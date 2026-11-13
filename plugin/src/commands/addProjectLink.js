import { Notice } from "obsidian";
import { app, plainday } from "../host.js";

export default class AddProjectLink {

    // On a task or event line in a daily, weekly, monthly or yearly note: pick a project or area from the
    // menu, and the task follows (rules 8 and 9, TaskChange): the line's ⭕ or 🗃️, in the forms the time report
    // and the calendar sync read, on every line of the task, its note into that project, and its line in a
    // project note into that project's To Do. Esc cancels and nothing changes. The cursor stays where it was.
    // Anywhere else nothing changes, before the menu, and the notice says what to do instead.
    async invoke() {
        const helper = plainday.AddTaskNote, tasks = plainday.TaskIds, change = plainday.TaskChange;
        const editor = app.workspace.activeLeaf?.view?.editor;
        const source = app.workspace.getActiveFile();
        if (!helper || !editor || !source) return;
        if (!tasks.works(source)) return;

        // On a sub-task, or any line under a task or event, the project is the task's or event's: the line at
        // the top of the nest (rule 5, OBS-193)
        const cursor = editor.getCursor("from");
        const line = plainday.TimeReport.topOf((n) => editor.getLine(n), cursor.line).at;
        const lineText = editor.getLine(line);
        // A meeting line in the form used before August 2025 is an event too (rule 1)
        if ((!helper.constructor.CHECKBOX.test(lineText) && plainday.TimeReport.eventKind(lineText) !== "meeting") || helper.hiddenAt(editor, line)) {
            new Notice("Not on a checklist item");
            return;
        }
        if (tasks.kindOf(source) === "other") {
            new Notice(plainday.MoveToProject.isFolderNote(source)
                ? "A task moves from one of its days, or by cutting and pasting its line into the other project's To Do when nothing is attached to it"
                : "Run MoveToProject on this note: the note says the project, and its lines follow");
            return;
        }
        if (!change.ready()) return;

        const mover = plainday.MoveToProject;
        const home = await helper.pickHome(this.label(lineText), { exclude: (f) => !mover.isFolderNote(f) });
        if (!home) return helper.cancelled();
        // The menu waited on you; don't write into a line that changed in the meantime
        if (editor.getLine(line) !== lineText) {
            new Notice("The line changed while picking a project, so nothing was linked");
            return;
        }

        const found = await change.find({ file: source, at: line });
        const done = await change.run(found, home, { name: this.label(lineText), stale: () => editor.getLine(line) !== lineText });
        if (!done.done) return;
        if (!done.wrote && !done.moved.length && !done.toDo.length && !done.failed.length) new Notice(`Already linked to ${home.basename}`);
        helper.keepCursor(editor, cursor, line, lineText);
    }

    // The line with `link` as its one ⭕ or 🗃️, before the note link that ends it, or at the end with no
    // trailing space. Any in the run of links that ends it come off; one in its text is part of the title.
    placed(lineText, link) {
        const helper = plainday.AddTaskNote;
        return helper.withHome(lineText, link, helper.trailingProjectLinks(lineText).map((l) => l.raw), { inRun: true });
    }

    // What to call the line in the menu: its text after the checkbox and an event's time, with
    // symbol links left out and any other link read as its alias
    label(lineText) {
        const helper = plainday.AddTaskNote;
        const { EVENT_TIME } = helper.constructor;
        return lineText.slice(helper.afterCheckbox(lineText))
            .replace(helper.constructor.BLOCK_ID, "")
            .replace(EVENT_TIME, "")
            .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/gu, (m, target, alias) => {
                const shown = (alias ?? target).trim();
                return /^(?:⋯|↗|⭕|🗃|🚩)/u.test(shown) ? "" : shown;
            })
            .replace(/\s+/g, " ").trim();
    }
}
