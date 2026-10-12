class NewNoteGuard {
    // Startup script (OBS-171): keeps Templater's trigger for new notes off notes that aren't new.
    //
    // Templater ("Trigger Templater on new file creation") waits 300ms after Obsidian reports a new
    // file, then applies the file template (Get Template here) to any note whose body below the
    // properties is empty, unless the note is in its own set of files it's still writing. Two kinds of
    // note reach it that aren't new:
    //   - one that appears with its properties already there: delivered by Sync, moved in from
    //     outside, restored. A meeting log with no notes yet, or a person note with only properties,
    //     went through the templates on a phone catching up, and the Log template trashed one.
    //   - one a template has just made and moved: Templater lists it by the path it was made at, and
    //     checks the path it's at now, so the trigger runs the templates on it a second time.
    // For both, this lists the note in that set for a moment (HOLD_MS), by the path it's at, so
    // Templater skips it: no write, no notice. A note you make starts empty and isn't held. The Log
    // template and Plan hold their own notes the same way.
    //
    // If Templater ever renames the set, nothing here runs, and Get Template's own check
    // (tp.user.arrivedNote) stops the template instead: with Templater's error notice, and no write.
    //
    // A note made on this device starts empty, and some get their properties a moment later, before
    // Templater looks: a base's New button writes the ones its filters ask for. A note that arrives
    // never starts empty: Sync writes a downloaded note in one go, with its original times (Obsidian
    // 1.14), and a move or a restore brings its text along. So each note created empty here is noted
    // in window.newNoteGuardMadeHere, and Get Template's check lets those through.
    static HOLD_MS = 1500;
    // How long to wait for Templater to finish with a note it has just written before holding it
    static RELEASE_WAIT_MS = 3000;
    static POLL_MS = 25;
    // A note with only properties is small; a bigger file is left alone without reading it
    static MAX_SIZE = 65536;
    static FRONTMATTER = /^﻿?---\r?\n(?:[\s\S]*?\r?\n)?---[^\S\r\n]*(?:\r?\n|$)/;

    async invoke() {
        // CustomJS doesn't run deconstructors when the plugin itself reloads, so keep the handles on
        // window to guarantee a single listener of each (as SyncArea does)
        this.deconstructor();
        window.newNoteGuardRef = app.vault.on("create", (file) => this.onCreate(file));
        window.newNoteGuardTemplateRef = app.workspace.on("templater:new-note-from-template", (e) => this.onTemplated(e?.file));
    }

    deconstructor() {
        if (window.newNoteGuardRef) app.vault.offref(window.newNoteGuardRef);
        if (window.newNoteGuardTemplateRef) app.workspace.offref(window.newNoteGuardTemplateRef);
        window.newNoteGuardRef = window.newNoteGuardTemplateRef = null;
        // Holds an earlier run made aren't let go here: their own timers do it, so a rerun while
        // synced notes arrive (a script update among them) doesn't drop them early
    }

    // Whether a note's text is an existing note's rather than a new one's: it has properties and
    // nothing below them. A new note is empty. A note with text below its properties is left to
    // Templater, which then only runs any template commands in it (a daily note made by the Daily
    // notes plugin needs that). Templater/arrivedNote.js has the same rule for Get Template.
    static arrived(text) {
        const s = String(text ?? "");
        const m = s.match(NewNoteGuard.FRONTMATTER);
        return !!m && s.slice(m[0].length).trim() === "";
    }

    // Templater's set of files it's still writing, or null when Templater is off or has changed
    pending() {
        const set = app.plugins.plugins["templater-obsidian"]?.templater?.files_with_pending_templates;
        return ["has", "add", "delete"].every((m) => typeof set?.[m] === "function") ? set : null;
    }

    // Lists `path` in Templater's set for HOLD_MS, or for HOLD_MS more when this already holds it.
    // Only holds this made are ever taken off: an entry Templater (or a template) put there is
    // left alone.
    hold(path) {
        const pending = this.pending();
        if (!pending || !path) return;
        this.holds ??= new Map();
        if (!this.holds.has(path) && pending.has(path)) return;
        clearTimeout(this.holds.get(path));
        pending.add(path);
        this.holds.set(path, setTimeout(() => this.release(path), NewNoteGuard.HOLD_MS));
    }

    release(path) {
        if (!this.holds?.has(path)) return;
        clearTimeout(this.holds.get(path));
        this.holds.delete(path);
        this.pending()?.delete(path);
    }

    // A note appeared: held when it already has properties and nothing below them
    async onCreate(file) {
        // The listener outlives CustomJS being switched off, so check on every event
        if (!app.plugins.enabledPlugins.has("customjs")) return;
        if (file?.extension !== "md") return;
        // By the file itself, not its path: a new note is often renamed straight away
        if (file.stat?.size === 0) {
            (window.newNoteGuardMadeHere ??= new WeakSet()).add(file);
            return;
        }
        if (!file.stat?.size || file.stat.size > NewNoteGuard.MAX_SIZE) return;
        const pending = this.pending();
        if (!pending || (pending.has(file.path) && !this.holds?.has(file.path))) return;
        let text;
        try {
            text = await app.vault.cachedRead(file);
        } catch {
            return;
        }
        if (NewNoteGuard.arrived(text)) this.hold(file.path);
    }

    // Templater has written a template into a note (made from a template, or by its trigger): once it
    // has let the note go, hold it where it is now, through the trigger's 300ms check
    onTemplated(file) {
        if (!app.plugins.enabledPlugins.has("customjs") || !file?.path) return;
        const started = Date.now();
        const wait = () => {
            const pending = this.pending();
            if (!pending) return;
            if (pending.has(file.path) && !this.holds?.has(file.path)) {
                if (Date.now() - started < NewNoteGuard.RELEASE_WAIT_MS) setTimeout(wait, NewNoteGuard.POLL_MS);
                return;
            }
            this.hold(file.path);
        };
        // Templater lets go of a note it didn't open in the same turn as this event, so the first look
        // waits a microtask: the hold then lands with no gap (OBS-55: a template with no menu can finish
        // close to the trigger's 300ms check)
        queueMicrotask(wait);
    }
}
