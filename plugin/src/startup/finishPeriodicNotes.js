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
    // - Templater's trigger for new notes would run Get Template on an empty one 300 ms after it appears.
    //   Get Template has no route for a periodic note, so its catch-all would give it `id` and `tags`: the
    //   trigger is kept off every empty one, one that arrived included, unless Templater is writing it itself.
    // - It's finished as soon as nothing else will write to it (Brian, 2026-11-20: the alias shouldn't
    //   hesitate). HOLD_AFTER_MS after it appears, whatever made it has written what it writes in one go, and
    //   Templater has started on it if it's making it from a template (Navigator's calendar with Templater
    //   code does, through create_new_note_from_template). Then:
    //   - Templater writing it: once it says it's done ("templater:new-note-from-template"), up to GIVE_UP_MS,
    //     since a template can ask questions. Templater writes the whole note, so anything sooner would go.
    //   - It holds Templater code: once Templater's trigger has run it ("templater:overwrite-file"), up to
    //     TRIGGER_WAIT_MS; with the trigger off, the code stays and the note is left as it is.
    //   - Otherwise at once, with the trigger kept off it, which would only read and write it again.
    static MADE_WITHIN_MS = 5000;
    static HOLD_AFTER_MS = 50;
    static TRIGGER_WAIT_MS = 1000;
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
        if (Math.abs(now - (file.stat?.ctime ?? 0)) <= FinishPeriodicNotes.MADE_WITHIN_MS) return this.later(file);
        // One that arrived isn't finished, but an empty one is kept from Templater's trigger all the same
        if (file.stat?.size === 0) {
            setTimeout(() => {
                if (!notes.pending()?.has(file.path)) notes.hold(file.path);
            }, FinishPeriodicNotes.HOLD_AFTER_MS);
        }
        return null;
    }

    async later(file) {
        const notes = plainday.PeriodicNotes;
        await FinishPeriodicNotes.sleep(FinishPeriodicNotes.HOLD_AFTER_MS);
        if (!plainday.plugin || !app.vault.getFileByPath(file.path)) return null;
        try {
            if (notes.pending()?.has(file.path)) {
                await this.templaterDone(file, "templater:new-note-from-template", FinishPeriodicNotes.GIVE_UP_MS);
            } else if ((await app.vault.read(file)).includes("<%")) {
                await this.templaterDone(file, "templater:overwrite-file", FinishPeriodicNotes.TRIGGER_WAIT_MS);
            } else {
                notes.hold(file.path);
            }
            if (!plainday.plugin) return null;
            return await notes.finish(file);
        } catch (e) {
            console.error(`FinishPeriodicNotes: couldn't finish ${file.path}`, e);
            return null;
        }
    }

    // Resolves when Templater says it has written `file` (its workspace event `name`), or after `ms`
    templaterDone(file, name, ms) {
        return new Promise((resolve) => {
            let ref = null;
            const done = () => {
                clearTimeout(timer);
                if (ref) app.workspace.offref(ref);
                resolve();
            };
            const timer = setTimeout(done, ms);
            ref = app.workspace.on(name, (e) => {
                if (e?.file === file || e?.file?.path === file.path) done();
            });
        });
    }

    static sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
