// What the class files get from Plainday, by import: `import { app, plainday } from "../host.js";`
//
// - `app`: the plugin's own app.
// - `plainday`: one instance of every class by name (`plainday.Schedule`), which the class files
//   call each other through, plus:
//   - `plainday.app`: the app;
//   - `plainday.obsidian`: Obsidian's module, for scripts sent into Obsidian by eval, which have no
//     other way to reach it (CalNav's Open Log Note calls `plainday.obsidian.normalizePath`). The
//     class files import it instead;
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
import * as obsidian from "obsidian";

// The calendar reader's background worker, as the text of a script: plugin/src/worker/ with ical.js,
// which the build bundles on its own and puts in here (plugin/esbuild.config.mjs). CalendarFeed
// starts a worker from it for each read (OBS-274).
export { default as calendarWorkerSource } from "plainday:calendar-worker";

// chrono-node's English, which DateWords reads typed dates with (OBS-139). Only English: the build
// leaves chrono-node's other languages out of main.js.
export * as chronoEn from "chrono-node/en";

/**
 * @typedef {typeof import("./commands/index.js").CLASSES} CommandClasses
 * @typedef {typeof import("./startup/index.js").CLASSES} StartupClasses
 * @typedef {typeof import("./shared/index.js").CLASSES} SharedClasses
 * @typedef {CommandClasses & StartupClasses & SharedClasses} Classes
 * @typedef {keyof Classes} ClassName
 * @typedef {{ [K in ClassName]: InstanceType<Classes[K]> & { constructor: Classes[K] } } & {
 *   app: PlaindayApp,
 *   obsidian: typeof obsidian,
 *   plugin: import("obsidian").Plugin | null,
 * }} Registry
 *
 * Each instance's `constructor` is its class, so a class's static members read through it
 * (`plainday.TaskIds.constructor.idOf`) have their types too.
 */

