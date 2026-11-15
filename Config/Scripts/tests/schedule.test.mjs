// Tests for plugin/src/commands/schedule.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { src, PLANNER, NN, MONTHS, SHORT, momentOn, standIn } from "./standInVault.mjs";
import { classScript } from "../../../plugin/classShape.mjs";
const code = src("schedule");
// Schedule's statics, beside a TaskIds for the ones that read its text rules (reopenIn) and the
// calendar sync, whose top list placeInTopList writes into (OBS-280)
const statics = vm.createContext({ plainday: {} });
const Schedule = vm.runInContext(code + "\n;Schedule", statics);
statics.plainday.TaskIds = new (vm.runInContext(src("taskIds") + "\n;TaskIds", statics))();
statics.plainday.TimeReport = new (vm.runInContext(src("timeReport") + "\n;TimeReport", statics))();
statics.plainday.CalendarSync = new (vm.runInContext(src("calendarSync") + "\n;CalendarSync", statics))();
// Values made in the vm, as plain ones, so deepEqual doesn't trip on the vm's own Array
const plainOf = (x) => JSON.parse(JSON.stringify(x));
const file = (path) => ({ basename: path.split("/").pop().replace(/\.md$/, ""), parent: { path: path.slice(0, path.lastIndexOf("/")) } });

// Schedule on a stand-in vault and editor, beside the scripts it leans on, all real: DatePrompt for
// the week rules, JumpToDate for a period's note, TimeReport for the periodic folders, AddTaskNote
// for links. `notes` maps paths to their text (a note's tags come from a `tags: [..]` line); `open` is
// the note in the editor, with the cursor on line `at`. The date box hands on `pick(datePrompt)`. `folds`
// maps paths to their saved fold records, as Obsidian keeps them for a note that isn't open.
// Returns the editor's text, the notes after, the notices, the options the date box was opened with, and
// the fold records saved.
const scheduleIn = async ({ notes = {}, open, at = 0, pick, today = "2026-09-16", nn = NN, failCreate = false, folds = {} }) => {
    const saved = {};
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
        foldManager: { load: (f) => folds[f.path] ?? null, save: async (f, info) => { saved[f.path] = plainOf(info); } },
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
    const plainday = {};
    const context = vm.createContext({ MarkdownView: class {}, getAllTags: (cache) => cache.frontmatter.tags.map((t) => `#${t}`), getLanguage: () => "en", app, plainday, moment: momentOn(today), Notice: class { constructor(m) { notices.push(m); } }, setTimeout: () => 0, console: { ...console, error: () => {} } });
    const make = (name, cls) => new (vm.runInContext(`${src(name)}\n;${cls}`, context))();
    Object.assign(plainday, {
        DatePrompt: make("datePrompt", "DatePrompt"), JumpToDate: make("jumpToDate", "JumpToDate"), TimeReport: make("timeReport", "TimeReport"),
        AddTaskNote: make("addTaskNote", "AddTaskNote"), Schedule: make("schedule", "Schedule"),
        TaskIds: make("taskIds", "TaskIds"), CalendarSync: make("calendarSync", "CalendarSync"),
    });
    plainday.TaskIds.freshId = () => "k3x9m2";
    let prompt = null;
    plainday.DatePrompt.open = (title, onPick, opts) => { prompt = { onPick, opts }; return {}; };
    await plainday.Schedule.invoke();
    if (prompt && pick) await prompt.onPick(pick(plainday.DatePrompt), { close() {} });
    return { editor: lines.join("\n"), notes: Object.fromEntries(vault), notices, opts: prompt?.opts, schedule: plainday.Schedule, dp: plainday.DatePrompt, folds: saved };
};

