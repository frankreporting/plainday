// Settings → Plainday (OBS-80, OBS-281): the panel that shows Plainday's settings, which
// shared/settings.js keeps, loads and saves. It sits beside main.js, since Plainday makes it with
// itself (addSettingTab), and it isn't one of the classes Plainday makes by name.
//
// The panel is one list of sections, each a heading and its rows (sections()). Obsidian 1.13 and later
// draw it from that list, as setting definitions, and find each row in the settings search
// (getSettingDefinitions); an older Obsidian, down to the manifest's 1.11.4, calls display(), which
// draws the same list itself with Setting and SettingGroup. Each row draws its own control (`render`).
// A row can instead be a page of its own sections (`page`, the calendar list): Obsidian 1.13+ shows it
// as an entry you click through; display(), with no pages to draw, puts its sections after the row's.
//
// Each change is saved as it's made. The invoice folder and the first invoice number are checked as you
// type and saved when you leave the field (or the panel closes), so a value on its way to another one
// (`Ref` on the way to `Reference/Invoices`) is never kept. A value that doesn't read (a folder outside
// the vault or in Archive, a number that isn't one) is refused with a line under the field, and on
// leaving it the field goes back to the saved value.
//
// The sections, in order: Copy and Paste at the top, as links (for a backup, or another device), then
// Folders and Note templates (OBS-283), Invoices, Tables (a switch, then the two freezes while it's on),
// Editor, and Calendars (OBS-282): Add calendar, the sync range and the help, then a group for each
// account with its calendars.
//
// Folders: Projects, the Inbox and the archive, each a real folder, none inside another; the daily
// notes' folder and name, shown from the Daily notes plugin, which keeps them; the weekly, monthly and
// yearly notes' folders, and the error log note, blank for what Plainday did before, which the
// placeholder shows. A periodic notes row whose names don't give a note's whole date says so (OBS-299).
// Note templates: the daily note's, shown the same way, and the weekly, monthly and
// yearly notes', each with a line when the template sets a property Plainday writes itself. Changing a
// folder moves no notes.
//
// A calendar's link is typed into a masked field, checked by downloading it once (CalendarFeed.check),
// and kept only in this device's secret storage (Settings.storeLink): never in a setting, a notice or
// the console. A link that fails isn't added, and the dialog says why, by the problem alone.
import { AbstractInputSuggest, ButtonComponent, Modal, Notice, PluginSettingTab, requireApiVersion, setIcon, Setting, SettingGroup, TextAreaComponent, TextComponent } from "obsidian";
import { plainday } from "./host.js";

/** @typedef {ReturnType<import("./shared/settings.js").default["defaults"]>} Values */
/** @typedef {Values["calendars"]["list"][number]} Calendar */
/** @typedef {import("obsidian").Setting} Setting */
/** @typedef {{ name: string, desc: string, render: (setting: Setting) => void | (() => void), visible?: () => boolean, page?: Page }} Row */
/** @typedef {{ heading: string | null, rows: Row[] }} Section */
/** @typedef {{ displayValue: string, sections: Section[] }} Page */

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
 * Folders to choose a folder setting from: the vault's own that the field would take, with `suggested`
 * (`Invoices` for the invoice folder) first while there's none. The folder typed exactly comes first,
 * then those that start with it, then those that hold it. Leaving the field while the list is open takes
 * the folder it highlights.
 * @extends {AbstractInputSuggest<string>}
 */
class FolderSuggest extends AbstractInputSuggest {
    /**
     * @param {import("obsidian").App} app @param {HTMLInputElement} inputEl @param {string} suggested
     * @param {(folder: string) => boolean} takes
     * @param {(() => (folder: string) => boolean) | null} [prepare] what the field takes, made once per
     *   query (OBS-283: its checks read the Planner's folders once, not once per folder)
     */
    constructor(app, inputEl, suggested, takes, prepare = null) {
        super(app, inputEl);
        this.suggested = suggested;
        this.takes = takes;
        this.prepare = prepare;
        // Each folder the list shows, by its row
        /** @type {Map<HTMLElement, string>} */
        this.drawn = new Map();
    }

