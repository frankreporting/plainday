// Plainday's bundle: built from the class files as they are, it loads in Node against stand-ins
// for Obsidian's module and CodeMirror's. Every class is made by name, every command in the list is
// added with its id, name and icon, the startup scripts run in order once the layout is ready, a class
// reaches Plainday through the host's `plainday` and imports Obsidian and CodeMirror, no CustomJS hook
// or `customJS` is left, and unloading leaves nothing of Plainday's behind. The build itself is
// tested too: a line in a class file that reaches for CustomJS stops it, and so does a class file
// without the shape (plugin/classShape.mjs), each naming the file and line.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, check, ROOT, SRC, workerPlugin, workerSource } from "../esbuild.config.mjs";
import { classFiles as listClassFiles, parse, readIndex, shapeProblems } from "../classShape.mjs";

// The indexes import the class files, which import Obsidian's module, which only Obsidian has, so
// they're read the way CI reads them
const { COMMANDS, STARTUP } = { ...readIndex("commands").exports, ...readIndex("startup").exports };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plainday-bundle-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const BUNDLE = path.join(tmp, "main.js");
await build({ outfile: BUNDLE, logLevel: "silent" });

// "commands/schedule.js" and so on
const classFiles = listClassFiles();
const read = (f, src = SRC) => fs.readFileSync(path.join(src, f), "utf8");
const CLASS_NAMES = classFiles.map((f) => parse(f, read(f)).name ?? null);
const OWN = new Set(["app", "obsidian", "plugin"]);
// Fold machinery, called directly and by eval, never from the palette
const NOT_COMMANDS = ["SnapshotDailyNotes", "RefoldDailyNotes"];
// Stand-ins for the CodeMirror modules Obsidian provides
const CODEMIRROR = {
    "@codemirror/view": { EditorView: class EditorView {}, ViewPlugin: {}, Decoration: {}, keymap: {} },
    "@codemirror/state": { EditorState: class EditorState {}, Prec: {}, StateEffect: {} },
    "@codemirror/language": { foldedRanges: () => [] },
};
const instances = (o) => Object.keys(o).filter((k) => !OWN.has(k));
// A copy of plugin/src/ to build from, for a test that changes a file
const copySrc = () => {
    const copy = fs.mkdtempSync(path.join(tmp, "src-"));
    fs.cpSync(SRC, copy, { recursive: true });
    return copy;
};

// Runs a built main.js the way Obsidian's plugin loader does, against stand-ins: `Plugin` records
// what the plugin adds and saves, `Notice` what it shows, and the app holds the layout-ready callbacks.
// `stored` is what loadData gives, null for a device with no settings saved. CodeMirror's modules come
// from the loader too, as Obsidian gives them to every plugin.
function load(file = BUNDLE, { stored = null } = {}) {
    const notices = [];
    class Plugin {
        constructor(app, manifest) {
            this.app = app;
            this.manifest = manifest;
            this.commands = [];
            this.extensions = [];
            this.tabs = [];
            this.saved = [];
        }
        addCommand(c) { this.commands.push(c); return c; }
        registerEditorExtension(e) { this.extensions.push(e); }
        addSettingTab(tab) { this.tabs.push(tab); }
        async loadData() { return stored; }
        async saveData(data) { this.saved.push(JSON.parse(JSON.stringify(data))); }
    }
    class Notice { constructor(message) { notices.push(message); } }
    // What the settings panel extends when main.js loads
    class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
    const suggests = [];
    class AbstractInputSuggest {
        constructor(app, el) { this.app = app; this.el = el; this.closed = 0; suggests.push(this); }
        onSelect(cb) { this.picked = cb; return this; }
        close() { this.closed++; }
    }
    class Modal {}
    const module = { exports: {} };
    const req = (id) => {
        if (id === "obsidian") return { Plugin, Notice, PluginSettingTab, AbstractInputSuggest, Modal, requireApiVersion: () => true };
        if (CODEMIRROR[id]) return CODEMIRROR[id];
        throw new Error(`unexpected require(${id}) while loading`);
    };
    globalThis.window = globalThis;
    new Function("module", "exports", "require", fs.readFileSync(file, "utf8"))(module, module.exports, req);
    const layout = [];
    const app = { workspace: { onLayoutReady: (cb) => layout.push(cb) }, vault: { getFileByPath: () => null } };
    const plugin = new module.exports.default(app, { id: "plainday" });
    return { plugin, layout, notices, suggests };
}

