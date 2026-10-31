// Tests for OBS-196: a line's project comes from the line alone (rules 3, 4, 5 and 7), and the checks
// that list what disagrees (rule 15). The class is loaded with vm, the way CustomJS evaluates it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const context = vm.createContext({});
const TimeReport = vm.runInContext(fs.readFileSync(new URL("../CustomJS/timeReport.js", here), "utf8") + "\n;TimeReport", context);
const tr = new TimeReport();
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}.js`, here), "utf8") + `\n;${name}`, vm.createContext({}));
const billing = new (load("billing", "Billing"))();
const TaskIds = load("taskIds", "TaskIds");
const log = new (load("errorLog", "ErrorLog"))();
const Invoice = load("invoice", "Invoice");
const plain = (x) => JSON.parse(JSON.stringify(x));

const DAY = "Reference/Planner/days/2026-09-17.md";
const WEEK = "Reference/Planner/weeks/2026w38.md";
const KES = "Projects/Freelance/Kestrel/Kestrel.md";
const CAT = "Projects/Freelance/Kestrel/Catalog/Catalog.md";
const PIN = "Projects/Freelance/Pinecrest/Pinecrest.md";
const HOME = "Projects/Household/Household.md";
const OLD = "Archive/Freelance/Oldco/Oldco.md";
const FONTS = "Projects/Freelance/Kestrel/Pick fonts.md";
const LOG = "Projects/Freelance/Pinecrest/›logs/2026-09-17 Printer call.md";
const LAMP = "Inbox/Desk lamp.md";
const PERSON = "Reference/People/Imogen.md";

const VAULT = [
    { path: DAY }, { path: WEEK },
    { path: KES, tags: ["project"], props: { rate_type: "hourly", rate: 95 } },
    { path: CAT, tags: ["project"], parent: "[[Kestrel]]" },
    { path: PIN, tags: ["project"], props: { rate_type: "hourly", rate: 80 } },
    { path: HOME, tags: ["area"] },
    { path: OLD, tags: ["project"], props: { rate_type: "hourly", rate: 70 } },
    { path: FONTS, tags: ["task"], parent: "[[Kestrel]]" },
    { path: LOG, tags: ["log"], parent: "[[Pinecrest]]" },
    { path: LAMP, tags: ["task"] },
    { path: PERSON },
];
const SYSTEM = (p) => !p.startsWith("Reference/People/") && !p.startsWith("Archive/");
const index = tr.makeIndex(VAULT, { inSystem: SYSTEM });
const read = (text, i = 0, path = DAY, ix = index) => {
    const lines = text.split("\n");
    return plain(tr.resolve((n) => lines[n], i, path, ix));
};
const day = (text, date = "2026-09-17") => ({ date, path: DAY, text });
const modelOf = (text) => tr.build([day(text)], index);
const projects = (m) => plain(m.entries.map((e) => e.project));

// ------------------------------------------------------------------ the one function

test("resolve: the top line's ⭕ or 🗃️ says where the time goes, or it's Unassigned", () => {
    assert.equal(read("- [x] Task [[Kestrel|⭕]]").project, KES);
    assert.equal(read("- [x] Errand [[Household|🗃️]]").project, HOME);
    assert.equal(read("- [x] Task").project, null);
    assert.equal(read("- [x] Task [[Kestrel]]").project, null, "a link in the text says nothing");
    assert.equal(read("- [x] Task [[Not a note|⭕]]").project, null, "a ⭕ naming no project says nothing");
    assert.equal(read("- [<] 9:00am\tReview [[Kestrel|⭕]]").project, KES, "an event like a task");
    assert.equal(read("9:00am\tReview [[Kestrel|⭕]]").project, KES, "an event in the form used before August 2025");
});

test("resolve: a ⋯, a ↗ or a log says nothing about a line's project", () => {
    for (const line of ["- [x] Task [[Pick fonts|⋯]]", "- [x] Task [[Pick fonts|↗]]", "- [<] 9:00am\t[[2026-09-17 Printer call|Printer call]]", "9:00am\t[[2026-09-17 Printer call|Printer call]]"]) {
        assert.deepEqual(read(line), { project: null, archived: false, live: null, conflict: null }, line);
    }
});

test("resolve: only the top of the nest counts; nothing on a nested line or a plain bullet", () => {
    const text = "- [ ] Task [[Kestrel|⭕]]\n\t- Notes [[Pinecrest|⭕]]\n\t\t- [ ] Sub [[Pinecrest|⭕]]\n\t\t\t- 9:00am - 9:30am";
    for (const i of [0, 1, 2, 3]) assert.equal(read(text, i).project, KES, `line ${i}`);
    assert.equal(read("- Plain [[Kestrel|⭕]]\n\t- 9:00am - 9:30am", 1).project, null, "a plain bullet's ⭕ counts for nothing");
});

test("resolve: a line whose top isn't a checklist or event line at the left edge has no project", () => {
    assert.equal(read("- Personal [[Kestrel|⭕]]\n\t- [x] Buy stamps [[Kestrel|⭕]]", 1).project, null);
    assert.equal(read("\t- [x] Indented with nothing above [[Kestrel|⭕]]").project, null);
    assert.equal(read("Paragraph [[Kestrel|⭕]]").project, null);
});

test("resolve: outside a periodic note a line has no project; a week's line reads like a day's", () => {
    assert.deepEqual(read("- [ ] Task [[Kestrel|⭕]]", 0, FONTS), { project: null, archived: false, live: null, conflict: null });
    assert.equal(read("- [ ] Task [[Kestrel|⭕]]", 0, WEEK).project, KES);
});

test("resolve: a project in Archive counts like any other, and is marked", () => {
    assert.deepEqual(read("- [x] Task [[Oldco|⭕]]"), { project: OLD, archived: true, live: null, conflict: null });
});

test("resolve: two project links that agree are one project; two that differ, nothing decides", () => {
    assert.equal(read("- [x] Task [[Kestrel|⭕]] [[Kestrel|⭕]]").conflict, null);
    const r = read("- [x] Task [[Kestrel|⭕]] [[Pinecrest|⭕]]");
    assert.equal(r.project, KES, "it holds the ⭕ the line names first, for the entry's place");
    assert.deepEqual(r.conflict.links, [KES, PIN]);
    const old = read("- [x] Task [[Oldco|⭕]] [[Pinecrest|⭕]]");
    assert.deepEqual([old.project, old.archived, old.live], [OLD, true, PIN], "Billing still finds a billed row's entry on the live project");
    assert.equal(read("- [x] Task [[Kestrel|⭕]] [[Not a note|⭕]]").conflict, null, "a link that names no project doesn't disagree");
});

test("resolve: a line's ⭕ and its own note: nothing decides when the note is filed elsewhere", () => {
    assert.equal(read("- [x] Task [[Kestrel|⭕]] [[Pick fonts|⋯]]").conflict, null);
    const r = read("- [x] Task [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]");
    assert.deepEqual([r.project, r.conflict.note, r.conflict.noteProject], [KES, LOG, PIN]);
    assert.equal(r.conflict.event, false);
    assert.equal(read("- [<] 9:00am\tCall [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]").conflict.event, true);
    assert.equal(read("- [<] 9:00am\t[[2026-09-17 Printer call|Call]] [[Kestrel|⭕]]").conflict.noteProject, PIN, "a log wrapped around the title is its own note");
    assert.equal(read("- [x] Task [[Kestrel|⭕]] [[2026-09-17 Printer call|↗]]").conflict, null, "a ↗ is read by nobody");
    assert.equal(read("- [x] Task [[Kestrel|⭕]] [[Imogen|⋯]]").conflict, null, "a ⋯ to a note outside the system is a reference");
    assert.equal(read("- [x] Task [[Kestrel|⭕]] [[Desk lamp|⋯]]").conflict, null, "a note in the Inbox is in no project");
});

test("resolve: a ⋯ to a note in Archive is compared like any other", () => {
    const ix = tr.makeIndex([...VAULT, { path: "Archive/Freelance/Oldco/Old note.md", tags: ["task"] }], { inSystem: SYSTEM });
    const r = read("- [x] Task [[Kestrel|⭕]] [[Old note|⋯]]", 0, DAY, ix);
    assert.equal(r.conflict.noteProject, OLD);
    assert.deepEqual([read("- [x] Task [[Oldco|⭕]] [[Pick fonts|⋯]]").live, read("- [x] Task [[Oldco|⭕]] [[Pick fonts|⋯]]").project], [KES, OLD], "an archived ⭕ with a live note: Billing reads the live one");
});

test("lineProject: a periodic note's line as resolve reads it; any other line, its note's project", () => {
    const lines = ["- [x] Task [[Oldco|⭕]] [[Pick fonts|⋯]]", "\t- [ ] Sub [[Pinecrest|⭕]]", "- [x] Other [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]"];
    assert.equal(tr.lineProject({ path: DAY }, 1, lines, index), KES, "a command passes over the archived ⭕");
    assert.equal(tr.lineProject({ path: DAY }, 1, lines, index, false), OLD, "the checks read it as the report does");
    assert.equal(tr.lineProject({ path: DAY }, 2, lines, index), KES, "on a disagreement, the ⭕");
    assert.equal(tr.lineProject({ path: FONTS }, 0, ["- [ ] Step"], index), KES, "a line outside a periodic note: its note's project");
    assert.equal(tr.lineProject({ path: LAMP }, 0, ["- [ ] Step"], index), null);
    assert.equal(tr.lineProject({ path: FONTS }, 0, ["- [ ] Step [[Pinecrest|⭕]]"], index), KES, "a ⭕ there counts for nothing (rule 4)");
    assert.equal(tr.lineProject({ path: LAMP }, 0, ["- [>] Step [[Pinecrest|⭕]]"], index), null);
});

// ------------------------------------------------------------------ a note's project

test("a note's project is its folder's: `parent` isn't read", () => {
    const ix = tr.makeIndex([{ path: KES, tags: ["project"] }, { path: "Reference/Loose.md", parent: "[[Kestrel]]" }, { path: PIN, tags: ["project"], parent: "[[Kestrel]]" }]);
    assert.equal(tr.projectOfNote("Reference/Loose.md", ix), null);
    assert.equal(tr.parentProject(PIN, ix), null, "a live project isn't a sub-project through its `parent`");
    assert.equal(tr.parentProject(CAT, tr.makeIndex([{ path: KES, tags: ["project"] }, { path: CAT, tags: ["project"] }])), KES, "only the folder makes one");
});

test("an archived project reads its `parent` when no folder gives it one", () => {
    const ix = tr.makeIndex([{ path: KES, tags: ["project"] }, { path: OLD, tags: ["project"], parent: "[[Kestrel]]" }]);
    assert.equal(tr.parentProject(OLD, ix), KES);
    const inside = "Archive/Oldco/Part/Part.md";
    const nested = tr.makeIndex([{ path: "Archive/Oldco/Oldco.md", tags: ["project"] }, { path: inside, tags: ["project"], parent: "[[Kestrel]]" }, { path: KES, tags: ["project"] }]);
    assert.equal(tr.parentProject(inside, nested), "Archive/Oldco/Oldco.md", "a folder still comes first");
});

test("an archived sub-project keeps counting toward its live parent's cap, and takes its rate", () => {
    const rate = tr.makeIndex([{ path: KES, tags: ["project"], props: { rate_type: "hourly", rate: 95 } }, { path: OLD, tags: ["project"], parent: "[[Kestrel]]" }]);
    const m = tr.build([day("- [x] Task [[Oldco|⭕]]\n\t- 9:00am - 10:00am")], rate);
    assert.equal(m.parent.get(OLD), KES);
    assert.equal(m.money.get(OLD).rate, 95);
});

// ------------------------------------------------------------------ which time counts

test("time directly under a top-level task or event counts toward its ⭕", () => {
    assert.deepEqual(projects(modelOf("- [x] Task [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n- [<] 11:00am\tCall [[Pinecrest|⭕]]\n\t- 11:30am")), [KES, PIN]);
});

test("a line with a ⋯, a ↗ or a wrapped log and no ⭕ is Unassigned, and isn't listed", () => {
    const m = modelOf("- [x] A [[Pick fonts|⋯]]\n\t- 8:00am - 8:30am\n- [x] B [[Pick fonts|↗]]\n\t- 9:00am - 9:30am\n- [<] 10:00am\t[[2026-09-17 Printer call|Call]]\n\t- 10:30am");
    assert.deepEqual(projects(m), [null, null, null]);
    assert.deepEqual(plain(m.problems), []);
    assert.deepEqual(plain(m.projectProblems), []);
});

test("time under a sub-task, at any depth, doesn't count and is listed", () => {
    for (const text of [
        "- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 9:00am - 9:30am",
        "- [ ] Task [[Kestrel|⭕]]\n\t- Notes\n\t\t- [ ] Sub\n\t\t\t- 9:00am - 9:30am",
        "- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- [ ] Sub of sub\n\t\t\t- 9:00am - 9:30am",
        "- [<] 8:00am\tCall [[Kestrel|⭕]]\n\t- 8:30am\n\t- [ ] Sub\n\t\t- 9:00am - 9:30am",
        "8:00am\tCall [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 9:00am - 9:30am",
    ]) {
        const m = modelOf(text);
        assert.equal(m.entries.filter((e) => e.minutes === 30 && e.start === 540).length, 0, text);
        const listed = m.problems.filter((p) => p.kind === "subtime");
        assert.equal(listed.length, 1, text);
        assert.deepEqual(plain(listed[0].projects), [KES], "on the task's project");
    }
});

test("time under a sub-task is on no report or timesheet, and a billed row on it says it's no longer counted", () => {
    const m = modelOf("- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 9:00am - 9:30am");
    assert.equal(m.entries.length, 0);
    assert.equal(m.disputed.length, 1);
    assert.equal(m.billingEntries.length, 1);
    assert.ok(m.billingEntries[0].disputed && m.billingEntries[0].subTask);
});

test("a sub-task's marks count for nothing: its ⭕ moves no time", () => {
    const m = modelOf("- [ ] Task [[Kestrel|⭕]]\n\t- 8:00am - 8:30am\n\t- [ ] Sub [[Pinecrest|⭕]]\n\t\t- 9:00am - 9:30am");
    assert.deepEqual(projects(m), [KES]);
});

test("an event nested under a task is a sub-task: its span doesn't count and is listed; under a plain bullet, nothing", () => {
    const nested = modelOf("- [ ] Task [[Kestrel|⭕]]\n\t- [<] 4:00pm\tCall\n\t\t- 4:30pm");
    assert.deepEqual(projects(nested), []);
    assert.deepEqual(plain(nested.problems.map((p) => p.kind)), ["subtime"]);
    const plainBullet = modelOf("- Errands\n\t- [<] 4:00pm\tCall [[Kestrel|⭕]]\n\t\t- 4:30pm\n\t- [<] 5:00pm\tNo end line");
    assert.deepEqual(projects(plainBullet), []);
    assert.deepEqual(plain(plainBullet.problems), []);
});

test("time anywhere else counts nowhere, and nothing lists it", () => {
    for (const text of [
        "- 3:00pm - 3:20pm",
        "- Errands\n\t- 3:00pm - 3:20pm",
        "- [ ] Task [[Kestrel|⭕]]\n\t- Notes\n\t\t- 3:00pm - 3:20pm",
        "- Personal\n\t- [x] Buy stamps [[Kestrel|⭕]]\n\t\t- 3:40pm - 3:50pm",
        "- Personal\n\t- [x] Buy stamps\n\t\t- [ ] Sub\n\t\t\t- 3:40pm - 3:50pm",
        "\t- [x] Indented alone [[Kestrel|⭕]]\n\t\t- 3:40pm - 3:50pm",
        "## Heading\n\t- 3:00pm - 3:20pm",
        "Paragraph\n\t- 3:00pm - 3:20pm",
    ]) {
        const m = modelOf(text);
        assert.deepEqual(plain(m.entries), [], text);
        assert.deepEqual(plain(m.billingEntries), [], text);
        assert.deepEqual(plain(m.problems), [], text);
    }
});

test("what looks like time with its format off is listed as it is today", () => {
    const kinds = (text) => plain(modelOf(text).problems.map((p) => p.kind));
    assert.deepEqual(kinds("- 10:00 - 11:00am"), ["format"], "with nothing above it");
    assert.deepEqual(kinds("- [ ] Task\n\t- 10:00 - 11:00am"), ["format"]);
    assert.deepEqual(kinds("- [ ] Task\n\t- Notes\n\t\t- 10:00 - 11:00am"), ["format"], "under a plain bullet, with a task further up");
    assert.deepEqual(kinds("- [ ] Task\n\t- [ ] Sub\n\t\t- 10:00 - 11:00am"), ["format"]);
    assert.deepEqual(kinds("- [ ] Task\n\t- 3:00pm - "), ["open"]);
    assert.deepEqual(kinds("- 3:00pm - "), ["open"], "a running clock with nothing above it");
    assert.deepEqual(kinds("- [ ] Task\n\t- Notes\n\t\t- 3:00pm - "), ["open"]);
    assert.deepEqual(kinds("- 11:00am - 10:00am"), ["order"]);
    assert.deepEqual(kinds("- 11:00am - 11:00am"), ["zero"]);
    assert.deepEqual(kinds("- Errands\n\t- 10:00 - 11:00am"), [], "a plain bullet with no task above it, as today");
});

test("time at the left edge under an old meeting line keeps counting", () => {
    const m = modelOf("## Meetings\n3:15pm\t[[2026-09-17 Printer call|Printer call]] [[Pinecrest|⭕]]\n- 3:15pm - 4:00pm");
    assert.deepEqual(projects(m), [PIN]);
    assert.deepEqual(plain(m.problems), []);
});

test("a Problem on a line takes its project from the top of its nest", () => {
    const m = modelOf("- [ ] Task [[Kestrel|⭕]]\n\t- 10:00 - 11:00am");
    assert.deepEqual(plain(m.problems[0].projects), [KES]);
    const none = modelOf("- 10:00 - 11:00am");
    assert.deepEqual(plain(none.problems[0].projects), [null]);
});

test("🆓 changes nothing about time under a sub-task: on the task or the sub-task, it isn't counted and is listed", () => {
    for (const text of ["- [ ] Task 🆓 [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 11:00am - 11:15am", "- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Sub 🆓\n\t\t- 11:00am - 11:15am"]) {
        const m = modelOf(text);
        assert.deepEqual(plain(m.entries), [], text);
        assert.deepEqual(plain(m.problems.map((p) => p.kind)), ["subtime"], text);
    }
});

// ------------------------------------------------------------------ nothing decides

test("a line that disagrees with itself counts toward neither, and isn't billed", () => {
    for (const line of ["- [x] Paper [[Kestrel|⭕]] [[Pinecrest|⭕]]", "- [x] Call [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]"]) {
        const m = modelOf(`${line}\n\t- 1:00pm - 1:30pm`);
        assert.deepEqual(plain(m.entries), [], line);
        assert.equal(m.disputed.length, 1, line);
        assert.ok(m.billingEntries[0].disputed, line);
    }
});

// ------------------------------------------------------------------ the checks

const WEEK_KEY = "2026w38";
const problemsIn = (block) => block.split("\n").filter((l) => l.startsWith("> - ")).map((l) => l.slice(2));
const link = (p) => `[[${tr.basename(p)}]]`;
const records = (text, path = DAY) => plain(tr.ownNoteProblems([{ path, date: "2026-09-17", text }], index));

test("own-note check: per line, with or without time, on both projects", () => {
    const text = "- [x] Call [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]";
    const rows = records(text);
    assert.deepEqual(rows.map((r) => [r.project, r.conflict.side, r.conflict.line, r.conflict.date]), [[KES, "line", 1, "2026-09-17"], [PIN, "note", 1, "2026-09-17"]]);
    assert.equal(records(`${text}\n\t- 9:00am - 9:30am\n\t- 10:00am - 10:30am`).length, 2, "one per line, however many entries");
    assert.equal(records("- [x] Call [[Pinecrest|⭕]] [[2026-09-17 Printer call|⋯]]").length, 0, "they agree");
    assert.equal(records("- [x] Call [[2026-09-17 Printer call|⋯]]").length, 0, "with no ⭕ the note isn't read");
    assert.equal(records("- [x] Call [[Kestrel|⭕]] [[2026-09-17 Printer call|↗]]").length, 0, "a ↗ is read by nobody");
    assert.equal(records("- [x] Task\n\t- [ ] Sub [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]").length, 0, "a sub-task's marks count for nothing");
    assert.equal(records(text, FONTS).length, 0, "outside a periodic note");
    assert.equal(records("```\n- [x] Call [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]\n```").length, 0, "a code block isn't a line");
});

test("own-note check: a week's line is dated by the week, and two project links are listed on each", () => {
    const rows = records("- [ ] Plan [[Kestrel|⭕]] [[Pinecrest|⭕]]", WEEK);
    assert.deepEqual(rows.map((r) => [r.project, r.conflict.side, r.conflict.kind, r.conflict.date]), [[KES, "line", "week", "2026-09-13"], [PIN, "note", "week", "2026-09-13"]]);
});

test("a ⭕ while its own note waits in the Inbox is listed, and its time counts", () => {
    const text = "- [x] Price a lamp [[Kestrel|⭕]] [[Desk lamp|⋯]]\n\t- 9:00am - 9:20am";
    const m = modelOf(text);
    assert.deepEqual(projects(m), [KES]);
    const rows = plain(m.projectProblems.filter((p) => p.conflict));
    assert.deepEqual(rows.map((r) => [r.project, r.conflict.side, r.conflict.inbox]), [[KES, "line", true]]);
    const block = tr.render(tr.attachBilling(m, [], index, billing), { kind: "period", unit: "week", key: WEEK_KEY }, "s", link);
    assert.ok(block.includes("links [[Kestrel]], but its task note [[Inbox/Desk lamp|Desk lamp]] waits in the Inbox; run AddProjectLink on the line, or MoveToProject on the note"), block);
});

test("two project links on one line are said in the week and on both projects, with their fix", () => {
    const m = tr.attachBilling(modelOf("- [x] Compare stock [[Kestrel|⭕]] [[Pinecrest|⭕]]\n\t- 1:00pm - 1:30pm"), [], index, billing);
    const want = "names [[Kestrel]] and [[Pinecrest]], so its time isn't counted on either; take the wrong link off";
    const week = problemsIn(tr.render(m, { kind: "period", unit: "week", key: WEEK_KEY }, "s", link));
    assert.equal(week.filter((l) => l.includes(want)).length, 1, "said once in a period");
    for (const path of [KES, PIN]) assert.equal(problemsIn(tr.render(m, { kind: "project", path }, "s", link)).filter((l) => l.includes(want)).length, 1, path);
    assert.ok(tr.render(m, { kind: "timesheet", path: KES }, "s", link).includes(want), "the timesheet says why it has no row");
});

test("a line's disagreement with no time shows in its week and in Invoice's Fix first", () => {
    // A day with no time at all: the report's list of daily notes doesn't hold it, the checks' does
    const checked = [{ path: DAY, kind: "day", date: "2026-09-17", text: "- [x] Call [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]]" }];
    const m = tr.attachBilling(tr.build([], index, { checked }), [], index, billing);
    const week = problemsIn(tr.render(m, { kind: "period", unit: "week", key: WEEK_KEY }, "s", link));
    assert.equal(week.length, 1, week.join("\n"));
    assert.ok(week[0].includes("is filed under [[Pinecrest]]"), week[0]);
    assert.ok(tr.projectTargets(m).has(KES) && tr.projectTargets(m).has(PIN), "both projects' notes get a report");
    const sel = billing.select(m, tr, index, { project: KES, through: "2026-09-30", ledger: billing.ledger([]) });
    const fix = tr.problemLines(m, [], sel.projectProblems.filter((p) => tr.changesBilling(p)), [], (p) => tr.basename(p));
    assert.equal(fix.length, 1, "Invoice's Fix first?");
    assert.ok(fix[0].includes("so its time isn't counted on either"), fix[0]);
});

test("time under a sub-task is listed on its day's reports and its project, the timesheet says why it has no row, and Fix first shows it from any day", () => {
    const m = tr.attachBilling(tr.build([
        { date: "2026-09-17", path: DAY, text: "- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 11:00am - 11:30am" },
        { date: "2026-09-18", path: DAY.replace("17", "18"), text: "- [x] Later [[Kestrel|⭕]]\n\t- 9:00am - 9:30am" },
    ], index), [], index, billing);
    const want = "is under a nested task, so it isn't counted; move it up to the task at the left edge, or outdent the nested task";
    for (const scope of [{ kind: "period", unit: "week", key: WEEK_KEY }, { kind: "project", path: KES }]) {
        assert.equal(problemsIn(tr.render(m, scope, "s", link)).filter((l) => l.includes(want)).length, 1, scope.kind);
    }
    const sheet = tr.render(m, { kind: "timesheet", path: KES }, "s", link);
    assert.ok(sheet.includes(want), sheet);
    assert.ok(!sheet.includes("11:00am - 11:30am |"), "it has no row");
    const sel = billing.select(m, tr, index, { project: KES, through: "2026-09-30", ledger: billing.ledger([]) });
    assert.deepEqual(plain(sel.problems.map((p) => [p.date, p.kind])), [["2026-09-17", "subtime"]], "dated before the first entry considered");
});

test("a billed row on an entry now under a sub-task says it's no longer counted, not that it's missing", () => {
    const rows = [{ date: "2026-09-17", start: 660, end: 690, minutes: 30, billed: 30, cents: 9500, project: KES, task: "Sub", note: "" }];
    const inv = { path: "Reference/Invoices/1001-KES.md", props: { status: "sent", project: "[[Kestrel]]" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const ix = tr.makeIndex([...VAULT, { path: inv.path, tags: ["invoice"] }], { inSystem: SYSTEM });
    const m = tr.attachBilling(tr.build([day("- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 11:00am - 11:30am")], ix), [inv], ix, billing);
    const lines = tr.render(m, { kind: "project", path: KES }, "s", link);
    assert.ok(lines.includes("now under a nested task, so it isn't counted"), lines);
    assert.deepEqual(plain(log.fromModel(m, link).map((g) => g.kind)), ["Billed entry under a nested task", "Time under a nested task"]);
});

test("the error log's kinds cover everything this issue lists, and every map's values are in its order", () => {
    const { ENTRY, CHANGE, RULE, KINDS } = log.constructor;
    for (const kind of [...Object.values(ENTRY), ...Object.values(CHANGE), ...Object.values(RULE)]) assert.ok(KINDS.includes(kind), kind);
    assert.ok(!KINDS.includes("Time not under a task or event") && !KINDS.includes("Time under a plain bullet"));
});

// ------------------------------------------------------------------ marks on sub-tasks

const marked = (text, path = DAY) => plain(tr.subTaskProblems([{ path, text }], TaskIds));

test("subTaskProblems: every mark on a sub-task, in any note, each with its fix", () => {
    const text = "- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Pick the fields [[Pinecrest|⭕]] [[Pick fonts|⋯]]\n\t\t- 11:00am - 11:30am";
    const [p] = marked(text);
    assert.equal(p.line, 1);
    assert.equal(p.message, "is nested, so its ⭕ and ⋯ count for nothing: only a task at the left edge can carry them; outdent it, or take them off");
    assert.match(marked("- [ ] Shoot\n\t- [ ] Charge batteries [[2026-09-23|🚩 9/23]]", KES)[0].message, /its 🚩 counts for nothing/);
    assert.match(marked("- [ ] Task\n\t- [ ] Sub [[Household|🗃️]]")[0].message, /its 🗃️ counts/);
    assert.match(marked("- [ ] Task\n\t- [ ] Sub [[Pick fonts|↗]]")[0].message, /its ↗ counts/);
    assert.match(marked("- [ ] Task\n\t- Notes\n\t\t- [ ] Sub [[Kestrel|⭕]]")[0].message, /its ⭕ counts/, "plain bullets in between");
    assert.match(marked("- [<] 9:00am\tCall\n\t- [ ] Sub [[Kestrel|⭕]]")[0].message, /its ⭕ counts/, "under an event");
    assert.match(marked("9:00am\tCall\n\t- [ ] Sub [[Kestrel|⭕]]")[0].message, /its ⭕ counts/, "under a meeting line in the form used before August 2025");
});

test("subTaskProblems: a block ID counts only when it's a task's", () => {
    assert.deepEqual(marked("- [ ] Task\n\t- [ ] Sub ^my-own"), [], "a block ID of your own is fine");
    assert.match(marked("- [>] Sub [[2026-09-18#^abc123|9/18]] ^abc123\n- [ ] Task\n\t- [ ] Sub ^abc123")[0].message, /its task ID counts/);
    assert.match(marked("- [ ] Task\n\t- [>] Sub [[2026-09-18#^abc123|9/18]] ^abc123")[0].message, /its task ID counts/, "sent from where it's nested");
});

test("subTaskProblems: what isn't a sub-task isn't listed", () => {
    for (const text of [
        "- [ ] Task [[Kestrel|⭕]]",
        "- Plain\n\t- [ ] Under a plain bullet [[Kestrel|⭕]]",
        "- Plain\n\t- [ ] Under a plain bullet\n\t\t- [ ] Sub of it [[Kestrel|⭕]]",
        "- [ ] Task\n\t- A plain bullet [[Kestrel|⭕]]",
        "- [ ] Task\n\t- [ ] Sub with a link in its text [[Kestrel|⭕]] and more",
        "```\n- [ ] Task\n\t- [ ] Sub [[Kestrel|⭕]]\n```",
    ]) assert.deepEqual(marked(text), [], text);
});

// ------------------------------------------------------------------ the task checks

const checked = (notes, ownNote = (text, from) => tr.ownNote(tr.lineLinks(tr.classify(text).body), from, index)) => plain(TaskIds.check(notes, {
    projectOf: () => null, resolve: (linkpath, from) => index.linkDest(linkpath.split("#")[0], from), ownNote,
}));

test("TaskIds.check reads top-level lines only: a nested line's ID isn't a task's, and a line under nothing but plain bullets isn't defined", () => {
    assert.deepEqual(checked([{ path: DAY, kind: "day", text: "- [ ] Task\n\t- [ ] Sub ^abc123\n- [>] Other ^abc123\n\t- [ ] Sub ^abc123" }]), [], "twice in a note only counts for lines of the task");
    assert.deepEqual(checked([{ path: DAY, kind: "day", text: "- Plain\n\t- [ ] Task ^abc123\n\t- [>] Task ^abc123" }]), []);
});

test("TaskIds.check: a task's lines in two notes outside the periodic notes", () => {
    const id = "^p7d2qe";
    const line = `- [>] Send copy [[2026-09-17#${id}|9/17]] ${id}`;
    const notes = [{ path: FONTS, kind: "other", text: line }, { path: KES, kind: "other", text: line }, { path: DAY, kind: "day", text: `- [ ] Send copy ${id}` }];
    const hits = checked(notes).filter((v) => v.rule === "notes");
    assert.deepEqual(hits.map((v) => v.lines.map((l) => l.path)), [[FONTS, KES]]);
    assert.deepEqual(checked(notes.slice(1)).filter((v) => v.rule === "notes"), [], "one note and its days is one task's lines");
});