    /** @param {string} query @returns {string[]} */
    getSuggestions(query) {
        const q = query.trim().toLowerCase();
        const takes = this.prepare ? this.prepare() : this.takes;
        const folders = this.app.vault.getAllFolders(false).map((f) => f.path).filter((f) => takes(f)).sort((a, b) => a.localeCompare(b));
        const all = !this.suggested || !takes(this.suggested) || folders.some((f) => f.toLowerCase() === this.suggested.toLowerCase()) ? folders : [this.suggested, ...folders];
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

    /**
     * The folder the open list highlights when it's one you chose (OBS-283): you moved the highlight off
     * the first row, which Obsidian highlights by itself, or it starts with what you typed; else null.
     * The list's own ↑ and ↓ never reach the field, so where the highlight is says it.
     * @param {string} typed
     * @returns {string | null}
     */
    chosen(typed) {
        const lit = this.highlighted();
        if (!lit || !typed) return null;
        const first = [...this.drawn].find(([el]) => el.isConnected)?.[1];
        return lit !== first || lit.toLowerCase().startsWith(typed.toLowerCase()) ? lit : null;
    }
}

/**
 * Notes to choose a template from (OBS-283): the vault's own that the field would take, the one typed
 * exactly first, then those whose path starts with it, then those that hold it. Leaving the field while
 * the list is open takes the note it chose (FolderSuggest.chosen).
 * @extends {FolderSuggest}
 */
class NoteSuggest extends FolderSuggest {
    // How many notes the list shows at most
    static MAX = 50;

