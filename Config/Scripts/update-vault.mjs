#!/usr/bin/env node
// update-vault.mjs: installs the system's files from this repository's `main` into a vault that uses
// the system (OBS-201). Run it from the clone, outside Obsidian:
//
//   node Config/Scripts/update-vault.mjs --vault <folder> [--dry-run] [--clone <folder>]
//
// It copies what the repository has under `Config/` (the templates, the Templater scripts, the bases
// and the manual), but the tests and the two scripts for working on the system (this one and
// dev-vault.sh), plus README.md and CLAUDE.md. Plainday itself isn't one of them: a vault takes it
// through BRAT, or the community directory once it's listed.
//
// - **From `main` in git, not from the clone's folder.** The clone doubles as the dev vault, where a
//   branch is tested and the app rewrites notes, so what's on disk there may be neither. It refuses
//   when `main` isn't the same as `origin/main` (pull it first).
// - **A file you changed stays as it is,** and is listed. To take the repository's version, delete
//   yours and run this again.
// - **It never removes anything.** A file the repository dropped is listed once and stays in the
//   vault as yours.
// - **`--dry-run`** lists what it would do and writes nothing.
// - **The vault isn't the clone,** nor one of its worktrees.
//
// What it installed last time is in the vault's `Config/Scripts/update-manifest.json`, which isn't in
// the repository: each file's SHA-1, which is how your edits are told apart from an old version. With
// no record (a vault it never updated), every file that differs from the repository counts as yours.
// The record was the Update Obsidian PM command's, which this script replaces, so its first run starts
// where the command left off. A path the record has that this script doesn't install (the two bases
// and the two settings files the command also copied) leaves the record quietly, and its file stays
// in the vault as it is.
//
// Each file is written beside its place under a dot name, which Obsidian and Sync skip, then renamed
// into place, so nothing ever reads half a template. Should a write fail partway, the record still
// says what landed.
//
// The close-out after a merge (CLAUDE.md, *After a merge*): this script, then Plainday's build.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRANCH = "main";
const PLUGIN_ID = "plainday";
const MANIFEST_FILE = "Config/Scripts/update-manifest.json";
// What the repository installs into a vault: a folder ends in `/`
const INCLUDE = ["Config/", "README.md", "CLAUDE.md"];
// Parts of the repository for working on the system, not for using it: the tests read the class files
// in plugin/src/, outside `Config/`, and the demo's own notes; dev-vault.sh drives the clone as a test
// vault; and this script runs from the clone.
const EXCLUDE = ["Config/Scripts/tests/", "Config/Scripts/dev-vault.sh", "Config/Scripts/update-vault.mjs"];

const matches = (list, p) => list.some((x) => (x.endsWith("/") ? p.startsWith(x) : p === x));
export const installs = (p) => matches(INCLUDE, p) && !matches(EXCLUDE, p);

// What an update does, from three pictures of the same paths:
//   source   Map(path → hash)  the files main installs
//   vault    Map(path → hash)  what the vault has now (a missing path is absent)
//   record   Map(path → hash)  what was installed last time, empty with no record
//   onMain   Set(path)         every path main has, installed or not
// Each list is sorted:
//   add      not in the vault
//   update   differs from the repository, and is what was installed: an old version
//   yours    differs from both, or was never installed: left as it is
//   same     already up to date
//   dropped  installed before, gone from main, and still in the vault: left as it is
export function plan(source, vault, record = new Map(), onMain = new Set(source.keys())) {
    const out = { add: [], update: [], yours: [], same: [], dropped: [] };
    const sorted = (m) => [...m].sort(([a], [b]) => a.localeCompare(b));
    for (const [p, hash] of sorted(source)) {
        const have = vault.get(p);
        if (have === undefined) out.add.push(p);
        else if (have === hash) out.same.push(p);
        else if (record.get(p) === have) out.update.push(p);
        else out.yours.push(p);
    }
    for (const [p] of sorted(record)) {
        if (!source.has(p) && !onMain.has(p) && installs(p) && vault.has(p)) out.dropped.push(p);
    }
    return out;
}

