// Scenario tests for CheckOff (OBS-232): a tick on either line of a sent task completes the task, and a click on
// a [>] box asks. The real scripts on a stand-in vault (today is 9/16), with the task checks after every step.
// Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { standIn, src, PLANNER } from "./standInVault.mjs";

const day = (d) => `${PLANNER}/days/${d}.md`;
const MONTH = `${PLANNER}/months/2026-09.md`;
const TODAY = day("2026-09-16");
const PIN = "Projects/Freelance/Pinecrest Library Brochure/Pinecrest Library Brochure.md";
const COPY = "Projects/Freelance/Pinecrest Library Brochure/Write brochure copy.md";
const GARDEN = "Projects/Personal/Garden Club Newsletter/Garden Club Newsletter.md";
const SOURCE = "- [>] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe";
const OPEN = "- [ ] Send final copy to Rafe [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe";
const copyNote = (line = SOURCE) => `---\ntags: [task]\nparent: "[[Pinecrest Library Brochure]]"\n---\nCopy for the six panels.\n\n- [x] First draft\n${line}\n\n## Notes\n\n- Keep every panel short.\n`;
const PHOTOS_SOURCE = "- [>] Collect member photos for the October issue [[2026-09#^g4m8sk|Sep. 2026]] ^g4m8sk";
const PHOTOS_OPEN = "- [ ] Collect member photos for the October issue [[Garden Club Newsletter|⭕]] ^g4m8sk";
// The sample notes' shapes: Send final copy to Rafe, sent from a task note and open on 9/17; Collect member photos,
// sent from a project note and open in the September monthly note
const notes = (extra = {}) => ({
    [PIN]: "---\ntags: [project]\n---\n## To Do\n\n- [ ] Pick the paper stock\n",
    [COPY]: copyNote(),
    [day("2026-09-17")]: `- [ ] Homepage build: category pages\n${OPEN}\n- [ ] Renew the car registration\n`,
    [GARDEN]: `---\ntags: [project]\n---\n## To Do\n\n${PHOTOS_SOURCE}\n`,
    [MONTH]: `${PHOTOS_OPEN}\n`,
    [TODAY]: "- [ ] Water the plants\n",
    ...extra,
});
const lineOf = (v, path, text) => v.notes()[path].split("\n").find((l) => l.includes(text)) ?? null;
// Lines in `path` that end in `id`
const idLines = (v, path, id) => (v.notes()[path] ?? "").split("\n").filter((l) => l.endsWith(`^${id}`));
const plain = (x) => JSON.parse(JSON.stringify(x));
// A scenario, run as written and again with the cache a command behind (in Obsidian a lookup made right after a
// write can miss the new line)
const scenario = (name, fn) => {
    for (const lag of [false, true]) test(`${name}${lag ? " (the cache a command behind)" : ""}`, () => fn({ lag }));
};

// ------------------------------------------------------------------ rule 1: ticking the open line

scenario("ticking the open line checks off the source line too, with its forward date unchanged; unticking puts it back; no notice", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: day("2026-09-17"), at: 1, lag });
    assert.equal(await v.click(), null, "no question");
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
    await v.click();
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.deepEqual(v.check(), []);
    assert.equal(v.notes()[TODAY], "- [ ] Water the plants\n", "today's note isn't touched");
    assert.deepEqual(plain(v.notices), [], "the other line changes without a notice");
});

scenario("canceling the open line cancels the source, and setting it back to todo puts the source back to [>]", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: day("2026-09-17"), at: 1, lag });
    await v.box("-");
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [-] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
    await v.box("x");
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe", "canceled to done follows too");
    await v.box(" ");
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.deepEqual(v.check(), []);
    assert.equal(v.notices.length, 0);
});

scenario("ticking the open line in a monthly note checks off its source in the project note", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: MONTH, at: 0, lag });
    await v.click();
    assert.equal(lineOf(v, GARDEN, "Collect member photos"), PHOTOS_SOURCE.replace("[>]", "[x]"));
    assert.equal(lineOf(v, MONTH, "Collect member photos"), PHOTOS_OPEN.replace("[ ]", "[x]"), "it stays in the monthly note");
    assert.deepEqual(v.check(), []);
});

scenario("ticking a task with no source line is just a tick, and an earlier day's [>] line stays [>]", async ({ lag }) => {
    const w = "- [>] Draft homepage wireframes [[Kestrel|⭕]] ^w2h5nf";
    const v = standIn({ notes: notes({ [day("2026-09-14")]: `${w}\n\t- 11:00am - 12:30pm\n`, [day("2026-09-15")]: "- [ ] Draft homepage wireframes [[Kestrel|⭕]] ^w2h5nf\n", "Projects/Freelance/Kestrel/Kestrel.md": "---\ntags: [project]\n---\n" }), open: day("2026-09-15"), at: 0, lag });
    const before = v.notes();
    await v.click();
    assert.deepEqual({ ...v.notes(), [day("2026-09-15")]: null }, { ...before, [day("2026-09-15")]: null }, "nothing else changed");
    assert.equal(lineOf(v, day("2026-09-14"), "Draft homepage"), w);
    assert.equal(v.notices.length, 0);
    assert.deepEqual(v.check(), []);
});

scenario("a source whose forward date pointed elsewhere points where the task was done", async ({ lag }) => {
    const v = standIn({ notes: notes({ [COPY]: copyNote("- [>] Send final copy to Rafe [[2026-09-12#^p7d2qe|9/12]] ^p7d2qe") }), open: day("2026-09-17"), at: 1, lag });
    await v.click();
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

// ------------------------------------------------------------------ rule 2: ticking the source line

scenario("ticking the source line with Task Status's picker finishes the open line where it is: nothing moves, and no notice", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
    assert.equal(await v.box("x"), null, "no question");
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.equal(v.notes()[TODAY], "- [ ] Water the plants\n", "today's note isn't touched");
    assert.equal(v.notices.length, 0);
    assert.deepEqual(v.check(), []);
});

scenario("canceling the source line cancels the open line where it is", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
    await v.box("-");
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[-]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [-] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

scenario("ticking a source whose open line is in a monthly note ticks it there", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: GARDEN, at: 5, lag });
    await v.box("x");
    assert.equal(v.notes()[MONTH], `${PHOTOS_OPEN.replace("[ ]", "[x]")}\n`);
    assert.equal(lineOf(v, GARDEN, "Collect member photos"), PHOTOS_SOURCE.replace("[>]", "[x]"));
    assert.deepEqual(v.check(), []);
});

scenario("ticking a source whose open line has time logged ticks it where it is, its time and nested lines with it", async ({ lag }) => {
    const open15 = "- [/] Send final copy to Rafe [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe";
    const nest = "\t- 9:00am - 9:30am\n\t- [ ] Proofread the hours panel\n\t- [x] Check the dates\n";
    const v = standIn({ notes: notes({ [COPY]: copyNote("- [>] Send final copy to Rafe [[2026-09-15#^p7d2qe|9/15]] ^p7d2qe"), [day("2026-09-17")]: "- [ ] Homepage build\n", [day("2026-09-15")]: `${open15}\n${nest}` }), open: COPY, at: 7, lag });
    await v.box("x");
    assert.equal(v.notes()[day("2026-09-15")], `${open15.replace("[/]", "[x]")}\n${nest}`);
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-15#^p7d2qe|9/15]] ^p7d2qe");
    assert.equal(v.notes()[TODAY], "- [ ] Water the plants\n");
    assert.deepEqual(v.check(), []);
});

scenario("ticking the source makes no note for today", async ({ lag }) => {
    const n = notes();
    delete n[TODAY];
    const v = standIn({ notes: n, open: COPY, at: 7, lag });
    await v.box("x");
    assert.equal(v.notes()[TODAY], undefined);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
});

scenario("unticking the source puts it back to [>] and reopens the done line where it is", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
    await v.box("x");
    v.open(COPY, 7);
    assert.equal(await v.click(), null, "no question");
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.equal(v.notices.length, 0);
    assert.deepEqual(v.check(), []);
});

