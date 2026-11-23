// Tests for periodic notes in folders by date (OBS-310): a pattern's folders and name read as one path,
// for finding a note (Schedule.isDailyNote and periodOf, the time report's kinds and period notes) and
// for making one (Schedule.dailyNotePath, PeriodicNotes.where and ensure). moment is the real one, from
// node_modules (the plain-Node stand-in knows only a few formats); the vault, the Daily notes plugin and
// Notebook Navigator are stand-ins with invented notes and settings.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { loadClass } from "../classShape.mjs";

const require = createRequire(import.meta.url);
const moment = require("moment");
moment.locale("en");
// Names that leave out the year read as this year's, so the tests run on a day of their own
const TODAY = new Date(2026, 10, 21, 12).getTime();
moment.now = () => TODAY;

// A stand-in vault holding `paths` (notes) and the folders they need, with Plainday's classes on it. The
// Daily notes plugin has `daily`; Notebook Navigator's calendar makes the notes when `navigator` is given.
function vault({ paths = [], daily = { folder: "", format: "YYYY-MM-DD" }, navigator = null } = {}) {
    const folders = new Map(), files = new Map();
    const folder = (path) => {
        if (folders.has(path)) return folders.get(path);
        const at = path.lastIndexOf("/");
        const f = { path, name: path.slice(at + 1), children: [], parent: path === "/" ? null : folder(at < 0 ? "/" : path.slice(0, at)) };
        folders.set(path, f);
        return f;
    };
    folder("/");
    const add = (path, text = "") => {
        const at = path.lastIndexOf("/");
        const name = path.slice(at + 1);
        const file = { path, name, basename: name.replace(/\.md$/, ""), extension: "md", parent: folder(at < 0 ? "/" : path.slice(0, at)), text };
        files.set(path, file);
        return file;
    };
    for (const p of paths) add(p);
    const made = [];
    const app = {
        internalPlugins: { plugins: { "daily-notes": { instance: { options: daily } } } },
        plugins: { plugins: navigator ? { "notebook-navigator": { settings: navigator } } : {}, getPlugin: () => null },
        vault: {
            getMarkdownFiles: () => [...files.values()],
            getFileByPath: (p) => files.get(p) ?? null,
            getFolderByPath: (p) => (p !== "/" && folders.has(p) ? folders.get(p) : null),
            getAbstractFileByPath: (p) => files.get(p) ?? (folders.has(p) ? folders.get(p) : null),
            async createFolder(p) {
                const at = p.lastIndexOf("/");
                if (folders.has(p)) throw new Error("Folder already exists.");
                if (at > 0 && !folders.has(p.slice(0, at))) throw new Error(`no parent for ${p}`);
                folder(p);
                made.push(p);
            },
            async create(p, text) {
                if (files.has(p)) throw new Error("File already exists.");
                const at = p.lastIndexOf("/");
                if (at > 0 && !folders.has(p.slice(0, at))) throw new Error(`no folder for ${p}`);
                made.push(p);
                return add(p, text);
            },
            read: async (f) => f.text,
            cachedRead: async (f) => f.text,
            process: async (f, fn) => { f.text = fn(f.text); return f.text; },
        },
        workspace: { getLeavesOfType: () => [] },
        metadataCache: { getFileCache: () => null },
        loadLocalStorage: () => null,
        saveLocalStorage: () => {},
    };
    const plainday = {};
    const context = vm.createContext({
        moment, Notice: class {}, MarkdownView: class {}, getAllTags: () => [], getLanguage: () => "en", app, plainday, URL,
        getFrontMatterInfo: (text) => ({ exists: false, frontmatter: "", from: 0, contentStart: 0, text }),
        parseYaml: () => ({}), stringifyYaml: () => "",
    });
    for (const [key, file] of [["Settings", "settings"], ["Schedule", "schedule"], ["Plan", "plan"], ["DatePrompt", "datePrompt"], ["JumpToDate", "jumpToDate"], ["TimeReport", "timeReport"], ["PeriodicNotes", "periodicNotes"]]) {
        plainday[key] = new (loadClass(`${file}.js`, context))();
    }
    return { plainday, app, file: (p) => files.get(p) ?? add(p), made };
}