test("every class file is bundled, and made once by name", async () => {
    const { plugin } = load();
    await plugin.onload();
    try {
        assert.equal(CLASS_NAMES.length, classFiles.length);
        assert.ok(!CLASS_NAMES.includes(null), "each class file declares a class");
        assert.deepEqual(instances(window.plainday).sort(), [...CLASS_NAMES].sort());
        for (const name of CLASS_NAMES) assert.equal(window.plainday[name].constructor.name, name, `${name} keeps its name`);
        assert.equal(window.plainday.plugin, plugin, "Plainday itself");
        assert.equal(window.plainday.app, plugin.app, "and the app");
        assert.equal(typeof window.plainday.obsidian?.Notice, "function", "and Obsidian's module, for scripts sent in by eval");
        assert.deepEqual(Object.keys(window.plainday).filter((k) => /^create.+Instance$|^(state|codemirror)$/.test(k)), [],
            "nothing else of CustomJS's: no create…Instance, no state, no CodeMirror");
        assert.equal(globalThis.customJS, undefined, "no customJS global");
    } finally {
        plugin.onunload();
    }
});

test("each command in the list is added with its id, name and icon, and runs its class", async () => {
    const { plugin } = load();
    await plugin.onload();
    try {
        const shown = ({ id, name, icon }) => ({ id, name, icon });
        assert.deepEqual(plugin.commands.map(shown), COMMANDS.map(shown));
        assert.equal(plugin.commands.length, 14);
        for (const c of plugin.commands) {
            assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, "ids are lower case with hyphens, without the plugin's id");
            // An icon name from Obsidian's set (OBS-263): without one, the phone's toolbar draws a question mark
            assert.match(c.icon ?? "", /^[a-z]+(-[a-z0-9]+)*$/, `${c.id} has an icon, in lower case with hyphens`);
            // Sentence case: only the first word and proper names capitalized
            const [first, ...rest] = c.name.split(" ");
            assert.match(first, /^[A-Z][a-z]+$/, c.name);
            for (const w of rest) assert.ok(/^[a-z]+$/.test(w) || ["Obsidian", "PM"].includes(w), `sentence case: ${c.name}`);
        }
        const icons = plugin.commands.map((c) => c.icon);
        assert.deepEqual(icons.filter((icon, i) => icons.indexOf(icon) !== i), [], "no two commands share an icon");
        for (const name of NOT_COMMANDS) {
            assert.ok(!COMMANDS.some((c) => c.script === name), `${name} isn't a command`);
            assert.equal(typeof window.plainday[name]?.invoke, "function", `${name} can still be called by eval`);
        }
        for (const { script } of COMMANDS) {
            const ran = [];
            window.plainday[script].invoke = async () => ran.push(script);
            await plugin.commands.find((c) => COMMANDS.find((l) => l.id === c.id).script === script).callback();
            assert.deepEqual(ran, [script]);
        }
    } finally {
        plugin.onunload();
    }
});

test("the startup scripts wait for the layout, then run one after the other in the list's order", async () => {
    const { plugin, layout, notices } = load();
    await plugin.onload();
    try {
        const ran = [];
        let running = 0;
        for (const name of STARTUP) {
            window.plainday[name].invoke = async () => {
                assert.equal(running++, 0, "one at a time");
                ran.push(name);
                await new Promise((r) => setTimeout(r, 1));
                running--;
                if (name === "SyncArea") throw new Error("invented failure");
            };
        }
        assert.equal(layout.length, 1);
        assert.deepEqual(ran, [], "nothing runs before the layout is ready");
        await layout[0]();
        assert.deepEqual(ran, STARTUP, "a failing script doesn't stop the next");
        assert.equal(notices.length, 1);
        assert.match(notices[0], /^Plainday: SyncArea failed\ninvented failure/);
    } finally {
        plugin.onunload();
    }
});

