// Tests for Templater/recordEvent.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The helper borrows the calendar sync's line shape, matching and sort order, so the sync class
// is loaded with vm the way its own tests do, and passed in as the Log template passes
// plainday.CalendarSync.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { classScript } from "../../../plugin/classShape.mjs";

const require = createRequire(import.meta.url);
const recordEvent = require("../Templater/recordEvent.js");
const eventTimes = require("../Templater/eventTimes.js");

const code = classScript("calendarSync.js");
const sync = new (vm.runInContext(code + "\n;CalendarSync", vm.createContext({ app: {}, window: {}, plainday: {}, console })))();

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
    "- [ ] A task [[A task|⋯]]",
    "\t- 10:00am - 10:30am",
);

// ------------------------------------------------------------------ linking a line that's there

test("a plain event line with the log's title: the log link ends the line, after the title, its marks and the ⭕ (OBS-90); the end line stays", () => {
    const { text: after, outcome } = record(DAY, "2026-09-16 Planning");
    assert.equal(outcome, "linked");
    assert.equal(after, DAY.replace("\tPlanning ℹ️ [[Pinecone Studio|⭕]]   ", "\tPlanning ℹ️ [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]"));
    // The Log template then reads the times from the linked line
    assert.deepEqual(eventTimes(after, "2026-09-16 Planning"), { time: "4:00pm", endTime: "4:30pm" });
});

test("an all-day line links too; the log link is last, after the ⭕", () => {
    assert.equal(record(DAY, "2026-09-16 Offsite").text, DAY.replace("\tOffsite", "\tOffsite [[2026-09-16 Offsite|⋯]]"));
    assert.equal(record(DAY, "2026-09-16 Standup").text, DAY.replace("\tStandup [[Pinecone Studio|⭕]]", "\tStandup [[Pinecone Studio|⭕]] [[2026-09-16 Standup|⋯]]"));
    const marked = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] 🆓", "\t- 4:30pm");
    assert.equal(record(marked, "2026-09-16 Planning").text, note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] 🆓 [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"));
});

test("already linked (the log was made from the line): nothing changes, whatever the link's alias or path", () => {
    const linked = record(DAY, "2026-09-16 Planning").text;
    assert.deepEqual(record(linked, "2026-09-16 Planning"), { text: linked, outcome: "present", line: linked.split("\n")[6] });
    // A title wrapped in the link, from before OBS-57
    for (const link of ["[[2026-09-16 Planning]]", "[[2026-09-16 Planning|Q3 planning]]", "[[Projects/Studio/logs/2026-09-16 Planning|Planning]]"]) {
        const day = DAY.replace("Planning ℹ️", `${link} ℹ️`);
        assert.equal(record(day, "2026-09-16 Planning").outcome, "present", link);
    }
    // The note link at the end, by name, by path and to a heading
    for (const link of ["[[2026-09-16 Planning|⋯]]", "[[Projects/Studio/logs/2026-09-16 Planning|⋯]]", "[[2026-09-16 Planning#Notes|⋯]]"]) {
        const day = DAY.replace("Planning ℹ️ [[", `Planning ℹ️ ${link} [[`);
        assert.equal(record(day, "2026-09-16 Planning").outcome, "present", link);
    }
});

test("a task that links the log with ⋯ or ↗ isn't the event line: the event still gets linked", () => {
    for (const mark of ["⋯", "↗"]) {
        const day = note("- [<] 4:00pm\tPlanning", "\t- 4:30pm", `- [ ] Send the deck [[2026-09-16 Planning|${mark}]]`, "- [ ] Planning [[2026-09-16 Planning|⋯]]");
        const { text: after, outcome } = record(day, "2026-09-16 Planning");
        assert.equal(outcome, "linked", mark);
        assert.equal(after, day.replace("\tPlanning", "\tPlanning [[2026-09-16 Planning|⋯]]"), mark);
    }
});

test("a title the log's title is a prefix of: linked when one line could be meant, keeping the line's own title as the alias", () => {
    const one = note("- [<] 9:00am\tStandup - Design review", "\t- 9:15am");
    assert.equal(record(one, "2026-09-16 Standup").text, one.replace("\tStandup - Design review", "\tStandup - Design review [[2026-09-16 Standup|⋯]]"));
    // Two candidates: neither is linked, and the log gets its own line
    const two = note("- [<] 9:00am\tStandup - Design review", "\t- 9:15am", "- [<] 10:00am\tStandup - Eng", "\t- 10:15am");
    const { text: after, outcome } = record(two, "2026-09-16 Standup");
    assert.equal(outcome, "inserted");
    assert.equal(after, note("- [<] 9:00am\tStandup - Design review", "\t- 9:15am", "- [<] 10:00am\tStandup - Eng", "\t- 10:15am", "- [<] Standup [[2026-09-16 Standup|⋯]]"));
    // An exact match wins over a prefix match
    const both = note("- [<] 9:00am\tStandup - Design review", "- [<] 10:00am\tStandup");
    assert.equal(record(both, "2026-09-16 Standup").text, note("- [<] 9:00am\tStandup - Design review", "- [<] 10:00am\tStandup [[2026-09-16 Standup|⋯]]"));
});

