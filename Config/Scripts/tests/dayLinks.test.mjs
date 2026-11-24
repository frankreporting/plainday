// Tests for OBS-297: the links on a task line that point to a day, a week, a month or a year (a 🚩, a forward
// date, a moved event's day, the date in front of a line sent before task IDs) are read by the note their name
// names, with the vault's formats, and Due date writes the day's note by its real name. The vault here is the
// demo's (its default names) or one whose notes are named DD-MM-YYYY, W39-2026 and 09-2026 (invented). Run from
// the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadClass } from "../../../plugin/classShape.mjs";
import { standIn, withDates, NN, PLANNER } from "./standInVault.mjs";
import { plainName, periodicNames, otherNames } from "./dayNames.mjs";
import { ROOT, loadTimeReport, readVault, planReports } from "./demo/renderReports.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
// The classes as the Raycast timer's sandbox has them: `plainday` empty, no moment
const bare = (file) => loadClass(file, vm.createContext({ plainday: withDates({}) }));
const TaskIds = bare("taskIds.js"), TrailingLinks = bare("trailingLinks.js"), DueDate = bare("setDueDate.js"), AddTaskNote = bare("addTaskNote.js");
const TimeReport = bare("timeReport.js");

// ---------------------------------------------------------------- the reader each rule reads names with

test("the time report's default reads the demo's names, a path's last part, and nothing else", () => {
    assert.deepEqual(plain(plainName("2026-09-17")), { unit: "day", date: "2026-09-17" });
    assert.deepEqual(plain(plainName("Reference/Planner/days/2026-09-17")), { unit: "day", date: "2026-09-17" });
    assert.deepEqual(plain(plainName("2026w39")), { unit: "week", date: "2026-09-20" });
    assert.deepEqual(plain(plainName("2026-09")), { unit: "month", date: "2026-09-01" });
    assert.deepEqual(plain(plainName("2027")), { unit: "year", date: "2027-01-01" });
    for (const name of ["17-09-2026", "W39-2026", "2026-W39", "2026-02-30", "2026w54", "2026-13", "Write brochure copy", ""]) assert.equal(plainName(name), null, name);
});

test("a rule with no reader asks Plainday's, and with neither it says so rather than read a name wrong", () => {
    const line = "- [>] Send final copy [[17-09-2026#^p7d2qe|9/17]] ^p7d2qe";
    assert.throws(() => TaskIds.forwardOf(line), /no reader/);
    assert.throws(() => TrailingLinks.trail(line), /no reader/);
    assert.throws(() => AddTaskNote.runItem("x [[17-09-2026#^p7d2qe|9/17]]"), /no reader/);
    assert.throws(() => new DueDate().placement("- [ ] Book it [[17-09-2026#^p7d2qe|9/17]]", "[[x|🚩 9/30]]"), /no reader/);
    // A line with no date-labelled link never needs one
    assert.equal(TaskIds.forwardOf("- [ ] Book it [[Kestrel|⭕]] ^k3x9m2"), null);
    // Plainday's, asked at the moment the rule runs
    const ctx = vm.createContext({ plainday: { PeriodicNotes: periodicNames(otherNames) } });
    assert.equal(loadClass("taskIds.js", ctx).forwardOf(line)?.label, "9/17");
    // The time report, outside a run: Plainday's, else its default (the Raycast timer)
    assert.equal(new TimeReport().reader(), TimeReport.plainName);
    const tr = new (loadClass("timeReport.js", vm.createContext({ plainday: { PeriodicNotes: periodicNames(otherNames) } })))();
    assert.equal(tr.reader(), otherNames);
});

// ---------------------------------------------------------------- forward dates