test("its settings load before anything runs; the panel is added; the old notes are read once the layout is ready, before the startup scripts (OBS-281)", async () => {
    const stored = { invoices: { name: "Juniper Hale", folder: "Reference/Invoices", lastNumber: 1001 } };
    const { plugin, layout } = load(BUNDLE, { stored });
    await plugin.onload();
    try {
        assert.equal(window.plainday.Settings.get().invoices.name, "Juniper Hale", "loaded before the commands are added");
        assert.equal(plugin.commands.length, COMMANDS.length);
        assert.equal(plugin.tabs.length, 1);
        assert.equal(plugin.tabs[0].plugin, plugin, "Settings → Plainday");
        const ran = [];
        window.plainday.Settings.readOldNotes = async () => ran.push("readOldNotes");
        for (const name of STARTUP) window.plainday[name].invoke = async () => ran.push(name);
        await layout[0]();
        assert.deepEqual(ran, ["readOldNotes", ...STARTUP]);
        assert.deepEqual(plugin.saved, [], "loading saves nothing");
        // Sync changed the data file: read again, and the editor switch applied
        stored.invoices.name = "From the phone";
        const applied = [];
        window.plainday.ListCursor.invoke = async () => applied.push("ListCursor");
        await plugin.onExternalSettingsChange();
        assert.equal(window.plainday.Settings.get().invoices.name, "From the phone");
        assert.deepEqual(applied, ["ListCursor"]);
    } finally {
        plugin.onunload();
    }
});

test("a device with no settings saved and no old notes starts from the defaults, and writes nothing", async () => {
    const { plugin, layout, notices } = load();
    await plugin.onload();
    try {
        assert.equal(window.plainday.Settings.get().invoices.lastNumber, 1000);
        assert.equal(window.plainday.Settings.saved, false);
        for (const name of STARTUP) window.plainday[name].invoke = async () => {};
        await layout[0]();
        assert.deepEqual(plugin.saved, [], "nothing to move, so no file written over one Sync may still bring");
        assert.deepEqual(notices, [], "no old notes, nothing to say");
    } finally {
        plugin.onunload();
    }
});

// A stand-in for Obsidian's Setting, enough for a row's render: its controls record their handlers
function standInSetting() {
    const listeners = {};
    const input = { value: "", rows: 0, inputMode: "", addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } };
    const control = {
        inputEl: input, handlers: {},
        setValue(v) { input.value = v; return this; }, getValue() { return input.value; },
        setPlaceholder(p) { input.placeholder = p; return this; }, addOptions(o) { this.options = o; return this; }, setTooltip() { return this; },
        onChange(fn) { this.handlers.change = fn; return this; }, setButtonText(t) { this.text = t; return this; }, onClick(fn) { this.handlers.click = fn; return this; },
    };
    const warnings = [];
    const links = {};
    const setting = {
        settingEl: { isConnected: true }, control, links,
        controlEl: {
            createEl(tag, { text }, cb) {
                const listeners = {};
                const el = { tag, text, addEventListener: (type, fn) => { listeners[type] = fn; } };
                cb?.(el);
                links[text] = () => { let stopped = false; listeners.click({ preventDefault: () => { stopped = true; } }); return stopped; };
                return el;
            },
            createSpan({ text }) { links[`span ${text}`] = null; },
        },
        descEl: { createDiv: () => ({ setText: (t) => warnings.push(t), toggleClass: () => {} }) },
        addText(cb) { cb(control); return this; }, addTextArea(cb) { cb(control); return this; }, addDropdown(cb) { cb(control); return this; },
        addToggle(cb) { cb(control); return this; },
        // Each button its own, by its text: { text, click, warning }
        buttons: {},
        addButton(cb) {
            const button = { setButtonText(t) { this.text = t; return this; }, onClick(fn) { this.click = fn; return this; },
                setWarning() { this.warning = true; return this; }, setCta() { return this; }, setTooltip() { return this; } };
            cb(button);
            setting.buttons[button.text] = button;
            return this;
        },
        type(v) { input.value = v; control.handlers.change(v); }, leave() { for (const fn of listeners.change ?? []) fn(); },
        tab() { for (const fn of listeners.keydown ?? []) fn({ key: "Tab" }); },
        warning: () => warnings.at(-1) ?? "",
    };
    return setting;
}

