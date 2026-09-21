// CI: nothing personal reaches GitHub (CLAUDE.md, "Privacy").
//
// Scans what a pull request adds: the diff's added lines, its commit messages, the PR title
// and body, and the branch name. Two severities:
// - block: a home-folder path, an email (other than the bot and GitHub noreply addresses),
//   an API token or private key, and a claude.ai session or artifact link.
// - warn: a dollar amount. The sample notes and tests use invented rates, so this only asks
//   for a second look.
// It also fails when a tracked file is one .gitignore would exclude (a `*.private.*` file, a
// personal setting), since that's how private data would slip in.
//
// Names, clients and amounts from a real vault can't be recognised by pattern: the rule in
// CLAUDE.md ("Privacy") is that nothing in the repo is written from a real note, and that
// part stays with the person writing the PR.
//
// Inputs (environment): BASE_SHA and HEAD_SHA for the diff and commits; PR_TITLE, PR_BODY,
// PR_BRANCH. Missing inputs are skipped. Exit 1 on any block finding.
import path from "node:path";
import { spawnSync } from "node:child_process";

const ALLOWED_EMAILS = [
    /^noreply@anthropic\.com$/i,
    /@users\.noreply\.github\.com$/i,
    /@example\.(com|org|net)$/i,
];

const RULES = [
    { rule: "home folder path", severity: "block", re: /(?<![\w./-])\/(?:Users|home)\/[A-Za-z0-9._-]+/g },
    { rule: "email address", severity: "block", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, allow: (m) => ALLOWED_EMAILS.some((a) => a.test(m)) },
    { rule: "claude.ai link", severity: "block", re: /claude\.ai\/(?:code|artifact)\/[\w-]+/g },
    { rule: "GitHub token", severity: "block", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g },
    { rule: "Linear token", severity: "block", re: /\blin_(?:api|oauth)_[A-Za-z0-9]{10,}/g },
    { rule: "Anthropic key", severity: "block", re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g },
    { rule: "Slack token", severity: "block", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
    { rule: "AWS key", severity: "block", re: /\bAKIA[0-9A-Z]{16}\b/g },
    { rule: "private key", severity: "block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { rule: "JWT", severity: "block", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
    { rule: "dollar amount", severity: "warn", re: /\$\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$\d+\.\d{2}\b|\$\d{2,}\b/g },
];

// Findings in one line of text: [{ severity, rule, match }]
export function scanLine(line) {
    const found = [];
    for (const { rule, severity, re, allow } of RULES) {
        for (const m of line.matchAll(re)) {
            if (allow?.(m[0])) continue;
            found.push({ severity, rule, match: m[0] });
        }
    }
    return found;
}

// Findings in a unified diff's added lines, with file and line number.
export function scanDiff(diff) {
    const found = [];
    let file = null;
    let line = 0;
    for (const raw of diff.split("\n")) {
        if (raw.startsWith("+++ ")) {
            file = raw.startsWith("+++ b/") ? raw.slice(6) : null;
        } else if (raw.startsWith("@@")) {
            line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0) - 1;
        } else if (raw.startsWith("+")) {
            line += 1;
            for (const f of scanLine(raw.slice(1))) found.push({ ...f, where: file, line, isFile: true });
        } else if (!raw.startsWith("-") && !raw.startsWith("\\")) {
            line += 1;
        }
    }
    return found;
}

export function scanText(text, where) {
    const found = [];
    text.split("\n").forEach((l, i) => {
        for (const f of scanLine(l)) found.push({ ...f, where, line: i + 1 });
    });
    return found;
}

function git(args) {
    const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
    return r.stdout;
}

export function main(env = process.env) {
    const findings = [];

    // Tracked files that .gitignore would exclude
    for (const f of git(["ls-files", "-i", "-c", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) {
        findings.push({ severity: "block", rule: "tracked file that .gitignore excludes", match: f, where: f, line: 1 });
    }
    for (const f of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
        if (/\.private\./.test(path.basename(f))) {
            findings.push({ severity: "block", rule: "tracked *.private.* file", match: f, where: f, line: 1 });
        }
    }

    if (env.BASE_SHA && env.HEAD_SHA) {
        const range = `${env.BASE_SHA}...${env.HEAD_SHA}`;
        findings.push(...scanDiff(git(["diff", "--no-color", "--no-ext-diff", range])));
        findings.push(...scanText(git(["log", "--format=%H%n%B", range]), "commit messages"));
    }
    if (env.PR_TITLE) findings.push(...scanText(env.PR_TITLE, "PR title"));
    if (env.PR_BODY) findings.push(...scanText(env.PR_BODY, "PR body"));
    if (env.PR_BRANCH) findings.push(...scanText(env.PR_BRANCH, "branch name"));
    return findings;
}

// A token must not be echoed into the log either.
export function describe(f) {
    const shown = f.severity === "block" && /token|key|JWT/i.test(f.rule) ? `${f.match.slice(0, 6)}…` : f.match;
    return `${f.rule}: ${shown}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const findings = main();
    for (const f of findings) {
        const at = f.isFile && f.where ? ` file=${f.where},line=${f.line}` : "";
        console.log(`::${f.severity === "block" ? "error" : "warning"}${at}::${describe(f)} (${f.where}:${f.line})`);
    }
    const blocks = findings.filter((f) => f.severity === "block").length;
    if (blocks) {
        console.log(`${blocks} finding(s) block this PR. See CLAUDE.md, "Privacy".`);
        process.exit(1);
    }
    console.log(findings.length ? `${findings.length} warning(s), nothing blocking.` : "Nothing personal found.");
}
