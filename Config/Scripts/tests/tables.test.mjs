// TimeReport.table, the one writer of every table the system writes (OBS-184): padded the way Obsidian's
// table editor pads a table, so that entering one changes nothing. tables.mjs holds a second reading of
// Obsidian's rule to check it against.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { obsidianPadded, shapeOf, segments, tablesIn } from "./tables.mjs";

const here = new URL(".", import.meta.url);
const TimeReport = vm.runInContext(fs.readFileSync(new URL("../../../plugin/src/classes/timeReport.js", here), "utf8") + "\n;TimeReport", vm.createContext({}));
const tr = new TimeReport();
const table = (head, align, rows) => [...tr.table(head, align, rows)];

test("table: each alignment, as Obsidian pads it", () => {
    assert.deepEqual(table(["Project", "Hours", "Mark", "Left"], [null, "right", "center", "left"], [["[[Harbor Web]]", "12.50", "✓", "a"]]), [
        "| Project        | Hours | Mark | Left |",
        "| -------------- | ----: | :--: | :--- |",
        "| [[Harbor Web]] | 12.50 |  ✓   | a    |",
    ]);
});

test("table: a column is at least 5 wide, so an empty heading's second row is :-:", () => {
    assert.deepEqual(table(["", "A"], ["center", "right"], [["", "1"], ["x", ""]]), [
        "|     |   A |",
        "| :-: | --: |",
        "|     |   1 |",
        "|  x  |     |",
    ]);
});

test("table: a centered cell splits its spaces, the extra one after", () => {
    assert.deepEqual(table(["Mark"], ["center"], [["ab"], ["abc"]]), ["| Mark |", "| :--: |", "|  ab  |", "| abc  |"]);
});

test("table: cells are measured as written: \\| as two characters, a link's whole source, bold marks", () => {
    const lines = table(["Day", "Hours"], [null, "right"], [["**[[2026-09-01\\|Tue 9/1]]**", "**1.50**"], ["", "1.50"]]);
    assert.deepEqual(lines, [
        "| Day                         |    Hours |",
        "| --------------------------- | -------: |",
        "| **[[2026-09-01\\|Tue 9/1]]** | **1.50** |",
        "|                             |     1.50 |",
    ]);
});

test("table: characters count as JavaScript counts them: ✅ 1, ⚠️ and 🆓 2, a Japanese character 1", () => {
    const lines = table(["", "Task"], ["center", null], [["✅", "日本語"], ["⚠️", "🆓 free"]]);
    assert.deepEqual(lines, [
        "|     | Task    |",
        "| :-: | ------- |",
        "|  ✅  | 日本語     |",
        "| ⚠️  | 🆓 free |",
    ]);
});

test("table: cells are trimmed, and a short row gets empty cells", () => {
    assert.deepEqual(table(["A", "B"], [null, null], [["  x  "], []]), ["| A   | B   |", "| --- | --- |", "| x   |     |", "|     |     |"]);
});

test("table: the same bytes Obsidian's table editor wrote for these tables (a fixture from Obsidian 1.15.1)", () => {
    // tables.obsidian.json holds what Obsidian itself made of compact tables: the edge cases (every
    // alignment, an empty heading, ✅, ⚠️, 🆓, 🕒, Japanese, `\|`, aliased links, bold) and a demo timesheet
    const { tables } = JSON.parse(fs.readFileSync(new URL("tables.obsidian.json", here), "utf8"));
    assert.ok(tables.length >= 4);
    for (const { note, compact, obsidian } of tables) {
        const { rows, alignments } = shapeOf(compact);
        assert.deepEqual(table(rows[0], alignments, rows.slice(1)), obsidian, note);
    }
});

test("table: whatever the cells, it's what Obsidian's rule writes, and its cells read back as given", () => {
    const words = ["", "a", "1.50", "**2.00**", "$1,200 flat", "–", "[[Note\\|alias]]", "✅", "⚠️", "🆓 time", "日本", "x \\| y", "**[[2026-09-01\\|Tue 9/1]]**", "a longer cell of text"];
    const aligns = [null, "left", "right", "center"];
    let seed = 7;
    const pick = (list) => list[(seed = (seed * 1103515245 + 12345) % 2147483648) % list.length];
    for (let n = 0; n < 300; n++) {
        const columns = 1 + (n % 6);
        const align = Array.from({ length: columns }, () => pick(aligns));
        const head = Array.from({ length: columns }, () => pick(words));
        const rows = Array.from({ length: n % 5 }, () => Array.from({ length: columns }, () => pick(words)));
        const lines = table(head, align, rows);
        assert.deepEqual(lines, obsidianPadded(lines), lines.join("\n"));
        const shape = shapeOf(lines);
        assert.deepEqual(shape.rows, [head, ...rows].map((r) => r.map((c) => c.trim())));
        assert.deepEqual(shape.alignments, align);
        assert.ok(lines.every((l) => segments(l).length === columns), "every row has the table's cells");
    }
});