// The record after copying `copied`: what's installed now. A file of yours keeps what was recorded for
// it, so it stays yours; a path main doesn't install any more leaves it.
export function recordAfter(source, previous, copied, same) {
    const out = new Map();
    for (const [p, hash] of previous) if (source.has(p)) out.set(p, hash);
    for (const p of [...copied, ...same]) out.set(p, source.get(p));
    return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

// The report, as lines
export function report(planned, { commit, clone, dryRun = false, firstRun = false }) {
    const lines = [`From ${BRANCH} at ${commit} (${clone})${dryRun ? ". Dry run: nothing is written." : ""}`];
    const list = (label, paths, note = "") => {
        if (!paths.length) return;
        lines.push("", `${label}: ${paths.length}${note}`, ...paths.map((p) => `  ${p}`));
    };
    if (firstRun && planned.yours.length) {
        lines.push("", "No record of an earlier install in this vault, so every file that differs from the repository counts as yours.");
    }
    list("Yours, left as they are", planned.yours, " (to take the repository's version, delete yours and run this again)");
    list(dryRun ? "Would add" : "Added", planned.add);
    list(dryRun ? "Would update" : "Updated", planned.update);
    list("Dropped by the repository, left in the vault as yours", planned.dropped);
    const n = planned.add.length + planned.update.length;
    lines.push("", n ? `${dryRun ? "Would copy" : "Copied"} ${n} file${n === 1 ? "" : "s"}; ${planned.same.length} already up to date.`
        : `Nothing to copy: ${planned.same.length} file${planned.same.length === 1 ? "" : "s"} already up to date.`);
    return lines;
}

// ---------------------------------------------------------------- running it

const sha1 = (buffer) => crypto.createHash("sha1").update(buffer).digest("hex");
const fail = (msg) => { console.error(`update-vault: ${msg}`); process.exit(1); };

// Writes beside the target under a dot name, then renames it into place
function put(vault, rel, data) {
    const to = path.join(vault, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const tmp = path.join(path.dirname(to), `.${path.basename(to)}.partial`);
    try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, to);
    } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
    }
}

function readFile(vault, rel) {
    try {
        const full = path.join(vault, rel);
        return fs.statSync(full).isFile() ? fs.readFileSync(full) : undefined;
    } catch { return undefined; }
}

// Every blob main has: Map(path → Buffer). Symlinks and submodules aren't files to copy.
function filesOnMain(git, clone) {
    const entries = git("ls-tree", "-r", "-z", "--full-tree", BRANCH).toString("utf8").split("\0").filter(Boolean).map((line) => {
        const [meta, p] = [line.slice(0, line.indexOf("\t")), line.slice(line.indexOf("\t") + 1)];
        const [mode, type, sha] = meta.split(" ");
        return { mode, type, sha, path: p };
    });
    const blobs = entries.filter((e) => e.type === "blob" && e.mode !== "120000");
    const wanted = blobs.filter((e) => installs(e.path));
    // One `cat-file --batch` for every wanted blob: "<sha> blob <size>\n<bytes>\n" each
    const out = execFileSync("git", ["-C", clone, "cat-file", "--batch"], {
        input: wanted.map((e) => e.sha).join("\n") + "\n", maxBuffer: 1 << 30,
    });
    const files = new Map();
    let at = 0;
    for (const e of wanted) {
        const nl = out.indexOf(10, at);
        const [sha, type, size] = out.subarray(at, nl).toString("utf8").split(" ");
        if (sha !== e.sha || type !== "blob") fail(`couldn't read ${e.path} from ${BRANCH}`);
        files.set(e.path, out.subarray(nl + 1, nl + 1 + Number(size)));
        at = nl + 1 + Number(size) + 1;
    }
    return { files, onMain: new Set(entries.map((e) => e.path)) };
}

