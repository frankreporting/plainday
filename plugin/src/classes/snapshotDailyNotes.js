class SnapshotDailyNotes {
    // Snapshots the folds of every open daily note and marks a sync as started, so
    // RefoldDailyNotes can tell which items an outside write added. A tool outside Obsidian runs
    // it before writing, by eval:
    //   obsidian vault=<v> eval code="plainday.SnapshotDailyNotes.invoke()"
    invoke() {
        customJS.RefoldDailyNotes.snapshotOpen(true);
    }
}
