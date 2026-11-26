// Tests Plan's dialog: its title, its Cancel and Plan buttons, and its keys (OBS-259). Run from the
// vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// What the days open into is Obsidian's (side by side, or tabs on a phone), so these stop at
// openDays and check the number it's given.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadClass } from "../../../plugin/classShape.mjs";

// Plan's dialog with stand-ins for Obsidian's parts, which record what the dialog does
const open = async () => {
    const seen = { title: null, closed: 0, buttons: [], keys: new Map(), rows: [] };
    class Modal {
        constructor() {
            this.titleEl = { setText: (t) => { seen.title = t; } };
            this.contentEl = { createDiv: (o) => { const row = { cls: o?.cls }; seen.rows.push(row); return row; } };
            this.scope = { register: (mods, key, fn) => seen.keys.set(key, fn) };
        }
        onOpen() {}
        open() { this.onOpen(); }
        close() { seen.closed++; }
    }
    class DropdownComponent {
        constructor() { this.selectEl = { addClass() {}, focus() {} }; this.options = []; this.value = ""; }
        addOption(v, label) { this.options.push([v, label]); return this; }
        setValue(v) { this.value = v; return this; }
        getValue() { return this.value; }
    }
    class ButtonComponent {
        constructor(row) { this.row = row; this.cta = false; seen.buttons.push(this); }
        setButtonText(t) { this.text = t; return this; }
        setCta() { this.cta = true; return this; }
        onClick(fn) { this.click = fn; return this; }
    }
    const ctx = vm.createContext({
        app: {},
        Notice: class {},
        Platform: { isMobile: false },
        requestAnimationFrame: () => {},
        Modal, ButtonComponent,
        DropdownComponent: class extends DropdownComponent {
            constructor(...a) { super(...a); seen.dropdown = this; }
        },
    });
    const Plan = loadClass("plan.js", ctx);
    const plan = new Plan();
    const ran = [];
    plan.openDays = async (days) => { ran.push(days); };
    await plan.invoke();
    const button = (text) => seen.buttons.find((b) => b.text === text);
    return { seen, ran, button };
};

test("the title asks the question, with no other text", async () => {
    const { seen } = await open();
    assert.equal(seen.title, "How many days?");
    assert.deepEqual(seen.dropdown.options.map(([, label]) => label), ["2 days", "3 days", "4 days", "5 days"]);
    assert.equal(seen.dropdown.getValue(), "2");
});

test("Cancel and Plan sit in one button row, Cancel first and Plan highlighted", async () => {
    const { seen } = await open();
    assert.deepEqual(seen.buttons.map((b) => b.text), ["Cancel", "Plan"]);
    assert.equal(seen.rows.length, 1);
    assert.equal(seen.rows[0].cls, "modal-button-container");
    assert.ok(seen.buttons.every((b) => b.row === seen.rows[0]));
    assert.deepEqual(seen.buttons.map((b) => b.cta), [false, true]);
});

test("Plan opens the number of days the dropdown shows", async () => {
    const { seen, ran, button } = await open();
    seen.dropdown.setValue("4");
    button("Plan").click();
    assert.deepEqual(ran, [4]);
    assert.equal(seen.closed, 1);
});

test("Cancel closes and opens nothing", async () => {
    const { seen, ran, button } = await open();
    seen.dropdown.setValue("5");
    button("Cancel").click();
    assert.deepEqual(ran, []);
    assert.equal(seen.closed, 1);
});

test("the keys work as before: 2 to 5 at once, Enter takes the dropdown's number", async () => {
    const { seen, ran } = await open();
    assert.deepEqual([...seen.keys.keys()], ["2", "3", "4", "5", "Enter"]);
    assert.equal(seen.keys.get("3")(), false);
    seen.dropdown.setValue("5");
    assert.equal(seen.keys.get("Enter")(), false);
    assert.deepEqual(ran, [3, 5]);
});
