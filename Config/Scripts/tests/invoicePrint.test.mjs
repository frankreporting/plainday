// Tests for plugin/src/startup/invoicePrint.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The export's own markup (each block in a div of its own) is checked in an Obsidian window; here, a
// stand-in of that shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { classScript } from "../../../plugin/classShape.mjs";

const InvoicePrint = vm.runInContext(classScript("invoicePrint.js") + "\n;InvoicePrint", vm.createContext({ plainday: {} }));

// A stand-in element: its tag, classes, children, and a heading's data-heading
function el(tag, classes = [], children = [], heading = undefined) {
    const e = {
        tagName: tag.toUpperCase(), classes: new Set(classes), children, dataset: heading === undefined ? {} : { heading },
        textContent: heading ?? "", parentElement: null, nextElementSibling: null,
        classList: { contains: (c) => e.classes.has(c), add: (c) => e.classes.add(c) },
        querySelectorAll: (sel) => all(e).filter((x) => x.tagName === sel.toUpperCase()),
    };
    children.forEach((k, i) => { k.parentElement = e; k.nextElementSibling = children[i + 1] ?? null; });
    return e;
}
const all = (e) => e.children.flatMap((k) => [k, ...all(k)]);
const block = (tag, heading) => el("div", [], [el(tag, [], [], heading)]);
// An invoice as Export to PDF renders it: one container, every block in a div
const exported = (cls = ["markdown-preview-view", "pm-invoice"]) => el("div", cls, [
    block("h1"), el("div", [], [el("div", ["pm-invoice-parties"])]), block("h2", "Billable hours"), block("table"), block("p"),
    block("h2", "Billed entries"), block("table"),
]);
const marked = (doc) => doc.children.map((k) => k.classes.has("pm-invoice-billed"));

test("mark: in an exported invoice, the Billed entries heading's block and every block after it", () => {
    const doc = exported();
    InvoicePrint.mark(doc);
    assert.deepEqual(marked(doc), [false, false, false, false, false, true, true]);
});

test("mark: leaves a note that isn't an invoice, and an invoice with no Billed entries, alone", () => {
    const doc = exported(["markdown-preview-view"]);
    InvoicePrint.mark(doc);
    assert.deepEqual(marked(doc), [false, false, false, false, false, false, false]);
    const none = el("div", ["pm-invoice"], [block("h2", "Billable hours"), block("table")]);
    InvoicePrint.mark(none);
    assert.deepEqual(marked(none), [false, false]);
});

test("mark: reading view's one-block calls mark nothing", () => {
    // Reading view hands each block to the post-processor on its own: the heading's parent is the block
    const section = el("div", ["el-h2"], [el("h2", [], [], "Billed entries")]);
    InvoicePrint.mark(section);
    assert.equal(section.classes.has("pm-invoice-billed"), false);
});
