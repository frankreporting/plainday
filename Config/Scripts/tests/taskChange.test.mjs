// Scenario tests for a project change (OBS-225): AddProjectLink, MoveToProject and AddTaskNote on a stand-in
// vault, through the real TaskChange, each with the checks after it, and again with the cache a command
// behind. Every name, note and amount here is invented. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { standIn, PLANNER } from "./standInVault.mjs";

const day = (d) => `${PLANNER}/days/${d}.md`;
const PROJECT = "---\ntags: [project]\n---\n";
const OLD = "Projects/Old/Old.md", NEW = "Projects/New/New.md", INVOICE = "Reference/Invoices/2001-OLD.md";
const NOTE = "Projects/Old/Write copy.md", LOG = "Projects/Old/›logs/2026-09-16 Planning.md";
const taskNote = (body = "") => `---\ntags: [task]\nparent: "[[Old]]"\n---\n${body}`;
const base = { [OLD]: PROJECT, [NEW]: PROJECT };
const plain = (x) => JSON.parse(JSON.stringify(x));
const scenario = (name, fn) => {
    for (const lag of [false, true]) test(`${name}${lag ? " (the cache a command behind)" : ""}`, () => fn({ lag }));
};
const lineOf = (v, path, text) => v.notes()[path].split("\n").find((l) => l.includes(text));
// An invoice billing `rows` ([date, "h:mmam", "h:mmam"]) to `project`, with its status
const invoice = (status, rows, project = "Old") => [
    "---", "tags: [invoice]", `number: 2001-OLD`, `invoice_status: ${status}`, 'paid: "2026-09-15"', `parent: "[[${project}]]"`, "---",
    "## Billed entries", "", "| Date | Time | Project | Task | Notes | Rate | Hours |", "| --- | --- | --- | --- | --- | --: | --: |",
    ...rows.flatMap(([d, a, b]) => [`| **[[${d}\\|${d}]]** |  |  |  |  |  | **1.00** |`, `|  | ${a} - ${b} | [[${project}]] | Work |  | 10.00 | 1.00 |`]), "",
].join("\n");

