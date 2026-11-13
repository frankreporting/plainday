// Tests for the calendar reader (OBS-274): plugin/src/shared/calendarFeed.js, which downloads a feed
// and hands it to a background worker, and plugin/src/worker/, which reads it. Invented feeds
// shaped like Google's, iCloud's and Outlook's exports (calendarFeeds.mjs) are read into the
// events the calendar sync writes, each checked through the sync's own lines(); the download's
// answers hold no link; and the worker as the build makes it runs on a thread of its own, where
// a feed it can't finish is stopped. ical.js is the real one, from node_modules, and so is
// moment, which lines() formats times with.
//
// Run from the repository root, after `npm ci`: npm test
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { Worker as Thread } from "node:worker_threads";
import ICAL from "ical.js";
import { loadClass } from "../classShape.mjs";
import { workerSource } from "../esbuild.config.mjs";
import { CalendarReader } from "../src/worker/calendarRead.js";
import { BIG, feeds, HEAVY, LINKS } from "./calendarFeeds.mjs";

const moment = createRequire(import.meta.url)("moment");
// What the reader gives back was made in its own context, whose objects compare as different
// kinds to strict equality: compared as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

// CalendarFeed, in a context of its own, with stand-ins for Obsidian's requestUrl and the browser's
// Worker, Blob and URL. `Worker` defaults to one that runs the reader in this process, a turn
// later, with copies of what goes in and out, as a worker's messages are; its reader is
// `feed.reader`, whose methods a test can swap.
function inProcess(reader) {
    return class {
        constructor() { this.stopped = false; }
        postMessage(data) {
            const sent = structuredClone(data);
            setTimeout(() => {
                if (this.stopped) return;
                let result;
                try { result = reader.read(sent.text, sent.options); } catch { result = { problem: "unreadable" }; }
                this.onmessage?.({ data: structuredClone(result) });
            }, 0);
        }
        terminate() { this.stopped = true; }
    };
}
function reader(requestUrl = () => { throw new Error("no download in this test"); }, Worker = null) {
    const inner = new CalendarReader();
    const context = vm.createContext({
        requestUrl, performance, window: { setTimeout, clearTimeout }, calendarWorkerSource: "",
        Worker: Worker ?? inProcess(inner), Blob: class { constructor(parts) { this.parts = parts; } },
        URL: { createObjectURL: () => "blob:calendar-worker", revokeObjectURL: () => {} },
    });
    const CalendarFeed = loadClass("calendarFeed.js", context);
    const feed = new CalendarFeed();
    feed.reader = inner;
    return { CalendarFeed, feed };
}
// The UIDs of a read's failed events, sorted
const uids = (failed) => failed.map((f) => f.uid).sort();
const CalendarSync = loadClass("calendarSync.js", vm.createContext({ moment, Notice: class {}, app: {}, plainday: {} }));
const sync = new CalendarSync();

// The test day at 9am, local, and the YYYY-MM-DD of the day n days after it
const at = (day, hour = 9) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, hour); };
const dayAfter = (day, n) => { const t = at(day); t.setDate(t.getDate() + n); return moment(t).format("YYYY-MM-DD"); };

const CALENDARS = {
    studio: { id: "cal-studio", name: "Studio", account: "Google" },
    home: { id: "cal-home", name: "Home", account: "iCloud" },
    library: { id: "cal-library", name: "Library", account: "Outlook" },
    big: { id: "cal-big", name: "Big", account: "Google" },
};

async function readAll(day, feed = reader().feed) {
    const window = feed.window(14, at(day));
    const all = feeds(day);
    const reads = {};
    for (const name of ["studio", "home", "library"]) {
        reads[name] = await feed.read(all[name].text, { calendar: CALENDARS[name], window, link: all[name].link });
        assert.ok(!reads[name].problem, `${name} reads`);
    }
    return { window, reads, feed };
}

// The lines the sync would write on each day, as apply() takes events: canceled ones aren't written
function daily(events) {
    const days = {};
    for (const e of events) {
        if (e.status === "canceled") continue;
        (days[e.date] ??= []).push(...sync.lines(e));
    }
    return days;
}

const INFO = "ℹ" + String.fromCharCode(0xfe0f);

// Two test days: one before a change to daylight saving time (day 3 is the Sunday it starts, in
// the US), and one in November, after it ends
for (const day of ["2026-03-05", "2026-11-12"]) {
    const d = (n) => dayAfter(day, n);
    // The local offset at that hour of day n
    const offset = (n, hour = 9) => moment(at(d(n), hour)).format("Z");

    test(`${day}: the three feeds give the daily-note lines their events should (1.1, 1.2)`, async () => {
        const { reads, feed } = await readAll(day);
        const events = feed.reader.sorted([...reads.studio.events, ...reads.home.events, ...reads.library.events]);
        const got = daily(events);
        const standup = ["- [<] 9:30am\tKestrel standup", "\t- 9:45am"];
        assert.deepEqual(got[d(1)], [
            "- [<] 8:00am\tDentist", "\t- 9:00am",
            "- [<] 9:00am\tDesign review", "\t- 10:00am",
            ...standup,
            `- [<] 3:30pm\tFocus block ${INFO}`, "\t- 5:00pm",
        ]);
        assert.deepEqual(got[d(2)], [...standup, "- [<] 10:00pm\tLate launch", "\t- 1:00am"]);
        assert.equal(got[d(3)], undefined, "day 3: the standup's skipped, the haircut canceled, the shelf audit declined");
        assert.deepEqual(got[d(4)], ["- [<] All day\tCatalog shoot", "- [<] 10:00am\tKestrel standup", "\t- 10:15am"]);
        assert.deepEqual(got[d(5)], [...standup, "- [<] 1:00pm\tPinecrest call", "\t- 1:30pm"]);
        assert.deepEqual(got[d(6)], [...standup, "- [<] 7:00pm\tGarden club", "\t- 8:30pm"]);
        assert.deepEqual(got[d(7)], [...standup, "- [<] 11:00am\tBrochure check-in", "\t- 11:30am"]);
        assert.deepEqual(got[d(14)], ["- [<] 11:00am\tBrochure check-in", "\t- 11:30am"]);
        assert.deepEqual(Object.keys(got).sort(), [1, 2, 4, 5, 6, 7, 14].map(d));
    });

    test(`${day}: a moved occurrence stays in its series, and an invitation to one occurrence counts as one (1.2, 1.3)`, async () => {
        const { reads } = await readAll(day);
        const standups = reads.studio.events.filter((e) => e.title === "Kestrel standup");
        assert.deepEqual(plain(standups.map((e) => e.key)), [1, 2, 4, 5, 6, 7].map((n) => `kestrel-standup@example.com@${d(n)}`));
        assert.ok(standups.every((e) => e.recurring && e.id === "kestrel-standup@example.com"));
        const moved = standups.find((e) => e.date === d(4));
        assert.equal(moved.start, `${d(4)}T10:00:00${offset(4)}`);
        const pinecrest = reads.studio.events.find((e) => e.title === "Pinecrest call");
        assert.equal(pinecrest.key, `pinecrest-series@example.org@${d(5)}`);
        assert.equal(pinecrest.recurring, true);
        const brochure = reads.library.events.filter((e) => e.title === "Brochure check-in");
        assert.deepEqual(plain(brochure.map((e) => e.key)), [7, 14].map((n) => `${brochure[0].id}@${d(n)}`));
    });

    test(`${day}: all-day, overnight, canceled, free and another time zone, field by field (1.4)`, async () => {
        const { reads } = await readAll(day);
        const by = (title) => reads.studio.events.find((e) => e.title === title);
        assert.deepEqual(plain(by("Catalog shoot")), {
            key: "catalog-shoot@example.com", id: "catalog-shoot@example.com", calendarId: "cal-studio", calendar: "Studio", account: "Google",
            title: "Catalog shoot", date: d(4), start: `${d(4)}T00:00:00${offset(4, 0)}`, end: `${d(5)}T23:59:59${offset(5, 23)}`,
            endsSameDay: false, allDay: true, recurring: false, status: "confirmed", availability: "free",
        });
        // In March, 1am on day 3 is the hour before the clocks change
        assert.equal(by("Late launch").end, `${d(3)}T01:00:00${offset(3, 1)}`);
        assert.equal(by("Late launch").endsSameDay, false);
        assert.equal(by("Haircut").status, "canceled");
        assert.equal(by("Focus block").availability, "free");
        assert.equal(by("Design review").start, `${d(1)}T09:00:00${offset(1)}`);
        assert.equal(reads.home.events.find((e) => e.title === "Dentist").status, "none");
    });

    test(`${day}: declined invitations are left out, by the Google link's path or the most frequent attendee (1.5)`, async () => {
        const { reads, window, feed } = await readAll(day);
        assert.equal(reads.studio.events.some((e) => e.title === "Vendor demo"), false);
        assert.equal(reads.home.events.some((e) => e.title === "Book swap"), false);
        assert.equal(reads.library.events.some((e) => e.title === "Shelf audit"), false);
        assert.deepEqual([reads.studio.stats.declined, reads.home.stats.declined, reads.library.stats.declined], [1, 1, 1]);
        // Without the link, Studio's most frequent attendee is a colleague, who declined nothing:
        // so it's the path that leaves the vendor demo out
        const guessed = await feed.read(feeds(day).studio.text, { calendar: CALENDARS.studio, window });
        assert.equal(guessed.events.some((e) => e.title === "Vendor demo"), true);
    });

    // Google-shaped feeds, whose owner comes from the link: for any other, the attendee counted as
    // the owner is the one on the most events read, so dropping old events can change who that is
    test(`${day}: old one-offs are dropped before reading, and the same events come out either way (1.6)`, async () => {
        const { reads, window } = await readAll(day);
        assert.equal(reads.studio.stats.skipped, 1);
        assert.equal(reads.studio.events.some((e) => e.title === "Old kickoff"), false);
        for (const name of ["studio", "big", "heavy"]) {
            const text = feeds(day)[name].text;
            const skipping = await reader().feed.read(text, { calendar: CALENDARS[name], window, link: LINKS[name] });
            const all = reader().feed;
            all.reader.old = () => false;
            const whole = await all.read(text, { calendar: CALENDARS[name], window, link: LINKS[name] });
            assert.equal(whole.stats.skipped, 0);
            assert.deepEqual(plain(skipping.events), plain(whole.events), name);
        }
    });

    test(`${day}: Big, the size of a large real feed, reads its upcoming events and skips its old one-offs`, async () => {
        const { feed } = reader();
        const window = feed.window(62, at(day));
        const got = await feed.read(feeds(day).big.text, { calendar: CALENDARS.big, window, link: LINKS.big });
        assert.equal(got.name, "Big");
        // Every old one-off; moved occurrences of series are read, whenever they were
        assert.equal(got.stats.skipped, BIG.oldOneOffs);
        assert.deepEqual(uids(got.failed), []);
        assert.equal(got.events.filter((e) => e.key.startsWith("big-new-")).length, BIG.upcoming);
        assert.ok(got.events.length > 300, `${got.events.length} events`);
        assert.ok(got.events.every((e) => e.date >= window.windowStart && e.date <= window.windowEnd));
        assert.equal(new Set(got.events.map((e) => e.key)).size, got.events.length, "every key once");
        assert.equal(got.stats.unknownZones, 0);
    });
}

