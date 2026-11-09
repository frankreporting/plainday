// Plainday's commands and startup scripts, each naming the class that does the work.
//
// Hotkeys, Commander buttons, the calendar sync and Raycast call a command by its id, which
// Obsidian shows as `plainday:<id>`, so an id never changes once set (OBS-226). A palette name
// ("Plainday: Add note") can change without breaking anything.
//
// CustomJS still runs the same classes in a vault that hasn't moved to Plainday, from its own
// list in .obsidian/plugins/customjs/data.json. CI checks that the two lists name the same
// classes (.github/ci/checkScripts.mjs), apart from CUSTOMJS_ONLY.
export const COMMANDS = [
    { id: "schedule", name: "Schedule", script: "Schedule" },
    { id: "due-date", name: "Due date", script: "DueDate" },
    { id: "add-note", name: "Add note", script: "AddTaskNote" },
    { id: "add-project-link", name: "Add project link", script: "AddProjectLink" },
    { id: "move-to-project", name: "Move to project", script: "MoveToProject" },
    { id: "convert-to-project", name: "Convert to project", script: "ConvertToProject" },
    { id: "toggle-time-entry", name: "Toggle time entry", script: "ToggleTimeEntry" },
    { id: "jump-to-date", name: "Jump to date", script: "JumpToDate" },
    { id: "plan", name: "Plan", script: "Plan" },
    { id: "time-report", name: "Time report", script: "TimeReport" },
    { id: "invoice", name: "Invoice", script: "Invoice" },
    { id: "view-error-logs", name: "View error logs", script: "ViewErrorLogs" },
    { id: "sync-calendars", name: "Sync calendars", script: "CalendarSync" },
    // Until OBS-201 replaces it with an install script
    { id: "update-obsidian-pm", name: "Update Obsidian PM", script: "UpdateObsidianPM" },
];

// Run once the layout is ready, one after the other, in this order (CustomJS's)
export const STARTUP = [
    "NewNoteGuard",
    "SyncArea",
    "RefoldOnOpen",
    "MoveToProjectMenu",
    "TrailingLinks",
    "ListCursor",
    "CheckOff",
    "TimeReportOnStartup",
];

// CustomJS's commands that aren't commands in Plainday. Snapshot and Refold daily notes are fold
// machinery: the classes call them directly, and a tool outside Obsidian calls them by eval
// (`plainday.SnapshotDailyNotes.invoke()`). The calendar sync's range is the `Sync range:` line
// in the Calendar Sync note.
export const CUSTOMJS_ONLY = ["SnapshotDailyNotes", "RefoldDailyNotes", "CalendarSyncRange"];
