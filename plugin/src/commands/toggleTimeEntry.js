import { FuzzySuggestModal, Keymap, MarkdownView, moment, Notice } from "obsidian";
import { app, plainday } from "../host.js";

/** @import { EditorPosition, Editor, TFile } from "obsidian" */
/** @import { FoldView, MomentFn, SomeView } from "../host.js" */
/** @import TimeReport from "./timeReport.js" */
/** @import { Toggle } from "./timeReport.js" */
/**
 * A dropdown item: a line of a note, the words it shows, the note, its text when read and how many
 * days before today its date is.
 * @typedef {{ line: number, label: string }} LineItem
 * @typedef {LineItem & { file: TFile, text: string, daysAgo: number }} Choice
 *
 * A suggest modal's list of items, which Obsidian's types leave out:
 * @typedef {{ chooser: { useSelectedItem(evt: KeyboardEvent): void } }} WithChooser
 */
export default class ToggleTimeEntry {
    // The "Toggle time entry" command, on ⌘ T. On or under a task or event it starts a time entry
    // ("- 9:01am - ") after its sub-bullets, or fills in the end time on its running one (the entry
    // on the cursor's line wins; with several, a dropdown asks which). Anywhere else, in reading
    // view, or with no note in front, a dropdown: running timers in any daily note (today's first,
    // then newest day first), then today's open tasks and events.
    // Timers start only in today's daily note; on a task anywhere else, ⌘ T opens the dropdown of today's
    // note instead (stops work anywhere).
    // Starting a timer on an open task marks it started ([ ] becomes [/], and stays after the stop).
    // A stop that would make an entry of 12 hours or more goes to the entry instead, to type its end
    // time. In a dropdown, ⌘ ↵ goes to the item's line (in the current tab) without toggling it.
    // The logic, with its tests, is in TimeReport (toggleEntry, runningChoices, taskChoices,
    // toggleText, lineCursor, foldsAfterInsert).
    async invoke() {
        const report = plainday.TimeReport;
        const now = () => /** @type {MomentFn} */ (moment)().format("h:mma");
        const view = app.workspace.getActiveViewOfType(MarkdownView);
        // In reading view the cursor is hidden, so that goes to the dropdown too
        const editor = view?.getMode() === "source" ? view.editor : null;

        let file = view?.file ?? null, text = null, line = -1, picked = false;
        let daysAgo = this.daysAgo(file), canStart = this.canStart(file);
        let /** @type {Toggle} */ r = { pick: true };
        if (editor) {
            text = editor.getValue();
            line = editor.getCursor().line;
            r = report.toggleEntry(report.lines(text), line, now(), daysAgo, canStart);
        }
        if (r.pick) {
            const items = await this.choices(report);
            if (!items.length) { new Notice("No running timers, and nothing open in today's daily note"); return; }
            // On a task outside today's daily note, where a timer wouldn't count, say why the dropdown opened
            const choice = await this.pick(items, r.elsewhere ? "Timers start in today's daily note: pick a task or timer" : "Start or stop a timer");
            if (!choice) return;
            ({ file, text, line, daysAgo } = choice.item);
            canStart = this.canStart(file);
            if (choice.go) return this.goTo(file, report.lineCursor(report.lines(text), line));
            picked = true;
        }
        r = report.toggleEntry(report.lines(text), line, now(), daysAgo, canStart);
        if (r.choose) {
            const choice = await this.pick(r.choose, "Which timer?");
            if (!choice) return;
            line = choice.item.line;
            if (choice.go) return this.goTo(file, report.lineCursor(report.lines(text), line));
        }
        // The time is read once any dropdown has closed
        const time = now();
        r = report.toggleEntry(report.lines(text), line, time, daysAgo, canStart);
        if (r.error) { new Notice(r.error); return; }
        if (r.jump) { new Notice(r.summary); return this.goTo(file, r.jump); }
        if (!r.action) return;
        if (!(await this.write(report, file, text, line, time, daysAgo, canStart, r, !picked))) {
            new Notice("The note changed while you were choosing; try again");
            return;
        }
        if (picked) new Notice(r.summary);
    }

