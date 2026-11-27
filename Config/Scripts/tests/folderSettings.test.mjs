// The commands follow Settings → Plainday → Folders (OBS-283): Projects, the Inbox and the archive in
// other folders, the weekly notes' folder and template as set, and messages that name the folders as
// they're set. On the stand-in vault; every note, name and date here is invented. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { standIn, PLANNER } from "./standInVault.mjs";

const day = (d) => `${PLANNER}/days/${d}.md`;
const ELSEWHERE = { projects: "Work", inbox: "Waiting", archive: "Old" };
const KES = "Work/Freelance/Kestrel/Kestrel.md";
const PROJECT = "---\ntags: [project]\n---\n";
const TASK = "---\ntags: [task]\ndue: 2026-09-18\n---\n";

test("the system is where the folders are set: a note in Work or Waiting is in it, one in Projects isn't, and Old is the archive", () => {
    const v = standIn({ notes: { [KES]: PROJECT, "Projects/Kestrel/Kestrel.md": PROJECT, "Waiting/Order toner.md": TASK, "Old/Marlowe/Marlowe.md": PROJECT }, folders: ELSEWHERE });
    const { TaskIds, TimeReport, AddTaskNote } = v.plainday;
    const file = (p) => v.app.vault.getFileByPath(p);
    assert.equal(TaskIds.inSystem(file(KES)), true);
    assert.equal(TaskIds.inSystem(file("Waiting/Order toner.md")), true);
    assert.equal(TaskIds.inSystem(file("Projects/Kestrel/Kestrel.md")), false, "Projects is only a folder now");
    assert.equal(TimeReport.isArchived("Old/Marlowe/Marlowe.md"), true);
    assert.equal(TimeReport.isArchived("Archive/Marlowe/Marlowe.md"), false);
    assert.equal(AddTaskNote.isLiveHome(file(KES)), true, "Move to project and Add project link list it");
    assert.equal(AddTaskNote.isLiveHome(file("Projects/Kestrel/Kestrel.md")), false);
    assert.equal(AddTaskNote.stagingFolder(), "Waiting");
    assert.equal(TaskIds.outside(file("Projects/Kestrel/Kestrel.md")), "Plainday only acts on periodic notes or notes in the Work or Waiting folders. If you think you're seeing this message in error, check your periodic note and folder settings.");
    assert.equal(TaskIds.outside(file("Old/Marlowe/Marlowe.md")), "Marlowe is in Old, where no command works, so nothing changed", "a note in the archive, by its name");
});

test("the folders as a new vault has them: the messages say Projects, the Inbox and Archive, as before", () => {
    const v = standIn({ notes: { "Reference/Loose.md": "" } });
    assert.equal(v.plainday.TaskIds.outside(v.app.vault.getFileByPath("Reference/Loose.md")), "Plainday only acts on periodic notes or notes in the Projects or Inbox folders. If you think you're seeing this message in error, check your periodic note and folder settings.");
    assert.equal(v.plainday.TimeReport.inboxWords(), "the Inbox");
    assert.equal(v.plainday.TimeReport.archiveWords(), "Archive");
});

test("Due date names the folders as they're set when a task note's due stays as it was", async () => {
    for (const [path, said] of [["Old/Marlowe/Old copy.md", "Old copy is in Old, so its due wasn't changed"], ["Reference/Old copy.md", "Old copy isn't in Work or Waiting, so its due wasn't changed"]]) {
        const notes = { [KES]: PROJECT, [path]: `${TASK}- [ ] Its own line [[Old copy|⋯]]\n`, [day("2026-09-16")]: "- [ ] Look into it [[Old copy|⋯]]\n" };
        const v = standIn({ notes, open: day("2026-09-16"), at: 0, folders: ELSEWHERE });
        await v.dueDate("2026-09-25");
        assert.deepEqual(v.notices, [said], path);
        assert.equal(v.notes()[path], notes[path], "the note in Old or outside the system is left alone");
    }
});

