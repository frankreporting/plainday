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

// Every group in a panel's definitions, a page's own groups included (the calendar list)
const groupsOf = (defs) => defs.flatMap((g) => [g, ...groupsOf((g.items ?? []).filter((i) => i.type === "page").flatMap((i) => i.items))]);

// Stand-ins for the elements and components a dialog and the panel's older drawing (display()) use:
// enough to type into a field, click a button and read what's shown. `fake.focused` is the element
// last focused; `fake.modals` and `fake.groups` the dialogs opened and the groups drawn.
const fake = { focused: null, modals: [], groups: [] };
class FakeEl {
    constructor(tag = "div") {
        this.tag = tag; this.children = []; this.text = ""; this.classes = new Set(); this.hidden = false;
        this.listeners = {}; this.attrs = {}; this.isConnected = true; this.value = ""; this.disabled = false;
    }
    createEl(tag, o = {}, cb) {
        const e = new FakeEl(tag);
        if (o.text) e.text = o.text;
        for (const c of String(o.cls ?? "").split(" ").filter(Boolean)) e.classes.add(c);
        this.children.push(e);
        cb?.(e);
        return e;
    }
    createDiv(o, cb) { return this.createEl("div", o, cb); }
    createSpan(o, cb) { return this.createEl("span", o, cb); }
    appendText(t) { this.text += t; }
    setText(t) { this.text = t; }
    addClass(c) { this.classes.add(c); }
    hasClass(c) { return this.classes.has(c); }
    toggleClass(c, on) { if (on) this.classes.add(c); else this.classes.delete(c); }
    setAttribute(k, v) { this.attrs[k] = v; }
    hide() { this.hidden = true; }
    show() { this.hidden = false; }
    toggle(on) { this.hidden = !on; }
    empty() { this.children = []; this.text = ""; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    fire(type, ev = {}) { for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {}, ...ev }); }
    focus() { fake.focused = this; }
    // Every element under it, itself first
    all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}
class FakeText {
    constructor(el) { this.inputEl = el.createEl("input"); this.inputEl.component = this; }
    setValue(v) { this.inputEl.value = v; return this; }
    getValue() { return this.inputEl.value; }
    setPlaceholder(p) { this.inputEl.placeholder = p; return this; }
    onChange(fn) { this.inputEl.addEventListener("input", () => fn(this.inputEl.value)); return this; }
    setDisabled(d) { this.inputEl.disabled = d; return this; }
    // As a person types: the value, then Obsidian's change
    type(v) { this.inputEl.value = v; this.inputEl.fire("input"); }
}
class FakeButton {
    constructor(el) { this.buttonEl = el.createEl("button"); }
    setButtonText(t) { this.buttonEl.text = t; return this; }
    setCta() { return this; }
    setWarning() { this.warning = true; return this; }
    setTooltip() { return this; }
    onClick(fn) { this.buttonEl.addEventListener("click", fn); return this; }
    setDisabled(d) { this.buttonEl.disabled = d; return this; }
}
// As Obsidian's: setValue runs the change callback when the value changes
class FakeToggle {
    constructor(el) { this.toggleEl = el.createEl("toggle"); }
    setValue(v) {
        const changed = this.value !== undefined && this.value !== v;
        this.value = v;
        if (changed) this.changed?.(v);
        return this;
    }
    setTooltip() { return this; }
    onChange(fn) { this.changed = fn; return this; }
}
class FakeDropdown {
    constructor(el) { this.selectEl = el.createEl("select"); }
    addOptions(o) { this.options = o; return this; }
    setValue(v) { this.value = v; return this; }
    onChange(fn) { this.changed = fn; return this; }
}
class FakeSetting {
    constructor(containerEl) {
        this.settingEl = containerEl.createDiv();
        this.nameEl = this.settingEl.createDiv();
        this.descEl = this.settingEl.createDiv();
        this.controlEl = this.settingEl.createDiv();
        this.components = [];
    }
    setName(n) { this.name = n; return this; }
    setDesc(d) { this.descEl.text = d; return this; }
    add(C, cb) { const c = new C(this.controlEl); this.components.push(c); cb(c); return this; }
    addText(cb) { return this.add(FakeText, cb); }
    addTextArea(cb) { return this.add(FakeText, cb); }
    addButton(cb) { return this.add(FakeButton, cb); }
    addToggle(cb) { return this.add(FakeToggle, cb); }
    addDropdown(cb) { return this.add(FakeDropdown, cb); }
    button(text) { return this.components.find((c) => c instanceof FakeButton && c.buttonEl.text === text); }
}
class FakeGroup {
    constructor(el) { this.el = el.createDiv(); this.rows = []; fake.groups.push(this); }
    setHeading(h) { this.heading = h; return this; }
    addSetting(cb) { const s = new FakeSetting(this.el); cb(s); this.rows.push(s); return this; }
}
class FakeModal {
    constructor(app) { this.app = app; this.contentEl = new FakeEl(); this.modalEl = new FakeEl(); }
    setTitle(t) { this.title = t; return this; }
    open() { fake.modals.push(this); this.isOpen = true; this.onOpen(); }
    close() { this.isOpen = false; this.onClose?.(); }
    // In this dialog: the settings by name, the text fields, buttons, and what it says
    settings() { return this.contentEl.all().filter((e) => e.setting).map((e) => e.setting); }
    field(name) { return this.settings().find((s) => s.name === name)?.controlEl.all().find((e) => e.component)?.component; }
    buttons() { return this.contentEl.all().filter((e) => e.tag === "button"); }
    said() { return this.contentEl.all().find((e) => e.hasClass("plainday-calendar-said"))?.text ?? ""; }
}