test("TaskIds.check: a task whose lines link two different notes with ⋯, and never a ↗", () => {
    const lines = (a, b) => [
        { path: DAY, kind: "day", text: `- [>] Draft [[Kestrel|⭕]] ${a} ^w2h5nf` },
        { path: DAY.replace("17", "18"), kind: "day", text: `- [x] Draft [[Kestrel|⭕]] ${b} ^w2h5nf` },
    ];
    const hits = (a, b) => checked(lines(a, b)).filter((v) => v.rule === "ownNotes");
    assert.equal(hits("[[Pick fonts|⋯]]", "[[2026-09-17 Printer call|⋯]]").length, 1);
    assert.deepEqual(hits("[[Pick fonts|⋯]]", "[[Pick fonts|⋯]]"), [], "the same note");
    assert.deepEqual(hits("[[Pick fonts|⋯]]", ""), [], "a line with none");
    assert.deepEqual(hits("[[Pick fonts|⋯]]", "[[2026-09-17 Printer call|↗]]"), [], "a ↗ is read by nobody");
    assert.deepEqual(hits("[[Pick fonts|⋯]]", "[[Imogen|⋯]]"), [], "a ⋯ to a note outside the system is a reference");
});

test("a task's lines in two notes say it's the same task and give both fixes; project and ⋯ say the same task too", () => {
    const lines = [{ path: "Projects/Kestrel/Pick fonts.md", line: 11 }, { path: "Projects/Kestrel/Kestrel.md", line: 19 }];
    const said = (rule) => tr.taskProblemText({ rule, id: "abc123", lines, detail: {} }, lines[0]);
    assert.equal(said("notes"), "is also at [[Kestrel|Kestrel]] line 20, with the same ID (^abc123). A task lives in one note, apart from the periodic notes. Delete the line that's in the wrong place, or, if they're really two tasks, take the ID off one");
    for (const rule of ["project", "ownNotes"]) assert.match(said(rule), /^is the same task as \[\[Kestrel\|Kestrel\]\] line 20, and they/);
    for (const rule of ["notes", "project", "ownNotes"]) assert.doesNotMatch(said(rule), /one task with/);
});