test("table: a cell is defused before it's measured, so the report's own defusing changes nothing", () => {
    // The report defuses every line of its block, so a `%%` or `-->` in a task can't open a comment. Done
    // after the padding, that made the cell a character wider than its column, and Obsidian re-padded it.
    assert.equal(tr.defuse(tr.defuse("50%%% done --> <!-- <%")), tr.defuse("50%%% done --> <!-- <%"), "defusing twice is defusing once");
    assert.ok(!tr.defuse("%%%").includes("%%"));
    const project = "Projects/Web/Web.md";
    const index = tr.makeIndex([{ path: project, tags: ["project"] }]);
    const m = tr.build([{ date: "2026-09-01", path: "Reference/Planner/days/2026-09-01.md",
        text: "- [x] Move header --> footer [[Web|⭕]]\n\t- 9:00am - 9:50am: `50%%` done, `%%%` after\n- [x] Short [[Web|⭕]]\n\t- 10:00am - 11:00am" }], index);
    let checked = 0;
    for (const scope of [{ kind: "timesheet", path: project }, { kind: "project", path: project }]) {
        const lines = tr.render(m, scope, "s").split("\n");
        for (const t of tablesIn(lines)) {
            const table = lines.slice(t.from, t.to + 1);
            assert.deepEqual(table, obsidianPadded(table), table.join("\n"));
            checked++;
        }
    }
    assert.ok(checked >= 2);
});

test("table: a pipe after an escaped backslash is escaped too, so the cell doesn't split (OBS-184)", () => {
    assert.equal(tr.tableText(String.raw`x | y`), String.raw`x \| y`);
    assert.equal(tr.tableText(String.raw`x \| y`), String.raw`x \| y`, "an escaped pipe stays as it is");
    assert.equal(tr.tableText(String.raw`a\\|b`), String.raw`a\\\|b`, "two backslashes are one escaped backslash, then a pipe to escape");
    const cells = [String.raw`a\\|b`, "x | y", String.raw`x \| y`].map((t) => [tr.tableText(t)]);
    const lines = table(["Task"], [null], cells);
    assert.ok(lines.every((l) => segments(l).length === 1), lines.join("\n"));
    assert.deepEqual(lines, obsidianPadded(lines));
});

test("table: a row with more cells than the table has columns is a mistake, not a lost cell", () => {
    assert.throws(() => table(["A"], [null], [["1", "2"]]), /a row of 2 cells in a table of 1 columns/);
});

test("every table the system writes comes from TimeReport.table: no script builds a row by hand", () => {
    // Every script under Config/Scripts (Templater, Calendar) and in plugin/src (Plainday's own and the
    // class files). A row built by hand joins cells with " | ", or starts a string with "| " or "|${";
    // the writer's own lines are the only ones allowed
    const repo = new URL("../../../", here);
    const scripts = [];
    const walk = (dir) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
            if (d.isDirectory() && d.name !== "tests") walk(new URL(`${d.name}/`, dir));
            else if (d.name.endsWith(".js")) scripts.push(new URL(d.name, dir));
        }
    };
    walk(new URL("Config/Scripts/", repo));
    walk(new URL("plugin/src/", repo));
    assert.ok(scripts.some((u) => u.pathname.endsWith("plugin/src/classes/timeReport.js")), "the scan reaches the class files");
    assert.ok(scripts.some((u) => u.pathname.endsWith("Config/Scripts/Templater/recordEvent.js")), "and the Templater scripts");
    const found = [];
    for (const url of scripts) {
        const lines = fs.readFileSync(url, "utf8").split("\n");
        const from = lines.findIndex((l) => /^\s+table\(head, align, rows(?:, \{[^}]*\} = \{\})?\) \{$/.test(l));
        const to = from === -1 ? -1 : lines.findIndex((l, i) => i > from && /^    \}$/.test(l));
        lines.forEach((line, i) => {
            if (url.pathname.endsWith("plugin/src/classes/timeReport.js") && i >= from && i <= to) return;
            const code = line.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/\s.*$/, "");
            if (/join\(\s*["'`] \| ["'`]\s*\)|["'`]\|(?: |\$\{)/.test(code)) found.push(`${url.pathname.slice(repo.pathname.length)}:${i + 1}: ${line.trim()}`);
        });
    }
    assert.deepEqual(found, [], "build a table with TimeReport.table instead (CLAUDE.md, Tables in notes)");
});