test("periodic notes: a weekly, monthly or yearly note is named by its pattern, in its folder (OBS-9, OBS-96)", async () => {
    const { schedule: s } = await scheduleIn({});
    assert.equal(s.periodOf(file(`${PLANNER}/weeks/2026w38.md`)), "week");
    assert.equal(s.periodOf(file(`${PLANNER}/months/2026-09.md`)), "month");
    assert.equal(s.periodOf(file(`${PLANNER}/years/2026.md`)), "year");
    assert.equal(s.periodOf(file(`${PLANNER}/days/2026-09-16.md`)), null, "a daily note isn't one");
    assert.equal(s.periodOf(file("Reference/Journal/2025-03.md")), null, "Journal notes aren't monthly notes");
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

// placeInTopList's result as lines, with where it put them
const placed = (lines, add = ["- [ ] Send September invoices"]) => {
    const r = Schedule.placeInTopList(lines.join("\n"), add);
    return { lines: r.content.split("\n"), at: r.at, count: r.count, item: r.item };
};
const PROPS = ["---", "aliases: 9/19/26 Saturday", "---"];
const TASK = "- [ ] Send September invoices";

test("placeInTopList: in a day's note, a task goes at the end of the list the note opens with (OBS-280)", () => {
    const top = placed([...PROPS, "- [<] 10:00am\tStandup", "- [ ] Order fabric swatches", "\t- ask for the linen", "", "## Notes", ""]);
    assert.deepEqual(top.lines, [...PROPS, "- [<] 10:00am\tStandup", "- [ ] Order fabric swatches", "\t- ask for the linen", TASK, "", "## Notes", ""]);
    assert.deepEqual([top.at, top.count, top.item], [6, 1, 6]);
    // Its sub-bullets come along; a blank line under the properties is still the top
    const spaced = placed([...PROPS, "", "- [ ] Order fabric swatches", ""], [TASK, "\t- the September ones"]);
    assert.deepEqual(spaced.lines, [...PROPS, "", "- [ ] Order fabric swatches", TASK, "\t- the September ones", ""]);
    assert.deepEqual([spaced.at, spaced.count, spaced.item], [5, 2, 5]);
    // A list that ends the note without a line break gets one
    assert.deepEqual(placed([...PROPS, "- [ ] Order fabric swatches"]).lines, [...PROPS, "- [ ] Order fabric swatches", TASK, ""]);
});

test("placeInTopList: with no list at the top, a task starts one right under the properties, above everything else (OBS-280)", () => {
    // Notes under a heading and no task lines: the shape seen on 11/15
    const notes = placed([...PROPS, "## Notes", "", "- The library book sale moved to Sunday", "\t- doors open at 10am", ""]);
    assert.deepEqual(notes.lines, [...PROPS, TASK, "", "## Notes", "", "- The library book sale moved to Sunday", "\t- doors open at 10am", ""]);
    assert.deepEqual([notes.at, notes.count, notes.item], [3, 2, 3]);
    // A checklist under a heading isn't the top list, so it stays where it is
    assert.deepEqual(placed([...PROPS, "## Notes", "- A note", "- [ ] Call the vet", ""]).lines,
        [...PROPS, TASK, "", "## Notes", "- A note", "- [ ] Call the vet", ""]);
    assert.deepEqual(placed([...PROPS, "## Notes", "- [ ] Call the vet", ""]).lines, [...PROPS, TASK, "", "## Notes", "- [ ] Call the vet", ""]);
    // Nor is a list that starts with a plain bullet, or one after a label
    assert.deepEqual(placed([...PROPS, "- Bring the folding table", "- [ ] Call the vet", ""]).lines,
        [...PROPS, TASK, "", "- Bring the folding table", "- [ ] Call the vet", ""]);
    assert.deepEqual(placed([...PROPS, "After lunch:", "- [ ] Call the vet", ""]).lines, [...PROPS, TASK, "", "After lunch:", "- [ ] Call the vet", ""]);
    // A blank line already there: no second one
    const blank = placed([...PROPS, "", "## Notes", "- A note", ""]);
    assert.deepEqual(blank.lines, [...PROPS, TASK, "", "## Notes", "- A note", ""]);
    assert.deepEqual([blank.at, blank.count, blank.item], [3, 1, 3]);
    // Properties only, with and without a line break at the end
    const props = placed([...PROPS, ""]);
    assert.deepEqual(props.lines, [...PROPS, TASK, ""]);
    assert.deepEqual([props.at, props.count, props.item], [3, 1, 3]);
    const bare = placed(PROPS);
    assert.deepEqual(bare.lines, [...PROPS, TASK, ""]);
    assert.deepEqual([bare.at, bare.count, bare.item], [3, 2, 3]);
    // An empty note: the first line
    const empty = placed([""], ["- [ ] Call the printer", "\t- ask about card stock"]);
    assert.deepEqual(empty.lines, ["- [ ] Call the printer", "\t- ask about card stock", ""]);
    assert.deepEqual([empty.at, empty.count, empty.item], [0, 2, 0]);
    // Text with no properties: the first line too
    assert.deepEqual(placed(["Some text", ""]).lines, [TASK, "", "Some text", ""]);
});

test("placeInTopList: a note fresh from the Daily Note template, its code not yet run, takes the task after the code (OBS-280)", () => {
    const template = fs.readFileSync("Config/Templates/Daily Note.md", "utf8");
    assert.match(template, /^<%/, "the template opens with its code");
    const r = Schedule.placeInTopList(template, [TASK]);
    assert.equal(r.content, `${template.replace(/\s+$/, "")}\n${TASK}\n`);
    const head = template.replace(/\s+$/, "").split("\n").length;
    assert.deepEqual([r.at, r.count, r.item], [head, 1, head]);
    assert.equal(Schedule.placeInTopList(`\n${template}`, [TASK]).content, `\n${template.replace(/\s+$/, "")}\n${TASK}\n`, "after a blank line too");
});

test("placeInTopList: a CRLF note keeps its line endings, the new blank line included (OBS-280)", () => {
    const add = ["- [ ] Two", "\t- note"];
    assert.equal(Schedule.placeInTopList("---\r\naliases: x\r\n---\r\n## Notes\r\nSome text\r\n", add).content, "---\r\naliases: x\r\n---\r\n- [ ] Two\r\n\t- note\r\n\r\n## Notes\r\nSome text\r\n");
    assert.equal(Schedule.placeInTopList("- [ ] One\r\n\r\n## Time Report\r\n", add).content, "- [ ] One\r\n- [ ] Two\r\n\t- note\r\n\r\n## Time Report\r\n");
    assert.equal(Schedule.placeInTopList("---\r\naliases: x\r\n---", ["- [ ] Two"]).content, "---\r\naliases: x\r\n---\r\n- [ ] Two\r\n", "properties with no line break at the end");
    assert.equal(Schedule.placeInTopList("- [ ] One\r\n- [ ] Two", ["- [ ] Three"]).content, "- [ ] One\r\n- [ ] Two\r\n- [ ] Three\r\n", "a list with no line break at the end");
    assert.equal(Schedule.placeInTopList("## A\n- [ ] One\n", ["- [ ] Two"]).content, "- [ ] Two\n\n## A\n- [ ] One\n", "an LF note stays LF");
});

test("placeInTopList: weekly, monthly and yearly notes follow the day's rule, and nothing goes into the time report (OBS-280)", () => {
    const REPORT = ["## Time Report", "", "%% time:start %%", "*Updated 2026-09-16 9:00pm*", "%% time:end %%", ""];
    const add = ["- [ ] Call the printer"];

    // A top list above the report: its end
    const week = placed(["---", "aliases: Week of 9/13/26", "---", "- [x] Brochure proofs", "- [ ] Product list", "\t- the fall colors", "", ...REPORT], add);
    assert.deepEqual(week.lines.slice(3, 9), ["- [x] Brochure proofs", "- [ ] Product list", "\t- the fall colors", "- [ ] Call the printer", "", "## Time Report"]);
    assert.deepEqual([week.at, week.count, week.item], [6, 1, 6]);
    assert.deepEqual(placed(["---", "aliases: Week of 9/13/26", "---", "- [ ] Product list", ...REPORT], add).lines.slice(3, 6),
        ["- [ ] Product list", "- [ ] Call the printer", "## Time Report"], "the report's heading ends the list");
    // A list under a heading: a new one under the properties
    assert.deepEqual(placed(["---", "aliases: Week of 9/13/26", "---", "## This week", "- [ ] Product list", "", ...REPORT], add).lines.slice(0, 8),
        ["---", "aliases: Week of 9/13/26", "---", "- [ ] Call the printer", "", "## This week", "- [ ] Product list", ""]);

    // Only the report: right under the properties, with or without a blank line before it
    const month = placed(["---", "aliases: September 2026", "---", "", ...REPORT], add);
    assert.deepEqual(month.lines.slice(0, 6), ["---", "aliases: September 2026", "---", "- [ ] Call the printer", "", "## Time Report"]);
    assert.deepEqual([month.at, month.count, month.item], [3, 1, 3]);
    const tight = placed(["---", "aliases: September 2026", "---", ...REPORT], add);
    assert.deepEqual(tight.lines.slice(0, 6), ["---", "aliases: September 2026", "---", "- [ ] Call the printer", "", "## Time Report"], "a blank line before the report");
    assert.deepEqual([tight.at, tight.count, tight.item], [3, 2, 3]);
    assert.deepEqual(placed(["---", "aliases: Week of 10/4/26", "---", ""], add).lines, ["---", "aliases: Week of 10/4/26", "---", "- [ ] Call the printer", ""], "a note fresh from its template");

    // Text and no list, like the yearly note's goals: first in the note
    const year = placed(["## Goals", "- Two new clients", "- A bigger studio", "", ...REPORT], add);
    assert.deepEqual(year.lines.slice(0, 7), ["- [ ] Call the printer", "", "## Goals", "- Two new clients", "- A bigger studio", "", "## Time Report"]);
    assert.deepEqual([year.at, year.count, year.item], [0, 2, 0]);

    // A checklist inside the report's markers is never the list, nor is one below the report
    assert.deepEqual(placed(["## Time Report", "", "%% time:start %%", "- [ ] not a task", "%% time:end %%", ""], add).lines,
        ["- [ ] Call the printer", "", "## Time Report", "", "%% time:start %%", "- [ ] not a task", "%% time:end %%", ""]);
    assert.deepEqual(placed(["---", "aliases: September 2026", "---", "%% time:start %%", "- [ ] not a task", "%% time:end %%", ""], add).lines,
        ["---", "aliases: September 2026", "---", "- [ ] Call the printer", "", "%% time:start %%", "- [ ] not a task", "%% time:end %%", ""], "the markers without their heading");
    const below = placed(["---", "aliases: September 2026", "---", ...REPORT.slice(0, -1), "", "- [ ] Later", ""], add);
    assert.deepEqual(below.lines.slice(0, 6), ["---", "aliases: September 2026", "---", "- [ ] Call the printer", "", "## Time Report"]);
    assert.deepEqual(below.lines.slice(-2), ["- [ ] Later", ""], "the checklist below the report stays where it is");
    // A report still under its heading from before OBS-133, or in another case, too
    for (const heading of ["## Time tracking", "## Time Tracking", "## Time report"]) {
        assert.deepEqual(placed(["---", "aliases: September 2026", "---", heading, "", "%% time:start %%", "%% time:end %%"], add).lines.slice(3, 6),
            ["- [ ] Call the printer", "", heading], heading);
    }
});

test("placeInTopList and the calendar sync write into the same list, whichever comes first (OBS-280)", () => {
    const sync = statics.plainday.CalendarSync, EVENT = "- [<] 10:00am\tFarmers market";
    const NOTES = [...PROPS, "## Notes", "- The library book sale moved to Sunday", ""];
    // The task first, then an event: the event goes above it, in the same list
    const task = Schedule.placeInTopList(NOTES.join("\n"), [TASK]).content;
    assert.equal(sync.insert(task.split("\n"), [EVENT]), [...PROPS, EVENT, TASK, "", ...NOTES.slice(3)].join("\n"));
    // The event first, then the task: the task goes after it
    const event = sync.insert(NOTES, [EVENT]);
    assert.equal(Schedule.placeInTopList(event, [TASK]).content, [...PROPS, EVENT, TASK, "", ...NOTES.slice(3)].join("\n"));
});

const DAY = `${PLANNER}/days/2026-09-16.md`;
const DAY_TEXT = [
    "---", "aliases: 9/16/26 Wednesday", "---",
    "- [<] 10:00am\tStandup",
    "- [ ] Order fabric swatches", "\t- ask for the linen",
    "- [/] Draft the brochure [[Brochure|⭕]] [[Draft the brochure|⋯]]", "\t- 9:00am - 10:00am",
    "- [ ] Water the plants",
    "", "## Notes", "",
].join("\n");
const WEEK = `${PLANNER}/weeks/2026w39.md`;
const WEEK_TEXT = [
    "---", "aliases: Week of 9/20/26", "---",
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
    assert.equal(r.editor, DAY_TEXT.replace("- [/] Draft the brochure [[Brochure|⭕]] [[Draft the brochure|⋯]]", "- [>] Draft the brochure [[Brochure|⭕]] [[Draft the brochure|⋯]] ^k3x9m2"));
    assert.equal(r.notes[WEEK], WEEK_TEXT.replace("\t- 2:00pm - 3:00pm\n", "\t- 2:00pm - 3:00pm\n- [/] Draft the brochure [[Brochure|⭕]] [[Draft the brochure|⋯]] ^k3x9m2\n"));
    assert.deepEqual(r.notices, ["Forwarded to Wk of 9/20"]);
});

test("Schedule: onto a day with notes and no task list, the task starts one under the properties, and the notes keep their folds (OBS-280)", async () => {
    const SAT = `${PLANNER}/days/2026-09-19.md`;
    const SAT_TEXT = [...PROPS, "## Notes", "", "- The library book sale moved to Sunday", "\t- doors open at 10am", "- Ask the market manager about a stall for October", "\t- bring the folding table", ""].join("\n");
    // The second note folded, the first open
    const r = await scheduleIn({ notes: { [DAY]: DAY_TEXT, [SAT]: SAT_TEXT }, open: DAY, at: 4, pick: (dp) => dp.result("2026-09-19", "day"), folds: { [SAT]: { folds: [{ from: 7, to: 8 }], lines: 10 } } });
    assert.equal(r.notes[SAT], [...PROPS, "- [ ] Order fabric swatches", "\t- ask for the linen", "", ...SAT_TEXT.split("\n").slice(3)].join("\n"));
    assert.equal(r.editor, DAY_TEXT.replace("- [ ] Order fabric swatches\n\t- ask for the linen\n", ""));
    assert.deepEqual(r.notices, ["Moved to 9/19"]);
    // The fold moved down with its note, three lines; the task that came along is folded, as before
    assert.deepEqual(r.folds[SAT], { folds: [{ from: 3, to: 4 }, { from: 10, to: 11 }], lines: 13 });
});

test("Schedule: a sent task's open line moved onto a day with notes and no task list starts the list there (OBS-280)", async () => {
    const day = (d) => `${PLANNER}/days/${d}.md`, KES = "Projects/Freelance/Kestrel/Kestrel.md";
    const TUE = [...PROPS.slice(0, 1), "aliases: 9/22/26 Tuesday", "---", "## Notes", "- Call back about the quote", ""].join("\n");
    const v = standIn({ notes: { [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Book the photographer\n", [day("2026-09-22")]: TUE }, open: KES, at: 5 });
    await v.schedule("2026-09-17");
    const id = v.notes()[KES].match(/\^([a-z0-9]{6})$/m)[1];
    v.open(KES, 5);
    assert.equal(await v.schedule("2026-09-22"), "Scheduled for Thu 9/17. Move it to");
    assert.equal(v.notes()[day("2026-09-22")], `---\naliases: 9/22/26 Tuesday\n---\n- [ ] Book the photographer [[Kestrel|⭕]] ^${id}\n\n## Notes\n- Call back about the quote\n`);
    assert.equal(v.notes()[day("2026-09-17")].trim(), "");
    assert.equal(v.notes()[KES].split("\n")[5], `- [>] Book the photographer [[2026-09-22#^${id}|9/22]] ^${id}`);
    assert.deepEqual(v.check(), []);
});

test("Schedule: from a project note, the line stays as [>] with a forward date at the end and the task's ID; the new line has the ID too (OBS-181)", async () => {
    const month = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT, "Reference/Journal/2026-10.md": "" }, open: PROJECT, at: 3, pick: (dp) => dp.result("2026-10-01", "month") });
    assert.equal(month.editor.split("\n")[3], `- [>] Plan the spring sale [[${PLANNER}/months/2026-10#^k3x9m2|Oct. 2026]] ^k3x9m2`, "by path: another note is named 2026-10");
    assert.equal(month.notes[`${PLANNER}/months/2026-10.md`], "- [ ] Plan the spring sale [[Kestrel|⭕]] ^k3x9m2\n");
    assert.deepEqual(month.notices, ["Forwarded to Oct. 2026"]);

    const year = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT }, open: PROJECT, at: 4, pick: (dp) => dp.result("2027-01-01", "year") });
    assert.equal(year.editor.split("\n")[4], "- [>] Book the photographer [[2027#^k3x9m2|2027]] ^k3x9m2");
    assert.equal(year.notes[`${PLANNER}/years/2027.md`], "- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2\n");

    const week = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT, [WEEK]: WEEK_TEXT }, open: PROJECT, at: 3, pick: (dp) => dp.result("2026-09-20", "week") });
    assert.equal(week.editor.split("\n")[3], "- [>] Plan the spring sale [[2026w39#^k3x9m2|Wk of 9/20]] ^k3x9m2");

    const own = PROJECT_TEXT.replace("Plan the spring sale", "Plan the spring sale [[2026-10-01|🚩 10/1]] ^Ab3-x9");
    const day = await scheduleIn({ notes: { [PROJECT]: own }, open: PROJECT, at: 3, pick: (dp) => dp.result("2026-09-18", "day") });
    assert.equal(day.editor.split("\n")[3], "- [>] Plan the spring sale [[2026-10-01|🚩 10/1]] [[2026-09-18#^Ab3-x9|9/18]] ^Ab3-x9", "its own block ID is the task's");
    assert.equal(day.notes[`${PLANNER}/days/2026-09-18.md`].trim() + "\n", "- [ ] Plan the spring sale [[2026-10-01|🚩 10/1]] [[Kestrel|⭕]] ^Ab3-x9\n");

    const dated = PROJECT_TEXT.replace("- [ ] Plan the spring sale", "- [ ] [[2026-09-17|9/17]] Plan the spring sale");
    const open = await scheduleIn({ notes: { [PROJECT]: dated }, open: PROJECT, at: 3, pick: (dp) => dp.result("2026-09-18", "day") });
    assert.equal(open.editor.split("\n")[3], "- [>] [[2026-09-17|9/17]] Plan the spring sale [[2026-09-18#^k3x9m2|9/18]] ^k3x9m2", "an open line's date link is its title's");
    assert.equal(open.notes[`${PLANNER}/days/2026-09-18.md`].trim() + "\n", "- [ ] [[2026-09-17|9/17]] Plan the spring sale [[Kestrel|⭕]] ^k3x9m2\n");
});

