// The time report's own checks (OBS-233): a ⭕ outside the periodic notes, a subtask's day in another project than
// its note, and a task's deadlines that differ. Each case runs twice: through the demo's render (renderReports.mjs,
// makeIndex over the notes' text) and through the app's path on the stand-in vault (appIndex over its metadata
// cache), which must agree. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { standIn, PLANNER } from "./standInVault.mjs";
import { planReports, frontmatter, loadTimeReport } from "./demo/renderReports.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
const day = (d) => `${PLANNER}/days/${d}.md`;
const week = (w) => `${PLANNER}/weeks/${w}.md`;
const PROJECT = "---\ntags: [project]\n---\n";
const KES = "Projects/Freelance/Kestrel/Kestrel.md", PINE = "Projects/Freelance/Pinecrest/Pinecrest.md", HOME = "Projects/Personal/Household/Household.md";
const RULES = ["stray", "subtaskProject", "deadline"];

// What the report lists for `notes`, both ways: [kind, where, path, line, rule, projects], a Problem on a day by its
// date ("today" when it's today's, which the two ways read from different clocks), one on a project by the project
const run = (given) => {
    // A note set to undefined is left out, so a case can move one
    const notes = Object.fromEntries(Object.entries(given).filter(([, text]) => text !== undefined));
    const rows = (model, today) => [
        ...model.problems.filter((p) => RULES.includes(p.rule)).map((p) => ["day", p.date === today ? "today" : p.date, p.note ?? p.path, p.line, p.rule, p.projects.slice().sort()]),
        ...model.projectProblems.filter((p) => RULES.includes(p.rule)).map((p) => ["project", p.project, p.path, p.line, p.rule]),
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const v = standIn({ notes });
    const tr = v.customJS.TimeReport, ids = v.customJS.TaskIds;
    const list = Object.keys(notes).filter((p) => ids.inSystem(v.file(p)) || p.startsWith("Archive/")).map((path) => ({ path, kind: ids.kindOf(v.file(path)), text: notes[path] }));
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, tr.appIndex(), list);
    const demoTr = loadTimeReport();
    const plan = planReports(demoTr, { notes: new Map(Object.entries(notes).map(([p, text]) => [p, { text, fm: frontmatter(text) }])) });
    const app = plain(rows(model, tr.today())), demo = plain(rows(plan.model, demoTr.today()));
    assert.deepEqual(demo, app, "the demo's render and the app agree");
    return { rows: app, model, tr, v, plan };
};
const messages = (model, rule) => [...model.problems, ...model.projectProblems].filter((p) => p.rule === rule).map((p) => p.message);

// ------------------------------------------------------------------ 1. a ⭕ outside a periodic note

test("check 1: a ⭕ or 🗃️ at the end of a task line in a project note is listed on that project, and nowhere else", () => {
    const { rows, model } = run({
        [KES]: `${PROJECT}## To Do\n\n- [ ] Proposal and estimate [[Pinecrest|⭕]]\n- [ ] Sort the photos [[Household|🗃️]]\n- [ ] Book the room\n`,
        [PINE]: PROJECT, [HOME]: "---\ntags: [area]\n---\n",
    });
    assert.deepEqual(rows, [["project", KES, KES, 6, "stray"], ["project", KES, KES, 7, "stray"]]);
    assert.deepEqual(messages(model, "stray").sort(), [
        "has a task line in [[Kestrel]] (line 6) that ends in a ⭕, which says nothing outside a daily, weekly, monthly or yearly note. Take the ⭕ off or move the task to the other project",
        "has a task line in [[Kestrel]] (line 7) that ends in a 🗃️, which says nothing outside a daily, weekly, monthly or yearly note. Take the 🗃️ off or move the task to the other area",
    ]);
    // A mark that names the note's own project: only take it off
    const own = run({ [KES]: `${PROJECT}- [ ] Proposal [[Kestrel|⭕]]\n` });
    assert.deepEqual(messages(own.model, "stray"), [`has a task line in [[Kestrel]] (line 4) that ends in a ⭕, which says nothing outside a daily, weekly, monthly or yearly note. Take the ⭕ off`]);
});

