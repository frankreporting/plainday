// CI: the pull request says what it needs to (CLAUDE.md, "Working on the system").
//
// - Linear link: the body names its issue as `Closes OBS-N`, `Fixes OBS-N`, `Resolves OBS-N`
//   or `Part of OBS-N`. A branch named `<user>/obs-N-<slug>` closes OBS-N on merge by itself, so
//   its body must close the same issue, not another one and not just "Part of".
// - Docs gate: when system files change (CustomJS, Templater, the templates, the calendar
//   scripts), the PR either changes README.md or has a `## Docs` section saying why the README
//   needs nothing. Either way that section must have a `My Obsidian Setup:` line listing the
//   sections changed in that (untracked) note, or `My Obsidian Setup: none`.
//
// Inputs (environment): PR_TITLE, PR_BODY, PR_BRANCH, and CHANGED_FILES (one path per line) or
// BASE_SHA + HEAD_SHA to compute it. Exit 1 with one line per problem.
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SYSTEM_DIRS = [
    "00 Meta/02 Scripts/CustomJS/",
    "00 Meta/02 Scripts/Templater/",
    "00 Meta/02 Scripts/Calendar/",
    "00 Meta/01 Templates/",
];

const LINK = /\b(Closes|Fixes|Resolves|Part of)\s+OBS-(\d+)\b/gi;

// The text under a `## Docs` heading (any level, case-insensitive), up to the next heading of
// the same or a higher level; null when there is none.
export function docsSection(body) {
    const lines = (body ?? "").replace(/\r/g, "").split("\n");
    const start = lines.findIndex((l) => /^#{1,6}\s+docs\s*$/i.test(l));
    if (start < 0) return null;
    const level = /^#+/.exec(lines[start])[0].length;
    const out = [];
    for (const l of lines.slice(start + 1)) {
        const h = /^(#{1,6})\s/.exec(l);
        if (h && h[1].length <= level) break;
        out.push(l);
    }
    return out.join("\n").trim();
}

export function checkLinearLink({ body, branch }) {
    const problems = [];
    const links = [...(body ?? "").matchAll(LINK)].map((m) => ({ word: m[1].toLowerCase(), n: Number(m[2]) }));
    const branchIssue = /(?:^|\/)obs-(\d+)(?:-|$)/i.exec(branch ?? "")?.[1];
    if (!links.length) {
        problems.push("PR body doesn't link a Linear issue: add `Closes OBS-N` (or `Part of OBS-N` for a PR that doesn't finish the issue)");
    }
    if (branchIssue) {
        const n = Number(branchIssue);
        const closes = links.some((l) => l.word !== "part of" && l.n === n);
        if (!closes) {
            problems.push(`branch \`${branch}\` closes OBS-${n} on merge by its name; the body must say \`Closes OBS-${n}\` (or move a \`Part of\` PR to a branch without obs-${n} in its name)`);
        }
    }
    return problems;
}

export function checkDocs({ body, changed }) {
    const problems = [];
    const system = changed.filter((f) => SYSTEM_DIRS.some((d) => f.startsWith(d)));
    if (!system.length) return problems;
    const readme = changed.includes("README.md");
    const section = docsSection(body);
    if (section === null) {
        problems.push(`system files changed (${system[0]}${system.length > 1 ? ` and ${system.length - 1} more` : ""}); the PR body needs a \`## Docs\` section${readme ? "" : ", or the PR needs to change README.md"}`);
        return problems;
    }
    const setup = /^\s*(?:[-*]\s*)?(?:\*\*)?My Obsidian Setup(?:\*\*)?\s*:\s*(.*\S)/im.exec(section);
    if (!setup) {
        problems.push("the `## Docs` section needs a `My Obsidian Setup:` line: the sections changed in that note, or `none`");
    }
    if (!readme) {
        const rest = section.split("\n").filter((l) => !/My Obsidian Setup\s*:/i.test(l)).join("\n").trim();
        if (!rest) problems.push("README.md is unchanged; the `## Docs` section must say why the README needs nothing");
    }
    return problems;
}

export function checkAll(env = process.env) {
    let changed = (env.CHANGED_FILES ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (!changed.length && env.BASE_SHA && env.HEAD_SHA) {
        const r = spawnSync("git", ["diff", "--name-only", `${env.BASE_SHA}...${env.HEAD_SHA}`], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git diff: ${r.stderr.trim()}`);
        changed = r.stdout.split("\n").filter(Boolean);
    }
    return [
        ...checkLinearLink({ body: env.PR_BODY, branch: env.PR_BRANCH }),
        ...checkDocs({ body: env.PR_BODY, changed }),
    ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const problems = checkAll();
    for (const p of problems) console.log(`::error::${p}`);
    if (problems.length) process.exit(1);
    console.log("The PR links its Linear issue and covers docs.");
}
