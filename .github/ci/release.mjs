// Plainday's releases (CLAUDE.md, "Releases"). One script for both places it runs, so the dry run
// on a PR and the release on main can't drift apart:
//
//   node .github/ci/release.mjs dry-run --out <dir>   CI, on every PR
//   node .github/ci/release.mjs publish --out <dir>   .github/workflows/release.yml, on main
//
// Both read the version in manifest.json and ask GitHub whether a release has it. Both copy the
// release's files into <dir>: main.js (built already, by `npm run build`), manifest.json, and
// styles.css once the repository has one. Then:
// - dry-run says what merging would do: "Merging publishes 0.0.2", or "0.0.1 is already
//   released, so merging publishes nothing". CI keeps <dir> for a week, to download.
// - publish does it: a release named and tagged with the version exactly (no "v", as the
//   community directory requires), on the commit it built ($GITHUB_SHA), with the files
//   attached. Its notes list the PRs merged since the previous release, as GitHub generates
//   them; the first release says "First release." A version that's released already
//   publishes nothing, so running it again is safe, and a publish that failed is retried by
//   the next merge.
//
// Needs the GitHub CLI (`gh`) with a token (GH_TOKEN) that can read releases, and write them for
// publish. Writes its message to $GITHUB_STEP_SUMMARY when that's set.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { VERSION } from "./checkVersion.mjs";

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

// mode: "dry-run" or "publish". Returns { version, files, published, message }.
export function run({ mode, root = ".", out, sha = process.env.GITHUB_SHA, gh = ghCli }) {
    const version = readVersion(root);
    const files = collect(root, out);
    const listed = files.join(", ");
    if (isReleased(version, gh)) {
        const message = mode === "publish"
            ? `${version} is already released, so there's nothing to publish.`
            : `${version} is already released, so merging publishes nothing. To release, raise the version (CLAUDE.md, "Releases").`;
        return { version, files, published: false, message };
    }
    if (mode !== "publish") {
        return { version, files, published: false, message: `Merging publishes ${version}, with ${listed}.` };
    }
    if (!sha) throw new Error("publish needs the commit to tag: GITHUB_SHA");
    const notes = hasAnyRelease(gh) ? ["--generate-notes"] : ["--notes", "First release."];
    const r = gh(["release", "create", version, ...files.map((f) => path.join(out, f)), "--target", sha, "--title", version, ...notes]);
    if (r.status !== 0) throw new Error(`gh release create ${version} failed: ${(r.stderr ?? "").trim()}`);
    return { version, files, published: true, message: `Published ${version} at ${sha.slice(0, 7)}, with ${listed}: ${r.stdout.trim()}` };
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
        const result = run({ mode, out });
        console.log(result.message);
        console.log(`The files are in ${out}`);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Release\n\n${result.message}\n`);
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\npublished=${result.published}\n`);
    } catch (e) {
        console.log(`::error::${e.message}`);
        process.exit(1);
    }
}
