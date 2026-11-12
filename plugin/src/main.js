// Plainday: the system's classes as one plugin.
//
// What Plainday does for the class files:
// - one instance of every class, by name: the build bundles the class files (plugin/esbuild.config.mjs)
//   and onload makes the instances, on the host's `customJS` (src/host.js);
// - a command for each class in the command list (src/commands.js);
// - the startup scripts' invoke(), one after the other, once the layout is ready;
// - a script that throws shows a notice and logs the error, and never stops the next one.
// Unloading the plugin runs every class's deconstructor(), so the listeners the startup scripts
// keep go with it. Obsidian itself removes the commands and editor extensions.
import { Notice, Plugin } from "obsidian";
import classes from "plainday:classes";
import { COMMANDS, STARTUP } from "./commands.js";
import { bind, customJS, unbind } from "./host.js";

export default class Plainday extends Plugin {
    onload() {
        bind(this);
        for (const Cls of classes) {
            try {
                customJS[Cls.name] = new Cls();
            } catch (e) {
                console.error(`Plainday: couldn't start ${Cls.name}`, e);
                continue;
            }
            customJS[`create${Cls.name}Instance`] = () => new Cls();
        }
        customJS.state._ready = true;
        // For the templates (Log.md, Task.md) and for tools outside Obsidian, which call a class by
        // eval: `plainday.SnapshotDailyNotes.invoke()`
        window.plainday = customJS;

        for (const c of COMMANDS) {
            this.addCommand({ id: c.id, name: c.name, callback: () => this.run(c.script) });
        }

        this.app.workspace.onLayoutReady(async () => {
            for (const name of STARTUP) {
                // Unloaded while an earlier one ran
                if (window.plainday !== customJS) return;
                await this.run(name);
            }
        });
    }

    onunload() {
        for (const [name, obj] of Object.entries(customJS)) {
            if (typeof obj?.deconstructor !== "function") continue;
            try {
                obj.deconstructor();
            } catch (e) {
                console.error(`Plainday: ${name}.deconstructor failed`, e);
            }
        }
        unbind();
        if (window.plainday === customJS) delete window.plainday;
    }

    async run(name) {
        const script = customJS[name];
        if (typeof script?.invoke !== "function") {
            console.warn(`Plainday: ${name} isn't a class with invoke()`);
            return;
        }
        try {
            await script.invoke();
        } catch (e) {
            new Notice(`Plainday: ${name} failed\n${e?.message ?? e}\nSee the developer console for details`);
            console.error(`Plainday: ${name} failed`, e);
        }
    }
}
