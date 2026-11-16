// Tests for plugin/src/shared/settings.js (OBS-281): Plainday's settings, their defaults, what reads
// and what doesn't, the one-time read of the old settings notes, and the copy for another device.
// Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// Every name, address and number here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { classScript } from "../../../plugin/classShape.mjs";

const load = (file, name, context = vm.createContext({})) => vm.runInContext(classScript(file) + `\n;${name}`, context);
const billing = new (load("billing.js", "Billing"))();
const Settings = load("settings.js", "Settings");
const settings = new Settings();
const plain = (x) => JSON.parse(JSON.stringify(x));
const DEFAULTS = {
    invoices: { name: "", address: [], terms: "", paymentNote: "", folder: "", lastNumber: 1000 },
    tables: { freezeRows: 0, freezeColumns: 0 },
    editor: { listCursor: true },
};
const JUNIPER = {
    invoices: { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"], terms: "Net 30",
        paymentNote: "Please pay by bank transfer within 30 days.", folder: "Reference/Invoices", lastNumber: 1001 },
    tables: { freezeRows: 0, freezeColumns: 0 },
    editor: { listCursor: true },
};

// ------------------------------------------------------------------ defaults and what reads

test("defaults: a new vault's settings, the first invoice 1001 (OBS-281)", () => {
    assert.deepEqual(plain(settings.defaults()), DEFAULTS);
    assert.deepEqual(plain(new Settings().get()), DEFAULTS, "until they load");
    assert.notEqual(settings.defaults().invoices.address, settings.defaults().invoices.address, "a fresh copy each time");
});

test("normalize: each value that reads, else its default", () => {
    assert.deepEqual(plain(settings.normalize({}, billing)), DEFAULTS);
    assert.deepEqual(plain(settings.normalize(null, billing)), DEFAULTS);
    assert.deepEqual(plain(settings.normalize("not settings", billing)), DEFAULTS);
    assert.deepEqual(plain(settings.normalize(JUNIPER, billing)), JUNIPER);
    const n = settings.normalize({
        invoices: { name: "  Juniper Hale ", address: "418 Larkspur Lane\n\n Maple Falls, ST 00000 ", terms: 30, paymentNote: "\nLine one  \nLine two\n",
            folder: " /Business//Invoices/ ", lastNumber: "1033" },
        tables: { freezeRows: "2", freezeColumns: 12 },
        editor: { listCursor: false },
    }, billing);
    assert.deepEqual(plain(n), {
        invoices: { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"], terms: "30", paymentNote: "Line one\nLine two",
            folder: "Business/Invoices", lastNumber: 1033 },
        tables: { freezeRows: 2, freezeColumns: 9 },
        editor: { listCursor: false },
    });
    for (const folder of ["../x", "Config/Invoices", "Archive", ".hidden", "a\nb", 7, ["Invoices"]]) {
        assert.equal(settings.normalize({ invoices: { folder } }, billing).invoices.folder, "", String(folder));
    }
    for (const lastNumber of [-1, 1.5, "abc", "1,033", 1000000, true, null, ""]) {
        assert.equal(settings.normalize({ invoices: { lastNumber } }, billing).invoices.lastNumber, 1000, String(lastNumber));
    }
    assert.equal(settings.normalize({ invoices: { lastNumber: 0 } }, billing).invoices.lastNumber, 0);
    assert.equal(settings.normalize({ invoices: { lastNumber: 999999 } }, billing).invoices.lastNumber, 999999);
    for (const v of [-1, 1.5, "a lot", true]) assert.equal(settings.normalize({ tables: { freezeRows: v } }, billing).tables.freezeRows, 0, String(v));
    for (const v of ["no", 0, null]) assert.equal(settings.normalize({ editor: { listCursor: v } }, billing).editor.listCursor, true, String(v));
});

test("the demo's data file reads as it's written, so loading and saving it changes nothing", () => {
    const text = fs.readFileSync(new URL("../../../.obsidian/plugins/plainday/data.json", import.meta.url), "utf8");
    const normalized = settings.normalize(JSON.parse(text), billing);
    assert.deepEqual(plain(normalized), JUNIPER, "the demo's invented details");
    // Obsidian's saveData writes JSON.stringify(data, null, 2)
    assert.equal(JSON.stringify(normalized, null, 2), text);
});

// ------------------------------------------------------------------ the old settings notes

const INVOICE_NOTE = { props: { id: 2026091210000000, tags: null, name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"],
    terms: "Net 30", payment_note: "Please pay by bank transfer within 30 days.", folder: "Reference/Invoices", last_number: 1001 } };

