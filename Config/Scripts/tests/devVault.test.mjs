// Tests for dev-vault.sh. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The script runs in a throwaway clone standing in for the demo vault (named "clone", so the
// CLI calls say `vault=clone`), with a bare remote, a worktree on a branch, and stubs for the
// Obsidian CLI and `open` that record how they were called. A state file says whether
// "Obsidian" is running, and what path the CLI answers with.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../dev-vault.sh", import.meta.url));
const REL = "Config/Scripts/dev-vault.sh";
const SETTINGS = ".obsidian/plugins/customjs/data.json";
const NOTE = "Reference/Planner/days/2026-09-16.md";

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (root, rel, text) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const head = (dir) => git(dir, "rev-parse", "HEAD");
const branch = (dir) => git(dir, "rev-parse", "--abbrev-ref", "HEAD"); // "HEAD" when detached
const identify = (dir) => { git(dir, "config", "user.email", "test@example.com"); git(dir, "config", "user.name", "Test"); };
const commit = (dir, rel, text, message) => { write(dir, rel, text); git(dir, "add", "-A"); git(dir, "commit", "-qm", message); return head(dir); };

function stub(dir, name, body) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
}

// A remote, a clone of it standing in for the demo vault, and a worktree on `me/obs-7-thing`,
// one commit ahead of main. `opens`: does opening the vault make "Obsidian" answer?
function setUp({ opens = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-vault-"));
    const remote = path.join(dir, "remote.git");
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    const clone = path.join(dir, "clone");
    git(dir, "init", "-q", "-b", "main", clone);
    identify(clone);
    git(clone, "remote", "add", "origin", remote);
    write(clone, ".gitignore", ["/.obsidian/*", "!/.obsidian/plugins/", "/.obsidian/plugins/*", "!/.obsidian/plugins/customjs/",
        "/.obsidian/plugins/customjs/*", "!/.obsidian/plugins/customjs/data.json", "/*Test Plan.md", "/.dev-vault/", ""].join("\n"));
    write(clone, "Welcome.md", "welcome\n");
    write(clone, NOTE, "daily note\n");
    write(clone, SETTINGS, '{"registeredInvocableScriptNames":["Schedule"]}\n');
    fs.mkdirSync(path.join(clone, "Config/Scripts"), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(clone, REL));
    fs.chmodSync(path.join(clone, REL), 0o755);
    git(clone, "add", "-A");
    git(clone, "commit", "-qm", "system");
    git(clone, "push", "-q", "-u", "origin", "main");
    write(clone, ".obsidian/app.json", "mirrored settings, git-ignored\n");

    const wt = path.join(dir, "wt");
    git(clone, "worktree", "add", "-q", wt, "-b", "me/obs-7-thing");
    identify(wt);
    commit(wt, "Welcome.md", "welcome, changed on the branch\n", "OBS-7: change the welcome note");

    const plan = path.join(dir, "plan.md");
    fs.writeFileSync(plan, "---\nid: 2026092012000000\ntags:\n  - plan\n---\n# OBS-7 test plan\n\n- [ ] Open [[Welcome]]\n\n## Notes for Claude\n");

    const state = path.join(dir, "state");
    fs.writeFileSync(state, "closed");
    const calls = path.join(dir, "calls");
    fs.writeFileSync(calls, "");
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    // The CLI answers only while "Obsidian" runs. `vault info=path` answers the clone for
    // `vault=clone`, and some other vault otherwise (or always, in the "other" state).
    stub(dir, "bin/obsidian", `echo "obsidian $*" >> ${calls}
state="$(cat ${state})"
[ "$state" = closed ] && exit 1
case "$1" in
  vault=clone) ;;
  *) echo "/some/other/vault"; exit 0 ;;
esac
case "$2" in
  plugin:reload|reload)
    [ -f ${dir}/writes-on-reload ] && printf 'rewritten by the startup report\n' >> "${clone}/${NOTE}"
    ;;
esac
if [ "$2" = vault ]; then
  [ "$state" = other ] && { echo "/some/other/vault"; exit 0; }
  echo "${clone}"
else
  echo ok
fi`);
    stub(dir, "bin/open", `echo "open $*" >> ${calls}
${opens ? `echo running > ${state}` : "true"}`);

    const run = (...args) => {
        const r = spawnSync("/bin/zsh", [path.join(clone, REL), ...args], {
            encoding: "utf8",
            env: {
                ...process.env, HOME: dir, OBSIDIAN_CLI: path.join(bin, "obsidian"), OPEN_CMD: path.join(bin, "open"),
                OBSIDIAN_WAIT: "2", DEV_VAULT_SETTLE: "3",
            },
        });
        return { status: r.status, out: r.stdout + r.stderr, calls: fs.readFileSync(calls, "utf8") };
    };
    const setState = (s) => fs.writeFileSync(state, s);
    // Makes the stubbed CLI write into a tracked note whenever it's asked to reload, the way
    // TimeReportOnStartup refreshes the reports once the vault has reindexed
    const writeOnReload = () => fs.writeFileSync(path.join(dir, "writes-on-reload"), "");
    const forget = () => fs.writeFileSync(calls, "");
    return { dir, remote, clone, wt, plan, run, setState, forget, writeOnReload };
}

const cleanUp = (t, f) => t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

test("test: detaches the dev vault at the branch, locks it, reloads CustomJS and puts the plan in front", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    const { status, out, calls } = f.run("test", "me/obs-7-thing", "--plan", f.plan);
    assert.equal(status, 0, out);
    assert.equal(head(f.clone), head(f.wt), "at the branch's commit");
    assert.equal(branch(f.clone), "HEAD", "detached, since the worktree holds the branch");
    assert.equal(read(f.clone, "Welcome.md"), "welcome, changed on the branch\n");
    assert.match(read(f.clone, ".dev-vault/testing"), /^issue=OBS-7$/m);
    assert.match(read(f.clone, ".dev-vault/testing"), /^branch=me\/obs-7-thing$/m);
    assert.equal(read(f.clone, "OBS-7 Test Plan.md"), fs.readFileSync(f.plan, "utf8"));
    assert.match(calls, /^obsidian vault=clone plugin:reload id=customjs$/m);
    assert.doesNotMatch(calls, /^obsidian vault=clone reload$/m, "settings unchanged, so no vault reload");
    assert.match(calls, /^obsidian vault=clone open path=OBS-7 Test Plan\.md$/m);
    for (const line of calls.split("\n").filter((l) => l.startsWith("obsidian "))) {
        assert.match(line, /^obsidian vault=clone /, `names the vault before the command: ${line}`);
    }
    assert.match(out, /Testing OBS-7/);
    assert.match(read(f.clone, ".git/hooks/pre-commit"), /dev-vault/, "the hook is installed");
});

