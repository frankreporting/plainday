// Tests for CustomJS/setDueDate.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// Only `placement` is pure; the modal and the write are checked in a dev vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const DueDate = vm.runInContext(fs.readFileSync(new URL("../CustomJS/setDueDate.js", here), "utf8") + "\n;DueDate", vm.createContext({}));
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
