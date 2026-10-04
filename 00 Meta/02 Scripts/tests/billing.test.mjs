// Tests for CustomJS/billing.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
// The class is loaded with vm, the way CustomJS evaluates it, next to TimeReport, whose parser and
// model it reads. Every project, client, amount and entry here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8") + `\n;${name}`, vm.createContext({}));
const TimeReport = load("timeReport.js", "TimeReport");
const Billing = load("billing.js", "Billing");
const tr = new TimeReport();
const billing = new Billing();
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

const DAYS = "30 Reference/36 Planner/days";
const WEB = "Projects/Work/Harbor Web/Harbor Web.md";                     // hourly $80, sub-projects on
const PHOTO = "Projects/Work/Harbor Web/Harbor Photos/Harbor Photos.md";   // sub-project, its own $100
const FLAT = "Projects/Work/Harbor Web/Harbor Print/Harbor Print.md";      // sub-project, flat fee
const OTHER = "Projects/Work/Dune Books/Dune Books.md";                    // hourly $60, billed through 9/1
const INV = "Projects/Work/Harbor Web/invoices";
const NOTES_INDEX = [
    { path: WEB, tags: ["project"], props: { rate: 80, rate_type: "hourly", include_subprojects: true, max_hours: 3, client: "[[Harbor Co]]" } },
    { path: PHOTO, tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
    { path: FLAT, tags: ["project"], props: { rate: 500, rate_type: "flat" } },
    { path: OTHER, tags: ["project"], props: { rate: 60, rate_type: "hourly", billed_through: "2026-09-01" } },
    { path: "30 Reference/34 Entities/Harbor Co.md", tags: [], props: { code: "HBR" } },
];
const index = tr.makeIndex(NOTES_INDEX);
const day = (date, text) => ({ date, path: `${DAYS}/${date}.md`, text });
const NOTES = [
    day("2026-09-01", "- [x] Old work [[Dune Books|⭕]]\n\t- 9:00am - 10:00am\n- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass"),
    day("2026-09-02", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am\n\t- 10:00am - 10:20am: 🆓 my typo\n- [x] Shoot [[Harbor Photos|⭕]]\n\t- 1:00pm - 2:00pm\n- [x] Print proof [[Harbor Print|⭕]]\n\t- 3:00pm - 4:00pm\n- [x] Dune pages [[Dune Books|⭕]]\n\t- 4:00pm - 4:30pm"),
    day("2026-09-03", "- [x] Late night fix [[Harbor Web|⭕]]\n\t- 10:30pm - 1:15am\n- [/] Running [[Harbor Web|⭕]]\n\t- 2:00pm - "),
];
const model = tr.build(NOTES, index);
const entry = (m, date, startText, project = WEB) => m.entries.find((e) => e.date === date && tr.formatTime(e.start) === startText && e.project === project);
const name = (p) => tr.basename(p);
const invoiceNote = (number, status, rows, props = {}) => ({
    path: `${INV}/${number}.md`,
    props: { status, number, project: "[[Harbor Web]]", period_start: "2026-09-01", period_end: "2026-09-02", ...props },
    text: ["---", "---", `# Invoice No. ${number}`, "", ...billing.billedLines(rows, tr, name)].join("\n"),
});
const read = (note) => billing.readInvoice(note, tr, index);
const emptyLedger = () => billing.ledger([]);

// ------------------------------------------------------------------ keys and dates

test("key: the daily note's date and the start and end in minutes, past 1440 across midnight", () => {
    assert.equal(billing.key(entry(model, "2026-09-01", "1:00pm")), "2026-09-01 780 870");
    assert.equal(billing.key(entry(model, "2026-09-03", "10:30pm")), "2026-09-03 1350 1515");
});

test("isoDate: a real day as YYYY-MM-DD, else null", () => {
    assert.equal(billing.isoDate("2026-09-02"), "2026-09-02");
    assert.equal(billing.isoDate(" 2026-09-02T09:30 "), "2026-09-02");
    assert.equal(billing.isoDate("2026-02-30"), null);
    assert.equal(billing.isoDate("9/2/26"), null);
    assert.equal(billing.isoDate(""), null);
    assert.equal(billing.isoDate(null), null);
});

test("truthy: a checkbox, or yes/true typed by hand", () => {
    for (const v of [true, "true", "True", "yes"]) assert.equal(billing.truthy(v), true, String(v));
    for (const v of [false, "false", "", null, undefined, "no", 1]) assert.equal(billing.truthy(v), false, String(v));
});

// ------------------------------------------------------------------ the Billed entries table

const ROWS = () => billing.snapshot([entry(model, "2026-09-01", "1:00pm"), entry(model, "2026-09-02", "9:00am"), entry(model, "2026-09-03", "10:30pm")], model, tr);

test("snapshot: each entry as billed, at its project's hourly rate", () => {
    assert.deepEqual(plain(ROWS()), [
        { date: "2026-09-01", start: 780, end: 870, minutes: 90, billed: 90, cents: 8000, project: WEB, task: "Site map", note: "first pass" },
        { date: "2026-09-02", start: 540, end: 590, minutes: 50, billed: 60, cents: 8000, project: WEB, task: "Build pages", note: "" },
        { date: "2026-09-03", start: 1350, end: 1515, minutes: 165, billed: 165, cents: 8000, project: WEB, task: "Late night fix", note: "" },
    ]);
});

test("Billed entries: written as a folded callout and read back the same", () => {
    const lines = billing.billedLines(ROWS(), tr, name);
    assert.equal(lines[0], "> [!pm-billed]- Billed entries");
    assert.equal(lines[1], "> | Date | Start | End | Minutes | Hours | Rate | Project | Task | Note |");
    assert.equal(lines[3], "> | [[2026-09-01\\|9/1/26]] | 1:00pm | 2:30pm | 90 | 1.50 | 80.00 | [[Harbor Web]] | Site map | first pass |");
    assert.equal(lines[5], "> | [[2026-09-03\\|9/3/26]] | 10:30pm | 1:15am | 165 | 2.75 | 80.00 | [[Harbor Web]] | Late night fix |  |");
    const back = billing.readBilled(["# x", "", ...lines, "", "after"].join("\n"), tr);
    assert.equal(back.found, true);
    assert.deepEqual(plain(back.bad), []);
    assert.deepEqual(plain(back.rows), plain(ROWS().map((r) => ({ ...r, project: "Harbor Web" }))));
});

test("Billed entries: pipes, links and comment marks in a task or note survive", () => {
    const rows = [{ date: "2026-09-01", start: 780, end: 870, minutes: 90, billed: 90, cents: 8000, project: WEB, task: "A | B", note: "see [[Page|the page]]" }];
    const back = billing.readBilled(billing.billedLines(rows, tr, name).join("\n"), tr).rows;
    assert.equal(back[0].task, "A | B");
    assert.equal(back[0].note, "see [[Page|the page]]");
    // %% can't open a comment in the invoice; the check compares defused text, so it isn't a change
    const marked = billing.billedLines([{ ...rows[0], task: "50%% done" }], tr, name).join("\n");
    assert.ok(!marked.includes("%%"));
});

test("Billed entries: a table Obsidian's editor reformatted reads the same; a bad row is set aside", () => {
    const text = [
        "> [!pm-billed]- Billed entries",
        "> |  Date                      |  Start   |  End     | Minutes | Hours | Rate  | Project          | Task      | Note       |",
        "> | :------------------------- | :------: | -------- | ------: | ----: | ----: | ---------------- | --------- | ---------- |",
        ">  |  [[2026-09-01\\|9/1/26]]  |  1:00pm  |  2:30pm  |   90    | 1.50  | 80.00 | [[Harbor Web]]   | Site map  | first pass |",
        "> | [[2026-09-02\\|9/2/26]] | 9:00am | 9:61am | 50 | 1.00 | 80.00 | [[Harbor Web]] | Build pages |  |",
        "> | [[2026-09-02\\|9/2/26]] | 1:00pm | 2:00pm | 60 | 1.00 | $100.00 | [[Harbor Photos]] | Shoot |  |",
        "",
        "> [!note] another callout",
        "> | Date | not ours |",
    ].join("\n");
    const { rows, bad } = billing.readBilled(text, tr);
    assert.deepEqual(plain(rows.map((r) => [r.date, r.start, r.end, r.billed, r.cents, r.project, r.task])), [
        ["2026-09-01", 780, 870, 90, 8000, "Harbor Web", "Site map"],
        ["2026-09-02", 780, 840, 60, 10000, "Harbor Photos", "Shoot"],
    ]);
    assert.equal(bad.length, 1);
    assert.match(bad[0].text, /9:61am/);
    assert.deepEqual(plain(billing.readBilled("# no table here", tr)), { rows: [], bad: [], found: false, head: false });
});

// ------------------------------------------------------------------ invoices and the ledger

test("readInvoice: status, project and dates", () => {
    const a = read(invoiceNote("1001-HBR", "Cancelled", ROWS(), { sent: "2026-09-04", paid: "not yet" }));
    assert.equal(a.status, "canceled");
    assert.equal(a.project, WEB);
    assert.equal(a.name, "1001-HBR");
    assert.equal(a.sent, "2026-09-04");
    assert.equal(a.paid, null);
    assert.equal(a.periodEnd, "2026-09-02");
    assert.equal(a.rows.length, 3);
    // No status reads as a draft; no project link falls back to the project the note is filed in
    const b = read({ path: `${INV}/1002-HBR.md`, props: {}, text: "" });
    assert.equal(b.status, "draft");
    assert.equal(b.project, WEB);
    assert.equal(b.number, "1002-HBR");
});

test("ledger: drafts count, canceled invoices don't, except leaves one out, twice is caught once", () => {
    const rows = ROWS();
    const draft = read(invoiceNote("1001-HBR", "draft", rows.slice(0, 1)));
    const canceled = read(invoiceNote("1002-HBR", "canceled", rows.slice(1, 2)));
    const sent = read(invoiceNote("1003-HBR", "sent", rows.slice(0, 1)));
    const l = billing.ledger([draft, canceled, sent]);
    assert.equal(l.byKey.get("2026-09-01 780 870").invoice.name, "1001-HBR", "the first invoice keeps the entry");
    assert.equal(l.byKey.has("2026-09-02 540 590"), false, "a canceled invoice bills nothing");
    assert.deepEqual(plain(l.twice.map((t) => [billing.key(t.row), t.invoices.map((i) => i.name)])), [["2026-09-01 780 870", ["1001-HBR", "1003-HBR"]]]);
    const without = billing.ledger([draft, canceled, sent], { except: draft.path });
    assert.equal(without.byKey.get("2026-09-01 780 870").invoice.name, "1003-HBR");
    assert.equal(without.twice.length, 0);
});

test("nextNumber: one past the highest, canceled included; null for the very first", () => {
    assert.equal(billing.nextNumber([]), null);
    assert.equal(billing.nextNumber([{ number: "2117-DUN" }, { number: "1002-HBR" }, { number: "abc" }]), 2118);
});

test("nextNumber: last_number is a floor, so a deleted invoice's number is never used again (OBS-112)", () => {
    const notes = [{ number: "1002-HBR" }, { number: "1003-KES" }];
    // 1004 was made and its note deleted: the mark remembers it
    assert.equal(billing.nextNumber(notes, 1004), 1005);
    // a mark below the notes changes nothing
    assert.equal(billing.nextNumber(notes, 1000), 1004);
    // no invoices yet: the mark says where to start
    assert.equal(billing.nextNumber([], 1033), 1034);
    assert.equal(billing.nextNumber([], 0), 1);
    // no mark, no invoices: the very first
    assert.equal(billing.nextNumber([], null), null);
});

// ------------------------------------------------------------------ where invoices are filed (OBS-112)

test("folderOf: a folder setting as a vault path; blank is none; anything else is an error", () => {
    for (const [raw, want] of [
        ["30 Reference/Invoices", "30 Reference/Invoices"],
        ["  /30 Reference//Invoices/ ", "30 Reference/Invoices"],
        ["Invoices", "Invoices"],
        ["", ""], ["  ", ""], ["/", ""], [null, ""], [undefined, ""],
    ]) {
        assert.deepEqual(plain(billing.folderOf(raw)), { folder: want, error: null }, String(raw));
    }
    for (const raw of ["../Invoices", "a/../../b", "./Invoices", ".obsidian", "a/.trash", "a/ /b", "C:\\Invoices", "a\\b",
        "[[Invoices]]", "Invoices#1", "a|b", "Business /Invoices", "Business/ Invoices", "a\nb", "a\tb", 2026, ["a"], { a: 1 }, true]) {
        const r = billing.folderOf(raw);
        assert.equal(r.folder, "", String(raw));
        assert.match(r.error, /isn't a folder in the vault/, String(raw));
    }
    // the system's folder and the archive are often excluded, where a base can't list them
    for (const raw of ["00 Meta/Invoices", "00 meta", "90 Archive/Invoices"]) {
        assert.match(billing.folderOf(raw).error, /is inside (00 Meta|00 meta|90 Archive), where invoices don't belong/, raw);
    }
    assert.equal(billing.folderOf("Business/00 Meta/Invoices").error, null, "only at the top");
});

test("hasBilled: a line that opens the Billed entries callout, not the words anywhere", () => {
    assert.equal(billing.hasBilled("# 1001-HBR\n\n> [!pm-billed]- Billed entries\n> | Date |"), true);
    assert.equal(billing.hasBilled(">   [!PM-BILLED] Billed"), true);
    assert.equal(billing.hasBilled("How invoices work: the `[!pm-billed]` callout at the end."), false);
    assert.equal(billing.hasBilled(""), false);
});

test("inInvoiceFolder: a folder named invoices in any case, or anywhere under the setting", () => {
    const yes = [
        ["Projects/Work/Harbor Web/invoices/1001-HBR.md", ""],
        ["Projects/Work/Harbor Web/Invoices/1001-HBR.md", ""],
        ["30 Reference/Invoices/1001-HBR.md", "30 Reference/Invoices"],
        ["30 Reference/Invoices/2026/1001-HBR.md", "30 Reference/Invoices"],
        ["30 reference/INVOICES/1001-HBR.md", "30 Reference/Invoices"],
    ];
    const no = [
        ["Projects/Work/Harbor Web/1001-HBR.md", ""],
        ["Projects/Work/invoices-old/1001-HBR.md", ""],
        ["Projects/Work/invoices/old/1001-HBR.md", ""],
        ["30 Reference/Invoices archive/1001-HBR.md", "30 Reference/Invoices"],
        ["30 Reference/Invoices.md", "30 Reference/Invoices"],
        ["invoices.md", ""],
    ];
    for (const [path, folder] of yes) assert.equal(billing.inInvoiceFolder(path, folder), true, path);
    for (const [path, folder] of no) assert.equal(billing.inInvoiceFolder(path, folder), false, path);
});

// ------------------------------------------------------------------ where an entry stands

test("standing: billed, changed (overlapping a billed row), before billed_through, open", () => {
    const rows = ROWS();
    const ledger = billing.ledger([read(invoiceNote("1001-HBR", "sent", rows))]);
    assert.equal(billing.standing(entry(model, "2026-09-01", "1:00pm"), ledger).kind, "billed");
    const extended = { date: "2026-09-01", start: 780, end: 885 };
    const s = billing.standing(extended, ledger);
    assert.equal(s.kind, "changed");
    assert.equal(s.invoice.name, "1001-HBR");
    assert.equal(s.row.end, 870);
    // Touching isn't overlapping: 2:30pm - 3:00pm right after a billed 1:00pm - 2:30pm is its own work
    assert.equal(billing.standing({ date: "2026-09-01", start: 870, end: 900 }, ledger).kind, "open");
    // Across midnight: a billed 9/3 10:30pm - 1:15am overlaps a 9/4 12:30am - 1:00am entry
    assert.equal(billing.standing({ date: "2026-09-04", start: 30, end: 60 }, ledger).kind, "changed");
    assert.equal(billing.standing({ date: "2026-09-04", start: 75, end: 120 }, ledger).kind, "open");
    assert.deepEqual(plain(billing.standing({ date: "2026-09-01", start: 540, end: 600 }, emptyLedger(), "2026-09-01")), { kind: "before", through: "2026-09-01" });
    assert.equal(billing.standing({ date: "2026-09-02", start: 540, end: 600 }, emptyLedger(), "2026-09-01").kind, "open");
});

test("billedThrough: the project's own, else its parent's; one that isn't a date is flagged", () => {
    assert.deepEqual(plain(billing.billedThrough(OTHER, tr, index)), { date: "2026-09-01", from: OTHER });
    assert.deepEqual(plain(billing.billedThrough(WEB, tr, index)), { date: null });
    const idx = tr.makeIndex(NOTES_INDEX.map((n) => (n.path === WEB ? { ...n, props: { ...n.props, billed_through: "2026-08-31" } } : n)));
    assert.deepEqual(plain(billing.billedThrough(PHOTO, tr, idx)), { date: "2026-08-31", from: WEB }, "inherited");
    const bad = tr.makeIndex(NOTES_INDEX.map((n) => (n.path === OTHER ? { ...n, props: { ...n.props, billed_through: "soon" } } : n)));
    assert.deepEqual(plain(billing.billedThrough(OTHER, tr, bad)), { date: null, from: OTHER, bad: "soon" });
});

test("scope: sub-projects only when include_subprojects is on", () => {
    assert.deepEqual([...billing.scope(WEB, model, tr, index)].sort(), [WEB, FLAT, PHOTO].sort());
    assert.deepEqual([...billing.scope(PHOTO, model, tr, index)], [PHOTO]);
    for (const value of [false, "false", undefined]) {
        const idx = tr.makeIndex(NOTES_INDEX.map((n) => (n.path === WEB ? { ...n, props: { ...n.props, include_subprojects: value } } : n)));
        assert.deepEqual([...billing.scope(WEB, model, tr, idx)], [WEB], String(value));
    }
    const typed = tr.makeIndex(NOTES_INDEX.map((n) => (n.path === WEB ? { ...n, props: { ...n.props, include_subprojects: "true" } } : n)));
    assert.equal(billing.scope(WEB, model, tr, typed).size, 3);
});

// ------------------------------------------------------------------ what a new invoice bills

const picked = (sel) => plain(sel.entries.map((e) => [e.date, tr.formatTime(e.start), name(e.project)]));

test("select: billable, hourly, ended, in scope, through the date; 🆓 and flat left out", () => {
    const sel = billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: emptyLedger() });
    assert.deepEqual(picked(sel), [["2026-09-01", "1:00pm", "Harbor Web"], ["2026-09-02", "9:00am", "Harbor Web"], ["2026-09-02", "1:00pm", "Harbor Photos"]]);
    assert.deepEqual(plain(sel.notHourly), [FLAT]);
    assert.deepEqual(plain(sel.problems), [], "the running clock is after the date");
    assert.equal(sel.before, 0);
    assert.deepEqual(plain(sel.bad), []);
});

test("select: problems in range, running clocks first; the cap when billable time passes it", () => {
    const text = NOTES[0].text.replace("\t- 1:00pm - 2:30pm: first pass", "\t- 1:00pm - 2:30pm: first pass\n\t- 3:00 - 4:00pm");
    const m = tr.build([{ ...NOTES[0], text }, NOTES[1], NOTES[2]], index);
    const sel = billing.select(m, tr, index, { project: WEB, through: "2026-09-03", ledger: emptyLedger() });
    assert.deepEqual(plain(sel.problems.map((p) => [p.date, p.kind])), [["2026-09-03", "open"], ["2026-09-01", "format"]]);
    // max_hours 3 (180 minutes) against 90 + 60 + 60 (Photos) + 60 (Print: flat, but billable, and the cap covers it) + 165
    assert.deepEqual(plain(sel.cap), { used: 435, cap: 180 });
    assert.deepEqual(picked(sel).at(-1), ["2026-09-03", "10:30pm", "Harbor Web"]);
});

test("select: a billed entry is skipped; the same entry extended since is held back, not billed", () => {
    const rows = ROWS().slice(0, 1);
    const ledger = billing.ledger([read(invoiceNote("1001-HBR", "paid", rows))]);
    const sel = billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger });
    assert.ok(!picked(sel).some(([d, t]) => d === "2026-09-01" && t === "1:00pm"));
    const edited = tr.build([{ ...NOTES[0], text: NOTES[0].text.replace("2:30pm", "2:45pm") }, NOTES[1], NOTES[2]], index);
    const again = billing.select(edited, tr, index, { project: WEB, through: "2026-09-02", ledger });
    assert.ok(!picked(again).some(([d, t]) => d === "2026-09-01" && t === "1:00pm"), "never billed in full again");
    assert.deepEqual(plain(again.heldBack.map((h) => [h.entry.date, h.entry.end, h.invoice.name, h.row.end])), [["2026-09-01", 885, "1001-HBR", 870]]);
});