test("Schedule: a day's forward date uses the note's path when another note has its name (OBS-181)", async () => {
    const r = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT, "Reference/Journal/2026-09-18.md": "" }, open: PROJECT, at: 3, pick: (dp) => dp.result("2026-09-18", "day") });
    assert.equal(r.editor.split("\n")[3], `- [>] Plan the spring sale [[${PLANNER}/days/2026-09-18#^k3x9m2|9/18]] ^k3x9m2`);
});

test("Schedule: a task in a weekly note moves with its sub-bullets, like one in a monthly note (OBS-96)", async () => {
    const DAY2 = `${PLANNER}/days/2026-09-22.md`;
    const r = await scheduleIn({ notes: { [WEEK]: WEEK_TEXT, [DAY2]: "---\naliases: 9/22/26 Tuesday\n---\n- [ ] Call the printer\n" }, open: WEEK, at: 3, pick: (dp) => dp.result("2026-09-22", "day") });
    assert.equal(r.editor, WEEK_TEXT.replace("- [ ] Pick the paper stock\n\t- 2:00pm - 3:00pm\n", ""));
    assert.equal(r.notes[DAY2], "---\naliases: 9/22/26 Tuesday\n---\n- [ ] Call the printer\n- [ ] Pick the paper stock\n\t- 2:00pm - 3:00pm\n");
    assert.deepEqual(r.notices, ["Moved to 9/22"]);
});

