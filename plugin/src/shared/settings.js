import { getFrontMatterInfo, Notice, parseYaml } from "obsidian";
import { app, plainday } from "../host.js";

export default class Settings {
    // Plainday's settings (OBS-80, OBS-281): what Settings → Plainday shows, kept in Plainday's own data
    // file (.obsidian/plugins/plainday/data.json, through the plugin's loadData and saveData), never in a
    // note. Plainday loads them before anything runs (main.js), and every class reads them from here,
    // from memory: `plainday.Settings.get().invoices.folder`.
    //
    //   - invoices: your name, address, terms and payment note, which head and close each invoice; the
    //     folder new invoices go in (blank until you choose one); the last invoice number given.
    //   - tables: the default freeze for every table the system writes (TimeReport, OBS-238).
    //   - editor: whether ListCursor runs (OBS-221).
    //
    // Whatever comes in, from the data file, a copy from another device or the old settings notes, goes
    // through normalize(), so a value that doesn't read becomes its default and the rest can trust what
    // they get.
    //
    // Vaults from before: on a device with no settings saved, the first load reads Config/Invoice
    // Settings.md and Config/Table Settings.md once (readOldNotes), saves what they held, and says so.
    // From then on the notes are never read again; they're left for you to delete. A data file that's
    // there but doesn't read (a write cut off, a sync conflict) isn't "no settings": Plainday says so,
    // uses the defaults, and leaves the file alone until you change a setting or paste your settings.
    //
    // A backup, or another device: plugin settings don't sync unless Obsidian Sync carries community
    // plugins, so copyText() is every setting as one block for the clipboard, and readCopy() and
    // replaceWith() take it back, on this device or another. A paste replaces this device's settings but keeps the higher last invoice
    // number, so no number is given twice.
    static INVOICE_NOTE = "Config/Invoice Settings.md";
    static TABLE_NOTE = "Config/Table Settings.md";
    // Invoice numbers have at most six digits
    static MAX_NUMBER = 999999;
    static FIRST_LAST_NUMBER = 1000;
    // Selectable Tables freezes at most 9 columns; more than 9 frozen rows would fill the screen
    static MAX_FROZEN = 9;
    // What a copy is marked with, and its format's version
    static COPY_MARK = "plainday-settings";
    static COPY_VERSION = 1;

    constructor() {
        this.data = this.defaults();
        // Whether this device has settings saved: until it has, the first load reads the old notes
        this.saved = false;
        // Whether the data file is there but doesn't read
        this.unreadable = false;
    }

    // ---------------------------------------------------------------- pure

