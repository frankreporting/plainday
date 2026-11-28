// Tests for plugin/src/shared/dates.js (OBS-309): the date format Plainday writes in (the daily notes' names',
// or a custom one set in Settings → Plainday → Dates), and the places that write and read a date in it. Run
// from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// Every note, task and date here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadClass } from "../../../plugin/classShape.mjs";
import { standIn, withDates, PLANNER } from "./standInVault.mjs";

// Dates in a context whose Settings say `dates` (null: no Settings at all), whose daily notes are named
// `names` (null: no Schedule), and whose moment's language writes its numeric dates as `language`
const datesWith = (dates, { names = "YYYY-MM-DD", language = "MM/DD/YYYY" } = {}) => {
    const plainday = dates === null ? {} : { Settings: { get: () => ({ dates }) } };
    if (names !== null) plainday.Schedule = { dailyOpts: () => ({ format: names }) };
    const moment = { localeData: () => ({ longDateFormat: (k) => (k === "L" ? language : "") }) };
    const Dates = loadClass("dates.js", vm.createContext({ plainday, moment }));
    return new Dates();
};
const Dates = loadClass("dates.js", vm.createContext({ plainday: {} }));

test("parse: the day, month and year as numbers, each once, one joiner, the year first or last", () => {
    const cases = {
        "M/D/YY": [false, "/", false, "M/D"],
        "D/M/YYYY": [true, "/", false, "D/M"],
        "DD.MM.YYYY": [true, ".", false, "DD.MM."],
        "M.D.YY": [false, ".", false, "M.D."],
        "YYYY-MM-DD": [false, "-", true, "MM-DD"],
        "YY.DD.MM": [true, ".", true, "DD.MM"],
        "DD-MM-YYYY": [true, "-", false, "DD-MM"],
    };
    for (const [format, parts] of Object.entries(cases)) {
        const p = Dates.parse(format);
        assert.deepEqual([p.dayFirst, p.sep, p.yearFirst, p.short], parts, format);
    }
    assert.equal(Dates.parse(" M/D/YY ").full, "M/D/YY");
    for (const format of ["M/D", "D.M.", "D MMM YYYY", "YYYYMMDD", "YYYY-MM-DD dddd", "D/M-YY", "DD/DD/YY", "MM/MM/YYYY", "D/M/YYY", "D/YY/M",
        "dd/mm/yy", "DD.MM.YYYY.", "", null, 7]) assert.equal(Dates.parse(format), null, String(format));
});

test("format: the custom one while it's on, else the daily notes' names, else YYYY-MM-DD; M/D/YY without Plainday's settings", () => {
    assert.equal(datesWith(null).format(), "M/D/YY", "no settings (the Raycast timer)");
    assert.equal(datesWith({ custom: false, format: "" }, { names: null }).format(), "M/D/YY", "no Schedule (the demo render)");
    assert.equal(datesWith({ custom: true, format: "DD.MM.YYYY" }, { names: null }).format(), "DD.MM.YYYY", "the box, even without Schedule");
    assert.equal(datesWith({ custom: true, format: "DD.MM.YYYY" }).format(), "DD.MM.YYYY");
    assert.equal(datesWith({ custom: false, format: "DD.MM.YYYY" }).format(), "YYYY-MM-DD", "the switch off: the names'");
    assert.equal(datesWith({ custom: true, format: "" }, { names: "DD-MM-YYYY" }).format(), "DD-MM-YYYY", "an empty box: the names'");
    assert.equal(datesWith({ custom: true, format: "D MMM" }, { names: "DD-MM-YYYY" }).format(), "DD-MM-YYYY", "a box it can't use: the names'");
    for (const names of ["YYYYMMDD", "YYYY-MM-DD dddd", "DD MMMM YYYY", ""]) assert.equal(datesWith({ custom: false, format: "" }, { names }).format(), "YYYY-MM-DD", names);
    assert.equal(datesWith({ custom: false, format: "" }, { names: "YYYYMMDD" }).names(), "YYYY-MM-DD", "what an empty box gives");
});

