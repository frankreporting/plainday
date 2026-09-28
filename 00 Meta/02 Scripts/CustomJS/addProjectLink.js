class AddProjectLink {
    // A line's note link, as AddTaskNote writes it: 🗒️, or 🔗 from before OBS-87 (a phone may add or drop
    // the U+FE0F). An event's log linked at the end of its line is one too (OBS-57).
    static TASK_LINK = /\[\[[^\]]*\|\s*(?:🗒|🔗)\uFE0F?\s*\]\]/u;
    // An event line whose title is a link to its meeting log, the way lines were written before
    // OBS-57: "- [<] 1:30pm⇥[[2026-09-15 Kickoff call|Kickoff call]]", or with no time yet, as the Log
    // template wrote a log's line before the calendar sync brought its event:
    // "- [<] [[2026-09-18 Printer call|Printer call]]". A log's name starts with its date, which
    // keeps a title that merely starts with a link ("[[Rafe Oakes|@Rafe]] lunch") from reading as
    // one. Captures up to the link's target.
    static LOG_TITLE = /^(\s*[-*+]\s+(?:\[.\]\s+(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+|\[<\]\s+))\[\[((?:[^\]|#]*\/)?\d{4}-\d{2}-\d{2} [^\]|#]*)/iu;

    // On a task or event line: pick a project or area from the menu and link it at the end of the
    // line as [[Project|⭕]] or [[Area|🗃️]], the forms the time report and the calendar sync read.
    // Esc cancels and nothing changes; the cursor ends up right after the checkbox, as after *Add task
    // note*.
    //
    // A line and its note agree on where the time counts (OBS-90), so a ⭕ or 🗃️ the line already
    // has is replaced, and with a 🗒️ note on the line (a task's note, an event's log) the note moves
    // into the picked project too. When that's in doubt it asks first (confirmMove): the note is
    // filed in another project or area, or other lines link it and would follow it. Leave it
    // changes nothing. A note already in the picked project needs only the ⭕; a same-named note
    // already there is linked instead. The ⭕ goes before the note link, which ends the line, and
    // otherwise at the end, with no trailing space; on an event line that's where the sync expects
    // it, after the title and the ℹ️ mark.
    async invoke() {
        const helper = customJS.AddTaskNote;
        const editor = app.workspace.activeLeaf?.view?.editor;
        const source = app.workspace.getActiveFile();
        if (!helper || !editor || !source) return;

        const line = editor.getCursor("from").line;
        const lineText = editor.getLine(line);
        if (!helper.constructor.CHECKBOX.test(lineText)) {
            new Notice("Not on a checklist item");
            return;
        }

        const home = await helper.pickHome(this.label(lineText), []);
        if (!home) return helper.cancelled();
        // The menu waited on you; don't write into a line that changed in the meantime
        if (editor.getLine(line) !== lineText) {
            new Notice("The line changed while picking a project, so nothing was linked");
            return;
        }

        const paths = () => app.vault.getMarkdownFiles().map((f) => f.path);
        const link = helper.homeLink(home, helper.linktextFor(home, paths()));
        const note = this.taskNoteOf(lineText, source.path);
        let before = lineText, linked;
        if (note) {
            // Where it's filed, a finished project included
            const noteHome = helper.filedIn(note);
            if (noteHome === home || note.parent?.path === helper.folderFor(note, home)) {
                // Already there, or in the folder the pick files into (a project note that isn't its
                // folder's own note): only the ⭕
                linked = this.placed(lineText, link);
                if (linked === lineText) new Notice(`${note.basename} is already in ${home.basename}`);
            } else if (customJS.MoveToProject?.kept?.(note.path)) {
                // The system, the periodic notes and archived work are never moved
                linked = this.placed(lineText, link);
                new Notice(`${note.basename} stays where it is, since nothing there is moved; the line links ${home.basename}`);
            } else if (helper.sameNameIn(note, home)) {
                // The picked home already has a note of that name: point the line at it and leave
                // this one where it is
                const twin = helper.sameNameIn(note, home);
                linked = this.placed(this.relinked(lineText, helper.linktextFor(twin, paths())), link);
                new Notice(`Linked the ${twin.basename} already in ${home.basename}; the one in ${note.parent?.path || "the vault root"} was left alone`);
            } else {
                if (noteHome || await this.shared(note, source.path, line, editor)) {
                    const choice = await helper.confirmMove(note, noteHome, home);
                    if (!choice) return helper.cancelled();
                    if (choice === "leave") {
                        new Notice(`${note.basename} stays ${noteHome ? `in ${noteHome.basename}` : "where it is"}, so nothing changed`);
                        return;
                    }
                    if (editor.getLine(line) !== lineText) {
                        new Notice("The line changed while you were asked, so nothing was moved");
                        return;
                    }
                }
                const movedFrom = note.path;
                if (!(await helper.moveInto(note, home, { line }))) return;
                await customJS.SyncArea?.sync?.(note, false);
                // The move can rewrite the 🗒️ link's text (a path, when the name isn't unique), so
                // the line is read again, and only the link may differ
                before = editor.getLine(line);
                if (!this.sameButTaskLink(before, lineText) || !helper.isSameNote(this.taskNoteOf(before, source.path), note, movedFrom)) {
                    new Notice(`${note.basename} moved, but the line changed, so its ⭕ links were left`);
                    return;
                }
                // Also when a project note that isn't a folder note couldn't take the note in
                linked = this.placed(before, link);
            }
        } else {
            linked = this.placed(lineText, link);
            if (linked === lineText) new Notice(`Already linked to ${home.basename}`);
        }
        if (linked !== before) {
            editor.replaceRange(linked, { line, ch: 0 }, { line, ch: before.length });
        }
        editor.setCursor({ line, ch: helper.afterCheckbox(editor.getLine(line)) });
    }

    // The line with `link` as its one ⭕ or 🗃️, before the note link that ends it, or at the end
    // with no trailing space: any it had come off
    placed(lineText, link) {
        const helper = customJS.AddTaskNote;
        return helper.withHome(lineText, link, helper.projectLinks(lineText).map((l) => l.raw));
    }

    // Whether a checklist line other than `line` (of the note at `sourcePath`, open in `editor`)
    // links `note` as its own note: that line's time moves with the note, so it's asked first
    async shared(note, sourcePath, line, editor) {
        const helper = customJS.AddTaskNote;
        const linksIt = (text, from, skip = null) => text.split("\n").some((t, i) => {
            if (i === skip || !helper.constructor.CHECKBOX.test(t)) return false;
            const linkpath = this.taskLinkpath(t);
            return !!linkpath && helper.isSameNote(app.metadataCache.getFirstLinkpathDest(linkpath, from), note);
        });
        if (linksIt(editor.getValue(), sourcePath, line)) return true;
        for (const f of customJS.MoveToProject?.linkingNotes?.(note) ?? []) {
            if (f.path !== sourcePath && linksIt(await app.vault.cachedRead(f), f.path)) return true;
        }
        return false;
    }

    // Whether two lines differ at most in their note link's target (the 🗒️, or an event's title link),
    // which Obsidian rewrites when the note moves and its name isn't unique
    sameButTaskLink(a, b) {
        const bare = (t) => t.replace(AddProjectLink.TASK_LINK, "[[|🗒️]]").replace(AddProjectLink.LOG_TITLE, "$1[[");
        return bare(a) === bare(b);
    }

    // The line with its note link (its 🗒️, or an event's title link) pointing at `linktext`
    // instead; the alias is kept
    relinked(lineText, linktext) {
        if (AddProjectLink.LOG_TITLE.test(lineText)) return lineText.replace(AddProjectLink.LOG_TITLE, `$1[[${linktext}`);
        return lineText.replace(AddProjectLink.TASK_LINK, (m) => `[[${linktext}${m.slice(m.indexOf("|"))}`);
    }

    // The target of the line's note link: its 🗒️ (a task's note, an event's log), or the log an event's title links to. Null
    // when there's neither.
    taskLinkpath(lineText) {
        const log = lineText.match(AddProjectLink.LOG_TITLE);
        if (log) return log[2].trim() || null;
        const match = lineText.match(AddProjectLink.TASK_LINK);
        return match ? match[0].slice(2).replace(/\|\s*(?:🗒|🔗)\uFE0F?\s*\]\]$/u, "").split("#")[0].trim() || null : null;
    }

    // The note a line's link points at (a task's 🗒️ note, or an event's log), or null when there's
    // none, it's broken, or it's a project or area note itself, finished or not (Schedule links one
    // from a line forwarded out of an area), which is never moved
    taskNoteOf(lineText, sourcePath) {
        const linkpath = this.taskLinkpath(lineText);
        const note = linkpath ? app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) : null;
        return note && !customJS.AddTaskNote.isHomeNote(note) ? note : null;
    }

    // What to call the line in the menu: its text after the checkbox and an event's time, with
    // symbol links left out and any other link read as its alias
    label(lineText) {
        const helper = customJS.AddTaskNote;
        const { EVENT_TIME } = helper.constructor;
        return lineText.slice(helper.afterCheckbox(lineText))
            .replace(EVENT_TIME, "")
            .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/gu, (m, target, alias) => {
                const shown = (alias ?? target).trim();
                return /^(?:🗒|🔗|⭕|🗃|🚩)/u.test(shown) ? "" : shown;
            })
            .replace(/\s+/g, " ").trim();
    }
}