test("test: opens the vault when Obsidian isn't answering, and gives up untouched if it never does", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const { status, out, calls } = f.run("test", "me/obs-7-thing");
    assert.equal(status, 0, out);
    assert.match(calls, /^open -g obsidian:\/\/open\?vault=clone$/m, "opens this vault by name");
    assert.equal(head(f.clone), head(f.wt));

    const g = setUp({ opens: false });
    cleanUp(t, g);
    const r = g.run("test", "me/obs-7-thing");
    assert.equal(r.status, 1);
    assert.match(r.out, /didn't answer/);
    assert.equal(branch(g.clone), "main", "nothing checked out");
    assert.equal(exists(g.clone, ".dev-vault/testing"), false, "no lock");
});

test("test: refuses when the CLI reaches another vault, before touching git", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("other");
    const { status, out } = f.run("test", "me/obs-7-thing");
    assert.equal(status, 1);
    assert.match(out, /another vault/);
    assert.equal(branch(f.clone), "main");
    assert.equal(exists(f.clone, ".dev-vault/testing"), false);
});

test("test: refuses another issue while the lock is held, and changes nothing", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    assert.equal(f.run("test", "me/obs-7-thing", "--plan", f.plan).status, 0);
    const other = path.join(f.dir, "wt8");
    git(f.clone, "worktree", "add", "-q", other, "-b", "me/obs-8-other");
    identify(other);
    commit(other, NOTE, "changed for OBS-8\n", "OBS-8: change");

    const { status, out } = f.run("test", "me/obs-8-other");
    assert.equal(status, 1);
    assert.match(out, /OBS-7/, "names the issue that holds the lock");
    assert.equal(head(f.clone), head(f.wt), "still at OBS-7's commit");
    assert.equal(read(f.clone, NOTE), "daily note\n");
    assert.match(read(f.clone, ".dev-vault/testing"), /^issue=OBS-7$/m);
    assert.equal(exists(f.clone, "OBS-7 Test Plan.md"), true);
});

