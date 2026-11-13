// A line's link to its own note (a task's note, an event's log) is written ⋯, and the link to the note
// Schedule sent it from ↗ (OBS-208); every script reads both spellings of the link, the ↗ with or without the
// U+FE0F a phone may add, and only what a line's own note decides reads the ⋯ alone. 🗒️ and 🔗, the marks before,
// and a typed … mean nothing. Each script keeps its own pattern (TimeReport has to stand alone for the
// Raycast timer), so this checks they all read the same spellings, and all write the same marks. Run from
// the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const here = new URL(".", import.meta.url);
const context = vm.createContext({ customJS: {}, app: {}, window: {}, console });
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../../../plugin/src/classes/${file}`, here), "utf8") + `\n;${name}`, context);
const AddTaskNote = load("addTaskNote.js", "AddTaskNote");
context.customJS.AddTaskNote = new AddTaskNote();
const AddProjectLink = load("addProjectLink.js", "AddProjectLink");
const Schedule = load("schedule.js", "Schedule");
const DueDate = load("setDueDate.js", "DueDate");
const TimeReport = load("timeReport.js", "TimeReport");
const CalendarSync = load("calendarSync.js", "CalendarSync");
const recordEvent = createRequire(import.meta.url)("../Templater/recordEvent.js");
const [linker, report, sync] = [new AddProjectLink(), new TimeReport(), new CalendarSync()];

const SPELLINGS = { "⋯": "⋯", "↗": "↗", "↗ + U+FE0F": "↗\uFE0F" };
// The marks before OBS-208, which the one-time conversion replaced, and the ellipsis a phone types
const NOTHING = { "🗒️": "🗒️", "🗒 (no U+FE0F)": "🗒", "🔗": "🔗", "🔗 + U+FE0F": "🔗\uFE0F", "… (U+2026)": "…" };
const once = (re) => new RegExp(re.source, re.flags.replace("g", ""));

test("every script reads ⋯, ↗ and ↗ + U+FE0F as a line's note link (OBS-208)", () => {
    for (const [name, mark] of Object.entries(SPELLINGS)) {
        const link = `[[Draft the brief|${mark}]]`;
        assert.ok(AddTaskNote.NOTE_LINK.test(link), `AddTaskNote: ${name}`);
        assert.ok(once(DueDate.NOTE_LINK).test(link), `DueDate: ${name}`);
        assert.ok(once(TimeReport.SYMBOL_LINK).test(link), `TimeReport.SYMBOL_LINK: ${name}`);
        const read = report.lineLinks(`[ ] Draft the brief ${link}`);
        assert.equal(read.notes.length + read.from.length, 1, `TimeReport.lineLinks: ${name}`);
        assert.equal(sync.splitTail(`Planning [[2026-09-16 Planning|${mark}]]`, true).log, `[[2026-09-16 Planning|${mark}]]`, `CalendarSync: ${name}`);
        const day = `- [<] 4:00pm\tPlanning [[2026-09-16 Planning|${mark}]]\n\t- 4:30pm`;
        assert.equal(recordEvent(day, { log: "2026-09-16 Planning", title: "Planning" }, sync).outcome, "present", `recordEvent: ${name}`);
    }
});

test("🗒️, 🔗 and … are a note link to none of them now (OBS-208)", () => {
    for (const [name, mark] of Object.entries(NOTHING)) {
        const link = `[[Draft the brief|${mark}]]`;
        assert.ok(!AddTaskNote.NOTE_LINK.test(link), `AddTaskNote: ${name}`);
        assert.ok(!once(DueDate.NOTE_LINK).test(link), `DueDate: ${name}`);
        assert.ok(!once(TimeReport.SYMBOL_LINK).test(link), `TimeReport.SYMBOL_LINK: ${name}`);
        const read = report.lineLinks(`[ ] Draft the brief ${link}`);
        assert.equal(read.notes.length + read.from.length, 0, `TimeReport.lineLinks: ${name}`);
        assert.equal(sync.splitTail(`Planning [[2026-09-16 Planning|${mark}]]`, true).log, null, `CalendarSync: ${name}`);
    }
});

test("a ⭕ or 🗃️ isn't a note link to any of them", () => {
    for (const link of ["[[Studio|⭕]]", "[[Home|🗃️]]", "[[2026-09-30|🚩 9/30]]", "[[Draft the brief|Brief]]"]) {
        assert.ok(!AddTaskNote.NOTE_LINK.test(link), `AddTaskNote: ${link}`);
        assert.equal(sync.splitTail(`Planning ${link}`, true).log, null, `CalendarSync: ${link}`);
    }
    for (const link of ["[[Studio|⭕]]", "[[Draft the brief|Brief]]"]) assert.equal(report.lineLinks(`[ ] Draft the brief ${link}`).notes.length, 0, link);
});

test("every writer writes the same marks, ⋯ for a line's own note and ↗ for the note it was sent from (OBS-208)", () => {
    assert.equal(AddTaskNote.NOTE_MARK, "⋯");
    assert.equal(Schedule.NOTE_MARK, AddTaskNote.NOTE_MARK);
    assert.equal(CalendarSync.NOTE_MARK, AddTaskNote.NOTE_MARK);
    assert.equal(Schedule.FROM_MARK, "↗");
    assert.equal(AddTaskNote.FROM_MARK, Schedule.FROM_MARK);
});
