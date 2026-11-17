// The commands follow Settings → Plainday → Folders (OBS-283): Projects, the Inbox and the archive in
// other folders, the weekly notes' folder and template as set, and messages that name the folders as
// they're set. On the stand-in vault; every note, name and date here is invented. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(TaskIds.outside(file("Projects/Kestrel/Kestrel.md")), "Kestrel isn't in the Planner, Work or Waiting, where the system works, so nothing changed");
    assert.equal(TaskIds.outside(file("Old/Marlowe/Marlowe.md")), "Marlowe is in Old, where no command works, so nothing changed", "a note in the archive, by its name");
});

test("the folders as a new vault has them: the messages say Projects, the Inbox and Archive, as before", () => {
    const v = standIn({ notes: { "Reference/Loose.md": "" } });
    assert.equal(v.plainday.TaskIds.outside(v.app.vault.getFileByPath("Reference/Loose.md")), "Loose isn't in the Planner, Projects or the Inbox, where the system works, so nothing changed");
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
    const v = standIn({ notes: { [day("2026-09-16")]: "- [ ] Order the paper stock\n" }, open: day("2026-09-16"), at: 0, folders: { week: "Planner/Weeks" } });
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
    assert.equal(sync.ignored({ path: "Config/Templates/Task.md" }), true, "Config stays out by name");
});
