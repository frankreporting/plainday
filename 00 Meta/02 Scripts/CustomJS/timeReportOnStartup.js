class TimeReportOnStartup {
    // Startup script, desktop only: refreshes the time reports (see TimeReport) once Obsidian has
    // loaded and finished indexing the vault, so the project notes and timesheets are current after
    // every launch. To see fresh numbers after logging time, reload Obsidian, or run
    // "CustomJS: TimeReport". The phone doesn't run it: it gets the updated notes through Sync, so
    // two devices never rewrite the same blocks. Nothing is written when the numbers haven't changed.
    static INDEX_WAIT_MS = 60000;
    // Saving a script while Obsidian is open makes CustomJS start `customJS` over, register the
    // classes again one file at a time, and run the startup scripts again. A run that was waiting
    // above can wake up in the middle of that, so it gives the classes it needs a moment to come back.
    static READY_WAIT_MS = 5000;
    // Billing reads the invoice notes for the project timesheets (OBS-5)
    static NEEDS = ["TimeReport", "Schedule", "Billing"];

    async invoke() {
        if (!customJS.obsidian.Platform.isDesktop) return;
        await new Promise((resolve) => app.workspace.onLayoutReady(resolve));
        // Before indexing finishes, no note looks like a project and every entry would be Unassigned
        if (!(await this.indexed())) {
            console.warn("TimeReportOnStartup: the vault was still indexing after a minute; skipped");
            return;
        }
        // CustomJS can be switched off while this waits
        if (!app.plugins.enabledPlugins.has("customjs")) return;
        const missing = await this.missing();
        if (missing.length) {
            // The rerun that follows a reload refreshes anyway; a script that failed to load needs fixing
            const names = missing.map((name) => `customJS.${name}`).join(" and ");
            console.warn(`TimeReportOnStartup: ${names} ${missing.length === 1 ? "isn't" : "aren't"} registered (CustomJS still reloading, or the script didn't load); skipped`);
            return;
        }
        await customJS.TimeReport.refresh({ quiet: true });
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

    // The classes in NEEDS that customJS still lacks after up to READY_WAIT_MS of polling
    async missing() {
        const missing = () => TimeReportOnStartup.NEEDS.filter((name) => !globalThis.customJS?.[name]);
        const deadline = Date.now() + TimeReportOnStartup.READY_WAIT_MS;
        while (missing().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
        return missing();
    }
}
