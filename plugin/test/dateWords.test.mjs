// Plainday's own reader of typed dates (plugin/src/shared/dateWords.js, OBS-139), with the real
// chrono-node: it reads every phrase the way Natural Language Dates (Revived) does, by the record of
// Revived's own answers (Config/Scripts/tests/datePrompt.revived.json, recordRevived.mjs), but for
// the four phrases below; and the date box reads the same with it as with Revived, but for two.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as chronoEn from "chrono-node/en";
import { loadClass } from "../classShape.mjs";
import { RECORD, recordedReader } from "../../Config/Scripts/tests/recordedReader.mjs";

const moment = createRequire(import.meta.url)("moment");
// In the record's time zone: a few readings depend on it, Revived's and Plainday's alike ("2026-10")
process.env.TZ = RECORD.timeZone;

// The reader and the date box in one context, with this realm's Date: chrono-node takes a reference
// date only when it's a Date of its own realm
// `format`: the date format Plainday writes and reads in (Dates, OBS-309), M/D unless given
const load = ({ revived = null, format = null } = {}) => {
    const plainday = {};
    const context = vm.createContext({ moment, chronoEn, Date, plainday, app: { plugins: { getPlugin: (id) => (id === "nldates-revived" ? revived : null) } }, console });
    plainday.Dates = new (loadClass("dates.js", vm.createContext({ plainday: { Settings: { get: () => ({ dates: { region: false, format: format ?? "M/D" } }) } } })))();
    plainday.DateWords = new (loadClass("dateWords.js", context))();
    plainday.DatePrompt = new (loadClass("datePrompt.js", context))();
    return plainday;
};
const { DateWords: words, DatePrompt: box } = load();

const pad = (n) => String(n).padStart(2, "0");
const local = (d) => (d && !isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null);
// 10am on a recorded day, as the record's clock was
const tenAm = (day) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 10); };

// The reader's answers on `day`, in the record's fields
const answers = (day, text) => {
    const now = tenAm(day);
    const r = words.at(now);
    const period = r.parser.getParsedPeriod(text);
    const results = r.parser.getParsedResult(text);
    const best = [...results].sort((a, b) => b.text.length - a.text.length)[0];
    return {
        parseDate: local(r.parseDate(text).moment.toDate()),
        period: { date: local(period.date), granularity: period.granularity },
        chrono: !!r.parser.getParsedDateResult(text, now),
        chronoDate: local(r.parser.getParsedDateResult(text, now, { forwardDate: true })),
        chronoWords: results.map((x) => x.text),
        chronoBest: best ? { text: best.text, year: best.start.isCertain("year"), month: best.start.isCertain("month"), day: best.start.isCertain("day") } : null,
    };
};

// Where Plainday's reader and Revived differ: its chrono-node is newer than the one inside Revived,
// and reads "end of …" and "last day of …" whole, where Revived's reads part of the words
const DIFFERENT = ["end of month", "end of october", "last day of month", "last day of next month"];

test("Plainday's reader gives Revived's answers, field by field, on every recorded day", () => {
    const days = Object.keys(RECORD.days);
    assert.ok(days.length >= 8, "the record's days");
    let rows = 0;
    for (const day of days) {
        for (const [text, row] of Object.entries(RECORD.days[day])) {
            if (DIFFERENT.includes(text)) continue;
            rows++;
            assert.deepEqual(answers(day, text), { ...row, chronoBest: row.chronoBest ?? null }, `${day} ${JSON.stringify(text)}`);
        }
    }
    assert.ok(rows > 700, `${rows} rows`);
});

test("where the readers differ, Plainday's reads all the words", () => {
    const SUN = "2026-09-27";
    const rev = RECORD.days[SUN];
    assert.equal(rev["end of month"].chronoDate, null, "Revived can't read it");
    assert.equal(answers(SUN, "end of month").parseDate, "2026-09-30");
    assert.deepEqual(rev["end of october"].chronoWords, ["october"], "Revived reads only \"october\"");
    assert.equal(rev["end of october"].parseDate, "2026-10-01");
    assert.equal(answers(SUN, "end of october").parseDate, "2026-10-31");
    assert.deepEqual(answers(SUN, "end of october").chronoWords, ["end of october"]);
    // The same day either way; only chrono-node's own words differ
    for (const text of ["last day of month", "last day of next month"]) {
        for (const day of Object.keys(RECORD.days)) assert.equal(answers(day, text).parseDate, RECORD.days[day][text].parseDate, `${day} ${text}`);
    }
    assert.deepEqual(answers(SUN, "last day of next month").chronoWords, ["last day of next month"]);
    assert.deepEqual(rev["last day of next month"].chronoWords, ["last day", "next month"]);
});

// The date box's reading of every recorded phrase, on every recorded day, in each box, with weeks
// starting Sunday or Monday: by Plainday's reader, and by Revived's recorded answers
const BOXES = { "Schedule and Due date": {}, "Jump to date": { periods: true, nearest: true }, Invoice: { nearest: true } };
const show = (r) => (r ? `${r.unit} ${r.date}${r.readAs ? ` (read as "${r.readAs}")` : ""}` : "not a date");

