// Tests for Templater/folderLook.js (OBS-142). Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const folderLook = createRequire(import.meta.url)("../Templater/folderLook.js");

const TAG_LOOKS = { project: { icon: "circle", color: "#ef4444" }, area: { icon: "archive", color: "#168a42" } };

// A Notebook Navigator with the public API calls folderLook uses, recording what it was asked
function fakeNavigator({ folderLooks = {}, tagLooks = TAG_LOOKS, pinned = [], settings = { enableFolderNotes: true, pinCreatedFolderNote: true } } = {}) {
    const calls = { setFolderMeta: [], pin: [] };
    const metadata = {
        getTagMeta: (tag) => tagLooks[tag] ?? null,
        getFolderMeta: (folder) => folderLooks[folder.path] ?? null,
        setFolderMeta: async (folder, meta) => {
            calls.setFolderMeta.push([folder.path, meta]);
            folderLooks[folder.path] = meta;
        },
        isPinned: (file, context) => context === "folder" && pinned.includes(file.path),
        pin: async (file, context) => calls.pin.push([file.path, context]),
    };
    return { navigator: { api: { metadata }, settings }, calls };
}

function folderNote(path) {
    const parts = path.split("/");
    const name = parts.pop().replace(/\.md$/, "");
    const folderPath = parts.join("/");
    return { path, basename: name, parent: { path: folderPath, name: folderPath.split("/").pop() } };
}

test("a new project's folder gets the project tag's look, and its note is pinned in it", async () => {
    const { navigator, calls } = fakeNavigator();
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    assert.deepEqual(calls.setFolderMeta, [["Projects/Launch plan", { icon: "circle", color: "#ef4444" }]]);
    assert.deepEqual(calls.pin, [["Projects/Launch plan/Launch plan.md", "folder"]]);
});

