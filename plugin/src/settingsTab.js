// Settings → Plainday (OBS-80, OBS-281): the panel that shows Plainday's settings, which
// shared/settings.js keeps, loads and saves. It sits beside main.js, since Plainday makes it with
// itself (addSettingTab), and it isn't one of the classes Plainday makes by name.
//
// The panel is one list of sections, each a heading and its rows (sections()). Obsidian 1.13 and later
// draw it from that list, as setting definitions, and find each row in the settings search
// (getSettingDefinitions); an older Obsidian, down to the manifest's 1.11.4, calls display(), which
// draws the same list itself with Setting and SettingGroup. Each row draws its own control (`render`).
//
// Each change is saved as it's made. The invoice folder and the first invoice number are checked as you
// type and saved when you leave the field (or the panel closes), so a value on its way to another one
// (`Ref` on the way to `Reference/Invoices`) is never kept. A value that doesn't read (a folder outside
// the vault or in Archive, a number that isn't one) is refused with a line under the field, and on
// leaving it the field goes back to the saved value.
//
// The sections, in order: Copy and Paste at the top, as links (for a backup, or another device), then
// Invoices, Tables (a switch, then the two freezes while it's on) and Editor. OBS-282 adds Calendars and
// OBS-283 Folders.
import { AbstractInputSuggest, ButtonComponent, Modal, Notice, PluginSettingTab, requireApiVersion, SettingGroup, TextAreaComponent } from "obsidian";
import { plainday } from "./host.js";

/** @typedef {ReturnType<import("./shared/settings.js").default["defaults"]>} Values */
/** @typedef {import("obsidian").Setting} Setting */
/** @typedef {{ name: string, desc: string, render: (setting: Setting) => void | (() => void), visible?: () => boolean }} Row */
/** @typedef {{ heading: string | null, rows: Row[] }} Section */

/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : typeof e === "string" ? e : "something went wrong");

/**
 * A row of the panel: its name, its description, and what draws its control
 * @param {string} name @param {string} desc @param {(setting: Setting) => unknown} draw
 * @returns {Row}
 */
const row = (name, desc, draw) => ({ name, desc, render: (s) => { draw(s); } });

/**
 * A link among a row's controls, as Style Settings draws Import and Export
 * @param {Setting} setting @param {string} text @param {() => void} act
 */
const link = (setting, text, act) => {
    setting.controlEl.createEl("a", { text, href: "#" }, (a) => {
        a.addEventListener("click", (e) => {
            e.preventDefault();
            act();
        });
    });
};

/**
 * A row whose value is saved when you leave the field: `draw` returns what saves a value still waiting.
 * Obsidian 1.13+ runs a row's cleanup both when the panel closes (the row already off the page) and
 * when it draws the row again in place (Sync changed the settings while you typed): only the first
 * saves, so a half-typed value is never kept. display() keeps the save itself, for hide().
 * @param {string} name @param {string} desc @param {(setting: Setting) => () => void} draw
 * @returns {Row}
 */
const field = (name, desc, draw) => ({
    name, desc,
    render: (s) => {
        const save = draw(s);
        return Object.assign(() => { if (!s.settingEl.isConnected) save(); }, { save });
    },
});

/**
 * Folders to choose an invoice folder from: the vault's own that the field would take, with `Invoices`
 * first while there's none. The folder typed exactly comes first, then those that start with it, then
 * those that hold it. Leaving the field while the list is open takes the folder it highlights.
 * @extends {AbstractInputSuggest<string>}
 */
class FolderSuggest extends AbstractInputSuggest {
    /**
     * @param {import("obsidian").App} app @param {HTMLInputElement} inputEl @param {string} suggested
     * @param {(folder: string) => boolean} takes
     */
    constructor(app, inputEl, suggested, takes) {
        super(app, inputEl);
        this.suggested = suggested;
        this.takes = takes;
        // Each folder the list shows, by its row
        /** @type {Map<HTMLElement, string>} */
        this.drawn = new Map();
    }