test("test: the same issue again restores the notes and follows the branch's new commit", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    assert.equal(f.run("test", "me/obs-7-thing", "--plan", f.plan).status, 0);
    // Obsidian rewrote a note while Brian tested, and the agent fixed something on the branch
    write(f.clone, NOTE, "rewritten by the startup report\n");
    const fix = commit(f.wt, "Welcome.md", "welcome, fixed on the branch\n", "OBS-7: fix");
    f.forget();

    const { status, out, calls } = f.run("test", "me/obs-7-thing");
    assert.equal(status, 0, out);
    assert.equal(head(f.clone), fix);
    assert.equal(read(f.clone, "Welcome.md"), "welcome, fixed on the branch\n");
    assert.equal(read(f.clone, NOTE), "daily note\n", "the rewritten note is restored");
    assert.equal(read(f.clone, "OBS-7 Test Plan.md"), fs.readFileSync(f.plan, "utf8"), "the plan stays");
    assert.match(calls, /^obsidian vault=clone plugin:reload id=customjs$/m);
    assert.match(read(f.clone, ".dev-vault/testing"), /^issue=OBS-7$/m);
});

test("test: refuses a dirty tree when no test is in progress", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    write(f.clone, "Welcome.md", "edited in the clone\n");
    const { status, out } = f.run("test", "me/obs-7-thing");
    assert.equal(status, 1);
    assert.match(out, /Welcome\.md/);
    assert.match(out, /done/, "says how to get out of it");
    assert.equal(branch(f.clone), "main");
});

test("test: a branch that only the remote has works too, and an unknown one is refused", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    git(f.wt, "push", "-q", "origin", "me/obs-7-thing:refs/heads/me/obs-9-remote");
    const { status, out } = f.run("test", "me/obs-9-remote");
    assert.equal(status, 0, out);
    assert.equal(head(f.clone), head(f.wt));
    assert.match(read(f.clone, ".dev-vault/testing"), /^issue=OBS-9$/m);
    assert.equal(f.run("done").status, 0);

    const r = f.run("test", "me/obs-10-nowhere");
    assert.equal(r.status, 1);
    assert.match(r.out, /no branch/i);
    assert.equal(branch(f.clone), "main");
});

test("test: the issue comes from the branch name, or from --issue when the name has none", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    git(f.clone, "branch", "-q", "me/docs-only", "me/obs-7-thing");
    const r = f.run("test", "me/docs-only");
    assert.equal(r.status, 1);
    assert.match(r.out, /--issue/);
    assert.equal(branch(f.clone), "main");

    const { status, out } = f.run("test", "me/docs-only", "--issue", "OBS-12", "--plan", f.plan);
    assert.equal(status, 0, out);
    assert.match(read(f.clone, ".dev-vault/testing"), /^issue=OBS-12$/m);
    assert.equal(exists(f.clone, "OBS-12 Test Plan.md"), true);
});

test("test: a settings change reloads the vault, not just CustomJS", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    commit(f.wt, SETTINGS, '{"registeredInvocableScriptNames":["Schedule","New"]}\n', "OBS-7: register a command");
    const { status, out, calls } = f.run("test", "me/obs-7-thing");
    assert.equal(status, 0, out);
    assert.match(calls, /^obsidian vault=clone reload$/m);
    assert.doesNotMatch(calls, /plugin:reload/, "the vault reload covers the plugin");
});