function main(argv) {
    let vault = null, clone = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--vault") vault = argv[++i];
        else if (a === "--clone") clone = argv[++i];
        else if (a === "--dry-run" || a === "-n") dryRun = true;
        else if (a === "-h" || a === "--help") {
            console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\nimport ")[0].replace(/^#!.*\n/, "").replace(/^\/\/ ?/gm, ""));
            return;
        } else fail(`unknown argument ${a} (--help says how to run it)`);
    }
    if (!vault) fail("which vault? --vault <folder>");
    vault = path.resolve(vault);
    clone = path.resolve(clone);
    if (!fs.existsSync(path.join(vault, ".obsidian"))) fail(`${vault} isn't a vault (no .obsidian folder)`);

    const git = (...args) => {
        try { return execFileSync("git", ["-C", clone, ...args], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }); }
        catch (e) { fail(`git ${args[0]} in ${clone}: ${String(e.stderr || e.message).trim().split("\n")[0]}`); }
    };
    const text = (...args) => git(...args).toString("utf8").trim();
    // Run from a worktree, the clone is the folder that holds its .git
    const common = text("rev-parse", "--path-format=absolute", "--git-common-dir");
    if (path.basename(common) === ".git") clone = path.dirname(common);

    // The clone: Plainday's, and main is what was merged
    let manifest = null;
    try { manifest = JSON.parse(execFileSync("git", ["-C", clone, "show", `${BRANCH}:manifest.json`], { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8")); } catch { /* not a clone */ }
    if (manifest?.id !== PLUGIN_ID) fail(`${clone} isn't a clone of Plainday's repository (no Plainday manifest.json on ${BRANCH})`);
    const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
    const trees = text("worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => real(l.slice(9)));
    const vaultReal = real(vault);
    const inside = trees.find((t) => vaultReal === t || vaultReal.startsWith(t + path.sep));
    if (inside) fail(`${vault} is the clone or one of its worktrees (${inside}), not a vault that uses the system`);
    let upstream;
    try { upstream = execFileSync("git", ["-C", clone, "rev-parse", "--verify", `origin/${BRANCH}`], { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim(); }
    catch { fail(`${clone} has no origin/${BRANCH} to compare ${BRANCH} with`); }
    const head = text("rev-parse", "--verify", BRANCH);
    if (head !== upstream) fail(`${clone}'s ${BRANCH} isn't origin/${BRANCH}. Pull it first (git pull --ff-only on ${BRANCH}), then run this again.`);
    const commit = text("rev-parse", "--short", BRANCH);

    // The three pictures
    const { files, onMain } = filesOnMain(git, clone);
    const source = new Map([...files].map(([p, buffer]) => [p, sha1(buffer)]));
    let previous = null;
    const recordText = readFile(vault, MANIFEST_FILE);
    if (recordText !== undefined) {
        try { previous = JSON.parse(recordText.toString("utf8")); } catch { fail(`${MANIFEST_FILE} in the vault isn't JSON. Fix or delete it, then run this again.`); }
    }
    const record = new Map(Object.entries(previous?.files ?? {}));
    const have = new Map();
    for (const p of new Set([...source.keys(), ...record.keys()])) {
        const buffer = readFile(vault, p);
        if (buffer !== undefined) have.set(p, sha1(buffer));
    }
    const planned = plan(source, have, record, onMain);
    const firstRun = record.size === 0;

    if (dryRun) {
        for (const line of report(planned, { commit, clone, dryRun, firstRun })) console.log(line);
        return;
    }

    // Copy, then record what landed, whatever happened
    const copied = [];
    let failed = null;
    try {
        for (const p of [...planned.add, ...planned.update]) {
            failed = p;
            put(vault, p, files.get(p));
            copied.push(p);
        }
        failed = null;
    } catch (e) {
        failed = `${failed} (${String(e?.message ?? e).split("\n")[0]})`;
    }
    const after = recordAfter(source, record, copied, planned.same);
    const unchanged = previous?.commit === commit && !previous.failed && !failed && after.size === record.size && [...after].every(([p, h]) => record.get(p) === h);
    if (!unchanged) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        put(vault, MANIFEST_FILE, JSON.stringify({
            source: clone, commit,
            updated: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
            ...(failed ? { failed } : {}),
            files: Object.fromEntries(after),
        }, null, 2) + "\n");
    }
    if (failed) {
        fail(`stopped at ${failed}: ${copied.length} of ${planned.add.length + planned.update.length} files copied, and the record says which.`
            + " Run this again once it can be written.");
    }
    for (const line of report(planned, { commit, clone, firstRun })) console.log(line);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
