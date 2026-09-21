// Tests for Templater/recordEvent.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The helper borrows the calendar sync's line shape, matching and sort order, so the sync class
// is loaded with vm the way its own tests do, and passed in as the Log template passes
// customJS.CalendarSync.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const recordEvent = require("../Templater/recordEvent.js");
const eventTimes = require("../Templater/eventTimes.js");

const code = fs.readFileSync(new URL("../CustomJS/calendarSync.js", import.meta.url), "utf8");
const sync = new (vm.runInContext(code + "\n;CalendarSync", vm.createContext({ app: {}, window: {}, customJS: {}, console })))();

const text = (...lines) => lines.join("\n");
const FM = ["---", "aliases: 9/16/26 Wednesday", "---"];
const note = (...lines) => text(...FM, ...lines, "");
const record = (day, log, over = {}) => recordEvent(day, { log, title: log.slice(11), ...over }, sync);

const DAY = note(
    "- [<] All day\tOffsite",
    "- [<] 9:00am\tStandup [[Pinecone Studio|⭕]]",
    "\t- 9:15am",
    "- [<] 4:00pm\tPlanning ℹ️ [[Pinecone Studio|⭕]]   ",
    "\t- 4:30pm",
    "- [ ] A task [[A task|🔗]]",
    "\t- 10:00am - 10:30am",
);

// ------------------------------------------------------------------ linking a line that's there

test("a plain event line with the log's title: the title becomes the log link, the rest of the line and the end line stay", () => {
    const { text: after, outcome } = record(DAY, "2026-09-16 Planning");
    assert.equal(outcome, "linked");
    assert.equal(after, DAY.replace("\tPlanning ℹ️", "\t[[2026-09-16 Planning|Planning]] ℹ️"));
    // The Log template then reads the times from the linked line
    assert.deepEqual(eventTimes(after, "2026-09-16 Planning"), { time: "4:00pm", endTime: "4:30pm" });
});

test("an all-day line links too; the ⭕ link stays outside the log link", () => {
    assert.equal(record(DAY, "2026-09-16 Offsite").text, DAY.replace("\tOffsite", "\t[[2026-09-16 Offsite|Offsite]]"));
    assert.equal(record(DAY, "2026-09-16 Standup").text, DAY.replace("\tStandup [[", "\t[[2026-09-16 Standup|Standup]] [["));
});

test("already linked (the log was made from the line): nothing changes, whatever the link's alias or path", () => {
    const linked = record(DAY, "2026-09-16 Planning").text;
    assert.deepEqual(record(linked, "2026-09-16 Planning"), { text: linked, outcome: "present" });
    for (const link of ["[[2026-09-16 Planning]]", "[[2026-09-16 Planning|Q3 planning]]", "[[Projects/Studio/logs/2026-09-16 Planning|Planning]]"]) {
        const day = DAY.replace("Planning ℹ️", `${link} ℹ️`);
        assert.equal(record(day, "2026-09-16 Planning").outcome, "present", link);
    }
});

test("a task that links the log with 🔗 isn't the event line: the event still gets linked", () => {
    const day = note("- [<] 4:00pm\tPlanning", "\t- 4:30pm", "- [ ] Send the deck [[2026-09-16 Planning|🔗]]");
    const { text: after, outcome } = record(day, "2026-09-16 Planning");
    assert.equal(outcome, "linked");
    assert.equal(after, day.replace("\tPlanning", "\t[[2026-09-16 Planning|Planning]]"));
});

