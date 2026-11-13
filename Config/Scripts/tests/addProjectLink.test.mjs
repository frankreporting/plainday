// Tests for plugin/src/classes/addProjectLink.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm beside AddTaskNote, whose pure helpers it uses through `plainday`;
// only the methods that don't touch `app` are tested. The menu,
// the move and the write into the editor are checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { classScript, readIndex } from "../../../plugin/classShape.mjs";
const { COMMANDS } = readIndex("commands").exports;

const here = new URL(".", import.meta.url);
const context = vm.createContext({ plainday: {} });
const load = (file, name) => vm.runInContext(classScript(`${file}`) + `\n;${name}`, context);
const AddTaskNote = load("addTaskNote.js", "AddTaskNote");
context.plainday.AddTaskNote = new AddTaskNote();
const AddProjectLink = load("addProjectLink.js", "AddProjectLink");
const cmd = new AddProjectLink();
const P = "[[Hawk Ledger|⭕]]";

test("placed: the ⭕ ends a line that has no ⋯, with no trailing space", () => {
    assert.equal(cmd.placed("- [ ] Order toner", P), "- [ ] Order toner [[Hawk Ledger|⭕]]");
    assert.equal(cmd.placed("- [ ] Order toner   ", P), "- [ ] Order toner [[Hawk Ledger|⭕]]", "trailing spaces closed up");
    assert.equal(cmd.placed("\t- [/] Order toner [[2026-09-30|🚩 9/30]]", P), "\t- [/] Order toner [[2026-09-30|🚩 9/30]] [[Hawk Ledger|⭕]]", "after a due date, indent kept");
    assert.equal(cmd.placed("- [ ] ", P), "- [ ] [[Hawk Ledger|⭕]]", "an empty task");
    // A path link text, when the project's name isn't unique
    assert.equal(cmd.placed("- [ ] A", "[[Projects/Freelance/Hawk Ledger/Hawk Ledger|⭕]]"), "- [ ] A [[Projects/Freelance/Hawk Ledger/Hawk Ledger|⭕]]");
});

test("placed: on an event line the ⭕ ends the line, after the title, a log link or the free mark, as the sync reads it", () => {
    assert.equal(cmd.placed("- [<] 9:00am\tTeam standup", P), "- [<] 9:00am\tTeam standup [[Hawk Ledger|⭕]]");
    assert.equal(cmd.placed("- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff call]]", P), "- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff call]] [[Hawk Ledger|⭕]]");
    assert.equal(cmd.placed("- [<] 3:00pm\tDelivery window ℹ️", P), "- [<] 3:00pm\tDelivery window ℹ️ [[Hawk Ledger|⭕]]");
    assert.equal(cmd.placed("- [<] All day\tConference ", P), "- [<] All day\tConference [[Hawk Ledger|⭕]]");
});

test("placed: with a note link at the end the ⭕ goes before it, so the note link stays last (OBS-90)", () => {
    assert.equal(cmd.placed("- [ ] Order toner [[Order toner|⋯]]", P), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]");
    assert.equal(cmd.placed("- [ ] Order toner [[Tin Works|⭕]] [[Order toner|⋯]]", P), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]");
    assert.equal(cmd.placed("- [ ] Order toner [[Order toner|⋯]] [[Tin Works|⭕]]", P), "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]", "the older order comes out in the new one");
    assert.equal(cmd.placed("- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Order toner|⋯]]", P), "- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Hawk Ledger|⭕]] [[Order toner|⋯]]", "after a due date");
    assert.equal(cmd.placed("- [<] 1:30pm\tKickoff call ℹ️ [[2026-09-15 Kickoff call|⋯]]", P), "- [<] 1:30pm\tKickoff call ℹ️ [[Hawk Ledger|⭕]] [[2026-09-15 Kickoff call|⋯]]", "an event's log");
    const same = "- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]]";
    assert.equal(cmd.placed(same, P), same, "already so: unchanged");
});