test("a new area's folder gets the area tag's look", async () => {
    const { navigator, calls } = fakeNavigator();
    await folderLook.apply(folderNote("Projects/Hobbies/Hobbies.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [["Projects/Hobbies", { icon: "archive", color: "#168a42" }]]);
});

test("a background color on the tag comes along; a tag with only an icon gives only the icon", async () => {
    const { navigator, calls } = fakeNavigator({
        tagLooks: { project: { icon: "star", color: undefined, backgroundColor: "#fff3c4" }, area: { icon: "box" } },
    });
    await folderLook.apply(folderNote("Projects/A/A.md"), "project", navigator);
    await folderLook.apply(folderNote("Projects/B/B.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [
        ["Projects/A", { icon: "star", backgroundColor: "#fff3c4" }],
        ["Projects/B", { icon: "box" }],
    ]);
});

test("a folder that already has a look keeps it", async () => {
    const { navigator, calls } = fakeNavigator({ folderLooks: { "Projects/Launch plan": { icon: "rocket" } } });
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    assert.deepEqual(calls.setFolderMeta, []);
    assert.equal(calls.pin.length, 1, "pinning doesn't depend on the look");
});

test("tags Navigator gives no look: a project gets a red circle and an area a green archive", async () => {
    const { navigator, calls } = fakeNavigator({ tagLooks: {} });
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    await folderLook.apply(folderNote("Projects/Hobbies/Hobbies.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [
        ["Projects/Launch plan", { icon: "circle", color: "#ef4444" }],
        ["Projects/Hobbies", { icon: "archive", color: "#168a42" }],
    ]);
    assert.deepEqual(calls.pin, [["Projects/Launch plan/Launch plan.md", "folder"], ["Projects/Hobbies/Hobbies.md", "folder"]]);
});

test("a tag whose look is empty, or a Navigator without getTagMeta, gets the system's look", async () => {
    const { navigator, calls } = fakeNavigator({ tagLooks: { project: { icon: undefined, color: undefined } } });
    await folderLook.apply(folderNote("Projects/A/A.md"), "project", navigator);
    delete navigator.api.metadata.getTagMeta;
    await folderLook.apply(folderNote("Projects/B/B.md"), "area", navigator);
    assert.deepEqual(calls.setFolderMeta, [
        ["Projects/A", { icon: "circle", color: "#ef4444" }],
        ["Projects/B", { icon: "archive", color: "#168a42" }],
    ]);
});

test("the system's looks aren't changed by a folder's look", async () => {
    const { navigator } = fakeNavigator({ tagLooks: {} });
    await folderLook.apply(folderNote("Projects/A/A.md"), "project", navigator);
    navigator.api.metadata.getFolderMeta({ path: "Projects/A" }).icon = "rocket";
    assert.equal(folderLook.LOOKS.project.icon, "circle");
});

test("pinning follows Navigator's own settings: Pin created folder notes, with folder notes on", async () => {
    for (const settings of [
        { enableFolderNotes: true, pinCreatedFolderNote: false },
        { enableFolderNotes: false, pinCreatedFolderNote: true },
        null,
    ]) {
        const { navigator, calls } = fakeNavigator({ settings });
        await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
        assert.deepEqual(calls.pin, [], JSON.stringify(settings));
        assert.equal(calls.setFolderMeta.length, 1);
    }
});

test("a note already pinned in its folder isn't pinned again", async () => {
    const { navigator, calls } = fakeNavigator({ pinned: ["Projects/Launch plan/Launch plan.md"] });
    await folderLook.apply(folderNote("Projects/Launch plan/Launch plan.md"), "project", navigator);
    assert.deepEqual(calls.pin, []);
});

test("without Navigator, or with an older one lacking these calls, nothing happens", async () => {
    const file = folderNote("Projects/Launch plan/Launch plan.md");
    await folderLook.apply(file, "project", null);
    await folderLook.apply(file, "project", { settings: { enableFolderNotes: true, pinCreatedFolderNote: true } });
    await folderLook.apply(file, "project", { api: { metadata: {} }, settings: { enableFolderNotes: true, pinCreatedFolderNote: true } });
});

test("only a folder note: a note not named like its folder, or at the vault root, is left alone", async () => {
    const { navigator, calls } = fakeNavigator();
    await folderLook.apply(folderNote("Inbox/Launch plan.md"), "project", navigator);
    await folderLook.apply({ path: "Launch plan.md", basename: "Launch plan", parent: { path: "/", name: "" } }, "project", navigator);
    await folderLook.apply({ path: "x.md", basename: "x", parent: null }, "project", navigator);
    assert.deepEqual(calls, { setFolderMeta: [], pin: [] });
});

// An Obsidian workspace that can report Templater's events, and the app around it
function fakeApp(navigator) {
    const listeners = new Set();
    const workspace = {
        on: (name, cb) => {
            const ref = { name, cb };
            listeners.add(ref);
            return ref;
        },
        offref: (ref) => listeners.delete(ref),
        trigger: (name, data) => {
            for (const ref of [...listeners]) if (ref.name === name) ref.cb(data);
        },
    };
    return { app: { workspace, plugins: { plugins: { "notebook-navigator": navigator } } }, listeners };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("from a template: waits for Templater to report it wrote this note, then a moment more, and writes nothing into it", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { navigator, calls } = fakeNavigator();
    const { app, listeners } = fakeApp(navigator);
    globalThis.app = app;
    try {
        const file = folderNote("Projects/Launch plan/Launch plan.md");
        assert.equal(folderLook({ config: { target_file: file } }, "project"), "");
        assert.equal(listeners.size, 1);

        // Another note written: not this one's turn
        app.workspace.trigger("templater:new-note-from-template", { file: folderNote("Projects/Other/Other.md"), content: "" });
        t.mock.timers.tick(folderLook.DELAY_MS);
        await settle();
        assert.deepEqual(calls.setFolderMeta, []);
        assert.equal(listeners.size, 1);

        app.workspace.trigger("templater:new-note-from-template", { file, content: "" });
        assert.equal(listeners.size, 0, "listens for one write only");
        await settle();
        assert.deepEqual(calls.setFolderMeta, [], "not while Templater is still finishing the note");
        t.mock.timers.tick(folderLook.DELAY_MS);
        await settle();
        assert.deepEqual(calls.setFolderMeta, [["Projects/Launch plan", { icon: "circle", color: "#ef4444" }]]);
        assert.deepEqual(calls.pin, [["Projects/Launch plan/Launch plan.md", "folder"]]);
    } finally {
        delete globalThis.app;
    }
});

test("from a template: a note Templater never reports written (the template failed) gets nothing, and it stops listening", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { navigator, calls } = fakeNavigator();
    const { app, listeners } = fakeApp(navigator);
    globalThis.app = app;
    try {
        const file = folderNote("Projects/Launch plan/Launch plan.md");
        folderLook({ config: { target_file: file } }, "project");
        t.mock.timers.tick(10000);
        assert.equal(listeners.size, 0);
        app.workspace.trigger("templater:new-note-from-template", { file, content: "" });
        t.mock.timers.tick(folderLook.DELAY_MS);
        await settle();
        assert.deepEqual(calls, { setFolderMeta: [], pin: [] });
    } finally {
        delete globalThis.app;
    }
});

test("from a template: a failure in Navigator only logs", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { navigator } = fakeNavigator();
    navigator.api.metadata.setFolderMeta = async () => {
        throw new Error("boom");
    };
    const { app } = fakeApp(navigator);
    globalThis.app = app;
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args);
    try {
        const file = folderNote("Projects/Other/Other.md");
        folderLook({ config: { target_file: file } }, "project");
        app.workspace.trigger("templater:new-note-from-template", { file, content: "" });
        t.mock.timers.tick(folderLook.DELAY_MS);
        await settle();
    } finally {
        console.error = consoleError;
        delete globalThis.app;
    }
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /Projects\/Other/);
});
