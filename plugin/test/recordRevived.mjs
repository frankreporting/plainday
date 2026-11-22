// Records what Natural Language Dates (Revived) reads each phrase as, into
// Config/Scripts/tests/datePrompt.revived.json: the record Plainday's own reader (DateWords) is
// checked against (dateWords.test.mjs), and which stands in for a reader in the date box's tests
// (Config/Scripts/tests/datePrompt.test.mjs). Plainday's reader is Revived's English rules on
// chrono-node, so the two give the same answers but for the phrases dateWords.test.mjs names.
//
// It runs Revived's own code, from a vault where it's installed, in Node: Obsidian's module is a
// stand-in (moment and empty classes), and the clock is fixed at 10am on each day. The days and
// phrases are below; add one and record again. Revived's settings as it comes: weeks start as the
// locale says (English: Sunday), and the weekly, monthly and yearly formats are set.
//
// The record names the time zone it was made in: a few readings depend on it ("2026-10" is a
// different day in Auckland), so the tests that read it run in that zone.
//
// Run from the repository root, after `npm ci`, best in the record's zone:
//   TZ=America/Los_Angeles node plugin/test/recordRevived.mjs <vault>/.obsidian/plugins/nldates-revived/main.js
// `--out <file>` writes the record there instead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const OUT = path.join(ROOT, "Config/Scripts/tests/datePrompt.revived.json");

// The days: a Sunday, a Monday and a Saturday in September, the ends of short and long months, the
// end of a year, a February 29th, and a month's first day
export const DAYS = ["2026-09-27", "2026-09-21", "2026-09-26", "2026-01-31", "2026-02-28", "2026-12-31", "2028-02-29", "2026-10-01"];
// The phrases: everyday words, the manual's examples, words the date box reads itself first (it
// strips "week of"; a note's own name), typos, and the shorthands OBS-162 adds, which must read
// as nothing
export const PHRASES = [
    "today", "tomorrow", "yesterday", "friday", "fri", "monday", "sunday", "saturday", "Friday!",
    "this friday", "next friday", "last friday", "this sunday", "last saturday", "next mon",
    "next monday at 3pm", "friday at 3pm", "tomorrow at 5pm", "today at 5pm",
    "in 3 days", "in 2 weeks", "in 1 month", "in 7 months", "in 2 weeks and 3 days", "in 3 months and 2 days", "3 days ago", "2 weeks ago",
    "from monday to friday", "the 15th of next month", "the first of next month", "the 16th", "16th",
    "last day of month", "last day of next month", "first monday of next month", "last friday of this month",
    "this week", "next week", "last week", "NEXT WEEK", "this month", "next month", "last month", "this year", "next year", "last year",
    "next quarter", "Q3", "q4 2026", "2026-Q1", "2026-W40", "2026-W41", "2026-W01",
    "10/2", "oct 2", "oct 5", "october 15", "9/16", "sep 16", "9/1/26", "9/16/26", "10/15/2026", "2026-10-20",
    "jan 5", "jan 31", "feb 29", "march 3", "dec 31", "12/25",
    "oct", "w41", "2026-10", "2027", "week of friday", "noon", "tonight",
    "fridya", "tomorow", "asdf", "tomorow at 5pm", "mid october",
    "end of month", "end of october", "end of week", "end of year",
    "d", "y", "t", "tw", "lw", "nw", "tm", "lm", "nm", "ty", "ly", "ny",
];

export const HOW = "Recorded by plugin/test/recordRevived.mjs from the plugin's own code, with a fixed clock at 10am on each day: "
    + "parseDate(text).moment as YYYY-MM-DD (null if invalid), as the plugin's parseDate gives it (the period's date for a week, month or year, else parser.getParsedDate); "
    + "parser.getParsedPeriod(text, 'locale-default'); whether parser.getParsedDateResult(text, now) found anything; its date with { forwardDate: true } (chronoDate); "
    + "the words parser.getParsedResult(text) matched (chronoWords); and for the longest of them, which of year, month and day the words stated (chronoBest, from start.isCertain)";

