// Tests for OBS-298: the reports, the timesheets, an invoice's date rows and the Problems about billed time link a
// day by its daily note's real name, and an invoice's date rows are read back by it. The vault here is the demo's
// (the default names, YYYY-MM-DD) or a stand-in whose daily notes are named DD-MM-YYYY (invented). Every project,
// invoice, amount and entry is invented. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadClass } from "../../../plugin/classShape.mjs";
import { compactTable } from "./tables.mjs";
import { otherNames } from "./dayNames.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
const DAYS = "Reference/Planner/days";
const WEB = "Projects/Work/Harbor Web/Harbor Web.md";
const INV = "Projects/Work/Harbor Web/invoices";
const dmy = (date) => `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;

// A vault whose daily notes are named DD-MM-YYYY: Plainday's naming (PeriodicNotes.where) and reader stand in,
// with the vault's notes, `files`
const otherVault = (files = []) => {
    const all = files.map((path) => ({ path, basename: path.split("/").pop().replace(/\.md$/, "") }));
    let counted = 0;
    const PeriodicNotes = {
        reader: () => otherNames,
        where: (unit, date) => ({ unit, date, name: dmy(date), path: `${DAYS}/${dmy(date)}.md` }),
    };
    const app = { vault: { getMarkdownFiles: () => { counted++; return all; }, getFileByPath: (p) => all.find((f) => f.path === p) ?? null } };
    const TimeReport = loadClass("timeReport.js", vm.createContext({ plainday: { PeriodicNotes }, app }));
    return { tr: new TimeReport(), counted: () => counted };
};
const demo = new (loadClass("timeReport.js", vm.createContext({})))();
const { tr: other } = otherVault([`${DAYS}/01-09-2026.md`, `${DAYS}/02-09-2026.md`, WEB]);
const billing = new (loadClass("billing.js", vm.createContext({})))();
const Invoice = loadClass("invoice.js", vm.createContext({}));

const index = demo.makeIndex([{ path: WEB, tags: ["project"], props: { rate: 80, rate_type: "hourly" } }]);
const ROWS = [
    { date: "2026-09-01", start: 780, end: 870, minutes: 90, billed: 90, cents: 8000, project: WEB, task: "Site map", note: "first pass" },
    { date: "2026-09-02", start: 540, end: 590, minutes: 50, billed: 60, cents: 8000, project: WEB, task: "Build pages", note: "" },
    { date: "2026-09-03", start: 1350, end: 1515, minutes: 165, billed: 165, cents: 8000, project: WEB, task: "Late night fix", note: "" },
];
const name = (p) => demo.basename(p);
const section = (tr, rows = ROWS) => billing.billedLines(rows, tr, name);
const invoice = (lines, props = {}) => ({
    path: `${INV}/1001-HBR.md`,
    props: { invoice_status: "sent", number: "1001-HBR", parent: "[[Harbor Web]]", hours: 5.25, total: 420, ...props },
    text: ["---", "---", "# Invoice No. 1001-HBR", "", ...lines].join("\n"),
});
const keys = (read) => plain(read.rows.map((r) => billing.key(r)));
const KEYS = ["2026-09-01 780 870", "2026-09-02 540 590", "2026-09-03 1350 1515"];

// ---------------------------------------------------------------- the link a day is written with

test("dayLinks: the day note's real name, its path when another note has that name, and the date itself without Plainday", () => {
    assert.equal(demo.dayLinks()("2026-09-11"), "2026-09-11", "the demo render and the Raycast timer: the default");
    const { tr, counted } = otherVault([`${DAYS}/11-09-2026.md`, "Projects/Work/Harbor Web/12-09-2026.md", WEB]);
    const day = tr.dayLinks();
    assert.equal(day("2026-09-11"), "11-09-2026");
    assert.equal(day("2026-09-12"), `${DAYS}/12-09-2026`, "another note has that name, so the link can't land on it");
    assert.equal(day("2026-09-13"), "13-09-2026", "a day with no note yet: its name, which makes it when clicked");
    assert.equal(counted(), 1, "the vault's names are counted once for all of a writer's links");
    // A run's namer serves every writer in the run
    tr.runName = day;
    assert.equal(tr.dayLinks(), day);
});

test("the weekly report's columns, a timesheet's day rows and the Problems link the days' real names", () => {
    const model = other.build([{ date: "2026-09-14", path: `${DAYS}/14-09-2026.md`, text: "- [x] Pages [[Harbor Web|⭕]]\n\t- 9:00am - 10:00am" }], index);
    // The week of 9/13 (the default week rules, English Sunday weeks)
    const grid = compactTable(other.weekDaysTable(model, model.entries, { kind: "period", unit: "week", key: "2026w38" }, (p) => `[[${name(p)}]]`));
    assert.match(grid[0], /\[\[13-09-2026\\\|Sun 9\/13\]\] \| \[\[14-09-2026\\\|Mon 9\/14\]\] .* \[\[19-09-2026\\\|Sat 9\/19\]\]/);
    const sheet = compactTable(other.sheet(model, model.entries, { project: false, link: (p) => `[[${name(p)}]]` }));
    assert.ok(sheet.some((l) => l.includes("**[[14-09-2026\\|Mon 9/14]]**")), sheet.join("\n"));
    const lines = other.problemLines(model, [{ date: "2026-09-16", line: 12, text: "- 2:30 - 3:45pm", message: "doesn't match" }], [], [], (p) => `[[${name(p)}]]`);
    assert.deepEqual(plain(lines), ["- [[16-09-2026|9/16/26]] line 12: `- 2:30 - 3:45pm` doesn't match"]);
    const conflict = other.conflictLine({ kind: "day", date: "2026-09-16", line: 4, text: "- [ ] Two", links: [WEB, WEB] }, (p) => `[[${name(p)}]]`, (t) => t);
    assert.match(conflict, /^- \[\[16-09-2026\|9\/16\/26\]\] line 4:/);
    // The demo's names, as before
    assert.deepEqual(plain(demo.problemLines(model, [{ date: "2026-09-16", line: 12, text: "x", message: "m" }], [], [], name)), ["- [[2026-09-16|9/16/26]] line 12: `x` m"]);
});

test("a Problem about billed time links the days' real names: the change, an overlap on another day, a missing row", () => {
    const link = (p) => `[[${name(p)}]]`;
    const row = { date: "2026-09-11", start: 780, end: 870, task: "Pages", note: "" };
    const inv = { name: "1001-HBR", status: "paid", paid: "2026-09-15" };
    assert.equal(other.invoiceProblem({ invoice: inv, change: { row, kind: "times", entry: { date: "2026-09-11", start: 780, end: 885 } } }, link),
        "- [[1001-HBR]] (paid 9/15): [[11-09-2026|9/11/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm");
    assert.match(other.invoiceProblem({ invoice: inv, change: { row, kind: "overlap", entry: { date: "2026-09-12", start: 0, end: 60 } } }, link), /and \[\[12-09-2026\|9\/12\/26\]\] 12:00am - 1:00am overlaps it/);
    assert.match(other.invoiceProblem({ invoice: inv, change: { row, kind: "gone" } }, link), /missing from \[\[11-09-2026\|the daily note\]\]/);
    assert.equal(other.invoiceProblem({ twice: { row, invoices: [inv, { name: "1002-HBR" }] } }, link), "- [[11-09-2026|9/11/26]] 1:00pm - 2:30pm is billed on both [[1001-HBR]] and [[1002-HBR]]");
});

test("a task Problem naming a daily note's line shows its day, read by the note's name", () => {
    const lines = [{ path: `${DAYS}/16-09-2026.md`, line: 3 }, { path: "Projects/Work/Harbor Web/Pages.md", line: 5 }];
    other.runRead = otherNames;
    try {
        assert.match(other.taskProblemText({ rule: "notes", id: "abc123", lines, detail: {} }, lines[1]), /^is also at \[\[16-09-2026\|9\/16\/26\]\] line 4,/);
    } finally {
        other.runRead = null;
    }
    assert.equal(other.dailyDate(`${DAYS}/16-09-2026.md`), "2026-09-16");
    assert.equal(demo.dailyDate(`${DAYS}/2026-09-16.md`), "2026-09-16");
});

test("Invoice's check block and its Fix first? and Held back lines link the days' real names", () => {
    const inv = new Invoice();
    const row = { ...ROWS[0] };
    assert.deepEqual(plain(inv.changeItems({ changes: [{ row, kind: "times", entry: { date: "2026-09-01", start: 780, end: 885 } }, { row, kind: "gone" }], late: [{ date: "2026-09-02", start: 900, end: 960, task: "Extra" }] }, other)), [
        "[[01-09-2026|9/1/26]] 1:00pm - 2:30pm was billed, now 1:00pm - 2:45pm",
        "9/1/26 1:00pm - 2:30pm `Site map: first pass` was billed, but now it's missing from [[01-09-2026|the daily note]]; put it back there to settle it",
        "Logged in this period after the invoice, not billed: [[02-09-2026|9/2/26]] 3:00pm - 4:00pm Extra",
    ]);
    const invoice = { name: "1001-HBR", status: "paid", paid: "2026-09-15", project: WEB };
    const sel = {
        problems: [{ date: "2026-09-03", line: 4, text: "- 2:00pm - ", message: "clock still running" }],
        changed: [{ invoice, change: { row, kind: "times" } }, { invoice, change: { row, kind: "gone" } }],
        heldBack: [{ entry: { date: "2026-09-01", start: 780, end: 885 }, invoice: { name: "1001-HBR" }, row, why: "changed" }],
        scope: new Set([WEB]),
    };
    assert.deepEqual(plain(inv.beforeSendingItems(sel, other)), [
        "[[03-09-2026|9/3/26]] line 4: `- 2:00pm - ` clock still running",
        "[[01-09-2026|9/1/26]] 1:00pm - 2:30pm on [[1001-HBR]] changed since it was billed (times)",
        "[[1001-HBR]] (paid 9/15): 9/1/26 1:00pm - 2:30pm `Site map: first pass` was billed, but now it's missing from [[01-09-2026|the daily note]]; put it back there to settle it",
        "Held back: [[01-09-2026|9/1/26]] 1:00pm - 2:45pm overlaps 1:00pm - 2:30pm, billed on [[1001-HBR]]",
    ]);
});

// ---------------------------------------------------------------- an invoice's date rows, written and read back

test("an invoice's date rows link the days' real names, and read back by them", () => {
    const lines = section(other);
    assert.deepEqual(plain(compactTable(lines.slice(2)).filter((l) => l.includes("**[[")).map((l) => l.split(" | ")[0])), [
        "| **[[01-09-2026\\|Tue 9/1]]**", "| **[[02-09-2026\\|Wed 9/2]]**", "| **[[03-09-2026\\|Thu 9/3]]**",
    ]);
    const read = billing.readInvoice(invoice(lines), other, index);
    assert.deepEqual(keys(read), KEYS);
    assert.equal(read.problem, null);
    // The demo's spelling, and the demo's reader, as before
    assert.equal(billing.readInvoice(invoice(section(demo)), demo, index).problem, null);
});

test("a date row whose link isn't a day's name doesn't read: rows left in the old spelling make the invoice a Problem", () => {
    // The demo's spelling, in a vault whose daily notes are named DD-MM-YYYY
    const all = billing.readInvoice(invoice(section(demo)), other, index);
    assert.match(all.problem, /^has 6 Billed entries rows that don't read$/);
    assert.deepEqual(keys(all), [], "nothing billed under a row that doesn't start a day");
    // One row left in the old spelling, the rest renamed: it doesn't read, as a row without a date doesn't
    const lines = section(other);
    const at = lines.findIndex((l) => l.includes("[[02-09-2026"));
    lines[at] = lines[at].replace("02-09-2026", "2026-09-02");
    const one = billing.readInvoice(invoice(lines), other, index);
    assert.equal(one.problem, "has a Billed entries row that doesn't read");
    assert.deepEqual(plain(one.bad.map((b) => b.line)), [at + 5]);
    // In the demo, a row naming a note that isn't a day's
    const named = section(demo);
    named[named.findIndex((l) => l.includes("[[2026-09-03"))] = named.find((l) => l.includes("[[2026-09-03")).replace("2026-09-03", "Harbor Web");
    assert.equal(billing.readInvoice(invoice(named), demo, index).problem, "has a Billed entries row that doesn't read");
});

test("a date row whose label shows another day counts on its link's day, and the invoice is a Problem that says so", () => {
    const lines = section(demo);
    const at = lines.findIndex((l) => l.includes("[[2026-09-03"));
    lines[at] = lines[at].replace("[[2026-09-03", "[[2026-09-04");
    const read = billing.readInvoice(invoice(lines), demo, index);
    assert.deepEqual(keys(read), [...KEYS.slice(0, 2), "2026-09-04 1350 1515"], "its entries are billed on 9/4, the day it links");
    assert.deepEqual(plain(read.labeled.map((l) => [l.line, l.date, l.shows])), [[at + 5, "2026-09-04", "9/3"]]);
    assert.deepEqual(plain(read.bad), []);
    assert.equal(read.problem, "has a Billed entries row labeled 9/3 that links the daily note for 9/4/26, the date Plainday reads");
    // In the report, and in Invoice's refusal
    assert.equal(demo.invoiceProblem({ invoice: read, problem: read.problem }, (p) => `[[${name(p)}]]`),
        "- [[1001-HBR]] has a Billed entries row labeled 9/3 that links the daily note for 9/4/26, the date Plainday reads, so this project can't be invoiced until it's fixed");
    const model = demo.build([], index);
    const sel = billing.select(model, demo, index, { project: WEB, through: "2026-09-30", ledger: billing.ledger([{ ...read, project: WEB }]) });
    assert.deepEqual(plain(sel.bad.map((b) => b.problem)), [read.problem]);
    // Two of them
    lines[lines.findIndex((l) => l.includes("[[2026-09-01"))] = lines.find((l) => l.includes("[[2026-09-01")).replace("Tue 9/1", "Tue 8/31");
    assert.equal(billing.readInvoice(invoice(lines), demo, index).problem,
        "has 2 Billed entries rows labeled with another day than the daily note they link, the first labeled 8/31 that links the daily note for 9/1/26, the date Plainday reads");
    // In a vault whose names are DD-MM-YYYY, the same
    const renamed = section(other);
    renamed[renamed.findIndex((l) => l.includes("[[03-09-2026"))] = renamed.find((l) => l.includes("[[03-09-2026")).replace("03-09-2026", "04-09-2026");
    assert.match(billing.readInvoice(invoice(renamed), other, index).problem, /labeled 9\/3 that links the daily note for 9\/4\/26/);
});

test("a date row with no label, a label without a month and day, or a path reads by its link with no Problem", () => {
    for (const [from, to] of [
        ["[[2026-09-03\\|Thu 9/3]]", "[[2026-09-03]]"],
        ["Thu 9/3", "Thursday"],
        ["[[2026-09-03", `[[${DAYS}/2026-09-03`],
    ]) {
        const lines = section(demo);
        const at = lines.findIndex((l) => l.includes("[[2026-09-03"));
        lines[at] = lines[at].replace(from, to);
        const read = billing.readInvoice(invoice(lines), demo, index);
        assert.deepEqual(keys(read), KEYS, to);
        assert.equal(read.problem, null, to);
    }
});

test("the old callout's rows read by their link's name, and a label that shows another day is flagged there too", () => {
    const callout = (first) => [
        "> [!pm-billed]- Billed entries",
        "> | Date | Start | End | Minutes | Hours | Rate | Project | Task | Note |",
        "> | --- | --- | --- | --: | --: | --: | --- | --- | --- |",
        `> | ${first} | 1:00pm | 2:30pm | 90 | 1.50 | 80.00 | [[Harbor Web]] | Site map | first pass |`,
    ];
    const props = { hours: 1.5, total: 120 };
    assert.equal(billing.readInvoice(invoice(callout("[[2026-09-01\\|9/1/26]]"), props), demo, index).problem, null);
    assert.deepEqual(keys(billing.readInvoice(invoice(callout("[[01-09-2026\\|9/1/26]]"), props), other, index)), [KEYS[0]]);
    const labeled = billing.readInvoice(invoice(callout("[[2026-09-02\\|9/1/26]]"), props), demo, index);
    assert.deepEqual(keys(labeled), ["2026-09-02 780 870"]);
    assert.match(labeled.problem, /labeled 9\/1\/26 that links the daily note for 9\/2\/26/);
    assert.match(billing.readInvoice(invoice(callout("[[2026-09-01\\|9/1/26]]"), props), other, index).problem, /a Billed entries row that doesn't read/);
});
