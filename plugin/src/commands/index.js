// Plainday's commands, each naming the class in this folder that does the work. Plainday makes one
// instance of every class in CLASSES (plugin/src/main.js), and CI checks that this folder holds
// exactly the classes the commands name, each listed here (.github/ci/checkScripts.mjs).
//
// Hotkeys, Commander buttons, the calendar sync and Raycast call a command by its id, which
// Obsidian shows as `plainday:<id>`, so an id never changes once set (OBS-226). A palette name
// ("Plainday: Add note") can change without breaking anything.
//
// Each command has its own icon: a name from the icons Obsidian ships with (Lucide's), one that the
// oldest Obsidian the manifest allows already has, or the button draws empty. The phone's toolbar
// shows it, and Commander takes it for a new button (OBS-263). A new command needs one too, and no
// two commands share one; the bundle test checks both.
//
// Snapshot and Refold daily notes aren't commands: they're fold machinery, in shared/, which the
// classes call directly and a tool outside Obsidian calls by eval
// (`plainday.SnapshotDailyNotes.invoke()`).
import AddProjectLink from "./addProjectLink.js";
import AddTaskNote from "./addTaskNote.js";
import CalendarSync from "./calendarSync.js";
import ConvertToProject from "./convertToProject.js";
import Invoice from "./invoice.js";
import JumpToDate from "./jumpToDate.js";
import MoveToProject from "./moveToProject.js";
import Plan from "./plan.js";
import Schedule from "./schedule.js";
import DueDate from "./setDueDate.js";
import TimeReport from "./timeReport.js";
import ToggleTimeEntry from "./toggleTimeEntry.js";
import UpdateObsidianPM from "./updateObsidianPM.js";
import ViewErrorLogs from "./viewErrorLogs.js";

export const CLASSES = {
    AddProjectLink, AddTaskNote, CalendarSync, ConvertToProject, DueDate, Invoice, JumpToDate, MoveToProject, Plan,
    Schedule, TimeReport, ToggleTimeEntry, UpdateObsidianPM, ViewErrorLogs,
};

export const COMMANDS = [
    { id: "schedule", name: "Schedule", script: "Schedule", icon: "calendar-arrow-up" },
    { id: "due-date", name: "Due date", script: "DueDate", icon: "flag" },
    { id: "add-note", name: "Add note", script: "AddTaskNote", icon: "file-plus-corner" },
    { id: "add-project-link", name: "Add project link", script: "AddProjectLink", icon: "circle" },
    { id: "move-to-project", name: "Move to project", script: "MoveToProject", icon: "folder-input" },
    { id: "convert-to-project", name: "Convert to project", script: "ConvertToProject", icon: "folder-plus" },
    { id: "toggle-time-entry", name: "Toggle time entry", script: "ToggleTimeEntry", icon: "timer" },
    { id: "jump-to-date", name: "Jump to date", script: "JumpToDate", icon: "calendar-search" },
    { id: "plan", name: "Plan", script: "Plan", icon: "columns-3" },
    { id: "time-report", name: "Time report", script: "TimeReport", icon: "table-2" },
    { id: "invoice", name: "Invoice", script: "Invoice", icon: "receipt" },
    { id: "view-error-logs", name: "View error logs", script: "ViewErrorLogs", icon: "triangle-alert" },
    { id: "sync-calendars", name: "Sync calendars", script: "CalendarSync", icon: "calendar-sync" },
    // Until OBS-201 replaces it with an install script
    { id: "update-obsidian-pm", name: "Update Obsidian PM", script: "UpdateObsidianPM", icon: "download" },
];
