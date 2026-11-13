// Tests for the CI checks. Run from the repo root: node --test .github/ci/*.test.mjs
// Everything here is invented: the paths, names and amounts stand for the shapes the checks
// must catch, not for anything real. The fixtures are split with `+` so this file's own diff
// doesn't trip the privacy scan.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadClass, checkAll as checkScripts, checkPlainday } from "./checkScripts.mjs";
import { scanLine, scanDiff, scanText, describe } from "./privacy.mjs";
import { docsSection, checkLinearLink, checkDocs } from "./checkPR.mjs";
import { oldFolderLines, checkAll as checkFolders } from "./checkFolders.mjs";
import { checkVersionFiles, compareVersions, checkAll as checkVersion } from "./checkVersion.mjs";
import { checkBaselineFiles, ruleTotals, checkAll as checkBaseline, BASELINE, ROOT_BASELINE } from "./checkBaseline.mjs";
import { run as release, FILES as RELEASE_FILES, manifestAt as releaseManifestAt } from "./release.mjs";
import { summary as lintSummary } from "./lintSummary.mjs";
import { spawnSync } from "node:child_process";

// ------------------------------------------------------------------ scripts load

test("a class that evaluates cleanly passes; a syntax error and a missing class fail", () => {
    assert.equal(loadClass("class Thing {\n  async invoke() {}\n}\n", "thing.js"), null);
    assert.match(loadClass("class Thing {\n  async invoke( {}\n}\n", "thing.js"), /thing\.js: SyntaxError/);
    assert.match(loadClass("const x = 1;\n", "x.js"), /no top-level class/);
    // A top-level reference to something only Obsidian provides breaks at startup too
    assert.match(loadClass("const m = moment();\nclass Thing {}\n", "thing.js"), /ReferenceError/);
});

test("checkAll reports a broken class file and a Templater script that doesn't parse", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
    const cjs = path.join(root, "plugin/src/classes");
    const tpl = path.join(root, "Config/Scripts/Templater");
    fs.mkdirSync(cjs, { recursive: true });
    fs.mkdirSync(tpl, { recursive: true });
    fs.writeFileSync(path.join(cjs, "good.js"), "class Good {}\n");
    fs.writeFileSync(path.join(cjs, "bad.js"), "class Bad {\n");
    fs.writeFileSync(path.join(tpl, "user.js"), "function f( {}\n");
    const problems = checkScripts(root);
    assert.ok(problems.some((p) => p.includes("bad.js") && p.includes("SyntaxError")), problems.join("\n"));
    assert.ok(problems.some((p) => p.includes("Templater/user.js")), problems.join("\n"));
    assert.ok(!problems.some((p) => p.includes("good.js")), problems.join("\n"));
    fs.rmSync(root, { recursive: true });
});

// ------------------------------------------------------------------ privacy

const rulesOf = (line) => scanLine(line).map((f) => `${f.severity}:${f.rule}`);

test("home-folder paths block, ~ and repo paths don't", () => {
    assert.deepEqual(rulesOf("see /Users/" + "somebody/vault/note.md"), ["block:home folder path"]);
    assert.deepEqual(rulesOf("see /home/" + "somebody/vault"), ["block:home folder path"]);
    assert.deepEqual(rulesOf("log at ~/Library/Logs/calendar-sync.log"), []);
    assert.deepEqual(rulesOf("a site at https://example.com/home/page"), []);
    assert.deepEqual(rulesOf("plugin/src/classes/plan.js"), []);
});

test("emails block except the bot and GitHub noreply addresses", () => {
    assert.deepEqual(rulesOf("Co-authored-by: Bot <noreply@anthropic.com>"), []);
    assert.deepEqual(rulesOf("Co-authored-by: Someone <123+someone@users.noreply.github.com>"), []);
    assert.deepEqual(rulesOf("mail me at someone@example.com"), []);
    assert.deepEqual(rulesOf("mail me at someone@" + "somewhere.org"), ["block:email address"]);
});