test("not the event line: a task with the same text, a canceled event, a title with a link in it, a line linked to another log", () => {
    const day = note(
        "- [-] 4:00pm\tPlanning",
        "\t- 4:30pm",
        "- [<] 5:00pm\tPlanning with [[Imogen Fenwick]]",
        "- [<] 6:00pm\t[[2026-09-16 Other|Planning]]",
        "- [<] 7:00pm\tPlanning [[2026-09-16 Another|⋯]]",
        "- [ ] Planning",
    );
    const { text: after, outcome } = record(day, "2026-09-16 Planning");
    assert.equal(outcome, "inserted");
    assert.equal(after, day.replace("- [ ] Planning", "- [<] Planning [[2026-09-16 Planning|⋯]]\n- [ ] Planning"));
});

test("two lines with the title: `time` picks the one with that start; without it, the first", () => {
    const day = note("- [<] 9:00am\tPlanning", "\t- 9:30am", "- [<] 4:00pm\tPlanning", "\t- 4:30pm");
    assert.equal(record(day, "2026-09-16 Planning", { time: "4:00pm" }).text, day.replace("4:00pm\tPlanning", "4:00pm\tPlanning [[2026-09-16 Planning|⋯]]"));
    assert.equal(record(day, "2026-09-16 Planning", { time: "4:00 PM" }).text, day.replace("4:00pm\tPlanning", "4:00pm\tPlanning [[2026-09-16 Planning|⋯]]"));
    assert.equal(record(day, "2026-09-16 Planning").text, day.replace("9:00am\tPlanning", "9:00am\tPlanning [[2026-09-16 Planning|⋯]]"));
    // A time no line has: the log gets its own line
    assert.equal(record(day, "2026-09-16 Planning", { time: "1:00pm" }).outcome, "inserted");
});

test("regex characters in the title are literal", () => {
    const day = note("- [<] 5:00pm\tBoard call (Q3)", "\t- 5:45pm");
    assert.equal(record(day, "2026-09-16 Board call (Q3)").text, day.replace("\tBoard call (Q3)", "\tBoard call (Q3) [[2026-09-16 Board call (Q3)|⋯]]"));
    assert.equal(record(record(day, "2026-09-16 Board call (Q3)").text, "2026-09-16 Board call (Q3)").outcome, "present");
});

// ------------------------------------------------------------------ adding a line

test("no line for the log: a [<] line with no time goes after the timed events, above the tasks", () => {
    const { text: after, outcome } = record(DAY, "2026-09-16 Retro");
    assert.equal(outcome, "inserted");
    assert.equal(after, DAY.replace("- [ ] A task", "- [<] Retro [[2026-09-16 Retro|⋯]]\n- [ ] A task"));
    // A second one goes after the first, and a timed event the sync inserts later goes above both
    const two = record(after, "2026-09-16 Wrap-up").text;
    assert.equal(two, after.replace("- [ ] A task", "- [<] Wrap-up [[2026-09-16 Wrap-up|⋯]]\n- [ ] A task"));
    const synced = sync.insert(two.split("\n"), ["- [<] 5:00pm\tDrinks", "\t- 6:00pm"]);
    assert.equal(synced, two.replace("- [<] Retro [[", "- [<] 5:00pm\tDrinks\n\t- 6:00pm\n- [<] Retro [["));
});

test("a note with tasks but no events, or with no checklist at all, or empty", () => {
    const tasks = note("- [ ] A task", "- [x] Another");
    assert.equal(record(tasks, "2026-09-16 Retro").text, note("- [<] Retro [[2026-09-16 Retro|⋯]]", "- [ ] A task", "- [x] Another"));
    const prose = note("", "## Notes", "- a thought");
    assert.equal(record(prose, "2026-09-16 Retro").text, note("- [<] Retro [[2026-09-16 Retro|⋯]]", "", "## Notes", "- a thought"));
    assert.equal(record("", "2026-09-16 Retro").text, "- [<] Retro [[2026-09-16 Retro|⋯]]\n");
});

