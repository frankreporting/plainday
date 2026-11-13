// Tests for plugin/src/classes/taskIds.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
// `plainday` defined and empty, as in the Raycast timer's sandbox: the classes read it bare
const TaskIds = vm.runInContext(classScript("taskIds.js") + "\n;TaskIds", vm.createContext({ plainday: {} }));
const plain = (x) => JSON.parse(JSON.stringify(x));
const F = "[[2026-10-08#^k3x9m2|10/8]]";

test("idOf, withId, withoutId: the ID ends the line; one already there is the task's", () => {
    assert.equal(TaskIds.idOf("- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2"), "k3x9m2");
    assert.equal(TaskIds.idOf("- [ ] Book the photographer ^Ab3-x9 "), "Ab3-x9", "Copy link to block's own, trailing space and all");
    assert.equal(TaskIds.idOf("- [ ] x^2 is not an ID"), null);
    assert.equal(TaskIds.idOf("- [ ] Mid ^k3x9m2 text"), null, "text after it: Obsidian doesn't read it");
    assert.equal(TaskIds.withId("- [ ] Book it  ", "k3x9m2"), "- [ ] Book it ^k3x9m2");
    assert.equal(TaskIds.withId("- [ ] Book it ^Ab3-x9", "k3x9m2"), "- [ ] Book it ^Ab3-x9", "never replaced");
    assert.equal(TaskIds.withoutId("- [ ] Book it [[K|⭕]] ^k3x9m2"), "- [ ] Book it [[K|⭕]]");
});

test("newId: six letters and digits, never one already taken", () => {
    const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const id = TaskIds.newId(new Set(["aaaaaa"]), () => seq[i++]);
    assert.equal(id, "ssssss", "the first draw, aaaaaa, is taken");
    assert.match(TaskIds.newId(new Set()), /^[a-z0-9]{6}$/);
});

test("forwardLink and forwardOf: the forward date names the note and the task's line, with just its date", () => {
    assert.equal(TaskIds.forwardLink("2026-10-08", "10/8", "k3x9m2"), F);
    assert.equal(TaskIds.forwardLink("Reference/Planner/months/2026-10", "Oct. 2026", "k3x9m2"), "[[Reference/Planner/months/2026-10#^k3x9m2|Oct. 2026]]");
    assert.deepEqual(plain(TaskIds.forwardOf(`- [>] Book it ${F} [[K|⭕]] ^k3x9m2`)), { raw: F, linkpath: "2026-10-08", id: "k3x9m2", label: "10/8" });
    assert.equal(TaskIds.forwardOf("- [>] Book it [[2026-10-08|10/8]]"), null, "a date link without the line's ID isn't one");
    assert.equal(TaskIds.forwardOf(`- [>] ${F} is in the text`), null, "only the run that ends the line counts");
    // Known by its target: a periodic note, by name or path, and a line's ID; any alias
    for (const [link, linkpath, label] of [
        ["[[2026w41#^k3x9m2|Wk of 10/4]]", "2026w41", "Wk of 10/4"],
        ["[[2026-W41#^k3x9m2|Wk of 10/5]]", "2026-W41", "Wk of 10/5"],
        ["[[2026-10#^k3x9m2|Oct. 2026]]", "2026-10", "Oct. 2026"],
        ["[[2027#^k3x9m2|2027]]", "2027", "2027"],
        ["[[Reference/Planner/days/2026-10-08#^k3x9m2|10/8]]", "Reference/Planner/days/2026-10-08", "10/8"],
    ]) assert.deepEqual(plain(TaskIds.forwardOf(`- [>] Book it ${link} ^k3x9m2`)), { raw: link, linkpath, id: "k3x9m2", label }, link);
    assert.equal(TaskIds.forwardOf("- [>] Book it [[Brief#^k3x9m2|see]] ^k3x9m2"), null, "a block link to a note that isn't a periodic one");
    // Only with a label Schedule writes: a day, a week, a month (any locale's short name) or a year
    for (const label of ["May 2026", "févr. 2026", "Sept. 2026", "10月 2026", "10月. 2026", "10월 2026"]) assert.equal(TaskIds.forwardOf(`- [>] Book it [[2026-09#^k3x9m2|${label}]] ^k3x9m2`)?.label, label, label);
    assert.equal(TaskIds.forwardOf("- [>] Book it [[2026-09#^k3x9m2|Q3 budget 2026]] ^k3x9m2"), null, "a month label is one word and the year, never more");
    // A block link of your own to a day's line isn't one, ending the text or ahead of the real one
    assert.equal(TaskIds.forwardOf("- [ ] Follow up on [[2026-09-15#^abc123|the call]]"), null);
    assert.equal(TaskIds.forwardOf("- [>] Recap [[2026-09-15#^abc123|the call]] [[2026-09-18#^q1w2e3|9/18]] ^q1w2e3")?.raw, "[[2026-09-18#^q1w2e3|9/18]]");
    assert.equal(TaskIds.withForward("- [ ] Follow up on [[2026-09-15#^abc123|the call]] ^q1w2e3", null), "- [ ] Follow up on [[2026-09-15#^abc123|the call]] ^q1w2e3", "kept");
    assert.equal(TaskIds.forwardOf("- [>] Book it [[2026-10-01|🚩 10/1]] ^k3x9m2"), null, "a due date");
    // One written with a ➡️ (before the forward date lost it) is still read, its label without the ➡️
    assert.deepEqual(plain(TaskIds.forwardOf("- [>] Book it [[2026-10-08#^k3x9m2|➡️ 10/8]] ^k3x9m2")), { raw: "[[2026-10-08#^k3x9m2|➡️ 10/8]]", linkpath: "2026-10-08", id: "k3x9m2", label: "10/8" });
    assert.equal(TaskIds.forwardOf("- [>] Book it [[2026-10-08#^k3x9m2|➡ 10/8]] ^k3x9m2")?.label, "10/8", "a phone may drop the U+FE0F");
});

