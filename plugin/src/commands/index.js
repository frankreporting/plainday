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
// A command marked `periodic` reads or writes the daily, weekly, monthly or yearly notes, so it doesn't
// run while Plainday's periodic notes source isn't chosen or is off: it says so instead (OBS-336,
// Settings.periodicNotice). The others work on Projects, areas and the error log alone.
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
import NewArea from "./newArea.js";
import NewEventLog from "./newEventLog.js";
import NewProject from "./newProject.js";
import Plan from "./plan.js";
import Schedule from "./schedule.js";
import DueDate from "./setDueDate.js";
import TimeReport from "./timeReport.js";
import ToggleTimeEntry from "./toggleTimeEntry.js";
import ViewErrorLogs from "./viewErrorLogs.js";

export const CLASSES = {
    AddProjectLink, AddTaskNote, CalendarSync, ConvertToProject, DueDate, Invoice, JumpToDate, MoveToProject, NewArea, NewEventLog,
    NewProject, Plan, Schedule, TimeReport, ToggleTimeEntry, ViewErrorLogs,
};

export const COMMANDS = [
    { id: "schedule", name: "Schedule", script: "Schedule", icon: "calendar-arrow-up", periodic: true },
    { id: "due-date", name: "Due date", script: "DueDate", icon: "flag", periodic: true },
    { id: "add-note", name: "Add note", script: "AddTaskNote", icon: "file-plus-corner", periodic: true },
    { id: "new-event-log", name: "New event log", script: "NewEventLog", icon: "notebook-pen", periodic: true },
    { id: "add-project-link", name: "Add project link", script: "AddProjectLink", icon: "circle", periodic: true },
    { id: "move-to-project", name: "Move to project", script: "MoveToProject", icon: "folder-input" },
    { id: "new-project", name: "New project", script: "NewProject", icon: "circle-plus" },
    { id: "new-area", name: "New area", script: "NewArea", icon: "package-plus" },
    { id: "convert-to-project", name: "Convert to project", script: "ConvertToProject", icon: "folder-plus" },
    { id: "toggle-time-entry", name: "Toggle time entry", script: "ToggleTimeEntry", icon: "timer", periodic: true },
    { id: "jump-to-date", name: "Jump to date", script: "JumpToDate", icon: "calendar-search", periodic: true },
    { id: "plan", name: "Plan", script: "Plan", icon: "columns-3", periodic: true },
    { id: "time-report", name: "Time report", script: "TimeReport", icon: "table-2", periodic: true },
    { id: "invoice", name: "Invoice", script: "Invoice", icon: "receipt", periodic: true },
    { id: "view-error-logs", name: "View error logs", script: "ViewErrorLogs", icon: "triangle-alert" },
    { id: "sync-calendars", name: "Sync calendars", script: "CalendarSync", icon: "calendar-sync", periodic: true },
];