test("Schedule: a task scheduled into the note it's in stays put (OBS-96)", async () => {
    const day = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4, pick: (dp) => dp.result("2026-09-16", "day") });
    assert.equal(day.editor, DAY_TEXT);
    assert.equal(day.notes[DAY], DAY_TEXT);
    assert.deepEqual(day.notices, ["Already in this note"]);
    const week = await scheduleIn({ notes: { [WEEK]: WEEK_TEXT }, open: WEEK, at: 3, pick: (dp) => dp.result("2026-09-24", "week") });
    assert.equal(week.editor, WEEK_TEXT);
    assert.deepEqual(week.notices, ["Already in this note"]);
});

test("leaveBehind: from a day, with time logged under it, the line stays [>] with its time, finished sub-tasks and notes, and a [/] copy goes with its open sub-tasks; otherwise, or from a week, it moves whole (OBS-181, OBS-193, OBS-210)", () => {
    const lines = ["- [ ] A ^aaaaaa", "\t- note", "- [ ] B ^bbbbbb", "\t- 9:00am - 9:30am", "\t- [x] b1", "\t- [ ] b2", "\t\t- [x] under b2", "\t- a note", "", "\t- [/] b3", "\t- [ ] b4 with time", "\t\t- 10:00am - 10:15am", "- [ ] C"];
    assert.deepEqual(plainOf(Schedule.leaveBehind(lines, 0, { daily: true })), { lines: lines.slice(2), outgoing: ["- [ ] A ^aaaaaa", "\t- note"], moved: "moved", end: 1, kept: [] });
    const b = plainOf(Schedule.leaveBehind(lines, 2, { daily: true }));
    assert.deepEqual(b.kept, ["- [>] B ^bbbbbb", "\t- 9:00am - 9:30am", "\t- [x] b1", "\t- a note", "\t- [ ] b4 with time", "\t\t- 10:00am - 10:15am"]);
    assert.deepEqual(b.lines, ["- [ ] A ^aaaaaa", "\t- note", ...b.kept, "- [ ] C"]);
    assert.deepEqual([b.outgoing, b.moved, b.end], [["- [/] B ^bbbbbb", "\t- [ ] b2", "\t\t- [x] under b2", "\t- [/] b3"], "forwarded", 11]);
    // From a week everything goes, time included, blank lines aside
    assert.deepEqual(plainOf(Schedule.leaveBehind(lines, 2, { daily: false })).outgoing, ["- [ ] B ^bbbbbb", ...lines.slice(3, 12).filter((l) => l).map((l) => l)]);
    // An event nested under a task (against the rules) is its note like anything else, and goes with it
    assert.deepEqual(plainOf(Schedule.leaveBehind(["- [ ] Prep", "\t- [<] 2:00pm\tReview call", "\t- [ ] open"], 0, { daily: true })).outgoing, ["- [ ] Prep", "\t- [<] 2:00pm\tReview call", "\t- [ ] open"]);
    // A finished line reopens: [/] with time logged under it or elsewhere (`started`), else [ ]
    const done = ["- [x] D ^dddddd", "\t- [ ] d1", "- [-] E ^eeeeee"];
    assert.deepEqual(plainOf(Schedule.leaveBehind(done, 0, { daily: true })).outgoing, ["- [ ] D ^dddddd", "\t- [ ] d1"]);
    assert.deepEqual(plainOf(Schedule.leaveBehind(done, 0, { daily: true, started: true })).outgoing, ["- [/] D ^dddddd", "\t- [ ] d1"]);
    assert.deepEqual(plainOf(Schedule.leaveBehind(["- [x] F ^ffffff", "\t- 9:00am - 9:30am"], 0, { daily: true })).outgoing, ["- [/] F ^ffffff"]);
    // A CRLF note keeps its line endings, and what goes leaves without them
    const crlf = plainOf(Schedule.leaveBehind(["- [/] T ^abc123\r", "\t- 9:00am - 9:30am\r", "\t- [ ] open\r", ""], 0, { daily: true }));
    assert.deepEqual([crlf.lines, crlf.outgoing], [["- [>] T ^abc123\r", "\t- 9:00am - 9:30am\r", ""], ["- [/] T ^abc123", "\t- [ ] open"]]);
});