test("done: restores every tracked note, removes the plan and the lock, and returns to an updated main", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    assert.equal(f.run("test", "me/obs-7-thing", "--plan", f.plan).status, 0);
    write(f.clone, "Welcome.md", "table reformatted by the editor\n");
    write(f.clone, NOTE, "synced event line added\n");
    // the PR merged meanwhile: main moved on the remote
    git(f.wt, "push", "-q", "origin", "me/obs-7-thing:main");
    f.forget();

    const { status, out, calls } = f.run("done");
    assert.equal(status, 0, out);
    assert.equal(branch(f.clone), "main");
    assert.equal(head(f.clone), head(f.wt), "pulled the merge");
    assert.equal(git(f.clone, "status", "--porcelain"), "", "clean");
    assert.equal(read(f.clone, NOTE), "daily note\n");
    assert.equal(exists(f.clone, "OBS-7 Test Plan.md"), false);
    assert.equal(exists(f.clone, ".dev-vault/testing"), false);
    assert.equal(exists(f.clone, ".obsidian/app.json"), true, "git-ignored settings are left alone");
    assert.match(calls, /^obsidian vault=clone plugin:reload id=customjs$/m);
    assert.match(out, /main/);
});

test("done: a write the app makes after the reload is restored, not left behind", (t) => {
    // Seen for real: `done` restored the tree, checked it clean, then its own reload set the
    // startup report writing, and the tree was dirty again a moment later. The next thing to read
    // this clone is UpdateObsidianPM, which refuses to install from a tree that isn't clean.
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    assert.equal(f.run("test", "me/obs-7-thing", "--plan", f.plan).status, 0);
    f.writeOnReload();

    const { status, out } = f.run("done");
    assert.equal(status, 0, out);
    assert.equal(read(f.clone, NOTE), "daily note\n", "the app's write is restored");
    assert.equal(git(f.clone, "status", "--porcelain"), "", "and the tree stays clean");
    assert.match(out, /clean/);
});

test("done: refuses while an untracked file is left, and keeps the lock", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    assert.equal(f.run("test", "me/obs-7-thing", "--plan", f.plan).status, 0);
    write(f.clone, "Inbox/stray.md", "a note made while testing\n");
    const { status, out } = f.run("done");
    assert.equal(status, 1);
    assert.match(out, /Inbox\/stray\.md/);
    assert.equal(branch(f.clone), "HEAD", "still detached");
    assert.equal(exists(f.clone, ".dev-vault/testing"), true);

    fs.rmSync(path.join(f.clone, "Inbox"), { recursive: true });
    assert.equal(f.run("done").status, 0);
    assert.equal(branch(f.clone), "main");
});

test("done: without a test in progress it still cleans up, and says so", (t) => {
    const f = setUp();
    cleanUp(t, f);
    f.setState("running");
    write(f.clone, "Welcome.md", "edited\n");
    const { status, out } = f.run("done");
    assert.equal(status, 0, out);
    assert.equal(read(f.clone, "Welcome.md"), "welcome\n");
    assert.match(out, /no test in progress/i);
});

test("the hook refuses a commit from the dev vault and allows one from a worktree", (t) => {
    const f = setUp();
    cleanUp(t, f);
    assert.equal(f.run("status").status, 0, "status installs the hook too");
    write(f.clone, "Welcome.md", "edited in the dev vault\n");
    git(f.clone, "add", "Welcome.md");
    assert.throws(() => git(f.clone, "commit", "-qm", "from the dev vault"), (e) => {
        assert.match(String(e.stderr), /no commits from the demo vault/);
        return true;
    });
    assert.equal(git(f.clone, "log", "--oneline", "-1"), git(f.clone, "log", "--oneline", "-1", "origin/main"), "nothing committed");
    git(f.clone, "checkout", "-q", "--", "Welcome.md");

    assert.doesNotThrow(() => commit(f.wt, NOTE, "from a worktree\n", "OBS-7: from a worktree"));
});

