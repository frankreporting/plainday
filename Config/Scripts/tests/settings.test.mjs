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
    calendars: { range: "2 months", list: [] },
};
const JUNIPER = {
    invoices: { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"], terms: "Net 30",
        paymentNote: "Please pay by bank transfer within 30 days.", folder: "Reference/Invoices", firstNumber: 1001, lastNumber: 1001 },
    tables: { freezeRows: 0, freezeColumns: 0 },
    editor: { listCursor: true },
    calendars: { range: "2 months", list: [] },
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
        calendars: { range: "2 months", list: [] },
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
function withPlugin({ stored = null, notes = {}, unreadable = false, secrets = new Map(), failSave = false } = {}) {
    const saves = [], notices = [], reads = [];
    let listCursorRuns = 0;
    const plugin = {
        manifest: { dir: ".obsidian/plugins/plainday" },
        loadData: async () => (unreadable ? undefined : stored === null ? null : JSON.parse(JSON.stringify(stored))),
        saveData: async (d) => {
            if (plugin.failSave) throw new Error("disk full");
            saves.push(plain(d));
        },
        failSave,
    };
    const app = {
        // As Obsidian's: names in lowercase letters, digits and dashes, one string each
        secretStorage: {
            setSecret: (id, v) => { if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`bad id ${id}`); secrets.set(id, v); },
            getSecret: (id) => secrets.get(id) ?? null,
            listSecrets: () => [...secrets.keys()],
        },
        vault: {
            getFileByPath: (p) => (p in notes ? { path: p } : null),
            read: async (f) => { reads.push(f.path); return notes[f.path]; },
        },
    };
    const context = vm.createContext({
        app,
        crypto: globalThis.crypto,
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
    return { s, plugin, saves, notices, reads, secrets, runs: () => listCursorRuns };
}
// What a device saved before OBS-282: no calendars
const JUNIPER_BEFORE = { invoices: JUNIPER.invoices, tables: JUNIPER.tables, editor: JUNIPER.editor };
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

// ------------------------------------------------------------------ calendars (OBS-282)

// Every link here is invented
const STUDIO_LINK = "https://calendar.google.com/calendar/ical/studio-owner%40example.com/private-0000invented/basic.ics";
const HOME_LINK = "webcal://p00-caldav.icloud.com/published/2/INVENTEDinvented";
// Nothing that looks like a link: what a saved settings file may never hold
const NO_LINK = /https?:|webcals?:|calendar\.google|caldav|private-0000|invented/i;

test("calendars: the range and the list, as they read; anything else is left out, a link above all", () => {
    assert.deepEqual(plain(settings.defaults().calendars), { range: "2 months", list: [] }, "2 months for a new vault");
    const n = settings.normalize({ calendars: {
        range: " 3  Weeks ",
        list: [
            { id: "abc123", name: " Studio ", account: "Work", addresses: "Me@Example.com, mailto:also@example.com; not-an-address", on: false, link: STUDIO_LINK, extra: 1 },
            { id: "abc123", name: "Twice" },
            { id: "Has-Caps", name: "Bad ID" },
            { id: "", name: "No ID" },
            { name: "No ID either" },
            "not a calendar",
            { id: "home99", name: "Home", addresses: ["home@example.com", 7] },
        ],
    } }, billing);
    assert.deepEqual(plain(n.calendars), { range: "3 weeks", list: [
        { id: "abc123", name: "Studio", account: "Work", addresses: ["me@example.com", "also@example.com"], on: false },
        { id: "home99", name: "Home", account: "", addresses: ["home@example.com"], on: true },
    ] });
    assert.doesNotMatch(JSON.stringify(n), NO_LINK, "no link from what came in");
    for (const range of ["5 weeks", 14, null, "", "2 Months!"]) {
        assert.equal(settings.normalize({ calendars: { range } }, billing).calendars.range, "2 months", String(range));
    }
    assert.deepEqual(plain(settings.rangeLabels()), ["1 week", "2 weeks", "3 weeks", "1 month", "2 months", "3 months", "6 months"]);
    assert.deepEqual(["1 week", "2 weeks", "3 weeks", "1 month", "2 months", "3 months", "6 months"].map((r) => settings.rangeDays(r)), [7, 14, 21, 31, 62, 92, 183]);
    assert.equal(settings.rangeDays("nonsense"), 62);
});

test("addressesOf: your address on a calendar, one or more, in lower case; what isn't one is named", () => {
    assert.deepEqual(plain(settings.addressesOf("")), { addresses: [], bad: [] });
    assert.deepEqual(plain(settings.addressesOf(" Desk@Example.org ")), { addresses: ["desk@example.org"], bad: [] });
    assert.deepEqual(plain(settings.addressesOf("a@example.com,b@example.com  a@example.com")), { addresses: ["a@example.com", "b@example.com"], bad: [] });
    assert.deepEqual(plain(settings.addressesOf("a@example.com, desk, x@")), { addresses: ["a@example.com"], bad: ["desk", "x@"] });
    assert.deepEqual(plain(settings.addressesOf(["mailto:A@example.com"])), { addresses: ["a@example.com"], bad: [] });
});

test("rangeFromNote and rangeNotice: the Calendar Sync note's line, read once", () => {
    const note = "---\nid: 1\n---\n\n## Range\n\nSync range: 3 weeks\n\nHow far ahead to sync…\n\n## Calendars\n";
    assert.deepEqual(plain(settings.rangeFromNote(note)), { range: "3 weeks" });
    assert.deepEqual(plain(settings.rangeFromNote("Sync range:  1 Month  ")), { range: "1 month" });
    assert.deepEqual(plain(settings.rangeFromNote("Sync range: 5 weeks")), { bad: "`Sync range` in Calendar Sync (5 weeks)" });
    assert.equal(settings.rangeFromNote("## Calendars\n- [x] Home\n"), null, "no line, nothing to move");
    assert.equal(settings.rangeNotice({ range: "3 weeks" }),
        "Plainday moved your calendar sync range, 3 weeks, into Settings → Plainday → Calendars. Sync calendars no longer reads the Sync range line in Calendar Sync, which still lists your calendars.");
    assert.equal(settings.rangeNotice({ bad: "`Sync range` in Calendar Sync (5 weeks)" }),
        "Plainday moved your calendar sync range into Settings → Plainday → Calendars. Sync calendars no longer reads the Sync range line in Calendar Sync, which still lists your calendars.\n\n"
        + "This didn't read, so it starts from the default, 2 months: `Sync range` in Calendar Sync (5 weeks).");
});

test("addCalendar, editCalendar, removeCalendar: the link only in secret storage, never in the data file", async () => {
    const f = withPlugin({ stored: JUNIPER });
    await f.s.load();
    const studio = await f.s.addCalendar({ name: " Studio ", account: "Work", addresses: ["studio-owner@example.com"], link: ` ${STUDIO_LINK} ` });
    assert.match(studio.id, /^[a-z0-9]{10}$/, "a random ID secret storage takes");
    assert.deepEqual(plain(f.s.get().calendars.list), [{ id: studio.id, name: "Studio", account: "Work", addresses: ["studio-owner@example.com"], on: true }]);
    assert.equal(f.secrets.get(`plainday-calendar-${studio.id}`), STUDIO_LINK, "under plainday-calendar- and its ID, trimmed");
    assert.equal(f.s.link(studio.id), STUDIO_LINK);
    const home = await f.s.addCalendar({ name: "Home", account: "iCloud", link: HOME_LINK });
    assert.notEqual(home.id, studio.id);
    // Which calendar has a link: a webcal:// link is its https:// one
    assert.equal(f.s.calendarWithLink(HOME_LINK.replace("webcal://", "https://"))?.name, "Home");
    assert.equal(f.s.calendarWithLink(STUDIO_LINK, studio.id), null, "not the calendar being edited");
    assert.equal(f.s.calendarWithLink("https://example.org/other.ics"), null);

    await f.s.editCalendar(home.id, { name: "Home", account: "iCloud", addresses: "home@example.com" }, `${HOME_LINK}x`);
    assert.deepEqual(plain(f.s.calendar(home.id)?.addresses), ["home@example.com"]);
    assert.equal(f.s.link(home.id), `${HOME_LINK}x`, "a new link replaces this device's");
    await f.s.editCalendar(home.id, { on: false });
    assert.equal(f.s.calendar(home.id)?.on, false);
    assert.equal(f.s.link(home.id), `${HOME_LINK}x`, "no new link keeps the old");
    // A long link reads back whole
    const long = `https://calendar.example.org/ical/${"a".repeat(200)}/basic.ics`;
    await f.s.editCalendar(studio.id, {}, long);
    assert.equal(f.s.link(studio.id), long);

    await f.s.removeCalendar(home.id);
    assert.deepEqual(plain(f.s.get().calendars.list.map((c) => c.name)), ["Studio"]);
    assert.equal(f.s.link(home.id), null, "its link blanked on this device");
    assert.equal(f.secrets.get(`plainday-calendar-${home.id}`), "", "secret storage can't delete, so it's blank");
    await f.s.removeCalendar("nosuch");

    assert.ok(f.saves.length >= 6);
    for (const saved of f.saves) assert.doesNotMatch(JSON.stringify(saved), NO_LINK, "no saved settings file holds a link");
});

test("a calendar that can't be saved isn't added, and leaves no link; an edit that can't be saved changes nothing", async () => {
    const f = withPlugin({ stored: JUNIPER });
    await f.s.load();
    const kept = await f.s.addCalendar({ name: "Studio", link: STUDIO_LINK });
    f.plugin.failSave = true;
    await assert.rejects(f.s.addCalendar({ name: "Home", link: HOME_LINK }), /disk full/);
    assert.deepEqual(plain(f.s.get().calendars.list.map((c) => c.name)), ["Studio"]);
    assert.deepEqual([...f.secrets.values()].filter(Boolean), [STUDIO_LINK], "the new link blanked again");
    await assert.rejects(f.s.editCalendar(kept.id, { name: "Renamed" }, HOME_LINK), /disk full/);
    assert.equal(f.s.calendar(kept.id)?.name, "Studio");
    assert.equal(f.s.link(kept.id), STUDIO_LINK, "the link only changes once the settings are saved");
    await assert.rejects(f.s.removeCalendar(kept.id), /disk full/);
    assert.equal(f.s.calendar(kept.id)?.name, "Studio");
    assert.equal(f.s.link(kept.id), STUDIO_LINK);
});

test("Copy carries each calendar's link beside the settings; Paste stores them, and blanks the links of calendars it drops", async () => {
    const mac = withPlugin({ stored: JUNIPER });
    await mac.s.load();
    const studio = await mac.s.addCalendar({ name: "Studio", account: "Work", addresses: ["studio-owner@example.com"], link: STUDIO_LINK });
    const home = await mac.s.addCalendar({ name: "Home", account: "Work", link: HOME_LINK });
    const text = mac.s.copyText();
    assert.ok(!text.includes("\n"));
    const raw = JSON.parse(text);
    assert.deepEqual(plain(raw.links), { [studio.id]: STUDIO_LINK, [home.id]: HOME_LINK });
    assert.doesNotMatch(JSON.stringify(raw.calendars), NO_LINK, "the links sit beside the calendars, not in them");

    // The phone: one calendar of its own the copy doesn't have, and none of the Mac's links
    const secrets = new Map([["plainday-calendar-oldcal", "https://example.org/old.ics"]]);
    const phone = withPlugin({ stored: { ...JUNIPER, calendars: { range: "1 week", list: [{ id: "oldcal", name: "Old" }] } }, secrets });
    await phone.s.load();
    const read = phone.s.readCopy(text, billing);
    assert.deepEqual(plain(Object.keys(read.links ?? {}).sort()), [studio.id, home.id].sort());
    await phone.s.replaceWith(read.settings, read.links);
    assert.deepEqual(plain(phone.s.get().calendars.list.map((c) => [c.id, c.name, c.account])), [[studio.id, "Studio", "Work"], [home.id, "Home", "Work"]], "calendars keep their IDs");
    assert.deepEqual(plain(phone.s.get().calendars.list[0].addresses), ["studio-owner@example.com"]);
    assert.equal(phone.s.get().calendars.range, "2 months");
    assert.equal(phone.s.link(studio.id), STUDIO_LINK);
    assert.equal(phone.s.link(home.id), HOME_LINK);
    assert.equal(phone.s.link("oldcal"), null, "a calendar the paste drops loses its link here");
    for (const saved of phone.saves) assert.doesNotMatch(JSON.stringify(saved), NO_LINK);

    // A copy without a link for a calendar keeps this device's; links for calendars not in the copy are ignored
    const bare = JSON.parse(text);
    delete bare.links[home.id];
    bare.links.nosuch = "https://example.org/stray.ics";
    bare.links[studio.id] = 7;
    const r = phone.s.readCopy(JSON.stringify(bare), billing);
    assert.deepEqual(plain(r.links), {}, "not a string, or not a calendar in the copy");
    await phone.s.replaceWith(r.settings, r.links);
    assert.equal(phone.s.link(home.id), HOME_LINK);
    assert.equal(phone.s.link("nosuch"), null);
    // A copy from before OBS-282: no calendars, and the defaults
    const old = phone.s.readCopy(JSON.stringify({ "plainday-settings": 1, invoices: { name: "J" } }), billing);
    assert.deepEqual(plain([old.settings?.calendars, old.links]), [{ range: "2 months", list: [] }, {}]);
});

test("readOldNotes: settings saved before OBS-282 read the Calendar Sync note's range once, and say so", async () => {
    const notes = { "Config/Calendar Sync.md": "---\nid: 1\n---\n\n## Range\n\nSync range: 3 weeks\n\n## Calendars\n" };
    const f = withPlugin({ stored: JUNIPER_BEFORE, notes });
    await f.s.load();
    assert.equal(f.s.get().calendars.range, "2 months", "until the note is read");
    await f.s.readOldNotes();
    assert.equal(f.s.get().calendars.range, "3 weeks");
    assert.deepEqual(f.saves, [{ ...JUNIPER, calendars: { range: "3 weeks", list: [] } }], "the rest as it was");
    assert.deepEqual(f.notices, [settings.rangeNotice({ range: "3 weeks" })]);
    assert.deepEqual(f.reads, ["Config/Calendar Sync.md"], "Invoice Settings and Table Settings aren't read again");
    await f.s.readOldNotes();
    assert.deepEqual([f.saves.length, f.notices.length, f.reads.length], [1, 1, 1], "once");
    // A later load finds calendars saved: the note's line, changed, changes nothing
    notes["Config/Calendar Sync.md"] = notes["Config/Calendar Sync.md"].replace("3 weeks", "1 week");
    f.plugin.loadData = async () => f.saves[0];
    await f.s.load();
    await f.s.readOldNotes();
    assert.deepEqual([f.s.get().calendars.range, f.reads.length], ["3 weeks", 1]);
});

test("readOldNotes: a new device reads all three notes at once, with one notice; a bad range is named", async () => {
    const f = withPlugin({ notes: {
        "Config/Invoice Settings.md": INVOICE_TEXT, "Config/Table Settings.md": TABLE_TEXT,
        "Config/Calendar Sync.md": "## Range\n\nSync range: 5 weeks\n",
    } });
    await f.s.load();
    await f.s.readOldNotes();
    assert.deepEqual(f.saves, [{ ...JUNIPER, tables: { freezeRows: 1, freezeColumns: 1 } }], "the default range");
    assert.equal(f.notices.length, 1);
    assert.equal(f.notices[0], `${settings.movedNotice({ read: ["invoice", "table"], bad: [] })}\n\n${settings.rangeNotice({ bad: "`Sync range` in Calendar Sync (5 weeks)" })}`);
});

test("readOldNotes: no range line, calendars already saved, or a data file that doesn't read: the note isn't read over them", async () => {
    const none = withPlugin({ stored: JUNIPER_BEFORE, notes: { "Config/Calendar Sync.md": "## Calendars\n" } });
    await none.s.load();
    await none.s.readOldNotes();
    assert.deepEqual([none.saves, none.notices], [[], []], "no line: nothing to move, and nothing written");
    const saved = withPlugin({ stored: JUNIPER, notes: { "Config/Calendar Sync.md": "Sync range: 1 week\n" } });
    await saved.s.load();
    await saved.s.readOldNotes();
    assert.deepEqual([saved.saves, saved.reads, saved.s.get().calendars.range], [[], [], "2 months"]);
    const broken = withPlugin({ unreadable: true, notes: { "Config/Calendar Sync.md": "Sync range: 1 week\n" } });
    await broken.s.load();
    await broken.s.readOldNotes();
    assert.deepEqual([broken.saves, broken.reads], [[], []]);
    // Sync brings a data file while the note is read: it wins
    const raced = withPlugin({ stored: JUNIPER_BEFORE, notes: { "Config/Calendar Sync.md": "Sync range: 1 week\n" } });
    await raced.s.load();
    const original = raced.s.rangeFromNote.bind(raced.s);
    raced.s.rangeFromNote = (t) => { raced.s.calendarsSaved = true; return original(t); };
    await raced.s.readOldNotes();
    assert.deepEqual([raced.saves, raced.notices], [[], []]);
});

test("the demo's data file holds no calendar, and no link", () => {
    const text = fs.readFileSync(new URL("../../../.obsidian/plugins/plainday/data.json", import.meta.url), "utf8");
    assert.deepEqual(JSON.parse(text).calendars, { range: "2 months", list: [] });
    assert.doesNotMatch(text, NO_LINK);
});
