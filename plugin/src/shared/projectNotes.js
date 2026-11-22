import { ButtonComponent, Modal, moment, Notice, stringifyYaml, TextComponent } from "obsidian";
import { app, plainday } from "../host.js";

export default class ProjectNotes {
    // Projects and areas, made in one place (OBS-123): New project, New area and Convert to project call make(),
    // and so can a picker or a base later (OBS-141, OBS-173). The Project and Area templates' Templater code did
    // this before; Plainday can't update that code once it's in a vault, and it filed into a fixed `Projects/`.
    // - Where: a folder of the name at the top of the Projects folder (Settings → Plainday → Folders), with the note
    //   inside it named like the folder, where Notebook Navigator and the Folder Notes plugin look for a folder's
    //   note. Move to project files it under an area afterwards.
    // - What it gets, in one write: the properties the scripts read, in the old Project template's order, `id`
    //   aside (no code reads it; the template writes it). A project's dates come out of its name: the first is
    //   its `start`, the second its `due`.
    // - Then that kind's template, when it has anything in it, as Add note runs the Task template (OBS-121):
    //   through Templater when it's on; else its text with {{title}}, {{date}} and {{time}} filled in; one with
    //   Templater code while Templater is off isn't used, with a notice. Plainday's own values stay: its alias
    //   first, its tag, the name's dates, and any of its values a template would leave empty.
    // - Then its folder's look in Notebook Navigator, and its pin, as Navigator would give a folder note (OBS-142).
    static KINDS = {
        project: { tag: "project", mark: "⭕.", word: "project", title: "New project" },
        area: { tag: "area", mark: "🗃️.", word: "area", title: "New area" },
    };
    static DATE = /[0-9]{4}-[0-9]{2}-[0-9]{2}/g;
    // Characters a file name or a link can't hold
    static BAD = /[\\/:*?"<>|#^[\]\r\n]/g;
    // A cursor marker a template leaves (tp.file.cursor): Templater moves the cursor there only in a note that's
    // open, and these are made closed, so the marker stays in the text until Plainday takes it out
    static CURSOR = /<%\s*tp\.file\.cursor\(\s*(\d*)\s*\)\s*%>/g;
    // The look a project or area folder gets when Navigator gives its tag none (Navigator's icon names)
    static LOOKS = {
        project: { icon: "circle", color: "#ef4444" },
        area: { icon: "archive", color: "#168a42" },
    };
    // How long make() waits for the metadata cache to read a new note before opening it anyway
    static READ_MS = 1000;

    constructor() {
        // Where the cursor goes in the note made last: { path, offset }, from a template's cursor marker
        this.cursorAt = null;
    }

    // ---------------------------------------------------------------- names

    // What a typed name gives: { name, start, due }. A project's dates come out of its name, the first its
    // `start`, the second its `due`; an area keeps its name as typed.
    parse(typed, kind = "project") {
        const text = String(typed ?? "").trim();
        if (kind !== "project") return { name: text.replace(/\s+/g, " "), start: "", due: "" };
        const dates = text.match(ProjectNotes.DATE) ?? [];
        const name = text.replace(ProjectNotes.DATE, " ").replace(/\s+/g, " ").trim();
        return { name, start: dates[0] ?? "", due: dates[1] ?? "" };
    }

    // Why `typed` can't name a new project or area, or "" when it can. The note would take over the links of a
    // note that has its name (Obsidian resolves a shared name to the shortest path), and the time on them; a
    // folder of its name in Projects may hold a folder note of its own already.
    problem(typed, kind = "project") {
        const raw = String(typed ?? "").trim();
        const { name } = this.parse(raw, kind);
        if (!raw) return `Type a name for the ${ProjectNotes.KINDS[kind].word}.`;
        if (!name) return "A project's dates become its start and due, so its name needs words too.";
        const bad = [...new Set((raw.match(ProjectNotes.BAD) ?? []).map((c) => (c === "\n" || c === "\r" ? "a line break" : `“${c}”`)))];
        if (bad.length) {
            const list = bad.length === 1 ? bad[0] : `${bad.slice(0, -1).join(", ")} or ${bad.at(-1)}`;
            return `A name can't contain ${list}. Files and links can't hold ${bad.length === 1 ? "it" : "them"}.`;
        }
        const lower = name.toLowerCase();
        if (app.vault.getMarkdownFiles().some((f) => f.basename.toLowerCase() === lower)) return `A note named “${name}” already exists. Give this one another name.`;
        const projects = plainday.Settings.folders().projects;
        const there = (app.vault.getFolderByPath(projects)?.children ?? []).find((c) => c.name.toLowerCase() === lower);
        if (there) return `${there.children ? "A folder" : "A file"} named “${there.name}” is already in ${projects}. Give this one another name.`;
        return "";
    }

    // ---------------------------------------------------------------- making one

    // Makes the project or area `name` (as typed: a project's dates in it too) and resolves to its note, not
    // opened. Throws when the name can't be used (problem()), for a caller that didn't ask first.
    async make({ kind = "project", name: typed }) {
        const why = this.problem(typed, kind);
        if (why) throw new Error(why);
        const { name, start, due } = this.parse(typed, kind);
        const folder = `${plainday.Settings.folders().projects}/${name}`;
        const path = `${folder}/${name}.md`;
        const own = this.own(kind, name, { start, due });
        const notes = plainday.PeriodicNotes;
        const tpl = app.vault.getFileByPath(this.templatePath(kind));
        const tplText = tpl ? await app.vault.read(tpl) : "";
        const templater = tplText.trim() ? notes.templater() : null;
        // Without Templater, the template's text goes in with Plainday's properties, in the one write
        let text = this.noteText(own), unused = false;
        if (tplText.trim() && !templater) {
            if (tplText.includes("<%")) unused = true;
            else text = this.withTemplate(text, notes.fill(tplText, { name, start: moment().format("YYYY-MM-DD") }), own);
        }
        // Templater's trigger is kept off the note from before its folder appears: another plugin can make the
        // folder's note as the folder appears (Folder Notes), and the trigger would template that one
        notes.hold(path);
        await this.makeFolders(folder);
        let file;
        try {
            file = await app.vault.create(path, text);
        } catch (e) {
            // Another plugin made the folder's note as the folder appeared: Plainday's properties go into it
            file = app.vault.getFileByPath(path);
            if (!file) throw e;
        }
        // That plugin's empty write can also land after Plainday's: either way, what's there gets what's missing
        await this.fillIn(file, text);
        notes.hold(file.path);
        if (templater) await this.withTemplater(templater, tpl, file, own);
        if (unused) new Notice(`${tpl.basename} holds Templater code and Templater is off, so the new ${kind} was made without it.`);
        await this.takeCursor(file);
        try {
            await this.look(file, kind);
        } catch (e) {
            console.error(`ProjectNotes: couldn't give ${folder} its look in Notebook Navigator`, e);
        }
        return file;
    }

    // The template a project or an area is made with, as Settings → Plainday → Note templates has it; blank means
    // Project.md or Area.md in the vault's template folder (Templater's), else at the top of the vault
    templatePath(kind) {
        return plainday.Settings.get().templates[kind] || plainday.Settings.defaultTemplatePath(kind);
    }

    // Plainday's properties for a new project or area, in the Project template's order: { key: value }
    own(kind, name, { start = "", due = "" } = {}) {
        const k = ProjectNotes.KINDS[kind];
        const props = { aliases: [`${k.mark}${name}`], tags: [k.tag] };
        if (kind !== "project") return props;
        return {
            ...props, status: "To Do", parent: "", start, due, who: "", client: "", bill_to: "", rate: "", rate_type: "", max_hours: "",
            include_subprojects: false,
        };
    }

    // A note's text from its properties, in their order, and `body`. An empty value is a bare key, as the old
    // templates wrote one, and a date stays bare, as Obsidian writes it.
    noteText(props, body = "") {
        const empty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
        const lines = ["---"];
        for (const [key, value] of Object.entries(props)) {
            if (empty(value)) lines.push(`${key}:`);
            else if (Array.isArray(value)) lines.push(`${key}:`, ...value.map((v) => `  - ${this.scalar(v)}`));
            else if (typeof value === "object") lines.push(stringifyYaml({ [key]: value }).replace(/\n$/, ""));
            else lines.push(`${key}: ${this.scalar(value)}`);
        }
        return `${lines.join("\n")}\n---\n${body}`;
    }

    scalar(value) {
        if (typeof value !== "string") return String(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : plainday.PeriodicNotes.scalar(value);
    }

    // `text` with a template's text, `filled`, added, without Templater: the properties combined as
    // PeriodicNotes.merge combines them (a template's value fills or replaces Plainday's, lists keep both), then
    // Plainday's own values put back (ownValues), in Plainday's order with the template's other properties after
    withTemplate(text, filled, own) {
        const notes = plainday.PeriodicNotes;
        const { props, body } = notes.parts(notes.merge(text, filled));
        const fixed = this.ownValues(props ?? {}, own);
        const ordered = {};
        for (const key of Object.keys(own)) ordered[key] = fixed[key];
        for (const [key, value] of Object.entries(fixed)) if (!(key in ordered)) ordered[key] = value;
        return this.noteText(ordered, body);
    }

    // `props` with Plainday's own values kept: its alias first, its tag, the name's `start` and `due`, and any
    // value of Plainday's a template left empty
    ownValues(props, own) {
        const out = { ...props };
        const list = (v) => [].concat(v ?? []).filter((x) => x !== null && x !== "").map(String);
        const alias = own.aliases[0], tag = own.tags[0];
        out.aliases = [alias, ...list(out.aliases).filter((a) => a !== alias)];
        const tags = list(out.tags);
        out.tags = tags.some((t) => t.toLowerCase() === tag) ? tags : [tag, ...tags];
        for (const [key, value] of Object.entries(own)) {
            if (key === "aliases" || key === "tags") continue;
            const blank = out[key] === null || out[key] === undefined || out[key] === "";
            if (blank && value !== "") out[key] = value;
        }
        for (const key of ["start", "due"]) if (own[key]) out[key] = own[key];
        return out;
    }

    // What's in `file` gets what `wanted` (the text Plainday wrote) has and it lacks: the properties it doesn't
    // have, or has empty, and the body when its own is empty. Nothing there is replaced. A note another plugin made
    // first (Folder Notes, as the folder appeared) gets Plainday's properties this way.
    async fillIn(file, wanted) {
        const notes = plainday.PeriodicNotes;
        const now = await app.vault.read(file);
        if (now === wanted) return;
        const have = notes.parts(now), want = notes.parts(wanted);
        const props = { ...(want.props ?? {}) };
        for (const [key, value] of Object.entries(have.props ?? {})) {
            const blank = value === null || value === undefined || value === "";
            if (Array.isArray(props[key]) || Array.isArray(value)) props[key] = [...new Set([...[].concat(props[key] ?? []), ...[].concat(value ?? [])].filter((v) => v !== null && v !== ""))];
            else if (!blank || !(key in props)) props[key] = value;
        }
        const body = have.body.trim() ? have.body : want.body;
        const text = this.noteText(props, body);
        if (text !== now) await app.vault.process(file, () => text);
    }

    // The template run on the new note through Templater, which adds the template's properties to Plainday's and its
    // text after them; then Plainday's own values again where the template changed them (ownValues)
    async withTemplater(templater, tpl, file, own) {
        const notes = plainday.PeriodicNotes;
        await templater.write_template_to_file(tpl, file);
        // Templater lets go of the note when it's done; the trigger mustn't take it then
        notes.hold(file.path);
        const front = notes.parts(await app.vault.read(file)).props ?? {};
        const fixed = this.ownValues(front, own);
        const same = (key) => JSON.stringify(front[key] ?? null) === JSON.stringify(fixed[key] ?? null);
        const changed = Object.keys(fixed).filter((key) => !same(key));
        if (!changed.length) return;
        await app.fileManager.processFrontMatter(file, (f) => {
            for (const key of changed) f[key] = fixed[key] === "" ? null : fixed[key];
        });
    }

    // Takes a template's cursor markers out of the note and remembers where the first one was (the lowest
    // number, then the first in the text), for open()
    async takeCursor(file) {
        const text = await app.vault.read(file);
        const marks = [...text.matchAll(ProjectNotes.CURSOR)];
        if (!marks.length) return;
        const first = [...marks].sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0) || a.index - b.index)[0];
        const offset = first.index - marks.filter((m) => m.index < first.index).reduce((n, m) => n + m[0].length, 0);
        await app.vault.process(file, (now) => now.replace(ProjectNotes.CURSOR, ""));
        this.cursorAt = { path: file.path, offset };
    }

