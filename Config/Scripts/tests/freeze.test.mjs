// Freezing the tables the system writes, for the Selectable Tables plugin (OBS-238): a default from Table
// Settings, labeled `%%default R C%%`, and a freeze you set yourself, labeled `%%custom%%`, kept through
// every rewrite. Every project, entry and amount here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { obsidianPadded, segments, tablesIn as spans } from "./tables.mjs";

const here = new URL(".", import.meta.url);
const load = (file, name) => vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8") + `\n;${name}`, vm.createContext({}));
const TimeReport = load("timeReport.js", "TimeReport");
const tr = new TimeReport();
const billing = new (load("billing.js", "Billing"))();
const inv = new (load("invoice.js", "Invoice"))();
const UpdateObsidianPM = load("updateObsidianPM.js", "UpdateObsidianPM");
const plain = (x) => JSON.parse(JSON.stringify(x));

const ON = { rows: 1, columns: 1 };
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

// A report run's write of `block` into `content`, as writeBlock plans it
function write(content, block, tables, opts = {}) {
    const edits = tr.blockEdits(content, block, { onlyIfChanged: true, tables, ...opts });
    assert.ok(!edits.error, edits.error);
    return edits.reduce((c, e) => c.slice(0, e.start) + e.text + c.slice(e.end), content);
}
const sheet = (model) => tr.render(model, { kind: "timesheet", path: WEB }, "s");
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

// Selectable Tables' commands, as its freeze-mark.ts writes the mark (withFreeze): over the first mark, or at
// the start of the first cell with none; freezing nothing takes every mark out, each with the spaces after it.
// Other comments in the cell stay. (The plugin also pads the table again; the report rewrites it anyway.)
const MARK = /%%\s*freeze\s+\d+\s+\d+\s*%%/;
function command(text, match, freeze) {
    const lines = text.split("\n");
    const t = tr.tablesIn(lines).find((x) => x.heading.includes(match));
    let row = lines[t.at];
    if (!freeze.rows && !freeze.columns) row = row.replace(new RegExp(`${MARK.source}[ \\t]*`, "g"), "");
    else if (MARK.test(row)) row = row.replace(MARK, `%%freeze ${freeze.rows} ${freeze.columns}%%`);
    else row = row.replace(/^\|\s?/, `| %%freeze ${freeze.rows} ${freeze.columns}%% `);
    lines[t.at] = row;
    return lines.join("\n");
}
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

test("table: the freeze comments go at the start of the first cell, and its column is padded for them as Obsidian pads it", () => {
    const sheetLines = tr.table(["", "Date", "Hours"], ["center", null, "right"], [["✅", "**9/1**", "1.50"], ["⚠️", "", "0.25"]],
        { freeze: "%%freeze 1 2%% %%default 1 2%%" });
    assert.deepEqual([...sheetLines], [
        "| %%freeze 1 2%% %%default 1 2%% | Date    | Hours |",
        "| :----------------------------: | ------- | ----: |",
        "|               ✅                | **9/1** |  1.50 |",
        "|               ⚠️               |         |  0.25 |",
    ]);
    const named = [...tr.table(["Project", "Total"], [null, "right"], [["[[Harbor Web]]", "2.00"]], { freeze: "%%freeze 1 1%% %%custom%%" })];
    assert.equal(named[0], "| %%freeze 1 1%% %%custom%% Project | Total |");
    for (const lines of [[...sheetLines], named]) {
        assert.deepEqual(lines, obsidianPadded(lines));
        assert.deepEqual(lines.map((l) => tr.defuse(l)), lines, "the report's own defusing changes nothing");
    }
});

// ------------------------------------------------------------------ whose freeze it is

test("freezeHeader: nothing in the header, so the default and its label, or nothing when it's off", () => {
    assert.equal(tr.freezeHeader(null, ON, ["Project"]), "%%freeze 1 1%% %%default 1 1%%");
    assert.equal(tr.freezeHeader(tr.freezeOf("| Project | Total |"), ON, ["Project"]), "%%freeze 1 1%% %%default 1 1%%");
    assert.equal(tr.freezeHeader(null, null, ["Project"]), "");
});

