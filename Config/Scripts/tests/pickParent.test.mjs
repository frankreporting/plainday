// Tests for Templater/pickParent.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The script is loaded with vm the way Templater loads a user script, on a stand-in vault, beside
// AddTaskNote, whose rule for a finished project or area it asks (OBS-125). The menu itself is
// Templater's suggester, stood in for by one that returns the labels it was given.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const source = (file) => fs.readFileSync(new URL(file, here), "utf8");
const NOTES = {
    "Projects/Freelance/Freelance.md": { tags: ["area"] },
    "Projects/Old Area/Old Area.md": { tags: ["area"], status: "Canceled" },
    "Projects/Freelance/Kestrel/Kestrel.md": { tags: ["project"], status: "Active" },
    "Projects/Freelance/Old Job/Old Job.md": { tags: ["project"], status: "Done" },
    "Projects/Freelance/Dropped/Dropped.md": { tags: ["project"], status: "canceled" },
    "Projects/Freelance/Paused/Paused.md": { tags: ["project"], status: "On Hold" },
    "Projects/Freelance/Dated/Dated.md": { tags: ["project"], completed: "2026-09-30" },
    "Projects/Freelance/Kestrel/Brief.md": { tags: ["task"] },
};

// The menu's labels, in order, with AddTaskNote loaded through `customJS` or without it
const menu = async ({ withCustomJS = true } = {}) => {
    const files = Object.keys(NOTES).map((path) => ({
        path, basename: path.split("/").pop().replace(/\.md$/, ""), parent: { path: path.slice(0, path.lastIndexOf("/")) },
    }));
    const app = {
        vault: { getMarkdownFiles: () => files },
        metadataCache: { getFileCache: (f) => ({ frontmatter: NOTES[f.path] }) },
    };
    const context = vm.createContext({ app, module: { exports: null } });
    if (withCustomJS) {
        const AddTaskNote = vm.runInContext(source("../CustomJS/addTaskNote.js") + "\n;AddTaskNote", context);
        context.customJS = { AddTaskNote: new AddTaskNote() };
    }
    vm.runInContext(source("../Templater/pickParent.js"), context);
    const tp = { config: { target_file: { path: "Inbox/New.md" } }, system: { suggester: async (label, items) => items.map(label) } };
    return context.module.exports(tp, (folder) => folder.startsWith("Projects/"), "Select parent...");
};

test("pickParent leaves out finished projects and areas, by AddTaskNote's rule (OBS-125)", async () => {
    assert.deepEqual(await menu(), ["Dated", "Freelance", "Kestrel", "Paused"]);
});

test("pickParent without CustomJS lists every area and project rather than failing", async () => {
    assert.deepEqual(await menu({ withCustomJS: false }), ["Dated", "Dropped", "Freelance", "Kestrel", "Old Area", "Old Job", "Paused"]);
});
