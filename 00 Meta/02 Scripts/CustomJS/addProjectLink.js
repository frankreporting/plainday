class AddProjectLink {
    // A 🔗 task note link, as AddTaskNote writes it (a phone may add U+FE0F to the emoji)
    static TASK_LINK = /\[\[[^\]]*\|🔗️?\]\]/u;
    // An event line whose title is a link to its meeting log, as AddTaskNote writes it:
    // "- [<] 1:30pm⇥[[2026-09-15 Kickoff call|Kickoff call]]". Captures up to the link's target.
    static LOG_TITLE = /^(\s*[-*+]\s+\[.\]\s+(?:all day|\d{1,2}:\d{2}\s?[ap]m)[\t ]+)\[\[([^\]|#]+)/iu;

    // On a task or event line: pick a project or area from the menu and link it at the end of the
    // line as [[Project|⭕]] or [[Area|🗃️]], the forms the time report and the calendar sync read.
    // It's for tying a line's time to a project when the task doesn't need a note of its own. Esc
    // cancels and nothing changes; the cursor ends up right after the checkbox, as after *Add task
    // note*.
    //
    // One link per line says where its time counts: a ⭕ or 🗃️, or a 🔗 task note filed in its
    // project (OBS-36). So a ⭕ or 🗃️ the line already has is replaced, and with a 🔗 task note on the line the
    // note is moved into the picked project instead, and no ⭕ is added: without asking when the
    // note has no project or area yet, after a confirm when it's leaving one (its project is
    // shared by every line that links it). A note already in the picked project needs nothing.
    // The ⭕ ends the line with no trailing space; on an event line that's where the sync expects
    // it, after the title, a log link or the ℹ️ mark.
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

        const link = helper.homeLink(home, helper.linktextFor(home, app.vault.getMarkdownFiles().map((f) => f.path)));
        const withoutProjects = (text) => helper.withoutLinks(text, helper.projectLinks(text).map((l) => l.raw));
        const note = this.taskNoteOf(lineText, source.path);
        let before = lineText, linked;
        if (note) {
            const noteHome = helper.homeOf(note);
            if (noteHome === home) {
                linked = withoutProjects(lineText);
                new Notice(linked === lineText
                    ? `${note.basename} is already in ${home.basename}`
                    : `${note.basename} is in ${home.basename}, so the other project link came off`);
            } else if (helper.sameNameIn(note, home)) {
                // The picked home already has a note of that name: point the line at it and leave
                // this one where it is
                const twin = helper.sameNameIn(note, home);
                linked = withoutProjects(this.relinked(lineText, helper.linktextFor(twin, app.vault.getMarkdownFiles().map((f) => f.path))));
                new Notice(`Linked the ${twin.basename} already in ${home.basename}; the one in ${note.parent?.path || "the vault root"} was left alone`);
            } else {
                if (noteHome) {
                    const choice = await helper.confirmMove(note, noteHome, home);
                    if (!choice) return helper.cancelled();
                    if (choice === "leave") {
                        new Notice(`${note.basename} stays in ${noteHome.basename}, so nothing changed`);
                        return;
                    }
                }
                if (!(await helper.moveInto(note, home))) return;
                await customJS.SyncArea?.sync?.(note, false);
                // The move can rewrite the 🔗 link's text (a path, when the name isn't unique), so
                // the line is read again, and only the link may differ
                before = editor.getLine(line);
                if (!this.sameButTaskLink(before, lineText) || this.taskNoteOf(before, source.path) !== note) {
                    new Notice(`${note.basename} moved, but the line changed, so its ⭕ links were left`);
                    return;
                }
                // A project note that isn't a folder note can't hold the note, so the line keeps a ⭕
                linked = helper.homeOf(note) === home ? withoutProjects(before) : this.placed(before, link);
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

    // The line with `link` as its one ⭕ or 🗃️, at the end with no trailing space: any it had come off
    placed(lineText, link) {
        const helper = customJS.AddTaskNote;
        const bare = helper.withoutLinks(lineText, helper.projectLinks(lineText).map((l) => l.raw));
        return `${bare.trimEnd()} ${link}`;
    }

    // Whether two lines differ at most in their note link's target (the 🔗, or an event's log link),
    // which Obsidian rewrites when the note moves and its name isn't unique
    sameButTaskLink(a, b) {
        const bare = (t) => t.replace(AddProjectLink.TASK_LINK, "[[|🔗]]").replace(AddProjectLink.LOG_TITLE, "$1[[");
        return bare(a) === bare(b);
    }

    // The line with its note link (a task's 🔗, or an event's title link) pointing at `linktext`
    // instead; the alias is kept
    relinked(lineText, linktext) {
        if (AddProjectLink.LOG_TITLE.test(lineText)) return lineText.replace(AddProjectLink.LOG_TITLE, `$1[[${linktext}`);
        return lineText.replace(AddProjectLink.TASK_LINK, (m) => `[[${linktext}${m.slice(m.indexOf("|"))}`);
    }

    // The target of the line's note link: a task's 🔗, or the log an event's title links to. Null
    // when there's neither.
    taskLinkpath(lineText) {
        const log = lineText.match(AddProjectLink.LOG_TITLE);
        if (log) return log[2].trim() || null;
        const match = lineText.match(AddProjectLink.TASK_LINK);
        return match ? match[0].slice(2).replace(/\|🔗\uFE0F?\]\]$/u, "").split("#")[0].trim() || null : null;
    }

    // The note a line's link points at (a task's 🔗 note, or an event's log), or null when there's
    // none, it's broken, or it's a project or area note itself (Schedule links one from a line
    // forwarded out of an area), which is never moved
    taskNoteOf(lineText, sourcePath) {
        const linkpath = this.taskLinkpath(lineText);
        const note = linkpath ? app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) : null;
        return note && !customJS.AddTaskNote.isHome(note) ? note : null;
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
                return /^(?:🔗|⭕|🗃|🚩)/u.test(shown) ? "" : shown;
            })
            .replace(/\s+/g, " ").trim();
    }
}