test("a long-running series started near the window gives the occurrences it gives stepped from its start", async () => {
    const day = "2026-11-12";
    const rules = [
        "FREQ=DAILY", "FREQ=DAILY;INTERVAL=3", "FREQ=DAILY;INTERVAL=7", "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
        "FREQ=WEEKLY", "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;WKST=SU", "FREQ=WEEKLY;INTERVAL=3;BYDAY=SA,SU;WKST=MO",
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;WKST=MO", "FREQ=WEEKLY;BYDAY=WE;UNTIL=20261120T235959Z",
        "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261101T000000Z", "FREQ=WEEKLY;UNTIL=20261201",
        "FREQ=DAILY;COUNT=4000", "FREQ=MONTHLY;BYDAY=2TU", "FREQ=YEARLY",
    ];
    const ymd = (n) => dayAfter(day, n).replaceAll("-", "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Rules", ...feeds(day).studio.text.split("\r\n").filter((l, i, all) => {
        const first = all.indexOf("BEGIN:VTIMEZONE"), last = all.lastIndexOf("END:VTIMEZONE");
        return i >= first && i <= last;
    })];
    let n = 0;
    for (const rule of rules) {
        for (const start of [-3001, -1000, -400, -31, -8, -1, 0, 3]) {
            // New York's time, all-day, UTC and floating (no zone: the device's)
            for (const kind of ["zoned", "allDay", "utc", "floating"]) {
                const uid = `rule-${n++}@example.com`;
                const at = (k, time) => kind === "allDay" ? `;VALUE=DATE:${ymd(k)}` : kind === "zoned" ? `;TZID=America/New_York:${ymd(k)}T${time}`
                    : kind === "utc" ? `:${ymd(k)}T${time}Z` : `:${ymd(k)}T${time}`;
                const value = (prop, k, time) => { const v = at(k, time); return v.startsWith(";") ? `${prop}${v}` : `${prop}${v}`; };
                // An RDATE turns starting near the window off, so only the UTC series have one, past
                // the window's end: on a day a daily rule also lands on, the series would repeat
                // twice that day, and be left out
                lines.push("BEGIN:VEVENT", value("DTSTART", start, "083000"), kind === "allDay" ? value("DTEND", start + 1, "") : value("DTEND", start, "090000"),
                    `RRULE:${rule}`, `UID:${uid}`, `SUMMARY:${rule}`, value("EXDATE", 5, "083000"), ...(kind === "utc" ? [value("RDATE", 70, "070000")] : []), "END:VEVENT");
                if (kind !== "allDay") lines.push("BEGIN:VEVENT", value("RECURRENCE-ID", 9, "083000"),
                    value("DTSTART", 10, "120000"), value("DTEND", 10, "130000"), `UID:${uid}`, "SUMMARY:moved", "END:VEVENT");
            }
        }
    }
    lines.push("END:VCALENDAR");
    const text = lines.join("\r\n") + "\r\n";
    for (const [name, feedText, days] of [["rules", text, 62], ["big", feeds(day).big.text, 62], ["heavy", feeds(day).heavy.text, 62]]) {
        const near = reader().feed;
        const window = near.window(days, at(day));
        const fromStart = reader().feed;
        fromStart.reader.startFor = (ev) => ev.startDate;
        const a = await near.read(feedText, { calendar: CALENDARS.studio, window });
        const b = await fromStart.read(feedText, { calendar: CALENDARS.studio, window });
        assert.ok(a.events.length > 50, `${name}: ${a.events.length} events`);
        assert.deepEqual(uids(a.failed), [], name);
        assert.deepEqual(plain(a.events), plain(b.events), name);
    }
});

