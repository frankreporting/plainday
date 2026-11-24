// Tests for plugin/src/commands/toggleTimeEntry.js: what it says when its dropdown has nothing to offer.
// Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The dropdown and the timers themselves are TimeReport's, tested in timeReport.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClass } from "../../../plugin/classShape.mjs";
import { standIn, NN, PLANNER } from "./standInVault.mjs";

const toggler = (v) => new (loadClass("toggleTimeEntry.js", v.globals))();

test("no running timers and no note for today: the path it looked for, and what to check (OBS-336)", () => {
    // The Daily notes plugin's folder, as the stand-in vault sets it, on the stand-in's day
    const v = standIn({ notes: {}, nn: NN, today: "2026-09-16" });
    const path = v.plainday.Schedule.dailyNotePath(v.globals.moment());
    assert.equal(toggler(v).nothingToPick(), `No running timers, and no note for today at \`${path}\`. Check your periodic note settings.`);
});

test("no running timers, and today's note has nothing open: as before", () => {
    const today = `${PLANNER}/days/2026-09-16.md`;
    const v = standIn({ notes: { [today]: "- [x] Done already\n" }, nn: { ...NN, calendarIntegrationMode: "notebook-navigator", calendarCustomFilePattern: "[days]/YYYY-MM-DD" }, today: "2026-09-16" });
    assert.equal(v.plainday.Schedule.dailyNotePath(v.globals.moment()), today);
    assert.equal(toggler(v).nothingToPick(), "No running timers, and nothing open in today's daily note");
});
