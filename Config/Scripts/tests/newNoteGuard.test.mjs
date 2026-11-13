// Tests for plugin/src/classes/newNoteGuard.js (OBS-171) and the two template guards that go with it. Run from
// the vault root: node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm, with a fake `app`. The last test reads
// Templater's own code when it's installed in this folder (the dev vault), since the guard leans on
// two of its internals; it skips where Templater isn't (CI).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { STARTUP } from "../../../plugin/src/commands.js";
import { createRequire } from "node:module";

const here = new URL(".", import.meta.url);
const SOURCE = fs.readFileSync(new URL("../../../plugin/src/classes/newNoteGuard.js", here), "utf8");
const NewNoteGuard = vm.runInContext(SOURCE + "\n;NewNoteGuard", vm.createContext({}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arrivedNote = createRequire(import.meta.url)("../Templater/arrivedNote.js");

test("arrived: a note with properties and nothing below them isn't new; an empty one, or one with text, is left to Templater", () => {
    // Not new: what a meeting log with no notes yet, or a person note, looks like when it arrives
    for (const text of [
        "---\nid: 2026091409000000\ntags:\n  - log\nparent: \"[[Kestrel Outfitters 2026|⭕]]\"\n---\n",
        "---\ntags: person\n---\n\n\n",
        "---\r\ntags: person\r\n---\r\n",
        "﻿---\ntags: person\n---\n",
        "---\n---\n",
        "---\ntags: person\n---",
    ]) assert.equal(NewNoteGuard.arrived(text), true, JSON.stringify(text));
    // New, or not ours to stop: an empty note, text with no properties, properties with a body
    for (const text of [
        "", "   \n\n", null, undefined,
        "Call the printer\n",
        "---\ntags: log\n---\n## Notes\n\n- agreed on the date\n",
        "Intro\n\n---\n\nAfter a rule\n",
        "<%* tR += 'daily note' %>\n",
        "---\nnot closed\n",
    ]) assert.equal(NewNoteGuard.arrived(text), false, JSON.stringify(text));
});

test("arrivedNote, Get Template's copy of the rule, agrees with the guard", () => {
    for (const text of ["", "  \n", "---\ntags: person\n---\n", "---\r\ntags: x\r\n---\r\n", "\uFEFF---\n---\n", "---\ntags: x\n---\nBody\n", "Body\n", "---\nnot closed\n", null]) {
        assert.equal(arrivedNote(text), NewNoteGuard.arrived(text), JSON.stringify(text));
    }
});

// A fake app: one vault listener list, file texts by path, and Templater's set. `loaded`: Plainday
// is loaded (`customJS.plugin`), or has unloaded and left this listener behind.
function setup({ loaded = true, templater = true } = {}) {
    const pending = new Set(), texts = new Map(), listeners = [];
    const ctx = vm.createContext({
        customJS: { plugin: loaded ? {} : null },
        app: {
            plugins: {
                plugins: templater ? { "templater-obsidian": { templater: { files_with_pending_templates: pending } } } : {},
            },
            workspace: {
                onLayoutReady: (fn) => fn(),
                on: (event, fn) => { listeners.push({ event, fn }); return fn; },
                offref: (ref) => { const i = listeners.findIndex((l) => l.fn === ref); if (i >= 0) listeners.splice(i, 1); },
            },
            vault: {
                cachedRead: async (f) => texts.get(f.path) ?? "",
                on: (event, fn) => { listeners.push({ event, fn }); return fn; },
                offref: (ref) => { const i = listeners.findIndex((l) => l.fn === ref); if (i >= 0) listeners.splice(i, 1); },
            },
        },
        window: {},
        setTimeout,
        queueMicrotask,
        clearTimeout,
    });
    const Guard = vm.runInContext(SOURCE + "\n;NewNoteGuard", ctx);
    const guard = new Guard();
    const file = (path, text) => {
        texts.set(path, text);
        return { path, extension: path.split(".").pop(), stat: { size: Buffer.byteLength(text) } };
    };
    return { Guard, guard, pending, listeners, file, ctx };
}

test("onCreate: a note that arrives with only properties is held from Templater for a while, then let go", async () => {
    const { Guard, guard, pending, file } = setup();
    Guard.HOLD_MS = 30;
    const log = file("Projects/Freelance/Kestrel Outfitters 2026/›logs/2026-09-14 Homepage review with Imogen.md", "---\ntags: log\n---\n");
    await guard.onCreate(log);
    assert.ok(pending.has(log.path), "Templater skips it when its 300ms are up");
    await sleep(60);
    assert.ok(!pending.has(log.path), "and it's let go afterwards");
});

test("onCreate: a note created empty is noted as made here, by the file itself, and isn't held", async () => {
    const { guard, pending, file, ctx } = setup();
    const made = file("Inbox/Untitled.md", "");
    await guard.onCreate(made);
    assert.ok(ctx.window.newNoteGuardMadeHere.has(made), "Get Template lets it through once a base writes its properties");
    made.path = "Inbox/Order toner.md";   // renamed straight away
    assert.ok(ctx.window.newNoteGuardMadeHere.has(made));
    const arrived = file("Reference/People/Rafe Oakes.md", "---\ntags: person\n---\n");
    await guard.onCreate(arrived);
    assert.ok(!ctx.window.newNoteGuardMadeHere.has(arrived), "a note that arrives with text isn't made here");
    assert.deepEqual([...pending], [arrived.path]);
});

test("onCreate: a new note, a note with text, another file type or a big file is left alone", async () => {
    const { guard, pending, file } = setup();
    await guard.onCreate(file("Inbox/Untitled.md", ""));
    await guard.onCreate(file("Inbox/Order toner.md", "---\ntags: task\n---\nCall first\n"));
    await guard.onCreate(file("Config/Bases/Projects.base", "---\nfilters:\n---\n"));
    await guard.onCreate(file("Inbox/Huge.md", "---\ntags: x\n---\n" + " ".repeat(70000)));
    await guard.onCreate(null);
    assert.deepEqual([...pending], []);
});

test("onCreate: nothing happens once Plainday has unloaded or with Templater missing, and a file Templater already holds stays Templater's", async () => {
    for (const opts of [{ loaded: false }, { templater: false }]) {
        const { guard, pending, file } = setup(opts);
        await guard.onCreate(file("Reference/People/Rafe Oakes.md", "---\ntags: person\n---\n"));
        assert.deepEqual([...pending], [], JSON.stringify(opts));
    }
    const { Guard, guard, pending, file } = setup();
    Guard.HOLD_MS = 20;
    const mine = file("Inbox/2026-09-15 Kickoff call.md", "---\ntags: log\n---\n");
    pending.add(mine.path);   // Templater (or the Log template) is writing it
    await guard.onCreate(mine);
    await sleep(40);
    assert.ok(pending.has(mine.path), "the guard never removes an entry it didn't add");
});

test("invoke: one listener of each, however often it runs", async () => {
    const { guard, listeners, ctx } = setup();
    await guard.invoke();
    await guard.invoke();
    assert.deepEqual(listeners.map((l) => l.event).sort(), ["create", "templater:new-note-from-template"]);
    assert.ok(ctx.window.newNoteGuardRef && ctx.window.newNoteGuardTemplateRef);
    guard.deconstructor();
    assert.equal(listeners.length, 0);
});

test("onCreate: a note held again while held stays held, from the latest time", async () => {
    const { Guard, guard, pending, file } = setup();
    Guard.HOLD_MS = 40;
    const person = file("Reference/People/Imogen Fenwick.md", "---\ntags: person\n---\n");
    await guard.onCreate(person);
    await sleep(25);
    await guard.onCreate(person);   // arrived again (Sync, a restore)
    await sleep(25);
    assert.ok(pending.has(person.path), "the second arrival re-armed the hold");
    await sleep(40);
    assert.ok(!pending.has(person.path));
});

test("onTemplated: a note a template just made is held where it is now, once Templater has let it go", async () => {
    const { Guard, guard, pending, file } = setup();
    Guard.HOLD_MS = 40; Guard.POLL_MS = 5;
    // Made in Inbox, moved to its project by the template: Templater still lists the old path
    const made = file("Projects/Freelance/Kestrel Outfitters 2026/Order toner.md", "---\ntags: task\n---\n");
    pending.add("Inbox/Order toner.md");
    guard.onTemplated(made);
    await Promise.resolve();
    assert.ok(pending.has(made.path), "held right after the event, where it is now");
    // Not moved: Templater lets it go in the same turn as the event (end_templater_task), and the
    // hold lands with no gap, so the trigger's 300ms check can't fall between the two (OBS-55)
    const kept = file("Inbox/2026-09-15 Kickoff call.md", "---\ntags: log\n---\n");
    pending.add(kept.path);
    guard.onTemplated(kept);
    pending.delete(kept.path);   // end_templater_task
    await Promise.resolve();
    assert.ok(pending.has(kept.path), "held with no gap");
    // One Templater keeps a while longer (it opened the note): the guard waits for it to let go, then holds it
    const opened = file("Inbox/2026-09-16 Catalog shoot planning.md", "---\ntags: log\n---\n");
    pending.add(opened.path);
    guard.onTemplated(opened);
    await sleep(8);
    pending.delete(opened.path);
    await sleep(15);
    assert.ok(pending.has(opened.path), "held after Templater finished with it");
    await sleep(50);
    assert.ok(!pending.has(kept.path) && !pending.has(made.path) && !pending.has(opened.path), "and let go");
    assert.ok(pending.has("Inbox/Order toner.md"), "Templater's own entry is never touched");
});

test("Get Template stops on a note that already has properties when Templater's trigger runs it, before anything else", () => {
    const text = fs.readFileSync(new URL("../../Templates/Get Template.md", here), "utf8");
    const guard = text.indexOf("tp.config.run_mode === 2");
    assert.ok(guard > 0, "the backstop is there");
    assert.ok(guard < text.indexOf("tp.file.include"), "before any template is chosen");
    assert.match(text, /tp\.user\.arrivedNote\(await app\.vault\.read\(tp\.config\.target_file\)\)/, "Templater's own script, not one of Plainday's classes");
    assert.match(text, /!window\.newNoteGuardMadeHere\?\.has\(tp\.config\.target_file\)/, "a note made here passes");
    assert.match(text.slice(guard, guard + 900), /new Notice\(why, 10000\);\s*throw new Error\(why\)/, "says why in its own notice, then stops");
});

test("the Log template trashes a same-named note only when it was empty when the template started", () => {
    const text = fs.readFileSync(new URL("../../Templates/Log.md", here), "utf8");
    assert.match(text, /const startedEmpty = \(await app\.vault\.read\(tp\.config\.target_file\)\)\.trim\(\) === "";/);
    const keep = text.indexOf("if (existing && !startedEmpty)"), trash = text.indexOf("app.fileManager.trashFile(here)");
    assert.ok(keep > 0 && trash > keep, "the non-empty case comes first, and only the other branch trashes");
    assert.ok(text.indexOf("const startedEmpty") < keep);
    // The trigger running it on a note that arrived with only properties stops before a move
    const stop = text.indexOf("tp.config.run_mode === 2 && !startedEmpty && !window.newNoteGuardMadeHere?.has(tp.config.target_file) && tp.user.arrivedNote(");
    assert.ok(stop > 0 && stop < text.indexOf("tp.file.move("), "before a move");
    assert.ok(stop < text.indexOf("takePresetParent"), "before it takes a preset meant for a new note");
    assert.match(text.slice(stop, stop + 500), /new Notice\(why, 10000\);\s*throw new Error\(why\)/);
});

test("the startup scripts start the guard", () => {
    assert.ok(STARTUP.includes("NewNoteGuard"));
});

// Real-artifact check: the guard and the backstop rely on Templater checking its pending set after
// its 300ms wait, and on run mode 2 being the trigger's. Read Templater's own code where it's
// installed (the dev vault, a real vault); skip elsewhere.
// TEMPLATER_JS points at another install (a worktree has no plugins)
const TEMPLATER = process.env.TEMPLATER_JS || new URL("../../../.obsidian/plugins/templater-obsidian/main.js", here);
test("Templater's trigger checks its pending set before applying a template, and runs as mode 2", { skip: !fs.existsSync(TEMPLATER) && "Templater isn't installed here" }, () => {
    const code = fs.readFileSync(TEMPLATER, "utf8");
    const onCreate = code.slice(code.indexOf("on_file_creation("), code.indexOf("on_file_creation(") + 1500);
    assert.match(onCreate, /files_with_pending_templates\.has\(/, "the trigger skips a file in the set");
    assert.ok(onCreate.indexOf("files_with_pending_templates.has(") < onCreate.indexOf("write_template_to_file"), "before writing");
    assert.match(code, /OverwriteFile=2\]="OverwriteFile"/);
    const write = code.slice(code.indexOf("async write_template_to_file("), code.indexOf("async write_template_to_file(") + 300);
    assert.match(write, /create_running_config\(\w+,\w+,2\)/, "the trigger's write runs as OverwriteFile");
});