test("freezeHeader: a freeze that still matches its default label follows the setting", () => {
    const old = tr.freezeOf("| %%freeze 1 1%% %%default 1 1%% Project | Total |");
    assert.equal(tr.freezeHeader(old, ON, ["Project"]), "%%freeze 1 1%% %%default 1 1%%");
    assert.equal(tr.freezeHeader(old, { rows: 2, columns: 1 }, ["Project"]), "%%freeze 2 1%% %%default 2 1%%");
    assert.equal(tr.freezeHeader(old, null, ["Project"]), "", "clearing the default takes it out");
});

test("freezeHeader: a freeze that differs from its default label was changed with a command, so it's yours", () => {
    const old = tr.freezeOf("| %%freeze 3 1%% %%default 1 1%% Project | Total |");
    assert.equal(tr.freezeHeader(old, ON, ["Project"]), "%%freeze 3 1%% %%custom%%");
    assert.equal(tr.freezeHeader(old, null, ["Project"]), "%%freeze 3 1%% %%custom%%");
});

test("freezeHeader: a default label with no freeze was unfrozen, so it stays unfrozen", () => {
    assert.equal(tr.freezeHeader(tr.freezeOf("| %%default 1 1%% Project | Total |"), ON, ["Project"]), "%%freeze 0 0%% %%custom%%");
});

test("freezeHeader: a freeze labeled custom stays as it is, whatever the default", () => {
    const old = tr.freezeOf("| %%freeze 2 2%% %%custom%% Project | Total |");
    for (const settings of [ON, { rows: 4, columns: 0 }, null]) assert.equal(tr.freezeHeader(old, settings, ["Project"]), "%%freeze 2 2%% %%custom%%");
});

test("freezeHeader: custom with no freeze is your own freeze taken off", () => {
    assert.equal(tr.freezeHeader(tr.freezeOf("| %%custom%% Project | Total |"), ON, ["Project"]), "%%freeze 0 0%% %%custom%%");
});

test("freezeHeader: a freeze with no label was typed, so it's yours, written as the plugin writes it", () => {
    assert.equal(tr.freezeHeader(tr.freezeOf("| %% freeze 2 1 %% Project | Total |"), ON, ["Project"]), "%%freeze 2 1%% %%custom%%");
    assert.equal(tr.freezeHeader(tr.freezeOf("| Project | Total %%freeze 0 0%% |"), ON, ["Project"]), "%%freeze 0 0%% %%custom%%", "in any cell");
});

test("freezeOf reads the header as Selectable Tables does: the first mark counts, and one in code is text", () => {
    assert.deepEqual(plain(tr.freezeOf("| %%freeze 2 1%% A | %%freeze 5 5%% B |").mark), { rows: 2, columns: 1 });
    assert.deepEqual(plain(tr.freezeOf("| `%%freeze 2 1%%` A | B |")), { mark: null, label: null });
    assert.deepEqual(plain(tr.freezeOf("| %%freeze 1 2%% %%default 1 2%% | Date |")), { mark: { rows: 1, columns: 2 }, label: { kind: "default", rows: 1, columns: 2 } });
});

test("freezeDefault: freeze_columns counts from the first named column, so a status column comes along", () => {
    assert.deepEqual(plain(tr.freezeDefault(ON, ["", "Date", "Time"])), { rows: 1, columns: 2 });
    assert.deepEqual(plain(tr.freezeDefault(ON, ["Project", "Total"])), { rows: 1, columns: 1 });
    assert.deepEqual(plain(tr.freezeDefault({ rows: 1, columns: 0 }, ["", "Date"])), { rows: 1, columns: 0 }, "no columns frozen, so the status column alone isn't");
    assert.deepEqual(plain(tr.freezeDefault({ rows: 0, columns: 9 }, ["", "Date"])), { rows: 0, columns: 9 }, "at most 9, as Selectable Tables freezes");
    assert.equal(tr.freezeDefault(null, ["Project"]), null);
});

