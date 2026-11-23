import { ButtonComponent, Modal, moment, Notice, Setting } from "obsidian";
import { app, plainday } from "../host.js";

export default class RenamePeriodicNotes {
    // Command (OBS-305): after you change how a kind of periodic note is named (the Daily notes plugin's format,
    // or Notebook Navigator's pattern), renames the notes still named the old way, and every link to them, so
    // Plainday reads them again. You give the kind, the folder the notes are in and their old format; the new
    // format starts as the one set now. A preview says what it would do and changes nothing.
    // - Which notes: those under the folder whose path from it, without .md, reads strictly in the old format
    //   and writes back the same. The old format may hold date folders (Navigator's default, YYYY/YYYYMMDD):
    //   those notes come out into the kind's folder, and the date folders they leave empty go. A new format
    //   with a folder in it is refused until Plainday finds notes in date folders (OBS-310).
    // - A week is renamed by its fourth day, so a switch between weeks starting Sunday and ISO weeks names
    //   the same week.
    // - Links: every wikilink and embed that resolves to a note being renamed, or to no note and reads in
    //   the old format (most 🚩s link a day with no note). Each keeps its label, heading or block, folder
    //   and \|. Markdown links and links in properties, which Plainday never writes, are counted and listed
    //   for you instead. A table whose links change length is padded again (TimeReport.table, OBS-184).
    // - Two steps, through temporary names (TEMP and the new name): first every link and note to its
    //   temporary name, then off it. Each step rewrites the links first, then the names, so a plugin that
    //   rewrites links on a rename (Advanced Rename and Delete Handler) finds none left, and
    //   app.vault.rename doesn't stop to ask "Update links?" as fileManager.renameFile does. The temporary
    //   names are why formats that name days alike work: from DD-MM-YYYY to MM-DD-YYYY, 05-11-2026 is
    //   November 5 before and May 11 after, and renamed directly, a link rewritten to May 11 would spell the
    //   November note's name until that note is renamed, and such a plugin would move it along.
    //   A run that stops between the steps is finished by running the command again.
    // - A note whose new name another note has already is left beside it, and listed, so a link by name
    //   never becomes ambiguous. A note it can't rewrite is left as it was, and listed; the run goes on.
    // It changes no setting. Running it again with the formats swapped undoes it.
    static KINDS = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
    // A run that takes longer than this shows its progress
    static PROGRESS_MS = 1000;
    // How many names a notice lists before it says how many more
    static LISTED = 5;
    // What a note's or link's name starts with between the two steps of a run
    static TEMP = "Plainday renaming ";

    async invoke() {
        const left = this.unfinished();
        if (left.notes.length || left.edits.size) return this.askFinish(left);
        this.ask({ unit: "day", ...this.defaults("day"), from: "" });
    }

    // The folder a kind's notes are kept in and the format that names them now, as Plainday makes them
    // (Schedule.dailyOpts, TimeReport.periodFolders, DatePrompt.weekRules)
    defaults(unit) {
        const rules = plainday.DatePrompt.weekRules();
        return { folder: this.folderOf(unit), to: unit === "day" ? plainday.Schedule.dailyOpts().format : rules.format[unit] };
    }

    // The kind's own folder, without the date folders a format of the Daily notes plugin's may add
    folderOf(unit) {
        return unit === "day" ? plainday.Schedule.dailyOpts().folder : plainday.TimeReport.periodFolders()[unit];
    }