test("addTaskProblems: the new checks are placed where a task's are, and a mark on a sub-task changes nothing billed", () => {
    const text = "- [ ] Task [[Kestrel|⭕]]\n\t- [ ] Sub [[Pinecrest|⭕]]";
    const model = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(model, index, [{ path: DAY, kind: "day", date: "2026-09-17", text }, { path: FONTS, kind: "other", text: "- [ ] Step\n\t- [ ] Sub [[2026-09-20|🚩 9/20]]" }, { path: LAMP, kind: "other", text: "- [ ] Step\n\t- [ ] Sub [[2026-09-20|🚩 9/20]]" }], TaskIds);
    const day = model.problems.find((p) => p.path === DAY);
    assert.deepEqual(plain([day.kind, day.line, day.projects, tr.changesBilling(day)]), ["subtask", 2, [KES], false]);
    const onProject = model.projectProblems.find((p) => p.path === FONTS);
    assert.equal(onProject.project, KES);
    assert.match(onProject.message, /^has a task line in \[\[Pick fonts\]\] \(line 2\) that is nested/);
    assert.equal(model.problems.find((p) => p.path === LAMP).note, LAMP, "in no project: listed on its note");
});

// ------------------------------------------------------------------ `parent`

test("parentProblems: a note's `parent` that names another project than its folder does, on both", () => {
    const ix = tr.makeIndex([
        { path: KES, tags: ["project"] }, { path: PIN, tags: ["project"] }, { path: HOME, tags: ["area"] },
        { path: "Inbox/Lamp.md", tags: ["task"], parent: "[[Kestrel]]" },
        { path: "Projects/Freelance/Pinecrest/Wrong.md", tags: ["task"], parent: "[[Kestrel]]" },
    ], { inSystem: SYSTEM });
    assert.deepEqual(plain(tr.parentProblems(ix).map((p) => [p.path, p.project, p.named, p.folder])), [
        ["Inbox/Lamp.md", KES, KES, null],
        ["Projects/Freelance/Pinecrest/Wrong.md", PIN, KES, PIN],
        ["Projects/Freelance/Pinecrest/Wrong.md", KES, KES, PIN],
    ]);
});

