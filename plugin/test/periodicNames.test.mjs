// Tests for the periodic notes' name check (OBS-299): Settings.namesWholeDate, periodicFormat and
// periodicWarning in plugin/src/shared/settings.js, which Settings → Plainday → Folders → Periodic notes
// shows under a row whose notes' names don't give their whole date on their own; and how navigatorNote
// reads Notebook Navigator's pattern as one path (OBS-310). moment is the real
// one, from node_modules (the plain-Node stand-in knows only a few formats), in four languages; the
// Daily notes plugin and Notebook Navigator are stand-ins with invented settings.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { loadClass } from "../classShape.mjs";

const require = createRequire(import.meta.url);
const moment = require("moment");
for (const l of ["de", "fr", "en-gb", "uk"]) require(`moment/locale/${l}`);
moment.locale("en");
// Reading a name back fills what it leaves out from today, so the tests run on a day of their own
const TODAY = new Date(2026, 10, 20, 12).getTime();
moment.now = () => TODAY;
const LOCALES = ["en", "de", "fr", "en-gb"];
// What a class gives back was made in its own context, whose objects compare as different kinds to
// strict equality: compared as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

// Settings and Schedule in a context of their own, with the two plugins' settings as `daily` and
// `navigator` (null: not installed) and the source as `periodic` (blank: Plainday picks)
function vault({ daily = { format: "YYYY-MM-DD", folder: "Reference/Planner/days" }, navigator = null, periodic = "" } = {}) {
    const app = {
        internalPlugins: { plugins: { "daily-notes": { instance: { options: daily } } } },
        plugins: { plugins: navigator ? { "notebook-navigator": { settings: navigator } } : {} },
    };
    const plainday = {};
    const context = vm.createContext({ moment, Notice: class {}, MarkdownView: class {}, getAllTags: () => [], app, plainday, URL });
    const Settings = loadClass("settings.js", context);
    plainday.Settings = new Settings();
    plainday.Settings.data.folders.periodic = periodic;
    plainday.Schedule = new (loadClass("schedule.js", context))();
    plainday.DatePrompt = new (loadClass("datePrompt.js", context))();
    plainday.TimeReport = new (loadClass("timeReport.js", context))();
    return plainday.Settings;
}
// Notebook Navigator's calendar making the notes, under `Planner`, with these patterns
const NAVIGATOR = (patterns = {}) => ({
    calendarIntegrationMode: "notebook-navigator",
    vaultProfiles: [{ periodicNotesFolder: "Planner" }],
    calendarCustomFilePattern: "[days]/YYYY-MM-DD",
    calendarCustomWeekPattern: "[weeks]/gggg[w]ww",
    calendarCustomMonthPattern: "[months]/YYYY-MM",
    calendarCustomYearPattern: "[years]/YYYY",
    ...patterns,
});

// Names that give the whole date, and names that don't (the plan's lists, checked 11/20)
const WORKS = {
    day: ["YYYY-MM-DD", "DD-MM-YYYY", "M-D-YY", "D MMMM YYYY", "dddd D MMMM YYYY", "YYYY/YYYY-MM-DD", "YYYY/MM/YYYY-MM-DD",
        "[Journal]/YYYY-MM-DD", "[days]/YYYY-MM-DD", "[days]/DD-MM-YYYY", "YYYY/YYYYMMDD"],
    week: ["gggg[w]ww", "[W]ww-gggg", "GGGG-[W]WW", "gggg-[W]ww"],
    month: ["YYYY-MM", "MM-YYYY", "MMMM YYYY", "YYYY/YYYYMM"],
    year: ["YYYY"],
};
const FAILS = {
    day: ["MM-DD", "YYYY/MM-DD", "[days]/YYYY/MM-DD"],
    week: ["[W]ww", "YYYY[w]ww", "YYYY-[W]WW", "gggg/[W]ww"],
    month: ["MM"],
};

test("names that give the whole date pass, in four languages: Navigator's defaults for a day, a month and a year among them", () => {
    const settings = vault();
    for (const locale of LOCALES) {
        for (const [unit, formats] of Object.entries(WORKS)) {
            for (const format of formats) assert.equal(settings.namesWholeDate(unit, format, locale), true, `${unit} ${format} in ${locale}`);
        }
    }
});

