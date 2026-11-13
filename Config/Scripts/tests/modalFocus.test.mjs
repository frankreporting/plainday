// Tests that the prompts focus their control once the modal is open, not straight after open()
// (OBS-50). Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// A hotkey runs its command inside the editor's keydown. Focusing in that same turn fights the
// editor, and the first key typed can land in the note. The real race needs Obsidian, so these
// check the shape: no script focuses right after open(), and the prompts focus from onOpen after
// a frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const dir = new URL("../../../plugin/src/classes/", import.meta.url);
const scripts = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
const read = (f) => fs.readFileSync(new URL(f, dir), "utf8");

test("no script focuses anything straight after a modal's open()", () => {
    for (const f of scripts) {
        const lines = read(f).split("\n");
        lines.forEach((line, i) => {
            if (!/\bmodal\.open\(\);/.test(line)) return;
            // The next statement, skipping blank lines and comments
            let j = i + 1;
            while (j < lines.length && /^\s*(\/\/.*)?$/.test(lines[j])) j++;
            assert.doesNotMatch(lines[j] ?? "", /\.focus\(\)/, `${f}:${j + 1} focuses right after open()`);
        });
    }
});

test("each prompt focuses its control from onOpen, a frame later", () => {
    for (const [f, control] of [
        ["datePrompt.js", "input.inputEl.focus()"],   // Schedule, Due and JumpToDate
        ["jumpToDate.js", "yes.focus()"],
        ["plan.js", "dropdown.selectEl.focus()"],
        ["addTaskNote.js", "move.buttonEl.focus()"],
        ["invoice.js", "input.inputEl.focus()"],        // Invoice: the invoice code and first number
        ["invoice.js", "buttonEl.focus())"],           // Invoice: its confirmation and questions
    ]) {
        // The focus that opens the prompt; a later one, after a click, may focus the same control
        const lines = read(f).split("\n").filter((l) => l.includes(control));
        assert.ok(lines.length > 0, `${f} focuses ${control}`);
        assert.ok(lines.some((l) => /onOpen.*requestAnimationFrame\(/.test(l)), `${f} focuses inside onOpen, after a frame`);
    }
});

// A Modal the way Obsidian's behaves for this: open() calls onOpen synchronously.
const harness = () => {
    const log = [];
    const frames = [];
    const el = (name) => ({ style: {}, focus: () => log.push(`focus ${name}`) });
    class Modal {
        constructor() { this.titleEl = { setText() {} }; this.contentEl = {}; this.scope = { register() {} }; }
        onOpen() {}
        open() { log.push("open"); this.onOpen(); }
        close() {}
    }
    class DropdownComponent {
        constructor() { this.selectEl = el("dropdown"); this.value = ""; }
        addOption() { return this; }
        setValue(v) { this.value = v; return this; }
        getValue() { return this.value; }
    }
    const ctx = vm.createContext({
        app: {},
        Notice: class {},
        requestAnimationFrame: (fn) => frames.push(fn),
        customJS: { obsidian: { Modal, DropdownComponent } },
    });
    return { log, frames, ctx };
};

for (const [f, name] of [["plan.js", "Plan"]]) {
    test(`${name}: the dropdown takes focus on the next frame, not during the command`, async () => {
        const { log, frames, ctx } = harness();
        const Cls = vm.runInContext(`${read(f)}\n;${name}`, ctx);
        await new Cls().invoke();
        assert.deepEqual(log, ["open"], "nothing focused while the command's turn is still running");
        assert.equal(frames.length, 1);
        frames[0]();
        assert.deepEqual(log, ["open", "focus dropdown"]);
    });
}