    // How many days before today a daily note's date is; 0 for any other note
    /**
     * @param {TFile | null} file
     * @returns {number}
     */
    daysAgo(file) {
        if (!file || !plainday.Schedule.isDailyNote(file)) return 0;
        const { format } = plainday.Schedule.dailyOpts();
        return /** @type {MomentFn} */ (moment)().startOf("day").diff(/** @type {MomentFn} */ (moment)(file.basename, format, true), "days");
    }

    // Whether a timer can start in this note: only in today's daily note. The time report reads only
    // daily notes and dates each entry by its note, so a timer anywhere else would be lost or misdated.
    /**
     * @param {TFile | null} file
     * @returns {boolean}
     */
    canStart(file) {
        return !!file && plainday.Schedule.isDailyNote(file) && this.daysAgo(file) === 0;
    }

    // [{ file, text, line, daysAgo, label }]: running timers in every daily note, today's first
    // and then newest day first, followed by today's open tasks and events
    /**
     * @param {TimeReport} report
     * @returns {Promise<Choice[]>}
     */
    async choices(report) {
        const days = app.vault.getMarkdownFiles()
            .filter((f) => plainday.Schedule.isDailyNote(f))
            .map((file) => ({ file, daysAgo: this.daysAgo(file) }))
            .sort((a, b) => a.daysAgo - b.daysAgo);
        // An open note's text is a string, which Promise.all passes through as it is
        const texts = await Promise.all(days.map((d) => /** @type {Promise<string>} */ (this.textOf(d.file))));

        const /** @type {Choice[]} */ todays = [], /** @type {Choice[]} */ others = [], /** @type {Choice[]} */ tasks = [];
        days.forEach((d, i) => {
            const text = texts[i];
            // Most notes have no running entry; skip the ones without anything like a start time
            if (d.daysAgo !== 0 && !/\d:\d\d\s?[ap]m\s*[-–—]/i.test(text)) return;
            const lines = report.lines(text);
            const at = (/** @type {LineItem} */ item) => ({ ...item, file: d.file, text, daysAgo: d.daysAgo });
            if (d.daysAgo === 0) {
                todays.push(...report.runningChoices(lines).map(at));
                tasks.push(...report.taskChoices(lines).map(at));
            } else {
                others.push(...report.runningChoices(lines, plainday.Dates.day(/** @type {MomentFn} */ (moment)().subtract(d.daysAgo, "days"))).map(at));
            }
        });
        // Future notes (negative daysAgo) sort ahead of today; timers there are unlikely, but go last
        others.sort((a, b) => (a.daysAgo < 0) - (b.daysAgo < 0));
        return [...todays, ...others, ...tasks];
    }

    // A type-to-filter dropdown of { label } items. Resolves to { item, go } (go: picked with ⌘ ↵,
    // to go to its line), or null.
    /**
     * @template {LineItem} T
     * @param {T[]} items
     * @param {string} placeholder
     * @returns {Promise<{ item: T, go: boolean } | null>}
     */
    pick(items, placeholder) {
        return new Promise((resolve) => {
            let chosen = false;
            const modal = new (class extends FuzzySuggestModal {
                getItems() { return items; }
                /** @param {T} item */
                getItemText(item) { return item.label; }
                /**
                 * @param {T} item
                 * @param {MouseEvent | KeyboardEvent} evt
                 */
                onChooseItem(item, evt) { chosen = true; resolve({ item, go: !!evt && !!Keymap.isModEvent(evt) }); }
                // Obsidian closes the modal before it reports the choice
                onClose() { window.setTimeout(() => { if (!chosen) resolve(null); }, 0); }
            })(app);
            modal.setPlaceholder(placeholder);
            modal.setInstructions([{ command: "↵", purpose: "toggle" }, { command: "⌘ ↵", purpose: "go to line" }]);
            modal.scope.register(["Mod"], "Enter", (evt) => { /** @type {typeof modal & WithChooser} */ (modal).chooser.useSelectedItem(evt); return false; });
            modal.open();
        });
    }

