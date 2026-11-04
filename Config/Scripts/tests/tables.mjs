// Helpers for the tables the system writes (OBS-184).
//
// `obsidianPadded(lines)` writes a table's lines the way Obsidian's table editor does when the cursor
// enters it. It's a second reading of that rule, kept apart from TimeReport.table on purpose: it follows
// Selectable Tables' src/editor/table-text.ts (`padded`, `delimiter`, `written`), which was read from
// Obsidian 1.15's table widget and has held up in that plugin's in-Obsidian checks. A table the system
// writes must come back from it unchanged, or Obsidian would rewrite it and the time report would write
// it back again.
//
// `compactTable(lines)` reads a table back as `| a | b |`, with the second row as `---`, `:--`, `--:` or
// `:-:`, so tests about what a table says don't depend on its padding. `compactWriter(tr)` makes a
// TimeReport whose tables come out that way: the real writer runs, and its lines are read back.

const DASHES = /^\s*:?-+:?\s*$/;

// The text between a row's pipes, cell by cell, padding included. A `\` escapes the next character.
export function segments(text) {
    const row = text.trimEnd();
    const out = [];
    let from = row.length - row.trimStart().length;
    if (row[from] === "|") from++;
    for (let i = from; i < row.length; i++) {
        if (row[i] === "\\") i++;
        else if (row[i] === "|") { out.push(row.slice(from, i)); from = i + 1; }
    }
    if (from < row.length) out.push(row.slice(from));
    return out;
}

function alignmentOf(cell) {
    const c = cell.trim();
    if (c.startsWith(":")) return c.endsWith(":") ? "center" : "left";
    return c.endsWith(":") ? "right" : null;
}

function padded(text, width, alignment) {
    const space = width - text.length;
    const before = alignment === "right" ? space - 1 : alignment === "center" ? Math.floor(space / 2) : 1;
    return " ".repeat(before) + text + " ".repeat(space - before);
}

function delimiter(width, alignment) {
    if (alignment === "left") return ` :${"-".repeat(width - 3)} `;
    if (alignment === "center") return ` :${"-".repeat(width - 4)}: `;
    if (alignment === "right") return ` ${"-".repeat(width - 3)}: `;
    return ` ${"-".repeat(width - 2)} `;
}

// A table's cells (header first, the second row left out) and each column's alignment
export function shapeOf(lines) {
    const alignments = segments(lines[1] ?? "").map(alignmentOf);
    const rows = lines.filter((_, i) => i !== 1).map((line) => segments(line).map((c) => c.trim()));
    return { rows, alignments };
}

export function obsidianPadded(lines) {
    const { rows, alignments } = shapeOf(lines);
    const widths = alignments.map((_, c) => Math.max(5, ...rows.map((row) => (row[c]?.length ?? 0) + 2)));
    const row = (cells) => `|${cells.join("|")}|`;
    const out = rows.map((cells) => row(cells.map((text, c) => padded(text, widths[c], alignments[c]))));
    out.splice(1, 0, row(alignments.map((a, c) => delimiter(widths[c], a))));
    return out;
}

export function compactTable(lines) {
    const { rows, alignments } = shapeOf(lines);
    const second = alignments.map((a) => (a === "left" ? ":--" : a === "center" ? ":-:" : a === "right" ? "--:" : "---"));
    const out = rows.map((cells) => `| ${cells.join(" | ")} |`);
    out.splice(1, 0, `| ${second.join(" | ")} |`);
    return out;
}

// Every table in some lines (a row, then a second row of dashes, then rows), as { from, to } line indexes
export function tablesIn(lines) {
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const isSecond = lines[i].trim().startsWith("|") && segments(lines[i]).every((c) => DASHES.test(c));
        if (!isSecond || !lines[i - 1].trim().startsWith("|") || (i >= 2 && lines[i - 2].trim().startsWith("|"))) continue;
        let j = i + 1;
        while (j < lines.length && lines[j].trim().startsWith("|")) j++;
        out.push({ from: i - 1, to: j - 1 });
    }
    return out;
}

export function compactWriter(tr) {
    const write = tr.table;
    tr.table = function (head, align, rows) {
        return compactTable(write.call(this, head, align, rows));
    };
    return tr;
}

// Some text with every table in it read back compactly (see compactTable)
export function compactTables(text) {
    const lines = String(text).split("\n");
    for (const t of tablesIn(lines).reverse()) lines.splice(t.from, t.to - t.from + 1, ...compactTable(lines.slice(t.from, t.to + 1)));
    return lines.join("\n");
}
