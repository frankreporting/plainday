class MoveToProject {
    // What this command never moves: the system, the daily and other periodic notes, and archived
    // work (its time is out of the reports and usually invoiced; bring it back by hand)
    static KEEP = ["Config/", "Reference/Planner/", "Archive/"];

    // Moves the note you're on into a project or area picked from the menu AddProjectLink uses, or,
    // when Notebook Navigator's pane has the focus, the notes selected there. Where each one goes:
    //   - a meeting log (see AddTaskNote.isLog) into the project's `›logs`, made if missing;
    //   - a project or area's folder note: the whole folder, sub-projects and logs included;
    //   - anything else into the project's folder.
    // Obsidian's move updates links, and SyncArea sets `area`; this never writes `area` itself.
    //
    // Moving one thing asks first (AddTaskNote.confirmMove) when a note leaves a project or area,
    // since every line that links it follows it, and whenever a project or area moves, since its
    // parent's totals and any rate it inherits change. Moving several at once doesn't ask.
    //
    // The lines that link a moved note follow it (OBS-90): a ⭕ or 🗃️ for the project it left becomes
    // the new one's, and a line with none gets one, so each line and its note keep agreeing. A ⭕ for
    // anywhere else is the line's own choice and stays; the notice says how many lines kept one. A
    // moved project's notes keep their project, so their lines are left alone.
    //
    // It refuses, with a notice, a move whose target already has a note or folder of that name, one
    // already where it would go, and a folder into itself; the menu leaves out the projects inside a
    // folder being moved. MoveToProjectMenu puts the same move in the file menus.
    async invoke() {
        const files = this.selected();
        if (!files.length) {
            new Notice("Open a note to move, or select notes in Notebook Navigator");
            return;
        }
        await this.move(files);
    }

    // What to move: Notebook Navigator's selected notes while its pane has the focus, else the note
    // you're on
    selected() {
        if (app.workspace.activeLeaf?.view?.getViewType?.() === "notebook-navigator") {
            const files = app.plugins.plugins["notebook-navigator"]?.api?.selection?.getCurrent?.()?.files ?? [];
            if (files.length) return files;
        }
        const file = app.workspace.getActiveFile();
        return file ? [file] : [];
    }

    // Whether any of `files` is something this command moves, for the file menus. A link's menu
    // offers it for notes only: a slip there shouldn't be one pick away from moving a whole project.
    movable(files, { homes = true } = {}) {
        return files.some((f) => {
            const item = this.itemFor(f);
            return item && !this.kept(item.path) && (homes || !item.home);
        });
    }

    // Moves `files` (notes, and projects or areas as their folders) into a project or area picked
    // from the menu
    async move(files) {
        const helper = customJS.AddTaskNote;
        if (!helper) return;
        const items = [];
        const told = [];
        const tell = () => { if (told.length) new Notice(told.join("\n")); };
        for (const f of files) {
            const item = this.itemFor(f);
            if (!item) told.push(`${f.name} isn't a project or area folder, so it wasn't moved`);
            else if (this.kept(item.path)) told.push(`${item.label} stays where it is: nothing in ${MoveToProject.KEEP.map((p) => p.slice(0, -1).split("/").pop()).join(", ").replace(/, (?=[^,]*$)/, " or ")} is moved`);
            else if (!items.some((i) => i.path === item.path)) items.push(item);
        }
        if (!items.length) return tell();

        const folders = items.filter((i) => i.folder).map((i) => i.path);
        const notesOnly = items.every((i) => !i.home && i.file.extension === "md");
        const label = items.length === 1 ? items[0].label : `${items.length} ${notesOnly ? "notes" : "items"}`;
        // A project note without a folder of its own has nowhere to put a note, and a folder can't
        // go into itself
        const home = await helper.pickHome(label, [], {
            exclude: (f) => !this.isFolderNote(f) || this.inside(f.path, folders),
            placeholder: `Move "${label}" to which project or area? (Esc: cancel)`,
        });
        if (!home) {
            tell();
            return helper.cancelled();
        }

        const into = home.parent.path;
        const moved = [];
        const lines = { relinked: 0, kept: 0, keptIn: [] };
        for (const step of this.plan(items, into, (p) => this.exists(p), helper.logsFolder(home))) {
            if (step.skip === "inside") continue;
            if (step.skip) { told.push(this.why(step, home)); continue; }
            const result = await this.moveOne(step, home, into, items.length === 1);
            if (result.cancelled) {
                tell();
                new Notice("Nothing was moved");
                return;
            }
            if (result.told) told.push(result.told);
            if (!result.moved) continue;
            moved.push(step);
            lines.relinked += result.relinked ?? 0;
            lines.kept += result.kept ?? 0;
            for (const f of result.keptIn ?? []) if (!lines.keptIn.includes(f)) lines.keptIn.push(f);
        }
        if (moved.length) new Notice(this.summary(moved, home, lines));
        tell();
    }

    // One thing to move, or null for a folder that isn't a project or area's:
    //   { file, note (a project or area's own note), path, name, label, folder: it moves as its
    //     folder, home: it's a project or area, log, from: the project or area it's in now (for a
    //     project or area, the one above it), homeFolder: that one's folder }
    itemFor(f) {
        const helper = customJS.AddTaskNote;
        if (f.children) {
            const note = app.vault.getFileByPath(`${f.path}/${f.name}.md`);
            if (!note || !this.isHomeNote(note)) return null;
            const from = this.homeAbove(f);
            return { file: f, note, path: f.path, name: f.name, label: f.name, folder: true, home: true, log: false, from, homeFolder: from?.parent?.path ?? null };
        }
        if (this.isFolderNote(f)) return this.itemFor(f.parent);
        const md = f.extension === "md";
        const from = this.homeAbove(f);
        return {
            file: f, note: f, path: f.path, name: f.name, label: md ? f.basename : f.name, folder: false,
            home: md && this.isHomeNote(f), log: md && helper.isLog(f), from, homeFolder: from?.parent?.path ?? null,
        };
    }

    // The project or area above `file` (a note, or a folder): the nearest folder note tagged
    // #project or #area, not finished, in the folders above it. Null outside any.
    homeAbove(file) {
        const helper = customJS.AddTaskNote;
        for (let dir = file.parent; dir && dir.path !== "/"; dir = dir.parent) {
            const note = app.vault.getFileByPath(`${dir.path}/${dir.name}.md`);
            if (note && note !== file && helper.isHome(note)) return note;
        }
        return null;
    }

    // A project or area's folder note (Folder/Folder.md, tagged exactly #project or #area),
    // finished or not: moving it moves its folder
    isFolderNote(file) {
        return file.extension === "md" && !!file.parent && file.basename === file.parent.name && this.isHomeNote(file);
    }

    isHomeNote(file) {
        const cache = app.metadataCache.getFileCache(file);
        return !!cache && customJS.AddTaskNote.tagsOf(cache).some((t) => t === "project" || t === "area");
    }

    kept(path) {
        return MoveToProject.KEEP.some((p) => path.startsWith(p));
    }

    // Whether `path` is inside any of `folders`
    inside(path, folders) {
        return folders.some((f) => path.startsWith(`${f}/`));
    }

    exists(path) {
        return !!(app.vault.getAbstractFileByPathInsensitive?.(path) ?? app.vault.getAbstractFileByPath(path));
    }

    // Where each of `items` goes in `into` (the picked project or area's folder; `logs` is its logs
    // folder, AddTaskNote.logsFolderIn), in order: [{ ...item, into, to, skip }]. `skip` is null
    // to move it, or why not:
    //   "inside": it's in a folder that's moving too, and goes along with it;
    //   "loop": a folder into itself or one of its own folders;
    //   "here": already there (a note already in that project or area, a log anywhere in its
    //     `›logs`, a folder already in that folder, anything already at the very path);
    //   "clash": something of that name is there already (`exists`, any case), or another item in
    //     this move is going there.
    plan(items, into, exists, logs = customJS.AddTaskNote.logsFolderIn(into)) {
        const folders = items.filter((i) => i.folder).map((i) => i.path);
        const parentOf = (path) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));
        const under = (path, folder) => path.toLowerCase().startsWith(`${folder.toLowerCase()}/`);
        const claimed = new Set();
        return items.map((item) => {
            const to = `${item.log ? logs : into}/${item.name}`;
            let skip = null;
            if (this.inside(item.path, folders.filter((f) => f !== item.path))) skip = "inside";
            else if (item.folder && (into === item.path || into.startsWith(`${item.path}/`))) skip = "loop";
            else if (to.toLowerCase() === item.path.toLowerCase()
                || (item.folder ? parentOf(item.path) === into : item.homeFolder === into && (!item.log || under(item.path, logs)))) skip = "here";
            else if (claimed.has(to.toLowerCase()) || exists(to)) skip = "clash";
            if (!skip) claimed.add(to.toLowerCase());
            return { ...item, into, to, skip };
        });
    }

    // The notice for a step `plan` skipped
    why(step, home) {
        const where = step.to.slice(0, step.to.lastIndexOf("/"));
        if (step.skip === "loop") return `${home.basename} is inside ${step.label}, so ${step.label} can't move there`;
        if (step.skip === "here") return `${step.label} is already in ${home.basename}`;
        return `${where} already has a ${step.folder ? "folder" : "note"} named ${step.label}, so it wasn't moved`;
    }

    // Moves one thing, asking first (when `ask`) if a note leaves a project or area or a project or
    // area moves at all; then, for a note, sets the ⭕ on the lines that link it to where it went
    // (relinkAll). Resolves to { moved, relinked, kept, keptIn, told, cancelled }.
    async moveOne(step, home, into, ask) {
        const helper = customJS.AddTaskNote;
        const { file, from } = step;
        if (ask && (step.home || (from && from !== home))) {
            const choice = await helper.confirmMove(step.note, from, home);
            if (!choice) return { cancelled: true };
            if (choice === "leave") return { told: `${step.label} stays ${from ? `in ${from.basename}` : "where it is"}, so nothing changed` };
        }
        // The menus waited on you: check again
        if (app.vault.getAbstractFileByPath(step.path) !== file || app.vault.getAbstractFileByPath(home.path) !== home || home.parent?.path !== into) {
            return { told: `${step.label} or ${home.basename} moved meanwhile, so ${step.label} wasn't moved` };
        }
        if (this.exists(step.to)) return { told: this.why({ ...step, skip: "clash" }, home) };
        // Collected before the move: Obsidian lists links by the path they point at
        const sources = step.home || file.extension !== "md" ? [] : this.linkingNotes(file);
        const folder = step.to.slice(0, step.to.lastIndexOf("/"));
        if (!this.exists(folder)) await helper.makeFolder(folder);
        await app.fileManager.renameFile(file, step.to);
        return { moved: true, ...(await this.relinkAll(sources, file, from, home, step.path)) };
    }

    // The notes that link `note`, other than itself
    linkingNotes(note) {
        return Object.entries(app.metadataCache.resolvedLinks ?? {})
            .filter(([path, links]) => path !== note.path && links?.[note.path])
            .map(([path]) => app.vault.getFileByPath(path))
            .filter((f) => f?.extension === "md");
    }

    // After `note` moved from the project or area `from` (null: none) into `home`, from `oldPath`: the
    // lines in `sources` (the notes that linked it, collected before the move) that link it get their
    // ⭕ set to `home` (relinkStale). The note in the active editor is changed through the editor,
    // except its line `line`, which the command that moved the note writes itself; the others
    // through the vault. AddTaskNote.moveInto uses this too, so every command's move does it
    // (OBS-90). Resolves to { relinked, kept, keptIn } (see relinkStale), summed over the notes.
    async relinkAll(sources, note, from, home, oldPath = null, { line = null } = {}) {
        const helper = customJS.AddTaskNote;
        const lines = { relinked: 0, kept: 0, keptIn: [] };
        if (!sources.length) return lines;
        const link = helper.homeLink(home, helper.linktextFor(home, app.vault.getMarkdownFiles().map((f) => f.path)));
        const view = app.workspace.activeLeaf?.view;
        const changed = [];
        for (const source of sources) {
            try {
                const editor = view?.file?.path === source.path ? view.editor : null;
                const out = editor
                    ? this.relinkEditor(editor, source, note, from, home, link, oldPath, line)
                    : await this.relinkIn(source, note, from, home, link, oldPath);
                lines.relinked += out.relinked;
                lines.kept += out.kept;
                for (const f of out.keptIn) if (!lines.keptIn.includes(f)) lines.keptIn.push(f);
                if (out.relinked) changed.push(source.path);
            } catch (e) {
                console.error(`MoveToProject: couldn't update the lines in ${source.path}`, e);
            }
        }
        if (changed.length) console.info(`MoveToProject: set the ⭕ to ${home.basename} on lines linking ${note.basename} in`, changed);
        return lines;
    }

    // relinkStale on `source`, writing the note only when something changes. Resolves to its counts.
    async relinkIn(source, note, from, home, link, oldPath = null) {
        const args = { note, from, home, link, oldPath, resolve: (linkpath) => app.metadataCache.getFirstLinkpathDest(linkpath, source.path) };
        const dry = this.relinkStale(await app.vault.read(source), args);
        if (!dry.relinked) return dry;
        let out = dry;
        await app.vault.process(source, (text) => {
            out = this.relinkStale(text, args);
            return out.text;
        });
        // A daily note's fold snapshot, taken again: RefoldOnOpen matches items by text, and would
        // otherwise read the changed line as new and fold it, though you'd left it open
        try {
            await customJS.RefoldDailyNotes?.onLeave?.(source);
        } catch (e) {
            console.error(`MoveToProject: couldn't snapshot the folds of ${source.path}`, e);
        }
        return out;
    }

    // relinkStale on the note open in `editor`, changing only the lines that change (never line
    // `skip`), so the editor keeps its cursor and folds. Returns its counts.
    relinkEditor(editor, source, note, from, home, link, oldPath = null, skip = null) {
        const before = editor.getValue().split("\n");
        const out = this.relinkStale(before.join("\n"), {
            note, from, home, link, oldPath, skip,
            resolve: (linkpath) => app.metadataCache.getFirstLinkpathDest(linkpath, source.path),
        });
        const after = out.text.split("\n");
        for (let i = 0; i < before.length; i++) {
            if (after[i] !== before[i]) editor.replaceRange(after[i], { line: i, ch: 0 }, { line: i, ch: before[i].length });
        }
        return out;
    }

    // `text` with the ⭕ on every checklist line whose note link (its 🗒️, or an event's log link,
    // either way) is `note` set to where the note now is, `home`, whose ⭕ or 🗃️ link is `link`
    // (OBS-90):
    //   - a ⭕ or 🗃️ for `from`, where the note was, becomes `link`, before the 🗒️;
    //   - a line with no ⭕ gets `link`, as a note from the Inbox or no project does;
    //   - a ⭕ for anywhere else (or one that's broken) is that line's own choice and stays, and a
    //     link for `from` beside it just comes off: the line keeps counting where its own links say.
    // Lines are read as the time report reads them: frontmatter and code blocks are skipped, and a
    // comment on a line doesn't count (there a link for `from` comes off only when it's outside the
    // comment and appears once, and nothing is added). Line `skip` is left alone. Only a line's end
    // changes, so the note keeps its line count, its folds and its line endings. `resolve(linkpath)`
    // finds a link's note; a note just moved from `oldPath` can briefly resolve to an entry there,
    // which counts as the note (AddTaskNote.isSameNote). Returns { text, relinked: lines changed,
    // kept: lines that still count their time somewhere other than `home`, keptIn: where those
    // lines' own links point }.
    relinkStale(text, { note, from, home, link, resolve, oldPath = null, skip = null }) {
        const helper = customJS.AddTaskNote;
        const linker = customJS.AddProjectLink;
        const raw = text.split("\n");
        const bare = raw.map((line) => line.replace(/\r$/, ""));
        const shown = customJS.TimeReport?.scan?.(bare);
        let relinked = 0, kept = 0;
        const keptIn = [];
        const out = bare.map((line, i) => {
            const cr = raw[i].endsWith("\r") ? "\r" : "";
            if (i === skip || shown?.hidden[i]) return raw[i];
            const seen = shown ? shown.visible[i] : line;
            if (!helper.constructor.CHECKBOX.test(seen)) return raw[i];
            const linkpath = linker.taskLinkpath(seen);
            if (!linkpath || !helper.isSameNote(resolve(linkpath), note, oldPath)) return raw[i];
            const links = helper.projectLinks(seen).map((l) => ({ ...l, dest: resolve(l.linkpath) }));
            const commented = seen !== line;
            let stale = links.filter((l) => from && from !== home && l.dest === from);
            // With a comment on the line, only a link that can't also be inside it is taken off
            if (commented && !stale.every((l) => line.split(l.raw).length === 2)) stale = [];
            const own = links.filter((l) => l.dest && l.dest !== home && !stale.includes(l));
            if (own.length) kept++;
            for (const l of own) if (!keptIn.includes(l.dest)) keptIn.push(l.dest);
            // The new home's link in place of `from`'s, or on a line with no ⭕ at all; a line whose
            // other ⭕ (or a broken one) is its own choice gets none
            const add = commented ? null : stale.length ? (!own.length && !links.some((l) => l.dest === home) ? link : null) : !links.length ? link : null;
            if (!stale.length && !add) return raw[i];
            const next = helper.withHome(line, add, stale.map((l) => l.raw));
            if (next === line) return raw[i];
            relinked++;
            return next + cr;
        });
        return { text: out.join("\n"), relinked, kept, keptIn };
    }

    // "2 lines linking them now link ⭕ Pinecrest Library Brochure"
    linesNow(count, them, home) {
        const mark = customJS.AddTaskNote.isArea(home) ? "🗃️" : "⭕";
        return `${count === 1 ? `A line linking ${them} now links` : `${count} lines linking ${them} now link`} ${mark} ${home.basename}`;
    }

    // "Moved Printer call to Projects/…/logs", or for several, "Moved 2 notes and 1 folder to
    // Pinecrest Library Brochure"; then what happened to the lines that link them (`relinked`: lines
    // now naming `home`; `keptIn`: where the other lines' own links point)
    summary(moved, home, { relinked, kept, keptIn = [] }) {
        const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
        const them = moved.length === 1 ? "it" : "them";
        let text;
        if (moved.length === 1) {
            const [step] = moved;
            text = `Moved ${step.label}${step.folder ? " with everything in it" : ""} to ${step.to.slice(0, step.to.lastIndexOf("/"))}`;
        } else {
            const folders = moved.filter((s) => s.folder).length;
            const parts = [];
            if (moved.length - folders) parts.push(plural(moved.length - folders, moved.every((s) => s.folder || s.file.extension === "md") ? "note" : "file"));
            if (folders) parts.push(plural(folders, "folder"));
            text = `Moved ${parts.join(" and ")} to ${home.basename}`;
        }
        return text + this.linesSaid({ relinked, kept, keptIn }, them, home);
    }

    // What happened to the lines that link what moved (relinkAll's counts), for a notice:
    // ". 2 lines linking it now link ⭕ Pinecrest. A line linking it has 🗃️ Household too, so …",
    // or "" when there were none. AddTaskNote.moveInto says the same after its moves.
    linesSaid({ relinked = 0, kept = 0, keptIn = [] }, them, home) {
        const helper = customJS.AddTaskNote;
        let text = "";
        if (relinked) text += `. ${this.linesNow(relinked, them, home)}`;
        const marks = (list) => list.map((f) => `${helper.isArea(f) ? "🗃️" : "⭕"} ${f.basename}`).join(", ");
        if (kept) text += `. ${kept === 1 ? `A line linking ${them} has` : `${kept} lines linking ${them} have`} ${marks(keptIn)} too, so ${kept === 1 ? "that line's" : "their"} time still counts there, not in ${home.basename}`;
        return text;
    }
}
