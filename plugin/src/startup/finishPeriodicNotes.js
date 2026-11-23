import { app, plainday } from "../host.js";

export default class FinishPeriodicNotes {
    // Startup script (OBS-120): finishes every daily, weekly, monthly and yearly note made on this device some
    // other way than by Plainday's own commands (which finish theirs as they make them, PeriodicNotes.ensure):
    // Notebook Navigator's calendar, the Daily notes plugin's command, a click on a link to a missing day, a date
    // typed as a new note's title. Nothing here guesses whether another plugin is done with a note (Brian,
    // 2026-11-20, after three review rounds found a new corner in each guess). Two kinds:
    // - Made blank, and not being written by Templater HOLD_AFTER_MS later: nothing else writes to it. Navigator
    //   writes a calendar note in one go, empty without a template, or has Templater make it, which lists the note
    //   as in progress from the moment it's made; the Daily notes plugin and a link click write it in one go too.
    //   It's finished at once (PeriodicNotes.finish): held from Templater's trigger, filed in its folder when it
    //   was made elsewhere, that kind of note's template, its alias.
    // - Written into by whatever made it (its template), or being made by Templater: left alone while it's made,
    //   and its alias is added when you leave it, when another note opens: whatever made it has finished, and
    //   you aren't typing in it. Never filed or templated: its maker did that. One Templater still lists, or that
    //   still holds Templater code, waits for the next time you leave it. Only notes made here while Plainday runs.
    // A note made just now has a creation time within MADE_WITHIN_MS. A note Sync brings keeps the creation time it
    // had on the other device, and a restored or copied-in note keeps its own, so they aren't finished. But an
    // empty one is still held from Templater's trigger: Get Template has no route for a periodic note, so its
    // catch-all would give it `id` and `tags`.
    static MADE_WITHIN_MS = 5000;
    static HOLD_AFTER_MS = 50;

    constructor() {
        // Notes their maker wrote into, made here since Plainday started, waiting for you to leave them
        this.waiting = new Set();
    }

    async invoke() {
        // The handles live on window, so a second run undoes the first (as NewNoteGuard does)
        this.deconstructor();
        window.finishPeriodicNotesCreateRef = app.vault.on("create", (file) => this.onCreate(file));
        window.finishPeriodicNotesOpenRef = app.workspace.on("file-open", (file) => this.onOpen(file));
    }

    deconstructor() {
        // `finishPeriodicNotesRef` is a build's from before the leave rule
        for (const key of ["finishPeriodicNotesCreateRef", "finishPeriodicNotesRef"]) {
            if (window[key]) app.vault.offref(window[key]);
            window[key] = null;
        }
        if (window.finishPeriodicNotesOpenRef) app.workspace.offref(window.finishPeriodicNotesOpenRef);
        window.finishPeriodicNotesOpenRef = null;
    }

    onCreate(file, now = Date.now()) {
        // A listener left over from an earlier load of Plainday stops here: its `plainday.plugin` is gone
        if (!plainday.plugin || file?.extension !== "md") return null;
        const notes = plainday.PeriodicNotes;
        if (!notes || notes.making.has(file.path)) return null;
        try {
            if (!notes.periodOfName(file.basename)) return null;
        } catch {
            return null;
        }
        if (Math.abs(now - (file.stat?.ctime ?? 0)) <= FinishPeriodicNotes.MADE_WITHIN_MS) return this.later(file);
        // One that arrived isn't finished, but an empty one is kept from Templater's trigger all the same
        if (file.stat?.size === 0) {
            window.setTimeout(() => {
                if (!notes.pending()?.has(file.path)) notes.hold(file.path);
            }, FinishPeriodicNotes.HOLD_AFTER_MS);
        }
        return null;
    }

    // Returns what happened, for tests: "finished", "left", "waiting" or null
    async later(file) {
        const notes = plainday.PeriodicNotes;
        await FinishPeriodicNotes.sleep(FinishPeriodicNotes.HOLD_AFTER_MS);
        if (!plainday.plugin || app.vault.getFileByPath(file.path) !== file) return null;
        try {
            if (!notes.pending()?.has(file.path) && (await app.vault.read(file)).trim() === "") {
                notes.hold(file.path);
                return await notes.finish(file);
            }
            this.waiting.add(file);
            return "waiting";
        } catch (e) {
            console.error(`FinishPeriodicNotes: couldn't finish ${file.path}`, e);
            return null;
        }
    }

    // Another note opened: every note waiting for you to leave it, but the one opened, gets its alias
    onOpen(opened) {
        if (!plainday.plugin || !this.waiting?.size) return [];
        const runs = [];
        for (const file of [...this.waiting]) {
            if (file === opened) continue;
            this.waiting.delete(file);
            runs.push(this.left(file).catch((e) => {
                console.error(`FinishPeriodicNotes: couldn't finish ${file.path}`, e);
                return null;
            }));
        }
        return runs;
    }

    // Returns what happened, for tests: "finished", "later" (waiting again), "left" (not a periodic note where
    // it is now) or "gone"
    async left(file) {
        const notes = plainday.PeriodicNotes;
        if (app.vault.getFileByPath(file.path) !== file) return "gone";
        const rules = plainday.DatePrompt.weekRules();
        const period = notes.periodOfName(file.basename, rules);
        if (!period || notes.where(period.unit, period.date, rules).path !== file.path) return "left";
        if (notes.pending()?.has(file.path) || (await app.vault.read(file)).includes("<%")) {
            this.waiting.add(file);
            return "later";
        }
        await notes.addAlias(file, notes.alias(period.unit, period.date, rules));
        return "finished";
    }

    static sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
}