scenario("unticking a source whose task has time logged reopens the done line as [/]", async ({ lag }) => {
    const done15 = "- [x] Send final copy to Rafe [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe";
    const v = standIn({ notes: notes({ [COPY]: copyNote("- [x] Send final copy to Rafe [[2026-09-15#^p7d2qe|9/15]] ^p7d2qe"), [day("2026-09-17")]: "- [ ] Homepage build\n", [day("2026-09-15")]: `${done15}\n\t- 9:00am - 9:30am\n` }), open: COPY, at: 7, lag });
    await v.click();
    assert.equal(lineOf(v, day("2026-09-15"), "Send final copy"), done15.replace("[x]", "[/]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [>] Send final copy to Rafe [[2026-09-15#^p7d2qe|9/15]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

scenario("⌘⏎ over a source line and an open line below it, which Obsidian ticks together, completes the task at once", async ({ lag }) => {
    // Obsidian takes the [>] straight to [x] and the [ ] below it to [x], in one edit
    const v = standIn({ notes: notes({ [COPY]: copyNote(`${SOURCE}\n- [ ] Ask about the paper ^pp4p3r`) }), open: COPY, at: 7, lag });
    const editor = v.app.workspace.activeLeaf.view.editor, C = v.plainday.CheckOff, file = v.file(COPY);
    const a = [editor.getLine(7), editor.getLine(8)], b = a.map((l) => l.replace(/\[.\]/, "[x]"));
    editor.replaceRange(b.join("\n"), { line: 7, ch: 0 }, { line: 8, ch: a[1].length });
    const found = C.constructor.boxChanges((n) => a[n - 7], (n) => b[n - 7], [{ fromA: 7, toA: 8, fromB: 7, toB: 8 }]);
    // Both boxes changed; the plain line's block ID was never sent, so following it changes nothing
    assert.deepEqual(plain(found.map((c) => c.line)), [7, 8]);
    for (const c of found) await C.follow(file, c);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Ask about the paper"), "- [x] Ask about the paper ^pp4p3r");
    assert.deepEqual(v.check(), []);
});

scenario("Task Status setting today's own [>] line to done finishes the open line where it is, and today's line stays [>]", async ({ lag }) => {
    const s = "- [>] Book the studio [[2026-09-17#^b5st0d|9/17]] ^b5st0d";
    const worked = "- [>] Book the studio [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^b5st0d|↗]] ^b5st0d";
    for (const timed of [false, true]) {
        const v = standIn({ notes: notes({ [COPY]: copyNote(`${SOURCE}\n${s}`), [TODAY]: `${worked}\n${timed ? "\t- 9:00am - 9:30am\n" : ""}`, [day("2026-09-17")]: `${OPEN}\n${worked.replace("[>]", "[ ]")}\n` }), open: TODAY, at: 0, lag });
        assert.equal(await v.box("x"), null);
        assert.deepEqual(idLines(v, TODAY, "b5st0d"), [worked], `timed ${timed}`);
        assert.deepEqual(idLines(v, day("2026-09-17"), "b5st0d"), [worked.replace("[>]", "[x]")]);
        assert.equal(lineOf(v, COPY, "Book the studio"), "- [x] Book the studio [[2026-09-17#^b5st0d|9/17]] ^b5st0d");
        assert.deepEqual(v.check(), []);
    }
});

// ------------------------------------------------------------------ rule 3: a click on a [>] box asks

const ASKED = { title: "This task is scheduled for Thu 9/17. What would you like to do?", name: "Send final copy to Rafe", buttons: ["Do nothing", "Cancel it", "Mark done"], cta: "Mark done" };

scenario("a click on the source's [>] box asks done or canceled, and Do nothing or Esc changes nothing", async ({ lag }) => {
    for (const answer of ["Do nothing", null]) {
        const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
        const before = v.notes();
        const asked = await v.click({ answer });
        assert.deepEqual(plain(asked), ASKED);
        assert.deepEqual(v.notes(), before, String(answer));
        assert.deepEqual(v.check(), []);
    }
});

scenario("a click on the source's [>] box, then Mark done: the task is checked off where it's open, with no notice", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
    await v.click({ answer: "Mark done" });
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.equal(v.notes()[TODAY], "- [ ] Water the plants\n");
    assert.equal(v.notices.length, 0);
    assert.deepEqual(v.check(), []);
});

scenario("a click on the source's [>] box, then Cancel it: the task is canceled where it's open", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
    await v.click({ answer: "Cancel it" });
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[-]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [-] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

scenario("a click on an earlier day's [>] line asks with that task's day, and Mark done leaves that line [>], finishing the open line where it is", async ({ lag }) => {
    const s = "- [>] Book the studio [[2026-09-18#^b5st0d|9/18]] ^b5st0d";
    const worked = "- [>] Book the studio [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^b5st0d|↗]] ^b5st0d";
    const open18 = worked.replace("[>]", "[/]");
    const v = standIn({ notes: notes({ [COPY]: copyNote(`${SOURCE}\n${s}`), [day("2026-09-15")]: `${worked}\n\t- 9:00am - 9:30am\n`, [day("2026-09-18")]: `${open18}\n` }), open: day("2026-09-15"), at: 0, lag });
    const asked = await v.click({ answer: "Mark done" });
    assert.equal(asked.title, "This task is scheduled for Fri 9/18. What would you like to do?");
    assert.deepEqual(plain(asked.buttons), ASKED.buttons);
    assert.equal(v.notes()[day("2026-09-15")], `${worked}\n\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-18")], `${open18.replace("[/]", "[x]")}\n`);
    assert.equal(lineOf(v, COPY, "Book the studio"), "- [x] Book the studio [[2026-09-18#^b5st0d|9/18]] ^b5st0d");
    assert.deepEqual(v.check(), []);
});

scenario("a click on today's own [>] line, then Mark done: the open line is finished where it is, and today's line stays [>] with its time", async ({ lag }) => {
    const s = "- [>] Book the studio [[2026-09-17#^b5st0d|9/17]] ^b5st0d";
    const worked = "- [>] Book the studio [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^b5st0d|↗]] ^b5st0d";
    const v = standIn({ notes: notes({ [COPY]: copyNote(`${SOURCE}\n${s}`), [TODAY]: `${worked}\n\t- 9:00am - 9:30am\n`, [day("2026-09-17")]: `${OPEN}\n${worked.replace("[>]", "[/]")}\n` }), open: TODAY, at: 0, lag });
    await v.click({ answer: "Mark done" });
    assert.equal(v.notes()[TODAY], `${worked}\n\t- 9:00am - 9:30am\n`);
    assert.deepEqual(idLines(v, day("2026-09-17"), "b5st0d"), [worked.replace("[>]", "[x]")]);
    assert.equal(lineOf(v, COPY, "Book the studio"), "- [x] Book the studio [[2026-09-17#^b5st0d|9/17]] ^b5st0d");
    assert.deepEqual(v.check(), []);
});

scenario("a task with no source line gets the same question, and Do nothing changes nothing", async ({ lag }) => {
    const w = "- [>] Draft homepage wireframes [[Kestrel|⭕]] ^w2h5nf";
    const v = standIn({ notes: notes({ [day("2026-09-15")]: `${w}\n\t- 9:00am - 9:30am\n`, [day("2026-09-18")]: "- [ ] Draft homepage wireframes [[Kestrel|⭕]] ^w2h5nf\n", "Projects/Freelance/Kestrel/Kestrel.md": "---\ntags: [project]\n---\n" }), open: day("2026-09-15"), at: 0, lag });
    const before = v.notes();
    const asked = await v.click({ answer: "Do nothing" });
    assert.deepEqual(plain(asked.buttons), ASKED.buttons);
    assert.deepEqual(v.notes(), before);
});

scenario("Task Status's picker setting todo or in progress on a [>] box asks too", async ({ lag }) => {
    for (const mark of [" ", "/"]) {
        const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
        const before = v.notes();
        assert.equal((await v.box(mark, { answer: null })).title, "This task is scheduled for Thu 9/17. What would you like to do?", JSON.stringify(mark));
        assert.deepEqual(v.notes(), before);
    }
});

scenario("Task Status's picker setting done on an earlier day's [>] line completes the task at once, where it's open, and that line goes back to [>]", async ({ lag }) => {
    const s = "- [>] Book the studio [[2026-09-18#^b5st0d|9/18]] ^b5st0d";
    const worked = "- [>] Book the studio [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^b5st0d|↗]] ^b5st0d";
    const v = standIn({ notes: notes({ [COPY]: copyNote(`${SOURCE}\n${s}`), [day("2026-09-15")]: `${worked}\n\t- 9:00am - 9:30am\n`, [day("2026-09-18")]: `${worked.replace("[>]", "[/]")}\n` }), open: day("2026-09-15"), at: 0, lag });
    assert.equal(await v.box("x"), null, "no question");
    assert.equal(v.notes()[day("2026-09-15")], `${worked}\n\t- 9:00am - 9:30am\n`);
    assert.equal(v.notes()[day("2026-09-18")], `${worked.replace("[>]", "[x]")}\n`);
    assert.equal(lineOf(v, COPY, "Book the studio"), "- [x] Book the studio [[2026-09-18#^b5st0d|9/18]] ^b5st0d");
    assert.deepEqual(v.check(), []);
});

scenario("a line that changed while the question was up gets nothing written", async ({ lag }) => {
    const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
    const editor = v.app.workspace.activeLeaf.view.editor;
    await v.click({ answer: "Mark done", before: () => editor.replaceRange(" now", { line: 7, ch: "- [>] Send final copy to Rafe".length }) });
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.equal(v.notices.at(-1), "The line changed while the question was open, so nothing was written");
});

// ------------------------------------------------------------------ a finished task

const WIRE = "Draft homepage wireframes [[2026-09-18|🚩 9/18]] [[Kestrel|⭕]] [[Draft homepage wireframes|⋯]] ^w2h5nf";
const WIRE_NOTES = () => notes({ [day("2026-09-14")]: `- [>] ${WIRE}\n\t- 11:00am - 12:30pm\n`, [day("2026-09-15")]: `- [x] ${WIRE}\n\t- 9:15am - 11:15am\n`, "Projects/Freelance/Kestrel/Kestrel.md": "---\ntags: [project]\n---\n", "Projects/Freelance/Kestrel/Draft homepage wireframes.md": "---\ntags: [task]\n---\n" });

scenario("a click on an earlier day's [>] line of a finished task asks Do nothing or Reopen today, and Do nothing changes nothing", async ({ lag }) => {
    const v = standIn({ notes: WIRE_NOTES(), open: day("2026-09-14"), at: 0, lag });
    const before = v.notes();
    const asked = await v.click({ answer: "Do nothing" });
    assert.deepEqual(plain(asked), { title: "This task was completed on Tue 9/15. What would you like to do?", name: "Draft homepage wireframes", buttons: ["Do nothing", "Reopen today"], cta: "Do nothing" });
    assert.deepEqual(v.notes(), before);
});

scenario("Reopen today on a finished task brings it to today's note, open, as Schedule moves it; the day it was done keeps a [>] line with its time", async ({ lag }) => {
    const v = standIn({ notes: WIRE_NOTES(), open: day("2026-09-14"), at: 0, lag });
    await v.click({ answer: "Reopen today" });
    assert.equal(v.notes()[day("2026-09-14")], `- [>] ${WIRE}\n\t- 11:00am - 12:30pm\n`, "the clicked line stays [>]");
    assert.equal(v.notes()[day("2026-09-15")], `- [>] ${WIRE}\n\t- 9:15am - 11:15am\n`);
    assert.equal(v.notes()[TODAY], `- [ ] Water the plants\n- [/] ${WIRE}\n`);
    assert.deepEqual(plain(v.notices), ["Reopened on 9/16"], "the line moved, so Schedule's notice says where");
    assert.deepEqual(v.check(), []);
});

scenario("Reopen today on the [>] source of a finished task: its done line comes to today, open, and the forward date follows", async ({ lag }) => {
    const done17 = OPEN.replace("[ ]", "[x]");
    const v = standIn({ notes: notes({ [day("2026-09-17")]: `- [ ] Homepage build\n${done17}\n` }), open: COPY, at: 7, lag });
    const asked = await v.click({ answer: "Reopen today" });
    assert.equal(asked.title, "This task was completed on Thu 9/17. What would you like to do?");
    assert.equal(v.notes()[day("2026-09-17")], "- [ ] Homepage build\n");
    assert.equal(v.notes()[TODAY], `- [ ] Water the plants\n${OPEN}\n`);
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [>] Send final copy to Rafe [[2026-09-16#^p7d2qe|9/16]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

scenario("Task Status's picker setting done on an earlier day's [>] line of a finished task changes only that line, as today", async ({ lag }) => {
    const w = "Draft homepage wireframes [[Kestrel|⭕]] ^w2h5nf";
    const v = standIn({ notes: notes({ [day("2026-09-14")]: `- [>] ${w}\n\t- 11:00am - 12:30pm\n`, [day("2026-09-15")]: `- [x] ${w}\n`, "Projects/Freelance/Kestrel/Kestrel.md": "---\ntags: [project]\n---\n" }), open: day("2026-09-14"), at: 0, lag });
    const before = v.notes();
    await v.box("x");
    assert.deepEqual({ ...v.notes(), [day("2026-09-14")]: null }, { ...before, [day("2026-09-14")]: null });
    assert.equal(v.notices.length, 0);
});

// ------------------------------------------------------------------ where nothing happens

scenario("a click on a [>] box behaves as it does today on a line with no ID, a nested line, a line outside the system, an event, and a task whose open line was deleted", async ({ lag }) => {
    const cases = [
        { name: "no ID", notes: { [day("2026-09-15")]: "- [>] Call the printer\n" }, open: day("2026-09-15"), at: 0 },
        { name: "nested", notes: { [day("2026-09-15")]: "- [ ] Brochure\n\t- [>] Book the studio [[2026-09-18#^b5st0d|9/18]] ^b5st0d\n", [day("2026-09-18")]: "- [ ] Book the studio ^b5st0d\n" }, open: day("2026-09-15"), at: 1 },
        { name: "outside", notes: { "Reference/Ideas.md": "- [>] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n" }, open: "Reference/Ideas.md", at: 0 },
        // An event the calendar sync forwarded, in the form it writes, with a block ID of its own
        { name: "event", notes: { [day("2026-09-15")]: "- [>] [[2026-09-18|9/18]] 1:00pm\tCall with Rafe ^c1rafe\n", [day("2026-09-18")]: "- [<] 1:00pm\tCall with Rafe ^c1rafe\n" }, open: day("2026-09-15"), at: 0 },
        { name: "deleted", notes: { [day("2026-09-17")]: "- [ ] Homepage build\n" }, open: COPY, at: 7 },
    ];
    for (const c of cases) {
        const v = standIn({ notes: notes(c.notes), open: c.open, at: c.at, lag });
        const before = v.notes();
        assert.equal(await v.click({ answer: "Mark done" }), null, c.name);
        const line = before[c.open].split("\n")[c.at];
        assert.deepEqual(v.notes(), { ...before, [c.open]: before[c.open].replace(line, line.replace("[>]", "[ ]")) }, c.name);
        assert.equal(v.notices.length, 0, c.name);
    }
});

// ------------------------------------------------------------------ whose changes count, and the pieces on their own

test("only your own edits count: a change tagged set (Sync, the vault, disk, a second pane) or with the system's tag isn't", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    for (const ev of [undefined, null, "", "input.type", "delete.backward", "undo", "redo", "select.pointer"]) assert.equal(C.yours(ev), true, String(ev));
    for (const ev of ["set", "obsidian-pm", "obsidian-pm.schedule"]) assert.equal(C.yours(ev), false, ev);
});

test("boxChanges reads each changed checklist line's mark before and after, on lines that keep their ID", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    const run = (a, b, ranges) => plain(C.boxChanges((n) => a[n], (n) => b[n], ranges));
    const one = (k) => ({ fromA: k, toA: k, fromB: k, toB: k });
    // A click: one character
    assert.deepEqual(run(["- [ ] A ^aaaaaa"], ["- [x] A ^aaaaaa"], [one(0)]), [{ line: 0, was: 0, before: "- [ ] A ^aaaaaa", after: "- [x] A ^aaaaaa" }]);
    // ⌘⏎ over several lines, as one change
    assert.deepEqual(run(["- [>] A ^aaaaaa", "- [ ] B ^bbbbbb", "- [ ] C"], ["- [x] A ^aaaaaa", "- [x] B ^bbbbbb", "- [x] C"], [{ fromA: 0, toA: 2, fromB: 0, toB: 2 }]).map((c) => c.line), [0, 1]);
    // No ID, a changed ID, text only, a box in a callout, a box taken off, lines added
    assert.deepEqual(run(["- [ ] A"], ["- [x] A"], [one(0)]), []);
    assert.deepEqual(run(["- [ ] A ^aaaaaa"], ["- [x] A ^bbbbbb"], [one(0)]), []);
    assert.deepEqual(run(["- [ ] A ^aaaaaa"], ["- [ ] AB ^aaaaaa"], [one(0)]), []);
    assert.deepEqual(run(["> - [ ] A ^aaaaaa"], ["> - [x] A ^aaaaaa"], [one(0)]), []);
    assert.deepEqual(run(["- [>] A ^aaaaaa"], ["- [] A ^aaaaaa"], [one(0)]), []);
    assert.deepEqual(run(["- [ ] A ^aaaaaa"], ["- [x] A ^aaaaaa", "- [ ] B"], [{ fromA: 0, toA: 0, fromB: 0, toB: 1 }]), []);
    // A line further down, after lines added above it in the same edit
    assert.deepEqual(run(["x", "- [ ] A ^aaaaaa"], ["x", "y", "- [x] A ^aaaaaa"], [{ fromA: 0, toA: 0, fromB: 0, toB: 1 }, { fromA: 1, toA: 1, fromB: 2, toB: 2 }]), [{ line: 2, was: 1, before: "- [ ] A ^aaaaaa", after: "- [x] A ^aaaaaa" }]);
});

test("typing the mark in two edits (through a line with no box) completes nothing: the source is left done and the task open, as today", async () => {
    const v = standIn({ notes: notes(), open: COPY, at: 7 });
    const editor = v.app.workspace.activeLeaf.view.editor;
    const C = v.plainday.CheckOff, file = v.file(COPY);
    const steps = ["- [] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe", "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe"];
    let before = SOURCE;
    for (const after of steps) {
        editor.replaceRange(after, { line: 7, ch: 0 }, { line: 7, ch: before.length });
        for (const c of C.constructor.boxChanges(() => before, () => after, [{ fromA: 0, toA: 0, fromB: 0, toB: 0 }])) await C.follow(file, { ...c, line: 7 });
        before = after;
    }
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN, "the open line is left open");
    assert.deepEqual(v.check().map((p) => p.rule), ["finished"], "the report lists it as done and open");
});

test("every write Schedule makes through an editor carries the system's tag, so CheckOff never takes it for yours", async () => {
    const v = standIn({ notes: notes({ [COPY]: copyNote("- [ ] Send final copy to Rafe") }), open: COPY, at: 7 });
    await v.schedule("2026-09-17");
    v.open(COPY, 7);
    await v.schedule("2026-09-18");
    v.open(day("2026-09-18"), 0);
    await v.schedule("2026-09-19");
    v.open(COPY, 7);
    await v.click({ answer: "Mark done" });
    v.open(COPY, 7);
    await v.click();
    const own = v.origins.filter((o) => o !== null);
    assert.ok(own.length >= 3, `the system wrote through the editor (${own.length})`);
    assert.deepEqual([...new Set(own)], ["obsidian-pm"]);
    // The only untagged writes are the stand-in's own clicks
    assert.equal(v.origins.filter((o) => o === null).length, 1);
});

// ------------------------------------------------------------------ round 1 of the review

// A stand-in for CodeMirror's Text and ChangeSet, enough for changesOf and without
const doc = (text) => {
    const ls = text.split("\n"), starts = [];
    let p = 0;
    for (const l of ls) { starts.push(p); p += l.length + 1; }
    const line = (n) => ({ number: n, from: starts[n - 1], to: starts[n - 1] + ls[n - 1].length, text: ls[n - 1] });
    return { lines: ls.length, line, lineAt: (pos) => line(ls.findIndex((l, i) => pos <= starts[i] + l.length) + 1 || ls.length), sliceString: (a, b) => text.slice(a, b) };
};
const changeSet = (list) => ({ iterChanges: (fn) => list.forEach((c) => fn(c.fromA, c.toA, c.fromB, c.toB, { toString: () => c.insert })) });
const applied = (text, changes) => [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);

test("a held edit keeps its changes to the other lines: ⌘⏎ line by line, and Task Status's one change over the selection", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    const a = "- [>] A ^aaaaaa\n- [ ] B\n- [x] C", b = "- [ ] A ^aaaaaa\n- [x] B\n- [ ] C";
    // Line by line, as Obsidian's toggleCheckList writes it
    const perLine = [{ fromA: 3, toA: 4, fromB: 3, toB: 4, insert: " " }, { fromA: 19, toA: 20, fromB: 19, toB: 20, insert: "x" }, { fromA: 27, toA: 28, fromB: 27, toB: 28, insert: " " }];
    const list1 = C.changesOf(changeSet(perLine), doc(a), doc(b));
    assert.equal(applied(a, C.without(list1, new Set([0]), doc(a), doc(b))), "- [>] A ^aaaaaa\n- [x] B\n- [ ] C");
    // One change over all three lines
    const whole = [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length, insert: b }];
    const list2 = C.changesOf(changeSet(whole), doc(a), doc(b));
    assert.equal(applied(a, C.without(list2, new Set([0]), doc(a), doc(b))), "- [>] A ^aaaaaa\n- [x] B\n- [ ] C");
    // Only the held line changed: nothing left to do
    const only = [{ fromA: 3, toA: 4, fromB: 3, toB: 4, insert: " " }];
    assert.deepEqual(plain(C.without(C.changesOf(changeSet(only), doc(a), doc("- [ ] A ^aaaaaa\n- [ ] B\n- [x] C")), new Set([0]), doc(a), doc("- [ ] A ^aaaaaa\n- [ ] B\n- [x] C"))), []);
    // A change that also adds a line can't be split
    const c = "- [ ] A ^aaaaaa\n- [ ] B2\n- [ ] B\n- [x] C";
    assert.equal(C.without(C.changesOf(changeSet([{ fromA: 0, toA: 23, fromB: 0, toB: 32, insert: c.slice(0, 32) }]), doc(a), doc(c)), new Set([0]), doc(a), doc(c)), null);
});

test("the editor's hold: two [>] boxes opened by one change over three lines are each held and asked about on their own lines", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    const hold = (a, b, changes) => {
        const list = C.changesOf(changeSet(changes), doc(a), doc(b));
        const hits = C.boxChanges(C.lineFn(doc(a)), C.lineFn(doc(b)), C.rangesOf(list)).filter((c) => C.markOf(c.before) === ">" && C.isOpen(C.markOf(c.after)));
        const held = C.hold(list, hits, doc(a), doc(b));
        return held && { result: applied(a, held.changes), asks: plain(held.asks) };
    };
    // Task Status's one change over the selection: A and C held, B opened
    const a = "- [>] A ^aaaaaa\n- [x] B ^bbbbbb\n- [>] C ^cccccc", b = "- [ ] A ^aaaaaa\n- [ ] B ^bbbbbb\n- [ ] C ^cccccc";
    assert.deepEqual(hold(a, b, [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length, insert: b }]), {
        result: "- [>] A ^aaaaaa\n- [ ] B ^bbbbbb\n- [>] C ^cccccc",
        asks: [{ line: 0, text: "- [>] A ^aaaaaa", want: " " }, { line: 2, text: "- [>] C ^cccccc", want: " " }],
    });
    // A line pasted over a held one keeps its new wording; only the box stays [>]
    const s1 = "- [>] Send copy [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe", s2 = "- [ ] Send the final copy ^p7d2qe";
    assert.deepEqual(hold(s1, s2, [{ fromA: 0, toA: s1.length, fromB: 0, toB: s2.length, insert: s2 }]), {
        result: "- [>] Send the final copy ^p7d2qe",
        asks: [{ line: 0, text: "- [>] Send the final copy ^p7d2qe", want: " " }],
    });
    // A line added above the held one in the same edit: it's asked about where it lands
    const t1 = "- [ ] X\n- [>] A ^aaaaaa", t2 = "- [ ] New\n- [ ] X\n- [ ] A ^aaaaaa";
    assert.deepEqual(hold(t1, t2, [{ fromA: 0, toA: 0, fromB: 0, toB: 10, insert: "- [ ] New\n" }, { fromA: 11, toA: 12, fromB: 21, toB: 22, insert: " " }]), {
        result: "- [ ] New\n- [ ] X\n- [>] A ^aaaaaa",
        asks: [{ line: 2, text: "- [>] A ^aaaaaa", want: " " }],
    });
    // An edit that can't be split goes ahead unasked
    // (A's box opened, and a line added at the end of A, in one edit)
    const u2 = "- [ ] A ^aaaaaa\n- [ ] B2\n- [x] B ^bbbbbb\n- [>] C ^cccccc";
    assert.equal(hold(a, u2, [{ fromA: 3, toA: 4, fromB: 3, toB: 4, insert: " " }, { fromA: 15, toA: 15, fromB: 15, toB: 24, insert: "\n- [ ] B2" }]), null);
    // (A line taken out above A and one added below it, with A's box opened: A's line moved within the edit)
    const v1 = "a\n- [>] A ^aaaaaa\nb", v2 = "- [ ] A ^aaaaaa\n- [ ] new\nb";
    assert.equal(hold(v1, v2, [{ fromA: 0, toA: 2, fromB: 0, toB: 0, insert: "" }, { fromA: 5, toA: 6, fromB: 3, toB: 4, insert: " " }, { fromA: 17, toA: 17, fromB: 15, toB: 25, insert: "\n- [ ] new" }]), null);
});

test("a write finds its line by the task's ID when lines above it came or went, and skips one that changed", () => {
    const v = standIn({ notes: notes() });
    const C = v.plainday.CheckOff.constructor;
    const ls = ["- [ ] New line", "- [ ] Homepage build", OPEN];
    assert.equal(C.lineIn(ls, 1, OPEN), 2);
    assert.equal(C.lineIn(ls, 2, OPEN), 2);
    assert.equal(C.lineIn(["- [ ] Homepage build", OPEN.replace("[ ]", "[x]")], 1, OPEN), -1);
    assert.equal(C.lineIn(["- [>] Call the framer"], 0, "- [ ] Call the framer"), -1);
});

scenario("a task finished or moved while the question was up gets nothing written", async ({ lag }) => {
    for (const answer of ["Mark done", "Cancel it"]) {
        const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
        const elsewhere = async () => { await v.app.vault.process(v.file(day("2026-09-17")), (t) => t.replace(OPEN, OPEN.replace("[ ]", "[x]"))); };
        await v.click({ answer, before: elsewhere });
        assert.equal(v.notices.at(-1), "The task changed while the question was open, so nothing was written", answer);
        assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE, answer);
        assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"), answer);
    }
    // Its open line deleted meanwhile: nothing written, and no error
    const v = standIn({ notes: notes(), open: COPY, at: 7, lag });
    await v.click({ answer: "Mark done", before: async () => { await v.app.vault.process(v.file(day("2026-09-17")), (t) => t.replace(`${OPEN}\n`, "")); } });
    assert.equal(v.notices.at(-1), "The task changed while the question was open, so nothing was written");
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
});

test("Mark done on a task that's finished already writes nothing", async () => {
    const v = standIn({ notes: notes({ [day("2026-09-17")]: `${OPEN.replace("[ ]", "[x]")}\n` }) });
    const T = v.plainday.TaskIds;
    const lines = await T.gather("p7d2qe", []);
    const before = v.notes();
    assert.equal(await v.plainday.CheckOff.complete("p7d2qe", lines, "x"), false);
    assert.equal(v.notices.at(-1), "This task is already finished, so nothing changed");
    assert.deepEqual(v.notes(), before);
});

scenario("a hand-made task open in its own note with a day's [>] line: a click on that line changes only the line, as today", async ({ lag }) => {
    const w = "- [>] Send final copy to Rafe [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^p7d2qe|↗]] ^p7d2qe";
    const v = standIn({ notes: notes({ [COPY]: copyNote("- [ ] Send final copy to Rafe ^p7d2qe"), [day("2026-09-17")]: "- [ ] Homepage build\n", [day("2026-09-15")]: `${w}\n\t- 9:00am - 9:30am\n` }), open: day("2026-09-15"), at: 0, lag });
    const before = v.notes();
    assert.equal(await v.click({ answer: "Mark done" }), null, "no question");
    assert.equal(lineOf(v, day("2026-09-15"), "Send final copy"), w.replace("[>]", "[ ]"));
    assert.deepEqual({ ...v.notes(), [day("2026-09-15")]: null }, { ...before, [day("2026-09-15")]: null });
});

scenario("two ticks in one edit both follow", async ({ lag }) => {
    // Task A's own [>] line on today and task B's open line below it, ticked together
    const a = "- [>] Book the studio [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^b5st0d|↗]] ^b5st0d";
    const b = OPEN.replace("Send final copy to Rafe", "Proof the hours panel").replaceAll("p7d2qe", "h7p1qq");
    const v = standIn({ notes: notes({ [COPY]: copyNote(`- [>] Book the studio [[2026-09-17#^b5st0d|9/17]] ^b5st0d\n- [>] Proof the hours panel [[2026-09-16#^h7p1qq|9/16]] ^h7p1qq`), [TODAY]: `${a}\n\t- 9:00am - 9:30am\n${b}\n`, [day("2026-09-17")]: `${a.replace("[>]", "[ ]")}\n\t- [ ] Call about the price\n` }), open: TODAY, lag });
    const editor = v.app.workspace.activeLeaf.view.editor;
    const C = v.plainday.CheckOff, file = v.file(TODAY);
    editor.replaceRange("x", { line: 0, ch: 3 }, { line: 0, ch: 4 });
    editor.replaceRange("x", { line: 2, ch: 3 }, { line: 2, ch: 4 });
    await C.follow(file, { line: 0, before: a, after: a.replace("[>]", "[x]") });
    await C.follow(file, { line: 2, before: b, after: b.replace("[ ]", "[x]") });
    assert.equal(lineOf(v, COPY, "Proof the hours panel"), "- [x] Proof the hours panel [[2026-09-16#^h7p1qq|9/16]] ^h7p1qq");
    assert.equal(lineOf(v, COPY, "Book the studio"), "- [x] Book the studio [[2026-09-17#^b5st0d|9/17]] ^b5st0d");
    assert.equal(lineOf(v, day("2026-09-17"), "Book the studio"), a.replace("[>]", "[x]"));
    assert.deepEqual(v.check(), []);
});

test("unticking a source whose task is done on two days reopens the day its forward date names", async () => {
    const done = OPEN.replace("[ ]", "[x]");
    const v = standIn({ notes: notes({ [COPY]: copyNote("- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe"), [day("2026-09-12")]: `${done}\n`, [day("2026-09-17")]: `${done}\n` }), open: COPY, at: 7 });
    await v.click();
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.equal(lineOf(v, day("2026-09-12"), "Send final copy"), done);
});

test("a second question about the same line while one is up isn't asked", async () => {
    const v = standIn({ notes: notes(), open: COPY, at: 7 });
    const C = v.plainday.CheckOff, file = v.file(COPY);
    let release, asked = 0;
    C.choose = () => { asked++; return new Promise((ok) => { release = ok; }); };
    const first = C.ask({ file, line: 7, text: SOURCE, want: " " });
    await new Promise((ok) => setImmediate(ok));
    await C.ask({ file, line: 7, text: SOURCE, want: " " });
    release("Do nothing");
    await first;
    assert.equal(asked, 1);
});

test("a note open in reading view is written and read through the vault, never through its editor (an edit there never reaches the file)", async () => {
    const v = standIn({ notes: notes(), open: COPY, at: 7 });
    v.app.workspace.activeLeaf.view.getMode = () => "preview";
    const origins = v.origins.length;
    // Schedule on the sent line moves the task and points its forward date at 9/18: the source, open in reading
    // view, is written through the vault
    await v.schedule("2026-09-18");
    assert.equal(v.origins.length, origins, "nothing went through an editor");
    assert.equal(lineOf(v, day("2026-09-18"), "Send final copy"), OPEN);
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [>] Send final copy to Rafe [[2026-09-18#^p7d2qe|9/18]] ^p7d2qe");
});

// ------------------------------------------------------------------ reading view (OBS-245)

// The stand-in with `path` open in reading view, its box on line `at` the one clicked
const reading = (n, path, at, lag) => {
    const v = standIn({ notes: n, open: path, at, lag });
    v.reading();
    return v;
};

scenario("reading view: a click on the open line checks off the source, unticking puts it back, and every write goes through the vault", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 1, lag);
    const origins = v.origins.length;
    assert.deepEqual(plain(await v.readClick()), { asked: null, left: false });
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
    await v.readClick();
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.deepEqual(v.check(), []);
    assert.equal(v.origins.length, origins, "nothing went through an editor");
    assert.deepEqual(plain(v.notices), []);
    assert.equal(v.notes()[TODAY], "- [ ] Water the plants\n");
});

scenario("reading view: a click on the source's [>] box asks, with the box held at [>], and Do nothing or Esc changes nothing", async ({ lag }) => {
    for (const answer of ["Do nothing", null]) {
        const v = reading(notes(), COPY, 7, lag);
        const before = v.notes();
        const { asked, left } = await v.readClick({ answer, before: () => assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE, "held while asked") });
        assert.deepEqual(plain(asked), ASKED);
        assert.equal(left, false);
        assert.deepEqual(v.notes(), before, String(answer));
        assert.deepEqual(v.check(), []);
    }
});

scenario("reading view: Mark done, then unticking the source, then Cancel it and a click on the canceled open line, as in Live Preview", async ({ lag }) => {
    const v = reading(notes(), COPY, 7, lag);
    await v.readClick({ answer: "Mark done" });
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
    // The source, now [x], unticked: no question, and both are open again where they are
    assert.equal((await v.readClick()).asked, null);
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.deepEqual(v.check(), []);
    await v.readClick({ answer: "Cancel it" });
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[-]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [-] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    v.open(day("2026-09-17"), 1);
    v.reading();
    await v.readClick();
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.deepEqual(v.check(), []);
    assert.deepEqual(plain(v.notices), []);
});

scenario("reading view: a task open in a monthly note asks with the month, and Mark done finishes it there", async ({ lag }) => {
    const v = reading(notes(), GARDEN, 5, lag);
    const { asked } = await v.readClick({ answer: "Mark done" });
    assert.equal(asked.title, "This task is scheduled for Sep. 2026. What would you like to do?");
    assert.equal(v.notes()[MONTH], `${PHOTOS_OPEN.replace("[ ]", "[x]")}\n`);
    assert.equal(lineOf(v, GARDEN, "Collect member photos"), PHOTOS_SOURCE.replace("[>]", "[x]"));
    await v.readClick();
    assert.equal(v.notes()[MONTH], `${PHOTOS_OPEN}\n`);
    assert.equal(lineOf(v, GARDEN, "Collect member photos"), PHOTOS_SOURCE);
    assert.deepEqual(v.check(), []);
});

scenario("reading view: an earlier day's [>] line of a finished task asks Do nothing or Reopen today", async ({ lag }) => {
    const v = reading(WIRE_NOTES(), day("2026-09-14"), 0, lag);
    const before = v.notes();
    const { asked } = await v.readClick({ answer: "Do nothing" });
    assert.deepEqual(plain(asked), { title: "This task was completed on Tue 9/15. What would you like to do?", name: "Draft homepage wireframes", buttons: ["Do nothing", "Reopen today"], cta: "Do nothing" });
    assert.deepEqual(v.notes(), before);
    await v.readClick({ answer: "Reopen today" });
    assert.equal(v.notes()[TODAY], `- [ ] Water the plants\n- [/] ${WIRE}\n`);
    assert.deepEqual(plain(v.notices), ["Reopened on 9/16"]);
    assert.deepEqual(v.check(), []);
});

scenario("reading view: a click CheckOff leaves alone is Obsidian's, changing only its line: no ID, nested, outside the system, an event, a callout, an embed, a dialog up", async ({ lag }) => {
    const cases = [
        { name: "no ID", notes: { [day("2026-09-15")]: "- [>] Call the printer\n" }, open: day("2026-09-15"), at: 0 },
        { name: "nested", notes: { [day("2026-09-15")]: "- [ ] Brochure\n\t- [>] Book the studio [[2026-09-18#^b5st0d|9/18]] ^b5st0d\n", [day("2026-09-18")]: "- [ ] Book the studio ^b5st0d\n" }, open: day("2026-09-15"), at: 1 },
        { name: "outside", notes: { "Reference/Ideas.md": "- [>] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n" }, open: "Reference/Ideas.md", at: 0 },
        { name: "event", notes: { [day("2026-09-15")]: "- [>] [[2026-09-18|9/18]] 1:00pm\tCall with Rafe ^c1rafe\n", [day("2026-09-18")]: "- [<] 1:00pm\tCall with Rafe ^c1rafe\n" }, open: day("2026-09-15"), at: 0 },
        { name: "callout", open: COPY, at: 7, where: { inside: [".callout"] } },
        { name: "embed", open: COPY, at: 7, where: { inside: [".markdown-embed", ".internal-embed"] } },
        { name: "embed's renderer", open: COPY, at: 7, where: { embedded: true } },
        { name: "in the editor", open: COPY, at: 7, where: { inside: [".cm-editor"] } },
        { name: "a dialog up", open: COPY, at: 7, where: { modal: true } },
        { name: "drawn with another mark", open: COPY, at: 7, where: { mark: " " } },
        // Its section's first line read wrong: the line found is First draft, whose mark isn't the box's
        { name: "drawn on another line", open: COPY, at: 7, where: { start: 5, dataLine: 1 } },
    ];
    for (const c of cases) {
        const v = reading(notes(c.notes), c.open, c.at, lag);
        const before = v.notes();
        const r = await v.readClick({ answer: "Mark done", ...c.where });
        assert.deepEqual(plain(r), { asked: null, left: true }, c.name);
        const at = c.at - (c.where?.start === 5 ? 1 : 0);
        const line = before[c.open].split("\n")[at];
        const want = { ...before, [c.open]: before[c.open].split("\n").map((l, i) => (i === at ? l.replace(/\[(.)\]/, (m, k) => `[${k === " " ? "x" : " "}]`) : l)).join("\n") };
        assert.deepEqual(v.notes(), want, `${c.name}: only ${line} changed`);
        assert.equal(v.notices.length, 0, c.name);
    }
});

scenario("reading view: a line that changed since reading view drew it gets nothing written, and a notice says so", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 1, lag);
    const C = v.plainday.CheckOff;
    const job = C.readingClick(v.readingBox());
    assert.equal(job.tick.want, "x");
    // A change reaching the note between the drawing and the click (Sync, say)
    await v.app.vault.process(v.file(day("2026-09-17")), (t) => t.replace("Send final copy to Rafe [[Pine", "Send the final copy to Rafe [[Pine"));
    const before = v.notes();
    await C.tickRead(job.tick);
    assert.deepEqual(v.notes(), before);
    assert.deepEqual(plain(v.notices), ["This line changed just before the click, so nothing was written"]);
});

scenario("reading view: a line moved by a line added above it since the drawing is still found, by its ID", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 1, lag);
    const C = v.plainday.CheckOff;
    const job = C.readingClick(v.readingBox());
    await v.app.vault.process(v.file(day("2026-09-17")), (t) => `- [ ] Call the framer\n${t}`);
    await C.tickRead(job.tick);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.notices.length, 0);
});

test("readingLine finds a box's line as Obsidian does, its section's first line plus its data-line, however long the note", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    const long = Array.from({ length: 3000 }, (_, i) => (i === 2995 ? "- [>] Near the end [[2026-09-17#^e1nd00|9/17]] ^e1nd00" : i % 7 === 0 ? "" : `- [ ] Task ${i}`)).join("\n");
    const at = C.readingLine(long, 2990, "5", ">");
    assert.equal(at.line, 2995);
    assert.equal(at.text, "- [>] Near the end [[2026-09-17#^e1nd00|9/17]] ^e1nd00");
    assert.equal(at.lineAt(2994), "- [ ] Task 2994");
    // The mark drawn must be the line's; no section, a bad data-line, a line past the end or not a box: nothing
    assert.equal(C.readingLine(long, 2990, "5", " "), null);
    for (const [start, dl, mark] of [[null, "5", ">"], [2990, null, ">"], [2990, "-1", ">"], [2990, "x5", ">"], [2990, "5", null], [2999, "5", " "], [0, "0", " "]]) assert.equal(C.readingLine(long, start, dl, mark), null, JSON.stringify([start, dl, mark]));
    // Windows line ends, and `[ ]` drawn with an empty data-task, as Obsidian 1.15.1 draws it
    assert.equal(C.readingLine("a\r\n- [ ] B ^bbbbbb\r\n", 1, "0", "").text, "- [ ] B ^bbbbbb");
    assert.equal(C.readingLine("- [x] B ^bbbbbb", 0, "0", ""), null);
});

