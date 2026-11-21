// Tests for the periodic notes' name check (OBS-299): Settings.nameProblem, periodicFormat and
// nameWarning in plugin/src/shared/settings.js, which Settings → Plainday → Folders → Periodic notes
// shows under a row whose notes' names don't give their whole date on their own. moment is the real
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
for (const l of ["de", "fr", "en-gb"]) require(`moment/locale/${l}`);
moment.locale("en");
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
            for (const format of formats) assert.equal(settings.nameProblem(unit, format, locale), null, `${unit} ${format} in ${locale}`);
        }
    }
});

test("names that leave part of the date out fail, in four languages: Navigator's default week pattern among them", () => {
    const settings = vault();
    for (const locale of LOCALES) {
        for (const [unit, formats] of Object.entries(FAILS)) {
            for (const format of formats) assert.notEqual(settings.nameProblem(unit, format, locale), null, `${unit} ${format} in ${locale}`);
        }
    }
});

test("which format is checked: the Daily notes plugin's for the days, and nothing else, with Plainday + Daily Notes plugin", () => {
    const settings = vault({ daily: { format: "MM-DD", folder: "Reference/Planner/days/2026" }, navigator: NAVIGATOR({ calendarCustomWeekPattern: "gggg/[W]ww" }), periodic: "daily-notes" });
    assert.deepEqual(plain(settings.periodicFormat("day")), { format: "MM-DD", navigator: false });
    for (const unit of ["week", "month", "year"]) assert.equal(settings.periodicFormat(unit), null, `Plainday names the ${unit}s itself, even with Navigator installed`);
    assert.equal(settings.nameWarning("week"), "");
});

test("which format is checked with Notebook Navigator: its patterns as typed, even one Plainday can't follow", () => {
    const settings = vault({ navigator: NAVIGATOR({ calendarCustomFilePattern: "[days]/YYYY/MM-DD", calendarCustomMonthPattern: "" }) });
    assert.equal(settings.periodicSource(), "notebook-navigator", "the demo's source");
    assert.deepEqual(plain(settings.periodicFormat("day")), { format: "[days]/YYYY/MM-DD", navigator: true });
    assert.equal(settings.navigatorNote("day"), null, "Plainday can't follow it, so it uses the Daily notes plugin's meanwhile");
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
        for (const unit of ["day", "week", "month", "year"]) assert.equal(settings.nameWarning(unit, "en"), "", `${unit}, ${periodic || "as it starts"}`);
    }
});

test("the warning names the format, where it's set, the name it gives a note and what that leaves out, and what Plainday needs", () => {
    const daily = vault({ daily: { format: "MM-DD", folder: "Reference/Planner/days/2026" }, periodic: "daily-notes" });
    assert.equal(daily.nameWarning("day", "en"), "`MM-DD`, set in Settings → Daily notes, names the note for 9/30/2026 `09-30`, which doesn't give the year. "
        + "For now, Plainday reads a note's date from its name alone, so the name needs the year, month and day, such as `YYYY-MM-DD`.");

    const defaults = vault({ navigator: NAVIGATOR({ calendarCustomFilePattern: "YYYY/YYYYMMDD", calendarCustomWeekPattern: "gggg/[W]ww", calendarCustomMonthPattern: "YYYY/YYYYMM", calendarCustomYearPattern: "YYYY" }) });
    assert.equal(defaults.nameWarning("week", "en"), "Notebook Navigator's week pattern, `gggg/[W]ww`, names the note for the week of 9/30/2026 `W40`, which doesn't give the year. "
        + "For now, Plainday reads a note's date from its name alone, so the name needs the week's year and number, such as `gggg[w]ww`. Change it in Settings → Notebook Navigator → Calendar.");
    for (const unit of ["day", "month", "year"]) assert.equal(defaults.nameWarning(unit, "en"), "", `Navigator's default ${unit} pattern gives the whole date in its name`);

    const day = vault({ navigator: NAVIGATOR({ calendarCustomFilePattern: "[days]/YYYY/MM-DD" }) });
    assert.match(day.nameWarning("day", "en"), /^Notebook Navigator's day pattern, `\[days\]\/YYYY\/MM-DD`, names the note for 9\/30\/2026 `09-30`, which doesn't give the year\. .* Change it in Settings → Notebook Navigator → Calendar\.$/);

    // A week named by the calendar year names the week that starts a year by the year before
    const slip = vault({ navigator: NAVIGATOR({ calendarCustomWeekPattern: "[weeks]/YYYY[w]ww" }) });
    assert.match(slip.nameWarning("week", "en"), /^Notebook Navigator's week pattern, `\[weeks\]\/YYYY\[w\]ww`, names the note for the week of 12\/28\/2026 `2026w01`, which Plainday reads as the week of 12\/28\/2025\. .*such as `gggg\[w\]ww`\./);
    // An ISO week pattern is told the ISO one
    const iso = vault({ navigator: NAVIGATOR({ calendarCustomWeekPattern: "[weeks]/YYYY-[W]WW" }) });
    assert.match(iso.nameWarning("week", "de"), /`2027-W53`, which Plainday can't read as a week\. .*such as `GGGG-\[W\]WW`\./);

    const month = vault({ navigator: NAVIGATOR({ calendarCustomMonthPattern: "[months]/MM" }) });
    assert.match(month.nameWarning("month", "en"), /names the note for September 2026 `09`, which doesn't give the year\. .*the year and month, such as `YYYY-MM`\./);
    const days = vault({ daily: { format: "DD" }, periodic: "daily-notes" });
    assert.match(days.nameWarning("day", "en"), /`30`, which doesn't give the year or the month\./);
});

test("days are checked in moment's language, weeks, months and years in the week settings'", () => {
    const days = vault({ daily: { format: "dddd D MMMM" }, periodic: "daily-notes" });
    moment.locale("de");
    try {
        assert.match(days.nameWarning("day"), /^`dddd D MMMM`, set in Settings → Daily notes, names the note for 9\/30\/2026 `Mittwoch 30 September`, which doesn't give the year\./);
    } finally {
        moment.locale("en");
    }
    // Navigator's calendar locale, French here, through DatePrompt.weekRules
    const months = vault({ navigator: NAVIGATOR({ calendarCustomMonthPattern: "[months]/MMMM", calendarLocale: "fr" }) });
    assert.match(months.nameWarning("month"), /names the note for September 2026 `septembre`, which doesn't give the year\./);
});
