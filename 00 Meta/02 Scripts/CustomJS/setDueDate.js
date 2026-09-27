class DueDate {
    // Note links end a line (🗒️ task note or log, or 🔗 from before OBS-87, ⭕ project, 🗃️ area), so End reaches the note; the
    // due date goes in front of them (OBS-36). A phone may add or drop the U+FE0F on an emoji.
    static NOTE_LINK = /\[\[[^\]]*\|\s*(?:🗒|🔗|⭕|🗃)\uFE0F?\s*\]\]/gu;

    // Where the due link goes on `lineText`, and the text to insert there: right before the line's
    // trailing note links (with one space either side), else at the end
    placement(lineText, dueLink) {
        const trimmed = lineText.trimEnd();
        let at = trimmed.length;
        for (;;) {
            const head = trimmed.slice(0, at).trimEnd();
            const last = [...head.matchAll(DueDate.NOTE_LINK)].pop();
            if (!last || last.index + last[0].length !== head.length) break;
            at = last.index;
        }
        if (at === trimmed.length) {
            return { from: lineText.length, to: lineText.length, text: `${lineText.endsWith(" ") || !lineText.length ? "" : " "}${dueLink} ` };
        }
        const before = trimmed.slice(0, at).trimEnd();
        return { from: before.length, to: at, text: ` ${dueLink} ` };
    }

    async invoke() {
        const { Modal, TextComponent, MarkdownView } = customJS.obsidian;
        const nld = app.plugins.getPlugin("nldates-obsidian");
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        if (!nld || !view) { new Notice("Need NLD + an active editor"); return; }

        const editor = view.editor;
        const lineNum = editor.getCursor().line;

        // Bail unless the line starts with a checklist box: "- [ ]", "- [x]", "- [<]", etc.
        if (!/^\s*[-*+]\s+\[.\]/.test(editor.getLine(lineNum))) {
            new Notice("Not on a checklist item");
            return;
        }

        const foldBefore = view.currentMode.getFoldInfo?.();

        const modal = new Modal(app);
        modal.titleEl.setText("Due date");
        const input = new TextComponent(modal.contentEl);
        input.setValue("");
        input.inputEl.style.width = "100%";

        input.inputEl.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();

            const parsed = nld.parseDate(input.getValue());
            if (!parsed?.moment?.isValid()) { new Notice("Couldn't parse that date"); return; }
            const m = parsed.moment;

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

        // Focus once the modal is open and the hotkey's keydown is over; focusing straight after
        // open() fights the editor for focus, and the first key typed can land in the note (OBS-50)
        modal.onOpen = () => requestAnimationFrame(() => { input.inputEl.focus(); input.inputEl.select(); });
        modal.open();
    }
}
