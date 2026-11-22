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

const load = (file, name, context = vm.createContext({ URL })) => vm.runInContext(classScript(file) + `\n;${name}`, context);
const billing = new (load("billing.js", "Billing"))();
const Settings = load("settings.js", "Settings");
const settings = new Settings();
const plain = (x) => JSON.parse(JSON.stringify(x));
// The folders a new vault starts with (OBS-283): the system's three as they always were, the rest blank
const FOLDERS = { projects: "Projects", inbox: "Inbox", archive: "Archive", periodic: "", week: "", month: "", year: "", errorLog: "" };
const TEMPLATES = { week: "", month: "", year: "", task: "", log: "" };
const DEFAULTS = {
    invoices: { name: "", address: [], terms: "", paymentNote: "", folder: "", firstNumber: 1001, lastNumber: 1000 },
    tables: { freezeRows: 0, freezeColumns: 0 },
    editor: { listCursor: true },
    calendars: { range: "2 months", list: [], recurring: null },
    folders: FOLDERS,
    templates: TEMPLATES,
};
const JUNIPER = {
    invoices: { name: "Juniper Hale", address: ["418 Larkspur Lane", "Maple Falls, ST 00000"], terms: "Net 30",
        paymentNote: "Please pay by bank transfer within 30 days.", folder: "Reference/Invoices", firstNumber: 1001, lastNumber: 1001 },
    tables: { freezeRows: 0, freezeColumns: 0 },
    editor: { listCursor: true },
    calendars: { range: "2 months", list: [], recurring: null },
    folders: FOLDERS,
    templates: TEMPLATES,
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
        calendars: { range: "2 months", list: [], recurring: null },
        folders: FOLDERS,
        templates: TEMPLATES,
    });
    for (const folder of ["../x", "Archive", ".hidden", "a\nb", 7, ["Invoices"]]) {
        assert.equal(settings.normalize({ invoices: { folder } }, billing).invoices.folder, "", String(folder));
    }
    assert.equal(settings.normalize({ invoices: { folder: "Config/Invoices" } }, billing).invoices.folder, "Config/Invoices", "a folder named Config is like any other (OBS-295)");
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
    // The demo keeps its error log in Config, by naming it (OBS-295)
    assert.deepEqual(plain(normalized), { ...JUNIPER, folders: { ...FOLDERS, errorLog: "Config/Error Log.md" } }, "the demo's invented details");
    // Obsidian's saveData writes JSON.stringify(data, null, 2)
    assert.equal(JSON.stringify(normalized, null, 2), text);
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
function withPlugin({ stored = null, notes = {}, unreadable = false, secrets = new Map(), failSave = false, vaultKey = "vault001", plugins = {}, templater = "" } = {}) {
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
    // This vault's local storage, where its key for its secrets' names is kept: "vault001" unless given
    const local = new Map(vaultKey ? [["plainday-calendar-key", vaultKey]] : []);
    const app = {
        // The community plugins Settings asks about: Notebook Navigator for the periodic notes' source,
        // and Templater, which keeps the vault's template folder
        plugins: { plugins, getPlugin: (id) => (id === "templater-obsidian" && templater ? { settings: { templates_folder: templater } } : null) },
        loadLocalStorage: (k) => local.get(k) ?? null,
        saveLocalStorage: (k, v) => { local.set(k, v); },
        // As Obsidian's: names in lowercase letters, digits and dashes, one string each
        secretStorage: {
            setSecret: (id, v) => { if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`bad id ${id}`); secrets.set(id, v); },
            getSecret: (id) => secrets.get(id) ?? null,
            listSecrets: () => [...secrets.keys()],
        },
        vault: {
            getFileByPath: (p) => (p in notes ? { path: p } : null),
            getFolderByPath: (p) => (Object.keys(notes).some((n) => n.startsWith(`${p}/`)) ? { path: p } : null),
            read: async (f) => { reads.push(f.path); return notes[f.path]; },
        },
    };
    const context = vm.createContext({
        app,
        URL,
        crypto: globalThis.crypto,
        Notice: class { constructor(text) { notices.push(text); } },
        plainday: { plugin, Billing: billing, ListCursor: { invoke: async () => { listCursorRuns++; } } },
    });
    const s = new (load("settings.js", "Settings", context))();
    return { s, plugin, saves, notices, reads, secrets, runs: () => listCursorRuns };
}
// What a device saved before OBS-282: no calendars
const JUNIPER_BEFORE = { invoices: JUNIPER.invoices, tables: JUNIPER.tables, editor: JUNIPER.editor };

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

