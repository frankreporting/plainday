// Tests for plugin/src/shared/calendarFeed.js, the calendar reader (OBS-274): invented feeds shaped
// like Google's, iCloud's and Outlook's exports (calendarFeeds.mjs) read into the events the
// calendar sync writes, each checked through the sync's own lines(); and the download's answers,
// none of which holds the link. ical.js is the real one, from node_modules, and so is moment, which
// lines() formats times with.
//
// Run from the repository root, after `npm ci`: npm test
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import ICAL from "ical.js";
import { loadClass, classSource, scriptOf } from "../classShape.mjs";
import { BIG, feeds, HEAVY, LINKS } from "./calendarFeeds.mjs";

const moment = createRequire(import.meta.url)("moment");
// What the reader gives back was made in its own context, whose objects compare as different
// kinds to strict equality: compared as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

// The reader, in a context of its own, with a stand-in for Obsidian's requestUrl that each test sets
function reader(requestUrl = () => { throw new Error("no download in this test"); }, extra = {}) {
    const context = vm.createContext({ ICAL, requestUrl, performance, window: { setTimeout, clearTimeout, ...extra } });
    const CalendarFeed = loadClass("calendarFeed.js", context);
    return { CalendarFeed, feed: new CalendarFeed(), context };
}
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
        const events = feed.sorted([...reads.studio.events, ...reads.home.events, ...reads.library.events]);
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
            all.old = () => false;
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
        // Every old one-off, and the overrides moved before the window
        assert.ok(got.stats.skipped > BIG.oldOneOffs && got.stats.skipped < BIG.oldOneOffs + BIG.overrides, `${got.stats.skipped} skipped`);
        assert.deepEqual(plain(got.failed), []);
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
        "FREQ=DAILY", "FREQ=DAILY;INTERVAL=3", "FREQ=DAILY;INTERVAL=2;BYDAY=MO,TH", "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
        "FREQ=WEEKLY", "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;WKST=SU", "FREQ=WEEKLY;INTERVAL=3;BYDAY=SA,SU;WKST=MO",
        "FREQ=WEEKLY;BYDAY=WE;UNTIL=20261120T235959Z", "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261101T000000Z",
        "FREQ=DAILY;COUNT=4000", "FREQ=MONTHLY;BYDAY=2TU", "FREQ=YEARLY",
        "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=2", "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;BYSETPOS=-1;WKST=MO",
        "FREQ=DAILY;BYMONTH=1,6,11", "FREQ=DAILY;BYMONTHDAY=1,15,28", "FREQ=WEEKLY;BYMONTH=11,12;BYDAY=TU",
        "FREQ=DAILY;BYHOUR=8,16", "FREQ=WEEKLY;UNTIL=20261201",
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
                lines.push("BEGIN:VEVENT", value("DTSTART", start, "083000"), kind === "allDay" ? value("DTEND", start + 1, "") : value("DTEND", start, "090000"),
                    `RRULE:${rule}`, `UID:${uid}`, `SUMMARY:${rule}`, value("EXDATE", 5, "083000"), value("RDATE", 12, "070000"), "END:VEVENT");
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
        fromStart.startFor = (ev) => ev.startDate;
        const a = await near.read(feedText, { calendar: CALENDARS.studio, window });
        const b = await fromStart.read(feedText, { calendar: CALENDARS.studio, window });
        assert.ok(a.events.length > 50, `${name}: ${a.events.length} events`);
        assert.deepEqual(plain(a.failed), [], name);
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
        assert.equal(feed.old(`\n${block}`, 20261112), true);
        assert.equal(feed.old(`\n${block}`, 20261111), false);
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

