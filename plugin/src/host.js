// What the class files get from Plainday, by import: `import { app, plainday } from "../host.js";`
//
// - `app`: the plugin's own app.
// - `plainday`: one instance of every class by name (`plainday.Schedule`), which the class files
//   call each other through, plus:
//   - `plainday.app`: the app;
//   - `plainday.plugin`: Plainday itself while it's loaded, and null once it unloads. The editor
//     features add their extensions through it, and a listener checks it before it acts.
//   It's the same object Plainday puts on `window.plainday` for the templates and for tools
//   outside Obsidian, which call a class by eval: `plainday.SnapshotDailyNotes.invoke()`.
//
// No class file imports another (plugin/classShape.mjs), so there's no import cycle, though many
// call each other both ways: they reach each other here, at run time, once Plainday has made them.
// They import what they need from Obsidian and CodeMirror themselves, which Obsidian provides to
// every plugin, so the build leaves them out of main.js.
//
// Each time Obsidian loads the plugin it runs main.js afresh, so a listener left over from an
// earlier load sees its own copy of this module, whose `plainday.plugin` is null once that load
// unbinds, and stops.

/**
 * @typedef {typeof import("./commands/index.js").CLASSES} CommandClasses
 * @typedef {typeof import("./startup/index.js").CLASSES} StartupClasses
 * @typedef {typeof import("./shared/index.js").CLASSES} SharedClasses
 * @typedef {CommandClasses & StartupClasses & SharedClasses} Classes
 * @typedef {keyof Classes} ClassName
 * @typedef {{ [K in ClassName]: InstanceType<Classes[K]> } & {
 *   app: import("obsidian").App,
 *   plugin: import("obsidian").Plugin | null,
 * }} Registry
 */

/** @type {Registry} */
export const plainday = /** @type {Registry} */ ({});
/** @type {import("obsidian").App} */
export let app;

/** @param {import("obsidian").Plugin} p */
export function bind(p) {
    app = p.app;
    for (const k of Object.keys(plainday)) delete plainday[/** @type {keyof Registry} */ (k)];
    plainday.app = p.app;
    plainday.plugin = p;
}

export function unbind() {
    plainday.plugin = null;
}
