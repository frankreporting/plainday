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
// Invoices, Tables (a switch, then the two freezes while it's on), Editor, and Calendars (OBS-282): Add
// calendar, the sync range and the help, then a group for each account with its calendars. OBS-283 adds
// Folders.
//
// A calendar's link is typed into a masked field, checked by downloading it once (CalendarFeed.check),
// and kept only in this device's secret storage (Settings.storeLink): never in a setting, a notice or
// the console. A link that fails isn't added, and the dialog says why, by the problem alone.
import { AbstractInputSuggest, ButtonComponent, Modal, Notice, PluginSettingTab, requireApiVersion, Setting, SettingGroup, TextAreaComponent, TextComponent } from "obsidian";
import { plainday } from "./host.js";

/** @typedef {ReturnType<import("./shared/settings.js").default["defaults"]>} Values */
/** @typedef {Values["calendars"]["list"][number]} Calendar */
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

// Paste: a box to paste a copy into, as wide as the window (styles.css), then Cancel or Replace, which
// stays off until the box holds a copy; text that isn't one says so. A phone doesn't always let a plugin read the clipboard, so the copy is pasted by hand.
class PasteModal extends Modal {
    /** @param {import("obsidian").App} app @param {(copy: Values, links: Record<string, string>, withCalendars: boolean) => Promise<void>} onReplace */
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
        /** @type {Record<string, string>} */
        let links = {};
        let withCalendars = true;
        const row = this.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(row).setButtonText("Cancel").onClick(() => this.close());
        const replace = new ButtonComponent(row).setButtonText("Replace").setCta().setDisabled(true);
        replace.onClick(() => {
            if (!copy) return;
            const chosen = copy;
            replace.setDisabled(true);
            this.onReplace(chosen, links, withCalendars).then(() => this.close(), (e) => {
                said.setText(`Couldn't save the settings: ${messageOf(e)}`);
                replace.setDisabled(false);
            });
        });
        box.onChange((text) => {
            const read = settings.readCopy(text);
            copy = read.settings ?? null;
            links = read.links ?? {};
            withCalendars = read.withCalendars ?? true;
            said.setText(read.error ?? "");
            replace.setDisabled(!copy);
        });
        window.setTimeout(() => box.inputEl.focus(), 0);
    }

    onClose() {
        this.contentEl.empty();
    }
}

// What Add calendar and Edit say when a link fails, by the problem CalendarFeed gives; never the link
const PROBLEMS = {
    notLink: "That isn't a link. A calendar's private link starts with https:// or webcal://.",
    dead: "That link stopped working: it was reset or unpublished. Copy the calendar's link again.",
    unreachable: "Couldn't reach that link. Check that you're online and that the link is whole, then try again.",
    unreadable: "That link isn't a calendar.",
    slow: "That calendar took too long to read.",
};
/** @param {string} problem */
const problemText = (problem) => PROBLEMS[/** @type {keyof typeof PROBLEMS} */ (problem)] ?? "Couldn't read that link.";

// The help: where each provider keeps a calendar's private link, and what to do if one leaks
const HELP = [
    ["Google Calendar", "On the web: Settings, then the calendar under Settings for my calendars, then Integrate calendar. Copy the Secret address in iCal format."],
    ["iCloud", "In Calendar, share the calendar and turn on Public Calendar, then copy its link (it starts with webcal://)."],
    ["Outlook", "On the web: Settings, Calendar, Shared calendars, then Publish a calendar. Choose the calendar and Can view all details, then copy the ICS link."],
    ["A calendar someone shares with you", "has no secret address of yours: only its owner can publish one."],
    ["A subscribed calendar", "(holidays, a team's schedule) uses the address you subscribed from. Apple publishes its holiday calendars at a public address."],
    ["At work or school", "a Google Workspace or Microsoft 365 admin can turn private links off; then the option isn't there."],
];
const LEAKS = "Each link works like a password: anyone who has it can read that calendar until you reset it. If one leaks, reset it: in Google, Reset beside the secret address; in iCloud, turn Public Calendar off and on again; in Outlook, Reset links under Publish a calendar. Then Edit the calendar here and paste its new link, and do the same on your other devices, or Copy and Paste.";

class CalendarHelpModal extends Modal {
    onOpen() {
        this.setTitle("Calendar links");
        const list = this.contentEl.createEl("ul");
        for (const [what, how] of HELP) {
            list.createEl("li", {}, (li) => {
                li.createEl("strong", { text: what });
                li.appendText(` ${how}`);
            });
        }
        this.contentEl.createEl("p", { text: LEAKS });
    }

