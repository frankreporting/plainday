import { app, plainday } from "../host.js";

/** @import { EventRef, TFile } from "obsidian" */
/**
 * The window, which holds this script's listener so a second run can undo the first
 * @typedef {Window & { finishLinkedLogsRef?: EventRef | null }} HandleWindow
 */

export default class FinishLinkedLogs {
    // Startup script (OBS-122): a click on an event line's ⋯ link to a log that isn't made yet makes a blank note of
    // that name, which becomes the log at once (EventLog.finish): Plainday's properties, the Log template, and filed
    // in the `›logs` folder of the project or area the line names, else the Inbox. Only what's a fact, as
    // FinishPeriodicNotes does (Brian, 2026-11-20): a note made on this device in the last MADE_WITHIN_MS, named with
    // a day, spelled as the daily notes are named (EventLog.dayOf, OBS-300), and a title, still blank and not being
    // written by Templater HOLD_AFTER_MS later, which an event line in that day's note links with its ⋯. Any other
    // note is left to whatever made it: a note made from the quick switcher with no event line linking it, a log
    // CalNav or another plugin makes, one that arrives through Sync.
    static MADE_WITHIN_MS = 5000;
    static HOLD_AFTER_MS = 50;

    async invoke() {
        // The handle lives on window, so a second run undoes the first (as NewNoteGuard does)
        this.deconstructor();
        /** @type {HandleWindow} */ (window).finishLinkedLogsRef = app.vault.on("create", (/** @type {TFile} */ file) => this.onCreate(file));
    }

    deconstructor() {
        if (/** @type {HandleWindow} */ (window).finishLinkedLogsRef) app.vault.offref(/** @type {HandleWindow} */ (window).finishLinkedLogsRef);
        /** @type {HandleWindow} */ (window).finishLinkedLogsRef = null;
    }

    // `file` is anything the vault made: a folder has no extension, so it stops at the first check
    /**
     * @param {TFile} file
     * @param {number} [now]
     */
    onCreate(file, now = Date.now()) {
        // A listener left over from an earlier load of Plainday stops here: its `plainday.plugin` is gone
        if (!plainday.plugin || file?.extension !== "md") return null;
        if (file.stat?.size !== 0 || Math.abs(now - (file.stat?.ctime ?? 0)) > FinishLinkedLogs.MADE_WITHIN_MS) return null;
        if (!plainday.EventLog || plainday.EventLog.making.has(file.basename) || !plainday.EventLog.dayOf(file.basename)) return null;
        return this.later(file);
    }

    // Returns what happened, for tests: "finished" or null
    /**
     * @param {TFile} file
     * @returns {Promise<string | null>}
     */
    async later(file) {
        const notes = plainday.PeriodicNotes;
        await FinishLinkedLogs.sleep(FinishLinkedLogs.HOLD_AFTER_MS);
        if (!plainday.plugin || app.vault.getFileByPath(file.path) !== file || notes.pending()?.has(file.path)) return null;
        try {
            return await plainday.EventLog.finish(file);
        } catch (e) {
            console.error(`FinishLinkedLogs: couldn't finish ${file.path}`, e);
            return null;
        }
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    static sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
}
