// Tests for OBS-199: the patterns that looked behind. iPhones and iPads before iOS 16.4 can't run a
// lookbehind, and Plainday is one bundle, so one would stop the whole plugin loading there. Each
// pattern was rewritten to read every input as before; these are the inputs its lookbehind kept out.
// Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../${file}`, here), "utf8");
const load = (file, name) => vm.runInContext(read(`CustomJS/${file}`) + `\n;${name}`, vm.createContext({}));
const AddTaskNote = load("addTaskNote.js", "AddTaskNote");
const TaskIds = load("taskIds.js", "TaskIds");
const TrailingLinks = load("trailingLinks.js", "TrailingLinks");
const TimeReport = load("timeReport.js", "TimeReport");
const Billing = load("billing.js", "Billing");
const NewNoteGuard = load("newNoteGuard.js", "NewNoteGuard");
const DueDate = load("setDueDate.js", "DueDate");
const tr = new TimeReport(), billing = new Billing();
// The Log template's helper, which isn't exported: read from its own file
const recordEvent = vm.runInContext(read("Templater/recordEvent.js") + "\n;({ trailItem })", vm.createContext({ module: {}, require: () => ({}) }));
const arrivedNote = vm.runInContext(read("Templater/arrivedNote.js") + "\n;arrivedNote", vm.createContext({ module: {} }));
const plain = (x) => JSON.parse(JSON.stringify(x));
const FE0F = String.fromCharCode(0xfe0f), BOM = String.fromCharCode(0xfeff), INFO = "ℹ" + FE0F;

