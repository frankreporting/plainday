// Tests for CustomJS/schedule.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = (name) => fs.readFileSync(new URL(`../CustomJS/${name}.js`, import.meta.url), "utf8");
const code = src("schedule");
const Schedule = vm.runInContext(code + "\n;Schedule", vm.createContext({}));
const file = (path) => ({ basename: path.split("/").pop().replace(/\.md$/, ""), parent: { path: path.slice(0, path.lastIndexOf("/")) } });

const PLANNER = "30 Reference/36 Planner";
const NN = {
    vaultProfiles: [{ periodicNotesFolder: PLANNER }],
    calendarCustomWeekPattern: "[weeks]/gggg[w]ww",
    calendarCustomMonthPattern: "[months]/YYYY-MM",
    calendarCustomYearPattern: "[years]/YYYY",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekKey = (date) => new (vm.runInContext(src("timeReport") + "\n;TimeReport", vm.createContext({})))().weekKey(date);

// Dates as "YYYY-MM-DD", moved by days, and their weekday (0 is Sunday)
const utc = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const plus = (date, n) => new Date(utc(date).getTime() + n * 864e5).toISOString().slice(0, 10);
const dow = (date) => utc(date).getUTCDay();
// ISO weeks, as moment's GGGG-[W]WW names them: a date's week, and the Monday a name stands for
const isoName = (date) => {
    const thursday = plus(date, 3 - ((dow(date) + 6) % 7));
    const week = Math.floor((utc(thursday) - utc(`${thursday.slice(0, 4)}-01-01`)) / 864e5 / 7) + 1;
    return `${thursday.slice(0, 4)}-W${String(week).padStart(2, "0")}`;
};
const isoMonday = (name) => { const jan4 = `${name.slice(0, 4)}-01-04`; return plus(jan4, -((dow(jan4) + 6) % 7) + (Number(name.slice(6)) - 1) * 7); };
// English weeks, as gggg[w]ww names them: the Sunday a name stands for
const enSunday = (name) => { const jan1 = `${name.slice(0, 4)}-01-01`; return plus(jan1, -dow(jan1) + (Number(name.slice(5)) - 1) * 7); };

// Enough of moment for these scripts, on `today`, in English (weeks start on Sunday), checked against
// Obsidian's own: a note's name parses strictly to its period's first day (an ISO week's Monday), a
// date formats as any of the names, and startOf("week") goes back to Sunday, as it does in English
const NAMES = { "YYYY-MM-DD": /^\d{4}-\d{2}-\d{2}$/, "gggg[w]ww": /^\d{4}w\d{2}$/, "GGGG-[W]WW": /^\d{4}-W\d{2}$/, "YYYY-MM": /^\d{4}-(?:0[1-9]|1[0-2])$/, YYYY: /^\d{4}$/ };
const momentOn = (today) => {
    const make = (date, valid = true) => ({
        isValid: () => valid,
        locale: () => make(date, valid),
        clone: () => make(date, valid),
        startOf: (unit) => make({ week: plus(date, -dow(date)), isoWeek: plus(date, -((dow(date) + 6) % 7)), month: `${date.slice(0, 7)}-01`, year: `${date.slice(0, 4)}-01-01` }[unit] ?? date, valid),
        year: () => Number(date.slice(0, 4)),
        format: (f) => ({ "YYYY-MM-DD": date, "gggg[w]ww": weekKey(date), "GGGG-[W]WW": isoName(date), "YYYY-MM": date.slice(0, 7), YYYY: date.slice(0, 4), "M/D": `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` })[f] ?? assert.fail(`format ${f}`),
    });
    const moment = (text, format) => {
        if (text === undefined) return make(today);
        if (!NAMES[format]?.test(text)) return make(null, false);
        return make({ "gggg[w]ww": () => enSunday(text), "GGGG-[W]WW": () => isoMonday(text), "YYYY-MM": () => `${text}-01`, YYYY: () => `${text}-01-01` }[format]?.() ?? text);
    };
    moment.locale = () => "en";
    moment.locales = () => ["en"];
    moment.localeData = () => ({ firstDayOfWeek: () => 0, months: () => MONTHS, monthsShort: () => SHORT });
    return moment;
};

// Schedule on a stand-in vault and editor, beside the scripts it leans on, all real: DatePrompt for
// the week rules, JumpToDate for a period's note, TimeReport for the periodic folders, AddTaskNote
// for links. `notes` maps paths to their text (a note's tags come from a `tags: [..]` line); `open` is
// the note in the editor, with the cursor on line `at`. The date box hands on `pick(datePrompt)`.
// Returns the editor's text, the notes after, the notices, and the options the date box was opened with.
const scheduleIn = async ({ notes = {}, open, at = 0, pick, today = "2026-09-16", nn = NN, failCreate = false }) => {
    const vault = new Map(Object.entries(notes));
    const folders = new Map();
    const folder = (path) => {
        if (!path) return { path: "/", name: "", parent: null };
        if (!folders.has(path)) folders.set(path, { path, name: path.split("/").pop(), parent: folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") });
        return folders.get(path);
    };
    const files = new Map();
    const fileOf = (path) => {
        if (!vault.has(path)) return null;
        if (!files.has(path)) files.set(path, { path, name: path.split("/").pop(), basename: path.split("/").pop().replace(/\.md$/, ""), extension: "md", parent: folder(path.slice(0, path.lastIndexOf("/"))) });
        return files.get(path);
    };
    const tagsOf = (path) => (vault.get(path)?.match(/^tags: \[(.*)\]$/m)?.[1] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const notices = [];
    const lines = (vault.get(open) ?? "").split("\n");
    const offset = (p) => lines.slice(0, p.line).reduce((sum, l) => sum + l.length + 1, 0) + p.ch;
    const editor = {
        getCursor: () => ({ line: at, ch: 0 }),
        setCursor() {},
        getLine: (n) => lines[n],
        lineCount: () => lines.length,
        replaceRange(text, from, to = from) {
            const all = lines.join("\n");
            lines.splice(0, lines.length, ...(all.slice(0, offset(from)) + text + all.slice(offset(to))).split("\n"));
        },
    };
    const view = { editor, file: fileOf(open), currentMode: { getFoldInfo: () => null } };
    const app = {
        internalPlugins: { plugins: { "daily-notes": { instance: { options: { folder: `${PLANNER}/days`, format: "YYYY-MM-DD" } } } } },
        plugins: { plugins: nn ? { "notebook-navigator": { settings: nn } } : {}, getPlugin: () => null },
        workspace: { getActiveViewOfType: () => view, getActiveFile: () => view.file, getLeavesOfType: () => [] },
        foldManager: { load: () => null, save: async () => {} },
        metadataCache: {
            getFileCache: (f) => ({ frontmatter: { tags: tagsOf(f.path) } }),
            getFirstLinkpathDest: (name) => [...vault.keys()].map(fileOf).find((f) => f.basename.toLowerCase() === name.toLowerCase()) ?? null,
        },
        vault: {
            getMarkdownFiles: () => [...vault.keys()].map(fileOf),
            getFileByPath: fileOf,
            getFolderByPath: () => ({}),
            createFolder: async () => {},
            create: async (path, text) => {
                if (failCreate) throw new Error(`can't create ${path}`);
                vault.set(path, text);
                return fileOf(path);
            },
            read: async (f) => vault.get(f.path),
            cachedRead: async (f) => vault.get(f.path),
            process: async (f, fn) => { vault.set(f.path, fn(vault.get(f.path))); return vault.get(f.path); },
        },
    };
    const customJS = { obsidian: { MarkdownView: class {}, getAllTags: (cache) => cache.frontmatter.tags.map((t) => `#${t}`), getLanguage: () => "en" } };
    const context = vm.createContext({ app, customJS, window: { moment: momentOn(today) }, Notice: class { constructor(m) { notices.push(m); } }, setTimeout: () => 0, console: { ...console, error: () => {} } });
    const make = (name, cls) => new (vm.runInContext(`${src(name)}\n;${cls}`, context))();
    Object.assign(customJS, {
        DatePrompt: make("datePrompt", "DatePrompt"), JumpToDate: make("jumpToDate", "JumpToDate"), TimeReport: make("timeReport", "TimeReport"),
        AddTaskNote: make("addTaskNote", "AddTaskNote"), Schedule: make("schedule", "Schedule"),
    });
    let prompt = null;
    customJS.DatePrompt.open = (title, onPick, opts) => { prompt = { onPick, opts }; return {}; };
    await customJS.Schedule.invoke();
    if (prompt && pick) await prompt.onPick(pick(customJS.DatePrompt), { close() {} });
    return { editor: lines.join("\n"), notes: Object.fromEntries(vault), notices, opts: prompt?.opts, schedule: customJS.Schedule, dp: customJS.DatePrompt };
};

test("periodic notes: a weekly, monthly or yearly note is named by its pattern, in its folder (OBS-9, OBS-96)", async () => {
    const { schedule: s } = await scheduleIn({});
    assert.equal(s.periodOf(file(`${PLANNER}/weeks/2026w38.md`)), "week");
    assert.equal(s.periodOf(file(`${PLANNER}/months/2026-09.md`)), "month");
    assert.equal(s.periodOf(file(`${PLANNER}/years/2026.md`)), "year");
    assert.equal(s.periodOf(file(`${PLANNER}/days/2026-09-16.md`)), null, "a daily note isn't one");
    assert.equal(s.periodOf(file("30 Reference/37 Journal/2025-03.md")), null, "Journal notes aren't monthly notes");
    assert.equal(s.periodOf(file(`${PLANNER}/2026-09.md`)), null);
    assert.equal(s.periodOf(file(`${PLANNER}/months/2026-09-07.md`)), null);
    assert.equal(s.periodOf(file(`${PLANNER}/months/2026-13.md`)), null);
    assert.equal(s.periodOf(file(`${PLANNER}/weeks/2026-09.md`)), null, "a month's name in the weeks folder");
    assert.equal(s.periodOf(file("Projects/Kestrel/Kestrel.md")), null);
});

test("periodic notes: the folders follow Notebook Navigator's patterns, or sit beside the daily notes", async () => {
    const moved = await scheduleIn({ nn: { ...NN, calendarCustomMonthPattern: "[periodic/months]/YYYY-MM" } });
    assert.equal(moved.schedule.periodOf(file(`${PLANNER}/periodic/months/2026-09.md`)), "month");
    assert.equal(moved.schedule.periodOf(file(`${PLANNER}/months/2026-09.md`)), null);
    const bare = await scheduleIn({ nn: null });
    assert.equal(bare.schedule.periodOf(file(`${PLANNER}/weeks/2026w38.md`)), "week");
    assert.equal(bare.schedule.periodOf(file(`${PLANNER}/months/2026-09.md`)), "month");
    assert.equal(bare.schedule.periodOf(file(`${PLANNER}/years/2026.md`)), "year");
});

test("periodLabel: the link text for a week, a month or a year, as short as a day's M/D (OBS-96)", () => {
    const en = { weekStart: 0, months: MONTHS, short: SHORT };
    assert.equal(Schedule.periodLabel({ date: "2026-10-07", unit: "week" }, en), "Wk of 10/4");
    assert.equal(Schedule.periodLabel({ date: "2026-10-04", unit: "week" }, en), "Wk of 10/4", "the week's own first day");
    assert.equal(Schedule.periodLabel({ date: "2026-10-07", unit: "week" }, { ...en, weekStart: 1 }), "Wk of 10/5", "weeks starting Monday");
    assert.equal(Schedule.periodLabel({ date: "2027-01-01", unit: "week" }, en), "Wk of 12/27", "a week that starts the year before");
    assert.equal(Schedule.periodLabel({ date: "2026-10-01", unit: "month" }, en), "Oct. 2026");
    assert.equal(Schedule.periodLabel({ date: "2026-09-01", unit: "month" }, en), "Sep. 2026");
    assert.equal(Schedule.periodLabel({ date: "2026-05-01", unit: "month" }, en), "May 2026", "no period when the short name is the whole name");
    const fr = { weekStart: 1, months: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"], short: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] };
    assert.equal(Schedule.periodLabel({ date: "2026-10-01", unit: "month" }, fr), "oct. 2026", "a short name with its own period");
    assert.equal(Schedule.periodLabel({ date: "2026-03-01", unit: "month" }, fr), "mars 2026");
    assert.equal(Schedule.periodLabel({ date: "2027-01-01", unit: "year" }, en), "2027");
});

test("placeInPeriod: a task goes to the end of the first checklist, never into the time report (OBS-96)", () => {
    const place = (lines, add = ["- [ ] Call the printer"]) => {
        const r = Schedule.placeInPeriod(lines.join("\n"), add);
        return { lines: r.content.split("\n"), at: r.at, count: r.count, item: r.item };
    };
    const REPORT = ["## Time Report", "", "%% time:start %%", "*Updated 2026-09-16 9:00pm*", "%% time:end %%", ""];

    // A checklist above the report: its end, as in a daily note
    const week = place(["---", "aliases: Week of 9/13/26", "---", "## This week", "- [x] Brochure proofs", "- [ ] Product list", "\t- the fall colors", "", ...REPORT]);
    assert.deepEqual(week.lines.slice(3, 9), ["## This week", "- [x] Brochure proofs", "- [ ] Product list", "\t- the fall colors", "- [ ] Call the printer", ""]);
    assert.deepEqual([week.at, week.count, week.item], [7, 1, 7]);

    // No checklist: a new one just above the report, after the frontmatter with no blank line
    const month = place(["---", "aliases: September 2026", "---", "", ...REPORT]);
    assert.deepEqual(month.lines.slice(0, 6), ["---", "aliases: September 2026", "---", "- [ ] Call the printer", "", "## Time Report"]);
    assert.deepEqual([month.at, month.count, month.item], [3, 1, 3]);
    const tight = place(["---", "aliases: September 2026", "---", ...REPORT]);
    assert.deepEqual(tight.lines.slice(0, 6), ["---", "aliases: September 2026", "---", "- [ ] Call the printer", "", "## Time Report"], "a blank line before the report");
    assert.deepEqual([tight.at, tight.count, tight.item], [3, 2, 3]);

    // After other content, blank lines set it off, so it doesn't run into a list above it
    const year = place(["## Goals", "- Two new clients", "", ...REPORT]);
    assert.deepEqual(year.lines.slice(0, 6), ["## Goals", "- Two new clients", "", "- [ ] Call the printer", "", "## Time Report"]);
    assert.deepEqual([year.at, year.count, year.item], [2, 2, 3]);
    assert.deepEqual(place(["## Goals", "- Two new clients", ...REPORT]).lines.slice(0, 6), ["## Goals", "- Two new clients", "", "- [ ] Call the printer", "", "## Time Report"]);

    // No report: at the end, ending the note with a newline
    assert.deepEqual(place(["## Goals", "- Two new clients", ""]).lines, ["## Goals", "- Two new clients", "", "- [ ] Call the printer", ""]);
    assert.deepEqual(place(["## Goals"]).lines, ["## Goals", "", "- [ ] Call the printer", ""]);
    assert.deepEqual(place(["---", "aliases: Week of 10/4/26", "---", ""]).lines, ["---", "aliases: Week of 10/4/26", "---", "- [ ] Call the printer", ""], "a note fresh from its template");
    const empty = place([""], ["- [ ] Call the printer", "\t- ask about card stock"]);
    assert.deepEqual(empty.lines, ["- [ ] Call the printer", "\t- ask about card stock", ""]);
    assert.deepEqual([empty.at, empty.count, empty.item], [0, 2, 0]);

    // A checklist inside the report's markers isn't one; one below the report is
    assert.deepEqual(place(["## Time Report", "", "%% time:start %%", "- [ ] not a task", "%% time:end %%", ""]).lines,
        ["- [ ] Call the printer", "", "## Time Report", "", "%% time:start %%", "- [ ] not a task", "%% time:end %%", ""]);
    assert.deepEqual(place([...REPORT.slice(0, -1), "", "- [ ] Later", ""]).lines.slice(-3), ["- [ ] Later", "- [ ] Call the printer", ""]);
    // The markers without their heading still mark the report
    assert.deepEqual(place(["Notes", "", "%% time:start %%", "%% time:end %%"]).lines, ["Notes", "", "- [ ] Call the printer", "", "%% time:start %%", "%% time:end %%"]);
    // A report still under its heading from before OBS-133, or in another case, is the report too, heading and all
    for (const heading of ["## Time tracking", "## Time Tracking", "## Time report"]) {
        assert.deepEqual(place(["---", "aliases: September 2026", "---", heading, "", "%% time:start %%", "%% time:end %%"]).lines.slice(3, 6),
            ["- [ ] Call the printer", "", heading], heading);
    }
});

const DAY = `${PLANNER}/days/2026-09-16.md`;
const DAY_TEXT = [
    "---", "aliases: 9/16/26 Wednesday", "---",
    "- [<] 10:00am\tStandup",
    "- [ ] Order fabric swatches", "\t- ask for the linen",
    "- [/] Draft the brochure [[Brochure|⭕]] [[Draft the brochure|🗒️]]", "\t- 9:00am - 10:00am",
    "- [ ] Water the plants",
    "", "## Notes", "",
].join("\n");
const WEEK = `${PLANNER}/weeks/2026w39.md`;
const WEEK_TEXT = [
    "---", "aliases: Week of 9/20/26", "---",
    "## This week",
    "- [ ] Pick the paper stock", "\t- 2:00pm - 3:00pm",
    "", "## Time Report", "", "%% time:start %%", "*Updated 2026-09-16 9:00pm*", "%% time:end %%", "",
].join("\n");
const PROJECT = "Projects/Kestrel/Kestrel.md";
const PROJECT_TEXT = ["---", "tags: [project]", "---", "- [ ] Plan the spring sale", "- [ ] Book the photographer", ""].join("\n");

test("Schedule: the date box reads weeks, months and years, a month or week without a year the next one (OBS-96)", async () => {
    const { opts, dp } = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4 });
    assert.equal(opts.periods, true);
    assert.ok(!opts.nearest, "a day without a year is the next one, as before");
    assert.deepEqual({ ...opts.name("2026-10") }, { date: "2026-10-01", unit: "month" }, "a monthly note's own name");
    assert.deepEqual({ ...opts.name("2027") }, { date: "2027-01-01", unit: "year" });
    assert.deepEqual({ ...opts.name("jan") }, { date: "2027-01-01", unit: "month" }, "January is past, so next year's");
    assert.deepEqual({ ...opts.name("aug") }, { date: "2027-08-01", unit: "month" });
    assert.deepEqual({ ...opts.name("sep") }, { date: "2026-09-01", unit: "month" }, "this month is still this month");
    assert.deepEqual({ ...opts.name("aug 2026") }, { date: "2026-08-01", unit: "month" }, "a year typed is taken as typed");
    assert.equal(opts.name("friday"), null);
    assert.equal(opts.label(dp.result("2026-10-07", "week")), "2026w41", "a week's note name after the preview");
    assert.equal(opts.label(dp.result("2026-10-01", "month")), null);
});

test("Schedule: an untouched task moves into next month's note, which is made for it (OBS-96)", async () => {
    const r = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4, pick: (dp) => dp.result("2026-10-01", "month") });
    assert.equal(r.editor, DAY_TEXT.replace("- [ ] Order fabric swatches\n\t- ask for the linen\n", ""));
    assert.equal(r.notes[`${PLANNER}/months/2026-10.md`], "- [ ] Order fabric swatches\n\t- ask for the linen\n");
    assert.deepEqual(r.notices, ["Moved to Oct. 2026"]);
});

test("Schedule: a worked-on task is forwarded to a week, its time entries staying where they were logged (OBS-96)", async () => {
    const r = await scheduleIn({ notes: { [DAY]: DAY_TEXT, [WEEK]: WEEK_TEXT }, open: DAY, at: 6, pick: (dp) => dp.result("2026-09-23", "week") });
    assert.equal(r.editor, DAY_TEXT.replace("- [/] Draft the brochure", "- [>] Draft the brochure"));
    assert.equal(r.notes[WEEK], WEEK_TEXT.replace("\t- 2:00pm - 3:00pm\n", "\t- 2:00pm - 3:00pm\n- [/] Draft the brochure [[Brochure|⭕]] [[Draft the brochure|🗒️]]\n"));
    assert.deepEqual(r.notices, ["Forwarded to Wk of 9/20"]);
});

test("Schedule: from a project note, the forward mark links the month or year, by path when its name is taken (OBS-96)", async () => {
    const month = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT, "30 Reference/37 Journal/2026-10.md": "" }, open: PROJECT, at: 3, pick: (dp) => dp.result("2026-10-01", "month") });
    assert.equal(month.editor.split("\n")[3], `- [>] [[${PLANNER}/months/2026-10|Oct. 2026]] Plan the spring sale`);
    assert.equal(month.notes[`${PLANNER}/months/2026-10.md`], "- [ ] Plan the spring sale [[Kestrel|⭕]]\n");
    assert.deepEqual(month.notices, ["Forwarded to Oct. 2026"]);

    const year = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT }, open: PROJECT, at: 4, pick: (dp) => dp.result("2027-01-01", "year") });
    assert.equal(year.editor.split("\n")[4], "- [>] [[2027]] Book the photographer");
    assert.equal(year.notes[`${PLANNER}/years/2027.md`], "- [ ] Book the photographer [[Kestrel|⭕]]\n");

    const week = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT, [WEEK]: WEEK_TEXT }, open: PROJECT, at: 3, pick: (dp) => dp.result("2026-09-20", "week") });
    assert.equal(week.editor.split("\n")[3], "- [>] [[2026w39|Wk of 9/20]] Plan the spring sale");
});