    /** @param {string} query @returns {string[]} */
    getSuggestions(query) {
        const q = query.trim().toLowerCase();
        /** @param {string} f */
        const rank = (f) => { const l = f.toLowerCase(); return l === q || l === `${q}.md` ? 0 : l.startsWith(q) ? 1 : 2; };
        const takes = this.prepare ? this.prepare() : this.takes;
        this.drawn = new Map();
        return this.app.vault.getMarkdownFiles().map((f) => f.path).filter((f) => f.toLowerCase().includes(q) && takes(f))
            .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, NoteSuggest.MAX);
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

// How to get the links (Add calendar's and Edit's "Where to find it"): that a link works like a
// password, where each provider keeps a calendar's link, and what doesn't work
const LINK_NOTE = "Treat calendar links like a password. If one leaks, reset at the source and get a new link. To sync a calendar that was shared with you, you'll need to ask the owner for the link.";
const HELP = [
    ["Google Calendar", "On the web: Settings, then the calendar under Settings for my calendars, then Integrate calendar. Copy the Secret address in iCal format."],
    ["iCloud", "In Calendar, share the calendar and turn on Public Calendar, then copy its link (it starts with webcal://)."],
    ["Outlook", "On the web: Settings, Calendar, Shared calendars, then Publish a calendar. Choose the calendar and Can view all details, then copy the ICS link."],
    ["A subscribed calendar", "(holidays, a team's schedule) uses the address you subscribed from. Apple publishes its holiday calendars at a public address."],
];
const HELP_LIMITS = "Also note that a Google Workspace or Microsoft 365 admin can disable private links.";

class CalendarHelpModal extends Modal {
    onOpen() {
        this.setTitle("How to get the links");
        this.contentEl.createEl("p", {}, (p) => {
            p.createEl("strong", { text: "NOTE:" });
            p.appendText(` ${LINK_NOTE}`);
        });
        const list = this.contentEl.createEl("ul");
        for (const [what, how] of HELP) {
            list.createEl("li", {}, (li) => {
                li.createEl("strong", { text: what });
                li.appendText(` ${how}`);
            });
        }
        this.contentEl.createEl("p", { text: HELP_LIMITS });
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
        // Adding: the field's name and placeholder say what to paste, so the description is only the link
        // (Brian, 2026-11-17). Editing says what a blank field would leave alone.
        linkSetting.descEl.appendText(!editing ? ""
            : settings.link(editing.id) !== null ? "This calendar is already linked. Leave blank or paste a new link to replace it. "
                : "This device has no link for it yet. ");
        linkSetting.descEl.createEl("a", { text: "Where to find it", href: "#", cls: "plainday-link" }, (a) => a.addEventListener("click", (e) => {
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
        // The eye shows the link as it was typed or pasted, to check it, and hides it again (Brian, 11/20)
        let shown = false;
        linkSetting.addExtraButton((b) => {
            const draw = () => b.setIcon(shown ? "eye-off" : "eye").setTooltip(shown ? "Hide link" : "Show link");
            draw();
            b.onClick(() => {
                shown = !shown;
                linkInput.inputEl.toggleClass("plainday-masked", !shown);
                draw();
            });
        });
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
        // The email address you're invited at on this calendar: the sync leaves out invitations it declined
        const addressSetting = new Setting(details).setName("Email address for this calendar");
        const addressInput = new TextComponent(addressSetting.controlEl);
        addressInput.inputEl.autocomplete = "off";
        const addressLine = addressSetting.descEl.createDiv({ cls: "mod-warning" });
        if (editing) {
            nameInput.setValue(editing.name);
            accountInput.setValue(editing.account);
            addressInput.setValue(editing.address);
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
        const address = () => settings.addressOf(addressInput.getValue());
        // A line under the address when it isn't one
        const showAddresses = () => {
            const { bad } = address();
            addressLine.setText(bad ? "That isn't an email address." : "");
            return !bad;
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
            return { name, account: accountInput.getValue(), address: address().address };
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
                if (!given.address && own) given.address = own;
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
    // The plugin a frozen table needs: without it the marks Plainday writes do nothing (OBS-283)
    static TABLES_PLUGIN = "selectable-tables";
    static TABLES_PLUGIN_NAME = "Selectable Tables";

    /**
     * Whether a community plugin is installed and on. `app.plugins` isn't in Obsidian's public types,
     * so it's read through one cast here rather than at each use.
     * @param {import("obsidian").App} app @param {string} id
     * @returns {boolean}
     */
    static hasPlugin(app, id) {
        const plugins = /** @type {{ plugins?: { getPlugin?: (id: string) => unknown } }} */ (/** @type {unknown} */ (app)).plugins;
        return !!plugins?.getPlugin?.(id);
    }

    // Obsidian 1.13 and later: the sections as setting definitions, drawn and searched by Obsidian
    getSettingDefinitions() {
        /** @param {Section} section @returns {import("obsidian").SettingDefinitionGroup} */
        const group = ({ heading, rows }) => ({
            type: "group",
            ...(heading ? { heading } : {}),
            items: rows.map(({ name, desc, render, visible, page }) => (page
                ? { type: /** @type {const} */ ("page"), name, ...(desc ? { desc } : {}), displayValue: page.displayValue, items: page.sections.map(group), ...(visible ? { visible } : {}) }
                : { name, ...(desc ? { desc } : {}), render, ...(visible ? { visible } : {}) })),
        });
        return this.sections().map(group);
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
        /** @param {Section[]} sections */
        const draw = (sections) => {
            for (const { heading, rows } of sections) {
                const group = new SettingGroup(this.containerEl);
                if (heading) group.setHeading(heading);
                /** @type {Page[]} */
                const pages = [];
                for (const { name, desc, render, visible, page } of rows) {
                    if (page) {
                        if (!visible || visible()) pages.push(page);
                        continue;
                    }
                    group.addSetting((s) => {
                        s.setName(name);
                        if (desc) s.setDesc(desc);
                        const cleanup = render(s);
                        if (cleanup) waiting.push(/** @type {{ save?: () => void }} */ (cleanup).save ?? cleanup);
                        if (visible) shown.push({ el: s.settingEl, visible });
                    });
                }
                for (const page of pages) draw(page.sections);
            }
        };
        draw(this.sections());
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
        // Folders and Note templates sit near the top; Other, which the same helper builds, goes last
        const [folders, templates, other] = this.folderSections(store, problem);

        return [
            {
                heading: null,
                rows: [
                    row("Backup and transfer", "Copy and paste settings between devices. Use this option when you're not syncing installed plugins. Pasting will overwrite existing settings.", (s) => {
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
            folders, templates,
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
                    row("Note", "An optional message to include at the end of each invoice.", (s) => s.addTextArea((t) => {
                        t.inputEl.rows = 3;
                        t.setValue(now().invoices.paymentNote).onChange((v) => { void store(s, "invoices", { paymentNote: settings.multiline(v) }); });
                    })),
                    field("Invoice folder", "", (s) => {
                        const archive = () => settings.folders().archive;
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
                            const { folder, error, taken } = plainday.Billing.folderOf(v, archive());
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
                            const list = new FolderSuggest(this.app, t.inputEl, "Invoices", (f) => !plainday.Billing.folderOf(f, archive()).error);
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
                    // Without Selectable Tables a freeze does nothing, so the switch can't be turned on:
                    // it's disabled and says what's missing (Brian, 2026-11-17)
                    row("Freeze rows and columns", "Applies only to tables created by Plainday.", (s) => {
                        const installed = !!PlaindaySettingTab.hasPlugin(this.app, PlaindaySettingTab.TABLES_PLUGIN);
                        s.addToggle((t) => {
                            t.setValue(freezing).setDisabled(!installed).onChange((on) => {
                                // On freezes the header row and the first column, off unfreezes both
                                freezing = on;
                                const n = on ? 1 : 0;
                                for (const d of freezes) d.setValue(String(n));
                                void store(s, "tables", { freezeRows: n, freezeColumns: n });
                                this.refreshShown();
                            });
                        });
                        if (!installed) problem(s, `The ${PlaindaySettingTab.TABLES_PLUGIN_NAME} plugin isn't installed, so a freeze would do nothing.`, false);
                    }),
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
            // Other comes last, after the calendars (Brian, 2026-11-17)
            other,
        ];
    }

    /**
     * Folders and Note templates (OBS-283). Each folder or note is checked as you type and saved when you
     * leave the field (or the panel closes), as the invoice folder is; one that doesn't read is refused
     * with a line under it, and the field goes back to the saved value. The daily notes' rows only show
     * what the Daily notes plugin has, which is where they're set.
     * @param {(setting: Setting, section: "folders" | "templates", values: Record<string, string>) => Promise<void>} store
     * @param {(setting: Setting, text: string, warn?: boolean) => void} problem
     * @returns {Section[]}
     */
    folderSections(store, problem) {
        const settings = plainday.Settings, billing = plainday.Billing;
        const Settings = /** @type {typeof import("./shared/settings.js").default} */ (settings.constructor);
        const now = () => settings.get();
        // The Daily notes plugin's folder, name format and template, as Schedule reads them
        /** @param {{ asPlugin?: boolean }} [opts] */
        const daily = (opts) => /** @type {{ folder: string, format: string, template: string }} */ (plainday.Schedule.dailyOpts(opts));

        /** @param {string} v */
        const code = (v) => `\`${v}\``;
        // A folder that isn't in the vault yet: the command that files a note there makes it
        /** @param {string} folder */
        const missingFolder = (folder) => !!folder && !this.app.vault.getFolderByPath(folder);
        /** @param {string} path */
        const missingNote = (path) => !!path && !this.app.vault.getFileByPath(path);
        /**
         * A folder or note field: `read(typed)` gives { value } or { error }; `saved()` the saved value;
         * `note(value)` the orange line for a value that reads ("" for none); `list(input)` the list to
         * choose from, which offers only what `read` takes (none for the error log). Leaving the field
         * with the list open takes the row it highlights only when you chose it (FolderSuggest.chosen),
         * so a folder you didn't choose never replaces what you typed.
         * @param {string} name @param {string} desc
         * @param {{ saved: () => string, read: (v: string) => { value: string, error?: undefined } | { error: string, value?: undefined }, save: (s: Setting, value: string) => Promise<void>, placeholder: () => string, note: (value: string) => string, list: ((input: HTMLInputElement) => FolderSuggest) | null, was: (value: string) => string }} how
         * @returns {Row}
         */
        const pathField = (name, desc, how) => field(name, desc, (s) => {
            /** @type {string | null} */
            let waiting = null;
            /** @type {import("obsidian").TextComponent | null} */
            let input = null;
            /** @type {FolderSuggest | null} */
            let suggest = null;
            /** @param {string} v */
            const check = (v) => {
                const got = how.read(v);
                waiting = got.error === undefined ? got.value : null;
                if (got.error !== undefined) problem(s, `Not used: ${got.error}. ${how.was(how.saved())}`);
                else problem(s, how.note(got.value), false);
            };
            // Leaving the field: with something typed and the list open, what it highlights; else what's
            // typed when it reads, and the saved value at once when it doesn't, its line still saying why
            const leave = () => {
                const typed = input !== null ? input.getValue().trim() : "";
                const pick = suggest !== null ? suggest.chosen(typed) : null;
                if (pick && input !== null) {
                    input.setValue(pick);
                    check(pick);
                }
                const value = waiting;
                waiting = null;
                if (value !== null && value !== how.saved()) void how.save(s, value);
                if (value !== null) problem(s, how.note(value), false);
                input?.setValue(value ?? how.saved());
            };
            s.addText((t) => {
                input = t;
                t.setPlaceholder(how.placeholder()).setValue(how.saved()).onChange(check);
                t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Tab") leave(); });
                t.inputEl.addEventListener("change", leave);
                if (!how.list) return;
                const list = how.list(t.inputEl);
                suggest = list;
                list.onSelect((v) => {
                    t.setValue(v);
                    check(v);
                    leave();
                    list.close();
                });
            });
            problem(s, how.note(how.saved()), false);
            return leave;
        });

        // Projects, the Inbox and the archive carry no description: their names say what they hold, and
        // the manual has the detail (Brian, 2026-11-16)
        /** @type {Record<"projects" | "inbox" | "archive", string>} */
        const system = { projects: "Projects", inbox: "Inbox", archive: "Archive" };
        // A path with each folder the vault has spelled as it is there, in any case: `projects/clients` is
        // `Projects/Clients` (a Mac refuses a folder that differs from one it has only in case)
        /** @param {string} path */
        const spelled = (path) => (path ? String(plainday.Invoice.realFolder(path)) : path);
        // A note's path as the vault spells it: the note it already has in another case, else its folders
        // spelled as the vault spells them, with the name as typed
        /** @param {string} path */
        const spelledNote = (path) => {
            if (!path) return path;
            const there = this.app.vault.getMarkdownFiles().find((f) => f.path.toLowerCase() === path.toLowerCase());
            if (there) return there.path;
            const at = path.lastIndexOf("/");
            return at < 0 ? path : `${spelled(path.slice(0, at))}${path.slice(at)}`;
        };
        // The daily notes' folder and the weekly, monthly and yearly notes' folders in use: none of
        // Projects, the Inbox and the archive may be one of them, hold one, or sit inside one
        /** @returns {[string, string][]} */
        const planner = () => {
            const p = plainday.TimeReport.periodFolders();
            return /** @type {[string, string][]} */ ([["the daily notes' folder", daily().folder], ["the weekly notes' folder", p.week], ["the monthly notes' folder", p.month], ["the yearly notes' folder", p.year]]).filter(([, f]) => !!f);
        };
        /** @param {string} folder @param {[string, string][]} plan @returns {string | null} */
        const meetsPlanner = (folder, plan) => {
            const a = folder.toLowerCase();
            for (const [name, f] of plan) {
                const b = f.toLowerCase();
                if (a === b) return `it's ${name}`;
                if (a.startsWith(`${b}/`)) return `it's inside ${name}, ${f}`;
                if (b.startsWith(`${a}/`)) return `${name}, ${f}, is inside it`;
            }
            return null;
        };
        // What Projects, the Inbox or the archive takes: { value } as the vault spells it, or { error }. A
        // list passes the Planner's folders it read once (`plan`), and a folder from the vault (`own`),
        // already spelled as it is there.
        /**
         * @param {"projects" | "inbox" | "archive"} key @param {string} v
         * @param {{ plan?: [string, string][], own?: boolean }} [opts]
         * @returns {{ value: string, error?: undefined } | { error: string, value?: undefined }}
         */
        const systemRead = (key, v, { plan = planner(), own = false } = {}) => {
            const got = billing.pathOf(v);
            if (got.error) return { error: `it ${got.error}` };
            const folder = got.folder && !own ? spelled(got.folder) : got.folder;
            if (folder && this.app.vault.getFileByPath(folder)) return { error: "it's a note, not a folder" };
            const next = { ...settings.folders(), [key]: folder };
            const wrong = settings.foldersProblem(next, billing, key);
            if (wrong) return { error: wrong.problem };
            const planned = meetsPlanner(folder, plan);
            if (planned) return { error: planned };
            // The invoice folder can't be in the archive
            const invoices = now().invoices.folder;
            if (key === "archive" && invoices && billing.folderOf(invoices, folder).taken) return { error: `the invoice folder, ${invoices}, is inside it` };
            return { value: folder };
        };
        /** @param {"projects" | "inbox" | "archive"} key */
        const systemField = (key) => pathField(system[key], "", {
            saved: () => now().folders[key],
            read: (v) => systemRead(key, v),
            save: (s, value) => store(s, "folders", { [key]: value }),
            placeholder: () => Settings.FOLDERS[key],
            note: (value) => (missingFolder(value) ? `“${value}” doesn't exist yet. Plainday will create it when it first files a note there.` : ""),
            list: (input) => new FolderSuggest(this.app, input, Settings.FOLDERS[key], (f) => systemRead(key, f).error === undefined, () => {
                const plan = planner();
                return (f) => systemRead(key, f, { plan, own: true }).error === undefined;
            }),
            was: (value) => `${system[key]} stays ${code(value)}.`,
        });
        /** @type {Record<"week" | "month" | "year", string>} */
        const periods = { week: "Weekly", month: "Monthly", year: "Yearly" };
        // The folder each one sits in when its field is blank, beside the daily notes
        /** @type {Record<"week" | "month" | "year", string>} */
        const beside = { week: "weeks", month: "months", year: "years" };
        const asBefore = () => plainday.TimeReport.periodFolders({ asBefore: true });
        // What a weekly, monthly or yearly folder takes: blank (as before), or a folder as the vault spells
        // it that isn't Projects, the Inbox or the archive, holds one, or sits inside one
        /** @param {string} v @param {boolean} [own] a folder from the vault, already spelled as it is there @returns {{ value: string, error?: undefined } | { error: string, value?: undefined }} */
        const periodRead = (v, own = false) => {
            const got = billing.pathOf(v);
            if (got.error) return { error: `it ${got.error}` };
            const folder = got.folder && !own ? spelled(got.folder) : got.folder;
            const meets = folder ? settings.overlap(folder) : null;
            if (meets) {
                const named = meets.name === meets.folder ? meets.name : `${meets.name} (${meets.folder})`;
                return { error: meets.how === "is" ? `it's the ${meets.name} folder` : meets.how === "in" ? `it's inside ${named}` : `${named} is inside it` };
            }
            return { value: folder };
        };
        /** @param {"week" | "month" | "year"} unit */
        // Each says what names its notes, as the daily notes' row does (OBS-299): Plainday's own names here
        const periodField = (unit) => pathField(`${periods[unit]} notes`, `Default: \`${beside[unit]}\` in same folder as daily notes. Named ${code(/** @type {{ format: Record<string, string> }} */ (plainday.DatePrompt.weekRules()).format[unit])}.`, {
            saved: () => now().folders[unit],
            read: (v) => periodRead(v),
            save: (s, value) => store(s, "folders", { [unit]: value }),
            placeholder: () => asBefore()[unit],
            note: (value) => (missingFolder(value) ? `“${value}” doesn't exist yet. Plainday will create it with the first ${periods[unit].toLowerCase()} note.` : ""),
            list: (input) => new FolderSuggest(this.app, input, "", (f) => periodRead(f, true).error === undefined),
            was: (value) => `${periods[unit]} notes stay ${value ? code(value) : "as before"}.`,
        });
        /** @param {"week" | "month" | "year"} unit */
        const templateField = (unit) => {
            const jump = plainday.JumpToDate;
            const before = () => settings.defaultTemplatePath(unit);
            // The line under a template: it isn't there yet, or it sets a property Plainday writes itself
            /** @param {string} value */
            const note = (value) => {
                if (missingNote(value)) return `“${value}” isn't in the vault, so the template Plainday used before is used until it is.`;
                const file = value ? this.app.vault.getFileByPath(value) : jump.templateFor(unit, { asBefore: true });
                const props = Object.keys(file ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {});
                return settings.templateWarning(props, Settings.WRITES[unit] ?? []);
            };
            return pathField(`${periods[unit]} note`, "", {
                saved: () => now().templates[unit],
                read: (v) => {
                    const got = settings.notePathOf(v);
                    return got.error ? { error: `it ${got.error}` } : { value: got.path };
                },
                save: (s, value) => store(s, "templates", { [unit]: value }),
                placeholder: () => before(),
                note,
                list: (input) => new NoteSuggest(this.app, input, "", (f) => settings.notePathOf(f).error === null),
                was: (value) => `The ${periods[unit].toLowerCase()} note's template stays ${value ? code(value) : "as before"}.`,
            });
        };

        // The Task and Log templates a task note and a log are made with (OBS-283). Their names are what they make,
        // and their default is the path the command had written into it. Both are optional (OBS-121, OBS-122).
        /** @type {Record<"task" | "log", string>} */
        const made = { task: "Task note", log: "Log" };
        /** @param {"task" | "log"} kind */
        const madeField = (kind) => pathField(made[kind], "", {
            saved: () => now().templates[kind],
            read: (v) => {
                const got = settings.notePathOf(v);
                if (got.error) return { error: `it ${got.error}` };
                return { value: got.path ? spelledNote(got.path) : "" };
            },
            save: (s, value) => store(s, "templates", { [kind]: value }),
            placeholder: () => settings.defaultTemplatePath(kind),
            note: (value) => {
                const path = value || settings.defaultTemplatePath(kind);
                // A task note or a log is made without one (OBS-121, OBS-122)
                if (missingNote(path)) return `“${path}” isn't in the vault, so ${kind === "task" ? "task notes" : "logs"} are made without a template.`;
                const file = this.app.vault.getFileByPath(path);
                const props = Object.keys(file ? this.app.metadataCache.getFileCache(file)?.frontmatter ?? {} : {});
                return settings.templateWarning(props, Settings.WRITES[kind] ?? []);
            },
            list: (input) => new NoteSuggest(this.app, input, "", (f) => settings.notePathOf(f).error === null),
            was: (value) => `The ${made[kind].toLowerCase()} template stays ${code(value || settings.defaultTemplatePath(kind))}.`,
        });

        // Periodic notes: a page of its own under Folders, whose first row is which calendar owns them
        // (Brian, 2026-11-16). With Notebook Navigator's, every row there is what it says, with no field.
        const source = () => settings.periodicSource();
        const navigator = () => source() === "notebook-navigator";
        // A row that only says where a note goes and who decides: used for the daily notes, and for every
        // periodic note in the Notebook Navigator source. When Navigator has no pattern Plainday can
        // follow for a unit, the row says what decides instead, rather than crediting Navigator (OBS-283).
        // A folder row says what names its notes, and warns when Plainday can't follow them or their names
        // don't give their whole date (Settings.periodicWarning, OBS-299).
        /** @param {string} name @param {"day" | "week" | "month" | "year"} unit @param {"folder" | "template"} part */
        const shown = (name, unit, part) => row(name, "", (s) => {
            const nn = navigator() ? settings.navigatorNote(unit) : null;
            const plugin = daily({ asPlugin: true });
            const value = part === "folder"
                ? (unit === "day" ? daily().folder : plainday.TimeReport.periodFolders()[unit])
                : (unit === "day" ? daily().template : nn?.template ?? "");
            // When Plainday can't follow Navigator's pattern for these, the red line below says why and
            // where they are instead (Settings.periodicWarning); a template waits until it can
            const off = navigator() && unit !== "day" ? settings.navigatorUnfollowed(unit) : null;
            const where = nn ? ". Set in Notebook Navigator."
                : unit === "day" || !navigator() ? ". Set in Settings → Daily notes."
                    : off?.reason === "empty" ? ". Notebook Navigator has no pattern for these, so they're Plainday's own."
                        : part === "folder" ? ". Set in Notebook Navigator." : ", until Plainday can file these notes where Notebook Navigator does.";
            // A folder row also says what names its notes, which is the other half of finding them: the
            // name Plainday reads them by (Schedule.dailyOpts for a day, DatePrompt.weekRules for the
            // rest), so all four rows read alike (Brian, 11/20, OBS-299)
            const names = unit === "day" ? (nn ? nn.format : plugin.format)
                : /** @type {{ format: Record<string, string> }} */ (plainday.DatePrompt.weekRules()).format[unit];
            const named = part === "folder" ? `, named ${code(names)}` : "";
            const shownValue = value ? code(part === "template" && !value.endsWith(".md") ? `${value}.md` : value) : part === "folder" ? "The top of the vault" : "None";
            s.descEl.empty();
            s.descEl.appendText(`${shownValue}${named}${where}`);
            // A folder row whose notes Plainday can't follow, or whose names don't give their whole date,
            // says so in a line of its own (OBS-299). Made here, after empty(), so a redraw never keeps
            // an old one.
            const warning = part === "folder" ? settings.periodicWarning(unit) : "";
            if (warning) s.descEl.createDiv({ cls: "mod-warning", text: warning });
        });

        /** @returns {Section[]} */
        const periodicSections = () => [
            {
                heading: null,
                rows: [
                    row("Define periodic notes using", "",
                        (s) => s.addDropdown((d) => d.addOptions(Object.fromEntries(Settings.SOURCES.map((v) => [v, Settings.SOURCE_NAMES[v]])))
                            .setValue(source()).onChange((v) => {
                                void store(s, "folders", { periodic: v }).then(() => this.redraw());
                            }))),
                ],
            },
            {
                heading: "Folders",
                rows: [
                    shown("Daily notes", "day", "folder"),
                    ...(navigator()
                        ? [shown("Weekly notes", "week", "folder"), shown("Monthly notes", "month", "folder"), shown("Yearly notes", "year", "folder")]
                        : [periodField("week"), periodField("month"), periodField("year")]),
                ],
            },
            {
                heading: "Templates",
                rows: [
                    shown("Daily note", "day", "template"),
                    ...(navigator()
                        ? [shown("Weekly note", "week", "template"), shown("Monthly note", "month", "template"), shown("Yearly note", "year", "template")]
                        : [templateField("week"), templateField("month"), templateField("year")]),
                ],
            },
        ];

        // The error log note: a note Plainday writes rather than a folder it files into, so it sits in
        // Other at the end rather than among the folders (Brian, 2026-11-17)
        const errorLogField = () =>
                    pathField("Error log note", "", {
                        saved: () => now().folders.errorLog,
                        read: (v) => {
                            const got = settings.notePathOf(v);
                            if (got.error) return { error: `it ${got.error}` };
                            // The note as the vault spells it, so a path in another case can't make a
                            // second log beside the one that's there (a Mac's volume ignores case)
                            const path = spelledNote(got.path);
                            // A note of yours with sections of its own: the log would move them after its own
                            // (its properties and any text above its first heading stay where they are)
                            const there = path ? this.app.vault.getFileByPath(path) : null;
                            const heads = (there && this.app.metadataCache.getFileCache(there)?.headings) ?? [];
                            const ours = /** @type {{ SECTIONS: string[] }} */ (plainday.ErrorLog.constructor).SECTIONS;
                            if (heads.some((h) => h.level === 2 && !ours.includes(h.heading))) return { error: "it's a note of yours with sections of its own, which the error log would move" };
                            return { value: path };
                        },
                        save: (s, value) => store(s, "folders", { errorLog: value }),
                        placeholder: () => settings.defaultErrorLogPath(),
                        note: (value) => (missingNote(value) ? `“${value}” isn't in the vault yet. The next run that finds a Problem makes it.` : ""),
                        list: null,
                        was: (value) => `The error log stays ${code(value || settings.defaultErrorLogPath())}.`,
                    })
;
        return [
            {
                heading: "Folders",
                rows: [
                    systemField("projects"),
                    systemField("inbox"),
                    systemField("archive"),
                    {
                        ...row("Periodic notes", "", () => {}),
                        page: { displayValue: Settings.SOURCE_NAMES[source()], sections: periodicSections() },
                    },
                ],
            },
            {
                heading: "Note templates",
                rows: [madeField("task"), madeField("log")],
            },
            {
                heading: "Other",
                rows: [errorLogField()],
            },
        ];
    }

    /**
     * What a calendar's row says about its link on this device: nothing when it works, else what to do
     * (the last Sync calendars that read it says whether it stopped working, OBS-275)
     * @param {string} id
     * @returns {string}
     */
    linkSaid(id) {
        if (!plainday.Settings.link(id)) return "Add link on this device: Edit, then paste it";
        return plainday.CalendarSync?.deadLink?.(id) ? "Link stopped working on this device: Edit, then paste a new one" : "";
    }

    /**
     * Calendars (OBS-282): Add calendar, whose description links to How to get the links, the sync range,
     * and the calendar list, a page of each account's calendars, accounts and calendars in alphabetical
     * order
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
        const taken = new Set(["", "folders", "note templates", "invoices", "tables", "editor", "calendars"]);
        for (const c of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
            const name = c.account || "No account";
            const account = taken.has(name.toLowerCase()) ? `${name} calendars` : name;
            accounts.set(account, [...(accounts.get(account) ?? []), c]);
        }
        /** @param {Calendar[]} calendars @returns {[Calendar, string][]} */
        const named = (calendars) => {
            /** @type {Set<string>} */
            const used = new Set();
            /** @type {[Calendar, string][]} */
            const out = [];
            for (const c of calendars) {
                const base = c.name || "Untitled calendar";
                let name = base;
                for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
                used.add(name);
                out.push([c, name]);
            }
            return out;
        };
        const help = () => new CalendarHelpModal(this.app).open();
        return [
            {
                heading: "Calendars",
                rows: [
                    // Its description links to How to get the links, drawn with the row, so the link is a
                    // new one each time Obsidian draws it
                    row("Add calendar", "", (s) => {
                        s.descEl.empty();
                        s.descEl.appendText("You'll need to copy its ");
                        s.descEl.createEl("a", { text: "private link", href: "#", cls: "plainday-link" }, (a) => a.addEventListener("click", (e) => {
                            e.preventDefault();
                            help();
                        }));
                        s.addButton((b) => b.setButtonText("Add calendar").onClick(() => dialog(null)));
                    }),
                    row("Sync range", "How far ahead to write events into daily notes.",
                        (s) => s.addDropdown((d) => d.addOptions(ranges).setValue(settings.get().calendars.range).onChange((v) => { void store(s, "calendars", { range: v }); }))),
                    // One device writes the events (OBS-275): kept on this device only, never in a copy, which
                    // the icon before its description says (Brian, 11/19). Obsidian draws the description first.
                    row("Sync calendars using this device", "This setting is per-device. Only one device can be used to sync calendars.", (s) => {
                        const icon = s.descEl.createSpan({ cls: "plainday-not-synced", attr: { "aria-label": "Not synced between devices" } });
                        setIcon(icon, "refresh-cw-off");
                        s.descEl.prepend(icon);
                        s.addToggle((t) => t.setValue(settings.syncHere()).onChange((on) => settings.setSyncHere(on)));
                    }),
                    // The calendars, each account's, on a page of their own
                    {
                        ...row("Calendar list", "", () => {}),
                        visible: () => list.length > 0,
                        page: {
                            displayValue: `${list.length} calendar${list.length === 1 ? "" : "s"}`,
                            sections: [...accounts].sort((a, b) => a[0].localeCompare(b[0])).map(([account, calendars]) => ({
                                heading: account,
                                rows: named(calendars).map(([c, name]) => row(name, this.linkSaid(c.id), (s) => {
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
                        },
                    },
                ],
            },
        ];
    }
}
