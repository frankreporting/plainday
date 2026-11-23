import { getFrontMatterInfo, moment, Notice, parseYaml, stringifyYaml } from "obsidian";
import { app, plainday } from "../host.js";

export default class PeriodicNotes {
    // The daily, weekly, monthly and yearly notes, made in one place (OBS-120). Plan, Jump to date, Schedule,
    // the calendar sync, the time report and EventLog all make theirs with ensure(), and
    // FinishPeriodicNotes finishes one made any other way (Notebook Navigator's calendar, the Daily notes
    // plugin, a click on a link to a missing day) with finish().
    // - Where a note goes and what it's called: the periodic notes' source in Settings → Plainday → Folders
    //   (OBS-283), through Schedule.dailyOpts for a day, and JumpToDate's names with TimeReport.periodPlaces
    //   for a week, a month or a year, folders by date included (OBS-310).
    // - What Plainday writes into one: its alias, from the date, in the language of the week settings
    //   (DatePrompt.weekRules). A yearly note has none. Nothing reads it; the quick switcher and link
    //   suggestions match it when you type a date.
    // - Then that kind of note's template, when it has anything in it: through Templater when Templater is
    //   on, which combines the template's properties with the note's; else its text with {{title}},
    //   {{date}} and {{time}} filled in, as Obsidian's own Templates plugin does, its properties combined
    //   with the note's. A template holding Templater code while Templater is off isn't used, with a notice.
    static KINDS = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
    // How long Templater's trigger for new notes is kept off a note Plainday made or finished. The trigger
    // looks 300 ms after a note appears, and would run Get Template on one that has only properties.
    static HOLD_MS = 1500;
    // Properties whose values are combined with a template's, not replaced (Templater does the same)
    static LISTS = ["aliases", "tags"];

    constructor() {
        // The notes being made now, by path: a second call for the same note gets the first one's (the
        // sync and Schedule making the same day at once). FinishPeriodicNotes leaves these alone.
        this.making = new Map();
        // Plainday's own holds on Templater's trigger, by path
        this.holds = new Map();
    }

    // The first day of the period `date` is in: the day itself, its week's first day (Monday for ISO weeks,
    // else the week settings' first day), the first of its month or of its year
    start(unit, date, rules) {
        if (unit === "day") return date;
        if (unit === "month") return `${date.slice(0, 7)}-01`;
        if (unit === "year") return `${date.slice(0, 4)}-01-01`;
        return plainday.DatePrompt.constructor.weekFirst(date, plainday.JumpToDate.isoWeeks(rules) ? 1 : rules.weekStart);
    }

    // Where the note of `unit` ("day", "week", "month" or "year") for `date` (YYYY-MM-DD, any day of the
    // period) goes, and what it's called: { unit, date, start, path, folder, name, kind }. Its folder is
    // the one the settings give, then the folders by date they give, read from the period's first day
    // (OBS-310), so it's where Schedule.isDailyNote and periodOf look for it.
    where(unit, date, rules = plainday.DatePrompt.weekRules()) {
        const start = this.start(unit, date, rules);
        let path;
        if (unit === "day") path = plainday.Schedule.dailyNotePath(moment(date, "YYYY-MM-DD", true));
        else {
            const place = plainday.TimeReport.periodPlaces()[unit];
            const folder = [place.folder, place.dateFolders ? moment(start, "YYYY-MM-DD", true).locale(rules.locale).format(place.dateFolders) : ""].filter(Boolean).join("/");
            path = `${folder ? `${folder}/` : ""}${plainday.JumpToDate.periodName({ date, unit }, rules)}.md`;
        }
        const at = path.lastIndexOf("/");
        return {
            unit, date, start, path,
            folder: at < 0 ? "" : path.slice(0, at), name: path.slice(at + 1).replace(/\.md$/, ""), kind: PeriodicNotes.KINDS[unit],
        };
    }

    // A periodic note's alias: "9/20/26 Sunday", "Week of 9/13/26" (the week's first day), "September 2026",
    // and none for a year, in the week settings' language
    alias(unit, date, rules = plainday.DatePrompt.weekRules()) {
        const day = (d) => moment(d, "YYYY-MM-DD", true).locale(rules.locale);
        if (unit === "day") return day(date).format("M/D/YY dddd");
        if (unit === "week") return `Week of ${day(this.start(unit, date, rules)).format("M/D/YY")}`;
        if (unit === "month") return day(this.start(unit, date, rules)).format("MMMM YYYY");
        return null;
    }

