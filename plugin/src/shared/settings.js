import { getFrontMatterInfo, Notice, parseYaml } from "obsidian";
import { app, plainday } from "../host.js";

export default class Settings {
    // Plainday's settings (OBS-80, OBS-281): what Settings → Plainday shows, kept in Plainday's own data
    // file (.obsidian/plugins/plainday/data.json, through the plugin's loadData and saveData), never in a
    // note. Plainday loads them before anything runs (main.js), and every class reads them from here,
    // from memory: `plainday.Settings.get().invoices.folder`.
    //
    //   - invoices: your name, address, terms and payment note, which head and close each invoice; the
    //     folder new invoices go in (blank until you choose one); the first invoice number, which the
    //     panel shows; and the last number given, which it doesn't: Invoice raises it, so a deleted
    //     invoice's number is never given again, and typing a first number sets it to one less.
    //   - tables: the default freeze for every table the system writes (TimeReport, OBS-238).
    //   - editor: whether ListCursor runs (OBS-221).
    //   - calendars (OBS-282): how far ahead Sync calendars writes events (`range`), and the calendars
    //     added by their private links, each { id, name, account, address, on }: `address` is your email
    //     address on that calendar, by which the calendar reader leaves out an invitation you declined. A calendar's link is never here: it's in this device's secret storage, under
    //     `plainday-calendar-<this vault's key>-<its id>` (link(), storeLink()), so it's never in a note,
    //     Plainday's data file, the console or a notice. The vault's key, random and kept in this vault's
    //     own local storage (vaultKey()), keeps two vaults apart on a phone, where Obsidian keeps one
    //     secret storage for every vault. Until OBS-275, nothing syncs from the list; Sync calendars reads
    //     only the range from here.
    //   - folders (OBS-283): where projects and areas live (`projects`), where Plainday puts a note it
    //     makes before the note has a project (`inbox`, Plainday's own: Obsidian's Default location for
    //     new notes decides where notes you make go), where finished projects go (`archive`), the
    //     weekly, monthly and yearly notes' folders (`week`, `month`, `year`: blank is as before,
    //     TimeReport.periodFolders' rule), and the error log note (`errorLog`: blank is errorLogPath's
    //     rule). Every command reads them from here (folders(), errorLogPath()), so no folder is written
    //     into a command. Changing one moves no notes. The daily notes' folder, name and template are
    //     the Daily notes plugin's, never asked again here.
    //   - templates (OBS-283): the weekly, monthly and yearly notes' templates (blank is as before:
    //     JumpToDate.templateFor's rule). Task notes, logs, projects and areas get theirs with the
    //     commands that make them in code (OBS-121 to OBS-123).
    //
    // Whatever comes in, from the data file, a copy from another device or the old settings notes, goes
    // through normalize(), so a value that doesn't read becomes its default and the rest can trust what
    // they get.
    //
    // Vaults from before: on a device with no settings saved, the first load reads Config/Invoice
    // Settings.md and Config/Table Settings.md once (readOldNotes), saves what they held, and says so.
    // From then on the notes are never read again; they're left for you to delete. Likewise the
    // `Sync range:` line of Config/Calendar Sync.md, on a device whose settings have no calendars yet
    // (saved before OBS-282); the note itself stays in use for the calendars until OBS-275. A data file that's
    // there but doesn't read (a write cut off, a sync conflict) isn't "no settings": Plainday says so,
    // uses the defaults, and leaves the file alone until you change a setting or paste your settings.
    //
    // A backup, or another device: plugin settings don't sync unless Obsidian Sync carries community
    // plugins, so copyText() is every setting as one block for the clipboard, and readCopy() and
    // replaceWith() take it back, on this device or another. A paste replaces this device's settings
    // but keeps the higher last number given, so no number is given twice. The copy carries each
    // calendar's link from this device's secret storage, beside the settings, and a paste stores them in
    // the other device's.
    static INVOICE_NOTE = "Config/Invoice Settings.md";
    static TABLE_NOTE = "Config/Table Settings.md";
    // Invoice numbers have at most six digits
    static MAX_NUMBER = 999999;
    // A new vault's first invoice is 1001, and none has been given yet
    static FIRST_NUMBER = 1001;
    static FIRST_LAST_NUMBER = 1000;
    // Selectable Tables freezes at most 9 columns; more than 9 frozen rows would fill the screen
    static MAX_FROZEN = 9;
    // What a copy is marked with, and its format's version
    static COPY_MARK = "plainday-settings";
    static COPY_VERSION = 1;
    // How far ahead Sync calendars writes events: the choices, and the days each means (OBS-282)
    static RANGES = [["1 week", 7], ["2 weeks", 14], ["3 weeks", 21], ["1 month", 31], ["2 months", 62], ["3 months", 92], ["6 months", 183]];
    static DEFAULT_RANGE = "2 months";
    static CALENDAR_NOTE = "Config/Calendar Sync.md";
    // A calendar's ID, which also names its link in secret storage: lowercase letters and digits, as
    // secret storage's names must be
    static ID = /^[a-z0-9]{1,32}$/;
    static SECRET_PREFIX = "plainday-calendar-";
    // An email address, as much as the reader needs: something@something, with no spaces, and no / or
    // : so no link is ever taken for one
    static ADDRESS = /^[^\s@,;<>()"/:]+@[^\s@,;<>()"/:]+$/;
    // Text that holds a link, with its scheme or without (a server's name ending in a top-level domain,
    // then a path): a calendar's link pasted into its name or account is never kept there. "Team 2.0/Ops"
    // isn't one.
    static LINKISH = /:\/\/|^\s*(?:https?|webcals?):|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S/i;
    // Where this vault keeps its key for the names of its secrets (app.saveLocalStorage: this vault's,
    // on this device)
    static VAULT_KEY = "plainday-calendar-key";
    // The system's folders in a new vault (OBS-283), which are the folders the system always used, so a
    // vault from before changes nothing. TimeReport keeps a copy for where Plainday isn't loaded (the
    // Raycast timer, the private tests), which settings.test.mjs holds to this one.
    static FOLDERS = { projects: "Projects", inbox: "Inbox", archive: "Archive" };
    // What each of the three is called in a message, by its setting's name
    static FOLDER_NAMES = { projects: "Projects", inbox: "Inbox", archive: "Archive" };
    // The weekly, monthly and yearly notes, by their unit
    static PERIODS = ["week", "month", "year"];
    // The system's own folder in a vault from before: never a place for the three, or for invoices
    static SYSTEM_FOLDER = "Config";
    // The error log note: where it is in a vault from before (it, or the Config folder, is there), and
    // where it goes in a new one
    static OLD_ERROR_LOG = "Config/Error Log.md";
    static NEW_ERROR_LOG = "Plainday error log.md";
    // The properties Plainday writes itself into each kind of note it makes, which a template's own
    // would give way to (Settings → Plainday → Note templates warns). The list for weekly, monthly and
    // yearly notes comes with OBS-120, which makes them in code; until then no row warns. List
    // properties are combined with a template's, not replaced, so they never warn.
    /** @type {Record<"week" | "month" | "year", string[]>} */
    static WRITES = { week: [], month: [], year: [] };
    static COMBINED = ["tags", "aliases"];
    // What loading says when the saved Projects, Inbox or archive didn't read: at the start, and when
    // Sync brings such a file
    static DROPPED_SYNC = "Plainday's settings file, changed by Sync, has Projects, Inbox and Archive folders that don't hold together (one is inside another, or isn't a folder), so it keeps the ones it had. Check them in Settings → Plainday → Folders.";