    /**
     * Every setting at its default: what a new vault starts with
     * @returns {{
     *   invoices: { name: string, address: string[], terms: string, paymentNote: string, folder: string, lastNumber: number },
     *   tables: { freezeRows: number, freezeColumns: number },
     *   editor: { listCursor: boolean },
     * }}
     */
    defaults() {
        return {
            invoices: { name: "", address: [], terms: "", paymentNote: "", folder: "", lastNumber: Settings.FIRST_LAST_NUMBER },
            tables: { freezeRows: 0, freezeColumns: 0 },
            editor: { listCursor: true },
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
        out.invoices.name = this.text(inv.name);
        out.invoices.address = this.lines(inv.address);
        out.invoices.terms = this.text(inv.terms);
        out.invoices.paymentNote = this.multiline(inv.paymentNote);
        out.invoices.folder = billing.folderOf(typeof inv.folder === "string" ? inv.folder : null).folder;
        out.invoices.lastNumber = this.lastNumberOf(inv.lastNumber).number ?? Settings.FIRST_LAST_NUMBER;
        out.tables.freezeRows = this.frozenOf(tables.freezeRows).number;
        out.tables.freezeColumns = this.frozenOf(tables.freezeColumns).number;
        if (typeof editor.listCursor === "boolean") out.editor.listCursor = editor.listCursor;
        return out;
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
                const folder = billing.folderOf(get("folder"));
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
     * Every setting as one block of text, for Copy
     * @param {ReturnType<Settings["defaults"]>} [settings]
     * @returns {string}
     */
    copyText(settings = this.data) {
        return JSON.stringify({ [Settings.COPY_MARK]: Settings.COPY_VERSION, ...settings });
    }

    /**
     * A pasted block: { settings, holds } where `holds` says what it holds, or { error } when it isn't a
     * copy of Plainday's settings
     * @param {string} text
     * @param {{ folderOf: (raw: unknown) => { folder: string, error: string | null } }} [billing]
     * @returns {{ settings: ReturnType<Settings["defaults"]>, holds: string, error?: undefined } | { error: string, settings?: undefined, holds?: undefined }}
     */
    readCopy(text, billing = plainday.Billing) {
        const not = { error: "That isn't a copy of Plainday's settings. Use Copy at the top of Settings → Plainday, then paste here what it copied." };
        const t = String(text ?? "").trim();
        if (!t) return { error: "Paste a copy of Plainday's settings here." };
        let raw;
        try { raw = JSON.parse(t); } catch { return not; }
        if (typeof raw !== "object" || raw === null || !(Settings.COPY_MARK in raw)) return not;
        const settings = this.normalize(raw, billing);
        return { settings, holds: this.holds(settings) };
    }

    /**
     * What a copy holds, as Paste says it before you choose: enough of its invoice details to
     * tell whose copy it is
     * @param {ReturnType<Settings["defaults"]>} settings
     * @returns {string}
     */
    holds(settings) {
        const inv = settings.invoices;
        const details = [inv.name || "no name", inv.folder ? `invoices in ${inv.folder}` : "no invoice folder", `last invoice number ${inv.lastNumber}`];
        return `invoices (${details.join(", ")}), tables (freeze ${settings.tables.freezeRows} rows and ${settings.tables.freezeColumns} columns) and the editor switch (${settings.editor.listCursor ? "on" : "off"})`;
    }

    /**
     * The settings a paste leaves: the copy's, with the higher of the two last invoice numbers
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
        this.data = this.normalize(raw ?? {});
        if (this.unreadable) {
            new Notice(`Plainday couldn't read its settings file, ${plugin.manifest.dir}/data.json, so it's using the defaults. It leaves the file as it is until you change a setting in Settings → Plainday or paste your settings again.`, 0);
        }
    }

    // Writes the settings as they are now
    async save() {
        const plugin = plainday.plugin;
        if (!plugin) throw new Error("Plainday isn't loaded");
        await plugin.saveData(this.data);
        this.saved = true;
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
     * Makes this device's settings the copy's (pasted() keeps the higher invoice number), saves, and
     * applies the editor switch
     * @param {ReturnType<Settings["defaults"]>} copy
     */
    async replaceWith(copy) {
        this.data = this.pasted(copy);
        await this.save();
        await plainday.ListCursor?.invoke();
    }

    // Sync changed the data file: read it again, and apply the editor switch. A file caught mid-write (or
    // not downloaded yet) reads as undefined: the settings in memory stay until it reads. The last invoice
    // number stays the higher of the two.
    async reload() {
        const plugin = plainday.plugin;
        if (!plugin) return;
        const raw = await plugin.loadData();
        if (raw === undefined) return;
        this.unreadable = false;
        this.saved = raw !== null;
        // As a paste does: an older file from another device never lowers the number given here
        this.data = this.pasted(this.normalize(raw ?? {}));
        await plainday.ListCursor?.invoke();
    }

    // On a device with no settings saved: reads the old settings notes, and when there are any, saves
    // what they held, so they're never read again, and says what moved. The notes are left as they are.
    // With none, nothing is written: a device whose notes Sync hasn't brought yet reads them at a later
    // load, and one whose data file Sync is still bringing doesn't write defaults over it.
    async readOldNotes() {
        if (this.saved) return;
        const props = async (path) => {
            const file = app.vault.getFileByPath(path);
            if (!file) return null;
            const info = getFrontMatterInfo(await app.vault.read(file));
            if (!info.exists) return { props: {} };
            try {
                const fm = parseYaml(info.frontmatter);
                return { props: typeof fm === "object" && fm !== null && !Array.isArray(fm) ? fm : {} };
            } catch (e) {
                return { error: String(e?.message ?? e) };
            }
        };
        const result = this.fromOldNotes({ invoice: await props(Settings.INVOICE_NOTE), table: await props(Settings.TABLE_NOTE) });
        // Sync brought a data file while the notes were read: it wins
        if (this.saved || !result.read.length) return;
        this.data = result.settings;
        await this.save();
        const notice = this.movedNotice(result);
        if (notice) new Notice(notice, 0);
    }
}
