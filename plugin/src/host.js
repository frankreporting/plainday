// What the class files get from Plainday, in place of what CustomJS gave them. The build imports
// these into every class file (plugin/esbuild.config.mjs):
//
// - `customJS`: Obsidian's module (`customJS.obsidian`), the app, and one instance of every class
//   by name (`customJS.Schedule`). The class files call each other through it. It's the same
//   object Plainday puts on `window.plainday` for the templates and for tools outside Obsidian,
//   which call a class by eval: `plainday.SnapshotDailyNotes.invoke()`.
// - `app`: the plugin's own app.
// - `loaded()` and `registerEditorExtension()`: the rewritten forms of the class files' two
//   CustomJS hooks, "is CustomJS still on?" and adding an editor extension through CustomJS.
//
// Each time Obsidian loads the plugin it runs main.js afresh, so a listener left over from an
// earlier load sees its own copy of this module, unbound, and `loaded()` tells it to stop.
import * as obsidian from "obsidian";

export const customJS = {};
export let app;
let plugin = null;

export function bind(p) {
    plugin = p;
    app = p.app;
    for (const k of Object.keys(customJS)) delete customJS[k];
    customJS.obsidian = obsidian;
    customJS.app = p.app;
    customJS.state = { _ready: false };
}

export function unbind() {
    plugin = null;
}

export function loaded() {
    return plugin !== null;
}

export function registerEditorExtension(extension) {
    if (!plugin) throw new Error("Plainday isn't loaded, so it can't add an editor extension");
    plugin.registerEditorExtension(extension);
}
