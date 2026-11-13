// Reads a calendar feed's text into the events the calendar sync writes into daily notes, in the
// shape the Mac's fetcher wrote to calendar-events.json, so the sync's apply() takes them as they
// are (OBS-274). It runs in a background worker (calendarWorker.js), which CalendarFeed
// (shared/calendarFeed.js) starts for each read and stops if it runs too long: ical.js loops
// forever on some impossible repeating rules, which only hand-made calendar files hold, and a
// worker that does can't freeze Obsidian. Nothing here hands control back or times itself out.
//
//   new CalendarReader().read(text, { calendar: { id, name, account }, window: { start, end }, owner })
//   → { name, events, failed: [{ uid, title }], stats } or { problem: "unreadable" }
//
// `window` holds the instants (or ms) an event's start must fall between; `owner` is the calendar's
// own address when the link says it (Google's), else the attendee on the most events is taken.
//
// How it reads a feed, from what OBS-227's spike found on real feeds:
// - One-off events that ended more than a day before the window are dropped from the text before
//   anything is parsed. Google's feed holds every event since the calendar began, and this is most
//   of it. The day of margin covers an end written in UTC or another zone. An occurrence of a
//   series is never dropped: another occurrence's change can move it.
// - Times are read in this device's own time zone data, by the zone's name: a full IANA name
//   (Google's and iCloud's, "America/New_York"), a Windows name (Outlook's, "Eastern Standard
//   Time") through Unicode's table of them (WINDOWS), or UTC. Any other name ("Customized Time
//   Zone", or an abbreviation like "BST", which the device would take for another place) is read
//   from the feed's own definition, kept to this read. An event in a zone neither knows goes to
//   `failed`.
// - Events are grouped by UID into a series and its overrides. A moved occurrence keeps its
//   series' key, `UID@<original date>`; so does an override whose series isn't in the feed (an
//   invitation to one occurrence of someone else's series).
// - An all-day event ends 1 second before midnight on its last day, as EventKit reported it.
// - An invitation the calendar's owner declined is left out, as EventKit left it out.
// - An event it can't read (one that doesn't parse, a zone it doesn't know, two events with one
//   UID, two overrides of one occurrence, EXRULE, a series it can't finish) is left out and named
//   in `failed`, with its title, and the rest of the calendar is read as usual. A feed it can't
//   read at all is "unreadable", so nothing in it looks canceled.
import ICAL from "ical.js";

export class CalendarReader {
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
    // A full IANA zone name (Area/Location, as many parts as it has), or UTC: the names read from
    // the device. An abbreviation isn't one: the device knows "BST" as Bangladesh's.
    static IANA = /^(?:[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+|UTC|GMT)$/;
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

    // Reads a feed's text: { name, events, failed, stats }, or { problem: "unreadable" }.
    // `calendar` is the calendar's { id, name, account } in Plainday's settings, `window` the
    // instants (or ms) an event's start must fall between, and `owner` the calendar's own address
    // when its link says it.
    read(text, { calendar = {}, window, owner = null }) {
        const started = performance.now();
        try {
            if (typeof text !== "string" || !/^BEGIN:VCALENDAR[ \t]*\r?\n/i.test(text.trimStart().slice(0, 40))) return { problem: "unreadable" };
            const range = { start: new Date(Number(window.start)), end: new Date(Number(window.end)) };
            const cutoff = Number(this.date(new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() - 1)).replaceAll("-", ""));
            const split = this.split(text.trimStart(), cutoff);
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

            const stats = { blocks: blocks.length + skipped, skipped, series: 0, declined: 0, failed: 0, unknownZones: 0 };
            // The events left out, by UID, with the title to name each by
            const failed = new Map();
            const fail = (uid, title) => { if (!failed.get(uid)) failed.set(uid, title || null); };
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
                    const { uid, title, attendees } = this.unparsed(block);
                    if (!uid) return { problem: "unreadable" };
                    fail(uid, title);
                    unread.push(attendees);
                    continue;
                }
                const uid = String(ve.getFirstPropertyValue("uid") ?? "").trim();
                // An event with no UID can't be told from one sync to the next, so it isn't synced
                if (!uid) continue;
                const title = String(ve.getFirstPropertyValue("summary") ?? "").trim();
                all.push(ve);
                let s = series.get(uid);
                if (!s) series.set(uid, (s = { master: null, exceptions: [], title }));
                if (ve.hasProperty("recurrence-id")) s.exceptions.push(ve);
                // Two events with one UID can't both be synced, nor told which is which
                else if (s.master) fail(uid, s.title);
                else s.master = ve;
                // EXRULE, the old way to leave dates out of a series, which ical.js doesn't read,
                // and a time in a zone neither the device nor the feed knows
                if (ve.hasProperty("exrule")) fail(uid, s.title);
                if (this.unknownZone(ve, known)) { fail(uid, s.title); stats.unknownZones++; }
            }
            stats.series = series.size;

