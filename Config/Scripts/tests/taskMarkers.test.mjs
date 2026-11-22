// Tests for Plainday's task markers (OBS-140): plugin/src/startup/taskMarkers.js, which sets the body
// class, and the rules in styles.css that draw the five marks under it. How they look is checked in a
// vault, in each theme. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { loadClass, readIndex } from "../../../plugin/classShape.mjs";

const CLASS = "plainday-task-markers";
const MARKS = ["<", ">", "/", "-", "w"];

// ------------------------------------------------------------------ styles.css

// The stylesheet's rules, comments left out, as { selectors, body }: each selector of a rule's list on
// its own, split at the commas outside brackets
function rules(css) {
    const out = [];
    const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = [];
        let depth = 0, start = 0;
        const list = m[1];
        for (let i = 0; i < list.length; i++) {
            if (list[i] === "(") depth++;
            else if (list[i] === ")") depth--;
            else if (list[i] === "," && depth === 0) { selectors.push(list.slice(start, i)); start = i + 1; }
        }
        selectors.push(list.slice(start));
        out.push({ selectors: selectors.map((s) => s.trim().replace(/\s+/g, " ")), body: m[2] });
    }
    return out;
}

const CSS = fs.readFileSync(new URL("../../../styles.css", import.meta.url), "utf8");
const named = (sel) => MARKS.some((mark) => sel.includes(`[data-task="${mark}"]`));

test("styles.css: every rule that names one of the five marks sits under the switch's body class", () => {
    const marked = rules(CSS).filter((r) => r.selectors.some(named));
    assert.ok(marked.length >= 8, "the marks' rules are there");
    for (const { selectors } of marked) {
        for (const sel of selectors) assert.ok(sel.startsWith(`body.${CLASS} `), `under the body class: ${sel}`);
    }
    for (const mark of MARKS) assert.ok(marked.some((r) => r.selectors.some((s) => s.includes(`[data-task="${mark}"]`))), `a rule for [${mark}]`);
});

test("styles.css: the marks' rules use no !important, and only the system's five marks", () => {
    for (const { selectors, body } of rules(CSS).filter((r) => r.selectors.some((s) => s.includes("data-task")))) {
        assert.doesNotMatch(body, /!important/, selectors.join(", "));
        for (const sel of selectors) {
            for (const [, mark] of sel.matchAll(/\[data-task="(.)"\]/g)) assert.ok(MARKS.includes(mark), `only the five: [${mark}] in ${sel}`);
        }
    }
});

test("styles.css: a reading view box is reached only as its own list item's child, never a nested task's", () => {
    const text = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    // From each list item to the box it reaches, within one selector list
    const reached = [...text.matchAll(/li\.task-list-item([^{}]*?)\.task-list-item-checkbox/g)].map((m) => m[1]);
    assert.ok(reached.length >= 10, "both of a reading view box's selectors, in every box rule");
    // The marks, then the box as its child, or its paragraph's in a loose list
    for (const between of reached) assert.match(between, /^(?::is\([^()]*\)|\[data-task="."\])\s*>\s*(?:p\s*>\s*)?$/, between);
});

// ------------------------------------------------------------------ TaskMarkers

// A stand-in body: the class list, as the browser keeps it
const body = () => {
    const classes = new Set();
    return { classes, classList: {
        toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
        remove: (c) => classes.delete(c),
    } };
};

// TaskMarkers with a main window, popouts holding tabs, and the switch at `on`
function withWorkspace({ on = true, popouts = [] } = {}) {
    const main = body();
    const listeners = [], registered = [], offs = [];
    const settings = { editor: { listCursor: true, taskMarkers: on } };
    const leaves = [main, ...popouts].map((b) => ({ view: { containerEl: { doc: { body: b } } } }));
    const app = {
        workspace: {
            containerEl: { doc: { body: main } },
            iterateAllLeaves: (fn) => leaves.forEach(fn),
            on: (name, fn) => { const ref = { name, fn }; listeners.push(ref); return ref; },
            offref: (ref) => { offs.push(ref); listeners.splice(listeners.indexOf(ref), 1); },
        },
    };
    const plainday = { plugin: { registerEvent: (ref) => registered.push(ref) }, Settings: { get: () => settings } };
    const context = vm.createContext({ app, plainday });
    const markers = new (loadClass("taskMarkers.js", context))();
    plainday.TaskMarkers = markers;
    return { markers, main, settings, listeners, registered, offs, plainday };
}

test("TaskMarkers: sets the class on every window's body while the switch is on, and removes it when it's off", async () => {
    const popout = body();
    const w = withWorkspace({ popouts: [popout] });
    await w.markers.invoke();
    assert.deepEqual([w.main.classes.has(CLASS), popout.classes.has(CLASS)], [true, true]);
    w.settings.editor.taskMarkers = false;
    await w.markers.invoke();
    assert.deepEqual([w.main.classes.has(CLASS), popout.classes.has(CLASS)], [false, false]);
    w.settings.editor.taskMarkers = true;
    await w.markers.invoke();
    assert.equal(w.main.classes.has(CLASS), true);
    assert.equal(w.listeners.length, 1, "one listener, however often it runs");
    assert.deepEqual(w.registered, w.listeners, "registered with Plainday, so it goes when Plainday unloads");
});

test("TaskMarkers: a popout opened later follows the switch as it is then", async () => {
    const w = withWorkspace();
    await w.markers.invoke();
    const [opened] = w.listeners;
    assert.equal(opened.name, "window-open");
    const later = body();
    opened.fn({ doc: { body: later } });
    assert.equal(later.classes.has(CLASS), true);
    w.settings.editor.taskMarkers = false;
    const another = body();
    opened.fn({ doc: { body: another } });
    assert.equal(another.classes.has(CLASS), false);
});

test("TaskMarkers: on before the settings load, and gone with Plainday", async () => {
    const w = withWorkspace();
    w.plainday.Settings = undefined;
    await w.markers.invoke();
    assert.equal(w.main.classes.has(CLASS), true, "the switch is on as it comes");
    w.markers.deconstructor();
    assert.equal(w.main.classes.has(CLASS), false);
    assert.equal(w.offs.length, 1, "its listener removed");
});

test("TaskMarkers runs first at startup, so notes open with their markers drawn", () => {
    const { CLASSES, STARTUP } = readIndex("startup").exports;
    assert.equal(STARTUP[0], "TaskMarkers");
    assert.ok("TaskMarkers" in CLASSES);
});
