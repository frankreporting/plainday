// Invented calendar feeds, for the calendar reader's tests (plugin/src/shared/calendarFeed.js) and
// for the calendar sync's test rounds (OBS-274, and OBS-80's, OBS-275's and OBS-276's test plans).
// Every name, address, link and event here is invented. Each feed is shaped like one provider's
// export: Studio like a Google calendar's secret address, Home like an iCloud public calendar,
// Library like an Outlook published calendar. Big has the size and shape of a large real Google
// feed (1.4 MB and 1,692 events, mostly old one-offs: a little over the largest real one), and
// Heavy holds what's slowest for ical.js, for the speed checks.
//
// Everything is dated from a test day: "day 1" is the day after it. The tests pin the day; a test
// round uses the real one.
//
//   import { feeds } from "./calendarFeeds.mjs";
//   const { studio, home, library, big, heavy } = feeds("2026-11-12");   // each { name, link, owner, text }
//
//   node plugin/test/calendarFeeds.mjs write <folder> [--day YYYY-MM-DD]
//       writes studio.ics, home.ics, library.ics, big.ics and heavy.ics into <folder>
//   node plugin/test/calendarFeeds.mjs serve [--port 8765] [--day YYYY-MM-DD]
//       serves them at http://127.0.0.1:<port>/<name>.ics until stopped; /gone.ics answers 404,
//       and /silent.ics never answers
//
// With no --day, the day is today on this machine.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CRLF = "\r\n";

// Lines as a feed writes them: CRLF after each, and folded at 75 characters, each continuation
// starting with a space
function fold(line) {
    if (line.length <= 75) return line;
    const parts = [line.slice(0, 75)];
    for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
    return parts.join(CRLF);
}
const ics = (lines) => lines.map(fold).join(CRLF) + CRLF;

// The test day plus n days, as YYYYMMDD
function dayOf(day, n) {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
}
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function weekday(day, n) {
    const s = dayOf(day, n);
    return WEEKDAYS[new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))).getUTCDay()];
}

// The time zones, as each provider writes them
const NEW_YORK = [
    "BEGIN:VTIMEZONE", "TZID:America/New_York", "X-LIC-LOCATION:America/New_York",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
    "END:VTIMEZONE",
];
const LONDON = [
    "BEGIN:VTIMEZONE", "TZID:Europe/London", "X-LIC-LOCATION:Europe/London",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
];
const NEW_YORK_APPLE = [
    "BEGIN:VTIMEZONE", "TZID:America/New_York", "X-LIC-LOCATION:America/New_York",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "DTSTART:20070311T020000", "TZNAME:EDT", "TZOFFSETTO:-0400", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "DTSTART:20071104T020000", "TZNAME:EST", "TZOFFSETTO:-0500", "END:STANDARD",
    "END:VTIMEZONE",
];
// Outlook names zones the Windows way, and defines them from 1601
const EASTERN_OUTLOOK = [
    "BEGIN:VTIMEZONE", "TZID:Eastern Standard Time",
    "BEGIN:STANDARD", "DTSTART:16010101T020000", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11", "END:STANDARD",
    "BEGIN:DAYLIGHT", "DTSTART:16010101T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3", "END:DAYLIGHT",
    "END:VTIMEZONE",
];

