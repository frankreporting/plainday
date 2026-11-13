// Plainday's startup scripts: the classes in this folder, which start with Plainday and act on their
// own (listeners, editor features, the startup report). Plainday makes one instance of every class
// in CLASSES (plugin/src/main.js) and, once the layout is ready, runs the invoke() of each one in
// STARTUP, one after the other, in that order. CI checks that this folder holds exactly the classes
// STARTUP names, each listed in CLASSES (.github/ci/checkScripts.mjs).
import CheckOff from "./checkOff.js";
import ListCursor from "./listCursor.js";
import MoveToProjectMenu from "./moveToProjectMenu.js";
import NewNoteGuard from "./newNoteGuard.js";
import RefoldOnOpen from "./refoldOnOpen.js";
import SyncArea from "./syncArea.js";
import TimeReportOnStartup from "./timeReportOnStartup.js";
import TrailingLinks from "./trailingLinks.js";

export const CLASSES = {
    CheckOff, ListCursor, MoveToProjectMenu, NewNoteGuard, RefoldOnOpen, SyncArea, TimeReportOnStartup, TrailingLinks,
};

// Run once the layout is ready, one after the other, in this order
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
