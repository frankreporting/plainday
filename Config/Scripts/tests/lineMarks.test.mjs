// OBS-208: the two marks (⋯ a line's own note, ↗ the note Schedule sent it from), the three folders the
// system works in, and the one-time conversion of 🗒️ and 🔗. Every note here is invented. Run from the
// vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { standIn, PLANNER } from "./standInVault.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
const day = (d) => `${PLANNER}/days/${d}.md`;
const PROJECT = "---\ntags: [project]\n---\n";
const KES = "Projects/Freelance/Kestrel/Kestrel.md";
const RAFE = "Reference/People/Rafe Oakes.md";

// ---------------------------------------------------------------- the three folders (rule 12)

test("inSystem: the periodic notes and every note in Projects and the Inbox; nothing else", () => {
    const notes = {
        [day("2026-09-17")]: "", [`${PLANNER}/weeks/2026w38.md`]: "", [KES]: PROJECT, "Inbox/Desk lamp.md": "",
        [RAFE]: "", "Archive/Old/Old.md": PROJECT, "Welcome.md": "", "Config/Templates/Task.md": "",
    };
    const v = standIn({ notes });
    const t = v.customJS.TaskIds;
    const yes = Object.keys(notes).filter((p) => t.inSystem(v.app.vault.getFileByPath(p)));
    assert.deepEqual(yes, [day("2026-09-17"), `${PLANNER}/weeks/2026w38.md`, KES, "Inbox/Desk lamp.md"]);
});

test("a line outside the system: Schedule, DueDate, AddTaskNote and AddProjectLink change nothing, and say why", async () => {
    const text = "- [ ] Ask for the photo release list\n";
    for (const name of ["Schedule", "DueDate", "AddTaskNote", "AddProjectLink"]) {
        const v = standIn({ notes: { [KES]: PROJECT, [RAFE]: text }, open: RAFE, at: 0 });
        if (name === "Schedule") assert.equal(await v.schedule("2026-09-19"), null, "no date is asked");
        else await v.customJS[name].invoke();
        assert.equal(v.notes()[RAFE], text, name);
        assert.equal(v.notices.at(-1), "Rafe Oakes isn't in the Planner, Projects or the Inbox, where the system works, so nothing changed", name);
        assert.equal(Object.keys(v.notes()).length, 2, `${name}: no note made`);
    }
});

test("the search for a task's lines reads only the system; the task checks read Archive too (Brian, 2026-10-28)", async () => {
    const v = standIn({ notes: {
        [day("2026-09-17")]: "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2\n",
        [KES]: PROJECT,
        [RAFE]: "- [ ] Book it ^k3x9m2\n",
        "Archive/Old/Old.md": `${PROJECT}- [>] Book it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n`,
    } });
    const t = v.customJS.TaskIds;
    assert.deepEqual(plain(t.linesOf("k3x9m2").map((l) => l.file.path)), [day("2026-09-17")]);
    assert.deepEqual(plain((await t.gather("k3x9m2", [v.app.vault.getFileByPath(RAFE)])).map((l) => l.file.path)), [day("2026-09-17")], "even a note a caller names");
    assert.deepEqual(plain(t.allIds().get("k3x9m2").map((l) => l.file.path).sort()), ["Archive/Old/Old.md", day("2026-09-17")]);
});

// ---------------------------------------------------------------- reopening (rule 13)

test("keepLinks: a reopened line keeps its ⋯ when the moving line has none, before the ↗ it takes from the moving line", () => {
    const v = standIn({ notes: {} });
    const keep = (line, old) => v.customJS.Schedule.constructor.keepLinks(line, old);
    assert.equal(keep("- [ ] Pick fonts [[Kestrel|⭕]] [[Brand guide|↗]] ^abc123", "- [>] Pick fonts [[2026-09-19#^abc123|9/19]] [[Kestrel|⭕]] [[Pick fonts|⋯]] ^abc123"),
        "- [ ] Pick fonts [[Kestrel|⭕]] [[Pick fonts|⋯]] [[Brand guide|↗]] ^abc123");
    assert.equal(keep("- [ ] Pick fonts [[Kestrel|⭕]] ^abc123", "- [x] Pick fonts [[Kestrel|⭕]] [[Brand guide|↗]] ^abc123"),
        "- [ ] Pick fonts [[Kestrel|⭕]] ^abc123", "the ↗ is the moving line's: one only the old line had goes");
    assert.equal(keep("- [ ] Pick fonts [[Kestrel|⭕]] [[New note|⋯]] ^abc123", "- [-] Pick fonts [[Pick fonts|⋯]] ^abc123"),
        "- [ ] Pick fonts [[Kestrel|⭕]] [[New note|⋯]] ^abc123", "the moving line's own ⋯ wins");
});