scenario("AddProjectLink on a subtask's day line changes the whole task: it asks about the parent, and the note it sits in moves with every line", async ({ lag }) => {
    const notes = {
        ...base,
        [NOTE]: taskNote("- [>] Send final copy [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n"),
        [day("2026-09-11")]: "- [x] Copy: first draft [[Old|⭕]] [[Write copy|⋯]]\n\t- 3:00pm - 4:20pm\n",
        [day("2026-09-17")]: "- [ ] Send final copy [[Old|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n",
    };
    let v = standIn({ notes, open: day("2026-09-17"), at: 0, lag });
    await v.addProjectLink(NEW, null);
    const [q] = plain(v.asked);
    assert.equal(q.title, "Moving a subtask requires moving its parent");
    assert.deepEqual([q.label, q.name], ["Parent", "Write copy"]);
    assert.deepEqual(q.words, ["Move this task? Any other subtasks and task notes will also move, and time entries will now count toward ⭕ New."]);
    assert.deepEqual([q.lines, q.time], ["9/11, 9/17", "9/11"], "what it covers, which it doesn't list");
    assert.deepEqual(v.notes(), notes, "Cancel changes nothing");
    v = standIn({ notes, open: day("2026-09-17"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.ok(v.notes()["Projects/New/Write copy.md"]);
    assert.equal(lineOf(v, day("2026-09-11"), "first draft"), "- [x] Copy: first draft [[New|⭕]] [[Write copy|⋯]]");
    assert.equal(lineOf(v, day("2026-09-17"), "final copy"), "- [ ] Send final copy [[New|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    assert.deepEqual(v.problems(), []);
});

scenario("a task and its subtasks share one project: picking the project its note is in brings a subtask's day back to it", async ({ lag }) => {
    const v = standIn({ notes: {
        ...base,
        [NOTE]: taskNote("- [>] Send final copy [[2026-09-14#^p7d2qe|9/14]] ^p7d2qe\n"),
        [day("2026-09-15")]: "- [x] Copy: revisions [[New|⭕]] [[Write copy|⋯]]\n",
        [day("2026-09-14")]: "- [ ] Send final copy [[New|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n\t- 9:00am - 10:00am\n",
    }, open: day("2026-09-15"), at: 0, lag });
    assert.deepEqual(v.problems(), [`own note ${day("2026-09-15")}:1`, `parent ${day("2026-09-14")}:1`]);
    await v.addProjectLink(OLD);
    assert.deepEqual(plain(v.asked).map((q) => q.time), ["9/14"], "the subtask's time moves, so it asks");
    assert.equal(lineOf(v, day("2026-09-15"), "revisions"), "- [x] Copy: revisions [[Old|⭕]] [[Write copy|⋯]]");
    assert.equal(lineOf(v, day("2026-09-14"), "final copy"), "- [ ] Send final copy [[Old|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    assert.match(v.notices.at(-1), /^2 lines now link ⭕ Old/);
    assert.deepEqual(v.problems(), []);
});

scenario("up and down: a change from a subtask's day moves the log the task is a follow-up of, the task's note, and the subtask's own note, and the question names them all", async ({ lag }) => {
    const SUB = "Projects/Old/Send final copy.md";
    const v = standIn({ notes: {
        ...base,
        [LOG]: "---\ntags: [log]\n---\n## Follow-ups\n\n- [x] Write copy [[Write copy|⋯]]\n- [ ] Ask about [[Write copy]]\n",
        [NOTE]: taskNote("- [>] Send final copy [[2026-09-17#^p7d2qe|9/17]] [[Send final copy|⋯]] ^p7d2qe\n"),
        [SUB]: taskNote(),
        [day("2026-09-16")]: "- [<] 10:00am\tPlanning [[Old|⭕]] [[2026-09-16 Planning|⋯]]\n\t- 10:00am - 11:00am\n",
        [day("2026-09-17")]: "- [ ] Send final copy [[Old|⭕]] [[Send final copy|⋯]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n",
    }, open: day("2026-09-17"), at: 0, lag });
    await v.addProjectLink(NEW);
    const [q] = plain(v.asked);
    assert.equal(q.title, "Move 3 notes?");
    assert.deepEqual([q.label, q.name], ["Notes", "Send final copy, Write copy, 2026-09-16 Planning"]);
    assert.deepEqual(q.words, ["Their subtasks and task notes will also move, and time entries will now count toward ⭕ New."]);
    for (const p of ["Projects/New/Send final copy.md", "Projects/New/Write copy.md", "Projects/New/›logs/2026-09-16 Planning.md"]) assert.ok(v.notes()[p], p);
    assert.equal(lineOf(v, day("2026-09-16"), "Planning"), "- [<] 10:00am\tPlanning [[New|⭕]] [[2026-09-16 Planning|⋯]]");
    assert.equal(lineOf(v, day("2026-09-17"), "final copy"), "- [ ] Send final copy [[New|⭕]] [[Send final copy|⋯]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    assert.deepEqual(v.problems(), []);
});

scenario("a plain note isn't a parent: a day line sent from one changes alone, and the note stays", async ({ lag }) => {
    const PLAIN = "Projects/Old/Ideas.md";
    const v = standIn({ notes: {
        ...base, [PLAIN]: "---\ntags: []\n---\n- [>] Try it [[2026-09-17#^abc123|9/17]] ^abc123\n",
        [day("2026-09-17")]: "- [ ] Try it [[Old|⭕]] [[Ideas#^abc123|↗]] ^abc123\n",
    }, open: day("2026-09-17"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(plain(v.asked), []);
    assert.ok(v.notes()[PLAIN]);
    assert.equal(lineOf(v, day("2026-09-17"), "Try it"), "- [ ] Try it [[New|⭕]] [[Ideas#^abc123|↗]] ^abc123");
});

scenario("AddProjectLink on a task with a note: it asks once, then the note, every day line and its project-note line all change", async ({ lag }) => {
    const v = standIn({ notes: {
        [OLD]: `${PROJECT}## To Do\n\n- [x] Write copy [[Write copy|⋯]]\n- [ ] Stay here\n\n## Time Report\n`,
        [NEW]: `${PROJECT}## To Do\n\n- [ ] Already here\n\n## Time Report\n`,
        [NOTE]: taskNote("- [x] First draft\n- [>] Send final copy [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n"),
        [day("2026-09-11")]: "- [x] Copy: first draft [[Old|⭕]] [[Write copy|⋯]]\n\t- 3:00pm - 4:20pm\n",
        [day("2026-09-15")]: "- [x] Copy: revisions [[Other|⭕]] [[Write copy|⋯]]\n\t- 4:00pm - 5:10pm\n",
        [day("2026-09-17")]: "- [ ] Send final copy [[Old|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n",
    }, open: day("2026-09-11"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(v.asked.length, 1, "one question");
    const [q] = plain(v.asked);
    assert.equal(q.title, "Move task?");
    assert.deepEqual([q.note, q.from, q.to], ["Write copy", "Old", "New"]);
    assert.deepEqual([q.label, q.name], ["Task", "Write copy"]);
    assert.deepEqual(q.words, ["Any subtasks and task notes will also move, and time entries will now count toward ⭕ New."]);
    assert.deepEqual([q.lines, q.time], ["9/11, 9/15, 9/17", "9/11"]);
    const moved = "Projects/New/Write copy.md";
    assert.equal(v.notes()[NOTE], undefined);
    assert.match(v.notes()[moved], /parent: "\[\[New/, "SyncArea set its parent");
    assert.match(v.notes()[moved], /- \[x\] First draft\n- \[>\] Send final copy \[\[2026-09-17#\^p7d2qe\|9\/17\]\] \^p7d2qe/, "its own lines don't change");
    assert.equal(lineOf(v, day("2026-09-11"), "first draft"), "- [x] Copy: first draft [[New|⭕]] [[Write copy|⋯]]");
    assert.equal(lineOf(v, day("2026-09-15"), "revisions"), "- [x] Copy: revisions [[New|⭕]] [[Write copy|⋯]]", "a third project's ⭕ is replaced too");
    assert.equal(lineOf(v, day("2026-09-17"), "final copy"), "- [ ] Send final copy [[New|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe", "its subtask's day line, through the note");
    assert.equal(v.notes()[OLD], `${PROJECT}## To Do\n\n- [ ] Stay here\n\n## Time Report\n`);
    assert.equal(v.notes()[NEW], `${PROJECT}## To Do\n\n- [ ] Already here\n- [x] Write copy [[Write copy|⋯]]\n\n## Time Report\n`);
    assert.deepEqual(v.check(), []);
    assert.ok(v.left.includes(day("2026-09-15")), "a daily note it wrote takes a new fold snapshot");
});

scenario("Cancel writes nothing; Esc on the menu writes nothing; the line changing meanwhile writes nothing", async ({ lag }) => {
    const notes = { ...base, [NOTE]: taskNote(), [day("2026-09-11")]: "- [x] Copy [[Old|⭕]] [[Write copy|⋯]]\n\t- 3:00pm - 4:20pm\n" };
    let v = standIn({ notes, open: day("2026-09-11"), at: 0, lag });
    await v.addProjectLink(NEW, null);
    assert.deepEqual(v.notes(), notes);
    assert.equal(v.notices.at(-1), "Nothing changed");
    v = standIn({ notes, open: day("2026-09-11"), at: 0, lag });
    await v.addProjectLink(null);
    assert.deepEqual(v.notes(), notes);
    assert.equal(v.notices.at(-1), "No project or area picked, so nothing changed");
    v = standIn({ notes, open: day("2026-09-11"), at: 0, lag });
    const editor = v.app.workspace.activeLeaf.view.editor;
    v.answering(NEW, "move");
    const ask = v.customJS.AddTaskNote.confirmMove;
    v.customJS.AddTaskNote.confirmMove = async (...a) => { editor.replaceRange("!", { line: 0, ch: 6 }); return ask(...a); };
    await v.customJS.AddProjectLink.invoke();
    assert.equal(v.notes()[day("2026-09-11")], "- [x] !Copy [[Old|⭕]] [[Write copy|⋯]]\n\t- 3:00pm - 4:20pm\n");
    assert.ok(v.notes()[NOTE], "nothing moved");
    assert.equal(v.notices.at(-1), "The line changed while you were asked, so nothing changed");
});

scenario("the billed-time refusal: paid and sent refuse after the answer, a draft and moving back don't, and an entry edited since matches by overlap", async ({ lag }) => {
    const LINE = "- [x] Inventory [[Old|⭕]]\n\t- 9:30am - 12:15pm\n\t- 1:00pm - 2:45pm\n";
    const run = async (status, pick = NEW, billedTo = "Old", rows = [["2026-09-11", "9:30am", "12:15pm"]]) => {
        const notes = { ...base, [INVOICE]: invoice(status, rows, billedTo), [day("2026-09-11")]: LINE };
        const v = standIn({ notes, open: day("2026-09-11"), at: 0, lag });
        await v.addProjectLink(pick);
        return v;
    };
    for (const status of ["paid", "sent", "my own status"]) {
        const v = await run(status);
        assert.equal(v.asked.length, 1, status);
        assert.equal(plain(v.asked)[0].title, "Change project?");
        assert.equal(lineOf(v, day("2026-09-11"), "Inventory"), "- [x] Inventory [[Old|⭕]]", status);
        assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/11 is on 2001-OLD/, status);
    }
    assert.equal(lineOf(await run("draft"), day("2026-09-11"), "Inventory"), "- [x] Inventory [[New|⭕]]", "a draft never refuses");
    assert.equal(lineOf(await run("canceled"), day("2026-09-11"), "Inventory"), "- [x] Inventory [[New|⭕]]", "nor a canceled one");
    assert.equal(lineOf(await run("paid", NEW, "New"), day("2026-09-11"), "Inventory"), "- [x] Inventory [[New|⭕]]", "moving time back to the project that billed it");
    const edited = await run("paid", NEW, "Old", [["2026-09-11", "1:00pm", "2:30pm"]]);
    assert.match(edited.notices.at(-1), /^Nothing changed/, "an entry edited since it was billed, by overlap");
    assert.equal(lineOf(await run("paid", NEW, "Old", [["2026-09-20", "9:30am", "12:15pm"]]), day("2026-09-11"), "Inventory"), "- [x] Inventory [[New|⭕]]", "a row on no day near it");
});

scenario("the billed-time check: a day with no entries is never checked, and an ended event's span counts as an entry", async ({ lag }) => {
    const notes = { ...base, [INVOICE]: invoice("paid", [["2026-09-14", "10:00am", "10:45am"]]), [day("2026-09-14")]: "- [<] 10:00am\tReview [[Old|⭕]]\n\t- 10:45am\n", [day("2026-09-15")]: "- [ ] Later [[Old|⭕]]\n" };
    let v = standIn({ notes, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(lineOf(v, day("2026-09-14"), "Review"), "- [<] 10:00am\tReview [[Old|⭕]]");
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/14 is on 2001-OLD/);
    v = standIn({ notes, open: day("2026-09-15"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(plain(v.asked), [], "no time, no question");
    assert.equal(lineOf(v, day("2026-09-15"), "Later"), "- [ ] Later [[New|⭕]]");
});

scenario("MoveToProject on a log: the log moves into the new ›logs, its event line and a line sent from it follow, and a note its text links doesn't", async ({ lag }) => {
    const SHOT = "Projects/Old/Shot list.md";
    const v = standIn({ notes: {
        ...base,
        [SHOT]: taskNote(),
        [LOG]: "---\ntags: [log]\n---\n## Follow-ups\n\n- [>] Confirm the [[Shot list]] [[2026-09-19#^abc123|9/19]] ^abc123\n",
        [day("2026-09-16")]: "- [<] 10:00am\tPlanning [[Old|⭕]] [[2026-09-16 Planning|⋯]]\n\t- 10:00am - 11:00am\n",
        [day("2026-09-19")]: "- [ ] Confirm the [[Shot list]] [[Old|⭕]] [[2026-09-16 Planning#^abc123|↗]] ^abc123\n",
    }, open: LOG, at: 0, lag });
    await v.moveToProject(NEW);
    const [q] = plain(v.asked);
    assert.equal(q.title, "Move log?");
    assert.deepEqual([q.label, q.name], ["Log", "2026-09-16 Planning"]);
    assert.deepEqual(q.words, ["Its follow-up tasks, along with any task notes, will also move, and its time entries will now count toward ⭕ New."]);
    assert.deepEqual([q.lines, q.time], ["9/16, 9/19", "9/16"]);
    assert.ok(v.notes()["Projects/New/›logs/2026-09-16 Planning.md"]);
    assert.equal(lineOf(v, day("2026-09-16"), "Planning"), "- [<] 10:00am\tPlanning [[New|⭕]] [[2026-09-16 Planning|⋯]]");
    assert.equal(lineOf(v, day("2026-09-19"), "Confirm"), "- [ ] Confirm the [[Shot list]] [[New|⭕]] [[2026-09-16 Planning#^abc123|↗]] ^abc123");
    assert.ok(v.notes()[SHOT], "linked only in the text: it stays");
    assert.deepEqual(v.problems(), []);
    // A follow-up's day takes its log with it: a log's follow-ups share its project
    v.open(day("2026-09-19"), 0);
    await v.addProjectLink(OLD);
    const back = plain(v.asked).at(-1);
    assert.equal(back.title, "Moving a subtask requires moving its parent");
    assert.deepEqual([back.label, back.name], ["Parent", "2026-09-16 Planning"]);
    assert.deepEqual(back.words, ["Move this log? Its other follow-up tasks, along with any task notes, will also move, and its time entries will now count toward ⭕ Old."]);
    assert.equal(lineOf(v, day("2026-09-19"), "Confirm"), "- [ ] Confirm the [[Shot list]] [[Old|⭕]] [[2026-09-16 Planning#^abc123|↗]] ^abc123");
    assert.ok(v.notes()[LOG], "the log is back in Old's ›logs");
    assert.equal(lineOf(v, day("2026-09-16"), "Planning"), "- [<] 10:00am\tPlanning [[Old|⭕]] [[2026-09-16 Planning|⋯]]");
    assert.deepEqual(v.problems(), []);
});

scenario("MoveToProject on a note already in the project picked puts its lines right; with nothing to change it says so", async ({ lag }) => {
    const notes = { ...base, [NOTE]: taskNote(), [day("2026-09-17")]: "- [ ] Write copy [[Other|⭕]] [[Write copy|⋯]]\n" };
    const v = standIn({ notes, open: NOTE, at: 0, lag });
    await v.moveToProject(OLD);
    assert.deepEqual(plain(v.asked), [], "no time moves");
    assert.equal(lineOf(v, day("2026-09-17"), "Write copy"), "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]");
    assert.equal(v.notices.at(-1), "Write copy was already in Old. A line now links ⭕ Old");
    v.open(NOTE, 0);
    await v.moveToProject(OLD);
    assert.equal(v.notices.at(-1), "Write copy is already in Old");
});

scenario("MoveToProject leaves alone what it doesn't work on, and says why, before any menu", async ({ lag }) => {
    const SHEET = "Projects/Old/Old timesheet.md", PERSON = "Reference/People/Rafe.md";
    const notes = { ...base, [SHEET]: "---\ntags: [timesheet]\n---\n", [PERSON]: "- [ ] Ask\n", [day("2026-09-18")]: "- [ ] A\n", [INVOICE]: invoice("paid", []) };
    for (const [path, said] of [
        [PERSON, "Rafe isn't in the Planner, Projects or the Inbox, where the system works, so nothing changed"],
        [day("2026-09-18"), "2026-09-18 stays where it is: run AddProjectLink on a line in it"],
        [SHEET, "Old timesheet stays where it is: a timesheet belongs to the time report"],
        [INVOICE, "2001-OLD stays where it is: an invoice belongs to the time report"],
    ]) {
        const v = standIn({ notes, open: path, at: 0, lag });
        await v.moveToProject(NEW);
        assert.deepEqual(v.notes(), notes, path);
        assert.deepEqual(plain(v.menus), [], path);
        assert.equal(v.notices.at(-1), said, path);
        assert.ok(!v.customJS.MoveToProject.movable([v.file(path)]), `${path}: the menus don't offer it`);
    }
});

scenario("several notes at once are each their own change: each asks; Cancel stops the rest and says what moved; a refusal skips only that note", async ({ lag }) => {
    const A = "Projects/Old/Alpha.md", B = "Projects/Old/Beta.md", C = "Projects/Old/Gamma.md";
    const notes = { ...base, [A]: taskNote(), [B]: taskNote(), [C]: taskNote() };
    let v = standIn({ notes, open: A, at: 0, lag });
    await v.moveToProject(NEW, ["move", null], [A, B, C]);
    assert.equal(v.asked.length, 2, "Beta's Cancel ends it");
    assert.ok(v.notes()["Projects/New/Alpha.md"] && v.notes()[B] && v.notes()[C]);
    assert.equal(v.notices.at(-1), "Stopped there: Alpha had already moved");
    v = standIn({ notes: { ...notes, [INVOICE]: invoice("paid", [["2026-09-11", "9:00am", "10:00am"]]), [day("2026-09-11")]: "- [x] Beta [[Old|⭕]] [[Beta|⋯]]\n\t- 9:00am - 10:00am\n" }, open: A, at: 0, lag });
    await v.moveToProject(NEW, "move", [A, B, C]);
    assert.ok(v.notes()["Projects/New/Alpha.md"] && v.notes()[B] && v.notes()["Projects/New/Gamma.md"], "only Beta stays");
    assert.ok(v.notices.some((n) => n.startsWith("Nothing changed: this task's time on 9/11")));
});

scenario("a project or area note moves its folder as it did, and a #project note that isn't its folder's own moves as a plain note", async ({ lag }) => {
    const ODD = "Projects/Old/Car checklist.md";
    let v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-17")]: "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]\n" }, open: OLD, at: 0, lag });
    await v.moveToProject(NEW);
    assert.deepEqual(plain(v.asked).map((q) => [q.note, q.from, q.to]), [["Old", null, "New"]]);
    assert.ok(v.notes()["Projects/New/Old/Old.md"] && v.notes()["Projects/New/Old/Write copy.md"]);
    assert.equal(lineOf(v, day("2026-09-17"), "Write copy"), "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]", "its lines are left alone");
    v = standIn({ notes: { ...base, [ODD]: PROJECT }, open: ODD, at: 0, lag });
    await v.moveToProject(NEW);
    assert.equal(plain(v.asked)[0].title, "Move note?");
    assert.ok(v.notes()["Projects/New/Car checklist.md"]);
    assert.match(v.notices.join("\n"), /a project needs a folder of its name, with the note inside/);
});

scenario("the menus leave out a #project note that isn't its folder's own; a file that isn't a note isn't offered and doesn't move", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [day("2026-09-17")]: "- [ ] A\n" }, open: day("2026-09-17"), at: 0, lag });
    await v.addProjectLink(NEW);
    const { exclude } = v.menus[0].options;
    assert.equal(exclude({ extension: "md", basename: "Car checklist", parent: { name: "Old" } }), true);
    assert.equal(exclude(v.file(NEW)), false);
    const pdf = { path: "Inbox/contract.pdf", name: "contract.pdf", extension: "pdf", parent: { path: "Inbox", name: "Inbox" } };
    assert.ok(!v.customJS.MoveToProject.movable([pdf]));
    v.answering(NEW, "move");
    await v.customJS.MoveToProject.move([pdf]);
    assert.equal(v.notices.at(-1), "contract.pdf isn't a note, so it wasn't moved");
});

scenario("AddProjectLink outside a periodic note changes nothing, before its menu, and says what to do instead", async ({ lag }) => {
    const notes = { [OLD]: `${PROJECT}## To Do\n\n- [ ] Build it\n`, [NEW]: PROJECT, [NOTE]: taskNote("- [ ] A subtask\n") };
    let v = standIn({ notes, open: OLD, at: 5, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(plain(v.menus), []);
    assert.equal(v.notices.at(-1), "A task moves from one of its days, or by cutting and pasting its line into the other project's To Do when nothing is attached to it");
    v = standIn({ notes, open: NOTE, at: 4, lag });
    await v.addProjectLink(NEW);
    assert.equal(v.notices.at(-1), "Run MoveToProject on this note: the note says the project, and its lines follow");
    assert.deepEqual(v.notes(), notes);
});

scenario("a note filed in no project moves with nothing asked, unless counted time would move", async ({ lag }) => {
    const LOOSE = "Inbox/Call the printer.md";
    const notes = { ...base, [LOOSE]: "---\ntags: [task]\n---\n", [day("2026-09-18")]: "- [ ] Call the printer [[Call the printer|⋯]]\n" };
    let v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(plain(v.asked), []);
    assert.ok(v.notes()["Projects/New/Call the printer.md"]);
    assert.equal(lineOf(v, day("2026-09-18"), "printer"), "- [ ] Call the printer [[New|⭕]] [[Call the printer|⋯]]");
    assert.deepEqual(v.check(), []);
    v = standIn({ notes: { ...notes, [day("2026-09-14")]: "- [x] Called [[Old|⭕]] [[Call the printer|⋯]]\n\t- 9:00am - 9:30am\n" }, open: day("2026-09-18"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(plain(v.asked).map((q) => q.title), ["Move task?"], "9/14's time would move");
});

scenario("a line that disagrees with itself doesn't ask, and the billed-time check still reads it", async ({ lag }) => {
    const MOVED = "Projects/New/Renew.md";
    const line = "- [x] Renew [[Old|⭕]] [[Renew|⋯]]\n\t- 9:00am - 10:00am\n";
    const notes = { ...base, [MOVED]: taskNote(), [day("2026-09-14")]: line };
    let v = standIn({ notes, open: MOVED, at: 0, lag });
    await v.moveToProject(NEW);
    assert.deepEqual(plain(v.asked), [], "its time wasn't counted, so none moves");
    assert.equal(lineOf(v, day("2026-09-14"), "Renew"), "- [x] Renew [[New|⭕]] [[Renew|⋯]]");
    v = standIn({ notes: { ...notes, [INVOICE]: invoice("paid", [["2026-09-14", "9:00am", "10:00am"]]) }, open: MOVED, at: 0, lag });
    await v.moveToProject(NEW);
    assert.equal(lineOf(v, day("2026-09-14"), "Renew"), "- [x] Renew [[Old|⭕]] [[Renew|⋯]]");
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/14 is on 2001-OLD/);
    // Its ⭕ already names the pick, and its note moves into it: the time would start counting
    const named = "Projects/Old/Renew.md";
    v = standIn({ notes: { ...base, [named]: taskNote(), [INVOICE]: invoice("paid", [["2026-09-14", "9:00am", "10:00am"]]), [day("2026-09-14")]: "- [x] Renew [[New|⭕]] [[Renew|⋯]]\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.ok(v.notes()[named], "refused, so the note stays");
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/14 is on 2001-OLD/);
});

scenario("warn after, never block: a line whose ⋯ links a note in Archive or a project's own note gets its ⭕, nothing asks, and the notice says its time counts nowhere", async ({ lag }) => {
    const ARCHIVED = "Archive/Gone/Write copy.md";
    let v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, [ARCHIVED]: taskNote(), [day("2026-09-14")]: "- [x] Write copy [[Gone|⭕]] [[Write copy|⋯]]\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(plain(v.asked), [], "no time moves to another project, and nothing waits on you");
    assert.ok(v.notes()[ARCHIVED]);
    assert.equal(lineOf(v, day("2026-09-14"), "Write copy"), "- [x] Write copy [[New|⭕]] [[Write copy|⋯]]");
    assert.equal(v.notices.at(-1), "9/14's line now disagrees with its note Write copy, which is filed in Gone, so its time counts nowhere until you fix it. The report lists it under Problems");
    assert.deepEqual(v.problems(), [`own note ${day("2026-09-14")}:1`]);
    // A project's own note, with another line whose time does move: the question says which is which
    v = standIn({ notes: { ...base, [day("2026-09-14")]: "- [>] Kickoff [[Old|⭕]] [[Old|⋯]] ^abc123\n\t- 9:00am - 10:00am\n", [day("2026-09-15")]: "- [x] Kickoff [[Old|⭕]] ^abc123\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addProjectLink(NEW);
    const [q] = plain(v.asked);
    assert.deepEqual([q.lines, q.time, q.stops], ["9/14, 9/15", "9/15", "9/14"]);
    assert.deepEqual(q.words, ["Its time entries will now count toward ⭕ New.", "Some of its time will stop counting, because its lines disagree with the task note."]);
    assert.match(v.notices.at(-1), /^9\/14's line now disagrees with its note Old, which is filed in Old/);
});

scenario("a change refused because a note of that name is at the destination writes nothing", async ({ lag }) => {
    const notes = { ...base, [NOTE]: taskNote(), "Projects/New/Write copy.md": taskNote(), [day("2026-09-17")]: "- [ ] Write it [[Old|⭕]] [[Projects/Old/Write copy|⋯]]\n" };
    const v = standIn({ notes, open: day("2026-09-17"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(v.notes(), notes);
    assert.equal(v.notices.at(-1), "Projects/New already has a note named Write copy, so nothing changed");
});

scenario("a failed write loses no line, and a second run finishes", async ({ lag }) => {
    const v = standIn({ notes: {
        [OLD]: `${PROJECT}## To Do\n\n- [ ] Write copy [[Write copy|⋯]]\n\t- [ ] Its nested task\n`, [NEW]: PROJECT, [NOTE]: taskNote(),
        [day("2026-09-11")]: "- [ ] Copy [[Old|⭕]] [[Write copy|⋯]]\n",
        [day("2026-09-15")]: "- [ ] Copy again [[Old|⭕]] [[Write copy|⋯]]\n",
    }, open: day("2026-09-11"), at: 0, lag });
    const process = v.app.vault.process;
    let fail = (f) => f.path === day("2026-09-15") || f.path === OLD;
    v.app.vault.process = async (f, fn) => { if (fail(f)) throw new Error("no"); return process(f, fn); };
    await v.addProjectLink(NEW);
    assert.ok(v.notes()["Projects/New/Write copy.md"], "the note moved first");
    assert.match(v.notices.at(-1), /couldn't write 2 notes; run it again to finish/);
    assert.match(v.notes()[OLD], /Write copy/, "the project-note line is still in the old note");
    assert.match(v.notes()[NEW], /- \[ \] Write copy \[\[Write copy\|⋯\]\]\n\t- \[ \] Its nested task/, "and it went in the new one first");
    fail = () => false;
    v.open(day("2026-09-15"), 0);
    await v.addProjectLink(NEW);
    assert.equal(lineOf(v, day("2026-09-15"), "Copy again"), "- [ ] Copy again [[New|⭕]] [[Write copy|⋯]]");
    assert.doesNotMatch(v.notes()[OLD], /Write copy/);
    assert.equal(v.notes()[NEW].match(/Write copy \[\[/g).length, 1, "not in twice");
});

scenario("code blocks, comments and line endings: a hidden line isn't one of the task's, a comment stays, and a CRLF note keeps its endings", async ({ lag }) => {
    const hidden = "```\n- [ ] Copy [[Old|⭕]] [[Write copy|⋯]]\n```\n";
    const v = standIn({ notes: {
        ...base, [NOTE]: taskNote(),
        [day("2026-09-11")]: `${hidden}- [ ] Copy [[Old|⭕]] [[Write copy|⋯]] %%was billed [[Old|⭕]]%%\n`,
        [day("2026-09-15")]: "- [ ] Copy again [[Old|⭕]] [[Write copy|⋯]]\r\n- [ ] Next\r\n",
    }, open: day("2026-09-11"), at: 3, lag });
    await v.addProjectLink(NEW);
    assert.equal(v.notes()[day("2026-09-11")], `${hidden}- [ ] Copy [[New|⭕]] [[Write copy|⋯]] %%was billed [[Old|⭕]]%%\n`);
    assert.equal(v.notes()[day("2026-09-15")], "- [ ] Copy again [[New|⭕]] [[Write copy|⋯]]\r\n- [ ] Next\r\n");
});

scenario("an older event line and a meeting line get their ⭕ like any other, and a log wrapped in the title is the line's own note", async ({ lag }) => {
    const v = standIn({ notes: {
        ...base, [LOG]: "---\ntags: [log]\n---\n",
        [day("2025-03-04")]: "11:00am [[2026-09-16 Planning|Planning]] [[Old|⭕]]\n\t- 11:00am - 11:45am\n",
    }, open: LOG, at: 0, lag });
    await v.moveToProject(NEW);
    assert.equal(lineOf(v, day("2025-03-04"), "Planning"), "11:00am [[2026-09-16 Planning|Planning]] [[New|⭕]]");
    assert.deepEqual(plain(v.asked).map((q) => q.title), ["Move log?"]);
});

scenario("AddTaskNote on a line with only a ↗ makes it a note of its own, and the ⋯ goes on every line of the task, ahead of the ↗", async ({ lag }) => {
    const v = standIn({ notes: {
        ...base, [NOTE]: taskNote("- [>] Send final copy [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n"),
        [day("2026-09-17")]: "- [ ] Send final copy [[Old|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n",
    }, open: day("2026-09-17"), at: 0, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/Old/Send final copy.md"]);
    assert.equal(lineOf(v, day("2026-09-17"), "final"), "- [ ] Send final copy [[Old|⭕]] [[Send final copy|⋯]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    assert.equal(lineOf(v, NOTE, "final"), "- [>] Send final copy [[2026-09-17#^p7d2qe|9/17]] [[Send final copy|⋯]] ^p7d2qe");
    assert.deepEqual(v.check(), []);
    // Run again, from the [>] line: nothing to add
    v.open(NOTE, v.notes()[NOTE].split("\n").findIndex((l) => l.includes("final")));
    await v.addTaskNote();
    assert.equal(v.notices.at(-1), "Every line of this task already links Send final copy");
});

scenario("AddTaskNote on a line with a ⋯ puts that note on the task's other lines, and leaves a line that has one alone", async ({ lag }) => {
    const v = standIn({ notes: {
        ...base, [NOTE]: taskNote(), "Projects/Old/Other note.md": taskNote(),
        [OLD]: `${PROJECT}## To Do\n\n- [>] Write copy [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n`,
        [day("2026-09-15")]: "- [>] Write copy [[Old|⭕]] [[Other note|⋯]] ^k3x9m2\n",
        [day("2026-09-17")]: "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]] ^k3x9m2\n",
    }, open: day("2026-09-17"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, OLD, "Write copy"), "- [>] Write copy [[2026-09-17#^k3x9m2|9/17]] [[Write copy|⋯]] ^k3x9m2");
    assert.equal(lineOf(v, day("2026-09-15"), "Write copy"), "- [>] Write copy [[Old|⭕]] [[Other note|⋯]] ^k3x9m2", "left alone");
});

scenario("AddTaskNote files a new note in the line's project, or the Inbox; a finished project too; in a task note, the subtask's note in that note's project with no ⭕", async ({ lag }) => {
    const DONE = "Projects/Done/Done.md";
    const notes = { ...base, [DONE]: "---\ntags: [project]\nstatus: Done\n---\n", [NOTE]: taskNote("- [ ] Confirm the list\n"), [day("2026-09-18")]: "- [ ] Call the printer\n- [ ] Lamp [[New|⭕]]\n- [ ] Shelf [[Done|⭕]]\n" };
    let v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Inbox/Call the printer.md"]);
    assert.equal(lineOf(v, day("2026-09-18"), "printer"), "- [ ] Call the printer [[Call the printer|⋯]]", "no project, no ⭕");
    v = standIn({ notes, open: day("2026-09-18"), at: 1, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/New/Lamp.md"]);
    assert.equal(lineOf(v, day("2026-09-18"), "Lamp"), "- [ ] Lamp [[New|⭕]] [[Lamp|⋯]]");
    v = standIn({ notes, open: day("2026-09-18"), at: 2, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/Done/Shelf.md"], "a finished project's line files there too");
    v = standIn({ notes, open: NOTE, at: 4, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/Old/Confirm the list.md"]);
    assert.equal(lineOf(v, NOTE, "Confirm"), "- [ ] Confirm the list [[Confirm the list|⋯]]");
});

scenario("AddTaskNote finds a note of the line's name: in its project it's linked; in the Inbox it's filed; with no project on the line, the line takes the note's", async ({ lag }) => {
    const LAMP = "Inbox/Desk lamp.md";
    const notes = { ...base, [LAMP]: "---\ntags: []\n---\n", [NOTE]: taskNote(), [day("2026-09-18")]: "- [ ] Write copy [[Old|⭕]]\n- [ ] Desk lamp [[New|⭕]]\n- [ ] Write copy\n" };
    let v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-18"), "Write copy"), "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]");
    assert.deepEqual(plain(v.asked), []);
    v = standIn({ notes, open: day("2026-09-18"), at: 1, lag });
    await v.addTaskNote();
    assert.deepEqual(plain(v.asked), []);
    assert.ok(v.notes()["Projects/New/Desk lamp.md"]);
    assert.equal(lineOf(v, day("2026-09-18"), "Desk lamp"), "- [ ] Desk lamp [[New|⭕]] [[Desk lamp|⋯]]");
    v = standIn({ notes, open: day("2026-09-18"), at: 2, lag });
    await v.addTaskNote();
    assert.deepEqual(plain(v.asked), []);
    assert.equal(v.notes()[day("2026-09-18")].split("\n")[2], "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]");
});

scenario("AddTaskNote on a note filed in another project asks Move or Leave it; Leave it gives the line the note's project, finished or not", async ({ lag }) => {
    const notes = { ...base, [NOTE]: taskNote(), [day("2026-09-18")]: "- [ ] Write copy [[New|⭕]]\n" };
    let v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote("leave");
    const [q] = plain(v.asked);
    assert.deepEqual([q.title, q.cancel], ["A note with this name already exists", "Leave it"]);
    assert.deepEqual([q.label, q.name], ["Task note", "Write copy, in ⭕ Old"]);
    assert.deepEqual(q.words, ["This task will link to that note. Move the note to ⭕ New with this task, or leave it where it is and give this task ⭕ Old?", "For a separate note, press Esc and give this task a different name."]);
    assert.ok(v.notes()[NOTE]);
    assert.equal(lineOf(v, day("2026-09-18"), "Write copy"), "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]");
    v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote("move");
    assert.ok(v.notes()["Projects/New/Write copy.md"]);
    assert.equal(lineOf(v, day("2026-09-18"), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy|⋯]]");
    v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote(null);
    assert.deepEqual(v.notes(), notes, "Cancel writes nothing");
    const finished = { ...notes, [OLD]: "---\ntags: [project]\nstatus: Done\n---\n" };
    v = standIn({ notes: finished, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote("leave");
    assert.equal(lineOf(v, day("2026-09-18"), "Write copy"), "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]", "a finished project's ⭕ is written");
});

scenario("AddTaskNote: a note outside the system is linked as a reference; a different note of that name in the line's project refuses; a project note is linked where it is", async ({ lag }) => {
    const PERSON = "Reference/People/Rafe.md", SAME = "Projects/New/Write copy.md";
    let notes = { ...base, [PERSON]: "---\ntags: []\n---\n", [day("2026-09-18")]: "- [ ] Rafe [[New|⭕]]\n" };
    let v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote();
    assert.ok(v.notes()[PERSON]);
    assert.equal(lineOf(v, day("2026-09-18"), "Rafe"), "- [ ] Rafe [[New|⭕]] [[Rafe|⋯]]");
    notes = { ...base, [NOTE]: taskNote(), [SAME]: taskNote(), [day("2026-09-18")]: "- [ ] Write copy [[New|⭕]]\n" };
    v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote();
    assert.deepEqual(v.notes(), notes);
    assert.equal(v.notices.at(-1), "New already has a different note named Write copy, so nothing changed");
});

scenario("the cursor stays on the same words: mid-title, past the links, and at the end of a selection (OBS-224)", async ({ lag }) => {
    const at = "- [ ] Send Sept".length;
    let v = standIn({ notes: { ...base, [day("2026-09-18")]: "- [ ] Send September invoices\n" }, open: day("2026-09-18"), at: 0, lag });
    v.open(day("2026-09-18"), 0, at);
    await v.addProjectLink(NEW);
    assert.deepEqual(v.placed(), { line: 0, ch: at }, "AddProjectLink");
    v.open(day("2026-09-18"), 0, at);
    await v.addTaskNote();
    assert.deepEqual(v.placed(), { line: 0, ch: at }, "AddTaskNote");
    // With an ID, past it: at the very end still
    const line = "- [ ] Task [[Old|⭕]] ^k3x9m2";
    v = standIn({ notes: { ...base, [day("2026-09-18")]: `${line}\n` }, open: day("2026-09-18"), at: 0, lag });
    v.open(day("2026-09-18"), 0, line.length);
    await v.addProjectLink(NEW);
    assert.deepEqual(v.placed(), { line: 0, ch: "- [ ] Task [[New|⭕]] ^k3x9m2".length });
    // Inside a link that changes: where that text was
    v.open(day("2026-09-18"), 0, "- [ ] Task [[Ne".length);
    await v.addProjectLink(OLD);
    assert.deepEqual(v.placed(), { line: 0, ch: "- [ ] Task [[".length });
});

scenario("AddTaskNote on an event line whose log exists: nothing is made, and the line and the log agree", async ({ lag }) => {
    const OWN = "Projects/Old/›logs/2026-09-14 Kickoff call.md", LOOSE = "Inbox/2026-09-14 Printer call.md";
    const notes = { ...base, [OWN]: "---\ntags: [log]\n---\n", [LOOSE]: "---\ntags: [log]\n---\n", [day("2026-09-14")]: "- [<] 1:30pm\tKickoff call\n- [<] 11:00am\tPrinter call [[New|⭕]]\n" };
    let v = standIn({ notes, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(v.notes()[day("2026-09-14")].split("\n")[0], "- [<] 1:30pm\tKickoff call [[Old|⭕]] [[2026-09-14 Kickoff call|⋯]]", "no ⭕: it gets the log's project, before the ⋯");
    v = standIn({ notes, open: day("2026-09-14"), at: 1, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/New/›logs/2026-09-14 Printer call.md"], "a log in the Inbox is filed where the line's ⭕ says, in a new ›logs");
    assert.deepEqual(plain(v.asked), []);
    assert.equal(v.notes()[day("2026-09-14")].split("\n")[1], "- [<] 11:00am\tPrinter call [[New|⭕]] [[2026-09-14 Printer call|⋯]]");
});

scenario("AddTaskNote with a selection: the name is the selection, its spaces stay, the ⋯ ends the line and the cursor ends after it", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [day("2026-09-14")]: "- [ ] Call the printer tomorrow [[New|⭕]]\n" }, open: day("2026-09-14"), at: 0, lag });
    v.select(6, "- [ ] Call the printer ".length);
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "printer"), "- [ ] Call the printer tomorrow [[New|⭕]] [[Call the printer|⋯]]");
    assert.deepEqual(v.placed(), { line: 0, ch: "- [ ] Call the printer".length });
});

scenario("AddTaskNote takes a date out of the name, as the task's due date, and the cursor stays on the same words", async ({ lag }) => {
    const line = "- [ ] 2026-11-01 Plan the offsite [[New|⭕]]";
    const v = standIn({ notes: { ...base, [day("2026-09-14")]: `${line}\n` }, open: day("2026-09-14"), at: 0, lag });
    v.open(day("2026-09-14"), 0, "- [ ] 2026-11-01 Plan".length);
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "Plan"), "- [ ] Plan the offsite [[New|⭕]] [[Plan the offsite|⋯]]");
    assert.deepEqual(v.placed(), { line: 0, ch: "- [ ] Plan".length });
});

scenario("AddTaskNote on a task in a project note files its note in that project, with no ⭕", async ({ lag }) => {
    const v = standIn({ notes: { [OLD]: `${PROJECT}## To Do\n\n- [ ] Homepage build\n`, [NEW]: PROJECT }, open: OLD, at: 5, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/Old/Homepage build.md"]);
    assert.equal(lineOf(v, OLD, "Homepage"), "- [ ] Homepage build [[Homepage build|⋯]]");
});

scenario("an empty link goes ahead of a ↗ and an ID on a line with no ⋯", async ({ lag }) => {
    const line = "- [ ] Send it [[New|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe";
    const v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-14")]: `${line}\n` }, open: day("2026-09-14"), at: 0, lag });
    const editor = v.app.workspace.activeLeaf.view.editor;
    let wrote = null;
    editor.transaction = ({ changes }) => { wrote = changes[0]; };
    v.open(day("2026-09-14"), 0, line.length);
    await v.addTaskNote();
    assert.equal(wrote.from.ch, "- [ ] Send it [[New|⭕]]".length);
    assert.equal(wrote.text, " [[|⋯]]");
});

scenario("the moved note's lines are still found right after a move, when a lookup by name can return a stale entry at the old path", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-14")]: "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]\n" }, open: NOTE, at: 0, lag });
    const rename = v.app.fileManager.renameFile, lookup = v.app.metadataCache.getFirstLinkpathDest;
    v.app.fileManager.renameFile = async (f, to) => {
        await rename(f, to);
        v.app.metadataCache.getFirstLinkpathDest = (l, from) => (l === "Write copy" ? { path: NOTE, basename: "Write copy", extension: "md" } : lookup(l, from));
    };
    await v.moveToProject(NEW);
    assert.equal(lineOf(v, day("2026-09-14"), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy|⋯]]");
});

test("placeInToDo: the end of the section; made above the report when a note has none, or at the end with no report; a line already there isn't added", async () => {
    const v = standIn({ notes: base });
    const place = (text, block) => v.customJS.TaskChange.constructor.placeInToDo(text, block);
    const block = ["- [ ] Moved", "\t- nested"];
    assert.equal(place(`${PROJECT}## To Do\n\n- [ ] One\n\n## Notes\n\nText\n`, block), `${PROJECT}## To Do\n\n- [ ] One\n- [ ] Moved\n\t- nested\n\n## Notes\n\nText\n`);
    assert.equal(place(`${PROJECT}## To Do\n\n## Time Report\n`, block), `${PROJECT}## To Do\n\n- [ ] Moved\n\t- nested\n\n## Time Report\n`);
    assert.equal(place(`${PROJECT}Scope.\n\n## Tasks\n\n- [ ] One\n\n## Time Report\n\n%% time:start %%\n`, block),
        `${PROJECT}Scope.\n\n## Tasks\n\n- [ ] One\n\n## To Do\n\n- [ ] Moved\n\t- nested\n\n## Time Report\n\n%% time:start %%\n`, "only ## Tasks: a section is made");
    assert.equal(place(`${PROJECT}Scope.\n`, block), `${PROJECT}Scope.\n\n## To Do\n\n- [ ] Moved\n\t- nested\n`, "no report: at the end");
    assert.equal(place(PROJECT, block), `${PROJECT}## To Do\n\n- [ ] Moved\n\t- nested\n`, "right after the frontmatter, no blank line above");
    const there = `${PROJECT}## To Do\n\n- [ ] Moved\n\t- nested\n`;
    assert.equal(place(there, block), there, "a second run doesn't add it twice");
    const copy = `${PROJECT}## To Do\n\n- [ ] Moved\n`;
    assert.equal(place(copy, block), `${copy}- [ ] Moved\n\t- nested\n`, "a bare copy there doesn't take what's nested under the moving line");
    assert.equal(place(`${PROJECT}## To Do\r\n\r\n- [ ] One\r\n`, block), `${PROJECT}## To Do\r\n\r\n- [ ] One\r\n- [ ] Moved\r\n\t- nested\r\n`, "a CRLF note keeps its endings");
});

scenario("everything under a note moves with it: a log's follow-up keeps its own note beside it, and MoveToProject on that note takes the log along", async ({ lag }) => {
    const OWN = "Projects/Old/Follow up.md";
    const notes = {
        ...base, [OWN]: taskNote(),
        [LOG]: "---\ntags: [log]\n---\n- [>] Follow up [[2026-09-15#^fu0001|9/15]] [[Follow up|⋯]] ^fu0001\n",
        [day("2026-09-15")]: "- [ ] Follow up [[Old|⭕]] [[Follow up|⋯]] [[2026-09-16 Planning#^fu0001|↗]] ^fu0001\n",
    };
    let v = standIn({ notes, open: LOG, at: 0, lag });
    await v.moveToProject(NEW);
    assert.deepEqual(plain(v.asked).map((q) => [q.title, q.label, q.name]), [["Move 2 notes?", "Notes", "2026-09-16 Planning, Follow up"]]);
    assert.ok(v.notes()["Projects/New/Follow up.md"], "its follow-up's own note went with it");
    assert.equal(lineOf(v, day("2026-09-15"), "Follow up"), "- [ ] Follow up [[New|⭕]] [[Follow up|⋯]] [[2026-09-16 Planning#^fu0001|↗]] ^fu0001");
    assert.deepEqual(v.problems(), []);
    v = standIn({ notes, open: OWN, at: 0, lag });
    await v.moveToProject(NEW);
    assert.ok(v.notes()["Projects/New/›logs/2026-09-16 Planning.md"], "the log it's a follow-up of went too");
    assert.deepEqual(v.problems(), []);
});

scenario("AddTaskNote's change moves a project-note line too: Leave it takes the line to the note's project's To Do", async ({ lag }) => {
    const FOO = "Projects/New/Foo.md";
    const v = standIn({ notes: { [OLD]: `${PROJECT}## To Do\n\n- [ ] Foo\n\t- a detail\n- [ ] Stay\n`, [NEW]: `${PROJECT}## To Do\n\n- [ ] Here\n`, [FOO]: taskNote() }, open: OLD, at: 5, lag });
    await v.addTaskNote("leave");
    assert.equal(v.notes()[OLD], `${PROJECT}## To Do\n\n- [ ] Stay\n`);
    assert.equal(v.notes()[NEW], `${PROJECT}## To Do\n\n- [ ] Here\n- [ ] Foo [[Foo|⋯]]\n\t- a detail\n`);
});

scenario("AddTaskNote's Move takes a sent task's line in a third project to the new To Do, with its ⋯", async ({ lag }) => {
    const THIRD = "Projects/Third/Third.md", FOO = "Projects/Old/Foo.md";
    const v = standIn({ notes: { ...base, [THIRD]: `${PROJECT}## To Do\n\n- [>] Foo [[2026-09-14#^abc123|9/14]] ^abc123\n`, [FOO]: taskNote(), [day("2026-09-14")]: "- [ ] Foo [[New|⭕]] ^abc123\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote("move");
    assert.ok(v.notes()["Projects/New/Foo.md"]);
    assert.doesNotMatch(v.notes()[THIRD], /Foo/);
    assert.match(v.notes()[NEW], /## To Do\n\n- \[>\] Foo \[\[2026-09-14#\^abc123\|9\/14\]\] \[\[Foo\|⋯\]\] \^abc123/);
    assert.deepEqual(v.check(), []);
});

scenario("a comment: one that ends the line stays after the new ⭕; one before the links, or a %% in the text, doesn't split it", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [day("2026-09-14")]: "- [ ] Foo %%note to self%% [[Old|⭕]]\n- [ ] Escape `%%` in it [[Old|⭕]]\n- [ ] Bar [[Old|⭕]] <!-- later -->\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(v.notes()[day("2026-09-14")].split("\n")[0], "- [ ] Foo %%note to self%% [[New|⭕]]");
    v.open(day("2026-09-14"), 1);
    await v.addProjectLink(NEW);
    assert.equal(v.notes()[day("2026-09-14")].split("\n")[1], "- [ ] Escape `%%` in it [[New|⭕]]");
    v.open(day("2026-09-14"), 2);
    await v.addProjectLink(NEW);
    assert.equal(v.notes()[day("2026-09-14")].split("\n")[2], "- [ ] Bar [[New|⭕]] <!-- later -->");
});

scenario("a line with a second link Obsidian rewrites on the move is still written", async ({ lag }) => {
    const TWIN = "Projects/Third/Write copy.md";
    const v = standIn({ notes: {
        ...base, [TWIN]: taskNote(), [NOTE]: taskNote("- [>] Sub [[2026-09-14#^abc123|9/14]] ^abc123\n"),
        [day("2026-09-14")]: "- [ ] Sub [[Old|⭕]] [[Sub|⋯]] [[Projects/Old/Write copy#^abc123|↗]] ^abc123\n",
        "Projects/Old/Sub.md": taskNote(),
    }, open: NOTE, at: 0, lag });
    await v.moveToProject(NEW);
    assert.match(lineOf(v, day("2026-09-14"), "Sub"), /^- \[ \] Sub \[\[New\|⭕\]\] \[\[Sub\|⋯\]\] \[\[Projects\/New\/Write copy#\^abc123\|↗\]\] \^abc123$/);
});

scenario("a line changed under the command isn't counted as written, and the notice says to run it again", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-14")]: "- [ ] Copy [[Old|⭕]] [[Write copy|⋯]]\n" }, open: NOTE, at: 0, lag });
    const rename = v.app.fileManager.renameFile;
    v.app.fileManager.renameFile = async (f, to) => { await rename(f, to); await v.app.vault.process(v.file(day("2026-09-14")), () => "- [ ] Something else\n"); };
    await v.moveToProject(NEW);
    assert.match(v.notices.at(-1), /couldn't write 1 note; run it again to finish/);
    assert.doesNotMatch(v.notices.at(-1), /now links/);
});

scenario("the billed-time check: a draft billing the same entry doesn't hide a sent invoice", async ({ lag }) => {
    const row = ["2026-09-11", "9:00am", "10:00am"];
    const draft = invoice("draft", [row]).replace("2001-OLD", "2000-OLD");
    const v = standIn({ notes: { ...base, "Reference/Invoices/2000-OLD.md": draft, [INVOICE]: invoice("sent", [row]), [day("2026-09-11")]: "- [x] Work [[Old|⭕]]\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-11"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/11 is on 2001-OLD/);
});

scenario("AddTaskNote on a line with two projects decides nothing: a new note waits in the Inbox", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [day("2026-09-14")]: "- [ ] Foo [[Old|⭕]] [[New|⭕]]\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Inbox/Foo.md"]);
});

scenario("the question names the note when none moves, and a task without its ID", async ({ lag }) => {
    let v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-14")]: "- [x] Copy [[New|⭕]] [[Write copy|⋯]]\n\t- 9:00am - 10:00am\n", [day("2026-09-15")]: "- [ ] Other [[New|⭕]]\n" }, open: NOTE, at: 0, lag });
    await v.moveToProject(OLD);
    assert.deepEqual(plain(v.asked), [], "disagreeing time wasn't counted, so nothing asks");
    v = standIn({ notes: { ...base, [day("2026-09-14")]: "- [x] Foo [[Old|⭕]] ^abc123\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual([plain(v.asked)[0].label, plain(v.asked)[0].name], ["Task", "Foo"]);
});

test("every AddTaskNote method a template calls exists, and the Log template files a log by the line's one project", async () => {
    const fs = await import("node:fs");
    const dir = new URL("../../Templates/", import.meta.url);
    const v = standIn({ notes: { ...base, "Projects/Done/Done.md": "---\ntags: [project]\nstatus: Done\n---\n", "Archive/Gone/Gone.md": PROJECT, [day("2026-09-14")]: "" } });
    const helper = v.customJS.AddTaskNote;
    for (const name of fs.readdirSync(dir)) {
        const text = fs.readFileSync(new URL(name, dir), "utf8");
        for (const m of text.matchAll(/\btasks\??\.(\w+)/g)) assert.equal(typeof helper[m[1]], "function", `${name}: tasks.${m[1]}`);
    }
    const path = day("2026-09-14");
    assert.equal(helper.lineHomeIn("- [<] 10:00am\tPlanning [[New|⭕]]", path)?.path, NEW);
    assert.equal(helper.lineHomeIn("- [<] 10:00am\tPlanning [[Done|⭕]]", path)?.path, "Projects/Done/Done.md", "a finished project too");
    assert.equal(helper.lineHomeIn("- [<] 10:00am\tPlanning", path), null);
    assert.equal(helper.lineHomeIn("- [<] 10:00am\tPlanning [[Gone|⭕]]", path), null, "an archived one waits in the Inbox");
    assert.equal(helper.lineHomeIn("- [<] 10:00am\tPlanning [[Old|⭕]] [[New|⭕]]", path), null, "two: nothing decides");
});

scenario("AddTaskNote settling on a project is a project change: another line's ⭕ follows, it asks before time moves, and billed time refuses before any note is made", async ({ lag }) => {
    const LINES = { [NOTE]: taskNote("- [>] Send it [[2026-09-14#^p7d2qe|9/14]] ^p7d2qe\n"), [day("2026-09-14")]: "- [ ] Send it [[New|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n\t- 3:00pm - 4:00pm\n" };
    let v = standIn({ notes: { ...base, ...LINES }, open: NOTE, at: 4, lag });
    await v.addTaskNote();
    assert.deepEqual(plain(v.asked).map((q) => q.title), ["Change project?"], "9/14's time would move to Old");
    assert.equal(lineOf(v, day("2026-09-14"), "Send it"), "- [ ] Send it [[Old|⭕]] [[Send it|⋯]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    assert.deepEqual(v.problems(), []);
    v = standIn({ notes: { ...base, ...LINES }, open: NOTE, at: 4, lag });
    await v.addTaskNote(null);
    assert.equal(v.notes()["Projects/Old/Send it.md"], undefined, "Cancel: no note is made");
    assert.equal(lineOf(v, day("2026-09-14"), "Send it"), "- [ ] Send it [[New|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    v = standIn({ notes: { ...base, ...LINES, [INVOICE]: invoice("paid", [["2026-09-14", "3:00pm", "4:00pm"]], "New") }, open: NOTE, at: 4, lag });
    await v.addTaskNote();
    assert.equal(v.notes()["Projects/Old/Send it.md"], undefined, "refused: no note is made");
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/14 is on 2001-OLD/);
    // The same when the note exists, and when the ⋯ spreads from a line that has it
    const SEND = "Projects/Old/Send it.md";
    v = standIn({ notes: { ...base, ...LINES, [SEND]: taskNote() }, open: NOTE, at: 4, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "Send it"), "- [ ] Send it [[Old|⭕]] [[Send it|⋯]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
    assert.equal(v.asked.length, 1);
    v = standIn({ notes: { ...base, ...LINES, [SEND]: taskNote(), [NOTE]: taskNote("- [>] Send it [[2026-09-14#^p7d2qe|9/14]] [[Send it|⋯]] ^p7d2qe\n") }, open: NOTE, at: 4, lag });
    await v.addTaskNote();
    assert.deepEqual(plain(v.asked).map((q) => q.title), ["Change project?"]);
    assert.equal(lineOf(v, day("2026-09-14"), "Send it"), "- [ ] Send it [[Old|⭕]] [[Send it|⋯]] [[Write copy#^p7d2qe|↗]] ^p7d2qe");
});

scenario("a selection on a line with a ⋯ puts that note on the task's other lines, and links nothing new", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-14")]: "- [ ] Write the copy [[Old|⭕]] [[Write copy|⋯]]\n" }, open: day("2026-09-14"), at: 0, lag });
    v.select("- [ ] Write ".length, "- [ ] Write the copy".length);
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "Write the copy"), "- [ ] Write the copy [[Old|⭕]] [[Write copy|⋯]]");
    assert.equal(v.notes()["Projects/Old/the copy.md"], undefined);
    assert.equal(v.notices.at(-1), "Every line of this task already links Write copy");
});

scenario("an invoice whose frontmatter is gone still refuses: its rows are checked", async ({ lag }) => {
    const body = invoice("paid", [["2026-09-14", "3:00pm", "4:00pm"]]).split("---\n").slice(2).join("---\n");
    const v = standIn({ notes: { ...base, "Reference/Invoices/2001-OLD.md": body, [day("2026-09-14")]: "- [x] Work [[Old|⭕]]\n\t- 3:00pm - 4:00pm\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(lineOf(v, day("2026-09-14"), "Work"), "- [x] Work [[Old|⭕]]");
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/14 is on 2001-OLD/);
});

scenario("a ⭕ in a task's title stays: only the one that ends the line changes", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [day("2026-09-14")]: "- [ ] Ask [[Other|⭕]] about the rate [[Old|⭕]] ^abc123\n", [day("2026-09-15")]: "- [>] Ask [[Other|⭕]] about the rate [[Old|⭕]] ^abc123\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(lineOf(v, day("2026-09-14"), "Ask"), "- [ ] Ask [[Other|⭕]] about the rate [[New|⭕]] ^abc123");
    assert.equal(lineOf(v, day("2026-09-15"), "Ask"), "- [>] Ask [[Other|⭕]] about the rate [[New|⭕]] ^abc123");
});

scenario("a line in a code block with the task's ID isn't one of its lines", async ({ lag }) => {
    const fenced = "```\n- [>] Book it [[Old|⭕]] ^abc123\n```\n";
    const v = standIn({ notes: { ...base, [day("2026-09-14")]: "- [>] Book it [[Old|⭕]] ^abc123\n", [day("2026-09-15")]: `${fenced}- [ ] Book it [[Old|⭕]] ^abc123\n` }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(v.notes()[day("2026-09-15")], `${fenced}- [ ] Book it [[New|⭕]] ^abc123\n`);
});

scenario("AddTaskNote: a #project note that isn't its folder's own is a plain note filed in the project above it", async ({ lag }) => {
    const STRAY = "Projects/Old/Stray.md";
    const v = standIn({ notes: { ...base, [STRAY]: PROJECT, [day("2026-09-14")]: "- [ ] Stray [[Old|⭕]]\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.deepEqual(plain(v.asked), []);
    assert.equal(lineOf(v, day("2026-09-14"), "Stray"), "- [ ] Stray [[Old|⭕]] [[Stray|⋯]]");
});

scenario("Leave it that moves the last line out of a project note leaves the cursor alone", async ({ lag }) => {
    const FOO = "Projects/New/Foo.md";
    const v = standIn({ notes: { [OLD]: `${PROJECT}## To Do\n\n- [ ] Foo`, [NEW]: PROJECT, [FOO]: taskNote() }, open: OLD, at: 5, lag });
    await v.addTaskNote("leave");
    assert.match(v.notes()[NEW], /- \[ \] Foo \[\[Foo\|⋯\]\]/);
    assert.equal(v.placed(), null);
});

scenario("two notes on one task going to one name: the plan sees the clash, and nothing moves", async ({ lag }) => {
    const notes = { ...base, "Projects/Old/Same.md": taskNote(), "Projects/Third/Same.md": taskNote(), [day("2026-09-14")]: "- [>] Task [[Old|⭕]] [[Projects/Old/Same|⋯]] ^abc123\n", [day("2026-09-15")]: "- [ ] Task [[Old|⭕]] [[Projects/Third/Same|⋯]] ^abc123\n" };
    const v = standIn({ notes, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(v.notes(), notes);
    assert.match(v.notices.at(-1), /Projects\/New already has a note named Same, so nothing changed/);
});

scenario("with Leave it offered and time on the line, the question still names no days", async ({ lag }) => {
    const v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-14")]: "- [ ] Write copy [[New|⭕]]\n\t- 3:00pm - 4:00pm\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote("leave");
    assert.deepEqual(plain(v.asked)[0].words, ["This task will link to that note. Move the note to ⭕ New with this task, or leave it where it is and give this task ⭕ Old?", "For a separate note, press Esc and give this task a different name."]);
    assert.equal(lineOf(v, day("2026-09-14"), "Write copy"), "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]]");
});

scenario("AddTaskNote on a task named like a note in Archive makes a fresh note and leaves the old one alone", async ({ lag }) => {
    const ARCHIVED = "Archive/Gone/Write copy.md";
    const v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, [ARCHIVED]: taskNote(), [day("2026-09-14")]: "- [x] Write copy [[New|⭕]]\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/New/Write copy (New).md"] && v.notes()[ARCHIVED], "named apart, so the archived days' links keep their note");
    assert.equal(lineOf(v, day("2026-09-14"), "Write copy"), "- [x] Write copy [[New|⭕]] [[Write copy (New)|⋯]]");
    assert.deepEqual(v.problems(), []);
});

scenario("a fresh note named apart is found again: the task's next line, or a run after the line changed, links it instead of making another", async ({ lag }) => {
    const ARCHIVED = "Archive/Gone/Write copy.md", FRESH = "Projects/New/Write copy (New).md";
    const named = (v) => Object.keys(v.notes()).filter((p) => p.includes("Write copy")).sort();
    const notes = { ...base, "Archive/Gone/Gone.md": PROJECT, [ARCHIVED]: taskNote(), [day("2026-09-15")]: "- [ ] Write copy [[New|⭕]]\n", [day("2026-09-16")]: "- [ ] Write copy [[New|⭕]]\n" };
    let v = standIn({ notes, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    v.open(day("2026-09-16"), 0);
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-16"), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy (New)|⋯]]");
    assert.deepEqual(named(v), [ARCHIVED, FRESH]);
    // The line changes while the template runs: the note is made but not linked, and running it again links it
    v = standIn({ notes, open: day("2026-09-15"), at: 0, lag });
    const helper = v.customJS.AddTaskNote, make = helper.createTaskNote, editor = v.app.workspace.activeLeaf.view.editor;
    let once = true;
    helper.createTaskNote = async (...a) => {
        const note = await make(...a);
        if (once) { once = false; editor.replaceRange("!", { line: 0, ch: 6 }); }
        return note;
    };
    await v.addTaskNote();
    assert.match(v.notices.at(-1), /^Write copy \(New\) is ready, but the line changed/);
    editor.replaceRange("", { line: 0, ch: 6 }, { line: 0, ch: 7 });
    v.open(day("2026-09-15"), 0);
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-15"), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy (New)|⋯]]");
    assert.deepEqual(named(v), [ARCHIVED, FRESH]);
    assert.deepEqual(v.problems(), []);
});

scenario("a fresh note is found again by any name a fresh note gets, but a note that only has a number after the task's name isn't taken for one", async ({ lag }) => {
    const ARCHIVED = { "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Write copy.md": taskNote() };
    const twice = async (notes, first, second) => {
        const v = standIn({ notes: { ...base, ...ARCHIVED, ...notes, [day("2026-09-15")]: `- [ ] Write copy${first}\n`, [day("2026-09-16")]: `- [ ] Write copy${second}\n` }, open: day("2026-09-15"), at: 0, lag });
        await v.addTaskNote();
        v.open(day("2026-09-16"), 0);
        await v.addTaskNote();
        return v;
    };
    // Made in New, and the next line names no project: it takes the note, and the note's project
    let v = await twice({}, " [[New|⭕]]", "");
    assert.equal(lineOf(v, day("2026-09-16"), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy (New)|⋯]]");
    // The name with the project taken in Archive, so the fresh note is numbered
    v = await twice({ "Archive/Gone/Write copy (New).md": taskNote() }, " [[New|⭕]]", " [[New|⭕]]");
    for (const d of ["2026-09-15", "2026-09-16"]) assert.equal(lineOf(v, day(d), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy (New) 2|⋯]]");
    // With no project, `Write copy 2` taken outside the system
    v = await twice({ "Reference/Write copy 2.md": "x\n" }, "", "");
    for (const d of ["2026-09-15", "2026-09-16"]) assert.equal(lineOf(v, day(d), "Write copy"), "- [ ] Write copy [[Write copy 3|⋯]]");
    // A note of the task's name with a number, filed in the project, is another task's
    v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Phase.md": taskNote(), "Projects/New/Phase 2.md": taskNote(), [day("2026-09-15")]: "- [ ] Phase [[New|⭕]]\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-15"), "Phase"), "- [ ] Phase [[New|⭕]] [[Phase (New)|⋯]]");
});

scenario("AddTaskNote says when it puts another line of the task in the line's project, a new note or not", async ({ lag }) => {
    for (const extra of [{}, { "Projects/New/Draft.md": taskNote() }]) {
        const v = standIn({ notes: { ...base, ...extra, [day("2026-09-14")]: "- [>] Draft [[2026-09-15#^abc123|9/15]] [[Old|⭕]] ^abc123\n", [day("2026-09-15")]: "- [ ] Draft [[New|⭕]] ^abc123\n" }, open: day("2026-09-15"), at: 0, lag });
        await v.addTaskNote();
        assert.equal(lineOf(v, day("2026-09-14"), "Draft"), "- [>] Draft [[2026-09-15#^abc123|9/15]] [[New|⭕]] [[Draft|⋯]] ^abc123");
        assert.ok(v.notices.includes("A line now links ⭕ New"), v.notices.join(" | "));
    }
});

scenario("the notice for several lines lists their days in order", async ({ lag }) => {
    const v = standIn({ notes: { ...base, "Projects/Other/Other.md": PROJECT, "Inbox/Wrap up.md": "---\ntags: [task]\n---\n",
        [day("2026-09-10")]: "- [>] Wrap up [[2026-09-11#^abc123|9/11]] [[Old|⭕]] ^abc123\n",
        [day("2026-09-11")]: "- [>] Wrap up [[2026-09-12#^abc123|9/12]] [[Other|⭕]] ^abc123\n",
        [day("2026-09-12")]: "- [ ] Wrap up [[Wrap up|⋯]] ^abc123\n" }, open: day("2026-09-12"), at: 0, lag });
    await v.addTaskNote();
    assert.match(v.notices.at(-2) ?? "", /^2 lines \(9\/10, 9\/11\) link a project, but their notes wait in the Inbox/, v.notices.join(" | "));
});

scenario("with no project, the fresh note for a name in Archive waits in the Inbox numbered, and the task's next line links it there", async ({ lag }) => {
    const ARCHIVED = "Archive/Gone/Write copy.md";
    const v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, [ARCHIVED]: taskNote(), [day("2026-09-15")]: "- [ ] Write copy\n", [day("2026-09-16")]: "- [ ] Write copy\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    v.open(day("2026-09-16"), 0);
    await v.addTaskNote();
    for (const d of ["2026-09-15", "2026-09-16"]) assert.equal(lineOf(v, day(d), "Write copy"), "- [ ] Write copy [[Write copy 2|⋯]]");
    assert.deepEqual(Object.keys(v.notes()).filter((p) => p.includes("Write copy")).sort(), [ARCHIVED, "Inbox/Write copy 2.md"]);
});

scenario("a fresh note's name has no date in it and no doubled space, wherever the date was in the task's text", async ({ lag }) => {
    for (const text of ["Write copy 2026-09-30", "2026-09-30 Write copy", "Write 2026-09-30 copy"]) {
        for (const archived of [true, false]) {
            const extra = archived ? { "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Write copy.md": taskNote() } : {};
            const v = standIn({ notes: { ...base, ...extra, [day("2026-09-15")]: `- [ ] ${text} [[New|⭕]]\n` }, open: day("2026-09-15"), at: 0, lag });
            await v.addTaskNote();
            const want = archived ? "Projects/New/Write copy (New).md" : "Projects/New/Write copy.md";
            assert.ok(v.notes()[want], `${text}${archived ? ", archived" : ""}: ${Object.keys(v.notes()).filter((p) => p.startsWith("Projects/New/"))}`);
        }
    }
});

scenario("AddTaskNote on a meeting line takes the live log over one of the same name in Archive", async ({ lag }) => {
    const LIVE = "Projects/New/›logs/2026-09-14 Planning.md";
    const v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/›logs/2026-09-14 Planning.md": "---\ntags: [log]\n---\n", [LIVE]: "---\ntags: [log]\n---\n", [day("2026-09-14")]: "- [<] 10:00am\tPlanning [[New|⭕]]\n\t- 10:00am - 11:00am\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "Planning"), "- [<] 10:00am\tPlanning [[New|⭕]] [[Projects/New/›logs/2026-09-14 Planning|⋯]]");
    assert.ok(!v.notices.some((n) => /disagree/.test(n)), v.notices.join(" | "));
    assert.deepEqual(v.problems(), []);
});

scenario("a task whose other line links its note in Archive gets a fresh note on a line in a live project, and the notices say what the report now lists", async ({ lag }) => {
    const notes = { ...base, "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Write copy.md": taskNote(), [day("2026-09-11")]: "- [>] Write copy [[2026-09-15#^abc123|9/15]] [[Gone|⭕]] [[Write copy|⋯]] ^abc123\n\t- 9:00am - 10:00am\n", [day("2026-09-15")]: "- [ ] Write copy [[New|⭕]] ^abc123\n" };
    const v = standIn({ notes, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-15"), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy (New)|⋯]] ^abc123");
    // The whole task takes New; the archived day keeps its note, so its time stops counting, said afterwards
    assert.equal(lineOf(v, day("2026-09-11"), "Write copy"), "- [>] Write copy [[2026-09-15#^abc123|9/15]] [[New|⭕]] [[Write copy|⋯]] ^abc123");
    assert.deepEqual(v.notices.slice(1), [
        "A line now links ⭕ New",
        "9/11's line now disagrees with its note Write copy, which is filed in Gone, so its time counts nowhere until you fix it. The report lists it under Problems",
        "This task's other line links Write copy, so the report lists it as linking two notes",
    ]);
    assert.deepEqual(v.problems(), ["ownNotes", `own note ${day("2026-09-11")}:1`]);
});

scenario("a selection naming the note the task's other line links says nothing about two notes", async ({ lag }) => {
    const notes = { ...base, "Projects/Old/Spec.md": taskNote(), [day("2026-09-14")]: "- [>] Draft the spec [[2026-09-15#^abc123|9/15]] [[Old|⭕]] [[Spec|⋯]] ^abc123\n", [day("2026-09-15")]: "- [ ] Draft the spec [[Old|⭕]] ^abc123\n" };
    const v = standIn({ notes, open: day("2026-09-15"), at: 0, lag });
    const at = notes[day("2026-09-15")].indexOf("spec");
    v.select(at, at + 4);
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-15"), "Draft"), "- [ ] Draft the spec [[Old|⭕]] [[Spec|⋯]] ^abc123");
    assert.ok(!v.notices.some((n) => /two notes/.test(n)), v.notices.join(" | "));
    assert.deepEqual(v.problems(), []);
});

scenario("the warning names only lines the change wrote: a line that already disagreed, left as it was, isn't named", async ({ lag }) => {
    // With no project to settle on: 9/11 already disagrees with its note, and AddTaskNote on 9/15 leaves it alone
    let v = standIn({ notes: { ...base, "Projects/New/Spec.md": taskNote(), [day("2026-09-11")]: "- [>] Draft [[2026-09-15#^abc123|9/15]] [[Old|⭕]] [[Spec|⋯]] ^abc123\n\t- 9:00am - 10:00am\n", [day("2026-09-15")]: "- [ ] Draft ^abc123\n" }, open: day("2026-09-15"), at: 0, lag });
    v.select(6, 11);
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-11"), "Draft"), "- [>] Draft [[2026-09-15#^abc123|9/15]] [[Old|⭕]] [[Spec|⋯]] ^abc123");
    assert.ok(!v.notices.some((n) => /9\/11/.test(n)), v.notices.join(" | "));
    // With one: 9/13 already names New, so AddProjectLink New from 9/14 doesn't write it
    v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Old copy.md": taskNote(), [day("2026-09-13")]: "- [>] Copy [[2026-09-14#^abc123|9/14]] [[New|⭕]] [[Old copy|⋯]] ^abc123\n", [day("2026-09-14")]: "- [ ] Copy [[Old|⭕]] ^abc123\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(lineOf(v, day("2026-09-14"), "Copy"), "- [ ] Copy [[New|⭕]] ^abc123");
    assert.ok(!v.notices.some((n) => /9\/13|disagree/.test(n)), v.notices.join(" | "));
});

scenario("AddTaskNote on a line every line of whose task links its note says so when it puts the line in that note's project", async ({ lag }) => {
    const v = standIn({ notes: { ...base, "Projects/Old/Spec.md": taskNote(), [day("2026-09-15")]: "- [ ] Draft the spec [[New|⭕]] [[Spec|⋯]]\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-15"), "Draft"), "- [ ] Draft the spec [[Old|⭕]] [[Spec|⋯]]");
    assert.deepEqual(v.notices, ["A line now links ⭕ Old"]);
    assert.deepEqual(v.problems(), []);
});

scenario("AddTaskNote on a subtask's day line that names no project files its note where the task note or log it was sent from is", async ({ lag }) => {
    for (const parent of ["Projects/Old/Brochure.md", LOG]) {
        const body = "- [>] Draft [[2026-09-15#^abc123|9/15]] ^abc123\n";
        const link = parent === LOG ? "2026-09-16 Planning" : "Brochure";
        const v = standIn({ notes: { ...base, [parent]: parent === LOG ? `---\ntags: [log]\n---\n${body}` : taskNote(body), [day("2026-09-15")]: `- [ ] Draft [[${link}#^abc123|↗]] ^abc123\n\t- 9:00am - 10:00am\n` }, open: day("2026-09-15"), at: 0, lag });
        assert.deepEqual(v.problems(), [`parent ${day("2026-09-15")}:1`]);
        await v.addTaskNote();
        assert.ok(v.notes()["Projects/Old/Draft.md"], `${parent}: ${Object.keys(v.notes()).filter((p) => p.endsWith("Draft.md"))}`);
        assert.match(lineOf(v, day("2026-09-15"), "Draft"), /\[\[Old\|⭕\]\]/);
        assert.deepEqual(v.problems(), []);
    }
});

scenario("a line that shifted while the question was open is found by where its links lead, never as another task's look-alike", async ({ lag }) => {
    const OTHER = "Projects/Other/Other.md";
    const v = standIn({ notes: {
        ...base, [OTHER]: PROJECT, "Projects/Old/Notes.md": taskNote(), "Projects/Other/Notes2.md": taskNote(),
        "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Notes.md": taskNote(),
        [day("2026-09-11")]: "- [x] Call [[Other|⭕]] [[Notes2|⋯]]\n- [x] Call [[Old|⭕]] [[Notes|⋯]]\n",
        [day("2026-09-12")]: "- [ ] Start [[Old|⭕]] [[Notes|⋯]]\n",
    }, open: day("2026-09-12"), at: 0, lag });
    v.answering(NEW, "move");
    // A synced event arrives above the lines while you're asked, and the moved note's links come back as paths
    const ask = v.customJS.AddTaskNote.confirmMove;
    v.customJS.AddTaskNote.confirmMove = async (...a) => {
        await v.app.vault.process(v.file(day("2026-09-11")), (t) => `- [<] 8:00am\tSynced event\n${t}`);
        return ask(...a);
    };
    v.tick();
    await v.customJS.AddProjectLink.invoke();
    assert.equal(v.notes()[day("2026-09-11")], "- [<] 8:00am\tSynced event\n- [x] Call [[Other|⭕]] [[Notes2|⋯]]\n- [x] Call [[New|⭕]] [[Projects/New/Notes|⋯]]\n");
});

scenario("a line that names a project while the note AddTaskNote made for it waits in the Inbox is named afterwards", async ({ lag }) => {
    const v = standIn({ notes: { ...base, "Archive/Done/Done.md": PROJECT, [day("2026-09-11")]: "- [x] Wrap up files [[Done|⭕]]\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-11"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-11"), "Wrap up"), "- [x] Wrap up files [[Done|⭕]] [[Wrap up files|⋯]]");
    assert.equal(v.notices.at(-1), "9/11's line links ⭕ Done, but its note Wrap up files waits in the Inbox. The report lists it under Problems until you run AddProjectLink on the line or MoveToProject on the note");
    assert.deepEqual(v.problems(), [`own note ${day("2026-09-11")}:1`]);
});

scenario("warn after, never block: AddTaskNote links a log in Archive from its meeting line, and a ⋯ already on a line, and says when a line disagrees", async ({ lag }) => {
    const ARCHIVED_LOG = "Archive/Gone/›logs/2026-09-14 Kickoff call.md";
    let v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, [ARCHIVED_LOG]: "---\ntags: [log]\n---\n", [day("2026-09-14")]: "- [<] 1:30pm\tKickoff call [[New|⭕]]\n\t- 1:30pm - 2:30pm\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "Kickoff"), "- [<] 1:30pm\tKickoff call [[New|⭕]] [[2026-09-14 Kickoff call|⋯]]", "that meeting's own log");
    assert.match(v.notices.at(-1), /^9\/14's line now disagrees with its note 2026-09-14 Kickoff call, which is filed in Gone/);
    const notes = { ...base, "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Write copy.md": taskNote(), [day("2026-09-14")]: "- [>] Write copy [[Gone|⭕]] [[Write copy|⋯]] ^abc123\n", [day("2026-09-15")]: "- [ ] Write copy [[New|⭕]] ^abc123\n\t- 9:00am - 10:00am\n" };
    v = standIn({ notes, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-15"), "Write copy"), "- [ ] Write copy [[New|⭕]] [[Write copy|⋯]] ^abc123");
    assert.ok(v.notices.some((n) => /^9\/15's line now disagrees with its note Write copy, which is filed in Gone/.test(n)));
});

scenario("a line hidden in a code block or comment is no task: AddTaskNote and AddProjectLink change nothing there and make no note", async ({ lag }) => {
    const notes = { ...base, [day("2026-09-14")]: "```\n- [ ] Draft it [[Old|⭕]]\n```\n%%\n- [ ] Plan it\n%%\n" };
    for (const at of [1, 4]) {
        let v = standIn({ notes, open: day("2026-09-14"), at, lag });
        await v.addTaskNote();
        assert.deepEqual(v.notes(), notes);
        assert.equal(v.notices.at(-1), "Not on a checklist item");
        v = standIn({ notes, open: day("2026-09-14"), at, lag });
        await v.addProjectLink(NEW);
        assert.deepEqual(v.notes(), notes);
        assert.deepEqual(plain(v.menus), [], "before the menu");
        assert.equal(v.notices.at(-1), "Not on a checklist item");
    }
});

scenario("Leave it with a whole task: the notes already in that project stay, and the rest go there", async ({ lag }) => {
    const PARENT = "Projects/New/Brochure.md";
    const notes = {
        ...base, [NOTE]: taskNote(),
        [PARENT]: taskNote("- [>] Write copy [[2026-09-18#^abc123|9/18]] ^abc123\n"),
        [day("2026-09-18")]: "- [ ] Write copy [[New|⭕]] [[Brochure#^abc123|↗]] ^abc123\n",
    };
    let v = standIn({ notes, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote("leave");
    assert.equal(plain(v.asked)[0].title, "A note with this name already exists");
    assert.ok(v.notes()[NOTE] && v.notes()["Projects/Old/Brochure.md"]);
    assert.equal(lineOf(v, day("2026-09-18"), "Write copy"), "- [ ] Write copy [[Old|⭕]] [[Write copy|⋯]] [[Brochure#^abc123|↗]] ^abc123");
    assert.deepEqual(v.problems(), []);
    // A note of that name where Leave it would take it: Leave it isn't offered
    const clash = { ...notes, "Projects/Old/Brochure.md": taskNote() };
    v = standIn({ notes: clash, open: day("2026-09-18"), at: 0, lag });
    await v.addTaskNote(null);
    assert.deepEqual([plain(v.asked)[0].title, plain(v.asked)[0].cancel], ["A note with this name already exists", "Cancel"]);
    assert.deepEqual(plain(v.asked)[0].words, ["This task will link to that note, and the note moves to ⭕ New with it.", "For a separate note, press Cancel and give this task a different name."]);
    assert.deepEqual(v.notes(), clash);
});

scenario("a line whose ⋯ links a timesheet: the timesheet stays, and the notice says the line now disagrees", async ({ lag }) => {
    const SHEET = "Projects/Old/Old timesheet.md";
    const v = standIn({ notes: { ...base, [SHEET]: "---\ntags: [timesheet]\n---\n", [day("2026-09-14")]: "- [ ] Hours [[Old|⭕]] [[Old timesheet|⋯]]\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.ok(v.notes()[SHEET]);
    assert.equal(v.notices.at(-1), "9/14's line now disagrees with its note Old timesheet, which is filed in Old, so its time counts nowhere until you fix it. The report lists it under Problems");
});

scenario("an invoice: one whose status can't be read refuses and says so; one that lost its tag but says draft doesn't", async ({ lag }) => {
    const LINE = { [day("2026-09-14")]: "- [x] Work [[Old|⭕]]\n\t- 3:00pm - 4:00pm\n" };
    const body = invoice("paid", [["2026-09-14", "3:00pm", "4:00pm"]]).split("---\n").slice(2).join("---\n");
    let v = standIn({ notes: { ...base, ...LINE, [INVOICE]: body }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(v.notices.at(-1), "Nothing changed: this task's time on 9/14 is on 2001-OLD, whose status can't be read.");
    const untagged = invoice("draft", [["2026-09-14", "3:00pm", "4:00pm"]]).replace("tags: [invoice]\n", "");
    v = standIn({ notes: { ...base, ...LINE, [INVOICE]: untagged }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.equal(lineOf(v, day("2026-09-14"), "Work"), "- [x] Work [[New|⭕]]", "a draft refuses nothing");
});

scenario("a plain note isn't taken for a parent by a tag that only contains task or log, or by an alias", async ({ lag }) => {
    for (const fm of ["tags: [task-list]", "tags: [meeting/log]", "tags: []\naliases:\n  - log"]) {
        const PLAIN = "Projects/Old/Ideas.md";
        const v = standIn({ notes: {
            ...base, [PLAIN]: `---\n${fm}\n---\n- [>] Try it [[2026-09-17#^abc123|9/17]] ^abc123\n- [>] Other [[2026-09-15#^def456|9/15]] ^def456\n`,
            [day("2026-09-15")]: "- [x] Other [[Old|⭕]] [[Ideas#^def456|↗]] ^def456\n\t- 9:00am - 10:00am\n",
            [day("2026-09-17")]: "- [ ] Try it [[Old|⭕]] [[Ideas#^abc123|↗]] ^abc123\n",
        }, open: day("2026-09-17"), at: 0, lag });
        await v.addProjectLink(NEW);
        assert.ok(v.notes()[PLAIN], fm);
        assert.equal(lineOf(v, day("2026-09-15"), "Other"), "- [x] Other [[Old|⭕]] [[Ideas#^def456|↗]] ^def456", fm);
    }
});

scenario("MoveToProject on a plain note takes its tasks along, as before", async ({ lag }) => {
    const PLAIN = "Projects/Old/Ideas.md";
    const v = standIn({ notes: { ...base, [PLAIN]: "---\ntags: []\n---\n- [>] Try it [[2026-09-14#^abc123|9/14]] ^abc123\n", [day("2026-09-14")]: "- [ ] Try it [[Old|⭕]] [[Ideas#^abc123|↗]] ^abc123\n" }, open: PLAIN, at: 0, lag });
    await v.moveToProject(NEW);
    assert.ok(v.notes()["Projects/New/Ideas.md"]);
    assert.equal(lineOf(v, day("2026-09-14"), "Try it"), "- [ ] Try it [[New|⭕]] [[Ideas#^abc123|↗]] ^abc123");
});

scenario("AddTaskNote on a line whose task already links a note on another line links that note, and a line that names no project takes the one its task's lines agree on", async ({ lag }) => {
    let v = standIn({ notes: { ...base, [NOTE]: taskNote(), [day("2026-09-11")]: "- [>] Copy: first draft [[Old|⭕]] [[Write copy|⋯]] ^abc123\n", [day("2026-09-15")]: "- [ ] Copy: revisions [[Old|⭕]] ^abc123\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(v.notes()["Projects/Old/Copy - revisions.md"] ?? v.notes()["Projects/Old/Copy: revisions.md"], undefined, "no second note");
    assert.equal(lineOf(v, day("2026-09-15"), "revisions"), "- [ ] Copy: revisions [[Old|⭕]] [[Write copy|⋯]] ^abc123");
    assert.deepEqual(v.problems(), []);
    v = standIn({ notes: { ...base, [day("2026-09-11")]: "- [>] Plan it [[Old|⭕]] ^abc123\n", [day("2026-09-15")]: "- [ ] Plan it ^abc123\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/Old/Plan it.md"], "filed where its other line says");
    assert.deepEqual(v.problems(), []);
});

scenario("several notes of one task selected together: the second went with the first, and the notice says so", async ({ lag }) => {
    const SUB = "Projects/Old/Send final.md";
    const v = standIn({ notes: { ...base, [NOTE]: taskNote("- [>] Send final [[2026-09-14#^abc123|9/14]] [[Send final|⋯]] ^abc123\n"), [SUB]: taskNote(), [day("2026-09-14")]: "- [ ] Send final [[Old|⭕]] [[Send final|⋯]] [[Write copy#^abc123|↗]] ^abc123\n" }, open: NOTE, at: 0, lag });
    await v.moveToProject(NEW, "move", [NOTE, SUB]);
    assert.ok(v.notes()["Projects/New/Write copy.md"] && v.notes()["Projects/New/Send final.md"]);
    assert.ok(v.notices.some((n) => n.includes("Send final moved with Write copy")), JSON.stringify(v.notices));
    assert.ok(!v.notices.some((n) => n.includes("wasn't moved")));
});

scenario("one write path: AddTaskNote's ⋯ that would leave billed time counting nowhere is refused, as any change is", async ({ lag }) => {
    const LINE = { [day("2026-09-14")]: "- [x] New [[Old|⭕]]\n\t- 9:00am - 10:00am\n", [INVOICE]: invoice("paid", [["2026-09-14", "9:00am", "10:00am"]]) };
    let v = standIn({ notes: { ...base, ...LINE }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "New"), "- [x] New [[Old|⭕]]", "a project's own note named like the line");
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/14 is on 2001-OLD/);
    const SPREAD = { [day("2026-09-13")]: "- [>] Copy [[Other|⭕]] [[Other|⋯]] ^abc123\n", [day("2026-09-14")]: "- [x] Copy [[Old|⭕]] ^abc123\n\t- 9:00am - 10:00am\n", [INVOICE]: invoice("paid", [["2026-09-14", "9:00am", "10:00am"]]), "Projects/Other/Other.md": PROJECT };
    v = standIn({ notes: { ...base, ...SPREAD }, open: day("2026-09-13"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-14"), "Copy"), "- [x] Copy [[Old|⭕]] ^abc123", "nor spreading it onto a billed line");
    assert.match(v.notices.at(-1), /^Nothing changed: this task's time on 9\/14 is on 2001-OLD/);
});

scenario("one write path: AddTaskNote run again after a failed write finishes it, and a note waiting in the Inbox is filed where the task's lines say", async ({ lag }) => {
    // What a failed write leaves: the note moved, one day still names the old project
    let v = standIn({ notes: { ...base, "Projects/New/Write copy.md": taskNote(), [day("2026-09-11")]: "- [x] Copy [[Old|⭕]] [[Write copy|⋯]]\n\t- 9:00am - 10:00am\n", [day("2026-09-15")]: "- [ ] Write copy [[New|⭕]] [[Write copy|⋯]]\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(lineOf(v, day("2026-09-11"), "Copy"), "- [x] Copy [[New|⭕]] [[Write copy|⋯]]");
    assert.deepEqual(v.problems(), []);
    v = standIn({ notes: { ...base, "Inbox/Call.md": taskNote(), [day("2026-09-14")]: "- [>] Call [[Call|⋯]] ^abc123\n", [day("2026-09-15")]: "- [ ] Call [[Old|⭕]] ^abc123\n" }, open: day("2026-09-15"), at: 0, lag });
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/Old/Call.md"], "filed in Old");
    assert.equal(lineOf(v, day("2026-09-15"), "Call"), "- [ ] Call [[Old|⭕]] [[Call|⋯]] ^abc123");
    assert.deepEqual(v.problems(), []);
});

scenario("one reading of a line: a ⋯ to a note outside the system counts as no own note, so its time moves with the question and nothing warns", async ({ lag }) => {
    const v = standIn({ notes: { ...base, "Reference/Clients/Clients.md": "---\ntags: [area]\n---\n", "Reference/Clients/Brief.md": "---\ntags: []\n---\n", [day("2026-09-14")]: "- [x] Brief [[Old|⭕]] [[Brief|⋯]]\n\t- 9:00am - 10:00am\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addProjectLink(NEW);
    assert.deepEqual(plain(v.asked).map((q) => q.time), ["9/14"]);
    assert.ok(!v.notices.some((n) => n.includes("disagrees")), JSON.stringify(v.notices));
    assert.deepEqual(v.problems(), []);
});

scenario("a move that fails warns about nothing it didn't write", async ({ lag }) => {
    const v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Old copy.md": taskNote(), [NOTE]: taskNote(), [day("2026-09-13")]: "- [>] Copy [[Gone|⭕]] [[Old copy|⋯]] ^abc123\n", [day("2026-09-14")]: "- [ ] Copy [[Old|⭕]] [[Write copy|⋯]] ^abc123\n" }, open: day("2026-09-14"), at: 0, lag });
    v.app.fileManager.renameFile = async () => { throw new Error("no"); };
    await v.addProjectLink(NEW);
    assert.ok(!v.notices.some((n) => n.includes("disagrees")), JSON.stringify(v.notices));
});

scenario("AddTaskNote takes the live note of a name an archived note shares, and a selection naming another note than the task's says the report will list two", async ({ lag }) => {
    let v = standIn({ notes: { ...base, "Archive/Gone/Gone.md": PROJECT, "Archive/Gone/Copy.md": taskNote(), "Projects/Old/Deep/Copy.md": taskNote(), [day("2026-09-14")]: "- [ ] Copy [[Old|⭕]]\n" }, open: day("2026-09-14"), at: 0, lag });
    await v.addTaskNote();
    assert.equal(Object.keys(v.notes()).filter((p) => p.endsWith("/Copy.md") || p.includes("Copy (")).length, 2, "no third note");
    v = standIn({ notes: { ...base, "Projects/Old/Spec.md": taskNote(), [day("2026-09-14")]: "- [>] Draft spec [[Old|⭕]] [[Spec|⋯]] ^abc123\n", [day("2026-09-15")]: "- [ ] Draft spec [[Old|⭕]] ^abc123\n" }, open: day("2026-09-15"), at: 0, lag });
    v.select("- [ ] ".length, "- [ ] Draft".length);
    await v.addTaskNote();
    assert.ok(v.notes()["Projects/Old/Draft.md"]);
    assert.ok(v.notices.some((n) => n === "This task's other line links Spec, so the report lists it as linking two notes"), JSON.stringify(v.notices));
});

test("a note in a folder of its own name that the cache doesn't know yet is taken for a project's own note, and doesn't move", () => {
    const WEB = "Projects/Old/Website/Website.md";
    const v = standIn({ notes: { ...base, [WEB]: PROJECT } });
    const change = v.customJS.TaskChange, get = v.app.metadataCache.getFileCache.bind(v.app.metadataCache);
    v.app.metadataCache.getFileCache = (f) => (f.path === WEB ? null : get(f));
    assert.equal(change.ours(v.file(WEB)), false);
});

// ---------------------------------------------------------------- seeded random sequences

const A = "Projects/Alpha/Alpha.md", B = "Projects/Beta/Beta.md", C = "Projects/Gamma/Gamma.md";
const HOMES = [A, B, C];
// Invented notes the report finds clean: tasks with notes, lines sent from a project note and a log, days worked on
const clean = () => ({
    [A]: `${PROJECT}## To Do\n\n- [ ] Plan it [[Plan it|⋯]]\n- [>] Book it [[2026-09-11#^bk0001|9/11]] ^bk0001\n- [ ] Loose end\n\n## Time Report\n`,
    [B]: `${PROJECT}## To Do\n\n- [ ] Draft it\n\n## Time Report\n`,
    [C]: `${PROJECT}Scope.\n`,
    "Projects/Alpha/Plan it.md": "---\ntags: [task]\n---\n- [ ] First step\n- [>] Second step [[2026-09-14#^st0001|9/14]] ^st0001\n",
    "Projects/Beta/Write it.md": "---\ntags: [task]\n---\nText.\n",
    "Projects/Beta/›logs/2026-09-10 Standup.md": "---\ntags: [log]\n---\n- [>] Follow up [[2026-09-15#^fu0001|9/15]] ^fu0001\n",
    "Inbox/Waiting.md": "---\ntags: [task]\n---\n",
    "Projects/Beta/Notes.md": "---\ntags: [reading-log]\n---\n- [>] Call back [[2026-09-14#^cb0001|9/14]] ^cb0001\n",
    [day("2026-09-10")]: "- [<] 9:00am\tStandup [[Beta|⭕]] [[2026-09-10 Standup|⋯]]\n\t- 9:00am - 9:30am\n- [x] Plan it first [[Alpha|⭕]] [[Plan it|⋯]]\n\t- 10:00am - 11:00am\n",
    [day("2026-09-11")]: "- [ ] Book it [[Alpha|⭕]] ^bk0001\n- [x] Write it [[Beta|⭕]] [[Write it|⋯]]\n\t- 1:00pm - 2:00pm\n- [ ] Waiting [[Waiting|⋯]]\n",
    [day("2026-09-14")]: "- [ ] Second step [[Alpha|⭕]] [[Plan it#^st0001|↗]] ^st0001\n- [ ] Odd job\n- [ ] Call back [[Beta|⭕]] [[Notes#^cb0001|↗]] ^cb0001\n",
    [day("2026-09-15")]: "- [ ] Follow up [[Beta|⭕]] [[2026-09-10 Standup#^fu0001|↗]] ^fu0001\n",
});

const sequence = async (seed, { lag, plant = null, steps = 18 }) => {
    let s = seed;
    const roll = (n) => { s = (s * 9301 + 49297) % 233280; return Math.floor((s / 233280) * n); };
    const pick = (list) => list[roll(list.length)];
    const v = standIn({ notes: clean(), lag, plant });
    const paths = (test) => Object.keys(v.notes()).filter(test).sort();
    const top = (path) => v.notes()[path].split("\n").map((l, i) => [l, i]).filter(([l]) => /^- \[/.test(l)).map(([, i]) => i);
    const days = () => paths((p) => p.includes("/days/"));
    const trail = [];
    for (let n = 0; n < steps; n++) {
        const path = pick(days());
        const lines = top(path);
        if (!lines.length) continue;
        const at = pick(lines);
        const home = pick(HOMES);
        const what = pick(["link", "link", "move", "note", "schedule"]);
        trail.push(`${what} ${path.split("/").pop()}:${at} ${home.split("/")[1]}`);
        if (what === "link") {
            v.open(path, at);
            await v.addProjectLink(home);
        } else if (what === "move") {
            const notes = paths((p) => /^(Projects|Inbox)\//.test(p) && !HOMES.includes(p));
            const note = pick(notes);
            v.open(note, 0);
            trail[trail.length - 1] += ` (${note})`;
            await v.moveToProject(home);
        } else if (what === "note") {
            const where = pick([path, path, ...paths((p) => /^Projects\//.test(p) && top(p).length)]);
            const on = where === path ? at : pick(top(where));
            v.open(where, on, "- [ ] ".length);
            await v.addTaskNote(pick(["move", "leave"]));
        } else {
            v.open(path, at);
            await v.schedule(pick(["2026-09-21", "2026-09-22", "2026-09-23"])).catch(() => {});
        }
        const problems = v.problems();
        if (problems.length) return { problems, trail };
    }
    return { problems: [], trail };
};

scenario("random sequences of AddProjectLink, MoveToProject, AddTaskNote and Schedule leave clean notes clean", async ({ lag }) => {
    for (let seed = 1; seed <= 40; seed++) {
        const { problems, trail } = await sequence(seed * 97, { lag });
        assert.deepEqual(problems, [], `seed ${seed}:\n${trail.join("\n")}`);
    }
});

test("planted bugs: the sequences catch each one", async () => {
    const bugs = {
        "a task's ID isn't followed": ["for (const l of (await tasks.gatherMany([id], ids)).get(id) ?? []) todo.push({ file: l.file, at: l.line });", ""],
        "a note's ⋯ lines aren't found": ["if (this.linked(text, file.path).some((n) => helper.isSameNote(n, note))) out.push({ file, at });", ""],
        "a project-note line stays behind": ["if (await this.intoToDo(l, home)) {", "if (true) {"],
        "the note doesn't move": ["await app.fileManager.renameFile(step.note, step.to);", ""],
        "a day line isn't written": ["const homed = periodic && home ? this.withProject(text, weighed.link) : text;", "const homed = text;"],
        "a note doesn't take its subtasks": ["for (const at of this.subtasks(visible, hidden)) seeds.push({ file: n, at });", ""],
        "a subtask doesn't take its parent": ["if (await this.holds(file, memo)) addNote(file);", ""],
    };
    for (const [name, [from, to]] of Object.entries(bugs)) {
        const plant = (script, text) => {
            if (script !== "taskChange") return text;
            assert.ok(text.includes(from), `${name}: nothing to plant`);
            return text.replace(from, to);
        };
        let caught = false;
        for (let seed = 1; seed <= 40 && !caught; seed++) caught = (await sequence(seed * 97, { lag: false, plant })).problems.length > 0;
        assert.ok(caught, name);
    }
});