test("dayFirst: the format's order, or Obsidian's language for a format that starts with the year", () => {
    assert.equal(datesWith({ custom: true, format: "DD.MM.YYYY" }).dayFirst(), true);
    assert.equal(datesWith({ custom: true, format: "M/D/YY" }, { language: "DD/MM/YYYY" }).dayFirst(), false, "the format says month first");
    const yearFirst = (language) => datesWith({ custom: false, format: "" }, { language }).dayFirst();
    // en-gb, de, fr write the day first; en and ja don't
    assert.deepEqual(["DD/MM/YYYY", "DD.MM.YYYY", "MM/DD/YYYY", "YYYY/MM/DD"].map(yearFirst), [true, true, false, false]);
    assert.equal(datesWith(null).dayFirst(), false, "M/D/YY without settings");
});

test("the forms: a day, with its year, a week and a range, in each format", () => {
    const at = (format) => datesWith({ custom: true, format });
    const cases = {
        "M/D/YY": ["9/7", "9/7/26", "9/7/2026", "Wk of 9/7", "9/13-9/19"],
        "DD.MM.YYYY": ["07.09.", "07.09.2026", "07.09.2026", "Wk of 07.09.", "13.09.-19.09."],
        "D/M/YY": ["7/9", "7/9/26", "7/9/2026", "Wk of 7/9", "13/9-19/9"],
        "YYYY-MM-DD": ["09-07", "2026-09-07", "2026-09-07", "Wk of 09-07", "09-13–09-19"],
    };
    for (const [format, want] of Object.entries(cases)) {
        const d = at(format);
        assert.deepEqual([d.day("2026-09-07"), d.year("2026-09-07"), d.year("2026-09-07", true), d.week("2026-09-07"), d.range("2026-09-13", "2026-09-19")], want, format);
    }
    assert.equal(at("YYYY-MM-DD").year("2007-01-05"), "2007-01-05");
    assert.equal(at("YY.MM.DD").year("2007-01-05"), "07.01.05", "a two-digit year, padded");
    assert.equal(at("DD.MM.YYYY").day({ format: (f) => (f === "YYYY-MM-DD" ? "2026-10-01" : "?") }), "01.10.", "a moment");
    assert.equal(at("DD.MM.YYYY").year({ year: () => 2026, month: () => 9, date: () => 1, format: () => "٢٠٢٦-١٠-٠١" }), "01.10.2026", "a moment in its own digits, read as numbers");
});

test("slashed: a day and month typed with the format's own joiner, as the date readers read them", () => {
    const dm = datesWith({ custom: true, format: "DD.MM.YYYY" });
    assert.deepEqual(["5.10.", "5.10", "5.10.27", "5.10.2027", "5/10", "5.10.2", "oct 5"].map((t) => dm.slashed(t)), ["5/10", "5/10", "5/10/27", "5/10/2027", null, null, null]);
    const iso = datesWith({ custom: false, format: "" });
    assert.deepEqual(["10-02", "2026-10-02"].map((t) => iso.slashed(t)), ["10/02", null], "a year typed first goes to the readers as typed");
    assert.equal(datesWith({ custom: true, format: "M/D/YY" }).slashed("5/10"), null, "slashes go to the readers as typed");
    // A format that starts with the year: its own short form reads in its own order (MM-DD), whatever order the
    // language's readers take, so a typed 🚩 label means what it says
    assert.equal(datesWith({ custom: false, format: "" }, { language: "DD/MM/YYYY" }).slashed("09-10"), "10/09", "turned round for a day-first reader");
    assert.equal(datesWith({ custom: false, format: "" }, { language: "MM/DD/YYYY" }).slashed("09-10"), "09/10");
});

