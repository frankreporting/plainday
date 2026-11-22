// Plainday: the system's classes as one plugin.
//
// What Plainday does for the class files:
// - one instance of every class, by name, on the host's `plainday` (src/host.js): the classes the
//   three folders' indexes list, commands/, startup/ and shared/;
// - a command for each class in the command list, with its icon (src/commands/index.js);
// - the startup scripts' invoke(), one after the other, once the layout is ready, in the order
//   src/startup/index.js gives;
// - a script that throws shows a notice and logs the error, and never stops the next one;
// - its settings (shared/settings.js), loaded before any of that, and the panel that shows them in
//   Settings → Plainday (src/settingsTab.js).
// Unloading the plugin runs every class's deconstructor(), so the listeners the startup scripts
// keep go with it. Obsidian itself removes the commands and editor extensions.
import { Notice, Plugin } from "obsidian";
import { CLASSES as COMMAND_CLASSES, COMMANDS } from "./commands/index.js";
import { CLASSES as SHARED_CLASSES } from "./shared/index.js";
import { CLASSES as STARTUP_CLASSES, STARTUP } from "./startup/index.js";
import { bind, plainday, unbind } from "./host.js";
import PlaindaySettingTab from "./settingsTab.js";

/** @typedef {import("./host.js").ClassName} ClassName */

/** @type {Record<ClassName, new () => object>} */
const CLASSES = { ...COMMAND_CLASSES, ...STARTUP_CLASSES, ...SHARED_CLASSES };

/** @param {unknown} e An error's message, else the thing thrown, as a string */
const messageOf = (e) => {
    if (e instanceof Error) return e.message;
    if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") return e.message;
    if (typeof e === "string") return e;
    if (typeof e === "number" || typeof e === "boolean" || typeof e === "bigint") return String(e);
    if (e === null) return "null";
    if (e === undefined) return "undefined";
    // Anything else thrown, as data
    try { return JSON.stringify(e); } catch { return typeof e; }
};

/** @param {unknown} obj @param {string} method @returns {obj is Record<string, () => unknown>} */
const has = (obj, method) => typeof obj === "object" && obj !== null && typeof (/** @type {Record<string, unknown>} */ (obj))[method] === "function";

export default class Plainday extends Plugin {
    async onload() {
        bind(this);
        /** @type {Record<string, unknown>} */
        const registry = plainday;
        for (const [name, Cls] of Object.entries(CLASSES)) {
            try {
                registry[name] = new Cls();
            } catch (e) {
                console.error(`Plainday: couldn't start ${name}`, e);
            }
        }
        // For the templates and for tools outside Obsidian, which call a class by eval:
        // `plainday.SnapshotDailyNotes.invoke()`, CalNav's `plainday.EventLog.openLog(…)`
        window.plainday = plainday;

        // Before anything reads them; the defaults when they don't load
        await this.attempt("its settings", () => plainday.Settings.load());
        // Turned off while they loaded
        if (plainday.plugin !== this) return;

        for (const c of COMMANDS) {
            this.addCommand({ id: c.id, name: c.name, icon: c.icon, callback: () => this.run(c.script) });
        }

        this.addSettingTab(new PlaindaySettingTab(this.app, this));

        this.app.workspace.onLayoutReady(async () => {
            // Unloaded before the layout was ready
            if (window.plainday !== plainday) return;
            for (const name of STARTUP) {
                // Unloaded while an earlier one ran
                if (window.plainday !== plainday) return;
                await this.run(name);
            }
        });
    }

    onunload() {
        for (const [name, obj] of Object.entries(plainday)) {
            if (!has(obj, "deconstructor")) continue;
            try {
                obj.deconstructor();
            } catch (e) {
                console.error(`Plainday: ${name}.deconstructor failed`, e);
            }
        }
        unbind();
        if (window.plainday === plainday) delete window.plainday;
    }

    // Sync or another tool changed Plainday's data file
    async onExternalSettingsChange() {
        await this.attempt("its settings", () => plainday.Settings.reload());
    }

    /**
     * Runs `step`, and says so when it fails, without stopping what comes after
     * @param {string} what @param {() => Promise<void>} step
     */
    async attempt(what, step) {
        try {
            await step();
        } catch (e) {
            new Notice(`Plainday: ${what} failed\n${messageOf(e)}\nSee the developer console for details`);
            console.error(`Plainday: ${what} failed`, e);
        }
    }

    /** @param {string} name */
    async run(name) {
        /** @type {Record<string, unknown>} */
        const registry = plainday;
        const script = registry[name];
        if (!has(script, "invoke")) {
            console.warn(`Plainday: ${name} isn't a class with invoke()`);
            return;
        }
        try {
            await script.invoke();
        } catch (e) {
            new Notice(`Plainday: ${name} failed\n${messageOf(e)}\nSee the developer console for details`);
            console.error(`Plainday: ${name} failed`, e);
        }
    }
}
