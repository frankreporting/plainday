class SnapshotDailyNotes {
    // Command: snapshots the folds of every open daily note and marks a sync as started, so
    // RefoldDailyNotes can tell which items the sync added. The calendar sync runs it before writing:
    //   obsidian command id=customjs:invoke-SnapshotDailyNotes
    invoke() {
        customJS.RefoldDailyNotes.snapshotOpen(true);
    }
}
