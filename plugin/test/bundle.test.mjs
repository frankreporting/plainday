// Plainday's bundle: built from the class files as they are, it loads in Node against stand-ins
// for Obsidian's module and CodeMirror's. Every class is made by name, every command in the list is
// added with its id, name and icon, the startup scripts run in order once the layout is ready, a class
// reaches Plainday through the host's `plainday` and imports Obsidian and CodeMirror, no CustomJS hook
// or `customJS` is left, and unloading leaves nothing of Plainday's behind. The build itself is
// tested too: a line in a class file that reaches for CustomJS stops it, and so does a class file
// without the shape (plugin/classShape.mjs), each naming the file and line.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, check, ROOT, SRC } from "../esbuild.config.mjs";
import { classFiles as listClassFiles, parse, readIndex, shapeProblems } from "../classShape.mjs";

// The indexes import the class files, which import Obsidian's module, which only Obsidian has, so
// they're read the way CI reads them
const { COMMANDS, STARTUP } = { ...readIndex("commands").exports, ...readIndex("startup").exports };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plainday-bundle-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const BUNDLE = path.join(tmp, "main.js");
await build({ outfile: BUNDLE, logLevel: "silent" });

// "commands/schedule.js" and so on
const classFiles = listClassFiles();
const read = (f, src = SRC) => fs.readFileSync(path.join(src, f), "utf8");
const CLASS_NAMES = classFiles.map((f) => parse(f, read(f)).name ?? null);
const OWN = new Set(["app", "obsidian", "plugin"]);
// Fold machinery, called directly and by eval, never from the palette
const NOT_COMMANDS = ["SnapshotDailyNotes", "RefoldDailyNotes"];
// Stand-ins for the CodeMirror modules Obsidian provides
const CODEMIRROR = {
    "@codemirror/view": { EditorView: class EditorView {}, ViewPlugin: {}, Decoration: {}, keymap: {} },
    "@codemirror/state": { EditorState: class EditorState {}, Prec: {}, StateEffect: {} },
    "@codemirror/language": { foldedRanges: () => [] },
};
const instances = (o) => Object.keys(o).filter((k) => !OWN.has(k));
// A copy of plugin/src/ to build from, for a test that changes a file
const copySrc = () => {
    const copy = fs.mkdtempSync(path.join(tmp, "src-"));
    fs.cpSync(SRC, copy, { recursive: true });
    return copy;
};

// Runs a built main.js the way Obsidian's plugin loader does, against stand-ins: `Plugin` records
// what the plugin adds, `Notice` what it shows, and the app holds the layout-ready callbacks.
// CodeMirror's modules come from the loader too, as Obsidian gives them to every plugin.
function load(file = BUNDLE) {
    const notices = [];
    class Plugin {
        constructor(app, manifest) {
            this.app = app;
            this.manifest = manifest;
            this.commands = [];
            this.extensions = [];
        }
        addCommand(c) { this.commands.push(c); return c; }
        registerEditorExtension(e) { this.extensions.push(e); }
    }
    class Notice { constructor(message) { notices.push(message); } }
    const module = { exports: {} };
    const req = (id) => {
        if (id === "obsidian") return { Plugin, Notice };
        if (CODEMIRROR[id]) return CODEMIRROR[id];
        throw new Error(`unexpected require(${id}) while loading`);
    };
    globalThis.window = globalThis;
    new Function("module", "exports", "require", fs.readFileSync(file, "utf8"))(module, module.exports, req);
    const layout = [];
    const app = { workspace: { onLayoutReady: (cb) => layout.push(cb) } };
    const plugin = new module.exports.default(app, { id: "plainday" });
    return { plugin, layout, notices };
}