const STAMP = "20260101T120000Z";
const google = (who, partstat = "ACCEPTED") => `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat};CN=${who};X-NUM-GUESTS=0:mailto:${who}`;
const apple = (cn, email, partstat, value = `mailto:${email}`) => `ATTENDEE;CN="${cn}";CUTYPE=INDIVIDUAL;EMAIL="${email}";PARTSTAT=${partstat};ROLE=REQ-PARTICIPANT:${value}`;
const outlook = (cn, who, partstat) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat};RSVP=TRUE;CN=${cn}:mailto:${who}`;
const event = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];

// The addresses the feeds' owners answer invitations from, and their links
export const OWNERS = { studio: "studio-owner@example.com", home: "home@example.com", library: "desk@example.org" };
export const LINKS = {
    studio: "https://calendar.google.com/calendar/ical/studio-owner%40example.com/private-0000invented0000invented0000abcd/basic.ics",
    home: "webcal://p00-caldav.icloud.com/published/2/INVENTEDinventedINVENTEDinventedINVENTEDinventedINVENTEDinventedINVENTEDinventedINVENTEDinventedINVENTEDinvented00",
    library: "https://outlook.office365.com/owa/calendar/0000invented0000@example.org/0000invented00000000invented0000/calendar.ics",
    big: "https://calendar.google.com/calendar/ical/big-owner%40example.com/private-0000invented0000invented0000beef/basic.ics",
    heavy: "https://outlook.office365.com/owa/calendar/0000invented0001@example.org/0000invented00000000invented0001/calendar.ics",
};

// Studio, a Google calendar's secret address: a series with a skipped day and a moved one, an
// event in London's time, a declined invitation (found by the address in the link's path: a
// colleague is on more events than the owner), an event shown as free, a two-day all-day event,
// one past midnight, a canceled one, an invitation to one occurrence of someone else's series,
// and an old one-off
function studio(day) {
    const d = (n) => dayOf(day, n);
    const NY = "TZID=America/New_York";
    const lead = "lead@example.com", owner = OWNERS.studio;
    return ics([
        "BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Studio", "X-WR-TIMEZONE:America/New_York",
        ...NEW_YORK, ...LONDON,
        ...event([`DTSTART;${NY}:${d(1)}T093000`, `DTEND;${NY}:${d(1)}T094500`, "RRULE:FREQ=DAILY;COUNT=7", `EXDATE;${NY}:${d(3)}T093000`,
            `DTSTAMP:${STAMP}`, `ORGANIZER;CN=${lead}:mailto:${lead}`, "UID:kestrel-standup@example.com", google(lead),
            "CREATED:20250101T120000Z", "DESCRIPTION:Daily check-in for the Kestrel catalog.\\nBring blockers.", "LAST-MODIFIED:20260101T120000Z",
            "LOCATION:", "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Kestrel standup", "TRANSP:OPAQUE"]),
        ...event([`DTSTART;${NY}:${d(4)}T100000`, `DTEND;${NY}:${d(4)}T101500`, `DTSTAMP:${STAMP}`, `ORGANIZER;CN=${lead}:mailto:${lead}`,
            "UID:kestrel-standup@example.com", `RECURRENCE-ID;${NY}:${d(4)}T093000`, google(lead), "CREATED:20250101T120000Z",
            "LAST-MODIFIED:20260101T120000Z", "SEQUENCE:1", "STATUS:CONFIRMED", "SUMMARY:Kestrel standup", "TRANSP:OPAQUE"]),
        ...event([`DTSTART;TZID=Europe/London:${d(1)}T140000`, `DTEND;TZID=Europe/London:${d(1)}T150000`, `DTSTAMP:${STAMP}`,
            `ORGANIZER;CN=${lead}:mailto:${lead}`, "UID:design-review@example.com", google(lead), google(owner),
            "X-GOOGLE-CONFERENCE:https://meet.google.com/aaa-bbbb-ccc", "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Design review", "TRANSP:OPAQUE"]),
        ...event([`DTSTART;${NY}:${d(1)}T110000`, `DTEND;${NY}:${d(1)}T120000`, `DTSTAMP:${STAMP}`, "ORGANIZER;CN=vendor@example.org:mailto:vendor@example.org",
            "UID:vendor-demo@example.com", google("vendor@example.org"), google(owner, "DECLINED"), "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Vendor demo", "TRANSP:OPAQUE"]),
        ...event([`DTSTART;${NY}:${d(1)}T153000`, `DTEND;${NY}:${d(1)}T170000`, `DTSTAMP:${STAMP}`, "UID:focus-block@example.com",
            "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Focus block", "TRANSP:TRANSPARENT"]),
        ...event([`DTSTART;VALUE=DATE:${d(4)}`, `DTEND;VALUE=DATE:${d(6)}`, `DTSTAMP:${STAMP}`, "UID:catalog-shoot@example.com",
            "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Catalog shoot", "TRANSP:TRANSPARENT"]),
        ...event([`DTSTART;${NY}:${d(2)}T220000`, `DTEND;${NY}:${d(3)}T010000`, `DTSTAMP:${STAMP}`, `ORGANIZER;CN=${lead}:mailto:${lead}`,
            "UID:late-launch@example.com", google(lead), "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Late launch", "TRANSP:OPAQUE"]),
        ...event([`DTSTART;${NY}:${d(3)}T140000`, `DTEND;${NY}:${d(3)}T144500`, `DTSTAMP:${STAMP}`, "UID:haircut@example.com",
            "SEQUENCE:2", "STATUS:CANCELLED", "SUMMARY:Haircut", "TRANSP:OPAQUE"]),
        ...event([`DTSTART;${NY}:${d(5)}T130000`, `DTEND;${NY}:${d(5)}T133000`, `DTSTAMP:${STAMP}`, "ORGANIZER;CN=pinecrest@example.org:mailto:pinecrest@example.org",
            "UID:pinecrest-series@example.org", `RECURRENCE-ID;${NY}:${d(5)}T130000`, google("pinecrest@example.org"), google(lead),
            "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Pinecrest call", "TRANSP:OPAQUE"]),
        ...event([`DTSTART:${d(-30)}T150000Z`, `DTEND:${d(-30)}T160000Z`, `DTSTAMP:${STAMP}`, "UID:old-kickoff@example.com",
            "SEQUENCE:0", "STATUS:CONFIRMED", "SUMMARY:Old kickoff", "TRANSP:OPAQUE"]),
        "END:VCALENDAR",
    ]);
}

// Home, an iCloud public calendar: two events, and an invitation the owner declined, found as the
// attendee on the most events (by the EMAIL parameter iCloud writes, whatever the value says)
function home(day) {
    const d = (n) => dayOf(day, n);
    const NY = "TZID=America/New_York";
    const owner = OWNERS.home;
    return ics([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iCloud Web Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Home", "X-APPLE-CALENDAR-COLOR:#34AADC", "X-WR-TIMEZONE:America/New_York",
        ...NEW_YORK_APPLE,
        ...event(["CREATED:20260101T120000Z", `DTEND;${NY}:${d(1)}T090000`, `DTSTAMP:${STAMP}`, `DTSTART;${NY}:${d(1)}T080000`,
            "LAST-MODIFIED:20260101T120000Z", "SEQUENCE:0", "SUMMARY:Dentist", "UID:0A1B2C3D-0000-4000-8000-00000000D001", "TRANSP:OPAQUE"]),
        ...event(["CREATED:20260101T120000Z", `DTEND;${NY}:${d(6)}T203000`, `DTSTAMP:${STAMP}`, `DTSTART;${NY}:${d(6)}T190000`,
            "ORGANIZER;CN=\"Garden Club\";EMAIL=\"club@example.org\":mailto:club@example.org",
            apple("Garden Club", "club@example.org", "ACCEPTED"), apple("Home", owner, "ACCEPTED"),
            "SEQUENCE:0", "SUMMARY:Garden club", "UID:0A1B2C3D-0000-4000-8000-00000000D002", "TRANSP:OPAQUE"]),
        ...event(["CREATED:20260101T120000Z", `DTEND;${NY}:${d(2)}T190000`, `DTSTAMP:${STAMP}`, `DTSTART;${NY}:${d(2)}T180000`,
            "ORGANIZER;CN=\"Swap Host\";EMAIL=\"swap@example.org\":mailto:swap@example.org",
            apple("Swap Host", "swap@example.org", "ACCEPTED"), apple("Home", owner, "DECLINED", "urn:uuid:00000000-0000-4000-8000-0000000000aa"),
            "SEQUENCE:1", "SUMMARY:Book swap", "UID:0A1B2C3D-0000-4000-8000-00000000D003", "TRANSP:OPAQUE"]),
        "END:VCALENDAR",
    ]);
}

// Library, an Outlook published calendar: a weekly series in Outlook's "Eastern Standard Time",
// and an invitation the owner declined, found as the attendee on the most events
function library(day) {
    const d = (n) => dayOf(day, n);
    const ET = "TZID=Eastern Standard Time";
    const owner = OWNERS.library;
    return ics([
        "BEGIN:VCALENDAR", "METHOD:PUBLISH", "PRODID:Microsoft Exchange Server 2010", "VERSION:2.0", "X-WR-CALNAME:Library",
        ...EASTERN_OUTLOOK,
        ...event(["ORGANIZER;CN=Coordinator:mailto:coord@example.org", outlook("Coordinator", "coord@example.org", "ACCEPTED"),
            outlook("Library Desk", owner, "ACCEPTED"), "DESCRIPTION;LANGUAGE=en-US:Weekly look at the brochure drafts.\\n",
            `RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${weekday(day, 7)};WKST=SU`, "UID:040000008200E00074C5B7101A82E0080000000000000000000000000000000000000001",
            "SUMMARY;LANGUAGE=en-US:Brochure check-in", `DTSTART;${ET}:${d(7)}T110000`, `DTEND;${ET}:${d(7)}T113000`,
            "CLASS:PUBLIC", "PRIORITY:5", `DTSTAMP:${STAMP}`, "TRANSP:OPAQUE", "STATUS:CONFIRMED", "SEQUENCE:0",
            "X-MICROSOFT-CDO-BUSYSTATUS:BUSY"]),
        ...event(["ORGANIZER;CN=Audit Lead:mailto:audit@example.org", outlook("Audit Lead", "audit@example.org", "ACCEPTED"),
            outlook("Library Desk", owner, "DECLINED"), "UID:040000008200E00074C5B7101A82E0080000000000000000000000000000000000000002",
            "SUMMARY;LANGUAGE=en-US:Shelf audit", `DTSTART;${ET}:${d(3)}T090000`, `DTEND;${ET}:${d(3)}T100000`,
            "CLASS:PUBLIC", "PRIORITY:5", `DTSTAMP:${STAMP}`, "TRANSP:OPAQUE", "STATUS:CONFIRMED", "SEQUENCE:0",
            "X-MICROSOFT-CDO-BUSYSTATUS:BUSY"]),
        "END:VCALENDAR",
    ]);
}

// The same numbers on every run, for a feed that's the same for a given day
function random(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const WORDS = "brief plan review draft catalog launch budget vendor shelf studio print layout photo copy proof call sync check notes agenda follow up ideas team quarter client press site page cover spread".split(" ");

// Big: the size and shape of a large real Google feed. Every event since the calendar began:
// 1,545 old one-offs over eight years, with notes and guests; 100 series, 60 of them long over,
// 30 weekly and 10 daily ones still running from years back; 40 moved or renamed occurrences;
// and 7 upcoming one-offs. About 1.4 MB.
export const BIG = { oldOneOffs: 1545, endedSeries: 60, weeklySeries: 30, dailySeries: 10, overrides: 40, upcoming: 7 };
function big(day) {
    const rnd = random(227);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
    const title = () => { const t = words(2 + Math.floor(rnd() * 3)); return t[0].toUpperCase() + t.slice(1); };
    const d = (n) => dayOf(day, n);
    const hhmm = () => `${String(8 + Math.floor(rnd() * 10)).padStart(2, "0")}${pick(["00", "15", "30", "45"])}00`;
    const NY = "TZID=America/New_York";
    const owner = "big-owner@example.com";
    const guests = () => Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => google(i === 0 ? owner : `guest${Math.floor(rnd() * 40)}@example.com`));
    const notes = () => `DESCRIPTION:${Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => words(8)).join("\\n")}`;
    const lines = ["BEGIN:VCALENDAR", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Big", "X-WR-TIMEZONE:America/New_York", ...NEW_YORK];
    const one = (uid, n, extra = []) => {
        const at = hhmm();
        const endHour = String(Math.min(23, Number(at.slice(0, 2)) + 1)).padStart(2, "0");
        lines.push(...event([`DTSTART;${NY}:${d(n)}T${at}`, `DTEND;${NY}:${d(n)}T${endHour}${at.slice(2)}`, `DTSTAMP:${STAMP}`,
            `ORGANIZER;CN=${owner}:mailto:${owner}`, `UID:${uid}@example.com`, ...guests(), "CREATED:20180101T120000Z", notes(),
            "LAST-MODIFIED:20260101T120000Z", `LOCATION:${words(3)}`, "SEQUENCE:0", "STATUS:CONFIRMED", `SUMMARY:${title()}`,
            "X-GOOGLE-CONFERENCE:https://meet.google.com/aaa-bbbb-ccc", "TRANSP:OPAQUE", ...extra]));
    };
    for (let i = 0; i < BIG.oldOneOffs; i++) one(`big-old-${i}`, -2 - Math.floor(rnd() * 2900));
    const series = [];
    const repeat = (i, startN, rule) => {
        const at = hhmm();
        series.push({ uid: `big-series-${i}@example.com`, startN, at });
        lines.push(...event([`DTSTART;${NY}:${d(startN)}T${at}`, `DTEND;${NY}:${d(startN)}T${at.slice(0, 2)}${String(Number(at.slice(2, 4)) + 14).padStart(2, "0")}00`,
            rule, `DTSTAMP:${STAMP}`, `ORGANIZER;CN=${owner}:mailto:${owner}`, `UID:big-series-${i}@example.com`, ...guests(),
            "CREATED:20180101T120000Z", notes(), "LAST-MODIFIED:20260101T120000Z", "SEQUENCE:0", "STATUS:CONFIRMED", `SUMMARY:${title()}`, "TRANSP:OPAQUE"]));
    };
    let i = 0;
    for (let k = 0; k < BIG.endedSeries; k++, i++) { const s = -2900 + Math.floor(rnd() * 2400); repeat(i, s, `RRULE:FREQ=WEEKLY;UNTIL=${d(s + 60 + Math.floor(rnd() * 300))}T235959Z`); }
    for (let k = 0; k < BIG.weeklySeries; k++, i++) repeat(i, -2900 + Math.floor(rnd() * 2800), "RRULE:FREQ=WEEKLY");
    for (let k = 0; k < BIG.dailySeries; k++, i++) repeat(i, -2200 + Math.floor(rnd() * 1800), "RRULE:FREQ=DAILY");
    // Moved occurrences of the running series, in the window and before it
    const running = series.slice(BIG.endedSeries);
    for (let k = 0; k < BIG.overrides; k++) {
        const s = running[k % running.length];
        const daily = series.indexOf(s) >= BIG.endedSeries + BIG.weeklySeries;
        // An occurrence on the rule: a whole number of steps from the series' start
        const step = daily ? 1 : 7;
        const n = s.startN + step * Math.ceil((-200 + Math.floor(rnd() * 260) - s.startN) / step);
        lines.push(...event([`DTSTART;${NY}:${d(n)}T${String(Math.min(22, Number(s.at.slice(0, 2)) + 1)).padStart(2, "0")}${s.at.slice(2)}`,
            `DTEND;${NY}:${d(n)}T${String(Math.min(23, Number(s.at.slice(0, 2)) + 2)).padStart(2, "0")}${s.at.slice(2)}`, `DTSTAMP:${STAMP}`,
            `UID:${s.uid}`, `RECURRENCE-ID;${NY}:${d(n)}T${s.at}`, ...guests(), "SEQUENCE:1", "STATUS:CONFIRMED", `SUMMARY:${title()}`, "TRANSP:OPAQUE"]));
    }
    for (let k = 0; k < BIG.upcoming; k++) one(`big-new-${k}`, 1 + Math.floor(rnd() * 50));
    lines.push("END:VCALENDAR");
    return ics(lines);
}

// Heavy: what's slowest for ical.js, shaped like an Outlook export. Two zones defined from 1601;
// series since 2015 on the last weekday and the last Friday of each month (BYSETPOS, as Outlook
// writes them); a weekly series since 2016; and a daily series since 2020 with 1,500 moved
// occurrences before the window. For the speed checks: each of these once made one step too long.
export const HEAVY = { overrides: 1500 };
function heavy(day) {
    const d = (n) => dayOf(day, n);
    const ET = "TZID=Eastern Standard Time", PT = "TZID=Pacific Standard Time";
    const PACIFIC = EASTERN_OUTLOOK.map((l) => l.replace("Eastern Standard Time", "Pacific Standard Time")
        .replace("TZOFFSETFROM:-0400", "TZOFFSETFROM:-0700").replace("TZOFFSETTO:-0500", "TZOFFSETTO:-0800")
        .replace("TZOFFSETFROM:-0500", "TZOFFSETFROM:-0800").replace("TZOFFSETTO:-0400", "TZOFFSETTO:-0700"));
    const series = (uid, start, rule, summary, zone = ET) => event([`UID:${uid}`, `SUMMARY:${summary}`, `DTSTART;${zone}:${start}T100000`,
        `DTEND;${zone}:${start}T103000`, `RRULE:${rule}`, `DTSTAMP:${STAMP}`, "TRANSP:OPAQUE", "STATUS:CONFIRMED", "X-MICROSOFT-CDO-BUSYSTATUS:BUSY"]);
    const lines = ["BEGIN:VCALENDAR", "METHOD:PUBLISH", "PRODID:Microsoft Exchange Server 2010", "VERSION:2.0", "X-WR-CALNAME:Heavy",
        ...EASTERN_OUTLOOK, ...PACIFIC,
        ...series("heavy-last-weekday@example.org", "20150130", "FREQ=MONTHLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", "Month-end close"),
        ...series("heavy-last-friday@example.org", "20150130", "FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=-1", "Last-Friday review", PT),
        ...series("heavy-weekly@example.org", "20160104", "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;WKST=SU", "Desk hours"),
        ...series("heavy-daily@example.org", "20200106", "FREQ=DAILY;INTERVAL=1", "Morning check")];
    // Moved occurrences of the daily series, each an hour later, on the days before the window
    for (let k = 0; k < HEAVY.overrides; k++) {
        const n = -2 - k;
        lines.push(...event(["UID:heavy-daily@example.org", "SUMMARY:Morning check", `RECURRENCE-ID;${ET}:${d(n)}T100000`,
            `DTSTART;${ET}:${d(n)}T110000`, `DTEND;${ET}:${d(n)}T113000`, `DTSTAMP:${STAMP}`, "TRANSP:OPAQUE", "STATUS:CONFIRMED"]));
    }
    lines.push("END:VCALENDAR");
    return ics(lines);
}

export function feeds(day) {
    return {
        studio: { name: "Studio", link: LINKS.studio, owner: OWNERS.studio, text: studio(day) },
        home: { name: "Home", link: LINKS.home, owner: OWNERS.home, text: home(day) },
        library: { name: "Library", link: LINKS.library, owner: OWNERS.library, text: library(day) },
        big: { name: "Big", link: LINKS.big, owner: "big-owner@example.com", text: big(day) },
        heavy: { name: "Heavy", link: LINKS.heavy, owner: null, text: heavy(day) },
    };
}

function today() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function option(args, name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, ...args] = process.argv.slice(2);
    const day = option(args, "--day", today());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`--day wants YYYY-MM-DD, not ${day}`);
    const all = feeds(day);
    if (command === "write" && args[0] && !args[0].startsWith("--")) {
        fs.mkdirSync(args[0], { recursive: true });
        for (const [name, f] of Object.entries(all)) fs.writeFileSync(path.join(args[0], `${name}.ics`), f.text);
        console.log(`Wrote ${Object.keys(all).map((n) => `${n}.ics`).join(", ")} into ${args[0]}, dated from ${day}`);
    } else if (command === "serve") {
        const port = Number(option(args, "--port", "8765"));
        http.createServer((req, res) => {
            const name = (req.url ?? "").replace(/^\/|\.ics(?:\?.*)?$/g, "");
            if (name === "silent") return;
            if (!all[name]) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8" });
            res.end(all[name].text);
        }).listen(port, "127.0.0.1", () => console.log(`Serving ${Object.keys(all).join(", ")} at http://127.0.0.1:${port}/<name>.ics, dated from ${day}`));
    } else {
        console.error("Usage: node plugin/test/calendarFeeds.mjs write <folder> [--day YYYY-MM-DD] | serve [--port 8765] [--day YYYY-MM-DD]");
        process.exit(2);
    }
}
