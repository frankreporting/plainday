import { requestUrl } from "obsidian";
import ICAL from "ical.js";

export default class CalendarFeed {
    // Downloads a calendar's private link (Google's secret address, iCloud's public calendar link,
    // Outlook's published calendar) and reads it into the events the calendar sync writes into
    // daily notes, in the shape the Mac's fetcher wrote to calendar-events.json, so the sync's
    // apply() takes them as they are (OBS-274; part 1 of OBS-231's plan). Nothing calls it yet:
    // OBS-275 wires it into Sync calendars.
    //
    //   const window = feed.window(62);
    //   const got = await feed.load(link, { calendar: { id, name, account }, window });
    //   got.problem   "dead" (the link stopped working), "unreachable", or "unreadable"
    //   got.events    the events, as calendar-events.json held them; got.name, the feed's own name
    //   got.failed    the UIDs of events it couldn't read: their lines are to be left as they are,
    //                 not taken for canceled
    //   feed.feed([{ calendar, events }], window)   the whole events file, for apply()
    //
    // How it reads a feed, from what OBS-227's spike found on real feeds:
    // - One-off events and overrides that ended more than a day before the window are dropped from
    //   the text before anything is parsed. Google's feed holds every event since the calendar
    //   began, and this is most of it. The day of margin covers an end written in UTC or another
    //   zone.
    // - Times are read in the time zones the feed itself defines. Outlook names zones the Windows
    //   way ("Eastern Standard Time"), which ical.js knows only from the feed's definitions. Each
    //   read keeps its zones to itself, so reads at the same time can't mix up two feeds' zones of
    //   the same name.
    // - Events are grouped by UID into a series and its overrides. A moved occurrence keeps its
    //   series' key, `UID@<original date>`; so does an override whose series isn't in the feed (an
    //   invitation to one occurrence of someone else's series).
    // - An all-day event ends 1 second before midnight on its last day, as EventKit reported it.
    // - An invitation the calendar's owner declined is left out, as EventKit left it out. For a
    //   Google link the owner is the calendar ID in the link's path; for any other, the attendee
    //   on the most events read (OBS-277 checks that against real iCloud and Outlook feeds).
    // - It works in small steps: it hands control back to the app every few milliseconds, so a
    //   large feed doesn't freeze the editor, and records its longest step for the speed check.
    // - An event it can't read (a rule ical.js would loop on, a date that doesn't parse) is left
    //   out and named in `failed`, and the rest of the calendar is read as usual. A feed it can't
    //   read at all is "unreadable", so nothing in it looks canceled.
    //
    // A link works like a password (OBS-231, 11/04): nothing here puts it in a result, an error,
    // the console or a notice. A failed download comes back as a problem and a status code only.