test("Settings → Plainday: its sections and rows, and the two checked fields save only when you leave them (OBS-281)", async () => {
    const stored = { invoices: { name: "Juniper Hale", folder: "Reference/Invoices", lastNumber: 1001 } };
    const { plugin, suggests, notices } = load(BUNDLE, { stored });
    plugin.app.vault.getAllFolders = () => [{ path: "Archive" }, { path: "Archive/Old" }, { path: "Business/Invoices" }, { path: "Config" }];
    const folders = new Set(["Reference/Invoices", "Business/Invoices"]);
    plugin.app.vault.getFolderByPath = (p) => (folders.has(p) ? { path: p } : null);
    plugin.app.vault.getRoot = () => ({ children: [] });
    await plugin.onload();
    try {
        const tab = plugin.tabs[0];
        const defs = tab.getSettingDefinitions();
        assert.deepEqual(defs.map((g) => [g.type, g.heading, g.items.map((i) => i.name)]), [
            ["group", undefined, ["Backup and transfer"]],
            ["group", "Invoices", ["Your name or company name", "Address", "Terms", "Note", "Invoice folder", "First invoice number"]],
            ["group", "Tables", ["Freeze rows and columns", "Freeze rows", "Freeze columns"]],
            ["group", "Editor", ["Keep the cursor after a list line's bullet or checkbox"]],
            ["group", "Calendars", ["Add calendar", "Sync range", "Private links"]],
        ]);
        assert.ok(!("heading" in defs[0]), "the top group has no heading");
        for (const g of defs) for (const i of g.items) {
            assert.ok(i.name, "every row has a name");
            assert.ok(!("desc" in i) || i.desc, `${i.name}: a description, or none at all`);
            assert.equal(typeof i.render, "function");
        }
        const descs = defs.flatMap((g) => g.items).filter((i) => !i.desc).map((i) => i.name);
        assert.deepEqual(descs, ["Your name or company name", "Address", "Freeze rows", "Freeze columns"]);
        const item = (name) => defs.flatMap((g) => g.items).find((i) => i.name === name);
        const draw = (name) => { const s = standInSetting(); const cleanup = item(name).render(s); return { s, cleanup }; };
        const saved = () => plugin.saved.at(-1)?.invoices;

        // Copy and Paste: two links at the top, as Style Settings draws Import and Export
        const top = draw("Backup and transfer");
        assert.deepEqual(Object.keys(top.s.links), ["Copy", "span |", "Paste"]);
        const copied = [];
        Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
        try {
            assert.equal(top.s.links.Copy(), true, "the link doesn't follow its href");
            await new Promise((r) => setTimeout(r, 0));
            assert.equal(copied.length, 1);
            assert.equal(JSON.parse(copied[0]).invoices.name, "Juniper Hale");
            assert.match(notices.at(-1), /^Copied\. It holds your invoice details/);
        } finally {
            delete globalThis.navigator.clipboard;
        }

        const folder = draw("Invoice folder");
        assert.equal(folder.s.control.inputEl.value, "Reference/Invoices");
        folder.s.type("Archiv");
        assert.deepEqual(plugin.saved, [], "typing saves nothing");
        folder.s.type("Archive/Invoices");
        assert.equal(folder.s.warning(), "Archive is already used by Plainday. Please choose another location.");
        folder.s.leave();
        assert.deepEqual(plugin.saved, [], "a refused value is never saved, nor the one before it");
        assert.equal(folder.s.control.inputEl.value, "Reference/Invoices", "and the field goes back to the saved folder on leaving it");
        folder.s.type("../x");
        assert.match(folder.s.warning(), /^Not used: it isn't a folder in the vault/);
        folder.s.type("Business/Invoices");
        folder.s.leave();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(saved()?.folder, "Business/Invoices", "saved on leaving the field");
        // Still typing when Obsidian draws the row again in place: nothing saved
        const count = plugin.saved.length;
        folder.s.type("Clients/Inv");
        folder.cleanup();
        assert.equal(plugin.saved.length, count);
        // The panel closing, the row already off the page: a value still waiting is saved
        folder.s.settingEl.isConnected = false;
        folder.cleanup();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(saved()?.folder, "Clients/Inv");
        // The folder list offers only folders the field takes, with Invoices first, and closes after a pick
        const suggest = suggests.at(-1);
        assert.deepEqual(suggest.getSuggestions(""), ["Invoices", "Business/Invoices"]);
        assert.deepEqual(suggest.getSuggestions("bus"), ["Business/Invoices"]);
        folder.s.settingEl.isConnected = true;
        suggest.picked("Business/Invoices");
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(saved()?.folder, "Business/Invoices", "a pick saves at once");
        assert.equal(suggest.closed, 1);
        assert.equal(folder.s.control.inputEl.value, "Business/Invoices");
        // Tab with the list open takes the folder it highlights; with it closed, what's typed, and a line
        // says a folder that isn't there yet will be made
        const row = (folder) => {
            const classes = new Set();
            const el = { isConnected: true, addClass: (c) => classes.add(c), hasClass: (c) => classes.has(c), createSpan: () => {} };
            suggest.renderSuggestion(folder, el);
            return { el, classes };
        };
        assert.deepEqual(suggest.getSuggestions("inv"), ["Invoices", "Business/Invoices"], "those that start with it first");
        const [rowA, rowB] = suggest.getSuggestions("inv").map(row);
        rowB.classes.add("is-selected");
        folder.s.type("inv");
        folder.s.tab();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(saved()?.folder, "Business/Invoices", "Tab takes the highlighted folder, not what's typed");
        assert.equal(folder.s.control.inputEl.value, "Business/Invoices");
        rowA.el.isConnected = rowB.el.isConnected = false;
        folder.s.type("Clients");
        folder.s.tab();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(saved()?.folder, "Clients", "the list closed: what's typed");
        assert.equal(folder.s.warning(), "“Clients” doesn't exist yet. Invoice will create it.");
        folder.s.type("");
        folder.s.leave();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(saved()?.folder, "", "clearing the field leaves no folder chosen");

        const first = draw("First invoice number");
        assert.equal(first.s.control.inputEl.value, "1001");
        first.s.type("2");
        first.s.type("");
        first.s.leave();
        assert.equal(window.plainday.Settings.get().invoices.firstNumber, 1001, "a blank or half-typed number is never kept");
        assert.match(first.s.warning(), /^Not used: it isn't a whole number from 1/);
        assert.equal(first.s.control.inputEl.value, "1001", "the field goes back to the saved number on leaving it");
        first.s.type("2001");
        first.s.leave();
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual([saved()?.firstNumber, saved()?.lastNumber], [2001, 2000], "typing a first number numbers from it");

        // Tables: the freezes show only while the switch is on, which freezes 1 and 1, and off unfreezes
        const visible = () => tab.getSettingDefinitions()[2].items.filter((i) => !i.visible || i.visible()).map((i) => i.name);
        const shown = tab.getSettingDefinitions()[2].items;
        assert.deepEqual(shown.filter((i) => !i.visible || i.visible()).map((i) => i.name), ["Freeze rows and columns"]);
        const sw = standInSetting();
        shown[0].render(sw);
        const rows = standInSetting();
        shown[1].render(rows);
        let refreshed = 0;
        tab.refreshDomState = () => { refreshed++; };
        sw.control.handlers.change(true);
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(plugin.saved.at(-1).tables, { freezeRows: 1, freezeColumns: 1 });
        assert.equal(rows.control.inputEl.value, "1", "the shown freeze follows");
        assert.ok(shown[1].visible() && shown[2].visible());
        sw.control.handlers.change(false);
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(plugin.saved.at(-1).tables, { freezeRows: 0, freezeColumns: 0 });
        assert.ok(!shown[1].visible());
        assert.equal(refreshed, 2, "Obsidian shows and hides them");
        assert.deepEqual(visible(), ["Freeze rows and columns"], "drawn again, the switch reads the saved freeze");
    } finally {
        plugin.onunload();
    }
});

test("Settings → Plainday → Calendars: Add calendar, the range, the help, then each account's calendars; Copy carries their links (OBS-282)", async () => {
    // Every link here is invented
    const STUDIO = "https://calendar.google.com/calendar/ical/studio-owner%40example.com/private-0000invented/basic.ics";
    const stored = { invoices: { name: "Juniper Hale" }, calendars: { range: "3 weeks", list: [
        { id: "studio0001", name: "Studio", account: "Work", addresses: ["studio-owner@example.com"], on: true },
        { id: "home000001", name: "Home", account: "Work", on: false },
        { id: "library001", name: "Library", account: "", on: true },
    ] } };
    const { plugin, notices } = load(BUNDLE, { stored });
    const secrets = new Map([["plainday-calendar-studio0001", STUDIO]]);
    plugin.app.secretStorage = { getSecret: (id) => secrets.get(id) ?? null, setSecret: (id, v) => { secrets.set(id, v); }, listSecrets: () => [...secrets.keys()] };
    await plugin.onload();
    try {
        const tab = plugin.tabs[0];
        let redrawn = 0;
        tab.update = () => { redrawn++; };
        const defs = tab.getSettingDefinitions();
        assert.deepEqual(defs.slice(4).map((g) => [g.heading, g.items.map((i) => [i.name, i.desc])]), [
            ["Calendars", [
                ["Add calendar", "Add another calendar by its private link."],
                ["Sync range", "How far ahead Sync calendars writes events into daily notes. Days beyond it are left as they are."],
                ["Private links", "Each calendar's link works like a password. It stays in this device's secret storage, never in a note or in Plainday's settings file."],
            ]],
            ["No account", [["Library", "Add link on this device: Edit, then paste it"]]],
            ["Work", [["Home", "Add link on this device: Edit, then paste it"], ["Studio", "Link on this device"]]],
        ], "accounts and calendars in alphabetical order, each saying whether this device has its link");
        const item = (group, name) => defs.find((g) => g.heading === group).items.find((i) => i.name === name);

        // The range: the seven choices, saved as chosen
        const range = standInSetting();
        item("Calendars", "Sync range").render(range);
        assert.deepEqual(Object.keys(range.control.options), ["1 week", "2 weeks", "3 weeks", "1 month", "2 months", "3 months", "6 months"]);
        assert.equal(range.control.inputEl.value, "3 weeks");
        range.control.handlers.change("1 week");
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(plugin.saved.at(-1).calendars.range, "1 week");
        assert.equal(window.plainday.Settings.rangeDays(), 7);

        // A calendar's switch, and Remove, which blanks its link on this device
        const studio = standInSetting();
        item("Work", "Studio").render(studio);
        assert.equal(studio.control.inputEl.value, true, "on");
        assert.deepEqual(Object.keys(studio.buttons), ["Edit", "Remove"]);
        assert.ok(studio.buttons.Remove.warning);
        studio.control.handlers.change(false);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(plugin.saved.at(-1).calendars.list.find((c) => c.id === "studio0001").on, false);

        // Copy: the links beside the settings, and a notice that says so
        const copied = [];
        Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
        try {
            const top = standInSetting();
            defs[0].items[0].render(top);
            top.links.Copy();
            await new Promise((r) => setTimeout(r, 0));
            assert.deepEqual(JSON.parse(copied[0]).links, { studio0001: STUDIO });
            assert.match(notices.at(-1), /^Copied\. It holds your calendar links, which work like passwords, and your invoice details/);
        } finally {
            delete globalThis.navigator.clipboard;
        }

        studio.buttons.Remove.click();
        await new Promise((r) => setTimeout(r, 0));
        assert.deepEqual(plugin.saved.at(-1).calendars.list.map((c) => c.name), ["Home", "Library"]);
        assert.equal(secrets.get("plainday-calendar-studio0001"), "");
        assert.equal(redrawn, 1, "the panel drawn again without it");
        for (const saved of plugin.saved) assert.ok(!JSON.stringify(saved).includes("private-0000"), "no link in the settings file");

        // With none left: the panel says so
        for (const id of ["home000001", "library001"]) await window.plainday.Settings.removeCalendar(id);
        assert.equal(tab.getSettingDefinitions()[4].items[0].desc, "No calendars are added yet. Add one by its private link.");
        assert.equal(tab.getSettingDefinitions().length, 5, "no account groups");
    } finally {
        plugin.onunload();
    }
});

test("no CustomJS hook or customJS is left in the bundle", () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    for (const p of [/["'`]customjs["'`]/, /\.customjs\b/, /\bcustomJS\b/]) {
        assert.doesNotMatch(text, p);
    }
    assert.doesNotMatch(text, /disablePlugin|enablePlugin/, "UpdateObsidianPM's offer to reload CustomJS is left out");
});

test("the bundle names no folder on the machine that built it, so a build anywhere matches the release (OBS-230)", () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    assert.ok(!text.includes(ROOT), `main.js names ${ROOT}`);
    assert.match(text, /^\/\/ plugin\/src\/commands\/schedule\.js$/m, "each class by its path in the repository");
});

test("unloading runs every deconstructor and removes the global", async () => {
    const { plugin } = load();
    await plugin.onload();
    const ran = [];
    for (const name of CLASS_NAMES) {
        if (typeof window.plainday[name].deconstructor === "function") window.plainday[name].deconstructor = () => ran.push(name);
    }
    window.plainday.TrailingLinks.deconstructor = () => { ran.push("TrailingLinks"); throw new Error("invented failure"); };
    plugin.onunload();
    assert.ok(ran.includes("TrailingLinks") && ran.includes("CheckOff"), "one failing doesn't stop the rest");
    assert.ok(STARTUP.every((n) => typeof window.plainday?.[n] === "undefined"));
    assert.equal(window.plainday, undefined);
});

// A class written the way the real ones are, using what the host gives the editor features and the
// listeners, and what they import from Obsidian and CodeMirror
const PROBE = `import { foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { app, plainday } from "../host.js";

export default class Probe {
    on() { return !!plainday.plugin; }
    add(extension) { plainday.plugin.registerEditorExtension(extension); }
    others() { return plainday; }
    theApp() { return app; }
    editor() { return { EditorView, EditorState, foldedRanges }; }
    notice() { return Notice; }
    async invoke() {}
}
`;

test("in the bundle, a class reaches Plainday through the host's plainday, and Obsidian and CodeMirror through its imports", async () => {
    const src = copySrc();
    fs.writeFileSync(path.join(src, "shared/probe.js"), PROBE);
    const index = path.join(src, "shared/index.js");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace(/^export const CLASSES = \{/m, 'import Probe from "./probe.js";\n\nexport const CLASSES = {\n    Probe,'));
    const out = path.join(src, "main.js.out");
    await build({ src, outfile: out, logLevel: "silent" });
    const { plugin } = load(out);
    await plugin.onload();
    const probe = window.plainday.Probe;
    assert.equal(probe.on(), true, "loaded");
    probe.add("an extension");
    assert.deepEqual(plugin.extensions, ["an extension"], "through the plugin, which Obsidian undoes on unload");
    assert.equal(probe.others(), window.plainday, "the bundle's own classes");
    assert.equal(probe.theApp(), plugin.app, "the plugin's own app");
    const { EditorView, EditorState, foldedRanges } = probe.editor();
    assert.equal(EditorView, CODEMIRROR["@codemirror/view"].EditorView, "Obsidian's own CodeMirror, not a copy");
    assert.equal(EditorState, CODEMIRROR["@codemirror/state"].EditorState);
    assert.equal(foldedRanges, CODEMIRROR["@codemirror/language"].foldedRanges);
    assert.equal(typeof probe.notice(), "function", "Obsidian's own Notice");
    plugin.onunload();
    assert.equal(probe.on(), false, "a listener left over sees Plainday is gone");
    assert.throws(() => probe.add("another"), TypeError, "nothing to add an extension to");
});

test("the three editor features import CodeMirror, and no class file requires it", () => {
    for (const f of classFiles) {
        assert.doesNotMatch(read(f), /require\(\s*["'`]@codemirror\//, f);
    }
    for (const f of ["startup/trailingLinks.js", "startup/listCursor.js", "startup/checkOff.js"]) {
        assert.match(read(f), /^import \{[^}]+\} from "@codemirror\/view";$/m, f);
    }
});

test("the build stops on a new CustomJS line in a class file, and names the file and line", async () => {
    const copy = copySrc();
    const file = path.join(copy, "startup/syncArea.js");
    const source = fs.readFileSync(file, "utf8");
    const at = source.lastIndexOf("\n}");
    const line = source.slice(0, at).split("\n").length + 1;

    for (const planted of [
        'app.plugins.enabledPlugins.has("customjs")',
        "app.plugins.plugins.customjs.registerEditorExtension([])",
        "globalThis.customJS?.Schedule",
        "window.customJS",
        "customJS.Schedule",
        'app.plugins.getPlugin("customjs")',
        'app.commands.executeCommandById("customjs:invoke-Schedule")',
    ]) {
        fs.writeFileSync(file, `${source.slice(0, at)}\n    planted() { return ${planted}; }${source.slice(at)}`);
        await assert.rejects(build({ src: copy, outfile: path.join(copy, "main.js.out"), logLevel: "silent" }),
            (e) => {
                assert.match(e.message, new RegExp(`startup/syncArea\\.js:${line} reaches for CustomJS: planted\\(\\)`), planted);
                return true;
            });
    }
    assert.ok(!fs.existsSync(path.join(copy, "main.js.out")), "no bundle from a failed build");
});

test("the build stops on a class file without the shape, and names the file and line", async () => {
    const copy = copySrc();
    const file = path.join(copy, "commands/plan.js");
    const source = fs.readFileSync(file, "utf8");
    const lines = source.split("\n");
    const classLine = lines.findIndex((l) => l.startsWith("export default class")) + 1;
    const last = lines.length;
    for (const [planted, at, pattern] of [
        [(s) => `${s}\nexport const second = 1;\n`, last + 1, /holds more than its class/],
        [(s) => `${s}\nconst after = 1;\n`, last + 1, /holds more than its class/],
        [(s) => `import { Schedule } from "./schedule.js";\n${s}`, 1, /imports from "\.\/schedule\.js"/],
        [(s) => `import Schedule from "./schedule.js";\n${s}`, 1, /no default import/],
        [(s) => `import { Notice as Toast } from "obsidian";\n${s}`, 1, /no renaming/],
        [(s) => `const before = 1;\n${s}`, 1, /comes before the class/],
        [(s) => s.replace("export default class", "class"), null, /no `export default class <Name>`/],
    ]) {
        fs.writeFileSync(file, planted(source));
        await assert.rejects(build({ src: copy, outfile: path.join(copy, "main.js.out"), logLevel: "silent" }),
            (e) => {
                assert.match(e.message, new RegExp(`commands/plan\\.js${at ? `:${at}` : ""}`), String(pattern));
                assert.match(e.message, pattern);
                return true;
            });
    }
    assert.ok(classLine > 1, "plan.js imports before its class");
});

test("main.js starts with ical.js's license notice, and holds ical.js", async () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "ical.js", "package.json"), "utf8"));
    const first = text.split("\n")[0];
    assert.ok(first.startsWith(`/*! Plainday bundles ical.js ${version} (https://github.com/kewisch/ical.js)`), first);
    assert.match(first, /Mozilla Public License, v\. 2\.0 \(https:\/\/mozilla\.org\/MPL\/2\.0\/\)/);
    assert.match(text, /node_modules\/ical\.js\/dist\/ical\.js/, "esbuild's comment naming the bundled file");
    // In the calendar reader's worker, which starts with the notice too, and which main.js carries
    const { code } = await workerSource();
    assert.ok(code.startsWith(first), code.slice(0, 120));
    assert.match(code, /self\.onmessage/);
    // main.js carries it as text, as esbuild writes a string: the notice a second time, and the
    // worker's message handler
    assert.equal(text.split("Plainday bundles ical.js").length - 1, 2, "the notice, in main.js and in the worker's script");
    assert.match(text, /self\.onmessage = \(event\) =>/);
});

