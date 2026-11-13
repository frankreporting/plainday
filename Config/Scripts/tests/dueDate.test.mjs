// Tests for plugin/src/classes/setDueDate.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// `placement` and `cursorAfter` first; then the command on a stand-in vault, with and without the cache a
// command behind: the deadline on every line of the task, and its task note's `due` (OBS-229). Every name,
// note and date here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { standIn, PLANNER } from "./standInVault.mjs";
import { classScript } from "../../../plugin/classShape.mjs";

const here = new URL(".", import.meta.url);
const DueDate = vm.runInContext(classScript("setDueDate.js") + "\n;DueDate", vm.createContext({}));
const due = new DueDate();
const D = "[[2026-09-30|🚩 9/30]]";
const apply = (line) => { const { from, to, text } = due.placement(line, D); return line.slice(0, from) + text + line.slice(to); };

test("placement: the due date goes before a trailing note link, so End still reaches the note (OBS-36)", () => {
    assert.equal(apply("- [ ] Renew the car [[Renew the car|⋯]]"), "- [ ] Renew the car [[2026-09-30|🚩 9/30]] [[Renew the car|⋯]]");
    assert.equal(apply("- [ ] Order toner [[Hawk Ledger|⭕]]"), "- [ ] Order toner [[2026-09-30|🚩 9/30]] [[Hawk Ledger|⭕]]");
    assert.equal(apply("- [ ] Mow [[Household|🗃️]]"), "- [ ] Mow [[2026-09-30|🚩 9/30]] [[Household|🗃️]]");
    assert.equal(apply("- [ ] A [[P|⭕]] [[A|⋯]]"), "- [ ] A [[2026-09-30|🚩 9/30]] [[P|⭕]] [[A|⋯]]", "before every trailing note link");
    assert.equal(apply("- [ ] A [[A|⋯]] "), "- [ ] A [[2026-09-30|🚩 9/30]] [[A|⋯]] ", "with U+FE0F, trailing space kept");
});

test("placement: with no note link at the end, the due date ends the line with a trailing space, as before", () => {
    assert.equal(apply("- [ ] Pay the invoice"), "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]] ");
    assert.equal(apply("- [ ] Pay the invoice "), "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]] ");
    assert.equal(apply("- [ ] Read [[Some note]] later"), "- [ ] Read [[Some note]] later [[2026-09-30|🚩 9/30]] ", "an ordinary link mid-line isn't a note link");
    assert.equal(apply("- [ ] A [[A|⋯]] and more"), "- [ ] A [[A|⋯]] and more [[2026-09-30|🚩 9/30]] ", "a ⋯ that isn't at the end stays where it is");
    assert.equal(apply("- [ ] "), "- [ ] [[2026-09-30|🚩 9/30]] ");
});

test("placement: a ⋯ note link (OBS-87), with or without U+FE0F, and an event's log at the end (OBS-57) are note links too", () => {
    assert.equal(apply("- [ ] Renew the car [[Renew the car|⋯]]"), "- [ ] Renew the car [[2026-09-30|🚩 9/30]] [[Renew the car|⋯]]");
    assert.equal(apply("- [ ] Renew the car [[Renew the car|⋯]]"), "- [ ] Renew the car [[2026-09-30|🚩 9/30]] [[Renew the car|⋯]]");
    assert.equal(apply("- [<] 9:00am\tStandup [[2026-09-14 Standup|⋯]] [[P|⭕]]"), "- [<] 9:00am\tStandup [[2026-09-30|🚩 9/30]] [[2026-09-14 Standup|⋯]] [[P|⭕]]");
});

test("placement: the 🚩 goes ahead of a forward date, and an ID stays last (OBS-107, OBS-185)", () => {
    const F = "[[2026-10-08#^k3x9m2|10/8]]";
    assert.equal(apply(`- [>] Book it ${F} ^k3x9m2`), `- [>] Book it [[2026-09-30|🚩 9/30]] ${F} ^k3x9m2`);
    assert.equal(apply(`- [>] Book it ${F} [[K|⭕]] [[Book it|⋯]] ^k3x9m2`), `- [>] Book it [[2026-09-30|🚩 9/30]] ${F} [[K|⭕]] [[Book it|⋯]] ^k3x9m2`);
    assert.equal(apply("- [ ] Book it [[K|⭕]] ^k3x9m2"), "- [ ] Book it [[2026-09-30|🚩 9/30]] [[K|⭕]] ^k3x9m2");
    assert.equal(apply("- [ ] Book it ^k3x9m2"), "- [ ] Book it [[2026-09-30|🚩 9/30]] ^k3x9m2", "no links: before the ID, not after it");
    assert.equal(apply("- [>] Book it [[2026w41#^k3x9m2|Wk of 10/4]] ^k3x9m2"), "- [>] Book it [[2026-09-30|🚩 9/30]] [[2026w41#^k3x9m2|Wk of 10/4]] ^k3x9m2", "to a week");
    assert.equal(apply("- [>] Book it [[2026-10-08#^k3x9m2|➡️ 10/8]] ^k3x9m2"), "- [>] Book it [[2026-09-30|🚩 9/30]] [[2026-10-08#^k3x9m2|➡️ 10/8]] ^k3x9m2", "one written with a ➡️");
    assert.equal(apply("- [ ] Follow up on [[2026-09-15#^abc123|the call]] ^k3x9m2"), "- [ ] Follow up on [[2026-09-15#^abc123|the call]] [[2026-09-30|🚩 9/30]] ^k3x9m2", "a block link of your own is text: the 🚩 goes after it");
});