test("withForward: after the 🚩, before the ⭕, 🗃️ and ⋯, the ID last; replaced, never doubled", () => {
    assert.equal(TaskIds.withForward("- [>] Book it ^k3x9m2", F), `- [>] Book it ${F} ^k3x9m2`);
    assert.equal(TaskIds.withForward("- [>] Book it [[2026-10-01|🚩 10/1]] [[K|⭕]] [[Book it|⋯]] ^k3x9m2", F),
        `- [>] Book it [[2026-10-01|🚩 10/1]] ${F} [[K|⭕]] [[Book it|⋯]] ^k3x9m2`);
    assert.equal(TaskIds.withForward(`- [>] Book it [[K|⭕]] ${F} ^k3x9m2`, "[[2026-10-12#^k3x9m2|10/12]]"),
        "- [>] Book it [[2026-10-12#^k3x9m2|10/12]] [[K|⭕]] ^k3x9m2", "moved into place");
    assert.equal(TaskIds.withForward(`- [ ] Book it ${F} ^k3x9m2`, null), "- [ ] Book it ^k3x9m2", "null takes it off");
    assert.equal(TaskIds.withForward("- [>] Book it [[Household|🗃️]]", F), `- [>] Book it ${F} [[Household|🗃️]]`, "no ID: none added");
    assert.equal(TaskIds.withForward("- [>] Book it [[2026-10-06#^k3x9m2|➡️ 10/6]] [[K|⭕]] ^k3x9m2", F), `- [>] Book it ${F} [[K|⭕]] ^k3x9m2`, "one with a ➡️ is replaced too");
});