    constructor() {
        this.data = this.defaults();
        // Whether this device has settings saved: until it has, the first load reads the old notes
        this.saved = false;
        // Whether the data file is there but doesn't read
        this.unreadable = false;
        // Whether the saved settings have calendars: until they have, the first load reads the range
        // from the Calendar Sync note (settings saved before OBS-282 have none)
        this.calendarsSaved = false;
        // Whether the saved settings have folders (settings saved before OBS-283 have none)
        this.foldersSaved = false;
    }

    // ---------------------------------------------------------------- pure

    /**
     * Every setting at its default: what a new vault starts with
     * @returns {{
     *   invoices: { name: string, address: string[], terms: string, paymentNote: string, folder: string, firstNumber: number, lastNumber: number },
     *   tables: { freezeRows: number, freezeColumns: number },
     *   editor: { listCursor: boolean },
     *   calendars: { range: string, list: Calendar[] },
     *   folders: { projects: string, inbox: string, archive: string, week: string, month: string, year: string, errorLog: string },
     *   templates: { week: string, month: string, year: string },
     * }}
     * @typedef {{ id: string, name: string, account: string, address: string, on: boolean }} Calendar
     */
    defaults() {
        return {
            invoices: { name: "", address: [], terms: "", paymentNote: "", folder: "", firstNumber: Settings.FIRST_NUMBER, lastNumber: Settings.FIRST_LAST_NUMBER },
            tables: { freezeRows: 0, freezeColumns: 0 },
            editor: { listCursor: true },
            calendars: { range: Settings.DEFAULT_RANGE, list: [] },
            folders: { ...Settings.FOLDERS, week: "", month: "", year: "", errorLog: "" },
            templates: { week: "", month: "", year: "" },
        };
    }

    /**
     * The settings as they are now
     * @returns {ReturnType<Settings["defaults"]>}
     */
    get() {
        return this.data;
    }

    // One line of text, trimmed; "" for anything else
    text(v) {
        return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    }

    // A note's text: each line trimmed at its end, blank lines at the start and end dropped
    multiline(v) {
        return typeof v === "string" ? v.split(/\r?\n/).map((l) => l.trimEnd()).join("\n").trim() : "";
    }

    // A list of lines, from a list or from text with one item per line: trimmed, blanks dropped
    lines(v) {
        return [].concat(v ?? []).flatMap((x) => (typeof x === "string" || typeof x === "number" ? String(x).split(/\r?\n/) : []))
            .map((x) => x.trim()).filter(Boolean);
    }

    /**
     * A last invoice number: a whole number from 0 to 999999, as a number or as digits. { number, error },
     * with both null when blank.
     * @param {unknown} raw
     * @returns {{ number: number | null, error: string | null }}
     */
    lastNumberOf(raw) {
        if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return { number: null, error: null };
        const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
        if (Number.isInteger(n) && n >= 0 && n <= Settings.MAX_NUMBER) return { number: n, error: null };
        return { number: null, error: `isn't a whole number from 0 to ${Settings.MAX_NUMBER}` };
    }

    /**
     * A first invoice number, as the panel takes it: a whole number from 1 to 999999. { number, error },
     * with both null when blank.
     * @param {unknown} raw
     * @returns {{ number: number | null, error: string | null }}
     */
    firstNumberOf(raw) {
        const n = this.lastNumberOf(raw);
        if (n.number === 0) return { number: null, error: `isn't a whole number from 1 to ${Settings.MAX_NUMBER}` };
        return n.error ? { number: null, error: `isn't a whole number from 1 to ${Settings.MAX_NUMBER}` } : n;
    }

    /**
     * How many rows or columns to freeze: a whole number from 0 to 9, as a number or as digits. { number,
     * error, capped }, with 0 when blank; more than 9 is 9, and `capped` says so.
     * @param {unknown} raw
     * @returns {{ number: number, error: string | null, capped: boolean }}
     */
    frozenOf(raw) {
        if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return { number: 0, error: null, capped: false };
        const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
        if (Number.isInteger(n) && n >= 0) return { number: Math.min(n, Settings.MAX_FROZEN), error: null, capped: n > Settings.MAX_FROZEN };
        return { number: 0, error: "isn't a whole number", capped: false };
    }