test("tableSettingsOf: whole numbers, blank or 0 for off, anything else counts as 0", () => {
    assert.equal(tr.tableSettingsOf({}), null);
    assert.equal(tr.tableSettingsOf(undefined), null);
    assert.equal(tr.tableSettingsOf({ freeze_rows: null, freeze_columns: "" }), null);
    assert.equal(tr.tableSettingsOf({ freeze_rows: 0, freeze_columns: 0 }), null);
    assert.deepEqual(plain(tr.tableSettingsOf({ freeze_rows: 1, freeze_columns: 1 })), ON);
    assert.deepEqual(plain(tr.tableSettingsOf({ freeze_rows: "2", freeze_columns: 0 })), { rows: 2, columns: 0 });
    assert.deepEqual(plain(tr.tableSettingsOf({ freeze_rows: -1, freeze_columns: 1.5 })), null);
    assert.deepEqual(plain(tr.tableSettingsOf({ freeze_rows: "a lot", freeze_columns: 12 })), { rows: 0, columns: 9 });
    assert.equal(tr.tableSettingsOf({ freeze_rows: true, freeze_columns: [1] }), null, "a checkbox or a list isn't a number");
});

test("withFreezes leaves a table alone when a row has more cells than its columns, rather than stop", () => {
    const lines = ["## Billable hours", "", "| Line item | Qty |", "| --- | --: |", "| 9/1 — Fix a \\\\| b | 1.00 | 2.00 |"];
    assert.deepEqual([...tr.withFreezes(lines, new Map(), ON)], lines);
});

// ------------------------------------------------------------------ a report run

test("a timesheet comes out frozen at the default, padded as Obsidian pads it, and the next run writes nothing", () => {
    const block = sheet(modelOf(NOTES));
    const note = write("", block, ON, SHEET);
    assert.equal(comments(note, "Billable"), "%%freeze 1 2%% %%default 1 2%%");
    assert.equal(comments(note, "🆓"), "%%freeze 1 2%% %%default 1 2%%");
    const lines = note.split("\n");
    for (const t of spans(lines)) assert.deepEqual(lines.slice(t.from, t.to + 1), obsidianPadded(lines.slice(t.from, t.to + 1)));
    // The comments close on their own line, so the block reads as it did: one block, nothing unclosed
    const read = tr.scan(lines);
    assert.deepEqual(plain(read.unclosed), []);
    assert.equal(read.blocks.length, 1);
    assert.ok(tr.sameBlock(note, tr.freezeBlock(block, note, ON)));
    assert.deepEqual(plain(tr.blockEdits(note, block, { tables: ON, heading: false })), [], "the next run changes nothing");
    assert.equal(write(note, block, null, SHEET), write("", block, null, SHEET), "and with the default off, it's as it was before OBS-238");
});

test("with the default off and no freeze in the note, a block is written exactly as before", () => {
    const block = sheet(modelOf(NOTES));
    assert.equal(tr.freezeBlock(block, "", null), block);
    assert.equal(tr.freezeBlock(block, write("", block, null, SHEET), null), block);
});

test("your freeze survives a rewrite, and the report labels it custom", () => {
    let note = write("", sheet(modelOf(NOTES)), ON, SHEET);
    note = freezeRows(note, "Billable", 3);
    assert.equal(comments(note, "Billable"), "%%freeze 3 2%% %%default 1 2%%", "the command writes over the mark, and the label stays");
    note = write(note, sheet(modelOf(MORE)), ON, SHEET);
    assert.ok(note.includes("Thu 9/3") && note.includes("Billable time: 3.50 hrs"), "the timesheet took the new entry, and its heading's total changed");
    assert.equal(comments(note, "Billable"), "%%freeze 3 2%% %%custom%%");
    assert.equal(comments(note, "🆓"), "%%freeze 1 2%% %%default 1 2%%");
});

test("changing the default changes only the tables still at the default, and clearing it takes them out", () => {
    let note = write("", sheet(modelOf(NOTES)), ON, SHEET);
    note = write(freezeRows(note, "Billable", 3), sheet(modelOf(NOTES)), ON, SHEET);
    note = write(note, sheet(modelOf(NOTES)), { rows: 1, columns: 2 }, SHEET);
    assert.equal(comments(note, "🆓"), "%%freeze 1 3%% %%default 1 3%%");
    assert.equal(comments(note, "Billable"), "%%freeze 3 2%% %%custom%%");
    note = write(note, sheet(modelOf(NOTES)), null, SHEET);
    assert.equal(comments(note, "🆓"), "");
    assert.equal(comments(note, "Billable"), "%%freeze 3 2%% %%custom%%");
});