test("oldForward: the breadcrumb in front of a line sent before OBS-181, never an event's", () => {
    assert.deepEqual(plain(TaskIds.oldForward("- [>] [[2026-09-17|9/17]] Send final copy to Rafe")), { linkpath: "2026-09-17", label: "9/17", line: "- [>] Send final copy to Rafe" });
    assert.deepEqual(plain(TaskIds.oldForward("- [>] [[2026-09|Sep. 2026]] Collect member photos")), { linkpath: "2026-09", label: "Sep. 2026", line: "- [>] Collect member photos" });
    assert.deepEqual(plain(TaskIds.oldForward("- [>] [[2027]] Plan the spring sale")), { linkpath: "2027", label: "2027", line: "- [>] Plan the spring sale" });
    assert.equal(TaskIds.oldForward("- [>] [[Reference/Planner/weeks/2026w41|Wk of 10/4]] Book it")?.linkpath, "Reference/Planner/weeks/2026w41");
    assert.equal(TaskIds.oldForward("- [>] [[2026-09-20|9/20]] 1:00pm\tPlanning call"), null, "the calendar sync's forwarded event");
    assert.equal(TaskIds.oldForward("- [ ] Read [[2026-09-17|9/17]] first"), null);
    assert.equal(TaskIds.oldForward("- [ ] [[2026-09-17|9/17]] Read the brief"), null, "only a sent line: an open one's date is its title's");
    assert.equal(TaskIds.oldForward("- [>] [[2026-09-30|9/30]] Fair: book a stall [[2026-09-18#^k3x9m2|9/18]] ^k3x9m2"), null, "a line with a forward date: the date in front is its title's");
});

test("title: the text before the links, without breadcrumb, ID, case or extra spaces", () => {
    assert.equal(TaskIds.title("- [>] [[2026-09-17|9/17]] Send  Final copy [[P|⭕]] ^k3x9m2"), "send final copy");
    assert.equal(TaskIds.title("- [ ] Call [[Ana Pruitt]] about the proofs [[Kestrel|⭕]]"), "call ana pruitt about the proofs", "the whole title, links as their text");
    assert.notEqual(TaskIds.title("- [ ] Call [[Bo Lind|Bo]] about the invoice"), TaskIds.title("- [ ] Call [[Ana Pruitt]] about the proofs"));
});

test("setForwardIn: the line ending in the ID gets the forward date; an older breadcrumb on it comes off", () => {
    const text = ["## To Do", "", "- [>] [[2026-10-06|10/6]] Book it ^k3x9m2", "- [ ] Another ^zzzzzz", ""].join("\n");
    const out = TaskIds.setForwardIn(text, "k3x9m2", F);
    assert.equal(out.text, ["## To Do", "", `- [>] Book it ${F} ^k3x9m2`, "- [ ] Another ^zzzzzz", ""].join("\n"));
    assert.equal(out.changed, true);
    assert.equal(TaskIds.setForwardIn(out.text, "k3x9m2", F).changed, false, "already right: nothing to write");
    assert.equal(TaskIds.setForwardIn("- [>] Book it\r\n", "k3x9m2", F).changed, false, "no ID, no change");
    assert.equal(TaskIds.setForwardIn("- [ ] Book it ^k3x9m2", "k3x9m2", F).changed, false, "an open line with the ID is left alone");
    assert.equal(TaskIds.setForwardIn("- [>] Book it [[2026-10-06#^k3x9m2|➡️ 10/6]] ^k3x9m2", "k3x9m2", F).text, `- [>] Book it ${F} ^k3x9m2`, "one with a ➡️ is rewritten without it");
});

test("setForwardIn: top-level lines only, and with `reopen` a done or canceled line becomes [>] too (OBS-193, rules 5 and 13)", () => {
    assert.equal(TaskIds.setForwardIn("- [ ] Errands\n\t- [>] Book it ^k3x9m2\n", "k3x9m2", F).changed, false, "a nested line is a sub-task: its ID counts for nothing");
    const text = ["- [x] Book it [[2026-10-06#^k3x9m2|10/6]] ^k3x9m2", "- [-] Book it again ^k3x9m2", "- [>] Sent ^k3x9m2", "- [ ] Open ^k3x9m2", "\t- [x] Nested ^k3x9m2"].join("\n");
    assert.equal(TaskIds.setForwardIn(text, "k3x9m2", F).text, [`- [x] Book it ${F} ^k3x9m2`, `- [-] Book it again ${F} ^k3x9m2`, `- [>] Sent ${F} ^k3x9m2`, "- [ ] Open ^k3x9m2", "\t- [x] Nested ^k3x9m2"].join("\n"), "without reopen the boxes stay");
    assert.equal(TaskIds.setForwardIn(text, "k3x9m2", F, { reopen: true }).text, [`- [>] Book it ${F} ^k3x9m2`, `- [>] Book it again ${F} ^k3x9m2`, `- [>] Sent ${F} ^k3x9m2`, "- [ ] Open ^k3x9m2", "\t- [x] Nested ^k3x9m2"].join("\n"));
});