test("line endings, time zones after the events, and small steps don't change what's read", async () => {
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
    // A step after every event: the same events, in many steps
    const { CalendarFeed, feed } = reader();
    CalendarFeed.SLICE_MS = 0;
    const stepped = await feed.read(all.studio.text, { calendar: CALENDARS.studio, window, link: LINKS.studio });
    assert.deepEqual(plain(stepped.events), plain(reads.studio.events));
    assert.ok(stepped.stats.steps > 10, `${stepped.stats.steps} steps`);
    assert.ok(reads.studio.stats.longestMs >= 0 && reads.studio.stats.readMs >= reads.studio.stats.longestMs);
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

test("the class file imports ical.js by its default import, which the loader reads from the context", () => {
    const script = scriptOf(classSource("calendarFeed.js"), "calendarFeed.js");
    assert.match(script, /^var ICAL = globalThis\.ICAL;$/m);
    assert.match(script, /^var requestUrl = globalThis\.requestUrl;$/m);
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
    one.CalendarFeed.SLICE_MS = 0;
    other.CalendarFeed.SLICE_MS = 0;
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
    feed.split = async (t) => ({ head: t, blocks: [], skipped: 0 });
    assert.deepEqual(plain(await feed.read(text, { calendar: CALENDARS.studio, window, link: LINKS.studio })), { problem: "unreadable" });
});

// Rules ical.js loops on, rules it throws on and events that don't parse: each is left out by its
// UID, and the rest of the calendar reads as usual. Run in a worker with a time and memory limit,
// so a rule that gets through fails this test instead of hanging it.
test("an event ical.js can't read is left out by its UID, and the rest of the calendar reads", async () => {
    const day = "2026-11-12";
    const bad = {
        "daily-last-day@example.org": "RRULE:FREQ=DAILY;BYMONTHDAY=-1",
        "daily-monday-last@example.org": "RRULE:FREQ=DAILY;BYDAY=MO;BYMONTHDAY=-1",
        "daily-setpos@example.org": "RRULE:FREQ=DAILY;INTERVAL=3;BYMONTHDAY=-1;BYSETPOS=1",
        "no-such-date@example.org": "RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30",
        "yearly-no-date@example.org": "RRULE:FREQ=YEARLY;BYMONTH=4,6;BYMONTHDAY=31",
        "fortnightly@example.org": "RRULE:FREQ=FORTNIGHTLY",
        "yearday@example.org": "RRULE:FREQ=DAILY;INTERVAL=7;BYYEARDAY=320,330,340",
    };
    const lines = [];
    for (const [uid, rule] of Object.entries(bad)) {
        lines.push(...vevent(`UID:${uid}`, "SUMMARY:Bad rule", "DTSTART;TZID=America/New_York:20261001T090000", "DTEND;TZID=America/New_York:20261001T100000", rule));
    }
    lines.push(...vevent("UID:not-a-date@example.org", "SUMMARY:Bad date", "DTSTART;VALUE=DATE-TIME:20261114", "DTEND:20261114T100000Z"));
    lines.push(...vevent("UID:no-start@example.org", "SUMMARY:No start", "DTEND:20261114T100000Z"));
    // An override that doesn't parse leaves its whole series out, not its other occurrences as if unmoved
    lines.push(...vevent("UID:daily-good@example.org", "SUMMARY:Good series", "DTSTART;TZID=America/New_York:20261113T090000",
        "DTEND;TZID=America/New_York:20261113T093000", "RRULE:FREQ=DAILY;COUNT=5"));
    lines.push(...vevent("UID:daily-good@example.org", "RECURRENCE-ID;TZID=America/New_York:20261115T090000", "DTSTART;TZID=America/New_York:20261115T110000",
        "DTEND;TZID=America/New_York:20261115T113000", "SUMMARY:Moved", "X-BROKEN;=:"));
    lines.push(...vevent("UID:fine@example.org", "SUMMARY:Fine", "DTSTART;TZID=America/New_York:20261113T140000", "DTEND;TZID=America/New_York:20261113T150000"));
    // A zone whose rule ical.js would loop on is dropped, and its times read as the device's
    const loopZone = ["BEGIN:VTIMEZONE", "TZID:Looping", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0100",
        "RRULE:FREQ=DAILY;BYMONTHDAY=-1", "END:STANDARD", "END:VTIMEZONE"];
    lines.push(...vevent("UID:looping-zone@example.org", "SUMMARY:Looping zone", "DTSTART;TZID=Looping:20261114T090000", "DTEND;TZID=Looping:20261114T100000"));
    const text = calendar(lines, [...NY_ZONE, ...loopZone]);
    const code = `
        const { parentPort, workerData } = require("node:worker_threads");
        (async () => {
            process.env.TZ = "America/New_York";
            const vm = require("node:vm");
            const ICAL = (await import(workerData.ical)).default;
            const { loadClass } = await import(workerData.shape);
            const context = vm.createContext({ ICAL, requestUrl: null, performance, window: { setTimeout, clearTimeout } });
            const CalendarFeed = loadClass("calendarFeed.js", context);
            const feed = new CalendarFeed();
            const [y, m, d] = workerData.day.split("-").map(Number);
            const got = await feed.read(workerData.text, { calendar: { id: "c", name: "C", account: null }, window: feed.window(14, new Date(y, m - 1, d, 9)) });
            parentPort.postMessage(JSON.stringify(got));
        })().catch((e) => parentPort.postMessage(JSON.stringify({ error: String(e) })));`;
    const worker = new Worker(code, {
        eval: true,
        workerData: { text, day, ical: import.meta.resolve("ical.js"), shape: new URL("../classShape.mjs", import.meta.url).href },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const got = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { worker.terminate(); reject(new Error("the read didn't finish: a rule got through")); }, 20000);
        worker.on("message", (m) => { clearTimeout(timer); worker.terminate(); resolve(JSON.parse(m)); });
        worker.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    assert.equal(got.error, undefined, got.error);
    assert.ok(!got.problem, got.problem);
    assert.deepEqual([...got.failed].sort(), [...Object.keys(bad), "not-a-date@example.org", "no-start@example.org", "daily-good@example.org"].sort());
    assert.deepEqual(got.events.map((e) => [e.title, e.start]), [["Fine", "2026-11-13T14:00:00-05:00"], ["Looping zone", "2026-11-14T09:00:00-05:00"]]);
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

test("it hands control back through scheduler.yield, else a posted message, else a timer", async () => {
    const day = "2026-11-12";
    const text = feeds(day).studio.text;
    let yields = 0;
    const scheduler = { yield: () => { yields++; return Promise.resolve(); } };
    for (const [name, extra] of [["scheduler", { scheduler }], ["message", { MessageChannel }], ["timer", {}]]) {
        const { CalendarFeed, feed } = reader(undefined, extra);
        CalendarFeed.SLICE_MS = 0;
        const got = await feed.read(text, { calendar: CALENDARS.studio, window: feed.window(14, at(day)), link: LINKS.studio });
        assert.equal(got.events.length, 12, name);
        assert.ok(got.stats.steps > 10, `${name}: ${got.stats.steps} steps`);
    }
    assert.ok(yields > 10);
});

test("Heavy, what's slowest for ical.js, reads its series and skips its old overrides", async () => {
    const { feed } = reader();
    const day = "2026-11-12";
    const window = feed.window(62, at(day));
    const got = await feed.read(feeds(day).heavy.text, { calendar: CALENDARS.library, window, link: LINKS.heavy });
    assert.deepEqual(plain(got.failed), []);
    assert.equal(got.stats.skipped, HEAVY.overrides);
    const titles = new Set(got.events.map((e) => e.title));
    assert.deepEqual([...titles].sort(), ["Desk hours", "Last-Friday review", "Month-end close", "Morning check"]);
    // The last weekday of November 2026 is Monday the 30th, at 10am Eastern
    assert.ok(got.events.some((e) => e.title === "Month-end close" && e.start === "2026-11-30T10:00:00-05:00"));
    // The last Friday of November, at 10am Pacific: 1pm Eastern
    assert.ok(got.events.some((e) => e.title === "Last-Friday review" && e.start === "2026-11-27T13:00:00-05:00"));
});