test("the hook never overwrites someone's own pre-commit hook", (t) => {
    const f = setUp();
    cleanUp(t, f);
    write(f.clone, ".git/hooks/pre-commit", "#!/bin/sh\necho mine\n");
    const { status, out } = f.run("status");
    assert.equal(status, 0);
    assert.match(out, /pre-commit hook/);
    assert.equal(read(f.clone, ".git/hooks/pre-commit"), "#!/bin/sh\necho mine\n");
});

test("status: says what's being tested and where HEAD is", (t) => {
    const f = setUp();
    cleanUp(t, f);
    let r = f.run("status");
    assert.equal(r.status, 0);
    assert.match(r.out, /No test in progress/);
    assert.match(r.out, /main/);

    f.setState("running");
    f.run("test", "me/obs-7-thing", "--plan", f.plan);
    write(f.clone, NOTE, "rewritten\n");
    r = f.run("status");
    assert.match(r.out, /OBS-7/);
    assert.match(r.out, /me\/obs-7-thing/);
    assert.match(r.out, /detached/);
    assert.match(r.out, new RegExp(NOTE.replace(/[/.]/g, "\\$&")));
});

test("a copy of the script in a worktree refuses to run: only the clone is the dev vault", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const r = spawnSync("/bin/zsh", [path.join(f.wt, REL), "status"], { encoding: "utf8", env: { ...process.env, HOME: f.dir } });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /not the dev vault/);
});

// ------------------------------------------------------------------ Plainday (OBS-226)

const PLUGINS = ".obsidian/community-plugins.json";
const PLAINDAY = ".obsidian/plugins/plainday";
const MANIFEST = '{"id":"plainday","version":"0.0.1"}\n';

// The setUp above, plus what switching plugins needs: a CLI stub that turns plugins on and off in
// community-plugins.json as Obsidian does, and an npm stub that records where it ran. Its build
// copies manifest.json to main.js, so the copy in the vault shows which commit was built.
function withPlainday(f) {
    const calls = path.join(f.dir, "calls"), state = path.join(f.dir, "state"), plugins = path.join(f.clone, PLUGINS);
    stub(f.dir, "bin/obsidian", `echo "obsidian $*" >> ${calls}
[ "$(cat ${state})" = closed ] && exit 1
case "$1" in
  vault=clone) ;;
  *) echo "/some/other/vault"; exit 0 ;;
esac
case "$2" in
  plugin:enable|plugin:disable)
    id="\${3#id=}"
    [ "$2" = plugin:enable ] && [ -f ${f.dir}/enable-fails-$id ] && { echo "Error: not found"; exit 1; }
    ids="$(grep -o '"[^"]*"' ${plugins} 2>/dev/null | tr -d '"' | grep -v -x "$id")"
    [ "$2" = plugin:enable ] && ids="$ids $id"
    printf '[%s]\\n' "$(for i in $ids; do printf '"%s"\\n' "$i"; done | paste -sd, -)" > ${plugins}
    ;;
esac
if [ "$2" = vault ]; then echo "${f.clone}"; else echo ok; fi`);
    stub(f.dir, "bin/npm", `echo "npm $* in $(pwd)" >> ${calls}
case "$1" in
  ci) [ -f ${f.dir}/ci-fails ] && { rm -f ${f.dir}/ci-fails; mkdir -p node_modules; echo "invented network error" >&2; exit 1; }; mkdir -p node_modules ;;
  run) [ -f ${f.dir}/build-fails ] && { echo "invented build error" >&2; exit 1; }; cp manifest.json main.js ;;
esac`);
    const run = (...args) => {
        const r = spawnSync("/bin/zsh", [path.join(f.clone, REL), ...args], {
            encoding: "utf8",
            env: {
                ...process.env, HOME: f.dir, OBSIDIAN_CLI: path.join(f.dir, "bin/obsidian"), OPEN_CMD: path.join(f.dir, "bin/open"),
                NPM_CMD: path.join(f.dir, "bin/npm"), OBSIDIAN_WAIT: "2", DEV_VAULT_SETTLE: "3",
            },
        });
        return { status: r.status, out: r.stdout + r.stderr, calls: fs.readFileSync(calls, "utf8") };
    };
    write(f.clone, PLUGINS, '["templater-obsidian","customjs"]\n');
    // The branch is Plainday's: manifest.json at the root, and its build files
    write(f.wt, "package.json", "{}\n");
    write(f.wt, "package-lock.json", '{"lockfileVersion":3}\n');
    commit(f.wt, "manifest.json", MANIFEST, "OBS-7: Plainday");
    const buildFails = () => fs.writeFileSync(path.join(f.dir, "build-fails"), "");
    const marker = (name) => fs.writeFileSync(path.join(f.dir, name), "");
    return { run, buildFails, marker, on: () => JSON.parse(read(f.clone, PLUGINS)) };
}