test("parentProblems: what isn't compared", () => {
    const ix = tr.makeIndex([
        { path: "Projects/Work/Work.md", tags: ["area"] },
        { path: KES, tags: ["project"], parent: "[[Household]]" },     // a project's own parent is the one above its folder
        { path: "Projects/Work/Kestrel Two/Kestrel Two.md", tags: ["project"], parent: "[[Work]]" },
        { path: PIN, tags: ["project"] }, { path: HOME, tags: ["area"] },
        { path: "Projects/Work/Kestrel Two/Agrees.md", parent: "[[Kestrel Two]]" },
        { path: "Projects/Work/Kestrel Two/No parent.md" },
        { path: "Projects/Work/Kestrel Two/Names no project.md", parent: "[[Agrees]]" },
        { path: "Projects/Work/Kestrel Two/Dead link.md", parent: "[[Nothing there]]" },
        { path: "Projects/Work/Kestrel Two/Invoice.md", tags: ["invoice"], parent: "[[Pinecrest]]" },
        { path: "Projects/Work/Kestrel Two/Kestrel Two timesheet.md", tags: ["timesheet"], parent: "[[Pinecrest]]" },
        { path: "Archive/Gone/Old note.md", parent: "[[Pinecrest]]" },
        { path: "Reference/People/Someone.md", parent: "[[Pinecrest]]" },
        { path: DAY, parent: "[[Pinecrest]]" },
    ], { inSystem: SYSTEM });
    assert.deepEqual(plain(tr.parentProblems(ix).map((p) => [p.path, p.project])), [[KES, HOME]], "only the project whose `parent` names what no folder says");
});