test("lineRange spans the lines that differ, past those both versions start and end with", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    assert.equal(C.lineRange(["a", "b"], ["a", "b"]), null);
    assert.deepEqual(plain(C.lineRange(["a", "- [ ] b", "c"], ["a", "- [x] b", "c"])), { fromA: 1, toA: 1, fromB: 1, toB: 1 });
    assert.deepEqual(plain(C.lineRange(["a", "b", "c"], ["a", "x", "b", "c"])), { fromA: 1, toA: 0, fromB: 1, toB: 1 });
});

// ------------------------------------------------------------------ Task Status's menu in reading view

scenario("reading view: Task Status's menu setting the open line done checks off the source, and todo puts it back", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 1, lag);
    assert.equal(await v.menu("x"), null);
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
    await v.menu(" ");
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.deepEqual(v.check(), []);
    assert.equal(v.notices.length, 0);
});

scenario("reading view: Task Status's menu setting in progress or todo on the source's [>] box puts it back to [>] and asks; Do nothing leaves it", async ({ lag }) => {
    for (const mark of ["/", " "]) {
        const v = reading(notes(), COPY, 7, lag);
        const before = v.notes();
        const asked = await v.menu(mark, { answer: "Do nothing" });
        assert.deepEqual(plain(asked), ASKED, JSON.stringify(mark));
        assert.deepEqual(v.notes(), before, JSON.stringify(mark));
        assert.deepEqual(v.check(), []);
    }
    const v = reading(notes(), COPY, 7, lag);
    await v.menu("/", { answer: "Mark done" });
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

scenario("reading view: Task Status's menu setting done on the source's [>] box completes the task at once, and on an earlier day's [>] line too", async ({ lag }) => {
    const v = reading(notes(), COPY, 7, lag);
    assert.equal(await v.menu("x"), null, "no question");
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
    const s = "- [>] Book the studio [[2026-09-18#^b5st0d|9/18]] ^b5st0d";
    const worked = "- [>] Book the studio [[Pinecrest Library Brochure|⭕]] [[Write brochure copy#^b5st0d|↗]] ^b5st0d";
    const w = reading(notes({ [COPY]: copyNote(`${SOURCE}\n${s}`), [day("2026-09-15")]: `${worked}\n\t- 9:00am - 9:30am\n`, [day("2026-09-18")]: `${worked.replace("[>]", "[/]")}\n` }), day("2026-09-15"), 0, lag);
    assert.equal(await w.menu("x"), null);
    assert.equal(w.notes()[day("2026-09-15")], `${worked}\n\t- 9:00am - 9:30am\n`, "that line goes back to [>]");
    assert.equal(w.notes()[day("2026-09-18")], `${worked.replace("[>]", "[x]")}\n`);
    assert.deepEqual(w.check(), []);
});

scenario("reading view: Task Status's menu changing another line than the one pressed (its count off in a long note) is followed on the line it changed", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 0, lag);
    // Pressed on line 0, written on line 1
    await v.menu("x", { line: 1 });
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

test("the watch on Task Status's menu: a press noted in reading view, kept once a dialog opens, taken by that note's next change of boxes only; a click forgets it", async () => {
    const v = reading(notes(), day("2026-09-17"), 1);
    const C = v.plainday.CheckOff, file = v.file(day("2026-09-17"));
    const jobs = [];
    C.enqueue = (job) => jobs.push(job);
    // A press that ends with no dialog up (a click) is forgotten
    C.pressed(v.readingBox());
    assert.equal(C.menu.path, file.path);
    C.released();
    assert.equal(C.menu, null);
    // A press whose dialog opened: another note's change isn't it, and this note's first change is
    C.pressed(v.readingBox());
    const w = C.menu, ob = v.observers.at(-1);
    assert.equal(ob.on, true);
    v.dialog(true);
    assert.equal(w.seen, true);
    C.released();
    assert.equal(C.menu, w, "a long press, released with the menu up");
    // The menu closes: still the menu's change for MENU_MS (menuTakes)
    v.dialog(false);
    assert.equal(typeof w.closed, "number");
    await C.modified(v.file(COPY));
    assert.equal(jobs.length, 0, "another note's change");
    // A change that isn't only boxes (a save from another pane) isn't the menu's: it's what the menu's is compared with
    await v.app.vault.process(file, (t) => t.replace("Renew the car registration", "Renew the car registration today"));
    await C.modified(file);
    assert.equal(jobs.length, 0, "not only boxes");
    assert.equal(C.menu, w);
    await v.app.vault.process(file, (t) => t.replace(OPEN, OPEN.replace("[ ]", "[x]")));
    await C.modified(file);
    assert.equal(jobs.length, 1, "the menu's");
    assert.equal(C.menu, null);
    assert.equal(ob.on, false);
    await C.modified(file);
    assert.equal(jobs.length, 1, "only the first change");
    // No press in the editor, an embed, or with a dialog already up
    for (const where of [{ inside: [".cm-editor"] }, { embedded: true }, { modal: true }, { inside: [".callout"] }]) {
        C.pressed(v.readingBox(where));
        assert.equal(C.menu ?? null, null, JSON.stringify(where));
    }
    // A note outside the system
    const o = reading(notes({ "Reference/Ideas.md": "- [ ] Send final copy to Rafe ^p7d2qe\n" }), "Reference/Ideas.md", 0);
    o.plainday.CheckOff.pressed(o.readingBox());
    assert.equal(o.plainday.CheckOff.menu ?? null, null);
});

test("menuTakes: once a dialog opened after the press, while it's up and until MENU_MS after it closes, for that note only", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    const w = { path: "a.md", seen: true, closed: null };
    assert.equal(C.menuTakes(w, "a.md", 5000), true);
    assert.equal(C.menuTakes(w, "b.md", 5000), false);
    assert.equal(C.menuTakes({ ...w, seen: false }, "a.md", 5000), false);
    assert.equal(C.menuTakes({ ...w, closed: 1000 }, "a.md", 1000 + C.MENU_MS), true);
    assert.equal(C.menuTakes({ ...w, closed: 1000 }, "a.md", 1001 + C.MENU_MS), false);
    assert.equal(C.menuTakes(null, "a.md", 0), false);
});

test("menuChanges: only the lines whose box alone changed", () => {
    const C = vm.runInContext(`${src("checkOff")}\n;CheckOff`, vm.createContext({}));
    const a = "- [>] A ^aaaaaa\n- [ ] B ^bbbbbb\ntext", b = "- [/] A ^aaaaaa\n- [ ] B, now ^bbbbbb\ntext";
    assert.deepEqual(plain(C.menuChanges(a, b)), [{ line: 0, was: 0, before: "- [>] A ^aaaaaa", after: "- [/] A ^aaaaaa" }]);
    assert.deepEqual(plain(C.menuChanges(a, a)), []);
    assert.deepEqual(plain(C.menuChanges("- [ ] A ^aaaaaa", "- [x] A, now ^aaaaaa")), []);
    // Two changes far apart, as many lines as before: each line on its own, however far (no MAX_LINES)
    const far = Array.from({ length: 400 }, (_, i) => `- [ ] T${i} ^t${String(i).padStart(5, "0")}`);
    const farB = far.map((l, i) => (i === 3 ? l.replace("T3", "T3, typed") : i === 380 ? l.replace("[ ]", "[x]") : l));
    assert.deepEqual(plain(C.menuChanges(far.join("\n"), farB.join("\n")).map((c) => c.line)), [380]);
    // A line added as well: not the menu's
    assert.deepEqual(plain(C.menuChanges(far.join("\n"), [...farB, "- [ ] new"].join("\n"))), []);
});

scenario("reading view: the calendar sync setting an event's box while Task Status's menu is up isn't the menu's: the pick that follows is", async ({ lag }) => {
    const ev = "- [<] 3:00pm\tPrinter call ^p1nt3r";
    const v = reading(notes({ [day("2026-09-17")]: `- [ ] Homepage build: category pages\n${OPEN}\n${ev}\n` }), day("2026-09-17"), 1, lag);
    const sync = () => v.app.vault.process(v.file(day("2026-09-17")), (t) => t.replace(ev, ev.replace("[<]", "[-]"))).then(() => v.plainday.CheckOff.modified(v.file(day("2026-09-17"))));
    await v.menu("x", { between: sync });
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

scenario("reading view: Task Status's menu while a save from another pane lands first: the save is passed over, and the pick followed", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 1, lag);
    const save = () => v.app.vault.process(v.file(day("2026-09-17")), (t) => t.replace("- [ ] Homepage build: category pages", "- [ ] Homepage build: category pages, and the footer")).then(() => v.plainday.CheckOff.modified(v.file(day("2026-09-17"))));
    await v.menu("x", { between: save });
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
});

test("the click listener's part for reading view stops a click only when CheckOff takes it, and runs what it takes", () => {
    const v = reading(notes(), COPY, 7);
    const C = v.plainday.CheckOff;
    const jobs = [], asks = [];
    C.enqueue = (job) => jobs.push(job);
    C.askLater = (args) => asks.push(args);
    const event = () => ({ stopped: 0, preventDefault() { this.stopped++; }, stopImmediatePropagation() { this.stopped++; } });
    // A [>] box: stopped and asked about
    const e1 = event();
    assert.equal(C.readingClicked(e1, v.readingBox()), true);
    assert.equal(e1.stopped, 2);
    assert.deepEqual(plain(asks.map((a) => [a.line, a.text, a.want, a.read])), [[7, SOURCE, " ", true]]);
    // A line it leaves alone: not stopped, nothing run
    const e2 = event();
    assert.equal(C.readingClicked(e2, v.readingBox({ line: 6 })), false);
    assert.equal(e2.stopped, 0);
    // A box on a day's open line: stopped, a tick run
    const d = reading(notes(), day("2026-09-17"), 1);
    const D = d.plainday.CheckOff, dj = [];
    D.enqueue = (job) => dj.push(job);
    const e3 = event();
    assert.equal(D.readingClicked(e3, d.readingBox()), true);
    assert.equal(e3.stopped, 2);
    assert.equal(dj.length, 1);
    // readingClick throwing (reading view changed): the click is Obsidian's
    D.readingClick = () => { throw new Error("changed"); };
    const e4 = event();
    assert.equal(D.readingClicked(e4, d.readingBox()), false);
    assert.equal(e4.stopped, 0);
});

scenario("reading view: a second click before the first was drawn finds its line already as it would make it, and does nothing", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 1, lag);
    const C = v.plainday.CheckOff;
    const first = C.readingClick(v.readingBox()), second = C.readingClick(v.readingBox());
    await C.tickRead(first.tick);
    await C.tickRead(second.tick);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(plain(v.notices), [], "no notice");
});