test("reopenIn: the moving line takes the place of the day's [>], done or canceled line, keeping what it gained; its box is [/] with time logged, else [ ]; sub-bullets follow (OBS-181, OBS-193)", () => {
    const text = ["- [>] B ^bbbbbb", "\t- 9:00am - 9:30am", "- [ ] C"].join("\n");
    assert.equal(Schedule.reopenIn(text, "bbbbbb", ["- [ ] B, reworded [[2026-09-25|🚩 9/25]] ^bbbbbb", "\t- call first"]),
        ["- [/] B, reworded [[2026-09-25|🚩 9/25]] ^bbbbbb", "\t- 9:00am - 9:30am", "\t- call first", "- [ ] C"].join("\n"));
    // A done line with no time reopens as [ ]; as [/] when the task has time logged elsewhere, or the moving line is [/]
    const done = ["- [x] B ^bbbbbb", "\t- [x] b1", "- [ ] C"].join("\n");
    assert.equal(Schedule.reopenIn(done, "bbbbbb", ["- [ ] B ^bbbbbb", "\t- [ ] b2"]), ["- [ ] B ^bbbbbb", "\t- [x] b1", "\t- [ ] b2", "- [ ] C"].join("\n"));
    assert.equal(Schedule.reopenIn(done, "bbbbbb", ["- [ ] B ^bbbbbb"], { started: true }), ["- [/] B ^bbbbbb", "\t- [x] b1", "- [ ] C"].join("\n"));
    assert.equal(Schedule.reopenIn(done, "bbbbbb", ["- [/] B ^bbbbbb"]), ["- [/] B ^bbbbbb", "\t- [x] b1", "- [ ] C"].join("\n"));
    assert.equal(Schedule.reopenIn("- [-] B ^bbbbbb", "bbbbbb", ["- [ ] B ^bbbbbb"]), "- [ ] B ^bbbbbb", "a canceled line too");
    // An open line with the ID isn't reopened, nor a nested one: a sub-task's ID counts for nothing
    assert.equal(Schedule.reopenIn("- [ ] B ^bbbbbb", "bbbbbb", ["- [ ] B ^bbbbbb"]), "- [ ] B ^bbbbbb");
    assert.equal(Schedule.reopenIn("- [ ] A\n\t- [>] B ^bbbbbb", "bbbbbb", ["- [ ] B ^bbbbbb"]), "- [ ] A\n\t- [>] B ^bbbbbb");
});

