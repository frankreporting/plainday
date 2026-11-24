// Tests for plugin/src/shared/dates.js (OBS-309): the date format Plainday writes in, set in Settings →
// Plainday → Dates, and the places that write and read a date in it. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// Every note, task and date here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadClass } from "../../../plugin/classShape.mjs";
import { standIn, withDates, PLANNER } from "./standInVault.mjs";

// Dates in a context whose Settings say `dates` (null: no Settings at all), with `Intl` swapped when given
const datesWith = (dates, extra = {}) => {
    const Dates = loadClass("dates.js", vm.createContext({ plainday: dates === null ? {} : { Settings: { get: () => ({ dates }) } }, ...extra }));
    Dates.regionMade = null;
    return new Dates();
};
const Dates = loadClass("dates.js", vm.createContext({ plainday: {} }));
const partsOf = (locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" }).formatToParts(new Date(2026, 0, 2));

test("parse: the day and month as numbers, either first, joined by a slash, a dot or a dash", () => {
    for (const [format, parts] of [["M/D", [false, "/", false]], ["D/M", [true, "/", false]], ["D.M.", [true, ".", true]], ["DD-MM", [true, "-", false]], ["MM.DD", [false, ".", false]]]) {
        const p = Dates.parse(format);
        assert.deepEqual([p.dayFirst, p.sep, p.trailing], parts, format);
    }
    for (const format of ["D MMM", "D/M/YY", "D", "DD/DD", "D/M.", "D.M/", "dd/mm", "DDD/M", "", null, 7]) assert.equal(Dates.parse(format), null, String(format));
    // Only a dot may follow, which every pattern that finds a label by its shape takes
    for (const format of ["D/M/", "M-D-", "DD-MM-"]) assert.equal(Dates.parse(format), null, format);
});

test("the region's format, from Intl's parts: padded when a part has two digits, the joiner without its spaces", () => {
    for (const [locale, format] of [["en-US", "M/D"], ["en-GB", "DD/MM"], ["de", "D.M."], ["nl", "D-M"], ["ko", "M.D."], ["fr", "DD/MM"], ["sv", "D/M"]]) {
        assert.equal(Dates.fromParts(partsOf(locale)), format, locale);
    }
    assert.equal(Dates.fromParts([{ type: "day", value: "2" }, { type: "literal", value: " " }, { type: "month", value: "1" }]), "M/D", "no joiner: M/D");
    assert.equal(Dates.fromParts([{ type: "month", value: "1" }, { type: "literal", value: "/" }, { type: "day", value: "2" }, { type: "year", value: "2026" }]), "M/D", "a year among the parts: M/D");
    // region() asks Intl in Obsidian; stubbed here
    const intl = (parts) => ({ DateTimeFormat: class { formatToParts() { return parts; } } });
    assert.equal(datesWith({ region: true, format: "" }, { Intl: intl(partsOf("de")) }).format(), "D.M.");
    assert.equal(datesWith({ region: true, format: "" }, { Intl: { DateTimeFormat: class { constructor() { throw new Error("none"); } } } }).format(), "M/D");
});

test("format: the one typed while the region's is off, else the region's; M/D without Plainday's settings", () => {
    const intl = { Intl: { DateTimeFormat: class { formatToParts() { return partsOf("en-GB"); } } } };
    assert.equal(datesWith(null).format(), "M/D");
    assert.equal(datesWith({ region: false, format: "D.M." }, intl).format(), "D.M.");
    assert.equal(datesWith({ region: true, format: "D.M." }, intl).format(), "DD/MM", "the switch on: the region's");
    assert.equal(datesWith({ region: false, format: "" }, intl).format(), "DD/MM", "an empty box: the region's");
    assert.equal(datesWith({ region: false, format: "D MMM" }, intl).format(), "DD/MM", "a format it can't use: the region's");
});

test("the forms: a day, with its year, a week and a range, in each format", () => {
    const at = (format) => datesWith({ region: false, format });
    const cases = {
        "M/D": ["9/7", "9/7/26", "9/7/2026", "Wk of 9/7", "9/13-9/19"],
        "D.M.": ["7.9.", "7.9.26", "7.9.2026", "Wk of 7.9.", "13.9.-19.9."],
        "D/M": ["7/9", "7/9/26", "7/9/2026", "Wk of 7/9", "13/9-19/9"],
        "DD-MM": ["07-09", "07-09-26", "07-09-2026", "Wk of 07-09", "13-09–19-09"],
    };
    for (const [format, want] of Object.entries(cases)) {
        const d = at(format);
        assert.deepEqual([d.day("2026-09-07"), d.year("2026-09-07"), d.year("2026-09-07", true), d.week("2026-09-07"), d.range("2026-09-13", "2026-09-19")], want, format);
    }
    assert.equal(at("D.M.").day({ format: (f) => (f === "YYYY-MM-DD" ? "2026-10-01" : "?") }), "1.10.", "a moment");
    assert.equal(at("D.M.").year({ year: () => 2026, month: () => 9, date: () => 1, format: () => "٢٠٢٦-١٠-٠١" }), "1.10.26", "a moment in its own digits, read as numbers");
});

test("slashed: a day and month typed with the format's own joiner, as the date readers read them", () => {
    const dm = datesWith({ region: false, format: "D.M." });
    assert.deepEqual(["5.10.", "5.10", "5.10.27", "5.10.2027", "5/10", "5.10.2", "oct 5"].map((t) => dm.slashed(t)), ["5/10", "5/10", "5/10/27", "5/10/2027", null, null, null]);
    assert.equal(datesWith({ region: false, format: "D-M" }).slashed("5-10"), "5/10");
    assert.equal(datesWith({ region: false, format: "M/D" }).slashed("5/10"), null, "slashes go to the readers as typed");
});

// ---------------------------------------------------------------- the writers, under D.M.

test("the writers' own forms under D.M.: the date box, a sentence, an alias, a notice, an invoice", () => {
    const plainday = withDates({}, "D.M.");
    const ctx = vm.createContext({ plainday, moment: () => ({ format: () => "2026-09-17" }) });
    plainday.DatePrompt = new (loadClass("datePrompt.js", ctx))();
    const dp = plainday.DatePrompt;
    assert.equal(dp.describe({ date: "2026-10-05", unit: "day" }, "2026-09-17"), "Mon 5.10. · in 18 days");
    assert.equal(dp.describe({ date: "2027-01-05", unit: "day" }, "2026-09-17"), "Tue 5.1.27 · in 110 days", "another year's");
    assert.equal(dp.spell({ date: "2027-10-02", unit: "day" }), "Saturday 2 October 2027", "the day first, spelled out");
    assert.equal(dp.spell({ date: "2026-09-23", unit: "week" }), "the week starting 20.9.26");
    assert.equal(withDates({}).Dates.constructor.parse("M/D").dayFirst, false);
    const tr = new (loadClass("timeReport.js", vm.createContext({ plainday })))();
    assert.deepEqual([tr.md("2026-09-17"), tr.shortDate("2026-09-11"), tr.mdRange("2026-09-13", "2026-09-19")], ["17.9.", "11.9.26", "13.9.-19.9."]);
    const inv = new (loadClass("invoice.js", vm.createContext({ plainday })))();
    assert.deepEqual([inv.label("2026-09-17", false), inv.label("2026-09-17", true), inv.dateText("2026-09-17")], ["17.9.", "17.9.26", "17.9.2026"]);
    const Schedule = loadClass("schedule.js", vm.createContext({ plainday }));
    assert.equal(Schedule.periodLabel({ date: "2026-09-23", unit: "week" }), "Wk of 20.9.");
    const change = new (loadClass("taskChange.js", vm.createContext({ plainday })))();
    assert.equal(change.refused({ entry: { date: "2026-09-11" }, invoice: { number: "1001-KES", status: "paid", paid: "2026-09-15" } }),
        "Nothing changed: this task's time on 11.9. is on 1001-KES (paid 15.9.).");
});

test("a label in D.M. is read back: the links at a line's end, a forward date, an edited invoice description", () => {
    const plain = { plainday: withDates({}, "D.M.") };
    const T = loadClass("taskIds.js", vm.createContext(plain)), TL = loadClass("trailingLinks.js", vm.createContext(plain));
    const DueDate = loadClass("setDueDate.js", vm.createContext(plain)), TR = loadClass("timeReport.js", vm.createContext(plain));
    const line = "- [>] Homepage build [[2026-09-30|🚩 30.9.]] [[2026-09-18#^h1b2c3|18.9.]] ^h1b2c3";
    assert.match("[[2026-09-18#^h1b2c3|18.9.]]", T.FORWARD);
    assert.match("[[2026-09-27#^h1b2c3|Wk of 27.9.]]", T.FORWARD);
    assert.match("- [ ] Homepage build [[2026-09-30|🚩 30.9.]]", TL.LINK);
    assert.match("- [ ] Homepage build [[2026-09-30|🚩 30-09]]", TL.LINK);
    assert.equal([...line.matchAll(DueDate.DUE_LINK)].length, 1, "Due date finds the 🚩 it replaces");
    assert.match("[[2026-09-18#^h1b2c3|18.9.]]", TR.FORWARD_LINK);
    // The Raycast timer runs the report's code with no `plainday`: it still drops the forward date from a task's name
    const raycast = new (loadClass("timeReport.js", vm.createContext({ plainday: undefined })))();
    assert.equal(raycast.itemLabel(line), "Homepage build 🚩 30.9.");
    assert.equal(raycast.md("2026-09-18"), "9/18", "and writes M/D, though it writes no dates");
    // Rebuild keeps a description by its line's date, written in any of the joiners
    const Invoice = loadClass("invoice.js", vm.createContext(plain)), Billing = loadClass("billing.js", vm.createContext(plain));
    const table = (label) => `## Billable hours\n\n| Description | Hours | Rate | Amount |\n| --- | --: | --: | --: |\n| ${label} — Edited by hand | 1.00 | $95.00 | $95.00 |\n`;
    for (const label of ["17.9.", "17.9.26", "17-09", "9/17", "9/17/26"]) {
        assert.deepEqual(JSON.parse(JSON.stringify([...new Invoice().descriptions(table(label), new Billing())])), [[`${label} $95.00`, "Edited by hand"]], label);
    }
});

// ---------------------------------------------------------------- Due date and Schedule, under D.M.

const day = (d) => `${PLANNER}/days/${d}.md`;
const KES = "Projects/Kestrel/Kestrel.md";
const NOTES = {
    [KES]: "---\ntags: [project]\n---\n\n## To Do\n\n- [ ] Homepage build ^h1b2c3\n",
    [day("2026-09-16")]: "- [ ] Poster typefaces [[Kestrel|⭕]]\n",
};

test("Due date and Schedule under D.M.: the 🚩, a second Due date replacing it, and the forward date (OBS-309)", async () => {
    const v = standIn({ notes: NOTES });
    v.plainday.Settings.get().dates.format = "D.M.";
    const at = v.lineOf(KES, "Homepage build");
    v.open(KES, at);
    await v.dueDate("2026-09-30");
    assert.equal(v.notes()[KES].split("\n")[at], "- [ ] Homepage build [[2026-09-30|🚩 30.9.]] ^h1b2c3");
    v.open(KES, at);
    await v.dueDate("2026-10-01");
    assert.equal(v.notes()[KES].split("\n")[at], "- [ ] Homepage build [[2026-10-01|🚩 1.10.]] ^h1b2c3", "one 🚩, not two");
    v.open(KES, at);
    v.notices.length = 0;
    await v.schedule("2026-09-18");
    v.open(day("2026-09-18"), 0);
    assert.equal(v.notes()[KES].split("\n")[at], "- [>] Homepage build [[2026-10-01|🚩 1.10.]] [[2026-09-18#^h1b2c3|18.9.]] ^h1b2c3");
    assert.deepEqual(v.notices, ["Forwarded to 18.9."]);
    // A week
    v.open(day("2026-09-16"), 0);
    v.notices.length = 0;
    await v.schedule("2026-09-20", "week");
    assert.deepEqual(v.notices, ["Moved to Wk of 20.9."]);
});
