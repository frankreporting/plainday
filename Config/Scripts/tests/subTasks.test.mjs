// Task commands on a sub-task act on the top of its nest, in every note (OBS-193, rule 5): DueDate,
// AddProjectLink and AddTaskNote, run on a stand-in vault. Schedule's cases are in taskIdentity.test.mjs, the
// timer's in timeReport.test.mjs. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { standIn, PLANNER } from "./standInVault.mjs";

const day = (d) => `${PLANNER}/days/${d}.md`;
const HOUSE = "Projects/Household/Household.md";
const KES = "Projects/Freelance/Kestrel/Kestrel.md";
const CAT = "Projects/Freelance/Kestrel/Catalog/Catalog.md";
const NOTES = {
    [HOUSE]: "---\ntags: [area]\n---\n",
    [KES]: "---\ntags: [project]\n---\n",
    [CAT]: "---\ntags: [project]\n---\n## Tasks\n\n- [ ] Deliver edited selects\n\t- [ ] Order the prop rentals\n",
    [day("2026-09-16")]: "- [ ] Test the timer\n\t- [ ] A sub-step\n\t\t- a note\n",
    [day("2026-09-17")]: "- [<] 9:00am\tKestrel standup [[Kestrel|⭕]]\n\t- 9:20am\n\t- [ ] Bring the sitemap\n",
    "Projects/Freelance/Kestrel/Draft wireframes.md": "---\ntags: [task]\n---\n- [ ] Mobile layout\n\t- [ ] Nav first\n",
};

// DueDate on line `at` of `path`, the date box handing on 9/25/26
const dueDate = async (path, at) => {
    const v = standIn({ notes: NOTES, open: path, at });
    let picked = false;
    v.customJS.DatePrompt.open = (title, onPick) => { picked = true; onPick({ m: { format: (f) => ({ "YYYY-MM-DD": "2026-09-25", "M/D": "9/25" })[f] } }, { close() {} }); return {}; };
    await v.customJS.DueDate.invoke();
    return { v, picked, lines: v.notes()[path].split("\n") };
};

test("DueDate on a sub-task puts the 🚩 on the top of its nest, in a day, a project note and a task note (OBS-193, rule 5)", async () => {
    for (const [path, at, top] of [[day("2026-09-16"), 1, 0], [day("2026-09-16"), 2, 0], [CAT, 6, 5], ["Projects/Freelance/Kestrel/Draft wireframes.md", 4, 3]]) {
        const { v, lines } = await dueDate(path, at);
        assert.match(lines[top], /\[\[2026-09-25\|🚩 9\/25\]\]/, `${path} ${at}`);
        assert.equal(lines.filter((l) => l.includes("🚩")).length, 1, `${path} ${at}: only the top gets it`);
        assert.deepEqual(v.notices, []);
    }
});

test("DueDate on an event, or a line under one, does nothing and says an event has no deadline (OBS-193, rule 14)", async () => {
    for (const at of [0, 1, 2]) {
        const { v, picked } = await dueDate(day("2026-09-17"), at);
        assert.equal(picked, false, `line ${at}: no date box`);
        assert.equal(v.notes()[day("2026-09-17")], NOTES[day("2026-09-17")], `line ${at}`);
        assert.deepEqual(v.notices, ["An event has no deadline, so none was set"], `line ${at}`);
    }
});

// AddProjectLink on line `at` of `path`, the menu handing on `pick`
const projectLink = async (path, at, pick) => {
    const v = standIn({ notes: NOTES, open: path, at });
    v.customJS.AddTaskNote.pickHome = async () => v.app.vault.getFileByPath(pick);
    await v.customJS.AddProjectLink.invoke();
    return { v, lines: v.notes()[path].split("\n") };
};

test("AddProjectLink on a sub-task links the top of its nest; under an event, the event (OBS-193, rule 5)", async () => {
    let { lines } = await projectLink(day("2026-09-16"), 1, HOUSE);
    assert.deepEqual(lines.slice(0, 3), ["- [ ] Test the timer [[Household|🗃️]]", "\t- [ ] A sub-step", "\t\t- a note"]);
    ({ lines } = await projectLink(day("2026-09-16"), 2, HOUSE));
    assert.equal(lines[0], "- [ ] Test the timer [[Household|🗃️]]");
    ({ lines } = await projectLink(day("2026-09-17"), 2, HOUSE));
    assert.deepEqual(lines.slice(0, 3), ["- [<] 9:00am\tKestrel standup [[Household|🗃️]]", "\t- 9:20am", "\t- [ ] Bring the sitemap"]);
});