// ---------------------------------------------------------------- the one-time conversion

const SHOT = "Projects/Freelance/Kestrel/Shot list.md";
const CONVERT = () => ({
    [KES]: `${PROJECT}## To Do\n\n- [x] Shot list [[Shot list|🗒️]]\n`,
    [SHOT]: "---\ntags: [task]\n---\n- [>] Confirm the products [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n- [x] Packs: loaded and empty\n",
    "Projects/Freelance/Kestrel/Book it.md": "---\ntags: [task]\n---\nCall around.\n",
    "Projects/Freelance/Done Job/Done Job.md": "---\ntags: [project]\nstatus: Done\n---\n",
    "Projects/Freelance/Done Job/Wrap up.md": "---\ntags: [task]\n---\n- [>] Send the files ^wr4pup\n",
    "Archive/Old/Old.md": PROJECT,
    "Archive/Old/Old note.md": "---\ntags: [task]\n---\n- [>] Return the samples ^ar1chv\n",
    [day("2026-09-17")]: [
        "- [ ] Confirm the products [[Shot list|🗒️]] ^p7d2qe",          // a link back, by ID
        "- [ ] Book it [[Kestrel|⭕]] [[Book it|🗒️]]",                  // its own note
        "- [ ] Book it again [[Kestrel|⭕]] [[Book it|🔗]]",             // the mark before 🗒️
        "- [ ] Send the files [[Wrap up|🗒️]] ^wr4pup",                  // back to a finished project's note
        "- [ ] Return the samples [[Old note|🗒️]] ^ar1chv",             // back to an archived project's note
        "- [ ] Parent [[Kestrel|⭕]]",
        "\t- [ ] Packs: loaded and empty [[Shot list|🗒️]]",            // nested: no ⭕ of its own
    ].join("\n") + "\n",
    [day("2026-09-18")]: "- [x] Packs: loaded and empty [[Shot list|🗒️]]\n",     // from before IDs, by its text
    [RAFE]: "- [ ] Ask for the list [[Book it|🗒️]]\n",                          // outside the system: left alone
});

test("linkBackPass: a link back becomes ↗, every other 🗒️ or 🔗 ⋯; a top-level day line reading its project only through it gets that ⭕", async () => {
    const v = standIn({ notes: CONVERT() });
    const { changes } = await v.customJS.TaskIds.linkBackPass();
    assert.deepEqual(plain(changes.map((c) => [c.path.split("/").pop(), c.line, c.mark, c.byText, c.after])), [
        // Text matches first, for you to check before anything is written
        ["2026-09-17.md", 7, "↗", true, "\t- [ ] Packs: loaded and empty [[Shot list|↗]]"],
        ["2026-09-18.md", 1, "↗", true, "- [x] Packs: loaded and empty [[Kestrel|⭕]] [[Shot list|↗]]"],
        ["Kestrel.md", 6, "⋯", false, "- [x] Shot list [[Shot list|⋯]]"],
        ["2026-09-17.md", 1, "↗", false, "- [ ] Confirm the products [[Kestrel|⭕]] [[Shot list#^p7d2qe|↗]] ^p7d2qe"],
        ["2026-09-17.md", 2, "⋯", false, "- [ ] Book it [[Kestrel|⭕]] [[Book it|⋯]]"],
        ["2026-09-17.md", 3, "⋯", false, "- [ ] Book it again [[Kestrel|⭕]] [[Book it|⋯]]"],
        ["2026-09-17.md", 4, "↗", false, "- [ ] Send the files [[Done Job|⭕]] [[Wrap up#^wr4pup|↗]] ^wr4pup"],
        ["2026-09-17.md", 5, "↗", false, "- [ ] Return the samples [[Old|⭕]] [[Old note#^ar1chv|↗]] ^ar1chv"],
    ]);
    assert.equal(v.notes()[day("2026-09-17")], CONVERT()[day("2026-09-17")], "a dry run writes nothing");
});

