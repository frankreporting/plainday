import { app, plainday } from "../host.js";

export default class FinishPeriodicNotes {
    // Startup script (OBS-120): finishes every daily, weekly, monthly and yearly note made on this device,
    // however it was made: Notebook Navigator's calendar, the Daily notes plugin's command, a click on a link
    // to a missing day, a date typed as a new note's title. Once whatever made it is done, Plainday files it
    // in its folder when it was made elsewhere with nothing in it, runs that kind of note's template on it
    // when it has nothing in it, and adds its alias when it lacks one (PeriodicNotes.finish). The notes
    // Plainday's own commands make are finished as they're made (PeriodicNotes.ensure).
    // - A note made just now: its creation time is within MADE_WITHIN_MS. A note Sync brings keeps the
    //   creation time it had on the other device, and a restored or copied-in note keeps its own, so they're
    //   left alone.
    // - Templater's trigger for new notes would run Get Template on an empty one 300 ms after it appears, so
    //   it's kept off every empty one, arrived or made here, that Templater isn't writing itself (a note
    //   Navigator makes through Templater is). Get Template never sees a periodic note.
    // - Done means SETTLE_MS have passed, past the trigger's look, and Templater isn't writing it, up to
    //   GIVE_UP_MS. Templater combines what it writes with the note as it is then, so the alias stays.
    static MADE_WITHIN_MS = 5000;
    static HOLD_AFTER_MS = 50;
    static SETTLE_MS = 800;
    static POLL_MS = 100;
    static GIVE_UP_MS = 10000;

    async invoke() {
        // The handle lives on window, so a second run undoes the first (as NewNoteGuard does)
        this.deconstructor();
        window.finishPeriodicNotesRef = app.vault.on("create", (file) => this.onCreate(file));
    }

    deconstructor() {
        if (window.finishPeriodicNotesRef) app.vault.offref(window.finishPeriodicNotesRef);
        window.finishPeriodicNotesRef = null;
    }

    onCreate(file, now = Date.now()) {
        // A listener left over from an earlier load of Plainday stops here: its `plainday.plugin` is gone
        if (!plainday.plugin || file?.extension !== "md") return null;
        const notes = plainday.PeriodicNotes;
        if (!notes || notes.making.has(file.path)) return null;
        try {
            if (!notes.periodOfName(file.basename)) return null;
        } catch (e) {
            return null;
        }
        // Get Template has no route for a periodic note, so its catch-all would give an empty one `id` and
        // `tags`: Templater's trigger is kept off every empty one, one that arrived through Sync too
        if (file.stat?.size === 0) {
            setTimeout(() => {
                if (!notes.pending()?.has(file.path)) notes.hold(file.path);
            }, FinishPeriodicNotes.HOLD_AFTER_MS);
        }
        if (Math.abs(now - (file.stat?.ctime ?? 0)) > FinishPeriodicNotes.MADE_WITHIN_MS) return null;
        return this.later(file);
    }

    async later(file) {
        const notes = plainday.PeriodicNotes;
        const started = Date.now();
        await FinishPeriodicNotes.sleep(FinishPeriodicNotes.SETTLE_MS);
        while (notes.templaterBusy(file.path) && Date.now() - started < FinishPeriodicNotes.GIVE_UP_MS) {
            await FinishPeriodicNotes.sleep(FinishPeriodicNotes.POLL_MS);
        }
        if (!plainday.plugin) return null;
        try {
            return await notes.finish(file);
        } catch (e) {
            console.error(`FinishPeriodicNotes: couldn't finish ${file.path}`, e);
            return null;
        }
    }

    static sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