test("a daily note's own name typed in the date box is read as a name first, before its joiner turns into slashes", () => {
    const plainday = withDates({}, "YYYY-MM-DD");
    const ctx = vm.createContext({ plainday, moment: () => ({ format: () => "2026-09-17" }) });
    const dp = new (loadClass("datePrompt.js", ctx))();
    const seen = [];
    const name = (text) => { seen.push(text); return text === "26-09-20" ? { date: "2026-09-20", unit: "day" } : null; };
    assert.equal(dp.readWith({}, "26-09-20", { name })?.date, "2026-09-20");
    assert.deepEqual(seen, ["26-09-20"]);
});

// ---------------------------------------------------------------- the writers, under DD.MM.YYYY

test("the writers' own forms under DD.MM.YYYY: the date box, a sentence, an alias, a notice, an invoice", () => {
    const plainday = withDates({}, "DD.MM.YYYY");
    const ctx = vm.createContext({ plainday, moment: () => ({ format: () => "2026-09-17" }) });
    plainday.DatePrompt = new (loadClass("datePrompt.js", ctx))();
    const dp = plainday.DatePrompt;
    assert.equal(dp.describe({ date: "2026-10-05", unit: "day" }, "2026-09-17"), "Mon 05.10. · in 18 days");
    assert.equal(dp.describe({ date: "2027-01-05", unit: "day" }, "2026-09-17"), "Tue 05.01.2027 · in 110 days", "another year's");
    assert.equal(dp.spell({ date: "2027-10-02", unit: "day" }), "Saturday 2 October 2027", "the day first, spelled out");
    assert.equal(dp.spell({ date: "2026-09-23", unit: "week" }), "the week starting 20.09.2026");
    const tr = new (loadClass("timeReport.js", vm.createContext({ plainday })))();
    assert.deepEqual([tr.md("2026-09-17"), tr.shortDate("2026-09-11"), tr.mdRange("2026-09-13", "2026-09-19")], ["17.09.", "11.09.2026", "13.09.-19.09."]);
    const inv = new (loadClass("invoice.js", vm.createContext({ plainday })))();
    assert.deepEqual([inv.label("2026-09-17", false), inv.label("2026-09-17", true), inv.dateText("2026-09-17")], ["17.09.", "17.09.2026", "17.09.2026"]);
    const Schedule = loadClass("schedule.js", vm.createContext({ plainday }));
    assert.equal(Schedule.periodLabel({ date: "2026-09-23", unit: "week" }), "Wk of 20.09.");
    const change = new (loadClass("taskChange.js", vm.createContext({ plainday })))();
    assert.equal(change.refused({ entry: { date: "2026-09-11" }, invoice: { number: "1001-KES", status: "paid", paid: "2026-09-15" } }),
        "Nothing changed: this task's time on 11.09. is on 1001-KES (paid 15.09.).");
});