test("Schedule: a task in a weekly note moves with its sub-bullets, like one in a monthly note (OBS-96)", async () => {
    const DAY2 = `${PLANNER}/days/2026-09-22.md`;
    const r = await scheduleIn({ notes: { [WEEK]: WEEK_TEXT, [DAY2]: "---\naliases: 9/22/26 Tuesday\n---\n- [ ] Call the printer\n" }, open: WEEK, at: 4, pick: (dp) => dp.result("2026-09-22", "day") });
    assert.equal(r.editor, WEEK_TEXT.replace("- [ ] Pick the paper stock\n\t- 2:00pm - 3:00pm\n", ""));
    assert.equal(r.notes[DAY2], "---\naliases: 9/22/26 Tuesday\n---\n- [ ] Call the printer\n- [ ] Pick the paper stock\n\t- 2:00pm - 3:00pm\n");
    assert.deepEqual(r.notices, ["Moved to 9/22"]);
});

test("Schedule: a task scheduled into the note it's in stays put (OBS-96)", async () => {
    const day = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4, pick: (dp) => dp.result("2026-09-16", "day") });
    assert.equal(day.editor, DAY_TEXT);
    assert.equal(day.notes[DAY], DAY_TEXT);
    assert.deepEqual(day.notices, ["Already in this note"]);
    const week = await scheduleIn({ notes: { [WEEK]: WEEK_TEXT }, open: WEEK, at: 4, pick: (dp) => dp.result("2026-09-24", "week") });
    assert.equal(week.editor, WEEK_TEXT);
    assert.deepEqual(week.notices, ["Already in this note"]);
});

