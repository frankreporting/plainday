import { MarkdownView, Notice } from "obsidian";
import { app, plainday } from "../host.js";

export default class ConvertToProject {
    // Turns the selected text into a project (OBS-123): makes it as New project does, straight in its folder at the
    // top of the Projects folder (ProjectNotes.make), without opening it, then swaps the selection for a link to
    // the new note, so you stay where you were. Move to project files it under an area afterwards (OBS-55).
    // A selection that can't name a project opens New project's name box with the text in it and the reason under
    // it; a name changed there links under the words you selected: [[New name|selected words]].
    async invoke() {
        const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (!editor) return;

        const selection = editor.getSelection();
        const title = selection.trim();
        if (!title) {
            new Notice("Select the text to turn into a project");
            return;
        }
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");

        const notes = plainday.ProjectNotes;
        let name = title;
        const why = notes.problem(title, "project");
        if (why) {
            name = await notes.ask("project", title.replace(/\s+/g, " "), why);
            if (name === null) return;
        }
        let file;
        try {
            file = await notes.make({ kind: "project", name });
        } catch (e) {
            console.error("ConvertToProject: couldn't make the project", e);
            new Notice(`Couldn't make the project: ${e.message}`);
            return;
        }

        const link = name === title || !this.labelable(title) ? `[[${file.basename}]]` : `[[${file.basename}|${title}]]`;
        if (editor.getRange(from, to) === selection) {
            // Keep any spaces that were selected around the name
            editor.replaceRange(selection.replace(title, link), from, to);
        } else {
            new Notice(`Made [[${file.basename}]], but the text changed, so the link wasn't put in`);
        }
    }

    // Whether `text` can be a link's label: not when it holds a line break, a | or brackets that would end the link
    labelable(text) {
        return !/[\r\n|]|\]\]|\[\[/.test(text);
    }
}