test("tokens, keys and claude.ai links block; the log doesn't echo a token", () => {
    assert.deepEqual(rulesOf("token ghp_" + "a".repeat(36)), ["block:GitHub token"]);
    assert.deepEqual(rulesOf("LINEAR=lin_api_" + "b".repeat(40)), ["block:Linear token"]);
    assert.deepEqual(rulesOf("sk-ant-" + "c".repeat(30)), ["block:Anthropic key"]);
    assert.deepEqual(rulesOf("-----BEGIN RSA " + "PRIVATE KEY-----"), ["block:private key"]);
    assert.deepEqual(rulesOf("Claude-Session: https://claude.ai/code/" + "session_0123456789abcdef"), ["block:claude.ai link"]);
    assert.deepEqual(rulesOf("https://claude.ai/artifact/" + "0123456789"), ["block:claude.ai link"]);
    const [f] = scanLine("token ghp_" + "a".repeat(36));
    assert.equal(describe(f), "GitHub token: ghp_aa…");
});

test("dollar amounts only warn, and regex back-references aren't amounts", () => {
    assert.deepEqual(rulesOf("| $" + "80/hr | $" + "1,250.00 |"), ["warn:dollar amount", "warn:dollar amount"]);
    assert.deepEqual(rulesOf('line.replace(/x/, "$1[<]") + "$0"'), []);
});

test("scanDiff reports added lines only, with the file and new line number", () => {
    const diff = [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -10,3 +10,4 @@",
        " unchanged",
        "-/Users/" + "old/removed",
        "+kept",
        "+see /Users/" + "somebody/vault",
        " tail",
        "diff --git a/x.md b/x.md",
        "--- a/x.md",
        "+++ b/x.md",
        "@@ -1 +1,2 @@",
        " a",
        "+someone@" + "somewhere.org",
    ].join("\n");
    const found = scanDiff(diff).map((f) => [f.rule, f.where, f.line]);
    assert.deepEqual(found, [["home folder path", "README.md", 12], ["email address", "x.md", 2]]);
});

test("scanText labels commit messages and PR text", () => {
    const found = scanText("fine\nhttps://claude.ai/code/" + "session_x1\n", "PR body");
    assert.deepEqual(found.map((f) => [f.rule, f.where, f.line]), [["claude.ai link", "PR body", 2]]);
});

// ------------------------------------------------------------------ PR metadata

test("docsSection finds the section at any heading level and stops at the next heading", () => {
    assert.equal(docsSection("## Summary\nx\n\n## Docs\n\nREADME updated.\nNothing else.\n\n## Test plan\ny"), "README updated.\nNothing else.");
    assert.equal(docsSection("### docs\nline\n#### sub\nmore\n### Next\nz"), "line\n#### sub\nmore");
    assert.equal(docsSection("## Documentation\nline"), null);
    assert.equal(docsSection(""), null);
    assert.equal(docsSection(undefined), null);
});