test("select: a draft's entries are billed for other invoices; a canceled invoice's aren't", () => {
    const rows = ROWS().slice(0, 2);
    const draft = read(invoiceNote("1001-HBR", "draft", rows));
    assert.equal(billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: billing.ledger([draft]) }).entries.length, 1);
    const canceled = read(invoiceNote("1001-HBR", "canceled", rows));
    assert.equal(billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: billing.ledger([canceled]) }).entries.length, 3);
    // Rebuilding the draft: its own rows don't count against it
    assert.equal(billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: billing.ledger([draft], { except: draft.path }) }).entries.length, 3);
});

test("select: billed_through covers older entries; one that isn't a date is reported", () => {
    const sel = billing.select(model, tr, index, { project: OTHER, through: "2026-09-02", ledger: emptyLedger() });
    assert.equal(sel.before, 1);
    assert.deepEqual(picked(sel), [["2026-09-02", "4:00pm", "Dune Books"]]);
    const bad = tr.makeIndex(NOTES_INDEX.map((n) => (n.path === OTHER ? { ...n, props: { ...n.props, billed_through: "soon" } } : n)));
    assert.deepEqual(plain(billing.select(model, tr, bad, { project: OTHER, through: "2026-09-02", ledger: emptyLedger() }).bad), [{ project: OTHER, value: "soon" }]);
});

