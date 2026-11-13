import { editorLivePreviewField } from "obsidian";
import { keymap } from "@codemirror/view";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { foldedRanges } from "@codemirror/language";
import { app, plainday } from "../host.js";

export default class ListCursor {
    // Startup script (OBS-221): on a list line in Live Preview, the cursor rests after the bullet or
    // checkbox, never in front of them, so a drawn checkbox doesn't turn back into `- [ ]`. The idea is
    // Outliner's "Stick the cursor to the content" setting (github.com/vslinko/obsidian-outliner, MIT).
    // This is written fresh: it reads only the cursor's own line, and moves the cursor in the same step.
    //   - The marker is what comes before a list line's text: the indent, the bullet or number, and the
    //     checkbox. A plain cursor that would land in it goes to the start of the text instead, whatever
    //     put it there: a click, Cmd-← or Home, an arrow key, or a write from outside Obsidian (OBS-68).
    //   - ← and Option-← at the start of the text go to the end of the line above, skipping the marker
    //     as → does on the way back. A folded line counts as one line, whatever it hides.
    //   - A selection and two or more cursors are left alone, so Shift-arrows can still reach a marker,
    //     and so is Source mode. Backspace and Delete stay Obsidian's own.
    //   - A line is read on its own: `- ` in a code block, the properties or a table cell counts as a
    //     list line, and `> - ` doesn't.
    //
    // It needs Obsidian's own CodeMirror, which Plainday passes in, as TrailingLinks does.

    // A list line's marker. A checkbox only counts with a space after it, so one being typed by hand
    // (`- []`, with the cursor between the brackets) isn't pushed past.
    static MARKER = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?/;

    // Where a list line's text starts, or null on a line that isn't a list line
    static textStart(text) {
        return text.match(ListCursor.MARKER)?.[0].length ?? null;
    }

    // Where ← arriving at `pos` stops. Folded lines have no row of their own, so a fold's end belongs
    // to the line the fold hangs from: it starts at that line's end. `folds` is CodeMirror's foldedRanges.
    static rowEnd(folds, pos) {
        let end = pos;
        folds.between(pos, pos, (from, to) => { if (to === pos) end = Math.min(end, from); });
        return end;
    }

    // The way back: from the very end of a folded line, the end of what it hides
    static foldEnd(folds, pos) {
        let end = pos;
        folds.between(pos, pos, (from, to) => { if (from === pos) end = Math.max(end, to); });
        return end;
    }

    async invoke() {
        // The handles live on window, so a second run undoes the first: one copy running, however
        // often it runs
        this.deconstructor();
        const L = ListCursor;
        const ws = app.workspace;

        // One registered slot per load of Plainday; a rerun swaps what's in it
        const kept = window.pmListCursor;
        const slot = kept?.slot && ws.editorExtensions?.includes?.(kept.slot) ? kept.slot : null;
        const handles = { slot: slot ?? [] };
        window.pmListCursor = handles;
        if (!slot) plainday.plugin.registerEditorExtension(handles.slot);

        // Whether `selection` is one plain cursor, in Live Preview
        const plain = (selection, s) => selection.ranges.length === 1 && selection.main.empty && s.field(editorLivePreviewField, false);

        // Runs on every cursor move and edit, so it looks at one line and stops there. It keeps the
        // column ↑ and ↓ remember, so the next one goes back to the column they started from.
        const stick = EditorState.transactionFilter.of((tr) => {
            if (!tr.docChanged && !tr.selection) return tr;
            const selection = tr.newSelection;
            if (!plain(selection, tr.startState)) return tr;
            const { head, assoc, goalColumn } = selection.main;
            const line = tr.newDoc.lineAt(head);
            const start = L.textStart(line.text);
            if (start === null || head >= line.from + start) return tr;
            return [tr, { selection: EditorSelection.create([EditorSelection.cursor(line.from + start, assoc, undefined, goalColumn)]), sequential: true }];
        });

        // ← and Option-← at the start of the text go where ← goes from the very start of the line, so
        // the note's first line works as it does on a plain line. Without this the key would land in
        // the marker and be pushed straight back. Above a folded line that spot is on the last hidden
        // line, drawn beside the "…" and left of the links, so any line goes to the folded line's end
        // instead. The cursor leans left there, or it's drawn beside the "…" all the same.
        const left = (v) => {
            const { state: s } = v;
            if (!plain(s.selection, s)) return false;
            const { head } = s.selection.main;
            const line = s.doc.lineAt(head);
            const start = L.textStart(line.text);
            if (head !== line.from + (start ?? 0)) return false;
            const above = v.moveByChar(EditorSelection.cursor(line.from), false);
            const end = L.rowEnd(foldedRanges(s), above.head);
            if (start === null && end === above.head) return false;
            const assoc = end === above.head ? above.assoc : -1;
            v.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(end, assoc)]), scrollIntoView: true, userEvent: "select" });
            return true;
        };
        // → and Option-→ from the very end of a folded line go past what it hides, as ← came
        const right = (v) => {
            const { state: s } = v;
            if (!plain(s.selection, s)) return false;
            const { head } = s.selection.main;
            const end = L.foldEnd(foldedRanges(s), head);
            if (end === head || end === s.doc.length) return false;
            v.dispatch({ selection: { anchor: end + 1 }, scrollIntoView: true, userEvent: "select" });
            return true;
        };
        const keys = Prec.highest(keymap.of([
            { key: "ArrowLeft", run: left },
            { key: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", run: left },
            { key: "ArrowRight", run: right },
            { key: "Mod-ArrowRight", mac: "Alt-ArrowRight", run: right },
        ]));

        handles.slot.length = 0;
        handles.slot.push(stick, keys);
        ws.updateOptions();
    }

    deconstructor() {
        const handles = window.pmListCursor;
        if (!handles) return;
        // The slot stays registered for the next run to fill
        handles.slot.length = 0;
        app.workspace.updateOptions();
    }
}
