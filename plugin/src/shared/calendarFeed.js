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
    // - One-off events that ended more than a day before the window are dropped from the text
    //   before anything is parsed. Google's feed holds every event since the calendar began, and
    //   this is most of it. The day of margin covers an end written in UTC or another zone.
    // - Times are read in this device's own time zone data, by the zone's name: an IANA name
    //   (Google's and iCloud's, "America/New_York") as it is, a Windows name (Outlook's, "Eastern
    //   Standard Time") through Unicode's table of them (WINDOWS). Only a name the device doesn't
    //   know ("Customized Time Zone") is read from the feed's own definition, which each read
    //   keeps to itself. An event in a zone neither knows goes to `failed`.
    // - Events are grouped by UID into a series and its overrides. A moved occurrence keeps its
    //   series' key, `UID@<original date>`; so does an override whose series isn't in the feed (an
    //   invitation to one occurrence of someone else's series).
    // - An all-day event ends 1 second before midnight on its last day, as EventKit reported it.
    // - An invitation the calendar's owner declined is left out, as EventKit left it out. For a
    //   Google link the owner is the calendar ID in the link's path; for any other, the attendee
    //   on the most events read (OBS-277 checks that against real iCloud and Outlook feeds).
    // - It works in small steps: it hands control back to the app every few milliseconds, so a
    //   large feed doesn't freeze the editor, and records its longest step for the speed check.
    // - An event it can't read (a rule ical.js would loop on, a date that doesn't parse, a zone
    //   it doesn't know, two events with one UID) is left out and named in `failed`, and the rest of
    //   the calendar is read as usual. A feed it can't read at all is "unreadable", so nothing in
    //   it looks canceled.
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
    static REPEATS = /\n(?:RRULE|RDATE|EXRULE|RECURRENCE-ID)[;:]/i;
    static GOOGLE = /^https:\/\/(?:www\.)?(?:calendar\.)?google\.com\/calendar\/ical\/([^/?#]+)\//i;
    // Windows zone names, as Outlook writes them, and the IANA name of each: Unicode CLDR 46's
    // windowsZones.xml, its "001" (whole zone) rows
    static WINDOWS = {
        "Dateline Standard Time": "Etc/GMT+12", "UTC-11": "Etc/GMT+11",
        "Aleutian Standard Time": "America/Adak", "Hawaiian Standard Time": "Pacific/Honolulu",
        "Marquesas Standard Time": "Pacific/Marquesas",
        "Alaskan Standard Time": "America/Anchorage", "UTC-09": "Etc/GMT+9",
        "Pacific Standard Time (Mexico)": "America/Tijuana", "UTC-08": "Etc/GMT+8",
        "Pacific Standard Time": "America/Los_Angeles",
        "US Mountain Standard Time": "America/Phoenix",
        "Mountain Standard Time (Mexico)": "America/Mazatlan",
        "Mountain Standard Time": "America/Denver", "Yukon Standard Time": "America/Whitehorse",
        "Central America Standard Time": "America/Guatemala",
        "Central Standard Time": "America/Chicago", "Easter Island Standard Time": "Pacific/Easter",
        "Central Standard Time (Mexico)": "America/Mexico_City",
        "Canada Central Standard Time": "America/Regina",
        "SA Pacific Standard Time": "America/Bogota",
        "Eastern Standard Time (Mexico)": "America/Cancun",
        "Eastern Standard Time": "America/New_York",
        "Haiti Standard Time": "America/Port-au-Prince", "Cuba Standard Time": "America/Havana",
        "US Eastern Standard Time": "America/Indianapolis",
        "Turks And Caicos Standard Time": "America/Grand_Turk",
        "Paraguay Standard Time": "America/Asuncion", "Atlantic Standard Time": "America/Halifax",
        "Venezuela Standard Time": "America/Caracas",
        "Central Brazilian Standard Time": "America/Cuiaba",
        "SA Western Standard Time": "America/La_Paz",
        "Pacific SA Standard Time": "America/Santiago",
        "Newfoundland Standard Time": "America/St_Johns",
        "Tocantins Standard Time": "America/Araguaina",
        "E. South America Standard Time": "America/Sao_Paulo",
        "SA Eastern Standard Time": "America/Cayenne",
        "Argentina Standard Time": "America/Buenos_Aires",
        "Greenland Standard Time": "America/Godthab",
        "Montevideo Standard Time": "America/Montevideo",
        "Magallanes Standard Time": "America/Punta_Arenas",
        "Saint Pierre Standard Time": "America/Miquelon", "Bahia Standard Time": "America/Bahia",
        "UTC-02": "Etc/GMT+2", "Azores Standard Time": "Atlantic/Azores",
        "Cape Verde Standard Time": "Atlantic/Cape_Verde", "UTC": "Etc/UTC",
        "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik",
        "Sao Tome Standard Time": "Africa/Sao_Tome", "Morocco Standard Time": "Africa/Casablanca",
        "W. Europe Standard Time": "Europe/Berlin",
        "Central Europe Standard Time": "Europe/Budapest", "Romance Standard Time": "Europe/Paris",
        "Central European Standard Time": "Europe/Warsaw",
        "W. Central Africa Standard Time": "Africa/Lagos", "Jordan Standard Time": "Asia/Amman",
        "GTB Standard Time": "Europe/Bucharest", "Middle East Standard Time": "Asia/Beirut",
        "Egypt Standard Time": "Africa/Cairo", "E. Europe Standard Time": "Europe/Chisinau",
        "Syria Standard Time": "Asia/Damascus", "West Bank Standard Time": "Asia/Hebron",
        "South Africa Standard Time": "Africa/Johannesburg", "FLE Standard Time": "Europe/Kiev",
        "Israel Standard Time": "Asia/Jerusalem", "South Sudan Standard Time": "Africa/Juba",
        "Kaliningrad Standard Time": "Europe/Kaliningrad", "Sudan Standard Time": "Africa/Khartoum",
        "Libya Standard Time": "Africa/Tripoli", "Namibia Standard Time": "Africa/Windhoek",
        "Arabic Standard Time": "Asia/Baghdad", "Turkey Standard Time": "Europe/Istanbul",
        "Arab Standard Time": "Asia/Riyadh", "Belarus Standard Time": "Europe/Minsk",
        "Russian Standard Time": "Europe/Moscow", "E. Africa Standard Time": "Africa/Nairobi",
        "Iran Standard Time": "Asia/Tehran", "Arabian Standard Time": "Asia/Dubai",
        "Astrakhan Standard Time": "Europe/Astrakhan", "Azerbaijan Standard Time": "Asia/Baku",
        "Russia Time Zone 3": "Europe/Samara", "Mauritius Standard Time": "Indian/Mauritius",
        "Saratov Standard Time": "Europe/Saratov", "Georgian Standard Time": "Asia/Tbilisi",
        "Volgograd Standard Time": "Europe/Volgograd", "Caucasus Standard Time": "Asia/Yerevan",
        "Afghanistan Standard Time": "Asia/Kabul", "West Asia Standard Time": "Asia/Tashkent",
        "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
        "Pakistan Standard Time": "Asia/Karachi", "Qyzylorda Standard Time": "Asia/Qyzylorda",
        "India Standard Time": "Asia/Calcutta", "Sri Lanka Standard Time": "Asia/Colombo",
        "Nepal Standard Time": "Asia/Katmandu", "Central Asia Standard Time": "Asia/Bishkek",
        "Bangladesh Standard Time": "Asia/Dhaka", "Omsk Standard Time": "Asia/Omsk",
        "Myanmar Standard Time": "Asia/Rangoon", "SE Asia Standard Time": "Asia/Bangkok",
        "Altai Standard Time": "Asia/Barnaul", "W. Mongolia Standard Time": "Asia/Hovd",
        "North Asia Standard Time": "Asia/Krasnoyarsk",
        "N. Central Asia Standard Time": "Asia/Novosibirsk", "Tomsk Standard Time": "Asia/Tomsk",
        "China Standard Time": "Asia/Shanghai", "North Asia East Standard Time": "Asia/Irkutsk",
        "Singapore Standard Time": "Asia/Singapore",
        "W. Australia Standard Time": "Australia/Perth", "Taipei Standard Time": "Asia/Taipei",
        "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
        "Aus Central W. Standard Time": "Australia/Eucla",
        "Transbaikal Standard Time": "Asia/Chita", "Tokyo Standard Time": "Asia/Tokyo",
        "North Korea Standard Time": "Asia/Pyongyang", "Korea Standard Time": "Asia/Seoul",
        "Yakutsk Standard Time": "Asia/Yakutsk",
        "Cen. Australia Standard Time": "Australia/Adelaide",
        "AUS Central Standard Time": "Australia/Darwin",
        "E. Australia Standard Time": "Australia/Brisbane",
        "AUS Eastern Standard Time": "Australia/Sydney",
        "West Pacific Standard Time": "Pacific/Port_Moresby",
        "Tasmania Standard Time": "Australia/Hobart",
        "Vladivostok Standard Time": "Asia/Vladivostok",
        "Lord Howe Standard Time": "Australia/Lord_Howe",
        "Bougainville Standard Time": "Pacific/Bougainville",
        "Russia Time Zone 10": "Asia/Srednekolymsk", "Magadan Standard Time": "Asia/Magadan",
        "Norfolk Standard Time": "Pacific/Norfolk", "Sakhalin Standard Time": "Asia/Sakhalin",
        "Central Pacific Standard Time": "Pacific/Guadalcanal",
        "Russia Time Zone 11": "Asia/Kamchatka", "New Zealand Standard Time": "Pacific/Auckland",
        "UTC+12": "Etc/GMT-12", "Fiji Standard Time": "Pacific/Fiji",
        "Chatham Islands Standard Time": "Pacific/Chatham", "UTC+13": "Etc/GMT-13",
        "Tonga Standard Time": "Pacific/Tongatapu", "Samoa Standard Time": "Pacific/Apia",
        "Line Islands Standard Time": "Pacific/Kiritimati",
    };

    constructor() {
        // Zones by the name a feed gives them: the device's zone for that name, or null
        this.deviceZones = new Map();
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
            const known = this.zones(root);
            // The device's zone data loads the first time any is asked for, once after Obsidian
            // starts (about 10 ms on a Mac): in a step of its own
            if (!this.deviceZones.size) {
                await clock.pause();
                this.deviceZone("UTC");
            }
            await clock.pause();

            const stats = { blocks: blocks.length + skipped, skipped, series: 0, declined: 0, failed: 0, unknownZones: 0 };
            const failed = new Set();
            const series = new Map();
            const all = [];
            // The attendees of events that didn't parse, which still count toward the owner
            const unread = [];
            for (const block of blocks) {
                let ve = null;
                try {
                    // The calendar as its parent, so its times find their zones through it
                    ve = new ICAL.Component(ICAL.parse(block), root);
                } catch {
                    ve = null;
                }
                if (ve?.name !== "vevent") {
                    // An event that doesn't parse: left out by its UID, or, with none to name it,
                    // the whole feed is unreadable
                    const { uid, attendees } = this.unparsed(block);
                    if (!uid) return { problem: "unreadable" };
                    failed.add(uid);
                    unread.push(attendees);
                    continue;
                }
                const uid = String(ve.getFirstPropertyValue("uid") ?? "").trim();
                // An event with no UID can't be told from one sync to the next, so it isn't synced
                if (!uid) continue;
                all.push(ve);
                let s = series.get(uid);
                if (!s) series.set(uid, (s = { master: null, exceptions: [] }));
                if (ve.hasProperty("recurrence-id")) s.exceptions.push(ve);
                // Two events with one UID can't both be synced, nor told which is which
                else if (s.master) failed.add(uid);
                else s.master = ve;
                // EXRULE, the old way to leave dates out of a series, which ical.js doesn't read,
                // and a time in a zone neither the device nor the feed knows
                if (ve.hasProperty("exrule")) failed.add(uid);
                if (this.unknownZone(ve, known)) { failed.add(uid); stats.unknownZones++; }
                if (clock.due()) await clock.pause();
            }
            stats.series = series.size;

            const owner = await this.owner(link, all, unread, clock);
            const events = [];
            for (const [uid, { master, exceptions }] of series) {
                if (failed.has(uid)) continue;
                const found = [];
                const emit = (item, startTime, endTime, recurrenceId) => {
                    const event = this.event(item, startTime, endTime, recurrenceId, { calendar, window, owner, stats });
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

    // A one-off event that ended before `cutoff` (YYYYMMDD): no RRULE, RDATE, EXRULE or
    // RECURRENCE-ID, and its end, or its start when it has no end, dated before it. Only those:
    // an occurrence of a series can be moved by another (a this-and-following change), so
    // whether one matters depends on more than its own text. An event whose dates can't be read
    // is kept.
    old(block, cutoff) {
        if (CalendarFeed.REPEATS.test(block)) return false;
        const m = CalendarFeed.DTEND.exec(block) ?? CalendarFeed.DTSTART.exec(block);
        return !!m && Number(m[1]) < cutoff;
    }

    // The UID and attendees of an event that doesn't parse, read as ical.js reads those of events
    // that do (parameters left out, escapes undone), from the event's own lines: not those of an
    // alarm or anything else inside it, which can have a UID of its own
    unparsed(block) {
        let depth = 0, uid = null;
        const attendees = [];
        for (const line of block.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
            if (/^BEGIN:/i.test(line)) { depth++; continue; }
            if (/^END:/i.test(line)) { depth--; continue; }
            if (depth !== 1) continue;
            try {
                if (!uid && /^UID[;:]/i.test(line)) uid = String(ICAL.Property.fromString(line.trim()).getFirstValue() ?? "").trim() || null;
                if (/^ATTENDEE[;:]/i.test(line)) attendees.push(this.attendee(ICAL.Property.fromString(line.trim())));
            } catch {
                // a line that doesn't parse names nothing
            }
        }
        return { uid, attendees };
    }

    // Readies the zones for the read: a time in a zone the device knows by its name is read from
    // the device's own zone data, and only one it doesn't from the feed's definition. A feed's
    // definition with a rule ical.js could loop on is dropped. Returns whether a zone name is
    // known, one way or the other.
    zones(root) {
        for (const vtz of root.getAllSubcomponents("vtimezone")) {
            const bad = vtz.getAllSubcomponents().some((obs) => {
                const rules = obs.getAllProperties("rrule");
                if (!rules.length) return false;
                const start = obs.getFirstPropertyValue("dtstart");
                const rule = rules[0].getFirstValue();
                return rules.length > 1 || !start || rule.freq !== "YEARLY" || !!this.unsafe(rule, start);
            });
            if (bad) root.removeSubcomponent(vtz);
        }
        const defined = new Set(root.getAllSubcomponents("vtimezone").map((vtz) => String(vtz.getFirstPropertyValue("tzid") ?? "")));
        const own = root.getTimeZoneByID.bind(root);
        root.getTimeZoneByID = (tzid) => this.deviceZone(tzid) ?? own(tzid);
        return (tzid) => !!this.deviceZone(tzid) || defined.has(tzid) || ICAL.TimezoneService.has(tzid);
    }

    // Whether an event names a zone that isn't known, on any of its times
    unknownZone(ve, known) {
        return ve.getAllProperties().some((p) => {
            const tzid = p.getParameter("tzid");
            return !!tzid && !known(tzid);
        });
    }

    // The device's zone for a name a feed gives, or null: an IANA name the device knows, or a
    // Windows name in WINDOWS. It answers ical.js's one question of a zone, its offset at a local
    // time there, from the device's own zone data.
    deviceZone(tzid) {
        if (this.deviceZones.has(tzid)) return this.deviceZones.get(tzid);
        const name = String(tzid ?? "").trim();
        const iana = Object.prototype.hasOwnProperty.call(CalendarFeed.WINDOWS, name) ? CalendarFeed.WINDOWS[name] : name;
        let zone;
        try {
            const format = new Intl.DateTimeFormat("en-US", {
                timeZone: iana, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
                hour: "numeric", minute: "numeric", second: "numeric",
            });
            // The offset at an instant: the local time there, less the instant
            const at = (ms) => {
                const parts = {};
                for (const { type, value } of format.formatToParts(new Date(ms))) parts[type] = Number(value);
                return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - (ms - (((ms % 1000) + 1000) % 1000));
            };
            // Each local day's offsets a day either side of it: the same on a day with no change
            // near it, which is nearly every day, so its times need nothing more
            const days = new Map();
            const around = (day) => {
                let pair = days.get(day);
                if (!pair) {
                    if (days.size > 5000) days.clear();
                    pair = [at((day - 1) * CalendarFeed.DAY_MS), at((day + 2) * CalendarFeed.DAY_MS)];
                    days.set(day, pair);
                }
                return pair;
            };
            zone = new ICAL.Timezone({ tzid: name });
            // In seconds, for a local time there. A time that happens twice (the hour the clocks go
            // back) is the first, and one that never happens (the hour they skip) is read with the
            // offset from before, so it lands after the gap, as RFC 5545 says.
            zone.utcOffset = (tt) => {
                const wall = Date.UTC(tt.year, tt.month - 1, tt.day, tt.hour, tt.minute, tt.second);
                const [before, after] = around(Math.floor(wall / CalendarFeed.DAY_MS));
                if (before === after) return before / 1000;
                const fits = [before, after].filter((o) => at(wall - o) === o);
                return (fits.length ? Math.max(...fits) : before) / 1000;
            };
        } catch {
            zone = null;
        }
        this.deviceZones.set(tzid, zone);
        return zone;
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
        // Nothing an app writes repeats less often than every 999 days, weeks, months or years
        if (interval > 999) return "interval";
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
        // A position among numbered weekdays ("the second of the first Mondays"), which no app
        // writes, can leave ical.js searching for years
        if (setpos.length && (!byday.length || ordinals.some(Boolean))) return "BYSETPOS";
        // A fifth weekday in a month a yearly rule skips years to may never come round
        const fifth = ordinals.some((o) => Math.abs(o) === 5) || setpos.some((n) => Math.abs(n) === 5);
        // The months a rule's dates can fall in, and whether a date there exists: February 29th
        // only in leap years, which a rule that skips years may never reach. `years` is the
        // number of years between the times it comes to February.
        const longest = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const dated = (inMonths, years) => {
            const want = days.length ? days : [start.day];
            const pairs = inMonths.flatMap((m) => want.filter((d) => Math.abs(d) <= longest[m - 1]).map((d) => [m, d]));
            if (!pairs.length) return false;
            if (!pairs.every(([m, d]) => m === 2 && Math.abs(d) === 29)) return true;
            return [0, 1, 2, 3].some((n) => (start.year + n * years) % 4 === 0);
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
                // A fifth weekday every few months is fine: ical.js gives up on a month rule after
                // 28 years of months without a date
                if (months.length || (days.length && byday.length)) return "MONTHLY";
                if (byday.length) return null;
                const visited = [...new Set(Array.from({ length: 12 }, (_, n) => ((start.month - 1 + n * interval) % 12) + 1))];
                return dated(visited, visited.length > 1 ? 1 : interval / 12) ? null : "no date";
            }
            case "YEARLY": {
                if ((byday.length && !months.length) || (fifth && interval !== 1)) return "YEARLY";
                // Days of the month and weekdays together only as old time zone definitions write
                // them (the Sunday among the 8th to the 14th): seven days in a row hold every weekday
                if (days.length && byday.length && (interval !== 1 || !this.week(days))) return "YEARLY";
                if (byday.length && !days.length) return null;
                return dated(months.length ? months : [start.month], interval) ? null : "no date";
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
        // Nothing past the year after the window's end is worked out: a date far ahead (a year
        // typed as 3026) would have a zone's changes worked out up to it, in one step
        const last = window.end.getFullYear() + 1;
        const zone = ev.startDate.zone;
        for (const ex of exceptions) {
            const e = new ICAL.Event(ex);
            ev.relateException(e);
            if (e.recurrenceId.year > last || e.startDate.year > last) continue;
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
        const it = ev.iterator(this.startFor(ev, from, last));
        let steps = 0;
        for (let next = it.next(); next; next = it.next()) {
            if (++steps > CalendarFeed.MAX_STEPS) return false;
            if (clock.due()) await clock.pause();
            if (next.year > last) break;
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
    startFor(ev, from, last = Infinity) {
        const start = ev.startDate;
        if (start.year > last) return start;
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
    event(item, startTime, endTime, recurrenceId, { calendar, window, owner, stats }) {
        // A date far past the window is out of it, without working out its zone's offset there
        const farthest = window.end.getFullYear() + 1;
        if (startTime.year > farthest) return null;
        const start = startTime.toJSDate();
        if (start < window.start || start >= window.end) return null;
        if (this.declined(item, owner)) { stats.declined++; return null; }
        const allDay = startTime.isDate;
        // An end years ahead is read as a day past the window: the line gets no end time
        const end = endTime && endTime.year > farthest ? new Date(window.end.getTime() + CalendarFeed.DAY_MS) : (endTime ?? startTime).toJSDate();
        // EventKit ends an all-day event 1 second before midnight on its last day; the feed's
        // DTEND is the midnight after it
        const last = allDay ? new Date(end.getTime() - 1000) : end;
        const date = this.date(start);
        const uid = String(item.getFirstPropertyValue("uid") ?? "").trim();
        const recurring = !!recurrenceId;
        const transp = String(item.getFirstPropertyValue("transp") ?? "").toUpperCase();
        return {
            key: recurring ? `${uid}@${recurrenceId.year > farthest ? recurrenceId.toString().slice(0, 10) : this.date(recurrenceId.toJSDate())}` : uid,
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
    // the most events read, those that didn't parse included (`unread`, each a list of
    // addresses). Null when there's none, or two are on as many.
    async owner(link, vevents, unread = [], clock = null) {
        const m = CalendarFeed.GOOGLE.exec(this.url(link));
        if (m) {
            try {
                return this.address(decodeURIComponent(m[1]));
            } catch {
                // a path that doesn't decode falls back to the attendees
            }
        }
        const counts = new Map();
        const count = (addresses) => {
            for (const who of new Set(addresses)) if (who) counts.set(who, (counts.get(who) ?? 0) + 1);
        };
        for (const ve of vevents) {
            count(ve.getAllProperties("attendee").map((a) => this.attendee(a)));
            if (clock?.due()) await clock.pause();
        }
        for (const addresses of unread) count(addresses);
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