test("an event early on the window's first day, written in UTC from a zone east of it, is kept: the day of margin (1.6)", async () => {
    const before = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
        const { feed } = reader();
        const window = feed.window(7, at("2026-11-12", 6));
        // 7 to 8am in Tokyo on the 12th is 10 to 11pm on the 11th in UTC
        const block = "BEGIN:VEVENT\r\nDTSTART:20261111T220000Z\r\nDTEND:20261111T230000Z\r\nUID:early@example.com\r\nSUMMARY:Early call\r\nEND:VEVENT\r\n";
        const text = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${block}END:VCALENDAR\r\n`;
        const got = await feed.read(text, { calendar: CALENDARS.studio, window });
        assert.deepEqual(plain(got.events.map((e) => [e.date, e.start])), [["2026-11-12", "2026-11-12T07:00:00+09:00"]]);
        assert.equal(got.stats.skipped, 0);
        // Compared with the window's first day itself, with no margin, it would have been dropped
        assert.equal(feed.reader.old(`\n${block}`, 20261112), true);
        assert.equal(feed.reader.old(`\n${block}`, 20261111), false);
    } finally {
        process.env.TZ = before;
    }
});

test("a webcal:// link is fetched as https://, and a feed with no name comes back with none (1.7)", async () => {
    const asked = [];
    const text = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
    const { feed } = reader(async (req) => { asked.push(req); return { status: 200, text }; });
    const got = await feed.load(LINKS.home, { calendar: CALENDARS.home, window: feed.window(7, at("2026-11-12")) });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url, LINKS.home.replace(/^webcal:/, "https:"));
    assert.equal(asked[0].throw, false);
    assert.equal(got.name, null);
    assert.deepEqual(plain(got.events), []);
    assert.equal(typeof got.stats.downloadMs, "number");
    assert.equal(feed.url("WEBCALS://example.com/x.ics"), "https://example.com/x.ics");
    assert.equal(feed.url(" https://example.com/x.ics "), "https://example.com/x.ics");
});

test("a link that stopped working, a server that fails or doesn't answer, and an answer that isn't a calendar: none holds the link (1.8)", async () => {
    const link = LINKS.studio;
    const window = { start: new Date(), end: new Date() };
    const cases = [
        [async () => ({ status: 404, text: "Not Found" }), { problem: "dead", status: 404 }],
        [async () => ({ status: 401, text: "" }), { problem: "dead", status: 401 }],
        [async () => ({ status: 403, text: "" }), { problem: "dead", status: 403 }],
        [async () => ({ status: 410, text: "" }), { problem: "dead", status: 410 }],
        [async () => ({ status: 500, text: "" }), { problem: "unreachable", status: 500 }],
        [async () => ({ status: 302, text: "" }), { problem: "unreachable", status: 302 }],
        [async () => { throw new Error(`net::ERR_NAME_NOT_RESOLVED ${link}`); }, { problem: "unreachable", status: null }],
        [() => { throw new Error(`thrown at once ${link}`); }, { problem: "unreachable", status: null }],
        [async () => ({ status: 200, text: "<html>Sign in</html>" }), { problem: "unreadable", status: 200 }],
        [async () => ({ status: 200, get text() { throw new Error(link); } }), { problem: "unreadable", status: 200 }],
    ];
    for (const [requestUrl, expected] of cases) {
        const { feed } = reader(requestUrl);
        const got = await feed.load(link, { calendar: CALENDARS.studio, window });
        assert.deepEqual(plain(got), expected);
        assert.ok(!JSON.stringify(got).includes("private-"), "no link in the result");
    }
    // A feed cut off in the middle of an event can't be read: reading what came before would make
    // its other events look canceled
    const cut = feeds("2026-11-12").studio.text.split("END:VEVENT")[0];
    const { feed } = reader(async () => ({ status: 200, text: cut }));
    assert.deepEqual(plain(await feed.load(link, { calendar: CALENDARS.studio, window: feed.window(7, at("2026-11-12")) })), { problem: "unreadable", status: 200 });
});

test("a download that takes longer than the timeout is given up, and its later failure goes nowhere (1.8)", async () => {
    const { CalendarFeed, feed } = reader(() => new Promise((_, reject) => setTimeout(() => reject(new Error(`late ${LINKS.studio}`)), 60)));
    CalendarFeed.TIMEOUT_MS = 20;
    const started = Date.now();
    assert.deepEqual(plain(await feed.download(LINKS.studio)), { problem: "unreachable", status: null });
    assert.ok(Date.now() - started < 55, "gave up at the timeout, not at the failure");
    // An unhandled rejection would fail this test file; wait past the late failure
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(CalendarFeed.TIMEOUT_MS, 20);
    assert.equal(reader().CalendarFeed.TIMEOUT_MS, 30000, "30 seconds, as the plan says");
});

test("line endings and time zones after the events don't change what's read", async () => {
    const day = "2026-11-12";
    const { reads, window } = await readAll(day);
    const all = feeds(day);
    // LF only
    const lf = await reader().feed.read(all.studio.text.replaceAll("\r\n", "\n"), { calendar: CALENDARS.studio, window, link: LINKS.studio });
    assert.deepEqual(plain(lf.events), plain(reads.studio.events));
    // Outlook's time zone moved after its events
    const text = all.library.text;
    const zone = text.slice(text.indexOf("BEGIN:VTIMEZONE"), text.indexOf("END:VTIMEZONE") + "END:VTIMEZONE\r\n".length);
    const moved = text.replace(zone, "").replace("END:VCALENDAR", `${zone}END:VCALENDAR`);
    const later = await reader().feed.read(moved, { calendar: CALENDARS.library, window, link: LINKS.library });
    assert.deepEqual(plain(later.events), plain(reads.library.events));
    assert.ok(reads.studio.stats.readMs >= 0 && reads.studio.stats.wallMs >= 0);
});

test("the events file: every calendar's events, sorted, in the shape the Mac's fetcher wrote", async () => {
    const day = "2026-11-12";
    const { reads, window, feed } = await readAll(day);
    const file = feed.feed(["studio", "home", "library"].map((n) => ({ calendar: CALENDARS[n], events: reads[n].events })), window, at(day));
    assert.equal(file.source, "ical");
    assert.equal(file.generatedAt, `${day}T09:00:00-05:00`);
    assert.deepEqual(plain([file.windowStart, file.windowEnd]), [day, dayAfter(day, 14)]);
    assert.deepEqual(plain(file.calendars), [
        { id: "cal-studio", title: "Studio", account: "Google" },
        { id: "cal-home", title: "Home", account: "iCloud" },
        { id: "cal-library", title: "Library", account: "Outlook" },
    ]);
    const starts = file.events.map((e) => Date.parse(e.start));
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
    assert.equal(file.events.length, reads.studio.events.length + reads.home.events.length + reads.library.events.length);
    assert.deepEqual(plain(Object.keys(file.events[0]).sort()), ["account", "allDay", "calendar", "calendarId", "date", "end", "endsSameDay", "id", "key", "recurring", "start", "status", "title", "availability"].sort());
});

// A calendar whose events are given as lines, with New York's zone and any other zone lines
const NY_ZONE = feeds("2026-11-12").studio.text.split("\r\n").filter((l, i, all) => i >= all.indexOf("BEGIN:VTIMEZONE") && i <= all.indexOf("END:VTIMEZONE"));
const calendar = (lines, zones = NY_ZONE) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...zones, ...lines, "END:VCALENDAR"].join("\r\n") + "\r\n";
const vevent = (...lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];

test("two reads at once keep their own zones, even with the same name", async () => {
    const zone = (offset) => ["BEGIN:VTIMEZONE", "TZID:Customized Time Zone", "BEGIN:STANDARD", "DTSTART:16010101T000000",
        `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, "END:STANDARD", "END:VTIMEZONE"];
    const text = (offset) => calendar(vevent("UID:noon@example.org", "SUMMARY:Noon", "DTSTART;TZID=Customized Time Zone:20261113T120000",
        "DTEND;TZID=Customized Time Zone:20261113T130000"), zone(offset));
    const one = reader(), other = reader();
    const window = one.feed.window(7, at("2026-11-12"));
    const [east, west] = await Promise.all([
        one.feed.read(text("-0500"), { calendar: CALENDARS.library, window }),
        other.feed.read(text("-0800"), { calendar: CALENDARS.library, window }),
    ]);
    assert.deepEqual(plain([east.events[0].start, west.events[0].start]), ["2026-11-13T12:00:00-05:00", "2026-11-13T15:00:00-05:00"]);
    assert.equal(ICAL.TimezoneService.has("Customized Time Zone"), false, "nothing registered for the whole app");
});

test("events in lowercase, with a trailing space or after a byte-order mark read as usual; one the split misses makes the feed unreadable", async () => {
    const day = "2026-11-12";
    const { reads, window } = await readAll(day);
    const text = feeds(day).studio.text;
    const variants = {
        lowercase: text.replaceAll("BEGIN:VEVENT", "begin:vevent").replaceAll("END:VEVENT", "end:vevent"),
        mixed: text.replaceAll("BEGIN:VEVENT", "Begin:VEvent"),
        trailing: text.replaceAll("BEGIN:VEVENT\r\n", "BEGIN:VEVENT \r\n").replaceAll("END:VEVENT\r\n", "END:VEVENT\t\r\n"),
        bom: String.fromCharCode(0xfeff) + text,
        lf: "\n\n" + text.replaceAll("\r\n", "\n"),
    };
    for (const [name, variant] of Object.entries(variants)) {
        const got = await reader().feed.read(variant, { calendar: CALENDARS.studio, window, link: LINKS.studio });
        assert.ok(!got.problem, `${name}: ${got.problem}`);
        assert.deepEqual(plain(got.events), plain(reads.studio.events), name);
    }
    const { feed } = reader();
    feed.reader.split = (t) => ({ head: t, blocks: [], skipped: 0 });
    assert.deepEqual(plain(await feed.read(text, { calendar: CALENDARS.studio, window, link: LINKS.studio })), { problem: "unreadable" });
});

