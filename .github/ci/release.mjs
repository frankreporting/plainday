// Plainday's releases (CLAUDE.md, "Releases"). One script for both places it runs, so the dry run
// on a PR and the release on main can't drift apart:
//
//   node .github/ci/release.mjs dry-run --out <dir>   CI, on every PR
//   node .github/ci/release.mjs publish --out <dir>   .github/workflows/release.yml, on main
//
// Both read the version in manifest.json, compare it with the version before, and ask GitHub
// whether a release has it. Both copy the release's files into <dir>: main.js (built already,
// by `npm run build`), manifest.json, and styles.css once the repository has one. Then:
// - dry-run says what merging would do: "Merging publishes 0.0.2" when the PR raises the
//   version past main's and that version has no release, and otherwise why merging publishes
//   nothing. CI keeps <dir> for a week, to download.
// - publish does it, on a merge that raised the version (OBS-266): a release named and tagged
//   with the version exactly (no "v", as the community directory requires), on the commit it
//   built ($GITHUB_SHA), with the files attached. Its notes list the PRs merged since the
//   previous release, as GitHub generates them; the first release says "First release." A
//   merge that leaves the version as it was publishes nothing, even when that version has no
//   release (one deleted, or a publish that failed), so a deleted release stays deleted.
// - publish run by hand (the Release workflow's "Run workflow") skips the comparison: it
//   publishes the manifest's version when that has no release. That's how a failed publish is
//   retried. A version that's released already publishes nothing, so running it again is safe.
//
// Inputs (environment): GITHUB_EVENT_NAME, "workflow_dispatch" for a run by hand. BEFORE_SHA,
// the commit before the push, for publish on a push; when it can't be read (a new branch's
// zeros, or a force push), publish publishes nothing and warns. BASE_SHA, main's commit, for
// dry-run (origin/main when it isn't set, as locally); the checkout needs the history
// (fetch-depth: 0) for either. Needs the GitHub CLI (`gh`) with a token (GH_TOKEN) that can read
// releases, and write them for publish. Writes its message to $GITHUB_STEP_SUMMARY when that's
// set.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { VERSION, compareVersions } from "./checkVersion.mjs";

export const FILES = ["main.js", "manifest.json", "styles.css"];
const REQUIRED = ["main.js", "manifest.json"];

// Runs gh; returns { status, stdout, stderr }
function ghCli(args) {
    const r = spawnSync("gh", args, { encoding: "utf8" });
    if (r.error) throw new Error(`gh: ${r.error.message}`);
    return r;
}

// Whether a release has this tag. Anything but "found" or "not found" throws, so a GitHub
// outage never reads as "not released yet".
export function isReleased(version, gh = ghCli) {
    const r = gh(["api", `repos/{owner}/{repo}/releases/tags/${version}`, "--jq", ".tag_name"]);
    if (r.status === 0) return true;
    if (/HTTP 404/.test(r.stderr ?? "")) return false;
    throw new Error(`couldn't ask GitHub whether ${version} is released: ${(r.stderr ?? "").trim()}`);
}

export function hasAnyRelease(gh = ghCli) {
    const r = gh(["api", "repos/{owner}/{repo}/releases?per_page=1", "--jq", "length"]);
    if (r.status !== 0) throw new Error(`couldn't list the releases: ${(r.stderr ?? "").trim()}`);
    return Number(r.stdout.trim()) > 0;
}

// Copies the release's files from root into out; returns their names. Throws when a required
// one is missing.
export function collect(root, out) {
    fs.mkdirSync(out, { recursive: true });
    const names = [];
    for (const name of FILES) {
        const from = path.join(root, name);
        if (!fs.existsSync(from)) {
            if (REQUIRED.includes(name)) throw new Error(`${name} is missing${name === "main.js" ? ": run `npm run build` first" : ""}`);
            continue;
        }
        if (fs.statSync(from).size === 0) throw new Error(`${name} is empty`);
        fs.copyFileSync(from, path.join(out, name));
        names.push(name);
    }
    return names;
}

export function readVersion(root) {
    const version = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).version;
    if (typeof version !== "string" || !VERSION.test(version)) {
        throw new Error(`manifest.json's version must be three numbers, such as 0.0.2, not ${JSON.stringify(version)}`);
    }
    return version;
}