test("placement: a 🚩 already on the line is replaced where it sits, not joined by a second (OBS-65)", () => {
    const F = "[[2026-10-08#^k3x9m2|10/8]]";
    assert.equal(apply("- [ ] Draft the proposal [[2026-09-18|🚩 9/18]] [[Draft the proposal|⋯]]"), "- [ ] Draft the proposal [[2026-09-30|🚩 9/30]] [[Draft the proposal|⋯]]");
    assert.equal(apply("- [ ] Pay the invoice [[2026-09-18|🚩 9/18]] "), "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]] ", "at the end, the trailing space kept");
    assert.equal(apply("- [ ] Pay the invoice [[2026-09-18|🚩 9/18]]"), "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]]", "at the end, no space added");
    assert.equal(apply("- [ ] Book [[2026-09-18|🚩 9/18]] the room [[K|⭕]]"), "- [ ] Book [[2026-09-30|🚩 9/30]] the room [[K|⭕]]", "mid-line stays mid-line");
    assert.equal(apply(`- [>] Book it [[2026-09-18|🚩 9/18]] ${F} [[K|⭕]] [[Book it|⋯]] ^k3x9m2`), `- [>] Book it [[2026-09-30|🚩 9/30]] ${F} [[K|⭕]] [[Book it|⋯]] ^k3x9m2`, "ahead of a forward date, with the ID last");
    assert.equal(apply("- [ ] Book it [[Planner/days/2026-09-18|🚩 9/18]] [[K|⭕]]"), "- [ ] Book it [[2026-09-30|🚩 9/30]] [[K|⭕]]", "a link with its folder");
    assert.equal(apply("- [ ] Book it [[2026-09-18|🚩\uFE0F 9/18]] [[K|⭕]]"), "- [ ] Book it [[2026-09-30|🚩 9/30]] [[K|⭕]]", "with the U+FE0F a phone may add");
});

test("placement: a line with several 🚩 ends with one, where the first was (OBS-65)", () => {
    assert.equal(apply("- [ ] Draft it [[2026-09-18|🚩 9/18]] [[2026-09-25|🚩 9/25]] [[Draft it|⋯]]"), "- [ ] Draft it [[2026-09-30|🚩 9/30]] [[Draft it|⋯]]");
    assert.equal(apply("- [ ] Draft [[2026-09-18|🚩 9/18]] the outline [[2026-09-25|🚩 9/25]] [[Draft it|⋯]]"), "- [ ] Draft [[2026-09-30|🚩 9/30]] the outline [[Draft it|⋯]]", "the words between them stay");
});

test("placement: a link that isn't a due date stays on the line (OBS-65)", () => {
    assert.equal(apply("- [ ] Recap [[2026-09-18|9/18]] [[Recap|⋯]]"), "- [ ] Recap [[2026-09-18|9/18]] [[2026-09-30|🚩 9/30]] [[Recap|⋯]]", "a daily note with no 🚩");
    assert.equal(apply("- [ ] Recap [[2026-09-18]] with [[2026-09-20|🚩 9/20]] "), "- [ ] Recap [[2026-09-18]] with [[2026-09-30|🚩 9/30]] ", "beside a 🚩, a plain link is left alone");
    assert.equal(apply("- [ ] Recap [[Launch plan|🚩 launch]]"), "- [ ] Recap [[Launch plan|🚩 launch]] [[2026-09-30|🚩 9/30]] ", "a 🚩 on a link to any other note");
});

test("cursorAfter: the cursor stays on the words it was on, wherever the 🚩 goes (Brian, 2026-10-30)", () => {
    const L = "[[2026-10-12|🚩 10/12]]", after = (line, ch) => due.cursorAfter(ch, due.placement(line, L));
    const title = "- [ ] Book it".length, flagged = "- [ ] Book it [[2026-09-18|🚩 9/18]] [[K|⭕]]", linked = "- [ ] Book it [[K|⭕]]";
    assert.equal(after(flagged, 8), 8, "in the title");
    assert.equal(after(flagged, title), title, "at the end of the title, where End stops");
    assert.equal(after(flagged, title + 5), title + 1, "inside the old 🚩: the start of the new one");
    assert.equal(after(flagged, flagged.length), flagged.length + 1, "past it, carried along by the longer date");
    assert.equal(after("- [ ] Book it", title), title, "a 🚩 added at the end goes after the cursor");
    assert.equal(after(linked, title), title, "so does one added before the links");
    assert.equal(after(linked, linked.length), `- [ ] Book it ${L} [[K|⭕]]`.length, "past the links, carried along");
});

// ---------------------------------------------------------------- every line of the task (OBS-229)

const day = (d) => `${PLANNER}/days/${d}.md`;
const PROJECT = "---\ntags: [project]\n---\n";
const OLD = "Projects/Old/Old.md", AREA = "Projects/Home/Home.md";
const NOTE = "Projects/Old/Write copy.md", LOG = "Projects/Old/›logs/2026-09-16 Planning.md";
const NOTE_FM = 'id: 2026091110000000\ntags: \n- task\nparent: "[[Old]]"\ndue: 2026-09-18\n';
// A task with a note, on two days by its ID and in its project's To Do by its ⋯; a nested task with its own 🚩;
// the note's subtask, sent to 9/17; a line with neither an ID nor a ⋯
const NOTES = {
    [OLD]: `${PROJECT}## To Do\n\n- [ ] Write copy [[Write copy|⋯]]\n`,
    [AREA]: "---\ntags: [area]\n---\n",
    [NOTE]: `---\n${NOTE_FM}---\nText.\n\n- [x] First pass\n- [>] Send it [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n`,
    [LOG]: "---\ntags: [log]\n---\n",
    [day("2026-09-11")]: "- [x] Copy: first draft [[Old|⭕]] [[Write copy|⋯]]\n\t- 3:00pm - 4:20pm\n\t- [ ] Find the brief [[2026-09-30|🚩 9/30]]\n",
    [day("2026-09-14")]: "- [>] Copy: revisions [[2026-09-18|🚩 9/18]] [[Old|⭕]] [[Write copy|⋯]] ^w2h5nf\n- [x] Reply about dates [[Old|⭕]]\n",
    [day("2026-09-15")]: "- [ ] Copy: revisions [[2026-09-18|🚩 9/18]] [[Old|⭕]] [[Write copy|⋯]] ^w2h5nf\n",
    [day("2026-09-17")]: "- [ ] Send it [[Old|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n",
};
const scenario = (name, fn) => {
    for (const lag of [false, true]) test(`${name}${lag ? " (the cache a command behind)" : ""}`, () => fn({ lag }));
};
const lineWith = (v, path, text) => v.notes()[path].split("\n").find((l) => l.includes(text));
const flags = (line) => [...line.matchAll(/\[\[\d{4}-\d{2}-\d{2}\|🚩 [^\]]*\]\]/gu)].map((m) => m[0]);
// DueDate on the line of `path` holding `text`, cursor at column `ch` (else the end of the line), picking `date`
const run = async (v, path, text, date, ch = null) => {
    const at = v.lineOf(path, text);
    assert.notEqual(at, -1, `${path}: ${text}`);
    v.open(path, at, ch);
    v.notices.length = 0;
    return v.dueDate(date);
};
const dueOf = (v, path) => v.notes()[path].match(/^due:(.*)$/m)?.[1].trim();
// How many lines in the vault show the 🚩 for `date` ("YYYY-MM-DD")
const shows = (v, date) => Object.values(v.notes()).flatMap((t) => t.split("\n")).filter((l) => l.includes(`[[${date}|🚩 `)).length;