test("select: two identical lines on one day bill once; the second is held back", () => {
    const twin = day("2026-09-05", "- [x] Same [[Harbor Web|⭕]]\n\t- 9:00am - 10:00am\n- [x] Same [[Harbor Web|⭕]]\n\t- 9:00am - 10:00am");
    const m = tr.build([twin], index);
    const sel = billing.select(m, tr, index, { project: WEB, through: "2026-09-05", ledger: emptyLedger() });
    assert.equal(sel.entries.length, 1);
    assert.deepEqual(plain(sel.heldBack.map((h) => h.why)), ["duplicate"]);
    assert.deepEqual(plain(sel.problems.map((p) => p.kind)), ["overlap"], "and the overlap is under Fix first");
    // An invoice written by hand with the same row twice is caught when it's read
    const rows = billing.snapshot([m.entries[0], m.entries[0]], m, tr);
    const ledger = billing.ledger([read(invoiceNote("1001-HBR", "sent", rows))]);
    assert.deepEqual(plain(ledger.twice.map((t) => t.invoices.map((i) => i.name))), [["1001-HBR", "1001-HBR"]]);
});

// ------------------------------------------------------------------ invoice lines

test("rows: a row per date and rate, rounded entries added up, amounts to the cent", () => {
    const sel = billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: emptyLedger() });
    assert.deepEqual(plain(billing.rows(billing.snapshot(sel.entries, model, tr))), [
        { date: "2026-09-01", cents: 8000, minutes: 90, tasks: ["Site map"], amount: 12000 },
        { date: "2026-09-02", cents: 10000, minutes: 60, tasks: ["Shoot"], amount: 10000 },
        { date: "2026-09-02", cents: 8000, minutes: 60, tasks: ["Build pages"], amount: 8000 },
    ]);
    assert.equal(billing.rows([{ date: "2026-09-01", cents: 9510, billed: 15, task: "x" }])[0].amount, 2378, "23.775 rounds to 23.78");
});