test("setForwardIn, review: a capital [X] source line is a finished one too (OBS-193)", () => {
    assert.equal(TaskIds.setForwardIn("- [X] Book it ^k3x9m2", "k3x9m2", F, { reopen: true }).text, `- [>] Book it ${F} ^k3x9m2`);
});

test("reopenIn: a task's done or canceled lines become [>], top-level lines only, nothing else on them touched (OBS-193, rule 13)", () => {
    const text = ["- [x] Book it [[K|⭕]]  ^k3x9m2", "\t- 9:00am - 9:30am", "\t- [x] Nested ^k3x9m2", "- [-] Again ^k3x9m2\r", "- [>] Sent ^k3x9m2", "- [ ] Open ^k3x9m2", "- [x] Other ^other1"].join("\n");
    const out = TaskIds.reopenIn(text, "K3X9M2");
    assert.equal(out.text, ["- [>] Book it [[K|⭕]]  ^k3x9m2", "\t- 9:00am - 9:30am", "\t- [x] Nested ^k3x9m2", "- [>] Again ^k3x9m2\r", "- [>] Sent ^k3x9m2", "- [ ] Open ^k3x9m2", "- [x] Other ^other1"].join("\n"));
    assert.equal(out.changed, true);
    assert.equal(TaskIds.reopenIn(out.text, "k3x9m2").changed, false, "nothing left to reopen");
});

import { standIn, PLANNER } from "./standInVault.mjs";
import { classScript } from "../../../plugin/classShape.mjs";

const D8 = `${PLANNER}/days/2026-10-08.md`;
const KES = "Projects/Freelance/Kestrel/Kestrel.md";
const LOOK = {
    [KES]: "---\ntags: [project]\n---\n## To Do\n\n- [>] Book the photographer [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2\n",
    [D8]: "- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2\n- [ ] Mixed [[Kestrel|⭕]] ^Ab3-x9\n- plain item ^plain1\n\nA paragraph with a block. ^para02\n",
    "Reference/Notes/Idea.md": "A paragraph with a block. ^para01\n",
    "Config/Templates/Task.md": "- [ ] From a template ^k3x9m2\n",
};
const at = (lines) => plain(lines.map((l) => `${l.file.path}:${l.line}:${l.task}`).sort());

test("linesOf: every line ending in the ID, from the cache, with its checkbox; Config and notes outside the system left out (OBS-208)", () => {
    const t = standIn({ notes: LOOK }).plainday.TaskIds;
    assert.deepEqual(at(t.linesOf("k3x9m2")), [`${KES}:5:>`, `${D8}:0: `]);
    assert.deepEqual(at(t.linesOf("Ab3-x9")), [`${D8}:1: `], "a mixed-case ID from Copy link to block");
    assert.equal(t.linesOf("plain1")[0].task, undefined, "a list item with no checkbox");
    assert.equal(t.linesOf("para02")[0].task, null, "a block that isn't a list item");
    assert.equal(t.linesOf("para01").length, 0, "a block in a note outside the system: no task's line is there");
    assert.equal(t.linesOf("nothin").length, 0);
});

test("gather: lines as they are now: open editors, and a note the caller names that the cache hasn't seen", async () => {
    const v = standIn({ notes: LOOK, open: D8, at: 0, lag: true });
    const t = v.plainday.TaskIds;
    const W = `${PLANNER}/weeks/2026w41.md`;
    v.tick();
    await v.app.vault.create(W, "- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2\n");
    v.tick();
    v.app.workspace.getActiveViewOfType().editor.replaceRange("/", { line: 0, ch: 3 }, { line: 0, ch: 4 });
    v.app.workspace.getActiveViewOfType().editor.replaceRange("- [ ] New line ^newid1\n", { line: 0, ch: 0 });
    assert.equal(t.linesOf("k3x9m2").some((l) => l.file.path === W), false, "the cache hasn't seen it yet");
    assert.equal(t.linesOf("newid1").length, 0, "nor the editor's new line");
    assert.doesNotMatch(await v.app.vault.cachedRead(v.app.vault.getFileByPath(D8)), /newid1/, "nor is it on disk");
    assert.deepEqual(at(await t.gather("newid1")), [`${D8}:0: `], "gather reads the open editor");
    assert.deepEqual(at(await t.gather("k3x9m2", [v.app.vault.getFileByPath(W)])), [`${KES}:5:>`, `${D8}:1:/`, `${W}:0: `]);
});