test("a daily note just created from its template: the line goes at the end, after the template's code", () => {
    const template = "<%*\ntR += \"---\\naliases: x\\n---\"\n%>";
    const { text: after, outcome } = recordEvent(template, { log: "2026-09-16 Retro", title: "Retro" }, sync, true);
    assert.equal(outcome, "inserted");
    assert.equal(after, `${template}\n- [<] Retro [[2026-09-16 Retro|⋯]]\n`);
    assert.equal(recordEvent("", { log: "2026-09-16 Retro", title: "Retro" }, sync, true).text, "- [<] Retro [[2026-09-16 Retro|⋯]]\n");
});

test("no title (a name that's only the date): nothing is written", () => {
    assert.deepEqual(recordEvent(DAY, { log: "2026-09-16", title: "" }, sync), { text: DAY, outcome: "skipped", line: null });
});

// ------------------------------------------------------------------ from the review of the diff

test("a bare link to the log on a task or in prose isn't its line (you clicked it to make the note): the event line still gets linked", () => {
    const day = note("- [<] 3:00pm\tPrinter call", "\t- 3:30pm", "- [ ] prep [[2026-09-18 Printer call]]", "", "## Notes", "- see [[2026-09-18 Printer call]]");
    const { text: after, outcome } = record(day, "2026-09-18 Printer call");
    assert.equal(outcome, "linked");
    assert.equal(after, day.replace("\tPrinter call", "\tPrinter call [[2026-09-18 Printer call|⋯]]"));
    // But an event line's log link counts wherever the marker came from, a forwarded event included,
    // at the end of the line or (from before OBS-57) around the title
    for (const line of [
        "- [-] 3:00pm\tPrinter call [[2026-09-18 Printer call|⋯]]",
        "- [>] [[2026-09-19|9/19]] 3:00pm\tPrinter call [[2026-09-18 Printer call|⋯]] [[Pinecone Studio|⭕]]",
        "- [<] Printer call [[2026-09-18 Printer call|⋯]]",
        "- [-] 3:00pm\t[[2026-09-18 Printer call|Printer call]]",
        "- [>] [[2026-09-19|9/19]] 3:00pm\t[[2026-09-18 Printer call|Printer call]] [[Pinecone Studio|⭕]]",
        "- [<] [[2026-09-18 Printer call|Printer call]]",
    ]) {
        assert.equal(record(note(line), "2026-09-18 Printer call").outcome, "present", line);
    }
});

test("a [<] line you typed with no time links too, so the sync can adopt it later", () => {
    const day = note("- [<] 3:00pm\tStandup", "\t- 3:30pm", "- [<] Printer call", "- [ ] A task");
    assert.equal(record(day, "2026-09-18 Printer call").text, day.replace("- [<] Printer call", "- [<] Printer call [[2026-09-18 Printer call|⋯]]"));
    // With a time to match, a timeless line isn't it
    assert.equal(record(day, "2026-09-18 Printer call", { time: "4:00pm" }).outcome, "inserted");
});

test("the title but for case links; a timeless line matches by prefix like a timed one", () => {
    const day = note("- [<] 3:00pm\tprinter call", "\t- 3:30pm");
    assert.equal(record(day, "2026-09-18 Printer call").text, day.replace("\tprinter call", "\tprinter call [[2026-09-18 Printer call|⋯]]"));
    const two = note("- [<] Printer call with the rep");
    assert.equal(record(two, "2026-09-18 Printer call").text, note("- [<] Printer call with the rep [[2026-09-18 Printer call|⋯]]"));
});

test("a note that still opens with its template's code is treated as fresh, whatever the flag says", () => {
    const template = "<%*\ntR += \"---\\naliases: x\\n---\"\n%>";
    assert.equal(record(template, "2026-09-16 Retro").text, `${template}\n- [<] Retro [[2026-09-16 Retro|⋯]]\n`);
});

// ------------------------------------------------------------------ the line's ⭕ files the log (OBS-57 fix round 1)

test("the event line it matched comes back, so the Log template can read its ⭕; none for a line it adds", () => {
    const day = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "\t- 4:30pm", "- [<] 5:00pm\tRetro [[2026-09-16 Retro|⋯]] [[Hawk Ledger|⭕]]");
    assert.equal(record(day, "2026-09-16 Planning").line, "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]]", "linked");
    assert.equal(record(day, "2026-09-16 Retro").line, "- [<] 5:00pm\tRetro [[2026-09-16 Retro|⋯]] [[Hawk Ledger|⭕]]", "present");
    assert.equal(record(day, "2026-09-16 Wrap-up").line, null, "inserted");
});