test("AddTaskNote on a sub-task links the top's note, named from its text, cursor and selection aside; under an event, the event's log (OBS-193, rule 5)", async () => {
    const NOTE = "Projects/Household/Test the timer.md";
    const v = standIn({ notes: { ...NOTES, [NOTE]: "---\ntags: [task]\n---\n" }, open: day("2026-09-16"), at: 1 });
    await v.customJS.AddTaskNote.invoke();
    assert.deepEqual(v.notes()[day("2026-09-16")].split("\n").slice(0, 2), ["- [ ] Test the timer [[Household|🗃️]] [[Test the timer|⋯]]", "\t- [ ] A sub-step"]);
    const e = standIn({ notes: NOTES, open: day("2026-09-17"), at: 2 });
    await e.customJS.AddTaskNote.invoke();
    assert.deepEqual(e.notes()[day("2026-09-17")].split("\n").slice(0, 3), ["- [<] 9:00am\tKestrel standup [[Kestrel|⭕]] [[2026-09-17 Kestrel standup|⋯]]", "\t- 9:20am", "\t- [ ] Bring the sitemap"]);
});

test("AddProjectLink on a meeting line in the form used before August 2025, or a line under one, links the meeting; its title's log is its note (OBS-193, rules 1 and 5)", async () => {
    const MEET = day("2025-03-04");
    const notes = { ...NOTES, [MEET]: "## Meetings\n\n11:00am [[2025-03-04 Team meeting|Team meeting]]\n\t- 11:00am - 11:45am\n\t- [ ] Action item\n" };
    for (const at of [2, 4]) {
        const v = standIn({ notes, open: MEET, at });
        v.customJS.AddTaskNote.pickHome = async () => v.app.vault.getFileByPath(HOUSE);
        await v.customJS.AddProjectLink.invoke();
        assert.equal(v.notes()[MEET].split("\n")[2], "11:00am [[2025-03-04 Team meeting|Team meeting]] [[Household|🗃️]]", `line ${at}`);
        assert.deepEqual(v.notices, [], `line ${at}`);
    }
    const cmd = standIn({ notes }).customJS.AddProjectLink;
    assert.equal(cmd.taskLinkpath("11:00am [[2025-03-04 Team meeting|Team meeting]]"), "2025-03-04 Team meeting");
    assert.equal(cmd.relinked("11:00am [[2025-03-04 Team meeting|Team meeting]]", "P/›logs/2025-03-04 Team meeting"), "11:00am [[P/›logs/2025-03-04 Team meeting|Team meeting]]");
    assert.equal(cmd.label("11:00am [[2025-03-04 Team meeting|Team meeting]]"), "Team meeting");
});

test("AddTaskNote, review: on or under a meeting line in the form used before August 2025, or a canceled event the sync wrote, it links the event's log (OBS-193, rule 1)", async () => {
    const MEET = day("2025-03-04");
    const notes = { ...NOTES, [MEET]: "10:00am\tWeekly sync\n\t- [ ] Action item\n11:00am [[2025-03-04 Team meeting|Team meeting]]\n\t- [ ] Another\n" };
    let v = standIn({ notes, open: MEET, at: 1 });
    await v.customJS.AddTaskNote.invoke();
    assert.equal(v.notes()[MEET].split("\n")[0], "10:00am\tWeekly sync [[2025-03-04 Weekly sync|⋯]]");
    v = standIn({ notes, open: MEET, at: 3 });
    await v.customJS.AddTaskNote.invoke();
    assert.equal(v.notes()[MEET], notes[MEET]);
    assert.equal(v.notices.at(-1), "This event already links a log");
    const CANCELED = day("2026-09-19");
    v = standIn({ notes: { ...NOTES, [CANCELED]: "- [-] 1:00pm\tCanceled call\n\t- [ ] x\n" }, open: CANCELED, at: 1 });
    await v.customJS.AddTaskNote.invoke();
    assert.equal(v.notes()[CANCELED].split("\n")[0], "- [-] 1:00pm\tCanceled call [[2026-09-19 Canceled call|⋯]]");
});

