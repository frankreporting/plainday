class AddTaskNote {
    // "- [ ]", "- [x]", "- [<]", … at the start of a line
    static CHECKBOX = /^\s*[-*+]\s+\[(.)\] ?/;
    static TASK_TEMPLATE = "00 Meta/01 Templates/Task.md";
    static LOG_TEMPLATE = "00 Meta/01 Templates/Log.md";
    // Where a new task note is made before the Task template's picker files it. The picker only
    // offers folders under Projects/, so a note still here afterwards means the picker was dismissed.
    static STAGING_FOLDER = "10 Inbox";
    static DATE = /\d{4}-\d{2}-\d{2}/g;
    // An event line's time, which comes before its title: "1:00pm\t", "all day\t", or a time with
    // nothing after it (a line with no title)
    static EVENT_TIME = /^(?:all day|\d{1,2}:\d{2}\s?[ap]m)(?:[\t ]+|$)/i;
    // A project link on a task line, [[Project|⭕]], or an area link, [[Area|🗃️]] (a phone may add
    // or drop the U+FE0F, and the calendar sync allows spaces around the emoji)
    static PROJECT_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?\|\s*(?:⭕|🗃)\uFE0F?\s*\]\]/gu;
    // The suffix a home gets on a line: ⭕ for a project, 🗃️ for an area (its Quick Switcher alias)
    static AREA_MARK = "🗃️";
    static PROJECT_MARK = "⭕";
    // A line's link to its own note: a task's note, or an event's meeting log (OBS-57). 🗒️ is
    // written (OBS-87); 🔗, the symbol before it, is still read, and a phone may add or drop the
    // U+FE0F on either.
    static NOTE_MARK = "🗒️";
    static NOTE_LINK = /\[\[[^\]]*\|\s*(?:🗒|🔗)\uFE0F?\s*\]\]/u;
    // An event title wrapped in a link to its log, the way lines were written before OBS-57
    static LOG_TITLE = /^\s*[-*+]\s+\[.\]\s+(?:(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)?\[\[(?:[^\]|#]*\/)?\d{4}-\d{2}-\d{2} /iu;
    // The parent picked in advance for the one note being created ({ path, parent }), read by pickParent
    static preset = null;

    // On a task line: link the task's note, creating it first through the Task template (which asks
    // for its project or area) when there isn't one, then put the cursor right after the checkbox.
    // The name is the selected text or, with nothing selected, the task's text, as long as some text
    // comes after the cursor. With only whitespace after the cursor, insert an empty link to type a
    // name into. On an event line (`- [<]`), link a meeting log named with the daily note's date and
    // the event's title (the selection, or the text after its time), at the end of the line like a
    // task's note (OBS-57), and make the log right away, as a task's note is made (see makeLog).
    async invoke() {
        const editor = app.workspace.activeLeaf?.view?.editor;
        const source = app.workspace.getActiveFile();
        if (!editor || !source) return;

        const selection = editor.getSelection();
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        const lineText = editor.getLine(from.line);

        if (!AddTaskNote.CHECKBOX.test(lineText)) {
            new Notice("Not on a checklist item");
            return;
        }

        if (!selection) {
            const target = this.target(lineText, from.ch);
            if (target.error) {
                new Notice(target.error);
            } else if (target.mode === "blank") {
                const before = /\S/.test(lineText.slice(from.ch - 1, from.ch)) ? " " : "";
                this.insert(editor, from, "", before + `[[|${AddTaskNote.NOTE_MARK}]]` + this.spacer(lineText.slice(from.ch)));
            } else if (target.kind === "event") {
                await this.linkEvent(editor, from.line, lineText, target.name);
            } else {
                const found = await this.noteFor(target.name, source.path, lineText);
                if (!found) return;
                if (editor.getLine(from.line) !== lineText) {
                    new Notice(`${found.note.basename} is ready, but the line changed, so it wasn't linked`);
                    return;
                }
                const linked = this.withoutLinks(this.lineWithLink(lineText, target, found), found.projectLinks);
                editor.replaceRange(linked, { line: from.line, ch: 0 }, { line: from.line, ch: lineText.length });
                editor.setCursor({ line: from.line, ch: this.afterCheckbox(editor.getLine(from.line)) });
            }
            return;
        }

        if (selection.includes("\n")) {
            new Notice(this.isEvent(lineText) ? "Select an event name on one line" : "Select a task name on one line");
            return;
        }

        if (this.isEvent(lineText)) {
            await this.linkEvent(editor, from.line, lineText, selection.trim());
            return;
        }

        const found = await this.noteFor(selection, source.path, lineText);
        if (!found) return;

        // The picker waited on you; don't write into a line that changed in the meantime
        if (editor.getLine(from.line) !== lineText) {
            new Notice(`${found.note.basename} is ready, but the line changed, so it wasn't linked`);
            return;
        }
        const linked = lineText.slice(0, from.ch) + this.taskLink(found.name, found.linktext, lineText.slice(to.ch)) + lineText.slice(to.ch);
        editor.replaceRange(this.withoutLinks(linked, found.projectLinks), { line: from.line, ch: 0 }, { line: from.line, ch: lineText.length });
        editor.setCursor({ line: from.line, ch: this.afterCheckbox(editor.getLine(from.line)) });
    }

    // The task note for `text`, as linked from `sourcePath`. A date in the text is the task's due
    // date, not part of its name: the note is looked up by the name without it, and a new one is made
    // through the Task template from the full text, so the template can set `due`.
    //
    // `lineText` is the whole task line. One link per line says where its time counts: the 🗒️ note
    // filed in its project or area, or a ⭕ (OBS-36), so once the note is linked every ⭕ comes off
    // the line, and the line's ⭕ links decide where the note goes first:
    //   - one project or area linked: a new note is filed there, and an existing note with no
    //     project or area (its nearest folder note) is moved there, without asking;
    //   - several linked: you pick, with the line's projects listed first, and the note is filed or
    //     moved there;
    //   - an existing note already in a different project or area: you're asked to move it there or
    //     leave it (its project is shared by every line that links it); left, the line's time then
    //     counts toward where the note is.
    // A project or area note is never moved. Esc on a menu cancels and nothing changes. An existing
    // note's `area` is then set from its folder (SyncArea's rule).
    //
    // Resolves to { note, linktext, name, created, projectLinks }, where `name` is the text to leave on
    // the line (without its dates) and `projectLinks` the ⭕ link texts to take off it, or null when no
    // note could be made or nothing was picked. Schedule uses this too, so a 🗒️ link it writes always
    // has a note behind it.
    async noteFor(text, sourcePath, lineText = "") {
        const name = this.withoutDates(text);
        const line = this.lineProjects(lineText, sourcePath);
        const existing = app.metadataCache.getFirstLinkpathDest(name, sourcePath);
        let note = existing;
        let movedFrom = null;
        if (existing) {
            const noteHome = this.homeOf(existing);
            if (line.projects.length && !this.isHome(existing) && !line.projects.includes(noteHome)) {
                let home = null;
                if (line.allLive && line.projects.length === 1) {
                    home = line.projects[0];
                } else {
                    home = await this.pickHome(existing.basename, line.projects);
                    if (!home) return this.cancelled();
                }
                const twin = this.sameNameIn(existing, home);
                if (twin) {
                    // The picked home already has a note of that name: link that one, leave this one
                    note = twin;
                    new Notice(`Linked the ${twin.basename} already in ${home.basename}; the one in ${existing.parent?.path || "the vault root"} was left alone`);
                } else if (home !== noteHome) {
                    let choice = "move";
                    if (noteHome) {
                        choice = await this.confirmMove(existing, noteHome, home);
                        if (!choice) return this.cancelled();
                    }
                    movedFrom = existing.path;
                    if (choice === "move" && !(await this.moveInto(existing, home))) return null;
                    if (choice === "leave") new Notice(`${existing.basename} stays in ${noteHome.basename}, which this line's time counts toward`);
                }
            }
            await customJS.SyncArea?.sync?.(note, false);
        } else {
            let home = null;
            if (line.allLive && line.projects.length === 1) {
                home = line.projects[0];
            } else if (line.allLive && line.projects.length > 1) {
                home = await this.pickHome(name, line.projects);
                if (!home) return this.cancelled();
            }
            note = await this.createTaskNote(text, home);
            if (!note) return null;
            new Notice(`Created ${note.path.replace(/\.md$/, "")}`);
        }
        return {
            note, name, created: !existing,
            // A note just moved can still show at its old path for a moment (see isSameNote)
            linktext: this.linktextFor(note, app.vault.getMarkdownFiles().map((f) => f.path).filter((p) => p !== movedFrom)),
            projectLinks: line.links,
        };
    }

    // Whether `file`, a link's target looked up by name, is `note`, which may have just moved from
    // `oldPath`. For a moment after a move the vault can hold a second entry at the old path (seen
    // in a vault with a rename-handling plugin): it's gone within 50ms, but a lookup by name in
    // that moment returns it whenever its path is shorter than the moved note's.
    isSameNote(file, note, oldPath = null) {
        return !!file && (file === note || file.path === note.path || (!!oldPath && file.path === oldPath));
    }

    // The link text for a task note: its name, or its path (without .md) when another note in `paths`
    // has the same name. Decided from the vault's file list, which is current the moment a note is made,
    // moved or trashed. Obsidian's own shortest-link lookup once wrote a full path for a note whose
    // name was unique, seconds after a cancelled attempt had trashed a note of that name.
    linktextFor(note, paths) {
        const name = note.basename.toLowerCase();
        const clash = paths.some((p) => p !== note.path && p.split("/").pop().replace(/\.md$/, "").toLowerCase() === name);
        return clash ? note.path.replace(/\.md$/, "") : note.basename;
    }

    cancelled() {
        new Notice("No project or area picked, so nothing changed");
        return null;
    }

    // Asks whether to move `note` from the project or area `from` into `to`. Resolves to "move",
    // "leave", or null when dismissed (Esc). Enter moves. Laid out as facts, not a sentence: a
    // Task (or Log, Project, Area or Note), From and To row, each project or area with its 🗃️ or ⭕,
    // then one line on what happens to its time. The buttons follow the rows' order: Leave it, then
    // Move. MoveToProject asks for a project or area too, whose `from` can be null (nothing above it).
    confirmMove(note, from, to) {
        const { Modal, ButtonComponent } = customJS.obsidian;
        return new Promise((resolve) => {
            let choice = null;
            const modal = new (class extends Modal {
                onClose() { setTimeout(() => resolve(choice), 0); }
                // Move is the default: focused, so Enter or Space takes it; Tab reaches Leave it.
                // Focused once the modal is open, not straight after open() (OBS-50)
                onOpen() { requestAnimationFrame(() => move.buttonEl.focus()); }
            })(app);
            const pick = (c) => { choice = c; modal.close(); };
            const cache = app.metadataCache.getFileCache(note);
            const tags = cache ? this.tagsOf(cache) : [];
            const kind = this.isLog(note) ? "Log" : tags.includes("task") ? "Task"
                : tags.includes("area") ? "Area" : tags.includes("project") ? "Project" : "Note";
            const mark = (f) => (f ? `${this.isArea(f) ? AddTaskNote.AREA_MARK : AddTaskNote.PROJECT_MARK} ${f.basename}` : "No project or area");
            modal.titleEl.setText(kind === "Task" ? "Move task note?" : `Move ${kind.toLowerCase()}?`);
            const rows = modal.contentEl.createEl("table", { attr: { style: "border-collapse: collapse; margin-bottom: 0.75em;" } });
            for (const [k, v] of [[kind, note.basename], ["From", mark(from)], ["To", mark(to)]]) {
                const tr = rows.createEl("tr");
                tr.createEl("td", { text: k, attr: { style: "padding: 0.15em 1em 0.15em 0; color: var(--text-muted); white-space: nowrap;" } });
                tr.createEl("td", { text: v, attr: { style: "padding: 0.15em 0; font-weight: var(--font-semibold);" } });
            }
            modal.contentEl.createEl("p", { text: kind === "Area" ? "Its time, and its projects', stays their own."
                : kind === "Project" ? "Its time stays its own. Inside another project, it counts toward that project's totals and takes its rate if it has none of its own."
                : "Time entries will be reallocated accordingly." });
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            new ButtonComponent(row).setButtonText("Leave it").onClick(() => pick("leave"));
            const move = new ButtonComponent(row).setButtonText("Move").setCta().onClick(() => pick("move"));
            modal.scope.register([], "Enter", () => { pick("move"); return false; });
            modal.open();
        });
    }

    // The project or area a note sits in: its nearest folder note (Folder/Folder.md) tagged #project
    // or #area, as SyncArea writes `area`; a project or area note is its own home. Null outside any.
    homeOf(file) {
        if (this.isHome(file)) return file;
        for (let dir = file.parent; dir && dir.path !== "/"; dir = dir.parent) {
            const folderNote = app.vault.getFileByPath(`${dir.path}/${dir.name}.md`);
            if (folderNote && this.isHome(folderNote)) return folderNote;
        }
        return null;
    }

    // A task line's ⭕ links: { links: link texts, projects: the distinct live projects or areas they
    // point at, in line order, allLive: every link is one }. Live means tagged #project or #area,
    // under Projects/, and not `completed`.
    lineProjects(lineText, sourcePath) {
        const links = this.projectLinks(lineText);
        const projects = [];
        let allLive = links.length > 0;
        for (const { linkpath } of links) {
            const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
            if (!file || !this.isLiveHome(file)) { allLive = false; continue; }
            if (!projects.includes(file)) projects.push(file);
        }
        return { links: links.map((l) => l.raw), projects, allLive };
    }

    isLiveHome(file) {
        return file.path.startsWith("Projects/") && this.isHome(file);
    }

    // Whether a home note is an area (tagged #area) rather than a project
    isArea(file) {
        const cache = app.metadataCache.getFileCache(file);
        return !!cache && this.tagsOf(cache).includes("area");
    }

    // A meeting log: a note tagged #log, or any note in a `logs` folder. Logs are filed in their
    // project's `logs/`, so one waiting in 10 Inbox still goes there when it's moved.
    isLog(file) {
        if (file.parent?.name?.toLowerCase() === "logs") return true;
        const cache = app.metadataCache.getFileCache(file);
        return !!cache && this.tagsOf(cache).includes("log");
    }

    // The suffix link for a home: [[Project|⭕]] or [[Area|🗃️]], with `linktext` as linktextFor gives it
    homeLink(home, linktext) {
        return `[[${linktext}|${this.isArea(home) ? AddTaskNote.AREA_MARK : AddTaskNote.PROJECT_MARK}]]`;
    }

    // A note's tags as pickParent reads them: frontmatter `tags` or `tag` (list or string) and
    // inline #tags, lowercased, without the #
    tagsOf(cache) {
        const raw = cache.frontmatter?.tags ?? cache.frontmatter?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .concat((cache.tags ?? []).map((t) => t.tag))
            .map((t) => String(t).replace(/^#/, "").toLowerCase());
    }

    // Asks which area or project the note `name` belongs to, with `preferred` (the task line's
    // projects) first, then every other area and project the Task template's picker offers. Resolves
    // to the picked area or project note, or null when dismissed. AddProjectLink and MoveToProject
    // use the same menu; MoveToProject leaves out the ones it can't file into (`exclude(file)` true)
    // and asks its own question (`placeholder`).
    pickHome(name, preferred, { exclude = () => false, placeholder = null } = {}) {
        const { FuzzySuggestModal } = customJS.obsidian;
        const aliasOf = (f) => [].concat(app.metadataCache.getFileCache(f)?.frontmatter?.aliases ?? [])[0] || f.basename;
        const others = app.vault.getMarkdownFiles()
            .filter((f) => f.parent?.path.startsWith("Projects/") && !preferred.includes(f) && this.isHome(f))
            .sort((a, b) => aliasOf(a).localeCompare(aliasOf(b)));
        const items = [...preferred, ...others].filter((f) => !exclude(f));
        return new Promise((resolve) => {
            let picked = null;
            const modal = new (class extends FuzzySuggestModal {
                getItems() { return items; }
                getItemText(f) { return aliasOf(f); }
                onChooseItem(f) { picked = f; }
                // Obsidian closes the modal before it reports the choice
                onClose() { setTimeout(() => resolve(picked), 0); }
            })(app);
            modal.setPlaceholder(placeholder ?? `Which project or area is "${name}" for? (Esc: cancel)`);
            modal.open();
        });
    }

    // An area or project note still in progress (exact #area or #project, as pickParent checks)
    isHome(file) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache || cache.frontmatter?.completed) return false;
        return this.tagsOf(cache).some((t) => t === "area" || t === "project");
    }

    // The note already in `home`'s folder (or its `logs/`, for a log) with the same name as `note`,
    // other than `note` itself; null when there's none. A line whose note has that twin in the picked
    // project is pointed at the twin rather than the move being refused (OBS-36).
    sameNameIn(note, home) {
        const folder = this.isLog(note) ? this.logsFolder(home) : home.parent.path;
        const target = `${folder}/${note.name}`;
        const twin = app.vault.getAbstractFileByPathInsensitive?.(target) ?? app.vault.getAbstractFileByPath(target);
        return twin && twin !== note && twin.extension === "md" ? twin : null;
    }

    // Moves `note` into the folder of `home` (an area or project note), updating links to it; a
    // meeting log (see isLog) goes into that folder's `logs/`, where the Log template files them.
    // False, with a notice, when the target already has a note of the same name.
    async moveInto(note, home) {
        const folder = this.isLog(note) ? this.logsFolder(home) : home.parent.path;
        const target = `${folder}/${note.name}`;
        if (app.vault.getAbstractFileByPathInsensitive?.(target) ?? app.vault.getAbstractFileByPath(target)) {
            new Notice(`${folder} already has a note named ${note.basename}, so nothing changed`);
            return false;
        }
        if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
        await app.fileManager.renameFile(note, target);
        new Notice(`Moved ${note.basename} to ${folder}`);
        return true;
    }

    // The `logs` folder of `home` (an area or project note): the one it has, spelled as it is, or
    // where a new one goes
    logsFolder(home) {
        const path = `${home.parent.path}/logs`;
        return (app.vault.getAbstractFileByPathInsensitive?.(path) ?? app.vault.getAbstractFileByPath(path))?.path ?? path;
    }

    // The ⭕ project and 🗃️ area links on a line: [{ raw, linkpath }]
    projectLinks(lineText) {
        return [...lineText.matchAll(AddTaskNote.PROJECT_LINK)].map((m) => ({ raw: m[0], linkpath: m[1].trim() }));
    }

    // `lineText` with each of `links` taken out, along with one space beside each, so the text
    // around them closes up while spacing elsewhere on the line stays as it is (an event's title
    // must still read as the sync wrote it). The line's indent and checkbox are kept as they are.
    withoutLinks(lineText, links) {
        if (!links?.length) return lineText;
        const head = this.afterCheckbox(lineText);
        let body = lineText.slice(head);
        for (const link of links) body = body.split(` ${link}`).join("").split(`${link} `).join("").split(link).join("");
        return lineText.slice(0, head) + body.trim();
    }

    // For pickParent: the parent picked in advance for the note at `path`, once. Any other note, or a
    // second ask, gets null and the usual menu.
    takePresetParent(path) {
        const preset = AddTaskNote.preset;
        if (!preset || preset.path !== path) return null;
        AddTaskNote.preset = null;
        return preset.parent;
    }

    // "2026-09-30 Renew the domain" → "Renew the domain". Text that's only a date is left alone.
    withoutDates(text) {
        const name = text.replace(AddTaskNote.DATE, " ").replace(/\s+/g, " ").trim();
        return name || text.trim();
    }

    // Runs the Task template on a new note named `name` without opening it. With `parent` (a project
    // or area note), the template files it there without showing its menu. Resolves to the note once the
    // template has filed it, or null when it couldn't be made or the picker was dismissed (the
    // half-made note is then deleted).
    async createTaskNote(name, parent = null) {
        const templater = app.plugins.plugins["templater-obsidian"]?.templater;
        const template = app.vault.getFileByPath(AddTaskNote.TASK_TEMPLATE);
        if (!templater || !template) {
            new Notice("Can't create the note: Templater or the Task template is missing");
            return null;
        }
        // Templater names the note with this same call, so the path matches the note it creates
        const path = app.vault.getAvailablePath(customJS.obsidian.normalizePath(`${AddTaskNote.STAGING_FOLDER}/${name}`), "md");
        AddTaskNote.preset = parent ? { path, parent } : null;
        let note;
        try {
            note = await templater.create_new_note_from_template(template, AddTaskNote.STAGING_FOLDER, name, false);
        } finally {
            AddTaskNote.preset = null;
        }
        if (!note) {
            new Notice(`Couldn't create a note named "${name}"`);
            return null;
        }
        if (note.parent?.path === AddTaskNote.STAGING_FOLDER) {
            await app.fileManager.trashFile(note);
            new Notice("No project or area picked, so no note was created");
            return null;
        }
        return note;
    }

    // With nothing selected, what to link:
    //   { kind, mode: "text", from, to, name }: the task's text (up to its first link), when some text
    //     comes after the cursor; on an event line, its title (after its time), wherever the cursor is
    //   { kind: "task", mode: "blank" }: only whitespace follows the cursor on a task line with no note
    //     link, so insert an empty link to type a name into. An event never gets one: `[[2026-09-14 |🗒️]]` would point
    //     at the daily note itself.
    //   { error }: there's no text to use, or the task already links a note, or the event a log
    // `kind` is "task" or "event".
    target(lineText, ch) {
        const kind = this.isEvent(lineText) ? "event" : "task";
        if (kind === "event" && this.linksLog(lineText)) return { error: "This event already links a log" };
        // Wherever the cursor is: a task with a note never gets a second, blank link
        if (kind === "task" && AddTaskNote.NOTE_LINK.test(lineText)) return { error: "This task already links a note" };
        if (kind === "task" && !/\S/.test(lineText.slice(ch))) return { kind, mode: "blank" };
        let from = this.afterCheckbox(lineText);
        if (kind === "event") from += lineText.slice(from).match(AddTaskNote.EVENT_TIME)?.[0].length ?? 0;
        from += lineText.slice(from).match(/^\s*/)[0].length;
        const link = lineText.indexOf("[[", from);
        let to = link === -1 ? lineText.length : link;
        while (to > from && /\s/.test(lineText[to - 1])) to--;
        // The calendar sync's free mark after an event's title (ℹ️, OBS-47) isn't part of the name,
        // and neither is your 🆓: both stay after the title, before the log link, where the sync
        // expects them
        for (let mark; kind === "event" && (mark = lineText.slice(from, to).match(/\s(?:ℹ|🆓)\uFE0F?$/u));) {
            to -= mark[0].length;
            while (to > from && /\s/.test(lineText[to - 1])) to--;
        }
        if (to === from && kind === "event") return { error: /\S/.test(lineText.slice(from)) ? "This event's title is already a link" : "This event has no title to name its log" };
        if (to === from) return { error: "No task text to name the note" };
        return { kind, mode: "text", from, to, name: lineText.slice(from, to) };
    }

    // The task line once it links its note: the name without its dates where the task text was, any
    // links it already had, then the 🗒️ link, which ends the line
    lineWithLink(lineText, target, found) {
        const text = lineText.slice(0, target.from) + found.name + lineText.slice(target.to);
        return `${text.trimEnd()} [[${found.linktext}|${AddTaskNote.NOTE_MARK}]]`;
    }

    // Links an event line to its meeting log (see eventLine), puts the cursor after the checkbox and
    // makes the log
    async linkEvent(editor, line, lineText, name) {
        const date = this.dailyNoteDate();
        const linked = this.eventLine(lineText, name, date);
        if (linked.error) {
            new Notice(linked.error);
            return;
        }
        editor.replaceRange(linked, { line, ch: 0 }, { line, ch: lineText.length });
        editor.setCursor({ line, ch: this.afterCheckbox(editor.getLine(line)) });
        await this.makeLog(`${date} ${this.logName(name)}`);
    }

    // A log's name from an event's title, as CalNav names them: ": " becomes " - ", a slash or bar
    // becomes "-", and characters a file name can't hold are dropped. The title on the line stays
    // as the calendar wrote it.
    logName(title) {
        return title.replace(/\s*:\s*/g, " - ").replace(/[\\/|]/g, "-").replace(/[*"<>?#^[\]]/g, "")
            .replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
    }

    // Makes the meeting log `name` right away, the way a task's note is made: through the Log
    // template, without opening it, so you stay in the daily note. The template files it in the
    // project the event line's ⭕ or 🗃️ names (and takes that link off the line), or asks; Esc leaves
    // it in 10 Inbox. A log that already has the name is left where it is. The daily note is saved
    // first, so the template reads the line just linked rather than the one on disk.
    async makeLog(name) {
        if (app.metadataCache.getFirstLinkpathDest(name, app.workspace.getActiveFile()?.path ?? "")) return;
        const templater = app.plugins.plugins["templater-obsidian"]?.templater;
        const template = app.vault.getFileByPath(AddTaskNote.LOG_TEMPLATE);
        if (!templater || !template) {
            new Notice("Templater or the Log template is missing, so the log wasn't made: click its link to make it");
            return;
        }
        try {
            await app.workspace.activeLeaf?.view?.save?.();
            await templater.create_new_note_from_template(template, AddTaskNote.STAGING_FOLDER, name, false);
        } catch (e) {
            console.error("AddTaskNote: couldn't make the log", e);
            new Notice(`Couldn't make the log "${name}": click its link to make it`);
        }
    }

    // The event line with a link to its meeting log, `[[date name|🗒️]]`: after the title and its
    // ℹ️ or 🆓, before the ⭕ and 🗃️ links that end the line, as the calendar sync writes it
    // (OBS-57). { error } when the line already links a log.
    eventLine(lineText, name, date) {
        if (this.linksLog(lineText)) return { error: "This event already links a log" };
        let at = lineText.trimEnd().length;
        for (let link; (link = lineText.slice(0, at).match(/\s*\[\[[^\]]*\|\s*(?:⭕|🗃)\uFE0F?\s*\]\]$/u));) at = link.index;
        const rest = lineText.slice(at).trim();
        return `${lineText.slice(0, at).trimEnd()} ${this.eventLink(date, this.logName(name))}${rest ? " " + rest : ""}`;
    }

    // Whether an event line links a log already: a note link, or its title wrapped in a dated link
    linksLog(lineText) {
        return AddTaskNote.NOTE_LINK.test(lineText) || AddTaskNote.LOG_TITLE.test(lineText);
    }

    // Replace the selection with `template`; with nothing selected, put the cursor where the link's name goes
    insert(editor, from, selection, template) {
        if (selection) {
            editor.replaceSelection(template);
        } else {
            const target = { line: from.line, ch: from.ch + template.indexOf("|") };
            editor.transaction({ replaceSelection: template, selection: { from: target } });
        }
    }

    isEvent(lineText) {
        return /^\s*[-*+]\s+\[<\]/.test(lineText);
    }

    // "Task" → "Task [[Task|🗒️]]", linking to `linktext` (the note's name, or its path when the name is
    // ambiguous). The link ends the line, so End then a click (or the open-link key) reaches it; a space
    // follows only when the selection was mid-line and text comes right after it.
    taskLink(selection, linktext, followedBy = "") {
        return `${selection} [[${linktext}|${AddTaskNote.NOTE_MARK}]]${this.spacer(followedBy)}`;
    }

    // " " when `followedBy` starts with something other than whitespace, so a link doesn't run into it
    spacer(followedBy) {
        return /^\S/.test(followedBy) ? " " : "";
    }

    // "Event name" → "[[2026-05-31 Event name|🗒️]]"
    eventLink(date, name) {
        return `[[${date} ${name}|${AddTaskNote.NOTE_MARK}]]`;
    }

    // The column right after a line's checkbox and the space that follows it: "- [ ] |Task"
    afterCheckbox(lineText) {
        const match = lineText.match(AddTaskNote.CHECKBOX);
        return match ? match[0].length : 0;
    }

    // Date from the active note's title (e.g. "2026-05-31"), falling back to today
    dailyNoteDate() {
        const name = app.workspace.getActiveFile()?.basename ?? "";
        const match = name.match(/\d{4}-\d{2}-\d{2}/);
        return match ? match[0] : window.moment().format("YYYY-MM-DD");
    }
}
