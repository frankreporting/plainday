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
    // A line's link to its own note: a task's note, or an event's meeting log (OBS-57), marked ⋯
    // (OBS-208). FROM_MARK, ↗, links the note Schedule sent the line from (Schedule.FROM_MARK). NOTE_LINK
    // reads either, for where the marks sit in a line's run; OWN_NOTE_LINK and FROM_LINK read one each, and
    // only the ⋯ is a line's own note. A phone may add the U+FE0F to ↗.
    // 🗒️ and 🔗, the marks before, mean nothing now: the one-time conversion replaced them.
    static NOTE_MARK = "⋯";
    static FROM_MARK = "↗";
    static NOTE_LINK = /\[\[[^\]]*\|\s*(?:⋯|↗\uFE0F?)\s*\]\]/u;
    static OWN_NOTE_LINK = /\[\[[^\]]*\|\s*⋯\s*\]\]/u;
    static FROM_LINK = /\[\[[^\]]*\|\s*↗\uFE0F?\s*\]\]/u;
    // One item of the run that ends a line: a ⋯, ↗, 🚩, ⭕ or 🗃️ link
    // shaped as the time report reads them (TimeReport.TRAIL_LINK), or the ℹ️ or 🆓 mark (OBS-90). And a
    // sent line's forward date (OBS-181): a link to a periodic note's line with a date for its label,
    // `[[2026-10-08#^k3x9m2|10/8]]`, or one written with a ➡️ before its date. Read with trailItem,
    // which adds the spaces before it and checks what's before a mark.
    static TRAIL_ITEM = /(?:\[\[[^\]|]+\|\s*(?:🚩\uFE0F?\s*\d{1,2}\/\d{1,2}|➡\uFE0F?[^\]]*|⋯|↗\uFE0F?|⭕\uFE0F?|🗃\uFE0F?)\s*\]\]|\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]|(?:ℹ|🆓)\uFE0F?)$/u;
    // The item of the run that ends `text`, with the spaces before it, or null. An ℹ️ or 🆓 is one only
    // after a space or a tab: stuck to a word, it's part of the text. Both are found here, not in the
    // pattern: older iPhones can't run a lookbehind (OBS-199), and spaces in it would be tried again from
    // each space of a long run. TaskIds.trailItem is a copy.
    static trailItem(text) {
        const item = text.match(AddTaskNote.TRAIL_ITEM);
        if (!item || (text[item.index] !== "[" && !/\s/.test(text[item.index - 1] ?? ""))) return null;
        while (text[item.index - 1] === " ") item.index--;
        item[0] = text.slice(item.index);
        return item;
    }
    // A block ID at the end of a line, ` ^abc123`, with the whitespace before it
    static BLOCK_ID = /\s+\^[A-Za-z0-9-]+$/;
    // An event title wrapped in a link to its log, the way lines were written before OBS-57, and the way a
    // meeting line in the form used before August 2025 (no bullet, its time first) was (OBS-193)
    static LOG_TITLE = /^\s*(?:[-*+]\s+\[.\]\s+(?:(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)?|(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)\[\[(?:[^\]|#]*\/)?\d{4}-\d{2}-\d{2} /iu;
    // The parent picked in advance for the one note being created ({ path, parent }), read by the
    // Task and Log templates (takePresetParent). Raycast's Open Log Note sets "inbox" as the parent
    static preset = null;

    // On a task line: link the task's note, making it first through the Task template when there isn't one,
    // and put its ⋯ on every line of the task, ahead of any ↗ (rule 8). The cursor stays where it was.
    // The name is the selected text or, with nothing selected, the task's text, as long as some text comes
    // after the cursor. With only whitespace after the cursor, insert an empty link to type a name into. On a
    // line that already has a ⋯, that note's ⋯ goes on the task's other lines (spread). A new note is filed in
    // the line's project, or waits in Inbox. A note of that name already there is settled (attach).
    // On an event line (`- [<]`), link a meeting log named with the daily note's date and the event's title
    // (the selection, or the text after its time), at the end of the line like a task's note (OBS-57), and
    // make the log right away, as a task's note is made (see makeLog).
    async invoke() {
        const editor = app.workspace.activeLeaf?.view?.editor;
        const source = app.workspace.getActiveFile();
        if (!editor || !source) return;
        if (customJS.TaskIds && !customJS.TaskIds.works(source)) return;

        // On a sub-task, or any line under a task or event, the note is the task's or the event's log: the line
        // at the top of the nest (rule 5, OBS-193), named from its text, the cursor and selection set aside
        const cursor = editor.getCursor("from");
        const top = customJS.TimeReport ? customJS.TimeReport.topOf((n) => editor.getLine(n), cursor.line).at : cursor.line;
        const nested = top !== cursor.line;
        const lineText = editor.getLine(top);
        const selection = nested ? "" : editor.getSelection();
        const from = nested ? { line: top, ch: this.afterCheckbox(lineText) } : cursor;
        const to = nested ? from : editor.getCursor("to");

        if ((!AddTaskNote.CHECKBOX.test(lineText) && !this.isEvent(lineText)) || this.hiddenAt(editor, top)) {
            new Notice("Not on a checklist item");
            return;
        }
        // An event the calendar moved to another day keeps its log on its line there
        if (customJS?.TimeReport?.eventKind(lineText) === "forwarded") {
            new Notice("This event moved to another day: link its log from its line there");
            return;
        }
        const line = { editor, source, at: top, lineText, cursor };

        if (!selection) {
            const target = this.target(lineText, from.ch);
            if (target.error) {
                new Notice(target.error);
            } else if (target.mode === "own") {
                await this.spread(line);
            } else if (target.mode === "blank") {
                // The empty link goes on the task at the top of the nest, and ahead of a ↗ and a task's ID, which
                // stay last (OBS-181): insert() types at the cursor, so with one of those behind it, this places it
                const stop = this.beforeRun(lineText);
                if (nested || stop !== null) {
                    const at = stop ?? lineText.length;
                    const gap = /\S/.test(lineText[at - 1] ?? "") ? " " : "";
                    const text = `${gap}[[|${AddTaskNote.NOTE_MARK}]]`;
                    editor.transaction({ changes: [{ from: { line: from.line, ch: at }, text }], selection: { from: { line: from.line, ch: at + text.indexOf("|") } } });
                    return;
                }
                const before = /\S/.test(lineText.slice(from.ch - 1, from.ch)) ? " " : "";
                this.insert(editor, from, "", before + `[[|${AddTaskNote.NOTE_MARK}]]` + this.spacer(lineText.slice(from.ch)));
            } else if (target.kind === "event") {
                await this.linkEvent(line, target.name);
            } else {
                await this.linkTask(line, target.name, target);
            }
            return;
        }

        if (selection.includes("\n")) {
            new Notice(this.isEvent(lineText) ? "Select an event name on one line" : "Select a task name on one line");
            return;
        }

        if (this.isEvent(lineText)) {
            await this.linkEvent(line, selection.trim());
            return;
        }

        // A line with a ⋯ is left alone, whatever's selected (rule 8)
        if (AddTaskNote.OWN_NOTE_LINK.test(lineText)) {
            await this.spread(line);
            return;
        }

        // The selection's own leading and trailing spaces stay, so words don't run together
        let start = from.ch, end = to.ch;
        while (start < end && /\s/.test(lineText[start])) start++;
        while (end > start && /\s/.test(lineText[end - 1])) end--;
        await this.linkTask(line, selection, { from: start, to: end }, { selected: true });
    }

    // Where an empty link goes when a ↗ or an ID ends the line, or null when neither does
    beforeRun(lineText) {
        const from = lineText.match(AddTaskNote.FROM_LINK);
        if (from) return lineText.slice(0, from.index).replace(/\s+$/, "").length;
        const id = lineText.match(AddTaskNote.BLOCK_ID);
        return id ? id.index : null;
    }

    // The project or area note line `at` of the note at `path` says, a finished one included, or null: in a
    // periodic note its own ⭕ or 🗃️, anywhere else its note's (rule 4). A line that disagrees with itself says
    // none, since nothing decides. The time report's one lookup answers.
    lineHomeAt(lines, at, path) {
        const tr = customJS.TimeReport, index = tr.appIndex();
        const project = tr.resolve((n) => lines[n], at, path, index).conflict ? null : tr.lineProject({ path }, at, lines, index);
        return project ? app.vault.getFileByPath(project) : null;
    }

    // The project or area a line of a daily note at `path` says, for the Log template, or null
    lineHomeIn(lineText, path) {
        return this.lineHomeAt([lineText], 0, path);
    }

    // The project or area the line at `at` of the note open in `editor` says
    projectOfLine(editor, source, at) {
        return this.lineHomeAt(customJS.Schedule.constructor.editorLines(editor).map((l) => l.replace(/\r$/, "")), at, source.path);
    }

    // The task's line once it links its note: `span` of its text gives way to the name without its dates, and
    // every line of the task takes the ⋯. `text` is what names the note; a date in it is the task's due date,
    // not part of its name, so the note is looked up without it, and a new one is made through the Task
    // template from the name with the dates after it, so the template can set `due` and the name keeps no
    // doubled space where a date was. The note's name is that name cleaned for a file name (fileName), so a
    // colon doesn't stop it; the line keeps the name as typed. Settling on a project is a project change
    // (rule 9): a new note is made only once the question and the refusal are past.
    async linkTask(line, text, span, { selected = false } = {}) {
        const { editor, source, at, lineText, cursor } = line;
        const change = customJS.TaskChange;
        if (!change.ready()) return;
        const name = this.withoutDates(text), noteName = this.fileName(name);
        if (!noteName) {
            new Notice("No task text to name the note");
            return;
        }
        // The note of that name outside Archive. One in Archive is an old one: this task gets a fresh note,
        // named apart from it so the old days' links keep pointing at it, and the old one is left alone
        // (Brian, 2026-11-02)
        const named = this.namedNote(noteName, source.path);
        let existing = named && !this.inArchive(named) ? named : null;
        let found = await change.find({ file: source, at }, { note: existing });
        // The fresh note an earlier run made for it, for the task's next line or after a run that stopped short
        const madeBefore = named && !existing ? this.freshNote(noteName, this.homeOf(line, found)) : null;
        if (madeBefore) {
            existing = madeBefore;
            found = await change.find({ file: source, at }, { note: existing });
        }
        const start = found.lines.find((l) => l.file === source && l.at === at);
        // A task whose other line, by its ID, already links its note takes that note, unless you named one
        const T = customJS.TaskIds.constructor, id = start && T.idOf(start.seen)?.toLowerCase();
        const sameTask = (l) => l !== start && id && T.idOf(l.seen)?.toLowerCase() === id;
        const others = found.lines.filter(sameTask).map((l) => this.ownNoteOf(l.seen, l.file.path)).filter(Boolean);
        const other = others.find((n) => !this.inArchive(n));
        if (other && !selected) return this.spread(line, other);
        const retitled = lineText.slice(0, span.from) + name + lineText.slice(span.to);
        const keep = lineText.slice(0, span.to);
        const each = (note, oldPath = null) => (t, l) => {
            const paths = app.vault.getMarkdownFiles().map((f) => f.path).filter((p) => p !== oldPath);
            const named = l === start && t.startsWith(keep) ? retitled.slice(0, span.from + name.length) + t.slice(span.to) : t;
            return this.withOwn(named, `[[${this.linktextFor(note, paths)}|${AddTaskNote.NOTE_MARK}]]`);
        };
        let done, note = null;
        if (existing) done = await this.attach(line, existing, found, each(existing, existing.path), name);
        else {
            const home = this.homeOf(line, found);
            // The template takes the dates off the title for the note's name and keeps the last as its due date
            const newName = named ? this.freshName(noteName, home) : noteName;
            const title = [newName, ...(name.match(AddTaskNote.DATE) ? [] : text.match(AddTaskNote.DATE) ?? [])].join(" ");
            // With no project the note waits in the Inbox, which a line naming a project is warned about
            const adds = home ? null : { path: `${customJS.TaskIds.constructor.INBOX}/${newName}.md`, basename: newName };
            const make = async () => {
                note = await this.createTaskNote(title, home);
                if (!note) return false;
                new Notice(`Created ${note.path.replace(/\.md$/, "")}`);
                // The template took a moment; don't write into a line that changed in the meantime
                if (editor.getLine(at) === lineText) return true;
                new Notice(`${note.basename} is ready, but the line changed, so it wasn't linked`);
                return false;
            };
            const own = (t, l) => each(note)(t, l);
            done = (await change.run(found, home, { ready: make, each: own, name, adds, start, stale: () => editor.getLine(at) !== lineText })).done;
        }
        if (!done || start.gone) return;
        // The task's other line links another note, one you didn't name or one in Archive: the report lists the two
        const linked = existing ?? note, two = others.find((n) => !(linked && this.isSameNote(n, linked)));
        if (two) new Notice(`This task's other line links ${two.basename}, so the report lists it as linking two notes`);
        // A note that moved can have taken a property above the line, as SyncArea writes `parent`
        const now = start.at, shifted = { line: cursor.line + now - at, ch: cursor.ch };
        if (selected) editor.setCursor({ line: now, ch: span.from + name.length });
        else this.keepCursor(editor, shifted, now, lineText, retitled);
    }

    // Settles `existing`, the note the line's name resolves to (rule 8), and writes the line. True once it has:
    //   - outside the system, a project or area note, an invoice or a timesheet: it's linked from this line,
    //     and nothing else changes; a notice names the line if it now disagrees with its note;
    //   - filed in another project than the line's: it asks, Move or Leave it (TaskChange.ask), unless the
    //     line's project already has another note of that name, which refuses;
    //   - otherwise the task takes the line's project, or the note's when the line has none, a note waiting in
    //     the Inbox filed there with it (rule 9). With neither, it's only linked.
    async attach(line, existing, found, each, name = null) {
        const { editor, source, at, lineText } = line;
        const change = customJS.TaskChange;
        const adds = existing, stale = () => editor.getLine(at) !== lineText;
        const start = found.lines.find((l) => l.file === source && l.at === at) ?? null;
        // Linked from this line as it is; a line it leaves disagreeing is named afterwards (warn after, never block)
        if (!change.ours(existing)) {
            const one = { notes: [], stays: [], lines: found.lines.filter((l) => l.file === source && l.at === at) };
            return !!(await change.run(one, null, { stale, each, name, adds, start })).done;
        }
        const home = this.homeOf(line, found), noteHome = this.filedAbove(existing);
        if (home && noteHome && home !== noteHome) {
            if (this.sameNameIn(existing, home)) {
                new Notice(`${home.basename} already has a different note named ${existing.basename}, so nothing changed`);
                return false;
            }
            return !!(await change.run(found, home, { leave: noteHome, stale, each, name, adds, start })).done;
        }
        return !!(await change.run(found, home ?? noteHome, { stale, each, name, adds, start })).done;
    }

    // The project a line says, as projectOfLine reads it, or when it names none, the one its task's other
    // lines agree on
    homeOf({ editor, source, at }, found) {
        return this.projectOfLine(editor, source, at) ?? customJS.TaskChange.agreedHome(found);
    }

    // On a line that already has a ⋯: that note's ⋯ on the task's other lines, and the task takes the note's
    // project, as a change does (rule 9). A line with a ⋯ is left alone.
    async spread(line, note = this.ownNoteOf(line.lineText, line.source.path)) {
        const { editor, source, at, lineText } = line;
        const change = customJS.TaskChange;
        if (!change.ready()) return;
        if (!note) {
            new Notice("This task already links a note");
            return;
        }
        const T = customJS.TaskIds.constructor;
        const found = await change.find({ file: source, at });
        const missing = found.lines.filter((l) => l.task && !T.hasOwnNote(l.seen));
        const linktext = this.linktextFor(note, app.vault.getMarkdownFiles().map((f) => f.path));
        const each = (t) => this.withOwn(t, `[[${linktext}|${AddTaskNote.NOTE_MARK}]]`);
        // A note in the system takes the task to its project, and one waiting in the Inbox is filed where the
        // task's lines say; any other note is only linked. Run again after a failed write, it finishes.
        const home = change.ours(note) ? this.filedAbove(note) ?? this.homeOf(line, found) : null;
        if (!home && !missing.length) {
            new Notice(`Every line of this task already links ${note.basename}`);
            return;
        }
        const scope = home ? found : { notes: [], stays: [], lines: missing };
        const result = await change.run(scope, home, { each, name: note.basename, stale: () => editor.getLine(at) !== lineText, adds: note });
        // A failed write has said so, and to run it again
        if (!result.done || result.failed.length) return;
        // One line put in the note's project says so too, as more lines or a moved note already do (said)
        if (result.wrote === 1 && !result.moved.length) new Notice(customJS.MoveToProject.linesNow(1, home));
        if (missing.length) new Notice(`Linked ${note.basename} on ${missing.length === 1 ? "1 more line" : `${missing.length} more lines`} of this task`);
        else if (!result.wrote && !result.moved.length && !result.toDo.length) new Notice(`Every line of this task already links ${note.basename}`);
    }

    // The note `name` resolves to, preferring one outside Archive when notes there share the name
    namedNote(name, from) {
        const first = app.metadataCache.getFirstLinkpathDest(name, from);
        if (!first || !this.inArchive(first)) return first;
        const lower = name.toLowerCase();
        return app.vault.getMarkdownFiles().find((f) => f.basename.toLowerCase() === lower && !this.inArchive(f)) ?? first;
    }

    // A name for a fresh note that no other note has: `name (Project)`, or with a number after it
    freshName(name, home) {
        const taken = new Set(app.vault.getMarkdownFiles().map((f) => f.basename.toLowerCase()));
        const base = home ? `${name} (${home.basename})` : name;
        if (!taken.has(base.toLowerCase())) return base;
        for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
    }

    // The fresh note an earlier run made for a task named like a note in Archive, by any name freshName gives
    // one: outside Archive, one a change can move, named `name (Project)`, wherever it's filed since, with a
    // number after it or not, or `name 2` (any number) while it waits in the Inbox. A note filed elsewhere
    // with only a number after the name is another task's (Phase 2). The one in `home`, or in the Inbox when
    // there's no `home`, else the only one; null when there's none, or no telling which.
    freshNote(name, home) {
        const inbox = `${customJS.TaskIds.constructor.INBOX}/`, files = app.vault.getMarkdownFiles();
        const made = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (?:\\((.+)\\)(?: \\d+)?|\\d+)$`, "i");
        const isHome = (p) => files.some((f) => f.basename.toLowerCase() === p.toLowerCase() && this.isHomeNote(f));
        const found = files.filter((f) => {
            const m = !this.inArchive(f) && f.basename.match(made);
            return m && customJS.TaskChange.ours(f) && (m[1] ? isHome(m[1]) : f.path.startsWith(inbox));
        });
        const here = found.filter((f) => (home ? this.filedAbove(f)?.path === home.path : f.path.startsWith(inbox)));
        if (here.length) return here.length === 1 ? here[0] : null;
        return found.length === 1 ? found[0] : null;
    }

    // Whether `note` is in Archive
    inArchive(note) {
        return note.path.startsWith(customJS.TaskIds.constructor.ARCHIVE);
    }

    // The note a line's ⋯ links, or null
    ownNoteOf(lineText, from) {
        const target = this.trailingNote(lineText, AddTaskNote.OWN_NOTE_LINK);
        return target ? app.metadataCache.getFirstLinkpathDest(target, from) : null;
    }

    // Whether line `at` of the note open in `editor` is hidden from the system, in a code block or a comment
    hiddenAt(editor, at) {
        const tr = customJS?.TimeReport;
        if (!tr) return false;
        const lines = editor.getValue ? editor.getValue().split("\n") : Array.from({ length: editor.lineCount() }, (_, n) => editor.getLine(n));
        return !!tr.scan(lines.map((l) => l.replace(/\r$/, ""))).hidden[at];
    }

    // The cursor where it was, on the same words, once line `at` has gone through `texts` (each a whole line):
    // a change at its end leaves it, and text taken away from under it leaves it where that text was. Run
    // from a line under the task, it stays there (OBS-224).
    keepCursor(editor, cursor, at, ...texts) {
        if (cursor.line !== at) return editor.setCursor(cursor);
        let ch = cursor.ch;
        const steps = [...texts, editor.getLine(at)];
        for (let i = 0; i + 1 < steps.length; i++) {
            const [was, now] = [steps[i], steps[i + 1]];
            let s = 0, e = 0;
            while (s < was.length && s < now.length && was[s] === now[s]) s++;
            while (e < was.length - s && e < now.length - s && was[was.length - 1 - e] === now[now.length - 1 - e]) e++;
            ch = customJS.DueDate.cursorAfter(ch, { from: s, to: was.length - e, text: now.slice(s, now.length - e) });
        }
        editor.setCursor({ line: at, ch });
    }

    // Whether a note is tagged exactly #project or #area, finished or not
    isHomeNote(file) {
        const cache = app.metadataCache.getFileCache(file);
        return !!cache && this.tagsOf(cache).some((t) => t === "area" || t === "project");
    }

    // The project or area `file` is filed in: the nearest folder note above it tagged #project or
    // #area, finished or not, or itself for one of those. Null outside any.
    filedIn(file) {
        return this.isHomeNote(file) ? file : this.filedAbove(file);
    }

    // The project or area above `file`: the nearest folder note above it tagged #project or #area, finished or
    // not. Null outside any.
    filedAbove(file) {
        for (let dir = file.parent; dir && dir.path !== "/"; dir = dir.parent) {
            const folderNote = app.vault.getFileByPath(`${dir.path}/${dir.name}.md`);
            if (folderNote && folderNote !== file && this.isHomeNote(folderNote)) return folderNote;
        }
        return null;
    }

    // `lineText` with `link` ([[Project|⭕]] or [[Area|🗃️]], as homeLink writes it) as its project link
    // and `drop` (links as written) taken off: `link` goes before the first note link (⋯ or ↗) in the
    // run of links that ends the line (⋯, ↗, 🚩, ⭕, 🗃️, and the ℹ️ and 🆓 marks among them), or at its
    // end when that run has none, so the note links stay last (OBS-90, OBS-208). A block ID stays at the very end. With no
    // `link`, only `drop` comes off. Trailing spaces go; an event's tab after its time stays.
    withHome(lineText, link, drop = [], { inRun = false } = {}) {
        let bare = (inRun ? lineText : this.withoutLinks(lineText, drop)).replace(/\s+$/, "");
        const block = bare.match(AddTaskNote.BLOCK_ID)?.[0] ?? "";
        bare = bare.slice(0, bare.length - block.length).replace(/\s+$/, "");
        // With `inRun`, `drop` comes off the run that ends the line only: the same link in the text is
        // its title's (Schedule's sentLine)
        if (inRun && drop.length) {
            let start = bare.length;
            for (let item; (item = AddTaskNote.trailItem(bare.slice(0, start)));) start = item.index;
            const run = this.withoutLinks(bare.slice(start).trim(), drop);
            bare = [bare.slice(0, start).replace(/\s+$/, ""), run].filter(Boolean).join(" ");
        }
        if (!link) return bare + block;
        let at = bare.length, before = null;
        for (let item; (item = AddTaskNote.trailItem(bare.slice(0, at)));) {
            at = item.index;
            if (AddTaskNote.NOTE_LINK.test(item[0])) before = at;
        }
        if (before === null) return `${bare} ${link}${block}`;
        return `${bare.slice(0, before).replace(/ +$/, "")} ${link} ${bare.slice(before).trim()}${block}`;
    }

    // Whether `file`, a link's target looked up by name, is `note`
    isSameNote(file, note) {
        return !!file && (file === note || file.path === note.path);
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

    // What a note is, as the question names it: "Log", "Task", "Area", "Project" or "Note"
    kindOf(note) {
        const cache = app.metadataCache.getFileCache(note);
        const tags = cache ? this.tagsOf(cache) : [];
        return this.isLog(note) ? "Log" : tags.includes("task") ? "Task"
            : tags.includes("area") ? "Area" : tags.includes("project") ? "Project" : "Note";
    }

    // A project or area with its 🗃️ or ⭕, for the question
    markOf(file) {
        return file ? `${this.isArea(file) ? AddTaskNote.AREA_MARK : AddTaskNote.PROJECT_MARK} ${file.basename}` : "No project or area";
    }

    // The one question (rule 10). Asks whether to move `note` from the project or area `from` into `to`, with
    // `title`, `label`, `name`, `words` (a sentence, or a list of them) and `cancel` when TaskChange has more to
    // say than that. Resolves to "move", "leave", or null when dismissed (Esc, or Cancel). Enter moves. The one
    // thing to decide about, highlighted with what it is (Task, Log, Note, Project or Area, or TaskChange's
    // label), then what follows from it, with no days or lines: the system takes care of those, and `from` and
    // `to` were just picked (Brian, 2026-11-03). The buttons: Leave it or Cancel, then Move. MoveToProject asks
    // for a project or area too, whose `from` can be null (nothing above it).
    confirmMove(note, from, to, { title = null, label = null, name = null, words = null, cancel = "Leave it" } = {}) {
        const { Modal, ButtonComponent } = customJS.obsidian;
        return new Promise((resolve) => {
            let choice = null;
            const modal = new (class extends Modal {
                onClose() { setTimeout(() => resolve(choice), 0); }
                // Move is the default: focused, so Enter or Space takes it; Tab reaches the other.
                // Focused once the modal is open, not straight after open() (OBS-50)
                onOpen() { requestAnimationFrame(() => move.buttonEl.focus()); }
            })(app);
            const pick = (c) => { choice = c; modal.close(); };
            const kind = note ? this.kindOf(note) : "Task";
            modal.titleEl.setText(title ?? `Move ${kind.toLowerCase()}?`);
            const mark = modal.contentEl.createEl("p").createEl("mark", { attr: { style: "background-color: var(--text-highlight-bg); color: var(--text-normal); padding: 0.1em 0.3em; border-radius: var(--radius-s);" } });
            mark.createEl("strong", { text: `${label ?? kind}:` });
            mark.appendText(` ${name ?? note?.basename ?? ""}`);
            const said = words ?? (kind === "Area" ? "Its time, and its projects', stays their own."
                : kind === "Project" ? "Its time stays its own. Inside another project, it counts toward that project's totals and takes its rate if it has none of its own."
                : "Time entries will be reallocated accordingly.");
            for (const text of [].concat(said)) modal.contentEl.createEl("p", { text });
            const row = modal.contentEl.createDiv({ cls: "modal-button-container" });
            new ButtonComponent(row).setButtonText(cancel).onClick(() => pick(cancel === "Cancel" ? null : "leave"));
            const move = new ButtonComponent(row).setButtonText("Move").setCta().onClick(() => pick("move"));
            modal.scope.register([], "Enter", () => { pick("move"); return false; });
            modal.open();
        });
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

    // Asks which area or project `name` belongs to, from every live area and project under Projects/. Resolves
    // to the picked area or project note, or null when dismissed. AddProjectLink and MoveToProject use it,
    // leaving out the ones they can't file into (`exclude(file)` true); MoveToProject asks its own question
    // (`placeholder`).
    pickHome(name, { exclude = () => false, placeholder = null } = {}) {
        const { FuzzySuggestModal } = customJS.obsidian;
        const aliasOf = (f) => [].concat(app.metadataCache.getFileCache(f)?.frontmatter?.aliases ?? [])[0] || f.basename;
        const items = app.vault.getMarkdownFiles()
            .filter((f) => f.parent?.path.startsWith("Projects/") && this.isHome(f) && !exclude(f))
            .sort((a, b) => aliasOf(a).localeCompare(aliasOf(b)));
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
    // other than `note` itself; null when there's none. AddTaskNote refuses then (rule 12).
    sameNameIn(note, home) {
        const folder = this.isLog(note) ? this.logsFolder(home) : home.parent.path;
        const target = `${folder}/${note.name}`;
        const twin = app.vault.getAbstractFileByPathInsensitive?.(target) ?? app.vault.getAbstractFileByPath(target);
        return twin && twin !== note && twin.extension === "md" ? twin : null;
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
        for (let item; (item = AddTaskNote.trailItem(bare.slice(0, at)));) {
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
    // note once the template has filed it, or null when it couldn't be made. The name is cleaned for a file
    // name first (fileName), whoever calls.
    async createTaskNote(title, parent = null) {
        const name = this.fileName(title);
        if (!name) {
            new Notice("No task text to name the note");
            return null;
        }
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
    //   { kind: "task", mode: "own" }: the task has a ⋯ already, wherever the cursor is, so that note goes on
    //     its other lines (spread). A ↗ is no note of its own: it's where the line was sent from.
    //   { kind: "task", mode: "blank" }: only whitespace follows the cursor on a task line with no ⋯ (a block
    //     ID at its end aside), so insert an empty link to type a name into. An event never gets one:
    //     `[[2026-09-14 |⋯]]` would point at the daily note itself.
    //   { error }: there's no text to use, or the event links a log already
    // `kind` is "task" or "event".
    target(lineText, ch) {
        const kind = this.isEvent(lineText) ? "event" : "task";
        if (kind === "event" && this.linksLog(lineText)) return { error: "This event already links a log" };
        // Wherever the cursor is: a task with a note never gets a second, blank link
        if (kind === "task" && AddTaskNote.OWN_NOTE_LINK.test(lineText)) return { kind, mode: "own" };
        // A task's ID at the end is hidden (OBS-181), so the cursor at the end of the visible text has
        // nothing after it: the ID doesn't count
        const id = lineText.match(AddTaskNote.BLOCK_ID);
        if (kind === "task" && !/\S/.test(lineText.slice(ch, id ? Math.max(ch, id.index) : lineText.length))) return { kind, mode: "blank" };
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

    // The target of the note link in the run of links that ends `lineText` (the first, when there are
    // several: its ⋯, else its ↗), or null when that run has none. `link` picks one mark: OWN_NOTE_LINK
    // for its own note only (Schedule, OBS-208).
    trailingNote(lineText, link = AddTaskNote.NOTE_LINK) {
        let bare = lineText.replace(/\s+$/, "");
        bare = bare.slice(0, bare.length - (bare.match(AddTaskNote.BLOCK_ID)?.[0].length ?? 0));
        let at = bare.length, note = null;
        for (let item; (item = AddTaskNote.trailItem(bare.slice(0, at)));) {
            at = item.index;
            if (link.test(item[0])) note = item[0].trim();
        }
        return note?.match(/^\[\[([^\]|#^]*)/)?.[1].trim() || null;
    }

    // `lineText` with `link`, a ↗ to the note it was sent from, in its run (OBS-208): after its ⋯, else
    // after its ⭕ or 🗃️, else at the end, before a block ID. A ↗ it had already gives way: a line was
    // sent from one note.
    withFrom(lineText, link) {
        let bare = lineText.replace(/\s+$/, "");
        const block = bare.match(AddTaskNote.BLOCK_ID)?.[0] ?? "";
        bare = bare.slice(0, bare.length - block.length).replace(/\s+$/, "");
        const items = [];
        let at = bare.length;
        for (let item; (item = AddTaskNote.trailItem(bare.slice(0, at)));) { items.unshift(item[0].trim()); at = item.index; }
        const run = items.filter((x) => !AddTaskNote.FROM_LINK.test(x));
        const after = (test) => run.reduce((last, x, i) => (test(x) ? i : last), -1);
        let i = after((x) => AddTaskNote.OWN_NOTE_LINK.test(x));
        if (i < 0) i = after((x) => /\|\s*(?:⭕|🗃)\uFE0F?\s*\]\]$/u.test(x));
        run.splice(i < 0 ? run.length : i + 1, 0, link);
        // The text keeps the gap it had before its links (a tab, say)
        const text = bare.slice(0, at), gap = text.match(/\s*$/)[0] || " ";
        return `${text.replace(/\s+$/, "")}${gap}${run.join(" ")}${block}`;
    }

    // `lineText` with `link`, a ⋯ to its own note, in its run: ahead of a ↗, else at the end, before a block ID.
    // A line with a ⋯ is left alone (rule 8).
    withOwn(lineText, link) {
        let bare = lineText.replace(/\s+$/, "");
        const block = bare.match(AddTaskNote.BLOCK_ID)?.[0] ?? "";
        bare = bare.slice(0, bare.length - block.length).replace(/\s+$/, "");
        const items = [];
        let at = bare.length;
        for (let item; (item = AddTaskNote.trailItem(bare.slice(0, at)));) { items.unshift(item[0].trim()); at = item.index; }
        if (items.some((x) => AddTaskNote.OWN_NOTE_LINK.test(x))) return lineText;
        const from = items.findIndex((x) => AddTaskNote.FROM_LINK.test(x));
        items.splice(from === -1 ? items.length : from, 0, link);
        const text = bare.slice(0, at), gap = text.match(/\s*$/)[0] || " ";
        return `${text.replace(/\s+$/, "")}${gap}${items.join(" ")}${block}`;
    }

    // `lineText` with `link` at its end, before a block ID if it ends in one
    endWith(lineText, link) {
        const bare = lineText.replace(/\s+$/, "");
        const block = bare.match(AddTaskNote.BLOCK_ID)?.[0] ?? "";
        return `${bare.slice(0, bare.length - block.length).replace(/\s+$/, "")} ${link}${block}`;
    }

    // Links an event line to its meeting log (see eventLine); the cursor stays where it was. A new log is made
    // (makeLog), and the Log template files it where the line's ⭕ says. A log that exists already is settled
    // the way a task's note is (attach).
    async linkEvent(line, name) {
        const { editor, source, at, lineText, cursor } = line;
        const change = customJS.TaskChange;
        const date = this.dailyNoteDate();
        const logName = `${date} ${this.fileName(name)}`;
        const fresh = this.eventLine(lineText, name, date);
        if (fresh.error) {
            new Notice(fresh.error);
            return;
        }
        const existing = this.namedNote(logName, source.path);
        if (!existing) {
            editor.replaceRange(fresh, { line: at, ch: 0 }, { line: at, ch: lineText.length });
            this.keepCursor(editor, cursor, at, lineText);
            await this.makeLog(logName);
            return;
        }
        if (!change.ready()) return;
        const found = await change.find({ file: source, at }, { note: existing });
        const oldPath = existing.path;
        const each = (t) => {
            const paths = app.vault.getMarkdownFiles().map((f) => f.path).filter((p) => p !== oldPath);
            return this.withOwn(t, `[[${this.linktextFor(existing, paths)}|${AddTaskNote.NOTE_MARK}]]`);
        };
        if (await this.attach(line, existing, found, each, name)) this.keepCursor(editor, cursor, at, lineText);
    }

    // A note's name from a task's text or an event's title, as CalNav names logs: ": " becomes " - ", a
    // slash or bar becomes "-", characters a file name or a link can't hold are dropped, and so are dots
    // and spaces at the end. Cleaning a name twice changes nothing. The line keeps its text as typed
    // (OBS-111).
    fileName(title) {
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

    // The event line with a link to its meeting log, `[[date name|⋯]]` (or `[[linktext|⋯]]`): at
    // the end, after the title, its ℹ️ or 🆓 and any ⭕ or 🗃️ links, so the note link ends the line
    // (OBS-90) and the calendar sync reads it (OBS-57). { error } when the line already links a log.
    eventLine(lineText, name, date, linktext = null) {
        if (this.linksLog(lineText)) return { error: "This event already links a log" };
        const link = linktext ? `[[${linktext}|${AddTaskNote.NOTE_MARK}]]` : this.eventLink(date, this.fileName(name));
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

    // An event line: a [<] line, and, told by their form (rule 1, OBS-193), a [-] line the calendar sync wrote
    // and a meeting line in the form used before August 2025
    isEvent(lineText) {
        return /^\s*[-*+]\s+\[<\]/.test(lineText) || ["canceled", "meeting"].includes(customJS?.TimeReport?.eventKind(lineText));
    }

    // " " when `followedBy` starts with something other than whitespace, so a link doesn't run into it
    spacer(followedBy) {
        return /^\S/.test(followedBy) ? " " : "";
    }

    // "Event name" → "[[2026-05-31 Event name|⋯]]"
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
