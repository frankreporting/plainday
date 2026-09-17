class DueDate {
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
            let link = `[[${m.format("YYYY-MM-DD")}|🚩 ${m.format("M/D")}]] `;
            if (!lineText.endsWith(" ")) link = " " + link;

            // Insert while the modal is still open — same order NLD uses
            editor.setCursor({ line: lineNum, ch: lineText.length });
            editor.replaceSelection(link);
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

        modal.open();
        input.inputEl.focus();
        input.inputEl.select();
    }
}