// manifest.json at a commit, for the version before: { sha, readable, manifest }. readable is
// false when the commit isn't there (no sha, a new branch's zeros, or history the checkout
// doesn't have); manifest is undefined when the commit has no manifest.json.
export function manifestAt(sha, root = ".") {
    const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (!sha || /^0+$/.test(sha) || git("cat-file", "-e", `${sha}^{commit}`).status !== 0) return { sha, readable: false };
    const r = git("show", `${sha}:manifest.json`);
    return { sha, readable: true, manifest: r.status === 0 ? r.stdout : undefined };
}

// The version in a manifest.json's text, or undefined when there's none to compare with
function versionIn(manifest) {
    try {
        const v = JSON.parse(manifest).version;
        return typeof v === "string" && VERSION.test(v) ? v : undefined;
    } catch {
        return undefined;
    }
}

// mode: "dry-run" or "publish". before: manifestAt's answer for the version to compare with
// (the PR's base, or the commit before the push); left out for a run by hand. Returns
// { version, files, published, message, warning }.
export function run({ mode, root = ".", out, sha = process.env.GITHUB_SHA, gh = ghCli, before }) {
    const version = readVersion(root);
    const files = collect(root, out);
    const listed = files.join(", ");
    const nothing = (message, warning = false) => ({ version, files, published: false, message, warning });
    if (before) {
        const short = before.sha ? before.sha.slice(0, 7) : "none given";
        if (!before.readable) {
            if (mode !== "publish") throw new Error(`couldn't read main's commit ${short} to compare versions with: the checkout needs its history (fetch-depth: 0)`);
            return nothing(`Couldn't read the commit before this push (${short}), so this run can't tell whether the merge raised the version, and publishes nothing. If it did, run the Release workflow by hand.`, true);
        }
        const was = versionIn(before.manifest);
        const change = was === undefined ? 1 : compareVersions(version, was);
        const who = mode === "publish" ? "This merge" : "This PR";
        const then = mode === "publish" ? "it publishes nothing" : "merging publishes nothing";
        if (change === 0) return nothing(`${who} ${mode === "publish" ? "left" : "leaves"} the version at ${version}, so ${then}. To release, ${mode === "publish" ? "a PR raises" : "raise"} the version (CLAUDE.md, "Releases").`);
        if (change < 0) return nothing(`${who} ${mode === "publish" ? "lowered" : "lowers"} the version from ${was} to ${version}, so ${then}.`);
    }
    if (isReleased(version, gh)) {
        return nothing(mode === "publish"
            ? `${version} is already released, so there's nothing to publish.`
            : `${version} is already released, so merging publishes nothing. To release, raise the version (CLAUDE.md, "Releases").`);
    }
    if (mode !== "publish") {
        return nothing(`Merging publishes ${version}, with ${listed}.`);
    }
    if (!sha) throw new Error("publish needs the commit to tag: GITHUB_SHA");
    const notes = hasAnyRelease(gh) ? ["--generate-notes"] : ["--notes", "First release."];
    const r = gh(["release", "create", version, ...files.map((f) => path.join(out, f)), "--target", sha, "--title", version, ...notes]);
    if (r.status !== 0) throw new Error(`gh release create ${version} failed: ${(r.stderr ?? "").trim()}`);
    return { version, files, published: true, message: `Published ${version} at ${sha.slice(0, 7)}, with ${listed}: ${r.stdout.trim()}`, warning: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const [mode, ...rest] = process.argv.slice(2);
    const outAt = rest.indexOf("--out");
    const out = outAt >= 0 ? rest[outAt + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "plainday-release-"));
    if (!["dry-run", "publish"].includes(mode) || !out) {
        console.error("usage: node .github/ci/release.mjs dry-run|publish --out <dir>");
        process.exit(2);
    }
    try {
        const env = process.env;
        // A run by hand compares with nothing; a push with the commit before it; a dry run with main
        const before = mode === "publish"
            ? (env.GITHUB_EVENT_NAME === "workflow_dispatch" ? undefined : manifestAt(env.BEFORE_SHA))
            : manifestAt(env.BASE_SHA || "origin/main");
        const result = run({ mode, out, before });
        console.log(result.warning ? `::warning::${result.message}` : result.message);
        console.log(`The files are in ${out}`);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Release\n\n${result.message}\n`);
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\npublished=${result.published}\n`);
    } catch (e) {
        console.log(`::error::${e.message}`);
        process.exit(1);
    }
}