test("forward dates are read by their names: the vault's own, by name or path, never another spelling", () => {
    const fwd = (link, read) => TaskIds.forwardOf(`- [>] Send final copy ${link} [[Pinecrest|⭕]] ^p7d2qe`, read);
    for (const [link, linkpath, label] of [
        ["[[17-09-2026#^p7d2qe|9/17]]", "17-09-2026", "9/17"],
        ["[[Reference/Planner/days/17-09-2026#^p7d2qe|9/17]]", "Reference/Planner/days/17-09-2026", "9/17"],
        ["[[W39-2026#^p7d2qe|Wk of 9/20]]", "W39-2026", "Wk of 9/20"],
        ["[[09-2026#^p7d2qe|Sep. 2026]]", "09-2026", "Sep. 2026"],
    ]) {
        assert.deepEqual(plain(fwd(link, otherNames)), { raw: link, linkpath, id: "p7d2qe", label }, link);
        assert.equal(fwd(link, plainName), null, `${link}: no note of the demo's`);
    }
    assert.equal(fwd("[[2026-09-17#^p7d2qe|9/17]]", otherNames), null, "the demo's spelling, in a vault that names days otherwise");
    assert.equal(fwd("[[2026-09-17#^p7d2qe|9/17]]", plainName)?.label, "9/17");
    // The run around it is read the same: a 🚩 goes ahead of it and the ⭕ is still found
    const line = "- [>] Send final copy [[17-09-2026#^p7d2qe|9/17]] [[Pinecrest|⭕]] ^p7d2qe";
    assert.deepEqual(plain(TaskIds.splitRun(line, otherNames)), { text: "- [>] Send final copy", items: ["[[17-09-2026#^p7d2qe|9/17]]", "[[Pinecrest|⭕]]"] });
    assert.equal(TaskIds.withForward(line, "[[18-09-2026#^p7d2qe|9/18]]", otherNames), "- [>] Send final copy [[18-09-2026#^p7d2qe|9/18]] [[Pinecrest|⭕]] ^p7d2qe", "replaced, never doubled");
    assert.deepEqual(plain(AddTaskNote.runItem("x [[17-09-2026#^p7d2qe|9/17]]", otherNames)?.[0]), " [[17-09-2026#^p7d2qe|9/17]]");
    assert.equal(AddTaskNote.runItem("x [[Write brochure copy#^r3v1sn|9/16]]", otherNames), null, "a date label on a block link to any other note");
});

test("a line sent before task IDs: the date in front is read by its name", () => {
    const line = "- [>] [[14-09-2026|9/14]] Book the venue [[Kestrel|⭕]]";
    assert.deepEqual(plain(TaskIds.oldForward(line, otherNames)), { linkpath: "14-09-2026", label: "9/14", line: "- [>] Book the venue [[Kestrel|⭕]]" });
    assert.equal(TaskIds.oldForward(line, plainName), null);
    assert.equal(TaskIds.oldForward("- [>] [[Kestrel brief|brief]] Book the venue", otherNames), null, "a link to any other note is the title's");
});

test("the editor draws a forward date in the vault's names as a date pill, and a passed 🚩 red", () => {
    const kinds = (text, read) => plain(TrailingLinks.trail(text, read)?.links.map((l) => l.kind) ?? []);
    const line = "- [>] Send final copy [[17-09-2026#^p7d2qe|9/17]] ^p7d2qe";
    assert.deepEqual(kinds(line, otherNames), ["forward"]);
    assert.deepEqual(kinds(line, plainName), [], "a plain link, in the demo's names");
    assert.deepEqual(kinds("- [ ] Draft wireframes [[18-09-2026|🚩 9/18]] [[W39-2026#^h2k8dm|Wk of 9/20]]", otherNames), ["due", "forward"]);
    assert.equal(TrailingLinks.overdue("18-09-2026", "2026-09-20", otherNames), true);
    assert.equal(TrailingLinks.overdue("Reference/Planner/days/18-09-2026", "2026-09-20", otherNames), true, "by its path");
    assert.equal(TrailingLinks.overdue("18-09-2026", "2026-09-18", otherNames), false, "today isn't passed");
    assert.equal(TrailingLinks.overdue("2026-09-18", "2026-09-20", otherNames), false, "the old spelling names no note now");
    assert.equal(TrailingLinks.overdue("Launch plan", "2026-09-20", otherNames), false);
    assert.equal(TrailingLinks.textEnd(line, otherNames), "- [>] Send final copy".length);
});

// ---------------------------------------------------------------- Due date