test("placed: a ⭕ in the run that ends the line is replaced, and several become one", () => {
    assert.equal(cmd.placed("- [ ] Order toner [[Tin Works|⭕]]", P), "- [ ] Order toner [[Hawk Ledger|⭕]]");
    assert.equal(cmd.placed("- [ ] [[Tin Works|⭕]] Order toner", P), "- [ ] [[Tin Works|⭕]] Order toner [[Hawk Ledger|⭕]]", "one in the text is part of the title");
    assert.equal(cmd.placed("- [ ] A [[Tin Works|⭕]] [[Other|⭕]]", P), "- [ ] A [[Hawk Ledger|⭕]]");
    assert.equal(cmd.placed("- [<] 9:00am\tStandup [[Tin Works|⭕]]", P), "- [<] 9:00am\tStandup [[Hawk Ledger|⭕]]");
    // The same project again: the line comes back as it was, which invoke reads as "already linked"
    const same = "- [ ] Order toner [[Hawk Ledger|⭕]]";
    assert.equal(cmd.placed(same, P), same);
    assert.equal(cmd.placed("- [<] 9:00am\tStandup [[Hawk Ledger|⭕]]", P), "- [<] 9:00am\tStandup [[Hawk Ledger|⭕]]");
});

test("placed: an area gets its own suffix, 🗃️, and either kind replaces the other", () => {
    const A = "[[Household|🗃️]]";
    assert.equal(cmd.placed("- [x] Water the tomato beds", A), "- [x] Water the tomato beds [[Household|🗃️]]");
    assert.equal(cmd.placed("- [x] Water the tomato beds [[Hawk Ledger|⭕]]", A), "- [x] Water the tomato beds [[Household|🗃️]]", "a project link replaced by an area");
    assert.equal(cmd.placed("- [x] Water the tomato beds [[Household|🗃️]]", P), "- [x] Water the tomato beds [[Hawk Ledger|⭕]]", "an area link replaced by a project");
    assert.equal(cmd.placed("- [<] 7:30am\tRun [[Household|🗃]]", A), "- [<] 7:30am\tRun [[Household|🗃️]]", "without U+FE0F it's still the area link");
    assert.equal(cmd.placed("- [x] Water the tomato beds [[Household|🗃️]]", A), "- [x] Water the tomato beds [[Household|🗃️]]", "the same area again: unchanged");
    assert.equal(cmd.label("- [<] 7:30am\tRun [[Household|🗃️]]"), "Run");
});

test("label: the line's text for the menu, without checkbox, event time or symbol links", () => {
    assert.equal(cmd.label("- [ ] Order toner [[Hawk Ledger|⭕]] [[Order toner|⋯]] [[2026-09-30|🚩 9/30]]"), "Order toner");
    assert.equal(cmd.label("\t- [/] Order toner"), "Order toner");
    assert.equal(cmd.label("- [<] 9:00am\tTeam standup [[Hawk Ledger|⭕]]"), "Team standup");
    assert.equal(cmd.label("- [<] All day\tConference"), "Conference");
    assert.equal(cmd.label("- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff call]]"), "Kickoff call", "a log link reads as its alias");
    assert.equal(cmd.label("- [ ] Read [[Some note]] again"), "Read Some note again");
    assert.equal(cmd.label("- [ ] "), "");
});

test("AddProjectLink is registered as a command, and goes through the shared change code", () => {
    assert.ok(COMMANDS.some((c) => c.script === "AddProjectLink"));
    const source = classScript("addProjectLink.js");
    assert.match(source, /helper\.pickHome\(this\.label\(lineText\), /, "the same project-or-area menu");
    assert.match(source, /change\.run\(found, home, /, "the question, the refusal and the write are TaskChange's");
    assert.doesNotMatch(source, /renameFile|replaceRange/, "and it writes nothing itself");
});

test("⋯ and ↗ (OBS-208), with or without a phone's U+FE0F, stay out of the menu's label; an event's log at the end is its note (OBS-57)", () => {
    for (const mark of ["⋯", "↗", "↗\uFE0F"]) {
        assert.equal(cmd.label(`- [ ] Order toner [[Order toner|${mark}]] [[Hawk Ledger|⭕]]`), "Order toner", mark);
    }
    const ev = "- [<] 1:30pm\tKickoff call [[2026-09-15 Kickoff call|⋯]] [[Hawk Ledger|⭕]]";
    assert.equal(cmd.label(ev), "Kickoff call");
    assert.equal(cmd.placed("- [<] 1:30pm\tKickoff call [[2026-09-15 Kickoff call|⋯]]", P), `- [<] 1:30pm\tKickoff call ${P} [[2026-09-15 Kickoff call|⋯]]`, "a log not made yet: the ⭕ goes before its link");
});