            const guessed = owner ? String(owner).toLowerCase() : this.owner(all, unread);
            const events = [];
            for (const [uid, { master, exceptions, title }] of series) {
                if (failed.has(uid)) continue;
                const found = [];
                const emit = (item, startTime, endTime, recurrenceId) => {
                    const event = this.event(item, startTime, endTime, recurrenceId, { calendar, range, owner: guessed, stats });
                    if (event) found.push(event);
                };
                let whole;
                try {
                    whole = this.expand(master, exceptions, range, emit);
                } catch {
                    whole = false;
                }
                // A series read only partly is left out whole, so none of its lines look canceled
                if (whole) events.push(...found);
                else fail(uid, title);
            }
            // A series left out goes by its own title, not one of its moved occurrences
            for (const [uid, { master }] of series) {
                const title = master && String(master.getFirstPropertyValue("summary") ?? "").trim();
                if (title && failed.has(uid)) failed.set(uid, title);
            }
            const read = events.filter((e) => !failed.has(e.id));
            stats.failed = failed.size;
            stats.events = read.length;
            stats.readMs = performance.now() - started;
            return { name, events: this.sorted(read), failed: [...failed].map(([uid, title]) => ({ uid, title })), stats };
        } catch {
            // A parse error's message quotes the feed, but there's nothing in it the user can act
            // on: the feed isn't one Plainday can read
            return { problem: "unreadable" };
        }
    }

    // The feed's text split into its events, each an iCalendar text of its own, and the rest (the
    // calendar's own lines and its time zones). An event is a line that is BEGIN:VEVENT through
    // the next that is END:VEVENT, in any case: a line inside a property starts with a space, so
    // it can't be either. An old one-off event (see old()) is dropped here. Null when an event
    // runs into the next one without closing.
    split(text, cutoff) {
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
        if (CalendarReader.REPEATS.test(block)) return false;
        const m = CalendarReader.DTEND.exec(block) ?? CalendarReader.DTSTART.exec(block);
        return !!m && Number(m[1]) < cutoff;
    }

    // The UID, title and attendees of an event that doesn't parse, read as ical.js reads those of
    // events that do (parameters left out, escapes undone), from the event's own lines: not those
    // of an alarm or anything else inside it, which can have a UID of its own
    unparsed(block) {
        let depth = 0, uid = null, title = null;
        const attendees = [];
        for (const line of block.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
            if (/^BEGIN:/i.test(line)) { depth++; continue; }
            if (/^END:/i.test(line)) { depth--; continue; }
            if (depth !== 1) continue;
            try {
                const value = () => String(ICAL.Property.fromString(line.trim()).getFirstValue() ?? "").trim() || null;
                if (!uid && /^UID[;:]/i.test(line)) uid = value();
                if (!title && /^SUMMARY[;:]/i.test(line)) title = value();
                if (/^ATTENDEE[;:]/i.test(line)) attendees.push(this.attendee(ICAL.Property.fromString(line.trim())));
            } catch {
                // a line that doesn't parse names nothing
            }
        }
        return { uid, title, attendees };
    }

    // Readies the zones for the read: a time in a zone the device knows by its full name is read
    // from the device's own zone data, and only one it doesn't from the feed's definition.
    // Returns whether a zone name is known, one way or the other.
    zones(root) {
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

    // The device's zone for a name a feed gives, or null: a full IANA name the device knows, or a
    // Windows name in WINDOWS. It answers ical.js's one question of a zone, its offset at a local
    // time there, from the device's own zone data.
    deviceZone(tzid) {
        if (this.deviceZones.has(tzid)) return this.deviceZones.get(tzid);
        const name = String(tzid ?? "").trim();
        const iana = Object.prototype.hasOwnProperty.call(CalendarReader.WINDOWS, name) ? CalendarReader.WINDOWS[name]
            : CalendarReader.IANA.test(name) ? name : null;
        let zone = null;
        if (iana) {
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
                        pair = [at((day - 1) * CalendarReader.DAY_MS), at((day + 2) * CalendarReader.DAY_MS)];
                        days.set(day, pair);
                    }
                    return pair;
                };
                const device = new ICAL.Timezone({ tzid: name });
                // In seconds, for a local time there. A time that happens twice (the hour the clocks
                // go back) is the first, and one that never happens (the hour they skip) is read with
                // the offset from before, so it lands after the gap, as RFC 5545 says.
                device.utcOffset = (tt) => {
                    const wall = Date.UTC(tt.year, tt.month - 1, tt.day, tt.hour, tt.minute, tt.second);
                    const [before, after] = around(Math.floor(wall / CalendarReader.DAY_MS));
                    if (before === after) return before / 1000;
                    const fits = [before, after].filter((o) => at(wall - o) === o);
                    return (fits.length ? Math.max(...fits) : before) / 1000;
                };
                zone = device;
            } catch {
                zone = null;
            }
        }
        this.deviceZones.set(tzid, zone);
        return zone;
    }

    // One series: its master and its overrides (each with a RECURRENCE-ID), handing every
    // occurrence that starts in the window to `emit`. False when it can't be read whole; it
    // throws when two overrides change one occurrence.
    expand(master, exceptions, range, emit) {
        if (!master) {
            // Overrides with no series in the feed: invitations to single occurrences
            this.overrides(exceptions);
            for (const ex of exceptions) {
                const e = new ICAL.Event(ex);
                emit(ex, e.startDate, e.endDate, e.recurrenceId);
            }
            return true;
        }
        const ev = new ICAL.Event(master);
        if (!ev.isRecurring()) {
            emit(master, ev.startDate, ev.endDate, null);
            return true;
        }
        // Occurrences are looked at from a day before the window to a day after it, and further by
        // as much as a this-and-following change moves them. An override moved into the window
        // from further away is caught after, from the overrides themselves.
        let from = range.start.getTime() - CalendarReader.DAY_MS;
        let to = range.end.getTime() + CalendarReader.DAY_MS;
        // Each override by the instant of the occurrence it changes, whatever zone that's written
        // in: ical.js matches them by their clock times, which differ when the zones do
        const byInstant = this.overrides(exceptions);
        for (const e of byInstant.values()) {
            ev.relateException(e);
            if (e.modifiesFuture()) {
                const moved = e.startDate.toJSDate().getTime() - e.recurrenceId.toJSDate().getTime();
                from = Math.min(from, range.start.getTime() - CalendarReader.DAY_MS - moved);
                to = Math.max(to, range.end.getTime() + CalendarReader.DAY_MS - moved);
            }
        }
        const matched = new Set();
        const it = ev.iterator(this.startFor(ev, from));
        let steps = 0;
        for (let next = it.next(); next; next = it.next()) {
            if (++steps > CalendarReader.MAX_STEPS) return false;
            const at = next.toJSDate().getTime();
            if (at >= to) break;
            if (at < from) continue;
            const own = byInstant.get(at);
            if (own) {
                matched.add(own);
                emit(own.component, own.startDate, own.endDate, own.recurrenceId);
                continue;
            }
            const d = ev.getOccurrenceDetails(next);
            // An override ical.js matched by clock time alone, for another instant, isn't this
            // occurrence's: the occurrence is the series' own
            if (d.item !== ev && !d.item.modifiesFuture() && d.item.recurrenceId.toJSDate().getTime() !== at) {
                const end = next.clone();
                end.addDuration(ev.duration);
                emit(master, next, end, next);
            } else {
                emit(d.item.component, d.startDate, d.endDate, d.recurrenceId);
            }
        }
        for (const e of byInstant.values()) {
            if (!matched.has(e)) emit(e.component, e.startDate, e.endDate, e.recurrenceId);
        }
        return true;
    }

    // A series' overrides by the instant of the occurrence each changes. Two for one occurrence
    // can't both be right, so the series can't be read.
    overrides(exceptions) {
        const byInstant = new Map();
        for (const ex of exceptions) {
            const e = new ICAL.Event(ex);
            const at = e.recurrenceId.toJSDate().getTime();
            if (byInstant.has(at)) throw new Error("two overrides of one occurrence");
            byInstant.set(at, e);
        }
        return byInstant;
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
        const behind = Math.floor((from - start.toJSDate().getTime()) / CalendarReader.DAY_MS) - period;
        const periods = Math.floor(behind / period);
        if (periods < 1) return start;
        const later = start.clone();
        later.adjust(periods * period, 0, 0, 0);
        return later;
    }

    // One occurrence as the events file holds it, or null when it doesn't start in the window or
    // the owner declined it. `recurrenceId` is its original start, for an occurrence of a series.
    event(item, startTime, endTime, recurrenceId, { calendar, range, owner, stats }) {
        const start = startTime.toJSDate();
        if (start < range.start || start >= range.end) return null;
        if (this.declined(item, owner)) { stats.declined++; return null; }
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
            status: CalendarReader.STATUS[String(item.getFirstPropertyValue("status") ?? "").toUpperCase()] ?? "none",
            availability: transp === "TRANSPARENT" ? "free" : "busy",
        };
    }

    // The attendee on the most events read, those that didn't parse included (`unread`, each a
    // list of addresses), lowercased. Null when there's none, or two are on as many.
    owner(vevents, unread = []) {
        const counts = new Map();
        const count = (addresses) => {
            for (const who of new Set(addresses)) if (who) counts.set(who, (counts.get(who) ?? 0) + 1);
        };
        for (const ve of vevents) count(ve.getAllProperties("attendee").map((a) => this.attendee(a)));
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
}
