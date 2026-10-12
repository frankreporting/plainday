// CI: the pull request says what it needs to (CLAUDE.md, "Working on the system").
//
// - Linear link: the body names its issue as `Closes OBS-N`, `Fixes OBS-N`, `Resolves OBS-N`
//   or `Part of OBS-N`. A branch named `<user>/obs-N-<slug>` closes OBS-N on merge by itself, so
//   its body must close the same issue, not another one and not just "Part of". A PR for a cluster
//   of issues lists them after one keyword (`Closes OBS-65, OBS-66` or `… OBS-65 and OBS-66`),
//   the way Linear reads it, and every issue in the list counts.
// - Docs gate: when system files change (CustomJS, Templater, the templates, the calendar
//   scripts), the PR either changes one of DOCS (the manual or the README) or has a `## Docs`
//   section saying why neither needs anything.
//
// Inputs (environment): PR_TITLE, PR_BODY, PR_BRANCH, and CHANGED_FILES (one path per line) or
// BASE_SHA + HEAD_SHA to compute it. Exit 1 with one line per problem.
import path from "node:path";
import { spawnSync } from "node:child_process";

export const SYSTEM_DIRS = [
    "Config/Scripts/CustomJS/",
    "Config/Scripts/Templater/",
    "Config/Scripts/Calendar/",
    "Config/Templates/",
];

// Where the system is documented: the manual (how it works) and the README (installing it)
export const DOCS = ["Config/Manual.md", "README.md"];

// A keyword and the issues after it: `Closes OBS-65, OBS-66 and OBS-67`
const LINK = /\b(Closes|Fixes|Resolves|Part of)\s+(OBS-\d+\b(?:\s*(?:,|,?\s+and\b|&)\s*OBS-\d+\b)*)/gi;

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
    const links = [...(body ?? "").matchAll(LINK)].flatMap((m) =>
        [...m[2].matchAll(/OBS-(\d+)/gi)].map((i) => ({ word: m[1].toLowerCase(), n: Number(i[1]) })));
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
    const system = changed.filter((f) => SYSTEM_DIRS.some((d) => f.startsWith(d)));
    if (!system.length || DOCS.some((d) => changed.includes(d))) return [];
    const files = `${system[0]}${system.length > 1 ? ` and ${system.length - 1} more` : ""}`;
    const section = docsSection(body);
    if (section === null) {
        return [`system files changed (${files}) but ${DOCS.join(" and ")} didn't; change one, or add a \`## Docs\` section saying why neither needs anything`];
    }
    if (!section) return [`${DOCS.join(" and ")} are unchanged; the \`## Docs\` section must say why neither needs anything`];
    return [];
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