test("Linear link: a closing line matching the branch's issue", () => {
    assert.deepEqual(checkLinearLink({ body: "Closes OBS-21", branch: "someone/obs-21-ci" }), []);
    assert.deepEqual(checkLinearLink({ body: "fixes obs-21", branch: "someone/obs-21-ci" }), []);
    assert.deepEqual(checkLinearLink({ body: "Part of OBS-7", branch: "someone/sync-links" }), []);
    assert.match(checkLinearLink({ body: "Nice change", branch: "someone/obs-21-ci" })[0], /doesn't link/);
    assert.match(checkLinearLink({ body: "Closes OBS-22", branch: "someone/obs-21-ci" })[0], /Closes OBS-21/);
    assert.match(checkLinearLink({ body: "Part of OBS-21", branch: "someone/obs-21-ci" })[0], /Part of/);
    assert.deepEqual(checkLinearLink({ body: "Closes OBS-21", branch: "someone/obs-210-other" }).length, 1);
});

test("Linear link: a cluster lists its issues after one keyword", () => {
    for (const body of ["Closes OBS-65, OBS-66", "Closes OBS-65,OBS-66", "Closes OBS-65 and OBS-66", "Closes OBS-64, OBS-65, and OBS-66", "Fixes OBS-65 & OBS-66"]) {
        assert.deepEqual(checkLinearLink({ body, branch: "someone/obs-66-due" }), [], body);
    }
    assert.deepEqual(checkLinearLink({ body: "Closes OBS-65\nCloses OBS-66", branch: "someone/obs-66-due" }), []);
    // A list ends at anything that isn't another issue
    assert.match(checkLinearLink({ body: "Closes OBS-65, see OBS-66", branch: "someone/obs-66-due" })[0], /Closes OBS-66/);
    // "Part of" a list still doesn't close the branch's issue
    assert.match(checkLinearLink({ body: "Part of OBS-65, OBS-66", branch: "someone/obs-66-due" })[0], /Part of/);
});

test("docs gate: only system changes need it; the manual, the README or a Docs section saying why", () => {
    const script = ["plugin/src/classes/plan.js"];
    assert.deepEqual(checkDocs({ body: "", changed: ["Welcome.md", "Config/Bases/Projects.base"] }), []);
    assert.match(checkDocs({ body: "Closes OBS-1", changed: script })[0], /## Docs/);
    assert.deepEqual(checkDocs({ body: "", changed: [...script, "Config/Manual.md"] }), []);
    assert.deepEqual(checkDocs({ body: "", changed: [...script, "README.md"] }), []);
    assert.match(checkDocs({ body: "## Docs\n\n## Test plan\nx", changed: script })[0], /must say why/);
    assert.deepEqual(checkDocs({ body: "## Docs\nInternal refactor, nothing a user sees.", changed: script }), []);
    assert.deepEqual(checkDocs({ body: "", changed: ["Config/Templates/Task.md", "Config/Manual.md"] }), []);
    assert.match(checkDocs({ body: "", changed: ["Config/Scripts/Calendar/sync-calendar.sh"] })[0], /Manual\.md and README\.md/);
});

test("OBS-81: a numbered folder the vault dropped is caught, in any case; plain names and other numbers aren't", () => {
    const old = (n, name) => `${n} ${name}`;   // built from parts, so this file doesn't name them
    for (const line of [`path: "${old("00", "Meta")}/Manual.md"`, `${old("30", "Reference")}/${old("36", "Planner")}/days`, `in ${old("90", "archive")}`, old("02", "Scripts"), old("37", "Journal")]) {
        assert.equal(oldFolderLines(line).length, 1, line);
    }
    for (const line of ["plugin/src/classes", "Reference/Planner/days", "Archive", "20 Projects/Freelance", "40 Trailhead pack", "2026-09-14"]) {
        assert.deepEqual(oldFolderLines(line), [], line);
    }
    assert.deepEqual(oldFolderLines(`a\nb ${old("10", "Inbox")}\nc`).map((l) => l.line), [2]);
});

test("OBS-81: no tracked file names a numbered folder", () => {
    assert.deepEqual(checkFolders(), []);
});

// ------------------------------------------------------------------ Plainday (OBS-226)

test("the docs gate counts Plainday's source and manifest as system files", () => {
    assert.match(checkDocs({ body: "", changed: ["plugin/src/main.js"] })[0], /system files changed \(plugin\/src\/main\.js\)/);
    assert.match(checkDocs({ body: "", changed: ["manifest.json"] })[0], /system files changed/);
    assert.deepEqual(checkDocs({ body: "", changed: ["plugin/src/main.js", "Config/Manual.md"] }), []);
    assert.deepEqual(checkDocs({ body: "", changed: ["package-lock.json"] }), [], "the build's tools aren't");
});

test("Plainday's command list must name classes that exist, with no id or name twice", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
    const commands = (body) => {
        fs.mkdirSync(path.join(root, "plugin/src"), { recursive: true });
        fs.writeFileSync(path.join(root, "plugin/src/commands.js"), body);
        fs.writeFileSync(path.join(root, "plugin/package.json"), '{"type":"module"}\n');
    };
    const cjs = path.join(root, "plugin/src/classes");
    fs.mkdirSync(cjs, { recursive: true });
    for (const name of ["Schedule", "Plan", "SyncArea", "CheckOff"]) fs.writeFileSync(path.join(cjs, `${name}.js`), `class ${name} {}\n`);
    try {
        assert.deepEqual(await checkPlainday(root), ["plugin/src/commands.js: missing"]);
        commands(`export const COMMANDS = [
    { id: "schedule", name: "Schedule", script: "Schedule" },
    { id: "plan", name: "Plan", script: "Plan" },
    { id: "plan", name: "Schedule", script: "Invoice" },
];
export const STARTUP = ["SyncArea", "CheckOff", "Gone"];
`);
        const problems = await checkPlainday(root);
        const has = (re) => assert.ok(problems.some((p) => re.test(p)), `${re}\n${problems.join("\n")}`);
        has(/the command "plan" runs Invoice, which no plugin\/src\/classes file defines/);
        has(/STARTUP names Gone, which no plugin\/src\/classes file defines/);
        has(/two commands have the id "plan"/);
        has(/two commands have the name "Schedule"/);
        assert.equal(problems.length, 4, problems.join("\n"));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("the repository's own Plainday command list names classes that exist", async () => {
    assert.deepEqual(await checkPlainday("."), []);
});

// ------------------------------------------------------------------ versions and releases (OBS-230)

// The four version files for a version, as `npm version` leaves them
const versionFiles = (v, { pkg = v, lock = v, lockRoot = v, versions = { [v]: "1.11.4" }, minApp = "1.11.4" } = {}) => ({
    "manifest.json": JSON.stringify({ id: "plainday", version: v, minAppVersion: minApp }),
    "package.json": JSON.stringify({ name: "plainday", version: pkg }),
    "package-lock.json": JSON.stringify({ name: "plainday", version: lock, packages: { "": { version: lockRoot } } }),
    "versions.json": JSON.stringify(versions),
});
const manifestAt = (v) => JSON.stringify({ version: v });

test("version files that agree pass, at main's version or above", () => {
    assert.deepEqual(checkVersionFiles(versionFiles("0.0.2")), []);
    assert.deepEqual(checkVersionFiles(versionFiles("0.0.2"), manifestAt("0.0.2")), []);
    assert.deepEqual(checkVersionFiles(versionFiles("0.1.0"), manifestAt("0.0.9")), []);
    assert.deepEqual(checkVersionFiles(versionFiles("0.0.10"), manifestAt("0.0.9")), [], "compared as numbers, not text");
    assert.equal(compareVersions("0.0.10", "0.0.9"), 1);
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("version files that disagree fail, naming the file", () => {
    const one = (files) => {
        const p = checkVersionFiles(files);
        assert.equal(p.length, 1, p.join("\n"));
        return p[0];
    };
    assert.match(one(versionFiles("0.0.2", { pkg: "0.0.1" })), /^package\.json says "0\.0\.1" and manifest\.json says 0\.0\.2/);
    assert.match(one(versionFiles("0.0.2", { lock: "0.0.1" })), /^package-lock\.json says "0\.0\.1"/);
    assert.match(one(versionFiles("0.0.2", { lockRoot: "0.0.1" })), /^package-lock\.json \(its root package\) says "0\.0\.1"/);
    assert.match(one(versionFiles("0.0.2", { versions: { "0.0.1": "1.11.4" } })), /^versions\.json doesn't list 0\.0\.2/);
    assert.match(one(versionFiles("0.0.2", { versions: { "0.0.2": "1.10.0" } })), /minimum Obsidian "1\.10\.0", and manifest\.json's minAppVersion is "1\.11\.4"/);
    const missing = versionFiles("0.0.2");
    delete missing["versions.json"];
    assert.deepEqual(checkVersionFiles(missing), ["versions.json: missing"]);
});

test("a version that isn't three numbers fails, and so does one lower than main's", () => {
    for (const v of ["v0.0.2", "0.0.2-beta", "0.2", "01.0.0", "0.0.2 "]) {
        const p = checkVersionFiles(versionFiles(v));
        assert.equal(p.length, 1, `${v}: ${p.join("\n")}`);
        assert.match(p[0], /must be three numbers/, v);
    }
    assert.deepEqual(checkVersionFiles(versionFiles("0.0.1"), manifestAt("0.0.2")), [
        "manifest.json's version 0.0.1 is lower than main's 0.0.2: a release never goes backwards",
    ]);
    assert.deepEqual(checkVersionFiles(versionFiles("0.0.1"), undefined), [], "main without a manifest: nothing to compare");
});

test("the repository's own version files agree", () => {
    assert.deepEqual(checkVersion({}), []);
});

test("npm's version step raises manifest.json and versions.json, and refuses a version that isn't three numbers", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
    const bump = (v) => spawnSync(process.execPath, [path.resolve("plugin/version-bump.mjs")], {
        cwd: root, encoding: "utf8", env: { ...process.env, npm_package_version: v },
    });
    try {
        fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ id: "plainday", version: "0.0.1", minAppVersion: "1.11.4" }, null, 2));
        fs.writeFileSync(path.join(root, "versions.json"), '{\n  "0.0.1": "1.11.4"\n}\n');
        assert.equal(bump("0.0.2").status, 0);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).version, "0.0.2");
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8")), { "0.0.1": "1.11.4", "0.0.2": "1.11.4" });
        const bad = bump("0.0.3-beta");
        assert.equal(bad.status, 1);
        assert.match(bad.stderr, /three numbers/);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).version, "0.0.2", "unchanged");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// ------------------------------------------------------------------ the lint baseline (OBS-230)

const baseline = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([file, rules]) =>
    [file, Object.fromEntries(Object.entries(rules).map(([r, count]) => [r, { count }]))])));