test("Schedule writes ↗ back to the note a line was sent from (OBS-208); it reads a line's ⋯ through AddTaskNote", () => {
    const Schedule = vm.runInContext(code + "\n;Schedule", vm.createContext({}));
    assert.equal(Schedule.NOTE_MARK, "⋯");
    assert.equal(Schedule.FROM_MARK, "↗");
    assert.equal(Schedule.NOTE_LINK, undefined, "AddTaskNote.NOTE_LINK is the pattern (noteLink.test.mjs)");
    // The link it writes (a line sent from another note) uses the mark, and none is written by hand
    assert.equal((code.match(/Schedule\.FROM_MARK/g) ?? []).length, 1);
    assert.doesNotMatch(code, /\|(?:⋯|↗)\]\]`/);
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
    const context = vm.createContext({ app, plainday: {}, getAllTags: (cache) => cache.frontmatter.tags.map((t) => `#${t}`) });
    const AddTaskNote = vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", context);
    context.plainday.AddTaskNote = new AddTaskNote();
    return { schedule: new (vm.runInContext(code + "\n;Schedule", context))(), file: (p) => files.find((f) => f.path === p) };
};
const DEMO = [
    ["Projects/Freelance/Freelance.md", ["area"]],
    ["Projects/Freelance/Kestrel/Kestrel.md", ["project"]],
    ["Projects/Freelance/Kestrel/Draft wireframes.md", ["task"]],
    ["Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md", ["log"]],
    ["Projects/Household/Household.md", ["area"]],
    ["Projects/Household/Fix the gate.md", ["task"]],
    ["Projects/Freelance/Old Job/Old Job.md", ["project"], { status: "Done" }],
    ["Projects/Freelance/Old Job/Old sub.md", ["task"]],
    ["Inbox/Loose idea.md", []],
];

