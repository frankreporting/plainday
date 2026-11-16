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
    invoices: { name: "", address: [], terms: "", paymentNote: "", folder: "", firstNumber: 1001, lastNumber: 1000 },
    tables: { freezeRows: 0, freezeColumns: 0 },
    editor: { listCursor: true },
};
const JUNIPER = {
    invoices: { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"], terms: "Net 30",
        paymentNote: "Please pay by bank transfer within 30 days.", folder: "Reference/Invoices", firstNumber: 1001, lastNumber: 1001 },
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
            folder: " /Business//Invoices/ ", firstNumber: "1020", lastNumber: "1033" },
        tables: { freezeRows: "2", freezeColumns: 12 },
        editor: { listCursor: false },
    }, billing);
    assert.deepEqual(plain(n), {
        invoices: { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"], terms: "30", paymentNote: "Line one\nLine two",
            folder: "Business/Invoices", firstNumber: 1020, lastNumber: 1033 },
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
    // The first invoice number runs from 1: 0 would leave the last number given at -1
    for (const firstNumber of [0, -1, 1.5, "abc", 1000000, true, null, ""]) {
        assert.equal(settings.normalize({ invoices: { firstNumber } }, billing).invoices.firstNumber, 1001, String(firstNumber));
    }
    assert.equal(settings.normalize({ invoices: { firstNumber: "1" } }, billing).invoices.firstNumber, 1);
    assert.deepEqual(plain(settings.firstNumberOf("0")), { number: null, error: "isn't a whole number from 1 to 999999" });
    assert.deepEqual(plain(settings.firstNumberOf("")), { number: null, error: null }, "blank isn't a number, and isn't an error either");
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
    assert.deepEqual(plain(r), { settings: { ...JUNIPER, tables: { freezeRows: 1, freezeColumns: 1 } }, read: ["invoice", "table"], bad: [], capped: [] });
    // the address as lines, numbers as text, the freeze blank
    const lines = settings.fromOldNotes({ invoice: { props: { name: "J", address: "a\nb", last_number: "1033" } }, table: { props: { freeze_rows: null, freeze_columns: "" } } }, billing);
    assert.deepEqual(plain(lines.settings.invoices.address), ["a", "b"]);
    assert.equal(lines.settings.invoices.lastNumber, 1033);
    assert.deepEqual(plain(lines.settings.tables), { freezeRows: 0, freezeColumns: 0 });
    assert.deepEqual(plain(lines.bad), []);
    // a property spelled in another case, as the old notes were read
    const cased = settings.fromOldNotes({ invoice: { props: { Name: "Juniper Hale", Last_Number: 1033 } }, table: { props: { Freeze_Rows: 1 } } }, billing);
    assert.deepEqual(plain([cased.settings.invoices.name, cased.settings.invoices.lastNumber, cased.settings.tables.freezeRows]), ["Juniper Hale", 1033, 1]);
});

test("fromOldNotes: a freeze over 9 is 9, and the notice says so", () => {
    const r = settings.fromOldNotes({ table: { props: { freeze_rows: 12, freeze_columns: 1 } } }, billing);
    assert.deepEqual(plain([r.settings.tables, r.bad, r.capped]), [{ freezeRows: 9, freezeColumns: 1 }, [], ["`freeze_rows` in Table Settings (12)"]]);
    assert.equal(settings.movedNotice(r),
        "Plainday moved your table settings into Settings → Plainday. It no longer reads Table Settings; you can delete it.\n\n"
        + "Plainday freezes at most 9 rows or columns, so this is 9 now: `freeze_rows` in Table Settings (12).");
});