scenario("reading view: a click while a change waits to be drawn reads the line the page shows, and finds it in the note by its ID", async ({ lag }) => {
    const v = reading(notes(), day("2026-09-17"), 1, lag);
    const R = v.app.workspace.activeLeaf.view.previewMode.renderer;
    // Sync adds a line at the top; the page still shows the note as it was, its sections' lines unmoved
    R.lastText = R.text;
    await v.app.vault.process(v.file(day("2026-09-17")), (t) => `- [ ] Call the framer ^c4fr4m\n${t}`);
    const job = v.plainday.CheckOff.readingClick(v.readingBox({ start: 0, dataLine: 1, mark: " " }));
    assert.equal(job.tick.text, OPEN, "the line the page shows, not the one now under it");
    await v.plainday.CheckOff.tickRead(job.tick);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN.replace("[ ]", "[x]"));
    assert.equal(lineOf(v, day("2026-09-17"), "Homepage build"), "- [ ] Homepage build: category pages");
    assert.equal(lineOf(v, COPY, "Send final copy"), "- [x] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
});

scenario("reading view: a double click on a done source unticks it once, with no notice", async ({ lag }) => {
    const v = reading(notes(), COPY, 7, lag);
    await v.readClick({ answer: "Mark done" });
    const C = v.plainday.CheckOff;
    const first = C.readingClick(v.readingBox()), second = C.readingClick(v.readingBox());
    await C.tickRead(first.tick);
    await C.tickRead(second.tick);
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE);
    assert.equal(lineOf(v, day("2026-09-17"), "Send final copy"), OPEN);
    assert.deepEqual(plain(v.notices), []);
});