const MAIN = baseline({ "a.js": { "obsidianmd/regex-lookbehind": 2, "no-empty": 1 }, "b.js": { "obsidianmd/regex-lookbehind": 1 } });
const PKG = (pluginVersion = "0.5.1", eslint = "10.14.0") => JSON.stringify({ devDependencies: { "eslint-plugin-obsidianmd": pluginVersion, eslint } });

test("a baseline the same as main's, or smaller, passes", () => {
    assert.deepEqual(ruleTotals(JSON.parse(MAIN)), { "obsidianmd/regex-lookbehind": 3, "no-empty": 1 });
    assert.deepEqual(checkBaselineFiles({ base: MAIN, head: MAIN, basePkg: PKG(), headPkg: PKG() }).problems, []);
    const smaller = baseline({ "a.js": { "obsidianmd/regex-lookbehind": 1 } });
    assert.deepEqual(checkBaselineFiles({ base: MAIN, head: smaller, basePkg: PKG(), headPkg: PKG() }).problems, []);
    assert.deepEqual(checkBaselineFiles({ base: MAIN, head: undefined, basePkg: PKG(), headPkg: PKG() }).problems, [], "no baseline left at all");
});

test("a bigger baseline fails, rule by rule, and a renamed file's entries pass", () => {
    const bigger = baseline({ "a.js": { "obsidianmd/regex-lookbehind": 3, "no-empty": 1 }, "b.js": { "obsidianmd/regex-lookbehind": 1 } });
    const p = checkBaselineFiles({ base: MAIN, head: bigger, basePkg: PKG(), headPkg: PKG() }).problems;
    assert.equal(p.length, 1, p.join("\n"));
    assert.match(p[0], /^\.github\/ci\/eslint-suppressions\.json: obsidianmd\/regex-lookbehind: 4 errors let through, main has 3\. The baseline only shrinks/);
    // The same total, with a lookbehind traded for a fixed empty block: still a new lookbehind
    const swapped = baseline({ "a.js": { "obsidianmd/regex-lookbehind": 3 }, "b.js": { "obsidianmd/regex-lookbehind": 1 } });
    assert.equal(checkBaselineFiles({ base: MAIN, head: swapped, basePkg: PKG(), headPkg: PKG() }).problems.length, 1);
    const newRule = JSON.stringify({ ...JSON.parse(MAIN), "c.js": { "no-useless-escape": { count: 1 } } });
    assert.match(checkBaselineFiles({ base: MAIN, head: newRule, basePkg: PKG(), headPkg: PKG() }).problems[0], /no-useless-escape: 1 errors let through, main has 0/);
    const renamed = baseline({ "a2.js": { "obsidianmd/regex-lookbehind": 2, "no-empty": 1 }, "b.js": { "obsidianmd/regex-lookbehind": 1 } });
    assert.deepEqual(checkBaselineFiles({ base: MAIN, head: renamed, basePkg: PKG(), headPkg: PKG() }).problems, []);
});

