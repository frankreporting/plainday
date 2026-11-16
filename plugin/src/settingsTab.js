// Settings → Plainday (OBS-80, OBS-281): the panel that shows Plainday's settings, which
// shared/settings.js keeps, loads and saves. It sits beside main.js, since Plainday makes it with
// itself (addSettingTab), and it isn't one of the classes Plainday makes by name.
//
// The panel is one list of sections, each a heading and its rows (sections()). Obsidian 1.13 and later
// draw it from that list, as setting definitions, and find each row in the settings search
// (getSettingDefinitions); an older Obsidian, down to the manifest's 1.11.4, calls display(), which
// draws the same list itself with Setting and SettingGroup. Each row draws its own control (`render`).
//
// Each change is saved as it's made. A value that doesn't read (an invoice folder outside the vault,
// a number that isn't one) is refused with a line under the field, and the old value stays.
//
// The sections, in order: Invoices, Tables, Editor, and Another device, with Copy settings and
// Paste settings. OBS-282 adds Calendars and OBS-283 Folders.
import { AbstractInputSuggest, ButtonComponent, Modal, Notice, PluginSettingTab, requireApiVersion, SettingGroup, TextAreaComponent } from "obsidian";
import { plainday } from "./host.js";

/** @typedef {ReturnType<import("./shared/settings.js").default["defaults"]>} Values */
/** @typedef {import("obsidian").Setting} Setting */
/** @typedef {{ name: string, desc: string, render: (setting: Setting) => void }} Row */
/** @typedef {{ heading: string, rows: Row[] }} Section */

/** @param {unknown} e */
const messageOf = (e) => (e instanceof Error ? e.message : typeof e === "string" ? e : "something went wrong");

/**
 * A row of the panel: its name, its description, and what draws its control
 * @param {string} name @param {string} desc @param {(setting: Setting) => unknown} draw
 * @returns {Row}
 */
const row = (name, desc, draw) => ({ name, desc, render: (s) => { draw(s); } });

/**
 * Folders to choose an invoice folder from: the vault's own, with `Invoices` first while there's none
 * @extends {AbstractInputSuggest<string>}
 */
class FolderSuggest extends AbstractInputSuggest {
    /** @param {import("obsidian").App} app @param {HTMLInputElement} inputEl @param {string} suggested */
    constructor(app, inputEl, suggested) {
        super(app, inputEl);
        this.suggested = suggested;
    }

    /** @param {string} query @returns {string[]} */
    getSuggestions(query) {
        const q = query.trim().toLowerCase();
        const folders = this.app.vault.getAllFolders(false).map((f) => f.path).sort((a, b) => a.localeCompare(b));
        const all = folders.some((f) => f.toLowerCase() === this.suggested.toLowerCase()) ? folders : [this.suggested, ...folders];
        return all.filter((f) => f.toLowerCase().includes(q));
    }

    /** @param {string} folder @param {HTMLElement} el */
    renderSuggestion(folder, el) {
        el.setText(folder);
    }
}

// Paste settings: a box to paste a copy into, what it holds, then Cancel or Replace. A phone doesn't
// always let a plugin read the clipboard, so the copy is pasted by hand.
class PasteModal extends Modal {
    /** @param {import("obsidian").App} app @param {(copy: Values) => Promise<void>} onReplace */
    constructor(app, onReplace) {
        super(app);
        this.onReplace = onReplace;
    }

