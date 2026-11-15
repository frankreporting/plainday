// The classes only other classes call: the system's own rules (task identity, how a project change
// spreads, what's billed, the folds of daily notes, the error log, the date prompt, reading a
// calendar's private link). Plainday makes one instance of every class in CLASSES
// (plugin/src/main.js), and the others reach them through the host's `plainday`
// (plugin/src/host.js).
import Billing from "./billing.js";
import CalendarFeed from "./calendarFeed.js";
import DatePrompt from "./datePrompt.js";
import ErrorLog from "./errorLog.js";
import RefoldDailyNotes from "./refoldDailyNotes.js";
import SnapshotDailyNotes from "./snapshotDailyNotes.js";
import TaskChange from "./taskChange.js";
import TaskIds from "./taskIds.js";

export const CLASSES = {
    Billing, CalendarFeed, DatePrompt, ErrorLog, RefoldDailyNotes, SnapshotDailyNotes, TaskChange, TaskIds,
};