test("gather: top-level lines only; a nested line ending in the ID is a sub-task of the line it's under (OBS-193, rule 5)", async () => {
    const D9 = `${PLANNER}/days/2026-10-09.md`;
    const v = standIn({ notes: { ...LOOK, [D9]: "- [ ] Errands\n\t- [ ] Book the photographer ^k3x9m2\n- Plain\n\t- [ ] Under a plain bullet ^k3x9m2\n" } });
    assert.deepEqual(at(await v.plainday.TaskIds.gather("k3x9m2")), [`${KES}:5:>`, `${D8}:0: `, `${D9}:3: `], "a checklist line under nothing but plain bullets is top-level");
});

test("readNow: the open note's editor text, ahead of disk under lag", async () => {
    const v = standIn({ notes: LOOK, open: D8, at: 0, lag: true });
    v.app.workspace.getActiveViewOfType().editor.replaceRange("Typed. ", { line: 0, ch: 0 });
    const f = v.app.vault.getFileByPath(D8);
    assert.match(await v.plainday.TaskIds.readNow(f), /^Typed\. /);
    assert.doesNotMatch(await v.app.vault.cachedRead(f), /Typed/);
    v.tick();
    assert.match(await v.app.vault.cachedRead(f), /^Typed\. /, "saved at the next command");
});

test("stand-in vault: create on an existing path throws; a folder exists once made", async () => {
    const v = standIn({ notes: LOOK });
    await assert.rejects(v.app.vault.create(D8, "x"), /already exists/);
    assert.equal(v.app.vault.getFolderByPath("Reference/Nope"), null);
    await v.app.vault.createFolder("Reference/Nope");
    assert.ok(v.app.vault.getFolderByPath("Reference/Nope"));
    await assert.rejects(v.app.vault.createFolder("Reference/Nope"), /already exists/);
});

test("gather: a note a command just wrote is read for a few seconds, whatever the cache says", async () => {
    const v = standIn({ notes: LOOK, lag: true });
    const t = v.plainday.TaskIds;
    const M = `${PLANNER}/months/2026-10.md`;
    v.tick();
    t.touched(await v.app.vault.create(M, "- [ ] Book the photographer [[Kestrel|⭕]] ^k3x9m2\n"));
    v.tick();
    assert.ok((await t.gather("k3x9m2")).some((l) => l.file.path === M));
});

test("allIds and freshId: every list item's ID; a new one no block has", () => {
    const v = standIn({ notes: { ...LOOK, "Reference/Notes/Taken.md": "- [ ] Taken ^aaaaaa" } });
    const t = v.plainday.TaskIds;
    // The task checks read the notes in the system and Archive; Taken.md is in neither
    assert.deepEqual(plain([...t.allIds().keys()].sort()), ["ab3-x9", "k3x9m2", "plain1"]);
    let draws = 0;
    t.random = () => (draws++ < 6 ? 0 : 0.99);
    assert.equal(t.freshId(), "999999", "aaaaaa is taken, even outside the system, so the next draw");
});

test("kindOf: daily, weekly, monthly and yearly notes, and any other note", () => {
    const v = standIn({ notes: { ...LOOK, [`${PLANNER}/weeks/2026w41.md`]: "", [`${PLANNER}/months/2026-10.md`]: "" } });
    const k = (p) => v.plainday.TaskIds.kindOf(v.app.vault.getFileByPath(p));
    assert.deepEqual([k(D8), k(`${PLANNER}/weeks/2026w41.md`), k(`${PLANNER}/months/2026-10.md`), k(KES)], ["day", "week", "month", "other"]);
});

