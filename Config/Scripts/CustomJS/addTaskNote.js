class AddTaskNote {
    // "- [ ]", "- [x]", "- [<]", … at the start of a line
    static CHECKBOX = /^\s*[-*+]\s+\[(.)\] ?/;
    static TASK_TEMPLATE = "Config/Templates/Task.md";
    static LOG_TEMPLATE = "Config/Templates/Log.md";
    // Where a new task note is made before the Task template files it. A note still here afterwards
    // is unfiled: its line named no project, so it waits here until AddProjectLink or MoveToProject
    // files it (OBS-55).
    static STAGING_FOLDER = "Inbox";
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
    // The `status` values that mean a project or area is finished, lowercased (see isFinished)
    static FINISHED = ["done", "canceled", "cancelled"];
    // A project or area keeps its meeting logs in a folder of their own, `›logs`: the U+203A puts it
    // above the project folders in Notebook Navigator's sort (OBS-164)
    static LOGS_FOLDER = "›logs";
    // Notebook Navigator's icon for a logs folder the system makes (a Lucide name)
    static LOGS_ICON = "history";
    // A line's link to its own note: a task's note, or an event's meeting log (OBS-57). 🗒️ is
    // written (OBS-87); 🔗, the symbol before it, is still read, and a phone may add or drop the
    // U+FE0F on either.
    static NOTE_MARK = "🗒️";
    static NOTE_LINK = /\[\[[^\]]*\|\s*(?:🗒|🔗)\uFE0F?\s*\]\]/u;
    // One item of the run that ends a line, with the spaces before it: a 🗒️ (or 🔗), 🚩, ⭕ or 🗃️ link
    // shaped as the time report reads them (TimeReport.TRAIL_LINK), or the ℹ️ or 🆓 mark (OBS-90)
    static TRAIL_ITEM = /(?<![ ])[ ]*(?:\[\[[^\]|]+\|\s*(?:🚩\uFE0F?\s*\d{1,2}\/\d{1,2}|🗒\uFE0F?|🔗\uFE0F?|⭕\uFE0F?|🗃\uFE0F?)\s*\]\]|(?<=\s)(?:ℹ|🆓)\uFE0F?)$/u;
    // A block ID at the end of a line, ` ^abc123`, with the whitespace before it
    static BLOCK_ID = /\s+\^[A-Za-z0-9-]+$/;
    // An event title wrapped in a link to its log, the way lines were written before OBS-57
    static LOG_TITLE = /^\s*[-*+]\s+\[.\]\s+(?:(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)?\[\[(?:[^\]|#]*\/)?\d{4}-\d{2}-\d{2} /iu;
    // The parent picked in advance for the one note being created ({ path, parent }), read by the
    // Task and Log templates (takePresetParent). Raycast's Open Log Note sets "inbox" as the parent
    static preset = null;

    // On a task line: link the task's note, creating it first through the Task template when there
    // isn't one (filed where the line's ⭕ says, or else in Inbox), then put the cursor right after
    // the checkbox.
    // The name is the selected text or, with nothing selected, the task's text, as long as some text
    // comes after the cursor. With only whitespace after the cursor, insert an empty link to type a
    // name into. The line keeps a link to the note's project or area, before the note link (OBS-90).
    // On an event line (`- [<]`), link a meeting log named with the daily note's date and the event's
    // title (the selection, or the text after its time), at the end of the line like a task's note
    // (OBS-57), and make the log right away, as a task's note is made (see makeLog).
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
                const linked = this.lineWithLink(lineText, target, found);
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

        // A menu may have waited on you; don't write into a line that changed in the meantime
        if (editor.getLine(from.line) !== lineText) {
            new Notice(`${found.note.basename} is ready, but the line changed, so it wasn't linked`);
            return;
        }
        // The selection's own leading and trailing spaces stay, so words don't run together
        let start = from.ch, end = to.ch;
        while (start < end && /\s/.test(lineText[start])) start++;
        while (end > start && /\s/.test(lineText[end - 1])) end--;
        const linked = this.lineWithLink(lineText, { from: start, to: end }, found);
        editor.replaceRange(linked, { line: from.line, ch: 0 }, { line: from.line, ch: lineText.length });
        editor.setCursor({ line: from.line, ch: this.afterCheckbox(editor.getLine(from.line)) });
    }

    // The task note for `text`, as linked from `sourcePath`. A date in the text is the task's due
    // date, not part of its name: the note is looked up by the name without it, and a new one is made
    // through the Task template from the full text, so the template can set `due`.
    //
    // `lineText` is the whole task line. The line and its note agree on where the time counts
    // (OBS-90): the line keeps a ⭕ (or 🗃️) for the note's project or area, next to its 🗒️. The line's
    // ⭕ links decide where the note goes first:
    //   - one project or area linked: a new note is filed there, and an existing note with no
    //     project or area (its nearest folder note) is moved there, without asking;
    //   - several linked: you pick, with the line's projects listed first, and the note is filed or
    //     moved there;
    //   - an existing note already in a different project or area: you're asked to move it there or
    //     leave it (its project is shared by every line that links it); left, the line's ⭕ becomes
    //     the note's project instead.
    // A line with no ⭕ gets one for wherever its note is filed. A new note for such a line goes where
    // the note the line is in belongs (a project's own note, or a task note filed in one: see
    // sourceHome), and otherwise waits in Inbox, unfiled; no menu asks (OBS-55). A project or area
    // note is never moved. Esc on a menu cancels and nothing changes. An existing note's `area` is then set from
    // its folder (SyncArea's rule).
    //
    // Resolves to { note, linktext, name, created, home, homeLink, clear, projectLinks }, where `name`
    // is the text to leave on the line (without its dates), `home` the project or area the line names
    // from now on and `homeLink` its ⭕ or 🗃️ link (both null when there's none to name: the line's
    // own links are then left as they are, unless `clear` says they'd disagree with the note), and
    // `projectLinks` the line's ⭕ link texts, which `homeLink` replaces. Null when no note could be
    // made or a menu was dismissed. Schedule uses this too, so a 🗒️ link it writes always has a note
    // behind it: a task can have its note before it has a home.
    async noteFor(text, sourcePath, lineText = "") {
        const name = this.withoutDates(text);
        const line = this.lineProjects(lineText, sourcePath);
        const existing = app.metadataCache.getFirstLinkpathDest(name, sourcePath);
        let note, home, movedFrom = null, clear = false;
        if (existing) {
            const settled = await this.settle(existing, line);
            if (!settled) return null;
            ({ note, home, movedFrom, clear } = settled);
            await customJS.SyncArea?.sync?.(note, false);
        } else {
            let pick = null;
            if (line.allLive && line.projects.length === 1) {
                pick = line.projects[0];
            } else if (line.allLive && line.projects.length > 1) {
                pick = await this.pickHome(name, line.projects);
                if (!pick) return this.cancelled();
            } else if (!line.links.length) {
                pick = this.sourceHome(sourcePath);
            }
            note = await this.createTaskNote(text, pick);
            if (!note) return null;
            home = this.homeFor(note, pick);
            new Notice(`Created ${note.path.replace(/\.md$/, "")}`);
        }
        const paths = app.vault.getMarkdownFiles().map((f) => f.path);
        return {
            note, name, created: !existing, home, clear,
            // A note just moved can still show at its old path for a moment (see isSameNote)
            linktext: this.linktextFor(note, paths.filter((p) => p !== movedFrom)),
            homeLink: home ? this.homeLink(home, this.linktextFor(home, paths)) : null,
            projectLinks: line.links,
        };
    }

    // Where an existing note settles for a line whose ⭕ links are `line` (lineProjects), as noteFor
    // describes: moved, after asking when it would leave a project or area, or left where it is.
    // Resolves to { note, home, movedFrom, clear }: the note to link (a same-named note already in the
    // picked project or area is linked instead), the project or area the line should name (null:
    // none), the path the note was moved from, and whether the line's own ⭕ links come off even with
    // no home to name (the note was left in a finished project, whose time counts there). Null when a
    // menu was dismissed or the move was refused. A project or area note, and a note MoveToProject
    // never moves (the system, the periodic notes, archived work), is linked where it is, and the
    // line keeps its links. A meeting log goes the same way when an event line links one that exists.
    async settle(existing, line) {
        const none = { note: existing, home: null, movedFrom: null, clear: false };
        if (this.isHomeNote(existing) || customJS.MoveToProject?.kept?.(existing.path)) return none;
        // Where it's filed, a finished project included: its time still counts there
        const noteHome = this.filedIn(existing);
        if (!line.projects.length) return { ...none, home: this.lineHome(existing) };
        if (line.projects.includes(noteHome)) return { ...none, home: noteHome };
        const pick = line.allLive && line.projects.length === 1 ? line.projects[0] : await this.pickHome(existing.basename, line.projects);
        if (!pick) return this.cancelled();
        const twin = this.sameNameIn(existing, pick);
        if (twin) {
            // The picked home already has a note of that name: link that one, leave this one
            new Notice(`Linked the ${twin.basename} already in ${pick.basename}; the one in ${existing.parent?.path || "the vault root"} was left alone`);
            return { note: twin, home: pick, movedFrom: null, clear: false };
        }
        // Already where the pick would put it (a project note that isn't its folder's own note
        // shares its folder with other notes): nothing moves, and the line names the pick
        if (pick === noteHome || existing.parent?.path === this.folderFor(existing, pick)) return { ...none, home: pick };
        if (noteHome) {
            const choice = await this.confirmMove(existing, noteHome, pick);
            if (!choice) return this.cancelled();
            if (choice === "leave") {
                new Notice(`${existing.basename} stays in ${noteHome.basename}, and so does this line's time`);
                return { ...none, home: this.lineHome(existing), clear: true };
            }
        }
        const movedFrom = existing.path;
        if (!(await this.moveInto(existing, pick))) return null;
        return { note: existing, home: this.homeFor(existing, pick), movedFrom, clear: false };
    }

    // The project or area a line names for `note`, filed for `pick` (a picked project or area, or
    // null): `pick` when the note is in the folder the pick files into (a project note that isn't its
    // folder's own note has no folder of its own; AddProjectLink keeps such a link too), else where
    // the note is filed (lineHome).
    homeFor(note, pick = null) {
        return pick && note.parent?.path === this.folderFor(note, pick) ? pick : this.lineHome(note);
    }

    // The folder a note goes into for `home` (an area or project note): its folder, or its logs
    // folder for a meeting log
    folderFor(note, home) {
        return this.isLog(note) ? this.logsFolder(home) : home.parent.path;
    }

    // Whether a note is tagged exactly #project or #area, finished or not
    isHomeNote(file) {
        const cache = app.metadataCache.getFileCache(file);
        return !!cache && this.tagsOf(cache).some((t) => t === "area" || t === "project");
    }

    // The project or area `file` is filed in: the nearest folder note above it tagged #project or
    // #area, finished or not (unlike homeOf), or itself for one of those. Null outside any.
    filedIn(file) {
        if (this.isHomeNote(file)) return file;
        for (let dir = file.parent; dir && dir.path !== "/"; dir = dir.parent) {
            const folderNote = app.vault.getFileByPath(`${dir.path}/${dir.name}.md`);
            if (folderNote && folderNote !== file && this.isHomeNote(folderNote)) return folderNote;
        }
        return null;
    }

    // Where a new note goes when its line names no project or area (OBS-55): the note the line is in,
    // when that's a live project or area's own note, or else the live project or area that note is
    // filed in. That's the project Schedule names on a line sent from that note. Null for a daily
    // note, a note in Inbox, or a finished project.
    sourceHome(sourcePath) {
        const source = sourcePath ? app.vault.getFileByPath(sourcePath) : null;
        if (!source) return null;
        if (this.isHomeNote(source)) return this.isLiveHome(source) ? source : null;
        return this.lineHome(source);
    }

    // The project or area a line that links `note` should name (OBS-90): the one the note is filed
    // in, when that's live. Null when that's a finished project (the report still counts the note's
    // time there, so naming the area above would move it), for a note outside Projects/, and for a
    // project or area note itself.
    lineHome(note) {
        if (this.isHomeNote(note)) return null;
        const home = this.filedIn(note);
        return home && this.isLiveHome(home) ? home : null;
    }

    // `lineText` with `link` ([[Project|⭕]] or [[Area|🗃️]], as homeLink writes it) as its project link
    // and `drop` (links as written) taken off: `link` goes before the first note link in the run of
    // links that ends the line (🗒️, 🚩, ⭕, 🗃️, and the ℹ️ and 🆓 marks among them), or at its end when
    // that run has none, so the 🗒️ stays last (OBS-90). A block ID stays at the very end. With no
    // `link`, only `drop` comes off. Trailing spaces go; an event's tab after its time stays.
    withHome(lineText, link, drop = []) {
        let bare = this.withoutLinks(lineText, drop).replace(/\s+$/, "");
        const block = bare.match(AddTaskNote.BLOCK_ID)?.[0] ?? "";
        bare = bare.slice(0, bare.length - block.length).replace(/\s+$/, "");
        if (!link) return bare + block;
        let at = bare.length, before = null;
        for (let item; (item = bare.slice(0, at).match(AddTaskNote.TRAIL_ITEM));) {
            at = item.index;
            if (AddTaskNote.NOTE_LINK.test(item[0])) before = at;
        }
        if (before === null) return `${bare} ${link}${block}`;
        return `${bare.slice(0, before).replace(/ +$/, "")} ${link} ${bare.slice(before).trim()}${block}`;
    }

    // A line once it links its note (noteFor's `found`): the note's project or area in place of the
    // line's ⭕ links, before the 🗒️. A line whose note has no project or area keeps its own, unless
    // they'd disagree with where the note was left (`clear`).
    homed(lineText, found) {
        return this.withHome(lineText, found.homeLink, found.homeLink || found.clear ? found.projectLinks : []);
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

    // A task line's ⭕ links, the ones that end it (trailingProjectLinks): { links: link texts,
    // projects: the distinct live projects or areas they point at, in line order, allLive: every
    // link is one }. Live means tagged #project or #area, under Projects/, and not finished.
    lineProjects(lineText, sourcePath) {
        const links = this.trailingProjectLinks(lineText);
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

    // A meeting log: a note tagged #log, or any note in a `›logs` folder. Logs are filed in their
    // project's `›logs`, so one waiting in Inbox still goes there when it's moved.
    isLog(file) {
        if (this.isLogsFolderName(file.parent?.name)) return true;
        const cache = app.metadataCache.getFileCache(file);
        return !!cache && this.tagsOf(cache).includes("log");
    }

    // The suffix link for a home: [[Project|⭕]] or [[Area|🗃️]], with `linktext` as linktextFor gives it
    homeLink(home, linktext) {
        return `[[${linktext}|${this.isArea(home) ? AddTaskNote.AREA_MARK : AddTaskNote.PROJECT_MARK}]]`;
    }

    // A note's tags: frontmatter `tags` or `tag` (list or string) and inline #tags, lowercased,
    // without the #
    tagsOf(cache) {
        const raw = cache.frontmatter?.tags ?? cache.frontmatter?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .concat((cache.tags ?? []).map((t) => t.tag))
            .map((t) => String(t).replace(/^#/, "").toLowerCase());
    }

    // Asks which area or project the note `name` belongs to, with `preferred` (the task line's
    // projects) first, then every other live area and project under Projects/. Resolves
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

    // An area or project note still in progress (exact #area or #project, as SyncArea checks)
    isHome(file) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache || this.isFinished(cache)) return false;
        return this.tagsOf(cache).some((t) => t === "area" || t === "project");
    }

    // A project or area is finished when its `status` is Done or Canceled, in any case (Cancelled
    // too). Finished ones drop out of the menus that file and link notes.
    isFinished(cache) {
        return [].concat(cache?.frontmatter?.status ?? [])
            .some((s) => AddTaskNote.FINISHED.includes(String(s).trim().toLowerCase()));
    }

    // The note already in `home`'s folder (or its logs folder, for a log) with the same name as `note`,
    // other than `note` itself; null when there's none. A line whose note has that twin in the picked
    // project is pointed at the twin rather than the move being refused (OBS-36).
    sameNameIn(note, home) {
        const folder = this.isLog(note) ? this.logsFolder(home) : home.parent.path;
        const target = `${folder}/${note.name}`;
        const twin = app.vault.getAbstractFileByPathInsensitive?.(target) ?? app.vault.getAbstractFileByPath(target);
        return twin && twin !== note && twin.extension === "md" ? twin : null;
    }

    // Moves `note` into the folder of `home` (an area or project note), updating links to it; a
    // meeting log (see isLog) goes into that folder's logs folder, where the Log template files them.
    // The other lines that link the note follow it: their ⭕ for where it was becomes `home`'s, as
    // MoveToProject does (OBS-90). `line` is the active editor's line the command is writing itself,
    // which is left to it. False, with a notice, when the target already has a note of the same name.
    async moveInto(note, home, { line = null } = {}) {
        const folder = this.isLog(note) ? this.logsFolder(home) : home.parent.path;
        const target = `${folder}/${note.name}`;
        if (app.vault.getAbstractFileByPathInsensitive?.(target) ?? app.vault.getAbstractFileByPath(target)) {
            new Notice(`${folder} already has a note named ${note.basename}, so nothing changed`);
            return false;
        }
        const mover = customJS.MoveToProject;
        // A ⭕ for a finished project stays on its lines: that time may already be invoiced
        const filed = this.filedIn(note);
        const from = filed && this.isLiveHome(filed) ? filed : null, oldPath = note.path;
        // Collected before the move: Obsidian lists links by the path they point at
        const sources = mover?.linkingNotes?.(note) ?? [];
        await this.makeFolder(folder);
        await app.fileManager.renameFile(note, target);
        let lines = null;
        try {
            lines = await mover?.relinkAll?.(sources, note, from, home, oldPath, { line });
        } catch (e) {
            console.error(`AddTaskNote: couldn't update the lines linking ${note.basename}`, e);
        }
        new Notice(`Moved ${note.basename} to ${folder}${lines ? mover.linesSaid(lines, "it", home) : ""}`);
        return true;
    }

    // Whether a folder's name makes it a logs folder: `›logs`, in any case
    isLogsFolderName(name) {
        return String(name ?? "").toLowerCase() === AddTaskNote.LOGS_FOLDER;
    }

    // The logs folder of `home` (an area or project note); see logsFolderIn
    logsFolder(home) {
        return this.logsFolderIn(home.parent.path);
    }

    // The `›logs` folder in the folder at `parent`: the one it has, spelled as it is, or where a new one goes
    logsFolderIn(parent) {
        const path = `${parent}/${AddTaskNote.LOGS_FOLDER}`;
        return (app.vault.getAbstractFileByPathInsensitive?.(path) ?? app.vault.getAbstractFileByPath(path))?.path ?? path;
    }

    // Makes the folder at `path` unless it's there. A logs folder made this way gets Notebook
    // Navigator's history icon, when Navigator is installed.
    async makeFolder(path) {
        if (app.vault.getAbstractFileByPathInsensitive?.(path) ?? app.vault.getAbstractFileByPath(path)) return;
        const made = await app.vault.createFolder(path);
        if (!this.isLogsFolderName(path.slice(path.lastIndexOf("/") + 1))) return;
        const folder = made?.path ? made : app.vault.getAbstractFileByPath(path);
        const navigator = app.plugins?.plugins?.["notebook-navigator"]?.api?.metadata;
        if (!folder || !navigator?.setFolderMeta) return;
        try {
            await navigator.setFolderMeta(folder, { icon: AddTaskNote.LOGS_ICON });
        } catch (e) {
            console.error(`AddTaskNote: couldn't set ${path}'s icon in Notebook Navigator`, e);
        }
    }

    // The ⭕ project and 🗃️ area links in the run of links that ends a line: [{ raw, linkpath }], in
    // line order. Only these say where the line's time goes (OBS-90); one in the text is its title's.
    trailingProjectLinks(lineText) {
        let bare = lineText.replace(/\s+$/, "");
        bare = bare.slice(0, bare.length - (bare.match(AddTaskNote.BLOCK_ID)?.[0].length ?? 0));
        const out = [];
        let at = bare.length;
        for (let item; (item = bare.slice(0, at).match(AddTaskNote.TRAIL_ITEM));) {
            at = item.index;
            out.unshift(...this.projectLinks(item[0]));
        }
        return out;
    }

    // The ⭕ project and 🗃️ area links on a line: [{ raw, linkpath }]
    projectLinks(lineText) {
        return [...lineText.matchAll(AddTaskNote.PROJECT_LINK)].map((m) => ({ raw: m[0], linkpath: m[1].trim() }));
    }

    // `lineText` with each of `links` taken out, along with one space beside each, so the text
    // around them closes up while spacing elsewhere on the line stays as it is (an event's title
    // must still read as the sync wrote it). Text that touched a link keeps a space from what's on
    // its other side, so `word[[P|⭕]]🆓` doesn't become `word🆓`. The line's indent and checkbox are
    // kept as they are.
    withoutLinks(lineText, links) {
        if (!links?.length) return lineText;
        const head = this.afterCheckbox(lineText);
        let body = lineText.slice(head);
        for (const link of links) {
            for (let at; (at = body.indexOf(link)) !== -1;) {
                let from = at, to = at + link.length;
                if (body[from - 1] === " ") from--;
                else if (body[to] === " ") to++;
                const gap = from > 0 && to < body.length && !/[\s([{]/.test(body[from - 1]) && !/[\s,.;:!?)\]}]/.test(body[to]) ? " " : "";
                body = body.slice(0, from) + gap + body.slice(to);
            }
        }
        return lineText.slice(0, head) + body.trim();
    }

    // For the Task and Log templates: the parent picked in advance for the note at `path`, once. Any
    // other note, a second ask, or Raycast's "inbox" gets null, and the template files the note in
    // Inbox.
    takePresetParent(path) {
        const preset = AddTaskNote.preset;
        if (!preset || preset.path !== path) return null;
        AddTaskNote.preset = null;
        return preset.parent === "inbox" ? null : preset.parent;
    }

    // "2026-09-30 Renew the domain" → "Renew the domain". Text that's only a date is left alone.
    withoutDates(text) {
        const name = text.replace(AddTaskNote.DATE, " ").replace(/\s+/g, " ").trim();
        return name || text.trim();
    }

    // Runs the Task template on a new note named `name` without opening it. With `parent` (a project
    // or area note), the template files it there; without, it stays in Inbox, unfiled. Resolves to the
    // note once the template has filed it, or null when it couldn't be made.
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
        // A block ID at the end isn't part of the name
        const stop = lineText.replace(/\s+$/, "").replace(AddTaskNote.BLOCK_ID, "").length;
        let to = Math.max(from, link === -1 ? stop : Math.min(link, stop));
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

    // The task line once it links its note: the name without its dates where the task text (or the
    // selection) was, the note's project or area (see homed), then the 🗒️ link, which ends the line
    lineWithLink(lineText, target, found) {
        const text = lineText.slice(0, target.from) + found.name + lineText.slice(target.to);
        return this.endWith(this.homed(text, found), `[[${found.linktext}|${AddTaskNote.NOTE_MARK}]]`);
    }

    // The target of the note link in the run of links that ends `lineText` (the first, when there are
    // several), or null when that run has none
    trailingNote(lineText) {
        let bare = lineText.replace(/\s+$/, "");
        bare = bare.slice(0, bare.length - (bare.match(AddTaskNote.BLOCK_ID)?.[0].length ?? 0));
        let at = bare.length, note = null;
        for (let item; (item = bare.slice(0, at).match(AddTaskNote.TRAIL_ITEM));) {
            at = item.index;
            if (AddTaskNote.NOTE_LINK.test(item[0])) note = item[0].trim();
        }
        return note?.match(/^\[\[([^\]|#^]*)/)?.[1].trim() || null;
    }

    // `lineText` with `link` at its end, before a block ID if it ends in one
    endWith(lineText, link) {
        const bare = lineText.replace(/\s+$/, "");
        const block = bare.match(AddTaskNote.BLOCK_ID)?.[0] ?? "";
        return `${bare.slice(0, bare.length - block.length).replace(/\s+$/, "")} ${link}${block}`;
    }

    // Links an event line to its meeting log (see eventLine) and puts the cursor after the checkbox.
    // A new log is made (makeLog), and the Log template files it where the line's ⭕ says. A log that
    // exists already is settled the way a task's note is (settle): moved to the line's project, or the
    // line's ⭕ set to where it's filed, so the two agree (OBS-90).
    async linkEvent(editor, line, lineText, name) {
        const sourcePath = app.workspace.getActiveFile()?.path ?? "";
        const date = this.dailyNoteDate();
        const logName = `${date} ${this.logName(name)}`;
        const fresh = this.eventLine(lineText, name, date);
        if (fresh.error) {
            new Notice(fresh.error);
            return;
        }
        const existing = app.metadataCache.getFirstLinkpathDest(logName, sourcePath);
        if (!existing) {
            editor.replaceRange(fresh, { line, ch: 0 }, { line, ch: lineText.length });
            editor.setCursor({ line, ch: this.afterCheckbox(editor.getLine(line)) });
            await this.makeLog(logName);
            return;
        }
        const settled = await this.settle(existing, this.lineProjects(lineText, sourcePath));
        if (!settled) return;
        await customJS.SyncArea?.sync?.(settled.note, false);
        // The menus waited on you; don't write into a line that changed in the meantime
        if (editor.getLine(line) !== lineText) {
            new Notice(`${settled.note.basename} is ready, but the line changed, so it wasn't linked`);
            return;
        }
        const paths = app.vault.getMarkdownFiles().map((f) => f.path);
        const linktext = this.linktextFor(settled.note, paths.filter((p) => p !== settled.movedFrom));
        const linked = this.eventLine(lineText, name, date, linktext);
        const home = settled.home ? this.homeLink(settled.home, this.linktextFor(settled.home, paths)) : null;
        const drop = home || settled.clear ? this.trailingProjectLinks(linked).map((l) => l.raw) : [];
        editor.replaceRange(this.withHome(linked, home, drop), { line, ch: 0 }, { line, ch: lineText.length });
        editor.setCursor({ line, ch: this.afterCheckbox(editor.getLine(line)) });
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
    // project the event line's ⭕ or 🗃️ names, or else leaves it in Inbox with no menu (OBS-55). A
    // log that already has the name is left where it is. The daily note is saved
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

    // The event line with a link to its meeting log, `[[date name|🗒️]]` (or `[[linktext|🗒️]]`): at
    // the end, after the title, its ℹ️ or 🆓 and any ⭕ or 🗃️ links, so the note link ends the line
    // (OBS-90) and the calendar sync reads it (OBS-57). { error } when the line already links a log.
    eventLine(lineText, name, date, linktext = null) {
        if (this.linksLog(lineText)) return { error: "This event already links a log" };
        const link = linktext ? `[[${linktext}|${AddTaskNote.NOTE_MARK}]]` : this.eventLink(date, this.logName(name));
        return this.endWith(lineText, link);
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