scenario("DueDate on a task's day: every line by its ID and by its ⋯ gets the one 🚩, and its task note's due follows", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25", "- [ ] Copy".length);
    const want = "[[2026-09-25|🚩 9/25]]";
    assert.equal(lineWith(v, day("2026-09-15"), "Copy: revisions"), `- [ ] Copy: revisions ${want} [[Old|⭕]] [[Write copy|⋯]] ^w2h5nf`);
    assert.equal(lineWith(v, day("2026-09-14"), "Copy: revisions"), `- [>] Copy: revisions ${want} [[Old|⭕]] [[Write copy|⋯]] ^w2h5nf`, "by its ID, the old 🚩 replaced");
    assert.equal(lineWith(v, day("2026-09-11"), "first draft"), `- [x] Copy: first draft ${want} [[Old|⭕]] [[Write copy|⋯]]`, "by its ⋯, a done line too");
    assert.equal(lineWith(v, OLD, "Write copy"), `- [ ] Write copy ${want} [[Write copy|⋯]]`, "its line in the project note");
    assert.equal(dueOf(v, NOTE), "2026-09-25");
    assert.equal(v.notes()[NOTE], NOTES[NOTE].replace("due: 2026-09-18", "due: 2026-09-25"), "the note's other properties and text stay");
    // A subtask keeps its own deadline, a nested task its own 🚩, and a line of another task has none
    assert.equal(lineWith(v, day("2026-09-17"), "Send it"), NOTES[day("2026-09-17")].trim());
    assert.equal(lineWith(v, NOTE, "Send it"), "- [>] Send it [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.equal(lineWith(v, day("2026-09-11"), "Find the brief"), "\t- [ ] Find the brief [[2026-09-30|🚩 9/30]]");
    assert.equal(lineWith(v, day("2026-09-14"), "Reply about dates"), "- [x] Reply about dates [[Old|⭕]]");
    assert.equal(shows(v, "2026-09-25"), 4);
    assert.deepEqual(v.notices, [], "nothing to say when it all went through");
    assert.deepEqual(v.placed(), { line: 0, ch: "- [ ] Copy".length }, "the cursor stays on the same words");
    assert.deepEqual(v.problems(), []);
    // Again, from the project note's line: the same lines, one 🚩 each
    await run(v, OLD, "Write copy", "2026-09-26", 8);
    for (const [path, text] of [[OLD, "Write copy"], [day("2026-09-11"), "first draft"], [day("2026-09-14"), "Copy: revisions"], [day("2026-09-15"), "Copy: revisions"]]) {
        assert.deepEqual(flags(lineWith(v, path, text)), ["[[2026-09-26|🚩 9/26]]"], `${path}: ${text}`);
    }
    assert.equal(dueOf(v, NOTE), "2026-09-26");
    assert.equal(shows(v, "2026-09-26"), 4);
    assert.deepEqual(v.notices, []);
    // The same date again changes nothing, the note included, and says nothing
    const before = v.notes();
    await run(v, day("2026-09-14"), "Copy: revisions", "2026-09-26");
    assert.deepEqual(v.notes(), before);
    assert.deepEqual(v.notices, []);
});

scenario("DueDate on a subtask's day: its own lines by its ID, never its task note's due or the task's other lines", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    await run(v, day("2026-09-17"), "Send it", "2026-09-24");
    assert.equal(lineWith(v, day("2026-09-17"), "Send it"), "- [ ] Send it [[2026-09-24|🚩 9/24]] [[Old|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    assert.equal(lineWith(v, NOTE, "Send it"), "- [>] Send it [[2026-09-24|🚩 9/24]] [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe", "before its forward date");
    assert.equal(dueOf(v, NOTE), "2026-09-18");
    for (const p of [OLD, day("2026-09-11"), day("2026-09-14"), day("2026-09-15")]) assert.equal(v.notes()[p], NOTES[p], p);
    assert.equal(shows(v, "2026-09-24"), 2);
    assert.deepEqual(v.notices, []);
    // And from the subtask's line in the note: the same two lines
    await run(v, NOTE, "Send it", "2026-09-23");
    assert.deepEqual(flags(lineWith(v, day("2026-09-17"), "Send it")), ["[[2026-09-23|🚩 9/23]]"]);
    assert.equal(dueOf(v, NOTE), "2026-09-18");
});

scenario("DueDate on a line with no ID and no ⋯ writes that line alone, and says nothing", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    await run(v, day("2026-09-14"), "Reply about dates", "2026-09-19");
    assert.equal(lineWith(v, day("2026-09-14"), "Reply about dates"), "- [x] Reply about dates [[2026-09-19|🚩 9/19]] [[Old|⭕]]");
    for (const p of Object.keys(NOTES).filter((p) => p !== day("2026-09-14"))) assert.equal(v.notes()[p], NOTES[p], p);
    assert.deepEqual(v.notices, []);
});