test("Schedule reads 🗒️, 🗒 and 🔗 as a task's note link, and writes 🗒️ (OBS-87)", () => {
    const Schedule = vm.runInContext(code + "\n;Schedule", vm.createContext({}));
    for (const mark of ["🗒️", "🗒", "🔗", "🔗️"]) assert.ok(Schedule.NOTE_LINK.test(`Draft the brief [[Draft the brief|${mark}]]`), mark);
    assert.ok(!Schedule.NOTE_LINK.test("Draft the brief [[Studio|⭕]]"));
    assert.equal(Schedule.NOTE_MARK, "🗒️");
    // The two links it writes (a worked-on task's note, found or made through AddTaskNote, and a line
    // sent from another note) both use the mark, and none is written with 🔗
    assert.equal((code.match(/Schedule\.NOTE_MARK/g) ?? []).length, 2);
    assert.doesNotMatch(code, /\|🔗\]\]`/);
});

// Schedule beside AddTaskNote, on a stand-in vault of notes at `paths` ([path, tags]), whose folders
// know their parents
const withVault = (paths) => {
    const folders = new Map();
    const folder = (path) => {
        if (!path) return { path: "/", name: "", parent: null };
        if (!folders.has(path)) folders.set(path, { path, name: path.split("/").pop(), parent: folder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "") });
        return folders.get(path);
    };
    const files = paths.map(([path, tags, more = {}]) => ({ path, name: path.split("/").pop(), basename: path.split("/").pop().replace(/\.md$/, ""), extension: "md", parent: folder(path.slice(0, path.lastIndexOf("/"))), cache: { frontmatter: { tags, ...more } } }));
    const app = {
        vault: { getMarkdownFiles: () => files, getFileByPath: (p) => files.find((f) => f.path === p) ?? null },
        metadataCache: {
            getFileCache: (f) => f.cache ?? null,
            getFirstLinkpathDest: (name) => files.find((f) => f.basename.toLowerCase() === name.toLowerCase()) ?? null,
        },
    };
    const context = vm.createContext({ app, customJS: { obsidian: { getAllTags: (cache) => cache.frontmatter.tags.map((t) => `#${t}`) } } });
    const AddTaskNote = vm.runInContext(fs.readFileSync(new URL("../CustomJS/addTaskNote.js", import.meta.url), "utf8") + "\n;AddTaskNote", context);
    context.customJS.AddTaskNote = new AddTaskNote();
    return { schedule: new (vm.runInContext(code + "\n;Schedule", context))(), file: (p) => files.find((f) => f.path === p) };
};
const DEMO = [
    ["Projects/Freelance/Freelance.md", ["area"]],
    ["Projects/Freelance/Kestrel/Kestrel.md", ["project"]],
    ["Projects/Freelance/Kestrel/Draft wireframes.md", ["task"]],
    ["Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md", ["log"]],
    ["Projects/Household/Household.md", ["area"]],
    ["Projects/Household/Fix the gate.md", ["task"]],
    ["Projects/Freelance/Old Job/Old Job.md", ["project"], { completed: true }],
    ["Projects/Freelance/Old Job/Old sub.md", ["task"]],
    ["10 Inbox/Loose idea.md", []],
];