test("the date box reads every recorded phrase the same with Plainday's reader as with Revived, but two", () => {
    const changed = new Map();
    let n = 0;
    for (const day of Object.keys(RECORD.days)) {
        const now = tenAm(day);
        for (const text of Object.keys(RECORD.days[day])) {
            for (const [name, opts] of Object.entries(BOXES)) {
                for (const weekStart of [0, 1]) {
                    n++;
                    const ours = show(box.read(text, { ...opts, weekStart, today: day, now }));
                    const theirs = show(box.readWith(recordedReader(day), text, { ...opts, weekStart, today: day, now }));
                    if (ours !== theirs) changed.set(`${text} | ${day} | ${name} | ${weekStart}`, `${theirs} → ${ours}`);
                }
            }
        }
    }
    assert.ok(n > 4000, `${n} readings`);
    const phrases = new Set([...changed.keys()].map((k) => k.split(" | ")[0]));
    assert.deepEqual([...phrases].sort(), ["end of month", "end of october", "last day of next month"]);
    // "last day of next month": the same day, without the note that only part was read
    for (const [k, v] of changed) {
        if (!k.startsWith("last day of next month")) continue;
        assert.match(k, /\| 2026-12-31 \|/, k);
        assert.equal(v, `day 2027-01-31 (read as "next month") → day 2027-01-31`, k);
    }
});

test("the two phrases that change, typed on Sun 9/27/26, in each box", () => {
    const SUN = "2026-09-27";
    const now = tenAm(SUN);
    for (const [name, opts] of Object.entries(BOXES)) {
        const line = (text) => box.describe(box.read(text, { ...opts, today: SUN, now }), SUN);
        assert.equal(line("end of month"), "Wed 9/30 · in 3 days", name);
        assert.equal(line("end of october"), "Sat 10/31 · in 34 days", name);
        // Before: Revived's reading
        const before = (text) => box.describe(box.readWith(recordedReader(SUN), text, { ...opts, today: SUN, now }), SUN);
        assert.equal(before("end of month"), "", `${name}: not a date I can read`);
        assert.equal(before("end of october"), `Thu 10/1 · in 4 days · read as "october"`, name);
    }
});

test("a phrase still read in part says so, as the manual shows", () => {
    const SUN = "2026-09-27";
    const r = box.read("mid october", { today: SUN, now: tenAm(SUN) });
    assert.equal(box.describe(r, SUN), `Thu 10/1 · in 4 days · read as "october"`);
    assert.equal(box.read("tomorow at 5pm", { today: SUN, now: tenAm(SUN) }), null, "a partial reading that's today counts as unreadable");
});

test("words Plainday's reader can't read go to Revived when it's on, and only those", () => {
    const SUN = "2026-09-27";
    const asked = [];
    // Revived reading a French word: "lundi prochain" is next Monday
    const revived = {
        settings: {},
        parseDate: (t) => { asked.push(t); return { moment: moment(t === "lundi prochain" ? "2026-09-28" : "2026-09-27", "YYYY-MM-DD") }; },
        parser: {
            getParsedPeriod: (t) => ({ date: new Date(2026, 8, t === "lundi prochain" ? 28 : 27), granularity: "day" }),
            getParsedDateResult: (t) => (t === "lundi prochain" ? new Date(2026, 8, 28) : null),
            getParsedResult: (t) => (t === "lundi prochain" ? [{ text: t, start: { isCertain: () => false } }] : []),
        },
    };
    const { DatePrompt: withRevived } = load({ revived });
    const read = (t) => show(withRevived.read(t, { today: SUN, now: tenAm(SUN) }));
    assert.equal(read("lundi prochain"), "day 2026-09-28");
    assert.equal(read("end of october"), "day 2026-10-31", "English stays Plainday's, where Revived would read 10/1");
    assert.equal(read("friday"), "day 2026-10-02");
    assert.equal(read("fridya"), "not a date");
    assert.deepEqual(asked, ["lundi prochain", "fridya"]);
    // Without Revived, the French word isn't a date
    assert.equal(show(box.read("lundi prochain", { today: SUN, now: tenAm(SUN) })), "not a date");
});

test("OBS-162's shorthands read as nothing, so they're free to mean something", () => {
    for (const day of Object.keys(RECORD.days)) {
        for (const t of ["d", "y", "t", "tw", "lw", "nw", "tm", "lm", "nm", "ty", "ly", "ny"]) {
            assert.equal(box.read(t, { today: day, now: tenAm(day) }), null, `${day} ${t}`);
        }
    }
});

test("a date format with the day first reads day before month, with slashes or its own joiner (OBS-309)", () => {
    const now = tenAm("2026-09-27");
    assert.equal(local(words.parseDate("3/10", now)), "2027-03-10");
    for (const format of ["D/M", "D.M.", "DD-MM"]) assert.equal(local(load({ format }).DateWords.parseDate("3/10", now)), "2026-10-03", format);
    const { DatePrompt: dm } = load({ format: "D.M." });
    const on = { today: "2026-09-17", now: tenAm("2026-09-17") };
    for (const typed of ["5/10", "5.10.", "5.10"]) assert.equal(dm.read(typed, on)?.date, "2026-10-05", typed);
    assert.equal(dm.read("2/10/2027", { ...on, periods: true, nearest: true })?.date, "2027-10-02");
    assert.equal(dm.read("week of 20/9", on)?.date, "2026-09-20");
    assert.equal(load({ format: "D-M" }).DatePrompt.read("5-10", on)?.date, "2026-10-05");
    // English (UK) alone no longer turns the order round: the format does
    const before = moment.locale();
    try {
        moment.locale("en-gb");
        assert.equal(local(words.parseDate("3/10", now)), "2027-03-10");
    } finally {
        moment.locale(before);
    }
});
