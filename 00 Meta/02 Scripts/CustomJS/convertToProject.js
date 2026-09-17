class ConvertToProject {
    // Turns the selected text into a project, replacing the old QuickAdd "Convert to project"
    // choice: creates a note named after the selection in 10 Inbox from the Project template,
    // whose picker asks for the parent area or project and moves the note into a new project
    // folder there, then swaps the selection for a link to the new note.
    async invoke() {
        const { MarkdownView } = customJS.obsidian;
        const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (!editor) return;

        const selection = editor.getSelection();
        const title = selection.trim();
        if (!title) {
            new Notice("Select the text to turn into a project");
            return;
        }
        // Characters that can't appear in a file name or a wikilink
        if (/[\\/:*?"<>|#^[\]\n]/.test(title)) {
            new Notice("A project name can't contain \\ / : * ? \" < > | # ^ [ ] or line breaks");
            return;
        }
        if (app.metadataCache.getFirstLinkpathDest(title, "")) {
            new Notice(`A note named "${title}" already exists`);
            return;
        }

        const templater = app.plugins.plugins["templater-obsidian"]?.templater;
        const template = app.vault.getAbstractFileByPath("00 Meta/01 Templates/Project.md");
        if (!templater || !template) {
            new Notice("Needs Templater and 00 Meta/01 Templates/Project.md");
            return;
        }

        const from = editor.getCursor("from");
        const to = editor.getCursor("to");

        // Resolves once the template (including its picker) has finished; the note may have
        // been moved and renamed by then, so link to wherever it ended up.
        const file = await templater.create_new_note_from_template(template, "10 Inbox", title, false);
        if (!file) return;

        const link = `[[${file.basename}]]`;
        if (editor.getRange(from, to) === selection) {
            // Keep any spaces that were selected around the name
            editor.replaceRange(selection.replace(title, link), from, to);
        } else {
            new Notice(`Created ${link}, but the text changed, so the link wasn't inserted`);
        }
    }
}