test("a Problem on a project note's own line says \"This project note\" in its report, and names the note elsewhere", () => {
    const TASK = "Projects/Freelance/Kestrel/Book the room.md";
    const { model, tr, plan } = run({
        [KES]: `${PROJECT}## To Do\n\n- [ ] Proposal and estimate [[Pinecrest|⭕]]\n`, [PINE]: PROJECT,
        [TASK]: "---\ntags: [task]\n---\n- [ ] Ask for a quote [[Pinecrest|⭕]]\n",
        [HOME]: "---\ntags: [area]\n---\n- [ ] Sort the photos [[Pinecrest|⭕]]\n",
    });
    const link = (p) => `[[${tr.basename(p)}]]`;
    const full = { ...model, parent: new Map() };
    const listed = (scope) => { const mine = tr.inScope(full, scope); return plain(tr.problemLines(full, mine.problems, mine.projectProblems, [], link, scope)); };
    assert.deepEqual(listed({ kind: "project", path: KES }).sort(), [
        "- This project note has a task line (line 6) that ends in a ⭕, which says nothing outside a daily, weekly, monthly or yearly note. Take the ⭕ off or move the task to the other project",
        "- [[Kestrel]] has a task line in [[Book the room]] (line 4) that ends in a ⭕, which says nothing outside a daily, weekly, monthly or yearly note. Take the ⭕ off or move the task to the other project",
    ].sort());
    assert.deepEqual(listed({ kind: "project", path: HOME, area: true }), ["- This area note has a task line (line 4) that ends in a ⭕, which says nothing outside a daily, weekly, monthly or yearly note. Take the ⭕ off or move the task to the other project"]);
    // The demo's render writes it the same way into the note
    assert.match(plan.blocks.get(KES), /^> - This project note has a task line \(line 6\) that ends in a ⭕/m);
    assert.match(plan.blocks.get(HOME), /^> - This area note has a task line \(line 4\)/m);
});

test("check 1: task lines only, at the end of the line, outside the periodic notes", () => {
    const { rows, model } = run({
        [KES]: `${PROJECT}A sentence that links [[Pinecrest|⭕]] in its text.\n\n## To Do\n\n- A plain bullet [[Pinecrest|⭕]]\n- [ ] Mentions [[Pinecrest|⭕]] in its text\n- [ ] Draft it\n\t- [ ] A nested task [[Pinecrest|⭕]]\n- Notes\n\t- [ ] Under a plain bullet [[Pinecrest|⭕]]\n`,
        [PINE]: PROJECT,
        [day("2026-09-17")]: "- [ ] On a day [[Pinecrest|⭕]]\n",
    });
    assert.deepEqual(rows, [], "a plain bullet, a ⭕ in the text, a nested line and a day's line aren't listed");
    // The nested task is listed once, as a mark on a nested task
    assert.deepEqual(plain(model.projectProblems.filter((p) => p.kind === "subtask").map((p) => [p.project, p.line])), [[KES, 11]]);
});

test("check 1: a note in the Inbox is listed under today's date, and one in Archive on its archived project", () => {
    const OLD = "Archive/Freelance/Old/Old.md";
    const { rows } = run({
        "Inbox/Errands.md": "---\ntags: [task]\n---\n- [ ] Return the books [[Household|⭕]]\n",
        [OLD]: `${PROJECT}- [ ] Close it out [[Household|⭕]]\n`,
        [HOME]: PROJECT,
    });
    assert.deepEqual(rows, [["day", "today", "Inbox/Errands.md", 4, "stray", []], ["project", OLD, OLD, 4, "stray"]]);
    // In no project: file it, unless it's in Archive, where no command works
    const loose = run({ "Inbox/Errands.md": "- [ ] Return the books [[Household|⭕]]\n", "Archive/Loose list.md": "- [ ] Return the books [[Household|⭕]]\n", [HOME]: PROJECT });
    const said = Object.fromEntries(loose.model.problems.filter((p) => p.rule === "stray").map((p) => [p.note, p.message.replace(/^.*yearly note\. /, "")]));
    assert.deepEqual(said, { "Inbox/Errands.md": "Take the ⭕ off, and file the note with MoveToProject", "Archive/Loose list.md": "Take the ⭕ off" });
});

// ------------------------------------------------------------------ 3. a subtask in another project than its note

const NOTE = "Projects/Freelance/Pinecrest/Write copy.md";
const SUBTASK = (dayLine, extra = {}) => ({
    [PINE]: PROJECT, [KES]: PROJECT,
    [NOTE]: "---\ntags: [task]\n---\n- [ ] First draft\n- [>] Send final copy [[2026-09-17#^p7d2qe|9/17]] ^p7d2qe\n",
    [day("2026-09-17")]: `${dayLine}\n\t- 9:00am - 10:00am\n`,
    ...extra,
});