test("names that leave part of the date out fail, in four languages: Navigator's default week pattern among them", () => {
    const settings = vault();
    for (const locale of LOCALES) {
        for (const [unit, formats] of Object.entries(FAILS)) {
            for (const format of formats) assert.equal(settings.namesWholeDate(unit, format, locale), false, `${unit} ${format} in ${locale}`);
        }
    }
});

test("which format is checked: the Daily notes plugin's for the days, and nothing else, with Plainday + Daily Notes plugin", () => {
    const settings = vault({ daily: { format: "MM-DD", folder: "Reference/Planner/days/2026" }, navigator: NAVIGATOR({ calendarCustomWeekPattern: "gggg/[W]ww" }), periodic: "daily-notes" });
    assert.deepEqual(plain(settings.periodicFormat("day")), { format: "MM-DD", navigator: false });
    for (const unit of ["week", "month", "year"]) assert.equal(settings.periodicFormat(unit), null, `Plainday names the ${unit}s itself, even with Navigator installed`);
    assert.equal(settings.periodicWarning("week"), "");
});

test("which format is checked with Notebook Navigator: its patterns as typed, folders by date included", () => {
    const settings = vault({ navigator: NAVIGATOR({ calendarCustomFilePattern: "[days]/YYYY/MM-DD", calendarCustomMonthPattern: "" }) });
    assert.equal(settings.periodicSource(), "notebook-navigator", "the demo's source");
    assert.deepEqual(plain(settings.periodicFormat("day")), { format: "[days]/YYYY/MM-DD", navigator: true });
    assert.deepEqual(plain(settings.navigatorNote("day")), { folder: "Planner/days", dateFolders: "YYYY", format: "MM-DD", template: "" }, "read as one path (OBS-310)");
    assert.deepEqual(plain(settings.periodicFormat("week")), { format: "[weeks]/gggg[w]ww", navigator: true });
    assert.equal(settings.periodicFormat("month"), null, "no pattern: Plainday's own name, which works");
    // Navigator installed but not making the notes: the Daily notes plugin's, as Schedule reads them
    const plugin = vault({ navigator: { ...NAVIGATOR(), calendarIntegrationMode: "daily-notes" }, periodic: "notebook-navigator" });
    assert.deepEqual(plain(plugin.periodicFormat("day")), { format: "YYYY-MM-DD", navigator: false });
    assert.equal(plugin.periodicFormat("week"), null);
});

test("the demo's settings warn on no row", () => {
    for (const periodic of ["", "daily-notes"]) {
        const settings = vault({ navigator: NAVIGATOR(), periodic });
        for (const unit of ["day", "week", "month", "year"]) assert.equal(settings.periodicWarning(unit, "en"), "", `${unit}, ${periodic || "as it starts"}`);
    }
});

const NEEDS_DAY = "Plainday reads a note's date from its name alone, so it needs the year, month, and day, such as `YYYY-MM-DD`.";
const NEEDS_WEEK = "Plainday reads a note's date from its name alone, so it needs the week's year and number, such as `gggg[w]ww`.";

test("folders by date and no periodic notes folder are followed: Navigator's own defaults among them (OBS-310)", () => {
    const defaults = vault({ navigator: { ...NAVIGATOR({ calendarCustomFilePattern: "YYYY/YYYYMMDD", calendarCustomWeekPattern: "gggg/[W]ww", calendarCustomMonthPattern: "YYYY/YYYYMM", calendarCustomYearPattern: "YYYY" }), vaultProfiles: [{}] } });
    assert.deepEqual(plain(defaults.navigatorNote("day")), { folder: "", dateFolders: "YYYY", format: "YYYYMMDD", template: "" });
    assert.deepEqual(plain(defaults.navigatorNote("week")), { folder: "", dateFolders: "gggg", format: "[W]ww", template: "" });
    assert.deepEqual(plain(defaults.navigatorNote("month")), { folder: "", dateFolders: "YYYY", format: "YYYYMM", template: "" });
    assert.deepEqual(plain(defaults.navigatorNote("year")), { folder: "", dateFolders: "", format: "YYYY", template: "" });
    assert.equal(vault({ navigator: NAVIGATOR({ calendarCustomWeekPattern: "" }) }).navigatorNote("week"), null, "no pattern: Plainday's own");
});