    // Makes the folders `path` needs, one at a time
    async makeFolders(path) {
        let at = "";
        for (const part of path.split("/")) {
            at = at ? `${at}/${part}` : part;
            if (app.vault.getFolderByPath(at)) continue;
            try {
                await app.vault.createFolder(at);
            } catch (e) {
                if (!app.vault.getFolderByPath(at)) throw e;
            }
        }
    }

    // ---------------------------------------------------------------- its look in Notebook Navigator (OBS-142)

    // The new folder gets the look Navigator gives the kind's tag, else a red circle for a project or a green
    // archive for an area, unless it has a look already. Navigator keeps it where its settings say: in its own
    // settings, or with "Use frontmatter metadata" on, in the folder note's icon and color. The note is pinned in its
    // folder when Navigator's "Pin created folder notes" is on, as Navigator does for a folder note it makes itself.
    // Without Navigator nothing happens. `navigator` is the Notebook Navigator plugin, if installed.
    async look(file, kind, navigator = app.plugins?.getPlugin?.("notebook-navigator")) {
        const metadata = navigator?.api?.metadata;
        const folder = file?.parent;
        const tag = ProjectNotes.KINDS[kind]?.tag ?? kind;
        // Only a folder note: the note named like its folder
        if (!metadata || !folder || folder.path === "/" || file.basename !== folder.name) return;
        if (metadata.setFolderMeta && !metadata.getFolderMeta?.(folder)) {
            // The tag's own look wins; a tag with none gets the system's
            const look = metadata.getTagMeta?.(tag) ?? {};
            let meta = {};
            for (const key of ["icon", "color", "backgroundColor"]) if (look[key]) meta[key] = look[key];
            if (!Object.keys(meta).length) meta = { ...ProjectNotes.LOOKS[tag] };
            if (Object.keys(meta).length) await metadata.setFolderMeta(folder, meta);
        }
        const settings = navigator.settings;
        if (settings?.enableFolderNotes && settings?.pinCreatedFolderNote && metadata.pin && !metadata.isPinned?.(file, "folder")) {
            await metadata.pin(file, "folder");
        }
    }