    onOpen() {
        const settings = plainday.Settings;
        this.setTitle("Paste settings");
        this.contentEl.createEl("p", { text: "Paste what Copy settings copied on your other device. Replace makes this device's settings the same as that device's." });
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
            said.setText(read.settings ? `It holds: ${read.holds}. This device's last invoice number stays if it's higher.` : read.error ?? "");
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
            heading,
            items: rows.map(({ name, desc, render }) => ({ name, desc, render })),
        }));
    }

    // An Obsidian before 1.13: the same sections, drawn here
    display() {
        this.containerEl.empty();
        for (const { heading, rows } of this.sections()) {
            const group = new SettingGroup(this.containerEl).setHeading(heading);
            for (const { name, desc, render } of rows) {
                group.addSetting((s) => {
                    s.setName(name).setDesc(desc);
                    render(s);
                });
            }
        }
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
        // A line under a setting saying what's wrong with what's typed, or nothing
        /** @type {WeakMap<Setting, HTMLElement>} */
        const lines = new WeakMap();
        /** @param {Setting} setting @param {string} text */
        const problem = (setting, text) => {
            let line = lines.get(setting);
            if (!line) {
                line = setting.descEl.createDiv({ cls: "mod-warning" });
                lines.set(setting, line);
            }
            line.setText(text);
        };
        /**
         * Saves one section's values, and says so under `setting` when that fails
         * @template {keyof Values} K
         * @param {Setting} setting @param {K} section @param {Partial<Values[K]>} values
         * @returns {Promise<void>}
         */
        const save = (setting, section, values) => settings.set(section, values).then(
            () => problem(setting, ""),
            (e) => problem(setting, `Couldn't save: ${messageOf(e)}`),
        );
        const counts = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), String(i)]));

        return [
            {
                heading: "Invoices",
                rows: [
                    row("Your name", "Heads each new invoice, above your address. Invoice asks for it before your first invoice.",
                        (s) => s.addText((t) => t.setValue(now().invoices.name).onChange((v) => { void save(s, "invoices", { name: v.trim() }); }))),
                    row("Address", "Under your name, one line per item.", (s) => s.addTextArea((t) => {
                        t.inputEl.rows = 3;
                        t.setValue(now().invoices.address.join("\n")).onChange((v) => { void save(s, "invoices", { address: settings.lines(v) }); });
                    })),
                    row("Terms", "Printed on each invoice, such as Net 30. A project's own terms win over these.",
                        (s) => s.addText((t) => t.setPlaceholder("Net 30").setValue(now().invoices.terms).onChange((v) => { void save(s, "invoices", { terms: v.trim() }); }))),
                    row("Payment note", "Closes each invoice, such as how to pay you.", (s) => s.addTextArea((t) => {
                        t.inputEl.rows = 3;
                        t.setValue(now().invoices.paymentNote).onChange((v) => { void save(s, "invoices", { paymentNote: settings.multiline(v) }); });
                    })),
                    row("Invoice folder", "Where new invoices go, with the Invoices base beside them. Invoice asks you to choose one before your first invoice. Changing it doesn't move the invoices already made, and invoices in a project's own invoices folder still count.", (s) => s.addText((t) => {
                        /** @param {string} v */
                        const change = (v) => {
                            const { folder, error } = plainday.Billing.folderOf(v);
                            const was = now().invoices.folder;
                            if (error) { problem(s, `Not used: it ${error}. The invoice folder stays ${was ? `\`${was}\`` : "unchosen"}.`); return; }
                            void save(s, "invoices", { folder });
                        };
                        t.setPlaceholder("Invoices").setValue(now().invoices.folder).onChange(change);
                        new FolderSuggest(this.app, t.inputEl, "Invoices").onSelect((folder) => {
                            t.setValue(folder);
                            change(folder);
                        });
                    })),
                    row("Last invoice number", "The highest invoice number given so far. The next invoice gets one more than this, or than the highest invoice note's number if that's higher, and Invoice raises it each time, so a deleted invoice's number is never given again.", (s) => s.addText((t) => {
                        t.inputEl.inputMode = "numeric";
                        t.setValue(String(now().invoices.lastNumber)).onChange((v) => {
                            const { number } = settings.lastNumberOf(v);
                            if (number === null) { problem(s, `Not used: it isn't a whole number from 0 to 999999. The last invoice number stays ${now().invoices.lastNumber}.`); return; }
                            void save(s, "invoices", { lastNumber: number });
                        });
                    })),
                ],
            },
            {
                heading: "Tables",
                rows: [
                    row("Freeze rows", "Keeps a table's first rows in view as you scroll it, with the Selectable Tables plugin: the time report's tables, timesheets and invoices. 0 is off. The next time report writes every table with it, and a table you froze or unfroze yourself keeps your choice.",
                        (s) => s.addDropdown((d) => d.addOptions(counts).setValue(String(now().tables.freezeRows))
                            .onChange((v) => { void save(s, "tables", { freezeRows: Number(v) }); }))),
                    row("Freeze columns", "Keeps a table's first columns in view, counted from its first named column, so a timesheet's status column comes along with its date. 0 is off.",
                        (s) => s.addDropdown((d) => d.addOptions(counts).setValue(String(now().tables.freezeColumns))
                            .onChange((v) => { void save(s, "tables", { freezeColumns: Number(v) }); }))),
                ],
            },
            {
                heading: "Editor",
                rows: [
                    row("Keep the cursor after a list line's bullet or checkbox", "In Live Preview, the cursor rests after a list line's bullet, number or checkbox, never in front of them, so a checkbox stays drawn. Off, it can rest anywhere on the line.",
                        (s) => s.addToggle((t) => t.setValue(now().editor.listCursor).onChange((v) => {
                            void save(s, "editor", { listCursor: v }).then(() => plainday.ListCursor.invoke());
                        }))),
                ],
            },
            {
                heading: "Another device",
                rows: [
                    row("Copy settings", "Plainday's settings stay on this device, unless Obsidian Sync carries installed community plugins, which it doesn't by default. To set up another device, copy every setting above here, as one block of text, and paste it there. After changing a setting, paste again, so both devices file and freeze the same way.", (s) => s.addButton((b) => b.setButtonText("Copy settings").onClick(() => {
                        navigator.clipboard.writeText(settings.copyText()).then(
                            () => new Notice("Copied. It holds your invoice details: paste it only into Plainday's settings on your other device. A clipboard manager may keep a copy.", 8000),
                            (e) => new Notice(`Couldn't copy the settings: ${messageOf(e)}`),
                        );
                    }))),
                    row("Paste settings", "Replaces this device's settings with a copy from your other device. This device's last invoice number stays when it's higher.",
                        (s) => s.addButton((b) => b.setButtonText("Paste settings").onClick(() => {
                            new PasteModal(this.app, async (copy) => {
                                await settings.replaceWith(copy);
                                this.redraw();
                            }).open();
                        }))),
                ],
            },
        ];
    }
}