test("sentLine (rule 13, OBS-208): its own note's project, else the source's, finished or not; a ↗ back to a note, after its ⋯", () => {
    const { schedule, file } = withVault(DEMO);
    const project = file("Projects/Freelance/Kestrel/Kestrel.md");
    const wireframes = file("Projects/Freelance/Kestrel/Draft wireframes.md");
    const log = file("Projects/Freelance/Kestrel/logs/2026-09-14 Homepage review.md");
    // From a project or area note: its ⭕ or 🗃️, and no ↗, since that already names the note
    assert.equal(schedule.sentLine("- [ ] Sign-off call", project), "- [ ] Sign-off call [[Kestrel|⭕]]", "no trailing space");
    assert.equal(schedule.sentLine("- [ ] Shot list [[Shot list|⋯]]", project), "- [ ] Shot list [[Kestrel|⭕]] [[Shot list|⋯]]", "before the line's own note, which doesn't exist yet");
    assert.equal(schedule.sentLine("- [ ] Mow", file("Projects/Household/Household.md")), "- [ ] Mow [[Household|🗃️]]");
    // A ⭕ or 🗃️ the line had in its note gives way: outside a periodic note a line has no project of its own (rule 4)
    assert.equal(schedule.sentLine("- [ ] Sign-off call [[Household|🗃️]]", project), "- [ ] Sign-off call [[Kestrel|⭕]]");
    // From a task note or a log: its project, then a ↗ back to it
    assert.equal(schedule.sentLine("- [/] Mobile layout ", wireframes), "- [/] Mobile layout [[Kestrel|⭕]] [[Draft wireframes|↗]]");
    assert.equal(schedule.sentLine("- [ ] Send the notes", log), "- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Homepage review|↗]]");
    assert.equal(schedule.sentLine("- [ ] Send the notes [[Household|🗃️]]", log), "- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Homepage review|↗]]", "its own 🗃️ gives way here too");
    assert.equal(schedule.sentLine("- [ ] Think it over", file("Inbox/Loose idea.md")), "- [ ] Think it over [[Loose idea|↗]]", "a note in no project: a ↗ and no ⭕");
    // A step with its own note: that note's project, its ⋯, then the ↗ (today it got no link back)
    assert.equal(schedule.sentLine("- [ ] Fix the gate [[Fix the gate|⋯]]", wireframes), "- [ ] Fix the gate [[Household|🗃️]] [[Fix the gate|⋯]] [[Draft wireframes|↗]]");
    assert.equal(schedule.sentLine("- [ ] Fix the gate [[Fix the gate|⋯]]", project), "- [ ] Fix the gate [[Household|🗃️]] [[Fix the gate|⋯]]", "from a project note: no ↗");
    assert.equal(schedule.sentLine("- [ ] New idea [[Not made yet|⋯]]", project), "- [ ] New idea [[Kestrel|⭕]] [[Not made yet|⋯]]", "a note that doesn't exist yet: the source's project");
    // A note in a finished project names it too: its time counts there (rule 13; today it named none)
    assert.equal(schedule.sentLine("- [ ] Old sub [[Old sub|⋯]]", project), "- [ ] Old sub [[Old Job|⭕]] [[Old sub|⋯]]");
    // A ⭕ in the text is the title's, not the line's: it stays, and the line still gets its own
    assert.equal(schedule.sentLine("- [ ] Talk to [[Household|🗃️]] about it", wireframes),
        "- [ ] Talk to [[Household|🗃️]] about it [[Kestrel|⭕]] [[Draft wireframes|↗]]");
    // A block ID stays last
    assert.equal(schedule.sentLine("- [ ] Send the notes ^a1b2", log), "- [ ] Send the notes [[Kestrel|⭕]] [[2026-09-14 Homepage review|↗]] ^a1b2");
    assert.equal(schedule.sentLine.length, 2, "sentLine(line, src)");
});