    // Which periodic note a note's name is, by the vault's own name formats (the daily notes' format, and the
    // week settings' patterns for the rest): { unit, date } (date the period's first day), or null. A day's
    // name is read in the language where() writes it in, Obsidian's (moment's own); the rest in the week
    // settings' language.
    periodOfName(name, rules = plainday.DatePrompt.weekRules(), day = plainday.Schedule.dailyOpts().format) {
        const formats = { day, ...rules.format };
        for (const unit of ["day", "week", "month", "year"]) {
            const m = moment(name, formats[unit], unit === "day" ? moment.locale() : rules.locale, true);
            if (!m.isValid() || m.format(formats[unit]) !== name) continue;
            // A week's name reads as its first day already
            const first = unit === "day" || unit === "week" ? m : m.clone().startOf(unit);
            return { unit, date: first.format("YYYY-MM-DD") };
        }
        return null;
    }

    // The one reader of a link to a periodic note (OBS-297): `read(linktext)` reads a link's name, or its
    // path's last part, as periodOfName does, with the formats and languages set now: { unit, date } or
    // null. A 🚩, a forward date and every other link on a task line is told by the note its name names,
    // never by how the name is spelled. Each name is read once and remembered under the formats and
    // languages that read it, so a changed setting gives a new reader, and the editor's links, drawn on
    // every keystroke, cost a lookup.
    static NAMES_KEPT = 5000;
    reader() {
        const rules = plainday.DatePrompt.weekRules();
        const day = plainday.Schedule.dailyOpts().format;
        const key = [day, moment.locale(), rules.locale, rules.format.week, rules.format.month, rules.format.year].join("\n");
        if (this.names?.key !== key) {
            const seen = new Map();
            const read = (linktext) => {
                const name = String(linktext ?? "").split("/").pop().trim();
                let out = seen.get(name);
                if (out === undefined) {
                    const period = name ? this.periodOfName(name, rules, day) : null;
                    out = period ? Object.freeze(period) : null;
                    if (seen.size >= PeriodicNotes.NAMES_KEPT) seen.clear();
                    seen.set(name, out);
                }
                return out;
            };
            this.names = { key, read };
        }
        return this.names.read;
    }

    // That kind of note's template: the Daily notes plugin's or Notebook Navigator's for a day (as
    // Schedule.dailyOpts says), JumpToDate.templateFor for the rest; null when there's none
    templateOf(unit) {
        if (unit !== "day") return plainday.JumpToDate.templateFor(unit);
        const t = plainday.Schedule.dailyOpts().template;
        return t ? app.vault.getFileByPath(t.endsWith(".md") ? t : `${t}.md`) : null;
    }

    // Templater, when it's on
    templater() {
        const t = app.plugins?.getPlugin?.("templater-obsidian")?.templater;
        return typeof t?.write_template_to_file === "function" ? t : null;
    }

    // The note for `date`'s period, made if it isn't there: the one function every creator calls. A note
    // there already is returned as it is.
    async ensure(unit, date, { rules = plainday.DatePrompt.weekRules() } = {}) {
        const target = this.where(unit, date, rules);
        const there = app.vault.getFileByPath(target.path);
        if (there) return there;
        if (!this.making.has(target.path)) {
            this.making.set(target.path, this.make(target, rules).finally(() => this.making.delete(target.path)));
        }
        return this.making.get(target.path);
    }

    async make(target, rules) {
        const { path, folder, unit, kind } = target;
        const alias = this.alias(unit, target.date, rules);
        const tpl = this.templateOf(unit);
        const tplText = tpl ? await app.vault.read(tpl) : "";
        const templater = tplText.trim() ? this.templater() : null;
        // Without Templater, the template's text goes in with the alias, in one write
        let text = this.withAlias("", alias), unused = false;
        if (tplText.trim() && !templater) {
            if (tplText.includes("<%")) unused = true;
            else text = this.merge(text, this.fill(tplText, target));
        }
        await this.makeFolders(folder);
        // Templater's trigger is kept off the note from before it's there, so it's never templated twice
        this.hold(path);
        let file;
        try {
            file = await app.vault.create(path, text);
        } catch (e) {
            // Made a moment ago by something else
            const other = app.vault.getFileByPath(path);
            if (other) return other;
            throw e;
        }
        if (templater) {
            await templater.write_template_to_file(tpl, file);
            this.hold(file.path);
            // A template that sets an alias of its own as a single value replaces Plainday's
            await this.addAlias(file, alias);
        }
        if (unused) new Notice(`${tpl.basename} holds Templater code and Templater is off, so the new ${kind} note was made without it.`);
        // A template that files the note itself (as the old templates did) can disagree with where the
        // settings put it; then Plainday wouldn't find it the next time
        if (file.path !== path) {
            const navigator = plainday.Settings?.periodicSource?.() === "notebook-navigator";
            const where = navigator ? "Notebook Navigator's pattern puts it" : `Settings → Plainday → Periodic notes puts ${kind} notes`;
            new Notice(`The ${kind} note's template moved it to ${file.parent?.path ?? "/"}, but ${where} in ${folder || "/"}. Make them agree, or Plainday won't find it next time.`, 0);
        }
        return file;
    }

