class CalendarSyncRange {
    // Command: choose how far ahead to sync, then sync. The choice is written into the Calendar
    // Sync note as `Sync range:`, so the plain *Calendar sync* command (and anything running it
    // from a shell or a schedule) uses it without ever waiting on a prompt. You can also just
    // edit that line in the note.
    async invoke() {
        const { Modal, DropdownComponent } = customJS.obsidian;
        const sync = customJS.CalendarSync;
        if (!sync) { new Notice("CalendarSync isn't loaded"); return; }

        const ranges = sync.ranges();
        const current = await sync.rangeLabel();
        const modal = new Modal(app);
        modal.titleEl.setText("Sync how far ahead?");

        const dropdown = new DropdownComponent(modal.contentEl);
        for (const [label] of ranges) dropdown.addOption(label, label);
        dropdown.setValue(current);
        dropdown.selectEl.style.width = "100%";

        const run = async (label) => {
            modal.close();
            await sync.setRange(label);
            try {
                new Notice(await sync.run());
            } catch (e) {
                console.error("CalendarSync:", e);
                new Notice(`Calendar sync failed: ${e.message}`);
            }
        };

        // Number keys pick a range outright; Enter takes whatever the dropdown shows
        ranges.forEach(([label], i) => {
            if (i < 9) modal.scope.register([], String(i + 1), () => { run(label); return false; });
        });
        modal.scope.register([], "Enter", () => { run(dropdown.getValue()); return false; });

        modal.open();
        dropdown.selectEl.focus();
    }
}