// Runs a built main.js the way Obsidian's plugin loader does, against stand-ins: `Plugin` records
// what the plugin adds and saves, `Notice` what it shows, and the app holds the layout-ready callbacks.
// `stored` is what loadData gives, null for a device with no settings saved. CodeMirror's modules come
// from the loader too, as Obsidian gives them to every plugin.
function load(file = BUNDLE, { stored = null, api13 = true } = {}) {
    const notices = [];
    fake.focused = null;
    fake.modals = [];
    fake.groups = [];
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
    class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new FakeEl(); } }
    // A Setting made in a dialog, findable from its element
    class Setting extends FakeSetting { constructor(el) { super(el); this.settingEl.setting = this; } }
    const suggests = [];
    class AbstractInputSuggest {
        constructor(app, el) { this.app = app; this.el = el; this.closed = 0; suggests.push(this); }
        onSelect(cb) { this.picked = cb; return this; }
        close() { this.closed++; }
    }
    const module = { exports: {} };
    const req = (id) => {
        if (id === "obsidian") {
            return { Plugin, Notice, PluginSettingTab, AbstractInputSuggest, Modal: FakeModal, Setting, SettingGroup: FakeGroup,
                TextComponent: FakeText, ButtonComponent: FakeButton, TextAreaComponent: FakeText, requireApiVersion: () => api13 };
        }
        if (CODEMIRROR[id]) return CODEMIRROR[id];
        throw new Error(`unexpected require(${id}) while loading`);
    };
    globalThis.window = globalThis;
    new Function("module", "exports", "require", fs.readFileSync(file, "utf8"))(module, module.exports, req);
    const layout = [];
    // This vault's local storage holds its key for its calendar links' names: "vault001"
    const local = new Map([["plainday-calendar-key", "vault001"]]);
    const app = { workspace: { onLayoutReady: (cb) => layout.push(cb) }, vault: { getFileByPath: () => null },
        loadLocalStorage: (k) => local.get(k) ?? null, saveLocalStorage: (k, v) => { local.set(k, v); } };
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
            ["group", "Calendars", ["Add calendar", "Sync range", "Calendar list"]],
        ]);
        assert.ok(!("heading" in defs[0]), "the top group has no heading");
        for (const g of defs) for (const i of g.items) {
            assert.ok(i.name, "every row has a name");
            assert.ok(!("desc" in i) || i.desc, `${i.name}: a description, or none at all`);
            assert.equal(typeof (i.type === "page" ? i.items : i.render), i.type === "page" ? "object" : "function");
        }
        const descs = defs.flatMap((g) => g.items).filter((i) => !i.desc).map((i) => i.name);
        assert.deepEqual(descs, ["Your name or company name", "Address", "Freeze rows", "Freeze columns", "Add calendar", "Calendar list"]);
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
        { id: "studio0001", name: "Studio", account: "Work", address: "studio-owner@example.com", on: true },
        { id: "home000001", name: "Home", account: "Work", on: false },
        { id: "library001", name: "Library", account: "", on: true },
    ] } };
    const { plugin, notices } = load(BUNDLE, { stored });
    const secrets = new Map([["plainday-calendar-vault001-studio0001", STUDIO]]);
    plugin.app.secretStorage = { getSecret: (id) => secrets.get(id) ?? null, setSecret: (id, v) => { secrets.set(id, v); }, listSecrets: () => [...secrets.keys()] };
    await plugin.onload();
    try {
        const tab = plugin.tabs[0];
        let redrawn = 0;
        tab.update = () => { redrawn++; };
        const defs = tab.getSettingDefinitions();
        assert.deepEqual(defs.slice(4).map((g) => [g.heading, g.items.map((i) => [i.type ?? "row", i.name, i.desc])]), [
            ["Calendars", [
                ["row", "Add calendar", undefined],
                ["row", "Sync range", "How far ahead to write events into daily notes. Days beyond it are left as they are."],
                ["page", "Calendar list", undefined],
            ]],
        ]);
        // The calendar list: a page of its own, each account's calendars on it
        const page = defs[4].items[2];
        assert.deepEqual([page.displayValue, page.visible()], ["3 calendars", true]);
        assert.deepEqual(page.items.map((g) => [g.heading, g.items.map((i) => [i.name, i.desc])]), [
            ["No account", [["Library", "Add link on this device: Edit, then paste it"]]],
            ["Work", [["Home", "Add link on this device: Edit, then paste it"], ["Studio", undefined]]],
        ], "accounts and calendars in alphabetical order, each saying when this device has no link");
        const item = (group, name) => groupsOf(defs).find((g) => g.heading === group).items.find((i) => i.name === name);

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
        assert.equal(secrets.get("plainday-calendar-vault001-studio0001"), "");
        assert.equal(redrawn, 1, "the panel drawn again without it");
        for (const saved of plugin.saved) assert.ok(!JSON.stringify(saved).includes("private-0000"), "no link in the settings file");

        // With none left: no calendar list
        for (const id of ["home000001", "library001"]) await window.plainday.Settings.removeCalendar(id);
        assert.equal(tab.getSettingDefinitions()[4].items[2].visible(), false);
    } finally {
        plugin.onunload();
    }
});

