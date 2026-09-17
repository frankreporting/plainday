class TimeReportOnStartup {
    // Startup script, desktop only: refreshes the time reports (see TimeReport) once Obsidian has
    // loaded and finished indexing the vault, so Projects.md and the project notes are current after
    // every launch. To see fresh numbers after logging time, reload Obsidian, or run
    // "CustomJS: TimeReport". The phone doesn't run it: it gets the updated notes through Sync, so
    // two devices never rewrite the same blocks. Nothing is written when the numbers haven't changed.
    static INDEX_WAIT_MS = 60000;

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
}