test("a label is read back: the links at a line's end, a forward date, an edited invoice description", () => {
    const plain = { plainday: withDates({}, "DD.MM.YYYY") };
    const T = loadClass("taskIds.js", vm.createContext(plain)), TL = loadClass("trailingLinks.js", vm.createContext(plain));
    const DueDate = loadClass("setDueDate.js", vm.createContext(plain)), TR = loadClass("timeReport.js", vm.createContext(plain));
    const line = "- [>] Homepage build [[2026-09-30|🚩 30.09.]] [[2026-09-18#^h1b2c3|18.09.]] ^h1b2c3";
    for (const label of ["18.09.", "09-18", "9/18", "Wk of 20.09.", "Wk of 09-20"]) assert.match(`[[2026-09-18#^h1b2c3|${label}]]`, T.FORWARD, label);
    assert.match("- [ ] Homepage build [[2026-09-30|🚩 30.09.]]", TL.LINK);
    assert.match("- [ ] Homepage build [[2026-09-30|🚩 09-30]]", TL.LINK);
    assert.equal([...line.matchAll(DueDate.DUE_LINK)].length, 1, "Due date finds the 🚩 it replaces");
    assert.match("[[2026-09-18#^h1b2c3|18.09.]]", TR.FORWARD_LINK);
    // The Raycast timer runs the report's code with no `plainday`: it still drops the forward date from a task's name
    const raycast = new (loadClass("timeReport.js", vm.createContext({ plainday: undefined })))();
    assert.equal(raycast.itemLabel(line), "Homepage build 🚩 30.09.");
    assert.equal(raycast.md("2026-09-18"), "9/18", "and writes M/D, though it writes no dates");
    assert.equal(loadClass("timeReport.js", vm.createContext({ plainday: undefined })).dateFormat(), "M/D/YY");
    // Rebuild keeps a description by its line's date, written in any of the joiners, with its year before or after
    const Invoice = loadClass("invoice.js", vm.createContext(plain)), Billing = loadClass("billing.js", vm.createContext(plain));
    const table = (label) => `## Billable hours\n\n| Description | Hours | Rate | Amount |\n| --- | --: | --: | --: |\n| ${label} — Edited by hand | 1.00 | $95.00 | $95.00 |\n`;
    for (const label of ["17.09.", "17.09.2026", "30.12.2026", "17-09", "2026-12-30", "9/17", "9/17/26", "12/30/2026"]) {
        assert.deepEqual(JSON.parse(JSON.stringify([...new Invoice().descriptions(table(label), new Billing())])), [[`${label} $95.00`, "Edited by hand"]], label);
    }
});

// ---------------------------------------------------------------- Due date and Schedule, in the app's own run

const day = (d) => `${PLANNER}/days/${d}.md`;
const KES = "Projects/Kestrel/Kestrel.md";
const NOTES = {
    [KES]: "---\ntags: [project]\n---\n\n## To Do\n\n- [ ] Homepage build ^h1b2c3\n",
    [day("2026-09-16")]: "- [ ] Poster typefaces [[Kestrel|⭕]]\n",
};

test("Due date and Schedule under DD.MM.YYYY: the 🚩, a second Due date replacing it, and the forward date (OBS-309)", async () => {
    const v = standIn({ notes: NOTES });
    v.plainday.Settings.get().dates.format = "DD.MM.YYYY";
    const at = v.lineOf(KES, "Homepage build");
    v.open(KES, at);
    await v.dueDate("2026-09-30");
    assert.equal(v.notes()[KES].split("\n")[at], "- [ ] Homepage build [[2026-09-30|🚩 30.09.]] ^h1b2c3");
    v.open(KES, at);
    await v.dueDate("2026-10-01");
    assert.equal(v.notes()[KES].split("\n")[at], "- [ ] Homepage build [[2026-10-01|🚩 01.10.]] ^h1b2c3", "one 🚩, not two");
    v.open(KES, at);
    v.notices.length = 0;
    await v.schedule("2026-09-18");
    v.open(day("2026-09-18"), 0);
    assert.equal(v.notes()[KES].split("\n")[at], "- [>] Homepage build [[2026-10-01|🚩 01.10.]] [[2026-09-18#^h1b2c3|18.09.]] ^h1b2c3");
    assert.deepEqual(v.notices, []);
    // A week
    v.open(day("2026-09-16"), 0);
    v.notices.length = 0;
    await v.schedule("2026-09-20", "week");
    assert.deepEqual(v.notices, ["Moved to Wk of 20.09."]);
});

test("the switch off: Due date writes the daily notes' names' format (OBS-309)", async () => {
    const v = standIn({ notes: NOTES });
    Object.assign(v.plainday.Settings.get().dates, { custom: false, format: "" });
    const at = v.lineOf(KES, "Homepage build");
    v.open(KES, at);
    await v.dueDate("2026-09-30");
    assert.equal(v.notes()[KES].split("\n")[at], "- [ ] Homepage build [[2026-09-30|🚩 09-30]] ^h1b2c3");
});