test("fromOldNotes: Invoice Settings and Table Settings, as the notes held them", () => {
    const r = settings.fromOldNotes({ invoice: INVOICE_NOTE, table: { props: { freeze_rows: 1, freeze_columns: "1" } } }, billing);
    assert.deepEqual(plain(r), { settings: { ...JUNIPER, tables: { freezeRows: 1, freezeColumns: 1 } }, read: ["invoice", "table"], bad: [] });
    // the address as lines, numbers as text, the freeze blank
    const lines = settings.fromOldNotes({ invoice: { props: { name: "J", address: "a\nb", last_number: "1033" } }, table: { props: { freeze_rows: null, freeze_columns: "" } } }, billing);
    assert.deepEqual(plain(lines.settings.invoices.address), ["a", "b"]);
    assert.equal(lines.settings.invoices.lastNumber, 1033);
    assert.deepEqual(plain(lines.settings.tables), { freezeRows: 0, freezeColumns: 0 });
    assert.deepEqual(plain(lines.bad), []);
});

test("fromOldNotes: no notes reads nothing; a blank folder or number starts from the defaults, unnamed", () => {
    assert.deepEqual(plain(settings.fromOldNotes({}, billing)), { settings: DEFAULTS, read: [], bad: [] });
    const blank = settings.fromOldNotes({ invoice: { props: { name: "J", folder: null, last_number: null } } }, billing);
    assert.deepEqual(plain([blank.settings.invoices.folder, blank.settings.invoices.lastNumber, blank.bad, blank.read]), ["", 1000, [], ["invoice"]]);
});

test("fromOldNotes: a value that doesn't read keeps its default, and is named", () => {
    const r = settings.fromOldNotes({
        invoice: { props: { ...INVOICE_NOTE.props, folder: "../x", last_number: "abc" } },
        table: { props: { freeze_rows: "a lot", freeze_columns: 2 } },
    }, billing);
    assert.equal(r.settings.invoices.folder, "");
    assert.equal(r.settings.invoices.lastNumber, 1000);
    assert.equal(r.settings.invoices.name, "Juniper Hale", "the rest still reads");
    assert.deepEqual(plain(r.settings.tables), { freezeRows: 0, freezeColumns: 2 });
    assert.deepEqual(plain(r.bad), ["`folder` in Invoice Settings (../x)", "`last_number` in Invoice Settings (abc)", "`freeze_rows` in Table Settings (a lot)"]);
    const unreadable = settings.fromOldNotes({ invoice: { error: "bad indentation" }, table: { error: "bad" } }, billing);
    assert.deepEqual(plain(unreadable), { settings: DEFAULTS, read: ["invoice", "table"], bad: ["Invoice Settings' properties", "Table Settings' properties"] });
});