    // A periodic note made some other way, once whatever made it is done (FinishPeriodicNotes). One made
    // outside its folder with nothing in it is moved into its folder, unless a note of that name is there
    // already; one with nothing in it gets that kind of note's template (one with properties had its
    // template run by whatever made it); then its alias, when it lacks it. Nothing already in the note changes. A note still holding Templater code
    // (Templater's trigger is off) is left as it is, and so is one renamed since to a name that isn't a
    // periodic note's. Returns what happened: "finished", "left" or null.
    async finish(file) {
        if (!file || !app.vault.getFileByPath(file.path)) return null;
        const rules = plainday.DatePrompt.weekRules();
        const period = this.periodOfName(file.basename, rules);
        if (!period) return null;
        const target = this.where(period.unit, period.date, rules);
        const text = await app.vault.read(file);
        if (text.includes("<%")) return "left";
        // Nothing in it at all: whatever made it wrote no template (a note with properties had one run already)
        const empty = text.trim() === "";
        if (file.path !== target.path) {
            if (!empty || app.vault.getFileByPath(target.path)) return "left";
            await this.makeFolders(target.folder);
            // Templater's trigger looks at the note by the path it's at when it looks, so the new one is held too
            this.hold(target.path);
            await app.fileManager.renameFile(file, target.path);
        }
        // Templater writes a template into an open note and puts the cursor at its top, above any properties
        // it brought, so the cursor's place is noted before the template and set after the alias (review 4)
        const top = this.cursorAtTopOf(file);
        if (empty) await this.applyTemplate(file, target);
        await this.addAlias(file, this.alias(period.unit, period.date, rules));
        if (top) this.cursorBelowProperties(top);
        return "finished";
    }

    // Makes the folders `path` needs, one at a time: a note in folders by date can need several (OBS-310).
    // One made a moment ago by something else is fine.
    async makeFolders(path) {
        let at = "";
        for (const part of String(path ?? "").split("/").filter(Boolean)) {
            at = at ? `${at}/${part}` : part;
            if (app.vault.getFolderByPath(at)) continue;
            try {
                await app.vault.createFolder(at);
            } catch (e) {
                if (!app.vault.getFolderByPath(at)) throw e;
            }
        }
    }

    // That kind of note's template, run on a note there already (finish)
    async applyTemplate(file, target) {
        const tpl = this.templateOf(target.unit);
        const tplText = tpl ? await app.vault.read(tpl) : "";
        if (!tplText.trim()) return;
        const templater = this.templater();
        if (templater) {
            this.hold(file.path);
            await templater.write_template_to_file(tpl, file);
            this.hold(file.path);
        } else if (tplText.includes("<%")) {
            new Notice(`${tpl.basename} holds Templater code and Templater is off, so the new ${target.kind} note was made without it.`);
        } else {
            const filled = this.fill(tplText, { ...target, name: file.basename });
            await this.rewrite(file, (text) => this.merge(text, filled));
        }
    }

    // Adds `alias` to the note's aliases when it isn't among them
    async addAlias(file, alias) {
        if (!alias) return;
        const text = await app.vault.read(file);
        if (this.withAlias(text, alias) === text) return;
        await this.rewrite(file, (now) => this.withAlias(now, alias));
    }

    // Writes through the note's editor when it's open (Schedule.rewrite), so what you're typing there stays
    // where it is. A cursor at the very start of a note that had no properties stays above properties put
    // there (CodeMirror keeps a cursor before what's inserted at it), so it goes below them, where you'd
    // type: in a note just opened empty, that's where the next keystroke lands.
    async rewrite(file, fn) {
        const top = this.cursorAtTopOf(file);
        await plainday.Schedule.rewrite(file, fn);
        if (top) this.cursorBelowProperties(top);
    }