// The worker's script as the build makes it, on a Node thread of its own: `self` is the thread's
// port, as in a browser's worker
const WORKER = (await workerSource()).code;
const posted = [];
class ThreadWorker {
    constructor() {
        this.thread = new Thread(`const { parentPort } = require("node:worker_threads"); globalThis.self = globalThis;
            self.postMessage = (m) => parentPort.postMessage(m); parentPort.on("message", (m) => self.onmessage({ data: m }));\n${WORKER}`, { eval: true });
        this.thread.on("message", (m) => this.onmessage?.({ data: m }));
        this.thread.on("error", (e) => this.onerror?.(e));
        this.exited = new Promise((resolve) => this.thread.on("exit", resolve));
        ThreadWorker.last = this;
    }
    postMessage(data) { posted.push(data); this.thread.postMessage(data); }
    terminate() { this.thread.terminate(); }
}

test("the worker as the build makes it reads a feed on a thread of its own, never sees the link, and is stopped when it can't finish", async () => {
    const day = "2026-11-12";
    const { reads, window } = await readAll(day);
    const { CalendarFeed, feed } = reader(undefined, ThreadWorker);
    const got = await feed.read(feeds(day).studio.text, { calendar: CALENDARS.studio, window, link: LINKS.studio });
    assert.deepEqual(plain(got.events), plain(reads.studio.events));
    assert.equal(await ThreadWorker.last.exited, 1, "stopped once it answered");
    assert.ok(!JSON.stringify(posted).includes("private-"), "the link stays on the main thread");
    assert.equal(posted.at(-1).options.owner, "studio-owner@example.com", "only the address its path holds");
    // A rule ical.js never finishes: every 2 years on the fifth Friday, from a February no leap year
    // comes round to
    const text = calendar(vevent("UID:stuck@example.org", "SUMMARY:Stuck", "DTSTART;TZID=America/New_York:20250228T100000",
        "DTEND;TZID=America/New_York:20250228T110000", "RRULE:FREQ=MONTHLY;INTERVAL=24;BYDAY=5FR"));
    CalendarFeed.READ_LIMIT_MS = 1500;
    const started = Date.now();
    assert.deepEqual(plain(await feed.read(text, { calendar: CALENDARS.studio, window })), { problem: "slow" });
    assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
    assert.equal(await ThreadWorker.last.exited, 1, "the stuck worker was stopped");
    assert.equal(reader().CalendarFeed.READ_LIMIT_MS, 20000, "20 seconds, as the plan says");
});