    // ---------------------------------------------------------------- the commands' side

    // New project and New area: asks for a name, makes it, and opens its note
    async create(kind) {
        const typed = await this.ask(kind);
        if (typed === null) return null;
        const file = await this.make({ kind, name: typed });
        await this.open(file);
        return file;
    }

    // The name box: resolves to a name that can be used, as typed, or null when it's closed. A name that can't be
    // used keeps the box open with the name in it and a line saying why (problem()). `value` is the name to start
    // with, and `reason` the line to show at once (Convert to project's selection, and why it can't be used).
    ask(kind, value = "", reason = "") {
        const k = ProjectNotes.KINDS[kind];
        return new Promise((resolve) => {
            let answer = null;
            const modal = new (class extends Modal {
                onClose() { setTimeout(() => resolve(answer), 0); }
                // Focused once the modal is open, not straight after open(), so the hotkey's key doesn't land in the
                // note (OBS-50)
                onOpen() { requestAnimationFrame(() => { input.inputEl.focus(); input.inputEl.select(); }); }
            })(app);
            modal.titleEl.setText(k.title);
            const input = new TextComponent(modal.contentEl).setPlaceholder(kind === "project" ? "Project name, and a start and due date if you like" : "Area name").setValue(value);
            input.inputEl.addClass("plainday-wide-input");
            const why = modal.contentEl.createDiv({ cls: "setting-item-description plainday-caution plainday-name-problem" });
            const accept = () => {
                const typed = input.getValue().trim();
                const problem = this.problem(typed, kind);
                if (problem) {
                    why.setText(problem);
                    input.inputEl.focus();
                    input.inputEl.select();
                    return;
                }
                answer = typed;
                modal.close();
            };
            if (reason) why.setText(reason);
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            new ButtonComponent(row).setButtonText("Cancel").onClick(() => modal.close());
            new ButtonComponent(row).setButtonText(`Make ${k.word}`).setCta().onClick(accept);
            modal.scope.register([], "Enter", () => { accept(); return false; });
            modal.open();
        });
    }