test("linkBackPass with write: every note written, a note outside the system untouched, and a second run finds nothing", async () => {
    const v = standIn({ notes: CONVERT() });
    const { changes, left } = await v.customJS.TaskIds.linkBackPass({ write: true });
    assert.equal(changes.length, 8);
    assert.deepEqual(plain(left), []);
    const notes = v.notes();
    assert.doesNotMatch(Object.entries(notes).filter(([p]) => p !== RAFE).map(([, t]) => t).join("\n"), /🗒|🔗/u);
    assert.equal(notes[RAFE], CONVERT()[RAFE]);
    assert.equal(notes[day("2026-09-18")], "- [x] Packs: loaded and empty [[Kestrel|⭕]] [[Shot list|↗]]\n");
});

// ---------------------------------------------------------------- review fixes (round 1)

const PIN = "Projects/Freelance/Pinecrest/Pinecrest.md";
const MEET = "Projects/Freelance/Pinecrest/logs/2026-09-15 Pinecrest kickoff.md";
const OWN = "Projects/Freelance/Kestrel/Pick fonts.md";
const TIMED = (line) => ({ [KES]: PROJECT, [PIN]: PROJECT, [MEET]: "---\ntags: [log]\n---\n", [OWN]: "---\ntags: [task]\n---\n", [day("2026-09-17")]: `${line}\n\t- 9:00am - 10:00am\n` });
const counted = (v) => {
    const tr = v.customJS.TimeReport;
    const daily = [{ date: "2026-09-17", path: day("2026-09-17"), text: v.notes()[day("2026-09-17")] }];
    const model = tr.build(daily, tr.appIndex(), {});
    // `conflicts`: entries on a line whose ⭕ and note disagree, counted toward neither project (OBS-213)
    return plain({ projects: model.entries.map((e) => e.project), conflicts: model.disputed.length });
};

test("a line's own note is its ⋯ and nothing else: a ↗ is read by nobody (OBS-196)", () => {
    // ⋯ in Kestrel, ↗ to a meeting log in Pinecrest, ⭕ Kestrel: Kestrel's, and nothing disagrees
    assert.deepEqual(counted(standIn({ notes: TIMED("- [x] Pick fonts [[Kestrel|⭕]] [[Pick fonts|⋯]] [[2026-09-15 Pinecrest kickoff|↗]]") })), { projects: [KES], conflicts: 0 });
    // Only a ↗: Unassigned, like any line with no ⭕
    assert.deepEqual(counted(standIn({ notes: TIMED("- [x] Pick fonts [[2026-09-15 Pinecrest kickoff|↗]]") })), { projects: [null], conflicts: 0 });
    // ⭕ Pinecrest with its own ⋯ in Kestrel: they disagree, so it counts toward neither (OBS-213)
    assert.deepEqual(counted(standIn({ notes: TIMED("- [x] Pick fonts [[Pinecrest|⭕]] [[Pick fonts|⋯]] [[2026-09-15 Pinecrest kickoff|↗]]") })), { projects: [], conflicts: 1 });
    // ⭕ Kestrel and only a ↗ to a log in Pinecrest: nothing disagrees, and the ⭕ says where it goes
    assert.deepEqual(counted(standIn({ notes: TIMED("- [x] Pick fonts [[Kestrel|⭕]] [[2026-09-15 Pinecrest kickoff|↗]]") })), { projects: [KES], conflicts: 0 });
});

test("OBS-41: an index a run began with answers what a note is once CustomJS has started over", () => {
    const week = `${PLANNER}/weeks/2026w38.md`;
    const v = standIn({ notes: { [KES]: PROJECT, [week]: "", [day("2026-09-17")]: "", "Reference/People/Someone.md": "---\nparent: \"[[Kestrel]]\"\n---\n" } });
    const tr = v.customJS.TimeReport;
    const index = tr.appIndex();
    for (const name of ["Schedule", "DatePrompt", "TimeReport", "TaskIds"]) delete v.customJS[name];
    assert.equal(index.inSystem("Reference/People/Someone.md"), false);
    assert.equal(index.inSystem(KES), true);
    assert.deepEqual(plain([index.kind(week), index.kind(day("2026-09-17")), index.kind(KES)]), ["week", "day", "other"], "a daily note read as anything else would lose its time");
    assert.deepEqual(plain(tr.parentProblems(index)), []);
});