test("an event the reader can't read is named with its title, and the rest of the calendar reads", async () => {
    const lines = [
        ...vevent("UID:fortnightly@example.org", "SUMMARY:Every other week", "DTSTART;TZID=America/New_York:20261001T090000",
            "DTEND;TZID=America/New_York:20261001T100000", "RRULE:FREQ=FORTNIGHTLY"),
        ...vevent("UID:not-a-date@example.org", "SUMMARY:Bad date", "DTSTART;VALUE=DATE-TIME:20261114", "DTEND:20261114T100000Z"),
        ...vevent("UID:no-start@example.org", "SUMMARY:No start", "DTEND:20261114T100000Z"),
        ...vevent("UID:nowhere@example.org", "SUMMARY:Somewhere", "DTSTART;TZID=Nowhere Time:20261114T090000", "DTEND;TZID=Nowhere Time:20261114T100000"),
        ...vevent("UID:exrule@example.org", "SUMMARY:Weekdays but Fridays", "DTSTART;TZID=America/New_York:20261113T090000",
            "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "EXRULE:FREQ=WEEKLY;BYDAY=FR"),
        // An override that doesn't parse leaves its whole series out, not its other occurrences as if unmoved
        ...vevent("UID:daily-good@example.org", "SUMMARY:Good series", "DTSTART;TZID=America/New_York:20261113T090000",
            "DTEND;TZID=America/New_York:20261113T093000", "RRULE:FREQ=DAILY;COUNT=5"),
        ...vevent("UID:daily-good@example.org", "RECURRENCE-ID;TZID=America/New_York:20261115T090000", "DTSTART;TZID=America/New_York:20261115T110000",
            "DTEND;TZID=America/New_York:20261115T113000", "SUMMARY:Moved", "X-BROKEN;=:"),
        // Two overrides of one occurrence, the second written in UTC
        ...vevent("UID:twice@example.org", "SUMMARY:Twice moved", "DTSTART;TZID=America/New_York:20261113T093000", "RRULE:FREQ=DAILY;COUNT=4"),
        ...vevent("UID:twice@example.org", "SUMMARY:A", "RECURRENCE-ID;TZID=America/New_York:20261115T093000", "DTSTART;TZID=America/New_York:20261115T120000"),
        ...vevent("UID:twice@example.org", "SUMMARY:B", "RECURRENCE-ID:20261115T143000Z", "DTSTART;TZID=America/New_York:20261115T130000"),
        ...vevent("UID:fine@example.org", "SUMMARY:Fine", "DTSTART;TZID=America/New_York:20261113T140000", "DTEND;TZID=America/New_York:20261113T150000"),
    ];
    const { feed } = reader();
    const got = await feed.read(calendar(lines), { calendar: CALENDARS.studio, window: feed.window(14, at("2026-11-12")) });
    assert.ok(!got.problem, got.problem);
    assert.deepEqual(plain(got.failed).sort((x, y) => (x.uid < y.uid ? -1 : 1)), [
        { uid: "daily-good@example.org", title: "Good series" },
        { uid: "exrule@example.org", title: "Weekdays but Fridays" },
        { uid: "fortnightly@example.org", title: "Every other week" },
        { uid: "no-start@example.org", title: "No start" },
        { uid: "not-a-date@example.org", title: "Bad date" },
        { uid: "nowhere@example.org", title: "Somewhere" },
        { uid: "twice@example.org", title: "Twice moved" },
    ]);
    assert.deepEqual(plain(got.events.map((e) => [e.title, e.start])), [["Fine", "2026-11-13T14:00:00-05:00"]]);
    assert.equal(got.stats.unknownZones, 1);
});

test("an override whose original start is written in another zone replaces its occurrence, once", async () => {
    const { feed } = reader();
    const window = feed.window(7, at("2026-11-12"));
    const London = feeds("2026-11-12").studio.text.split("\r\n").filter((l, i, all) => i > all.indexOf("END:VTIMEZONE") && i <= all.lastIndexOf("END:VTIMEZONE"));
    const text = calendar([
        ...vevent("UID:ny@example.org", "SUMMARY:Standup", "DTSTART;TZID=America/New_York:20261113T093000", "DTEND;TZID=America/New_York:20261113T094500", "RRULE:FREQ=DAILY;COUNT=5"),
        // 2:30pm in London is 9:30am in New York in November
        ...vevent("UID:ny@example.org", "SUMMARY:Standup, moved", "RECURRENCE-ID;TZID=Europe/London:20261115T143000",
            "DTSTART;TZID=America/New_York:20261115T150000", "DTEND;TZID=America/New_York:20261115T151500"),
        ...vevent("UID:utc@example.org", "SUMMARY:Sync", "DTSTART:20261113T143000Z", "DTEND:20261113T150000Z", "RRULE:FREQ=DAILY;COUNT=5"),
        ...vevent("UID:utc@example.org", "SUMMARY:Sync, moved", "RECURRENCE-ID;TZID=America/New_York:20261114T093000",
            "DTSTART;TZID=America/New_York:20261114T160000", "DTEND;TZID=America/New_York:20261114T163000"),
    ], [...NY_ZONE, ...London]);
    const got = await feed.read(text, { calendar: CALENDARS.studio, window });
    const on = (title, date) => got.events.filter((e) => e.title.startsWith(title) && e.date === date).map((e) => [e.key, e.title, e.start.slice(11, 16)]);
    assert.deepEqual(plain(on("Standup", "2026-11-15")), [["ny@example.org@2026-11-15", "Standup, moved", "15:00"]]);
    assert.deepEqual(plain(on("Sync", "2026-11-14")), [["utc@example.org@2026-11-14", "Sync, moved", "16:00"]]);
    assert.equal(got.events.length, 10);
});

test("a this-and-following change that moves occurrences days later still fills the window's first days", async () => {
    const { feed } = reader();
    const window = feed.window(6, at("2026-11-12"));
    const text = calendar([
        ...vevent("UID:range@example.org", "SUMMARY:Daily", "DTSTART;TZID=America/New_York:20261101T090000", "DTEND;TZID=America/New_York:20261101T093000", "RRULE:FREQ=DAILY"),
        // From the 7th on, every occurrence three days later
        ...vevent("UID:range@example.org", "SUMMARY:Daily", "RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20261107T090000",
            "DTSTART;TZID=America/New_York:20261110T090000", "DTEND;TZID=America/New_York:20261110T093000"),
    ]);
    const got = await feed.read(text, { calendar: CALENDARS.studio, window });
    assert.deepEqual(plain(got.events.map((e) => [e.date, e.key])), [12, 13, 14, 15, 16, 17, 18].map((n) => [`2026-11-${n}`, `range@example.org@2026-11-${String(n - 3).padStart(2, "0")}`]));
});

test("Heavy, what's slowest for ical.js, reads its series and its moved occurrences", async () => {
    const { feed } = reader();
    const day = "2026-11-12";
    const window = feed.window(62, at(day));
    const got = await feed.read(feeds(day).heavy.text, { calendar: CALENDARS.library, window, link: LINKS.heavy });
    assert.deepEqual(uids(got.failed), []);
    // Moved occurrences aren't skipped, however old: another can move them into the window
    assert.equal(got.stats.skipped, 0);
    assert.equal(got.stats.blocks, 4 + HEAVY.overrides);
    const titles = new Set(got.events.map((e) => e.title));
    assert.deepEqual([...titles].sort(), ["Desk hours", "Last-Friday review", "Month-end close", "Morning check"]);
    // The last weekday of November 2026 is Monday the 30th, at 10am Eastern
    assert.ok(got.events.some((e) => e.title === "Month-end close" && e.start === "2026-11-30T10:00:00-05:00"));
    // The last Friday of November, at 10am Pacific: 1pm Eastern
    assert.ok(got.events.some((e) => e.title === "Last-Friday review" && e.start === "2026-11-27T13:00:00-05:00"));
});

test("the repeating rules Google, iCloud and Outlook write are all read", async () => {
    const written = [
        "FREQ=DAILY", "FREQ=DAILY;INTERVAL=3", "FREQ=DAILY;COUNT=10", "FREQ=DAILY;UNTIL=20270101T045959Z", "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
        "FREQ=WEEKLY;BYDAY=FR", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;WKST=SU",
        "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR;UNTIL=20270301T000000Z", "FREQ=WEEKLY;INTERVAL=3;BYDAY=MO;WKST=MO",
        "FREQ=MONTHLY", "FREQ=MONTHLY;BYMONTHDAY=13", "FREQ=MONTHLY;BYMONTHDAY=31", "FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=MONTHLY;BYMONTHDAY=1,15",
        "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31", "FREQ=MONTHLY;BYDAY=2TU", "FREQ=MONTHLY;BYDAY=-1FR", "FREQ=MONTHLY;BYDAY=5MO",
        "FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR", "FREQ=MONTHLY;INTERVAL=1;BYDAY=MO;BYSETPOS=2",
        "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", "FREQ=MONTHLY;BYDAY=SU,MO,TU,WE,TH,FR,SA;BYSETPOS=-1",
        "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1", "FREQ=YEARLY", "FREQ=YEARLY;INTERVAL=2", "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=13",
        "FREQ=YEARLY;BYMONTH=5;BYDAY=-1MO", "FREQ=YEARLY;INTERVAL=1;BYDAY=TH;BYSETPOS=4;BYMONTH=11", "FREQ=YEARLY;BYMONTH=1,3",
        "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
    ];
    const lines = written.flatMap((rule, i) => vevent(`UID:written-${i}@example.org`, `SUMMARY:${rule}`,
        "DTSTART;TZID=America/New_York:20240213T090000", "DTEND;TZID=America/New_York:20240213T100000", `RRULE:${rule}`));
    const { feed } = reader();
    const got = await feed.read(calendar(lines), { calendar: CALENDARS.studio, window: feed.window(500, at("2026-11-12")) });
    assert.deepEqual(uids(got.failed), []);
    const read = new Set(got.events.map((e) => e.title));
    assert.deepEqual(written.filter((r) => !read.has(r) && !/COUNT=10|UNTIL=2027|UNTIL=20270301/.test(r)), [], "every running rule has an occurrence in the window");
});

// Zones whose changes stop, as definitions with their history write them: one that dropped
// daylight time (its last change is a rule's last), and one whose rules end in 2024
test("a zone the device doesn't know is read from the feed's definition, ended rules and all", async () => {
    const zones = [
        // Daylight time until 2018, then standard time for good, at -03
        ["BEGIN:VTIMEZONE", "TZID:Ended", "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0300", "TZOFFSETTO:-0200", "DTSTART:20081019T000000",
            "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=3SU;UNTIL=20181104T030000Z", "END:DAYLIGHT",
            "BEGIN:STANDARD", "TZOFFSETFROM:-0200", "TZOFFSETTO:-0300", "DTSTART:20090215T000000",
            "RRULE:FREQ=YEARLY;BYMONTH=2;BYDAY=3SU;UNTIL=20190217T020000Z", "END:STANDARD", "END:VTIMEZONE"],
        // Rules that end in 2024 at -05 standard, started on the 31st of October
        ["BEGIN:VTIMEZONE", "TZID:Ends2024", "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "DTSTART:19701031T020000",
            "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;UNTIL=20241027T060000Z", "END:STANDARD",
            "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "DTSTART:19700405T020000",
            "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU;UNTIL=20240407T070000Z", "END:DAYLIGHT", "END:VTIMEZONE"],
    ];
    const lines = ["Ended", "Ends2024"].flatMap((tz) => [3, 120, 200].flatMap((n) => vevent(`UID:${tz}-${n}@example.org`, `SUMMARY:${tz}`,
        `DTSTART;TZID=${tz}:${dayAfter("2026-11-12", n).replaceAll("-", "")}T100000`, `DTEND;TZID=${tz}:${dayAfter("2026-11-12", n).replaceAll("-", "")}T110000`)));
    const { feed } = reader();
    const window = feed.window(300, at("2026-11-12"));
    const got = await feed.read(calendar(lines, zones.flat()), { calendar: CALENDARS.studio, window });
    assert.equal(got.events.length, 6);
    const utcHour = (e) => new Date(e.start).getUTCHours();
    // 10am at -03 is 1pm UTC; at -05 (the last change of the rules that ended in 2024) 3pm UTC
    assert.deepEqual(plain(got.events.map((e) => [e.title, utcHour(e)])).sort(), [["Ended", 13], ["Ended", 13], ["Ended", 13], ["Ends2024", 15], ["Ends2024", 15], ["Ends2024", 15]]);
});

test("a zone named the IANA or the Windows way is read from the device, even with no definition, or a wrong one", async () => {
    const event = (uid, tzid) => vevent(`UID:${uid}@example.org`, `SUMMARY:${uid}`, `DTSTART;TZID=${tzid}:20261116T090000`, `DTEND;TZID=${tzid}:20261116T100000`);
    // A definition of New York that's wrong: it says -0700 all year
    const wrong = ["BEGIN:VTIMEZONE", "TZID:America/New_York", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0700", "END:STANDARD", "END:VTIMEZONE"];
    const text = calendar([...event("berlin", "Europe/Berlin"), ...event("tokyo", "Tokyo Standard Time"), ...event("eastern", "Eastern Standard Time"),
        ...event("ny", "America/New_York"), ...event("nowhere", "Nowhere Standard Time")], wrong);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.library, window: feed.window(7, at("2026-11-12")) });
    const by = Object.fromEntries(got.events.map((e) => [e.title, e.start]));
    // 9am in Berlin is 3am in New York in November; in Tokyo, 7pm the day before
    assert.deepEqual(plain(by), {
        berlin: "2026-11-16T03:00:00-05:00", tokyo: "2026-11-15T19:00:00-05:00",
        eastern: "2026-11-16T09:00:00-05:00", ny: "2026-11-16T09:00:00-05:00",
    });
    // A zone no one knows: its event is left out, not read in the device's zone
    assert.deepEqual(uids(got.failed), ["nowhere@example.org"]);
    assert.equal(got.stats.unknownZones, 1);
});