    onClose() {
        this.contentEl.empty();
    }
}

/**
 * Account names to choose from: those the list already has, and the three providers
 * @extends {AbstractInputSuggest<string>}
 */
class AccountSuggest extends AbstractInputSuggest {
    /** @param {string} query @returns {string[]} */
    getSuggestions(query) {
        const q = query.trim().toLowerCase();
        const names = [...new Set([...plainday.Settings.get().calendars.list.map((c) => c.account).filter(Boolean), "Google", "iCloud", "Outlook"])];
        return names.filter((n) => n.toLowerCase().includes(q) && n !== query.trim());
    }

    /** @param {string} name @param {HTMLElement} el */
    renderSuggestion(name, el) {
        el.setText(name);
    }
}

// Add calendar, or Edit one: its link in a masked field, checked by downloading it once; its name,
// account and your address on it. Adding shows the name, account and address once the link reads,
// filled in from it. Editing shows them at once, with the link blank: a link typed there is checked
// and replaces this device's on Save.
class CalendarModal extends Modal {
    /**
     * @param {import("obsidian").App} app
     * @param {Calendar | null} calendar the one to edit, or null to add
     * @param {() => void} done
     */
    constructor(app, calendar, done) {
        super(app);
        this.calendar = calendar;
        this.done = done;
        this.closed = false;
    }

