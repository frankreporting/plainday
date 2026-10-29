// Tests for CustomJS/addProjectLink.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm beside AddTaskNote, whose pure helpers it uses through `customJS`,
// the way CustomJS evaluates them; only the methods that don't touch `app` are tested. The menu,
// the move and the write into the editor are checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const context = vm.createContext({ customJS: {} });
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8") + `\n;${name}`, context);
const AddTaskNote = load("addTaskNote.js", "AddTaskNote");
context.customJS.AddTaskNote = new AddTaskNote();
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

test("placed: a ⭕ the line already has is replaced, wherever it was, and several become one", () => {
    assert.equal(cmd.placed("- [ ] Order toner [[Tin Works|⭕]]", P), "- [ ] Order toner [[Hawk Ledger|⭕]]");
    assert.equal(cmd.placed("- [ ] [[Tin Works|⭕]] Order toner", P), "- [ ] Order toner [[Hawk Ledger|⭕]]", "a ⭕ before the text moves to the end");
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

test("taskLinkpath: the first ⋯ link's target; a heading is dropped; other links aren't task notes", () => {
    assert.equal(cmd.taskLinkpath("- [ ] Order toner [[Order toner|⋯]]"), "Order toner");
    assert.equal(cmd.taskLinkpath("- [ ] A [[Projects/Hawk/Order toner|⋯]] [[B|⋯]]"), "Projects/Hawk/Order toner");
    assert.equal(cmd.taskLinkpath("- [ ] A [[Order toner#Notes|⋯]]"), "Order toner");
    assert.equal(cmd.taskLinkpath("- [ ] A [[Order toner|↗\uFE0F]]"), "Order toner", "a ↗ with U+FE0F, on a line with no ⋯");
    assert.equal(cmd.taskLinkpath("- [ ] A [[Hawk Ledger|⭕]] [[2026-09-30|🚩 9/30]]"), null);
    // An event's title link is its meeting log, the event's own note (OBS-36)
    assert.equal(cmd.taskLinkpath("- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff call]]"), "2026-09-15 Kickoff call");
    assert.equal(cmd.taskLinkpath("- [<] All day\t[[Projects/Hawk/logs/2026-09-15 Offsite|Offsite]] [[Hawk Ledger|⭕]]"), "Projects/Hawk/logs/2026-09-15 Offsite");
    assert.equal(cmd.taskLinkpath("- [<] 1:30pm\tKickoff call [[Hawk Ledger|⭕]]"), null, "a plain event title");
    // A log's line written before its event arrives has no time yet (the Log template, OBS-10)
    assert.equal(cmd.taskLinkpath("- [<] [[2026-09-18 Printer call|Printer call]]"), "2026-09-18 Printer call");
    assert.equal(cmd.taskLinkpath("- [<] [[2026-09-18 Printer call|Printer call]] [[Hawk Ledger|⭕]]"), "2026-09-18 Printer call");
    assert.equal(cmd.relinked("- [<] [[2026-09-18 Printer call|Printer call]]", "P/logs/2026-09-18 Printer call"), "- [<] [[P/logs/2026-09-18 Printer call|Printer call]]");
    assert.equal(cmd.taskLinkpath("- [x] [[2026-09-18 Printer call|Printer call]]"), null, "a task that starts with a link still isn't an event");
    // A log is named with its date first; a title that only starts with a link isn't a log's
    assert.equal(cmd.taskLinkpath("- [<] 12:00pm\t[[Rafe Oakes|@Rafe]] lunch"), null);
    assert.equal(cmd.taskLinkpath("- [<] [[Rafe Oakes|@Rafe]] lunch"), null);
    assert.equal(cmd.taskLinkpath("- [x] 9:00am [[Hawk Ledger|⭕]] call about it [[Call notes|⋯]]"), "Call notes", "a task with a time in its text keeps its ⋯");
    assert.equal(cmd.taskLinkpath("- [ ] [[Some note|Some]] task"), null, "a task starting with a link isn't an event");
    assert.ok(cmd.sameButTaskLink("- [<] 1:30pm\t[[Projects/Hawk/logs/2026-09-15 Kickoff call|Kickoff call]]", "- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff call]]"), "a moved log's rewritten link is the same line");
    assert.ok(!cmd.sameButTaskLink("- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff]]", "- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff call]]"), "but not an edited title");
    assert.equal(cmd.taskLinkpath("- [ ] A [[|⋯]]"), null, "an empty link");
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

test("AddProjectLink is registered as a command, and shares AddTaskNote's menu, move and confirm", () => {
    const settings = JSON.parse(fs.readFileSync(new URL("../../../.obsidian/plugins/customjs/data.json", here), "utf8"));
    assert.ok(settings.registeredInvocableScriptNames.includes("AddProjectLink"));
    const source = fs.readFileSync(new URL("../CustomJS/addProjectLink.js", here), "utf8");
    assert.match(source, /helper\.pickHome\(this\.label\(lineText\), \[\]\)/, "the same project-or-area menu");
    assert.match(source, /helper\.confirmMove\(note, noteHome, home\)/, "asks before moving a note out of a project or area");
    assert.match(source, /helper\.moveInto\(note, home, \{ line \}\)/, "the other lines that link the note follow it; this line is its own");
    for (const method of ["homeOf", "confirmMove", "moveInto", "pickHome", "isHome", "withoutLinks", "projectLinks", "linktextFor", "afterCheckbox", "cancelled"]) {
        assert.equal(typeof context.customJS.AddTaskNote[method], "function", method);
    }
});

test("relinked: the line's note link points at another note, alias kept (a same-named note already in the picked project)", () => {
    assert.equal(cmd.relinked("- [ ] Renew the car [[Renew the car|⋯]]", "Projects/Household/Renew the car"), "- [ ] Renew the car [[Projects/Household/Renew the car|⋯]]");
    assert.equal(cmd.relinked("- [ ] A [[Inbox/A|⋯]] [[2026-09-30|🚩 9/30]]", "A"), "- [ ] A [[A|⋯]] [[2026-09-30|🚩 9/30]]", "a path link back to a plain name");
    assert.equal(cmd.relinked("- [ ] A [[A|↗\uFE0F]]", "P/A"), "- [ ] A [[P/A|↗\uFE0F]]", "a ↗ with U+FE0F, on a line with no ⋯");
    assert.equal(cmd.relinked("- [<] 1:30pm\t[[2026-09-15 Kickoff call|Kickoff call]] [[Hawk Ledger|⭕]]", "P/logs/2026-09-15 Kickoff call"),
        "- [<] 1:30pm\t[[P/logs/2026-09-15 Kickoff call|Kickoff call]] [[Hawk Ledger|⭕]]", "an event's title link keeps its alias");
    assert.equal(cmd.relinked("- [ ] No link here", "A"), "- [ ] No link here");
});

test("⋯ and ↗ (OBS-208), with or without a phone's U+FE0F, are both a line's note link; an event's log at the end is its note (OBS-57)", () => {
    for (const mark of ["⋯", "↗", "↗\uFE0F"]) {
        assert.equal(cmd.taskLinkpath(`- [ ] Order toner [[Order toner|${mark}]]`), "Order toner", mark);
        assert.equal(cmd.relinked(`- [ ] A [[A|${mark}]]`, "P/A"), `- [ ] A [[P/A|${mark}]]`, mark);
        assert.equal(cmd.label(`- [ ] Order toner [[Order toner|${mark}]] [[Hawk Ledger|⭕]]`), "Order toner", mark);
        assert.ok(cmd.sameButTaskLink(`- [ ] A [[P/A|${mark}]]`, `- [ ] A [[A|${mark}]]`), mark);
    }
    const ev = "- [<] 1:30pm\tKickoff call [[2026-09-15 Kickoff call|⋯]] [[Hawk Ledger|⭕]]";
    assert.equal(cmd.taskLinkpath(ev), "2026-09-15 Kickoff call");
    assert.equal(cmd.label(ev), "Kickoff call");
    assert.equal(cmd.relinked(ev, "P/logs/2026-09-15 Kickoff call"), "- [<] 1:30pm\tKickoff call [[P/logs/2026-09-15 Kickoff call|⋯]] [[Hawk Ledger|⭕]]");
    assert.equal(cmd.taskLinkpath("- [<] Printer call [[2026-09-18 Printer call|⋯]]"), "2026-09-18 Printer call", "a log's line with no time yet");
    assert.equal(cmd.placed("- [<] 1:30pm\tKickoff call [[2026-09-15 Kickoff call|⋯]]", P), `- [<] 1:30pm\tKickoff call ${P} [[2026-09-15 Kickoff call|⋯]]`, "a log not made yet: the ⭕ goes before its link");
});