test("taskNotes finds a note by its links: a mark on a sub-task in a project note, and a day with no time, reach the checks", async () => {
    const v = standIn({ notes: {
        [KES]: `${PROJECT}- [ ] Shoot\n\t- [ ] Charge batteries [[2026-09-23|🚩 9/23]]\n`,
        [day("2026-09-17")]: "- [x] No time here [[Kestrel|⭕]] [[Pick fonts|⋯]]\n",
        [OWN]: "---\ntags: [task]\n---\nNo marks here.\n",
        "Reference/People/Someone.md": "- [ ] Outside the system [[Kestrel|⭕]]\n",
        "Archive/Old/Old note.md": "- [ ] Archived [[Kestrel|⭕]]\n",
    } });
    const tr = v.customJS.TimeReport;
    const found = plain((await tr.taskNotes([])).map((n) => n.path)).sort();
    assert.deepEqual(found, ["Archive/Old/Old note.md", KES, day("2026-09-17")].sort());
});

test("appIndex knows what waits in the Inbox, by the one name for it", () => {
    const v = standIn({ notes: { [KES]: PROJECT, "Inbox/Lamp.md": "---\ntags: [task]\n---\n" } });
    const index = v.customJS.TimeReport.appIndex();
    assert.deepEqual([index.inInbox("Inbox/Lamp.md"), index.inInbox(KES)], [true, false]);
});

test("the report's task checks read Archive too: an archived task note's lines are checked (Brian, 2026-10-28)", async () => {
    const v = standIn({ notes: {
        "Archive/Old/Old.md": PROJECT,
        "Archive/Old/Old note.md": "---\ntags: [task]\n---\n- [>] Return the samples [[2026-09-18#^ar1chv|9/18]] ^ar1chv\n",
        [day("2026-09-17")]: "- [ ] Return the samples [[Old|⭕]] ^ar1chv\n",
    } });
    const tr = v.customJS.TimeReport;
    const notes = await tr.taskNotes([]);
    assert.ok(notes.some((n) => n.path === "Archive/Old/Old note.md"));
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, tr.appIndex(), notes);
    assert.ok(model.problems.length + model.projectProblems.length > 0, "its forward date points at a day the task isn't on");
    assert.ok(v.check().length > 0, "and the stand-in's check reads Archive as the report does");
});

test("until the one-time conversion runs, the time report and invoices write nothing, and say why", async () => {
    const v = standIn({ notes: { [KES]: PROJECT, [day("2026-09-17")]: "- [ ] Book it [[Kestrel|⭕]] [[Book it|🗒️]]\n\t- 9:00am - 10:00am\n- A [[note|🗒️]] in a line's text\n" } });
    const tr = v.customJS.TimeReport;
    assert.equal(tr.oldMarkLines([{ text: "- [ ] a [[K|⭕]] [[N|🗒️]] ^abc123\n9:00am\tStandup [[2026-09-14 Standup|🗒]]\nProse with [[N|🗒️]] at the end\n- b [[N|🗒️]] then text\n" }]), 2,
        "a list line and an old meeting line whose run ends in one; not prose, nor a link before more text");
    await assert.rejects(tr.currentModel());
    assert.match(v.notices.at(-1), /^1 line in the daily notes still end/);
    const after = standIn({ notes: { [KES]: PROJECT, [day("2026-09-17")]: "- [ ] Book it [[Kestrel|⭕]] [[Book it|⋯]]\n" } });
    assert.equal(after.customJS.TimeReport.oldMarksNotice([{ text: after.notes()[day("2026-09-17")] }]), false);
});