test("check 3: a subtask's day that names another project is listed on its day, on both projects, and marks billing", () => {
    const { rows, model, tr } = run(SUBTASK("- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe"));
    assert.deepEqual(rows, [["day", "2026-09-17", day("2026-09-17"), 1, "subtaskProject", [KES, PINE].sort()]]);
    assert.deepEqual(messages(model, "subtaskProject"), ["names and counts toward [[Kestrel]], but it's a subtask of [[Write copy]], which is filed in [[Pinecrest]]. Choose one project by running AddProjectLink on one of its task lines or MoveToProject on the task note"]);
    // In the report, Brian's words: "Project disagreement on", and the line's title quoted
    assert.deepEqual(plain(tr.problemLines(model, model.problems, [], [], (x) => x)), ["- Project disagreement on [[2026-09-17|9/17/26]] line 1: `Send final copy` names and counts toward [[Kestrel]], but it's a subtask of [[Write copy]], which is filed in [[Pinecrest]]. Choose one project by running AddProjectLink on one of its task lines or MoveToProject on the task note"]);
    const p = model.problems.find((x) => x.rule === "subtaskProject");
    assert.equal(tr.changesBilling(p), true, "it's about where the day's time counts, as two projects is");
    for (const project of [KES, PINE]) {
        const sheet = tr.sheetEntryProblems(model, new Set([project]), project, [], (x) => x);
        assert.ok(sheet.lines.some((l) => l.includes("it's a subtask of")), `${project}'s timesheet: ${sheet.lines}`);
    }
});

test("check 3: nothing when the day agrees; a ↗ alone and the subtask's own line decide nothing", () => {
    assert.deepEqual(run(SUBTASK("- [ ] Send final copy [[Pinecrest|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe")).rows, []);
    // A line that names the note only with ↗ but has no ID isn't one of its subtask's days
    assert.deepEqual(run(SUBTASK("- [ ] Ask about it [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]]")).rows, []);
    // A block ID of your own that was never sent isn't a task's
    assert.deepEqual(run({ ...SUBTASK("- [ ] Mine [[Kestrel|⭕]] ^myown1"), [NOTE]: "---\ntags: [task]\n---\n- [ ] Mine ^myown1\n" }).rows, []);
});

