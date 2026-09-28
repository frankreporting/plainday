// Tests for CustomJS/trailingLinks.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
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
    const line = "- [ ] Draft the proposal [[2026-09-30|🚩 9/30]] [[Draft the proposal|🗒️]]";
    const t = TrailingLinks.trail(line);
    assert.deepEqual(plain(t.links.map((l) => [l.kind, l.target])), [["due", "2026-09-30"], ["note", "Draft the proposal"]]);
    assert.equal(t.runFrom, at(line, "[[2026"));
    assert.equal(t.runTo, line.length);
    assert.equal(t.textEnd, at(line, " [[2026"), "the text ends before the space ahead of the run");
    assert.equal(t.bodyFrom, "- [ ] ".length);
    assert.equal(line.slice(t.links[0].from, t.links[0].to), "[[2026-09-30|🚩 9/30]]");
});

test("trail: an event's log and project links, with the ℹ️ left in the text", () => {
    const line = "- [<] 10:00am\tKickoff call ℹ️ [[2026-09-27 Kickoff call|🗒️]] [[Kestrel Outfitters 2026|⭕]]";
    const t = TrailingLinks.trail(line);
    assert.deepEqual(plain(t.links.map((l) => l.kind)), ["note", "project"]);
    assert.equal(line.slice(t.bodyFrom, t.textEnd), "10:00am\tKickoff call ℹ️");
});

test("trail: every system symbol, with or without U+FE0F, and 🔗 from before 🗒️", () => {
    assert.deepEqual(kinds("- [ ] A [[N|🗒️]]"), ["note"]);
    assert.deepEqual(kinds("- [ ] A [[N|🗒]]"), ["note"]);
    assert.deepEqual(kinds("- [ ] A [[N|🔗]]"), ["note"]);
    assert.deepEqual(kinds("- [ ] A [[P|⭕]]"), ["project"]);
    assert.deepEqual(kinds("- [ ] A [[P|⭕️]]"), ["project"]);
    assert.deepEqual(kinds("- [ ] A [[H|🗃️]]"), ["area"]);
    assert.deepEqual(kinds("- [ ] A [[H|🗃]]"), ["area"]);
    assert.deepEqual(kinds("- [ ] A [[2026-12-31|🚩 12/31]] [[P|⭕]] [[N|🗒️]]"), ["due", "project", "note"]);
});

test("trail: ordinary links stay in the text, even at the end of a line", () => {
    assert.equal(TrailingLinks.trail("- [ ] Call [[Rafe Oakes]]"), null);
    assert.equal(TrailingLinks.trail("- [ ] Read [[Some note|the brief]]"), null);
    assert.equal(TrailingLinks.trail("- [<] 3:00pm\t[[2026-09-27 Printer call|Printer call]]"), null, "an old event title wrapped in its log link");
    assert.equal(TrailingLinks.trail("- [ ] Flag it [[2026-09-30|🚩]]"), null, "a 🚩 without its date isn't DueDate's");
    const line = "- [ ] Call [[Rafe Oakes]] about it [[Shot list|🗒️]]";
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
    assert.deepEqual(kinds("\t- [ ] Nested [[N|🗒️]]"), ["note"]);
    assert.deepEqual(kinds("    * [x] Spaces and a star [[N|🗒️]]"), ["note"]);
    assert.deepEqual(kinds("- [>] Forwarded [[N|🗒️]]"), ["note"]);
});

test("trail: trailing spaces aren't part of the run, and a heading in the link is kept", () => {
    const line = "- [ ] Pay the invoice [[2026-09-30|🚩 9/30]] ";
    assert.equal(TrailingLinks.trail(line).runTo, line.length - 1);
    assert.equal(TrailingLinks.trail("- [ ] A [[Note#Part|🗒️]]").links[0].target, "Note#Part");
});

test("trail: a line that is only a run has no text", () => {
    const t = TrailingLinks.trail("- [ ] [[Note|🗒️]]");
    assert.deepEqual(plain(t.links.map((l) => l.kind)), ["note"]);
    assert.ok(t.textEnd <= t.bodyFrom);
});

// ---------------------------------------------------------------- lastWordStart

test("lastWordStart: the text's last word, which wraps with the run", () => {
    const line = "- [ ] Homepage build: category pages [[P|⭕]]";
    const t = TrailingLinks.trail(line);
    assert.equal(TrailingLinks.lastWordStart(line, t.bodyFrom, t.textEnd), at(line, "pages"));
    const event = "- [<] 10:00am\tKickoff call ℹ️ [[L|🗒️]]";
    const e = TrailingLinks.trail(event);
    assert.equal(TrailingLinks.lastWordStart(event, e.bodyFrom, e.textEnd), at(event, "ℹ️"));
});

test("lastWordStart: a link ending the text is one word, spaces and all", () => {
    const line = "- [ ] Call [[Rafe Oakes]] [[N|🗒️]]";
    const t = TrailingLinks.trail(line);
    assert.equal(TrailingLinks.lastWordStart(line, t.bodyFrom, t.textEnd), at(line, "[[Rafe"));
    const alias = "- [ ] Read [[Some note|the brief]] [[N|🗒️]]";
    const a = TrailingLinks.trail(alias);
    assert.equal(TrailingLinks.lastWordStart(alias, a.bodyFrom, a.textEnd), at(alias, "[[Some"));
});

test("lastWordStart: a one-word task, and none when there's no text", () => {
    const line = "- [ ] Mow [[H|🗃️]]";
    const t = TrailingLinks.trail(line);
    assert.equal(TrailingLinks.lastWordStart(line, t.bodyFrom, t.textEnd), at(line, "Mow"));
    const bare = "- [ ] [[Note|🗒️]]";
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
    "\t- [ ] Gutter quote [[Fix the gutter|🗒️]]",
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
    assert.deepEqual(plain(TrailingLinks.reportContext(["\t- [x] Sub [[Loose|🗒️]]", "\tsee [[Beta|⭕]]", "- [<] 9:00am\t[[2026-09-14 Review|Review]]"])),
        [{ body: "[x] Sub [[Loose|🗒️]]" }, { body: "[<] 9:00am\t[[2026-09-14 Review|Review]]" }], "indented text isn't a parent; bullets come off");
    assert.deepEqual(plain(TrailingLinks.reportContext(["\t1. [ ] Step [[Loose|🗒️]]", "## Plan"])), [{ body: "[ ] Step [[Loose|🗒️]]" }, { body: "## Plan" }]);
});