test("the device's zones read the invented feeds as their own definitions do, around the changes to and from daylight time", async () => {
    for (const day of ["2026-03-05", "2026-10-29", "2026-11-12"]) {
        for (const name of ["studio", "home", "library", "heavy"]) {
            const device = reader().feed, defined = reader().feed;
            defined.reader.deviceZone = () => null;
            const window = device.window(20, at(day));
            const a = await device.read(feeds(day)[name].text, { calendar: CALENDARS.studio, window, link: LINKS[name] });
            const b = await defined.read(feeds(day)[name].text, { calendar: CALENDARS.studio, window, link: LINKS[name] });
            assert.ok(a.events.length > 0, `${day} ${name}`);
            // Late launch ends at 1am on the night the clocks go back, an hour that happens twice:
            // RFC 5545 says it's the first, as the device reads it; ical.js's own reading of the
            // definition takes the second. Every other time is the same.
            const twice = (e) => e.id === "late-launch@example.com" && e.end.startsWith("2026-11-01T01:00:00");
            const first = plain(a.events).map((e) => (twice(e) ? (assert.equal(e.end.slice(-6), "-04:00"), { ...e, end: "first 1am" }) : e));
            const second = plain(b.events).map((e) => (twice(e) ? (assert.equal(e.end.slice(-6), "-05:00"), { ...e, end: "first 1am" }) : e));
            assert.deepEqual(first, second, `${day} ${name}`);
        }
    }
});

test("a time the clocks skip lands after the gap, and one they repeat is the first", async () => {
    const text = calendar([
        // The clocks go from 2am to 3am on March 8th 2026 in New York, and from 2am back to 1am on November 1st
        ...vevent("UID:gap@example.org", "SUMMARY:Gap", "DTSTART;TZID=America/New_York:20260308T023000", "DTEND;TZID=America/New_York:20260308T033000"),
        ...vevent("UID:twice@example.org", "SUMMARY:Twice", "DTSTART;TZID=America/New_York:20261101T013000", "DTEND;TZID=America/New_York:20261101T023000"),
    ]);
    const { feed } = reader();
    for (const [day, title, utc] of [["2026-03-08", "Gap", "2026-03-08T07:30:00.000Z"], ["2026-11-01", "Twice", "2026-11-01T05:30:00.000Z"]]) {
        const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(1, at(day, 0)) });
        const e = got.events.find((x) => x.title === title);
        assert.equal(new Date(e.start).toISOString(), utc, title);
    }
});

test("a date years past the window isn't worked out, even in a zone defined from 1601", async () => {
    const zone = feeds("2026-11-12").heavy.text.split("\r\n").filter((l, i, all) => i >= all.indexOf("BEGIN:VTIMEZONE") && i <= all.indexOf("END:VTIMEZONE"))
        .map((l) => l.replace("Eastern Standard Time", "Customized Time Zone"));
    const text = calendar([
        ...vevent("UID:far@example.org", "SUMMARY:Far", "DTSTART;TZID=Customized Time Zone:99991113T090000", "DTEND;TZID=Customized Time Zone:99991113T100000"),
        ...vevent("UID:rare@example.org", "SUMMARY:Rare", "DTSTART;TZID=Customized Time Zone:20261113T090000", "DTEND;TZID=Customized Time Zone:20261113T100000", "RRULE:FREQ=YEARLY;INTERVAL=999"),
        ...vevent("UID:ends-far@example.org", "SUMMARY:Ends far", "DTSTART;TZID=Customized Time Zone:20261114T090000", "DTEND;TZID=Customized Time Zone:30261114T100000"),
    ], zone);
    const { feed } = reader();
    const started = performance.now();
    const got = await feed.read(text, { calendar: CALENDARS.library, window: feed.window(7, at("2026-11-12")) });
    assert.ok(performance.now() - started < 1000, `${Math.round(performance.now() - started)} ms`);
    assert.deepEqual(plain(got.events.map((e) => [e.title, e.endsSameDay])), [["Rare", true], ["Ends far", false]]);
    assert.deepEqual(uids(got.failed), []);
});

test("an old occurrence moved back by itself isn't skipped: another's this-and-following change would move it into the window", async () => {
    const text = calendar([
        ...vevent("UID:standup@example.org", "SUMMARY:Standup", "DTSTART;TZID=America/New_York:20261006T093000", "DTEND;TZID=America/New_York:20261006T094500", "RRULE:FREQ=WEEKLY"),
        // From October 20th on, two days later: Thursdays
        ...vevent("UID:standup@example.org", "SUMMARY:Standup", "RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20261020T093000",
            "DTSTART;TZID=America/New_York:20261022T093000", "DTEND;TZID=America/New_York:20261022T094500"),
        // The 10th kept on its Tuesday
        ...vevent("UID:standup@example.org", "SUMMARY:Standup", "RECURRENCE-ID;TZID=America/New_York:20261110T093000",
            "DTSTART;TZID=America/New_York:20261110T093000", "DTEND;TZID=America/New_York:20261110T094500"),
    ]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(10, at("2026-11-12")) });
    assert.deepEqual(plain(got.events.map((e) => [e.date, e.key])), [["2026-11-19", "standup@example.org@2026-11-17"]]);
});

test("a rule every few months on a fifth weekday is read, and so is February 29th from a leap year", async () => {
    const text = calendar([
        ...vevent("UID:fifth@example.org", "SUMMARY:Fifth Friday", "DTSTART;TZID=America/New_York:20260130T100000", "DTEND;TZID=America/New_York:20260130T110000",
            "RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=5FR"),
        ...vevent("UID:leap4@example.org", "SUMMARY:Leap 4", "DTSTART;VALUE=DATE:20240229", "DTEND;VALUE=DATE:20240301", "RRULE:FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29"),
        ...vevent("UID:leap2@example.org", "SUMMARY:Leap 2", "DTSTART;VALUE=DATE:20240229", "DTEND;VALUE=DATE:20240301", "RRULE:FREQ=YEARLY;INTERVAL=2"),
    ]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(500, at("2026-11-12")) });
    assert.deepEqual(uids(got.failed), []);
    assert.deepEqual(plain(got.events.map((e) => [e.title, e.date])), [["Fifth Friday", "2027-01-29"], ["Fifth Friday", "2027-07-30"], ["Leap 2", "2028-02-29"], ["Leap 4", "2028-02-29"]]);
});

test("two events with one UID, and an event that doesn't parse whose alarm comes first, are named by the right UID", async () => {
    const text = calendar([
        ...vevent("UID:twin@example.org", "SUMMARY:First", "DTSTART:20261113T140000Z"),
        ...vevent("UID:twin@example.org", "SUMMARY:Second", "DTSTART:20261114T140000Z"),
        ...vevent("UID:series@example.org", "SUMMARY:Series", "DTSTART;TZID=America/New_York:20261113T093000", "DTEND;TZID=America/New_York:20261113T100000", "RRULE:FREQ=DAILY;COUNT=4"),
        ...vevent("BEGIN:VALARM", "UID:alarm-1@example.org", "ACTION:DISPLAY", "TRIGGER:-PT10M", "END:VALARM", "UID:series@example.org",
            "RECURRENCE-ID;TZID=America/New_York:20261115T093000", "DTSTART;TZID=America/New_York:20261115T150000", "X-BROKEN;=:"),
        ...vevent("UID:fine@example.org", "SUMMARY:Fine", "DTSTART:20261113T160000Z"),
    ]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(7, at("2026-11-12")) });
    assert.deepEqual(uids(got.failed), ["series@example.org", "twin@example.org"]);
    assert.deepEqual(plain(got.events.map((e) => e.title)), ["Fine"]);
});