    static TIMEOUT_MS = 30000;
    // The answers that mean the link itself stopped working (reset, unpublished or deleted).
    // Anything else that fails means the calendar couldn't be reached this time.
    static DEAD = [401, 403, 404, 410];
    // How long one step runs before handing control back
    static SLICE_MS = 4;
    // Occurrences stepped through in one series before giving up on it
    static MAX_STEPS = 100000;
    static DAY_MS = 24 * 3600 * 1000;
    static STATUS = { CONFIRMED: "confirmed", TENTATIVE: "tentative", CANCELLED: "canceled", CANCELED: "canceled" };
    // A property's date in an event's text: the date's digits, whatever zone they're written in.
    // The value is what follows the last colon on the line, so a quoted zone name with a colon in
    // it (`TZID="(UTC+01:00) Amsterdam"`) doesn't confuse it. A line folded inside the property
    // doesn't match, and the event is then kept.
    static DTEND = /\nDTEND(?:;[^\r\n]*)?:(\d{8})(?:T\d{6}Z?)?[ \t]*\r?\n/i;
    static DTSTART = /\nDTSTART(?:;[^\r\n]*)?:(\d{8})(?:T\d{6}Z?)?[ \t]*\r?\n/i;
    static RECURRENCE_ID = /\nRECURRENCE-ID(?:;[^\r\n]*)?:(\d{8})(?:T\d{6}Z?)?[ \t]*\r?\n/i;
    static HAS_RECURRENCE_ID = /\nRECURRENCE-ID[;:]/i;
    static RULES = /\n(?:RRULE|RDATE|EXRULE)[;:]/i;
    static UID = /\nUID[;:][^\r\n]*/i;
    static GOOGLE = /^https:\/\/(?:www\.)?(?:calendar\.)?google\.com\/calendar\/ical\/([^/?#]+)\//i;

    // Downloads a link and reads it: the read, with how long the download took, or the problem
    async load(link, { calendar, window }) {
        const started = performance.now();
        const got = await this.download(link);
        const downloadMs = performance.now() - started;
        if (got.problem) return { problem: got.problem, status: got.status };
        const read = await this.read(got.text, { calendar, window, link });
        if (read.problem) return { problem: read.problem, status: got.status };
        read.stats.downloadMs = downloadMs;
        return read;
    }

    // The feed's text, or the problem: "dead" for an answer that says the link stopped working,
    // "unreachable" for any other failure, no answer, or none within TIMEOUT_MS, and "unreadable"
    // for an answer that isn't a calendar. Never the link, nor an error that could carry it.
    async download(link) {
        let timer;
        const timeout = new Promise((resolve) => { timer = window.setTimeout(() => resolve(undefined), CalendarFeed.TIMEOUT_MS); });
        // A request that fails after the timeout has won is caught too, so its error, which can
        // carry the address, never reaches the console as an unhandled rejection
        const request = Promise.resolve()
            .then(() => requestUrl({ url: this.url(link), method: "GET", throw: false }))
            .catch(() => null);
        const response = await Promise.race([request, timeout]);
        window.clearTimeout(timer);
        if (!response) return { problem: "unreachable", status: null };
        const status = Number(response.status) || null;
        if (CalendarFeed.DEAD.includes(status)) return { problem: "dead", status };
        if (!status || status < 200 || status >= 300) return { problem: "unreachable", status };
        let text;
        try {
            text = response.text;
        } catch {
            return { problem: "unreadable", status };
        }
        if (!this.isCalendar(text)) return { problem: "unreadable", status };
        return { text, status };
    }

    // A webcal:// link is fetched as https://
    url(link) {
        return String(link ?? "").trim().replace(/^webcals?:\/\//i, "https://");
    }

    // Whether text starts as a calendar does (after any byte-order mark, which trimStart takes)
    isCalendar(text) {
        return typeof text === "string" && /^BEGIN:VCALENDAR[ \t]*\r?\n/i.test(text.trimStart().slice(0, 40));
    }

    // The window the Mac's fetcher used: today, through `days` days after it. `start` and `end`
    // are the instants an event's start must fall between (local midnight today, and local
    // midnight after the last day); windowStart and windowEnd are the first and last days.
    window(days, now = new Date()) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
        const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
        return { start, end, windowStart: this.date(start), windowEnd: this.date(last) };
    }

    // The whole events file, as the Mac's fetcher wrote it, from one or more calendars' reads:
    // [{ calendar: { id, name, account }, events }]
    feed(reads, window, now = new Date()) {
        return {
            generatedAt: this.stamp(now),
            source: "ical",
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
            calendars: reads.map(({ calendar }) => ({ id: calendar.id, title: calendar.name, account: calendar.account })),
            events: this.sorted(reads.flatMap((r) => r.events)),
        };
    }

    // Reads a feed's text: { name, events, failed, stats }, or { problem: "unreadable" }.
    // `calendar` is the calendar's { id, name, account } in Plainday's settings, `window` from
    // window(), and `link` the link it came from, which only says whose invitations were declined.
    async read(text, { calendar = {}, window, link = null }) {
        const clock = this.clock();
        try {
            if (!this.isCalendar(text)) return { problem: "unreadable" };
            const body = text.trimStart();
            const cutoff = Number(this.date(new Date(window.start.getFullYear(), window.start.getMonth(), window.start.getDate() - 1)).replaceAll("-", ""));
            const split = await this.split(body, cutoff, clock);
            if (!split) return { problem: "unreadable" };
            const { head, blocks, skipped } = split;
            const parsed = ICAL.parse(head);
            const roots = (typeof parsed[0] === "string" ? [parsed] : parsed).map((j) => new ICAL.Component(j));
            // Every event was split out of the text: one left in the rest is one the split didn't
            // recognise, and reading without it would make it look canceled
            if (roots.some((r) => r.getAllSubcomponents("vevent").length)) return { problem: "unreadable" };
            const root = roots[0];
            for (const other of roots.slice(1)) {
                for (const vtz of other.getAllSubcomponents("vtimezone")) root.addSubcomponent(vtz);
            }
            const name = roots.map((r) => String(r.getFirstPropertyValue("x-wr-calname") ?? "").trim()).find(Boolean) ?? null;
            this.zones(root, window);
            if (clock.due()) await clock.pause();

            const stats = { blocks: blocks.length + skipped, skipped, series: 0, declined: 0, failed: 0, unknownZones: 0 };
            const failed = new Set();
            const series = new Map();
            const all = [];
            for (const block of blocks) {
                let ve = null;
                try {
                    // The calendar as its parent, so its times find the feed's own zones
                    ve = new ICAL.Component(ICAL.parse(block), root);
                } catch {
                    ve = null;
                }
                if (ve?.name !== "vevent") {
                    // An event that doesn't parse: left out by its UID, or, with none to name it,
                    // the whole feed is unreadable
                    const uid = this.uidOf(block);
                    if (!uid) return { problem: "unreadable" };
                    failed.add(uid);
                    continue;
                }
                const uid = String(ve.getFirstPropertyValue("uid") ?? "").trim();
                // An event with no UID can't be told from one sync to the next, so it isn't synced
                if (!uid) continue;
                let s = series.get(uid);
                if (!s) series.set(uid, (s = { master: null, exceptions: [] }));
                if (ve.hasProperty("recurrence-id")) s.exceptions.push(ve);
                else s.master = ve;
                all.push(ve);
                if (clock.due()) await clock.pause();
            }
            stats.series = series.size;

            const owner = this.owner(link, all);
            const events = [];
            for (const [uid, { master, exceptions }] of series) {
                const found = [];
                const emit = (item, startTime, endTime, recurrenceId) => {
                    const event = this.event(item, startTime, endTime, recurrenceId, { calendar, window, owner, stats, root });
                    if (event) found.push(event);
                };
                let whole;
                try {
                    whole = await this.expand(master, exceptions, window, emit, clock);
                } catch {
                    whole = false;
                }
                // A series read only partly is left out whole, so none of its lines look canceled
                if (whole) events.push(...found);
                else failed.add(uid);
                if (clock.due()) await clock.pause();
            }
            // An event that failed anywhere (an override that didn't parse, say) is left out whole:
            // its series' other occurrences would otherwise come out as if it hadn't been moved
            const read = events.filter((e) => !failed.has(e.id));
            stats.failed = failed.size;
            stats.events = read.length;
            clock.stop();
            return { name, events: this.sorted(read), failed: [...failed], stats: { ...stats, ...clock.stats() } };
        } catch {
            // A parse error's message quotes the feed, not the link, but there's nothing in it the
            // user can act on either: the feed isn't one Plainday can read
            return { problem: "unreadable" };
        }
    }

    // The feed's text split into its events, each an iCalendar text of its own, and the rest (the
    // calendar's own lines and its time zones). An event is a line that is BEGIN:VEVENT through
    // the next that is END:VEVENT, in any case: a line inside a property starts with a space, so
    // it can't be either. An old one-off event or override (see old()) is dropped here. Null when
    // an event runs into the next one without closing.
    async split(text, cutoff, clock) {
        const begin = /^BEGIN:VEVENT[ \t]*\r?$/gim;
        const end = /^END:VEVENT[ \t]*\r?$/gim;
        const head = [];
        const blocks = [];
        let skipped = 0;
        let pos = 0;
        for (;;) {
            begin.lastIndex = pos;
            const b = begin.exec(text);
            if (!b) break;
            end.lastIndex = b.index;
            const e = end.exec(text);
            // An event that never closes is left in the rest, whose read then fails: the feed is
            // cut off, and reading what came before would make its other events look canceled
            if (!e) break;
            // So is one that runs into the next event: the two would be read as one
            begin.lastIndex = b.index + 1;
            const again = begin.exec(text);
            if (again && again.index < e.index) return null;
            const newline = text.indexOf("\n", e.index);
            const after = newline < 0 ? text.length : newline + 1;
            head.push(text.slice(pos, b.index));
            // Its first and last lines written as ical.js reads them: it would take a trailing
            // space for part of the component's name
            const block = `BEGIN:VEVENT\r\n${text.slice(text.indexOf("\n", b.index) + 1, e.index)}END:VEVENT\r\n`;
            if (this.old(block, cutoff)) skipped++;
            else blocks.push(block);
            pos = after;
            if (clock.due()) await clock.pause();
        }
        head.push(text.slice(pos));
        return { head: head.join(""), blocks, skipped };
    }

    // An event that can't put anything in the window: no RRULE or RDATE; its end, or its start
    // when it has no end, dated before `cutoff` (YYYYMMDD); and, for an override, its original
    // date too, and no RANGE (a this-and-following change moves later occurrences). An event whose
    // dates can't be read is kept.
    old(block, cutoff) {
        if (CalendarFeed.RULES.test(block)) return false;
        if (CalendarFeed.HAS_RECURRENCE_ID.test(block)) {
            const rid = CalendarFeed.RECURRENCE_ID.exec(block);
            if (!rid || Number(rid[1]) >= cutoff || /RANGE=/i.test(block)) return false;
        }
        const m = CalendarFeed.DTEND.exec(block) ?? CalendarFeed.DTSTART.exec(block);
        return !!m && Number(m[1]) < cutoff;
    }

    // The UID of an event that doesn't parse, read as ical.js reads the UIDs of those that do
    // (parameters left out, escapes undone), or null
    uidOf(block) {
        const line = block.replace(/\r?\n[ \t]/g, "").match(CalendarFeed.UID)?.[0];
        if (!line) return null;
        try {
            return String(ICAL.Property.fromString(line.trim()).getFirstValue() ?? "").trim() || null;
        } catch {
            return null;
        }
    }

    // Readies the feed's own time zones. ical.js works a zone's changes out from each rule's
    // start, and Outlook's start in 1601: that's centuries of yearly changes in one step the first
    // time a time is read. So a yearly rule that never ends, and starts more than two years before
    // the window, starts then instead: the same changes from then on. A rule that ends is left as
    // it is, since its last change may be the zone's last. A zone with a rule ical.js could loop on
    // is dropped, and its times read as the device's.
    zones(root, window) {
        const year = window.start.getFullYear() - 2;
        for (const vtz of root.getAllSubcomponents("vtimezone")) {
            let bad = false;
            for (const obs of vtz.getAllSubcomponents()) {
                if (obs.name !== "standard" && obs.name !== "daylight") continue;
                const rules = obs.getAllProperties("rrule");
                if (!rules.length) continue;
                const rule = rules[0].getFirstValue();
                const start = obs.getFirstPropertyValue("dtstart");
                if (rules.length > 1 || !start || rule.freq !== "YEARLY" || this.unsafe(rule, start)) { bad = true; break; }
                if (rule.until || rule.count || (rule.interval || 1) !== 1 || start.year >= year) continue;
                const later = start.clone();
                later.year = year;
                if (later.month === 2 && later.day === 29) later.day = 28;
                obs.updatePropertyWithValue("dtstart", later);
            }
            if (bad) root.removeSubcomponent(vtz);
        }
    }

    // Why a repeating rule isn't read, or null. ical.js loops forever, or until memory runs out,
    // on some rules RFC 5545 allows (a daily rule limited to a month's last day, a daily rule every
    // 7 days on a weekday it never lands on, a date no month has), inside one step, where nothing
    // can stop it. So only the shapes calendar apps write are read (Google's, iCloud's and
    // Outlook's), each of which it steps through in bounded time: daily or weekly, on weekdays;
    // monthly on days of the month, or on weekdays with a position; yearly in given months, on a day
    // or a weekday with a position. `start`
    // is the series' first start, whose month and day stand in for a missing BYMONTH or BYMONTHDAY.
    unsafe(rule, start) {
        const p = rule.parts ?? {};
        if (Object.keys(p).some((k) => !["BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"].includes(k))) return "part";
        const interval = rule.interval || 1;
        const byday = (p.BYDAY ?? []).map((d) => /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(String(d)));
        if (byday.some((m) => !m)) return "BYDAY";
        const ordinals = byday.map((m) => (m[1] ? Number(m[1]) : 0));
        const days = (p.BYMONTHDAY ?? []).map(Number);
        const months = (p.BYMONTH ?? []).map(Number);
        const setpos = (p.BYSETPOS ?? []).map(Number);
        const position = (n) => Number.isInteger(n) && n !== 0 && Math.abs(n) <= 5;
        if (days.some((d) => !Number.isInteger(d) || d === 0 || Math.abs(d) > 31)) return "BYMONTHDAY";
        if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) return "BYMONTH";
        if (!ordinals.every((o) => o === 0 || position(o)) || !setpos.every(position)) return "position";
        if (setpos.length && !byday.length) return "BYSETPOS";
        // A fifth weekday turns up within a few years only when every month or year is looked at
        const fifth = ordinals.some((o) => Math.abs(o) === 5) || setpos.some((n) => Math.abs(n) === 5);
        // The months a rule's dates can fall in, and whether a date there exists: February 29th
        // only in leap years, which a rule that skips years may never reach
        const longest = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const dated = (inMonths, everyYear) => {
            const want = days.length ? days : [start.day];
            const pairs = inMonths.flatMap((m) => want.filter((d) => Math.abs(d) <= longest[m - 1]).map((d) => [m, d]));
            if (!pairs.length) return false;
            return everyYear || !pairs.every(([m, d]) => m === 2 && Math.abs(d) === 29);
        };
        switch (rule.freq) {
            case "DAILY":
                if (days.length || months.length || setpos.length || ordinals.some(Boolean)) return "DAILY";
                if (byday.length && interval !== 1) return "DAILY";
                return null;
            case "WEEKLY":
                if (days.length || months.length || setpos.length || ordinals.some(Boolean)) return "WEEKLY";
                return null;
            case "MONTHLY": {
                if (months.length || (days.length && byday.length) || (fifth && interval !== 1)) return "MONTHLY";
                if (byday.length) return null;
                const visited = [...new Set(Array.from({ length: 12 }, (_, n) => ((start.month - 1 + n * interval) % 12) + 1))];
                return dated(visited, interval === 12 || visited.length > 1) ? null : "no date";
            }
            case "YEARLY": {
                if ((byday.length && !months.length) || (fifth && interval !== 1)) return "YEARLY";
                // Days of the month and weekdays together only as old time zone definitions write
                // them (the Sunday among the 8th to the 14th): seven days in a row hold every weekday
                if (days.length && byday.length && (interval !== 1 || !this.week(days))) return "YEARLY";
                if (byday.length && !days.length) return null;
                return dated(months.length ? months : [start.month], interval === 1) ? null : "no date";
            }
            default:
                return "frequency";
        }
    }

    // Whether days of the month hold seven in a row
    week(days) {
        const set = new Set(days);
        return days.some((d) => [1, 2, 3, 4, 5, 6].every((k) => set.has(d + k)));
    }

    // One series: its master and its overrides (each with a RECURRENCE-ID), handing every
    // occurrence that starts in the window to `emit`. False when it can't be read whole.
    async expand(master, exceptions, window, emit, clock) {
        if (!master) {
            // Overrides with no series in the feed: invitations to single occurrences
            for (const ex of exceptions) {
                const e = new ICAL.Event(ex);
                emit(ex, e.startDate, e.endDate, e.recurrenceId);
                if (clock.due()) await clock.pause();
            }
            return true;
        }
        const ev = new ICAL.Event(master);
        if (!ev.isRecurring()) {
            emit(master, ev.startDate, ev.endDate, null);
            return true;
        }
        for (const p of master.getAllProperties("rrule")) if (this.unsafe(p.getFirstValue(), ev.startDate)) return false;
        // Occurrences are looked at from a day before the window to a day after it, and further by
        // as much as a this-and-following change moves them. An override moved into the window
        // from further away is caught after, from the overrides themselves.
        let from = window.start.getTime() - CalendarFeed.DAY_MS;
        let to = window.end.getTime() + CalendarFeed.DAY_MS;
        const zone = ev.startDate.zone;
        for (const ex of exceptions) {
            const e = new ICAL.Event(ex);
            ev.relateException(e);
            // An override whose original start is written in another zone than the series' is
            // found under the series' zone too, as ical.js finds the series' own occurrences
            const there = e.recurrenceId.convertToZone(zone).toString();
            if (!(there in ev.exceptions)) ev.exceptions[there] = e;
            if (e.modifiesFuture()) {
                const moved = e.startDate.toJSDate().getTime() - e.recurrenceId.toJSDate().getTime();
                from = Math.min(from, window.start.getTime() - CalendarFeed.DAY_MS - moved);
                to = Math.max(to, window.end.getTime() + CalendarFeed.DAY_MS - moved);
            }
            if (clock.due()) await clock.pause();
        }
        const matched = new Set();
        const it = ev.iterator(this.startFor(ev, from));
        let steps = 0;
        for (let next = it.next(); next; next = it.next()) {
            if (++steps > CalendarFeed.MAX_STEPS) return false;
            if (clock.due()) await clock.pause();
            const at = next.toJSDate().getTime();
            if (at >= to) break;
            if (at < from) continue;
            // The override for this occurrence itself, found as getOccurrenceDetails finds it
            const own = ev.exceptions[next.toString()] ?? ev.exceptions[next.convertToZone(ICAL.Timezone.utcTimezone).toString()];
            if (own) matched.add(own);
            const d = ev.getOccurrenceDetails(next);
            emit(d.item.component, d.startDate, d.endDate, d.recurrenceId);
        }
        for (const ex of new Set(Object.values(ev.exceptions))) {
            if (!matched.has(ex)) emit(ex.component, ex.startDate, ex.endDate, ex.recurrenceId);
            if (clock.due()) await clock.pause();
        }
        return true;
    }

    // Where to start stepping through a series' occurrences. ical.js steps through every one from
    // the series' start, which for a daily meeting of some years is thousands before the window.
    // A daily or weekly rule without a COUNT has the same occurrences from any start a whole number
    // of its periods later (the same weekday, the same week in its rhythm), so stepping starts at
    // the last such start at least one period before `from`. An occurrence there that the rule
    // wouldn't have made falls before `from`, where nothing is read. Anything else starts at the
    // series' start, as does one with an RDATE.
    startFor(ev, from) {
        const start = ev.startDate;
        const rules = ev.component.getAllProperties("rrule");
        // ical.js starts from an RDATE before the given start, and then steps its EXDATEs out of
        // line, so a series with any RDATE starts at its start
        if (rules.length !== 1 || ev.component.hasProperty("rdate")) return start;
        const rule = rules[0].getFirstValue();
        const days = rule.freq === "DAILY" ? 1 : rule.freq === "WEEKLY" ? 7 : 0;
        if (!days || rule.count) return start;
        const period = days * (rule.interval || 1);
        const behind = Math.floor((from - start.toJSDate().getTime()) / CalendarFeed.DAY_MS) - period;
        const periods = Math.floor(behind / period);
        if (periods < 1) return start;
        const later = start.clone();
        later.adjust(periods * period, 0, 0, 0);
        return later;
    }

    // One occurrence as the events file holds it, or null when it doesn't start in the window or
    // the owner declined it. `recurrenceId` is its original start, for an occurrence of a series.
    event(item, startTime, endTime, recurrenceId, { calendar, window, owner, stats, root }) {
        const start = startTime.toJSDate();
        if (start < window.start || start >= window.end) return null;
        if (this.declined(item, owner)) { stats.declined++; return null; }
        // A zone the feed doesn't define reads as the device's own (OBS-274's follow-up)
        const tzid = item.getFirstProperty("dtstart")?.getParameter("tzid");
        if (tzid && !root.getTimeZoneByID(tzid) && !ICAL.TimezoneService.has(tzid)) stats.unknownZones++;
        const allDay = startTime.isDate;
        const end = (endTime ?? startTime).toJSDate();
        // EventKit ends an all-day event 1 second before midnight on its last day; the feed's
        // DTEND is the midnight after it
        const last = allDay ? new Date(end.getTime() - 1000) : end;
        const date = this.date(start);
        const uid = String(item.getFirstPropertyValue("uid") ?? "").trim();
        const recurring = !!recurrenceId;
        const transp = String(item.getFirstPropertyValue("transp") ?? "").toUpperCase();
        return {
            key: recurring ? `${uid}@${this.date(recurrenceId.toJSDate())}` : uid,
            id: uid,
            calendarId: calendar.id ?? null,
            calendar: calendar.name ?? null,
            account: calendar.account ?? null,
            title: String(item.getFirstPropertyValue("summary") ?? "").trim(),
            date,
            start: this.stamp(start),
            end: this.stamp(last),
            endsSameDay: this.date(last) === date,
            allDay,
            recurring,
            status: CalendarFeed.STATUS[String(item.getFirstPropertyValue("status") ?? "").toUpperCase()] ?? "none",
            availability: transp === "TRANSPARENT" ? "free" : "busy",
        };
    }

    // The calendar's own address, lowercased: from a Google link's path, or else the attendee on
    // the most events read. Null when there's none, or two are on as many.
    owner(link, vevents) {
        const m = CalendarFeed.GOOGLE.exec(this.url(link));
        if (m) {
            try {
                return this.address(decodeURIComponent(m[1]));
            } catch {
                // a path that doesn't decode falls back to the attendees
            }
        }
        const counts = new Map();
        for (const ve of vevents) {
            const seen = new Set();
            for (const a of ve.getAllProperties("attendee")) {
                const who = this.attendee(a);
                if (!who || seen.has(who)) continue;
                seen.add(who);
                counts.set(who, (counts.get(who) ?? 0) + 1);
            }
        }
        // On a tie it can't tell, and takes no one: no event is left out
        let best = null, most = 0, tie = false;
        for (const [who, n] of counts) {
            if (n > most) { best = who; most = n; tie = false; } else if (n === most) tie = true;
        }
        return tie ? null : best;
    }

    // An attendee's address: its EMAIL parameter (iCloud's), or its value without `mailto:`
    attendee(property) {
        return this.address(property.getParameter("email") ?? property.getFirstValue());
    }

    address(value) {
        return String(value ?? "").trim().replace(/^mailto:/i, "").toLowerCase();
    }

    declined(item, owner) {
        if (!owner) return false;
        return item.getAllProperties("attendee").some((a) => this.attendee(a) === owner && String(a.getParameter("partstat") ?? "").toUpperCase() === "DECLINED");
    }

    // By start, then title, as the Mac's fetcher sorted them
    sorted(events) {
        return events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    }

    // A day as YYYY-MM-DD, in this device's time zone
    date(d) {
        return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
    }

    // An instant as local time with its offset, as moment().format() writes it and the Mac's
    // fetcher did: 2026-11-13T09:30:00-05:00
    stamp(d) {
        const offset = -d.getTimezoneOffset();
        const abs = Math.abs(offset);
        return `${this.date(d)}T${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}${offset < 0 ? "-" : "+"}${this.pad(Math.floor(abs / 60))}:${this.pad(abs % 60)}`;
    }

    pad(n) {
        return String(n).padStart(2, "0");
    }

    // Times the read's steps: due() says the current step has run SLICE_MS, pause() hands control
    // back to the app and starts the next, and stats() gives the busy time, the longest step and
    // the number of steps
    clock() {
        const now = () => performance.now();
        let since = now(), busy = 0, longest = 0, steps = 0;
        const end = () => {
            const step = now() - since;
            busy += step;
            longest = Math.max(longest, step);
            steps++;
        };
        return {
            due: () => now() - since >= CalendarFeed.SLICE_MS,
            pause: async () => {
                end();
                await this.handBack();
                since = now();
            },
            stop: end,
            stats: () => ({ readMs: busy, longestMs: longest, steps }),
        };
    }

    // Lets the app run whatever is waiting (a keystroke, a repaint) before the read goes on.
    // scheduler.yield() where the app has it (Obsidian's desktop app); else a message posted to
    // itself, which a hidden window doesn't hold back the way it holds back timers; else a timer.
    handBack() {
        const scheduler = /** @type {any} */ (window).scheduler;
        if (typeof scheduler?.yield === "function") return scheduler.yield();
        const Channel = window.MessageChannel;
        if (typeof Channel === "function") {
            return new Promise((resolve) => {
                const { port1, port2 } = new Channel();
                port1.onmessage = () => {
                    port1.close();
                    resolve(undefined);
                };
                port2.postMessage(null);
            });
        }
        return new Promise((resolve) => window.setTimeout(resolve, 0));
    }
}