    // Opens the new note once the metadata cache has read it, so its properties show (OBS-177), with the cursor
    // where its template's marker was, else at the end of its body, below the properties
    async open(file) {
        await this.read(file);
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { state: { mode: "source" }, eState: { focus: true } });
        const at = this.cursorAt?.path === file.path ? this.cursorAt.offset : null;
        this.cursorAt = null;
        const place = () => {
            const editor = app.workspace.activeEditor?.editor;
            if (!editor || app.workspace.getActiveFile() !== file) return;
            editor.focus();
            if (at !== null) editor.setCursor(editor.offsetToPos(at));
            else {
                const last = editor.lastLine();
                editor.setCursor({ line: last, ch: editor.getLine(last).length });
            }
        };
        place();
        // Obsidian can put the cursor in the title as the note opens
        setTimeout(place, 300);
    }

    // Resolves once the metadata cache has the note's properties, or after READ_MS
    read(file) {
        if (app.metadataCache.getFileCache(file)?.frontmatter) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => { app.metadataCache.offref(ref); clearTimeout(timer); resolve(); };
            const ref = app.metadataCache.on("changed", (changed) => { if (changed === file || changed?.path === file.path) done(); });
            const timer = setTimeout(done, ProjectNotes.READ_MS);
        });
    }
}