test("movedNotice: what moved, that the notes can go, and what didn't read", () => {
    assert.equal(settings.movedNotice({ read: [], bad: [] }), null);
    assert.equal(settings.movedNotice({ read: ["invoice", "table"], bad: [] }),
        "Plainday moved your invoice and table settings into Settings → Plainday. It no longer reads Invoice Settings or Table Settings; you can delete them.");
    assert.equal(settings.movedNotice({ read: ["table"], bad: [] }),
        "Plainday moved your table settings into Settings → Plainday. It no longer reads Table Settings; you can delete it.");
    assert.equal(settings.movedNotice({ read: ["invoice"], bad: ["`folder` in Invoice Settings (../x)"] }),
        "Plainday moved your invoice settings into Settings → Plainday. It no longer reads Invoice Settings; you can delete it.\n\n"
        + "This didn't read, so it starts from the default: `folder` in Invoice Settings (../x).");
    assert.match(settings.movedNotice({ read: ["invoice"], bad: ["a", "b"] }), /These didn't read, so they start from the default: a, b\.$/);
});

// ------------------------------------------------------------------ another device

test("copyText and readCopy: one block, read back whole; anything else isn't a copy", () => {
    const text = settings.copyText(JUNIPER);
    assert.ok(!text.includes("\n"), "one line, so nothing on the way breaks it");
    const read = settings.readCopy(text, billing);
    assert.deepEqual(plain(read.settings), JUNIPER);
    assert.equal(read.holds, "Invoices, tables and the editor switch");
    assert.deepEqual(plain(settings.readCopy(`  ${text}\n`, billing).settings), JUNIPER, "spaces around it are fine");
    for (const t of ["{}", '{"invoices":{}}', "[1]", "not json", "null", '"plainday-settings"']) {
        assert.match(settings.readCopy(t, billing).error, /^That isn't a copy of Plainday's settings/, t);
    }
    assert.equal(settings.readCopy("  ", billing).error, "Paste the copy from your other device here.");
    // a copy is read as any settings are: a bad value becomes its default
    const odd = settings.readCopy(JSON.stringify({ "plainday-settings": 1, invoices: { name: "J", folder: "../x" } }), billing);
    assert.deepEqual(plain([odd.settings.invoices.name, odd.settings.invoices.folder]), ["J", ""]);
});

test("pasted: the copy's settings, with the higher last invoice number of the two", () => {
    const here = { ...DEFAULTS, invoices: { ...DEFAULTS.invoices, name: "Old name", lastNumber: 1004 } };
    const after = settings.pasted(JUNIPER, here);
    assert.equal(after.invoices.name, "Juniper Hale");
    assert.equal(after.invoices.lastNumber, 1004, "this device's higher number stays");
    assert.equal(settings.pasted({ ...JUNIPER, invoices: { ...JUNIPER.invoices, lastNumber: 1010 } }, here).invoices.lastNumber, 1010, "the copy's higher number wins");
    assert.equal(JUNIPER.invoices.lastNumber, 1001, "the copy itself isn't changed");
});

// ------------------------------------------------------------------ the data file and the first load

// Settings in a stand-in for Plainday: loadData gives `stored` (null for none, as Obsidian does, and
// undefined with `unreadable`, as Obsidian gives for a file that doesn't parse), saveData records, the
// vault holds `notes` as text, and the notices shown are kept
function withPlugin({ stored = null, notes = {}, unreadable = false } = {}) {
    const saves = [], notices = [], reads = [];
    let listCursorRuns = 0;
    const plugin = {
        manifest: { dir: ".obsidian/plugins/plainday" },
        loadData: async () => (unreadable ? undefined : stored === null ? null : JSON.parse(JSON.stringify(stored))),
        saveData: async (d) => { saves.push(plain(d)); },
    };
    const app = {
        vault: {
            getFileByPath: (p) => (p in notes ? { path: p } : null),
            read: async (f) => { reads.push(f.path); return notes[f.path]; },
        },
    };
    const context = vm.createContext({
        app,
        Notice: class { constructor(text) { notices.push(text); } },
        // As Obsidian's: the frontmatter between the first two ---, and YAML enough for these notes
        getFrontMatterInfo: (text) => { const m = String(text).match(/^---\n([\s\S]*?)\n---/); return { exists: !!m, frontmatter: m ? m[1] : "" }; },
        parseYaml: (yaml) => {
            const out = {};
            let list = null;
            for (const line of yaml.split("\n")) {
                const item = line.match(/^ {2}- (.*)$/);
                if (item && list) { out[list].push(item[1]); continue; }
                const m = line.match(/^([\w-]+):\s*(.*)$/);
                if (!m) throw new Error(`can't read ${line}`);
                list = m[2] === "" ? m[1] : null;
                out[m[1]] = m[2] === "" ? (list ? [] : null) : /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
            }
            for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && !v.length) out[k] = null;
            return out;
        },
        plainday: { plugin, Billing: billing, ListCursor: { invoke: async () => { listCursorRuns++; } } },
    });
    const s = new (load("settings.js", "Settings", context))();
    return { s, saves, notices, reads, runs: () => listCursorRuns };
}
const INVOICE_TEXT = "---\nid: 2026091210000000\ntags:\nname: Juniper Hale\naddress:\n  - 418 Larkspur Lane\n  - Maple Falls, ST 00000\nterms: Net 30\n"
    + "payment_note: Please pay by bank transfer within 30 days.\nfolder: Reference/Invoices\nlast_number: 1001\n---\nYour details for invoices.\n";
const TABLE_TEXT = "---\nid: 2026110312000000\ntags:\nfreeze_rows: 1\nfreeze_columns: 1\n---\nHow the tables come out.\n";

test("load: the saved settings, normalized; the defaults on a device with none saved", async () => {
    const none = withPlugin();
    await none.s.load();
    assert.deepEqual(plain(none.s.get()), DEFAULTS);
    assert.equal(none.s.saved, false);
    const some = withPlugin({ stored: { invoices: { name: "Juniper Hale", folder: "../x" } } });
    await some.s.load();
    assert.equal(some.s.saved, true);
    assert.deepEqual(plain([some.s.get().invoices.name, some.s.get().invoices.folder]), ["Juniper Hale", ""]);
    assert.deepEqual(some.saves, [], "loading never writes");
});

