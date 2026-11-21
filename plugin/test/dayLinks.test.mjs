// Tests for the reader of periodic note names (OBS-297): PeriodicNotes.reader in plugin/src/shared/periodicNotes.js,
// which every link on a task line is read with, and the time report's default, TimeReport.plainName, which the
// Raycast timer and the demo's render read with. moment is the real one, from node_modules (the plain-Node
// stand-in knows only a few formats); the Daily notes plugin and Notebook Navigator are stand-ins with invented
// settings.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { loadClass } from "../classShape.mjs";

const require = createRequire(import.meta.url);
const moment = require("moment");
for (const l of ["de", "fr"]) require(`moment/locale/${l}`);
moment.locale("en");
const TODAY = new Date(2026, 10, 20, 12).getTime();
moment.now = () => TODAY;
const plain = (x) => JSON.parse(JSON.stringify(x));

// Plainday's classes in a context of their own, with Notebook Navigator's calendar making the notes by `patterns`
// (null: the Daily notes plugin, with `daily`)
function vault({ patterns = null, daily = { format: "YYYY-MM-DD", folder: "Reference/Planner/days" }, locale = null } = {}) {
    const navigator = patterns && {
        calendarIntegrationMode: "notebook-navigator",
        vaultProfiles: [{ periodicNotesFolder: "Reference/Planner" }],
        calendarCustomFilePattern: "[days]/YYYY-MM-DD", calendarCustomWeekPattern: "[weeks]/gggg[w]ww",
        calendarCustomMonthPattern: "[months]/YYYY-MM", calendarCustomYearPattern: "[years]/YYYY",
        ...(locale ? { calendarLocale: locale } : {}),
        ...patterns,
    };
    const app = {
        internalPlugins: { plugins: { "daily-notes": { instance: { options: daily } } } },
        plugins: { plugins: navigator ? { "notebook-navigator": { settings: navigator } } : {} },
        vault: { getMarkdownFiles: () => [] },
    };
    const plainday = {};
    const context = vm.createContext({ moment, Notice: class {}, MarkdownView: class {}, getAllTags: () => [], getLanguage: () => "en", app, plainday, URL });
    for (const [key, file, cls] of [["Settings", "settings"], ["Schedule", "schedule"], ["DatePrompt", "datePrompt"], ["JumpToDate", "jumpToDate"], ["TimeReport", "timeReport"], ["PeriodicNotes", "periodicNotes"], ["AddTaskNote", "addTaskNote"], ["EventLog", "eventLog"]]) {
        plainday[key] = new (loadClass(`${file}.js`, context))();
    }
    return { plainday, navigator, app };
}

test("the reader reads a name by the vault's formats: DD-MM-YYYY days, [W]ww-gggg weeks and MM-YYYY months", () => {
    const { plainday } = vault({ patterns: { calendarCustomFilePattern: "[days]/DD-MM-YYYY", calendarCustomWeekPattern: "[weeks]/[W]ww-gggg", calendarCustomMonthPattern: "[months]/MM-YYYY" } });
    const read = plainday.PeriodicNotes.reader();
    assert.deepEqual(plain(read("17-09-2026")), { unit: "day", date: "2026-09-17" });
    assert.deepEqual(plain(read("Reference/Planner/days/17-09-2026")), { unit: "day", date: "2026-09-17" }, "a path's last part");
    assert.deepEqual(plain(read("W39-2026")), { unit: "week", date: "2026-09-20" }, "an English week, from its Sunday");
    assert.deepEqual(plain(read("09-2026")), { unit: "month", date: "2026-09-01" });
    assert.deepEqual(plain(read("2026")), { unit: "year", date: "2026-01-01" });
    for (const name of ["2026-09-17", "2026w39", "2026-09", "31-02-2026", "17-9-2026", "Write brochure copy", ""]) assert.equal(read(name), null, name);
    // The same names are read once and kept; the same reader while the settings stay
    assert.equal(read("17-09-2026"), read("17-09-2026"));
    assert.equal(plainday.PeriodicNotes.reader(), read);
});

test("a changed setting gives a new reader, which reads the names afresh", () => {
    const { plainday, navigator } = vault({ patterns: {} });
    const before = plainday.PeriodicNotes.reader();
    assert.deepEqual(plain(before("2026-09-17")), { unit: "day", date: "2026-09-17" });
    navigator.calendarCustomFilePattern = "[days]/DD-MM-YYYY";
    const after = plainday.PeriodicNotes.reader();
    assert.notEqual(after, before);
    assert.equal(after("2026-09-17"), null);
    assert.deepEqual(plain(after("17-09-2026")), { unit: "day", date: "2026-09-17" });
});

