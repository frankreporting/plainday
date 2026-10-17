class DueDate {
    // Note links end a line (🗒️ task note or log, or 🔗 from before OBS-87, ⭕ project, 🗃️ area), so End reaches the note; the
    // due date goes in front of them (OBS-36), and in front of a sent line's forward date (OBS-107): a
    // link to a periodic note's line with a date for its label, `[[2026-10-08#^k3x9m2|10/8]]`, or one
    // written with a ➡️ before its date. A task's ID stays last (OBS-181). A phone may add or drop the U+FE0F on an emoji.
    static NOTE_LINK = /\[\[[^\]]*\|\s*(?:🗒|🔗|⭕|🗃|➡)\uFE0F?[^\]]*\]\]|\[\[(?:[^\]|#]*\/)?(?:\d{4}-\d{2}-\d{2}|\d{4}w\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4})#\^[A-Za-z0-9-]+\|\s*(?:\d{1,2}\/\d{1,2}|Wk of \d{1,2}\/\d{1,2}|[^\s\]|]+ \d{4}|\d{4})\s*\]\]/gu;
    static BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/;

    // Where the due link goes on `lineText`, and the text to insert there: right before the line's
    // trailing note links and forward date (with one space either side), else at the end, ahead of an ID
    placement(lineText, dueLink) {
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

    async invoke() {
        const { MarkdownView } = customJS.obsidian;
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) { new Notice("Need an active editor"); return; }

        const editor = view.editor;
        const lineNum = editor.getCursor().line;

        // Bail unless the line starts with a checklist box: "- [ ]", "- [x]", "- [<]", etc.
        if (!/^\s*[-*+]\s+\[.\]/.test(editor.getLine(lineNum))) {
            new Notice("Not on a checklist item");
            return;
        }

        const foldBefore = view.currentMode.getFoldInfo?.();

        customJS.DatePrompt.open("Due date", ({ m }, modal) => {
            const lineText = editor.getLine(lineNum);
            const { from, to, text } = this.placement(lineText, `[[${m.format("YYYY-MM-DD")}|🚩 ${m.format("M/D")}]]`);

            // Insert while the modal is still open — same order NLD uses
            editor.replaceRange(text, { line: lineNum, ch: from }, { line: lineNum, ch: to });
            editor.setCursor({ line: lineNum, ch: editor.getLine(lineNum).length });
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
