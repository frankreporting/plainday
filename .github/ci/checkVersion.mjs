// CI: Plainday's version files agree, and the version can be released (CLAUDE.md, "Releases").
//
// - manifest.json (what Obsidian and BRAT read), package.json and its lockfile (npm's copies) say
//   the same version, and versions.json lists it with the manifest's minAppVersion.
//   `npm version <x.y.z> --no-git-tag-version` raises all of them (plugin/version-bump.mjs).
// - The version is three numbers, such as 0.0.2: no `v`, no `-beta`. The release's tag is the
//   version exactly, as the community directory requires.
// - It isn't lower than main's: a release never goes backwards.
//
// Inputs (environment): BASE_SHA, main's commit to compare with; without it, or when main has
// no manifest.json yet, only the files themselves are checked. Exit 1 with one line per problem.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// -1, 0 or 1, for two versions that match VERSION
export function compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    return 0;
}

// files: { "manifest.json": text, "package.json": text, "package-lock.json": text,
// "versions.json": text }, any of them missing (undefined). baseManifest: main's manifest.json
// text, or undefined.
export function checkVersionFiles(files, baseManifest) {
    const problems = [];
    const parsed = {};
    for (const name of ["manifest.json", "package.json", "package-lock.json", "versions.json"]) {
        if (files[name] === undefined) {
            problems.push(`${name}: missing`);
            continue;
        }
        try {
            parsed[name] = JSON.parse(files[name]);
        } catch (e) {
            problems.push(`${name}: not valid JSON (${e.message})`);
        }
    }
    const manifest = parsed["manifest.json"];
    if (!manifest) return problems;
    const version = manifest.version;
    if (typeof version !== "string" || !VERSION.test(version)) {
        problems.push(`manifest.json: the version must be three numbers, such as 0.0.2 (no "v", no "-beta"), not ${JSON.stringify(version)}`);
        return problems;
    }
    const pkg = parsed["package.json"];
    const lock = parsed["package-lock.json"];
    const others = [
        ...(pkg ? [["package.json", pkg.version]] : []),
        ...(lock ? [["package-lock.json", lock.version], ["package-lock.json (its root package)", lock.packages?.[""]?.version]] : []),
    ];
    for (const [name, v] of others) {
        if (v !== version) {
            problems.push(`${name} says ${JSON.stringify(v)} and manifest.json says ${version}: raise all of them with \`npm version ${version} --no-git-tag-version\``);
        }
    }
    const versions = parsed["versions.json"];
    if (versions) {
        if (!(version in versions)) {
            problems.push(`versions.json doesn't list ${version}: raise the version with \`npm version ${version} --no-git-tag-version\`, which adds it`);
        } else if (versions[version] !== manifest.minAppVersion) {
            problems.push(`versions.json gives ${version} the minimum Obsidian ${JSON.stringify(versions[version])}, and manifest.json's minAppVersion is ${JSON.stringify(manifest.minAppVersion)}`);
        }
    }
    if (baseManifest !== undefined) {
        let base;
        try {
            base = JSON.parse(baseManifest).version;
        } catch {
            base = undefined;
        }
        if (typeof base === "string" && VERSION.test(base) && compareVersions(version, base) < 0) {
            problems.push(`manifest.json's version ${version} is lower than main's ${base}: a release never goes backwards`);
        }
    }
    return problems;
}

function show(sha, file) {
    const r = spawnSync("git", ["show", `${sha}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : undefined;
}

export function checkAll(env = process.env, root = ".") {
    const read = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : undefined);
    const files = Object.fromEntries(["manifest.json", "package.json", "package-lock.json", "versions.json"].map((f) => [f, read(f)]));
    return checkVersionFiles(files, env.BASE_SHA ? show(env.BASE_SHA, "manifest.json") : undefined);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const problems = checkAll();
    for (const p of problems) console.log(`::error::${p}`);
    if (problems.length) process.exit(1);
    console.log(`Plainday's version files agree on ${JSON.parse(fs.readFileSync("manifest.json", "utf8")).version}.`);
}
