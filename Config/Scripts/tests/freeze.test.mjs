// Freezing the tables the system writes, for the Better Markdown Tables plugin, once Selectable Tables
// (OBS-238). Since OBS-351 the report writes no freeze of its own, so a table takes that plugin's
// default; the one it wrote before, labeled `%%default R C%%`, comes out at the next rewrite, and a freeze
// you set yourself is kept through every rewrite. Every project, entry and amount here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { obsidianPadded, segments, tablesIn as spans } from "./tables.mjs";
import { classScript } from "../../../plugin/classShape.mjs";
import { withDates } from "./standInVault.mjs";

const load = (file, name) => vm.runInContext(classScript(`${file}`) + `\n;${name}`, vm.createContext({ plainday: withDates({}) }));
const TimeReport = load("timeReport.js", "TimeReport");
const tr = new TimeReport();
const billing = new (load("billing.js", "Billing"))();
const inv = new (load("invoice.js", "Invoice"))();
const plain = (x) => JSON.parse(JSON.stringify(x));

const DAYS = "Reference/Planner/days";
const WEB = "Projects/Work/Harbor Web/Harbor Web.md";                     // hourly $80
const PHOTO = "Projects/Work/Harbor Web/Harbor Photos/Harbor Photos.md";   // its sub-project, hourly $100
const CLIENT = "Reference/Entities/Harbor Co.md";
const index = tr.makeIndex([
    { path: WEB, tags: ["project"], props: { rate: 80, rate_type: "hourly", include_subprojects: true, client: "[[Harbor Co]]" } },
    { path: PHOTO, tags: ["project"], props: { rate: 100, rate_type: "hourly" } },
    { path: CLIENT, tags: [], props: { code: "hbr" } },
]);
const day = (date, text) => ({ date, path: `${DAYS}/${date}.md`, text });
const NOTES = [
    day("2026-09-01", "- [x] Site map [[Harbor Web|⭕]]\n\t- 1:00pm - 2:30pm: first pass\n- [x] Fix a typo [[Harbor Web|⭕]] 🆓\n\t- 3:00pm - 3:20pm"),
    day("2026-09-02", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am"),
];
const modelOf = (notes) => tr.build(notes, index);
const MORE = [...NOTES, day("2026-09-03", "- [x] Polish [[Harbor Web|⭕]]\n\t- 10:00am - 11:00am")];
const SHOOT = [...NOTES, day("2026-09-03", "- [x] Shoot [[Harbor Photos|⭕]]\n\t- 1:00pm - 2:00pm")];

// A report run's write of `block` into `content`, as writeBlock plans it
function write(content, block, opts = {}) {
    const edits = tr.blockEdits(content, block, { onlyIfChanged: true, ...opts });
    assert.ok(!edits.error, edits.error);
    return edits.reduce((c, e) => c.slice(0, e.start) + e.text + c.slice(e.end), content);
}
const sheet = (model) => tr.render(model, { kind: "timesheet", path: WEB }, "s");
const project = (notes) => tr.render(modelOf(notes), { kind: "project", path: WEB }, "s");
const SHEET = { heading: false };

// The header rows of `text`'s tables, by the heading above each (as tablesIn keys it)
function headers(text) {
    const lines = text.split("\n");
    return plain(tr.tablesIn(lines)).map(({ at, heading }) => [heading, lines[at]]);
}
// The freeze comments at the start of the header row under the heading that includes `match`
function comments(text, match) {
    const [, row] = headers(text).find(([h]) => h.includes(match)) ?? [];
    assert.ok(row, `no table under a heading with ${match}`);
    return segments(row)[0].trim().match(/^((?:%%[^%]*%%\s*)*)/)[1].trim();
}
// Whether each table of `text` is padded as Obsidian's table editor pads it
function assertPadded(text) {
    const lines = text.split("\n");
    for (const t of spans(lines)) assert.deepEqual(lines.slice(t.from, t.to + 1), obsidianPadded(lines.slice(t.from, t.to + 1)));
}

// A note as the report wrote it before OBS-351 with its default on: each table under a heading that
// includes `match` (every table, with none) starts with the default's mark and its label. A timesheet's
// default counted from its first named column, so 1 and 1 froze its status column and Date / Time.
function oldDefault(text, { rows = 1, columns = 1 } = {}, match = "") {
    const lines = text.split("\n");
    for (const t of tr.tablesIn(lines)) {
        if (t.heading.includes(match)) lines[t.at] = lines[t.at].replace(/^\|\s?/, `| %%freeze ${rows} ${columns}%% %%default ${rows} ${columns}%% `);
    }
    return lines.join("\n");
}
const OLD_SHEET = { rows: 1, columns: 2 };

// Better Markdown Tables' commands, as its freeze-mark.ts writes the mark (withFreeze): over the first mark, or
// at the start of the first cell with none. Unfreeze table takes every mark out, each with the spaces after it,
// or, while that plugin's own default is on, writes `%%freeze 0 0%%` (`keep`), so the table stays unfrozen.
// Other comments in the cell stay. (The plugin also pads the table again; the report rewrites it anyway.)
const MARK = /%%\s*freeze\s+\d+\s+\d+\s*%%/;
function command(text, match, freeze, { keep = false } = {}) {
    const lines = text.split("\n");
    const t = tr.tablesIn(lines).find((x) => x.heading.includes(match));
    let row = lines[t.at];
    if (!freeze.rows && !freeze.columns && !keep) row = row.replace(new RegExp(`${MARK.source}[ \\t]*`, "g"), "");
    else if (MARK.test(row)) row = row.replace(MARK, `%%freeze ${freeze.rows} ${freeze.columns}%%`);
    else row = row.replace(/^\|\s?/, `| %%freeze ${freeze.rows} ${freeze.columns}%% `);
    lines[t.at] = row;
    return lines.join("\n");
}
const UNFROZEN = { rows: 0, columns: 0 };
// Freeze rows up to here: the rows change, the frozen columns stay
const freezeRows = (text, match, rows) => {
    const [, row] = headers(text).find(([h]) => h.includes(match));
    return command(text, match, { rows, columns: tr.freezeOf(row).mark?.columns ?? 0 });
};

// ------------------------------------------------------------------ defusing

test("defuse leaves a freeze mark and label whole, and still escapes what's around them", () => {
    for (const kept of ["%%freeze 1 2%% %%default 1 2%%", "%%freeze 0 0%% %%custom%%", "%%freeze 12 3%% Date", "Project %%custom%%"]) {
        assert.equal(tr.defuse(kept), kept);
    }
    assert.equal(tr.defuse("50%% done %%custom%% -->"), "50%​% done %%custom%% --​>");
    // Next to another %, or after a < (Templater's <%), a comment isn't the report's, and is escaped whole
    for (const s of ["%%%custom%%", "%%custom%%%", "<%%custom%%", "%% freeze 1 1 %%", "%%freeze 1%%", "%%Custom%%"]) {
        const d = tr.defuse(s);
        assert.ok(!d.includes("%%") && !d.includes("<%"), `${s} → ${JSON.stringify(d)}`);
    }
});

test("defuse: whatever the text, nothing it leaves can open a comment that hides the block's end, and twice is once", () => {
    const parts = ["%", "%%", "<", "!--", "-->", "<%", "%%custom%%", "%%freeze 1 2%%", "%%default 0 3%%", "x", " ", "`"];
    let seed = 11;
    const pick = () => parts[(seed = (seed * 1103515245 + 12345) % 2147483648) % parts.length];
    for (let n = 0; n < 2000; n++) {
        const s = Array.from({ length: 1 + (n % 9) }, pick).join("");
        const d = tr.defuse(s);
        assert.equal(tr.defuse(d), d, JSON.stringify(s));
        assert.ok(!d.includes("<%") && !d.includes("<!--") && !d.includes("-->"), JSON.stringify(s));
        const read = tr.scan([d, TimeReport.END]);
        assert.deepEqual(plain(read.unclosed), [], JSON.stringify(s));
        assert.deepEqual(plain(read.ends), [1], JSON.stringify(s));
    }
});

// ------------------------------------------------------------------ the writer

test("table: a freeze mark goes at the start of the first cell, and its column is padded for it as Obsidian pads it", () => {
    const sheetLines = tr.table(["", "Date", "Hours"], ["center", null, "right"], [["✅", "**9/1**", "1.50"], ["⚠️", "", "0.25"]],
        { freeze: "%%freeze 1 2%%" });
    assert.deepEqual([...sheetLines], [
        "| %%freeze 1 2%% | Date    | Hours |",
        "| :------------: | ------- | ----: |",
        "|       ✅        | **9/1** |  1.50 |",
        "|       ⚠️       |         |  0.25 |",
    ]);
    const named = [...tr.table(["Project", "Total"], [null, "right"], [["[[Harbor Web]]", "2.00"]], { freeze: "%%freeze 1 1%%" })];
    assert.equal(named[0], "| %%freeze 1 1%% Project | Total |");
    for (const lines of [[...sheetLines], named]) {
        assert.deepEqual(lines, obsidianPadded(lines));
        assert.deepEqual(lines.map((l) => tr.defuse(l)), lines, "the report's own defusing changes nothing");
    }
});

// ------------------------------------------------------------------ whose freeze it is

test("freezeHeader: nothing in the header, so nothing: the table takes Better Markdown Tables' default (OBS-351)", () => {
    assert.equal(tr.freezeHeader(null), "");
    assert.equal(tr.freezeHeader(tr.freezeOf("| Project | Total |")), "");
});

test("freezeHeader: a freeze that still matches its default label is the report's old default, so it comes out", () => {
    for (const old of ["| %%freeze 1 1%% %%default 1 1%% Project | Total |", "| %%freeze 1 2%% %%default 1 2%% | Date |", "| %%freeze 4 0%% %%default 4 0%% Project | Total |"]) {
        assert.equal(tr.freezeHeader(tr.freezeOf(old)), "", old);
    }
});

test("freezeHeader: a freeze that differs from its default label was changed with a command, so it's yours", () => {
    assert.equal(tr.freezeHeader(tr.freezeOf("| %%freeze 3 1%% %%default 1 1%% Project | Total |")), "%%freeze 3 1%%");
});

test("freezeHeader: a label with no freeze was unfrozen, so it stays unfrozen", () => {
    assert.equal(tr.freezeHeader(tr.freezeOf("| %%default 1 1%% Project | Total |")), "%%freeze 0 0%%");
    assert.equal(tr.freezeHeader(tr.freezeOf("| %%custom%% Project | Total |")), "%%freeze 0 0%%", "your own freeze taken off");
});

test("freezeHeader: a freeze labeled custom stays, without its label", () => {
    assert.equal(tr.freezeHeader(tr.freezeOf("| %%freeze 2 2%% %%custom%% Project | Total |")), "%%freeze 2 2%%");
    assert.equal(tr.freezeHeader(tr.freezeOf("| %%freeze 0 0%% %%custom%% Project | Total |")), "%%freeze 0 0%%");
});

test("freezeHeader: a freeze with no label was set with a command or typed, so it's yours, written as the plugin writes it", () => {
    assert.equal(tr.freezeHeader(tr.freezeOf("| %% freeze 2 1 %% Project | Total |")), "%%freeze 2 1%%");
    assert.equal(tr.freezeHeader(tr.freezeOf("| Project | Total %%freeze 0 0%% |")), "%%freeze 0 0%%", "in any cell");
});

test("freezeOf reads the header as Better Markdown Tables does: the first mark counts, and one in code is text", () => {
    assert.deepEqual(plain(tr.freezeOf("| %%freeze 2 1%% A | %%freeze 5 5%% B |").mark), { rows: 2, columns: 1 });
    assert.deepEqual(plain(tr.freezeOf("| `%%freeze 2 1%%` A | B |")), { mark: null, label: null });
    assert.deepEqual(plain(tr.freezeOf("| %%freeze 1 2%% %%default 1 2%% | Date |")), { mark: { rows: 1, columns: 2 }, label: { kind: "default", rows: 1, columns: 2 } });
});

test("withFreezes leaves a table alone when a row has more cells than its columns, rather than stop", () => {
    const lines = ["## Billable hours", "", "| %%freeze 1 1%% %%default 1 1%% Line item | Qty |", "| --- | --: |", "| 9/1 — Fix a \\\\| b | 1.00 | 2.00 |"];
    assert.deepEqual([...tr.withFreezes(lines, tr.freezesIn(lines))], lines);
});

// ------------------------------------------------------------------ a report run

test("a new timesheet carries no freeze, written exactly as before OBS-238", () => {
    const block = sheet(modelOf(NOTES));
    assert.equal(tr.freezeBlock(block, ""), block);
    const note = write("", block, SHEET);
    assert.ok(!note.includes("%%freeze") && !note.includes("%%default") && !note.includes("%%custom"), note);
    assert.equal(tr.freezeBlock(block, note), block);
    assert.deepEqual(plain(tr.blockEdits(note, block, { heading: false })), [], "the next run changes nothing");
});

test("a timesheet at the report's old default loses it on the next run, padded as Obsidian pads it, and the run after writes nothing", () => {
    const block = sheet(modelOf(NOTES));
    const before = oldDefault(write("", block, SHEET), OLD_SHEET);
    assert.equal(comments(before, "Billable"), "%%freeze 1 2%% %%default 1 2%%");
    const note = write(before, block, SHEET);
    assert.equal(comments(note, "Billable"), "");
    assert.equal(note, write("", block, SHEET), "as a new one is written");
    assertPadded(note);
    // The block reads as it did: one block, nothing unclosed
    const read = tr.scan(note.split("\n"));
    assert.deepEqual(plain(read.unclosed), []);
    assert.equal(read.blocks.length, 1);
    assert.deepEqual(plain(tr.blockEdits(note, block, { heading: false })), [], "the next run changes nothing");
});

test("your freeze survives a rewrite, and a run after writes nothing", () => {
    // Set on a table at the old default: the command writes over the mark, and the old label stays
    let note = freezeRows(oldDefault(write("", sheet(modelOf(NOTES)), SHEET), OLD_SHEET), "Billable", 3);
    assert.equal(comments(note, "Billable"), "%%freeze 3 2%% %%default 1 2%%");
    note = write(note, sheet(modelOf(MORE)), SHEET);
    assert.ok(note.includes("Thu 9/3") && note.includes("Billable time: 3.50 hrs"), "the timesheet took the new entry, and its heading's total changed");
    assert.equal(comments(note, "Billable"), "%%freeze 3 2%%", "yours, without the label");
    assertPadded(note);
    assert.deepEqual(plain(tr.blockEdits(note, sheet(modelOf(MORE)), { heading: false })), []);
    // Set on a new table, and one labeled custom before OBS-351
    note = write(command(write("", sheet(modelOf(NOTES)), SHEET), "Billable", { rows: 2, columns: 1 }), sheet(modelOf(MORE)), SHEET);
    assert.equal(comments(note, "Billable"), "%%freeze 2 1%%");
    note = write(note.replace("%%freeze 2 1%%", "%%freeze 2 1%% %%custom%%"), sheet(modelOf(MORE)), SHEET);
    assert.equal(comments(note, "Billable"), "%%freeze 2 1%%");
});

test("a timesheet's table keeps your freeze when its summary line gains or loses a kind of time (OBS-242)", () => {
    const billableOnly = [day("2026-09-02", "- [x] Build pages [[Harbor Web|⭕]]\n\t- 9:00am - 9:50am")];
    let note = write("", sheet(modelOf(billableOnly)), SHEET);
    assert.ok(note.includes("### Billable time: 1.00 hrs\n"), note);
    note = write(freezeRows(note, "Billable", 3), sheet(modelOf(billableOnly)), SHEET);
    note = write(note, sheet(modelOf(NOTES)), SHEET);
    assert.ok(note.includes("### Billable time: 2.50 hrs · 🆓 time: 0.50 hrs"), note);
    assert.equal(comments(note, "Billable"), "%%freeze 3 0%%", "its first 🆓 entry doesn't make it a new table");
});

test("a timesheet from before OBS-242: a freeze you set on either of its two tables carries over to the one, the Billable table's when both have one", () => {
    // The old layout's two tables, each with the freeze comments it may have
    const old = (billable, free) => [
        "%% time:start %%", "*Updated s*", "",
        "### Billable time: 2.50 hrs", "", `| ${billable} | Date | Time | Hours |`, "| :-: | --- | --- | --: |", "|  | **[[2026-09-02\\|Wed 9/2]]** |  | **1.00** |", "",
        "### 🆓 time: 0.50 hrs", "", `| ${free} | Date | Time | Hours |`, "| :-: | --- | --- | --: |", "|  | **[[2026-09-01\\|Tue 9/1]]** |  | **0.50** |", "",
        "%% time:end %%",
    ].join("\n");
    const block = sheet(modelOf(NOTES));
    const DEF = "%%freeze 1 2%% %%default 1 2%%";
    assert.equal(comments(write(old(DEF, DEF), block, SHEET), "Billable"), "", "both at the old default: none");
    assert.equal(comments(write(old(DEF, "%%freeze 4 2%% %%custom%%"), block, SHEET), "Billable"), "%%freeze 4 2%%", "yours on 🆓 time carries over");
    assert.equal(comments(write(old("", "%%default 1 2%%"), block, SHEET), "Billable"), "%%freeze 0 0%%", "so does an Unfreeze");
    assert.equal(comments(write(old("%%freeze 2 2%% %%custom%%", "%%freeze 4 2%% %%custom%%"), block, SHEET), "Billable"), "%%freeze 2 2%%", "both yours: Billable time's");
    assert.equal(tr.tablesIn(write(old(DEF, DEF), block, SHEET).split("\n")).length, 1, "one table now");
    // Date and Time are one column now, so a freeze of yours that reached Time ends at the same column
    assert.equal(comments(write(old("%%freeze 2 3%% %%custom%%", DEF), block, SHEET), "Billable"), "%%freeze 2 2%%", "status, Date and Time: status and Date / Time");
    assert.equal(comments(write(old("%%freeze 2 2%% %%custom%%", DEF), block, SHEET), "Billable"), "%%freeze 2 2%%", "status and Date: the same two");
    assert.equal(comments(write(old("%%freeze 2 4%% %%custom%%", DEF), block, SHEET), "Billable"), "%%freeze 2 3%%", "and one past Time keeps the column after");
});

test("a project note's two tables: the old default comes out of one, and yours stays on the other", () => {
    // A project note with time on its sub-project has two tables, By Project and By Week
    let note = oldDefault(write("## Time Report\n", project(SHOOT)));
    note = freezeRows(note, "By Week", 3);
    note = write(note, project(SHOOT));
    assert.equal(comments(note, "By Project"), "");
    assert.equal(comments(note, "By Week"), "%%freeze 3 1%%");
});

test("Unfreeze sticks, on a table at the old default and on one of yours, with or without Better Markdown Tables' default", () => {
    const fresh = write("", sheet(modelOf(NOTES)), SHEET);
    const atDefault = oldDefault(fresh, OLD_SHEET);
    const yours = write(command(fresh, "Billable", { rows: 3, columns: 1 }), sheet(modelOf(NOTES)), SHEET);
    assert.equal(comments(yours, "Billable"), "%%freeze 3 1%%");
    // At the old default, Unfreeze takes the mark out and leaves the label, or writes 0 0 over the mark
    for (const keep of [false, true]) {
        let note = command(atDefault, "Billable", UNFROZEN, { keep });
        assert.equal(comments(note, "Billable"), keep ? "%%freeze 0 0%% %%default 1 2%%" : "%%default 1 2%%");
        note = write(note, sheet(modelOf(NOTES)), SHEET);
        assert.equal(comments(note, "Billable"), "%%freeze 0 0%%", "unfrozen, not back to a default");
        assert.equal(comments(write(note, sheet(modelOf(MORE)), SHEET), "Billable"), "%%freeze 0 0%%", "and it stays so");
    }
    // Yours: with Better Markdown Tables' default on, its 0 0 stays; with none, nothing is left, as on a new table
    assert.equal(comments(write(command(yours, "Billable", UNFROZEN, { keep: true }), sheet(modelOf(NOTES)), SHEET), "Billable"), "%%freeze 0 0%%");
    assert.equal(comments(write(command(yours, "Billable", UNFROZEN), sheet(modelOf(NOTES)), SHEET), "Billable"), "");
});

test("deleting a table's mark gives it back to Better Markdown Tables' default", () => {
    let note = write(command(oldDefault(write("", sheet(modelOf(NOTES)), SHEET), OLD_SHEET), "Billable", UNFROZEN), sheet(modelOf(NOTES)), SHEET);
    assert.equal(comments(note, "Billable"), "%%freeze 0 0%%");
    note = write(note.replace("%%freeze 0 0%% ", ""), sheet(modelOf(NOTES)), SHEET);
    assert.equal(comments(note, "Billable"), "");
});

test("tables match by heading, so a table that appears doesn't take another's freeze", () => {
    let note = write("## Time Report\n", project(NOTES));
    assert.deepEqual(headers(note).map(([h]) => h), ["### By Week"]);
    note = write(command(note, "By Week", { rows: 2, columns: 1 }), project(NOTES));
    assert.equal(comments(note, "By Week"), "%%freeze 2 1%%");
    // Time logged to a sub-project brings By Project in, above By Week
    note = write(note, project(SHOOT));
    assert.deepEqual(headers(note).map(([h]) => h), ["### By Project", "### By Week"]);
    assert.equal(comments(note, "By Project"), "");
    assert.equal(comments(note, "By Week"), "%%freeze 2 1%%");
});

test("a table of yours outside the block is never read or touched", () => {
    const outside = "| %%freeze 3 3%% %%default 3 3%% Mine | B |\n| --- | --- |\n| 1 | 2 |\n\n";
    const note = write(oldDefault(outside + write("", sheet(modelOf(NOTES)), SHEET), OLD_SHEET, "Billable"), sheet(modelOf(NOTES)), SHEET);
    assert.ok(note.startsWith(outside));
    assert.equal(comments(note, "Billable"), "");
});

test("a weekly note's tables, each under its own heading, all lose the old default", () => {
    const block = tr.render(modelOf(NOTES), { kind: "period", unit: "week", key: tr.weekKey("2026-09-01") }, "s");
    const note = write(oldDefault(write("## Time Report\n", block)), block);
    assert.deepEqual(headers(note).map(([h, row]) => [h, segments(row)[0].trim()]), [
        ["### Earnings", "Project"],
        ["### Hours", "Project"],
    ]);
});

// ------------------------------------------------------------------ invoices

const DATA = (more = {}) => ({
    id: "2026090312000000", name: "1001-HBR", status: "draft",
    parent: "[[Harbor Web|Harbor Web]]", clientLink: "Harbor Co", billToLink: "Harbor Co",
    invoiceDate: "2026-09-03", periodStart: "2026-09-01", periodEnd: "2026-09-02",
    from: { name: "Juniper Hale", address: ["418 Larkspur Lane"] }, billTo: { name: "Harbor Co", address: ["1 Dock Street"] },
    projectId: "", requestedBy: "", terms: "Net 30", paymentNote: "Please pay within 30 days.",
    billed: billing.snapshot(modelOf(NOTES).entries.filter((e) => e.billable), modelOf(NOTES), tr), linkText: (p) => tr.basename(p), ...more,
});
// What rebuild() hands body(): the freezes the draft's tables hold now
const freezesOf = (text) => tr.freezesIn(inv.split(text).body.split(/\r?\n/));

test("a new invoice's two tables carry no freeze", () => {
    const text = inv.noteText(DATA(), tr, billing);
    assert.ok(!/%%(?:freeze|default|custom)/.test(text), text);
    assertPadded(text);
});

test("Rebuild: the report's old default comes out of an invoice's tables, yours stays, and Billing still reads its Billed entries", () => {
    const plainText = inv.noteText(DATA(), tr, billing);
    const before = freezeRows(oldDefault(plainText), "Billed entries", 4);
    assert.equal(comments(before, "Billable hours"), "%%freeze 1 1%% %%default 1 1%%");
    assert.equal(comments(before, "Billed entries"), "%%freeze 4 1%% %%default 1 1%%");
    const rebuilt = inv.noteText(DATA({ freezes: freezesOf(before) }), tr, billing);
    assert.equal(comments(rebuilt, "Billable hours"), "");
    assert.equal(comments(rebuilt, "Billed entries"), "%%freeze 4 1%%");
    assertPadded(rebuilt);
    // Billed entries read as billed with the old comments, with yours, and with none
    for (const text of [before, rebuilt]) {
        const read = billing.readBilled(text, tr), unmarked = billing.readBilled(plainText, tr);
        assert.equal(read.head, true, "the header still reads as Billed entries' columns");
        assert.deepEqual(plain(read.bad), []);
        assert.deepEqual(plain(read.rows), plain(unmarked.rows));
        assert.ok(read.rows.length > 0);
    }
    // The descriptions Rebuild keeps read from the line items' body rows, which carry no comments
    assert.deepEqual([...inv.descriptions(before, billing)], [...inv.descriptions(plainText, billing)]);
});

test("Billing reads a Billed entries header with a mark typed in any cell, or a comment of your own", () => {
    const text = inv.noteText(DATA(), tr, billing);
    const head = text.split("\n").find((l) => /^\| Date +\| Time/.test(l));
    for (const edited of [
        text.replace(head, head.replace("| Date ", "| %% freeze 2 1 %% Date ")),
        text.replace(head, head.replace(/ \|$/, " %%freeze 1 1%% %%custom%% |")),
        text.replace(head, head.replace("| Task ", "| %%my note%% Task ")),
    ]) {
        assert.notEqual(edited, text);
        const read = billing.readBilled(edited, tr);
        assert.equal(read.head, true, edited.split("\n").find((l) => l.includes("| Notes")));
        assert.deepEqual(plain(read.rows), plain(billing.readBilled(text, tr).rows));
    }
});

test("only an invoice's own two tables are rewritten: a table in the payment note is left as written, odd rows and all", () => {
    const paymentNote = "Pay to:\n\n| %%freeze 1 1%% %%default 1 1%% Bank | Account |\n| --- | --- |\n| Example Bank | 000-111 | (checking) |";
    const text = inv.noteText(DATA({ paymentNote }), tr, billing);
    assert.ok(text.includes(paymentNote.split("\n\n")[1]));
    // Rebuilt, the line items still match their own old table, not the payment note's
    const rebuilt = inv.noteText(DATA({ paymentNote, freezes: freezesOf(freezeRows(text, "Billable hours", 2)) }), tr, billing);
    assert.equal(comments(rebuilt, "Billable hours"), "%%freeze 2 0%%");
    assert.ok(rebuilt.includes(paymentNote.split("\n\n")[1]));
});

test("an invoice made before this reads the same: a billed task quoting a freeze comment isn't a wording change", () => {
    // Before OBS-238 defuse escaped `%%custom%%` too, so an invoice made then stored it with zero-width spaces
    const task = "Document the `%%custom%%` label";
    const before = "Document the `%​%custom%​%` label";
    assert.notEqual(billing.stored(tr, task), before);
    assert.ok(billing.readsAs(tr, task, before));
    assert.ok(!billing.readsAs(tr, "Document the label", before), "a real change in wording still counts");
});

// ------------------------------------------------------------------ writing to an open note

// A note open in an editor, as the scripts use one, with Better Markdown Tables' edit guard: while a cell is
// selected, the note's selection covers its whole table, and any change touching that selection is dropped,
// whatever sent it (the plugin's decide.ts, stopsEdit). `guard: "all"` drops every change, for another
// plugin that refuses for reasons of its own. Offsets map the way CodeMirror maps a selection.
function openEditor(text, { selection = [0, 0], guard = "cell" } = {}) {
    let value = text, [anchor, head] = selection;
    const posOf = (o) => { const lines = value.slice(0, o).split("\n"); return { line: lines.length - 1, ch: lines.at(-1).length }; };
    const offOf = ({ line, ch }) => value.split("\n").slice(0, line).reduce((n, l) => n + l.length + 1, 0) + ch;
    const editor = {
        moved: 0,
        getValue: () => value,
        posToOffset: offOf, offsetToPos: posOf,
        listSelections: () => [{ anchor: posOf(anchor), head: posOf(head) }],
        getCursor: (which = "head") => posOf(which === "anchor" ? anchor : head),
        setCursor(pos) { anchor = head = offOf(pos); editor.moved++; },
        replaceRange(t, from, to = from) {
            const s = offOf(from), e = offOf(to), lo = Math.min(anchor, head), hi = Math.max(anchor, head);
            if (guard === "all" || (guard === "cell" && lo !== hi && s <= hi && e >= lo)) return;
            value = value.slice(0, s) + t + value.slice(e);
            const map = (o) => (o <= s ? o : o >= e ? o + t.length - (e - s) : s + t.length);
            [anchor, head] = [map(anchor), map(head)];
        },
        get selection() { return [anchor, head]; },
    };
    return editor;
}
// The span of the table under the heading that includes `match`, as Better Markdown Tables selects it: [from, to]
function tableSpan(text, match) {
    const lines = text.split("\n");
    const t = tr.tablesIn(lines).find((x) => x.heading.includes(match));
    const from = lines.slice(0, t.at).reduce((n, l) => n + l.length + 1, 0);
    return [from, from + lines.slice(t.at, t.end + 1).join("\n").length];
}
// TimeReport and Invoice in a sandbox whose workspace has `editor` open on `file`; notices are kept
function withOpenNote(file, editor) {
    const notices = [];
    const context = vm.createContext({
        plainday: withDates({}), app: { workspace: { getLeavesOfType: () => [{ view: { file, editor } }] } },
        Notice: class { constructor(message) { notices.push(message); } },
    });
    const make = (file, name) => new (vm.runInContext(classScript(`${file}`) + `\n;${name}`, context))();
    return { tr: make("timeReport.js", "TimeReport"), inv: make("invoice.js", "Invoice"), notices };
}

test("Unfreeze leaves a cell selected: the report names the open timesheet instead of counting it, and moves nothing", async () => {
    const block = sheet(modelOf(NOTES));
    const atDefault = oldDefault(write("", block, SHEET), OLD_SHEET);
    // Unfreeze table on Billable time at the old default: the mark goes, the label stays, and the cell stays selected
    const unfrozen = command(atDefault, "Billable", UNFROZEN);
    const selection = tableSpan(unfrozen, "Billable");
    const editor = openEditor(unfrozen, { selection });
    const file = { path: "sheet.md" };
    const { tr: open } = withOpenNote(file, editor);
    const r = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false });
    assert.equal(r.heldBack, true);
    assert.ok(r.error);
    assert.equal(editor.getValue(), unfrozen, "the plugin kept the change out");
    assert.equal(editor.moved, 0);
    assert.deepEqual(editor.selection, selection, "the selected cell is left as it was");
    // Click outside the table, run again: the change goes in
    editor.setCursor(editor.offsetToPos(0));
    const again = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false });
    assert.equal(again.wrote, true);
    assert.equal(comments(editor.getValue(), "Billable"), "%%freeze 0 0%%");
});