test("Due date: the 🚩 goes ahead of a forward date in the vault's names, and replaces the 🚩 the line has, old spelling or new", () => {
    const due = new DueDate();
    const placed = (line, link) => { const c = due.placement(line, link, otherNames); return line.slice(0, c.from) + c.text + line.slice(c.to); };
    const L = "[[25-09-2026|🚩 9/25]]";
    assert.equal(placed("- [>] Send final copy [[17-09-2026#^p7d2qe|9/17]] ^p7d2qe", L), `- [>] Send final copy ${L} [[17-09-2026#^p7d2qe|9/17]] ^p7d2qe`);
    assert.equal(placed("- [ ] Draft wireframes [[18-09-2026|🚩 9/18]] [[Kestrel|⭕]] ^h2k8dm", L), `- [ ] Draft wireframes ${L} [[Kestrel|⭕]] ^h2k8dm`);
    assert.equal(placed("- [ ] Renew registration [[2026-09-30|🚩 9/30]] ^r4n2wq", L), `- [ ] Renew registration ${L} ^r4n2wq`, "a 🚩 from before the format changed");
    assert.equal(placed("- [ ] Recap [[Launch plan|🚩 launch]]", L), `- [ ] Recap [[Launch plan|🚩 launch]] ${L} `, "a 🚩 with words is no deadline");
    assert.equal(placed("- [ ] Recap [[Write brochure copy#^r3v1sn|9/16]] ^r3v1sn", L), `- [ ] Recap [[Write brochure copy#^r3v1sn|9/16]] ${L} ^r3v1sn`, "a date label on a block link to another note is text");
    assert.equal(DueDate.link({ format: (f) => (f === "YYYY-MM-DD" ? "2026-09-25" : "?") }, "25-09-2026"), L);
});

const DD = { ...NN, calendarIntegrationMode: "notebook-navigator", calendarCustomFilePattern: "[days]/DD-MM-YYYY" };
const day = (d) => `${PLANNER}/days/${d}.md`;

test("Due date in a vault whose daily notes are named DD-MM-YYYY: the day's note by its real name, every line of the task", async () => {
    const v = standIn({
        nn: DD,
        notes: {
            "Projects/Kestrel/Kestrel.md": "---\ntags: [project]\n---\n",
            [day("14-09-2026")]: "- [>] Draft wireframes [[18-09-2026|🚩 9/18]] [[Kestrel|⭕]] ^h2k8dm\n",
            [day("15-09-2026")]: "- [ ] Draft wireframes [[18-09-2026|🚩 9/18]] [[Kestrel|⭕]] ^h2k8dm\n",
            "Projects/Kestrel/Send final copy.md": "---\ntags: [task]\n---\n- [>] Send final copy [[17-09-2026#^p7d2qe|9/17]] ^p7d2qe\n",
        },
    });
    const run = async (path, text, date) => { v.open(path, v.lineOf(path, text)); await v.dueDate(date); };
    await run(day("15-09-2026"), "Draft wireframes", "2026-09-21");
    assert.equal(v.notes()[day("15-09-2026")], "- [ ] Draft wireframes [[21-09-2026|🚩 9/21]] [[Kestrel|⭕]] ^h2k8dm\n", "one 🚩, replaced");
    assert.equal(v.notes()[day("14-09-2026")], "- [>] Draft wireframes [[21-09-2026|🚩 9/21]] [[Kestrel|⭕]] ^h2k8dm\n", "the task's other line too");
    await run("Projects/Kestrel/Send final copy.md", "Send final copy", "2026-09-25");
    assert.equal(v.notes()["Projects/Kestrel/Send final copy.md"].split("\n")[3], "- [>] Send final copy [[25-09-2026|🚩 9/25]] [[17-09-2026#^p7d2qe|9/17]] ^p7d2qe", "ahead of the forward date");
});

test("Due date links the day by its path when another note has the day's name, as Schedule links one", async () => {
    const v = standIn({ nn: DD, notes: { [day("15-09-2026")]: "- [ ] Draft wireframes\n", "Archive/30-09-2026.md": "An old note of that name.\n" } });
    v.open(day("15-09-2026"), 0);
    await v.dueDate("2026-09-30");
    assert.equal(v.notes()[day("15-09-2026")], `- [ ] Draft wireframes [[${PLANNER}/days/30-09-2026|🚩 9/30]] \n`);
});