test("a title the log's title is a prefix of: linked when one line could be meant, keeping the line's own title as the alias", () => {
    const one = note("- [<] 9:00am\tStandup - Design review", "\t- 9:15am");
    assert.equal(record(one, "2026-09-16 Standup").text, one.replace("\tStandup - Design review", "\t[[2026-09-16 Standup|Standup - Design review]]"));
    // Two candidates: neither is linked, and the log gets its own line
    const two = note("- [<] 9:00am\tStandup - Design review", "\t- 9:15am", "- [<] 10:00am\tStandup - Eng", "\t- 10:15am");
    const { text: after, outcome } = record(two, "2026-09-16 Standup");
    assert.equal(outcome, "inserted");
    assert.equal(after, note("- [<] 9:00am\tStandup - Design review", "\t- 9:15am", "- [<] 10:00am\tStandup - Eng", "\t- 10:15am", "- [<] [[2026-09-16 Standup|Standup]]"));
    // An exact match wins over a prefix match
    const both = note("- [<] 9:00am\tStandup - Design review", "- [<] 10:00am\tStandup");
    assert.equal(record(both, "2026-09-16 Standup").text, note("- [<] 9:00am\tStandup - Design review", "- [<] 10:00am\t[[2026-09-16 Standup|Standup]]"));
});

test("not the event line: a task with the same text, a canceled event, a title with a link in it, a title linked to another log", () => {
    const day = note(
        "- [-] 4:00pm\tPlanning",
        "\t- 4:30pm",
        "- [<] 5:00pm\tPlanning with [[Imogen Fenwick]]",
        "- [<] 6:00pm\t[[2026-09-16 Other|Planning]]",
        "- [ ] Planning",
    );
    const { text: after, outcome } = record(day, "2026-09-16 Planning");
    assert.equal(outcome, "inserted");
    assert.equal(after, day.replace("- [ ] Planning", "- [<] [[2026-09-16 Planning|Planning]]\n- [ ] Planning"));
});

test("two lines with the title: `time` picks the one with that start; without it, the first", () => {
    const day = note("- [<] 9:00am\tPlanning", "\t- 9:30am", "- [<] 4:00pm\tPlanning", "\t- 4:30pm");
    assert.equal(record(day, "2026-09-16 Planning", { time: "4:00pm" }).text, day.replace("4:00pm\tPlanning", "4:00pm\t[[2026-09-16 Planning|Planning]]"));
    assert.equal(record(day, "2026-09-16 Planning", { time: "4:00 PM" }).text, day.replace("4:00pm\tPlanning", "4:00pm\t[[2026-09-16 Planning|Planning]]"));
    assert.equal(record(day, "2026-09-16 Planning").text, day.replace("9:00am\tPlanning", "9:00am\t[[2026-09-16 Planning|Planning]]"));
    // A time no line has: the log gets its own line
    assert.equal(record(day, "2026-09-16 Planning", { time: "1:00pm" }).outcome, "inserted");
});

test("regex characters in the title are literal", () => {
    const day = note("- [<] 5:00pm\tBoard call (Q3)", "\t- 5:45pm");
    assert.equal(record(day, "2026-09-16 Board call (Q3)").text, day.replace("\tBoard call (Q3)", "\t[[2026-09-16 Board call (Q3)|Board call (Q3)]]"));
    assert.equal(record(record(day, "2026-09-16 Board call (Q3)").text, "2026-09-16 Board call (Q3)").outcome, "present");
});

// ------------------------------------------------------------------ adding a line

test("no line for the log: a [<] line with no time goes after the timed events, above the tasks", () => {
    const { text: after, outcome } = record(DAY, "2026-09-16 Retro");
    assert.equal(outcome, "inserted");
    assert.equal(after, DAY.replace("- [ ] A task", "- [<] [[2026-09-16 Retro|Retro]]\n- [ ] A task"));
    // A second one goes after the first, and a timed event the sync inserts later goes above both
    const two = record(after, "2026-09-16 Wrap-up").text;
    assert.equal(two, after.replace("- [ ] A task", "- [<] [[2026-09-16 Wrap-up|Wrap-up]]\n- [ ] A task"));
    const synced = sync.insert(two.split("\n"), ["- [<] 5:00pm\tDrinks", "\t- 6:00pm"]);
    assert.equal(synced, two.replace("- [<] [[2026-09-16 Retro", "- [<] 5:00pm\tDrinks\n\t- 6:00pm\n- [<] [[2026-09-16 Retro"));
});

