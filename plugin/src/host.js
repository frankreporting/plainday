// What the class files get from Plainday. The build imports these into every class file
// (plugin/esbuild.config.mjs):
//
// - `customJS`: one instance of every class by name (`customJS.Schedule`), which the class files
//   call each other through, and what they need from Obsidian:
//   - `customJS.obsidian`: Obsidian's module;
//   - `customJS.codemirror`: Obsidian's CodeMirror, as `.view`, `.state` and `.language`, for the
//     editor features (TrailingLinks, ListCursor, CheckOff);
//   - `customJS.app`: the app;
//   - `customJS.plugin`: Plainday itself while it's loaded, and null once it unloads. The editor
//     features add their extensions through it, and a listener checks it before it acts.
//   It's the same object Plainday puts on `window.plainday` for the templates and for tools
//   outside Obsidian, which call a class by eval: `plainday.SnapshotDailyNotes.invoke()`.
// - `app`: the plugin's own app.
//
// Obsidian provides its own module and CodeMirror's to every plugin, so the build leaves them out
// of main.js, as plugins do. Each time Obsidian loads the plugin it runs main.js afresh, so a
// listener left over from an earlier load sees its own copy of this module, whose
// `customJS.plugin` is null once that load unbinds, and stops.
import * as obsidian from "obsidian";
// Names no class file uses, so the bundle keeps the classes' own `view` and `state`
import * as codemirrorView from "@codemirror/view";
import * as codemirrorState from "@codemirror/state";
import * as codemirrorLanguage from "@codemirror/language";

export const customJS = {};
export let app;

export function bind(p) {
    app = p.app;
    for (const k of Object.keys(customJS)) delete customJS[k];
    customJS.obsidian = obsidian;
    customJS.codemirror = { view: codemirrorView, state: codemirrorState, language: codemirrorLanguage };
    customJS.app = p.app;
    customJS.plugin = p;
    customJS.state = { _ready: false };
}

export function unbind() {
    customJS.plugin = null;
}