test("load: the settings notes from before, in Config, are left alone: nothing read, saved or said (OBS-295)", async () => {
    const f = withPlugin({ notes: {
        "Config/Invoice Settings.md": "---\nname: Juniper Hale\n---\n", "Config/Table Settings.md": "---\nfreeze_rows: 2\n---\n",
        "Config/Calendar Sync.md": "Sync range: 3 weeks\n",
    } });
    await f.s.load();
    assert.deepEqual(plain(f.s.get()), DEFAULTS);
    assert.deepEqual([f.reads, f.saves, f.notices], [[], [], []]);
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

test("a data file that doesn't read: the defaults, a notice, and no save over it", async () => {
    const f = withPlugin({ unreadable: true });
    await f.s.load();
    assert.deepEqual(plain(f.s.get()), DEFAULTS);
    assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /^Plainday couldn't read its settings file, \.obsidian\/plugins\/plainday\/data\.json, so it's using the defaults\. It leaves the file as it is until you change a setting/);
    assert.deepEqual([f.saves, f.notices.length], [[], 1], "nothing is saved");
    // A change you make saves, as you asked
    await f.s.set("invoices", { name: "Juniper Hale" });
    assert.equal(f.saves.length, 1);
    assert.equal(f.s.unreadable, false);
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
    assert.deepEqual(plain(settings.defaults().calendars), { range: "2 months", list: [], recurring: null }, "2 months for a new vault");
    const n = settings.normalize({ calendars: {
        range: " 3  Weeks ",
        list: [
            { id: "abc123", name: " Studio ", account: "Work", address: " mailto:Me@Example.com ", on: false, link: STUDIO_LINK, extra: 1 },
            { id: "abc123", name: "Twice" },
            { id: "Has-Caps", name: "Bad ID" },
            { id: "", name: "No ID" },
            { name: "No ID either" },
            "not a calendar",
            { id: "home99", name: "Home", address: "home@example.com, desk@example.org" },
        ],
    } }, billing);
    assert.deepEqual(plain(n.calendars), { range: "3 weeks", list: [
        { id: "abc123", name: "Studio", account: "Work", address: "me@example.com", on: false },
        { id: "home99", name: "Home", account: "", address: "", on: true },
    ], recurring: null });
    assert.doesNotMatch(JSON.stringify(n), NO_LINK, "no link from what came in");
    for (const range of ["5 weeks", 14, null, "", "2 Months!"]) {
        assert.equal(settings.normalize({ calendars: { range } }, billing).calendars.range, "2 months", String(range));
    }
    assert.deepEqual(plain(settings.rangeLabels()), ["1 week", "2 weeks", "3 weeks", "1 month", "2 months", "3 months", "6 months"]);
    assert.deepEqual(["1 week", "2 weeks", "3 weeks", "1 month", "2 months", "3 months", "6 months"].map((r) => settings.rangeDays(r)), [7, 14, 21, 31, 62, 92, 183]);
    assert.equal(settings.rangeDays("nonsense"), 62);
});

test("addressOf: your email address on a calendar, one, in lower case; anything else isn't one", () => {
    assert.deepEqual(plain(settings.addressOf("")), { address: "", bad: false });
    assert.deepEqual(plain(settings.addressOf(" Desk@Example.org ")), { address: "desk@example.org", bad: false });
    assert.deepEqual(plain(settings.addressOf("mailto:A@example.com")), { address: "a@example.com", bad: false });
    for (const v of ["a@example.com, b@example.com", "a@example.com b@example.com", "desk", "x@", "a@b@c"]) {
        assert.deepEqual(plain(settings.addressOf(v)), { address: "", bad: true }, v);
    }
    assert.deepEqual(plain(settings.addressOf(["a@example.com"])), { address: "", bad: false }, "not text: nothing");
});

test("addCalendar, editCalendar, removeCalendar: the link only in secret storage, never in the data file", async () => {
    const f = withPlugin({ stored: JUNIPER });
    await f.s.load();
    const studio = await f.s.addCalendar({ name: " Studio ", account: "Work", address: "studio-owner@example.com", link: ` ${STUDIO_LINK} ` });
    assert.match(studio.id, /^[a-z0-9]{10}$/, "a random ID secret storage takes");
    assert.deepEqual(plain(f.s.get().calendars.list), [{ id: studio.id, name: "Studio", account: "Work", address: "studio-owner@example.com", on: true }]);
    assert.equal(f.secrets.get(`plainday-calendar-vault001-${studio.id}`), STUDIO_LINK, "under plainday-calendar-, the vault's key and its ID, trimmed");
    assert.equal(f.s.link(studio.id), STUDIO_LINK);
    const home = await f.s.addCalendar({ name: "Home", account: "iCloud", link: HOME_LINK });
    assert.notEqual(home.id, studio.id);
    // Which calendar has a link: a webcal:// link is its https:// one
    assert.equal(f.s.calendarWithLink(HOME_LINK.replace("webcal://", "https://"))?.name, "Home");
    assert.equal(f.s.calendarWithLink(STUDIO_LINK, studio.id), null, "not the calendar being edited");
    assert.equal(f.s.calendarWithLink("https://example.org/other.ics"), null);

    await f.s.editCalendar(home.id, { name: "Home", account: "iCloud", address: "Home@Example.com" }, `${HOME_LINK}x`);
    assert.equal(f.s.calendar(home.id)?.address, "home@example.com");
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
    assert.equal(f.secrets.get(`plainday-calendar-vault001-${home.id}`), "", "secret storage can't delete, so it's blank");
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
    const studio = await mac.s.addCalendar({ name: "Studio", account: "Work", address: "studio-owner@example.com", link: STUDIO_LINK });
    const home = await mac.s.addCalendar({ name: "Home", account: "Work", link: HOME_LINK });
    const text = mac.s.copyText();
    assert.ok(!text.includes("\n"));
    const raw = JSON.parse(text);
    assert.deepEqual(plain(raw.links), { [studio.id]: STUDIO_LINK, [home.id]: HOME_LINK });
    assert.doesNotMatch(JSON.stringify(raw.calendars), NO_LINK, "the links sit beside the calendars, not in them");

    // The phone: one calendar of its own the copy doesn't have, and none of the Mac's links
    const secrets = new Map([["plainday-calendar-vault001-oldcal", "https://example.org/old.ics"]]);
    const phone = withPlugin({ stored: { ...JUNIPER, calendars: { range: "1 week", list: [{ id: "oldcal", name: "Old" }] } }, secrets });
    await phone.s.load();
    const read = phone.s.readCopy(text, billing);
    assert.deepEqual(plain(Object.keys(read.links ?? {}).sort()), [studio.id, home.id].sort());
    await phone.s.replaceWith(read.settings, read.links);
    assert.deepEqual(plain(phone.s.get().calendars.list.map((c) => [c.id, c.name, c.account])), [[studio.id, "Studio", "Work"], [home.id, "Home", "Work"]], "calendars keep their IDs");
    assert.equal(phone.s.get().calendars.list[0].address, "studio-owner@example.com");
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
    assert.deepEqual(plain([old.settings?.calendars, old.links]), [{ range: "2 months", list: [], recurring: null }, {}]);
});

test("the demo's data file holds no calendar, and no link", () => {
    const text = fs.readFileSync(new URL("../../../.obsidian/plugins/plainday/data.json", import.meta.url), "utf8");
    assert.deepEqual(JSON.parse(text).calendars, { range: "2 months", list: [], recurring: null });
    assert.doesNotMatch(text, NO_LINK);
});

// ------------------------------------------------------------------ calendars: what the reviews found (OBS-282)

test("a link pasted into a calendar's name, account or address is never kept, from the panel, a paste or a file", async () => {
    const outlookish = "https://outlook.office365.com/owa/calendar/0000aaaa@example.com/1111bbbb/calendar.ics";
    assert.deepEqual(plain(settings.addressOf(outlookish)), { address: "", bad: true }, "no / or : in an address");
    const n = settings.normalize({ calendars: { list: [{ id: "abc", name: STUDIO_LINK, account: "webcal://x", address: outlookish }] } }, billing);
    assert.deepEqual(plain(n.calendars.list), [{ id: "abc", name: "", account: "", address: "", on: true }]);
    assert.equal(settings.linkFree("Team: planning"), "Team: planning", "a colon alone is fine");
    const f = withPlugin({ stored: JUNIPER });
    await f.s.load();
    const c = await f.s.addCalendar({ name: STUDIO_LINK, account: HOME_LINK, link: STUDIO_LINK });
    await f.s.editCalendar(c.id, { name: ` ${HOME_LINK}` });
    // Something put a link on a calendar in memory: the next save still writes none
    f.s.get().calendars.list[0].link = STUDIO_LINK;
    await f.s.set("calendars", { range: "1 week" });
    for (const saved of f.saves) assert.doesNotMatch(JSON.stringify(saved), NO_LINK);
    assert.deepEqual(Object.keys(f.saves.at(-1).calendars.list[0]).sort(), ["account", "address", "id", "name", "on"]);
});

test("Paste blanks every calendar link this device keeps but the copy's, a removed calendar's too; an older copy leaves the calendars alone; a failed save changes nothing", async () => {
    // A link left from a calendar another device removed, which Sync took out of this device's list
    const secrets = new Map([["plainday-calendar-vault001-gone01", "https://example.org/gone.ics"], ["other-plugin-key", "theirs"]]);
    const f = withPlugin({ stored: JUNIPER, secrets });
    await f.s.load();
    const kept = await f.s.addCalendar({ name: "Studio", link: STUDIO_LINK });
    const copy = f.s.readCopy(f.s.copyText(), billing);
    await f.s.replaceWith(copy.settings, copy.links, copy.withCalendars);
    assert.equal(f.s.link("gone01"), null, "blanked");
    assert.equal(f.s.link(kept.id), STUDIO_LINK);
    assert.equal(secrets.get("other-plugin-key"), "theirs", "another plugin's secret is left alone");

    // A copy from before calendars: this device's calendars, range and links stay
    await f.s.set("calendars", { range: "3 weeks" });
    const old = f.s.readCopy(JSON.stringify({ "plainday-settings": 1, invoices: { name: "From the backup" } }), billing);
    assert.equal(old.withCalendars, false);
    await f.s.replaceWith(old.settings, old.links, old.withCalendars);
    assert.deepEqual(plain([f.s.get().invoices.name, f.s.get().calendars.range, f.s.get().calendars.list.map((c) => c.name)]), ["From the backup", "3 weeks", ["Studio"]]);
    assert.equal(f.s.link(kept.id), STUDIO_LINK);

    // A paste whose save fails: nothing changes, in memory or in secret storage
    f.plugin.failSave = true;
    const other = f.s.readCopy(JSON.stringify({ "plainday-settings": 1, invoices: { name: "Elsewhere" }, calendars: { list: [] } }), billing);
    await assert.rejects(f.s.replaceWith(other.settings, other.links, other.withCalendars), /disk full/);
    assert.deepEqual(plain([f.s.get().invoices.name, f.s.get().calendars.list.length]), ["From the backup", 1]);
    assert.equal(f.s.link(kept.id), STUDIO_LINK);
});

test("readCopy: only a link-shaped link for a calendar in the copy is taken", () => {
    const text = JSON.stringify({ "plainday-settings": 1, calendars: { list: [{ id: "abc", name: "A" }, { id: "def", name: "D" }, { id: "ghi", name: "G" }] },
        links: { abc: "javascript:alert(1)", def: " https://example.org/x.ics ", ghi: "not a link", zzz: "https://example.org/stray.ics" } });
    assert.deepEqual(plain(settings.readCopy(text, billing).links), { def: "https://example.org/x.ics" });
});

test("reload: a data file from a device on a release before calendars leaves this device's calendars as they are", async () => {
    const f = withPlugin({ stored: { ...JUNIPER, calendars: { range: "3 weeks", list: [{ id: "abc", name: "Studio" }] } } });
    await f.s.load();
    f.plugin.loadData = async () => JUNIPER_BEFORE;
    await f.s.reload();
    assert.deepEqual(plain([f.s.get().calendars.range, f.s.get().calendars.list.map((c) => c.name)]), ["3 weeks", ["Studio"]]);
    f.plugin.loadData = async () => ({ ...JUNIPER, calendars: { range: "1 week", list: [] } });
    await f.s.reload();
    assert.deepEqual(plain(f.s.get().calendars), { range: "1 week", list: [], recurring: null }, "one that has calendars is taken as it is");
});

// ------------------------------------------------------------------ calendars: the second review (OBS-282)

test("each vault names its links with a key of its own, so two vaults on one phone never touch each other's", async () => {
    // One secret storage for two vaults, as on a phone; each vault its own local storage
    const secrets = new Map();
    const a = withPlugin({ stored: JUNIPER, secrets });
    // b has no key yet: one is made, kept, and used from then on
    const b = withPlugin({ stored: JUNIPER, secrets, vaultKey: null });
    await a.s.load();
    await b.s.load();
    const kept = [];
    const original = b.s.vaultKey.bind(b.s);
    b.s.vaultKey = () => { const k = original(); kept.push(k); return k; };
    const own = await a.s.addCalendar({ name: "Studio", link: STUDIO_LINK });
    // The same copy pasted into both vaults: the same IDs
    const copy = a.s.readCopy(a.s.copyText(), billing);
    await b.s.replaceWith(copy.settings, copy.links, copy.withCalendars);
    assert.equal(b.s.link(own.id), STUDIO_LINK);
    assert.ok(kept.length && kept.every((k) => k === kept[0] && k !== "vault001"), "one key for the vault, not a's");
    // Remove in one, and a paste of nothing in the other: the other vault's link stays
    await b.s.removeCalendar(own.id);
    assert.equal(b.s.link(own.id), null);
    assert.equal(a.s.link(own.id), STUDIO_LINK, "vault a's link is its own");
    const empty = b.s.readCopy(JSON.stringify({ "plainday-settings": 1, calendars: { list: [] } }), billing);
    await b.s.replaceWith(empty.settings, empty.links, empty.withCalendars);
    assert.equal(a.s.link(own.id), STUDIO_LINK, "b's paste sweeps only b's links");
    assert.deepEqual(plain([...secrets.keys()].filter((k) => k.startsWith("plainday-calendar-vault001-"))), [`plainday-calendar-vault001-${own.id}`]);
});

test("a vault with no key makes one, keeps it, and names its links with it", () => {
    const local = new Map();
    const context = vm.createContext({
        crypto: globalThis.crypto,
        app: { loadLocalStorage: (k) => local.get(k) ?? null, saveLocalStorage: (k, v) => { local.set(k, v); } },
        plainday: {},
    });
    const s = new (load("settings.js", "Settings", context))();
    const key = s.vaultKey();
    assert.match(key, /^[a-z0-9]{8}$/);
    assert.equal(local.get("plainday-calendar-key"), key);
    assert.equal(s.vaultKey(), key);
    assert.equal(s.secretId("abc"), `plainday-calendar-${key}-abc`);
    assert.ok(s.secretId("a".repeat(32)).length <= 64, "within secret storage's 64 characters");
    local.set("plainday-calendar-key", "Not A Key!");
    assert.notEqual(s.vaultKey(), "Not A Key!", "one that isn't a key is replaced");
});

test("reload: a file with no calendars from an older device keeps this device's, written back, so they're there at the next start", async () => {
    const f = withPlugin({ stored: { ...JUNIPER, calendars: { range: "1 week", list: [{ id: "abc", name: "Studio" }] } } });
    await f.s.load();
    f.plugin.loadData = async () => ({ ...JUNIPER_BEFORE, invoices: { ...JUNIPER.invoices, lastNumber: 1007 } });
    await f.s.reload();
    assert.deepEqual(plain(f.saves.at(-1).calendars), { range: "1 week", list: [{ id: "abc", name: "Studio", account: "", address: "", on: true }], recurring: null });
    assert.equal(f.saves.at(-1).invoices.lastNumber, 1007, "the rest is the other device's");
    // The next start reads what was written back
    f.plugin.loadData = async () => f.saves.at(-1);
    await f.s.load();
    assert.deepEqual(plain([f.s.get().calendars.range, f.s.get().calendars.list.map((c) => c.name), f.notices]), ["1 week", ["Studio"], []]);
    // A device that never had calendars takes such a file as it is, and writes nothing
    const g = withPlugin({ stored: JUNIPER_BEFORE });
    await g.s.load();
    g.plugin.loadData = async () => JUNIPER_BEFORE;
    await g.s.reload();
    assert.deepEqual(g.saves, []);
});

test("a link without its scheme is a link too; a pasted http:// link is taken only from this device", () => {
    for (const t of ["calendar.google.com/calendar/ical/x/basic.ics", "p00-caldav.icloud.com/published/2/abc", "outlook.office365.com/owa/calendar/x"]) {
        assert.equal(settings.linkFree(t), "", t);
    }
    for (const t of ["Team A/B", "Home", "Q3: planning", "v2.1 release", "Team 2.0/Ops", "v1.2/beta"]) assert.equal(settings.linkFree(t), t, t);
    const links = { a: "http://example.org/x.ics", b: "http://127.0.0.1:8765/x.ics", c: "https://example.org/x.ics", d: "webcal://example.org/x",
        // A user name in front of the server: the server is example.org, not this device
        e: "http://127.0.0.1:80@example.org/private/basic.ics", f: "https://", g: "https://exa mple.org/x.ics" };
    const text = JSON.stringify({ "plainday-settings": 1, calendars: { list: Object.keys(links).map((id) => ({ id, name: id })) }, links });
    assert.deepEqual(Object.keys(settings.readCopy(text, billing).links ?? {}).sort(), ["b", "c", "d"]);
});

// ------------------------------------------------------------------ folders and templates (OBS-283)

test("folders: a new vault's are the folders the system always used, and TimeReport's copy for where Plainday isn't loaded is the same", () => {
    assert.deepEqual(plain(Settings.FOLDERS), { projects: "Projects", inbox: "Inbox", archive: "Archive" });
    const TimeReport = load("timeReport.js", "TimeReport");
    assert.deepEqual(plain(TimeReport.FOLDERS), plain(Settings.FOLDERS));
    assert.deepEqual(plain(new TimeReport().systemFolders()), plain(Settings.FOLDERS), "with no settings loaded, the defaults");
    assert.deepEqual(plain(settings.folders()), plain(Settings.FOLDERS));
});

test("normalize: each folder that reads, a note's path with .md, blank for what was there before; three that don't hold together are the defaults", () => {
    const n = settings.normalize({
        folders: { projects: " Work/ ", inbox: "Waiting", archive: "Old", week: "/Planner//Weeks/", month: "../x", year: 7, errorLog: "Logs/Problems" },
        templates: { week: "Templates/Plain week", month: "Templates/Month.md", year: "a|b" },
    }, billing);
    assert.deepEqual(plain(n.folders), { projects: "Work", inbox: "Waiting", archive: "Old", periodic: "", week: "Planner/Weeks", month: "", year: "", errorLog: "Logs/Problems.md" });
    assert.deepEqual(plain(n.templates), { ...TEMPLATES, week: "Templates/Plain week.md", month: "Templates/Month.md", year: "" });
    // One that doesn't read keeps its default; the others stay
    assert.deepEqual(plain(settings.normalize({ folders: { projects: "../x", inbox: "Waiting" } }, billing).folders).inbox, "Waiting");
    assert.equal(settings.normalize({ folders: { projects: "../x" } }, billing).folders.projects, "Projects");
    // Inside one another or the same twice: all three go back to the defaults
    for (const folders of [{ projects: "Work", inbox: "Work/Inbox" }, { inbox: "Projects" }, { archive: "Projects/Old" }, { inbox: "projects" }]) {
        assert.deepEqual(plain(Object.fromEntries(["projects", "inbox", "archive"].map((k) => [k, settings.normalize({ folders }, billing).folders[k]]))), plain(Settings.FOLDERS), JSON.stringify(folders));
    }
    // The invoice folder can't be in the archive, as it's set
    assert.equal(settings.normalize({ folders: { archive: "Old" }, invoices: { folder: "Old/Invoices" } }, billing).invoices.folder, "");
    assert.equal(settings.normalize({ folders: { archive: "Old" }, invoices: { folder: "Archive/Invoices" } }, billing).invoices.folder, "Archive/Invoices");
    // A folder named Config is like any other (OBS-295)
    assert.deepEqual(plain(settings.normalize({ folders: { projects: "Config/Projects", inbox: "Config/Inbox", archive: "config/old" } }, billing).folders),
        { ...FOLDERS, projects: "Config/Projects", inbox: "Config/Inbox", archive: "config/old" });
});

test("foldersProblem: the one you change, said plainly; the vault's top refused; none for three apart", () => {
    const f = (o) => ({ ...Settings.FOLDERS, ...o });
    assert.equal(settings.foldersProblem(f({}), billing), null);
    assert.equal(settings.foldersProblem(f({ projects: "Work", inbox: "Waiting", archive: "Old" }), billing), null);
    assert.deepEqual(plain(settings.foldersProblem(f({ inbox: "Projects/Freelance" }), billing, "inbox")), { key: "inbox", problem: "it's inside Projects" });
    assert.deepEqual(plain(settings.foldersProblem(f({ projects: "Work", inbox: "Work/Waiting" }), billing, "projects")), { key: "projects", problem: "Inbox (Work/Waiting) is inside it" });
    assert.deepEqual(plain(settings.foldersProblem(f({ archive: "Inbox" }), billing, "archive")), { key: "archive", problem: "it's the Inbox folder already" });
    assert.deepEqual(plain(settings.foldersProblem(f({ inbox: "" }), billing, "inbox")), { key: "inbox", problem: "a folder is needed: notes can't go at the top of the vault" });
    assert.equal(settings.foldersProblem(f({ archive: "config/old" }), billing, "archive"), null, "a folder named Config is like any other (OBS-295)");
    assert.match(settings.foldersProblem(f({ projects: "a/../b" }), billing, "projects").problem, /^it isn't a folder in the vault/);
    assert.equal(settings.foldersProblem(f({ projects: "Work", inbox: "Workshop" }), billing), null, "whole folder names");
});

test("notePathOf: a note's path, with .md added; blank is none; anything else isn't a note", () => {
    assert.deepEqual(plain(settings.notePathOf(" Logs//Problems ", billing)), { path: "Logs/Problems.md", error: null });
    assert.deepEqual(plain(settings.notePathOf("Plainday error log.MD", billing)), { path: "Plainday error log.md", error: null }, "the extension as Obsidian reads a note's");
    assert.deepEqual(plain(settings.notePathOf("", billing)), { path: "", error: null });
    assert.deepEqual(plain(settings.notePathOf(undefined, billing)), { path: "", error: null });
    assert.match(settings.notePathOf("../x", billing).error, /^isn't a note in the vault/);
});

test("errorLogPath: the setting's, else Plainday error log.md at the top, in every vault, whatever a Config folder holds (OBS-295)", async () => {
    for (const notes of [{ "Welcome.md": "" }, { "Config/Error Log.md": "" }, { "Config/Templates/Task.md": "" }, { "Plainday error log.md": "", "Config/Error Log.md": "" }]) {
        const f = withPlugin({ notes });
        assert.equal(f.s.errorLogPath(), "Plainday error log.md", Object.keys(notes).join(", "));
        assert.equal(f.s.defaultErrorLogPath(), "Plainday error log.md", "what blank means, for the panel");
    }
    const chosen = withPlugin({ stored: { folders: { errorLog: "Config/Error Log.md" } }, notes: { "Config/Error Log.md": "" } });
    await chosen.s.load();
    assert.equal(chosen.s.errorLogPath(), "Config/Error Log.md", "named in the setting, as the demo names it");
    assert.equal(chosen.s.defaultErrorLogPath(), "Plainday error log.md");
});

test("templateWarning: the properties a template sets that Plainday writes itself; list properties are combined, never warned about", () => {
    assert.equal(settings.templateWarning(["date", "tags"], ["date", "tags", "aliases"]), "Your template also sets `date`; Plainday writes its own.");
    assert.equal(settings.templateWarning(["Date", "week", "parent"], ["date", "week"]), "Your template also sets `Date` and `week`; Plainday writes its own.");
    assert.equal(settings.templateWarning(["a", "b", "c"], ["a", "b", "c"]), "Your template also sets `a`, `b` and `c`; Plainday writes its own.");
    assert.equal(settings.templateWarning(["tags", "aliases"], ["tags", "aliases"]), "");
    assert.equal(settings.templateWarning(["date"], []), "");
    assert.deepEqual(plain(Settings.WRITES), { week: ["aliases"], month: ["aliases"], year: [], task: ["tags", "parent", "due"], log: ["parent", "date", "time", "endTime", "who"] },
        "the alias PeriodicNotes writes (OBS-120), a list, so no row warns; a task note's tag, parent and due (OBS-121); a log's parent, day, times and who (OBS-122)");
    assert.equal(settings.templateWarning(["aliases", "tags"], Settings.WRITES.week), "");
    // A Task template that sets `parent` or `due` is warned about; its `id`, `status` and tags aren't (OBS-121)
    assert.equal(settings.templateWarning(["id", "tags", "parent", "due", "status"], Settings.WRITES.task), "Your template also sets `parent` and `due`; Plainday writes its own.");
    assert.equal(settings.templateWarning(["id", "tags"], Settings.WRITES.task), "");
    // A Log template that sets `date` is warned about; its `id`, `series`, `topic` and aliases aren't (OBS-122)
    assert.equal(settings.templateWarning(["id", "aliases", "series", "topic", "date"], Settings.WRITES.log), "Your template also sets `date`; Plainday writes its own.");
    assert.equal(settings.templateWarning(["id", "series", "topic"], Settings.WRITES.log), "");
});

test("Paste and Sync: a copy or a data file from before folders leaves this device's folders and templates as they are", async () => {
    const mine = { ...JUNIPER, folders: { ...FOLDERS, projects: "Work", inbox: "Waiting" }, templates: { ...TEMPLATES, week: "Templates/Plain week.md" } };
    const f = withPlugin({ stored: mine });
    await f.s.load();
    assert.equal(f.s.foldersSaved, true);
    const { folders, templates, ...older } = mine;
    const read = f.s.readCopy(JSON.stringify({ "plainday-settings": 1, ...older }), billing);
    assert.deepEqual(plain([read.settings.folders, read.settings.templates]), plain([mine.folders, mine.templates]));
    const newer = f.s.readCopy(JSON.stringify({ "plainday-settings": 1, ...older, folders: { projects: "Clients" } }), billing);
    assert.equal(newer.settings.folders.projects, "Clients", "a copy with folders brings them");
    assert.equal(newer.settings.folders.inbox, "Inbox");
    // Sync brings a file from a device on the release before: this device's are kept, and written back
    f.plugin.loadData = async () => JSON.parse(JSON.stringify(older));
    await f.s.reload();
    assert.deepEqual(plain(f.s.get().folders), plain(mine.folders));
    assert.deepEqual(plain(f.saves.at(-1).folders), plain(mine.folders), "written back, so they're there at the next start");
    // A file with folders is read as it is
    f.plugin.loadData = async () => JSON.parse(JSON.stringify({ ...older, folders: { projects: "Clients" } }));
    await f.s.reload();
    assert.equal(f.s.get().folders.projects, "Clients");
});

test("folders: the Inbox is Plainday's own, whatever Obsidian's Default location for new notes says", async () => {
    const f = withPlugin({ stored: JUNIPER });
    // Obsidian's own setting, which Plainday never reads
    let asked = 0;
    const getConfig = () => { asked++; return "Notes"; };
    Object.assign(f.plugin, { app: { vault: { getConfig } } });
    await f.s.load();
    assert.equal(f.s.folders().inbox, "Inbox");
    assert.equal(asked, 0);
    assert.doesNotMatch(fs.readFileSync(new URL("../../../plugin/src/shared/settings.js", import.meta.url), "utf8"), /newFileFolderPath|newFileLocation/);
});

test("normalize: a weekly, monthly or yearly folder in Projects, the Inbox or the archive, or holding one, is as before", () => {
    const n = (folders) => plain(settings.normalize({ folders }, billing).folders);
    assert.equal(n({ week: "Archive/Weeks" }).week, "");
    assert.equal(n({ month: "Config/Months" }).month, "Config/Months", "a folder named Config is like any other (OBS-295)");
    assert.equal(n({ year: "Projects" }).year, "");
    assert.equal(n({ week: "Planner", projects: "Planner/Projects" }).week, "", "one that holds Projects");
    assert.equal(n({ week: "Old/Weeks", archive: "Old" }).week, "", "the archive as it's set");
    assert.equal(n({ week: "Archive/Weeks", archive: "Old" }).week, "Archive/Weeks", "Archive is only a folder once the archive is elsewhere");
    assert.deepEqual(plain(settings.overlap("Reference/Planner/weeks")), null);
    assert.deepEqual(plain(settings.overlap("Config/Weeks")), null);
    assert.deepEqual(plain(settings.overlap("Inbox/Weeks")), { name: "Inbox", folder: "Inbox", how: "in" });
});

test("a copy or a Sync file from before folders is read with this device's folders, so its invoice folder is checked against this device's archive", async () => {
    const mine = { ...JUNIPER, folders: { ...FOLDERS, archive: "Billing" } };
    const f = withPlugin({ stored: mine });
    await f.s.load();
    const { folders, templates, ...older } = { ...mine, invoices: { ...mine.invoices, folder: "Billing/2026" } };
    const read = f.s.readCopy(JSON.stringify({ "plainday-settings": 1, ...older }), billing);
    assert.equal(read.settings.folders.archive, "Billing");
    assert.equal(read.settings.invoices.folder, "", "inside this device's archive, so not kept, and Paste shows it");
    f.plugin.loadData = async () => JSON.parse(JSON.stringify(older));
    await f.s.reload();
    assert.equal(f.s.get().folders.archive, "Billing");
    assert.equal(f.s.get().invoices.folder, "");
});

test("Projects, the Inbox and the archive that don't hold together: at the start the defaults, with a notice; from Sync, this device's, with a notice", async () => {
    const f = withPlugin({ stored: { ...JUNIPER, folders: { ...FOLDERS, projects: "Work", inbox: "Work/Waiting" } } });
    await f.s.load();
    assert.deepEqual(plain(f.s.folders()), plain(Settings.FOLDERS));
    assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /don't hold together .* so it's using Projects `Projects`, Inbox `Inbox` and Archive `Archive`\. Set them in Settings → Plainday → Folders\.$/);
    // One that doesn't read keeps the others: the notice names the folders in use
    const h = withPlugin({ stored: { ...JUNIPER, folders: { ...FOLDERS, projects: "Work", inbox: "a:b", archive: "Old" } } });
    await h.s.load();
    assert.match(h.notices[0], /using Projects `Work`, Inbox `Inbox` and Archive `Old`\./);
    const g = withPlugin({ stored: { ...JUNIPER, folders: { ...FOLDERS, projects: "Work", inbox: "Waiting", archive: "Old" } } });
    await g.s.load();
    assert.deepEqual(g.notices, [], "three that hold together say nothing");
    g.plugin.loadData = async () => ({ ...JUNIPER, folders: { ...FOLDERS, projects: "Work", inbox: "Work/Waiting", archive: "Old" } });
    await g.s.reload();
    assert.deepEqual(plain(g.s.folders()), { projects: "Work", inbox: "Waiting", archive: "Old" }, "this device's, not the defaults");
    assert.equal(g.notices.length, 1);
    assert.match(g.notices[0], /changed by Sync, .* so it keeps the ones it had/);
    assert.deepEqual(plain(g.saves.at(-1).folders).projects, "Work", "and saved, so the next start doesn't read the file that didn't hold together");
    // The other folders are checked against the ones kept: a weekly folder in Work is as before
    g.plugin.loadData = async () => ({ ...JUNIPER, folders: { projects: "Work", inbox: "Work/Waiting", archive: "Old", week: "Work/weeks" } });
    await g.s.reload();
    assert.equal(g.s.get().folders.week, "");
    // Folders that read, from Sync, are taken
    g.plugin.loadData = async () => ({ ...JUNIPER, folders: { ...FOLDERS, projects: "Clients", inbox: "Waiting", archive: "Old" } });
    await g.s.reload();
    assert.equal(g.s.folders().projects, "Clients");
    assert.equal(g.notices.length, 2);
    // A pasted copy whose three don't hold together keeps this device's
    const pasted = g.s.readCopy(JSON.stringify({ "plainday-settings": 1, ...JUNIPER, folders: { projects: "Work", inbox: "Work/In", archive: "Old" } }), billing);
    assert.deepEqual(plain(Object.fromEntries(["projects", "inbox", "archive"].map((k) => [k, pasted.settings.folders[k]]))), { projects: "Clients", inbox: "Waiting", archive: "Old" });
});

test("reload: the saved flags move only once the write lands, so a failed save can't let the defaults replace this device's folders (OBS-283)", async () => {
    const mine = { ...JUNIPER, folders: { ...FOLDERS, projects: "Work", inbox: "Waiting", archive: "Old" } };
    const f = withPlugin({ stored: mine });
    await f.s.load();
    assert.equal(f.s.foldersSaved, true);
    const { folders, templates, ...older } = mine;
    // Sync brings a file from the release before, and the write that keeps this device's folders fails
    f.plugin.loadData = async () => JSON.parse(JSON.stringify(older));
    f.plugin.failSave = true;
    await f.s.reload().catch(() => {});
    assert.deepEqual(plain(f.s.folders()), { projects: "Work", inbox: "Waiting", archive: "Old" }, "kept in memory");
    assert.equal(f.s.foldersSaved, true, "still saved, so the next reload keeps them again");
    f.plugin.failSave = false;
    await f.s.reload();
    assert.deepEqual(plain(f.s.folders()), { projects: "Work", inbox: "Waiting", archive: "Old" }, "and the next one keeps them, not the defaults");
    assert.deepEqual(plain(f.saves.at(-1).folders).projects, "Work");
});

// ------------------------------------------------------------- the periodic notes' source (OBS-283)

// A vault whose Notebook Navigator makes the periodic notes itself, with its own patterns and templates
const NAVIGATOR = {
    calendarIntegrationMode: "notebook-navigator",
    vaultProfiles: [{ periodicNotesFolder: "Planner" }],
    calendarCustomFilePattern: "[days]/YYYY-MM-DD",
    calendarCustomWeekPattern: "[weeks]/gggg[w]ww",
    calendarCustomMonthPattern: "[months]/YYYY-MM",
    calendarCustomYearPattern: "[years]/YYYY",
    calendarCustomFileTemplate: "T/Day.md",
    calendarCustomWeekTemplate: "T/Week.md",
};

test("periodicSource: the setting, else the calendar the vault uses; Navigator integrating with the Daily notes plugin means that plugin", async () => {
    const plain2 = withPlugin({});
    assert.equal(plain2.s.periodicSource(), "daily-notes", "no Navigator at all");
    const nn = withPlugin({ plugins: { "notebook-navigator": { settings: NAVIGATOR } } });
    assert.equal(nn.s.periodicSource(), "notebook-navigator");
    const integrated = withPlugin({ plugins: { "notebook-navigator": { settings: { ...NAVIGATOR, calendarIntegrationMode: "daily-notes" } } } });
    assert.equal(integrated.s.periodicSource(), "daily-notes", "its calendar isn't what makes them");
    // The setting wins over what's installed, both ways
    const chosen = withPlugin({ stored: { folders: { periodic: "daily-notes" } }, plugins: { "notebook-navigator": { settings: NAVIGATOR } } });
    await chosen.s.load();
    assert.equal(chosen.s.periodicSource(), "daily-notes");
    const other = withPlugin({ stored: { folders: { periodic: "notebook-navigator" } } });
    await other.s.load();
    assert.equal(other.s.periodicSource(), "notebook-navigator");
    // Anything else isn't a source
    assert.equal(settings.normalize({ folders: { periodic: "periodic-notes" } }, billing).folders.periodic, "");
});

test("navigatorNote: the folder, name and template Notebook Navigator's pattern says, with its [literals] unwrapped", async () => {
    const f = withPlugin({ plugins: { "notebook-navigator": { settings: NAVIGATOR } } });
    assert.deepEqual(plain(f.s.navigatorNote("day")), { folder: "Planner/days", format: "YYYY-MM-DD", template: "T/Day.md" });
    assert.deepEqual(plain(f.s.navigatorNote("week")), { folder: "Planner/weeks", format: "gggg[w]ww", template: "T/Week.md" });
    assert.deepEqual(plain(f.s.navigatorNote("month")), { folder: "Planner/months", format: "YYYY-MM", template: "" });
    // A pattern with no folder of its own sits at its base; no pattern means nothing to read
    const flat = withPlugin({ plugins: { "notebook-navigator": { settings: { ...NAVIGATOR, calendarCustomYearPattern: "YYYY" } } } });
    assert.deepEqual(plain(flat.s.navigatorNote("year")), { folder: "Planner", format: "YYYY", template: "" });
    const none = withPlugin({ plugins: { "notebook-navigator": { settings: { ...NAVIGATOR, calendarCustomWeekPattern: "" } } } });
    assert.equal(none.s.navigatorNote("week"), null);
    // A pattern whose folder part holds date tokens names a folder per date, which Plainday can't
    // follow: it reads as none, so the folder falls back instead of a literal "YYYY" folder being made
    for (const pattern of ["YYYY/MM/YYYY-MM-DD", "[days]/YYYY/YYYY-MM-DD", "YYYY/[days]/YYYY-MM-DD"]) {
        const tokens = withPlugin({ plugins: { "notebook-navigator": { settings: { ...NAVIGATOR, calendarCustomFilePattern: pattern } } } });
        assert.equal(tokens.s.navigatorNote("day"), null, pattern);
    }
    // And with no periodic notes folder of its own, there's no base to put them under
    const baseless = withPlugin({ plugins: { "notebook-navigator": { settings: { ...NAVIGATOR, vaultProfiles: [{}] } } } });
    assert.equal(baseless.s.navigatorNote("day"), null);
    assert.equal(withPlugin({}).s.navigatorCalendar(), null, "no Navigator installed");
});

test("templates: blank means the template's own name in the vault's template folder, never a folder of this repository's (OBS-283)", () => {
    const d = settings.defaults().templates;
    assert.deepEqual(plain([d.task, d.log]), ["", ""], "blank as it comes");
    assert.deepEqual(plain(Settings.TEMPLATE_NAMES), { task: "Task", log: "Log", week: "Weekly Note", month: "Monthly Note", year: "Yearly Note" });
    // Templater keeps the folder; without it a template sits at the top of the vault
    const withTemplater = withPlugin({ templater: "Config/Templates" });
    assert.equal(withTemplater.s.defaultTemplatePath("task"), "Config/Templates/Task.md");
    assert.equal(withTemplater.s.defaultTemplatePath("week"), "Config/Templates/Weekly Note.md");
    const bare = withPlugin({});
    assert.equal(bare.s.defaultTemplatePath("task"), "Task.md");
    assert.equal(bare.s.defaultTemplatePath("log"), "Log.md");
    assert.equal(bare.s.defaultTemplatePath("year"), "Yearly Note.md");
    const slashes = withPlugin({ templater: "/Templates/" });
    assert.equal(slashes.s.defaultTemplatePath("log"), "Templates/Log.md");
    // Nothing writes this repository's own folder in as a default
    assert.doesNotMatch(fs.readFileSync(new URL("../../../plugin/src/shared/settings.js", import.meta.url), "utf8"), /Config\/Templates/);
    const n = settings.normalize({ templates: { task: "Templates/My task", log: "a|b" } }, billing);
    assert.equal(n.templates.task, "Templates/My task.md");
    assert.equal(n.templates.log, "", "a path that doesn't read is blank, so the default holds");
});

test("recurring events' projects (OBS-275): each title once with its ⭕ and 🗃️ links; null until read; anything else left out", () => {
    assert.equal(settings.normalize({}, billing).calendars.recurring, null, "never read: null");
    assert.deepEqual(plain(settings.normalize({ calendars: { recurring: [] } }, billing).calendars.recurring), [], "read, with none");
    const n = settings.normalize({ calendars: { recurring: [
        { title: " Kestrel  standup ", links: ["[[Kestrel Outfitters 2026|⭕]]", "not a link", STUDIO_LINK, 7] },
        { title: "Kestrel standup", links: ["[[Household|🗃️]]", "[[Kestrel Outfitters 2026|⭕]]"] },
        { title: "No links", links: [] },
        { title: "", links: ["[[A|⭕]]"] },
        { title: "Link text", links: ["[[https://example.com/feed.ics|⭕]]"] },
        "not a series",
    ] } }, billing);
    assert.deepEqual(plain(n.calendars.recurring), [{ title: "Kestrel standup", links: ["[[Kestrel Outfitters 2026|⭕]]", "[[Household|🗃️]]"] }]);
    assert.doesNotMatch(JSON.stringify(n), NO_LINK);
});

test("reload and paste: a file or copy from before recurring events keeps this device's (OBS-275)", async () => {
    const mine = [{ title: "Kestrel standup", links: ["[[Kestrel Outfitters 2026|⭕]]"] }];
    const f = withPlugin({ stored: { ...JUNIPER, calendars: { range: "1 week", list: [], recurring: mine } } });
    await f.s.load();
    f.plugin.loadData = async () => ({ ...JUNIPER, calendars: { range: "3 weeks", list: [] } });
    await f.s.reload();
    assert.deepEqual(plain(f.s.get().calendars), { range: "3 weeks", list: [], recurring: mine });
    assert.deepEqual(plain(f.saves.at(-1).calendars.recurring), mine, "written back, so it's there at the next start");
    await f.s.replaceWith(f.s.normalize({ ...JUNIPER, calendars: { range: "2 weeks", list: [] } }, billing), {}, true);
    assert.deepEqual(plain(f.s.get().calendars.recurring), mine, "a copy from before keeps them too");
});

test("syncHere (OBS-275): off until turned on, on for the device a first calendar is added on, kept on this device only", async () => {
    const f = withPlugin({ stored: JUNIPER });
    await f.s.load();
    assert.equal(f.s.syncHere(), false);
    await f.s.addCalendar({ name: "Studio", link: STUDIO_LINK });
    assert.equal(f.s.syncHere(), true, "the device the first calendar is added on syncs");
    f.s.setSyncHere(false);
    await f.s.addCalendar({ name: "Home", link: HOME_LINK });
    assert.equal(f.s.syncHere(), false, "a second calendar doesn't turn it back on");
    f.s.setSyncHere(true);
    assert.doesNotMatch(f.s.copyText(), /sync-here|syncHere/, "a copy never carries it");
    assert.ok(!JSON.stringify(f.saves).includes("syncHere"), "nor the settings file");
});