    // A note's property by its name, in any case, as the old notes were read (TimeReport.prop)
    prop(props, key) {
        if (key in props) return props[key];
        const k = Object.keys(props).find((x) => x.toLowerCase() === key.toLowerCase());
        return k === undefined ? undefined : props[k];
    }

    /**
     * Settings from whatever was stored or pasted: each value that reads, else its default. The invoice
     * folder follows Billing.folderOf's rules, so it's always a folder in the vault, or "".
     * @param {unknown} raw
     * @param {{ folderOf: (raw: unknown) => { folder: string, error: string | null } }} [billing]
     * @returns {ReturnType<Settings["defaults"]>}
     */
    normalize(raw, billing = plainday.Billing) {
        const out = this.defaults();
        const obj = (v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {});
        const r = obj(raw), inv = obj(r.invoices), tables = obj(r.tables), editor = obj(r.editor);
        // The folders first (OBS-283): the invoice folder can't be inside the archive. The three
        // system folders each read as a folder, or keep their default; three that don't hold together
        // (one inside another) are the defaults, which do.
        const folders = obj(r.folders), templates = obj(r.templates);
        for (const key of /** @type {const} */ (["projects", "inbox", "archive"])) {
            const read = billing.pathOf(typeof folders[key] === "string" ? folders[key] : null);
            if (read.folder && !read.error) out.folders[key] = read.folder;
        }
        if (this.foldersProblem(out.folders, billing)) Object.assign(out.folders, Settings.FOLDERS);
        for (const unit of Settings.PERIODS) {
            const folder = billing.pathOf(typeof folders[unit] === "string" ? folders[unit] : null).folder;
            // A weekly, monthly or yearly folder in Projects, the Inbox, the archive or Config, or holding
            // one, is as before
            out.folders[unit] = folder && this.overlap(folder, out.folders) ? "" : folder;
            out.templates[unit] = this.notePathOf(templates[unit], billing).path;
        }
        out.folders.errorLog = this.notePathOf(folders.errorLog, billing).path;
        out.invoices.name = this.text(inv.name);
        out.invoices.address = this.lines(inv.address);
        out.invoices.terms = this.text(inv.terms);
        out.invoices.paymentNote = this.multiline(inv.paymentNote);
        out.invoices.folder = billing.folderOf(typeof inv.folder === "string" ? inv.folder : null, out.folders.archive).folder;
        out.invoices.firstNumber = this.firstNumberOf(inv.firstNumber).number ?? Settings.FIRST_NUMBER;
        out.invoices.lastNumber = this.lastNumberOf(inv.lastNumber).number ?? Settings.FIRST_LAST_NUMBER;
        out.tables.freezeRows = this.frozenOf(tables.freezeRows).number;
        out.tables.freezeColumns = this.frozenOf(tables.freezeColumns).number;
        if (typeof editor.listCursor === "boolean") out.editor.listCursor = editor.listCursor;
        const calendars = obj(r.calendars);
        out.calendars.range = this.rangeOf(calendars.range) ?? Settings.DEFAULT_RANGE;
        // Each calendar with an ID that can name its link, once; only the keys a calendar has, so no
        // link in a copy or a hand-edited file ever reaches the data file
        const ids = new Set();
        for (const c of Array.isArray(calendars.list) ? calendars.list : []) {
            const cal = obj(c), id = typeof cal.id === "string" ? cal.id : "";
            if (!Settings.ID.test(id) || ids.has(id)) continue;
            ids.add(id);
            out.calendars.list.push({ id, name: this.linkFree(cal.name), account: this.linkFree(cal.account),
                address: this.addressOf(cal.address).address, on: typeof cal.on === "boolean" ? cal.on : true });
        }
        return out;
    }

    // ---------------------------------------------------------------- folders (OBS-283)

    /**
     * Projects, the Inbox and the archive, as they're set
     * @returns {{ projects: string, inbox: string, archive: string }}
     */
    folders() {
        const { projects, inbox, archive } = this.data.folders;
        return { projects, inbox, archive };
    }

    /**
     * What's wrong with a set of the three system folders, or null: the first that doesn't read, is the
     * top of the vault, is inside the system's own folder, or holds another or sits inside it (or is
     * it), with the one it meets. `first`, the one you're changing, is checked first.
     * @param {{ projects: string, inbox: string, archive: string }} folders
     * @param {{ pathOf: (raw: unknown) => { folder: string, error: string | null } }} [billing]
     * @param {"projects" | "inbox" | "archive" | null} [first]
     * @returns {{ key: "projects" | "inbox" | "archive", problem: string } | null}
     */
    foldersProblem(folders, billing = plainday.Billing, first = null) {
        /** @type {("projects" | "inbox" | "archive")[]} */
        const all = ["projects", "inbox", "archive"];
        const keys = first ? [first, ...all.filter((k) => k !== first)] : all;
        const lower = (f) => String(f).toLowerCase();
        for (const key of keys) {
            const read = billing.pathOf(folders[key]);
            if (read.error) return { key, problem: `it ${read.error}` };
            if (!read.folder) return { key, problem: "a folder is needed: notes can't go at the top of the vault" };
            if (lower(read.folder.split("/")[0]) === lower(Settings.SYSTEM_FOLDER)) return { key, problem: `it's inside ${Settings.SYSTEM_FOLDER}, the system's own folder` };
            for (const other of all) {
                if (other === key) continue;
                const a = lower(read.folder), b = lower(folders[other]);
                const name = Settings.FOLDER_NAMES[other] === folders[other] ? Settings.FOLDER_NAMES[other] : `${Settings.FOLDER_NAMES[other]} (${folders[other]})`;
                if (a === b) return { key, problem: `it's the ${Settings.FOLDER_NAMES[other]} folder already` };
                if (a.startsWith(`${b}/`)) return { key, problem: `it's inside ${name}` };
                if (b.startsWith(`${a}/`)) return { key, problem: `${name} is inside it` };
            }
        }
        return null;
    }

