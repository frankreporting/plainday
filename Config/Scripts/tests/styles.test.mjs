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

test("styles.css draws the invoice under the class its notes carry; a timesheet's table is the theme's (OBS-203)", () => {
    // Notes already written carry these classes, so they can't change
    for (const sel of ["body .pm-invoice .pm-invoice-parties", "body .pm-invoice .pm-invoice-facts", "body .pm-invoice .pm-invoice-label", "body .pm-invoice .pm-invoice-name"]) {
        assert.ok(CSS.includes(`${sel} {`), sel);
    }
    assert.match(CSS, /@media print \{[\s\S]*?body \.pm-invoice :is\(\.metadata-container,/);
    // Stripes on every other row since OBS-203 (the day bands took :has): a timesheet's rows, and in an invoice
    // the cells of rows of five cells or more, which leaves out Billable hours, the table of four columns
    assert.ok(CSS.includes(".pm-timesheet table tbody tr:nth-child(even):hover,\n"), "a timesheet's stripes");
    assert.ok(CSS.includes("body .pm-invoice table tbody tr:nth-child(even) > :first-child:nth-last-child(n + 5) ~ * {"), "Billed entries' stripes");
    assert.match(CSS, /--pm-table-stripe,\s*color-mix\(in oklab, var\(--background-primary\), var\(--text-normal\) var\(--pm-table-stripe-mix\)\)\)/);
    assert.doesNotMatch(CSS, /pm-timesheet-entry/);
    // On screen, a line only between the two blocks of names, since many themes underline the title; printed,
    // above the first too
    const block = (sel) => CSS.slice(CSS.indexOf(`${sel} {`)).split("}")[0];
    assert.doesNotMatch(block("body .pm-invoice .pm-invoice-parties"), /border-top/);
    assert.match(block("body .pm-invoice .cm-html-embed + .cm-html-embed > .pm-invoice-parties"), /border-top: 1px solid/);
    assert.ok(CSS.includes("body .pm-invoice .pm-invoice-parties + .pm-invoice-parties,\n"), "reading view's line");
    assert.match(CSS, /@media print \{[\s\S]*?body \.pm-invoice \.pm-invoice-parties \{\s*border-top: 1px solid/);
    // Printed, Billed entries are hidden: the blocks InvoicePrint marks, from the heading's on
    assert.match(CSS, /@media print \{[\s\S]*?body \.pm-invoice \.pm-invoice-billed \{\s*display: none;/);
    assert.ok(read("plugin/src/startup/invoicePrint.js").includes('static CLASS = "pm-invoice-billed";'));
    // Nothing left to copy into a vault's snippets
    assert.ok(!fs.existsSync(new URL("Config/Scripts/Style Settings/pm-invoice.css", root)));
    assert.ok(!fs.existsSync(new URL("Config/Scripts/Style Settings/pm-timesheet.css", root)));
});

test("styles.css: a forwarded or canceled task's text, and the strike, are a done task's color", () => {
    assert.match(CSS, /--plainday-faded-text: var\(--checklist-done-color\);/);
    const rule = (sel) => CSS.slice(CSS.indexOf(sel)).split("}")[0];
    assert.match(rule(`li.task-list-item):is([data-task=">"], [data-task="-"]) {`), /color: var\(--plainday-faded-text\);/);
    assert.doesNotMatch(CSS, /\[data-task=">"\] \{\s*color: var\(--text-muted\)/);
    assert.match(CSS, /linear-gradient\(var\(--plainday-faded-text\), var\(--plainday-faded-text\)\)/);
});

// The directory's scan (OBS-203): it warns on every !important and every :has, and on text-indent, which
// its browser check calls partly supported. styles.css has no !important. Two rules CSS can't write
// without them stay, each saying why in a stylelint comment; the scan lists them anyway (11/23).
function unexplained(css) {
    const out = [];
    let off = false, next = false, inComment = false;
    css.split("\n").forEach((line, i) => {
        if (/stylelint-disable-next-line/.test(line)) { next = true; return; }
        if (/stylelint-disable(?!-)/.test(line)) { off = true; return; }
        if (/stylelint-enable/.test(line)) { off = false; return; }
        let code = line.replace(/\/\*.*?\*\//g, "");
        if (inComment) { if (code.includes("*/")) { inComment = false; code = code.slice(code.indexOf("*/") + 2); } else return; }
        if (code.includes("/*")) { inComment = true; code = code.slice(0, code.indexOf("/*")); }
        if (code.includes("!important")) out.push(`${i + 1}: !important`);
        else if (/:has\(|text-indent/.test(code) && !off && !next) out.push(`${i + 1}: no reason given`);
        if (code.trim()) next = false;
    });
    return out;
}

// The lines of code (comments left out) that use :has or text-indent
function kept(css) {
    let inComment = false;
    return css.split("\n").flatMap((line) => {
        let code = line.replace(/\/\*.*?\*\//g, "");
        if (inComment) { if (!code.includes("*/")) return []; inComment = false; code = code.slice(code.indexOf("*/") + 2); }
        if (code.includes("/*")) { inComment = true; code = code.slice(0, code.indexOf("/*")); }
        return /:has\(|text-indent/.test(code) ? [code.trim()] : [];
    });
}

test("styles.css: no !important, and each rule that needs :has or text-indent says why (OBS-203)", () => {
    assert.deepEqual(unexplained(CSS), []);
    // Only the two the plan keeps: the links' indent reset, and a line with a link open for editing,
    // whose brackets only Obsidian knows it shows. A folded line has a class of its own (TrailingLinks).
    assert.deepEqual(kept(CSS), ["text-indent: 0;", "& .cm-line.pm-trail-line:has(.pm-trail-run :is(.cm-formatting-link, .cm-link-alias-pipe)) {"]);
    assert.ok(CSS.includes("& .pm-trail-line.pm-trail-folded {"));
    assert.ok(read("plugin/src/startup/trailingLinks.js").includes('"pm-trail-line pm-trail-folded"'));
    assert.deepEqual(kept("/* a :has(.x)\n   text-indent */\n.y:has(.z) {}"), [".y:has(.z) {}"]);
    assert.ok(/:has\(/.test(CSS) && /text-indent/.test(CSS), "the kept rules are still there");
    // What the check finds
    assert.deepEqual(unexplained(".a { color: red !important; }\n.b:has(> .c) { color: red; }\n/* x */ .d { text-indent: 0; }"),
        ["1: !important", "2: no reason given", "3: no reason given"]);
    assert.deepEqual(unexplained("/* stylelint-disable-next-line -- why */\n.b:has(> .c) { color: red; }\n/* stylelint-disable -- why */\n.b:has(> .c),\n.e:has(.f) {}\n/* stylelint-enable */\n/* :has and !important in a comment */"), []);
});

// The class files call the timers through window, as the scan's prefer-window-timers asks: in a pop-out
// window, a bare setTimeout would be the main window's (OBS-203)
test("no bare setTimeout, clearTimeout or requestAnimationFrame in Plainday's code", () => {
    const bare = /(^|[^.\w$])(setTimeout|clearTimeout|requestAnimationFrame)\(/;
    const files = scripts("plugin/src/");
    const found = files.flatMap((path) => read(path).split("\n").flatMap((line, i) => (!/^\s*\/\//.test(line) && bare.test(line) ? [`${path}:${i + 1}`] : [])));
    assert.deepEqual(found, []);
    assert.ok(bare.test("    setTimeout(() => {}, 0);") && !bare.test("window.setTimeout(() => {}, 0);"));
});