    // The dialog: the form, then the preview, then the run
    ask(form) {
        const modal = new Modal(app);
        modal.titleEl.setText("Rename periodic notes");
        const el = modal.contentEl;
        let onEnter = null;
        const showForm = (problem = "") => {
            el.empty();
            el.createEl("p", { text: "Renames notes still named the old way after you change how they're named, and every link to them. Change the format where it's set first. This changes no setting." });
            new Setting(el).setName("Notes").addDropdown((d) => {
                for (const [unit, kind] of Object.entries(RenamePeriodicNotes.KINDS)) d.addOption(unit, `${kind[0].toUpperCase()}${kind.slice(1)} notes`);
                d.setValue(form.unit).onChange((unit) => {
                    Object.assign(form, { unit, ...this.defaults(unit) });
                    showForm();
                });
            });
            new Setting(el).setName("In the folder").setDesc("Where the notes are now.")
                .addText((t) => t.setValue(form.folder).onChange((v) => { form.folder = v; }));
            let first = null;
            new Setting(el).setName("Old format").setDesc("How they're named now, in moment.js tokens. It may hold date folders, such as YYYY/YYYYMMDD.")
                .addText((t) => { first = t; t.setPlaceholder("YYYY-MM-DD").setValue(form.from).onChange((v) => { form.from = v; }); });
            new Setting(el).setName("New format").setDesc("How they should be named: the format set now.")
                .addText((t) => t.setValue(form.to).onChange((v) => { form.to = v; }));
            if (problem) el.createDiv({ cls: "setting-item-description plainday-caution", text: problem });
            const row = el.createDiv({ cls: "modal-button-container" });
            new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
            new ButtonComponent(row).setButtonText("Preview").setCta().onClick(preview);
            onEnter = preview;
            window.requestAnimationFrame(() => first?.inputEl.focus());
        };
        const preview = async () => {
            await this.saveOpenNotes();
            const p = this.plan(form);
            if (p.refused) return showForm(p.refused);
            el.empty();
            for (const line of this.describe(p)) el.createEl("p", { text: line.text, cls: line.caution ? "plainday-caution" : undefined });
            const row = el.createDiv({ cls: "modal-button-container" });
            new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
            new ButtonComponent(row).setButtonText("Back").onClick(() => showForm());
            onEnter = null;
            if (p.notes.length || p.edits.size) {
                const rename = () => { modal.close(); void this.run(p); };
                const go = new ButtonComponent(row).setButtonText("Rename").setCta().onClick(rename);
                onEnter = rename;
                window.requestAnimationFrame(() => go.buttonEl.focus());
            }
        };
        // Enter in a box previews, and on the preview renames; on a button, it presses that button
        modal.scope.register([], "Enter", () => {
            if (el.ownerDocument.activeElement?.tagName === "BUTTON") return true;
            void onEnter?.();
            return false;
        });
        modal.onOpen = () => showForm();
        modal.open();
    }

    // The dialog when a run stopped between its two steps: it offers to finish
    askFinish(left) {
        const modal = new Modal(app);
        modal.titleEl.setText("Rename periodic notes");
        const el = modal.contentEl;
        const n = left.notes.length, links = [...left.edits.values()].reduce((a, l) => a + l.length, 0);
        const what = n ? `${this.count(n, "note")} still ${n === 1 ? "has a temporary name" : "have temporary names"}, such as ${left.notes[0].rel}`
            : `${this.count(links, "link")} still ${links === 1 ? "links a temporary name" : "link temporary names"}`;
        el.createEl("p", { text: `A rename stopped before it was done, so ${what}. Finishing gives them their new names, and the links to them.` });
        const row = el.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
        const go = new ButtonComponent(row).setButtonText("Finish").setCta().onClick(() => { modal.close(); void this.runFinish(); });
        modal.onOpen = () => window.requestAnimationFrame(() => go.buttonEl.focus());
        modal.open();
    }

