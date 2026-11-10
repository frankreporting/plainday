// CI: Obsidian's lint baseline only shrinks (CLAUDE.md, "Lint").
//
// eslint-suppressions.json lists, for each file and rule, how many errors ESLint lets through.
// ESLint itself fails on a new error and on an entry whose error is fixed, but it would also
// accept a baseline re-recorded with every new error in it (`--suppress-all`). So this compares
// the baseline with main's, rule by rule: no rule may have more errors let through than on main.
// Moving entries to a renamed file keeps each rule's count, so it passes.
//
// The one exception is a PR that changes the version of a lint package (LINT_PACKAGES), since a
// new version can find new things: it re-records the baseline, and says in the PR what changed.
//
// Inputs (environment): BASE_SHA, main's commit to compare with. Without it, or when main has no
// baseline yet, there's nothing to compare. Exit 1 with one line per rule that grew.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const BASELINE = "eslint-suppressions.json";
export const LINT_PACKAGES = ["eslint-plugin-obsidianmd", "eslint", "typescript-eslint", "typescript"];

// { rule: count } summed over every file
export function ruleTotals(suppressions) {
    const totals = {};
    for (const rules of Object.values(suppressions ?? {})) {
        for (const [rule, { count }] of Object.entries(rules ?? {})) totals[rule] = (totals[rule] ?? 0) + (count ?? 0);
    }
    return totals;
}

// The lint packages whose version differs between two package.json texts: ["eslint 10.1.0 → 10.2.0"]
export function lintUpdates(basePkg, headPkg) {
    const deps = (text) => {
        try {
            const p = JSON.parse(text ?? "{}");
            return { ...p.dependencies, ...p.devDependencies };
        } catch {
            return {};
        }
    };
    const a = deps(basePkg);
    const b = deps(headPkg);
    return LINT_PACKAGES.filter((n) => a[n] !== b[n]).map((n) => `${n} ${a[n] ?? "(none)"} → ${b[n] ?? "(none)"}`);
}

// base and head: the baseline files' texts (base undefined when main has none);
// basePkg and headPkg: package.json's texts. Returns { problems, notes }.
export function checkBaselineFiles({ base, head, basePkg, headPkg }) {
    if (base === undefined) return { problems: [], notes: ["main has no lint baseline yet, so there's nothing to compare"] };
    const parse = (text, where) => {
        try {
            return JSON.parse(text ?? "{}");
        } catch (e) {
            throw new Error(`${where}: not valid JSON (${e.message})`);
        }
    };
    let before;
    let after;
    try {
        before = ruleTotals(parse(base, `main's ${BASELINE}`));
        after = ruleTotals(parse(head, BASELINE));
    } catch (e) {
        return { problems: [e.message], notes: [] };
    }
    const sum = (t) => Object.values(t).reduce((a, n) => a + n, 0);
    const grew = Object.keys(after).filter((r) => after[r] > (before[r] ?? 0)).sort();
    const notes = [`The lint baseline lets through ${sum(after)} errors (main: ${sum(before)}).`];
    if (!grew.length) return { problems: [], notes };
    const updates = lintUpdates(basePkg, headPkg);
    const lines = grew.map((r) => `${r}: ${after[r]} errors let through, main has ${before[r] ?? 0}`);
    if (updates.length) {
        return { problems: [], notes: [...notes, `The baseline grew, which a lint update may do (${updates.join(", ")}): say in the PR what's new.`, ...lines] };
    }
    return {
        problems: lines.map((l) => `${BASELINE}: ${l}. The baseline only shrinks: fix the new error instead of adding it to the baseline (CLAUDE.md, "Lint")`),
        notes,
    };
}

function show(sha, file) {
    const r = spawnSync("git", ["show", `${sha}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : undefined;
}

export function checkAll(env = process.env, root = ".") {
    if (!env.BASE_SHA) return { problems: [], notes: ["No BASE_SHA, so there's nothing to compare"] };
    const read = (f) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : undefined);
    return checkBaselineFiles({
        base: show(env.BASE_SHA, BASELINE),
        head: read(BASELINE),
        basePkg: show(env.BASE_SHA, "package.json"),
        headPkg: read("package.json"),
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const { problems, notes } = checkAll();
    for (const n of notes) console.log(n);
    for (const p of problems) console.log(`::error::${p}`);
    if (problems.length) process.exit(1);
}