test("sentLine: a line sent from a project or area links it before any note link; from a note, that note's project, then the note (OBS-90)", () => {
    const { schedule, file } = withVault(DEMO);
    const project = file("Projects/Freelance/Kestrel/Kestrel.md");
    assert.equal(schedule.sentLine("- [ ] Sign-off call", project), "- [ ] Sign-off call [[Kestrel|⭕]]", "no trailing space");
    assert.equal(schedule.sentLine("- [ ] Shot list [[Shot list|🗒️]]", project), "- [ ] Shot list [[Kestrel|⭕]] [[Shot list|🗒️]]", "before the line's own note");
    assert.equal(schedule.sentLine("- [ ] Mow", file("Projects/Household/Household.md")), "- [ ] Mow [[Household|🗃️]]");
    assert.equal(schedule.sentLine("- [ ] Sign-off call [[Household|🗃️]]", project), "- [ ] Sign-off call [[Household|🗃️]]", "a line with its own ⭕ or 🗃️ keeps it");
    // From a task note or a log: its project, then the link back to it
    assert.equal(schedule.sentLine("- [/] Mobile layout ", file("Projects/Freelance/Kestrel/Draft wireframes.md")),
        "- [/] Mobile layout [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    assert.equal(schedule.sentLine("- [ ] Send the notes", file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md")),
        "- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Homepage review|🗒️]]");
    assert.equal(schedule.sentLine("- [ ] Send the notes [[Household|🗃️]]", file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md")),
        "- [ ] Send the notes [[Household|🗃️]] [[2026-09-14 Homepage review|🗒️]]", "its own ⭕ or 🗃️ instead");
    assert.equal(schedule.sentLine("- [ ] Think it over", file("10 Inbox/Loose idea.md")), "- [ ] Think it over [[Loose idea|🗒️]]", "a note in no project");
    // A sub-task with a note of its own keeps it as its note, named with its own project, and gets no second note link
    assert.equal(schedule.sentLine("- [ ] Fix the gate [[Fix the gate|🗒️]]", file("Projects/Freelance/Kestrel/Draft wireframes.md")),
        "- [ ] Fix the gate [[Household|🗃️]] [[Fix the gate|🗒️]]");
    assert.equal(schedule.sentLine("- [ ] Fix the gate [[Fix the gate|🗒️]]", project), "- [ ] Fix the gate [[Household|🗃️]] [[Fix the gate|🗒️]]", "from a project note too");
    assert.equal(schedule.sentLine("- [ ] New idea [[Not made yet|🗒️]]", project), "- [ ] New idea [[Kestrel|⭕]] [[Not made yet|🗒️]]", "a note that doesn't exist yet: the source's project");
    // A note in a finished project names none: its time counts there, not in the source's project
    assert.equal(schedule.sentLine("- [ ] Old sub [[Old sub|🗒️]]", project), "- [ ] Old sub [[Old sub|🗒️]]");
    // A ⭕ in the text is the title's, not the line's: the line still gets its own
    assert.equal(schedule.sentLine("- [ ] Talk to [[Household|🗃️]] about it", file("Projects/Freelance/Kestrel/Draft wireframes.md")),
        "- [ ] Talk to [[Household|🗃️]] about it [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    // A block ID stays last
    assert.equal(schedule.sentLine("- [ ] Send the notes ^a1b2", file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md")),
        "- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Homepage review|🗒️]] ^a1b2");
});

test("withNote: a worked-on task's lines keep their ⭕ as the note's project, name without dates, the 🗒️ last (OBS-90)", () => {
    const { schedule } = withVault(DEMO);
    const found = { name: "Draft wireframes", linktext: "Draft wireframes", homeLink: "[[Kestrel|⭕]]", projectLinks: ["[[Kestrel|⭕]]"] };
    const line = "- [>] 2026-09-18 Draft wireframes [[Kestrel|⭕]]";
    assert.equal(schedule.withNote(line, 6, "2026-09-18 Draft wireframes", found), "- [>] Draft wireframes [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    // The note stayed in another project (Leave it): the line's ⭕ follows it
    const left = { ...found, homeLink: "[[Household|🗃️]]" };
    assert.equal(schedule.withNote("- [ ] Draft wireframes [[Kestrel|⭕]]", 6, "Draft wireframes", left), "- [ ] Draft wireframes [[Household|🗃️]] [[Draft wireframes|🗒️]]");
    // A due date stays ahead of both
    assert.equal(schedule.withNote("- [/] Draft wireframes [[2026-09-30|🚩 9/30]]", 6, "Draft wireframes", { ...found, projectLinks: [] }),
        "- [/] Draft wireframes [[2026-09-30|🚩 9/30]] [[Kestrel|⭕]] [[Draft wireframes|🗒️]]");
    // A name that also appears in the checkbox's text isn't replaced there
    assert.equal(schedule.withNote("- [x] x", 6, "x", { name: "x", linktext: "x", homeLink: null, projectLinks: [] }), "- [x] x [[x|🗒️]]");
});

test("Schedule: ISO weekly notes (GGGG-[W]WW): a week's name is that week, labeled from its Monday", async () => {
    const ISO = { ...NN, calendarCustomWeekPattern: "[weeks]/GGGG-[W]WW" };
    const { opts } = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4, nn: ISO });
    assert.deepEqual({ ...opts.name("2026-W41") }, { date: "2026-10-05", unit: "week" }, "not the Sunday before, in week 40");
    const r = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT }, open: PROJECT, at: 3, nn: ISO, pick: (dp) => dp.result("2026-10-07", "week") });
    assert.equal(r.editor.split("\n")[3], "- [>] [[2026-W41|Wk of 10/5]] Plan the spring sale");
    assert.equal(r.notes[`${PLANNER}/weeks/2026-W41.md`], "- [ ] Plan the spring sale [[Kestrel|⭕]]\n");
});

test("Schedule: when the note it goes to can't be made, the line stays where it was", async () => {
    const r = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4, failCreate: true, pick: (dp) => dp.result("2026-10-01", "month") });
    assert.equal(r.editor, DAY_TEXT);
    assert.deepEqual(r.notices, ["Couldn't make the monthly note, so nothing was scheduled — check console"]);
});