// The Calendars section loaded with `stored` settings, a stand-in secret storage and a check that waits
// to be answered: `answer(result)` settles the check in flight
async function calendarPanel(stored, secrets = new Map()) {
    const loaded = load(BUNDLE, { stored });
    const { plugin } = loaded;
    plugin.app.secretStorage = { getSecret: (id) => secrets.get(id) ?? null, setSecret: (id, v) => { secrets.set(id, v); }, listSecrets: () => [...secrets.keys()] };
    await plugin.onload();
    const tab = plugin.tabs[0];
    let redrawn = 0;
    tab.update = () => { redrawn++; };
    const checks = [];
    window.plainday.CalendarFeed.check = (link) => new Promise((resolve) => { checks.push({ link, resolve }); });
    const answer = async (result) => { checks.at(-1).resolve(result); await new Promise((r) => setTimeout(r, 0)); };
    const row = (group, name) => {
        const item = groupsOf(tab.getSettingDefinitions()).find((g) => g.heading === group).items.find((i) => i.name === name);
        const setting = new FakeSetting(new FakeEl());
        item.render(setting);
        return setting;
    };
    const click = async (button) => { button.fire("click"); await new Promise((r) => setTimeout(r, 0)); };
    return { ...loaded, secrets, tab, checks, answer, row, click, redrawn: () => redrawn };
}
const GOOGLE_LINK = "https://calendar.google.com/calendar/ical/studio-owner%40example.com/private-0000invented/basic.ics";