test("days are read in Obsidian's language, as they're named; weeks and months in the week settings' language", () => {
    const { plainday } = vault({ patterns: { calendarCustomFilePattern: "[days]/D MMMM YYYY", calendarCustomMonthPattern: "[months]/MMMM YYYY" }, locale: "fr" });
    const read = plainday.PeriodicNotes.reader();
    const path = plainday.Schedule.dailyNotePath(moment("2026-09-17", "YYYY-MM-DD", true));
    assert.equal(path.split("/").pop(), "17 September 2026.md", "named in Obsidian's language");
    assert.deepEqual(plain(read("17 September 2026")), { unit: "day", date: "2026-09-17" });
    assert.equal(read("17 septembre 2026"), null);
    assert.deepEqual(plain(read("septembre 2026")), { unit: "month", date: "2026-09-01" }, "a month in Navigator's language");
});

test("under the Daily notes plugin, the daily notes' own format", () => {
    const { plainday } = vault({ daily: { format: "DD.MM.YYYY", folder: "Journal" } });
    const read = plainday.PeriodicNotes.reader();
    assert.deepEqual(plain(read("17.09.2026")), { unit: "day", date: "2026-09-17" });
    assert.deepEqual(plain(read("2026w39")), { unit: "week", date: "2026-09-20" }, "Plainday's own week names");
});

test("a log's name: the day's name as the daily notes are named, then the title; read back the same way, a day's name with spaces too (OBS-300)", () => {
    for (const [format, name] of [["YYYY-MM-DD", "2026-09-17"], ["DD-MM-YYYY", "17-09-2026"], ["M-D-YY", "9-17-26"], ["D MMMM YYYY", "17 September 2026"]]) {
        const log = vault({ daily: { format, folder: "Reference/Planner/days" } }).plainday.EventLog;
        assert.equal(log.nameFor("2026-09-17", "Sync: Q3 plan"), `${name} Sync - Q3 plan`, format);
        assert.deepEqual(plain(log.dayOf(`${name} Kestrel standup`)), { date: "2026-09-17", title: "Kestrel standup" }, format);
        assert.deepEqual(plain(log.dayOf(`${name} 2026 budget`)), { date: "2026-09-17", title: "2026 budget" }, `${format}: the first day's name`);
        assert.deepEqual(plain(log.dayOf(`${name} X`)), { date: "2026-09-17", title: "X" }, `${format}: a short name`);
        for (const other of [name, `${name} `, "Kestrel standup", ""]) assert.equal(log.dayOf(other), null, `${format}: "${other}"`);
    }
    const dd = vault({ daily: { format: "DD-MM-YYYY", folder: "Reference/Planner/days" } }).plainday.EventLog;
    assert.equal(dd.dayOf("2026-09-17 Kestrel standup"), null, "another vault's spelling");
    // A week's, a month's or a year's name isn't a day's
    const demo = vault().plainday.EventLog;
    for (const other of ["2026w38 Review", "2026-09 Review", "2026 Planning"]) assert.equal(demo.dayOf(other), null, other);
});

test("the time report's default reads the demo's names exactly as the reader does under the demo's settings", () => {
    const { plainday } = vault({ patterns: {} });
    const read = plainday.PeriodicNotes.reader();
    const TimeReport = plainday.TimeReport.constructor;
    const names = [];
    for (let d = Date.UTC(2025, 11, 1); d <= Date.UTC(2028, 0, 31); d += 864e5) {
        const date = new Date(d).toISOString().slice(0, 10);
        names.push(date, plainday.TimeReport.plainWeekKey(date), date.slice(0, 7), date.slice(0, 4));
    }
    names.push("2026-02-29", "2028-02-29", "2026w00", "2026w53", "2027w53", "2026-00", "2026-W39", "17-09-2026");
    for (const name of new Set(names)) assert.deepEqual(plain(TimeReport.plainName(name)), plain(read(name)), name);
});

test("the editor's links on a line in a DD-MM-YYYY vault: a forward date pill, a red passed 🚩", () => {
    const { plainday } = vault({ patterns: { calendarCustomFilePattern: "[days]/DD-MM-YYYY", calendarCustomWeekPattern: "[weeks]/[W]ww-gggg" } });
    const context = vm.createContext({ moment, plainday });
    const TrailingLinks = loadClass("trailingLinks.js", context);
    const read = plainday.PeriodicNotes.reader();
    const kinds = plain(TrailingLinks.trail("- [ ] Draft wireframes [[18-09-2026|🚩 9/18]] [[W39-2026#^h2k8dm|Wk of 9/20]] ^h2k8dm", read).links.map((l) => l.kind));
    assert.deepEqual(kinds, ["due", "forward"]);
    assert.equal(TrailingLinks.overdue("18-09-2026", "2026-11-20", read), true);
    assert.equal(TrailingLinks.overdue("2026-09-30", "2026-11-20", read), false, "an old 🚩 in the old spelling isn't read as a day now");
    // Without one handed in, Plainday's, asked as the rule runs
    assert.deepEqual(plain(TrailingLinks.trail("- [>] Send final copy [[17-09-2026#^p7d2qe|9/17]] ^p7d2qe").links.map((l) => l.kind)), ["forward"]);
});
