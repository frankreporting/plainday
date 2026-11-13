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
    //   feed.feed([{ calendar, events }], window)   the whole events file, for apply()
    //
    // How it reads a feed, from what OBS-227's spike found on real feeds:
    // - One-off events that ended more than a day before the window are dropped from the text
    //   before anything is parsed. Google's feed holds every event since the calendar began, and
    //   this is most of it. The day of margin covers an end written in UTC or another zone.
    // - Every time zone the feed defines is registered first. Outlook names zones the Windows way
    //   ("Eastern Standard Time"), which ical.js knows only from the feed's own definitions.
    // - Events are grouped by UID into a series and its overrides. A moved occurrence keeps its
    //   series' key, `UID@<original date>`; so does an override whose series isn't in the feed (an
    //   invitation to one occurrence of someone else's series).
    // - An all-day event ends 1 second before midnight on its last day, as EventKit reported it.
    // - An invitation the calendar's owner declined is left out, as EventKit left it out. For a
    //   Google link the owner is the calendar ID in the link's path; for any other, the attendee
    //   on the most events (OBS-277 checks that against real iCloud and Outlook feeds).
    // - It works in small steps: it hands control back to the app every few milliseconds, so a
    //   large feed doesn't freeze the editor, and records its longest step for the speed check.
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
    // The end date of an event in the text, or its start when it has no end: the date's digits,
    // whatever zone they're written in. The value is what follows the last colon on the line, so a
    // quoted zone name with a colon in it (`TZID="(UTC+01:00) Amsterdam"`) doesn't confuse it.
    static DTEND = /\nDTEND(?:;[^\r\n]*)?:(\d{8})(?:T\d{6}Z?)?\r?\n/;
    static DTSTART = /\nDTSTART(?:;[^\r\n]*)?:(\d{8})(?:T\d{6}Z?)?\r?\n/;
    static REPEATS = /\n(?:RRULE|RDATE|RECURRENCE-ID)[;:]/;
    static GOOGLE = /^https:\/\/(?:www\.)?(?:calendar\.)?google\.com\/calendar\/ical\/([^/?#]+)\//i;

    constructor() {
        // The text of each time zone registered with ical.js, by its TZID: a zone is registered
        // again only when a feed defines it differently
        this.zones = new Map();
    }

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
        return typeof text === "string" && /^BEGIN:VCALENDAR\r?\n/i.test(text.trimStart().slice(0, 32));
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

    // Reads a feed's text: { name, events, stats }, or { problem: "unreadable" }. `calendar` is
    // the calendar's { id, name, account } in Plainday's settings, `window` from window(), and
    // `link` the link it came from, which only says whose invitations were declined.
    async read(text, { calendar = {}, window, link = null }) {
        const clock = this.clock();
        try {
            if (!this.isCalendar(text)) return { problem: "unreadable" };
            const cutoff = Number(this.date(new Date(window.start.getFullYear(), window.start.getMonth(), window.start.getDate() - 1)).replaceAll("-", ""));
            const { head, blocks, skipped } = await this.split(text, cutoff, clock);
            const parsed = ICAL.parse(head);
            const roots = (typeof parsed[0] === "string" ? [parsed] : parsed).map((j) => new ICAL.Component(j));
            const name = roots.map((r) => String(r.getFirstPropertyValue("x-wr-calname") ?? "").trim()).find(Boolean) ?? null;
            for (const root of roots) this.register(root);
            if (clock.due()) await clock.pause();

            const stats = { blocks: blocks.length + skipped, skipped, series: 0, declined: 0, noUid: 0, capped: 0, unknownZones: 0 };
            const series = new Map();
            const all = [];
            for (const block of blocks) {
                const ve = new ICAL.Component(ICAL.parse(block));
                if (ve.name !== "vevent") continue;
                const uid = String(ve.getFirstPropertyValue("uid") ?? "").trim();
                // An event with no UID can't be told from one sync to the next, so it isn't synced
                if (!uid) { stats.noUid++; continue; }
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
            const emit = (item, startTime, endTime, recurrenceId) => {
                const event = this.event(item, startTime, endTime, recurrenceId, { calendar, window, owner, stats });
                if (event) events.push(event);
            };
            for (const [, { master, exceptions }] of series) {
                await this.expand(master, exceptions, window, emit, clock, stats);
                if (clock.due()) await clock.pause();
            }
            stats.events = events.length;
            clock.stop();
            return { name, events: this.sorted(events), stats: { ...stats, ...clock.stats() } };
        } catch {
            // A parse error's message quotes the feed, not the link, but there's nothing in it the
            // user can act on either: the feed isn't one Plainday can read
            return { problem: "unreadable" };
        }
    }

    // The feed's text split into its events, each an iCalendar text of its own, and the rest (the
    // calendar's own lines and its time zones). An event is a line that is exactly BEGIN:VEVENT
    // through the next that is exactly END:VEVENT: a line inside a property starts with a space,
    // so it can't be either. A one-off event that ended before `cutoff` (a date as YYYYMMDD) is
    // dropped here.
    async split(text, cutoff, clock) {
        const head = [];
        const blocks = [];
        let skipped = 0;
        let pos = 0;
        for (;;) {
            const begin = this.lineAt(text, "BEGIN:VEVENT", pos);
            if (begin < 0) break;
            const close = this.lineAt(text, "END:VEVENT", begin);
            // An event that never closes is left in the rest, whose parse then fails: the feed is
            // cut off, and reading what came before would make its other events look canceled
            if (close < 0) break;
            const newline = text.indexOf("\n", close);
            const after = newline < 0 ? text.length : newline + 1;
            head.push(text.slice(pos, begin));
            const block = text.slice(begin, after);
            if (this.old(block, cutoff)) skipped++;
            else blocks.push(block);
            pos = after;
            if (clock.due()) await clock.pause();
        }
        head.push(text.slice(pos));
        return { head: head.join(""), blocks, skipped };
    }

    // Where the next line that is exactly `line` starts, at or after `from`, or -1
    lineAt(text, line, from) {
        let i = from;
        for (;;) {
            i = text.indexOf(line, i);
            if (i < 0) return -1;
            const end = i + line.length;
            const starts = i === 0 || text[i - 1] === "\n";
            const ends = end === text.length || text[end] === "\n" || (text[end] === "\r" && (end + 1 === text.length || text[end + 1] === "\n"));
            if (starts && ends) return i;
            i = end;
        }
    }

    // A one-off event (no RRULE, RDATE or RECURRENCE-ID) whose end, or start when it has no end,
    // is dated before `cutoff`. An event whose dates can't be read is kept.
    old(block, cutoff) {
        if (CalendarFeed.REPEATS.test(block)) return false;
        const m = CalendarFeed.DTEND.exec(block) ?? CalendarFeed.DTSTART.exec(block);
        return !!m && Number(m[1]) < cutoff;
    }

    // Registers every time zone a calendar defines, before any of its times are read: ical.js
    // works a time's zone out when it first reads the time, from the zones registered then
    register(root) {
        for (const vtz of root.getAllSubcomponents("vtimezone")) {
            const tzid = String(vtz.getFirstPropertyValue("tzid") ?? "");
            if (!tzid) continue;
            const source = JSON.stringify(vtz.toJSON());
            if (this.zones.get(tzid) === source && ICAL.TimezoneService.has(tzid)) continue;
            ICAL.TimezoneService.register(new ICAL.Timezone(vtz), tzid);
            this.zones.set(tzid, source);
        }
    }

    // One series: its master and its overrides (each with a RECURRENCE-ID), handing every
    // occurrence that starts in the window to `emit`
    async expand(master, exceptions, window, emit, clock, stats) {
        if (!master) {
            // Overrides with no series in the feed: invitations to single occurrences
            for (const ex of exceptions) {
                const e = new ICAL.Event(ex);
                emit(ex, e.startDate, e.endDate, e.recurrenceId);
            }
            return;
        }
        const ev = new ICAL.Event(master);
        if (!ev.isRecurring()) {
            emit(master, ev.startDate, ev.endDate, null);
            return;
        }
        for (const ex of exceptions) ev.relateException(ex);
        // Occurrences are looked at from a day before the window to a day after it, which catches
        // one moved by a this-and-following change across the window's edge. An override moved
        // into the window from further away is caught after, from the overrides themselves.
        const from = window.start.getTime() - CalendarFeed.DAY_MS;
        const to = window.end.getTime() + CalendarFeed.DAY_MS;
        const matched = new Set();
        const it = ev.iterator(this.startFor(ev, from));
        let steps = 0;
        for (let next = it.next(); next; next = it.next()) {
            if (++steps > CalendarFeed.MAX_STEPS) { stats.capped++; break; }
            if ((steps & 63) === 0 && clock.due()) await clock.pause();
            const at = next.toJSDate().getTime();
            if (at >= to) break;
            if (at < from) continue;
            // The override for this occurrence itself, found as getOccurrenceDetails finds it
            const own = ev.exceptions[next.toString()] ?? ev.exceptions[next.convertToZone(ICAL.Timezone.utcTimezone).toString()];
            if (own) matched.add(own);
            const d = ev.getOccurrenceDetails(next);
            emit(d.item.component, d.startDate, d.endDate, d.recurrenceId);
        }
        for (const ex of Object.values(ev.exceptions)) {
            if (!matched.has(ex)) emit(ex.component, ex.startDate, ex.endDate, ex.recurrenceId);
        }
    }

    // Where to start stepping through a series' occurrences. ical.js steps through every one from
    // the series' start, which for a daily meeting of some years is thousands before the window.
    // A daily or weekly rule without a COUNT has the same occurrences from any start a whole number
    // of its periods later (the same weekday, the same week in its rhythm), so stepping starts at
    // the last such start at least one period before `from`. An occurrence there that the rule
    // wouldn't have made falls before `from`, where nothing is read. Anything else starts at the
    // series' start.
    startFor(ev, from) {
        const start = ev.startDate;
        const rules = ev.component.getAllProperties("rrule");
        if (rules.length !== 1) return start;
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
    event(item, startTime, endTime, recurrenceId, { calendar, window, owner, stats }) {
        const start = startTime.toJSDate();
        if (start < window.start || start >= window.end) return null;
        if (this.declined(item, owner)) { stats.declined++; return null; }
        const tzid = item.getFirstProperty("dtstart")?.getParameter("tzid");
        if (tzid && !ICAL.TimezoneService.has(tzid)) stats.unknownZones++;
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
    // the most events (the first seen, on a tie). Null when there's none.
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
        let best = null, most = 0;
        for (const [who, n] of counts) if (n > most) { best = who; most = n; }
        return best;
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

    // Lets the app run whatever is waiting (a keystroke, a repaint) before the read goes on
    handBack() {
        const scheduler = /** @type {any} */ (window).scheduler;
        if (typeof scheduler?.yield === "function") return scheduler.yield();
        return new Promise((resolve) => window.setTimeout(resolve, 0));
    }
}
