// Tests for CustomJS/schedule.js (the parts that don't need an editor). Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../CustomJS/schedule.js", import.meta.url), "utf8");
const load = (app) => new (vm.runInContext(code + "\n;Schedule", vm.createContext({ app })))();
const file = (path) => ({ basename: path.split("/").pop().replace(/\.md$/, ""), parent: { path: path.slice(0, path.lastIndexOf("/")) } });

const PLANNER = "30 Reference/36 Planner";
const app = (nn) => ({
    internalPlugins: { plugins: { "daily-notes": { instance: { options: { folder: `${PLANNER}/days`, format: "YYYY-MM-DD" } } } } },
    plugins: { plugins: nn ? { "notebook-navigator": { settings: nn } } : {} },
});
const NN = { vaultProfiles: [{ periodicNotesFolder: PLANNER }], calendarCustomMonthPattern: "[months]/YYYY-MM" };

test("monthly notes: YYYY-MM in the Planner's months folder only (OBS-9)", () => {
    const s = load(app(NN));
    assert.equal(s.monthsFolder(), `${PLANNER}/months`);
    assert.equal(s.isMonthlyNote(file(`${PLANNER}/months/2026-09.md`)), true);
    assert.equal(s.isMonthlyNote(file("30 Reference/37 Journal/2025-03.md")), false, "Journal notes aren't monthly notes");
    assert.equal(s.isMonthlyNote(file(`${PLANNER}/2026-09.md`)), false);
    assert.equal(s.isMonthlyNote(file(`${PLANNER}/months/2026-09-07.md`)), false);
});

test("monthly notes: the months folder follows Notebook Navigator, or sits beside the daily notes", () => {
    assert.equal(load(app({ ...NN, calendarCustomMonthPattern: "[periodic/months]/YYYY-MM" })).monthsFolder(), `${PLANNER}/periodic/months`);
    // A month pattern with a date in its folder isn't one fixed folder: fall back
    assert.equal(load(app({ ...NN, calendarCustomMonthPattern: "YYYY/[months]/MM" })).monthsFolder(), `${PLANNER}/months`);
    assert.equal(load(app(null)).monthsFolder(), `${PLANNER}/months`);
});