test("linkBackPass: an old meeting line is converted; a link back by an ID on a line never sent is listed first; Archive is converted too", async () => {
    const v = standIn({ notes: {
        [KES]: PROJECT, [PIN]: PROJECT, [MEET]: "---\ntags: [log]\n---\n",
        "Projects/Freelance/Pinecrest/Copy.md": "---\ntags: [task]\n---\n- [ ] Copy edits ^cp3dit\n",
        "Archive/Old/Old.md": PROJECT,
        "Archive/Old/Draft.md": "---\ntags: [task]\n---\n",
        "Archive/Old/Old tasks.md": "- [>] Draft [[2026-09-17#^dr4ft1|9/17]] [[Draft|🗒️]] ^dr4ft1\n",
        [day("2026-09-17")]: [
            "- [ ] Copy edits [[Copy|🗒️]] ^cp3dit",                          // the note's line was never sent
            "10:00am\tStandup [[2026-09-15 Pinecrest kickoff|🗒️]]",           // a meeting line in the old form
        ].join("\n") + "\n",
    } });
    const { changes } = await v.customJS.TaskIds.linkBackPass();
    assert.deepEqual(plain(changes.map((c) => [c.path.split("/").pop(), c.line, c.mark, c.review, c.home, c.after])), [
        ["2026-09-17.md", 1, "↗", true, PIN, "- [ ] Copy edits [[Pinecrest|⭕]] [[Copy#^cp3dit|↗]] ^cp3dit"],
        ["Old tasks.md", 1, "⋯", false, null, "- [>] Draft [[2026-09-17#^dr4ft1|9/17]] [[Draft|⋯]] ^dr4ft1"],
        ["2026-09-17.md", 2, "⋯", false, null, "10:00am\tStandup [[2026-09-15 Pinecrest kickoff|⋯]]"],
    ]);
    const { old } = await v.customJS.TaskIds.linkBackPass({ write: true });
    assert.equal(old, 0);
});

test("linkBackPass: a line whose time the report would count differently afterwards is listed first, with its minutes", async () => {
    // A line typed with two old marks: its own note in Kestrel, and a link back to a log in Pinecrest. Main
    // compares both with the ⭕ and counts the half hour toward neither; afterwards only the ⋯ is the line's
    // note, so it counts toward Kestrel, and the dry run says so. A line with one mark reads as before.
    const v = standIn({ notes: {
        [KES]: PROJECT, [PIN]: PROJECT, [OWN]: "---\ntags: [task]\n---\n",
        [MEET]: "---\ntags: [log]\n---\n- [>] Pick fonts [[2026-09-17#^pf0nt5|9/17]] [[Kestrel|⭕]] ^pf0nt5\n",
        [day("2026-09-17")]: "- [x] Book it [[Kestrel|⭕]] [[2026-09-15 Pinecrest kickoff|🗒️]]\n\t- 8:00am - 8:30am\n- [x] Pick fonts [[Kestrel|⭕]] [[Pick fonts|🗒️]] [[2026-09-15 Pinecrest kickoff|🗒️]] ^pf0nt5\n\t- 9:00am - 9:30am\n",
    } });
    const { changes } = await v.customJS.TaskIds.linkBackPass();
    assert.deepEqual(plain(changes.map((c) => [c.line, c.mark, c.review, c.moves])), [
        [3, "↗", true, [{ minutes: 30, from: null, to: KES }]],
        [1, "⋯", false, []],
    ]);
});

// ---------------------------------------------------------------- Schedule's sent line (review round 1)

