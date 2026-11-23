import { Notice } from "obsidian";
import { app, plainday } from "../host.js";

/** @import { EventRef, TAbstractFile } from "obsidian" */
/** @import { AddMenuItem, NavigatorApi } from "../host.js" */
/**
 * What a run added, so the next run can take it off: Obsidian's listeners, what takes the items off
 * Notebook Navigator's menus, the API they went to, and the retry waiting for it.
 * @typedef {{ refs: EventRef[], offs: (() => void)[], api: NavigatorApi | null, timer: number | null }} MenuState
 *
 * The window, which holds them
 * @typedef {Window & { moveToProjectMenu?: MenuState | null }} HandleWindow
 */
export default class MoveToProjectMenu {
    // Startup script: puts *Move to project…* (MoveToProject's move) in the menus that act on files:
    //   - Notebook Navigator's menu for a note, or for several selected, and for a project or area's
    //     folder, through its API, since it builds its own menus;
    //   - Obsidian's own file menus: a tab's "…" menu, a link's right-click menu (for notes only,
    //     not a project a ⭕ points at), and the core file explorer's menus for one file or several.
    // An item only appears for something MoveToProject moves.
    static TITLE = "Move to project…";
    static ICON = "folder-input";
    // Notebook Navigator can finish loading after Plainday runs its startup scripts
    static RETRY_MS = 1000;
    static TRIES = 30;

    async invoke() {
        // The handles live on window, so a second run undoes the first: one set of menu items, however
        // often it runs
        this.deconstructor();
        /** @type {MenuState} */
        const state = { refs: [], offs: [], api: null, timer: null };
        /** @type {HandleWindow} */ (window).moveToProjectMenu = state;
        state.refs.push(
            app.workspace.on("file-menu", (menu, file, source) => this.add((build) => menu.addItem(build), [file], { homes: source !== "link-context-menu" })),
            app.workspace.on("files-menu", (menu, files) => this.add((build) => menu.addItem(build), files)),
            // Notebook Navigator switched on, reloaded or updated later has a new API without our items
            app.workspace.on("layout-change", () => this.addToNavigator(state, 1)),
        );
        this.addToNavigator(state, MoveToProjectMenu.TRIES);
    }

    deconstructor() {
        const state = /** @type {HandleWindow} */ (window).moveToProjectMenu;
        if (!state) return;
        for (const ref of state.refs) app.workspace.offref(ref);
        for (const off of state.offs) off();
        window.clearTimeout(state.timer);
        /** @type {HandleWindow} */ (window).moveToProjectMenu = null;
    }

    // Registers the items with Notebook Navigator's current API, once per API object; retries
    // `tries - 1` more times while it isn't there yet
    /**
     * @param {MenuState} state
     * @param {number} tries
     */
    addToNavigator(state, tries) {
        if (/** @type {HandleWindow} */ (window).moveToProjectMenu !== state || !app.plugins.enabledPlugins.has("notebook-navigator")) return;
        const api = app.plugins.plugins["notebook-navigator"]?.api;
        if (api && api === state.api) return;
        if (!api?.menus) {
            // A layout change (tries 1) leaves a pending retry running
            if (tries > 1) {
                window.clearTimeout(state.timer);
                state.timer = window.setTimeout(() => this.addToNavigator(state, tries - 1), MoveToProjectMenu.RETRY_MS);
            }
            return;
        }
        window.clearTimeout(state.timer);
        for (const off of state.offs) off();
        state.offs = [
            api.menus.registerFileMenu(({ addItem, file, selection }) => this.add(addItem, selection?.files?.length ? selection.files : [file])),
            api.menus.registerFolderMenu(({ addItem, folder }) => this.add(addItem, [folder])),
        ];
        state.api = api;
    }

    // Adds the item through `addItem` (a menu's, or Notebook Navigator's) when MoveToProject would
    // move any of `files`. Menus are built synchronously; the move runs on the click.
    /**
     * @param {AddMenuItem} addItem
     * @param {TAbstractFile[]} files
     * @param {{ homes?: boolean }} [options]
     */
    add(addItem, files, { homes = true } = {}) {
        // A listener left over from an earlier load of Plainday stops here: its `plainday.plugin` is gone
        if (!plainday.plugin) return;
        const mover = plainday.MoveToProject;
        if (!mover || !files.length || !mover.movable(files, { homes })) return;
        addItem((item) => item.setTitle(MoveToProjectMenu.TITLE).setIcon(MoveToProjectMenu.ICON).onClick(() => {
            plainday.MoveToProject.move(files).catch((/** @type {Error} */ e) => {
                console.error("MoveToProject failed", e);
                new Notice(`Move to project failed: ${e.message}`);
            });
        }));
    }
}