test("fromOldNotes: no notes reads nothing; a blank folder or number starts from the defaults, unnamed", () => {
    assert.deepEqual(plain(settings.fromOldNotes({}, billing)), { settings: DEFAULTS, read: [], bad: [], capped: [] });
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
    assert.deepEqual(plain(unreadable), { settings: DEFAULTS, read: ["invoice", "table"], bad: ["Invoice Settings' properties", "Table Settings' properties"], capped: [] });
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
    assert.equal(read.holds, "invoices (Juniper Hale, invoices in Reference/Invoices, first invoice number 1001), tables (freeze 0 rows and 0 columns) and the editor switch (on)");
    assert.equal(settings.holds(DEFAULTS), "invoices (no name, no invoice folder, first invoice number 1001), tables (freeze 0 rows and 0 columns) and the editor switch (on)");
    assert.deepEqual(plain(settings.readCopy(`  ${text}\n`, billing).settings), JUNIPER, "spaces around it are fine");
    for (const t of ["{}", '{"invoices":{}}', "[1]", "not json", "null", '"plainday-settings"']) {
        assert.match(settings.readCopy(t, billing).error, /^That isn't a copy of Plainday's settings/, t);
    }
    assert.equal(settings.readCopy("  ", billing).error, "Paste a copy of Plainday's settings here.");
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
    const first = settings.pasted({ ...JUNIPER, invoices: { ...JUNIPER.invoices, firstNumber: 2001, lastNumber: 2000 } }, here).invoices;
    assert.deepEqual(plain([first.firstNumber, first.lastNumber]), [2001, 2000], "the copy's first number, and its last number given when higher");
    // A copy from before the first invoice number: the default, and this device's numbering goes on
    const old = settings.readCopy(JSON.stringify({ "plainday-settings": 1, invoices: { name: "J", lastNumber: 1003 } }), billing).settings;
    assert.deepEqual(plain([old.invoices.firstNumber, settings.pasted(old, here).invoices.lastNumber]), [1001, 1004]);
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
    return { s, plugin, saves, notices, reads, runs: () => listCursorRuns };
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

test("readOldNotes: a device with settings saved reads nothing; one with no notes writes nothing, and reads them once they arrive", async () => {
    const saved = withPlugin({ stored: JUNIPER, notes: { "Config/Invoice Settings.md": INVOICE_TEXT.replace("Juniper Hale", "Someone Else") } });
    await saved.s.load();
    await saved.s.readOldNotes();
    assert.deepEqual([saved.saves, saved.notices, saved.reads], [[], [], []]);
    assert.equal(saved.s.get().invoices.name, "Juniper Hale", "the note's name changes nothing");
    const notes = {};
    const fresh = withPlugin({ notes });
    await fresh.s.load();
    await fresh.s.readOldNotes();
    assert.deepEqual([fresh.saves, fresh.notices, fresh.s.saved], [[], [], false], "nothing to move: no file written over one Sync may still bring");
    // Sync brings the note later: the next load reads it
    notes["Config/Invoice Settings.md"] = INVOICE_TEXT;
    await fresh.s.load();
    await fresh.s.readOldNotes();
    assert.equal(fresh.saves.length, 1);
    assert.equal(fresh.s.get().invoices.name, "Juniper Hale");
});

test("reload: Sync's new data file is read; one caught mid-write keeps what's in memory", async () => {
    const f = withPlugin({ stored: { invoices: { name: "Juniper Hale", lastNumber: 1004 }, editor: { listCursor: false } } });
    await f.s.load();
    f.plugin.loadData = async () => undefined;
    await f.s.reload();
    assert.deepEqual(plain([f.s.get().invoices.name, f.s.get().invoices.lastNumber, f.s.get().editor.listCursor]), ["Juniper Hale", 1004, false]);
    assert.deepEqual([f.notices, f.saves, f.runs()], [[], [], 0], "no notice, nothing written, nothing applied");
    f.plugin.loadData = async () => ({ invoices: { name: "From the phone" } });
    await f.s.reload();
    assert.equal(f.s.get().invoices.name, "From the phone");
    assert.equal(f.runs(), 1, "the editor switch applied");
    f.plugin.loadData = async () => null;
    await f.s.reload();
    assert.deepEqual(plain(f.s.get()), { ...DEFAULTS, invoices: { ...DEFAULTS.invoices, lastNumber: 1004 } }, "the file gone: the defaults, but never a lower number");
    // An older file from another device doesn't lower the number given here
    f.plugin.loadData = async () => ({ invoices: { name: "Juniper Hale", lastNumber: 1001 } });
    await f.s.reload();
    assert.equal(f.s.get().invoices.lastNumber, 1004);
});

test("readOldNotes: a data file Sync brings while the notes are read wins over them", async () => {
    const f = withPlugin({ notes: { "Config/Invoice Settings.md": INVOICE_TEXT } });
    await f.s.load();
    // Sync delivers the other device's file during the note's read, which reload() loads
    const original = f.s.fromOldNotes.bind(f.s);
    f.s.fromOldNotes = (...a) => { f.s.data = { ...f.s.get(), invoices: { ...f.s.get().invoices, name: "From the phone" } }; f.s.saved = true; return original(...a); };
    await f.s.readOldNotes();
    assert.deepEqual([f.saves, f.notices], [[], []]);
    assert.equal(f.s.get().invoices.name, "From the phone");
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