    /**
     * Where `folder` meets the system's own folders: the first of Config, Projects, the Inbox and the
     * archive that it's inside, holds, or is, as { name, folder, how: "in" | "holds" | "is" }; else null
     * @param {string} folder
     * @param {{ projects: string, inbox: string, archive: string }} [folders]
     * @returns {{ name: string, folder: string, how: "in" | "holds" | "is" } | null}
     */
    overlap(folder, folders = this.data.folders) {
        const a = String(folder).toLowerCase();
        /** @type {[string, string][]} */
        const named = [[Settings.SYSTEM_FOLDER, Settings.SYSTEM_FOLDER], ...(/** @type {const} */ (["projects", "inbox", "archive"])).map((k) => /** @type {[string, string]} */ ([Settings.FOLDER_NAMES[k], folders[k]]))];
        for (const [name, f] of named) {
            const b = String(f).toLowerCase();
            if (!b) continue;
            if (a === b) return { name, folder: f, how: "is" };
            if (a.startsWith(`${b}/`)) return { name, folder: f, how: "in" };
            if (b.startsWith(`${a}/`)) return { name, folder: f, how: "holds" };
        }
        return null;
    }

    /**
     * A note's path in a setting (the error log note, a template): { path, error }, with ".md" added when
     * it's left off and "" for none; it reads as a folder does
     * @param {unknown} raw
     * @param {{ pathOf: (raw: unknown) => { folder: string, error: string | null } }} [billing]
     * @returns {{ path: string, error: string | null }}
     */
    notePathOf(raw, billing = plainday.Billing) {
        const read = billing.pathOf(typeof raw === "string" ? raw : raw === undefined || raw === null ? null : raw);
        if (read.error) return { path: "", error: read.error.replace("isn't a folder in the vault", "isn't a note in the vault") };
        if (!read.folder) return { path: "", error: null };
        return { path: /\.md$/i.test(read.folder) ? `${read.folder.slice(0, -3)}.md` : `${read.folder}.md`, error: null };
    }

    /**
     * The error log note: the setting's, else the log already made (Config/Error Log.md, then Plainday
     * error log.md), else Config/Error Log.md in a vault from before (the Config folder is there), else
     * Plainday error log.md at the top of the vault
     * @returns {string}
     */
    errorLogPath() {
        return this.data.folders.errorLog || this.defaultErrorLogPath();
    }

    // The error log note a blank setting means, which the panel shows: a log already made stays where it
    // is (the old one first), so a Config folder that turns up later doesn't start a second log
    defaultErrorLogPath() {
        if (app.vault.getFileByPath(Settings.OLD_ERROR_LOG)) return Settings.OLD_ERROR_LOG;
        if (app.vault.getFileByPath(Settings.NEW_ERROR_LOG)) return Settings.NEW_ERROR_LOG;
        return app.vault.getFolderByPath(Settings.SYSTEM_FOLDER) ? Settings.OLD_ERROR_LOG : Settings.NEW_ERROR_LOG;
    }

    /**
     * What the Note templates section warns under a template (OBS-80, 11/13): the properties `props`
     * (the template's own, by name) sets that Plainday writes itself into a note of that kind, or ""
     * @param {string[]} props
     * @param {string[]} writes
     * @returns {string}
     */
    templateWarning(props, writes) {
        const ours = new Set(writes.map((w) => w.toLowerCase()).filter((w) => !Settings.COMBINED.includes(w)));
        const both = [...new Set(props.filter((p) => ours.has(String(p).toLowerCase())))];
        if (!both.length) return "";
        const named = both.map((p) => `\`${p}\``);
        const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
        return `Your template also sets ${list}; Plainday writes its own.`;
    }

    // ---------------------------------------------------------------- calendars (OBS-282)

    /**
     * One line of text, or "" when it holds a link, which a calendar's name and account never keep
     * @param {unknown} v
     * @returns {string}
     */
    linkFree(v) {
        const t = this.text(v);
        return Settings.LINKISH.test(t) ? "" : t;
    }

    /**
     * A sync range as the panel and the Calendar Sync note write it ("2 months", in any case), or null
     * @param {unknown} raw
     * @returns {string | null}
     */
    rangeOf(raw) {
        const said = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").toLowerCase() : "";
        return Settings.RANGES.find(([label]) => label === said)?.[0] ?? null;
    }

    // The ranges the panel offers, shortest first
    rangeLabels() {
        return Settings.RANGES.map(([label]) => label);
    }

    /**
     * How many days ahead a range reaches: the setting's, unless another is given
     * @param {string} [range]
     * @returns {number}
     */
    rangeDays(range = this.data.calendars.range) {
        const label = this.rangeOf(range) ?? Settings.DEFAULT_RANGE;
        return /** @type {[string, number]} */ (Settings.RANGES.find(([l]) => l === label))[1];
    }

    /**
     * Your email address on a calendar: { address }, in lower case without `mailto:`, "" when blank, or
     * { address: "", bad: true } when it isn't one (a link never is: it has a / or :)
     * @param {unknown} raw
     * @returns {{ address: string, bad: boolean }}
     */
    addressOf(raw) {
        const a = typeof raw === "string" ? raw.trim().replace(/^mailto:/i, "").toLowerCase() : "";
        if (!a) return { address: "", bad: false };
        return Settings.ADDRESS.test(a) ? { address: a, bad: false } : { address: "", bad: true };
    }

    /**
     * A calendar in the list, by its ID
     * @param {string} id
     * @returns {Calendar | null}
     */
    calendar(id) {
        return this.data.calendars.list.find((c) => c.id === id) ?? null;
    }

    /**
     * This vault's key in the names of its calendar links: random, made the first time it's needed, and
     * kept in this vault's own local storage on this device
     * @returns {string}
     */
    vaultKey() {
        const kept = app.loadLocalStorage(Settings.VAULT_KEY);
        if (typeof kept === "string" && /^[a-z0-9]{8}$/.test(kept)) return kept;
        const key = this.randomId(8);
        app.saveLocalStorage(Settings.VAULT_KEY, key);
        return key;
    }