test("the owner is counted on events that didn't parse too", async () => {
    const att = (who, partstat) => `ATTENDEE;PARTSTAT=${partstat}:mailto:${who}`;
    const text = calendar([
        ...vevent("UID:a@example.org", "SUMMARY:Declined", "DTSTART:20261113T140000Z", att("desk@example.org", "DECLINED"), att("x@example.org", "ACCEPTED")),
        ...vevent("UID:b@example.org", "SUMMARY:Broken", "DTSTART:20261114T140000Z", att("desk@example.org", "ACCEPTED"), "X-BROKEN;=:"),
        ...vevent("UID:c@example.org", "SUMMARY:Other", "DTSTART:20261115T140000Z", att("y@example.org", "ACCEPTED")),
    ]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.library, window: feed.window(7, at("2026-11-12")) });
    assert.deepEqual(uids(got.failed), ["b@example.org"]);
    assert.deepEqual(plain(got.events.map((e) => e.title)), ["Other"]);
});

test("a series with an RDATE before the window keeps the occurrences its EXDATEs remove", async () => {
    const exdates = Array.from({ length: 40 }, (_, i) => `EXDATE;TZID=America/New_York:${dayAfter("2026-11-12", -7 * (i + 3)).replaceAll("-", "")}T090000`);
    const text = calendar(vevent("UID:rdate@example.org", "SUMMARY:Weekly", "DTSTART;TZID=America/New_York:20200102T090000",
        "DTEND;TZID=America/New_York:20200102T093000", "RRULE:FREQ=WEEKLY", "RDATE;TZID=America/New_York:20210303T090000", ...exdates,
        "EXDATE;TZID=America/New_York:20261119T090000"));
    const near = reader().feed, fromStart = reader().feed;
    fromStart.reader.startFor = (ev) => ev.startDate;
    const window = near.window(20, at("2026-11-12"));
    const a = await near.read(text, { calendar: CALENDARS.studio, window });
    const b = await fromStart.read(text, { calendar: CALENDARS.studio, window });
    assert.deepEqual(plain(a.events.map((e) => e.date)), ["2026-11-12", "2026-11-26"]);
    assert.deepEqual(plain(a.events), plain(b.events));
});

test("an event that runs into the next one without closing makes the feed unreadable", async () => {
    const text = calendar([
        "BEGIN:VEVENT", "UID:a@example.org", "SUMMARY:A", "DTSTART:20261113T140000Z",
        ...vevent("UID:b@example.org", "SUMMARY:B", "DTSTART:20261113T150000Z"),
        ...vevent("UID:c@example.org", "SUMMARY:C", "DTSTART:20261113T160000Z"),
    ]);
    const { feed } = reader();
    assert.deepEqual(plain(await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(7, at("2026-11-12")) })), { problem: "unreadable" });
});

test("an event that doesn't parse is named by its UID as ical.js reads UIDs, so its series' events are all left out", async () => {
    for (const [line, uid] of [["UID:s\\,1@example.org", "s,1@example.org"], ["UID;X-A=1:s2@example.org", "s2@example.org"]]) {
        const text = calendar([
            ...vevent(line, "SUMMARY:Series", "DTSTART;TZID=America/New_York:20261113T090000", "DTEND;TZID=America/New_York:20261113T093000", "RRULE:FREQ=DAILY;COUNT=3"),
            ...vevent(line, "RECURRENCE-ID;TZID=America/New_York:20261114T090000", "DTSTART;TZID=America/New_York:20261114T110000", "X-BROKEN;=:"),
        ]);
        const { feed } = reader();
        const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(7, at("2026-11-12")) });
        assert.deepEqual(uids(got.failed), [uid]);
        assert.deepEqual(plain(got.events), []);
    }
});

test("when two attendees are on as many events, no one is taken for the owner, and nothing is left out", async () => {
    const att = (who, partstat) => `ATTENDEE;PARTSTAT=${partstat}:mailto:${who}`;
    const text = calendar([
        ...vevent("UID:t1@example.org", "SUMMARY:One", "DTSTART:20261113T140000Z", att("guest@example.org", "DECLINED"), att("me@example.org", "ACCEPTED")),
        ...vevent("UID:t2@example.org", "SUMMARY:Two", "DTSTART:20261114T140000Z", att("guest@example.org", "ACCEPTED"), att("me@example.org", "ACCEPTED")),
    ]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.home, window: feed.window(7, at("2026-11-12")) });
    assert.deepEqual(plain(got.events.map((e) => e.title)), ["One", "Two"]);
});

test("a this-and-following change written in UTC or in London's time moves later meetings by its clock time", async () => {
    const london = feeds("2026-11-12").studio.text.split("\r\n").filter((l, i, all) => i > all.indexOf("END:VTIMEZONE") && i <= all.lastIndexOf("END:VTIMEZONE"));
    // 2:30pm in UTC, and in London in November, is 9:30am in New York
    for (const rid of ["RECURRENCE-ID;RANGE=THISANDFUTURE:20261113T143000Z", "RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Europe/London:20261113T143000"]) {
        const text = calendar([
            ...vevent("UID:later@example.org", "SUMMARY:Standup", "DTSTART;TZID=America/New_York:20261110T093000", "DTEND;TZID=America/New_York:20261110T094500", "RRULE:FREQ=DAILY"),
            ...vevent("UID:later@example.org", "SUMMARY:Standup, later", rid, "DTSTART;TZID=America/New_York:20261113T113000", "DTEND;TZID=America/New_York:20261113T114500"),
        ], [...NY_ZONE, ...london]);
        const { feed } = reader();
        const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(5, at("2026-11-12")) });
        assert.deepEqual(plain(got.events.map((e) => [e.date, e.start.slice(11, 16), e.end.slice(11, 16), e.title])), [
            ["2026-11-12", "09:30", "09:45", "Standup"],
            ...[13, 14, 15, 16, 17].map((d) => [`2026-11-${d}`, "11:30", "11:45", "Standup, later"]),
        ], rid);
    }
});

test("an override that changes no occurrence of its series, and a one-off with an override, are left out by name", async () => {
    const london = feeds("2026-11-12").studio.text.split("\r\n").filter((l, i, all) => i > all.indexOf("END:VTIMEZONE") && i <= all.lastIndexOf("END:VTIMEZONE"));
    const text = calendar([
        // 9:30 in London is 4:30 in New York: no occurrence of the series starts then
        ...vevent("UID:stray@example.org", "SUMMARY:Daily", "DTSTART;TZID=America/New_York:20261110T093000", "RRULE:FREQ=DAILY;COUNT=10"),
        ...vevent("UID:stray@example.org", "SUMMARY:Stray", "RECURRENCE-ID;TZID=Europe/London:20261115T093000", "DTSTART;TZID=America/New_York:20261115T120000"),
        ...vevent("UID:one-off@example.org", "SUMMARY:Lunch", "DTSTART;TZID=America/New_York:20261114T093000"),
        ...vevent("UID:one-off@example.org", "SUMMARY:Lunch, moved", "RECURRENCE-ID;TZID=America/New_York:20261114T093000", "DTSTART;TZID=America/New_York:20261114T150000"),
        ...vevent("UID:fine@example.org", "SUMMARY:Fine", "DTSTART;TZID=America/New_York:20261113T140000"),
    ], [...NY_ZONE, ...london]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(7, at("2026-11-12")) });
    assert.deepEqual(plain(got.failed).sort((x, y) => (x.uid < y.uid ? -1 : 1)), [{ uid: "one-off@example.org", title: "Lunch" }, { uid: "stray@example.org", title: "Daily" }]);
    assert.deepEqual(plain(got.events.map((e) => e.title)), ["Fine"]);
});

test("a meeting at the hour the clocks go back, in a zone only the feed defines, moved by an override written in UTC: left out, not doubled", async () => {
    const custom = NY_ZONE.map((l) => l.replace("America/New_York", "Customized Time Zone"));
    const text = calendar([
        ...vevent("UID:night@example.org", "SUMMARY:Night", "DTSTART;TZID=Customized Time Zone:20261028T013000", "DTEND;TZID=Customized Time Zone:20261028T020000", "RRULE:FREQ=DAILY"),
        // The first 1:30am on November 1st, in UTC
        ...vevent("UID:night@example.org", "SUMMARY:Night, moved", "RECURRENCE-ID:20261101T053000Z", "DTSTART;TZID=Customized Time Zone:20261101T030000"),
    ], custom);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(7, at("2026-10-29")) });
    // ical.js reads 1:30am that night as the second one in a zone it defines, so the override,
    // which changes the first, matches no occurrence, and the series would have Nov 1 twice
    assert.deepEqual(plain(got.failed), [{ uid: "night@example.org", title: "Night" }]);
    assert.deepEqual(plain(got.events), []);
});

