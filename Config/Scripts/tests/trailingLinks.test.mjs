// Tests for CustomJS/trailingLinks.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// Only the text rules are pure; the editor extension and its CSS are checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const TrailingLinks = vm.runInContext(fs.readFileSync(new URL("../CustomJS/trailingLinks.js", here), "utf8") + "\n;TrailingLinks", vm.createContext({}));
// Values made in the script's own context, as plain ones this file can compare
const plain = (x) => JSON.parse(JSON.stringify(x));
const kinds = (line) => plain(TrailingLinks.trail(line)?.links.map((l) => l.kind) ?? null);
const at = (line, s) => line.indexOf(s);

// ---------------------------------------------------------------- trail

test("trail: a task's 🚩 and note link are the run, in line order", () => {
    const line = "- [ ] Draft the proposal [[2026-09-30|🚩 9/30]] [[Draft the proposal|⋯]]";
    const t = TrailingLinks.trail(line);
    assert.deepEqual(plain(t.links.map((l) => [l.kind, l.target])), [["due", "2026-09-30"], ["note", "Draft the proposal"]]);
    assert.equal(t.runFrom, at(line, "[[2026"));
    assert.equal(t.runTo, line.length);
    assert.equal(t.textEnd, at(line, " [[2026"), "the text ends before the space ahead of the run");
    assert.equal(t.bodyFrom, "- [ ] ".length);
    assert.equal(line.slice(t.links[0].from, t.links[0].to), "[[2026-09-30|🚩 9/30]]");
});

test("trail: an event's log and project links, with the ℹ️ left in the text", () => {
    const line = "- [<] 10:00am\tKickoff call ℹ️ [[2026-09-27 Kickoff call|⋯]] [[Kestrel Outfitters 2026|⭕]]";
    const t = TrailingLinks.trail(line);
    assert.deepEqual(plain(t.links.map((l) => l.kind)), ["note", "project"]);
    assert.equal(line.slice(t.bodyFrom, t.textEnd), "10:00am\tKickoff call ℹ️");
});

test("trail: every system symbol, with or without U+FE0F; ⋯ is the line's own note and ↗ the note it was sent from (OBS-208)", () => {
    assert.deepEqual(kinds("- [ ] A [[N|⋯]]"), ["note"]);
    assert.deepEqual(kinds("- [ ] A [[S|↗]]"), ["from"]);
    assert.deepEqual(kinds("- [ ] A [[S|↗\uFE0F]]"), ["from"]);
    // The marks before OBS-208, and a typed …, are ordinary links now: no run
    for (const old of ["🗒️", "🗒", "🔗", "…"]) assert.deepEqual(kinds(`- [ ] A [[N|${old}]]`), null, old);
    // ↗ comes after the ⋯, last in the run, so End goes past it as past the rest
    const sent = "- [ ] A [[P|⭕]] [[N|⋯]] [[S|↗]] ^abc123";
    assert.deepEqual(kinds(sent), ["project", "note", "from"]);
    assert.equal(TrailingLinks.trail(sent).runTo, sent.indexOf(" ^abc123"));
    assert.deepEqual(kinds("- [ ] A [[P|⭕]]"), ["project"]);
    assert.deepEqual(kinds("- [ ] A [[P|⭕️]]"), ["project"]);
    assert.deepEqual(kinds("- [ ] A [[H|🗃️]]"), ["area"]);
    assert.deepEqual(kinds("- [ ] A [[H|🗃]]"), ["area"]);
    assert.deepEqual(kinds("- [ ] A [[2026-12-31|🚩 12/31]] [[P|⭕]] [[N|⋯]]"), ["due", "project", "note"]);
});

