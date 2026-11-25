// Tests for where Plainday finds the periodic notes (OBS-336): only where Settings → Plainday → Folders →
// Periodic notes says, so installing Notebook Navigator, whose calendar is on as it comes, moves nothing.
// Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadClass } from "../../../plugin/classShape.mjs";
import { standIn, PLANNER } from "./standInVault.mjs";

const KES = "Projects/Kestrel/Kestrel.md";
const PROJECT = "---\ntags: [project]\n---\n";
const TODAY = `${PLANNER}/days/2026-09-16.md`;
const TASK = "- [ ] Call the printer\n";
// Notebook Navigator as a fresh install leaves it: its calendar on, days at `YYYY/YYYYMMDD` at the top
// of the vault
const NAVIGATOR_FRESH = { calendarIntegrationMode: "notebook-navigator", vaultProfiles: [{ periodicNotesFolder: "" }], calendarCustomFilePattern: "YYYY/YYYYMMDD" };

test("OBS-128's repro: the Daily notes plugin chosen, then Navigator installed: today's note is still today's, and Add project link and Toggle time entry still work in it", async () => {
    const v = standIn({ notes: { [KES]: PROJECT, [TODAY]: TASK }, open: TODAY, at: 0, nn: null });
    assert.equal(v.plainday.Settings.periodicSource(), "daily-notes", "chosen");
    v.app.plugins.plugins["notebook-navigator"] = { settings: NAVIGATOR_FRESH };
    const today = v.app.vault.getFileByPath(TODAY);
    assert.equal(v.plainday.Settings.periodicSource(), "daily-notes", "installing Navigator changes nothing");
    assert.equal(v.plainday.Schedule.dailyNotePath(v.globals.moment()), TODAY);
    assert.equal(v.plainday.TaskIds.inSystem(today), true);
    // Add project link offers the projects, instead of refusing the note
    await v.addProjectLink(null);
    assert.equal(v.menus.length, 1, "the menu opened");
    assert.deepEqual(v.notices, ["No project or area picked, so nothing changed"], "the menu's Esc, not a refusal of the note");
    // Toggle time entry starts a timer on it: it's today's daily note
    const toggle = new (loadClass("toggleTimeEntry.js", v.globals))();
    assert.equal(toggle.canStart(today), true);
});