test("Schedule sends a line to a week into the weekly notes' folder as set, and makes the note there", async () => {
    const v = standIn({ notes: { [day("2026-09-16")]: "- [ ] Order the paper stock\n" }, open: day("2026-09-16"), at: 0, folders: { week: "[Planner/Weeks]/gggg[w]ww" } });
    await v.schedule("2026-09-23", "week");
    assert.equal(v.notes()["Planner/Weeks/2026w39.md"], "- [ ] Order the paper stock\n");
    assert.equal(v.notes()[`${PLANNER}/weeks/2026w39.md`], undefined, "not where Notebook Navigator's pattern would put it");
    assert.equal(v.plainday.Schedule.periodOf(v.app.vault.getFileByPath("Planner/Weeks/2026w39.md")), "week", "and it's a weekly note there");
});

test("Move to project files a note from the Inbox as set into a project under Work", async () => {
    const NOTE = "Waiting/Client onboarding checklist.md";
    const v = standIn({ notes: { [KES]: PROJECT, [NOTE]: "---\ntags: [task]\n---\n- [ ] Send the welcome pack\n" }, open: NOTE, at: 3, folders: ELSEWHERE });
    await v.moveToProject(KES);
    assert.equal(v.notes()[NOTE], undefined);
    assert.ok(Object.keys(v.notes()).includes("Work/Freelance/Kestrel/Client onboarding checklist.md"), Object.keys(v.notes()).join(", "));
});

test("SyncArea leaves a note moved into the archive as set alone, as it leaves one in Archive", () => {
    const v = standIn({ notes: { [KES]: PROJECT, "Old/Kestrel notes.md": "---\nparent: \"[[Kestrel]]\"\n---\n", "Archive/Other.md": "" }, folders: ELSEWHERE });
    const sync = v.plainday.SyncArea, file = (p) => v.app.vault.getFileByPath(p);
    assert.equal(sync.ignored(file("Old/Kestrel notes.md")), true);
    assert.equal(sync.ignored(file("Archive/Other.md")), false, "Archive is only a folder now");
    assert.equal(sync.ignored({ path: "Config/Clients/Loose note.md" }), false, "a folder named Config is like any other (OBS-295)");
});

test("the time report, with the folders moved: a line whose note waits in Waiting is listed, by that name, and a project in Work counts", () => {
    const DAY = day("2026-09-17");
    const v = standIn({
        notes: {
            [KES]: PROJECT,
            "Waiting/Desk lamp.md": "---\ntags: [task]\n---\n",
            "Old/Marlowe/Marlowe.md": PROJECT,
            [DAY]: "- [x] Price a lamp [[Kestrel|⭕]] [[Desk lamp|⋯]]\n\t- 9:00am - 9:20am\n",
        },
        folders: ELSEWHERE,
    });
    const tr = v.plainday.TimeReport, index = tr.appIndex();
    assert.equal(index.inInbox("Waiting/Desk lamp.md"), true);
    assert.equal(index.inSystem("Work/Freelance/Kestrel/Kestrel.md"), true);
    assert.equal(index.inSystem("Projects/Elsewhere.md"), false);
    const model = tr.build([{ date: "2026-09-17", path: DAY, text: v.notes()[DAY] }], index);
    const conflicts = model.projectProblems.filter((p) => p.conflict);
    assert.deepEqual(JSON.parse(JSON.stringify(conflicts.map((p) => [p.project, p.conflict.inbox]))), [[KES, true]], "listed as waiting in the Inbox as set");
    const line = tr.conflictLine(conflicts[0].conflict, (p) => `[[${tr.basename(p)}]]`, (t) => t);
    assert.match(line, /waits in Waiting; run AddProjectLink on the line, or MoveToProject on the note$/);
    assert.equal(tr.isArchived("Old/Marlowe/Marlowe.md"), true);
});

test("Plan makes daily notes where everything else looks for them: it reads the Daily notes plugin only through Schedule (OBS-283)", () => {
    // Schedule is the one place that reads the plugin, so the periodic notes' source can't split what
    // Plan creates from what the reports and commands look for
    const src = readFileSync(new URL("../../../plugin/src/commands/plan.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /internalPlugins/, "Plan has no copy of dailyOpts' plugin read");
    assert.match(src, /dailyOpts\(\) \{\s*return plainday\.Schedule\.dailyOpts\(\);/, "it delegates to Schedule");
    for (const f of ["plugin/src/commands/plan.js", "plugin/src/commands/jumpToDate.js", "plugin/src/commands/timeReport.js", "plugin/src/shared/taskIds.js"]) {
        const text = readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
        assert.doesNotMatch(text, /internalPlugins\?\.plugins\?\.\["daily-notes"\]/, f);
    }
});