    // What the preview says: [{ text, caution }]
    describe(p) {
        const lines = [], kind = RenamePeriodicNotes.KINDS[p.unit];
        const where = p.dest || "the top of the vault";
        if (!p.notes.length && !p.taken.length) lines.push({ text: `No notes in ${p.folder || "the vault's top folder"} are named ${p.from}.` });
        if (p.notes.length) {
            const e = p.notes.at(-1);
            lines.push({ text: `Renames ${this.count(p.notes.length, `${kind} note`)}, such as ${e.rel} → ${e.name} (${this.spell(p.unit, e.period, p.locale)}), into ${where}.` });
        }
        if (p.links) {
            const none = p.dangling ? `, ${p.dangling} of them to ${p.unit === "day" ? "days" : `${p.unit}s`} with no note yet` : "";
            lines.push({ text: `Rewrites ${this.count(p.links, "link")} in ${this.count(p.edits.size, "note")}${none}.` });
        }
        if (p.taken.length) lines.push({ text: `Leaves ${this.list(p.taken.map((n) => n.rel))}, since another note already has the new name. Merge the two, then run this again.` });
        if (p.other.size) lines.push({ text: `Can't rewrite ${this.count([...p.other.values()].reduce((a, b) => a + b, 0), "link")} written as a Markdown link or in properties: you'll get the list of notes at the end, to fix by hand.` });
        if (p.mislabeled.count) {
            const m = p.mislabeled;
            lines.push({ caution: true, text: `${this.count(m.count, "link")} would link a day other than the one ${m.count === 1 ? "its" : "their"} label shows, such as "${m.label}" for ${m.name}. The old format is probably wrong.` });
        }
        if (p.notes.length || p.edits.size) {
            lines.push({ text: p.from.includes("/")
                ? "Take a backup first. Notes taken out of date folders can't be put back into them this way yet."
                : "Take a backup first. To undo it, run this again with the two formats swapped." });
        }
        return lines;
    }

    // ---------------------------------------------------------------- the plan (what the preview shows)