// ------------------------------------------------------------------ changed since invoiced

test("changes: times, moved, gone, 🆓, another project, wording; entries logged late", () => {
    const rows = billing.snapshot(billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: emptyLedger() }).entries, model, tr);
    const invoice = read(invoiceNote("1001-HBR", "sent", rows));
    const ledger = billing.ledger([invoice]);
    const kinds = (notes) => {
        const m = tr.build(notes, index);
        return plain(billing.changes(invoice, m, tr, index, ledger).changes.map((c) => [c.row.date, tr.formatTime(c.row.start), c.kind]));
    };
    assert.deepEqual(kinds(NOTES), [], "nothing changed");
    assert.deepEqual(kinds([{ ...NOTES[0], text: NOTES[0].text.replace("2:30pm", "2:45pm") }, NOTES[1]]), [["2026-09-01", "1:00pm", "times"]]);
    assert.deepEqual(kinds([{ ...NOTES[0], text: NOTES[0].text.replace("first pass", "second pass") }, NOTES[1]]), [["2026-09-01", "1:00pm", "wording"]]);
    assert.deepEqual(kinds([NOTES[0], { ...NOTES[1], text: NOTES[1].text.replace("9:50am\n", "9:50am: 🆓\n") }]), [["2026-09-02", "9:00am", "free"]]);
    assert.deepEqual(kinds([NOTES[0], { ...NOTES[1], text: NOTES[1].text.replace("Build pages [[Harbor Web|⭕]]", "Build pages [[Dune Books|⭕]]") }]), [["2026-09-02", "9:00am", "project"]]);
    const moved = NOTES[1].text.replace("- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am\n", "");
    assert.deepEqual(kinds([NOTES[0], { ...NOTES[1], text: moved }, day("2026-09-04", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am")]), [["2026-09-02", "9:00am", "moved"]]);
    assert.deepEqual(kinds([NOTES[0], { ...NOTES[1], text: NOTES[1].text.replace("- [x] Shoot [[Harbor Photos|⭕]]\n\t- 1:00pm - 2:00pm\n", "") }]), [["2026-09-02", "1:00pm", "gone"]]);
    const late = tr.build([NOTES[0], { ...NOTES[1], text: NOTES[1].text + "\n- [x] Extra [[Harbor Web|⭕]]\n\t- 5:00pm - 5:30pm" }], index);
    assert.deepEqual(plain(billing.changes(invoice, late, tr, index, ledger).late.map((e) => [e.date, tr.formatTime(e.start)])), [["2026-09-02", "5:00pm"]]);
});

// ------------------------------------------------------------------ from the plan's review (2026-09-28)

const ledgerOf = (...notes) => billing.ledger(notes.map(read));
const billedAll = () => billing.snapshot(billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: emptyLedger() }).entries, model, tr);