test("Schedule: ISO weekly notes (GGGG-[W]WW): a week's name is that week, labeled from its Monday", async () => {
    const ISO = { ...NN, calendarCustomWeekPattern: "[weeks]/GGGG-[W]WW" };
    const { opts } = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4, nn: ISO });
    assert.deepEqual({ ...opts.name("2026-W41") }, { date: "2026-10-05", unit: "week" }, "not the Sunday before, in week 40");
    const r = await scheduleIn({ notes: { [PROJECT]: PROJECT_TEXT }, open: PROJECT, at: 3, nn: ISO, pick: (dp) => dp.result("2026-10-07", "week") });
    assert.equal(r.editor.split("\n")[3], "- [>] Plan the spring sale [[2026-W41#^k3x9m2|Wk of 10/5]] ^k3x9m2");
    assert.equal(r.notes[`${PLANNER}/weeks/2026-W41.md`], "- [ ] Plan the spring sale [[Kestrel|⭕]] ^k3x9m2\n");
});

test("Schedule: when the note it goes to can't be made, the line stays where it was", async () => {
    const r = await scheduleIn({ notes: { [DAY]: DAY_TEXT }, open: DAY, at: 4, failCreate: true, pick: (dp) => dp.result("2026-10-01", "month") });
    assert.equal(r.editor, DAY_TEXT);
    assert.deepEqual(r.notices, ["Couldn't make the monthly note, so nothing was scheduled — check console"]);
});

// ------------------------------------------------------------------ review fixes (OBS-193)

test("reopenIn: 🆓 follows the moving line, added or taken off, as its 🚩 does (Brian, 2026-10-26)", () => {
    assert.equal(Schedule.reopenIn("- [>] B [[Studio|⭕]] ^bbbbbb\n\t- 9:00am - 9:30am", "bbbbbb", ["- [ ] B 🆓 [[Studio|⭕]] ^bbbbbb"]), "- [/] B 🆓 [[Studio|⭕]] ^bbbbbb\n\t- 9:00am - 9:30am");
    assert.equal(Schedule.reopenIn("- [>] B 🆓 [[Studio|⭕]] ^bbbbbb", "bbbbbb", ["- [ ] B [[Studio|⭕]] ^bbbbbb"]), "- [ ] B [[Studio|⭕]] ^bbbbbb");
    assert.equal(Schedule.reopenIn("- [>] B ^bbbbbb", "bbbbbb", ["- [ ] B, 🆓 reworded ^bbbbbb"]), "- [ ] B, 🆓 reworded ^bbbbbb", "a 🆓 in the text stays where it was typed");
});

test("reopenIn: the reopened line takes everything from the moving line, its ⭕ included; only its entries and, when the moving line has none, its ⋯ are the day's (Brian, 2026-10-26)", () => {
    assert.equal(Schedule.reopenIn("- [>] B [[Studio|⭕]] [[B|⋯]] ^bbbbbb\n\t- 9:00am - 9:30am", "bbbbbb", ["- [ ] B [[Kestrel|⭕]] ^bbbbbb"]), "- [/] B [[Kestrel|⭕]] [[B|⋯]] ^bbbbbb\n\t- 9:00am - 9:30am");
    assert.equal(Schedule.reopenIn("- [>] B [[Studio|⭕]] ^bbbbbb", "bbbbbb", ["- [ ] B ^bbbbbb"]), "- [ ] B ^bbbbbb", "a ⭕ the moving line doesn't have comes off");
    assert.equal(Schedule.reopenIn("- [>] B [[Old|⋯]] ^bbbbbb", "bbbbbb", ["- [ ] B [[Kestrel|⭕]] [[New|⋯]] ^bbbbbb"]), "- [ ] B [[Kestrel|⭕]] [[New|⋯]] ^bbbbbb");
});