scenario("DueDate with one line and a task note: only the note's due changes, and nothing is said", async ({ lag }) => {
    const notes = { ...NOTES, [day("2026-09-16")]: "- [ ] Proofread [[Old|⭕]] [[Proofread|⋯]]\n", "Projects/Old/Proofread.md": "---\ntags: [task]\ndue: \n---\n" };
    const v = standIn({ notes, lag });
    await run(v, day("2026-09-16"), "Proofread", "2026-09-22");
    assert.equal(dueOf(v, "Projects/Old/Proofread.md"), "2026-09-22", "an empty due, as the Task template leaves it, is filled");
    assert.deepEqual(v.notices, []);
    // A task note with no due at all gets one
    const w = standIn({ notes: { ...notes, "Projects/Old/Proofread.md": "---\ntags: [task]\n---\n" }, lag });
    await run(w, day("2026-09-16"), "Proofread", "2026-09-22");
    assert.equal(dueOf(w, "Projects/Old/Proofread.md"), "2026-09-22");
});

scenario("DueDate sets due only on a task note: not a log, a plain note, a project's or area's own note, or a note in Archive or outside the system", async ({ lag }) => {
    const cases = [
        ["a log", LOG, "---\ntags: [log]\n---\n", []],
        ["a plain note", "Projects/Old/Reading list.md", "---\ntags: [reading]\n---\n", []],
        ["a project's own note", OLD, NOTES[OLD], []],
        ["an area's own note", AREA, NOTES[AREA], []],
        ["a task note in Archive", "Archive/Old/Old copy.md", "---\ntags: [task]\ndue: 2026-09-18\n---\n", ["Old copy is in Archive, so its due wasn't changed"]],
        ["a task note outside the system", "Reference/Old copy.md", "---\ntags: [task]\ndue: 2026-09-18\n---\n", ["Old copy isn't in Projects or the Inbox, so its due wasn't changed"]],
        ["a note tagged both task and log", "Projects/Old/Both.md", "---\ntags: [task, log]\n---\n", []],
    ];
    for (const [what, path, text, said] of cases) {
        const name = path.split("/").pop().replace(/\.md$/, "");
        const notes = { ...NOTES, [path]: text, [day("2026-09-16")]: `- [ ] Look into it [[${name}|⋯]] ^lk0001\n`, [day("2026-09-18")]: `- [>] Look into it [[${name}|⋯]] ^lk0001\n` };
        const v = standIn({ notes, lag });
        await run(v, day("2026-09-16"), "Look into it", "2026-09-25");
        assert.equal(v.notes()[path], text, `${what}: no due`);
        assert.deepEqual(flags(lineWith(v, day("2026-09-18"), "Look into it")), ["[[2026-09-25|🚩 9/25]]"], `${what}: the task's other line still changes`);
        assert.equal(shows(v, "2026-09-25"), 2, what);
        assert.deepEqual(v.notices, said, what);
    }
});

scenario("DueDate on a task whose lines link two task notes sets due on both", async ({ lag }) => {
    const notes = {
        ...NOTES,
        "Projects/Old/Outline.md": "---\ntags: [task]\ndue: 2026-09-18\n---\n",
        [day("2026-09-16")]: "- [>] Outline it [[Old|⭕]] [[Write copy|⋯]] ^ot0001\n",
        [day("2026-09-18")]: "- [ ] Outline it [[Old|⭕]] [[Outline|⋯]] ^ot0001\n",
    };
    const v = standIn({ notes, lag });
    await run(v, day("2026-09-18"), "Outline it", "2026-09-25");
    assert.equal(dueOf(v, NOTE), "2026-09-25");
    assert.equal(dueOf(v, "Projects/Old/Outline.md"), "2026-09-25");
    // Write copy's lines are this task's lines too: they link the same note
    assert.deepEqual(flags(lineWith(v, day("2026-09-15"), "Copy: revisions")), ["[[2026-09-25|🚩 9/25]]"]);
    assert.equal(shows(v, "2026-09-25"), 6);
    assert.deepEqual(v.notices, []);
});

scenario("DueDate leaves an event line among a task's lines without a 🚩, and its log without a due", async ({ lag }) => {
    // Only a hand edit makes this: a task line whose ⋯ links a meeting log, which its event line links too
    const notes = {
        ...NOTES,
        [day("2026-09-16")]: "- [<] 10:00am\tPlanning [[Old|⭕]] [[2026-09-16 Planning|⋯]]\n\t- 10:00am - 10:30am\n- [ ] Plan the copy [[Old|⭕]] [[2026-09-16 Planning|⋯]]\n",
    };
    const v = standIn({ notes, lag });
    await run(v, day("2026-09-16"), "Plan the copy", "2026-09-25");
    const lines = v.notes()[day("2026-09-16")].split("\n");
    assert.equal(lines[0], "- [<] 10:00am\tPlanning [[Old|⭕]] [[2026-09-16 Planning|⋯]]");
    assert.deepEqual(flags(lines[2]), ["[[2026-09-25|🚩 9/25]]"]);
    assert.equal(v.notes()[LOG], NOTES[LOG]);
    assert.deepEqual(v.notices, []);
});

scenario("DueDate on a nested task writes the task at the top of its nest, on every line, and the nested task keeps its own 🚩", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    await run(v, day("2026-09-11"), "Find the brief", "2026-09-25");
    // On a nested task, the deadline is the task's: the line at the top of the nest, and every line of that task
    assert.equal(lineWith(v, day("2026-09-11"), "Find the brief"), "\t- [ ] Find the brief [[2026-09-30|🚩 9/30]]", "the nested task's own 🚩 stays");
    assert.deepEqual(flags(lineWith(v, day("2026-09-11"), "first draft")), ["[[2026-09-25|🚩 9/25]]"]);
    assert.deepEqual(flags(lineWith(v, day("2026-09-15"), "Copy: revisions")), ["[[2026-09-25|🚩 9/25]]"]);
    assert.equal(dueOf(v, NOTE), "2026-09-25");
});