// Obsidian's features that its published types don't describe, as Plainday uses them (OBS-320).
// `app`'s type adds them, so a class file reads them like any other part of the app; the other types
// a class file imports by name, in a comment: `/** @import { FoldView } from "../host.js" */`. Each
// says what the code already expects there. Nothing here is checked when Plainday runs: the code
// keeps its own checks (`?.`, `typeof … === "function"`) for a feature that's gone or has changed.
/** @import { App, Editor, MarkdownView, MenuItem, MetadataCache, TAbstractFile, TFile, TFolder, Vault, View, Workspace } from "obsidian" */
/** @import { EditorView } from "@codemirror/view" */
/** @import { Extension } from "@codemirror/state" */
/** @import { Moment } from "moment" */
/** @import MomentLib from "moment" */
/** @import { ParsedResult } from "chrono-node" */
/**
 * Moment.js's function, which Obsidian hands over as `moment`. Obsidian's types import Moment.js as a
 * namespace, which the directory's scan reads as a function returning anything (it reads the code
 * with `esModuleInterop`, as jsconfig.json does), so each call casts `moment` to this type in a
 * comment first: `(moment)(date, "YYYY-MM-DD", true)` with the cast before the parentheses.
 * @typedef {typeof MomentLib} MomentFn
 *
 * A folded range in a note, by line, and a note's folds as Obsidian saves them on each device, which
 * it ignores once `lines` no longer matches the note:
 * @typedef {{ from: number, to: number }} Fold
 * @typedef {{ folds: Fold[], lines: number }} FoldInfo
 * @typedef {{ load(file: TFile): FoldInfo | null, save(file: TFile, info: FoldInfo): Promise<void> }} FoldManager
 *
 * A Markdown view's mode reads and sets the folds it shows:
 * @typedef {MarkdownView & { currentMode: MarkdownView["currentMode"] & { getFoldInfo?: () => FoldInfo | null, applyFoldInfo?: (info: FoldInfo) => void } }} FoldView
 *
 * The editor a Markdown view shows, with its CodeMirror view:
 * @typedef {Editor & { cm: EditorView }} CmEditor
 *
 * Any view, which may be a Markdown view (`app.workspace.activeLeaf?.view`):
 * @typedef {View & Partial<Pick<MarkdownView, "editor" | "file" | "save">>} SomeView
 *
 * The core plugins' options Plainday reads: Daily notes' (and whether it's on) and Templates':
 * @typedef {{ format?: string, folder?: string, template?: string }} DailyNotesOptions
 * @typedef {{ folder?: string, dateFormat?: string, timeFormat?: string }} TemplatesOptions
 * @typedef {{ plugins?: { "daily-notes"?: { enabled?: boolean, instance?: { options?: DailyNotesOptions } }, templates?: { instance?: { options?: TemplatesOptions } } } }} InternalPlugins
 *
 * Templater's own object: the notes it's still writing, and how it writes a template into a note:
 * @typedef {{ files_with_pending_templates?: Set<string>, write_template_to_file(template: TFile, file: TFile): Promise<void> }} Templater
 * @typedef {{ templater?: Templater }} TemplaterPlugin
 *
 * Notebook Navigator's API: its folder and tag looks and pins, its menus, and what's selected in it:
 * @typedef {{
 *   getFolderMeta?(folder: TFolder): unknown,
 *   setFolderMeta?(folder: TFolder, meta: Record<string, string>): Promise<void>,
 *   getTagMeta?(tag: string): Record<string, string> | null | undefined,
 *   pin?(file: TFile, context: string): Promise<void>,
 *   isPinned?(file: TFile, context: string): boolean,
 * }} NavigatorMetadata
 * @typedef {(build: (item: MenuItem) => void) => void} AddMenuItem
 * @typedef {{
 *   registerFileMenu(add: (menu: { addItem: AddMenuItem, file: TFile, selection?: { files?: TFile[] } }) => void): () => void,
 *   registerFolderMenu(add: (menu: { addItem: AddMenuItem, folder: TFolder }) => void): () => void,
 * }} NavigatorMenus
 * @typedef {{ metadata?: NavigatorMetadata, menus?: NavigatorMenus, selection?: { getCurrent?(): { files?: TAbstractFile[] } | null } }} NavigatorApi
 * @typedef {{ api?: NavigatorApi, settings?: Record<string, unknown> }} NavigatorPlugin
 *
 * A date reader with Natural Language Dates (Revived)'s three answers: the plugin itself, or
 * Plainday's own (DateWords.at). A period is "day", "week", "month", "quarter" or "year", from its
 * first day.
 * @typedef {{ date: Date, granularity: string }} ParsedPeriod
 * @typedef {{
 *   parseDate(text: string): { moment: Moment },
 *   parser?: {
 *     getParsedPeriod?(text: string, weekStart?: unknown): ParsedPeriod | null,
 *     getParsedDateResult?(text: string, ref?: Date, opts?: { forwardDate?: boolean }): Date | null,
 *     getParsedResult?(text: string): ParsedResult[],
 *   },
 *   settings?: { weekStart?: unknown },
 * }} DateReader
 *
 * The community plugins, by id; Templater, Notebook Navigator and Revived as Plainday reads them:
 * @typedef {{
 *   getPlugin(id: "templater-obsidian"): TemplaterPlugin | null,
 *   getPlugin(id: "notebook-navigator"): NavigatorPlugin | null,
 *   getPlugin(id: "nldates-revived"): Partial<DateReader> | null,
 *   getPlugin(id: string): unknown,
 *   plugins: { "templater-obsidian"?: TemplaterPlugin, "notebook-navigator"?: NavigatorPlugin } & Record<string, unknown>,
 *   enabledPlugins: Set<string>,
 * }} CommunityPlugins
 *
 * The app as Plainday uses it: what a value saved on the device holds is up to its reader (unknown),
 * the vault finds a path whatever its case, the workspace holds the editor extensions plugins
 * register, and the metadata cache says whether it's still indexing the vault.
 * @typedef {Omit<App, "loadLocalStorage" | "vault" | "workspace" | "metadataCache"> & {
 *   loadLocalStorage(key: string): unknown,
 *   vault: Vault & { getAbstractFileByPathInsensitive?(path: string): TAbstractFile | null },
 *   workspace: Workspace & { editorExtensions?: Extension[] },
 *   metadataCache: MetadataCache & { initialized?: boolean, inProgressTaskCount?: number, onCleanCache?(callback: () => void): void },
 *   foldManager: FoldManager,
 *   internalPlugins?: InternalPlugins,
 *   plugins: CommunityPlugins,
 *   isMobile: boolean,
 * }} PlaindayApp
 */

/** @type {Registry} */
export const plainday = /** @type {Registry} */ ({});
/** @type {PlaindayApp} */
export let app;

/** @param {import("obsidian").Plugin} p */
export function bind(p) {
    // The app with the features its published types leave out (PlaindayApp)
    app = /** @type {PlaindayApp} */ (/** @type {unknown} */ (p.app));
    for (const k of Object.keys(plainday)) delete plainday[/** @type {keyof Registry} */ (k)];
    plainday.app = /** @type {PlaindayApp} */ (/** @type {unknown} */ (p.app));
    plainday.obsidian = obsidian;
    plainday.plugin = p;
}

export function unbind() {
    plainday.plugin = null;
}