    /** @param {string} query @returns {string[]} */
    getSuggestions(query) {
        const q = query.trim().toLowerCase();
        const folders = this.app.vault.getAllFolders(false).map((f) => f.path).filter((f) => this.takes(f)).sort((a, b) => a.localeCompare(b));
        const all = folders.some((f) => f.toLowerCase() === this.suggested.toLowerCase()) ? folders : [this.suggested, ...folders];
        /** @param {string} f */
        const rank = (f) => { const l = f.toLowerCase(); return l === q ? 0 : l.startsWith(q) ? 1 : 2; };
        this.drawn = new Map();
        return all.filter((f) => f.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b));
    }

    /** @param {string} folder @param {HTMLElement} el */
    renderSuggestion(folder, el) {
        el.addClass("plainday-folder-suggestion");
        el.createSpan({ cls: "plainday-folder-path", text: folder });
        this.drawn.set(el, folder);
    }

    /** The folder the open list highlights, or null when it's closed @returns {string | null} */
    highlighted() {
        for (const [el, folder] of this.drawn) if (el.isConnected && el.hasClass("is-selected")) return folder;
        return null;
    }
}

// Paste: a box to paste a copy into, as wide as the window (styles.css), what it holds, then Cancel or
// Replace. A phone doesn't always let a plugin read the clipboard, so the copy is pasted by hand.
class PasteModal extends Modal {
    /** @param {import("obsidian").App} app @param {(copy: Values) => Promise<void>} onReplace */
    constructor(app, onReplace) {
        super(app);
        this.onReplace = onReplace;
    }

    onOpen() {
        const settings = plainday.Settings;
        this.setTitle("Paste settings");
        this.modalEl.addClass("plainday-paste");
        const box = new TextAreaComponent(this.contentEl).setPlaceholder("Paste here");
        box.inputEl.rows = 6;
        const said = this.contentEl.createEl("p", { cls: "setting-item-description" });
        /** @type {Values | null} */
        let copy = null;
        const row = this.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(row).setButtonText("Cancel").onClick(() => this.close());
        const replace = new ButtonComponent(row).setButtonText("Replace").setCta().setDisabled(true);
        replace.onClick(() => {
            if (!copy) return;
            const chosen = copy;
            replace.setDisabled(true);
            this.onReplace(chosen).then(() => this.close(), (e) => {
                said.setText(`Couldn't save the settings: ${messageOf(e)}`);
                replace.setDisabled(false);
            });
        });
        box.onChange((text) => {
            const read = settings.readCopy(text);
            copy = read.settings ?? null;
            said.setText(read.settings ? `It holds ${read.holds}. Invoice numbers this device has given aren't given again.` : read.error ?? "");
            replace.setDisabled(!copy);
        });
        window.setTimeout(() => box.inputEl.focus(), 0);
    }

    onClose() {
        this.contentEl.empty();
    }
}

export default class PlaindaySettingTab extends PluginSettingTab {
    // Obsidian 1.13 and later: the sections as setting definitions, drawn and searched by Obsidian
    getSettingDefinitions() {
        return this.sections().map(({ heading, rows }) => ({
            type: /** @type {const} */ ("group"),
            ...(heading ? { heading } : {}),
            items: rows.map(({ name, desc, render, visible }) => ({ name, ...(desc ? { desc } : {}), render, ...(visible ? { visible } : {}) })),
        }));
    }

    // An Obsidian before 1.13: the same sections, drawn here. What a row returns saves a value still
    // waiting when the panel closes (hide), as Obsidian 1.13 runs it when it takes the row down.
    display() {
        this.containerEl.empty();
        /** @type {(() => void)[]} */
        const waiting = [];
        this.waiting = waiting;
        /** @type {{ el: HTMLElement, visible: () => boolean }[]} */
        const shown = [];
        this.shown = shown;
        for (const { heading, rows } of this.sections()) {
            const group = new SettingGroup(this.containerEl);
            if (heading) group.setHeading(heading);
            for (const { name, desc, render, visible } of rows) {
                group.addSetting((s) => {
                    s.setName(name);
                    if (desc) s.setDesc(desc);
                    const cleanup = render(s);
                    if (cleanup) waiting.push(/** @type {{ save?: () => void }} */ (cleanup).save ?? cleanup);
                    if (visible) shown.push({ el: s.settingEl, visible });
                });
            }
        }
        this.refreshShown();
    }

    // Shows or hides each row by its `visible`, after a switch changed it
    refreshShown() {
        if (requireApiVersion("1.13.0")) this.refreshDomState();
        else for (const { el, visible } of this.shown ?? []) el.toggle(visible());
    }

    hide() {
        for (const save of this.waiting?.splice(0) ?? []) save();
    }

    // Draws the panel again, after a paste changed every value
    redraw() {
        if (requireApiVersion("1.13.0")) this.update();
        else this.display();
    }