test("no lookbehind in a class file or a Templater script, in a pattern or a string made into one", () => {
    const found = [];
    for (const dir of ["CustomJS", "Templater"]) {
        for (const name of fs.readdirSync(new URL(`../${dir}/`, here)).filter((n) => n.endsWith(".js"))) {
            read(`${dir}/${name}`).split("\n").forEach((line, i) => {
                if (/\(\?<[=!]/.test(line)) found.push(`${dir}/${name}:${i + 1}`);
            });
        }
    }
    assert.deepEqual(found, []);
});

// ---------------------------------------------------------------- the run of marks that ends a line

// A line's run, walked from its end the way Add note walks it
const walk = (trailItem, line) => {
    const bare = line.replace(/\s+\^[A-Za-z0-9-]+$/, "").replace(/\s+$/, "");
    const items = [];
    let at = bare.length;
    for (let item; (item = trailItem(bare.slice(0, at)));) { items.unshift(item[0].trim()); at = item.index; }
    return { text: bare.slice(0, at).replace(/\s+$/, ""), items };
};
const walkers = {
    "AddTaskNote": (l) => walk((t) => AddTaskNote.trailItem(t), l),
    "TaskIds": (l) => plain(TaskIds.splitRun(l)),
    "the Log template": (l) => walk((t) => recordEvent.trailItem(t), l),
};

test("trailItem: the ℹ️ mark is part of a line's run after a space or a tab; stuck to a word, it's the title's", () => {
    const event = "- [<] 2:00pm\tDelivery window for the new monitor";
    for (const [who, run] of Object.entries(walkers)) {
        assert.deepEqual(run(`${event} ${INFO}`), { text: event, items: [INFO] }, `${who}: after a space`);
        assert.deepEqual(run(`${event}\t${INFO}`), { text: event, items: [INFO] }, `${who}: after a tab`);
        assert.deepEqual(run(`${event}${INFO}`), { text: `${event}${INFO}`, items: [] }, `${who}: stuck to the word`);
        assert.deepEqual(run(`${event} 🆓`), { text: event, items: ["🆓"] }, `${who}: 🆓 the same`);
        assert.deepEqual(run(`${event}🆓`), { text: `${event}🆓`, items: [] }, `${who}: 🆓 stuck to the word`);
        assert.deepEqual(run(`${INFO} [[Kestrel Outfitters 2026|⭕]]`).items, ["[[Kestrel Outfitters 2026|⭕]]"], `${who}: at the start of the text, it's no mark`);
    }
});

test("trailItem: an item takes all the spaces before it, as the search's leftmost match", () => {
    const text = "- [ ] Book the venue   [[Kestrel Outfitters 2026|⭕]]";
    for (const trailItem of [(t) => AddTaskNote.trailItem(t), (t) => TaskIds.trailItem(t), (t) => recordEvent.trailItem(t)]) {
        const item = trailItem(text);
        assert.equal(item.index, text.indexOf("   ["));
        assert.equal(item[0], "   [[Kestrel Outfitters 2026|⭕]]");
    }
});

test("Add note's walk over Draft homepage wireframes on 2026-09-14 finds its 🚩, ⭕ and ⋯, in that order", () => {
    // As the line is in Reference/Planner/days/2026-09-14.md
    const line = "- [>] Draft homepage wireframes [[2026-09-18|🚩 9/18]] [[Kestrel Outfitters 2026|⭕]] [[Draft homepage wireframes|⋯]] ^w2h5nf";
    const run = ["[[2026-09-18|🚩 9/18]]", "[[Kestrel Outfitters 2026|⭕]]", "[[Draft homepage wireframes|⋯]]"];
    for (const [who, walkOf] of Object.entries(walkers)) {
        assert.deepEqual(walkOf(line), { text: "- [>] Draft homepage wireframes", items: run }, who);
    }
    assert.equal(new AddTaskNote().trailingNote(line), "Draft homepage wireframes");
});

test("OLD_ITEM: an old 🗒️ link with several spaces before it is still found where its [[ starts", () => {
    const line = `- [ ] Book the venue   [[Book the venue|🗒${FE0F}]] [[Kestrel Outfitters 2026|⭕]]`;
    assert.deepEqual(plain(TaskIds.oldMarks(line)), [{ from: line.indexOf("[[Book"), to: line.indexOf(" [[Kestrel"), target: "Book the venue" }]);
});

// ---------------------------------------------------------------- forward dates

test("a date label is a forward date only on a link to a periodic note's line, in the editor and the time report", () => {
    const line = (link) => `- [>] Send final copy to Rafe ${link} ^p7d2qe`;
    const forward = (link) => {
        const editor = TrailingLinks.trail(line(link))?.links.map((l) => l.kind) ?? [];
        const report = tr.trailLink(`Send final copy to Rafe ${link}`);
        return { editor: plain(editor), report: report ? report[1] : null };
    };
    // As in Projects/Freelance/Pinecrest Library Brochure/Write brochure copy.md
    assert.deepEqual(forward("[[2026-09-17#^p7d2qe|9/17]]"), { editor: ["forward"], report: "2026-09-17#^p7d2qe" });
    assert.deepEqual(forward("[[Daily/2026-09-17#^p7d2qe|9/17]]"), { editor: ["forward"], report: "Daily/2026-09-17#^p7d2qe" });
    assert.deepEqual(forward("[[2026-W38#^p7d2qe|Wk of 9/14]]"), { editor: ["forward"], report: "2026-W38#^p7d2qe" });
    assert.deepEqual(forward("[[2026-09#^p7d2qe|Sept. 2026]]"), { editor: ["forward"], report: "2026-09#^p7d2qe" });
    assert.deepEqual(forward("[[2027#^p7d2qe|2027]]"), { editor: ["forward"], report: "2027#^p7d2qe" });
    // A date label on a link to another note's line, or to a day without a line, is text
    assert.deepEqual(forward("[[Write brochure copy#^r3v1sn|9/16]]"), { editor: [], report: null });
    assert.deepEqual(forward("[[2026-09-17|9/17]]"), { editor: [], report: null });
    assert.deepEqual(forward("[[2026-09-17#Notes|9/17]]"), { editor: [], report: null });
    // With a ➡️, its own alternative reads it, on any link
    assert.deepEqual(forward("[[2027|➡️ 2027]]"), { editor: ["forward"], report: "2027" });
});

test("a date label's link is read as the lookbehind read it, a [[ inside its text and all", () => {
    // The lookbehind looked for the periodic line just before the `|`, from any [[ there: the link's
    // own, one inside its text, or one made of the link's second [ and a [ after it
    for (const [text, target] of [["x [[a[[2026-09-17#^k|9/17]]", "a[[2026-09-17#^k"], ["x [[[2026-09-17#^k|9/17]]", "[2026-09-17#^k"], ["x [[a/[[b/2026-09-17#^k|9/17]]", "a/[[b/2026-09-17#^k"]]) {
        assert.equal(TrailingLinks.lastLink(text)?.[1], target, text);
        assert.equal(tr.trailLink(text)?.[1], target, text);
    }
    for (const text of ["x [[a#b/2026-09-17#^k|9/17]]", "x [[a[2026-09-17#^k|9/17]]"]) {
        assert.equal(TrailingLinks.lastLink(text), null, text);
        assert.equal(tr.trailLink(text), null, text);
    }
});

// ---------------------------------------------------------------- 🆓

test("🆓 frees a line only as a word of its own: Stray🆓 isn't one, (🆓) is", () => {
    assert.deepEqual(plain(tr.freeLine("Stray🆓 in the title")), { free: false, stray: true });
    assert.deepEqual(plain(tr.freeLine("Fix the nav (🆓)")), { free: true, stray: false });
    assert.deepEqual(plain(tr.freeLine("Fix the nav [🆓]")), { free: true, stray: false });
    assert.deepEqual(plain(tr.freeLine(`Fix the nav 🆓${FE0F}.`)), { free: true, stray: false });
    // As under Draft homepage wireframes in Reference/Planner/days/2026-09-15.md
    assert.deepEqual(plain(tr.freeLine("🆓 redid the nav after misreading my own notes")), { free: true, stray: false });
});

test("taking 🆓 out of a line's text keeps the character before it", () => {
    assert.equal(tr.taskText("Fix the nav (🆓) today"), "Fix the nav today");
    assert.equal(tr.taskText("Fix the nav 🆓, today"), "Fix the nav , today");
    assert.equal(tr.taskText("Stray🆓 today"), "Stray🆓 today");
    assert.equal(tr.taskText("🆓 🆓 Fix the nav"), "Fix the nav");
    assert.equal(tr.freeEvent(`Delivery window for the new monitor (🆓) ${INFO}`), true);
    assert.equal(tr.freeEvent(`Delivery window for the new monitor${INFO}`), false);
});

// ---------------------------------------------------------------- tables

test("tableText: a | already escaped stays as it is, the same in a report's table and an invoice's", () => {
    for (const [who, t] of [["report", tr], ["invoice", billing]]) {
        assert.equal(t.tableText(String.raw`a \| b`), String.raw`a \| b`, who);
        assert.equal(t.tableText("a | b"), String.raw`a \| b`, who);
        assert.equal(t.tableText(String.raw`a \\| b`), String.raw`a \\\| b`, `${who}: an escaped backslash, then a pipe to escape`);
        assert.equal(t.tableText(String.raw`a \\\| b`), String.raw`a \\\| b`, who);
        assert.equal(t.tableText("a || b"), String.raw`a \|\| b`, who);
        assert.equal(t.tableText(String.raw`a \ | b`), String.raw`a \ \| b`, who);
    }
});

test("cell: the | in a link is escaped once", () => {
    assert.equal(tr.cell("[[Kestrel Outfitters 2026|⭕]]"), String.raw`[[Kestrel Outfitters 2026\|⭕]]`);
    assert.equal(tr.cell(String.raw`[[Kestrel Outfitters 2026\|⭕]]`), String.raw`[[Kestrel Outfitters 2026\|⭕]]`);
    assert.equal(tr.cell(String.raw`[[a\\|b]]`), String.raw`[[a\\|b]]`, "a pipe after a backslash is left alone");
    assert.equal(tr.cell("a | b"), "a | b", "outside a link it's tableText's");
});

test("a freeze comment is kept whole, unless it's right after a % or a <", () => {
    assert.equal(tr.defuse("Day %%freeze 2 1%%"), "Day %%freeze 2 1%%");
    assert.equal(tr.defuse("%%freeze 2 1%% Day"), "%%freeze 2 1%% Day");
    for (const text of ["Day %%%freeze 2 1%%", "Day <%%freeze 2 1%%"]) {
        assert.ok(!tr.defuse(text).includes("%%"), text);
        assert.equal(tr.withoutFreeze(text), text);
    }
    // One right after a comment that isn't one counts, though it starts inside it
    assert.deepEqual(plain(tr.splitFreeze("<%%custom%%custom%%")), ["<%%custom", "%%custom%%", ""]);
    assert.equal(tr.withoutFreeze("Day %%freeze 2 1%% %%default 2 1%%\tTasks"), "Day Tasks");
});

// ---------------------------------------------------------------- the rest

test("Billing.folderOf refuses a folder name holding a control character", () => {
    for (const code of [0, 9, 31, 127]) assert.match(billing.folderOf(`Invoices${String.fromCharCode(code)}`).error ?? "", /isn't a folder/, `U+${code.toString(16)}`);
    assert.equal(billing.folderOf("Invoices").error, null);
});

test("a byte-order mark before a note's properties is still read past", () => {
    const note = `${BOM}---\ndue: 2026-09-18\n---\nText`;
    assert.ok(NewNoteGuard.FRONTMATTER.test(note));
    assert.equal(arrivedNote(note), NewNoteGuard.arrived(note));
    assert.match(DueDate.withDue(note, "2026-09-20")?.text ?? "", /due: 2026-09-20/);
});
