// npm's preinstall step: refuses `npm install` and `npm ci` in a folder Obsidian opens as a vault.
//
// This repository is also a working demo vault, and its clone is the dev vault. A node_modules
// folder there would put thousands of files into a vault Obsidian indexes. So npm runs in a
// worktree, in CI, or in the folder dev-vault.sh builds in (.dev-vault/build/, which Obsidian
// skips, as it skips every folder whose name starts with a dot).
//
// A folder counts as a vault once Obsidian has opened it: it then has .obsidian/workspace.json
// (or workspace-mobile.json). The folder checked is the repository's root, the one above plugin/,
// for an install there and in plugin/ alike. Set PLAINDAY_NPM_IN_VAULT=1 to install anyway.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opened = ["workspace.json", "workspace-mobile.json"].some((f) => fs.existsSync(path.join(root, ".obsidian", f)));

if (opened && !process.env.CI && process.env.PLAINDAY_NPM_IN_VAULT !== "1") {
    console.error([
        `plainday: not installing in ${root}: Obsidian opens this folder as a vault, and node_modules would put`,
        "thousands of files into it. Build in a worktree instead (git worktree add ../<folder> -b <branch>),",
        "or let Config/Scripts/dev-vault.sh build for the dev vault. PLAINDAY_NPM_IN_VAULT=1 installs here anyway.",
    ].join("\n"));
    process.exit(1);
}