    /** @returns {Section[]} */
    sections() {
        const settings = plainday.Settings;
        const now = () => settings.get();
        // A line under a setting saying what's wrong with what's typed, or a note when `warn` is false, or
        // nothing
        /** @type {WeakMap<Setting, HTMLElement>} */
        const lines = new WeakMap();
        // The settings whose line says a save failed, which the next save that works clears
        /** @type {WeakSet<Setting>} */
        const failed = new WeakSet();
        /** @param {Setting} setting @param {string} text @param {boolean} [warn] */
        const problem = (setting, text, warn = true) => {
            let line = lines.get(setting);
            if (!line) {
                line = setting.descEl.createDiv();
                lines.set(setting, line);
            }
            line.toggleClass("mod-warning", warn);
            line.setText(text);
        };
        /**
         * Saves one section's values, and says so under `setting` when that fails
         * @template {keyof Values} K
         * @param {Setting} setting @param {K} section @param {Partial<Values[K]>} values
         * @returns {Promise<void>}
         */
        const store = (setting, section, values) => settings.set(section, values).then(
            () => { if (failed.delete(setting)) problem(setting, ""); },
            (e) => { failed.add(setting); problem(setting, `Couldn't save: ${messageOf(e)}`); },
        );
        const counts = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), String(i)]));
        // Whether the two freezes show: the switch above them, on while either is more than 0
        let freezing = now().tables.freezeRows > 0 || now().tables.freezeColumns > 0;
        /** @type {import("obsidian").DropdownComponent[]} */
        const freezes = [];

        return [
            {
                heading: null,
                rows: [
                    row("Backup and transfer", "Copy settings for backup and to transfer from one device to another when you're not syncing your installed plugin settings. Paste will replace all settings with the contents of your clipboard.", (s) => {
                        link(s, "Copy", () => {
                            navigator.clipboard.writeText(settings.copyText()).then(
                                () => new Notice("Copied. It holds your invoice details, so keep it somewhere private. A clipboard manager may keep a copy.", 8000),
                                (e) => new Notice(`Couldn't copy the settings: ${messageOf(e)}`),
                            );
                        });
                        s.controlEl.createSpan({ text: "|", cls: "plainday-separator" });
                        link(s, "Paste", () => {
                            new PasteModal(this.app, async (copy) => {
                                await settings.replaceWith(copy);
                                this.redraw();
                            }).open();
                        });
                    }),
                ],
            },
            {
                heading: "Invoices",
                rows: [
                    row("Your name or company name", "",
                        (s) => s.addText((t) => t.setValue(now().invoices.name).onChange((v) => { void store(s, "invoices", { name: v.trim() }); }))),
                    row("Address", "", (s) => s.addTextArea((t) => {
                        t.inputEl.rows = 3;
                        t.setValue(now().invoices.address.join("\n")).onChange((v) => { void store(s, "invoices", { address: settings.lines(v) }); });
                    })),
                    row("Terms", "e.g. Net 30",
                        (s) => s.addText((t) => t.setPlaceholder("Net 30").setValue(now().invoices.terms).onChange((v) => { void store(s, "invoices", { terms: v.trim() }); }))),
                    row("Note", "Closes each invoice, such as how to pay you.", (s) => s.addTextArea((t) => {
                        t.inputEl.rows = 3;
                        t.setValue(now().invoices.paymentNote).onChange((v) => { void store(s, "invoices", { paymentNote: settings.multiline(v) }); });
                    })),
                    field("Invoice folder", "Note that changing it will not move past invoices.", (s) => {
                        /** @type {string | null} */
                        let waiting = null;
                        /** @type {import("obsidian").TextComponent | null} */
                        let input = null;
                        /** @type {FolderSuggest | null} */
                        let suggest = null;
                        // A folder that isn't in the vault yet: Invoice makes it, as it finds it
                        /** @param {string} folder */
                        const missing = (folder) => !!folder && !this.app.vault.getFolderByPath(String(plainday.Invoice.realFolder(folder)));
                        // Leaving the field: with something typed and the list open, the folder it highlights;
                        // else what's typed when it reads, and the saved folder at once when it doesn't, its
                        // line still saying why. Clearing the field leaves no folder chosen.
                        const save = () => {
                            const typed = input !== null ? input.getValue().trim() : "";
                            const pick = typed !== "" && suggest !== null ? suggest.highlighted() : null;
                            if (pick && input !== null) {
                                input.setValue(pick);
                                check(pick);
                            }
                            const folder = waiting;
                            waiting = null;
                            if (folder !== null && folder !== now().invoices.folder) void store(s, "invoices", { folder });
                            if (folder !== null) problem(s, missing(folder) ? `“${folder}” doesn't exist yet. Invoice will create it.` : "", false);
                            input?.setValue(folder ?? now().invoices.folder);
                        };
                        /** @param {string} v */
                        const check = (v) => {
                            const { folder, error, taken } = plainday.Billing.folderOf(v);
                            const was = now().invoices.folder;
                            waiting = error ? null : folder;
                            problem(s, taken ? `${taken} is already used by Plainday. Please choose another location.`
                                : error ? `Not used: it ${error}. The invoice folder stays ${was ? `\`${was}\`` : "unchosen"}.` : "");
                        };
                        s.addText((t) => {
                            input = t;
                            t.setPlaceholder("Invoices").setValue(now().invoices.folder).onChange(check);
                            // Tab leaves before the list closes; a click elsewhere, by the change it makes
                            t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Tab") save(); });
                            t.inputEl.addEventListener("change", save);
                            const list = new FolderSuggest(this.app, t.inputEl, "Invoices", (f) => !plainday.Billing.folderOf(f).error);
                            suggest = list;
                            list.onSelect((folder) => {
                                t.setValue(folder);
                                check(folder);
                                save();
                                list.close();
                            });
                        });
                        if (missing(now().invoices.folder)) problem(s, `“${now().invoices.folder}” doesn't exist yet. Invoice will create it.`, false);
                        return save;
                    }),
                    // The number the panel shows; Invoice also goes past the last number given, which typing
                    // a first number sets to one less, and past the highest invoice in the vault
                    field("First invoice number", "Plainday will increment up from here, or from the next highest number if you already have a series of invoices in your vault.", (s) => {
                        /** @type {number | null} */
                        let waiting = null;
                        /** @type {import("obsidian").TextComponent | null} */
                        let input = null;
                        const save = () => {
                            const first = waiting;
                            waiting = null;
                            if (first !== null && first !== now().invoices.firstNumber) void store(s, "invoices", { firstNumber: first, lastNumber: first - 1 });
                            input?.setValue(String(first ?? now().invoices.firstNumber));
                        };
                        s.addText((t) => {
                            input = t;
                            t.inputEl.inputMode = "numeric";
                            t.setValue(String(now().invoices.firstNumber)).onChange((v) => {
                                waiting = settings.firstNumberOf(v).number;
                                problem(s, waiting === null ? `Not used: it isn't a whole number from 1 to 999999. The first invoice number stays ${now().invoices.firstNumber}.` : "");
                            });
                            t.inputEl.addEventListener("change", save);
                        });
                        return save;
                    }),
                ],
            },
            {
                heading: "Tables",
                rows: [
                    row("Freeze rows and columns", "Applies only to tables created by Plainday and requires Selectable Tables plugin.", (s) => s.addToggle((t) => t.setValue(freezing).onChange((on) => {
                        // On freezes the header row and the first column, off unfreezes both
                        freezing = on;
                        const n = on ? 1 : 0;
                        for (const d of freezes) d.setValue(String(n));
                        void store(s, "tables", { freezeRows: n, freezeColumns: n });
                        this.refreshShown();
                    }))),
                    {
                        ...row("Freeze rows", "", (s) => s.addDropdown((d) => {
                            freezes.push(d);
                            d.addOptions(counts).setValue(String(now().tables.freezeRows)).onChange((v) => { void store(s, "tables", { freezeRows: Number(v) }); });
                        })),
                        visible: () => freezing,
                    },
                    {
                        ...row("Freeze columns", "", (s) => s.addDropdown((d) => {
                            freezes.push(d);
                            d.addOptions(counts).setValue(String(now().tables.freezeColumns)).onChange((v) => { void store(s, "tables", { freezeColumns: Number(v) }); });
                        })),
                        visible: () => freezing,
                    },
                ],
            },
            {
                heading: "Editor",
                rows: [
                    row("Keep the cursor after a list line's bullet or checkbox", "In Live Preview, prevent the cursor from resting inside the raw markdown for tasks and list items, so they stay rendered. You can still edit the markdown in Source mode or select to copy or delete.",
                        (s) => s.addToggle((t) => t.setValue(now().editor.listCursor).onChange((v) => {
                            void store(s, "editor", { listCursor: v }).then(() => plainday.ListCursor.invoke());
                        }))),
                ],
            },
        ];
    }
}