// ---------------------------------------------------------------- what the time report reads

test("a moved event is an event whatever its day's link: Due date and Add note refuse it", () => {
    const tr = new TimeReport();
    for (const link of ["[[20-09-2026|9/20]]", "[[Reference/Planner/days/20-09-2026|9/20]]", "[[2026-09-20|9/20]]"]) {
        const line = `- [>] ${link} 1:00pm\tPlanning call`;
        assert.equal(tr.eventKind(line), "forwarded", link);
        assert.equal(tr.topOf([line], 0).event, "forwarded");
        assert.equal(TaskIds.isEvent(line), true);
        assert.equal(tr.taskText(tr.classify(line).body), "Planning call");
    }
    assert.equal(tr.eventKind("- [>] [[Kestrel brief|brief]] Book the venue"), null, "a link and no time: a task");
});

test("a task's text drops its forward date by its name; the timer's dropdown, with no reader, by its shape", () => {
    const line = "- [>] Category page templates [[W39-2026#^c7t2pq|Wk of 9/20]] [[Kestrel Outfitters 2026|⭕]] ^c7t2pq";
    const tr = new (loadClass("timeReport.js", vm.createContext({ plainday: { PeriodicNotes: periodicNames(otherNames) } })))();
    assert.equal(tr.taskText(tr.classify(line).body), "Category page templates");
    assert.equal(new TimeReport().taskText(new TimeReport().classify(line).body), "Category page templates Wk of 9/20", "a block link to no periodic note is text");
    // The Raycast timer loads timeReport.js alone: no Plainday, no moment
    const sandboxed = new (loadClass("timeReport.js", vm.createContext({ plainday: {} })))();
    assert.equal(sandboxed.itemLabel(line), "Category page templates ⭕");
    assert.equal(sandboxed.itemLabel("- [ ] Follow up on [[2026-09-15#^abc123|the call]] ^q1w2e3"), "Follow up on the call", "a block link with words stays");
});

test("a 🚩 in the vault's names is a deadline the report compares with its task note's `due`", () => {
    const tr = new (loadClass("timeReport.js", vm.createContext({ plainday: { PeriodicNotes: periodicNames(otherNames) } })))();
    const links = tr.lineLinks("[ ] Draft wireframes [[18-09-2026|🚩 9/18]] [[W39-2026#^h2k8dm|Wk of 9/20]] [[Kestrel|⭕]]");
    assert.deepEqual(plain(links.due), [{ target: "18-09-2026", alias: "🚩 9/18" }]);
    assert.deepEqual(plain(links.marks), [{ target: "Kestrel", alias: "⭕" }], "the forward date between them is part of the run");
    assert.equal(tr.isDateLink("18-09-2026"), true);
    assert.equal(tr.isDateLink("2026-09-18"), false);
});

// ---------------------------------------------------------------- a label that shows another day

test("labelDay: the month and day a label shows, in the date format set now (OBS-309)", () => {
    const read = (label, format) => { const r = TimeReport.labelDay(label, format); return r && `${r.month}/${r.day} ${r.shows}`; };
    // Without Plainday's settings, M/D
    for (const [label, shows] of [["🚩 9/19", "9/19 9/19"], ["🚩" + String.fromCharCode(0xfe0f) + " 9/19", "9/19 9/19"], ["9/16", "9/16 9/16"], ["Thu 9/17", "9/17 9/17"], ["9/17/26", "9/17 9/17/26"], ["09/07", "9/7 09/07"]]) assert.equal(read(label), shows, label);
    for (const label of ["Wk of 9/20", "Sep. 2026", "2027", "brief", "🚩 launch", "2026-09-18", "13/1", "18.9."]) assert.equal(read(label), null, label);
    // Day first, with dots, a trailing dot and a year: the label as written is what a Problem quotes
    for (const [label, shows] of [["🚩 30.9.", "9/30 30.9."], ["Thu 17.9.", "9/17 17.9."], ["17.9.26", "9/17 17.9.26"], ["17.9", "9/17 17.9"], ["01.10.2026", "10/1 01.10.2026"]]) assert.equal(read(label, "D.M."), shows, label);
    // A label in another format isn't read, and neither is one whose month can't be one
    for (const label of ["9/30", "Fri 9/11", "17-9"]) assert.equal(read(label, "D.M."), null, label);
    assert.equal(read("Fri 9/11", "D/M"), "11/9 9/11", "an old M/D label reads the other way round under D/M");
    assert.equal(read("9/30", "D/M"), null, "30 isn't a month");
    assert.equal(read("17-09", "DD-MM"), "9/17 17-09");
    assert.equal(read("9.17.", "M.D."), "9/17 9.17.");
});