test("every class file is bundled, and made once by name", () => {
    const { plugin } = load();
    plugin.onload();
    try {
        assert.equal(CLASS_NAMES.length, classFiles.length);
        assert.ok(!CLASS_NAMES.includes(null), "each class file declares a class");
        assert.deepEqual(instances(window.plainday).sort(), [...CLASS_NAMES].sort());
        for (const name of CLASS_NAMES) assert.equal(window.plainday[name].constructor.name, name, `${name} keeps its name`);
        assert.equal(window.plainday.plugin, plugin, "Plainday itself");
        assert.equal(window.plainday.app, plugin.app, "and the app");
        assert.equal(typeof window.plainday.obsidian?.Notice, "function", "and Obsidian's module, for scripts sent in by eval");
        assert.deepEqual(Object.keys(window.plainday).filter((k) => /^create.+Instance$|^(state|codemirror)$/.test(k)), [],
            "nothing else of CustomJS's: no create…Instance, no state, no CodeMirror");
        assert.equal(globalThis.customJS, undefined, "no customJS global");
    } finally {
        plugin.onunload();
    }
});

test("each command in the list is added with its id, name and icon, and runs its class", async () => {
    const { plugin } = load();
    plugin.onload();
    try {
        const shown = ({ id, name, icon }) => ({ id, name, icon });
        assert.deepEqual(plugin.commands.map(shown), COMMANDS.map(shown));
        assert.equal(plugin.commands.length, 14);
        for (const c of plugin.commands) {
            assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, "ids are lower case with hyphens, without the plugin's id");
            // An icon name from Obsidian's set (OBS-263): without one, the phone's toolbar draws a question mark
            assert.match(c.icon ?? "", /^[a-z]+(-[a-z0-9]+)*$/, `${c.id} has an icon, in lower case with hyphens`);
            // Sentence case: only the first word and proper names capitalized
            const [first, ...rest] = c.name.split(" ");
            assert.match(first, /^[A-Z][a-z]+$/, c.name);
            for (const w of rest) assert.ok(/^[a-z]+$/.test(w) || ["Obsidian", "PM"].includes(w), `sentence case: ${c.name}`);
        }
        const icons = plugin.commands.map((c) => c.icon);
        assert.deepEqual(icons.filter((icon, i) => icons.indexOf(icon) !== i), [], "no two commands share an icon");
        for (const name of NOT_COMMANDS) {
            assert.ok(!COMMANDS.some((c) => c.script === name), `${name} isn't a command`);
            assert.equal(typeof window.plainday[name]?.invoke, "function", `${name} can still be called by eval`);
        }
        for (const { script } of COMMANDS) {
            const ran = [];
            window.plainday[script].invoke = async () => ran.push(script);
            await plugin.commands.find((c) => COMMANDS.find((l) => l.id === c.id).script === script).callback();
            assert.deepEqual(ran, [script]);
        }
    } finally {
        plugin.onunload();
    }
});

test("the startup scripts wait for the layout, then run one after the other in the list's order", async () => {
    const { plugin, layout, notices } = load();
    plugin.onload();
    try {
        const ran = [];
        let running = 0;
        for (const name of STARTUP) {
            window.plainday[name].invoke = async () => {
                assert.equal(running++, 0, "one at a time");
                ran.push(name);
                await new Promise((r) => setTimeout(r, 1));
                running--;
                if (name === "SyncArea") throw new Error("invented failure");
            };
        }
        assert.equal(layout.length, 1);
        assert.deepEqual(ran, [], "nothing runs before the layout is ready");
        await layout[0]();
        assert.deepEqual(ran, STARTUP, "a failing script doesn't stop the next");
        assert.equal(notices.length, 1);
        assert.match(notices[0], /^Plainday: SyncArea failed\ninvented failure/);
    } finally {
        plugin.onunload();
    }
});

test("no CustomJS hook or customJS is left in the bundle", () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    for (const p of [/["'`]customjs["'`]/, /\.customjs\b/, /\bcustomJS\b/]) {
        assert.doesNotMatch(text, p);
    }
    assert.doesNotMatch(text, /disablePlugin|enablePlugin/, "UpdateObsidianPM's offer to reload CustomJS is left out");
});

test("the bundle names no folder on the machine that built it, so a build anywhere matches the release (OBS-230)", () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    assert.ok(!text.includes(ROOT), `main.js names ${ROOT}`);
    assert.match(text, /^\/\/ plugin\/src\/commands\/schedule\.js$/m, "each class by its path in the repository");
});

