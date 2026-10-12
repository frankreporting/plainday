// Tests for CustomJS/refoldDailyNotes.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it, against a stub of what refold() asks
// of `app`: the note's text, one open view of it, the saved fold record and local storage. Folds
// come from Schedule's real foldableRanges.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const read = (name) => fs.readFileSync(new URL(`../CustomJS/${name}`, here), "utf8");
const Schedule = vm.runInContext(read("schedule.js") + "\n;Schedule", vm.createContext({}));
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

const PATH = "Reference/Planner/days/2026-09-15.md";
const NOTE = [
    "- [<] 9:00am\tTeam standup",
    "\t- 9:30am",
    "- [/] Fix the booking form",
    "\t- 8:06pm - 8:07pm",
    "\t- 8:08pm - 8:18pm",
    "- [x] Send the invoice",
].join("\n");

// The note open in one editor that shows `shown` folds; `saved` is the fold record on disk.
// Returns the class, the file and what was applied to the editor and saved.
function load({ text = NOTE, shown, saved }) {
    const file = { path: PATH, extension: "md" };
    const applied = [], writes = [];
    const view = {
        file,
        getViewType: () => "markdown",
        getViewData: () => text,
        currentMode: { getFoldInfo: () => shown, applyFoldInfo: (info) => applied.push(plain(info)) },
    };
    const storage = {};
    const noDate = { isValid: () => false, startOf: () => noDate, subtract: () => noDate, isBefore: () => false };
    const schedule = new Schedule();
    const context = {
        app: {
            vault: { read: async () => text, getFileByPath: () => file },
            workspace: { iterateAllLeaves: (cb) => cb({ view }) },
            foldManager: { load: () => saved, save: (_f, info) => writes.push(plain(info)) },
            loadLocalStorage: (k) => storage[k] ?? null,
            saveLocalStorage: (k, v) => { storage[k] = v; },
        },
        customJS: {
            Schedule: {
                foldableRanges: (t) => schedule.foldableRanges(t),
                isDailyNote: () => true,
                dailyOpts: () => ({ folder: "Reference/Planner/days", format: "YYYY-MM-DD" }),
            },
        },
        window: { moment: () => noDate },
        Notice: class {},
        console,
    };
    const RefoldDailyNotes = vm.runInContext(read("refoldDailyNotes.js") + "\n;RefoldDailyNotes", vm.createContext(context));
    return { refold: new RefoldDailyNotes(), file, applied, writes };
}

const FOLDS = { folds: [{ from: 0, to: 1 }, { from: 2, to: 4 }], lines: 6 };

test("OBS-64: an open note whose folds already match by line gets them applied again, cleared first", async () => {
    // A stop appended "8:18pm" to the fold's last line: the editor still reports lines 2 to 4
    const { refold, file, applied, writes } = load({ shown: FOLDS, saved: FOLDS });
    assert.equal(await refold.refold(file, "command"), false);
    assert.deepEqual(applied, [{ folds: [], lines: 6 }, FOLDS]);
    assert.deepEqual(writes, []);
});

test("folds that changed are saved and applied, and count as a refold", async () => {
    // The task was folded before its third line came in: the editor's fold stops at line 3
    const stale = { folds: [{ from: 0, to: 1 }, { from: 2, to: 3 }], lines: 6 };
    const { refold, file, applied, writes } = load({ shown: stale, saved: stale });
    assert.equal(await refold.refold(file, "command"), true);
    assert.deepEqual(applied, [{ folds: [], lines: 6 }, FOLDS]);
    assert.deepEqual(writes, [FOLDS]);
});

test("a note being opened whose saved folds still fit is left alone", async () => {
    const { refold, file, applied, writes } = load({ shown: FOLDS, saved: FOLDS });
    // No snapshot and a record that fits: nothing to do, and nothing is applied
    assert.equal(await refold.refold(file, "open"), false);
    assert.deepEqual(applied, []);
    assert.deepEqual(writes, []);
});