test("Unfreeze sticks, on a table at the default and on one of yours", () => {
    let note = write("", sheet(modelOf(NOTES)), ON, SHEET);
    note = freezeRows(note, "Billable", 3);
    note = command(command(note, "🆓", { rows: 0, columns: 0 }), "Billable", { rows: 0, columns: 0 });
    assert.equal(comments(note, "🆓"), "%%default 1 2%%", "Unfreeze takes the mark out and leaves the label");
    note = write(note, sheet(modelOf(NOTES)), ON, SHEET);
    assert.equal(comments(note, "🆓"), "%%freeze 0 0%% %%custom%%");
    assert.equal(comments(note, "Billable"), "%%freeze 0 0%% %%custom%%");
    note = write(note, sheet(modelOf(NOTES)), { rows: 2, columns: 2 }, SHEET);
    assert.equal(comments(note, "🆓"), "%%freeze 0 0%% %%custom%%", "a new default doesn't freeze it again");
});

test("deleting both comments gives a table back to the default", () => {
    let note = write("", sheet(modelOf(NOTES)), ON, SHEET);
    note = write(command(note, "Billable", { rows: 0, columns: 0 }), sheet(modelOf(NOTES)), ON, SHEET);
    assert.equal(comments(note, "Billable"), "%%freeze 0 0%% %%custom%%");
    note = note.replace("%%freeze 0 0%% %%custom%%", "");
    note = write(note, sheet(modelOf(NOTES)), { rows: 1, columns: 2 }, SHEET);
    assert.equal(comments(note, "Billable"), "%%freeze 1 3%% %%default 1 3%%");
});

test("tables match by heading, so a table that appears doesn't take another's freeze", () => {
    const project = (notes) => tr.render(modelOf(notes), { kind: "project", path: WEB }, "s");
    let note = write("## Time Report\n", project(NOTES), ON);
    assert.deepEqual(headers(note).map(([h]) => h), ["### By Week"]);
    note = write(command(note, "By Week", { rows: 2, columns: 1 }), project(NOTES), ON);
    assert.equal(comments(note, "By Week"), "%%freeze 2 1%% %%custom%%");
    // Time logged to a sub-project brings By Project in, above By Week
    note = write(note, project([...NOTES, day("2026-09-03", "- [x] Shoot [[Harbor Photos|⭕]]\n\t- 1:00pm - 2:00pm")]), ON);
    assert.deepEqual(headers(note).map(([h]) => h), ["### By Project", "### By Week"]);
    assert.equal(comments(note, "By Project"), "%%freeze 1 1%% %%default 1 1%%");
    assert.equal(comments(note, "By Week"), "%%freeze 2 1%% %%custom%%");
});

test("a table of yours outside the block is never read or touched", () => {
    const outside = "| %%freeze 3 3%% Mine | B |\n| --- | --- |\n| 1 | 2 |\n\n";
    const note = write(outside, sheet(modelOf(NOTES)), ON, SHEET);
    assert.ok(note.startsWith(outside));
    assert.equal(comments(note, "Billable"), "%%freeze 1 2%% %%default 1 2%%");
});