test("sentLine: a source tagged with a subtag names itself; a ⭕ in the title stays; the ↗ links the task's line by its ID, after the ⋯, replacing one the line had, by path when names clash", async () => {
    const SUBTAG = "Projects/Freelance/Retainer/Retainer.md";
    const NOTE = "Projects/Freelance/Kestrel/Draft.md";
    const sent = async (notes, from, line) => {
        const v = standIn({ notes: { [KES]: PROJECT, [PIN]: PROJECT, [OWN]: "---\ntags: [task]\n---\n", ...notes, [from]: `${notes[from] ?? ""}${line}\n` }, open: from, at: (notes[from] ?? "").split("\n").length - 1 });
        await v.schedule("2026-09-19");
        return v.notes()[day("2026-09-19")].trim().replace(/ \^\w+$/, "");
    };
    assert.equal(await sent({ [SUBTAG]: "---\ntags: [project/retainer]\n---\n" }, SUBTAG, "- [ ] Send the report"), "- [ ] Send the report [[Retainer|⭕]]");
    assert.equal(await sent({ [NOTE]: "---\ntags: [task]\n---\n" }, NOTE, "- [ ] Ask [[Pinecrest|⭕]] about it [[Pinecrest|⭕]]"), "- [ ] Ask [[Pinecrest|⭕]] about it [[Kestrel|⭕]] [[Draft#^hzt03c|↗]]");
    assert.equal(await sent({ [NOTE]: "---\ntags: [task]\n---\n" }, NOTE, "- [ ] Pick fonts [[Pick fonts|⋯]] 🆓 [[Old source|↗]]"), "- [ ] Pick fonts [[Kestrel|⭕]] [[Pick fonts|⋯]] [[Draft#^hzt03c|↗]] 🆓");
    assert.equal(await sent({ [NOTE]: "---\ntags: [task]\n---\n", "Projects/Freelance/Pinecrest/Draft.md": "" }, NOTE, "- [ ] Mobile layout"), "- [ ] Mobile layout [[Kestrel|⭕]] [[Projects/Freelance/Kestrel/Draft#^hzt03c|↗]]");
    // Its own ⋯ note in the Inbox, in no project: the source's project, as before OBS-208
    assert.equal(await sent({ [MEET]: "---\ntags: [log]\n---\n", "Inbox/Idea.md": "" }, MEET, "- [ ] Follow up [[Idea|⋯]]"), "- [ ] Follow up [[Pinecrest|⭕]] [[Idea|⋯]] [[2026-09-15 Pinecrest kickoff#^hzt03c|↗]]");
});

// ---------------------------------------------------------------- waiting for the conversion (review round 3)

test("until the one-time conversion runs, the calendar sync changes nothing, and says why", async () => {
    const code = fs.readFileSync(new URL("../CustomJS/calendarSync.js", import.meta.url), "utf8");
    const Sync = vm.runInContext(`${code}\n;CalendarSync`, vm.createContext({ customJS: { TimeReport: { oldMarksLeft: async () => 2 } }, console }));
    const sync = new Sync();
    let fetched = false;
    sync.fetchNow = async () => { fetched = true; return null; };
    assert.match(await sync.run(), /^2 lines in the daily notes still end in a 🗒️ or 🔗 link, so the calendar sync waits/);
    assert.equal(fetched, false, "not even a fetch");
});

test("oldMarksLeft counts every daily note, one with no times included, as the calendar sync and the Log template read them", async () => {
    const v = standIn({ notes: { [day("2026-09-17")]: "- [<] Planning [[2026-09-17 Planning|🗒️]]\n- Prose [[Note|🗒️]] then more\n", [day("2026-09-18")]: "- [<] Retro [[2026-09-18 Retro|⋯]]\n" } });
    const tr = v.customJS.TimeReport;
    assert.equal(await tr.oldMarksLeft(), 1);
    assert.equal(tr.oldMarkLines(await tr.readDailyNotes(v.customJS.Schedule)), 0, "the report reads only days with times");
});

test("a change reads only a line's ⋯ for its own note; its ↗ joins nothing, and a line whose links moved is still found", () => {
    const v = standIn({ notes: {} });
    const at = (lines, raw, n = 0) => v.customJS.TaskChange.locate(lines, { raw, at: n });
    assert.equal(at(["- [ ] A [[Src|↗]] [[P/Own|⋯]]"], "- [ ] A [[Src|↗]] [[Own|⋯]]"), 0);
    assert.equal(at(["- [ ] B", "- [ ] A [[Own|⋯]]"], "- [ ] A [[Own|⋯]]"), 1, "a line that shifted");
    assert.equal(at(["- [ ] A [[X|⭕]]", "- [ ] A [[Y|⭕]]"], "- [ ] A [[Y|⭕]]"), 1, "the line as it was read, before one that differs only in a link");
    assert.equal(at(["- [ ] B"], "- [ ] A"), -1);
    const own = (text) => [...v.customJS.TimeReport.lineLinks(v.customJS.TimeReport.classify(text).body).notes].map((l) => l.target);
    assert.deepEqual(own("- [ ] A [[B|⭕]] [[Src|↗]] [[Own|⋯]]"), ["Own"]);
    assert.deepEqual(own("- [ ] A [[B|⭕]] [[Src|↗]]"), []);
});