test("a note with tasks but no events, or with no checklist at all, or empty", () => {
    const tasks = note("- [ ] A task", "- [x] Another");
    assert.equal(record(tasks, "2026-09-16 Retro").text, note("- [<] [[2026-09-16 Retro|Retro]]", "- [ ] A task", "- [x] Another"));
    const prose = note("", "## Notes", "- a thought");
    assert.equal(record(prose, "2026-09-16 Retro").text, note("- [<] [[2026-09-16 Retro|Retro]]", "", "## Notes", "- a thought"));
    assert.equal(record("", "2026-09-16 Retro").text, "- [<] [[2026-09-16 Retro|Retro]]\n");
});

test("a daily note just created from its template: the line goes at the end, after the template's code", () => {
    const template = "<%*\ntR += \"---\\naliases: x\\n---\"\n%>";
    const { text: after, outcome } = recordEvent(template, { log: "2026-09-16 Retro", title: "Retro" }, sync, true);
    assert.equal(outcome, "inserted");
    assert.equal(after, `${template}\n- [<] [[2026-09-16 Retro|Retro]]\n`);
    assert.equal(recordEvent("", { log: "2026-09-16 Retro", title: "Retro" }, sync, true).text, "- [<] [[2026-09-16 Retro|Retro]]\n");
});

test("no title (a name that's only the date): nothing is written", () => {
    assert.deepEqual(recordEvent(DAY, { log: "2026-09-16", title: "" }, sync), { text: DAY, outcome: "skipped" });
});

// ------------------------------------------------------------------ from the review of the diff

test("a bare link to the log on a task or in prose isn't its line (you clicked it to make the note): the event line still gets linked", () => {
    const day = note("- [<] 3:00pm\tPrinter call", "\t- 3:30pm", "- [ ] prep [[2026-09-18 Printer call]]", "", "## Notes", "- see [[2026-09-18 Printer call]]");
    const { text: after, outcome } = record(day, "2026-09-18 Printer call");
    assert.equal(outcome, "linked");
    assert.equal(after, day.replace("\tPrinter call", "\t[[2026-09-18 Printer call|Printer call]]"));
    // But the log link as an event's title counts wherever the marker came from, a forwarded event included
    for (const line of ["- [-] 3:00pm\t[[2026-09-18 Printer call|Printer call]]", "- [>] [[2026-09-19|9/19]] 3:00pm\t[[2026-09-18 Printer call|Printer call]] [[Pinecone Studio|⭕]]", "- [<] [[2026-09-18 Printer call|Printer call]]"]) {
        assert.equal(record(note(line), "2026-09-18 Printer call").outcome, "present", line);
    }
});

test("a [<] line you typed with no time links too, so the sync can adopt it later", () => {
    const day = note("- [<] 3:00pm\tStandup", "\t- 3:30pm", "- [<] Printer call", "- [ ] A task");
    assert.equal(record(day, "2026-09-18 Printer call").text, day.replace("- [<] Printer call", "- [<] [[2026-09-18 Printer call|Printer call]]"));
    // With a time to match, a timeless line isn't it
    assert.equal(record(day, "2026-09-18 Printer call", { time: "4:00pm" }).outcome, "inserted");
});

test("the title but for case links; a timeless line matches by prefix like a timed one", () => {
    const day = note("- [<] 3:00pm\tprinter call", "\t- 3:30pm");
    assert.equal(record(day, "2026-09-18 Printer call").text, day.replace("\tprinter call", "\t[[2026-09-18 Printer call|printer call]]"));
    const two = note("- [<] Printer call with the rep");
    assert.equal(record(two, "2026-09-18 Printer call").text, note("- [<] [[2026-09-18 Printer call|Printer call with the rep]]"));
});

test("a note that still opens with its template's code is treated as fresh, whatever the flag says", () => {
    const template = "<%*\ntR += \"---\\naliases: x\\n---\"\n%>";
    assert.equal(record(template, "2026-09-16 Retro").text, `${template}\n- [<] [[2026-09-16 Retro|Retro]]\n`);
});