test("trail: ordinary links stay in the text, even at the end of a line", () => {
    assert.equal(TrailingLinks.trail("- [ ] Call [[Rafe Oakes]]"), null);
    assert.equal(TrailingLinks.trail("- [ ] Read [[Some note|the brief]]"), null);
    assert.equal(TrailingLinks.trail("- [<] 3:00pm\t[[2026-09-27 Printer call|Printer call]]"), null, "an old event title wrapped in its log link");
    assert.equal(TrailingLinks.trail("- [ ] Flag it [[2026-09-30|🚩]]"), null, "a 🚩 without its date isn't DueDate's");
    const line = "- [ ] Call [[Rafe Oakes]] about it [[Shot list|⋯]]";
    const t = TrailingLinks.trail(line);
    assert.deepEqual(plain(t.links.map((l) => l.kind)), ["note"], "only the note link moves");
    assert.equal(line.slice(t.bodyFrom, t.textEnd), "Call [[Rafe Oakes]] about it");
});

test("trail: a system link in the middle of the text isn't a run", () => {
    assert.equal(TrailingLinks.trail("- [ ] A link [[Kestrel|⭕]] in the middle"), null);
});

test("trail: only task and event lines", () => {
    assert.equal(TrailingLinks.trail("- Plain bullet [[P|⭕]]"), null);
    assert.equal(TrailingLinks.trail("Some text [[P|⭕]]"), null);
    assert.equal(TrailingLinks.trail("## Heading [[P|⭕]]"), null);
    assert.deepEqual(kinds("\t- [ ] Nested [[N|⋯]]"), ["note"]);
    assert.deepEqual(kinds("    * [x] Spaces and a star [[N|⋯]]"), ["note"]);
    assert.deepEqual(kinds("- [>] Forwarded [[N|⋯]]"), ["note"]);
});

test("trail: trailing spaces aren't part of the run, and a heading in the link is kept", () => {
    const line = "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]] ";
    assert.equal(TrailingLinks.trail(line).runTo, line.length - 1);
    assert.equal(TrailingLinks.trail("- [ ] A [[Note#Part|⋯]]").links[0].target, "Note#Part");
});

test("trail: a line that is only a run has no text", () => {
    const t = TrailingLinks.trail("- [ ] [[Note|⋯]]");
    assert.deepEqual(plain(t.links.map((l) => l.kind)), ["note"]);
    assert.ok(t.textEnd <= t.bodyFrom);
});

test("trail: a block ID after the links doesn't hide them, and isn't part of the run (OBS-185)", () => {
    const line = "- [ ] Book the photographer [[Kestrel|⭕]] [[Book it|⋯]] ^k3x9m2";
    const t = TrailingLinks.trail(line);
    assert.deepEqual(kinds(line), ["project", "note"]);
    assert.equal(t.runTo, at(line, " ^k3x9m2"), "the run ends before the ID");
});

test("trail: a forward date is a link to a periodic note's line, drawn with the run as its date (OBS-185)", () => {
    assert.deepEqual(kinds("- [>] Book it [[2026-10-01|🚩 10/1]] [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2"), ["due", "forward"]);
    assert.deepEqual(kinds("- [>] Book it [[Reference/Planner/months/2026-10#^k3x9m2|Oct. 2026]] ^k3x9m2"), ["forward"]);
    assert.deepEqual(kinds("- [>] Book it [[2026w41#^k3x9m2|Wk of 10/4]] [[Kestrel|⭕]] ^k3x9m2"), ["forward", "project"]);
    assert.deepEqual(plain(TrailingLinks.trail("- [>] Book it [[2026-10-08#^k3x9m2|10/8]] ^k3x9m2").links.map((l) => l.alias)), ["10/8"], "the pill shows just the date");
    assert.deepEqual(kinds("- [>] Book it [[2026-10-08#^k3x9m2|➡️ 10/8]] ^k3x9m2"), ["forward"], "one written with a ➡️ is still one");
    assert.equal(TrailingLinks.trail("- [>] Book it [[Brief#^k3x9m2|see]] ^k3x9m2"), null, "a block link to another note isn't");
    assert.equal(TrailingLinks.trail("- [>] Book it [[2026-10-08|10/8]]"), null, "nor a day link without a line's ID");
    assert.equal(TrailingLinks.trail("- [ ] Follow up on [[2026-09-15#^abc123|the call]] ^q1w2e3"), null, "nor a block link of your own to a day's line, whose alias isn't a date");
});