    // What names a calendar's link in this device's secret storage: this vault's, by its ID
    secretId(id) {
        return `${Settings.SECRET_PREFIX}${this.vaultKey()}-${id}`;
    }

    /**
     * A calendar's link on this device, or null when this device has none
     * @param {string} id
     * @returns {string | null}
     */
    link(id) {
        const secret = app.secretStorage?.getSecret(this.secretId(id));
        return typeof secret === "string" && secret.trim() ? secret.trim() : null;
    }

    /**
     * Keeps a calendar's link in this device's secret storage
     * @param {string} id @param {string} link
     */
    storeLink(id, link) {
        if (!app.secretStorage) throw new Error("This version of Obsidian has no secret storage");
        app.secretStorage.setSecret(this.secretId(id), String(link).trim());
    }

    /**
     * Blanks a calendar's link in this device's secret storage (it can't delete one)
     * @param {string} id
     */
    forgetLink(id) {
        if (this.link(id) !== null) app.secretStorage.setSecret(this.secretId(id), "");
    }

    /**
     * Whether a pasted copy's link is one Add calendar would take: https:// or webcal:// to a server, or
     * http:// to this device itself, with no spaces
     * @param {unknown} link
     * @returns {boolean}
     */
    isLink(link) {
        const text = String(link ?? "").trim();
        if (!/^(?:https?|webcals?):\/\/\S+$/i.test(text)) return false;
        try {
            const url = new URL(text.replace(/^webcals?:\/\//i, "https://"));
            if (!url.hostname) return false;
            return url.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
        } catch {
            return false;
        }
    }

    /**
     * The IDs of every calendar link this vault keeps on this device, whether or not a calendar in the
     * list has it (one removed on another device, which Sync took out of the list, keeps its link here).
     * Another vault's are never among them.
     * @returns {string[]}
     */
    storedIds() {
        const mine = `${Settings.SECRET_PREFIX}${this.vaultKey()}-`;
        return (app.secretStorage?.listSecrets() ?? [])
            .filter((name) => name.startsWith(mine))
            .map((name) => name.slice(mine.length));
    }

    // A link as two links to one calendar compare: trimmed, a webcal:// link as the https:// one it is
    sameLink(a, b) {
        const key = (l) => String(l ?? "").trim().replace(/^webcals?:\/\//i, "https://");
        return !!key(a) && key(a) === key(b);
    }

    /**
     * The calendar whose link on this device is `link`, other than `except`, or null
     * @param {string} link @param {string | null} [except]
     * @returns {Calendar | null}
     */
    calendarWithLink(link, except = null) {
        return this.data.calendars.list.find((c) => c.id !== except && this.sameLink(this.link(c.id), link)) ?? null;
    }

    /**
     * A new calendar's ID: random, and naming no calendar and no link on this device
     * @returns {string}
     */
    newId() {
        for (;;) {
            const id = this.randomId(10);
            if (!this.calendar(id) && this.link(id) === null) return id;
        }
    }

    /**
     * Random lowercase letters and digits, as many as `n`
     * @param {number} n
     * @returns {string}
     */
    randomId(n) {
        const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
        return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => letters[b % letters.length]).join("");
    }

    /**
     * Adds a calendar, switched on, with its link in this device's secret storage, and saves
     * @param {{ name: string, account?: string, address?: string, link: string }} calendar
     * @returns {Promise<Calendar>}
     */
    async addCalendar({ name, account = "", address = "", link }) {
        const id = this.newId();
        this.storeLink(id, link);
        /** @type {Calendar} */
        const calendar = { id, name: this.linkFree(name), account: this.linkFree(account), address: this.addressOf(address).address, on: true };
        this.data.calendars.list.push(calendar);
        try {
            await this.save();
        } catch (e) {
            this.data.calendars.list = this.data.calendars.list.filter((c) => c.id !== id);
            this.forgetLink(id);
            throw e;
        }
        return calendar;
    }

    /**
     * Changes a calendar's name, account, address or switch, and saves; with `link`, keeps that as its
     * link on this device once saved
     * @param {string} id
     * @param {Partial<Omit<Calendar, "id">>} values
     * @param {string | null} [link]
     */
    async editCalendar(id, values, link = null) {
        const calendar = this.calendar(id);
        if (!calendar) throw new Error("That calendar isn't in the list any more");
        const before = { ...calendar };
        if (values.name !== undefined) calendar.name = this.linkFree(values.name);
        if (values.account !== undefined) calendar.account = this.linkFree(values.account);
        if (values.address !== undefined) calendar.address = this.addressOf(values.address).address;
        if (typeof values.on === "boolean") calendar.on = values.on;
        try {
            await this.save();
        } catch (e) {
            Object.assign(calendar, before);
            throw e;
        }
        if (link) this.storeLink(id, link);
    }

    /**
     * Takes a calendar out of the list, saves, and blanks its link on this device. Another device keeps
     * its own until a paste.
     * @param {string} id
     */
    async removeCalendar(id) {
        const list = this.data.calendars.list;
        const i = list.findIndex((c) => c.id === id);
        if (i < 0) return;
        const [gone] = list.splice(i, 1);
        try {
            await this.save();
        } catch (e) {
            list.splice(i, 0, gone);
            throw e;
        }
        this.forgetLink(id);
    }

    /**
     * The links this device has for a list of calendars, by ID: what a copy carries
     * @param {ReturnType<Settings["defaults"]>} [settings]
     * @returns {Record<string, string>}
     */
    links(settings = this.data) {
        /** @type {Record<string, string>} */
        const out = {};
        for (const { id } of settings.calendars?.list ?? []) {
            const link = this.link(id);
            if (link) out[id] = link;
        }
        return out;
    }

    /**
     * The range from the Calendar Sync note's `Sync range:` line: { range }, or { bad } when the line
     * isn't one of the ranges; null when the note has no such line
     * @param {string} text
     * @returns {{ range: string, bad?: undefined } | { bad: string, range?: undefined } | null}
     */
    rangeFromNote(text) {
        const said = /^Sync range:[ \t]*(.*?)[ \t]*$/m.exec(String(text ?? ""))?.[1];
        if (said === undefined) return null;
        const range = this.rangeOf(said);
        return range ? { range } : { bad: `\`Sync range\` in Calendar Sync (${said})` };
    }

    /**
     * What the first load says after reading the range from the Calendar Sync note
     * @param {{ range?: string, bad?: string }} result
     * @returns {string}
     */
    rangeNotice({ range, bad }) {
        const lines = [`Plainday moved your calendar sync range${range ? `, ${range},` : ""} into Settings → Plainday → Calendars. Sync calendars no longer reads the Sync range line in Calendar Sync, which still lists your calendars.`];
        if (bad) lines.push(`This didn't read, so it starts from the default, ${Settings.DEFAULT_RANGE}: ${bad}.`);
        return lines.join("\n\n");
    }

    /**
     * Settings from the notes that held them before (OBS-281): `invoice` and `table` are each { props },
     * the note's properties, { error } when they don't read, or null when the note isn't there.
     * { settings, read: the notes that were there, bad: what didn't read, by the note's own name for it,
     * capped: a freeze over 9, which is 9 now }. A value that doesn't read is left at its default.
     * @typedef {{ props: Record<string, unknown>, error?: undefined } | { error: string, props?: undefined } | null} OldNote
     * @param {{ invoice?: OldNote, table?: OldNote }} notes
     * @param {{ folderOf: (raw: unknown) => { folder: string, error: string | null } }} [billing]
     */
    fromOldNotes({ invoice = null, table = null }, billing = plainday.Billing) {
        const settings = this.defaults();
        /** @type {("invoice" | "table")[]} */
        const read = [];
        /** @type {string[]} */
        const bad = [], capped = [];
        const shown = (v) => (typeof v === "string" ? v.trim() : JSON.stringify(v));
        if (invoice) {
            read.push("invoice");
            if (!invoice.props) {
                bad.push("Invoice Settings' properties");
            } else {
                const s = settings.invoices, p = invoice.props, get = (k) => this.prop(p, k);
                s.name = this.text(get("name"));
                s.address = this.lines(get("address"));
                s.terms = this.text(get("terms"));
                s.paymentNote = this.multiline(typeof get("payment_note") === "string" ? get("payment_note") : this.text(get("payment_note")));
                const folder = billing.folderOf(get("folder"), settings.folders.archive);
                if (folder.error) bad.push(`\`folder\` in Invoice Settings (${shown(get("folder"))})`);
                else s.folder = folder.folder;
                const last = this.lastNumberOf(get("last_number"));
                if (last.error) bad.push(`\`last_number\` in Invoice Settings (${shown(get("last_number"))})`);
                else if (last.number !== null) s.lastNumber = last.number;
            }
        }
        if (table) {
            read.push("table");
            if (!table.props) {
                bad.push("Table Settings' properties");
            } else {
                for (const [key, to] of /** @type {const} */ ([["freeze_rows", "freezeRows"], ["freeze_columns", "freezeColumns"]])) {
                    const raw = this.prop(table.props, key), n = this.frozenOf(raw);
                    if (n.error) bad.push(`\`${key}\` in Table Settings (${shown(raw)})`);
                    else settings.tables[to] = n.number;
                    if (n.capped) capped.push(`\`${key}\` in Table Settings (${shown(raw)})`);
                }
            }
        }
        return { settings, read, bad, capped };
    }

    /**
     * What the first load says after reading the old notes, or null when there were none
     * @param {{ read: ("invoice" | "table")[], bad: string[], capped?: string[] }} result
     * @returns {string | null}
     */
    movedNotice({ read, bad, capped = [] }) {
        if (!read.length) return null;
        const what = read.map((r) => (r === "invoice" ? "invoice" : "table")).join(" and ");
        const notes = read.map((r) => (r === "invoice" ? "Invoice Settings" : "Table Settings")).join(" or ");
        const lines = [`Plainday moved your ${what} settings into Settings → Plainday. It no longer reads ${notes}; you can delete ${read.length === 1 ? "it" : "them"}.`];
        if (bad.length) lines.push(`${bad.length === 1 ? "This" : "These"} didn't read, so ${bad.length === 1 ? "it starts" : "they start"} from the default: ${bad.join(", ")}.`);
        if (capped.length) lines.push(`Plainday freezes at most ${Settings.MAX_FROZEN} rows or columns, so ${capped.length === 1 ? "this is" : "these are"} ${Settings.MAX_FROZEN} now: ${capped.join(", ")}.`);
        return lines.join("\n\n");
    }

    /**
     * Every setting as one block of text, for Copy, with each calendar's link this device has
     * @param {ReturnType<Settings["defaults"]>} [settings]
     * @param {Record<string, string>} [links]
     * @returns {string}
     */
    copyText(settings = this.data, links = this.links(settings)) {
        return JSON.stringify({ [Settings.COPY_MARK]: Settings.COPY_VERSION, ...settings, ...(Object.keys(links).length ? { links } : {}) });
    }

    /**
     * A pasted block: { settings, links, withCalendars }, or { error } when it isn't a copy of
     * Plainday's settings. `links` holds the copy's link for each of its calendars that had one, by the
     * calendar's ID; `withCalendars` is false for a copy made before there were calendars, which a paste
     * leaves this device's as they are. A copy made before there were folders (OBS-283) carries this
     * device's folders and templates, so a paste leaves them as they are too.
     * @param {string} text
     * @param {{ folderOf: (raw: unknown) => { folder: string, error: string | null } }} [billing]
     * @returns {{ settings: ReturnType<Settings["defaults"]>, links: Record<string, string>, withCalendars: boolean, error?: undefined } | { error: string, settings?: undefined, links?: undefined, withCalendars?: undefined }}
     */
    readCopy(text, billing = plainday.Billing) {
        const not = { error: "That isn't a copy of Plainday's settings. Use Copy at the top of Settings → Plainday, then paste here what it copied." };
        const t = String(text ?? "").trim();
        if (!t) return { error: "Paste a copy of Plainday's settings here." };
        let raw;
        try { raw = JSON.parse(t); } catch { return not; }
        if (typeof raw !== "object" || raw === null || !(Settings.COPY_MARK in raw)) return not;
        const settings = this.normalize(raw, billing);
        /** @type {Record<string, string>} */
        const links = {};
        const given = typeof raw.links === "object" && raw.links !== null ? raw.links : {};
        for (const { id } of settings.calendars.list) {
            const link = given[id];
            if (typeof link === "string" && this.isLink(link)) links[id] = link.trim();
        }
        // A copy from before folders is read with this device's folders and templates, and one whose
        // Projects, Inbox and archive don't hold together with this device's three, so its invoice folder
        // is checked against this device's archive
        const read = !this.hasFolders(raw) ? this.normalize({ ...raw, folders: this.data.folders, templates: this.data.templates }, billing)
            : this.foldersDropped(raw, settings, billing) ? this.normalize(this.withFolders(raw, this.folders()), billing) : settings;
        return { settings: read, links, withCalendars: this.hasCalendars(raw) };
    }

    /**
     * The settings a paste leaves: the copy's, with the higher of the two last invoice numbers given
     * @param {ReturnType<Settings["defaults"]>} copy
     * @param {ReturnType<Settings["defaults"]>} [now]
     * @returns {ReturnType<Settings["defaults"]>}
     */
    pasted(copy, now = this.data) {
        const out = JSON.parse(JSON.stringify(copy));
        out.invoices.lastNumber = Math.max(copy.invoices.lastNumber, now.invoices.lastNumber);
        return out;
    }

    // ---------------------------------------------------------------- the data file

    // Reads the saved settings, or the defaults on a device with none saved yet. Obsidian's loadData
    // gives null when there's no data file, and undefined when there is one that doesn't read: then the
    // defaults hold, the old notes aren't read over it, and a notice says so.
    async load() {
        const plugin = plainday.plugin;
        if (!plugin) return;
        const raw = await plugin.loadData();
        this.unreadable = raw === undefined;
        this.saved = raw !== null;
        this.calendarsSaved = this.hasCalendars(raw);
        this.foldersSaved = this.hasFolders(raw);
        this.data = this.normalize(raw ?? {});
        if (this.foldersDropped(raw, this.data)) new Notice(this.droppedNotice(), 0);
        if (this.unreadable) {
            new Notice(`Plainday couldn't read its settings file, ${plugin.manifest.dir}/data.json, so it's using the defaults. It leaves the file as it is until you change a setting in Settings → Plainday or paste your settings again.`, 0);
        }
    }

    // Whether a data file as loaded has calendars, or doesn't read (then nothing is read over it)
    hasCalendars(raw) {
        return raw === undefined || (typeof raw === "object" && raw !== null && typeof raw.calendars === "object" && raw.calendars !== null);
    }

    // What loading says when the saved Projects, Inbox or archive didn't read: the folders it uses instead
    droppedNotice() {
        const { projects, inbox, archive } = this.folders();
        return `Plainday's Projects, Inbox and Archive folders in its settings file don't hold together (one is inside another, or isn't a folder), so it's using Projects \`${projects}\`, Inbox \`${inbox}\` and Archive \`${archive}\`. Set them in Settings → Plainday → Folders.`;
    }

    // Whether Projects, the Inbox or the archive a data file names didn't survive normalize(): one that
    // doesn't read, or three that don't hold together, which went back to the defaults
    foldersDropped(raw, settings, billing = plainday.Billing) {
        const f = typeof raw === "object" && raw !== null && typeof raw.folders === "object" && raw.folders !== null ? raw.folders : null;
        if (!f) return false;
        return /** @type {const} */ (["projects", "inbox", "archive"]).some((k) => typeof f[k] === "string" && f[k].trim() !== "" && billing.pathOf(f[k]).folder !== settings.folders[k]);
    }

    // A data file or a copy with `three` (Projects, the Inbox and the archive) in place of its own
    withFolders(raw, three) {
        const r = typeof raw === "object" && raw !== null ? raw : {};
        const f = typeof r.folders === "object" && r.folders !== null ? r.folders : {};
        return { ...r, folders: { ...f, ...three } };
    }

    // Whether a data file or a copy has folders (one from before OBS-283 has none), or doesn't read
    hasFolders(raw) {
        return raw === undefined || (typeof raw === "object" && raw !== null && typeof raw.folders === "object" && raw.folders !== null);
    }

    // Writes the settings as they are now, through normalize(), so only the keys a setting has reach
    // the file: never a link, even one something put on a calendar in memory
    async save() {
        const plugin = plainday.plugin;
        if (!plugin) throw new Error("Plainday isn't loaded");
        await plugin.saveData(this.normalize(this.data));
        this.saved = true;
        this.calendarsSaved = true;
        this.foldersSaved = true;
        this.unreadable = false;
    }

    /**
     * Sets one section's values, and saves
     * @template {keyof ReturnType<Settings["defaults"]>} K
     * @param {K} section
     * @param {Partial<ReturnType<Settings["defaults"]>[K]>} values
     */
    async set(section, values) {
        Object.assign(this.data[section], values);
        await this.save();
    }

    /**
     * Raises the last invoice number to `n`, never lowering it, and saves
     * @param {number} n
     */
    async raiseLastNumber(n) {
        if (n <= this.data.invoices.lastNumber) return;
        await this.set("invoices", { lastNumber: n });
    }

    /**
     * Makes this device's settings the copy's (pasted() keeps the higher invoice number), saves, keeps
     * the copy's links in this device's secret storage, blanks every other calendar link this device
     * keeps, and applies the editor switch. A calendar the copy has without a link keeps the one this
     * device has, if any. A copy from before there were calendars (`withCalendars` false) leaves this
     * device's calendars and links as they are. A save that fails changes nothing.
     * @param {ReturnType<Settings["defaults"]>} copy
     * @param {Record<string, string>} [links]
     * @param {boolean} [withCalendars]
     */
    async replaceWith(copy, links = {}, withCalendars = true) {
        const before = this.data;
        const next = this.pasted(copy);
        if (!withCalendars) next.calendars = JSON.parse(JSON.stringify(before.calendars));
        this.data = next;
        try {
            await this.save();
        } catch (e) {
            this.data = before;
            throw e;
        }
        if (withCalendars) {
            const kept = new Set(next.calendars.list.map((c) => c.id));
            for (const [id, link] of Object.entries(links)) if (kept.has(id)) this.storeLink(id, link);
            for (const id of this.storedIds()) if (!kept.has(id)) this.forgetLink(id);
        }
        await plainday.ListCursor?.invoke();
    }

    // Sync changed the data file: read it again, and apply the editor switch. A file caught mid-write (or
    // not downloaded yet) reads as undefined: the settings in memory stay until it reads. The last invoice
    // number stays the higher of the two. A file with no calendars, from a device on a release before
    // them, keeps this device's, and is written again with them, so they're there at the next start;
    // the same for folders and templates (OBS-283).
    async reload() {
        const plugin = plainday.plugin;
        if (!plugin) return;
        const raw = await plugin.loadData();
        if (raw === undefined) return;
        this.unreadable = false;
        this.saved = raw !== null;
        const hadCalendars = this.calendarsSaved, hadFolders = this.foldersSaved;
        const nowCalendars = this.hasCalendars(raw), nowFolders = this.hasFolders(raw);
        // The same for folders and templates, from a device on a release before them (OBS-283): read with
        // this device's, so its invoice folder is checked against this device's archive
        const keepFolders = raw !== null && !nowFolders && hadFolders;
        const given = keepFolders ? { ...raw, folders: this.data.folders, templates: this.data.templates } : raw ?? {};
        // As a paste does: an older file from another device never lowers the number given here
        const next = this.pasted(this.normalize(given));
        const keep = raw !== null && !nowCalendars && hadCalendars;
        if (keep) next.calendars = this.data.calendars;
        // Projects, the Inbox and the archive that don't hold together (a file edited by hand, two devices'
        // changes merged) keep this device's, with a notice, rather than going back to the defaults: read
        // again with them, so the other folders and the invoice folder are checked against them, and
        // saved, so the next start doesn't read the file that didn't hold together
        const dropped = this.foldersDropped(given, next);
        const kept = dropped ? this.pasted(this.normalize(this.withFolders(given, this.folders()))) : next;
        if (dropped && keep) kept.calendars = this.data.calendars;
        this.data = kept;
        if (dropped) new Notice(Settings.DROPPED_SYNC, 0);
        // save() sets both flags once the write lands; until then they stay as they were, so a write
        // that fails can't let the next reload take the defaults over this device's (OBS-283)
        if (keep || keepFolders || dropped) await this.save();
        else { this.calendarsSaved = nowCalendars; this.foldersSaved = nowFolders; }
        await plainday.ListCursor?.invoke();
    }

    // On a device with no settings saved: reads the old settings notes, and when there are any, saves
    // what they held, so they're never read again, and says what moved. The notes are left as they are.
    // With none, nothing is written: a device whose notes Sync hasn't brought yet reads them at a later
    // load, and one whose data file Sync is still bringing doesn't write defaults over it. The same for
    // the range on a device whose settings have no calendars yet: the Calendar Sync note's `Sync range:`
    // line, read once (OBS-282). On a device with no settings saved, the range alone is used but not
    // saved, for the same reason: it's saved with the invoice and table settings when their notes
    // arrive, or with the first change you make.
    async readOldNotes() {
        if (this.saved && this.calendarsSaved) return;
        const wasSaved = this.saved, hadCalendars = this.calendarsSaved;
        const text = async (path) => {
            const file = app.vault.getFileByPath(path);
            return file ? app.vault.read(file) : null;
        };
        const props = async (path) => {
            const note = await text(path);
            if (note === null) return null;
            const info = getFrontMatterInfo(note);
            if (!info.exists) return { props: {} };
            try {
                const fm = parseYaml(info.frontmatter);
                return { props: typeof fm === "object" && fm !== null && !Array.isArray(fm) ? fm : {} };
            } catch (e) {
                return { error: String(e?.message ?? e) };
            }
        };
        const notes = wasSaved ? null : this.fromOldNotes({ invoice: await props(Settings.INVOICE_NOTE), table: await props(Settings.TABLE_NOTE) });
        const calendarNote = hadCalendars ? null : await text(Settings.CALENDAR_NOTE);
        const range = calendarNote === null ? null : this.rangeFromNote(calendarNote);
        // Sync brought a data file while the notes were read: it wins
        if (this.saved !== wasSaved || this.calendarsSaved !== hadCalendars) return;
        if (!notes?.read.length && !range) return;
        if (!wasSaved && !notes?.read.length && range) {
            this.data.calendars.range = range.range ?? Settings.DEFAULT_RANGE;
            return;
        }
        /** @type {string[]} */
        const notices = [];
        if (notes?.read.length) {
            this.data = { ...notes.settings, calendars: this.data.calendars };
            notices.push(/** @type {string} */ (this.movedNotice(notes)));
        }
        if (range) {
            this.data.calendars.range = range.range ?? Settings.DEFAULT_RANGE;
            notices.push(this.rangeNotice(range));
        }
        await this.save();
        new Notice(notices.join("\n\n"), 0);
    }
}
