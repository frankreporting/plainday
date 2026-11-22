// Tests for OBS-200: Plainday's look lives in styles.css, where a theme or a snippet can restyle it, and
// the code sets no style itself. The directory's scan rejects a style set from code, but its rule
// (no-static-styles-assignment) sees only some of the forms; this test reads them all. The one
// exception is a value only code can know: the trailing links' measured width, --pm-run-w, set on each
// line. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const CSS = read("styles.css");

// Every script file under a folder, as paths from the repository's root
function scripts(dir) {
    const out = [];
    for (const entry of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
        const path = `${dir}${entry.name}`;
        if (entry.isDirectory()) out.push(...scripts(`${path}/`));
        else if (/\.(m?js)$/.test(entry.name)) out.push(path);
    }
    return out;
}

// What sets a style from code: an element's style property or attribute, a style element, Obsidian's
// setCssStyles and setCssProps. A style attribute passed to Decoration.line or createEl counts too,
// unless all it sets is a measured width.
const FORMS = [
    [/\.style\s*(?:\.\s*[A-Za-z]+|\[)[^=\n]*=(?!=)/, "a style property set"],
    [/\.style\.(?:setProperty|cssText)/, "a style property set"],
    [/\bsetAttribute\(\s*["'`]style["'`]/, "a style attribute"],
    [/\bcreateElement\(\s*["'`]style["'`]/, "a style element"],
    [/\bcreateEl\(\s*["'`]style["'`]/, "a style element"],
    [/\bsetCss(?:Styles|Props)\(/, "setCssStyles or setCssProps"],
];
const MEASURED = /\bstyle:\s*`--pm-run-w: \$\{width\}px`/;

function found(text, path) {
    const out = [];
    text.split("\n").forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        for (const [pattern, what] of FORMS) if (pattern.test(line)) out.push(`${path}:${i + 1}: ${what}`);
        if (/\bstyle\s*:/.test(line) && !MEASURED.test(line)) out.push(`${path}:${i + 1}: a style attribute`);
    });
    return out;
}

test("no style set from code in Plainday or the Templater scripts, but the trailing links' measured width", () => {
    const files = [...scripts("plugin/src/"), ...scripts("Config/Scripts/Templater/")];
    assert.ok(files.length > 40, "the files are there");
    assert.deepEqual(files.flatMap((path) => found(read(path), path)), []);
    assert.match(read("plugin/src/startup/trailingLinks.js"), MEASURED, "the measured width is still set per line");
});

test("the guard finds each form it reads", () => {
    const lines = [
        'input.inputEl.style.width = "100%";',
        'el.style["min-height"] = "1em";',
        "el.style.setProperty('color', 'red');",
        'el.setAttribute("style", "color: red");',
        'const s = document.createElement("style");',
        'contentEl.createEl("style", { text: css });',
        "el.setCssStyles({ width: '100%' });",
        'el.createEl("mark", { attr: { style: "padding: 0" } });',
        "Decoration.line({ attributes: { style: `--pm-run-w: ${width}px; color: red` } });",
    ];
    for (const line of lines) assert.equal(found(line, "x").length > 0, true, line);
    for (const line of [
        'input.inputEl.addClass("plainday-wide-input");',
        "if (el.style.width === '') return;",
        "// el.style.width = '100%' was the old way",
        "Decoration.line({ class: \"pm-trail-line\", attributes: { style: `--pm-run-w: ${width}px` } });",
    ]) assert.deepEqual(found(line, "x"), [], line);
});

test("styles.css holds the classes the code gives its dialogs", () => {
    for (const cls of ["plainday-wide-input", "plainday-date-preview", "plainday-task-name", "plainday-selectable"]) {
        assert.match(CSS, new RegExp(`\\.${cls}\\b[^{]*\\{`), cls);
    }
    const uses = {
        "plainday-wide-input": ["plugin/src/shared/datePrompt.js", "plugin/src/commands/plan.js", "plugin/src/commands/invoice.js", "plugin/src/commands/newEventLog.js"],
        "plainday-date-preview": ["plugin/src/shared/datePrompt.js"],
        "plainday-task-name": ["plugin/src/commands/addTaskNote.js", "plugin/src/startup/checkOff.js"],
        "plainday-selectable": ["plugin/src/commands/invoice.js"],
    };
    for (const [cls, files] of Object.entries(uses)) for (const file of files) assert.ok(read(file).includes(`"${cls}`) || read(file).includes(` ${cls}"`), `${file} uses ${cls}`);
});

test("styles.css draws the invoice and the timesheet, under the classes their notes carry", () => {
    // Notes already written carry these classes, so they can't change
    for (const sel of ["body .pm-invoice .pm-invoice-parties", "body .pm-invoice .pm-invoice-facts", "body .pm-invoice .pm-invoice-label", "body .pm-invoice .pm-invoice-name"]) {
        assert.ok(CSS.includes(`${sel} {`), sel);
    }
    assert.match(CSS, /@media print \{[\s\S]*?body \.pm-invoice \.metadata-container/);
    assert.match(CSS, /\.pm-timesheet table tbody tr:nth-child\(n\)/);
    assert.match(CSS, /--pm-timesheet-entry-background/);
    // Nothing left to copy into a vault's snippets
    assert.ok(!fs.existsSync(new URL("Config/Scripts/Style Settings/pm-invoice.css", root)));
    assert.ok(!fs.existsSync(new URL("Config/Scripts/Style Settings/pm-timesheet.css", root)));
});

test("styles.css: a canceled task's text and its strike are a done task's color", () => {
    assert.match(CSS, /--plainday-canceled-text: var\(--checklist-done-color\);/);
    const rule = (sel) => CSS.slice(CSS.indexOf(sel)).split("}")[0];
    assert.match(rule(`li.task-list-item)[data-task="-"] {`), /color: var\(--plainday-canceled-text\);/);
    assert.match(rule(`li.task-list-item)[data-task=">"] {`), /color: var\(--text-muted\);/);
    assert.match(CSS, /linear-gradient\(var\(--plainday-canceled-text\), var\(--plainday-canceled-text\)\)/);
});