test("a series with more occurrences in the window than can be handed back is left out by name, and the rest reads", async () => {
    const text = calendar([
        ...vevent("UID:minutely@example.org", "SUMMARY:Every minute", "DTSTART;TZID=America/New_York:20261112T000000", "RRULE:FREQ=MINUTELY"),
        ...vevent("UID:fine@example.org", "SUMMARY:Fine", "DTSTART;TZID=America/New_York:20261113T140000"),
    ]);
    const { feed } = reader();
    const started = performance.now();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(62, at("2026-11-12")) });
    assert.ok(performance.now() - started < 2000, `${Math.round(performance.now() - started)} ms`);
    assert.deepEqual(plain(got.failed), [{ uid: "minutely@example.org", title: "Every minute" }]);
    assert.deepEqual(plain(got.events.map((e) => e.title)), ["Fine"]);
});

test("only the calendar's ID, name and account reach the worker, and a message that can't be sent or read is unreadable", async () => {
    const sent = [];
    const reading = new CalendarReader();
    const Recording = class extends inProcess(reading) { postMessage(data) { sent.push(data); super.postMessage(data); } };
    const { feed } = reader(undefined, Recording);
    const window = feed.window(7, at("2026-11-12"));
    // A calendar setting holding more than the reader needs: its link, and something that can't be copied
    const settings = { id: 7, name: "Studio", account: "Google", link: LINKS.studio, check: () => true };
    const got = await feed.read(feeds("2026-11-12").studio.text, { calendar: settings, window, link: LINKS.studio });
    assert.ok(!got.problem, got.problem);
    assert.deepEqual(plain(sent[0].options.calendar), { id: "7", name: "Studio", account: "Google" });
    assert.ok(!JSON.stringify(sent).includes("private-"), "no link");
    assert.equal(got.events[0].calendarId, "7");
    for (const Broken of [
        class { postMessage() { throw new Error("DataCloneError"); } terminate() {} },
        class { postMessage() { setTimeout(() => this.onmessageerror?.({}), 0); } terminate() {} },
    ]) {
        const { feed: broken } = reader(undefined, Broken);
        const started = Date.now();
        assert.deepEqual(plain(await broken.read(feeds("2026-11-12").studio.text, { calendar: settings, window })), { problem: "unreadable" });
        assert.ok(Date.now() - started < 1000, "at once, not at the time limit");
    }
});

test("an RDATE that repeats an occurrence the rule makes counts once", async () => {
    for (const rdate of ["RDATE;TZID=America/New_York:20261116T100000", "RDATE;TZID=America/New_York:20261109T100000", "RDATE:20261116T150000Z"]) {
        const text = calendar(vevent("UID:weekly@example.org", "SUMMARY:Weekly", "DTSTART;TZID=America/New_York:20261109T100000",
            "DTEND;TZID=America/New_York:20261109T110000", "RRULE:FREQ=WEEKLY;COUNT=3", rdate));
        const { feed } = reader();
        const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(20, at("2026-11-08")) });
        assert.deepEqual(uids(got.failed), [], rdate);
        assert.deepEqual(plain(got.events.map((e) => e.key)), [9, 16, 23].map((d) => `weekly@example.org@2026-11-${d < 10 ? `0${d}` : d}`), rdate);
    }
});

test("a daily meeting in a far-off zone keeps one key a day through the device's change of clocks", async () => {
    const india = ["BEGIN:VTIMEZONE", "TZID:Asia/Kolkata", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0530", "TZOFFSETTO:+0530", "TZNAME:IST", "END:STANDARD", "END:VTIMEZONE"];
    const text = calendar(vevent("UID:india@example.org", "SUMMARY:Morning sync", "DTSTART;TZID=Asia/Kolkata:20261001T100000",
        "DTEND;TZID=Asia/Kolkata:20261001T103000", "RRULE:FREQ=DAILY"), [...NY_ZONE, ...india]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(62, at("2026-10-13")) });
    assert.deepEqual(uids(got.failed), []);
    const keys = got.events.map((e) => e.key);
    assert.equal(new Set(keys).size, keys.length, "one key a day");
    // 10am in India is 12:30am in New York until the clocks go back early on November 1st, and
    // 11:30pm the day before after it: November 1st in New York has two, each keyed by its own day
    const start = (day) => got.events.find((e) => e.key === `india@example.org@2026-11-0${day}`).start;
    assert.equal(start(1), "2026-11-01T00:30:00-04:00");
    assert.equal(start(2), "2026-11-01T23:30:00-05:00");
    assert.equal(got.events.filter((e) => e.date === "2026-11-01").length, 2);
});

test("a this-and-following change that makes an all-day series timed, or a timed one all-day, leaves it out by name", async () => {
    const text = calendar([
        ...vevent("UID:allday@example.org", "SUMMARY:All-day weekly", "DTSTART;VALUE=DATE:20261005", "DTEND;VALUE=DATE:20261006", "RRULE:FREQ=WEEKLY"),
        ...vevent("UID:allday@example.org", "SUMMARY:Now timed", "RECURRENCE-ID;RANGE=THISANDFUTURE;VALUE=DATE:20261019", "DTSTART;TZID=America/New_York:20261019T090000"),
        ...vevent("UID:timed@example.org", "SUMMARY:Timed weekly", "DTSTART;TZID=America/New_York:20261006T090000", "RRULE:FREQ=WEEKLY"),
        ...vevent("UID:timed@example.org", "SUMMARY:Now all day", "RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20261020T090000", "DTSTART;VALUE=DATE:20261020"),
    ]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(20, at("2026-10-22")) });
    assert.deepEqual(plain(got.failed).sort((x, y) => (x.uid < y.uid ? -1 : 1)), [{ uid: "allday@example.org", title: "All-day weekly" }, { uid: "timed@example.org", title: "Timed weekly" }]);
});

test("a this-and-following change that keeps the time keeps each meeting's instant, the second 1am of the night the clocks go back included", async () => {
    const text = calendar([
        ...vevent("UID:utc@example.org", "SUMMARY:Early call", "DTSTART:20261025T063000Z", "DTEND:20261025T070000Z", "RRULE:FREQ=DAILY"),
        // Renamed from October 28th on, written in New York's time: 2:30am there is 6:30 UTC
        ...vevent("UID:utc@example.org", "SUMMARY:Early call, renamed", "RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20261028T023000",
            "DTSTART;TZID=America/New_York:20261028T023000", "DTEND;TZID=America/New_York:20261028T030000"),
    ]);
    const { feed } = reader();
    const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(5, at("2026-10-29")) });
    for (const e of got.events) {
        assert.equal(new Date(e.start).getUTCHours() * 60 + new Date(e.start).getUTCMinutes(), 6 * 60 + 30, `${e.key} starts at 6:30 UTC`);
        assert.equal(Date.parse(e.end) - Date.parse(e.start), 30 * 60000, `${e.key} lasts half an hour`);
    }
    // November 1st, 6:30 UTC, is the second 1:30am in New York
    assert.equal(got.events.find((e) => e.key === "utc@example.org@2026-11-01").start, "2026-11-01T01:30:00-05:00");
});

test("the events file lists each calendar's ID as the events carry it", async () => {
    const { feed } = reader();
    const window = feed.window(7, at("2026-11-12"));
    const calendar = { id: 7, name: "Studio", account: "Google" };
    const got = await feed.read(feeds("2026-11-12").studio.text, { calendar, window, link: LINKS.studio });
    const file = feed.feed([{ calendar, events: got.events }], window, at("2026-11-12"));
    assert.deepEqual(plain(file.calendars), [{ id: "7", title: "Studio", account: "Google" }]);
    assert.ok(file.events.every((e) => e.calendarId === "7"));
});