test("a day link whose label shows another day still reads by its name, and is listed to be fixed", () => {
    const tr = new (loadClass("timeReport.js", vm.createContext({ plainday: { PeriodicNotes: periodicNames(otherNames) } })))();
    const notes = [
        { path: day("15-09-2026"), kind: "day", date: "2026-09-15", text: "- [ ] Draft wireframes [[18-09-2026|🚩 9/19]] [[Kestrel|⭕]] ^h2k8dm\n- [ ] Book the venue [[30-09-2026|🚩 9/30]]" },
        { path: "Projects/Pinecrest/Write brochure copy.md", kind: "other", text: "- [>] Send final copy [[17-09-2026#^p7d2qe|9/16]] ^p7d2qe\n- [>] [[14-09-2026|9/13]] Old line [[Pinecrest|⭕]]\n- [>] [[W39-2026#^c7t2pq|Wk of 9/27]] Week" },
    ];
    const found = plain(tr.dayLabelProblems(notes, TaskIds)).map((l) => `${l.path.split("/").pop()}:${l.line} ${l.link} ${l.shows} ${l.date}`);
    assert.deepEqual(found, ["15-09-2026.md:0 due 9/19 2026-09-18", "Write brochure copy.md:0 forward 9/16 2026-09-17", "Write brochure copy.md:1 sent 9/13 2026-09-14"]);
    assert.equal(tr.dayLabelText({ link: "due", shows: "9/19", date: "2026-09-18" }), "has a 🚩 labeled 9/19 that links the daily note for 9/18/26, the date Plainday reads: run DueDate on the line to set its deadline again");
    assert.equal(tr.dayLabelText({ link: "forward", shows: "9/16", date: "2026-09-17" }), "has a forward date labeled 9/16 that links the daily note for 9/17/26, the date Plainday reads: fix its label or its link by hand");
    // It still counts on the day its name says
    assert.deepEqual(plain(tr.lineLinks("[ ] Draft wireframes [[18-09-2026|🚩 9/19]]").due), [{ target: "18-09-2026", alias: "🚩 9/19" }]);
});

test("in the demo: none as committed, and a 🚩 and a forward date relabelled are each listed once, on their projects", () => {
    const problems = (edit = {}) => {
        const vault = readVault(ROOT);
        for (const [p, [from, to]] of Object.entries(edit)) {
            const n = vault.notes.get(p);
            assert.ok(n.text.includes(from), `${p}: ${from}`);
            vault.notes.set(p, { ...n, text: n.text.replace(from, to) });
        }
        const { model } = planReports(loadTimeReport(), vault);
        return [...model.problems, ...model.projectProblems].filter((p) => p.rule === "dayLabel");
    };
    assert.deepEqual(problems(), []);
    const found = problems({
        [`${PLANNER}/days/2026-09-15.md`]: ["[[2026-09-18|🚩 9/18]]", "[[2026-09-18|🚩 9/19]]"],
        "Projects/Freelance/Pinecrest Library Brochure/Write brochure copy.md": ["[[2026-09-17#^p7d2qe|9/17]]", "[[2026-09-17#^p7d2qe|9/16]]"],
    });
    assert.deepEqual(found.map((p) => `${(p.project ?? p.path).split("/").pop()} ${p.path.split("/").pop()}`).sort(), [
        "2026-09-15.md 2026-09-15.md",
        "Pinecrest Library Brochure.md Write brochure copy.md",
    ]);
});