test("a `parent` that differs from its folder is said on both projects' notes, with its fix, and in no week", () => {
    const ix = tr.makeIndex([...VAULT, { path: "Inbox/Lamp.md", tags: ["task"], parent: "[[Kestrel]]" }, { path: "Projects/Freelance/Pinecrest/Wrong.md", parent: "[[Kestrel]]" }], { inSystem: SYSTEM });
    const m = tr.attachBilling(tr.build([day("- [x] Task [[Kestrel|⭕]]\n\t- 9:00am - 9:30am")], ix), [], ix, billing);
    tr.addTaskProblems(m, ix, [], TaskIds);
    const kes = problemsIn(tr.render(m, { kind: "project", path: KES }, "s", link));
    assert.ok(kes.includes("- [[Inbox/Lamp|Lamp]] is in no project's folder, but its `parent` names [[Kestrel]]; clear `parent`, or file the note"), kes.join("\n"));
    assert.ok(kes.includes("- [[Projects/Freelance/Pinecrest/Wrong|Wrong]] is filed under [[Pinecrest]], but its `parent` names [[Kestrel]]; set `parent` to [[Pinecrest]]"), kes.join("\n"));
    assert.equal(problemsIn(tr.render(m, { kind: "project", path: PIN }, "s", link)).length, 1);
    assert.deepEqual(problemsIn(tr.render(m, { kind: "period", unit: "week", key: WEEK_KEY }, "s", link)), []);
    assert.deepEqual(plain(log.fromModel(m, link).map((g) => [g.kind, g.name])), [["Note's parent differs from its folder", "Lamp"], ["Note's parent differs from its folder", "Wrong"]]);
});

