// CI: no tracked file's path or text names a numbered folder the vault dropped in OBS-81: the
// system's old home and its subfolders, the old inbox, the old reference folder and its
// subfolders, and the old archive. A branch rebased across the rename keeps the paths it typed
// itself, and git can't move those; this catches them, and a file still named after one.
//
// Run from the repo root: node .github/ci/checkFolders.mjs
// Exits 1 with one line per file and line that names one.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Built from parts, so this file and its test don't name the folders themselves
const NUMBERED = [["00", "Meta"], ["10", "Inbox"], ["30", "Reference"], ["90", "Archive"]];
const SUBFOLDERS = [["0[1-4]", "Templates|Scripts|Clippers|Bases"], ["3[1-7]", "Notes|Sources|Subjects|Entities|People|Planner|Invoices|Journal"]];
export const OLD = new RegExp(`\\b(?:${[...NUMBERED.map(([n, name]) => `${n} ${name}`), ...SUBFOLDERS.map(([n, names]) => `${n} (?:${names})`)].join("|")})\\b`, "i");

// The lines of `text` that name an old folder: [{ line, text }]
export function oldFolderLines(text) {
    return text.split("\n").flatMap((line, i) => (OLD.test(line) ? [{ line: i + 1, text: line.trim() }] : []));
}

export function checkAll(root = ".") {
    const files = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).stdout.split("\0").filter(Boolean);
    const problems = [];
    for (const file of files) {
        // The path itself, which a git mv of the folders doesn't fix (a folder note named after one)
        if (OLD.test(file)) problems.push(`${file}: its path names a numbered folder the vault no longer has (OBS-81)`);
        let text;
        try {
            text = fs.readFileSync(path.join(root, file), "utf8");
        } catch {
            continue;
        }
        if (text.includes("\u0000")) continue;   // binary
        for (const { line, text: what } of oldFolderLines(text)) {
            problems.push(`${file}:${line}: names a numbered folder the vault no longer has (OBS-81): ${what.slice(0, 120)}`);
        }
    }
    return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const problems = checkAll();
    for (const p of problems) console.log(`::error::${p}`);
    if (problems.length) process.exit(1);
    console.log("No file names a numbered folder.");
}