    onOpen() {
        const settings = plainday.Settings, feed = plainday.CalendarFeed;
        const editing = this.calendar;
        this.setTitle(editing ? `Edit ${editing.name || "calendar"}` : "Add calendar");
        this.modalEl.addClass("plainday-calendar");

        const linkSetting = new Setting(this.contentEl).setName(editing ? "New link" : "Private link");
        linkSetting.descEl.appendText(!editing ? "Paste the calendar's private link. "
            : settings.link(editing.id) !== null ? "This device has its link. Paste a new one to replace it, or leave this blank. "
                : "This device has no link for it yet. ");
        linkSetting.descEl.createEl("a", { text: "Where to find it", href: "#" }, (a) => a.addEventListener("click", (e) => {
            e.preventDefault();
            new CalendarHelpModal(this.app).open();
        }));
        // Masked by styles.css rather than as a password, so a phone's password manager doesn't offer to
        // keep it
        const linkInput = new TextComponent(linkSetting.controlEl).setPlaceholder("https://… or webcal://…");
        linkInput.inputEl.addClass("plainday-masked");
        linkInput.inputEl.autocomplete = "off";
        linkInput.inputEl.spellcheck = false;
        linkInput.inputEl.setAttribute("autocapitalize", "off");
        for (const ignore of ["data-1p-ignore", "data-lpignore", "data-bwignore"]) linkInput.inputEl.setAttribute(ignore, "true");
        // What the check says: "Checking the link…", or why the link fails
        const said = this.contentEl.createEl("p", { cls: "setting-item-description plainday-calendar-said" });

        const details = this.contentEl.createDiv();
        const nameInput = new TextComponent(new Setting(details).setName("Name").controlEl);
        const accountInput = new TextComponent(new Setting(details).setName("Account").setDesc("Calendars are grouped under it.").controlEl);
        const accounts = new AccountSuggest(this.app, accountInput.inputEl);
        accounts.onSelect((name) => {
            accountInput.setValue(name);
            accounts.close();
        });
        const addressSetting = new Setting(details).setName("Your address on this calendar")
            .setDesc("The email address you're invited at on this calendar, so the sync leaves out invitations you declined. Separate more than one with commas. Blank shows every invitation.");
        const addressInput = new TextComponent(addressSetting.controlEl);
        addressInput.inputEl.autocomplete = "off";
        const addressLine = addressSetting.descEl.createDiv({ cls: "mod-warning" });
        if (editing) {
            nameInput.setValue(editing.name);
            accountInput.setValue(editing.account);
            addressInput.setValue(editing.addresses.join(", "));
        } else {
            details.hide();
        }

        const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
        const go = new ButtonComponent(buttons).setCta().setButtonText(editing ? "Save" : "Check link");

        // Adding: the link that read, so a link changed afterwards has to be checked again
        /** @type {string | null} */
        let checked = null;
        let busy = false;
        const link = () => linkInput.getValue().trim();
        const addresses = () => settings.addressesOf(addressInput.getValue());
        // A line under the address when part of it isn't one; a link is never shown back
        const showAddresses = () => {
            const { bad } = addresses();
            const shown = bad.map((b) => (settings.linkFree(b) ? b : "a link"));
            addressLine.setText(bad.length ? `Not an email address: ${shown.join(", ")}` : "");
            return !bad.length;
        };
        addressInput.onChange(showAddresses);

        // The link typed: its feed's name and the link it checked when it reads, or why not: not a link,
        // another calendar already has it, or the check's problem. The field takes no typing meanwhile.
        /** @returns {Promise<{ problem: string, name?: undefined, link?: undefined } | { name: string, link: string, problem?: undefined }>} */
        const check = async () => {
            const typed = link();
            if (!feed.isLink(typed)) return { problem: problemText("notLink") };
            const other = settings.calendarWithLink(typed, editing ? editing.id : null);
            if (other) return { problem: `${other.name || "Another calendar"} already has that link.` };
            said.setText("Checking the link…");
            linkInput.setDisabled(true);
            try {
                const got = await feed.check(typed);
                if (got.problem !== undefined) return { problem: problemText(got.problem) };
                if (link() !== typed) return { problem: "The link changed while it was checked. Check it again." };
                return { name: got.name, link: typed };
            } finally {
                linkInput.setDisabled(false);
            }
        };
        // A link pasted into the name or the account is never kept there
        const linkFree = () => {
            if (settings.linkFree(nameInput.getValue()) === nameInput.getValue().trim() && settings.linkFree(accountInput.getValue()) === accountInput.getValue().trim()) return true;
            said.setText("That's a link: paste it into the link field, not the name or the account.");
            return false;
        };
        // Adding, before the link has read: checks it, and shows its name, account and your address
        const checkNew = async () => {
            const got = await check();
            if (this.closed) return;
            if (got.problem !== undefined) {
                said.setText(got.problem);
                return;
            }
            checked = got.link;
            said.setText("");
            nameInput.setValue(got.name);
            accountInput.setValue(feed.account(got.link));
            addressInput.setValue(feed.address(got.link) ?? "");
            showAddresses();
            details.show();
            go.setButtonText("Add calendar");
            nameInput.inputEl.focus();
        };
        // The name, account and address as typed, when they'll do; else null, with the line that says why
        const values = () => {
            const name = nameInput.getValue().trim();
            if (!name) {
                said.setText("Give the calendar a name.");
                return null;
            }
            if (!linkFree() || !showAddresses()) return null;
            return { name, account: accountInput.getValue(), addresses: addresses().addresses };
        };
        // Adds the calendar, or saves the edit, after checking a new link. What's typed is read again after
        // the check, so a change made while it ran is kept.
        const save = async () => {
            if (!values()) return;
            /** @type {string | null} */
            let newLink = null;
            if (editing && link()) {
                const got = await check();
                if (this.closed) return;
                if (got.problem !== undefined) {
                    said.setText(got.problem);
                    return;
                }
                newLink = got.link;
            }
            const given = values();
            if (!given) return;
            if (!editing) {
                await settings.addCalendar({ ...given, link: checked ?? "" });
            } else {
                // A Google link to a person's calendar names them: your address, when you haven't given one
                const own = newLink ? feed.address(newLink) : null;
                if (!given.addresses.length && own) given.addresses = [own];
                await settings.editCalendar(editing.id, given, newLink);
            }
            this.close();
            this.done();
        };
        const run = async () => {
            if (busy) return;
            busy = true;
            go.setDisabled(true);
            try {
                if (!editing && checked === null) await checkNew();
                else await save();
            } catch (e) {
                if (!this.closed) said.setText(`Couldn't save the calendar: ${messageOf(e)}`);
            } finally {
                busy = false;
                go.setDisabled(false);
            }
        };
        go.onClick(() => { void run(); });
        linkInput.inputEl.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void run();
        });
        // Adding: a link changed after it read has to be checked again
        linkInput.onChange(() => {
            if (editing || checked === null || link() === checked) return;
            checked = null;
            details.hide();
            go.setButtonText("Check link");
        });
        // Adding: a pasted link is checked at once
        if (!editing) {
            linkInput.inputEl.addEventListener("paste", () => window.setTimeout(() => {
                if (checked === null && link()) void run();
            }, 0));
        }
        // Editing a calendar this device has the link for: its name; otherwise the link, which the list
        // says to paste
        window.setTimeout(() => (editing && settings.link(editing.id) !== null ? nameInput : linkInput).inputEl.focus(), 0);
    }

    onClose() {
        this.closed = true;
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
        // A line under a setting saying what's wrong with what's typed (red), or something to know when
        // `warn` is false (orange), or nothing
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
            line.toggleClass("plainday-caution", !warn);
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
                            const links = settings.links();
                            navigator.clipboard.writeText(settings.copyText(settings.get(), links)).then(
                                () => new Notice(Object.keys(links).length
                                    ? "Copied. It holds your calendar links, which work like passwords, and your invoice details, so keep it somewhere private. A clipboard manager may keep a copy."
                                    : "Copied. It holds your invoice details, so keep it somewhere private. A clipboard manager may keep a copy.", 8000),
                                (e) => new Notice(`Couldn't copy the settings: ${messageOf(e)}`),
                            );
                        });
                        s.controlEl.createSpan({ text: "|", cls: "plainday-separator" });
                        link(s, "Paste", () => {
                            new PasteModal(this.app, async (copy, links, withCalendars) => {
                                await settings.replaceWith(copy, links, withCalendars);
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
            ...this.calendarSections(store),
        ];
    }

    /**
     * Calendars (OBS-282): Add calendar, the sync range and the help, then each account's calendars,
     * accounts and calendars in alphabetical order
     * @param {(setting: Setting, section: "calendars", values: Partial<Values["calendars"]>) => Promise<void>} store
     * @returns {Section[]}
     */
    calendarSections(store) {
        const settings = plainday.Settings;
        const list = settings.get().calendars.list;
        const ranges = Object.fromEntries(settings.rangeLabels().map((label) => [label, label]));
        /** @param {Calendar | null} calendar */
        const dialog = (calendar) => new CalendarModal(this.app, calendar, () => this.redraw()).open();
        // Each account's calendars, in alphabetical order. Obsidian 1.13+ tells rows apart by their names and
        // groups by their headings, so none repeats: a second calendar named alike in an account is
        // "Calendar (2)", and an account named like one of the panel's own sections is "… calendars".
        /** @type {Map<string, Calendar[]>} */
        const accounts = new Map();
        const taken = new Set(["", "invoices", "tables", "editor", "calendars"]);
        for (const c of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
            const name = c.account || "No account";
            const account = taken.has(name.toLowerCase()) ? `${name} calendars` : name;
            accounts.set(account, [...(accounts.get(account) ?? []), c]);
        }
        /** @param {Calendar[]} calendars @returns {[Calendar, string][]} */
        const named = (calendars) => {
            /** @type {Map<string, number>} */
            const seen = new Map();
            return calendars.map((c) => {
                const base = c.name || "Untitled calendar";
                const n = (seen.get(base) ?? 0) + 1;
                seen.set(base, n);
                return [c, n === 1 ? base : `${base} (${n})`];
            });
        };
        return [
            {
                heading: "Calendars",
                rows: [
                    row("Add calendar", list.length ? "Add another calendar by its private link." : "No calendars are added yet. Add one by its private link.",
                        (s) => s.addButton((b) => b.setButtonText("Add calendar").onClick(() => dialog(null)))),
                    row("Sync range", "How far ahead Sync calendars writes events into daily notes. Days beyond it are left as they are.",
                        (s) => s.addDropdown((d) => d.addOptions(ranges).setValue(settings.get().calendars.range).onChange((v) => { void store(s, "calendars", { range: v }); }))),
                    row("Private links", "Each calendar's link works like a password. It stays in this device's secret storage, never in a note or in Plainday's settings file.",
                        (s) => link(s, "Where to find them, and if one leaks", () => new CalendarHelpModal(this.app).open())),
                ],
            },
            ...[...accounts].sort((a, b) => a[0].localeCompare(b[0])).map(([account, calendars]) => ({
                heading: account,
                rows: named(calendars).map(([c, name]) => row(name, settings.link(c.id) ? "Link on this device" : "Add link on this device: Edit, then paste it", (s) => {
                    // Put back when its save fails, which runs onChange again: that turn is ignored
                    let reverting = false;
                    s.addToggle((t) => t.setValue(c.on).setTooltip("Sync this calendar").onChange((on) => {
                        if (reverting) return;
                        settings.editCalendar(c.id, { on }).catch((e) => {
                            reverting = true;
                            t.setValue(!on);
                            reverting = false;
                            new Notice(`Couldn't save: ${messageOf(e)}`);
                            // Gone from the list (Sync brought another device's): draw the panel again
                            if (!settings.calendar(c.id)) this.redraw();
                        });
                    }));
                    s.addButton((b) => b.setButtonText("Edit").onClick(() => dialog(c)));
                    s.addButton((b) => b.setButtonText("Remove").setWarning().onClick(() => {
                        settings.removeCalendar(c.id).then(() => this.redraw(), (e) => new Notice(`Couldn't remove ${c.name}: ${messageOf(e)}`));
                    }));
                })),
            })),
        ];
    }
}
