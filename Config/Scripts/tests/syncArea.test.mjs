// Tests for CustomJS/syncArea.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it; only isInvoice, which doesn't touch
// `app`, is tested. SyncArea leaves an invoice's `area` alone because it's the project the invoice
// bills (OBS-114).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const SyncArea = vm.runInContext(fs.readFileSync(new URL("../CustomJS/syncArea.js", here), "utf8") + "\n;SyncArea", vm.createContext({}));
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
