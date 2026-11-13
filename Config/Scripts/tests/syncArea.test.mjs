// Tests for plugin/src/startup/syncArea.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm; only the parts that don't touch `app`
// are tested: isInvoice, and how `parent` replaces the older `area` (OBS-175). SyncArea leaves an
// invoice's `parent` alone because it's the project the invoice bills (OBS-114).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { classScript } from "../../../plugin/classShape.mjs";

const here = new URL(".", import.meta.url);
const SyncArea = vm.runInContext(classScript("syncArea.js") + "\n;SyncArea", vm.createContext({}));
const sync = new SyncArea();

test("isInvoice: frontmatter tagged invoice, as the Invoice command writes it, in any spelling", () => {
    assert.equal(sync.isInvoice({ tags: ["invoice"] }), true);
    assert.equal(sync.isInvoice({ tags: ["project", "#Invoice"] }), true);
    assert.equal(sync.isInvoice({ tags: "invoice, draft" }), true);
    assert.equal(sync.isInvoice({ tag: "invoice" }), true);
    assert.equal(sync.isInvoice({ tags: [null, "invoice"] }), true);
});

test("isInvoice: anything else isn't", () => {
    assert.equal(sync.isInvoice({ tags: ["invoices", "project"] }), false);
    assert.equal(sync.isInvoice({ tags: "project" }), false);
    assert.equal(sync.isInvoice({ status: "invoice" }), false);
    assert.equal(sync.isInvoice({}), false);
    assert.equal(sync.isInvoice(null), false);
});

test("parentKeys: the frontmatter's own spelling of parent, and the older area if it's still there (OBS-175)", () => {
    // Copied out of the vm's realm, whose objects have another prototype
    const pk = (f) => ({ ...sync.parentKeys(f) });
    assert.deepEqual(pk({ parent: "[[A]]" }), { key: "parent", old: null });
    assert.deepEqual(pk({ Parent: "[[A]]", AREA: "[[B]]" }), { key: "Parent", old: "AREA" });
    assert.deepEqual(pk({ area: "[[B]]" }), { key: "parent", old: "area" });
    assert.deepEqual(pk({}), { key: "parent", old: null });
    assert.deepEqual(pk(null), { key: "parent", old: null });
});

test("setParent: parent takes area's place in the frontmatter, so nothing else moves", () => {
    const keys = (f) => Object.keys(f).join(",");
    const old = sync.setParent({ id: 1, tags: ["task"], area: "[[A]]", due: "2026-09-30" }, { key: "parent", old: "area", value: "[[B]]" });
    assert.equal(keys(old), "id,tags,parent,due");
    assert.equal(old.parent, "[[B]]");
    // Both: parent stays where it is, with the new value, and area goes
    const both = sync.setParent({ parent: "[[A]]", id: 1, area: "[[C]]" }, { key: "parent", old: "area", value: "[[B]]" });
    assert.equal(keys(both), "parent,id");
    assert.equal(both.parent, "[[B]]");
    // Neither: parent is added
    const none = sync.setParent({ id: 1 }, { key: "parent", old: null, value: "[[B]]" });
    assert.equal(keys(none), "id,parent");
});

test("hasText: a parent counts only when it holds text, as TimeReport reads it, so an empty one doesn't win over area", () => {
    assert.equal(sync.hasText("[[A]]"), true);
    assert.equal(sync.hasText(["[[A]]"]), true);
    assert.equal(sync.hasText(""), false);
    assert.equal(sync.hasText("  "), false);
    assert.equal(sync.hasText([]), false);
    assert.equal(sync.hasText([""]), false);
    assert.equal(sync.hasText(null), false);
    assert.equal(sync.hasText(undefined), false);
});