const order = (calls, ...lines) => {
    const at = lines.map((l) => calls.split("\n").indexOf(l));
    assert.ok(at.every((i) => i >= 0), `all of these were called:\n${lines.join("\n")}\n---\n${calls}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `in this order:\n${lines.join("\n")}\n---\n${calls}`);
};

test("test: a commit with manifest.json is built outside the vault, copied in as Plainday, and switched to", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    const { status, out, calls } = p.run("test", "me/obs-7-thing", "--plan", f.plan);
    assert.equal(status, 0, out);
    assert.equal(head(f.clone), head(f.wt));
    assert.equal(read(f.clone, `${PLAINDAY}/main.js`), MANIFEST, "the branch's commit, built");
    assert.equal(read(f.clone, `${PLAINDAY}/manifest.json`), MANIFEST);
    assert.deepEqual(p.on(), ["templater-obsidian", "plainday"], "CustomJS off, Plainday on");
    order(calls, "obsidian vault=clone plugin:disable id=customjs filter=community",
        "obsidian vault=clone eval code=app.plugins.loadManifests().then(() => !!app.plugins.manifests.plainday)",
        "obsidian vault=clone plugin:enable id=plainday filter=community", "obsidian vault=clone open path=OBS-7 Test Plan.md");
    assert.doesNotMatch(calls, /plugin:reload/, "turning Plainday on loaded the build; no second load");
    const tree = path.join(f.clone, ".dev-vault/build/tree");
    order(calls, `npm ci --no-audit --no-fund in ${tree}`, `npm run --silent build in ${tree}`);
    assert.equal(exists(f.clone, "node_modules"), false, "npm never runs in the vault itself");
    assert.equal(git(f.clone, "status", "--porcelain"), "", "the build and the plugin leave the tree clean");
    for (const line of calls.split("\n").filter((l) => l.startsWith("obsidian "))) assert.match(line, /^obsidian vault=clone /);
    assert.match(p.run("status").out, /^Plugin: Plainday on; this commit runs on Plainday$/m);
});

test("test: the next round rebuilds, and runs npm ci again only when the lockfile changed", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    assert.equal(p.run("test", "me/obs-7-thing").status, 0);
    f.forget();
    commit(f.wt, "manifest.json", MANIFEST.replace("0.0.1", "0.0.2"), "OBS-7: a fix");
    let { status, out, calls } = p.run("test", "me/obs-7-thing");
    assert.equal(status, 0, out);
    assert.match(read(f.clone, `${PLAINDAY}/main.js`), /0\.0\.2/);
    assert.doesNotMatch(calls, /npm ci/);
    assert.match(calls, /npm run --silent build/);
    assert.doesNotMatch(calls, /plugin:(enable|disable)/, "already on");
    assert.match(calls, /^obsidian vault=clone plugin:reload id=plainday$/m);

    f.forget();
    commit(f.wt, "package-lock.json", '{"lockfileVersion":3,"changed":true}\n', "OBS-7: a new tool");
    ({ status, out, calls } = p.run("test", "me/obs-7-thing"));
    assert.equal(status, 0, out);
    assert.match(calls, /npm ci/);
});

test("test: a build that fails leaves the dev vault as it was, and says why", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    p.buildFails();
    const before = head(f.clone);
    const { status, out, calls } = p.run("test", "me/obs-7-thing", "--plan", f.plan);
    assert.notEqual(status, 0);
    assert.match(out, /invented build error/);
    assert.match(out, /dev vault is unchanged/);
    assert.equal(head(f.clone), before);
    assert.equal(branch(f.clone), "main");
    assert.equal(exists(f.clone, ".dev-vault/testing"), false, "no lock");
    assert.equal(exists(f.clone, "OBS-7 Test Plan.md"), false);
    assert.deepEqual(p.on(), ["templater-obsidian", "customjs"]);
    assert.doesNotMatch(calls, /plugin:/);
});

test("done: back on a main without manifest.json, Plainday goes off and CustomJS comes back", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    assert.equal(p.run("test", "me/obs-7-thing", "--plan", f.plan).status, 0);
    f.forget();
    const { status, out, calls } = p.run("done");
    assert.equal(status, 0, out);
    assert.equal(branch(f.clone), "main");
    assert.deepEqual(p.on(), ["templater-obsidian", "customjs"]);
    order(calls, "obsidian vault=clone plugin:disable id=plainday filter=community", "obsidian vault=clone plugin:enable id=customjs filter=community",
        "obsidian vault=clone plugin:reload id=customjs");
    assert.doesNotMatch(calls, /npm /, "nothing to build for CustomJS");
    assert.equal(git(f.clone, "status", "--porcelain"), "");
    assert.match(p.run("status").out, /^Plugin: CustomJS on; this commit runs on CustomJS$/m);
});

test("done: once main has Plainday, it's built from main and stays on", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    assert.equal(p.run("test", "me/obs-7-thing").status, 0);
    // The PR merged meanwhile
    git(f.wt, "push", "-q", "origin", "me/obs-7-thing:main");
    f.forget();
    const { status, out, calls } = p.run("done");
    assert.equal(status, 0, out);
    assert.equal(head(f.clone), head(f.wt));
    assert.deepEqual(p.on(), ["templater-obsidian", "plainday"]);
    assert.match(calls, /npm run --silent build/);
    assert.match(calls, /^obsidian vault=clone plugin:reload id=plainday$/m);
    assert.doesNotMatch(calls, /plugin:(enable|disable)/);
});

test("test: when Plainday won't turn on, CustomJS goes back on and it says so", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    p.marker("enable-fails-plainday");
    const { out, calls } = p.run("test", "me/obs-7-thing");
    assert.match(out, /Couldn't turn Plainday on, so CustomJS is back on/);
    assert.deepEqual(p.on(), ["templater-obsidian", "customjs"], "never neither");
    order(calls, "obsidian vault=clone plugin:disable id=customjs filter=community", "obsidian vault=clone plugin:enable id=plainday filter=community",
        "obsidian vault=clone plugin:enable id=customjs filter=community");
});

test("test: an npm ci that failed runs again next time, instead of building with half the tools", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    p.marker("ci-fails");
    let { status, out } = p.run("test", "me/obs-7-thing");
    assert.notEqual(status, 0);
    assert.match(out, /npm ci failed/);
    f.forget();
    ({ status, out } = p.run("test", "me/obs-7-thing"));
    assert.equal(status, 0, out);
    assert.match(fs.readFileSync(path.join(f.dir, "calls"), "utf8"), /npm ci/);
});

test("done: with Obsidian closed, main's Plainday is still built and copied in, for the next open", (t) => {
    const f = setUp();
    cleanUp(t, f);
    const p = withPlainday(f);
    f.setState("running");
    assert.equal(p.run("test", "me/obs-7-thing").status, 0);
    commit(f.wt, "manifest.json", MANIFEST.replace("0.0.1", "0.0.3"), "OBS-7: merged");
    git(f.wt, "push", "-q", "origin", "me/obs-7-thing:main");
    f.setState("closed");
    const { status, out } = p.run("done");
    assert.equal(status, 0, out);
    assert.match(read(f.clone, `${PLAINDAY}/main.js`), /0\.0\.3/, "main's build, not the branch's");
    assert.doesNotMatch(out, /weren't switched/, "Plainday is on already, so there's nothing to switch");
});
