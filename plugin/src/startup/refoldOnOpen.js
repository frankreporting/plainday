import { app, plainday } from "../host.js";

export default class RefoldOnOpen {
    // Startup script: keeps daily notes folded as they're opened, and snapshots them as they're
    // left or Obsidian quits (see RefoldDailyNotes), on every device.
    async invoke() {
        // The handles live on window, so a second run undoes the first: a single set of listeners,
        // however often it runs (same as SyncArea)
        this.deconstructor();
        let current = app.workspace.getActiveFile();
        window.refoldOnOpenRefs = [
            app.workspace.on("file-open", (file) => {
                const left = current;
                current = file;
                if (left && left !== file) this.run("onLeave", left);
                this.run("onOpen", file);
            }),
            app.workspace.on("quit", () => this.run("snapshotOpen")),
        ];
        // The note restored at launch opened before these listeners existed
        this.run("onOpen", current);
    }

    deconstructor() {
        for (const ref of window.refoldOnOpenRefs ?? []) app.workspace.offref(ref);
        if (window.refoldOnOpenRef) app.workspace.offref(window.refoldOnOpenRef);   // earlier version's handle
        window.refoldOnOpenRefs = null;
        window.refoldOnOpenRef = null;
    }

    run(method, ...args) {
        // A listener left over from an earlier load of Plainday stops here: its `plainday.plugin` is gone
        if (!plainday.plugin) return;
        const log = (e) => console.error(`RefoldOnOpen: ${method} failed`, e);
        try {
            Promise.resolve(plainday.RefoldDailyNotes?.[method](...args)).catch(log);
        } catch (e) {
            log(e);
        }
    }
}