test("readOldNotes: on a device with none saved, the old notes once, saved, and one notice; the notes stay", async () => {
    const f = withPlugin({ notes: { "Config/Invoice Settings.md": INVOICE_TEXT, "Config/Table Settings.md": TABLE_TEXT } });
    await f.s.load();
    await f.s.readOldNotes();
    assert.deepEqual(f.saves, [{ ...JUNIPER, tables: { freezeRows: 1, freezeColumns: 1 } }]);
    assert.deepEqual(plain(f.s.get()), f.saves[0]);
    assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /^Plainday moved your invoice and table settings into Settings → Plainday\. It no longer reads Invoice Settings or Table Settings; you can delete them\.$/);
    // never again: a reload, or a later load, finds settings saved
    await f.s.readOldNotes();
    assert.deepEqual([f.saves.length, f.notices.length, f.reads.length], [1, 1, 2]);
});

test("readOldNotes: a device with settings saved reads nothing; one with no notes saves the defaults, silently", async () => {
    const saved = withPlugin({ stored: JUNIPER, notes: { "Config/Invoice Settings.md": INVOICE_TEXT.replace("Juniper Hale", "Someone Else") } });
    await saved.s.load();
    await saved.s.readOldNotes();
    assert.deepEqual([saved.saves, saved.notices, saved.reads], [[], [], []]);
    assert.equal(saved.s.get().invoices.name, "Juniper Hale", "the note's name changes nothing");
    const fresh = withPlugin();
    await fresh.s.load();
    await fresh.s.readOldNotes();
    assert.deepEqual([fresh.saves, fresh.notices], [[DEFAULTS], []]);
});

test("a data file that doesn't read: the defaults, a notice, and neither the old notes nor a save over it", async () => {
    const f = withPlugin({ unreadable: true, notes: { "Config/Invoice Settings.md": INVOICE_TEXT } });
    await f.s.load();
    assert.deepEqual(plain(f.s.get()), DEFAULTS);
    assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /^Plainday couldn't read its settings file, \.obsidian\/plugins\/plainday\/data\.json, so it's using the defaults\. It leaves the file as it is until you change a setting/);
    await f.s.readOldNotes();
    assert.deepEqual([f.saves, f.reads, f.notices.length], [[], [], 1], "the old notes aren't read over it, and nothing is saved");
    // A change you make saves, as you asked
    await f.s.set("invoices", { name: "Juniper Hale" });
    assert.equal(f.saves.length, 1);
    assert.equal(f.s.unreadable, false);
});

test("readOldNotes: a bad value is named in the notice; properties that don't read leave the defaults", async () => {
    const bad = withPlugin({ notes: { "Config/Invoice Settings.md": INVOICE_TEXT.replace("folder: Reference/Invoices", "folder: ../x") } });
    await bad.s.load();
    await bad.s.readOldNotes();
    assert.equal(bad.s.get().invoices.folder, "");
    assert.equal(bad.s.get().invoices.name, "Juniper Hale");
    assert.match(bad.notices[0], /^Plainday moved your invoice settings into Settings → Plainday\. It no longer reads Invoice Settings; you can delete it\.\n\nThis didn't read, so it starts from the default: `folder` in Invoice Settings \(\.\.\/x\)\.$/);
    const broken = withPlugin({ notes: { "Config/Table Settings.md": "---\nfreeze_rows 1\n---\n" } });
    await broken.s.load();
    await broken.s.readOldNotes();
    assert.deepEqual(plain(broken.s.get().tables), DEFAULTS.tables);
    assert.match(broken.notices[0], /`?Table Settings' properties/);
});

test("raiseLastNumber never lowers the number; set saves one section; replaceWith keeps the higher number and applies the editor switch", async () => {
    const f = withPlugin({ stored: JUNIPER });
    await f.s.load();
    await f.s.raiseLastNumber(1000);
    assert.deepEqual(f.saves, [], "lower: nothing written");
    await f.s.raiseLastNumber(1002);
    assert.equal(f.s.get().invoices.lastNumber, 1002);
    assert.equal(f.saves.at(-1).invoices.lastNumber, 1002);
    await f.s.set("tables", { freezeRows: 1 });
    assert.deepEqual(f.saves.at(-1).tables, { freezeRows: 1, freezeColumns: 0 });
    await f.s.replaceWith({ ...DEFAULTS, invoices: { ...DEFAULTS.invoices, name: "From the phone", lastNumber: 1001 }, editor: { listCursor: false } });
    assert.deepEqual(plain([f.s.get().invoices.name, f.s.get().invoices.lastNumber, f.s.get().editor.listCursor]), ["From the phone", 1002, false]);
    assert.deepEqual(f.saves.at(-1), plain(f.s.get()));
    assert.equal(f.runs(), 1, "ListCursor follows the pasted switch");
});