    // Everything a run would do, worked out without changing anything: { unit, kind, folder, from, to, locale,
    // dest, notes: [{ file, from (its path), rel, period, name, path }], taken: [the same, left], edits:
    // Map(path → [{ start, end, original, text, temp (its text between the steps) }]), links and dangling
    // (how many, and how many link no note),
    // other: Map(path → its Markdown and property links), mislabeled: { count, label, name } }, or { refused }
    plan({ unit, folder, from, to }) {
        const rules = plainday.DatePrompt.weekRules();
        const locale = unit === "day" ? moment.locale() : rules.locale;
        const kind = RenamePeriodicNotes.KINDS[unit];
        folder = String(folder ?? "").trim().replace(/^\/+|\/+$/g, "");
        from = String(from ?? "").trim();
        to = String(to ?? "").trim();
        if (!from) return { refused: "Give the format the notes are named in now." };
        if (!to) return { refused: "Give the format they should be named in." };
        if (to.includes("/")) return { refused: "Plainday doesn't find notes in date folders yet, so the new format can't hold a folder." };
        if (!plainday.Settings.namesWholeDate(unit, to, locale)) return { refused: `Names in ${to} don't give a note's whole date on their own, which Plainday needs.` };
        const dest = this.folderOf(unit);
        const prefix = folder ? `${folder}/` : "";
        const ctx = { unit, folder, prefix, from, to, locale, dest };

        // The notes, and the names they'd get
        const files = app.vault.getMarkdownFiles();
        const names = new Map();
        for (const f of files) names.set(f.basename.toLowerCase(), (names.get(f.basename.toLowerCase()) ?? 0) + 1);
        const found = [];
        for (const f of files) {
            if (!f.path.startsWith(prefix)) continue;
            const rel = f.path.slice(prefix.length).replace(/\.md$/, "");
            const period = this.read(unit, rel, from, locale);
            if (!period) continue;
            const name = this.name(unit, period, to, locale);
            if (!this.readsBack(unit, period, name, to, locale)) {
                return { refused: `${rel} would be named ${name}, which doesn't read back as the same ${unit} in ${to}.` };
            }
            const path = `${dest ? `${dest}/` : ""}${name}.md`;
            if (path !== f.path) found.push({ file: f, from: f.path, rel, period, name, path });
        }
        found.sort((a, b) => a.period.localeCompare(b.period));
        // A note stays when its new name is one a note keeps (a link by name would then be ambiguous), or an
        // earlier note gets it. The notes this run renames give their names up, so two may swap names (the
        // temporary names make that safe), until one of them is found to stay, which can hold another back.
        const stays = new Set();
        let notes = [];
        for (let changed = true; changed;) {
            changed = false;
            const kept = new Map(names), leaving = new Set();
            for (const n of found) {
                if (stays.has(n)) continue;
                const key = n.file.basename.toLowerCase();
                kept.set(key, kept.get(key) - 1);
                leaving.add(n.from);
            }
            notes = [];
            const giving = new Set();
            for (const n of found) {
                if (stays.has(n)) continue;
                const key = n.name.toLowerCase(), at = app.vault.getAbstractFileByPath(n.path);
                if ((kept.get(key) ?? 0) > 0 || giving.has(key) || (at && !leaving.has(at.path))) { stays.add(n); changed = true; } else { giving.add(key); notes.push(n); }
            }
        }
        const taken = found.filter((n) => stays.has(n));
        ctx.renamed = new Map(notes.map((n) => [n.from, n]));
        // The old format's last part, which reads a link by its name alone when it gives the whole date
        const last = from.slice(from.lastIndexOf("/") + 1);
        ctx.last = plainday.Settings.namesWholeDate(unit, last, locale) ? last : null;

        // The links
        const edits = new Map(), other = new Map(), mislabeled = { count: 0, label: "", name: "" };
        let links = 0, dangling = 0;
        for (const f of files) {
            const cache = app.metadataCache.getFileCache(f);
            if (!cache) continue;
            const list = [];
            for (const l of [...(cache.links ?? []), ...(cache.embeds ?? [])]) {
                const at = l.position?.start?.offset, end = l.position?.end?.offset;
                const w = RenamePeriodicNotes.parse(l.original);
                if (!w) {
                    if (this.retarget(l.link, f.path, ctx)) other.set(f.path, (other.get(f.path) ?? 0) + 1);
                    continue;
                }
                const next = this.retarget(w.linkpath, f.path, ctx);
                if (!next || typeof at !== "number" || typeof end !== "number") continue;
                // Its temporary name, for the first step
                const cut = next.linkpath.lastIndexOf("/") + 1;
                const temp = `${next.linkpath.slice(0, cut)}${RenamePeriodicNotes.TEMP}${next.linkpath.slice(cut)}`;
                list.push({ start: at, end, original: l.original, text: `${w.bang}[[${next.linkpath}${w.rest}]]`, temp: `${w.bang}[[${temp}${w.rest}]]` });
                if (!next.note) dangling++;
                const shows = unit === "day" ? plainday.TimeReport.constructor.labelDay(w.label) : null;
                if (shows && shows !== `${+next.period.slice(5, 7)}/${+next.period.slice(8, 10)}`) {
                    if (!mislabeled.count) Object.assign(mislabeled, { label: w.label, name: next.name });
                    mislabeled.count++;
                }
            }
            for (const l of cache.frontmatterLinks ?? []) {
                if (this.retarget(l.link, f.path, ctx)) other.set(f.path, (other.get(f.path) ?? 0) + 1);
            }
            if (list.length) { edits.set(f.path, list); links += list.length; }
        }
        return { unit, kind, folder, from, to, locale, dest, notes, taken, edits, links, dangling, other, mislabeled };
    }

    // A name read strictly in `format`, as the period it names: its first day (YYYY-MM-DD), or null. A week
    // reads as its first day in that format's way of counting weeks.
    read(unit, text, format, locale) {
        const m = moment(text, format, locale, true);
        if (!m.isValid() || m.format(format) !== text) return null;
        // In Western digits, whatever the language's own
        return (unit === "day" || unit === "week" ? m : m.clone().startOf(unit)).locale("en").format("YYYY-MM-DD");
    }