test("a weekly note's tables, each under its own heading, all get the default", () => {
    const block = tr.render(modelOf(NOTES), { kind: "period", unit: "week", key: tr.weekKey("2026-09-01") }, "s");
    const note = write("## Time Report\n", block, ON);
    assert.deepEqual(headers(note).map(([h, row]) => [h, segments(row)[0].trim()]), [
        ["### Earnings", "%%freeze 1 1%% %%default 1 1%% Project"],
        ["### Hours", "%%freeze 1 1%% %%default 1 1%% Project"],
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

test("an invoice's two tables come out frozen, and Billing still reads its Billed entries", () => {
    const text = inv.noteText(DATA({ tables: ON }), tr, billing);
    assert.equal(comments(text, "Billable hours"), "%%freeze 1 1%% %%default 1 1%%");
    assert.equal(comments(text, "Billed entries"), "%%freeze 1 1%% %%default 1 1%%");
    const plainText = inv.noteText(DATA(), tr, billing);
    assert.ok(!plainText.includes("%%freeze"), "off by default");
    const marked = billing.readBilled(text, tr), unmarked = billing.readBilled(plainText, tr);
    assert.equal(marked.head, true, "the header still reads as Billed entries' columns");
    assert.deepEqual(plain(marked.bad), []);
    assert.deepEqual(plain(marked.rows), plain(unmarked.rows));
    assert.ok(marked.rows.length > 0);
    // The descriptions Rebuild keeps read from the line items' body rows, which carry no comments
    assert.deepEqual([...inv.descriptions(text, billing)], [...inv.descriptions(plainText, billing)]);
    const lines = text.split("\n");
    for (const t of spans(lines)) assert.deepEqual(lines.slice(t.from, t.to + 1), obsidianPadded(lines.slice(t.from, t.to + 1)));
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

test("only an invoice's own two tables are frozen: a table in the payment note is left as written, odd rows and all", () => {
    const paymentNote = "Pay to:\n\n| Bank | Account |\n| --- | --- |\n| Example Bank | 000-111 | (checking) |";
    const text = inv.noteText(DATA({ tables: ON, paymentNote }), tr, billing);
    assert.ok(text.includes("| Bank | Account |\n| --- | --- |\n| Example Bank | 000-111 | (checking) |"));
    assert.equal(comments(text, "Billable hours"), "%%freeze 1 1%% %%default 1 1%%");
    assert.equal(comments(text, "Billed entries"), "%%freeze 1 1%% %%default 1 1%%");
    // Rebuilt, the line items still match their own old table, not the payment note's
    const freezes = tr.freezesIn(freezeRows(text, "Billable hours", 2).split("\n"));
    assert.equal(comments(inv.noteText(DATA({ tables: ON, paymentNote, freezes }), tr, billing), "Billable hours"), "%%freeze 2 1%% %%custom%%");
});

test("an invoice made before this reads the same: a billed task quoting a freeze comment isn't a wording change", () => {
    // Before OBS-238 defuse escaped `%%custom%%` too, so an invoice made then stored it with zero-width spaces
    const task = "Document the `%%custom%%` label";
    const before = "Document the `%\u200B%custom%\u200B%` label";
    assert.notEqual(billing.stored(tr, task), before);
    assert.ok(billing.readsAs(tr, task, before));
    assert.ok(!billing.readsAs(tr, "Document the label", before), "a real change in wording still counts");
});

test("Rebuild keeps the freeze you set on an invoice's table, and the other follows the default", () => {
    let text = inv.noteText(DATA({ tables: ON }), tr, billing);
    text = freezeRows(text, "Billed entries", 4);
    // What rebuild() hands body(): the freezes the draft's tables hold now
    const freezes = tr.freezesIn(inv.split(text).body.split(/\r?\n/));
    const rebuilt = inv.noteText(DATA({ tables: { rows: 2, columns: 1 }, freezes }), tr, billing);
    assert.equal(comments(rebuilt, "Billed entries"), "%%freeze 4 1%% %%custom%%");
    assert.equal(comments(rebuilt, "Billable hours"), "%%freeze 2 1%% %%default 2 1%%");
    assert.equal(billing.readBilled(rebuilt, tr).head, true);
});

// ------------------------------------------------------------------ installing

test("UpdateObsidianPM installs Table Settings when the vault has none, and then leaves it alone", () => {
    const up = new UpdateObsidianPM();
    const PATH = "Config/Table Settings.md";
    assert.ok(up.installs(PATH));
    const source = new Map([[PATH, "repo"], ["Config/Scripts/CustomJS/timeReport.js", "s1"]]);
    const listed = (plan) => Object.entries(plain(plan)).filter(([, paths]) => paths.some?.((p) => p === PATH || p?.to === PATH)).map(([k]) => k);
    assert.deepEqual(listed(up.plan(source, new Map())), ["add"]);
    assert.deepEqual(listed(up.plan(source, new Map([[PATH, "yours"]]), new Map([[PATH, "repo"]]))), [], "changed by you: not updated, not listed");
    assert.deepEqual(listed(up.plan(source, new Map([[PATH, "yours"]]))), [], "on a first run too");
    assert.deepEqual(listed(up.plan(source, new Map([[PATH, "old"]]), new Map([[PATH, "old"]]))), [], "an older copy you never changed stays too");
    assert.deepEqual(listed(up.plan(new Map([[PATH, "repo"]]), new Map([[PATH, "repo"]]))), []);
    // Should the repository ever drop it, the vault's own stays: not removed, not listed
    const dropped = new Map([["Config/Scripts/CustomJS/timeReport.js", "s1"]]);
    for (const vault of ["repo", "yours"]) assert.deepEqual(listed(up.plan(dropped, new Map([[PATH, vault]]), new Map([[PATH, "repo"]]))), [], vault);
});

// ------------------------------------------------------------------ writing to an open note

// A note open in an editor, as the scripts use one, with Selectable Tables' edit guard: while a cell is
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
// The span of the table under the heading that includes `match`, as Selectable Tables selects it: [from, to]
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
        app: { workspace: { getLeavesOfType: () => [{ view: { file, editor } }] } },
        Notice: class { constructor(message) { notices.push(message); } },
    });
    const make = (file, name) => new (vm.runInContext(fs.readFileSync(new URL(`../CustomJS/${file}`, here), "utf8") + `\n;${name}`, context))();
    return { tr: make("timeReport.js", "TimeReport"), inv: make("invoice.js", "Invoice"), notices };
}

test("Unfreeze leaves a cell selected: the report names the open timesheet instead of counting it, and moves nothing", async () => {
    const block = sheet(modelOf(NOTES));
    const atDefault = write("", block, ON, SHEET);
    // Unfreeze table on Billable time: the mark goes, the label stays, and the cell stays selected
    const unfrozen = command(atDefault, "Billable", { rows: 0, columns: 0 });
    const selection = tableSpan(unfrozen, "Billable");
    const editor = openEditor(unfrozen, { selection });
    const file = { path: "sheet.md" };
    const { tr: open } = withOpenNote(file, editor);
    const r = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false, tables: ON });
    assert.equal(r.heldBack, true);
    assert.ok(r.error);
    assert.equal(editor.getValue(), unfrozen, "the plugin kept the change out");
    assert.equal(editor.moved, 0);
    assert.deepEqual(editor.selection, selection, "the selected cell is left as it was");
    // Click outside the table, run again: the change goes in
    editor.setCursor(editor.offsetToPos(0));
    const again = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false, tables: ON });
    assert.equal(again.wrote, true);
    assert.equal(comments(editor.getValue(), "Billable"), "%%freeze 0 0%% %%custom%%");
});

