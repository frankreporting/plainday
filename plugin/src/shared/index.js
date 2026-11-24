// The classes only other classes call: the system's own rules (task identity, how a project change
// spreads, what's billed, the folds of daily notes, the error log, the date prompt and its reader of typed dates, how a date is written, reading a
// calendar's private link, making the periodic notes, the event logs, and the projects and areas), and Plainday's settings, which the panel (plugin/src/settingsTab.js)
// shows. Plainday makes one instance of every class in CLASSES
// (plugin/src/main.js), and the others reach them through the host's `plainday`
// (plugin/src/host.js).
import Billing from "./billing.js";
import CalendarFeed from "./calendarFeed.js";
import DatePrompt from "./datePrompt.js";
import Dates from "./dates.js";
import DateWords from "./dateWords.js";
import ErrorLog from "./errorLog.js";
import EventLog from "./eventLog.js";
import PeriodicNotes from "./periodicNotes.js";
import ProjectNotes from "./projectNotes.js";
import RefoldDailyNotes from "./refoldDailyNotes.js";
import Settings from "./settings.js";
import SnapshotDailyNotes from "./snapshotDailyNotes.js";
import TaskChange from "./taskChange.js";
import TaskIds from "./taskIds.js";

export const CLASSES = {
    Billing, CalendarFeed, DatePrompt, Dates, DateWords, ErrorLog, EventLog, PeriodicNotes, ProjectNotes, RefoldDailyNotes, Settings, SnapshotDailyNotes, TaskChange,
    TaskIds,
};
