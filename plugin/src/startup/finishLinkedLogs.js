import { app, plainday } from "../host.js";

export default class FinishLinkedLogs {
    // Startup script (OBS-122): a click on an event line's ⋯ link to a log that isn't made yet makes a blank note of
    // that name, which becomes the log at once (MeetingLog.finish): Plainday's properties, the Log template, and filed
    // in the `›logs` folder of the project or area the line names, else the Inbox. Only what's a fact, as
    // FinishPeriodicNotes does (Brian, 2026-11-20): a note made on this device in the last MADE_WITHIN_MS, named with
    // a day and a title, still blank and not being written by Templater HOLD_AFTER_MS later, which an event line in
    // that day's note links with its ⋯. Any other note is left to whatever made it: a note made from the quick
    // switcher with no event line linking it, a log CalNav or another plugin makes, one that arrives through Sync.
    static MADE_WITHIN_MS = 5000;
    static HOLD_AFTER_MS = 50;
    // A log's name: a day, then a title
    static NAME = /^\d{4}-\d{2}-\d{2} \S/;

    async invoke() {
        // The handle lives on window, so a second run undoes the first (as NewNoteGuard does)
        this.deconstructor();
        window.finishLinkedLogsRef = app.vault.on("create", (file) => this.onCreate(file));
    }

    deconstructor() {
        if (window.finishLinkedLogsRef) app.vault.offref(window.finishLinkedLogsRef);
        window.finishLinkedLogsRef = null;
    }

    onCreate(file, now = Date.now()) {
        // A listener left over from an earlier load of Plainday stops here: its `plainday.plugin` is gone
        if (!plainday.plugin || file?.extension !== "md" || !FinishLinkedLogs.NAME.test(file.basename)) return null;
        if (plainday.MeetingLog?.making.has(file.basename)) return null;
        if (file.stat?.size !== 0 || Math.abs(now - (file.stat?.ctime ?? 0)) > FinishLinkedLogs.MADE_WITHIN_MS) return null;
        return this.later(file);
    }

    // Returns what happened, for tests: "finished" or null
    async later(file) {
        const notes = plainday.PeriodicNotes;
        await FinishLinkedLogs.sleep(FinishLinkedLogs.HOLD_AFTER_MS);
        if (!plainday.plugin || app.vault.getFileByPath(file.path) !== file || notes.pending()?.has(file.path)) return null;
        try {
            return await plainday.MeetingLog.finish(file);
        } catch (e) {
            console.error(`FinishLinkedLogs: couldn't finish ${file.path}`, e);
            return null;
        }
    }

    static sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