test("a bigger baseline passes when the same PR updates the lint, and main without a baseline passes", () => {
    const bigger = baseline({ "a.js": { "obsidianmd/regex-lookbehind": 5, "no-empty": 1 } });
    const r = checkBaselineFiles({ base: MAIN, head: bigger, basePkg: PKG("0.5.1"), headPkg: PKG("0.6.0") });
    assert.deepEqual(r.problems, []);
    assert.ok(r.notes.some((n) => n.includes("eslint-plugin-obsidianmd 0.5.1 → 0.6.0")), r.notes.join("\n"));
    assert.deepEqual(checkBaselineFiles({ base: MAIN, head: bigger, basePkg: PKG(), headPkg: PKG("0.5.1", "10.15.0") }).problems, [], "ESLint's own update");
    assert.deepEqual(checkBaselineFiles({ base: undefined, head: bigger, basePkg: undefined, headPkg: PKG() }).problems, []);
    assert.match(checkBaselineFiles({ base: MAIN, head: "{", basePkg: PKG(), headPkg: PKG() }).problems[0], /not valid JSON/);
});

test("the lint summary counts warnings by rule and the baseline's errors", () => {
    const md = lintSummary([
        { filePath: "a.js", messages: [{ severity: 1, ruleId: "no-restricted-globals" }, { severity: 1, ruleId: "no-restricted-globals" }, { severity: 1, ruleId: "obsidianmd/prefer-window-timers" }] },
        { filePath: "b.js", messages: [] },
    ], JSON.parse(MAIN));
    assert.match(md, /2 files\. 4 errors let through by the baseline \(`\.github\/ci\/eslint-suppressions\.json`\), 3 warnings\./);
    assert.match(md, /\| `no-restricted-globals` \| 2 \|\n\| `obsidianmd\/prefer-window-timers` \| 1 \|/);
    assert.match(lintSummary([{ filePath: "a.js", messages: [{ severity: 2, ruleId: "x" }] }], {}), /\*\*1 errors not in the baseline\.\*\*/);
});