const PROJ = { "Kestrel": "P/Kestrel.md", "Household": "P/Household.md" };
const projectOf = (note, i, lines) => {
    const m = lines[i].match(/\[\[([^\]|]+)\|(?:⭕|🗃️)\]\]/u);
    return m ? PROJ[m[1]] : note.kind === "other" ? "P/Kestrel.md" : null;
};
const resolve = (linkpath) => (/^\d{4}-\d{2}-\d{2}$/.test(linkpath) ? `days/${linkpath}.md` : null);
const run = (notes, opts = {}) => plain(TaskIds.check(notes, { projectOf, resolve, ...opts }).map((v) => [v.rule, v.lines.map((l) => `${l.path}:${l.line}`)]));
const SRC = { path: "P/Kestrel.md", kind: "other", text: "- [>] Book it [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2" };
const OPEN = { path: "days/2026-10-08.md", kind: "day", text: "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2" };

test("check: a task whose lines agree has nothing to say", () => {
    assert.deepEqual(run([SRC, OPEN]), []);
    assert.deepEqual(run([{ ...SRC, text: SRC.text.replace("[>]", "[x]") }, { ...OPEN, text: OPEN.text.replace("[ ]", "[x]") }]), [], "done, and the forward date names the day");
    assert.deepEqual(run([{ path: "days/2026-10-07.md", kind: "day", text: "- [>] Call [[Kestrel|⭕]] ^q1w2e3" }, { path: "days/2026-10-08.md", kind: "day", text: "- [/] Call [[Kestrel|⭕]] ^q1w2e3" }]), [], "only daily lines, no source");
});
test("map and gatherMany: one pass for a command, notes in the system only, task IDs only (OBS-225)", async () => {
    const DAY = "Reference/Planner/days/2026-09-17.md", P = "Projects/Kestrel/Kestrel.md", NOTE = "Reference/People/Rafe.md", MINE = "Projects/Kestrel/Mine.md";
    const v = standIn({ notes: {
        [P]: "---\ntags: [project]\n---\n- [>] Book it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n\t- [ ] Nested ^k3x9m2\n",
        [DAY]: "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2\n- [ ] Mine ^myown\n",
        [MINE]: "- [ ] Mine too ^myown\n",
        [NOTE]: "- [ ] Outside ^k3x9m2\n",
    } });
    const t = v.plainday.TaskIds;
    const map = t.map();
    assert.deepEqual([...map.keys()].sort(), ["k3x9m2", "myown"]);
    assert.ok(!map.get("k3x9m2").some((l) => l.file.path === NOTE), "a note outside the system isn't in it");
    const lines = await t.gatherMany(["k3x9m2", "myown", "NOPE"], map);
    assert.deepEqual([...lines.keys()], ["k3x9m2"], "a block ID of your own that was never sent isn't a task's");
    assert.deepEqual(plain(lines.get("k3x9m2").map((l) => [l.file.path, l.line, l.task]).sort()), [[DAY, 0, " "], [P, 3, ">"]].sort(), "top-level lines only");
});

test("check: a line in a task note, log or plain note is compared with nothing, when `compared` says so (OBS-225)", () => {
    const note = { path: "P/Write copy.md", kind: "other", text: "- [>] Book it [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2" };
    const other = { ...OPEN, text: "- [ ] Book it [[Household|⭕]] ^k3x9m2" };
    const rules = (compared) => plain(TaskIds.check([note, other], { projectOf: (n) => (n === note ? "Kestrel" : "Household"), resolve, compared }).map((x) => x.rule));
    assert.deepEqual(rules(undefined), ["project"]);
    assert.deepEqual(rules((n) => n.kind !== "other"), []);
});