    // The name `format` gives the period starting on `period`. A week's is the week in `format`'s way of
    // counting that holds the old week's fourth day, named from its first day, so a format with a day in it
    // names the week as Plainday does.
    name(unit, period, format, locale) {
        const m = moment(period, "YYYY-MM-DD", true).locale(locale);
        if (unit !== "week") return m.format(format);
        return m.add(3, "days").startOf(plainday.Settings.constructor.isoName(format) ? "isoWeek" : "week").format(format);
    }

    // Whether `name` reads back in `format` as the same day, month or year, or as a week holding the old
    // week's fourth day
    readsBack(unit, period, name, format, locale) {
        const back = this.read(unit, name, format, locale);
        if (!back) return false;
        if (unit === "week") {
            const days = moment(period, "YYYY-MM-DD", true).add(3, "days").diff(moment(back, "YYYY-MM-DD", true), "days");
            return days >= 0 && days <= 6;
        }
        return back === period;
    }

    // The link text a link should have after the run, or null when it stays: { linkpath, period, name, note
    // (whether it links a note) }. A
    // link to a note being renamed takes its new name, or its new path when it had a path. A link to no
    // note takes the name its old-format name reads as: by the old format's last part when it's a name
    // alone, by the whole format under the folder when it's a path.
    retarget(linkpath, source, ctx) {
        const text = String(linkpath ?? "").trim();
        if (!text) return null;
        const path = text.includes("/"), ext = /\.md$/i.test(text) ? text.slice(-3) : "";
        const dest = app.metadataCache.getFirstLinkpathDest(text, source);
        let period, name;
        if (dest) {
            const n = ctx.renamed.get(dest.path);
            if (!n) return null;
            ({ period, name } = n);
        } else {
            const bare = ext ? text.slice(0, -3) : text;
            if (path) period = bare.startsWith(ctx.prefix) ? this.read(ctx.unit, bare.slice(ctx.prefix.length), ctx.from, ctx.locale) : null;
            else period = ctx.last ? this.read(ctx.unit, bare, ctx.last, ctx.locale) : null;
            if (!period) return null;
            name = this.name(ctx.unit, period, ctx.to, ctx.locale);
            if (!this.readsBack(ctx.unit, period, name, ctx.to, ctx.locale)) return null;
        }
        const next = path ? `${ctx.dest ? `${ctx.dest}/` : ""}${name}${ext}` : `${name}${ext}`;
        return next === text ? null : { linkpath: next, period, name, note: !!dest };
    }