test("Add calendar: the link checked once, then its name, account and your address filled in; a link that fails, or that another calendar has, isn't added (OBS-282)", async () => {
    const p = await calendarPanel({ invoices: { name: "Juniper Hale" } });
    try {
        // Its description: "Add using private calendar links", the link opening How to get the links
        const addRow = p.row("Calendars", "Add calendar");
        const linkEl = addRow.descEl.children.find((e) => e.tag === "a");
        assert.deepEqual([addRow.descEl.text, linkEl.text, linkEl.hasClass("plainday-link")], ["Add using ", "private calendar links", true]);
        linkEl.fire("click");
        assert.equal(fake.modals.at(-1).title, "How to get the links");
        fake.modals.at(-1).close();
        await p.click(p.row("Calendars", "Add calendar").button("Add calendar").buttonEl);
        const dialog = fake.modals.at(-1);
        assert.equal(dialog.title, "Add calendar");
        const link = dialog.field("Private link");
        assert.ok(link.inputEl.hasClass("plainday-masked"), "masked by its style");
        assert.notEqual(link.inputEl.type, "password", "not a password, so no password manager offers to keep it");
        assert.equal(link.inputEl.attrs["data-1p-ignore"], "true");
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(fake.focused, link.inputEl, "the cursor in the link field");
        // "Where to find it", in the link color, opens the help: the note on links first, then each
        // provider, then what doesn't work
        const where = dialog.contentEl.all().find((e) => e.tag === "a");
        assert.deepEqual([where.text, where.hasClass("plainday-link")], ["Where to find it", true]);
        where.fire("click");
        const help = fake.modals.at(-1);
        assert.equal(help.title, "How to get the links");
        const [note, list, limits] = help.contentEl.children;
        assert.deepEqual([note.children[0].tag, note.children[0].text, note.text], ["strong", "NOTE:",
            " Treat calendar links like a password. If one leaks, reset at the source and get a new link. To sync a calendar that was shared with you, you'll need to ask the owner for the link."]);
        assert.deepEqual(list.children.map((li) => li.children[0].text), ["Google Calendar", "iCloud", "Outlook", "A subscribed calendar"]);
        assert.equal(limits.text, "Also note that a Google Workspace or Microsoft 365 admin can disable private links.");
        help.close();
        const details = dialog.field("Name").inputEl;
        const go = () => dialog.buttons().find((b) => b.classes.size === 0 && b.text !== "Cancel");
        const shown = () => !dialog.settings().find((s) => s.name === "Name").settingEl.hidden && !dialog.contentEl.all().some((e) => e.hidden && e.all().includes(details));
        assert.equal(go().text, "Check link");
        assert.equal(shown(), false, "the name, account and address wait for the link");

        link.type("Studio's calendar");
        await p.click(go());
        assert.match(dialog.said(), /^That isn't a link\. A calendar's private link starts with https:\/\/ or webcal:\/\/\.$/);
        link.type("http://example.org/cal.ics");
        await p.click(go());
        assert.match(dialog.said(), /^That isn't a link/, "http:// would send it unencrypted");
        assert.equal(p.checks.length, 0, "neither is downloaded");

        link.type(GOOGLE_LINK);
        await p.click(go());
        assert.equal(dialog.said(), "Checking the link…");
        assert.equal(link.inputEl.disabled, true, "no typing over the link while it's checked");
        assert.equal(p.checks[0].link, GOOGLE_LINK);
        await p.answer({ name: "Studio" });
        assert.equal(link.inputEl.disabled, false);
        assert.equal(dialog.said(), "");
        assert.equal(shown(), true);
        assert.deepEqual([dialog.field("Name").getValue(), dialog.field("Account").getValue(), dialog.field("Email address for this calendar").getValue()],
            ["Studio", "Google", "studio-owner@example.com"]);
        assert.equal(go().text, "Add calendar");

        // A link pasted into the name is refused; one pasted as the address isn't an address
        dialog.field("Name").type(GOOGLE_LINK);
        await p.click(go());
        assert.match(dialog.said(), /^That's a link: paste it into the link field/);
        dialog.field("Name").type("Studio");
        dialog.field("Email address for this calendar").type(GOOGLE_LINK.replace("%40", "@"));
        await p.click(go());
        assert.equal(dialog.settings().find((s) => s.name === "Email address for this calendar").descEl.all().find((e) => e.hasClass("mod-warning")).text, "That isn't an email address.", "a link never shown back");
        assert.deepEqual(p.plugin.saved, []);
        dialog.field("Email address for this calendar").type("studio-owner@example.com");
        dialog.field("Account").type("Work");
        await p.click(go());
        assert.equal(dialog.isOpen, false);
        const saved = p.plugin.saved.at(-1).calendars.list;
        assert.deepEqual(saved.map(({ name, account, address, on }) => ({ name, account, address, on })), [{ name: "Studio", account: "Work", address: "studio-owner@example.com", on: true }]);
        assert.equal(p.secrets.get(`plainday-calendar-vault001-${saved[0].id}`), GOOGLE_LINK);
        assert.equal(p.redrawn(), 1, "the panel drawn again with it");
        for (const s of p.plugin.saved) assert.ok(!JSON.stringify(s).includes("private-0000"), "no link in the settings file");

        // The same link again: which calendar has it, with no download
        await p.click(p.row("Calendars", "Add calendar").button("Add calendar").buttonEl);
        const again = fake.modals.at(-1);
        again.field("Private link").type(GOOGLE_LINK.replace("https://", "webcal://"));
        await p.click(again.buttons().find((b) => b.text === "Check link"));
        assert.equal(again.said(), "Studio already has that link.");
        assert.equal(p.checks.length, 1);

        // A link that fails says why, and adds nothing; a link changed after it read is checked again
        again.field("Private link").type("https://example.org/gone.ics");
        await p.click(again.buttons().find((b) => b.text === "Check link"));
        await p.answer({ problem: "dead" });
        assert.equal(again.said(), "That link stopped working: it was reset or unpublished. Copy the calendar's link again.");
        for (const [problem, text] of [["unreachable", /^Couldn't reach that link/], ["unreadable", /^That link isn't a calendar\.$/], ["slow", /^That calendar took too long to read\.$/]]) {
            await p.click(again.buttons().find((b) => b.text === "Check link"));
            await p.answer({ problem });
            assert.match(again.said(), text);
        }
        await p.click(again.buttons().find((b) => b.text === "Check link"));
        await p.answer({ name: "" });
        assert.equal(again.field("Account").getValue(), "", "any other server suggests no account");
        assert.equal(again.field("Email address for this calendar").getValue(), "");
        again.field("Private link").type("https://example.org/other.ics");
        assert.ok(again.buttons().some((b) => b.text === "Check link"), "to be checked again");
        // Closed while a check runs: nothing is added
        await p.click(again.buttons().find((b) => b.text === "Check link"));
        again.close();
        await p.answer({ name: "Other" });
        assert.equal(window.plainday.Settings.get().calendars.list.length, 1);
    } finally {
        p.plugin.onunload();
    }
});

test("Edit: name, account and address saved; a new link checked, then kept on this device; a calendar with no link here starts in the link field (OBS-282)", async () => {
    const stored = { calendars: { list: [{ id: "home000001", name: "Home", account: "iCloud" }, { id: "studio0001", name: "Studio", account: "Work" }] } };
    const p = await calendarPanel(stored, new Map([["plainday-calendar-vault001-studio0001", "https://example.org/studio.ics"]]));
    try {
        await p.click(p.row("iCloud", "Home").button("Edit").buttonEl);
        const dialog = fake.modals.at(-1);
        assert.equal(dialog.title, "Edit Home");
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(fake.focused, dialog.field("New link").inputEl, "no link here: the cursor in the link field");
        assert.match(dialog.settings().find((s) => s.name === "New link").descEl.text, /^This device has no link for it yet\./);
        dialog.field("Email address for this calendar").type("Home@Example.com, desk@example.org");
        await p.click(dialog.buttons().find((b) => b.text === "Save"));
        assert.equal(dialog.isOpen, true, "one address only");
        dialog.field("Email address for this calendar").type("Home@Example.com");
        await p.click(dialog.buttons().find((b) => b.text === "Save"));
        assert.equal(dialog.isOpen, false);
        assert.equal(p.plugin.saved.at(-1).calendars.list[0].address, "home@example.com");
        assert.equal(p.secrets.get("plainday-calendar-vault001-home000001"), undefined, "a blank link field leaves the link as it is");

        // A new Google link: checked, kept, and your address filled in from it while blank
        await p.click(p.row("Work", "Studio").button("Edit").buttonEl);
        const studio = fake.modals.at(-1);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(fake.focused, studio.field("Name").inputEl, "a link here: the cursor in the name");
        assert.match(studio.settings().find((s) => s.name === "New link").descEl.text, /^This calendar is already linked\. Leave blank or paste a new link to replace it\. $/);
        assert.equal(studio.settings().find((s) => s.name === "Email address for this calendar").descEl.text, "", "no description");
        studio.field("New link").type(GOOGLE_LINK);
        await p.click(studio.buttons().find((b) => b.text === "Save"));
        assert.equal(studio.said(), "Checking the link…");
        assert.equal(studio.field("New link").inputEl.disabled, true);
        await p.answer({ name: "Something else" });
        assert.equal(studio.isOpen, false);
        assert.equal(p.secrets.get("plainday-calendar-vault001-studio0001"), GOOGLE_LINK);
        const after = p.plugin.saved.at(-1).calendars.list.find((c) => c.id === "studio0001");
        assert.deepEqual([after.name, after.address], ["Studio", "studio-owner@example.com"], "the name stays yours");
        for (const s of p.plugin.saved) assert.ok(!JSON.stringify(s).includes("private-0000"));
    } finally {
        p.plugin.onunload();
    }
});

test("a calendar's switch that can't be saved goes back once, and a calendar gone from the list draws the panel again (OBS-282)", async () => {
    const stored = { calendars: { list: [{ id: "studio0001", name: "Studio", account: "Work", on: true }] } };
    const p = await calendarPanel(stored);
    try {
        const row = p.row("Work", "Studio");
        const toggle = row.components.find((c) => c instanceof FakeToggle);
        // Sync brought another device's settings, without this calendar, while the panel was open
        window.plainday.Settings.get().calendars.list = [];
        toggle.setValue(false);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(toggle.value, true, "back as it was");
        assert.equal(p.notices.filter((n) => n.startsWith("Couldn't save")).length, 1, "once, not over and over");
        assert.equal(p.redrawn(), 1);
    } finally {
        p.plugin.onunload();
    }
});

test("Edit: a name typed while a new link is checked is the one saved; repeated names and an account named like a section are told apart (OBS-282)", async () => {
    const stored = { calendars: { list: [
        { id: "cal0000001", name: "Calendar", account: "iCloud" }, { id: "cal0000002", name: "Calendar", account: "iCloud" },
        { id: "cal0000003", name: "Calendar (2)", account: "iCloud" },
        { id: "inv0000001", name: "Billing", account: "Invoices" },
    ] } };
    const p = await calendarPanel(stored);
    try {
        const defs = p.tab.getSettingDefinitions();
        assert.deepEqual(defs[4].items[2].items.map((g) => [g.heading, g.items.map((i) => i.name)]), [["iCloud", ["Calendar", "Calendar (2)", "Calendar (2) (2)"]], ["Invoices calendars", ["Billing"]]]);
        await p.click(p.row("iCloud", "Calendar (2)").button("Edit").buttonEl);
        const dialog = fake.modals.at(-1);
        dialog.field("New link").type("https://example.org/new.ics");
        await p.click(dialog.buttons().find((b) => b.text === "Save"));
        dialog.field("Name").type("Family");
        await p.answer({ name: "Ignored" });
        assert.equal(dialog.isOpen, false);
        assert.equal(window.plainday.Settings.calendar("cal0000002").name, "Family");
        assert.equal(window.plainday.Settings.link("cal0000002"), "https://example.org/new.ics");
    } finally {
        p.plugin.onunload();
    }
});

test("Settings → Plainday on an Obsidian before 1.13: display() draws the Calendars section and each account's calendars", async () => {
    const stored = { calendars: { list: [{ id: "studio0001", name: "Studio", account: "Work" }] } };
    const { plugin } = load(BUNDLE, { stored, api13: false });
    plugin.app.secretStorage = { getSecret: () => null, setSecret: () => {}, listSecrets: () => [] };
    await plugin.onload();
    try {
        plugin.tabs[0].display();
        assert.deepEqual(fake.groups.slice(-2).map((g) => [g.heading, g.rows.map((r) => r.name)]),
            [["Calendars", ["Add calendar", "Sync range"]], ["Work", ["Studio"]]]);
        assert.equal(fake.groups.at(-1).rows[0].descEl.text, "Add link on this device: Edit, then paste it");
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
