// Plainday's bundle: built from the class files as they are, it loads in Node against a stand-in
// for Obsidian's module. Every class is made by name, every command in the list is added with its
// id and name, the startup scripts run in order once the layout is ready, no CustomJS hook is left,
// and unloading leaves nothing of Plainday's behind. The build itself is tested too: a new CustomJS
// line in a class file stops it, naming the file and line.
//
// Run from the repository root, after `npm ci`: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, rewrite, CLASSES, ROOT } from "../esbuild.config.mjs";
import { COMMANDS, STARTUP, CUSTOMJS_ONLY } from "../src/commands.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plainday-bundle-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const BUNDLE = path.join(tmp, "main.js");
await build({ outfile: BUNDLE, logLevel: "silent" });

const classFiles = fs.readdirSync(CLASSES).filter((f) => f.endsWith(".js")).sort();
const classNameOf = (source) => /^class\s+([A-Za-z_$][\w$]*)/m.exec(source)?.[1] ?? null;
const CLASS_NAMES = classFiles.map((f) => classNameOf(fs.readFileSync(path.join(CLASSES, f), "utf8")));
const OWN = new Set(["obsidian", "app", "state"]);
const instances = (o) => Object.keys(o).filter((k) => !OWN.has(k) && !/^create.+Instance$/.test(k));

// Runs a built main.js the way Obsidian's plugin loader does, against stand-ins: `Plugin` records
// what the plugin adds, `Notice` what it shows, and the app holds the layout-ready callbacks.
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
        assert.equal(typeof window.plainday.obsidian, "object", "the classes reach Obsidian's module through it");
        assert.equal(globalThis.customJS, undefined, "no customJS global");
    } finally {
        plugin.onunload();
    }
});

test("each command in the list is added with its id and name, and runs its class", async () => {
    const { plugin } = load();
    plugin.onload();
    try {
        assert.deepEqual(plugin.commands.map(({ id, name }) => ({ id, name })), COMMANDS.map(({ id, name }) => ({ id, name })));
        assert.equal(plugin.commands.length, 14);
        for (const c of plugin.commands) {
            assert.match(c.id, /^[a-z]+(-[a-z]+)*$/, "ids are lower case with hyphens, without the plugin's id");
            // Sentence case: only the first word and proper names capitalized
            const [first, ...rest] = c.name.split(" ");
            assert.match(first, /^[A-Z][a-z]+$/, c.name);
            for (const w of rest) assert.ok(/^[a-z]+$/.test(w) || ["Obsidian", "PM"].includes(w), `sentence case: ${c.name}`);
        }
        for (const name of CUSTOMJS_ONLY) {
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

test("the startup scripts wait for the layout, then run one after the other in CustomJS's order", async () => {
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

test("no CustomJS hook or customJS global is left in the bundle", () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    for (const p of [/["'`]customjs["'`]/, /\.customjs\b/, /\b(?:globalThis|window|self)\??\.customJS\b/]) {
        assert.doesNotMatch(text, p);
    }
    assert.doesNotMatch(text, /disablePlugin|enablePlugin/, "UpdateObsidianPM's offer to reload CustomJS is left out");
});

test("the bundle names no folder on the machine that built it, so a build anywhere matches the release (OBS-230)", () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    assert.ok(!text.includes(ROOT), `main.js names ${ROOT}`);
    assert.match(text, /^\/\/ plainday-class:schedule\.js$/m, "each class by its file name");
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

// A class written the way the real ones are, using each hook the build rewrites
const PROBE = `class Probe {
    on() { return app.plugins.enabledPlugins.has("customjs"); }
    add(extension) { app.plugins.plugins.customjs.registerEditorExtension(extension); }
    others() { return globalThis.customJS; }
    async invoke() {}
}
`;
const PROBE_REWRITES = [
    { from: 'app.plugins.enabledPlugins.has("customjs")', to: "plainday$loaded()", files: { "probe.js": 1 } },
    { from: "app.plugins.plugins.customjs.registerEditorExtension(", to: "plainday$registerEditorExtension(", files: { "probe.js": 1 } },
    { from: "globalThis.customJS", to: "customJS", files: { "probe.js": 1 } },
];

test("in the bundle, the hooks reach Plainday: loaded, its own editor extensions, its own classes", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "probe-"));
    fs.writeFileSync(path.join(dir, "probe.js"), PROBE);
    const out = path.join(dir, "main.js");
    await build({ classes: dir, outfile: out, rewrites: PROBE_REWRITES, logLevel: "silent" });
    const { plugin } = load(out);
    plugin.onload();
    const probe = window.plainday.Probe;
    assert.equal(probe.on(), true, "loaded");
    probe.add("an extension");
    assert.deepEqual(plugin.extensions, ["an extension"], "through the plugin, which Obsidian undoes on unload");
    assert.equal(probe.others(), window.plainday, "the bundle's own classes");
    plugin.onunload();
    assert.equal(probe.on(), false, "a listener left over sees Plainday is gone");
    assert.throws(() => probe.add("another"), /isn't loaded/);
});

test("the build stops on a new CustomJS line in a class file, and names the file and line", async () => {
    const copy = fs.mkdtempSync(path.join(tmp, "classes-"));
    for (const f of classFiles) fs.copyFileSync(path.join(CLASSES, f), path.join(copy, f));
    const file = path.join(copy, "syncArea.js");
    const source = fs.readFileSync(file, "utf8");
    const at = source.lastIndexOf("\n}");
    const line = source.slice(0, at).split("\n").length + 1;

    fs.writeFileSync(file, `${source.slice(0, at)}\n    planted() { return app.plugins.enabledPlugins.has("customjs"); }${source.slice(at)}`);
    await assert.rejects(build({ classes: copy, outfile: path.join(copy, "main.js"), logLevel: "silent" }),
        (e) => {
            assert.match(e.message, new RegExp(`syncArea\\.js has \`app\\.plugins\\.enabledPlugins\\.has\\("customjs"\\)\` twice \\(line \\d+, ${line}\\), where the build expects it once`));
            return true;
        });

    for (const planted of ['app.plugins.getPlugin("customjs")', 'app.commands.executeCommandById("customjs:invoke-Schedule")']) {
        fs.writeFileSync(file, `${source.slice(0, at)}\n    planted() { return ${planted}; }${source.slice(at)}`);
        await assert.rejects(build({ classes: copy, outfile: path.join(copy, "main.js"), logLevel: "silent" }),
            (e) => {
                assert.match(e.message, new RegExp(`syncArea\\.js:${line} still reaches for CustomJS: planted\\(\\)`), planted);
                return true;
            });
    }
    assert.ok(!fs.existsSync(path.join(copy, "main.js")), "no bundle from a failed build");
});

test("a rewrite keeps the class's line numbers, and comments about CustomJS are left alone", () => {
    const source = fs.readFileSync(path.join(CLASSES, "updateObsidianPM.js"), "utf8");
    const { text, problems } = rewrite("updateObsidianPM.js", source);
    assert.deepEqual(problems, []);
    assert.equal(text.split("\n").length, source.split("\n").length);
    const after = (s) => s.split("\n").findIndex((l) => l.includes("the bits that touch the app"));
    assert.equal(after(text), after(source));
    assert.deepEqual(rewrite("x.js", "class X {\n    // app.plugins.getPlugin(\"customjs\") is CustomJS's\n}\n", []).problems, []);
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