    // The note's editor (in editing view) when the note is open there with no properties and the cursor at its
    // very start, else null
    cursorAtTopOf(file) {
        const view = app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file?.path === file.path && v.editor && (v.getMode?.() ?? "source") === "source");
        const editor = view?.editor, cursor = editor?.getCursor();
        return editor && cursor.line === 0 && cursor.ch === 0 && !getFrontMatterInfo(editor.getValue()).exists ? editor : null;
    }

    // A cursor still at the very start of a note that now has properties goes below them; one a template put
    // elsewhere (tp.file.cursor) stays
    cursorBelowProperties(editor) {
        const cursor = editor.getCursor();
        if (cursor.line !== 0 || cursor.ch !== 0) return;
        const info = getFrontMatterInfo(editor.getValue());
        if (info.exists) editor.setCursor(editor.offsetToPos(info.contentStart));
    }

    // `text` with `alias` among its aliases: properties of its own at the top when it has none, a line of
    // its own when its properties have no aliases, else added to the list. Unchanged when it's there, and
    // when its properties don't read.
    withAlias(text, alias) {
        if (!alias) return text;
        const nl = text.includes("\r\n") ? "\r\n" : "\n";
        const info = getFrontMatterInfo(text);
        if (!info.exists) return `---${nl}aliases: ${this.scalar(alias)}${nl}---${nl}${text}`;
        const props = this.read(info.frontmatter);
        if (!props) return text;
        const have = [].concat(props.aliases ?? []).filter((a) => a !== null && a !== "").map(String);
        if (have.includes(alias)) return text;
        if (!("aliases" in props)) return `${text.slice(0, info.from)}aliases: ${this.scalar(alias)}${nl}${text.slice(info.from)}`;
        props.aliases = [...have, alias];
        return `---${nl}${stringifyYaml(props).replace(/\r?\n/g, nl)}---${nl}${text.slice(info.contentStart)}`;
    }

    // A note's text with a template's added: the properties combined (a template's value replaces the note's,
    // aliases and tags keep both, each value once), the template's text after the note's
    merge(text, tpl) {
        const a = this.parts(text), b = this.parts(tpl);
        if (!b.props || !Object.keys(b.props).length) return `${text}${b.body}`;
        if (!a.props) return `---\n${stringifyYaml(b.props)}---\n${a.body}${b.body}`;
        const props = { ...a.props };
        for (const [key, value] of Object.entries(b.props)) {
            if (!(key in props)) props[key] = value;
            else if (PeriodicNotes.LISTS.includes(key) || Array.isArray(props[key]) || Array.isArray(value)) {
                props[key] = [...new Set([...[].concat(props[key] ?? []), ...[].concat(value ?? [])].filter((v) => v !== null && v !== ""))];
            } else if (value !== null && value !== "") props[key] = value;
        }
        return `---\n${stringifyYaml(props)}---\n${a.body}${b.body}`;
    }

    // { props, body }: a note's properties (null when it has none, or they don't read) and the text after them
    parts(text) {
        const info = getFrontMatterInfo(text);
        if (!info.exists) return { props: null, body: text };
        const props = this.read(info.frontmatter);
        return props ? { props, body: text.slice(info.contentStart) } : { props: null, body: text };
    }

    read(yaml) {
        try {
            const props = parseYaml(yaml) ?? {};
            return typeof props === "object" && !Array.isArray(props) ? props : null;
        } catch {
            return null;
        }
    }

    // A value for a line of properties: bare when YAML reads it back as the same text, else quoted
    scalar(value) {
        return /^[\p{L}\p{N}][\p{L}\p{N} ./,-]*$/u.test(value) && !/^\d+$/.test(value) ? value : JSON.stringify(value);
    }

    // A template's text with {{title}}, {{date}}, {{date:FORMAT}}, {{time}} and {{time:FORMAT}} filled in, as
    // Obsidian's Templates plugin fills them (its date and time formats), the date being the period's first day
    fill(text, { name, start }) {
        const opts = app.internalPlugins?.plugins?.templates?.instance?.options ?? {};
        const day = moment(start, "YYYY-MM-DD", true);
        return text.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (all, what, format) => {
            const w = what.toLowerCase();
            if (w === "title") return name;
            if (w === "date") return day.format(format?.trim() || opts.dateFormat || "YYYY-MM-DD");
            return moment().format(format?.trim() || opts.timeFormat || "HH:mm");
        });
    }

    // Keeps Templater's trigger for new notes off `path` for HOLD_MS (from now, or more when it's held
    // already): it looks 300 ms after a note appears, and runs Get Template on one with only properties
    hold(path) {
        const pending = this.pending();
        if (!pending || !path) return;
        clearTimeout(this.holds.get(path));
        pending.add(path);
        this.holds.set(path, setTimeout(() => {
            this.holds.delete(path);
            pending.delete(path);
        }, PeriodicNotes.HOLD_MS));
    }

    // Templater's set of notes it's still writing, or null when Templater is off or has changed
    pending() {
        const set = app.plugins?.plugins?.["templater-obsidian"]?.templater?.files_with_pending_templates;
        return ["has", "add", "delete"].every((m) => typeof set?.[m] === "function") ? set : null;
    }
}