test("a worker that doesn't build stops the build, and names its files for npm run dev to watch", async () => {
    const copy = copySrc();
    const file = path.join(copy, "worker", "calendarRead.js");
    fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")}\nexport const broken = ;\n`);
    await assert.rejects(build({ src: copy, outfile: path.join(copy, "main.js.out"), logLevel: "silent" }));
    let load;
    workerPlugin(copy).setup({ onResolve() {}, onLoad(_, fn) { load = fn; } });
    const result = await load({ path: "calendar-worker", namespace: "plainday-worker" });
    assert.ok(result.errors.length, "the worker's error");
    assert.ok(result.watchFiles.includes(file), "watched, so fixing it builds again");
});

test("every class file passes the checks, and comments about CustomJS are left alone", () => {
    assert.equal(classFiles.length, 31);
    for (const f of classFiles) {
        assert.deepEqual(check(f, read(f)), [], f);
        assert.deepEqual(shapeProblems(f, read(f)), [], f);
    }
    assert.deepEqual(check("x.js", "class X {\n    // app.plugins.getPlugin(\"customjs\") is CustomJS's\n}\n"), []);
    assert.equal(check("x.js", "class X {\n    a() { return window.customJS; }\n}\n").length, 1);
});

test("npm refuses to install in a folder Obsidian has opened as a vault, from the root or plugin/", async () => {
    const { spawnSync } = await import("node:child_process");
    const repo = fs.mkdtempSync(path.join(tmp, "repo-"));
    fs.mkdirSync(path.join(repo, "plugin"));
    fs.copyFileSync(new URL("../preinstall.mjs", import.meta.url), path.join(repo, "plugin/preinstall.mjs"));
    const env = { ...process.env, CI: "", PLAINDAY_NPM_IN_VAULT: "" };
    const run = (cwd) => spawnSync(process.execPath, [path.join(repo, "plugin/preinstall.mjs")], { cwd, env, encoding: "utf8" });
    assert.equal(run(repo).status, 0, "a worktree or a fresh clone: never opened");
    fs.mkdirSync(path.join(repo, ".obsidian"));
    fs.writeFileSync(path.join(repo, ".obsidian/workspace.json"), "{}");
    for (const cwd of [repo, path.join(repo, "plugin")]) {
        const r = run(cwd);
        assert.equal(r.status, 1, cwd);
        assert.match(r.stderr, /Obsidian opens this folder as a vault/);
    }
    assert.equal(spawnSync(process.execPath, [path.join(repo, "plugin/preinstall.mjs")], { cwd: repo, env: { ...env, CI: "true" } }).status, 0, "CI");
});
