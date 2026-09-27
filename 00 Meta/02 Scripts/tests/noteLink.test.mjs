// A line's link to its own note (a task's note, an event's log) is written 🗒️ and read as 🗒️ or
// 🔗, the symbol before OBS-87, with or without the U+FE0F a phone may add or drop. Each script
// keeps its own pattern (TimeReport has to stand alone for the Raycast timer), so this checks
// they all read the same four spellings, and all write the same mark. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const here = new URL(".", import.meta.url);
const context = vm.createContext({ customJS: {}, app: {}, window: {}, console });
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8") + `\n;${name}`, context);
const AddTaskNote = load("addTaskNote.js", "AddTaskNote");
context.customJS.AddTaskNote = new AddTaskNote();
const AddProjectLink = load("addProjectLink.js", "AddProjectLink");
const Schedule = load("schedule.js", "Schedule");
const DueDate = load("setDueDate.js", "DueDate");
const TimeReport = load("timeReport.js", "TimeReport");
const CalendarSync = load("calendarSync.js", "CalendarSync");
const recordEvent = createRequire(import.meta.url)("../Templater/recordEvent.js");
const [linker, report, sync] = [new AddProjectLink(), new TimeReport(), new CalendarSync()];

const SPELLINGS = { "🗒️": "🗒️", "🗒 (no U+FE0F)": "🗒", "🔗": "🔗", "🔗 + U+FE0F": "🔗️" };
const once = (re) => new RegExp(re.source, re.flags.replace("g", ""));

test("every script reads 🗒️, 🗒, 🔗 and 🔗 + U+FE0F as a line's note link", () => {
    for (const [name, mark] of Object.entries(SPELLINGS)) {
        const link = `[[Draft the brief|${mark}]]`;
        assert.ok(AddTaskNote.NOTE_LINK.test(link), `AddTaskNote: ${name}`);
        assert.ok(AddProjectLink.TASK_LINK.test(link), `AddProjectLink: ${name}`);
        assert.equal(linker.taskLinkpath(`- [ ] Draft the brief ${link}`), "Draft the brief", `AddProjectLink.taskLinkpath: ${name}`);
        assert.ok(Schedule.NOTE_LINK.test(link), `Schedule: ${name}`);
        assert.ok(once(DueDate.NOTE_LINK).test(link), `DueDate: ${name}`);
        assert.ok(once(TimeReport.SYMBOL_LINK).test(link), `TimeReport.SYMBOL_LINK: ${name}`);
        assert.ok(report.isNoteAlias(mark), `TimeReport.isNoteAlias: ${name}`);
        assert.equal(sync.splitTail(`Planning [[2026-09-16 Planning|${mark}]]`, true).log, `[[2026-09-16 Planning|${mark}]]`, `CalendarSync: ${name}`);
        const day = `- [<] 4:00pm\tPlanning [[2026-09-16 Planning|${mark}]]\n\t- 4:30pm`;
        assert.equal(recordEvent(day, { log: "2026-09-16 Planning", title: "Planning" }, sync).outcome, "present", `recordEvent: ${name}`);
    }
});

test("a ⭕ or 🗃️ isn't a note link to any of them", () => {
    for (const link of ["[[Studio|⭕]]", "[[Home|🗃️]]", "[[2026-09-30|🚩 9/30]]", "[[Draft the brief|Brief]]"]) {
        assert.ok(!AddTaskNote.NOTE_LINK.test(link), `AddTaskNote: ${link}`);
        assert.ok(!AddProjectLink.TASK_LINK.test(link), `AddProjectLink: ${link}`);
        assert.ok(!Schedule.NOTE_LINK.test(link), `Schedule: ${link}`);
        assert.equal(sync.splitTail(`Planning ${link}`, true).log, null, `CalendarSync: ${link}`);
    }
    assert.ok(!report.isNoteAlias("⭕") && !report.isNoteAlias("Brief"));
});

test("every writer writes the same mark, 🗒️", () => {
    assert.equal(AddTaskNote.NOTE_MARK, "🗒️");
    assert.equal(Schedule.NOTE_MARK, AddTaskNote.NOTE_MARK);
    assert.equal(CalendarSync.NOTE_MARK, AddTaskNote.NOTE_MARK);
});