scenario("reading view: a [>] line that changed since reading view drew it asks nothing, and a notice says so", async ({ lag }) => {
    const v = reading(notes(), COPY, 7, lag);
    const C = v.plainday.CheckOff;
    const job = C.readingClick(v.readingBox());
    await v.app.vault.process(v.file(COPY), (t) => t.replace(SOURCE, SOURCE.replace("Send final copy", "Send the final copy")));
    let asked = 0;
    C.choose = async () => { asked++; return "Mark done"; };
    const before = v.notes();
    await C.ask(job.ask);
    assert.equal(asked, 0);
    assert.deepEqual(v.notes(), before);
    assert.deepEqual(plain(v.notices), ["This line changed just before the click, so nothing was written"]);
});

test("only Task Status's picker keeps a press noted: the system's own question opening after it doesn't", () => {
    const v = reading(notes(), COPY, 7);
    const C = v.plainday.CheckOff;
    C.pressed(v.readingBox({ line: 6 }));
    const w = C.menu;
    v.dialog("question");
    assert.equal(w.seen, false);
    C.released();
    assert.equal(C.menu, null, "forgotten on release");
    v.dialog(false);
    C.pressed(v.readingBox({ line: 6 }));
    v.dialog("prompt");
    assert.equal(C.menu.seen, true);
    v.dialog(false);
    C.unwatch();
});

scenario("Task Status opening a [>] box is put back and asked about on its line where it is now, after a job before it moved it", async ({ lag }) => {
    const v = reading(notes(), COPY, 7, lag);
    const C = v.plainday.CheckOff, f = v.file(COPY);
    const before = await v.app.vault.cachedRead(f);
    await v.app.vault.process(f, (t) => t.replace(SOURCE, SOURCE.replace("[>]", "[/]")));
    const changes = C.constructor.menuChanges(before, await v.app.vault.cachedRead(f));
    assert.equal(changes[0].line, 7);
    // A line added above it before the follow runs
    await v.app.vault.process(f, (t) => t.replace("Copy for the six panels.", "Copy for the six panels.\nAnd a map."));
    const asks = [];
    C.askLater = (args) => asks.push(args);
    await C.followMenu(f, changes);
    assert.deepEqual(plain(asks.map((a) => [a.line, a.text, a.want])), [[8, SOURCE, "/"]]);
    assert.equal(lineOf(v, COPY, "Send final copy"), SOURCE, "back to [>]");
});
