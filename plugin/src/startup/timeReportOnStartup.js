import { Platform } from "obsidian";
import { app, plainday } from "../host.js";

export default class TimeReportOnStartup {
    // Startup script, desktop only: refreshes the time reports (see TimeReport) once Obsidian has
    // loaded and finished indexing the vault, so the project notes and timesheets are current after
    // every launch. To see fresh numbers after logging time, reload Obsidian, or run
    // "Plainday: Time report". The phone doesn't run it: it gets the updated notes through Sync, so
    // two devices never rewrite the same blocks. Nothing is written when the numbers haven't changed.
    static INDEX_WAIT_MS = 60000;
    // How long a run gives the classes it needs to be there. Plainday makes every class before the
    // startup scripts run, so one that's missing is one Plainday couldn't start.
    static READY_WAIT_MS = 5000;
    // Billing reads the invoice notes for the project timesheets (OBS-5)
    static NEEDS = ["TimeReport", "Schedule", "Billing", "TaskIds"];

    async invoke() {
        if (!Platform.isDesktop) return;
        await new Promise((resolve) => app.workspace.onLayoutReady(resolve));
        // Before indexing finishes, no note looks like a project and every entry would be Unassigned
        if (!(await this.indexed())) {
            console.warn("TimeReportOnStartup: the vault was still indexing after a minute; skipped");
            return;
        }
        // Plainday can be turned off or reloaded while this waits
        if (!plainday.plugin) return;
        const missing = await this.missing();
        if (missing.length) {
            // A class that failed to start needs fixing, and the console says why
            const names = missing.map((name) => `plainday.${name}`).join(" and ");
            console.warn(`TimeReportOnStartup: ${names} ${missing.length === 1 ? "isn't" : "aren't"} registered (Plainday couldn't start it: see the error above); skipped`);
            return;
        }
        await plainday.TimeReport.refresh({ quiet: true });
    }

    // Resolves true once the metadata cache is clean, or false after INDEX_WAIT_MS
    async indexed() {
        const cache = app.metadataCache;
        const clean = typeof cache.onCleanCache === "function"
            ? new Promise((resolve) => cache.onCleanCache(() => resolve(true)))
            : (async () => {
                // Fallback if Obsidian drops onCleanCache: poll its own indexing state
                while (!(cache.initialized && !cache.inProgressTaskCount)) await new Promise((r) => setTimeout(r, 250));
                return true;
            })();
        const timeout = new Promise((resolve) => setTimeout(() => resolve(false), TimeReportOnStartup.INDEX_WAIT_MS));
        return Promise.race([clean, timeout]);
    }

    // The classes in NEEDS that plainday still lacks after up to READY_WAIT_MS of polling
    async missing() {
        const missing = () => TimeReportOnStartup.NEEDS.filter((name) => !plainday?.[name]);
        const deadline = Date.now() + TimeReportOnStartup.READY_WAIT_MS;
        while (missing().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
        return missing();
    }
}