test("trail: past a hand-made ID too, and an ID with no links before it isn't a run (OBS-185)", () => {
    assert.deepEqual(kinds("- [ ] Book it [[Kestrel|⭕]] ^Ab3-x9"), ["project"]);
    assert.equal(TrailingLinks.trail("- [ ] Book it ^k3x9m2"), null);
    const line = "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2 ";
    assert.equal(TrailingLinks.trail(line).textEnd, at(line, " [["));
});

test("CSS: the forward date sits after the due date, faint (OBS-185)", () => {
    assert.match(TrailingLinks.CSS, /\.pm-trail-due \{ order: 2; \}/);
    assert.match(TrailingLinks.CSS, /\.pm-trail-forward \{ order: 3; \}/);
    assert.match(TrailingLinks.CSS, /\.pm-trail-forward :is\(\.cm-hmd-internal-link, \.cm-underline\) \{ color: var\(--text-faint\) !important; \}/);
});

test("CSS: the ⋯ and then the ↗ are drawn last, at the edge after the due and forward dates (OBS-208, Brian 2026-10-28)", () => {
    const css = fs.readFileSync(new URL("../CustomJS/trailingLinks.js", here), "utf8");
    assert.match(css, /:is\(\.pm-trail-note, \.pm-trail-from\) \{ order: 4; \}/);
});