test("home: the line names the project the log was filed in, in place of its own ⭕ links, before the ⋯, linked, present or inserted (OBS-90)", () => {
    const record = (text, home) => recordEvent(text, { log: "2026-09-16 Planning", title: "Planning", home }, sync);
    const day = note("- [<] 4:00pm\tPlanning 🆓 [[Pinecone Studio|⭕]] [[Hawk Ledger|⭕]]", "\t- 4:30pm");
    const linked = record(day, "[[Hawk Ledger|⭕]]");
    assert.equal(linked.outcome, "linked");
    assert.equal(linked.text, note("- [<] 4:00pm\tPlanning 🆓 [[Hawk Ledger|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"));
    // Already present, in either order: the ⭕ is set and comes before the ⋯
    for (const line of ["- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]", "- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]"]) {
        const present = record(note(line, "\t- 4:30pm"), "[[Household|🗃️]]");
        assert.equal(present.outcome, "present", line);
        assert.equal(present.text, note("- [<] 4:00pm\tPlanning [[Household|🗃️]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"), line);
    }
    // The line already names it: the note is left exactly as it was, and so it is with no home (Esc)
    const agreed = note("- [<] 4:00pm\tPlanning [[Pinecone Studio|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm");
    assert.equal(record(agreed, "[[Pinecone Studio|⭕]]").text, agreed);
    const older = note("- [<] 4:00pm\tPlanning [[2026-09-16 Planning|⋯]] [[Pinecone Studio|⭕]]", "\t- 4:30pm");
    assert.equal(record(older, null).text, older);
    // A line with no ⭕ gets it; so does a line that's added
    assert.equal(record(note("- [<] 4:00pm\tPlanning", "\t- 4:30pm"), "[[Tin|⭕]]").text, note("- [<] 4:00pm\tPlanning [[Tin|⭕]] [[2026-09-16 Planning|⋯]]", "\t- 4:30pm"));
    const added = record(note("- [ ] A task"), "[[Tin|⭕]]");
    assert.equal(added.outcome, "inserted");
    assert.equal(added.text, note("- [<] Planning [[Tin|⭕]] [[2026-09-16 Planning|⋯]]", "- [ ] A task"));
});

test("an event typed by hand with a space after its time is found by its title, and by its time (fix round 5)", () => {
    const day = note("- [<] 3:00pm Quick sync [[Household|🗃️]]", "- [<] 4:00pm Quick sync", "- [ ] A task");
    const linked = recordEvent(day, { log: "2026-09-27 Quick sync", title: "Quick sync", home: "[[Household|🗃️]]" }, sync);
    assert.equal(linked.outcome, "linked");
    assert.equal(linked.line, "- [<] 3:00pm Quick sync [[Household|🗃️]]");
    assert.equal(linked.text, note("- [<] 3:00pm Quick sync [[Household|🗃️]] [[2026-09-27 Quick sync|⋯]]", "- [<] 4:00pm Quick sync", "- [ ] A task"));
    assert.equal(recordEvent(day, { log: "2026-09-27 Quick sync", title: "Quick sync", time: "4:00pm" }, sync).line, "- [<] 4:00pm Quick sync");
});

test("a block ID at the end of an event line: found, and kept last (OBS-90 review)", () => {
    const day = note("- [<] 2:00pm\tReview [[Hawk|⭕]] ^mtg1", "\t- 3:00pm");
    const linked = recordEvent(day, { log: "2026-09-16 Review", title: "Review" }, sync);
    assert.equal(linked.outcome, "linked");
    assert.equal(linked.text, note("- [<] 2:00pm\tReview [[Hawk|⭕]] [[2026-09-16 Review|⋯]] ^mtg1", "\t- 3:00pm"));
    const present = recordEvent(linked.text, { log: "2026-09-16 Review", title: "Review", home: "[[Hawk|⭕]]" }, sync);
    assert.deepEqual([present.outcome, present.text], ["present", linked.text], "no second line for it");
    // Taking a ⭕ off keeps a 🆓 a word of its own
    const freed = recordEvent(note("- [<] 2:00pm\tReview [[Old|⭕]]🆓 [[2026-09-16 Review|⋯]]"), { log: "2026-09-16 Review", title: "Review", home: "[[Hawk|⭕]]" }, sync);
    assert.equal(freed.text, note("- [<] 2:00pm\tReview 🆓 [[Hawk|⭕]] [[2026-09-16 Review|⋯]]"));
});