scenario("DueDate: a line that changes between the search and the write keeps its old 🚩, is named, and running again finishes", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    const change = v.plainday.TaskChange, find = change.find.bind(change);
    // Sync merges an edit from the phone into 9/14 just after the search read it
    change.find = async (...args) => {
        const found = await find(...args);
        await v.app.vault.process(v.file(day("2026-09-14")), (t) => t.replace("Copy: revisions", "Copy: second revisions"));
        return found;
    };
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.deepEqual(flags(lineWith(v, day("2026-09-14"), "second revisions")), ["[[2026-09-18|🚩 9/18]]"], "left as it is");
    assert.deepEqual(flags(lineWith(v, day("2026-09-11"), "first draft")), ["[[2026-09-25|🚩 9/25]]"], "the other lines are written");
    assert.equal(dueOf(v, NOTE), "2026-09-25");
    assert.equal(shows(v, "2026-09-25"), 3);
    assert.deepEqual(v.notices, ["9/14's line changed meanwhile, so it kept its old deadline. Run DueDate again to finish"]);
    change.find = find;
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.deepEqual(flags(lineWith(v, day("2026-09-14"), "second revisions")), ["[[2026-09-25|🚩 9/25]]"]);
    assert.equal(shows(v, "2026-09-25"), 4);
    assert.deepEqual(v.notices, [], "finished: nothing to say");
});

scenario("DueDate: a note it can't write is named, and the rest is written", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    const process = v.app.vault.process;
    v.app.vault.process = async (f, fn) => { if (f.path === OLD) throw new Error("disk full"); return process(f, fn); };
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.equal(v.notes()[OLD], NOTES[OLD]);
    assert.deepEqual(flags(lineWith(v, day("2026-09-14"), "Copy: revisions")), ["[[2026-09-25|🚩 9/25]]"]);
    assert.equal(dueOf(v, NOTE), "2026-09-25");
    assert.equal(shows(v, "2026-09-25"), 3);
    assert.deepEqual(v.notices, ["Couldn't write to Old; run DueDate again to finish"]);
});

scenario("DueDate while Obsidian is still indexing changes nothing, and says to try again, before the date box", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    v.app.metadataCache.initialized = false;
    assert.equal(await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25"), null, "no date box");
    assert.deepEqual(v.notes(), NOTES);
    assert.deepEqual(v.notices, ["Obsidian is still indexing the vault; try again in a moment"]);
});

scenario("DueDate leaves a line that shows the date already as it is, and says nothing", async ({ lag }) => {
    const notes = {
        [OLD]: PROJECT, "Projects/Old/Spec.md": "---\ntags: [task]\n---\n",
        [day("2026-09-11")]: "- [x] Spec [[Old|⭕]] [[Spec|⋯]]\n",
        [day("2026-09-14")]: "- [x] Spec [[2026-09-25|🚩 9/25]] [[Old|⭕]] [[Spec|⋯]]\n",
        [day("2026-09-15")]: "- [ ] Spec [[Old|⭕]] [[Spec|⋯]]\n",
    };
    const v = standIn({ notes, lag });
    await run(v, day("2026-09-15"), "Spec", "2026-09-25");
    assert.equal(v.notes()[day("2026-09-14")], notes[day("2026-09-14")]);
    for (const d of ["2026-09-11", "2026-09-15"]) assert.deepEqual(flags(lineWith(v, day(d), "Spec")), ["[[2026-09-25|🚩 9/25]]"], d);
    assert.equal(dueOf(v, "Projects/Old/Spec.md"), "2026-09-25");
    assert.deepEqual(v.notices, []);
});

scenario("DueDate gives the 🚩 to lines whose ⋯ links a task note in Archive or outside the system, and leaves that note's due", async ({ lag }) => {
    for (const [path, said] of [["Archive/Old/Old copy.md", "Old copy is in Archive, so its due wasn't changed"], ["Reference/Old copy.md", "Old copy isn't in Projects or the Inbox, so its due wasn't changed"]]) {
        const text = "---\ntags: [task]\ndue: 2026-09-18\n---\n- [ ] Its own line [[Old copy|⋯]]\n";
        const notes = { ...NOTES, [path]: text, [day("2026-09-16")]: "- [ ] Look into it [[Old copy|⋯]]\n", [day("2026-09-17")]: "- [ ] Look into it more [[Old copy|⋯]]\n" };
        const v = standIn({ notes, lag });
        await run(v, day("2026-09-16"), "Look into it", "2026-09-25");
        assert.deepEqual(flags(lineWith(v, day("2026-09-17"), "Look into it more")), ["[[2026-09-25|🚩 9/25]]"], path);
        assert.equal(v.notes()[path], text, `${path}: its due and its own line stay, since no command works there`);
        assert.equal(shows(v, "2026-09-25"), 2, path);
        assert.deepEqual(v.notices, [said], path);
    }
});

scenario("DueDate writes the same lines whichever line of the task it starts from", async ({ lag }) => {
    // Lines that disagree, which the report lists: a subtask's day links its task note, its other day the subtask's own note
    const notes = {
        [OLD]: PROJECT,
        "Projects/Old/Mobile.md": "---\ntags: [task]\n---\n",
        "Projects/Old/Wireframes.md": "---\ntags: [task]\n---\n- [ ] Mobile [[Mobile|⋯]]\n",
        [day("2026-09-11")]: "- [x] Wireframes [[Old|⭕]] [[Wireframes|⋯]]\n",
        [day("2026-09-14")]: "- [>] Mobile [[Old|⭕]] [[Wireframes|⋯]] ^mb0001\n",
        [day("2026-09-15")]: "- [ ] Mobile [[Old|⭕]] [[Mobile|⋯]] ^mb0001\n",
    };
    const after = [];
    for (const [path, text] of [[day("2026-09-14"), "Mobile"], [day("2026-09-15"), "Mobile"], [day("2026-09-11"), "Wireframes"], ["Projects/Old/Wireframes.md", "Mobile"]]) {
        const v = standIn({ notes, lag });
        await run(v, path, text, "2026-09-25");
        after.push(v.notes());
    }
    for (const notes of after.slice(1)) assert.deepEqual(notes, after[0]);
});

