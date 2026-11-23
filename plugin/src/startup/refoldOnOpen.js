import { app, plainday } from "../host.js";

/** @import { EventRef, TFile } from "obsidian" */
/**
 * The window, which holds this script's listeners so a second run can undo the first (and an earlier
 * version's single handle)
 * @typedef {Window & { refoldOnOpenRefs?: EventRef[] | null, refoldOnOpenRef?: EventRef | null }} HandleWindow
 */

export default class RefoldOnOpen {
    // Startup script: keeps daily notes folded as they're opened, and snapshots them as they're
    // left or Obsidian quits (see RefoldDailyNotes), on every device.
    async invoke() {
        // The handles live on window, so a second run undoes the first: a single set of listeners,
        // however often it runs (same as SyncArea)
        this.deconstructor();
        let current = app.workspace.getActiveFile();
        /** @type {HandleWindow} */ (window).refoldOnOpenRefs = [
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
        for (const ref of /** @type {HandleWindow} */ (window).refoldOnOpenRefs ?? []) app.workspace.offref(ref);
        if (/** @type {HandleWindow} */ (window).refoldOnOpenRef) app.workspace.offref(/** @type {HandleWindow} */ (window).refoldOnOpenRef);   // earlier version's handle
        /** @type {HandleWindow} */ (window).refoldOnOpenRefs = null;
        /** @type {HandleWindow} */ (window).refoldOnOpenRef = null;
    }

    /**
     * @param {"onOpen" | "onLeave" | "snapshotOpen"} method
     * @param {...(TFile | null)} args
     */
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
