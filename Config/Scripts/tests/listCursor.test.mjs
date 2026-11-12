// Tests for CustomJS/listCursor.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// Only the text and fold rules are pure; the editor extension is checked in a vault, with real key presses.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { COMMANDS, STARTUP } from "../../../plugin/src/commands.js";

const here = new URL(".", import.meta.url);
const ListCursor = vm.runInContext(fs.readFileSync(new URL("../CustomJS/listCursor.js", here), "utf8") + "\n;ListCursor", vm.createContext({}));

// The line with the cursor drawn as | at its text start, or null on a line that isn't a list line
const atStart = (line) => {
    const ch = ListCursor.textStart(line);
    return ch === null ? null : `${line.slice(0, ch)}|${line.slice(ch)}`;
};

test("textStart: after a bullet, of any of the three kinds", () => {
    assert.equal(atStart("- Call the printer"), "- |Call the printer");
    assert.equal(atStart("* Call the printer"), "* |Call the printer");
    assert.equal(atStart("+ Call the printer"), "+ |Call the printer");
});

test("textStart: after a checkbox, with any status", () => {
    assert.equal(atStart("- [ ] Send the notes"), "- [ ] |Send the notes");
    assert.equal(atStart("- [x] Send the notes"), "- [x] |Send the notes");
    assert.equal(atStart("- [>] Send the notes"), "- [>] |Send the notes");
    assert.equal(atStart("- [<] 9:00am\tKestrel standup"), "- [<] |9:00am\tKestrel standup");
    assert.equal(atStart("* [/] Send the notes"), "* [/] |Send the notes");
});

test("textStart: after a number, with a dot or a bracket", () => {
    assert.equal(atStart("1. Clone the repository"), "1. |Clone the repository");
    assert.equal(atStart("12. Clone the repository"), "12. |Clone the repository");
    assert.equal(atStart("1) Clone the repository"), "1) |Clone the repository");
    assert.equal(atStart("1. [ ] Clone the repository"), "1. [ ] |Clone the repository");
});

test("textStart: past the tabs of a nested line, and the spaces of one nested with spaces", () => {
    assert.equal(atStart("\t- 9:20am"), "\t- |9:20am");
    assert.equal(atStart("\t\t- [ ] Send the notes"), "\t\t- [ ] |Send the notes");
    assert.equal(atStart("    - 9:20am"), "    - |9:20am");
});

test("textStart: past several spaces after the bullet or the checkbox", () => {
    assert.equal(atStart("-   Call the printer"), "-   |Call the printer");
    assert.equal(atStart("- [ ]   Call the printer"), "- [ ]   |Call the printer");
    assert.equal(atStart("-\tCall the printer"), "-\t|Call the printer");
});

test("textStart: on a line with no text yet, it's the end of the line", () => {
    assert.equal(atStart("- "), "- |");
    assert.equal(atStart("- [ ] "), "- [ ] |");
    assert.equal(atStart("\t- [ ] "), "\t- [ ] |");
});

test("textStart: brackets only count as a checkbox with a space after them, so one being typed isn't pushed past", () => {
    assert.equal(atStart("- ["), "- |[");
    assert.equal(atStart("- []"), "- |[]");
    assert.equal(atStart("- [ ]"), "- |[ ]");
    assert.equal(atStart("- [ ]Task"), "- |[ ]Task");
    assert.equal(atStart("- [link](target)"), "- |[link](target)");
});

test("textStart: only list lines", () => {
    for (const line of ["", "Plain text", "\tIndented with no bullet", "    Indented with no bullet", "-", "-Task", "*emphasis*", "**bold**", "---", "1.", "1.5 metres", "# - heading", "> - item", "> [!note] A callout", "| - cell |"]) {
        assert.equal(ListCursor.textStart(line), null, JSON.stringify(line));
    }
});

test("ListCursor is a startup script, ahead of the time report's long run, and no command", () => {
    assert.ok(STARTUP.includes("ListCursor") && STARTUP.indexOf("ListCursor") < STARTUP.indexOf("TimeReportOnStartup"));
    assert.ok(!COMMANDS.some((c) => c.script === "ListCursor"));
});

// The one method of CodeMirror's fold set these rules read: it calls back with each fold touching the span
const folds = (...ranges) => ({ between: (a, b, f) => ranges.forEach(([from, to]) => { if (from <= b && to >= a) f(from, to); }) });

test("rowEnd: a fold's end belongs to the line the fold hangs from", () => {
    assert.equal(ListCursor.rowEnd(folds([388, 407]), 407), 388);
});

test("rowEnd: with no fold ending there, the position stands", () => {
    assert.equal(ListCursor.rowEnd(folds(), 407), 407);
    assert.equal(ListCursor.rowEnd(folds([407, 450]), 407), 407);
});

test("rowEnd: folds that end together go to the outermost", () => {
    assert.equal(ListCursor.rowEnd(folds([100, 407], [388, 407]), 407), 100);
});

test("foldEnd: from a fold's start, the fold's end", () => {
    assert.equal(ListCursor.foldEnd(folds([388, 407]), 388), 407);
});

test("foldEnd: with no fold starting there, the position stands", () => {
    assert.equal(ListCursor.foldEnd(folds(), 388), 388);
    assert.equal(ListCursor.foldEnd(folds([300, 388]), 388), 388);
});