test("AddTaskNote, review: on a sub-task of a task with no text yet, the empty link goes on the task, not the sub-task (OBS-193)", async () => {
    const v = standIn({ notes: { ...NOTES, [day("2026-09-20")]: "- [ ] \n\t- [ ] sub step\n" }, open: day("2026-09-20"), at: 1 });
    const editor = v.app.workspace.activeLeaf.view.editor;
    editor.transaction = ({ changes, selection, replaceSelection }) => {
        assert.ok(changes && !replaceSelection, "an explicit change, not typed at the cursor");
        for (const c of changes) editor.replaceRange(c.text, c.from, c.to ?? c.from);
        assert.equal(selection.from.line, 0);
    };
    await v.customJS.AddTaskNote.invoke();
    assert.deepEqual(v.notes()[day("2026-09-20")].split("\n").slice(0, 2), ["- [ ] [[|⋯]]", "\t- [ ] sub step"]);
});

test("AddTaskNote, review round 2: on a [>] event line the calendar sync wrote, or under one, it says the log is linked from the event's new day (OBS-193, rule 1)", async () => {
    const D = day("2026-09-19");
    const notes = { ...NOTES, [D]: "- [>] [[2026-09-20|9/20]] 2:00pm\tMoved call\n\t- [ ] x\n" };
    for (const at of [0, 1]) {
        const v = standIn({ notes, open: D, at });
        await v.customJS.AddTaskNote.invoke();
        assert.equal(v.notes()[D], notes[D]);
        assert.equal(v.notices.at(-1), "This event moved to another day: link its log from its line there");
    }
});

test("DueDate, PR 54 review: does nothing on or under any form of event; and nothing when the line changed while the date box was open (rules 12, 14)", async () => {
    const D = day("2026-09-19");
    const notes = { ...NOTES, [D]: "- [>] [[2026-09-20|9/20]] 2:00pm\tMoved call\n\t- [ ] a\n- [-] 3:00pm\tCanceled call\n\t- [ ] b\n4:00pm Old meeting\n\t- [ ] c\n" };
    for (const at of [1, 3, 5]) {
        const w = standIn({ notes, open: D, at });
        let p = false;
        w.customJS.DatePrompt.open = () => { p = true; return {}; };
        await w.customJS.DueDate.invoke();
        assert.equal(p, false, `line ${at}: no date box`);
        assert.deepEqual(w.notices, ["An event has no deadline, so none was set"], `line ${at}`);
    }
    const v = standIn({ notes: NOTES, open: day("2026-09-16"), at: 1 });
    const editor = v.app.workspace.activeLeaf.view.editor;
    v.customJS.DatePrompt.open = (t, onPick) => {
        editor.replaceRange(" (edited)", { line: 0, ch: editor.getLine(0).length });
        onPick({ m: { format: (f) => ({ "YYYY-MM-DD": "2026-09-25", "M/D": "9/25" })[f] } }, { close() {} });
        return {};
    };
    await v.customJS.DueDate.invoke();
    assert.equal(v.notes()[day("2026-09-16")].split("\n")[0], "- [ ] Test the timer (edited)");
    assert.equal(v.notices.at(-1), "The line changed while the date box was open, so no deadline was set");
});

test("on a sub-task, DueDate, AddProjectLink and AddTaskNote leave the cursor where it was (Brian, 2026-10-26)", async () => {
    const D = day("2026-09-16"), end = "\t- [ ] A sub-step".length;
    let v = standIn({ notes: NOTES, open: D, at: 1 });
    v.customJS.DatePrompt.open = (t, onPick) => { onPick({ m: { format: (f) => ({ "YYYY-MM-DD": "2026-09-25", "M/D": "9/25" })[f] } }, { close() {} }); return {}; };
    await v.customJS.DueDate.invoke();
    assert.deepEqual(v.placed(), { line: 1, ch: end }, "DueDate");
    v = standIn({ notes: NOTES, open: D, at: 1 });
    v.customJS.AddTaskNote.pickHome = async () => v.app.vault.getFileByPath(HOUSE);
    await v.customJS.AddProjectLink.invoke();
    assert.deepEqual(v.placed(), { line: 1, ch: end }, "AddProjectLink");
    v = standIn({ notes: { ...NOTES, "Projects/Household/Test the timer.md": "---\ntags: [task]\n---\n" }, open: D, at: 1 });
    await v.customJS.AddTaskNote.invoke();
    assert.deepEqual(v.placed(), { line: 1, ch: end }, "AddTaskNote");
});