test("a caret, or a selection outside what the report rewrites, stays where it is", async () => {
    const block = sheet(modelOf(NOTES));
    const note = `My own line above\n\n${command(oldDefault(write("", block, SHEET), OLD_SHEET), "Billable", UNFROZEN)}`;
    const file = { path: "sheet.md" };
    for (const selection of [[3, 3], [0, 6]]) {
        const editor = openEditor(note, { selection });
        const { tr: open } = withOpenNote(file, editor);
        const r = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false });
        assert.equal(r.wrote, true, String(selection));
        assert.equal(editor.moved, 0, String(selection));
        assert.deepEqual(editor.selection, selection, String(selection));
    }
});

test("an open note that refuses the change is named, not counted as written", async () => {
    const block = sheet(modelOf(NOTES));
    const note = command(oldDefault(write("", block, SHEET), OLD_SHEET), "Billable", UNFROZEN);
    const editor = openEditor(note, { guard: "all" });
    const file = { path: "sheet.md" };
    const { tr: open } = withOpenNote(file, editor);
    const r = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false });
    assert.equal(r.heldBack, true);
    assert.ok(r.error);
    assert.equal(editor.getValue(), note);
    // Nothing to write is still nothing, refused or not
    const done = openEditor(write("", block, SHEET), { guard: "all" });
    const { tr: open2 } = withOpenNote(file, done);
    assert.deepEqual(plain(await open2.writeBlock(file, block, { onlyIfChanged: true, heading: false })), { wrote: false, inserted: false });
});

test("Invoice's write to an open invoice: around a selected cell it goes in; into that table it's named, not lost", async () => {
    const before = "---\ninvoice_status: draft\n---\n\n## Billed entries\n\n| Date | Hours |\n| ---- | ----: |\n| 9/1  |  1.50 |\n";
    const file = { path: "1001-HBR.md" };
    const table = [before.indexOf("| Date"), before.length - 1];
    // Its status, outside the selected table
    const sent = before.replace("draft", "sent");
    const a = withOpenNote(file, openEditor(before, { selection: table }));
    assert.equal(await a.inv.write(file, before, sent, a.tr), true);
    // A change to the selected table: the plugin keeps it out, and Invoice says so
    const editor = openEditor(before, { selection: table });
    const b = withOpenNote(file, editor);
    assert.equal(await b.inv.write(file, before, before.replace("1.50", "2.00"), b.tr), false);
    assert.equal(editor.getValue(), before);
    assert.deepEqual(editor.selection, table);
    assert.match(b.notices.join("\n"), /didn't take the change/);
});