// A git repository whose first commit has `files`; returns its root, that commit, and git
function repoAt(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
    const git = (...args) => spawnSync("git", ["-C", root, "-c", "user.name=CI", "-c", "user.email=ci@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
    git("init", "-q");
    for (const [f, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
        fs.writeFileSync(path.join(root, f), text);
    }
    git("add", "-A");
    git("commit", "-q", "-m", "main");
    return { root, sha: git("rev-parse", "HEAD").stdout.trim(), git };
}

test("main's baseline is read at its new path, or at the root from before the move (OBS-268)", () => {
    for (const at of [BASELINE, ROOT_BASELINE]) {
        const { root, sha, git } = repoAt({ [at]: MAIN, "package.json": PKG() });
        try {
            if (at === ROOT_BASELINE) {
                fs.mkdirSync(path.join(root, path.dirname(BASELINE)), { recursive: true });
                git("mv", ROOT_BASELINE, BASELINE);
            }
            const r = checkBaseline({ BASE_SHA: sha }, root);
            assert.deepEqual(r.problems, [], at);
            assert.deepEqual(r.notes, ["The lint baseline lets through 4 errors (main: 4)."], at);
            fs.writeFileSync(path.join(root, BASELINE), baseline({ "a.js": { "obsidianmd/regex-lookbehind": 3, "no-empty": 1 }, "b.js": { "obsidianmd/regex-lookbehind": 1 } }));
            assert.equal(checkBaseline({ BASE_SHA: sha }, root).problems.length, 1, `${at}: a bigger baseline still fails`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

test("an eslint-suppressions.json at the root fails, where the directory's scan would stop on it (OBS-268)", () => {
    const { root, sha } = repoAt({ [BASELINE]: MAIN, "package.json": PKG() });
    try {
        assert.deepEqual(checkBaseline({ BASE_SHA: sha }, root).problems, []);
        assert.deepEqual(checkBaseline({}, root).problems, []);
        fs.writeFileSync(path.join(root, ROOT_BASELINE), MAIN);
        for (const env of [{ BASE_SHA: sha }, {}]) {
            const p = checkBaseline(env, root).problems;
            assert.equal(p.length, 1, p.join("\n"));
            assert.match(p[0], /^eslint-suppressions\.json is at the repository's root, where the community directory's scan stops on it \(OBS-268\)\. The baseline is \.github\/ci\/eslint-suppressions\.json/);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("the repository's lint commands name the baseline, and none is at the root (OBS-268)", () => {
    const flag = `--suppressions-location ${BASELINE}`;
    const { scripts } = JSON.parse(fs.readFileSync("package.json", "utf8"));
    // The first run reads the baseline; the second, Plainday's own code, has no entries
    assert.ok(scripts.lint.split(" && ")[0].includes(flag), scripts.lint);
    assert.ok(scripts["lint:prune"].includes(flag), scripts["lint:prune"]);
    const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    const eslintRuns = ci.split("\n").filter((l) => /\bnpx eslint\b/.test(l));
    assert.ok(eslintRuns.length, "the lint summary step runs ESLint");
    for (const l of eslintRuns) assert.ok(l.includes(flag), l);
    assert.ok(fs.existsSync(BASELINE), BASELINE);
    assert.equal(fs.existsSync(ROOT_BASELINE), false);
});

// ------------------------------------------------------------------ the release script (OBS-230)

// A stand-in for the gh CLI: `releases` are the tags that have a release
function fakeGh({ releases = [], fail = false } = {}) {
    const calls = [];
    const gh = (args) => {
        calls.push(args);
        if (fail) return { status: 1, stdout: "", stderr: "HTTP 502: Bad Gateway" };
        const tag = /releases\/tags\/(.+)$/.exec(args[1] ?? "")?.[1];
        if (args[0] === "api" && tag) {
            return releases.includes(tag) ? { status: 0, stdout: `${tag}\n`, stderr: "" } : { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
        }
        if (args[0] === "api") return { status: 0, stdout: `${Math.min(releases.length, 1)}\n`, stderr: "" };
        if (args[0] === "release" && args[1] === "create") return { status: 0, stdout: `https://github.com/owner/repo/releases/tag/${args[2]}\n`, stderr: "" };
        throw new Error(`unexpected gh ${args.join(" ")}`);
    };
    return { gh, calls };
}

function releaseRoot({ version = "0.0.1", styles = false, main = "// main.js\n" } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ id: "plainday", version }));
    if (main !== null) fs.writeFileSync(path.join(root, "main.js"), main);
    if (styles) fs.writeFileSync(path.join(root, "styles.css"), ".plainday {}\n");
    return { root, out: path.join(root, "out") };
}

// The version before the merge (or on the PR's base), as manifestAt reads it
const before = (v) => ({ sha: "bef0123", readable: true, manifest: v === undefined ? undefined : JSON.stringify({ id: "plainday", version: v }) });

test("the dry run says merging publishes only when the PR raises the version, and collects the release's files", () => {
    const { root, out } = releaseRoot({ version: "0.0.2" });
    try {
        const { gh, calls } = fakeGh({ releases: ["0.0.1"] });
        const r = release({ mode: "dry-run", root, out, gh, before: before("0.0.1") });
        assert.equal(r.message, "Merging publishes 0.0.2, with main.js, manifest.json.");
        assert.deepEqual(fs.readdirSync(out).sort(), ["main.js", "manifest.json"]);
        assert.ok(!calls.some((c) => c[0] === "release"), "a dry run publishes nothing");
        // The same version as main's publishes nothing, even when it has no release (OBS-266)
        const same = release({ mode: "dry-run", root, out, gh: fakeGh().gh, before: before("0.0.2") });
        assert.equal(same.published, false);
        assert.match(same.message, /^This PR leaves the version at 0\.0\.2, so merging publishes nothing\./);
        assert.deepEqual(fs.readdirSync(out).sort(), ["main.js", "manifest.json"], "the files are kept either way");
        const done = release({ mode: "dry-run", root, out, gh: fakeGh({ releases: ["0.0.2"] }).gh, before: before("0.0.1") });
        assert.match(done.message, /^0\.0\.2 is already released, so merging publishes nothing\./);
        assert.match(release({ mode: "dry-run", root, out, gh: fakeGh().gh, before: before(undefined) }).message, /^Merging publishes 0\.0\.2/, "main without a manifest");
        assert.throws(() => release({ mode: "dry-run", root, out, gh: fakeGh().gh, before: { sha: "bef0123", readable: false } }), /couldn't read main's commit bef0123/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a merge publishes only when it raises the version; a run by hand publishes any version without a release (OBS-266)", () => {
    const { root, out } = releaseRoot();
    try {
        // Unchanged, and released: nothing
        const a = fakeGh({ releases: ["0.0.1"] });
        const kept = release({ mode: "publish", root, out, sha: "abc1234", gh: a.gh, before: before("0.0.1") });
        assert.equal(kept.published, false);
        assert.ok(!a.calls.some((c) => c[0] === "release"));
        // Unchanged, and no release (one deleted, or a publish that failed): still nothing, and says why
        const b = fakeGh();
        const gone = release({ mode: "publish", root, out, sha: "abc1234", gh: b.gh, before: before("0.0.1") });
        assert.equal(gone.published, false);
        assert.equal(gone.message, 'This merge left the version at 0.0.1, so it publishes nothing. To release, a PR raises the version (CLAUDE.md, "Releases").');
        assert.ok(!b.calls.some((c) => c[0] === "release"));
        // Lowered (only a push straight to main could): nothing
        const lower = release({ mode: "publish", root, out, sha: "abc1234", gh: fakeGh().gh, before: before("0.0.2") });
        assert.equal(lower.published, false);
        assert.match(lower.message, /^This merge lowered the version from 0\.0\.2 to 0\.0\.1, so it publishes nothing\./);
        // Raised: publishes
        const c = fakeGh();
        const raised = release({ mode: "publish", root, out, sha: "abc1234", gh: c.gh, before: before("0.0.0") });
        assert.equal(raised.published, true);
        assert.equal(c.calls.filter((x) => x[0] === "release").length, 1);
        // The commit before can't be read (a new branch's zeros, or a force push): nothing, with a warning
        const d = fakeGh();
        const unread = release({ mode: "publish", root, out, sha: "abc1234", gh: d.gh, before: { sha: "bef0123", readable: false } });
        assert.equal(unread.published, false);
        assert.equal(unread.warning, true);
        assert.match(unread.message, /^Couldn't read the commit before this push \(bef0123\), .* publishes nothing\. If it did, run the Release workflow by hand\./);
        assert.ok(!d.calls.some((x) => x[0] === "release"));
        // By hand (no `before`): publishes the manifest's version when it has no release, as before
        const e = fakeGh();
        assert.equal(release({ mode: "publish", root, out, sha: "abc1234", gh: e.gh }).published, true);
        assert.equal(release({ mode: "publish", root, out, sha: "abc1234", gh: fakeGh({ releases: ["0.0.1"] }).gh }).published, false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("manifestAt reads main's manifest.json at a commit, and tells a missing commit from a missing file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
    const git = (...args) => spawnSync("git", ["-C", root, "-c", "user.name=CI", "-c", "user.email=ci@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
    try {
        git("init", "-q");
        fs.writeFileSync(path.join(root, "README.md"), "x\n");
        git("add", "README.md");
        git("commit", "-q", "-m", "first");
        const first = git("rev-parse", "HEAD").stdout.trim();
        fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ version: "0.0.1" }));
        git("add", "manifest.json");
        git("commit", "-q", "-m", "second");
        const second = git("rev-parse", "HEAD").stdout.trim();
        assert.deepEqual(releaseManifestAt(second, root), { sha: second, readable: true, manifest: JSON.stringify({ version: "0.0.1" }) });
        assert.deepEqual(releaseManifestAt(first, root), { sha: first, readable: true, manifest: undefined }, "a commit from before the manifest");
        for (const sha of ["", undefined, "0".repeat(40), "f".repeat(40)]) {
            assert.equal(releaseManifestAt(sha, root).readable, false, String(sha));
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("publish makes the first release with its own notes, a later one with GitHub's, and styles.css once there is one", () => {
    const first = releaseRoot();
    const later = releaseRoot({ version: "0.0.2", styles: true });
    try {
        const a = fakeGh();
        const r = release({ mode: "publish", ...first, sha: "abc1234def", gh: a.gh });
        assert.equal(r.published, true);
        const create = a.calls.find((c) => c[0] === "release");
        assert.deepEqual(create, ["release", "create", "0.0.1", path.join(first.out, "main.js"), path.join(first.out, "manifest.json"),
            "--target", "abc1234def", "--title", "0.0.1", "--notes", "First release."]);
        const b = fakeGh({ releases: ["0.0.1"] });
        release({ mode: "publish", ...later, sha: "abc1234def", gh: b.gh });
        const create2 = b.calls.find((c) => c[0] === "release");
        assert.ok(create2.includes(path.join(later.out, "styles.css")), create2.join(" "));
        assert.equal(create2.at(-1), "--generate-notes");
        assert.deepEqual(RELEASE_FILES, ["main.js", "manifest.json", "styles.css"]);
    } finally {
        fs.rmSync(first.root, { recursive: true, force: true });
        fs.rmSync(later.root, { recursive: true, force: true });
    }
});

test("publish does nothing for a released version, and stops when GitHub can't say or main.js is missing", () => {
    const ok = releaseRoot();
    const noMain = releaseRoot({ main: null });
    const badVersion = releaseRoot({ version: "v0.0.1" });
    try {
        const a = fakeGh({ releases: ["0.0.1"] });
        const r = release({ mode: "publish", ...ok, sha: "abc1234", gh: a.gh });
        assert.equal(r.published, false);
        assert.equal(r.message, "0.0.1 is already released, so there's nothing to publish.");
        assert.ok(!a.calls.some((c) => c[0] === "release"));
        assert.throws(() => release({ mode: "publish", ...ok, sha: "abc1234", gh: fakeGh({ fail: true }).gh }), /couldn't ask GitHub whether 0\.0\.1 is released: HTTP 502/);
        assert.throws(() => release({ mode: "dry-run", ...noMain, gh: fakeGh().gh }), /main\.js is missing: run `npm run build` first/);
        assert.throws(() => release({ mode: "dry-run", ...badVersion, gh: fakeGh().gh }), /three numbers/);
        assert.throws(() => release({ mode: "publish", ...ok, sha: "", gh: fakeGh().gh }), /GITHUB_SHA/);
    } finally {
        for (const x of [ok, noMain, badVersion]) fs.rmSync(x.root, { recursive: true, force: true });
    }
});
