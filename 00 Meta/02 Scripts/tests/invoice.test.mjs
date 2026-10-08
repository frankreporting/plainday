// Tests for CustomJS/invoice.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
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

const DAYS = "30 Reference/36 Planner/days";
const WEB = "Projects/Work/Harbor Web/Harbor Web.md";
const PHOTO = "Projects/Work/Harbor Web/Harbor Photos/Harbor Photos.md";
const CLIENT = "30 Reference/34 Entities/Harbor Co.md";
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
    area: "[[Harbor Web|⭕.Work.Harbor Web]]", clientLink: "Harbor Co",
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
        'area: "[[Harbor Web|⭕.Work.Harbor Web]]"',
        "invoice_status: draft",
        'number: "1001-HBR"',
        'client: "[[Harbor Co]]"',
        "invoice_date: 2026-09-03",
        "period_start: 2026-09-01",
        "period_end: 2026-09-02",
        "hours: 4.00",
        "total: 340.00",
        "paid:",
        "---",
    ].join("\n"));
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
    assert.equal(lines[at("> [!pm-billed]- Billed entries") + 1], "> | Date | Start | End | Minutes | Hours | Rate | Project | Task | Note |");
});

test("noteText: nothing printed is a link", () => {
    const text = inv.noteText(DATA({ check: inv.checkLines("Before sending", ["[[2026-09-01|9/1/26]] line 3: x"]) }), tr, billing);
    const printed = text.slice(text.indexOf("# Invoice No."), text.indexOf("> [!pm-billed]"));
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
    assert.equal(s({ folder: " /30 Reference/Invoices/ " }).folder, "30 Reference/Invoices");
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

test("readClient: the project's client, else its parent's; the code upper-cased; errors say what to do", () => {
    assert.deepEqual(plain(inv.readClient(PHOTO, tr, index)), { path: CLIENT, name: "Harbor Co", code: "HBR", billingName: "Harbor Co", address: ["1 Dock Street", "Port Town, ST 00000"] });
    const none = tr.makeIndex([{ path: "P/Solo/Solo.md", tags: ["project"], props: {} }]);
    assert.match(inv.readClient("P/Solo/Solo.md", tr, none).error, /has no `client`/);
    const missing = tr.makeIndex([{ path: "P/Solo/Solo.md", tags: ["project"], props: { client: "[[Nobody Yet]]" } }]);
    assert.match(inv.readClient("P/Solo/Solo.md", tr, missing).error, /isn't a note yet/);
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