test("check 3: a day that names no project, or one while the note waits in the Inbox", () => {
    const none = run(SUBTASK("- [ ] Send final copy [[Write copy#^p7d2qe|↗]] ^p7d2qe"));
    assert.deepEqual(none.rows, [["day", "2026-09-17", day("2026-09-17"), 1, "subtaskProject", [PINE]]]);
    assert.match(messages(none.model, "subtaskProject")[0], /^names no project, so it counts toward none, but it's a subtask of \[\[Write copy\]\], which is filed in \[\[Pinecrest\]\]\. Choose one project/);
    const INBOX = "Inbox/Write copy.md";
    const waiting = run({ ...SUBTASK("- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe"), [INBOX]: SUBTASK("")[NOTE], [NOTE]: undefined });
    assert.deepEqual(waiting.rows, [["day", "2026-09-17", day("2026-09-17"), 1, "subtaskProject", [KES]]]);
    assert.match(messages(waiting.model, "subtaskProject")[0], /^names and counts toward \[\[Kestrel\]\], but it's a subtask of \[\[Write copy\]\], which waits in the Inbox\. Choose one project/);
    // Both agreeing on no project is nothing to say
    assert.deepEqual(run({ ...SUBTASK("- [ ] Send final copy [[Write copy#^p7d2qe|↗]] ^p7d2qe"), [INBOX]: SUBTASK("")[NOTE], [NOTE]: undefined }).rows, []);
});

test("check 3: a log's follow-up, a weekly note's line, and a task note in Archive", () => {
    const LOG = "Projects/Freelance/Pinecrest/›logs/2026-09-10 Kickoff.md";
    const log = run({
        [PINE]: PROJECT, [KES]: PROJECT,
        [LOG]: "---\ntags: [log]\n---\n- [>] Confirm the dates [[2026-09-17#^fu0001|9/17]] ^fu0001\n",
        [day("2026-09-17")]: "- [ ] Confirm the dates [[Kestrel|⭕]] [[2026-09-10 Kickoff#^fu0001|↗]] ^fu0001\n",
    });
    assert.deepEqual(log.rows, [["day", "2026-09-17", day("2026-09-17"), 1, "subtaskProject", [KES, PINE].sort()]]);
    assert.match(messages(log.model, "subtaskProject")[0], /^names and counts toward \[\[Kestrel\]\], but it's a follow-up from the log \[\[2026-09-10 Kickoff\]\], which is filed in \[\[Pinecrest\]\]\. Choose one project by running AddProjectLink on one of its task lines or MoveToProject on the log$/);
    const wk = run({ ...SUBTASK(""), [NOTE]: "---\ntags: [task]\n---\n- [>] Send final copy [[2026w38#^p7d2qe|Wk of 9/13]] ^p7d2qe\n", [week("2026w38")]: "- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n" });
    assert.deepEqual(wk.rows, [["day", "2026-09-13", week("2026w38"), 1, "subtaskProject", [KES, PINE].sort()]], "on its week, linking the note, and on both projects");
    const OLD = "Archive/Freelance/Pinecrest/Pinecrest.md", OLDNOTE = "Archive/Freelance/Pinecrest/Write copy.md";
    const archived = run({ ...SUBTASK("- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe"), [OLD]: PROJECT, [OLDNOTE]: SUBTASK("")[NOTE], [NOTE]: undefined, [PINE]: undefined });
    assert.deepEqual(archived.rows, [["day", "2026-09-17", day("2026-09-17"), 1, "subtaskProject", [KES, OLD].sort()]]);
    assert.match(messages(archived.model, "subtaskProject")[0], /which is filed in \[\[Pinecrest\]\]\. Change the line's ⭕ to \[\[Pinecrest\]\] by hand: the note is in Archive, where no command works$/);
    const bare = run({ ...SUBTASK("- [ ] Send final copy [[Write copy#^p7d2qe|↗]] ^p7d2qe"), [OLD]: PROJECT, [OLDNOTE]: SUBTASK("")[NOTE], [NOTE]: undefined, [PINE]: undefined });
    assert.match(messages(bare.model, "subtaskProject")[0], /\. Add \[\[Pinecrest\|⭕\]\] to the line by hand: the note is in Archive/, "a line with no ⭕ gets one");
    // An archived area's mark is 🗃️
    const AREA = "Archive/Personal/Garden/Garden.md", AREANOTE = "Archive/Personal/Garden/Write copy.md";
    const area = run({ ...SUBTASK("- [ ] Send final copy [[Write copy#^p7d2qe|↗]] ^p7d2qe"), [AREA]: "---\ntags: [area]\n---\n", [AREANOTE]: SUBTASK("")[NOTE], [NOTE]: undefined, [PINE]: undefined });
    assert.match(messages(area.model, "subtaskProject")[0], /\. Add \[\[Garden\|🗃️\]\] to the line by hand/);
    // A note filed in a finished project, which AddProjectLink's menu leaves out: by hand, in both renders
    const done = run(SUBTASK("- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe", { [PINE]: "---\ntags: [project]\nstatus: Done\n---\n" }));
    for (const m of [done.model, done.plan.model]) assert.match(messages(m, "subtaskProject")[0], /\. Change the line's ⭕ to \[\[Pinecrest\]\] by hand: a finished project isn't in AddProjectLink's menu$/);
    // A day line that also disagrees with itself counts its time toward neither project, and says so
    const both = run(SUBTASK("- [ ] Send final copy [[Kestrel|⭕]] [[Pinecrest|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe"));
    assert.match(messages(both.model, "subtaskProject")[0], /^names \[\[Kestrel\]\] and another project, so it counts toward neither, but it's a subtask of/);
    // A log known by its folder alone, in the demo's render as in the app
    const UNTAGGED = "Projects/Freelance/Pinecrest/›logs/2026-09-10 Kickoff.md";
    const folder = run({ [PINE]: PROJECT, [KES]: PROJECT, [UNTAGGED]: "- [>] Confirm the dates [[2026-09-17#^fu0001|9/17]] ^fu0001\n", [day("2026-09-17")]: "- [ ] Confirm the dates [[Kestrel|⭕]] [[2026-09-10 Kickoff#^fu0001|↗]] ^fu0001\n" });
    assert.deepEqual(folder.rows.map((r) => r[4]), ["subtaskProject"]);
});

test("where the new checks are listed: a line's own periods and its projects, never every period with time on the project", () => {
    // Time on Kestrel in March and October, far from the lines the checks are about
    const far = { [day("2026-03-10")]: "- [x] Old work [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n", [day("2026-10-13")]: "- [x] Later work [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n" };
    const blocks = (notes) => run({ ...notes, ...far }).plan.blocks;
    // Reports only: the timesheets have a test of their own
    const listing = (b, re) => [...b].filter(([p, text]) => re.test(text) && !p.includes("timesheet")).map(([p]) => p.split("/").pop()).sort();
    // Check 1: Kestrel's note and nothing else
    const stray = blocks({ [KES]: `${PROJECT}- [ ] Proposal [[Pinecrest|⭕]]\n`, [PINE]: PROJECT });
    assert.deepEqual(listing(stray, /says nothing outside/), ["Kestrel.md"]);
    // Check 4 with a 🚩 on the project note's To Do line: the days' periods and the project
    // (with an hour in week 38, which a week needs for a report of its own)
    const dl = blocks({ ...DEADLINES("2026-09-18", { toDo: "- [ ] Draft wireframes [[2026-09-25|🚩 9/25]] [[Draft wireframes|⋯]]" }), [day("2026-09-16")]: "- [x] Other [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n" });
    assert.deepEqual(listing(dl, /deadlines differ/), ["2026.md", "2026-09.md", "2026w38.md", "Kestrel.md"].sort());
    for (const [p, text] of dl) if (/deadlines differ/.test(text)) assert.equal(text.match(/deadlines differ/g).length, 1, `${p} says it once`);
    // Check 3 on a week's line: that week's month and year, and both projects
    const wk = blocks({
        ...SUBTASK(""), [NOTE]: "---\ntags: [task]\n---\n- [>] Send final copy [[2026w38#^p7d2qe|Wk of 9/13]] ^p7d2qe\n", [week("2026w38")]: "- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n",
        [day("2026-09-17")]: "- [x] Other [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n- [x] More [[Pinecrest|⭕]]\n\t- 11:00am - 12:00pm\n",
    });
    assert.deepEqual(listing(wk, /it's a subtask of/), ["2026.md", "2026-09.md", "2026w38.md", "Kestrel.md", "Pinecrest.md"].sort());
    for (const [p, text] of wk) if (/it's a subtask of/.test(text)) assert.equal(text.match(/it's a subtask of/g).length, 1, `${p} says it once`);
});

test("a Problem on a monthly note's line is the month's and the year's, not a week's", () => {
    const MONTH = `${PLANNER}/months/2026-10.md`;
    const { model, tr } = run({ ...SUBTASK(""), [NOTE]: "---\ntags: [task]\n---\n- [>] Send final copy [[2026-10#^p7d2qe|October 2026]] ^p7d2qe\n", [MONTH]: "- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe\n" });
    const full = { ...model, parent: new Map() };
    const listed = (scope) => tr.inScope(full, scope).problems.filter((p) => p.rule === "subtaskProject").length;
    assert.deepEqual([{ unit: "week", key: "2026w40" }, { unit: "month", key: "2026-10" }, { unit: "year", key: "2026" }].map((s) => listed({ kind: "period", ...s })), [0, 1, 1]);
    assert.equal(listed({ kind: "all" }), 1);
});

test("check 3 is on both projects' timesheets, and its entries ⚠️ where they count: the project the line names", () => {
    const { plan, tr } = run(SUBTASK("- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe"));
    assert.deepEqual(plain(plan.model.entries.filter((e) => e.path === day("2026-09-17")).map((e) => e.project)), [KES], "its time counts where the line says");
    const sheet = (project) => tr.sheetEntryProblems(plan.model, new Set([project]), project, plan.model.entries.filter((e) => e.project === project), (x) => x);
    assert.deepEqual([KES, PINE].map((p) => [sheet(p).flagged.size, sheet(p).lines.some((l) => l.includes("it's a subtask of"))]), [[1, true], [0, true]]);
});

// ------------------------------------------------------------------ 4. two deadlines on one task

const WIRE = "Projects/Freelance/Kestrel/Draft wireframes.md";
const DEADLINES = (d14 = "2026-09-18", { due = "2026-09-18", toDo = "- [ ] Draft wireframes [[Draft wireframes|⋯]]" } = {}) => ({
    [KES]: `${PROJECT}## To Do\n\n${toDo}\n`,
    [WIRE]: `---\ntags: [task]\n${due === null ? "" : `due: ${due}\n`}---\nThe wireframes.\n`,
    [day("2026-09-14")]: `- [>] Draft wireframes [[${d14}|🚩 ${+d14.slice(5, 7)}/${+d14.slice(8)}]] [[Kestrel|⭕]] [[Draft wireframes|⋯]] [[2026-09-15#^w2h5nf|9/15]] ^w2h5nf\n`,
    [day("2026-09-15")]: "- [x] Draft wireframes [[2026-09-18|🚩 9/18]] [[Kestrel|⭕]] [[Draft wireframes|⋯]] ^w2h5nf\n",
});

test("check 4: a task's 🚩 and its task note's due that differ are one Problem, on each day with a 🚩, said once in a report", () => {
    assert.deepEqual(run(DEADLINES()).rows, [], "they agree");
    const { rows, model, tr } = run(DEADLINES("2026-09-27"));
    assert.deepEqual(rows, [["day", "2026-09-14", day("2026-09-14"), 1, "deadline", [KES]], ["day", "2026-09-15", day("2026-09-15"), 1, "deadline", [KES]]]);
    assert.deepEqual([...new Set(messages(model, "deadline"))], ["belongs to a task whose deadlines differ, 9/18/26 and 9/27/26: run DueDate on any of its lines to give it one"]);
    assert.equal(tr.changesBilling(model.problems[0]), false, "a deadline doesn't change what's billed");
    // Once in the week's report and once in the project's
    const full = { ...model, parent: new Map() };
    for (const scope of [{ kind: "period", unit: "week", key: "2026w38" }, { kind: "project", path: KES }]) {
        const mine = tr.inScope(full, scope);
        const lines = tr.problemLines(model, mine.problems, mine.projectProblems, [], (p) => `[[${tr.basename(p)}]]`);
        assert.equal(lines.length, 1, `${scope.kind}: ${lines}`);
        assert.ok(lines[0].startsWith("- [[2026-09-14|9/14/26]] line 1: `"), lines[0]);
    }
});

test("check 4: two 🚩 on one line, a done line, a 🚩 linking a day by its path, and lines joined only by their note", () => {
    const two = run({ [KES]: PROJECT, [day("2026-09-14")]: "- [ ] Call the printer [[2026-09-18|🚩 9/18]] [[2026-09-20|🚩 9/20]] [[Kestrel|⭕]]\n" });
    assert.deepEqual(two.rows, [["day", "2026-09-14", day("2026-09-14"), 1, "deadline", [KES]]]);
    assert.match(messages(two.model, "deadline")[0], /deadlines differ, 9\/18\/26 and 9\/20\/26: run DueDate on any of its lines to give it one$/);
    // With another line of the task, each date once
    const more = run({ [KES]: PROJECT, [day("2026-09-14")]: "- [>] Call the printer [[2026-09-18|🚩 9/18]] [[2026-09-20|🚩 9/20]] [[Kestrel|⭕]] ^pr1nt3\n", [day("2026-09-15")]: "- [ ] Call the printer [[2026-09-18|🚩 9/18]] [[Kestrel|⭕]] ^pr1nt3\n" });
    assert.match(messages(more.model, "deadline")[0], /deadlines differ, 9\/18\/26 and 9\/20\/26: run DueDate/);
    // By its path, the same day: nothing to say
    assert.deepEqual(run({ ...DEADLINES(), [day("2026-09-15")]: `- [x] Draft wireframes [[${PLANNER}/days/2026-09-18|🚩 9/18]] [[Kestrel|⭕]] [[Draft wireframes|⋯]] ^w2h5nf\n` }).rows, []);
    // A project note's line with no ID, joined by its ⋯ alone, against the days
    const toDo = run(DEADLINES("2026-09-18", { toDo: "- [x] Draft wireframes [[2026-09-25|🚩 9/25]] [[Draft wireframes|⋯]]" }));
    assert.deepEqual(toDo.rows.map((r) => r.slice(0, 3)), [["day", "2026-09-14", day("2026-09-14")], ["day", "2026-09-15", day("2026-09-15")], ["project", KES, KES]]);
    assert.match(messages(toDo.model, "deadline")[0], /deadlines differ, 9\/18\/26 and 9\/25\/26: run DueDate on any of its lines to give it one$/);
});

test("check 4: what isn't compared", () => {
    // A due that isn't a date, and no due
    for (const due of ["", "next week", null]) assert.deepEqual(run(DEADLINES("2026-09-18", { due })).rows, [], `due: ${due}`);
    assert.deepEqual(run({ ...DEADLINES(), [WIRE]: "---\ntags: [task]\ndue:\n  - 2026-09-30\n---\n" }).rows, [], "a list");
    // A log's, a plain note's, a project note's due, and a note tagged both #task and #log
    for (const tags of ["[log]", "[reading-log]", "[task, log]"]) assert.deepEqual(run({ ...DEADLINES(), [WIRE]: `---\ntags: ${tags}\ndue: 2026-09-30\n---\n` }).rows, [], tags);
    assert.deepEqual(run({ ...DEADLINES(), [KES]: "---\ntags: [project]\ndue: 2026-12-31\n---\n- [ ] Draft wireframes [[Draft wireframes|⋯]]\n" }).rows, [], "a project's own deadline");
    // A subtask keeps its own deadline: its lines aren't compared with its task note's due
    assert.deepEqual(run({
        [KES]: PROJECT,
        [WIRE]: "---\ntags: [task]\ndue: 2026-09-18\n---\n- [>] Mobile layout [[2026-09-30|🚩 9/30]] [[2026-09-17#^m0b1le|9/17]] ^m0b1le\n",
        [day("2026-09-17")]: "- [ ] Mobile layout [[2026-09-30|🚩 9/30]] [[Kestrel|⭕]] [[Draft wireframes#^m0b1le|↗]] ^m0b1le\n",
    }).rows, []);
    // A 🚩 in the text, a line with no 🚩, and an event line
    assert.deepEqual(run({ [KES]: PROJECT, [day("2026-09-14")]: "- [ ] Due [[2026-09-20|🚩 9/20]] for sure [[2026-09-18|🚩 9/18]] [[Kestrel|⭕]]\n- [<] 9:00am\tReview [[Kestrel|⭕]] [[2026-09-14 Review|⋯]]\n" }).rows, []);
});

test("check 4: a due written another way than DueDate writes it is set by hand, and the Problem says so", () => {
    for (const due of ["2026-09-20 # from the brief", "'2026-09-20'"]) {
        // The note holds an ID, so the report reads its text, which says how its due is written
        const odd = run({ ...DEADLINES(), [WIRE]: `---\ntags: [task]\ndue: ${due}\n---\n- [ ] A step ^st0001\n` });
        const said = messages(odd.model, "deadline")[0] ?? "";
        const byHand = said.endsWith(": run DueDate on any of its lines to give it one, then set Draft wireframes' `due` by hand, since DueDate doesn't change a `due` written another way than `due:` and a date");
        assert.equal(byHand, due.includes("#"), `${due}: ${said}`);
    }
});

test("check 4: lines in Archive, which DueDate never reads, join only each other", () => {
    const OLD = "Archive/Freelance/Old/Old.md", NOTE4 = "Projects/Freelance/Kestrel/Task note.md";
    const notes = {
        [KES]: PROJECT, [OLD]: `${PROJECT}- [>] Task [[Task note|⋯]] [[2026-09-14#^abc123|9/14]] ^abc123\n`,
        [NOTE4]: "---\ntags: [task]\ndue: 2026-09-25\n---\n",
        [day("2026-09-14")]: "- [ ] Task [[2026-09-18|🚩 9/18]] [[Kestrel|⭕]] ^abc123\n",
        [day("2026-09-20")]: "- [ ] Task [[2026-09-25|🚩 9/25]] [[Kestrel|⭕]] [[Task note|⋯]]\n",
    };
    // 9/14 is tied to the note only through the line in Archive: two tasks, each agreeing with itself
    assert.deepEqual(run(notes).rows, []);
    // An Archive line's own 🚩 is compared with the other lines in Archive and the note's due
    const old = run({ ...notes, [OLD]: `${PROJECT}- [>] Task [[2026-09-30|🚩 9/30]] [[Task note|⋯]] [[2026-09-14#^abc123|9/14]] ^abc123\n` });
    // On the archived project, and on the project its task note is filed in
    assert.deepEqual(old.rows.map((r) => r.slice(0, 3)), [["project", OLD, OLD], ["project", KES, OLD]]);
    assert.match(messages(old.model, "deadline")[0], /deadlines differ, 9\/25\/26 and 9\/30\/26: change \[\[Old\]\] by hand, since DueDate doesn't change a note in Archive$/);
    // A task whose lines are all in Archive, where DueDate doesn't run: only the hand fix
    const only = run({ [KES]: PROJECT, [OLD]: `${PROJECT}- [ ] Close it [[2026-09-18|🚩 9/18]] [[2026-09-20|🚩 9/20]]\n` });
    assert.match(messages(only.model, "deadline")[0], /deadlines differ, 9\/18\/26 and 9\/20\/26: change \[\[Old\]\] by hand, since DueDate doesn't change a note in Archive$/);
    // An ID that only a line in Archive makes a task's joins nothing in the system, as DueDate's search sees it
    const sent = run({
        [KES]: PROJECT, [OLD]: `${PROJECT}- [>] Print run [[2026-09-14#^pr1nt1|9/14]] ^pr1nt1\n`,
        [day("2026-09-14")]: "- [x] Print run [[2026-09-18|🚩 9/18]] [[Kestrel|⭕]] ^pr1nt1\n",
        [day("2026-09-20")]: "- [ ] Print run [[2026-09-25|🚩 9/25]] [[Kestrel|⭕]] ^pr1nt1\n",
    });
    assert.deepEqual(sent.rows.filter((r) => r[4] === "deadline"), []);
});

test("check 4: a task note in Archive is compared, and the Problem says to change it by hand", () => {
    const OLD = "Archive/Freelance/Kestrel/Draft wireframes.md";
    const { rows, model } = run({ ...DEADLINES(), [OLD]: DEADLINES("2026-09-18", { due: "2026-09-20" })[WIRE], [WIRE]: undefined });
    assert.deepEqual(rows.map((r) => r.slice(0, 3)), [["day", "2026-09-14", day("2026-09-14")], ["day", "2026-09-15", day("2026-09-15")]]);
    assert.match(messages(model, "deadline")[0], /deadlines differ, 9\/18\/26 and 9\/20\/26: run DueDate on any of its lines to give it one, then change \[\[Draft wireframes\]\] by hand, since DueDate doesn't change a note in Archive$/);
});

test("check 4: a task note's due is read from its text, which can be ahead of the cache", () => {
    const { tr, v } = run(DEADLINES());
    const T = v.customJS.TaskIds.constructor, index = tr.appIndex();
    const notes = Object.entries(DEADLINES()).map(([path, text]) => ({ path, kind: v.customJS.TaskIds.kindOf(v.file(path)), text }));
    // DueDate just wrote 9/27 everywhere; the cache still has 9/18
    const now = notes.map((n) => ({ ...n, text: n.text.replaceAll("2026-09-18|🚩 9/18", "2026-09-27|🚩 9/27").replace("due: 2026-09-18", "due: 2026-09-27") }));
    assert.equal(index.props(WIRE).due, "2026-09-18");
    assert.deepEqual(plain(tr.deadlineProblems(now, index, T)), []);
    // Without Obsidian's parser (the demo's render), the usual shapes by hand
    const node = loadTimeReport();
    assert.equal(node.dueIn("---\ntags: [task]\ndue: \"2026-09-27\" # set by DueDate\n---\n"), "2026-09-27");
    for (const text of ["---\ndue:\n  - 2026-09-27\n---\n", "---\ndue: 2026-09-27\ndue: 2026-09-28\n---\n", "No properties.\ndue: 2026-09-27\n", "---\ndue: 2026-02-30\n---\n", "---\ndue:2026-09-27\n---\n"]) assert.equal(node.dueIn(text), null, text);
    // With it (the app; here the stand-in's parser), the properties as Obsidian reads them
    assert.equal(tr.dueIn("---\ntags: [task]\ndue: 2026-09-27\n---\n"), "2026-09-27");
    v.customJS.obsidian.parseYaml = () => ({ due: "2026-10-01" });
    assert.equal(tr.dueIn("---\ndue: anything\n---\n"), "2026-10-01", "read through Obsidian's parser");
    v.customJS.obsidian.parseYaml = () => { throw new Error("bad YAML"); };
    assert.equal(tr.dueIn("---\ndue: [\n---\n"), null, "properties Obsidian can't read have no due");
});

// ------------------------------------------------------------------ 2. two projects

test("check 2: one fix, AddProjectLink, and by hand only where no command works: a line in Archive, every project finished", () => {
    const BOOK = { [KES]: `${PROJECT}- [>] Book it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n`, [HOME]: PROJECT, [day("2026-09-17")]: "- [ ] Book it [[Household|⭕]] ^k3x9m2\n" };
    const said = (notes) => run(notes).model.problems.find((p) => p.rule === "project").message;
    assert.match(said(BOOK), /, and they don't name the same project: run AddProjectLink on one of its lines and pick the task's one project$/);
    // A line in Archive keeps its folder's project, and no command writes there: the task takes its ID off it
    const OLD = "Archive/Freelance/Kestrel/Kestrel.md";
    const archived = { ...BOOK, [OLD]: BOOK[KES], [KES]: undefined };
    assert.match(said(archived), /, and they don't name the same project: take the ID off its line in \[\[Kestrel\]\] by hand, since no command changes a note in Archive$/);
    // With the lines outside Archive disagreeing too, AddProjectLink first
    const three = { ...archived, [KES]: PROJECT, [day("2026-09-18")]: "- [ ] Book it [[Kestrel|⭕]] ^k3x9m2\n" };
    assert.match(said(three), /: run AddProjectLink on one of its lines outside Archive and pick the task's one project, then take the ID off its line in \[\[Kestrel\]\] by hand, since no command changes a note in Archive$/);
    // Every project finished: none is in AddProjectLink's menu
    const done = { ...BOOK, [KES]: `---\ntags: [project]\nstatus: Done\n---\n- [>] Book it [[2026-09-17#^k3x9m2|9/17]] ^k3x9m2\n`, [HOME]: "---\ntags: [project]\nstatus: canceled\n---\n" };
    assert.match(said(done), /: give its lines the task's one project by hand, since a finished project isn't in AddProjectLink's menu$/);
    assert.match(said({ ...done, [HOME]: PROJECT }), /: run AddProjectLink/, "one of them still open");
});

// ------------------------------------------------------------------ the error log

test("the error log names each new check, and a task whose deadlines differ once", () => {
    const ErrorLog = vm.runInContext(fs.readFileSync(new URL("../../../plugin/src/classes/errorLog.js", import.meta.url), "utf8") + "\n;ErrorLog", vm.createContext({}));
    const log = new ErrorLog();
    const link = (p) => `[[${p.replace(/\.md$/, "")}]]`;
    const kinds = (notes) => plain(log.fromModel({ ...run(notes).model, billing: null }, link).map((g) => [g.kind, g.name, g.count]));
    assert.deepEqual(kinds(DEADLINES("2026-09-27")), [["Two deadlines on one task", "2026-09-14", 1]]);
    assert.deepEqual(kinds(SUBTASK("- [ ] Send final copy [[Kestrel|⭕]] [[Write copy#^p7d2qe|↗]] ^p7d2qe")), [["Subtask in another project than its note", "2026-09-17", 1]]);
    assert.deepEqual(kinds({ [KES]: `${PROJECT}- [ ] Proposal [[Pinecrest|⭕]]\n`, [PINE]: PROJECT }), [["⭕ outside a periodic note", "Kestrel", 1]]);
    for (const kind of ["⭕ outside a periodic note", "Subtask in another project than its note", "Two deadlines on one task"]) assert.ok(ErrorLog.KINDS.includes(kind), kind);
});