scenario("DueDate names a note it couldn't write once, though both its line and its due failed", async ({ lag }) => {
    const v = standIn({ notes: { ...NOTES, [NOTE]: NOTES[NOTE].replace("- [x] First pass", "- [x] First pass\n- [ ] Write copy [[Write copy|⋯]]") }, lag });
    const process = v.app.vault.process;
    v.app.vault.process = async (f, fn) => { if (f.path === NOTE) throw new Error("disk full"); return process(f, fn); };
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.equal(dueOf(v, NOTE), "2026-09-18");
    assert.equal(shows(v, "2026-09-25"), 4);
    assert.deepEqual(v.notices, ["Couldn't write to Write copy; run DueDate again to finish"]);
});

scenario("DueDate in the task note itself: the line written in the editor and the note's due both hold", async ({ lag }) => {
    // A subtask's day whose ⋯ links its task note: the note you're in is one of the task's own notes
    const notes = { ...NOTES, [day("2026-09-17")]: "- [ ] Send it [[Old|⭕]] [[Write copy|⋯]] ^p7d2qe\n" };
    const v = standIn({ notes, lag });
    await run(v, NOTE, "Send it", "2026-09-25", 8);
    assert.equal(lineWith(v, NOTE, "Send it"), "- [>] Send it [[2026-09-25|🚩 9/25]] [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.equal(dueOf(v, NOTE), "2026-09-25");
    assert.deepEqual(v.placed(), { line: v.lineOf(NOTE, "Send it"), ch: 8 });
});

scenario("DueDate on another line of the task in the note you're in writes it through the editor, the cursor staying", async ({ lag }) => {
    const W = `${PLANNER}/weeks/2026w38.md`;
    const notes = { ...NOTES, [W]: "- [ ] Copy: revisions [[Old|⭕]] [[Write copy|⋯]]\n- [ ] Other\n- [>] Copy: revisions [[2026-09-15#^w2h5nf|9/15]] [[Old|⭕]] ^w2h5nf\n" };
    const v = standIn({ notes, lag });
    await run(v, W, "Copy: revisions", "2026-09-25", 9);
    assert.deepEqual(v.notes()[W].split("\n").map(flags), [["[[2026-09-25|🚩 9/25]]"], [], ["[[2026-09-25|🚩 9/25]]"], []], "both of the week's lines");
    assert.deepEqual(v.placed(), { line: 0, ch: 9 });
    assert.equal(shows(v, "2026-09-25"), 6);
    assert.deepEqual(v.notices, []);
});

scenario("DueDate stops at the task: a subtask's own note is never named, wherever it is", async ({ lag }) => {
    const notes = {
        ...NOTES,
        [NOTE]: NOTES[NOTE].replace("- [x] First pass", "- [ ] Research [[Old research|⋯]]"),
        "Archive/Old/Old research.md": "---\ntags: [task]\n---\n",
        [day("2026-09-16")]: "- [ ] Polish [[Old|⭕]] [[Write copy|⋯]]\n",
    };
    const v = standIn({ notes: { [OLD]: PROJECT, [NOTE]: notes[NOTE], "Archive/Old/Old research.md": notes["Archive/Old/Old research.md"], [day("2026-09-16")]: notes[day("2026-09-16")] }, lag });
    await run(v, day("2026-09-16"), "Polish", "2026-09-25");
    assert.equal(dueOf(v, NOTE), "2026-09-25");
    assert.deepEqual(v.notices, []);
    assert.equal(lineWith(v, NOTE, "Research"), "- [ ] Research [[Old research|⋯]]");
});

scenario("DueDate names a line that changed meanwhile in a project note by the note", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    const change = v.plainday.TaskChange, find = change.find.bind(change);
    change.find = async (...args) => {
        const found = await find(...args);
        await v.app.vault.process(v.file(OLD), (t) => t.replace("- [ ] Write copy", "- [ ] Write the copy"));
        return found;
    };
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.deepEqual(v.notices, ["Old's line changed meanwhile, so it kept its old deadline. Run DueDate again to finish"]);
});