// Notebook Navigator's own defaults: days and months in a folder per year, weeks in a folder per week-year
// with names that leave out the year, years at the top, and no periodic notes folder
const NAVIGATOR_DEFAULTS = {
    calendarIntegrationMode: "notebook-navigator",
    vaultProfiles: [{ periodicNotesFolder: "" }],
    calendarCustomFilePattern: "YYYY/YYYYMMDD",
    calendarCustomWeekPattern: "gggg/[W]ww",
    calendarCustomMonthPattern: "YYYY/YYYYMM",
    calendarCustomYearPattern: "YYYY",
};

test("the Daily notes plugin's format with folders by date: found only in its own folder, made there", () => {
    const { plainday, file } = vault({
        daily: { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" },
        paths: ["Journal/2026/11/2026-11-20.md", "Journal/2026/11/2026-11-21.md", "Journal/2026-11-22.md", "Journal/2026/12/2026-11-23.md"],
    });
    const { Schedule, Plan } = plainday;
    assert.deepEqual({ ...Schedule.dailyOpts() }, { folder: "Journal", dateFolders: "YYYY/MM", format: "YYYY-MM-DD", template: "" });
    for (const p of ["Journal/2026/11/2026-11-20.md", "Journal/2026/11/2026-11-21.md"]) {
        assert.equal(Schedule.isDailyNote(file(p)), true, p);
        assert.equal(Plan.isDailyNote(file(p)), true, `Plan agrees: ${p}`);
    }
    assert.equal(Schedule.isDailyNote(file("Journal/2026-11-22.md")), false, "straight in the folder, not its date's");
    assert.equal(Schedule.isDailyNote(file("Journal/2026/12/2026-11-23.md")), false, "in another month's folder");
    assert.equal(Schedule.isDailyNote(file("Elsewhere/2026/11/2026-11-21.md")), false, "outside the folder");
    assert.equal(Schedule.dailyNotePath(moment("2026-12-03", "YYYY-MM-DD", true)), "Journal/2026/12/2026-12-03.md");
    assert.equal(Plan.dailyNotePath(moment("2026-11-22", "YYYY-MM-DD", true)), "Journal/2026/11/2026-11-22.md", "beside 11/21, not the flat one");
    assert.equal(plainday.PeriodicNotes.where("day", "2026-12-04").path, "Journal/2026/12/2026-12-04.md");
    // The name alone gives the date, so the commands read it as before
    assert.deepEqual({ ...plainday.PeriodicNotes.periodOfName("2026-11-21") }, { unit: "day", date: "2026-11-21" });
});

test("a [literal] folder in the format joins the fixed folder, and needs no setting", () => {
    const { plainday, file } = vault({ daily: { folder: "", format: "[Journal]/YYYY-MM-DD" } });
    assert.deepEqual({ ...plainday.Schedule.dailyOpts() }, { folder: "Journal", dateFolders: "", format: "YYYY-MM-DD", template: "" });
    assert.equal(plainday.Schedule.isDailyNote(file("Journal/2026-11-21.md")), true);
    assert.equal(plainday.Schedule.isDailyNote(file("2026-11-21.md")), false);
    assert.equal(plainday.Schedule.dailyNotePath(moment("2026-11-21", "YYYY-MM-DD", true)), "Journal/2026-11-21.md");
});

test("a flat setup is found and made as before", () => {
    const { plainday, file } = vault({ daily: { folder: "Reference/Planner/days", format: "YYYY-MM-DD" } });
    assert.deepEqual({ ...plainday.Schedule.dailyOpts() }, { folder: "Reference/Planner/days", dateFolders: "", format: "YYYY-MM-DD", template: "" });
    assert.equal(plainday.Schedule.isDailyNote(file("Reference/Planner/days/2026-11-21.md")), true);
    assert.equal(plainday.Schedule.isDailyNote(file("Reference/Planner/days/2026/2026-11-21.md")), false);
    const top = vault();
    assert.equal(top.plainday.Schedule.isDailyNote(top.file("2026-11-21.md")), true, "no folder: the top of the vault");
    assert.equal(top.plainday.Schedule.dailyNotePath(moment("2026-11-21", "YYYY-MM-DD", true)), "2026-11-21.md");
});

test("Notebook Navigator's defaults, with no periodic notes folder: each kind found and made where its pattern says", () => {
    const { plainday, file } = vault({ navigator: NAVIGATOR_DEFAULTS });
    const { Schedule, PeriodicNotes } = plainday;
    assert.equal(Schedule.isDailyNote(file("2026/20261121.md")), true);
    assert.equal(Schedule.isDailyNote(file("2025/20261121.md")), false, "in another year's folder");
    assert.equal(Schedule.isDailyNote(file("20261121.md")), false, "at the top, outside its year's folder");
    assert.equal(Schedule.periodOf(file("2026/202611.md")), "month");
    assert.equal(Schedule.periodOf(file("2025/202611.md")), null);
    assert.equal(Schedule.periodOf(file("2026.md")), "year");
    assert.equal(Schedule.periodOf(file("2026/W47.md")), "week", "this year's week, as a name without its year reads");
    assert.equal(PeriodicNotes.where("day", "2026-11-21").path, "2026/20261121.md");
    assert.equal(PeriodicNotes.where("month", "2026-11-21").path, "2026/202611.md");
    assert.equal(PeriodicNotes.where("year", "2026-11-21").path, "2026.md");
    assert.equal(PeriodicNotes.where("week", "2026-11-21").path, "2026/W47.md");
    assert.equal(PeriodicNotes.where("month", "2027-01-15").path, "2027/202701.md");
    // A week named with its year, in a folder per year: one that starts in December goes by its first day,
    // made where it's found
    const weeks = vault({ navigator: { ...NAVIGATOR_DEFAULTS, calendarCustomWeekPattern: "YYYY/gggg-[W]ww" } });
    assert.equal(weeks.plainday.PeriodicNotes.where("week", "2027-01-01").path, "2026/2027-W01.md");
    assert.equal(weeks.plainday.Schedule.periodOf(weeks.file("2026/2027-W01.md")), "week");
    assert.equal(weeks.plainday.Schedule.periodOf(weeks.file("2027/2027-W01.md")), null);
    assert.deepEqual({ ...plainday.TimeReport.periodPlaces().month }, { folder: "", dateFolders: "YYYY" });
});

test("Navigator's pattern under its periodic notes folder, with [literal] and dated folders", () => {
    const { plainday, file } = vault({ navigator: { ...NAVIGATOR_DEFAULTS, vaultProfiles: [{ periodicNotesFolder: "Planner" }], calendarCustomFilePattern: "[days]/YYYY/MM/YYYY-MM-DD", calendarCustomMonthPattern: "[months]/YYYY-MM" } });
    assert.equal(plainday.Schedule.isDailyNote(file("Planner/days/2026/11/2026-11-21.md")), true);
    assert.equal(plainday.Schedule.isDailyNote(file("Planner/days/2026-11-21.md")), false);
    assert.equal(plainday.Schedule.periodOf(file("Planner/months/2026-11.md")), "month");
    assert.equal(plainday.PeriodicNotes.where("day", "2026-12-03").path, "Planner/days/2026/12/2026-12-03.md");
    assert.equal(plainday.TimeReport.periodFolders().month, "Planner/months", "the fixed folder, which the settings show");
});

test("ensure makes a note's folders by date, each one it needs", async () => {
    const { plainday, app, made } = vault({ daily: { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" }, paths: ["Journal/2026/11/2026-11-21.md"] });
    const note = await plainday.PeriodicNotes.ensure("day", "2026-12-03");
    assert.equal(note.path, "Journal/2026/12/2026-12-03.md");
    assert.deepEqual(made, ["Journal/2026/12", "Journal/2026/12/2026-12-03.md"], "the year's folder was there already");
    assert.equal(await plainday.PeriodicNotes.ensure("day", "2026-12-03"), note, "made once");
    const nav = vault({ navigator: NAVIGATOR_DEFAULTS });
    const month = await nav.plainday.PeriodicNotes.ensure("month", "2027-02-10");
    assert.equal(month.path, "2027/202702.md");
    assert.deepEqual(nav.made, ["2027", "2027/202702.md"]);
    assert.ok(app.vault.getFileByPath("Journal/2026/12/2026-12-03.md"));
});

test("the time report: notes in folders by date are days, weeks, months and years, and period notes are filed there", async () => {
    const { plainday, file } = vault({
        navigator: NAVIGATOR_DEFAULTS,
        paths: ["2026/20261120.md", "2026/202611.md", "2026.md", "202611.md", "Notes/202611.md"],
    });
    const report = plainday.TimeReport;
    file("2026/20261120.md").text = "- 9:00-10:00 Invented work\n";
    const index = report.appIndex();
    assert.equal(index.kind("2026/20261120.md"), "day");
    assert.equal(index.kind("2026/202611.md"), "month");
    assert.equal(index.kind("2026.md"), "year");
    assert.equal(index.kind("202611.md"), "other", "a month's name outside its year's folder");
    const days = await report.readDailyNotes(plainday.Schedule);
    assert.deepEqual(JSON.parse(JSON.stringify(days.map((d) => [d.date, d.path]))), [["2026-11-20", "2026/20261120.md"]]);
    const places = report.periodPlaces();
    assert.equal(report.periodPath(places, "month", "202611"), "2026/202611.md");
    assert.equal(report.periodPath(places, "year", "2026"), "2026.md");
    assert.equal(report.periodPath(places, "month", "not a month"), null);
    // A link to a period note is its name, unless another note shares it: then its path, folders by date included
    const link = report.periodLinkTarget(places);
    assert.equal(link("month", "202611"), "2026/202611");
    assert.equal(link("year", "2026"), "2026");
});

test("the time report's period notes: one with a report in its year's folder is updated, a missing one made there", async () => {
    const { plainday, file, made } = vault({ navigator: NAVIGATOR_DEFAULTS, paths: ["2026/202610.md", "202609.md"] });
    const report = plainday.TimeReport;
    file("2026/202610.md").text = "## Time Report\n\n%% time:start %%\nold\n%% time:end %%\n";
    file("202609.md").text = "## Time Report\n\n%% time:start %%\nold\n%% time:end %%\n";
    // The report's own parts stand in: entries in November and December, and every block rewritten
    report.periodsWithEntries = () => ({ week: [], month: ["202611", "202612"], year: [] });
    report.render = (model, scope) => `%% time:start %%\n${scope.key}\n%% time:end %%`;
    report.freezeBlock = (block) => block;
    const wrote = [];
    report.writeBlock = async (f) => { wrote.push(f.path); return { wrote: true }; };
    const out = await report.writePeriodNotes({ tables: {} }, "stamp", null, { create: true });
    assert.deepEqual(JSON.parse(JSON.stringify(out.created)), ["202611", "202612"]);
    assert.deepEqual(wrote.sort(), ["2026/202610.md", "2026/202611.md", "2026/202612.md"], "October's in its year's folder counts; the one at the top doesn't");
    assert.deepEqual(made.filter((p) => p.endsWith(".md")), ["2026/202611.md", "2026/202612.md"]);
});