// One row per line, so a change shows as the rows it changes
export function format(record) {
    const out = [`{`, `  "plugin": ${JSON.stringify(record.plugin)},`, `  "settings": ${JSON.stringify(record.settings)},`, `  "timeZone": ${JSON.stringify(record.timeZone)},`, `  "how": ${JSON.stringify(record.how)},`, `  "days": {`];
    const days = Object.entries(record.days);
    days.forEach(([day, rows], i) => {
        out.push(`    ${JSON.stringify(day)}: {`);
        const entries = Object.entries(rows);
        entries.forEach(([text, row], j) => out.push(`      ${JSON.stringify(text)}: ${JSON.stringify(row)}${j < entries.length - 1 ? "," : ""}`));
        out.push(`    }${i < days.length - 1 ? "," : ""}`);
    });
    out.push(`  }`, `}`, ``);
    return out.join("\n");
}

function record(mainJs) {
    const require = createRequire(path.join(ROOT, "package.json"));
    const moment = require("moment");
    const Module = require("node:module");
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(mainJs), "manifest.json"), "utf8"));

    // Obsidian's module: moment, and an empty class for anything else
    class Base {}
    const obsidian = new Proxy({ moment, normalizePath: (p) => p, Platform: {} }, { get: (t, k) => (k in t ? t[k] : Base) });
    const resolve = Module._resolveFilename;
    const stub = path.join(os.tmpdir(), "plainday-obsidian-stub.cjs");
    fs.writeFileSync(stub, "module.exports = globalThis.__obsidianStub;\n");
    globalThis.__obsidianStub = obsidian;
    Module._resolveFilename = function (request, ...rest) { return request === "obsidian" ? stub : resolve.call(this, request, ...rest); };
    globalThis.window = globalThis;
    globalThis.document = { createElement: () => ({}), body: {} };
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    globalThis.moment = moment;

    // The clock, fixed while recording
    const RealDate = Date;
    let fixed = 0;
    class FixedDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
        static now() { return fixed; }
    }
    globalThis.Date = FixedDate;

    // Revived's bundle, with its parser class exported
    const copy = path.join(os.tmpdir(), "plainday-nldates-revived.cjs");
    fs.writeFileSync(copy, `${fs.readFileSync(mainJs, "utf8")}\nmodule.exports.__NLDParser = NLDParser;\n`);
    const { __NLDParser: NLDParser } = require(copy);

    const pad = (n) => String(n).padStart(2, "0");
    const local = (d) => (d && !isNaN(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null);
    const days = {};
    for (const day of DAYS) {
        const [y, m, d] = day.split("-").map(Number);
        fixed = new RealDate(y, m - 1, d, 10).getTime();
        const parser = new NLDParser(["en"]);
        const rows = {};
        for (const text of PHRASES) {
            const period = parser.getParsedPeriod(text, "locale-default");
            const parsed = ["week", "month", "year"].includes(period.granularity) ? period.date : parser.getParsedDate(text, "locale-default");
            const found = parser.getParsedDateResult(text, new Date());
            const results = parser.getParsedResult(text);
            const best = [...results].sort((a, b) => b.text.length - a.text.length)[0];
            rows[text] = {
                parseDate: local(moment(parsed).toDate()),
                period: { date: local(period.date), granularity: period.granularity },
                chrono: !!found,
                chronoDate: local(parser.getParsedDateResult(text, new Date(), { forwardDate: true })),
                chronoWords: results.map((r) => r.text),
                chronoBest: best ? { text: best.text, year: best.start.isCertain("year"), month: best.start.isCertain("month"), day: best.start.isCertain("day") } : null,
            };
        }
        days[day] = rows;
    }
    globalThis.Date = RealDate;
    Module._resolveFilename = resolve;
    fs.rmSync(copy, { force: true });
    fs.rmSync(stub, { force: true });
    return {
        plugin: `${manifest.id} ${manifest.version}`,
        settings: "weekStart locale-default (en: Sunday), weekFormat GGGG[w]ww, monthFormat YYYY-MM, yearFormat YYYY",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        how: HOW,
        days,
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const mainJs = process.argv[2];
    if (!mainJs || !fs.existsSync(mainJs)) {
        console.error("Usage: node plugin/test/recordRevived.mjs <vault>/.obsidian/plugins/nldates-revived/main.js");
        process.exit(1);
    }
    const at = process.argv.indexOf("--out");
    const out = at > 0 ? path.resolve(process.argv[at + 1]) : OUT;
    const got = record(path.resolve(mainJs));
    fs.writeFileSync(out, format(got));
    console.log(`${path.relative(ROOT, out)}: ${got.plugin}, ${DAYS.length} days × ${PHRASES.length} phrases`);
}