test("the red line: what Plainday needs when the names don't give the whole date, and nothing for folders by date (OBS-310)", () => {
    // The row shows `MM-DD` and that the Daily notes plugin sets it, so the line says only what's needed
    const daily = vault({ daily: { format: "MM-DD", folder: "Reference/Planner/days/2026" }, periodic: "daily-notes" });
    assert.equal(daily.periodicWarning("day", "en"), NEEDS_DAY);
    assert.equal(vault({ daily: { format: "YYYY/MM/YYYY-MM-DD", folder: "Journal" }, periodic: "daily-notes" }).periodicWarning("day", "en"), "", "the Daily notes plugin's folders by date");
    const followed = vault({ navigator: NAVIGATOR({ calendarCustomFilePattern: "[days]/MM-DD" }) });
    assert.equal(followed.periodicWarning("day", "en"), NEEDS_DAY);
    // Folders by date with a name that leaves out the year: only what the name needs
    const dated = vault({ navigator: NAVIGATOR({ calendarCustomFilePattern: "[days]/YYYY/MM-DD" }) });
    assert.equal(dated.periodicWarning("day", "en"), NEEDS_DAY);

    // Navigator's defaults, with no periodic notes folder: only the week, whose names (`W40`) leave out the year
    const defaults = vault({ navigator: { ...NAVIGATOR({ calendarCustomFilePattern: "YYYY/YYYYMMDD", calendarCustomWeekPattern: "gggg/[W]ww", calendarCustomMonthPattern: "YYYY/YYYYMM", calendarCustomYearPattern: "YYYY" }), vaultProfiles: [{}] } });
    assert.equal(defaults.periodicWarning("day", "en"), "");
    assert.equal(defaults.periodicWarning("week", "en"), NEEDS_WEEK);
    assert.equal(defaults.periodicWarning("month", "en"), "");
    assert.equal(defaults.periodicWarning("year", "en"), "");

    // No pattern isn't a problem: the notes are Plainday's own
    assert.equal(vault({ navigator: NAVIGATOR({ calendarCustomWeekPattern: "" }) }).periodicWarning("week", "en"), "");

    // Names alone
    const slip = vault({ navigator: NAVIGATOR({ calendarCustomWeekPattern: "[weeks]/YYYY[w]ww" }) });
    assert.equal(slip.periodicWarning("week", "en"), NEEDS_WEEK, "the calendar year's week names the week that starts a year by the year before");
    const iso = vault({ navigator: NAVIGATOR({ calendarCustomWeekPattern: "[weeks]/YYYY-[W]WW" }) });
    assert.match(iso.periodicWarning("week", "de"), /such as `GGGG-\[W\]WW`\.$/, "an ISO week pattern is told the ISO one");
    const month = vault({ navigator: NAVIGATOR({ calendarCustomMonthPattern: "[months]/MM" }) });
    assert.equal(month.periodicWarning("month", "en"), "Plainday reads a note's date from its name alone, so it needs the year and month, such as `YYYY-MM`.");
});

test("days are checked in moment's language, weeks, months and years in the week settings'", () => {
    // moment can't read its own Ukrainian month names back strictly, so a name with them can't work
    // there, though it does in English
    const days = vault({ daily: { format: "D MMMM YYYY" }, periodic: "daily-notes" });
    assert.equal(days.periodicWarning("day"), "");
    moment.locale("uk");
    try {
        assert.equal(days.periodicWarning("day"), NEEDS_DAY);
    } finally {
        moment.locale("en");
    }
    // Navigator's calendar locale, through DatePrompt.weekRules: a week named by a day in it
    const weeks = (calendarLocale) => vault({ navigator: NAVIGATOR({ calendarCustomWeekPattern: "[weeks]/[Week of] D MMMM YYYY", calendarLocale }) });
    assert.equal(weeks("en").periodicWarning("week"), "");
    assert.match(weeks("uk").periodicWarning("week"), /so it needs the week's year and number/);
});