test("review: a billed entry moved to another day is held back, not billed again", () => {
    const ledger = ledgerOf(invoiceNote("1001-HBR", "sent", billedAll()));
    const moved = NOTES[1].text.replace("- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am\n", "- [x] Build pages [[Harbor Web|⭕]]\n");
    const m = tr.build([NOTES[0], { ...NOTES[1], text: moved }, day("2026-09-04", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am")], index);
    const sel = billing.select(m, tr, index, { project: WEB, through: "2026-09-04", ledger });
    assert.deepEqual(picked(sel), []);
    assert.deepEqual(plain(sel.heldBack.map((h) => [h.entry.date, h.why, h.invoice.name])), [["2026-09-04", "moved", "1001-HBR"]]);
    assert.deepEqual(plain(sel.changed.map((c) => c.change.kind)), ["moved"]);
});

test("review: a billed entry retimed without overlapping (a typo fix, a synced event) is held back", () => {
    const ledger = ledgerOf(invoiceNote("1001-HBR", "sent", billedAll()));
    const m = tr.build([{ ...NOTES[0], text: NOTES[0].text.replace("1:00pm - 2:30pm", "3:00pm - 4:30pm") }, NOTES[1]], index);
    const sel = billing.select(m, tr, index, { project: WEB, through: "2026-09-02", ledger });
    assert.deepEqual(picked(sel), []);
    assert.deepEqual(plain(sel.heldBack.map((h) => [h.entry.date, tr.formatTime(h.entry.start), h.why])), [["2026-09-01", "3:00pm", "retimed"]]);
});

test("review: the same times on another project aren't taken for a billed entry", () => {
    const ledger = ledgerOf(invoiceNote("1001-HBR", "sent", billedAll()));
    const m = tr.build([NOTES[0], { ...NOTES[1], text: NOTES[1].text + "\n- [x] Dune copy [[Dune Books|⭕]]\n\t- 9:00am - 9:50am" }], index);
    const dune = m.entries.find((e) => e.project === OTHER && e.date === "2026-09-02" && e.start === 540);
    const s = billing.standing(dune, ledger);
    assert.equal(s.kind, "changed", "held back and named, never skipped as billed");
    const sel = billing.select(m, tr, index, { project: OTHER, through: "2026-09-02", ledger });
    assert.deepEqual(plain(sel.heldBack.map((h) => [h.entry.date, h.why, h.invoice.name])), [["2026-09-02", "changed", "1001-HBR"]]);
});

test("review: an invoice whose Billed entries can't be trusted stops invoicing the project", () => {
    const rows = billedAll();
    const good = invoiceNote("1001-HBR", "sent", rows, { hours: 3.5, total: 300 });
    assert.equal(read(good).problem, null, "hours and total match the rows");
    const cases = [
        [{ ...good, text: good.text.replace("| 1:00pm | 2:30pm |", "| 13:00 | 2:30pm |") }, /a Billed entries row that doesn't read/],
        [{ ...good, text: good.text.replace("[!pm-billed]", "[!note]") }, /has no Billed entries table/],
        [{ ...good, text: good.text.replace(/> \| Date .*\n> \| --- .*\n/, "") }, /without its column names/],
        [{ ...good, props: { ...good.props, hours: 5 } }, /add up to 3\.50 hours, not its `hours` \(5\)/],
        [{ ...good, props: { ...good.props, total: 250 } }, /add up to \$300\.00, not its `total` \(250\)/],
    ];
    for (const [note, why] of cases) {
        const inv = read(note);
        assert.match(inv.problem ?? "", why);
        const sel = billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: billing.ledger([inv]) });
        assert.deepEqual(plain(sel.bad.map((b) => b.invoice?.name)), ["1001-HBR"], String(why));
    }
    // A canceled invoice's table doesn't matter
    const canceled = read({ ...good, props: { ...good.props, status: "canceled" }, text: "" });
    assert.deepEqual(plain(billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: billing.ledger([canceled]) }).bad), []);
});