    // A wikilink or embed as written: { bang, linkpath, rest (its #heading or #^block, its | or \| and label,
    // as written), label }, or null for a Markdown link
    static parse(original) {
        const m = String(original ?? "").match(/^(!?)\[\[([\s\S]*)\]\]$/);
        if (!m) return null;
        const inner = m[2];
        let cut = inner.search(/[#|]/);
        if (cut < 0) cut = inner.length;
        // A table's \| escapes the bar; the backslash isn't part of the name
        if (inner[cut] === "|" && inner[cut - 1] === "\\") cut--;
        const rest = inner.slice(cut), bar = rest.indexOf("|");
        return { bang: m[1], linkpath: inner.slice(0, cut), rest, label: bar < 0 ? "" : rest.slice(bar + 1) };
    }

    // ---------------------------------------------------------------- the run

    async run(p) {
        const show = this.progress(), out = { failed: new Set(), missed: new Set(), late: [] };
        const done = { links: 0, notes: 0, files: 0 }, T = RenamePeriodicNotes.TEMP;
        const emptied = new Set();
        try {
            // Step 1: every link and note to its temporary name, which no note or link has
            const temp = new Map([...p.edits].map(([path, list]) => [path, list.map((e) => ({ ...e, text: e.temp }))]));
            Object.assign(done, await this.rewriteLinks(temp, (i, n) => show(`Step 1 of 2: rewriting links in ${i} of ${n}…`), out));
            const ours = new Set(p.notes.map((n) => n.from));
            let i = 0;
            for (const n of p.notes) {
                show(`Step 1 of 2: renaming ${++i} of ${this.count(p.notes.length, `${p.kind} note`)}…`);
                if (!app.vault.getFileByPath(n.from)) continue;
                // A note made under the new name since the preview
                const held = app.vault.getAbstractFileByPath(n.path);
                const to = `${p.dest ? `${p.dest}/` : ""}${T}${n.name}.md`;
                if ((held && !ours.has(held.path)) || app.vault.getAbstractFileByPath(to)) { out.late.push(n); continue; }
                try {
                    if (p.dest && !app.vault.getFolderByPath(p.dest)) await app.vault.createFolder(p.dest);
                    await app.vault.rename(n.file, to);
                    for (let dir = this.parentOf(n.from); dir && dir !== p.folder && dir.startsWith(p.folder ? `${p.folder}/` : ""); dir = this.parentOf(dir)) emptied.add(dir);
                } catch (e) {
                    console.error(`RenamePeriodicNotes: couldn't rename ${n.from}`, e);
                    out.failed.add(n.from);
                }
            }
            await this.settled();
            // Step 2: off the temporary names
            done.notes = (await this.finish((text) => show(`Step 2 of 2: ${text}`), out)).notes;
            // The date folders the notes came out of, deepest first, when nothing is left in them
            for (const dir of [...emptied].sort((a, b) => b.split("/").length - a.split("/").length)) {
                const f = app.vault.getFolderByPath(dir);
                if (f && !f.children.length) await app.fileManager.trashFile(f).catch((e) => console.error(`RenamePeriodicNotes: couldn't remove ${dir}`, e));
            }
        } finally {
            show.hide();
        }
        const end = this.summary(p, done, out);
        new Notice(end.text, end.left ? 0 : undefined);
        return end;
    }

    // A run that stopped between its steps, finished
    async runFinish() {
        const show = this.progress(), out = { failed: new Set(), missed: new Set(), late: [] };
        let done;
        try {
            done = await this.finish(show, out);
        } finally {
            show.hide();
        }
        const end = this.summary({ kind: "periodic", taken: [], other: new Map() }, done, out);
        new Notice(end.text, end.left ? 0 : undefined);
        return end;
    }

    // Step 2: every link to a temporary name, and every note with one, off it: { notes, links, files }
    async finish(show, out) {
        const left = this.unfinished();
        const done = await this.rewriteLinks(left.edits, (i, n) => show(`rewriting links in ${i} of ${n}…`), out);
        done.notes = 0;
        let i = 0;
        for (const n of left.notes) {
            show(`renaming ${++i} of ${this.count(left.notes.length, "note")}…`);
            // It keeps its temporary name while another note has its name
            if (app.vault.getAbstractFileByPath(n.path)) { out.late.push(n); continue; }
            try {
                await app.vault.rename(n.file, n.path);
                done.notes++;
            } catch (e) {
                console.error(`RenamePeriodicNotes: couldn't rename ${n.from}`, e);
                out.failed.add(n.from);
            }
        }
        return done;
    }

    // What's still under a temporary name, as the second step would change it: { notes: [{ file, from, rel,
    // name, path }], edits: Map(path → [{ start, end, original, text }]) }
    unfinished() {
        const T = RenamePeriodicNotes.TEMP, files = app.vault.getMarkdownFiles();
        const notes = files.filter((f) => f.basename.startsWith(T)).map((f) => {
            const name = f.basename.slice(T.length), dir = this.parentOf(f.path);
            return { file: f, from: f.path, rel: f.basename, name, path: `${dir ? `${dir}/` : ""}${name}.md` };
        });
        const edits = new Map();
        for (const f of files) {
            const cache = app.metadataCache.getFileCache(f), list = [];
            for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
                const w = RenamePeriodicNotes.parse(l.original);
                const at = l.position?.start?.offset, end = l.position?.end?.offset;
                if (!w || typeof at !== "number" || typeof end !== "number") continue;
                const cut = w.linkpath.lastIndexOf("/") + 1;
                if (!w.linkpath.startsWith(T, cut)) continue;
                list.push({ start: at, end, original: l.original, text: `${w.bang}[[${w.linkpath.slice(0, cut)}${w.linkpath.slice(cut + T.length)}${w.rest}]]` });
            }
            if (list.length) edits.set(f.path, list);
        }
        return { notes, edits };
    }

    // The links of `edits` rewritten, then the views written through saved and the cache caught up: { links,
    // files }. A note that can't be written goes into out.failed, one whose links moved into out.missed.
    async rewriteLinks(edits, show, out) {
        const written = [];
        let i = 0, links = 0;
        for (const [path, list] of edits) {
            show(++i, this.count(edits.size, "note"));
            const file = app.vault.getFileByPath(path);
            if (!file) { out.missed.add(path); continue; }
            try {
                let n = 0;
                await plainday.Schedule.rewrite(file, (text) => {
                    const r = this.apply(text, list);
                    n = r.count;
                    return r.text;
                });
                links += n;
                if (n) written.push(file);
                if (n < list.length) out.missed.add(path);
            } catch (e) {
                console.error(`RenamePeriodicNotes: couldn't rewrite the links in ${path}`, e);
                out.failed.add(path);
            }
        }
        // An open note is read into the cache only once it's saved
        for (const file of written) await this.viewOf(file)?.save?.();
        await this.settled();
        return { links, files: written.length };
    }

    // A notice of a run's progress, shown once it takes longer than PROGRESS_MS: show(text), show.hide()
    progress() {
        const started = Date.now();
        let notice = null;
        const show = (text) => {
            if (!notice && Date.now() - started < RenamePeriodicNotes.PROGRESS_MS) return;
            notice ??= new Notice(text, 0);
            notice.setMessage(text);
        };
        show.hide = () => notice?.hide();
        return show;
    }

    // What the notice at the end says, and whether it left anything: { text, left }
    summary(p, done, out) {
        const kind = p.kind, lines = [], failed = [...out.failed], missed = [...out.missed], late = out.late;
        lines.push(`Renamed ${this.count(done.notes, `${kind} note`)} and rewrote ${this.count(done.links, "link")} in ${this.count(done.files, "note")}.`);
        const name = (path) => path.split("/").pop().replace(/\.md$/, "");
        const left = [...p.taken, ...late];
        if (left.length) lines.push(`Left ${this.list(left.map((n) => n.rel))}, since another note has the new name. Merge the two, then run this again.`);
        if (failed.length) lines.push(`Couldn't change ${this.list(failed.map(name))}, so left ${failed.length === 1 ? "it" : "them"} as ${failed.length === 1 ? "it was" : "they were"}.`);
        if (missed.length) lines.push(`Some links in ${this.list(missed.map(name))} changed while this ran, so they were left: run this again.`);
        if (p.other.size) lines.push(`Fix by hand the Markdown links or links in properties in ${this.list([...p.other.keys()].map(name))}.`);
        return { text: lines.join("\n\n"), left: lines.length > 1 };
    }

    // `text` with each link of `list` changed where it still is (a note being edited may have moved it), and
    // each padded table whose links changed length padded again, so a table typed by hand stays as typed:
    // { text, count }. Throws when a table can't be padded, so the note is left as it was.
    apply(text, list) {
        let out = text, count = 0;
        const lines = new Set();
        for (const e of [...list].sort((a, b) => b.start - a.start)) {
            if (out.slice(e.start, e.end) !== e.original) continue;
            out = out.slice(0, e.start) + e.text + out.slice(e.end);
            count++;
            if (e.text.length !== e.original.length) lines.add(text.slice(0, e.start).split("\n").length - 1);
        }
        if (!lines.size) return { text: out, count };
        const all = out.split("\n"), before = text.split("\n");
        // Each table once, from its last changed line up, so the lines above keep their numbers
        const done = new Set();
        for (const i of [...lines].sort((a, b) => b - a)) {
            if (!all[i]?.startsWith("|")) continue;
            let a = i;
            while (a > 0 && all[a - 1].startsWith("|")) a--;
            if (done.has(a)) continue;
            done.add(a);
            let b = i;
            while (b + 1 < all.length && all[b + 1].startsWith("|")) b++;
            const was = before.slice(a, b + 1);
            const padded = this.pad(was)?.join("\n") === was.join("\n") ? this.pad(all.slice(a, b + 1)) : null;
            if (padded) all.splice(a, b - a + 1, ...padded);
        }
        return { text: all.join("\n"), count };
    }

    // A table's lines padded again as Obsidian's table editor pads them (TimeReport.table), or null when they
    // aren't a table, or padding would change what a cell says
    pad(rows) {
        if (rows.length < 2) return null;
        const align = RenamePeriodicNotes.cells(rows[1]).map((c) => {
            const m = c.match(/^(:?)-+(:?)$/);
            return m ? (m[1] && m[2] ? "center" : m[1] ? "left" : m[2] ? "right" : null) : undefined;
        });
        if (align.includes(undefined)) return null;
        const cells = [rows[0], ...rows.slice(2)].map(RenamePeriodicNotes.cells);
        const out = plainday.TimeReport.table(cells[0], align, cells.slice(1));
        const back = [out[0], ...out.slice(2)].map(RenamePeriodicNotes.cells);
        const same = cells.every((row, r) => align.every((_, c) => (row[c] ?? "") === back[r][c]));
        return same ? out : null;
    }

    // A table row's cells, trimmed: split at each | that isn't escaped as \| (without a lookbehind, which iOS
    // before 16.4 can't read)
    static cells(line) {
        const t = line.trim(), out = [""];
        for (let i = 0; i < t.length; i++) {
            if (t[i] === "\\" && t[i + 1] === "|") { out[out.length - 1] += "\\|"; i++; } else if (t[i] === "|") out.push("");
            else out[out.length - 1] += t[i];
        }
        if (t.startsWith("|")) out.shift();
        if (t.endsWith("|") && !t.endsWith("\\|")) out.pop();
        return out.map((c) => c.trim());
    }

    // ---------------------------------------------------------------- helpers

    // Every open note saved, and the cache caught up, so the links are read where they are now
    async saveOpenNotes() {
        for (const leaf of app.workspace.getLeavesOfType("markdown")) await leaf.view?.save?.();
        await this.settled();
    }

    // Once the metadata cache has read every change
    async settled() {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        const cache = app.metadataCache;
        if (typeof cache.onCleanCache === "function") await new Promise((resolve) => cache.onCleanCache(resolve));
    }

    viewOf(file) {
        return app.workspace.getLeavesOfType("markdown").map((l) => l.view).find((v) => v?.file?.path === file.path && v.editor && (v.getMode?.() ?? "source") === "source");
    }

    parentOf(path) {
        const at = path.lastIndexOf("/");
        return at < 0 ? "" : path.slice(0, at);
    }

    // "Thursday, September 17, 2026", "the week of Sunday, September 13, 2026", "September 2026", "2026"
    spell(unit, period, locale) {
        const m = moment(period, "YYYY-MM-DD", true).locale(locale);
        if (unit === "day") return m.format("dddd, LL");
        if (unit === "week") return `the week of ${m.format("dddd, LL")}`;
        return m.format(unit === "month" ? "MMMM YYYY" : "YYYY");
    }

    count(n, word) {
        return `${n} ${word}${n === 1 ? "" : "s"}`;
    }

    // "a, b and c", or the first few and how many more
    list(names) {
        const max = RenamePeriodicNotes.LISTED;
        const shown = names.length > max ? [...names.slice(0, max - 1), `${names.length - max + 1} more`] : names;
        return shown.length < 2 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
    }
}