test("a caret, or a selection outside what the report rewrites, stays where it is", async () => {
    const block = sheet(modelOf(NOTES));
    const note = `My own line above\n\n${command(write("", block, ON, SHEET), "Billable", { rows: 0, columns: 0 })}`;
    const file = { path: "sheet.md" };
    for (const selection of [[3, 3], [0, 6]]) {
        const editor = openEditor(note, { selection });
        const { tr: open } = withOpenNote(file, editor);
        const r = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false, tables: ON });
        assert.equal(r.wrote, true, String(selection));
        assert.equal(editor.moved, 0, String(selection));
        assert.deepEqual(editor.selection, selection, String(selection));
    }
});

test("an open note that refuses the change is named, not counted as written", async () => {
    const block = sheet(modelOf(NOTES));
    const note = command(write("", block, ON, SHEET), "Billable", { rows: 0, columns: 0 });
    const editor = openEditor(note, { guard: "all" });
    const file = { path: "sheet.md" };
    const { tr: open } = withOpenNote(file, editor);
    const r = await open.writeBlock(file, block, { onlyIfChanged: true, heading: false, tables: ON });
    assert.equal(r.heldBack, true);
    assert.ok(r.error);
    assert.equal(editor.getValue(), note);
    // Nothing to write is still nothing, refused or not
    const done = openEditor(write("", block, ON, SHEET), { guard: "all" });
    const { tr: open2 } = withOpenNote(file, done);
    assert.deepEqual(plain(await open2.writeBlock(file, block, { onlyIfChanged: true, heading: false, tables: ON })), { wrote: false, inserted: false });
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
