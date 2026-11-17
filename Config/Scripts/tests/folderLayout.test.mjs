// The second layout (OBS-283): the demo's notes in other folders, with Plainday's folder settings to
// match, give the same reports. Every project and area moves under `Work`, the Inbox is `Waiting` and the
// archive `Old`; the periodic notes stay in the Planner. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readVault, loadTimeReport, loadBilling, planReports, vaultSettings, checkedNotes, vaultFolders } from "./demo/renderReports.mjs";

const MOVES = [["Projects", "Work"], ["Inbox", "Waiting"], ["Archive", "Old"]];
// A path in the second layout, and a report's text with its paths moved the same way
const moved = (p) => {
    for (const [from, to] of MOVES) if (p.startsWith(`${from}/`)) return `${to}${p.slice(from.length)}`;
    return p;
};
const movedText = (t) => MOVES.reduce((s, [from, to]) => s.replaceAll(`[[${from}/`, `[[${to}/`), t);

const billing = loadBilling();
const demo = readVault();
const layout = { root: null, files: demo.files.map(moved), notes: new Map([...demo.notes].map(([p, n]) => [moved(p), n])) };
const settings = vaultSettings(demo, billing);
const theirs = { ...settings, folders: { ...settings.folders, projects: "Work", inbox: "Waiting", archive: "Old" } };
const asDemo = planReports(loadTimeReport(), demo, { billing, settings });
const asLayout = planReports(loadTimeReport(), layout, { billing, settings: theirs });

test("the second layout moves the demo's projects, Inbox and archive, and nothing else", () => {
    const where = (vault, folder) => [...vault.notes.keys()].filter((p) => p.startsWith(`${folder}/`)).length;
    for (const [from, to] of MOVES) {
        assert.ok(where(demo, from) > 0, `the demo has notes in ${from}`);
        assert.equal(where(layout, to), where(demo, from), `${to} holds what ${from} held`);
        assert.equal(where(layout, from), 0, `and ${from} is gone`);
    }
    assert.equal(layout.notes.size, demo.notes.size);
    assert.deepEqual(asDemo.errors, []);
    assert.deepEqual(asLayout.errors, []);
});

test("with the settings to match, the time report writes the same hours and Problems as the demo, apart from paths", () => {
    assert.deepEqual(asDemo.changes.map((c) => c.path), [], "the demo's committed reports are what it renders");
    assert.deepEqual(asLayout.changes.map((c) => c.path), [], "and the second layout's are the same notes, unchanged");
    assert.equal(asLayout.blocks.size, asDemo.blocks.size, "a report in the same notes");
    for (const [path, block] of asDemo.blocks) {
        assert.equal(asLayout.blocks.get(moved(path)), movedText(block), path);
    }
    for (const path of ["Projects/Freelance/Kestrel Outfitters 2026/Kestrel Outfitters 2026.md",
        "Projects/Freelance/Kestrel Outfitters 2026/Kestrel Outfitters 2026 timesheet.md",
        "Reference/Planner/weeks/2026w38.md", "Reference/Planner/months/2026-09.md"]) {
        assert.ok(asDemo.blocks.has(path), `${path} has a report`);
    }
    // The Problems the report found, its own and each project's, the same ones (12 reports list some)
    const problems = (plan) => JSON.stringify([plan.model.problems, plan.model.projectProblems]);
    assert.ok(asDemo.model.problems.length > 0 && asDemo.model.projectProblems.length > 0, "the demo has Problems of both kinds");
    assert.ok([...asDemo.blocks.values()].filter((b) => b.includes("Problems")).length > 0);
    const movedPaths = (t) => MOVES.reduce((x, [from, to]) => x.replaceAll(`"${from}/`, `"${to}/`), movedText(t));
    assert.equal(problems(asLayout), movedPaths(problems(asDemo)));
});

test("with the folders left as the demo has them, the report's checks read none of the moved notes: the folders are what they read", () => {
    // The reports find projects by their tags, so their hours don't move with a folder; the task checks
    // read only the notes in the system (Projects, the Inbox and the periodic notes) and the archive
    const notes = (vault, s) => checkedNotes(loadTimeReport(), vault, vaultFolders(s)).filter((n) => n.kind !== "day").map((n) => n.path);
    const inDemo = notes(demo, settings);
    assert.ok(inDemo.some((p) => p.startsWith("Projects/")) && inDemo.some((p) => p.startsWith("Archive/")));
    assert.deepEqual(notes(layout, theirs), inDemo.map(moved), "with the settings to match, the same notes, moved");
    assert.deepEqual(notes(layout, settings).filter((p) => !p.startsWith("Reference/")), [], "with Projects, Inbox and Archive left as they were, none of them");
});