test("check 1: two projects, with no line let off (OBS-233)", () => {
    const other = { ...OPEN, text: "- [ ] Book it [[Household|⭕]] ^k3x9m2" };
    assert.deepEqual(run([SRC, other]), [["project", ["P/Kestrel.md:0", "days/2026-10-08.md:0"]]]);
    // The option that let an invoiced or finished line keep its project is gone: a project change writes every line
    // of the task and refuses to move billed time, so two projects are always something to fix
    assert.deepEqual(run([SRC, other], { exempt: () => "invoiced" }), [["project", ["P/Kestrel.md:0", "days/2026-10-08.md:0"]]]);
});
test("check 2 and 4: a copy on an earlier day is only open twice; the forward date may name either open line, but not neither (OBS-185)", () => {
    const earlier = { path: "days/2026-10-07.md", kind: "day", text: OPEN.text };
    assert.deepEqual(run([SRC, earlier, OPEN]), [["open", ["days/2026-10-07.md:0", "days/2026-10-08.md:0"]]]);
    const elsewhere = { ...SRC, text: SRC.text.replace("2026-10-08#", "2026-10-06#").replace("10/8]]", "10/6]]") };
    assert.deepEqual(run([elsewhere, earlier, OPEN]).map((v) => v[0]), ["open", "forward"]);
    assert.deepEqual(run([{ ...SRC, text: "- [>] Book it ^k3x9m2" }, earlier, OPEN]).map((v) => v[0]), ["open", "forward"], "a [>] source with none");
});
test("check 2: open on two days", () => {
    const copy = { path: "days/2026-10-09.md", kind: "day", text: OPEN.text };
    assert.deepEqual(run([SRC, OPEN, copy]).map((v) => v[0]), ["open"]);
});
test("check 3: done while still open; done on two days", () => {
    const done = { path: "days/2026-10-07.md", kind: "day", text: "- [x] Book it [[Kestrel|⭕]] ^k3x9m2" };
    assert.equal(run([SRC, OPEN, done])[0][0], "finished");
    const again = { path: "days/2026-10-09.md", kind: "day", text: done.text };
    assert.deepEqual(run([{ ...SRC, text: SRC.text.replace("[>]", "[x]") }, { ...done, path: "days/2026-10-08.md" }, again]).map((v) => v[0]), ["finished"]);
});
test("check 4: a forward date pointing where the task isn't, or a [>] source with none", () => {
    assert.deepEqual(run([{ ...SRC, text: SRC.text.replace("2026-10-08#", "2026-10-06#").replace("10/8]]", "10/6]]") }, OPEN]), [["forward", ["P/Kestrel.md:0", "days/2026-10-08.md:0"]]]);
    assert.deepEqual(run([{ ...SRC, text: "- [>] Book it ^k3x9m2" }, OPEN]).map((v) => v[0]), ["forward"]);
});
test("check 5: an ID twice in one note", () => {
    assert.deepEqual(run([SRC, { ...OPEN, text: `${OPEN.text}\n${OPEN.text}` }]).map((v) => v[0]), ["open", "twice"]);
});
test("check: lines that share a block ID of your own, never sent, aren't a task", () => {
    assert.deepEqual(run([{ path: "days/2026-10-07.md", kind: "day", text: "- [ ] Weekly review ^review" }, { path: "days/2026-10-08.md", kind: "day", text: "- [ ] Weekly review [[Household|⭕]] ^review" }]), []);
});
test("check 6: text typed after a task's ID (Review Focus 5)", () => {
    const typed = { path: "days/2026-10-09.md", kind: "day", text: "- [ ] Call Rafe ^k3x9m2 about the proof" };
    assert.deepEqual(run([SRC, OPEN, typed]), [["trailing", ["days/2026-10-09.md:0"]]]);
});
test("check 5: a block ID of your own twice in one note, never sent, isn't a task", () => {
    assert.deepEqual(run([{ path: "days/2026-10-08.md", kind: "day", text: "- [ ] Weekly review ^review\n- [ ] Weekly review ^review" }]), []);
});

test("TRAIL_ITEM and trailItem are AddTaskNote's, kept as copies by hand (OBS-185, OBS-199)", () => {
    const AddTaskNote = vm.runInContext(classScript("addTaskNote.js") + "\n;AddTaskNote", vm.createContext({}));
    // One writes the U+FE0F as itself, the other as ️
    assert.equal(TaskIds.TRAIL_ITEM.source.replace(/️/g, "\\uFE0F"), AddTaskNote.TRAIL_ITEM.source);
    assert.equal(TaskIds.TRAIL_ITEM.flags, AddTaskNote.TRAIL_ITEM.flags);
    assert.equal(TaskIds.trailItem.toString().replaceAll("TaskIds.", "AddTaskNote."), AddTaskNote.trailItem.toString());
});