    // Opens the note in the current tab (unless it's already in front, in editing view) and puts
    // the cursor at `pos`, unfolding only what hides that line
    /**
     * @param {TFile} file
     * @param {EditorPosition} pos
     */
    async goTo(file, pos) {
        let /** @type {FoldView | null} */ view = app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file !== file || view.getMode() !== "source") {
            const leaf = app.workspace.getLeaf(false);
            await leaf.openFile(file, { active: true, state: { mode: "source" } });
            view = /** @type {FoldView} */ (leaf.view);
            // A daily note refolds as it opens (RefoldOnOpen); let that finish before unfolding
            await plainday.RefoldDailyNotes?.onOpen(file);
        }
        const info = view.currentMode.getFoldInfo?.();
        if (info) {
            const folds = info.folds.filter((f) => !(f.from < pos.line && pos.line <= f.to));
            if (folds.length !== info.folds.length) view.currentMode.applyFoldInfo({ folds, lines: info.lines });
        }
        view.editor.setCursor(pos);
        view.editor.scrollIntoView({ from: pos, to: pos }, true);
        view.editor.focus();
    }

    // The note as write() will see it: an editing view's text, else the file
    /**
     * @param {TFile} file
     * @returns {string | Promise<string>}
     */
    textOf(file) {
        return this.editorOf(file)?.getValue() ?? app.vault.cachedRead(file);
    }

    /**
     * @param {TFile} file
     * @returns {Editor | undefined}
     */
    editorOf(file) {
        return app.workspace.getLeavesOfType("markdown").map((l) => /** @type {SomeView & Partial<Pick<MarkdownView, "getMode">>} */ (l.view))
            .find((v) => v?.file === file && v.editor && v.getMode?.() === "source")?.editor;
    }

    // Writes the edit through the note's editor when it's open in editing view (the editor keeps its
    // own folds), else in one read-modify-write that moves the saved folds to match. A view in
    // reading view still has an editor, but an edit there never reaches the file (seen 2026-09-15).
    // False, writing nothing, when the note no longer matches `text`.
    /**
     * @param {TimeReport} report
     * @param {TFile} file
     * @param {string} text
     * @param {number} line
     * @param {string} time
     * @param {number} daysAgo
     * @param {boolean} canStart
     * @param {Toggle} r
     * @param {boolean} moveCursor
     * @returns {Promise<boolean>}
     */
    async write(report, file, text, line, time, daysAgo, canStart, r, moveCursor) {
        const editor = this.editorOf(file);
        if (editor) {
            if (editor.getValue() !== text) return false;
            // [ ] becomes [/] on a start; the line keeps its length, so the edit below stays put
            if (r.status) editor.setLine(r.status.line, r.status.text);
            const e = r.edit;
            if (e.from) {
                editor.replaceRange(e.text, e.from, e.to);
                if (moveCursor) editor.setCursor(e.cursor);
            } else {
                editor.setLine(e.line, e.text);
                if (moveCursor) editor.setCursor({ line: e.line, ch: e.text.length });
            }
            return true;
        }
        let result = /** @type {(Toggle & { content?: string }) | null} */ (null);
        await app.vault.process(file, (raw) => {
            // vault.read drops a byte order mark that process still passes in
            const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
            if (raw.slice(bom.length) !== text) return raw;
            result = report.toggleText(text, line, time, daysAgo, canStart);
            return result.content ? bom + result.content : raw;
        });
        if (!result?.content) return false;
        const before = report.lines(text), after = report.lines(result.content);
        const saved = app.foldManager.load(file);
        if (saved && saved.lines === before.length && after.length > before.length) {
            const folds = report.foldsAfterInsert(saved.folds, before, result.edit.from.line, after[result.edit.from.line + 1]);
            await app.foldManager.save(file, { folds, lines: after.length });
        }
        return true;
    }
}