test("withDue: only the due line changes, or one is added at the end of the properties; a shape one line can't settle is left to Obsidian", () => {
    const set = (text) => JSON.parse(JSON.stringify(DueDate.withDue(text, "2026-09-25")));
    const demo = 'id: 2026091410552318\ntags: \n- task\nparent: "[[Kestrel|⭕.Freelance.Kestrel]]"\n';
    assert.deepEqual(set(`---\n${demo}due: 2026-09-18\n---\nBody\n`), { text: `---\n${demo}due: 2026-09-25\n---\nBody\n` }, "the demo's layout kept to the byte");
    assert.deepEqual(set("---\ntags: [task]\ndue: \n---\n"), { text: "---\ntags: [task]\ndue: 2026-09-25\n---\n" }, "empty, as the Task template leaves it");
    assert.deepEqual(set('---\ndue: "2026-09-18"\ntags: [task]\n---\n'), { text: "---\ndue: 2026-09-25\ntags: [task]\n---\n" }, "quoted");
    assert.deepEqual(set("---\ntags:\n  - task\n---\nBody\n"), { text: "---\ntags:\n  - task\ndue: 2026-09-25\n---\nBody\n" }, "none: added last");
    assert.deepEqual(set("---\r\ntags: [task]\r\ndue: 2026-09-18\r\n---\r\n"), { text: "---\r\ntags: [task]\r\ndue: 2026-09-25\r\n---\r\n" }, "Windows line ends");
    assert.deepEqual(set("---\ndue: '2026-09-25'\n---\n"), { same: true });
    assert.deepEqual(set("\uFEFF---\ntags: [task]\ndue: 2026-09-18\n---\n"), { text: "\uFEFF---\ntags: [task]\ndue: 2026-09-25\n---\n" }, "a BOM");
    assert.deepEqual(set("---\nnotes: |\n  Draft\n  ---\n  More\ntags: [task]\n---\nBody\n"), { text: "---\nnotes: |\n  Draft\n  ---\n  More\ntags: [task]\ndue: 2026-09-25\n---\nBody\n" }, "a --- inside a value isn't the end");
    assert.deepEqual(set("---\nmeta:\n  due: 2026-01-01\n---\n"), null, "a due in a nested map");
    assert.deepEqual(set("---\ndue_date: 2026-01-01\n---\n"), { text: "---\ndue_date: 2026-01-01\ndue: 2026-09-25\n---\n" }, "due_date is another key");
    // A quoted value over several lines with a `due:` line inside it gets past the line match: what keeps it whole
    // is setDue's check that Obsidian reads the edited block as the same properties (a scenario below)
    assert.ok(set('---\nnote: "first\ndue: 2026-09-18\nend: x"\ntags: [task]\n---\n').text, "left to setDue's check");
    // Left to Obsidian: no block, an unclosed one, two keys, a quoted key, a comment, a value on more lines, a value that isn't a date
    for (const odd of [
        "Body only\n", "---\ntags: [task]\n", "---\ndue: 2026-09-18\ndue: 2026-09-19\n---\n", '---\n"due": 2026-09-18\n---\n',
        "---\ndue: 2026-09-18 # by hand\n---\n", "---\ndue:\n  - 2026-09-18\n---\n", "---\ndue:\n\n  - 2026-09-18\n---\n",
        "---\ndue: >\n  2026-09-18\n---\n", "---\ndue: [[2026-09-18]]\n---\n", "---\ndue: next week\n---\n", "---\ndue: 2026-09-18\n# a comment\n---\n",
    ]) assert.equal(set(odd), null, JSON.stringify(odd));
});


scenario("DueDate: lines whose ⋯ links a plain note outside the system, such as a person's, aren't one task, and nothing is said", async ({ lag }) => {
    const notes = {
        [OLD]: PROJECT, "Reference/People/Pat.md": "---\ntags: [person]\n---\n",
        [day("2026-09-14")]: "- [ ] Call Pat [[Old|⭕]] [[Pat|⋯]]\n", [day("2026-09-15")]: "- [ ] Email Pat [[Old|⭕]] [[Pat|⋯]]\n",
    };
    const v = standIn({ notes, lag });
    await run(v, day("2026-09-14"), "Call Pat", "2026-09-25");
    assert.deepEqual(flags(lineWith(v, day("2026-09-14"), "Call Pat")), ["[[2026-09-25|🚩 9/25]]"]);
    assert.equal(v.notes()[day("2026-09-15")], notes[day("2026-09-15")]);
    assert.deepEqual(v.notices, []);
});



scenario("DueDate: a task note whose properties Obsidian can't read keeps them, and the notice says why", async ({ lag }) => {
    const v = standIn({ notes: NOTES, lag });
    const ob = v.globals, parse = ob.parseYaml;
    ob.parseYaml = (y) => { if (/parent:/.test(y)) throw new Error("duplicated mapping key"); return parse(y); };
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.equal(v.notes()[NOTE], NOTES[NOTE]);
    assert.equal(shows(v, "2026-09-25"), 4);
    assert.deepEqual(v.notices, ["Write copy's properties can't be read, so its due wasn't changed. Fix them, then run DueDate again"]);
});

// Every scenario below also checks that DueDate never calls processFrontMatter (Brian, 2026-11-06)
const noFrontMatter = (v) => { v.app.fileManager.processFrontMatter = async () => assert.fail("processFrontMatter called"); return v; };
const ODD = "Write copy's due is written in a way DueDate doesn't change, so it wasn't changed. Set it by hand";

scenario("DueDate leaves a due written in a way the one-line edit doesn't take, says so, and still changes the task's lines", async ({ lag }) => {
    for (const odd of ["due:\n  - 2026-09-18", "due: 2026-09-18 # moved once", '"due": 2026-09-18']) {
        const notes = { ...NOTES, [NOTE]: NOTES[NOTE].replace("due: 2026-09-18", odd) };
        const v = noFrontMatter(standIn({ notes, lag }));
        await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
        assert.equal(v.notes()[NOTE], notes[NOTE], odd);
        assert.deepEqual(flags(lineWith(v, day("2026-09-14"), "Copy: revisions")), ["[[2026-09-25|🚩 9/25]]"], odd);
        assert.equal(shows(v, "2026-09-25"), 4, odd);
        assert.deepEqual(v.notices, [ODD], odd);
    }
});

scenario("DueDate: a one-line edit Obsidian would read as other properties isn't written", async ({ lag }) => {
    const v = noFrontMatter(standIn({ notes: NOTES, lag }));
    const ob = v.globals, parse = ob.parseYaml;
    // Obsidian reading the edited block differently, a shape the line match didn't foresee
    ob.parseYaml = (y) => { const fm = parse(y); if (/due: 2026-09-25/.test(y)) delete fm.parent; return fm; };
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.equal(v.notes()[NOTE], NOTES[NOTE]);
    assert.equal(shows(v, "2026-09-25"), 4);
    assert.deepEqual(v.notices, [ODD]);
});

scenario("DueDate: a note whose due changed shape between the read and the write is left, and says so, not that it's due", async ({ lag }) => {
    const v = noFrontMatter(standIn({ notes: NOTES, lag }));
    const schedule = v.plainday.Schedule, rewrite = schedule.rewrite.bind(schedule);
    // Sync turns the note's due into a list in that moment
    schedule.rewrite = async (f, fn) => {
        if (f.path === NOTE) await v.app.vault.process(f, (t) => t.replace("due: 2026-09-18", "due:\n  - 2026-09-18"));
        return rewrite(f, fn);
    };
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.match(v.notes()[NOTE], /due:\n {2}- 2026-09-18/);
    assert.equal(shows(v, "2026-09-25"), 4);
    assert.deepEqual(v.notices, [ODD]);
});

