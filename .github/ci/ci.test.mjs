// Tests for the CI checks. Run from the repo root: node --test .github/ci/*.test.mjs
// Everything here is invented: the paths, names and amounts stand for the shapes the checks
// must catch, not for anything real. The fixtures are split with `+` so this file's own diff
// doesn't trip the privacy scan.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCustomJS, checkAll as checkScripts } from "./checkScripts.mjs";
import { scanLine, scanDiff, scanText, describe } from "./privacy.mjs";
import { docsSection, checkLinearLink, checkDocs } from "./checkPR.mjs";

// ------------------------------------------------------------------ scripts load

test("a class that evaluates cleanly passes; a syntax error and a missing class fail", () => {
    assert.equal(loadCustomJS("class Thing {\n  async invoke() {}\n}\n", "thing.js"), null);
    assert.match(loadCustomJS("class Thing {\n  async invoke( {}\n}\n", "thing.js"), /thing\.js: SyntaxError/);
    assert.match(loadCustomJS("const x = 1;\n", "x.js"), /no top-level class/);
    // A top-level reference to something only Obsidian provides breaks at startup too
    assert.match(loadCustomJS("const m = moment();\nclass Thing {}\n", "thing.js"), /ReferenceError/);
});

test("checkAll reports a broken script and a settings name with no class", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-"));
    const cjs = path.join(root, "00 Meta/02 Scripts/CustomJS");
    const tpl = path.join(root, "00 Meta/02 Scripts/Templater");
    fs.mkdirSync(cjs, { recursive: true });
    fs.mkdirSync(tpl, { recursive: true });
    fs.mkdirSync(path.join(root, ".obsidian/plugins/customjs"), { recursive: true });
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
    assert.deepEqual(rulesOf("00 Meta/02 Scripts/CustomJS/plan.js"), []);
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
    const script = ["00 Meta/02 Scripts/CustomJS/plan.js"];
    assert.deepEqual(checkDocs({ body: "", changed: ["Welcome.md", "00 Meta/04 Bases/Projects.base"] }), []);
    assert.match(checkDocs({ body: "Closes OBS-1", changed: script })[0], /## Docs/);
    assert.deepEqual(checkDocs({ body: "", changed: [...script, "00 Meta/Manual.md"] }), []);
    assert.deepEqual(checkDocs({ body: "", changed: [...script, "README.md"] }), []);
    assert.match(checkDocs({ body: "## Docs\n\n## Test plan\nx", changed: script })[0], /must say why/);
    assert.deepEqual(checkDocs({ body: "## Docs\nInternal refactor, nothing a user sees.", changed: script }), []);
    assert.deepEqual(checkDocs({ body: "", changed: ["00 Meta/01 Templates/Task.md", "00 Meta/Manual.md"] }), []);
    assert.match(checkDocs({ body: "", changed: ["00 Meta/02 Scripts/Calendar/sync-calendar.sh"] })[0], /Manual\.md and README\.md/);
});
