// Plainday: the system's classes as one plugin.
//
// What Plainday does for the class files:
// - one instance of every class, by name, on the host's `plainday` (src/host.js): the classes the
//   three folders' indexes list, commands/, startup/ and shared/;
// - a command for each class in the command list, with its icon (src/commands/index.js);
// - the startup scripts' invoke(), one after the other, once the layout is ready, in the order
//   src/startup/index.js gives;
// - a script that throws shows a notice and logs the error, and never stops the next one.
// Unloading the plugin runs every class's deconstructor(), so the listeners the startup scripts
// keep go with it. Obsidian itself removes the commands and editor extensions.
import { Notice, Plugin } from "obsidian";
import { CLASSES as COMMAND_CLASSES, COMMANDS } from "./commands/index.js";
import { CLASSES as SHARED_CLASSES } from "./shared/index.js";
import { CLASSES as STARTUP_CLASSES, STARTUP } from "./startup/index.js";
import { bind, plainday, unbind } from "./host.js";

/** @typedef {import("./host.js").ClassName} ClassName */

/** @type {Record<ClassName, new () => object>} */
const CLASSES = { ...COMMAND_CLASSES, ...STARTUP_CLASSES, ...SHARED_CLASSES };

/** @param {unknown} obj @param {string} method @returns {obj is Record<string, () => unknown>} */
const has = (obj, method) => typeof obj === "object" && obj !== null && typeof (/** @type {Record<string, unknown>} */ (obj))[method] === "function";

export default class Plainday extends Plugin {
    onload() {
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
        // For the templates (Log.md, Task.md) and for tools outside Obsidian, which call a class by
        // eval: `plainday.SnapshotDailyNotes.invoke()`
        window.plainday = plainday;

        for (const c of COMMANDS) {
            this.addCommand({ id: c.id, name: c.name, icon: c.icon, callback: () => this.run(c.script) });
        }

        this.app.workspace.onLayoutReady(async () => {
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
            const message = /** @type {{ message?: unknown } | null | undefined} */ (e)?.message ?? e;
            new Notice(`Plainday: ${name} failed\n${String(message)}\nSee the developer console for details`);
            console.error(`Plainday: ${name} failed`, e);
        }
    }
}