// ------------------------------------------------------------------ an invoice with no project

test("an invoice with no project is listed on each project its rows bill, on its note and timesheet, and stops nothing", () => {
    const rows = [
        { date: "2026-09-17", start: 540, end: 600, minutes: 60, billed: 60, cents: 9500, project: KES, task: "Task", note: "" },
        { date: "2026-09-17", start: 660, end: 720, minutes: 60, billed: 60, cents: 8000, project: PIN, task: "Other", note: "" },
    ];
    const inv = { path: "Reference/Invoices/1001-KES.md", props: { status: "paid" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const ix = tr.makeIndex([...VAULT, { path: inv.path, tags: ["invoice"] }], { inSystem: SYSTEM });
    // The first row's entry moved, as the demo's 9/11 row has: that change isn't listed while its project can't be read
    const m = tr.attachBilling(tr.build([day("- [x] Task [[Kestrel|⭕]]\n\t- 9:15am - 10:00am\n- [x] Other [[Pinecrest|⭕]]\n\t- 11:00am - 12:00pm")], ix), [inv], ix, billing);
    const want = "- [[1001-KES]] has no project that can be read, so nothing says whose bill it is; set its `parent` to the project it bills";
    for (const path of [KES, PIN]) assert.deepEqual(problemsIn(tr.render(m, { kind: "project", path }, "s", link)).filter((l) => l.includes("1001-KES")), [want], path);
    assert.deepEqual(problemsIn(tr.render(m, { kind: "period", unit: "week", key: WEEK_KEY }, "s", link)), [], "an invoice's Problems are for its projects' notes");
    assert.ok(tr.render(m, { kind: "timesheet", path: KES }, "s", link).includes(want));
    assert.ok(!problemsIn(tr.render(m, { kind: "project", path: KES }, "s", link)).some((l) => l.includes("was billed")), "its rows' changes wait until it can be read");
    assert.ok(log.fromModel(m, link).some((g) => g.kind === "Invoice with no project" && g.name === "1001-KES"));
    assert.deepEqual(plain(billing.select(m, tr, ix, { project: KES, through: "2026-09-30", ledger: m.billing.ledger }).bad), [], "Invoice isn't refused");
});

test("a canceled invoice with no project is never listed", () => {
    const rows = [{ date: "2026-09-17", start: 540, end: 600, minutes: 60, billed: 60, cents: 9500, project: KES, task: "Task", note: "" }];
    const inv = { path: "Reference/Invoices/1001-KES.md", props: { status: "canceled" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const ix = tr.makeIndex([...VAULT, { path: inv.path, tags: ["invoice"] }], { inSystem: SYSTEM });
    const m = tr.attachBilling(tr.build([], ix), [inv], ix, billing);
    assert.deepEqual(plain(m.projectProblems), []);
});

// ------------------------------------------------------------------ review round 1

test("every change Billing can name has words on the invoice and in the report", () => {
    const row = { date: "2026-09-17", start: 540, end: 600, task: "Task", note: "" };
    const entry = { date: "2026-09-17", start: 540, end: 600, project: KES };
    for (const kind of ["times", "free", "unassigned", "project", "disputed", "subtask", "gone", "wording"]) {
        const [line] = new Invoice().changeItems({ changes: [{ row, kind, entry }], late: [] }, tr);
        assert.ok(!line.includes("undefined"), `Invoice: ${kind}: ${line}`);
        if (kind === "wording") continue;
        const said = tr.invoiceProblem({ invoice: { name: "1001-KES", status: "sent", invoiceDate: "2026-09-17" }, change: { row, kind, entry } }, link);
        assert.ok(!said.includes("undefined"), `report: ${kind}: ${said}`);
    }
    assert.match(new Invoice().changeItems({ changes: [{ row, kind: "subtask", entry }], late: [] }, tr)[0], /now under a nested task, so it isn't counted/);
});

test("an invoice with no project is listed only on projects: a row linking a note that isn't one finds its entries' project instead", () => {
    const rows = [{ date: "2026-09-17", start: 540, end: 600, minutes: 60, billed: 60, cents: 9500, project: "Reference/Old name.md", task: "Task", note: "" }];
    const inv = { path: "Reference/Invoices/1001-KES.md", props: { status: "paid" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const ix = tr.makeIndex([...VAULT, { path: "Reference/Old name.md" }, { path: inv.path, tags: ["invoice"] }], { inSystem: SYSTEM });
    const m = tr.attachBilling(tr.build([day("- [x] Task [[Kestrel|⭕]]\n\t- 9:00am - 10:00am")], ix), [inv], ix, billing);
    assert.deepEqual(plain(m.projectProblems.map((p) => p.project)), [KES]);
    assert.ok(!tr.projectTargets(m).has("Reference/Old name.md"), "a note that isn't a project gets no report");
    const gone = rows.map((r) => ({ ...r, project: "Nothing there" }));
    const dead = { ...inv, text: billing.billedLines(gone, tr, (p) => tr.basename(p)).join("\n") };
    const n = tr.attachBilling(tr.build([day("- [x] Task [[Kestrel|⭕]]\n\t- 9:00am - 10:00am")], ix), [dead], ix, billing);
    assert.deepEqual(plain(n.projectProblems.map((p) => p.project)), [KES], "a dead row link too");
    assert.ok(tr.render(n, { kind: "timesheet", path: KES }, "s", link).includes("has no project that can be read"));
});

test("time that isn't counted still reaches a report: its project's note and its period, though nothing else is there", () => {
    for (const text of ["- [x] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 9:00am - 9:30am", "- [x] Paper [[Kestrel|⭕]] [[Pinecrest|⭕]]\n\t- 9:00am - 9:30am"]) {
        const m = modelOf(text);
        assert.deepEqual(plain(tr.periodsWithEntries(m)), { week: [WEEK_KEY], month: ["2026-09"], year: ["2026"] }, text);
        assert.ok(tr.projectTargets(m).has(KES), text);
    }
    const later = tr.build([day("- [x] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 9:00am - 9:30am")], index, { now: { date: "2026-09-16", minutes: 0 } });
    assert.deepEqual(plain(later.disputed), [], "time still to come isn't work yet");
    assert.deepEqual(plain(tr.periodsWithEntries(later)), { week: [], month: [], year: [] });
});

test("a ⭕ with its note in the Inbox bills normally: not in Fix first, and its timesheet rows are ⚠️", () => {
    const m = tr.attachBilling(modelOf("- [x] Price a lamp [[Kestrel|⭕]] [[Desk lamp|⋯]]\n\t- 9:00am - 9:20am"), [], index, billing);
    const sel = billing.select(m, tr, index, { project: KES, through: "2026-09-30", ledger: billing.ledger([]) });
    assert.deepEqual(plain(sel.projectProblems.filter((p) => tr.changesBilling(p))), [], "Invoice's Fix first?");
    assert.equal(sel.entries.length, 1, "and the time is billed");
    const sheet = tr.render(m, { kind: "timesheet", path: KES }, "s", link);
    assert.ok(sheet.includes("waits in the Inbox"), sheet);
    assert.ok(sheet.split("\n").some((l) => l.startsWith("| ⚠️ |") && l.includes("9:00am - 9:20am")), sheet);
});

test("the Inbox is named once: the index says what waits there", () => {
    assert.equal(TimeReport.INBOX, undefined);
    assert.equal(TaskIds.INBOX, "Inbox");
    assert.ok(TaskIds.FOLDERS.includes(TaskIds.INBOX));
    const ix = tr.makeIndex(VAULT, { inSystem: SYSTEM, inInbox: () => false });
    assert.deepEqual(plain(tr.ownNoteProblems([{ path: DAY, date: "2026-09-17", text: "- [x] Lamp [[Kestrel|⭕]] [[Desk lamp|⋯]]" }], ix)), []);
});

// ------------------------------------------------------------------ review round 2

test("a timesheet still lists what changed on an invoice with no project: only the project's note leaves it out", () => {
    const rows = [
        { date: "2026-09-17", start: 540, end: 600, minutes: 60, billed: 60, cents: 9500, project: KES, task: "Gone now", note: "" },
        { date: "2026-09-17", start: 660, end: 690, minutes: 30, billed: 30, cents: 9500, project: KES, task: "Sub", note: "" },
    ];
    const inv = { path: "Reference/Invoices/1001-KES.md", props: { status: "paid" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const ix = tr.makeIndex([...VAULT, { path: inv.path, tags: ["invoice"] }], { inSystem: SYSTEM });
    const m = tr.attachBilling(tr.build([day("- [ ] Task [[Kestrel|⭕]]\n\t- 1:00pm - 1:30pm\n\t- [ ] Sub\n\t\t- 11:00am - 11:30am")], ix), [inv], ix, billing);
    const sheet = tr.render(m, { kind: "timesheet", path: KES }, "s", link);
    assert.ok(sheet.includes("has no project that can be read"), sheet);
    assert.ok(sheet.includes("but now it's missing from"), "the row whose entry is gone");
    assert.ok(sheet.includes("now under a nested task, so it isn't counted"), "the row now under a sub-task");
    assert.ok(!problemsIn(tr.render(m, { kind: "project", path: KES }, "s", link)).some((l) => l.includes("was billed")), "not on the project's note");
});

test("an invoice with no project is said once on a parent, though its rows bill the parent and its sub-project", () => {
    const rows = [KES, CAT].map((project, i) => ({ date: "2026-09-17", start: 540 + i * 60, end: 600 + i * 60, minutes: 60, billed: 60, cents: 9500, project, task: "Task", note: "" }));
    const inv = { path: "Reference/Invoices/1001-KES.md", props: { status: "paid" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const ix = tr.makeIndex([...VAULT, { path: inv.path, tags: ["invoice"] }], { inSystem: SYSTEM });
    const m = tr.attachBilling(tr.build([day("- [x] Task [[Kestrel|⭕]]\n\t- 9:00am - 10:00am\n- [x] Other [[Catalog|⭕]]\n\t- 10:00am - 11:00am")], ix), [inv], ix, billing);
    assert.equal(problemsIn(tr.render(m, { kind: "project", path: KES }, "s", link)).filter((l) => l.includes("has no project that can be read")).length, 1);
});

test("a row with a dead link finds its entry on an archived project, or on a line where nothing decides", () => {
    const rows = [{ date: "2026-09-17", start: 540, end: 600, minutes: 60, billed: 60, cents: 7000, project: "Nothing there", task: "Task", note: "" }];
    const inv = { path: "Reference/Invoices/1001-KES.md", props: { status: "paid" }, text: billing.billedLines(rows, tr, (p) => tr.basename(p)).join("\n") };
    const ix = tr.makeIndex([...VAULT, { path: inv.path, tags: ["invoice"] }], { inSystem: SYSTEM });
    const on = (text) => plain(tr.attachBilling(tr.build([day(text)], ix), [inv], ix, billing).projectProblems.filter((p) => p.noProject).map((p) => p.project));
    assert.deepEqual(on("- [x] Task [[Oldco|⭕]]\n\t- 9:00am - 10:00am"), [OLD]);
    assert.deepEqual(on("- [x] Task [[Kestrel|⭕]] [[Pinecrest|⭕]]\n\t- 9:00am - 10:00am"), [KES]);
    assert.deepEqual(on("- [x] Task [[Kestrel|⭕]]\n\t- [ ] Sub\n\t\t- 9:00am - 10:00am"), [KES], "or under a sub-task");
    assert.deepEqual(on("- [x] Task [[Kestrel|⭕]]\n\t- 9:00am - 9:30am"), [], "other times aren't that row's");
});

test("a task line with a ⋯ and no ⭕ is Unassigned and isn't listed: the check that a task's lines name one project passes over it (rule 4)", () => {
    const model = () => ({ problems: [], projectProblems: [], entries: [], billing: null });
    const list = (one, two) => {
        const m = model();
        tr.addTaskProblems(m, index, [{ path: DAY, kind: "day", date: "2026-09-17", text: one }, { path: DAY.replace("17", "18"), kind: "day", date: "2026-09-18", text: two }], TaskIds);
        return plain(m.problems.filter((p) => p.rule === "project").map((p) => p.line));
    };
    assert.deepEqual(list("- [>] Draft [[Kestrel|⭕]] ^abc123", "- [ ] Draft [[Pick fonts|⋯]] ^abc123"), []);
    assert.deepEqual(list("- [>] Draft [[Kestrel|⭕]] ^abc123", "- [ ] Draft [[Imogen|⋯]] ^abc123"), [], "any ⋯: one to a note outside the system");
    assert.deepEqual(list("- [>] Draft [[Kestrel|⭕]] ^abc123", "- [ ] Draft [[Nothing there|⋯]] ^abc123"), [], "or to a note that isn't there");
    assert.deepEqual(list("- [>] Draft [[Kestrel|⭕]] ^abc123", "- [ ] Draft ^abc123"), [1, 1], "with no ⋯, as today: one line counts toward no project while another does");
    assert.deepEqual(list("- [>] Draft [[Kestrel|⭕]] ^abc123", "- [ ] Draft [[Pinecrest|⭕]] ^abc123"), [1, 1], "two projects, as today");
});

test("a `parent` stays off the timesheet and out of Fix first: it changes nothing billed", () => {
    const ix = tr.makeIndex([...VAULT, { path: "Projects/Freelance/Pinecrest/Wrong.md", parent: "[[Kestrel]]" }], { inSystem: SYSTEM });
    const m = tr.attachBilling(tr.build([day("- [x] Task [[Kestrel|⭕]]\n\t- 9:00am - 9:30am")], ix), [], ix, billing);
    tr.addTaskProblems(m, ix, [], TaskIds);
    assert.ok(!tr.render(m, { kind: "timesheet", path: KES }, "s", link).includes("Wrong"));
    const sel = billing.select(m, tr, ix, { project: KES, through: "2026-09-30", ledger: billing.ledger([]) });
    assert.deepEqual(plain(sel.projectProblems.filter((p) => tr.changesBilling(p))), []);
});

test("a disagreement reaches the outer project's note, through a sub-project with no time of its own", () => {
    const ix = tr.makeIndex([...VAULT.filter((n) => n.path !== CAT), { path: CAT, tags: ["project"] }, { path: "Projects/Freelance/Kestrel/Catalog/Shot list.md", tags: ["task"] }], { inSystem: SYSTEM });
    const m = tr.build([day("- [x] Call [[Pinecrest|⭕]] [[Shot list|⋯]]")], ix);
    assert.equal(m.parent.get(CAT), KES, "the note's project is in the model, and so is what's above it");
    assert.ok(tr.render(m, { kind: "project", path: KES }, "s", link).includes("is filed under [[Catalog]]"));
});

test("two ⋯ notes through the report's own check: a ↗ is never a line's note", () => {
    const m = { problems: [], projectProblems: [], entries: [], billing: null };
    const run = (two) => {
        m.problems.length = 0;
        tr.addTaskProblems(m, index, [{ path: DAY, kind: "day", date: "2026-09-17", text: "- [>] Draft [[Kestrel|⭕]] [[Pick fonts|⋯]] ^w2h5nf" }, { path: DAY.replace("17", "18"), kind: "day", date: "2026-09-18", text: two }], TaskIds);
        return plain(m.problems.filter((p) => p.rule === "ownNotes").length);
    };
    assert.equal(run("- [x] Draft [[Kestrel|⭕]] [[2026-09-17 Printer call|↗]] ^w2h5nf"), 0);
    assert.equal(run("- [x] Draft [[Kestrel|⭕]] [[2026-09-17 Printer call|⋯]] ^w2h5nf"), 2);
});

test("a mark on a sub-task in a project note is on the note's project, whatever its own ⭕ names", () => {
    const m = { problems: [], projectProblems: [], entries: [], billing: null };
    tr.addTaskProblems(m, index, [{ path: KES, kind: "other", text: "- [ ] Task\n\t- [ ] Sub [[Pinecrest|⭕]]" }], TaskIds);
    assert.deepEqual(plain(m.projectProblems.filter((p) => p.kind === "subtask").map((p) => p.project)), [KES]);
});