test("CSS: a shown task ID comes last in the run, after the links (OBS-185)", () => {
    assert.match(TrailingLinks.CSS, /\.pm-trail-run > \.pm-trail-id \{ order: 5;/);
});

// ---------------------------------------------------------------- blockId

test("blockId: where a task line's ID sits, the space before it included", () => {
    const line = "- [ ] Book it ^k3x9m2";
    assert.deepEqual(plain(TrailingLinks.blockId(line)), { from: at(line, " ^k3x9m2"), to: line.length });
    assert.equal(TrailingLinks.blockId("- [ ] Book it ^k3x9m2 later"), null);
});

test("blockId: strict takes only an ID of six letters or digits, the one that's hidden (OBS-185)", () => {
    assert.ok(TrailingLinks.blockId("- [ ] Book it ^k3x9m2", { strict: true }));
    assert.ok(TrailingLinks.blockId("- [ ] Book it ^K3x9M2", { strict: true }), "either case");
    assert.equal(TrailingLinks.blockId("- [ ] Book it ^3", { strict: true }), null, "a typed ^3 stays text");
    assert.equal(TrailingLinks.blockId("- [ ] Book it ^Ab3-x9", { strict: true }), null, "a hand-made ID with a dash");
    assert.ok(TrailingLinks.blockId("- [ ] Book it ^Ab3-x9"), "but any ID ends the search for the run");
    const spaced = "- [ ] Book it ^k3x9m2  ";
    assert.deepEqual(plain(TrailingLinks.blockId(spaced, { strict: true })), { from: at(spaced, " ^"), to: spaced.length - 2 }, "spaces after it aren't part of it");
});

// ---------------------------------------------------------------- keepIdAtEnd

// An edit on one line, as the transaction filter sees it ({ from, to, insert, cursor: an offset into
// insert }), applied the way keepIdAtEnd says: the text after it with the cursor drawn as |, or null
// when the edit is left as it is
const kept = (line, edit) => {
    const r = plain(TrailingLinks.keepIdAtEnd(line, edit));
    if (!r) return null;
    let text = line;
    for (const c of [...r.changes].reverse()) text = text.slice(0, c.from) + c.insert + text.slice(c.from);
    return text.slice(0, r.cursor) + "|" + text.slice(r.cursor);
};
// Enter in a list as Obsidian 1.14 sends it (newlineAndIndentContinueMarkdownList): the character
// before the cursor replaced by itself, a line break and the next bullet, and the spaces after the
// cursor taken off, which CodeMirror reports as one change. The cursor ends after the bullet.
const obsidianEnter = (line, c) => ({ from: c - 1, to: c + line.slice(c).match(/^[>\s]*/)[0].length, insert: `${line[c - 1]}\n- [ ] `, cursor: 8 });
// CodeMirror's insertNewlineAndIndent: the spaces after the cursor taken off, a line break put in
const codeMirrorEnter = (c) => ({ from: c, to: c + 1, insert: "\n", cursor: 1 });
const typed = (c, insert, cursor = insert.length) => ({ from: c, to: c, insert, cursor });

test("keepIdAtEnd: Enter anywhere is Obsidian's own: at the end of the text it isn't moved past the ID (fix round 1)", () => {
    const bare = "- [ ] Book it ^k3x9m2";
    assert.equal(kept(bare, obsidianEnter(bare, at(bare, " ^"))), null, "Obsidian's Enter");
    assert.equal(kept(bare, codeMirrorEnter(at(bare, " ^"))), null, "CodeMirror's");
    assert.equal(kept(bare, typed(at(bare, " ^"), "\n- [ ] ")), null, "a plain insert");
    const linked = "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2";
    assert.equal(kept(linked, obsidianEnter(linked, at(linked, " [["))), null, "before the links");
    assert.equal(kept(bare, obsidianEnter(bare, bare.length)), null, "after the ID");
});

test("keepIdAtEnd: text typed just after the ID goes in before it (OBS-185)", () => {
    const bare = "- [ ] Book it ^k3x9m2";
    assert.equal(kept(bare, typed(bare.length, "s")), "- [ ] Book its| ^k3x9m2");
    assert.equal(kept(bare, typed(bare.length, "[]", 1)), "- [ ] Book it[|] ^k3x9m2", "an auto-paired bracket keeps the cursor inside");
    const spaced = "- [ ] Book it ^k3x9m2 ";
    assert.equal(kept(spaced, typed(spaced.length - 1, "s")), "- [ ] Book its| ^k3x9m2 ", "between the ID and a space after it");
    assert.equal(kept(spaced, typed(spaced.length, "s")), "- [ ] Book its| ^k3x9m2 ", "after that space");
});

test("keepIdAtEnd: text typed after the ID of a line with links goes in at the end of its text, before the links, so they're still read (OBS-185)", () => {
    const linked = "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2";
    assert.equal(kept(linked, typed(linked.length, " soon")), "- [ ] Book it soon| [[Kestrel|⭕]] ^k3x9m2", "where a click right of the line puts the cursor");
    assert.equal(kept(linked, typed(linked.length, "s")), "- [ ] Book its| [[Kestrel|⭕]] ^k3x9m2");
    assert.equal(kept(linked, typed(linked.length, "a\nb")), "- [ ] Book ita [[Kestrel|⭕]] ^k3x9m2\nb|", "pasted lines: the rest after the ID");
    // A sent line: its forward date is still the run's, and still read
    const sent = "- [>] Send final copy to Rafe [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe";
    const typedIn = kept(sent, typed(sent.length, " soon"));
    assert.equal(typedIn, "- [>] Send final copy to Rafe soon| [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe");
    assert.deepEqual(plain(TrailingLinks.trail(typedIn.replace("|", "")).links.map((l) => l.kind)), ["forward"]);
    // No text yet, but links: after the checkbox and a space of its own
    const empty = "- [ ] [[Kestrel|⭕]] ^k3x9m2";
    assert.equal(kept(empty, typed(empty.length, "x")), "- [ ] x| [[Kestrel|⭕]] ^k3x9m2");
});

test("keepIdAtEnd: on a task with no text yet, what's typed goes after the checkbox's space, so the box stays a box (OBS-185)", () => {
    const empty = "- [ ] ^k3x9m2";
    assert.equal(kept(empty, typed(empty.length, "x")), "- [ ] x| ^k3x9m2", "typed after the ID");
    assert.equal(kept(empty, typed(at(empty, " ^"), "x")), "- [ ] x| ^k3x9m2", "typed where a click at the end of the visible text puts the cursor");
    assert.equal(kept(empty, typed(empty.length, "a\nb")), "- [ ] a ^k3x9m2\nb|", "pasted lines");
    assert.equal(kept(empty, typed(empty.length, " ")), "- [ ] | ^k3x9m2", "a space needs no other");
    assert.equal(kept(empty, typed(at(empty, " ^"), " ")), null, "nor typed before the ID");
});

test("keepIdAtEnd: lines pasted just after the ID: the first goes where typed text would, the rest after the ID; pasted at the end of the text, as they come (OBS-185)", () => {
    const bare = "- [ ] Book it ^k3x9m2";
    assert.equal(kept(bare, typed(bare.length, "a\nb")), "- [ ] Book ita ^k3x9m2\nb|", "just after the ID");
    assert.equal(kept(bare, typed(at(bare, " ^"), "a\nb")), null, "at the end of the text: a paste there is Obsidian's, like Enter");
});

test("keepIdAtEnd: every other edit is left as it is (OBS-185)", () => {
    const bare = "- [ ] Book it ^k3x9m2";
    assert.equal(kept(bare, obsidianEnter(bare, bare.length)), null, "Enter after the ID already starts after it");
    assert.equal(kept(bare, typed(bare.length, "\n- [ ] ")), null);
    assert.equal(kept(bare, typed(at(bare, " ^"), "s")), null, "typing at the end of the text already goes in before the ID");
    assert.equal(kept(bare, typed(at(bare, " it"), "s")), null, "typing in the text");
    assert.equal(kept(bare, obsidianEnter(bare, at(bare, " it"))), null, "Enter in the text");
    assert.equal(kept(bare, { from: at(bare, "it"), to: at(bare, " ^"), insert: "\n", cursor: 1 }), null, "text replaced");
    assert.equal(kept(bare, typed(at(bare, "^") + 3, "\n")), null, "Enter inside the ID");
    assert.equal(kept("- [ ] Book it ^3", typed(16, "4")), null, "not a task's ID");
    assert.equal(kept("- [ ] Book it ^Ab3-x9", typed(21, "s")), null, "a hand-made ID isn't hidden, so it isn't kept");
    assert.equal(kept("- Book it ^k3x9m2", typed(17, "s")), null, "not a task line");
});

// ---------------------------------------------------------------- lastWordStart

test("lastWordStart: the text's last word, which wraps with the run", () => {
    const line = "- [ ] Homepage build: category pages [[P|⭕]]";
    const t = TrailingLinks.trail(line);
    assert.equal(TrailingLinks.lastWordStart(line, t.bodyFrom, t.textEnd), at(line, "pages"));
    const event = "- [<] 10:00am\tKickoff call ℹ️ [[L|⋯]]";
    const e = TrailingLinks.trail(event);
    assert.equal(TrailingLinks.lastWordStart(event, e.bodyFrom, e.textEnd), at(event, "ℹ️"));
});

test("lastWordStart: a link ending the text is one word, spaces and all", () => {
    const line = "- [ ] Call [[Rafe Oakes]] [[N|⋯]]";
    const t = TrailingLinks.trail(line);
    assert.equal(TrailingLinks.lastWordStart(line, t.bodyFrom, t.textEnd), at(line, "[[Rafe"));
    const alias = "- [ ] Read [[Some note|the brief]] [[N|⋯]]";
    const a = TrailingLinks.trail(alias);
    assert.equal(TrailingLinks.lastWordStart(alias, a.bodyFrom, a.textEnd), at(alias, "[[Some"));
});

test("lastWordStart: a one-word task, and none when there's no text", () => {
    const line = "- [ ] Mow [[H|🗃️]]";
    const t = TrailingLinks.trail(line);
    assert.equal(TrailingLinks.lastWordStart(line, t.bodyFrom, t.textEnd), at(line, "Mow"));
    const bare = "- [ ] [[Note|⋯]]";
    const b = TrailingLinks.trail(bare);
    assert.equal(TrailingLinks.lastWordStart(bare, b.bodyFrom, b.textEnd), -1);
});

// ---------------------------------------------------------------- shortestName

test("shortestName: the shortest of the note's name and its plain aliases", () => {
    assert.equal(TrailingLinks.shortestName("Kestrel Outfitters 2026", ["⭕.Clients.Kestrel Outfitters 2026", "Kestrel"]), "Kestrel");
    assert.equal(TrailingLinks.shortestName("Kestrel Outfitters 2026", []), "Kestrel Outfitters 2026");
    assert.equal(TrailingLinks.shortestName("Kestrel Outfitters 2026", undefined), "Kestrel Outfitters 2026");
});

test("shortestName: never a ⭕ or 🗃 alias, with or without U+FE0F", () => {
    assert.equal(TrailingLinks.shortestName("Household", ["🗃.H"]), "Household");
    assert.equal(TrailingLinks.shortestName("Household", ["🗃️.H"]), "Household");
    assert.equal(TrailingLinks.shortestName("Pinecrest Library", ["⭕️.P", "⭕.X"]), "Pinecrest Library");
});

test("shortestName: the name wins a tie, and odd aliases are ignored", () => {
    assert.equal(TrailingLinks.shortestName("Abc", ["Xyz"]), "Abc");
    assert.equal(TrailingLinks.shortestName("Kestrel Outfitters", [null, "", 2026]), "2026");
});

// ---------------------------------------------------------------- overdue

test("overdue: a due date before today; today itself isn't overdue", () => {
    assert.equal(TrailingLinks.overdue("2026-09-07", "2026-09-27"), true);
    assert.equal(TrailingLinks.overdue("2026-09-27", "2026-09-27"), false);
    assert.equal(TrailingLinks.overdue("2026-09-30", "2026-09-27"), false);
    assert.equal(TrailingLinks.overdue("Someday", "2026-09-27"), false);
    assert.equal(TrailingLinks.overdue("2026-09", "2026-09-27"), false);
});

// ---------------------------------------------------------------- context and subtreeEnd

const NOTE = [
    "- [ ] Plan the shoot [[Kestrel|⭕]]",
    "\t- [ ] Gutter quote [[Fix the gutter|⋯]]",
    "\t\t- 9:15am - 9:30am",
    "",
    "    - [ ] Four spaces count as a tab",
    "- [ ] Next task",
];
const lineAt = (n) => NOTE[n - 1];
const context = (n) => plain(TrailingLinks.context(lineAt, n));

test("context: the line and the lines it's nested under, nearest first", () => {
    assert.deepEqual(context(2), [NOTE[1], NOTE[0]]);
    assert.deepEqual(context(3), [NOTE[2], NOTE[1], NOTE[0]]);
    assert.deepEqual(context(5), [NOTE[4], NOTE[0]], "a blank line doesn't end the nesting");
    assert.deepEqual(context(6), [NOTE[5]]);
});

test("subtreeEnd: the last line nested under a line", () => {
    assert.equal(TrailingLinks.subtreeEnd(lineAt, NOTE.length, 1), 5);
    assert.equal(TrailingLinks.subtreeEnd(lineAt, NOTE.length, 2), 3);
    assert.equal(TrailingLinks.subtreeEnd(lineAt, NOTE.length, 6), 6);
});

test("reportContext: the lines a line is nested under, as the time report reads them (OBS-90)", () => {
    assert.deepEqual(plain(TrailingLinks.reportContext(["\t- [x] Sub [[Loose|⋯]]", "\tsee [[Beta|⭕]]", "- [<] 9:00am\t[[2026-09-14 Review|Review]]"])),
        [{ body: "[x] Sub [[Loose|⋯]]" }, { body: "[<] 9:00am\t[[2026-09-14 Review|Review]]" }], "indented text isn't a parent; bullets come off");
    assert.deepEqual(plain(TrailingLinks.reportContext(["\t1. [ ] Step [[Loose|⋯]]", "## Plan"])), [{ body: "[ ] Step [[Loose|⋯]]" }, { body: "## Plan" }]);
});
