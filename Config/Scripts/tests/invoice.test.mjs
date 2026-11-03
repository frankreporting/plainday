// Tests for CustomJS/invoice.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it, next to TimeReport and Billing; only the
// methods that don't touch `app` are tested. Every name, address and amount here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8") + `\n;${name}`, vm.createContext({}));
const tr = new (load("timeReport.js", "TimeReport"))();
const billing = new (load("billing.js", "Billing"))();
const inv = new (load("invoice.js", "Invoice"))();
const plain = (x) => JSON.parse(JSON.stringify(x));

const DAYS = "Reference/Planner/days";
const WEB = "Projects/Work/Harbor Web/Harbor Web.md";
const PHOTO = "Projects/Work/Harbor Web/Harbor Photos/Harbor Photos.md";
const CLIENT = "Reference/Entities/Harbor Co.md";
const INDEX_NOTES = [
    { path: WEB, tags: ["project"], props: { rate: 80, rate_type: "hourly", include_subprojects: true, client: "[[Harbor Co]]" } },
    { path: PHOTO, tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
    { path: CLIENT, tags: [], props: { code: "hbr", address: ["1 Dock Street", "Port Town, ST 00000"] } },
];
const index = tr.makeIndex(INDEX_NOTES);
const day = (date, text) => ({ date, path: `${DAYS}/${date}.md`, text });
const model = tr.build([
    day("2026-09-01", "- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass\n- [x] Review [[Harbor Web|⭕]]\n\t- 3:00pm - 3:20pm"),
    day("2026-09-02", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am\n- [x] Shoot [[Harbor Photos|⭕]]\n\t- 1:00pm - 2:00pm"),
], index);
const billed = billing.snapshot(model.entries, model, tr);
const DATA = (more = {}) => ({
    id: "2026090312000000", name: "1001-HBR", status: "draft",
    parent: "[[Harbor Web|⭕.Work.Harbor Web]]", clientLink: "Harbor Co", billToLink: "Harbor Co",
    invoiceDate: "2026-09-03", periodStart: "2026-09-01", periodEnd: "2026-09-02",
    from: { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"] },
    billTo: { name: "Harbor Co", address: ["1 Dock Street", "Port Town, ST 00000"] },
    projectId: "", requestedBy: "", terms: "Net 30", paymentNote: "Please pay by bank transfer within 30 days.",
    billed, linkText: (p) => tr.basename(p), ...more,
});

// ------------------------------------------------------------------ the note

test("noteText: frontmatter the Invoices base and Billing read", () => {
    const text = inv.noteText(DATA(), tr, billing);
    assert.equal(text.split("\n---\n")[0] + "\n---", [
        "---",
        "id: 2026090312000000",
        "aliases:",
        '  - "Invoice 1001-HBR"',
        "tags:",
        "  - invoice",
        "cssclasses:",
        "  - pm-invoice",
        'parent: "[[Harbor Web|⭕.Work.Harbor Web]]"',
        "invoice_status: draft",
        'number: "1001-HBR"',
        'client: "[[Harbor Co]]"',
        'bill_to: "[[Harbor Co]]"',
        "invoice_date: 2026-09-03",
        "period_start: 2026-09-01",
        "period_end: 2026-09-02",
        "hours: 4.00",
        "total: 340.00",
        "paid:",
        "---",
    ].join("\n"));
});

test("noteText: `bill_to` names who's billed, right after `client`; with no client, `client` is blank (OBS-109)", () => {
    const front = (more) => inv.noteText(DATA(more), tr, billing).split("\n---\n")[0].split("\n");
    const lines = front({ billToLink: "Tern Agency" });
    assert.deepEqual(lines.slice(lines.indexOf('client: "[[Harbor Co]]"'), lines.indexOf('client: "[[Harbor Co]]"') + 2), ['client: "[[Harbor Co]]"', 'bill_to: "[[Tern Agency]]"']);
    const blank = front({ clientLink: "", billToLink: "Tern Agency" });
    assert.deepEqual(blank.slice(blank.indexOf("client:"), blank.indexOf("client:") + 2), ["client:", 'bill_to: "[[Tern Agency]]"']);
});

test("noteText: the header, a row per date and rate, the total, then the Billed entries", () => {
    const lines = inv.noteText(DATA(), tr, billing).split("\n");
    const at = (l) => lines.indexOf(l);
    assert.ok(at("# Invoice No. 1001-HBR") > 0);
    assert.ok(lines.includes('<div class="pm-invoice-party"><p class="pm-invoice-name">Juniper Hale</p><p>418 Larkspur Lane<br>Maple Falls, ST 00000</p></div>'));
    assert.ok(lines.includes('<div class="pm-invoice-facts"><p><span class="pm-invoice-label">Invoice date</span><br>9/3/2026</p></div>'));
    assert.ok(lines.includes('<div class="pm-invoice-facts"><p><span class="pm-invoice-label">Terms</span><br>Net 30</p><p><span class="pm-invoice-label">Total hours</span><br><strong>4.00</strong></p><p><span class="pm-invoice-label">Total due</span><br><strong>$340.00</strong></p></div>'));
    const table = lines.slice(at("## Billable hours") + 2, at("## Billable hours") + 8);
    assert.deepEqual(table, [
        "| Line item | Qty | Rate | Amount |",
        "| --- | --: | --: | --: |",
        "| 9/1 — Site map, Review | 2.00 | $80.00 | $160.00 |",
        "| 9/2 — Shoot | 1.00 | $100.00 | $100.00 |",
        "| 9/2 — Build pages | 1.00 | $80.00 | $80.00 |",
        "| **Total** | **4.00** |  | **$340.00** |",
    ]);
    assert.ok(at("Please pay by bank transfer within 30 days.") > at("| **Total** | **4.00** |  | **$340.00** |"));
    assert.ok(at("## Billed entries") > at("Please pay by bank transfer within 30 days."), "Billed entries comes last");
    assert.equal(lines[at("## Billed entries") + 2], "| Date | Time | Project | Task | Notes | Rate | Hours |");
});

test("noteText: nothing printed is a link", () => {
    const text = inv.noteText(DATA({ check: inv.checkLines("Before sending", ["[[2026-09-01|9/1/26]] line 3: x"]) }), tr, billing);
    const printed = text.slice(text.indexOf("# Invoice No."), text.indexOf("## Billed entries"));
    assert.ok(!printed.includes("[["), printed);
    assert.ok(text.indexOf("%% invoice-check:start %%") < text.indexOf("# Invoice No."), "the check block sits above the invoice");
});

test("noteText: reads back through Billing with nothing wrong, rows and total intact", () => {
    const text = inv.noteText(DATA(), tr, billing);
    const fm = { status: "draft", number: "1001-HBR", project: "[[Harbor Web]]", hours: 4, total: 340, period_start: "2026-09-01", period_end: "2026-09-02" };
    const read = billing.readInvoice({ path: "Projects/Work/Harbor Web/invoices/1001-HBR.md", props: fm, text }, tr, index);
    assert.equal(read.problem, null);
    assert.equal(read.rows.length, 4);
    assert.deepEqual(plain(read.rows.map((r) => r.projectPath)), [WEB, WEB, WEB, PHOTO]);
});

test("noteText: values from notes are escaped; the optional facts and note only when set", () => {
    const text = inv.noteText(DATA({ billTo: { name: 'A & B <Co> "X"', address: [] }, projectId: "HB-26", requestedBy: "R. Vale", paymentNote: "", terms: "" }), tr, billing);
    assert.ok(text.includes('<p class="pm-invoice-name">A &amp; B &lt;Co&gt; &quot;X&quot;</p></div>'));
    assert.ok(text.includes('<p><span class="pm-invoice-label">Requested by</span><br>R. Vale</p><p><span class="pm-invoice-label">Project ID</span><br>HB-26</p><p><span class="pm-invoice-label">Total hours</span>'));
    assert.ok(!text.includes("Terms"));
    assert.ok(!text.includes("Please pay"));
});

test("lines: dates carry the year when an invoice spans two", () => {
    const rows = [{ date: "2026-12-30", cents: 8000, billed: 60, task: "A" }, { date: "2027-01-02", cents: 8000, billed: 60, task: "B" }];
    assert.deepEqual(plain(inv.lines(rows, billing, tr).map((r) => r.label)), ["12/30/26", "1/2/27"]);
});

// ------------------------------------------------------------------ rebuilding a draft

test("keepDescriptions: an edited description survives a rebuild; an untouched one follows the tasks", () => {
    const text = inv.noteText(DATA(), tr, billing).replace("| 9/2 — Build pages |", "| 9/2 — Page templates, first pass |");
    const kept = inv.keepDescriptions(text, billed, billing, tr);
    assert.deepEqual(plain([...kept]), [["9/2 $80.00", "Page templates, first pass"]]);
    // A new task on 9/1: its untouched description takes it
    const more = [...billed, { date: "2026-09-01", start: 1000, end: 1030, minutes: 30, billed: 30, cents: 8000, project: WEB, task: "Fixes", note: "" }];
    const rows = inv.lines(more, billing, tr, kept);
    assert.equal(rows.find((r) => r.label === "9/1").description, "Site map, Review, Fixes");
    assert.equal(rows.find((r) => r.label === "9/2" && r.cents === 8000).description, "Page templates, first pass");
});

test("descriptions: a | in a description survives", () => {
    const text = inv.noteText(DATA(), tr, billing).replace("| 9/2 — Build pages |", "| 9/2 — Pages \\| templates |");
    assert.equal(inv.descriptions(text, billing).get("9/2 $80.00"), "Pages \\| templates");
});

// ------------------------------------------------------------------ editing the note

test("placeCheck: inserts after the frontmatter, replaces, removes, and leaves the rest alone", () => {
    const text = "---\nstatus: sent\n---\n# Invoice No. 1\n\nbody\n";
    const one = inv.placeCheck(text, inv.checkLines("First", ["a"]));
    assert.equal(one, "---\nstatus: sent\n---\n%% invoice-check:start %%\n> [!pm-invoice-check] First\n> - a\n%% invoice-check:end %%\n# Invoice No. 1\n\nbody\n");
    const two = inv.placeCheck(one, inv.checkLines("Second"));
    assert.equal(two, "---\nstatus: sent\n---\n%% invoice-check:start %%\n> [!pm-invoice-check] Second\n%% invoice-check:end %%\n# Invoice No. 1\n\nbody\n");
    assert.equal(inv.placeCheck(two, null), text);
    assert.equal(inv.placeCheck(text, null), text);
});

test("setProps: sets a value in place, replaces a list, adds a missing key last", () => {
    const text = "---\nstatus: draft\ntags:\n  - invoice\nsent:\nextra: kept\n---\nbody";
    assert.equal(inv.setProps(text, { status: "sent", sent: "2026-09-12" }), "---\nstatus: sent\ntags:\n  - invoice\nsent: 2026-09-12\nextra: kept\n---\nbody");
    assert.equal(inv.setProps(text, { paid: "2026-09-15" }), "---\nstatus: draft\ntags:\n  - invoice\nsent:\nextra: kept\npaid: 2026-09-15\n---\nbody");
    assert.equal(inv.setProps("---\nhours: 1\nlist:\n  - a\n  - b\n---\n", { list: "x" }), "---\nhours: 1\nlist: x\n---\n");
    assert.equal(inv.setProps("no frontmatter", { status: "sent" }), null);
});

test("setStatus: sets invoice_status and takes out the status an older invoice carries (OBS-117)", () => {
    // An invoice made before: its status line becomes invoice_status where it stands
    const old = '---\ntags:\n  - invoice\nstatus: sent\nnumber: "1001-HBR"\npaid:\n---\nbody';
    assert.equal(inv.setStatus(old, "paid", { paid: "2026-09-15" }), '---\ntags:\n  - invoice\ninvoice_status: paid\nnumber: "1001-HBR"\npaid: 2026-09-15\n---\nbody');
    // A `status` in the body is left alone
    assert.equal(inv.setStatus("---\nStatus: draft\n---\nstatus: notes\n", "sent"), "---\ninvoice_status: sent\n---\nstatus: notes\n");
    // One made now: set in place
    assert.equal(inv.setStatus("---\ninvoice_status: sent\nsent: 2026-09-12\n---\n", "canceled"), "---\ninvoice_status: canceled\nsent: 2026-09-12\n---\n");
    // Both: one left
    assert.equal(inv.setStatus("---\ninvoice_status: draft\nstatus: draft\n---\n", "sent", { sent: "2026-09-12" }), "---\ninvoice_status: sent\nsent: 2026-09-12\n---\n");
    assert.equal(inv.setStatus("\r\n---\r\n", "sent"), null);
    assert.equal(inv.setStatus("---\r\nstatus: draft\r\nsent:\r\n---\r\nbody", "sent", { sent: "2026-09-12" }), "---\r\ninvoice_status: sent\r\nsent: 2026-09-12\r\n---\r\nbody");
    // Invoice and Billing name the property the same way
    assert.equal(inv.constructor.STATUS, "invoice_status");
    assert.equal(billing.constructor.STATUS, inv.constructor.STATUS);
});

test("escapeKey: a property name with pattern characters matches only itself", () => {
    assert.equal(inv.setProps("---\naXb: 1\n---\n", { "a.b": 2 }), "---\naXb: 1\na.b: 2\n---\n");
    assert.equal(inv.removeProps("---\naXb: 1\na.b: 2\n---\n", ["a.b"]), "---\naXb: 1\n---\n");
});

test("removeProps: takes keys out of the frontmatter, with any list under them, and nothing else", () => {
    assert.equal(inv.removeProps("---\na: 1\nlist:\n  - x\n  - y\nb: 2\n---\nlist: body\n", ["list", "missing"]), "---\na: 1\nb: 2\n---\nlist: body\n");
    assert.equal(inv.removeProps("---\nStatus: sent\nstatus_note: keep\n---\n", ["status"]), "---\nstatus_note: keep\n---\n");
    assert.equal(inv.removeProps("no frontmatter", ["a"]), null);
});

test("setPrintedDate: the date the invoice prints, set to the day it's sent", () => {
    const text = inv.noteText(DATA(), tr, billing);
    const sent = inv.setPrintedDate(text, "2026-09-12");
    assert.ok(text.includes('<span class="pm-invoice-label">Invoice date</span><br>9/3/2026</p>'));
    assert.ok(sent.includes('<span class="pm-invoice-label">Invoice date</span><br>9/12/2026</p>'));
    assert.equal(sent.replace("9/12/2026", "9/3/2026"), text, "nothing else changes");
    assert.equal(inv.setPrintedDate("no header", "2026-09-12"), "no header");
});

test("split: the frontmatter and the body", () => {
    assert.deepEqual(plain(inv.split("---\na: 1\n---\n# Title\n")), { front: "---\na: 1\n---", body: "# Title\n" });
    assert.deepEqual(plain(inv.split("# Title")), { front: "", body: "# Title" });
});

// ------------------------------------------------------------------ settings, clients, numbers

test("readSettings: a name makes it usable; an address as a list or lines", () => {
    assert.equal(inv.readSettings({ name: "" }, billing).ok, false);
    assert.deepEqual(plain(inv.readSettings({ name: " Juniper Hale ", address: "418 Larkspur Lane\nMaple Falls, ST 00000", terms: "Net 15", payment_note: "Thanks" }, billing)),
        { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"], terms: "Net 15", paymentNote: "Thanks", folder: "", lastNumber: null, problem: null, ok: true });
    assert.deepEqual(plain(inv.readSettings({ name: "J", address: ["a", "", " b "] }, billing).address), ["a", "b"]);
});

test("readSettings: `folder` and `last_number` (OBS-112), and what's wrong with them", () => {
    const s = (props) => inv.readSettings({ name: "J", ...props }, billing);
    assert.equal(s({ folder: " /Reference/Invoices/ " }).folder, "Reference/Invoices");
    for (const [raw, want] of [[1033, 1033], ["1033", 1033], [" 1033 ", 1033], [0, 0], ["", null], ["  ", null], [null, null], [undefined, null]]) {
        assert.equal(s({ last_number: raw }).lastNumber, want, String(raw));
        assert.equal(s({ last_number: raw }).problem, null, String(raw));
    }
    assert.equal(s({ last_number: 999999 }).lastNumber, 999999);
    for (const raw of [1033.5, -1, "abc", "1,033", "1033-KES", true, [1033], 1000000, "1e5", 1e21]) {
        assert.equal(s({ last_number: raw }).lastNumber, null, String(raw));
        assert.match(s({ last_number: raw }).problem, /`last_number` isn't a whole number from 0 to 999999/, String(raw));
        assert.equal(s({ last_number: raw }).ok, true, "a bad number doesn't stop a rebuild");
    }
    assert.match(s({ folder: "../Invoices" }).problem, /^`folder` isn't a folder in the vault/);
    assert.equal(s({ folder: "../Invoices" }).folder, "");
});

test("readBillTo: with no bill_to, the project's client, else its parent's; the code upper-cased", () => {
    assert.deepEqual(plain(inv.readBillTo(PHOTO, tr, index)), {
        path: CLIENT, name: "Harbor Co", code: "HBR", billingName: "Harbor Co", address: ["1 Dock Street", "Port Town, ST 00000"],
        client: { path: CLIENT, written: "Harbor Co" },
    });
});

// A client project billed through an agency (OBS-109): the parent names both, a sub-project repeats the
// client, another names its own bill-to. Every name and address is invented.
const AGENCY = "Reference/Entities/Tern Agency.md";
const PRINT = "Projects/Work/Harbor Web/Harbor Print/Harbor Print.md";
const BILL_TO_NOTES = [
    { path: WEB, tags: ["project"], props: { rate: 80, rate_type: "hourly", client: "[[Harbor Co]]", bill_to: "[[Tern Agency]]" } },
    { path: PHOTO, tags: ["project"], props: { rate: 100, rate_type: "hourly", client: "[[Harbor Co]]" } },
    { path: PRINT, tags: ["project"], props: { rate: 90, rate_type: "hourly", bill_to: "[[Gull Press]]" } },
    { path: CLIENT, tags: [], props: { code: "hbr", address: ["1 Dock Street", "Port Town, ST 00000"] } },
    { path: AGENCY, tags: [], props: { billing_name: " Tern Agency LLC ", address: "77 Mill Street\nPort Town, ST 00000" } },
    { path: "Reference/Entities/Gull Press.md", tags: [], props: { code: "gp" } },
];

test("readBillTo: the nearest bill_to wins over every client, so a sub-project that repeats its client bills its parent's bill-to", () => {
    const idx = tr.makeIndex(BILL_TO_NOTES);
    const agency = { path: AGENCY, name: "Tern Agency", code: "", billingName: "Tern Agency LLC", address: ["77 Mill Street", "Port Town, ST 00000"], client: { path: CLIENT, written: "Harbor Co" } };
    assert.deepEqual(plain(inv.readBillTo(WEB, tr, idx)), agency);
    assert.deepEqual(plain(inv.readBillTo(PHOTO, tr, idx)), agency, "its own client doesn't beat the parent's bill_to");
    // Its own bill_to beats its parent's; the client recorded is still the nearest one, the parent's
    assert.deepEqual(plain(inv.readBillTo(PRINT, tr, idx)),
        { path: "Reference/Entities/Gull Press.md", name: "Gull Press", code: "GP", billingName: "Gull Press", address: [], client: { path: CLIENT, written: "Harbor Co" } });
});

test("readBillTo: a bill_to with no client anywhere invoices, recording no client", () => {
    const idx = tr.makeIndex([
        { path: "P/Solo/Solo.md", tags: ["project"], props: { bill_to: "[[Tern Agency]]" } },
        { path: AGENCY, tags: [], props: {} },
    ]);
    const billed = inv.readBillTo("P/Solo/Solo.md", tr, idx);
    assert.equal(billed.path, AGENCY);
    assert.equal(billed.client, null);
    assert.deepEqual(plain(inv.partyLinks(billed, (p) => tr.basename(p))), { clientLink: "", billToLink: "Tern Agency" });
});

test("readBillTo: the notices say what to do; a client that isn't a note stops only the invoice that bills it", () => {
    const solo = (props, more = []) => inv.readBillTo("P/Solo/Solo.md", tr, tr.makeIndex([{ path: "P/Solo/Solo.md", tags: ["project"], props }, ...more]));
    assert.equal(solo({}).error, "Solo has no `client` or `bill_to`; link the note to bill from the project first");
    assert.equal(solo({ client: "  ", bill_to: "" }).error, "Solo has no `client` or `bill_to`; link the note to bill from the project first");
    assert.equal(solo({ client: "[[Nobody Yet]]" }).error, "The client [[Nobody Yet]] isn't a note yet; create it, then run Invoice again");
    assert.equal(solo({ client: "[[Harbor Co]]", bill_to: "[[Tern Agency]]" }, [{ path: CLIENT, tags: [], props: {} }]).error,
        "The bill-to [[Tern Agency]] isn't a note yet; create it, then run Invoice again");
    // Billed to the agency, the client link is recorded as written
    const billed = solo({ client: "[[Nobody Yet]]", bill_to: "[[Tern Agency]]" }, [{ path: AGENCY, tags: [], props: {} }]);
    assert.equal(billed.error, undefined);
    assert.deepEqual(plain(billed.client), { path: null, written: "Nobody Yet" });
    assert.deepEqual(plain(inv.partyLinks(billed, (p) => tr.basename(p))), { clientLink: "Nobody Yet", billToLink: "Tern Agency" });
    // Its alias kept; plain text becomes a link to it, with nothing that would break the link
    const links = (client) => inv.partyLinks(solo({ client, bill_to: "[[Tern Agency]]" }, [{ path: AGENCY, tags: [], props: {} }]), (p) => tr.basename(p)).clientLink;
    assert.equal(links("[[Nobody Yet|NY Co]]"), "Nobody Yet|NY Co");
    assert.equal(links("Nobody | Yet ]]"), "Nobody  Yet");
});

test("rebuiltFront: a Rebuild sets client and bill_to, bill_to right after client on an older draft; nothing else moves", () => {
    const old = inv.split(inv.noteText(DATA(), tr, billing)).front.replace('bill_to: "[[Harbor Co]]"\n', "").replace("paid:", "paid:\nnotes: mine");
    const idx = tr.makeIndex(BILL_TO_NOTES);
    const front = inv.rebuiltFront(old, inv.readBillTo(PHOTO, tr, idx), (p) => tr.basename(p), { hours: "4.50", total: "377.50" });
    const want = old.split("\n");
    want.splice(want.indexOf('client: "[[Harbor Co]]"') + 1, 0, 'bill_to: "[[Tern Agency]]"');
    assert.deepEqual(front.split("\n"), want.map((l) => (l === "hours: 4.00" ? "hours: 4.50" : l === "total: 340.00" ? "total: 377.50" : l)));
    // Run again, it changes nothing more, and a client gone from the project leaves `client` blank
    assert.equal(inv.rebuiltFront(front, inv.readBillTo(PHOTO, tr, idx), (p) => tr.basename(p)), front);
    const alone = tr.makeIndex([{ path: "P/Solo/Solo.md", tags: ["project"], props: { bill_to: "[[Tern Agency]]" } }, { path: AGENCY, tags: [], props: {} }]);
    const blank = inv.rebuiltFront(front, inv.readBillTo("P/Solo/Solo.md", tr, alone), (p) => tr.basename(p)).split("\n");
    assert.deepEqual(blank.slice(blank.indexOf("client:"), blank.indexOf("client:") + 2), ["client:", 'bill_to: "[[Tern Agency]]"']);
});

test("setProps: a new key goes after the key `after` names, past any list under it, else last", () => {
    const text = "---\nid: 1\ntags:\n  - invoice\nclient: x\n---\nbody";
    assert.equal(inv.setProps(text, { bill_to: "y" }, { after: { bill_to: "tags" } }), "---\nid: 1\ntags:\n  - invoice\nbill_to: y\nclient: x\n---\nbody");
    assert.equal(inv.setProps(text, { bill_to: "y" }, { after: { bill_to: "missing" } }), "---\nid: 1\ntags:\n  - invoice\nclient: x\nbill_to: y\n---\nbody");
    assert.equal(inv.setProps(text, { bill_to: "y" }), "---\nid: 1\ntags:\n  - invoice\nclient: x\nbill_to: y\n---\nbody");
    // A client written as a list, in another case, in a note with CRLF line ends: replaced whole, bill_to after it
    const crlf = "---\r\nid: 1\r\nClient:\r\n  - \"[[Old Co]]\"\r\npaid:\r\n---\r\nbody";
    assert.equal(inv.setProps(crlf, { client: '"[[New Co]]"', bill_to: '"[[Tern Agency]]"' }, { after: { bill_to: "client" } }),
        '---\r\nid: 1\r\nclient: "[[New Co]]"\r\nbill_to: "[[Tern Agency]]"\r\npaid:\r\n---\r\nbody');
    // A bill_to already there is set where it stands
    assert.equal(inv.setProps("---\nbill_to: a\nclient: x\n---\n", { client: "y", bill_to: "b" }, { after: { bill_to: "client" } }), "---\nbill_to: b\nclient: y\n---\n");
});

test("suggestCode and nameFor", () => {
    assert.equal(inv.suggestCode("Kestrel Outfitters"), "KO");
    assert.equal(inv.suggestCode("@Pinecrest Public Library"), "PPL");
    assert.equal(inv.suggestCode("Harbor"), "HAR");
    assert.equal(inv.nameFor(1001, "KES"), "1001-KES");
});

test("settingsText: blanks to fill in, and a body so Templater leaves it be", () => {
    const text = inv.settingsText("2026092810000000");
    assert.match(text, /^---\nid: 2026092810000000\ntags:\nname:\naddress:\nterms: Net 30\npayment_note:\nfolder:\nlast_number: 1000\n---\nYour details for invoices\./);
    assert.match(text, /`folder`/);
    assert.match(text, /`last_number`/);
    assert.ok(!/invoice\n/.test(text.split("---")[1]), "the settings note isn't tagged invoice");
});

// ------------------------------------------------------------------ what the check and the draft say

test("changeItems and beforeSendingItems: plain lines for the check block", () => {
    const rows = billed.slice(0, 1);
    const fake = { changes: [{ row: { ...rows[0] }, kind: "times", entry: { date: "2026-09-01", start: 780, end: 885 } }], late: [{ date: "2026-09-02", start: 900, end: 960, task: "Extra | work" }] };
    assert.deepEqual(plain(inv.changeItems(fake, tr)), [
        "[[2026-09-01|9/1/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm",
        "Logged in this period after the invoice, not billed: [[2026-09-02|9/2/26]] 3:00pm - 4:00pm Extra \\| work",
    ]);
    const sel = {
        problems: [{ date: "2026-09-03", line: 4, text: "- 2:00pm - ", message: "clock still running (no end time), so it isn't counted" }],
        changed: [],
        heldBack: [{ entry: { date: "2026-09-01", start: 780, end: 885 }, invoice: { name: "1001-HBR" }, row: { date: "2026-09-01", start: 780, end: 870 }, why: "changed" }],
    };
    assert.deepEqual(plain(inv.beforeSendingItems(sel, tr)), [
        "[[2026-09-03|9/3/26]] line 4: `- 2:00pm - ` clock still running (no end time), so it isn't counted",
        "Held back: [[2026-09-01|9/1/26]] 1:00pm - 2:45pm overlaps 1:00pm - 2:30pm, billed on [[1001-HBR]]",
    ]);
});

test("OBS-215: a gone billed row says it's missing from the daily note, linked; under Fix first, another project's names that project", () => {
    const row = { ...billed[0] };
    assert.deepEqual(plain(inv.changeItems({ changes: [{ row, kind: "gone" }], late: [] }, tr)), [
        "9/1/26 1:00pm - 2:30pm `Site map: first pass` was billed, but now it's missing from [[2026-09-01|the daily note]]; put it back there to settle it",
    ]);
    const invoice = { name: "1001-HBR", status: "paid", paid: "2026-09-15", project: WEB };
    const items = (scope) => plain(inv.beforeSendingItems({ problems: [], heldBack: [], scope: new Set(scope), changed: [{ invoice, change: { row, kind: "gone" } }] }, tr));
    assert.deepEqual(items([WEB]), ["[[1001-HBR]] (paid 9/15): 9/1/26 1:00pm - 2:30pm `Site map: first pass` was billed, but now it's missing from [[2026-09-01|the daily note]]; put it back there to settle it"]);
    assert.deepEqual(items(["Projects/Work/Dune Books/Dune Books.md"]), ["Harbor Web's [[1001-HBR]] (paid 9/15): 9/1/26 1:00pm - 2:30pm `Site map: first pass` was billed, but now it's missing from [[2026-09-01|the daily note]]; put it back there to settle it"]);
    // A sub-project's row on its parent's invoice is the sub-project's time: no name when invoicing it
    const sub = (scope) => plain(inv.beforeSendingItems({ problems: [], heldBack: [], scope: new Set(scope), changed: [{ invoice, change: { row: { ...row, projectPath: PHOTO }, kind: "gone" } }] }, tr));
    assert.ok(!sub([PHOTO])[0].includes("'s [[1001-HBR]]"));
    assert.ok(sub(["Projects/Work/Dune Books/Dune Books.md"])[0].startsWith("Harbor Photos's [[1001-HBR]]"));
    // The draft's Before sending callout keeps this project's missing rows and leaves out another's
    const sel = (scope) => ({ problems: [], heldBack: [], scope: new Set(scope), changed: [{ invoice, change: { row, kind: "gone" } }] });
    assert.match(inv.beforeSending(sel([WEB]), tr).join("\n"), /\[\[1001-HBR\]\] \(paid 9\/15\): 9\/1\/26 1:00pm - 2:30pm `Site map: first pass` was billed, but now it's missing/);
    assert.equal(inv.beforeSending(sel(["Projects/Work/Dune Books/Dune Books.md"]), tr), null, "nothing of Harbor Web's in Dune Books's draft");
});

test("OBS-215: linkParts splits a confirmation item around its links, so each can be clicked", () => {
    assert.deepEqual(plain(inv.linkParts("Harbor Web's [[1001-HBR]] (paid 9/15): missing from [[2026-09-01|the daily note]]")), [
        { text: "Harbor Web's " }, { link: "1001-HBR", text: "1001-HBR" }, { text: " (paid 9/15): missing from " }, { link: "2026-09-01", text: "the daily note" },
    ]);
    assert.deepEqual(plain(inv.linkParts("no links")), [{ text: "no links" }]);
    assert.deepEqual(plain(inv.linkParts("[[a]][[b|c]]")), [{ link: "a", text: "a" }, { link: "b", text: "c" }]);
});

test("setProps, placeCheck and split keep a note's CRLF line endings, and a key doesn't match a longer one", () => {
    const text = "---\r\nstatus: draft\r\npaid_by: x\r\npaid:\r\n---\r\n# Invoice No. 1\r\n";
    assert.equal(inv.setProps(text, { status: "sent", paid: "2026-09-15" }), "---\r\nstatus: sent\r\npaid_by: x\r\npaid: 2026-09-15\r\n---\r\n# Invoice No. 1\r\n");
    const checked = inv.placeCheck(text, inv.checkLines("T", ["a"]));
    assert.ok(!/[^\r]\n/.test(checked), "no bare newlines");
    assert.equal(inv.placeCheck(checked, null), text);
    assert.deepEqual(plain(inv.split(text)), { front: "---\r\nstatus: draft\r\npaid_by: x\r\npaid:\r\n---", body: "# Invoice No. 1\r\n" });
});

test("final review: setProps matches a key however it's capitalized", () => {
    assert.equal(inv.setProps("---\nStatus: sent\n---\n", { status: "paid" }), "---\nstatus: paid\n---\n");
});

test("askDate: a month and day without a year is the closer one, since billing looks back as often as ahead (OBS-143)", async () => {
    const asked = [];
    const DatePrompt = {
        open(title, onPick, opts) {
            asked.push({ title, nearest: opts?.nearest });
            const modal = { contentEl: { querySelector: () => null }, close() { this.onClose?.(); } };
            setTimeout(() => onPick({ date: "2026-09-16" }, modal), 0);
            return modal;
        },
    };
    const context = vm.createContext({ setTimeout, customJS: { DatePrompt } });
    const src = fs.readFileSync(new URL("../CustomJS/invoice.js", here), "utf8");
    const asking = new (vm.runInContext(`${src}\n;Invoice`, context))();
    assert.equal(await asking.askDate("Bill through"), "2026-09-16");
    assert.deepEqual(asked, [{ title: "Bill through", nearest: true }]);
});

test("Invoice on a flat project asks when its fee was earned, and sets `earned` on the note that sets the fee (OBS-133)", async () => {
    const POSTER = "Projects/Work/Poster/Poster.md", PRINT = "Projects/Work/Poster/Print/Print.md";
    const idx = tr.makeIndex([
        { path: POSTER, tags: ["project"], props: { rate: 1200, rate_type: "flat", Earned: "2026-09-01" } },
        { path: PRINT, tags: ["project"] },
        ...INDEX_NOTES,
    ]);
    const notices = [], titles = [], written = [];
    const fm = { rate: 1200, rate_type: "flat", Earned: "2026-09-01" };
    const DatePrompt = {
        open(title, onPick) {
            titles.push(title);
            const modal = { contentEl: { querySelector: () => null }, close() { this.onClose?.(); } };
            setTimeout(() => onPick({ date: "2026-09-30" }, modal), 0);
            return modal;
        },
    };
    // The metadata cache reads a note when its frontmatter changes; Invoice waits for that before refreshing
    const listeners = new Set(), events = [];
    const app = {
        vault: { getFileByPath: (p) => ({ path: p }) },
        fileManager: { processFrontMatter: async (file, fn) => { fn(fm); written.push(file.path); events.push("written"); for (const l of listeners) l(file); } },
        metadataCache: { on: (name, fn) => { listeners.add(fn); return fn; }, offref: (fn) => { listeners.delete(fn); events.push("read"); } },
    };
    let pick = null;
    const FuzzySuggestModal = class { constructor() {} setPlaceholder() {} open() { if (pick !== null) this.onChooseItem(this.getItems()[pick]); this.onClose(); } };
    const context = vm.createContext({ app, setTimeout, clearTimeout, window: { moment: () => ({ format: () => "2026-10-11" }) },
        Notice: class { constructor(t) { notices.push(t); events.push("notice"); } },
        customJS: { DatePrompt, obsidian: { Platform: { isDesktop: false }, FuzzySuggestModal } } });
    const invoice = new (vm.runInContext(`${fs.readFileSync(new URL("../CustomJS/invoice.js", here), "utf8")}\n;Invoice`, context))();
    await invoice.create(POSTER, tr, billing, idx);
    assert.deepEqual(written, [POSTER]);
    assert.deepEqual(plain(fm), { rate: 1200, rate_type: "flat", Earned: "2026-09-30" }, "set where it's already spelled, not added twice");
    assert.deepEqual(titles, ["Poster's $1,200 fee: earned on (now 9/1/26)"]);
    assert.equal(notices[0], "Poster: its $1,200 fee counts as earned on 9/30/26");
    assert.deepEqual(events.slice(0, 3), ["written", "read", "notice"], "the report waits for the cache to read the new date");
    // A sub-project is part of its parent's fee, so it's sent there; nothing is asked or written
    await invoice.create(PRINT, tr, billing, idx);
    assert.equal(notices.at(-1), "Print is part of Poster's flat fee; run Invoice on Poster");
    assert.deepEqual([titles.length, written.length], [1, 1]);
    assert.equal(invoice.feeHolder(PRINT, tr, idx), POSTER);
    assert.equal(invoice.feeHolder(WEB, tr, idx), null, "an hourly project has no fee");
    // A day still to come is fine: a fee invoiced ahead
    const later = { ...DatePrompt, open(title, onPick) { const modal = { contentEl: { querySelector: () => null }, close() { this.onClose?.(); } }; setTimeout(() => onPick({ date: "2027-02-01" }, modal), 0); return modal; } };
    context.customJS.DatePrompt = later;
    await invoice.create(POSTER, tr, billing, idx);
    assert.equal(fm.Earned, "2027-02-01");
    assert.ok(notices.includes("Poster: its $1,200 fee counts as earned on 2/1/27"));
    assert.equal(written.length, 2);
    context.customJS.DatePrompt = DatePrompt;
    // A flat project that invoices its sub-projects' time asks which; Esc does nothing
    const both = tr.makeIndex([{ path: POSTER, tags: ["project"], props: { rate: 1200, rate_type: "flat", include_subprojects: true } }, ...INDEX_NOTES]);
    pick = null;
    await invoice.create(POSTER, tr, billing, both);
    assert.deepEqual([titles.length, written.length], [1, 2], "dismissed: nothing asked or written");
    pick = 0;
    await invoice.create(POSTER, tr, billing, both);
    assert.deepEqual([titles.length, written.length], [2, 3], "the first choice records the earned day");
});

// ------------------------------------------------------------------ Billed entries folded (OBS-145)

// Invoice with a stand-in for Obsidian: folds as the fold manager keeps them, and the notices shown
const withApp = ({ saved = null, view = null } = {}) => {
    const notices = [], saves = [];
    const app = {
        workspace: { getLeavesOfType: () => (view ? [{ view }] : []) },
        foldManager: { load: () => saved, save: async (file, info) => { saves.push(info); } },
    };
    const context = vm.createContext({ app, Notice: class { constructor(text) { notices.push(text); } }, setTimeout });
    const src = fs.readFileSync(new URL("../CustomJS/invoice.js", here), "utf8");
    return { invoice: new (vm.runInContext(`${src}\n;Invoice`, context))(), notices, saves };
};

test("billedFold: from the Billed entries heading to its last line, 0-based, as Obsidian keeps folds (OBS-145)", () => {
    const text = inv.noteText(DATA(), tr, billing);
    const lines = text.split("\n");
    const fold = inv.billedFold(text, billing);
    assert.equal(lines[fold.from], "## Billed entries");
    assert.equal(fold.to, lines.length - 2, "the last row; the note ends with a newline");
    assert.ok(lines[fold.to].startsWith("|  | "));
    assert.deepEqual(plain(inv.billedFold(text.replace(/\n/g, "\r\n"), billing)), plain(fold), "the same with CRLF");
    assert.equal(inv.billedFold("# Invoice No. 1\n\n## Billable hours\n", billing), null);
    assert.equal(inv.billedFold("## Billed entries\n\n", billing), null, "nothing under it to fold");
});

test("foldBilled: a new invoice opens with Billed entries folded, keeping the folded properties (OBS-145)", async () => {
    const text = inv.noteText(DATA(), tr, billing);
    const fold = inv.billedFold(text, billing);
    const lines = text.split("\n").length;
    const fresh = withApp();
    await fresh.invoice.foldBilled({ path: "x.md" }, text, billing);
    assert.deepEqual(plain(fresh.saves), plain([{ folds: [fold], lines }]));
    // Saved for an older text: only the folded properties carry over
    const old = withApp({ saved: { folds: [{ from: 0, to: 0 }, { from: 30, to: 40 }], lines: lines - 3 } });
    await old.invoice.foldBilled({ path: "x.md" }, text, billing);
    assert.deepEqual(plain(old.saves), plain([{ folds: [{ from: 0, to: 0 }, fold], lines }]));
    // A closed note's saved folds were for its old text, even at the same line count: only the properties stay
    const same = withApp({ saved: { folds: [{ from: 0, to: 0 }, { from: 20, to: 22 }], lines } });
    await same.invoice.foldBilled({ path: "x.md" }, text, billing);
    assert.deepEqual(plain(same.saves), plain([{ folds: [{ from: 0, to: 0 }, fold], lines }]));
    // An open note's folds, as its editor moved them with the write, all stay
    const file = { path: "x.md" };
    const view = { file, editor: {}, currentMode: { getFoldInfo: () => ({ folds: [{ from: 20, to: 22 }], lines }), applyFoldInfo() {} } };
    const open = withApp({ view });
    await open.invoice.foldBilled(file, text, billing);
    assert.deepEqual(plain(open.saves), plain([{ folds: [{ from: 20, to: 22 }, fold], lines }]));
});

// ------------------------------------------------------------------ nothing to bill (OBS-149)

test("Nothing unbilled says when the next unbilled time is, or that there's none (OBS-149)", () => {
    const m = tr.attachBilling(model, [], index, billing);
    const say = (through) => {
        const { invoice, notices } = withApp();
        const sel = billing.select(m, tr, index, { project: WEB, through, ledger: m.billing.ledger });
        assert.equal(invoice.billable(WEB, m, sel, tr, billing, through), false);
        return notices;
    };
    assert.deepEqual(plain(say("2026-08-31")), ["Nothing unbilled on Harbor Web through 8/31. The next unbilled time is on 9/1."]);
    // All of it billed: on an invoice, the time through 9/2 is no longer unbilled
    const all = { path: "Reference/Invoices/1001-HBR.md", props: { invoice_status: "sent", parent: "[[Harbor Web]]" },
        text: ["---", "---", ...billing.billedLines(billing.snapshot(m.entries.filter((e) => e.project === WEB || e.project === PHOTO), m, tr), tr, (p) => tr.basename(p))].join("\n") };
    const billed = tr.attachBilling(tr.build([
        day("2026-09-01", "- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass\n- [x] Review [[Harbor Web|⭕]]\n\t- 3:00pm - 3:20pm"),
        day("2026-09-02", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am\n- [x] Shoot [[Harbor Photos|⭕]]\n\t- 1:00pm - 2:00pm"),
    ], index), [all], index, billing);
    const { invoice, notices } = withApp();
    const sel = billing.select(billed, tr, index, { project: WEB, through: "2026-09-30", ledger: billed.billing.ledger });
    assert.equal(invoice.billable(WEB, billed, sel, tr, billing, "2026-09-30"), false);
    assert.deepEqual(plain(notices), ["Nothing unbilled on Harbor Web through 9/30. There's none after it either."]);
});

test("writeKeepingFold: a closed invoice's saved folds move with a write that adds lines above them (OBS-145)", async () => {
    const before = inv.noteText(DATA(), tr, billing);
    const fold = inv.billedFold(before, billing);
    const lines = before.split("\n").length;
    const title = before.split("\n").indexOf("# Invoice No. 1001-HBR");
    const { invoice, saves } = withApp({ saved: { folds: [{ from: 0, to: 0 }, { from: title, to: title + 5 }, fold], lines } });
    invoice.write = async () => true;
    const after = invoice.placeCheck(before, invoice.checkLines("Changed since invoiced", ["a", "b"]));
    assert.equal(await invoice.writeKeepingFold({ path: "x.md" }, before, after, tr, billing), true);
    const moved = inv.billedFold(after, billing);
    const delta = after.split("\n").length - lines;
    assert.equal(moved.from - fold.from, delta);
    // The check block goes in at the start of the title's line: a fold there moves down with it
    assert.equal(after.split("\n")[title + delta], "# Invoice No. 1001-HBR");
    assert.deepEqual(plain(saves), plain([{ folds: [{ from: 0, to: 0 }, { from: title + delta, to: title + 5 + delta }, moved], lines: after.split("\n").length }]));
    // Saved for another text: left alone, as Obsidian would
    const stale = withApp({ saved: { folds: [fold], lines: lines + 2 } });
    stale.invoice.write = async () => true;
    await stale.invoice.writeKeepingFold({ path: "x.md" }, before, after, tr, billing);
    assert.deepEqual(plain(stale.saves), []);
});


// ------------------------------------------------------------------ the project picker (OBS-192)

test("pickProject: lists the projects with unbilled time; a leftover billed_through changes nothing (OBS-192)", async () => {
    const items = [];
    // Esc as soon as it opens: the list is what it offered
    const FuzzySuggestModal = class { constructor() {} setPlaceholder() {} open() { items.push(...this.getItems()); this.onClose(); } };
    const context = vm.createContext({ app: {}, setTimeout, Notice: class { hide() {} }, customJS: { obsidian: { FuzzySuggestModal } } });
    const invoice = new (vm.runInContext(`${fs.readFileSync(new URL("../CustomJS/invoice.js", here), "utf8")}\n;Invoice`, context))();
    for (const value of [undefined, "2026-09-02", "soon"]) {
        const idx = tr.makeIndex(INDEX_NOTES.map((n) => (n.path === WEB && value ? { ...n, props: { ...n.props, billed_through: value } } : n)));
        const m = tr.attachBilling(tr.build([
            day("2026-09-01", "- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass"),
            day("2026-09-02", "- [x] Shoot [[Harbor Photos|⭕]]\n\t- 1:00pm - 2:00pm"),
        ], idx), [], idx, billing);
        const current = Object.assign(Object.create(tr), { currentModel: async () => ({ model: m }) });
        items.length = 0;
        assert.equal(await invoice.pickProject(current, billing, idx), null, "nothing picked");
        assert.deepEqual(plain(items), [PHOTO, WEB], String(value));
    }
});

test("pickProject: an archived project with unbilled time isn't offered (OBS-213)", async () => {
    const items = [];
    const FuzzySuggestModal = class { constructor() {} setPlaceholder() {} open() { items.push(...this.getItems()); this.onClose(); } };
    const context = vm.createContext({ app: {}, setTimeout, Notice: class { hide() {} }, customJS: { obsidian: { FuzzySuggestModal } } });
    const invoice = new (vm.runInContext(`${fs.readFileSync(new URL("../CustomJS/invoice.js", here), "utf8")}\n;Invoice`, context))();
    const ARCH = "Archive/Work/Harbor Stills/Harbor Stills.md";
    const idx = tr.makeIndex([...INDEX_NOTES, { path: ARCH, tags: ["project"], props: { rate: 100, rate_type: "hourly" } }]);
    const m = tr.attachBilling(tr.build([
        day("2026-09-01", "- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass"),
        day("2026-09-02", "- [x] Stills [[Harbor Stills|⭕]]\n\t- 1:00pm - 2:00pm"),
    ], idx), [], idx, billing);
    assert.ok(m.entries.some((e) => e.project === ARCH), "its time is in the model");
    const current = Object.assign(Object.create(tr), { currentModel: async () => ({ model: m }) });
    assert.equal(await invoice.pickProject(current, billing, idx), null, "nothing picked");
    assert.deepEqual(plain(items), [WEB]);
});

test("pickProject: a live project under an archived parent is offered on its own, never through the parent (OBS-213)", async () => {
    const items = [];
    const FuzzySuggestModal = class { constructor() {} setPlaceholder() {} open() { items.push(...this.getItems()); this.onClose(); } };
    const context = vm.createContext({ app: {}, setTimeout, Notice: class { hide() {} }, customJS: { obsidian: { FuzzySuggestModal } } });
    const invoice = new (vm.runInContext(`${fs.readFileSync(new URL("../CustomJS/invoice.js", here), "utf8")}\n;Invoice`, context))();
    const OLD = "Archive/Work/Old Client/Old Client.md", KID = "Projects/Work/Kid/Kid.md";
    const idx = tr.makeIndex([...INDEX_NOTES,
        { path: OLD, tags: ["project"], props: { rate: 100, rate_type: "hourly", include_subprojects: true } },
        { path: KID, tags: ["project"], parent: "[[Old Client]]", props: { rate: 100, rate_type: "hourly" } }]);
    const m = tr.attachBilling(tr.build([day("2026-09-01", "- [x] Kid work [[Kid|⭕]]\n\t- 1:00pm - 2:00pm")], idx), [], idx, billing);
    assert.equal(m.parent.get(KID), null, "its chain is cut where it enters Archive");
    const current = Object.assign(Object.create(tr), { currentModel: async () => ({ model: m }) });
    assert.equal(await invoice.pickProject(current, billing, idx), null, "nothing picked");
    assert.deepEqual(plain(items), [KID]);
    assert.equal(billing.select(m, tr, idx, { project: OLD, through: "2026-09-30", ledger: billing.ledger([]) }).entries.length, 0, "the archived parent bills none of it");
});
