class AddTaskNote {
    // "- [ ]", "- [x]", "- [<]", … at the start of a line
    static CHECKBOX = /^\s*[-*+]\s+\[(.)\] ?/;
    static TASK_TEMPLATE = "00 Meta/01 Templates/Task.md";
    // Where a new task note is made before the Task template's picker files it. The picker only
    // offers folders under Projects/, so a note still here afterwards means the picker was dismissed.
    static STAGING_FOLDER = "10 Inbox";
    static DATE = /\d{4}-\d{2}-\d{2}/g;
    // An event line's time, which comes before its title: "1:00pm\t", "all day\t"
    static EVENT_TIME = /^(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+/i;
    // A project link on a task line: [[Project|⭕]]
    static PROJECT_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?\|⭕\]\]/g;
    // The parent picked in advance for the one note being created ({ path, parent }), read by pickParent
    static preset = null;

    // On a task line: link the task's note, creating it first through the Task template (which asks
    // for its project or area) when there isn't one, then put the cursor right after the checkbox.
    // The name is the selected text or, with nothing selected, the task's text, as long as some text
    // comes after the cursor. With only whitespace after the cursor, insert an empty link to type a
    // name into. On an event line (`- [<]`), link a meeting log named with the daily note's date and
    // the event's title (the selection, or the text after its time).
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
                const template = target.kind === "event"
                    ? before + this.eventLink(this.dailyNoteDate(), "")
                    : before + "[[|🔗]]" + this.spacer(lineText.slice(from.ch));
                this.insert(editor, from, "", template);
            } else if (target.kind === "event") {
                const link = this.eventLink(this.dailyNoteDate(), target.name).trimEnd();
                editor.replaceRange(link, { line: from.line, ch: target.from }, { line: from.line, ch: target.to });
                editor.setCursor({ line: from.line, ch: this.afterCheckbox(editor.getLine(from.line)) });
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

        if (this.isEvent(lineText)) {
            this.insert(editor, from, selection, this.eventLink(this.dailyNoteDate(), selection));
            editor.setCursor({ line: from.line, ch: this.afterCheckbox(editor.getLine(from.line)) });
            return;
        }

        if (selection.includes("\n")) {
            new Notice("Select a task name on one line");
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
    // `lineText` is the whole task line, and its ⭕ project links decide where the note goes:
    //   - one project linked: a new note is filed there, and an existing note with no project (by the
    //     time report's rule: its folder, else its `area`) is moved there, without asking;
    //   - several projects linked: you pick, with the line's projects listed first, and the new note
    //     is filed there or the existing projectless note moved there;
    //   - an existing note already in a project stays where it is.
    // Esc on the menu cancels and nothing changes. An existing note's `area` is then set from its
    // folder (SyncArea's rule), so its properties show where it lives even when that disagrees with
    // the line. `reconcile` decides which ⭕ links go.
    //
    // Resolves to { note, linktext, name, created, projectLinks }, where `name` is the text to leave on
    // the line (without its dates) and `projectLinks` the ⭕ link texts to take off it, or null when no
    // note could be made or nothing was picked. Schedule uses this too, so a 🔗 link it writes always
    // has a note behind it.
    async noteFor(text, sourcePath, lineText = "") {
        const name = this.withoutDates(text);
        const line = this.lineProjects(lineText, sourcePath);
        const existing = app.metadataCache.getFirstLinkpathDest(name, sourcePath);
        let note = existing, picked = false;
        if (existing) {
            if (line.projects.length && !this.projectOfNote(existing)) {
                let home = null;
                if (line.allLive && line.projects.length === 1) {
                    home = line.projects[0];
                } else {
                    home = await this.pickHome(existing.basename, line.projects);
                    if (!home) return this.cancelled();
                    picked = true;
                }
                if (!(await this.moveInto(existing, home))) return null;
            }
            await customJS.SyncArea?.sync?.(existing, false);
        } else {
            let home = null;
            if (line.allLive && line.projects.length === 1) {
                home = line.projects[0];
            } else if (line.allLive && line.projects.length > 1) {
                home = await this.pickHome(name, line.projects);
                if (!home) return this.cancelled();
                picked = true;
            }
            note = await this.createTaskNote(text, home);
            if (!note) return null;
            new Notice(`Created ${note.path.replace(/\.md$/, "")}`);
        }
        return {
            note, name, created: !existing,
            linktext: this.linktextFor(note, app.vault.getMarkdownFiles().map((f) => f.path)),
            projectLinks: this.reconcile({
                links: line.links,
                lineProjects: line.projects.map((f) => f.path),
                noteProject: this.projectOfNote(note),
                picked,
            }),
        };
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

    // Which ⭕ links come off the task line once its note is settled, so the line and note agree:
    //   - all of them, when the note sits in one of the projects the line links;
    //   - all of them, when the line linked several and you picked (the pick settles it);
    //   - none, when the note has no project (the links are all that tie its time to one), or when it
    //     sits in a different project than the line's single ⭕: a conflict to settle by hand, which the
    //     time report lists on both projects.
    // { links: link texts, lineProjects: paths, noteProject: path | null, picked } → link texts
    reconcile({ links, lineProjects, noteProject, picked }) {
        if (!links.length || !noteProject) return [];
        if (lineProjects.includes(noteProject)) return links;
        if (picked && lineProjects.length > 1) return links;
        return [];
    }

    // A task line's ⭕ links: { links: link texts, projects: the distinct live projects they point at,
    // in line order, allLive: every link is one }. Live means tagged #project, under Projects/, and
    // not `completed`.
    lineProjects(lineText, sourcePath) {
        const links = this.projectLinks(lineText);
        const projects = [];
        let allLive = links.length > 0;
        for (const { linkpath } of links) {
            const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
            if (!file || !this.isLiveProject(file)) { allLive = false; continue; }
            if (!projects.includes(file)) projects.push(file);
        }
        return { links: links.map((l) => l.raw), projects, allLive };
    }

    isLiveProject(file) {
        const cache = app.metadataCache.getFileCache(file);
        const raw = cache?.frontmatter?.tags ?? [];
        const tags = (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/)).map((t) => String(t).replace(/^#/, "").toLowerCase());
        return tags.includes("project") && file.path.startsWith("Projects/") && !cache.frontmatter?.completed;
    }

    // The path of the project a note belongs to, by the time report's own rule (its nearest project
    // folder, else its `area`), so the two never disagree; null when it has none
    projectOfNote(file) {
        const report = customJS.TimeReport;
        return report.projectOfNote(file.path, report.appIndex());
    }

    // Asks which area or project the note `name` belongs to, with `preferred` (the task line's
    // projects) first, then every other area and project the Task template's picker offers. Resolves
    // to the picked area or project note, or null when dismissed.
    pickHome(name, preferred) {
        const { FuzzySuggestModal } = customJS.obsidian;
        const aliasOf = (f) => [].concat(app.metadataCache.getFileCache(f)?.frontmatter?.aliases ?? [])[0] || f.basename;
        const others = app.vault.getMarkdownFiles()
            .filter((f) => f.parent?.path.startsWith("Projects/") && !preferred.includes(f) && this.isHome(f))
            .sort((a, b) => aliasOf(a).localeCompare(aliasOf(b)));
        const items = [...preferred, ...others];
        return new Promise((resolve) => {
            let picked = null;
            const modal = new (class extends FuzzySuggestModal {
                getItems() { return items; }
                getItemText(f) { return aliasOf(f); }
                onChooseItem(f) { picked = f; }
                // Obsidian closes the modal before it reports the choice
                onClose() { setTimeout(() => resolve(picked), 0); }
            })(app);
            modal.setPlaceholder(`Which project or area is "${name}" for? (Esc: cancel)`);
            modal.open();
        });
    }

    // An area or project note still in progress (exact #area or #project, as pickParent checks)
    isHome(file) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache || cache.frontmatter?.completed) return false;
        const raw = cache.frontmatter?.tags ?? cache.frontmatter?.tag ?? [];
        return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/))
            .concat((cache.tags ?? []).map((t) => t.tag))
            .map((t) => String(t).replace(/^#/, "").toLowerCase())
            .some((t) => t === "area" || t === "project");
    }

    // Moves `note` into the folder of `home` (an area or project note), updating links to it.
    // False, with a notice, when that folder already has a note of the same name.
    async moveInto(note, home) {
        const folder = home.parent.path;
        const target = `${folder}/${note.name}`;
        if (app.vault.getAbstractFileByPathInsensitive?.(target) ?? app.vault.getAbstractFileByPath(target)) {
            new Notice(`${folder} already has a note named ${note.basename}, so nothing changed`);
            return false;
        }
        await app.fileManager.renameFile(note, target);
        new Notice(`Moved ${note.basename} to ${folder}`);
        return true;
    }

    // The ⭕ project links on a line: [{ raw, linkpath }]
    projectLinks(lineText) {
        return [...lineText.matchAll(AddTaskNote.PROJECT_LINK)].map((m) => ({ raw: m[0], linkpath: m[1].trim() }));
    }

    // `lineText` with each of `links` taken out, and the spaces they leave behind closed up.
    // The line's indent and checkbox are kept as they are.
    withoutLinks(lineText, links) {
        if (!links?.length) return lineText;
        const head = this.afterCheckbox(lineText);
        let body = lineText.slice(head);
        for (const link of links) body = body.split(link).join("");
        return lineText.slice(0, head) + body.replace(/ {2,}/g, " ").trim();
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

    // With nothing selected, what to link, from where the cursor is on the line:
    //   { kind, mode: "text", from, to, name }: some text comes after the cursor, so link the task's text
    //     (up to its first link) or an event's title (after its time), which spans `from`–`to`
    //   { kind, mode: "blank" }: only whitespace follows the cursor, so insert an empty link
    //   { error }: there's no text to use, or the task already links a note
    // `kind` is "task" or "event".
    target(lineText, ch) {
        const kind = this.isEvent(lineText) ? "event" : "task";
        if (!/\S/.test(lineText.slice(ch))) return { kind, mode: "blank" };
        let from = this.afterCheckbox(lineText);
        if (kind === "event") from += lineText.slice(from).match(AddTaskNote.EVENT_TIME)?.[0].length ?? 0;
        from += lineText.slice(from).match(/^\s*/)[0].length;
        const link = lineText.indexOf("[[", from);
        let to = link === -1 ? lineText.length : link;
        while (to > from && /\s/.test(lineText[to - 1])) to--;
        // The calendar sync's free mark after an event's title (ℹ️, OBS-47) isn't part of the name:
        // the link wraps the title and the mark stays after it, where the sync expects it
        const mark = kind === "event" && lineText.slice(from, to).match(/\sℹ\uFE0F?$/u);
        if (mark) {
            to -= mark[0].length;
            while (to > from && /\s/.test(lineText[to - 1])) to--;
        }
        if (kind === "task" && /\[\[[^\]]*\|🔗\]\]/.test(lineText)) return { error: "This task already links a note" };
        if (to === from) return { error: kind === "event" ? "This event's title is already a link" : "No task text to name the note" };
        return { kind, mode: "text", from, to, name: lineText.slice(from, to) };
    }

    // The task line once it links its note: the name without its dates where the task text was, any
    // links it already had, then the 🔗 link, which ends the line
    lineWithLink(lineText, target, found) {
        const text = lineText.slice(0, target.from) + found.name + lineText.slice(target.to);
        return `${text.trimEnd()} [[${found.linktext}|🔗]]`;
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

    // "Task" → "Task [[Task|🔗]]", linking to `linktext` (the note's name, or its path when the name is
    // ambiguous). The link ends the line, so End then a click (or the open-link key) reaches it; a space
    // follows only when the selection was mid-line and text comes right after it.
    taskLink(selection, linktext, followedBy = "") {
        return `${selection} [[${linktext}|🔗]]${this.spacer(followedBy)}`;
    }

    // " " when `followedBy` starts with something other than whitespace, so a link doesn't run into it
    spacer(followedBy) {
        return /^\S/.test(followedBy) ? " " : "";
    }

    // "Event name" → "[[2026-05-31 Event name|Event name]] "; nothing selected → "[[2026-05-31 |]] "
    eventLink(date, selection) {
        return selection ? `[[${date} ${selection}|${selection}]] ` : `[[${date} |]] `;
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
