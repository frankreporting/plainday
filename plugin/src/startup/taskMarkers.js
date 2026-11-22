import { app, plainday } from "../host.js";

export default class TaskMarkers {
    // Startup script (OBS-140): Plainday draws an event `[<]`, a forwarded task `[>]`, a started `[/]`, a
    // canceled `[-]` and a goal `[w]` with looks of their own, which every theme shows alike. The drawing
    // is all in styles.css, under the body class below; this only sets the class, on every window's body
    // (the main window's and each popout's), while Settings → Plainday → Editor → Draw task markers is on,
    // and removes it while it's off. Nothing runs as you type.
    //
    // The panel runs invoke() again on each change, and so do a paste and Sync's change to the settings,
    // so every open note follows at once. A popout opened later gets the class as it opens.

    static CLASS = "plainday-task-markers";

    // Every window's body: the main window's, through the workspace, and each popout's through its tabs
    bodies() {
        /** @type {Set<HTMLElement>} */
        const bodies = new Set([app.workspace.containerEl.doc.body]);
        app.workspace.iterateAllLeaves((leaf) => {
            const body = leaf.view?.containerEl?.doc?.body;
            if (body) bodies.add(body);
        });
        return bodies;
    }

    // Whether the switch is on; on until the settings say otherwise
    on() {
        return plainday.Settings?.get().editor.taskMarkers !== false;
    }

    async invoke() {
        const on = this.on();
        for (const body of this.bodies()) body.classList.toggle(TaskMarkers.CLASS, on);
        // One listener per load of Plainday, gone with it
        if (this.opened || !plainday.plugin) return;
        this.opened = app.workspace.on("window-open", (win) => {
            if (plainday.plugin) win.doc.body.classList.toggle(TaskMarkers.CLASS, this.on());
        });
        plainday.plugin.registerEvent(this.opened);
    }

    deconstructor() {
        if (this.opened) app.workspace.offref(this.opened);
        this.opened = null;
        for (const body of this.bodies()) body.classList.remove(TaskMarkers.CLASS);
    }
}