test("review: select refuses a date it can't read", () => {
    for (const through of [null, "", "soon", "2026-02-30"]) {
        assert.throws(() => billing.select(model, tr, index, { project: WEB, through, ledger: emptyLedger() }), /isn't a date/, String(through));
    }
});

test("review: touching isn't overlapping, in changes too", () => {
    const rows = billing.snapshot([entry(model, "2026-09-01", "1:00pm")], model, tr);
    const inv = read(invoiceNote("1001-HBR", "sent", rows));
    // The billed entry deleted, and another task's entry starting when it ended: gone, not "times"
    const m = tr.build([{ ...NOTES[0], text: NOTES[0].text.replace("- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass", "- [x] Other work [[Harbor Web|⭕]]\n\t- 2:30pm - 3:00pm") }], index);
    assert.deepEqual(plain(billing.changes(inv, m, tr, index, billing.ledger([inv])).changes.map((c) => c.kind)), ["gone"]);
});

test("review: changes says unassigned, and ignores another project's overlapping entry", () => {
    const rows = billing.snapshot([entry(model, "2026-09-01", "1:00pm")], model, tr);
    const inv = read(invoiceNote("1001-HBR", "sent", rows));
    const l = billing.ledger([inv]);
    const unlinked = tr.build([{ ...NOTES[0], text: NOTES[0].text.replace("Site map [[Harbor Web|⭕]]", "Site map") }], index);
    assert.deepEqual(plain(billing.changes(inv, unlinked, tr, index, l).changes.map((c) => c.kind)), ["unassigned"]);
    const other = tr.build([{ ...NOTES[0], text: NOTES[0].text.replace("- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass", "- [x] Dune [[Dune Books|⭕]]\n\t- 1:30pm - 2:00pm") }], index);
    assert.deepEqual(plain(billing.changes(inv, other, tr, index, l).changes.map((c) => c.kind)), ["gone"]);
});

test("review: late leaves out what billed_through covers", () => {
    const idx = tr.makeIndex(NOTES_INDEX.map((n) => (n.path === WEB ? { ...n, props: { ...n.props, billed_through: "2026-09-01" } } : n)));
    const m = tr.build(NOTES, idx);
    const inv = billing.readInvoice(invoiceNote("1001-HBR", "sent", billing.snapshot([entry(m, "2026-09-02", "9:00am")], m, tr), { period_start: "2026-09-01" }), tr, idx);
    const late = billing.changes(inv, m, tr, idx, billing.ledger([inv])).late;
    assert.ok(!late.some((e) => e.date === "2026-09-01"), "9/1 is covered by billed_through");
    assert.ok(late.some((e) => e.date === "2026-09-02" && e.project === PHOTO));
});

test("review: nextNumber reads only invoice-style numbers; statuses in any spelling", () => {
    assert.equal(billing.nextNumber([{ number: "2026-09-14" }, { number: "Invoice" }, { number: "2117-DUN" }, { number: "2118-KES-2" }, { number: "2119-A B" }]), 2120);
    for (const [status, want] of [["Canceled", "canceled"], ["CANCELLED", "canceled"], ["Sent", "sent"], ["on hold", "on hold"]]) {
        assert.equal(read(invoiceNote("1001-HBR", status, ROWS())).status, want);
    }
    // A status it doesn't know still bills
    const held = read(invoiceNote("1001-HBR", "on hold", ROWS().slice(0, 1)));
    assert.equal(billing.ledger([held]).byKey.size, 1);
});

test("review: Fix first starts at the first entry being billed, except a running clock", () => {
    const old = day("2026-08-01", "- [x] Old [[Harbor Web|⭕]]\n\t- 3:00 - 4:00pm\n- [/] Forgotten [[Harbor Web|⭕]]\n\t- 9:00am - ");
    const m = tr.build([old, ...NOTES], index);
    const ledger = billing.ledger([read(invoiceNote("1000-HBR", "paid", billing.snapshot(m.entries.filter((e) => e.date < "2026-09-01" && e.project === WEB), m, tr)))]);
    const sel = billing.select(m, tr, index, { project: WEB, through: "2026-09-02", ledger });
    assert.deepEqual(plain(sel.problems.map((p) => [p.date, p.kind])), [["2026-08-01", "open"]], "the old mistyped range is left out; the running clock stays");
});

// ------------------------------------------------------------------ from the branch review (2026-09-28)

test("final review: a recurring meeting isn't taken for a moved entry; one far away isn't either", () => {
    const standup = (d) => day(d, "- [<] 9:00am\tStandup [[Harbor Web|⭕]]\n\t- 9:20am");
    const m0 = tr.build([standup("2026-09-07"), standup("2026-09-08"), standup("2026-09-09")], index);
    const billed = billing.snapshot(m0.entries.filter((e) => e.date === "2026-09-08"), m0, tr);
    const inv = read(invoiceNote("1001-HBR", "sent", billed));
    const l = billing.ledger([inv]);
    // 9/8's end line dropped: two other standups at the same times, so it's gone, not a guess
    const m = tr.build([standup("2026-09-07"), day("2026-09-08", "- [<] 9:00am\tStandup [[Harbor Web|⭕]]"), standup("2026-09-09")], index);
    assert.deepEqual(plain(billing.changes(inv, m, tr, index, l).changes.map((c) => c.kind)), ["gone"]);
    assert.equal(billing.holds(m, tr, index, l).held.size, 0, "and nothing is held back");
    // A single candidate a week away is a different meeting, not a move
    const far = tr.build([day("2026-09-08", "- [<] 9:00am\tStandup [[Harbor Web|⭕]]"), standup("2026-09-15")], index);
    assert.deepEqual(plain(billing.changes(inv, far, tr, index, l).changes.map((c) => c.kind)), ["gone"]);
    // One candidate within three days is a move
    const near = tr.build([day("2026-09-08", "- [<] 9:00am\tStandup [[Harbor Web|⭕]]"), standup("2026-09-10")], index);
    assert.deepEqual(plain(billing.changes(inv, near, tr, index, l).changes.map((c) => [c.kind, c.entry?.date])), [["moved", "2026-09-10"]]);
});

test("final review: a retime is held back only when it's the task's one entry that day", () => {
    const billed = billing.snapshot([entry(model, "2026-09-01", "1:00pm")], model, tr);
    const inv = read(invoiceNote("1001-HBR", "sent", billed));
    const l = billing.ledger([inv]);
    const one = tr.build([{ ...NOTES[0], text: NOTES[0].text.replace("1:00pm - 2:30pm", "3:00pm - 4:30pm") }], index);
    assert.deepEqual(plain(billing.changes(inv, one, tr, index, l).changes.map((c) => [c.kind, tr.formatTime(c.entry?.start ?? 0)])), [["times", "3:00pm"]]);
    assert.deepEqual(plain([...billing.holds(one, tr, index, l).held.values()].map((h) => h.why)), ["retimed"]);
    // Retimed, and new work on the same task logged the same day: nothing is guessed, nothing held
    const more = tr.build([{ ...NOTES[0], text: NOTES[0].text.replace("1:00pm - 2:30pm: first pass", "3:00pm - 4:30pm: first pass\n\t- 5:00pm - 6:00pm") }], index);
    assert.deepEqual(plain(billing.changes(inv, more, tr, index, l).changes.map((c) => c.kind)), ["gone"]);
    const sel = billing.select(more, tr, index, { project: WEB, through: "2026-09-01", ledger: l });
    assert.deepEqual(picked(sel), [["2026-09-01", "3:00pm", "Harbor Web"], ["2026-09-01", "5:00pm", "Harbor Web"]]);
    assert.deepEqual(plain(sel.changed.map((c) => c.change.kind)), ["gone"], "it's under Fix first instead");
});

test("final review: rows for a project archived since are left alone", () => {
    const ARCH = "90 Archive/Work/Harbor Web/Harbor Photos/Harbor Photos.md";
    const idx = tr.makeIndex([...NOTES_INDEX, { path: ARCH, tags: ["project"], props: { rate: 100, rate_type: "hourly" } }]);
    const rows = [{ date: "2026-09-02", start: 780, end: 840, minutes: 60, billed: 60, cents: 10000, project: ARCH, task: "Shoot", note: "" }];
    const inv = billing.readInvoice({ path: `${INV}/1001-HBR.md`, props: { status: "paid", project: "[[Harbor Web]]" }, text: billing.billedLines(rows, tr, (p) => p.replace(/\.md$/, "")).join("\n") }, tr, idx);
    assert.equal(inv.rows[0].projectPath, ARCH);
    const m = tr.build([], idx);
    assert.deepEqual(plain(billing.changes(inv, m, tr, idx, billing.ledger([inv])).changes), []);
});

test("final review: an invoice that lost its tag, or whose frontmatter doesn't read, stays billed and blocks invoicing", () => {
    const note = invoiceNote("1001-HBR", "sent", ROWS().slice(0, 1));
    for (const [flags, why] of [[{ tagged: false }, /isn't tagged `invoice` any more/], [{ error: "bad yaml" }, /frontmatter that doesn't read/]]) {
        const inv = billing.readInvoice({ ...note, ...flags }, tr, index);
        assert.match(inv.problem, why);
        const l = billing.ledger([inv]);
        assert.equal(l.byKey.size, 1, "its rows still count as billed");
        assert.equal(billing.select(model, tr, index, { project: WEB, through: "2026-09-02", ledger: l }).bad.length, 1);
    }
});

test("final review: a project link to a note that isn't a project falls back to the invoice's folder", () => {
    const idx = tr.makeIndex([...NOTES_INDEX, { path: "30 Reference/31 Notes/Harbor Web ideas.md", tags: [], props: {} }]);
    const inv = billing.readInvoice({ ...invoiceNote("1001-HBR", "sent", ROWS()), props: { status: "sent", project: "[[Harbor Web ideas]]" } }, tr, idx);
    assert.equal(inv.project, WEB);
});