scenario("DueDate on a task note with no properties block leaves it, and says so", async ({ lag }) => {
    // A note made by hand with its tag in the text; the stand-in reads tags from the properties, so its cache says task
    const notes = { ...NOTES, "Projects/Old/Bare.md": "Text.\n", [day("2026-09-16")]: "- [ ] Bare one [[Old|⭕]] [[Bare|⋯]]\n" };
    const v = noFrontMatter(standIn({ notes, lag }));
    const cache = v.app.metadataCache.getFileCache;
    v.app.metadataCache.getFileCache = (f) => (f.path === "Projects/Old/Bare.md" ? { frontmatter: { tags: ["task"] }, listItems: [], blocks: {}, links: [] } : cache(f));
    await run(v, day("2026-09-16"), "Bare one", "2026-09-25");
    assert.equal(v.notes()["Projects/Old/Bare.md"], "Text.\n");
    assert.deepEqual(v.notices, ["Bare's due is written in a way DueDate doesn't change, so it wasn't changed. Set it by hand"]);
});

scenario("DueDate on a task note with Windows line ends changes its due line and keeps them", async ({ lag }) => {
    const crlf = NOTES[NOTE].replace(/\n/g, "\r\n");
    const v = noFrontMatter(standIn({ notes: { ...NOTES, [NOTE]: crlf }, lag }));
    await run(v, day("2026-09-15"), "Copy: revisions", "2026-09-25");
    assert.equal(v.notes()[NOTE], crlf.replace("due: 2026-09-18\r", "due: 2026-09-25\r"));
    assert.equal(shows(v, "2026-09-25"), 4);
    assert.deepEqual(v.notices, []);
});

scenario("DueDate: a line in a task note whose ⋯ links that same note is one of the task's lines, from either end", async ({ lag }) => {
    const notes = { ...NOTES, [NOTE]: NOTES[NOTE].replace("- [x] First pass", "- [ ] Write copy [[Write copy|⋯]]") };
    const after = [];
    for (const [path, text] of [[day("2026-09-15"), "Copy: revisions"], [NOTE, "Write copy [["]]) {
        const v = noFrontMatter(standIn({ notes, lag }));
        await run(v, path, text, "2026-09-25");
        assert.deepEqual(flags(lineWith(v, NOTE, "Write copy [[")), ["[[2026-09-25|🚩 9/25]]"], path);
        after.push(v.notes());
    }
    assert.deepEqual(after[0], after[1]);
});

test("planted bugs in the search's family: false paths: the scenarios catch each one", async () => {
    const bugs = {
        "no walk to a task note in Archive or outside the system": ["&& !walked.has(own) && await this.isTaskNote(own, memo)) {", "&& false) {"],
        "any note outside the system ties its lines": ["&& !walked.has(own) && await this.isTaskNote(own, memo)) {", "&& !walked.has(own)) {"],
        "walked notes are the queued ones": ["if (task && !family && !walked.has(own)) {", "if (task && !family && !queued.has(own)) {"],
        "a note's own lines aren't searched": ["if (self) files.set(note.path, note);", ""],
    };
    const checks = async (plant) => {
        const v = (notes) => standIn({ notes, plant });
        // A task note in Archive: its other line in the system
        const arch = { ...NOTES, "Archive/Old/Old copy.md": "---\ntags: [task]\n---\n", [day("2026-09-16")]: "- [ ] Look into it [[Old copy|⋯]]\n", [day("2026-09-17")]: "- [ ] Look into it more [[Old copy|⋯]]\n" };
        let w = v(arch);
        await run(w, day("2026-09-16"), "Look into it", "2026-09-25");
        if (!flags(lineWith(w, day("2026-09-17"), "Look into it more")).length) return true;
        // A person's note outside the system ties nothing
        const pat = { [OLD]: PROJECT, "Reference/People/Pat.md": "---\ntags: [person]\n---\n", [day("2026-09-14")]: "- [ ] Call Pat [[Old|⭕]] [[Pat|⋯]]\n", [day("2026-09-15")]: "- [ ] Email Pat [[Old|⭕]] [[Pat|⋯]]\n" };
        w = v(pat);
        await run(w, day("2026-09-14"), "Call Pat", "2026-09-25");
        if (flags(lineWith(w, day("2026-09-15"), "Email Pat")).length) return true;
        // The same lines from either start
        const tangled = {
            [OLD]: PROJECT, "Projects/Old/Mobile.md": "---\ntags: [task]\n---\n", "Projects/Old/Wireframes.md": "---\ntags: [task]\n---\n- [ ] Mobile [[Mobile|⋯]]\n",
            [day("2026-09-11")]: "- [x] Wireframes [[Old|⭕]] [[Wireframes|⋯]]\n", [day("2026-09-14")]: "- [>] Mobile [[Old|⭕]] [[Wireframes|⋯]] ^mb0001\n", [day("2026-09-15")]: "- [ ] Mobile [[Old|⭕]] [[Mobile|⋯]] ^mb0001\n",
        };
        const ends = [];
        for (const start of ["2026-09-14", "2026-09-15"]) { w = v(tangled); await run(w, day(start), "Mobile", "2026-09-25"); ends.push(JSON.stringify(w.notes())); }
        if (ends[0] !== ends[1]) return true;
        // A line in the task note that links the note itself
        w = v({ ...NOTES, [NOTE]: NOTES[NOTE].replace("- [x] First pass", "- [ ] Write copy [[Write copy|⋯]]") });
        await run(w, day("2026-09-15"), "Copy: revisions", "2026-09-25");
        return !flags(lineWith(w, NOTE, "Write copy [[")).length;
    };
    assert.equal(await checks(null), false, "the real code passes every check");
    for (const [name, [from, to]] of Object.entries(bugs)) {
        const plant = (script, text) => {
            if (script !== "taskChange") return text;
            assert.ok(text.includes(from), `${name}: nothing to plant`);
            return text.replace(from, to);
        };
        assert.equal(await checks(plant), true, name);
    }
});