test("unloading runs every deconstructor and removes the global", () => {
    const { plugin } = load();
    plugin.onload();
    const ran = [];
    for (const name of CLASS_NAMES) {
        if (typeof window.plainday[name].deconstructor === "function") window.plainday[name].deconstructor = () => ran.push(name);
    }
    window.plainday.TrailingLinks.deconstructor = () => { ran.push("TrailingLinks"); throw new Error("invented failure"); };
    plugin.onunload();
    assert.ok(ran.includes("TrailingLinks") && ran.includes("CheckOff"), "one failing doesn't stop the rest");
    assert.ok(STARTUP.every((n) => typeof window.plainday?.[n] === "undefined"));
    assert.equal(window.plainday, undefined);
});

// A class written the way the real ones are, using what the host gives the editor features and the
// listeners, and what they import from Obsidian and CodeMirror
const PROBE = `import { foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { app, plainday } from "../host.js";

export default class Probe {
    on() { return !!plainday.plugin; }
    add(extension) { plainday.plugin.registerEditorExtension(extension); }
    others() { return plainday; }
    theApp() { return app; }
    editor() { return { EditorView, EditorState, foldedRanges }; }
    notice() { return Notice; }
    async invoke() {}
}
`;

test("in the bundle, a class reaches Plainday through the host's plainday, and Obsidian and CodeMirror through its imports", async () => {
    const src = copySrc();
    fs.writeFileSync(path.join(src, "shared/probe.js"), PROBE);
    const index = path.join(src, "shared/index.js");
    fs.writeFileSync(index, fs.readFileSync(index, "utf8").replace(/^export const CLASSES = \{/m, 'import Probe from "./probe.js";\n\nexport const CLASSES = {\n    Probe,'));
    const out = path.join(src, "main.js.out");
    await build({ src, outfile: out, logLevel: "silent" });
    const { plugin } = load(out);
    plugin.onload();
    const probe = window.plainday.Probe;
    assert.equal(probe.on(), true, "loaded");
    probe.add("an extension");
    assert.deepEqual(plugin.extensions, ["an extension"], "through the plugin, which Obsidian undoes on unload");
    assert.equal(probe.others(), window.plainday, "the bundle's own classes");
    assert.equal(probe.theApp(), plugin.app, "the plugin's own app");
    const { EditorView, EditorState, foldedRanges } = probe.editor();
    assert.equal(EditorView, CODEMIRROR["@codemirror/view"].EditorView, "Obsidian's own CodeMirror, not a copy");
    assert.equal(EditorState, CODEMIRROR["@codemirror/state"].EditorState);
    assert.equal(foldedRanges, CODEMIRROR["@codemirror/language"].foldedRanges);
    assert.equal(typeof probe.notice(), "function", "Obsidian's own Notice");
    plugin.onunload();
    assert.equal(probe.on(), false, "a listener left over sees Plainday is gone");
    assert.throws(() => probe.add("another"), TypeError, "nothing to add an extension to");
});

test("the three editor features import CodeMirror, and no class file requires it", () => {
    for (const f of classFiles) {
        assert.doesNotMatch(read(f), /require\(\s*["'`]@codemirror\//, f);
    }
    for (const f of ["startup/trailingLinks.js", "startup/listCursor.js", "startup/checkOff.js"]) {
        assert.match(read(f), /^import \{[^}]+\} from "@codemirror\/view";$/m, f);
    }
});

test("the build stops on a new CustomJS line in a class file, and names the file and line", async () => {
    const copy = copySrc();
    const file = path.join(copy, "startup/syncArea.js");
    const source = fs.readFileSync(file, "utf8");
    const at = source.lastIndexOf("\n}");
    const line = source.slice(0, at).split("\n").length + 1;

    for (const planted of [
        'app.plugins.enabledPlugins.has("customjs")',
        "app.plugins.plugins.customjs.registerEditorExtension([])",
        "globalThis.customJS?.Schedule",
        "window.customJS",
        "customJS.Schedule",
        'app.plugins.getPlugin("customjs")',
        'app.commands.executeCommandById("customjs:invoke-Schedule")',
    ]) {
        fs.writeFileSync(file, `${source.slice(0, at)}\n    planted() { return ${planted}; }${source.slice(at)}`);
        await assert.rejects(build({ src: copy, outfile: path.join(copy, "main.js.out"), logLevel: "silent" }),
            (e) => {
                assert.match(e.message, new RegExp(`startup/syncArea\\.js:${line} reaches for CustomJS: planted\\(\\)`), planted);
                return true;
            });
    }
    assert.ok(!fs.existsSync(path.join(copy, "main.js.out")), "no bundle from a failed build");
});

test("the build stops on a class file without the shape, and names the file and line", async () => {
    const copy = copySrc();
    const file = path.join(copy, "commands/plan.js");
    const source = fs.readFileSync(file, "utf8");
    const lines = source.split("\n");
    const classLine = lines.findIndex((l) => l.startsWith("export default class")) + 1;
    const last = lines.length;
    for (const [planted, at, pattern] of [
        [(s) => `${s}\nexport const second = 1;\n`, last + 1, /holds more than its class/],
        [(s) => `${s}\nconst after = 1;\n`, last + 1, /holds more than its class/],
        [(s) => `import { Schedule } from "./schedule.js";\n${s}`, 1, /imports from "\.\/schedule\.js"/],
        [(s) => `import Schedule from "./schedule.js";\n${s}`, 1, /no default import/],
        [(s) => `import { Notice as Toast } from "obsidian";\n${s}`, 1, /no renaming/],
        [(s) => `const before = 1;\n${s}`, 1, /comes before the class/],
        [(s) => s.replace("export default class", "class"), null, /no `export default class <Name>`/],
    ]) {
        fs.writeFileSync(file, planted(source));
        await assert.rejects(build({ src: copy, outfile: path.join(copy, "main.js.out"), logLevel: "silent" }),
            (e) => {
                assert.match(e.message, new RegExp(`commands/plan\\.js${at ? `:${at}` : ""}`), String(pattern));
                assert.match(e.message, pattern);
                return true;
            });
    }
    assert.ok(classLine > 1, "plan.js imports before its class");
});

test("every class file passes the checks, and comments about CustomJS are left alone", () => {
    assert.equal(classFiles.length, 29);
    for (const f of classFiles) {
        assert.deepEqual(check(f, read(f)), [], f);
        assert.deepEqual(shapeProblems(f, read(f)), [], f);
    }
    assert.deepEqual(check("x.js", "class X {\n    // app.plugins.getPlugin(\"customjs\") is CustomJS's\n}\n"), []);
    assert.equal(check("x.js", "class X {\n    a() { return window.customJS; }\n}\n").length, 1);
});

test("npm refuses to install in a folder Obsidian has opened as a vault, from the root or plugin/", async () => {
    const { spawnSync } = await import("node:child_process");
    const repo = fs.mkdtempSync(path.join(tmp, "repo-"));
    fs.mkdirSync(path.join(repo, "plugin"));
    fs.copyFileSync(new URL("../preinstall.mjs", import.meta.url), path.join(repo, "plugin/preinstall.mjs"));
    const env = { ...process.env, CI: "", PLAINDAY_NPM_IN_VAULT: "" };
    const run = (cwd) => spawnSync(process.execPath, [path.join(repo, "plugin/preinstall.mjs")], { cwd, env, encoding: "utf8" });
    assert.equal(run(repo).status, 0, "a worktree or a fresh clone: never opened");
    fs.mkdirSync(path.join(repo, ".obsidian"));
    fs.writeFileSync(path.join(repo, ".obsidian/workspace.json"), "{}");
    for (const cwd of [repo, path.join(repo, "plugin")]) {
        const r = run(cwd);
        assert.equal(r.status, 1, cwd);
        assert.match(r.stderr, /Obsidian opens this folder as a vault/);
    }
    assert.equal(spawnSync(process.execPath, [path.join(repo, "plugin/preinstall.mjs")], { cwd: repo, env: { ...env, CI: "true" } }).status, 0, "CI");
});
