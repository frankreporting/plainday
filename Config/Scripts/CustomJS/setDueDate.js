class DueDate {
    // Note links end a line (⋯ task note or log, ↗ the note it was sent from, ⭕ project, 🗃️ area), so End reaches the note; the
    // due date goes in front of them (OBS-36), and in front of a sent line's forward date (OBS-107): a
    // link to a periodic note's line with a date for its label, `[[2026-10-08#^k3x9m2|10/8]]`, or one
    // written with a ➡️ before its date. A task's ID stays last (OBS-181). A phone may add or drop the U+FE0F on an emoji.
    static NOTE_LINK = /\[\[[^\]]*\|\s*(?:⋯|↗|⭕|🗃|➡)\uFE0F?[^\]]*\]\]|\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]/gu;
    static BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/;
    // A due date, with any whitespace before it: a link to a day's note with a 🚩 for its label. A link
    // to a day with no 🚩 isn't one, and neither is a 🚩 on a link to any other note.
    static DUE_LINK = /(\s*)\[\[(?:[^\]|#]*\/)?\d{4}-\d{2}-\d{2}\|\s*🚩\uFE0F?[^\]]*\]\]/gu;

    // Where the due link goes on `lineText`, and the text to insert there: over the 🚩 the line has, the
    // first one if there are more, which go (OBS-65); else right before the line's trailing note links
    // and forward date (with one space either side), else at the end, ahead of an ID
    placement(lineText, dueLink) {
        const flags = [...lineText.matchAll(DueDate.DUE_LINK)];
        if (flags.length) {
            const [first, last] = [flags[0], flags[flags.length - 1]];
            const from = first.index + first[1].length, to = last.index + last[0].length;
            return { from, to, text: dueLink + lineText.slice(from, to).replace(DueDate.DUE_LINK, "") };
        }
        const id = lineText.match(DueDate.BLOCK_ID);
        const trimmed = lineText.slice(0, id ? id.index : lineText.length).trimEnd();
        let at = trimmed.length;
        for (;;) {
            const head = trimmed.slice(0, at).trimEnd();
            const last = [...head.matchAll(DueDate.NOTE_LINK)].pop();
            if (!last || last.index + last[0].length !== head.length) break;
            at = last.index;
        }
        if (at === trimmed.length) {
            if (id) return { from: trimmed.length, to: id.index, text: ` ${dueLink}` };
            return { from: lineText.length, to: lineText.length, text: `${lineText.endsWith(" ") || !lineText.length ? "" : " "}${dueLink} ` };
        }
        const before = trimmed.slice(0, at).trimEnd();
        return { from: before.length, to: at, text: ` ${dueLink} ` };
    }

    // Where a cursor at `ch` ends up after that change: on the same words, ahead of a 🚩 added right
    // where it is. One inside a replaced 🚩 goes to the start of the new one.
    cursorAfter(ch, { from, to, text }) {
        return ch <= from ? ch : ch < to ? from : ch + text.length - (to - from);
    }

    async invoke() {
        const { MarkdownView } = customJS.obsidian;
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) { new Notice("Need an active editor"); return; }
        if (view.file && customJS.TaskIds && !customJS.TaskIds.works(view.file)) return;

        const editor = view.editor;
        // On a sub-task, or any line under a task, the deadline is the task's: the line at the top of the nest
        // (rule 5, OBS-193). An event has none (rule 14), whatever its form.
        const cursor = editor.getCursor();
        const top = customJS.TimeReport.topOf((n) => editor.getLine(n), cursor.line);
        if (top.event) {
            new Notice("An event has no deadline, so none was set");
            return;
        }
        const lineNum = top.at;

        // Bail unless the line starts with a checklist box: "- [ ]", "- [x]", "- [>]", etc.
        if (top.box === null) {
            new Notice("Not on a checklist item");
            return;
        }

        const foldBefore = view.currentMode.getFoldInfo?.();

        const read = top.line;
        customJS.DatePrompt.open("Due date", ({ m }, modal) => {
            const lineText = editor.getLine(lineNum);
            // The date box waited on you: don't write into a line that changed meanwhile (rule 12)
            if (lineText !== read) {
                modal.close();
                new Notice("The line changed while the date box was open, so no deadline was set");
                return;
            }
            const change = this.placement(lineText, `[[${m.format("YYYY-MM-DD")}|🚩 ${m.format("M/D")}]]`);

            // Insert while the modal is still open — same order NLD uses
            editor.replaceRange(change.text, { line: lineNum, ch: change.from }, { line: lineNum, ch: change.to });
            // The cursor stays where it was, on the line or under it
            editor.setCursor(lineNum !== cursor.line ? cursor : { line: lineNum, ch: this.cursorAfter(cursor.ch, change) });
            modal.close();

            // Safety net: if the fold got dropped anyway, restore the pre-edit fold map
            setTimeout(() => {
                const wasFolded = foldBefore?.folds?.some(f => f.from === lineNum);
                const after = view.currentMode.getFoldInfo?.();
                const stillFolded = after?.folds?.some(f => f.from === lineNum);
                if (wasFolded && !stillFolded && view.currentMode.applyFoldInfo) {
                    view.currentMode.applyFoldInfo(foldBefore);
                }
            }, 50);
        });
    }
}
