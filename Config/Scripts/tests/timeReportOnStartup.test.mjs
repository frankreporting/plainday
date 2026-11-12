// Tests for CustomJS/timeReportOnStartup.js. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The class is loaded with vm against a stub of the little it asks of `app` and `customJS`: the
// layout is ready, the metadata cache is clean (unless a test holds it), Plainday is loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const here = new URL(".", import.meta.url);
const code = fs.readFileSync(new URL("../CustomJS/timeReportOnStartup.js", here), "utf8");

// `customJS` with Plainday loaded and no class in it
const bare = () => ({ obsidian: { Platform: { isDesktop: true } }, plugin: {} });
// A TimeReport whose refresh records its calls
const timeReport = (calls) => ({ refresh: async (opts) => { calls.push(opts); } });

// Loads the class. With `hold`, the metadata cache's clean callback is kept for the test to release.
function load(customJS, { hold = null } = {}) {
    const warnings = [];
    const context = {
        app: {
            workspace: { onLayoutReady: (cb) => cb() },
            metadataCache: { onCleanCache: hold ? (cb) => { hold.release = cb; } : (cb) => cb() },
        },
        customJS,
        console: { ...console, warn: (m) => warnings.push(String(m)) },
        // The minute-long indexing timeout is never awaited here, so it mustn't keep the test process
        // alive; the short polls must, or the process exits with a run still waiting
        setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (ms >= 1000) t.unref(); return t; },
    };
    const TimeReportOnStartup = vm.runInContext(code + "\n;TimeReportOnStartup", vm.createContext(context));
    TimeReportOnStartup.READY_WAIT_MS = 500;
    return { context, TimeReportOnStartup, warnings };
}
const after = (ms, fn) => setTimeout(fn, ms);
// Objects made inside the vm context have that context's prototypes; compare as plain data
const plain = (x) => JSON.parse(JSON.stringify(x));

test("refreshes at once when TimeReport and Schedule are registered", async () => {
    const calls = [];
    const { TimeReportOnStartup, warnings } = load({ ...bare(), Schedule: {}, Billing: {}, TaskIds: {}, TimeReport: timeReport(calls) });
    await new TimeReportOnStartup().invoke();
    assert.deepEqual(plain(calls), [{ quiet: true }]);
    assert.deepEqual(warnings, []);
});

test("OBS-41: a run that wakes up to find its classes gone waits a moment for them to come back", async () => {
    const oldCalls = [], newCalls = [];
    const hold = {};
    const { context, TimeReportOnStartup, warnings } = load({ ...bare(), Schedule: {}, Billing: {}, TaskIds: {}, TimeReport: timeReport(oldCalls) }, { hold });
    // Every class is there when the run starts; it then waits for the metadata cache
    const run = new TimeReportOnStartup().invoke();
    await new Promise((r) => setImmediate(r));
    // The classes go, and come back one at a time
    context.customJS = bare();
    hold.release();
    after(50, () => { context.customJS.Schedule = {}; context.customJS.Billing = {}; context.customJS.TaskIds = {}; });
    after(100, () => { context.customJS.TimeReport = timeReport(newCalls); });
    await run;
    assert.deepEqual(oldCalls, []);
    assert.deepEqual(plain(newCalls), [{ quiet: true }]);
    assert.deepEqual(warnings, []);
});

test("does nothing once Plainday has unloaded while it waited for the index", async () => {
    const calls = [];
    const hold = {};
    const { context, TimeReportOnStartup, warnings } = load({ ...bare(), Schedule: {}, Billing: {}, TaskIds: {}, TimeReport: timeReport(calls) }, { hold });
    const run = new TimeReportOnStartup().invoke();
    await new Promise((r) => setImmediate(r));
    context.customJS.plugin = null;
    hold.release();
    await run;
    assert.deepEqual(calls, []);
    assert.deepEqual(warnings, []);
});

test("OBS-41: skips with a warning when a class doesn't come back in time", async () => {
    const calls = [];
    const { TimeReportOnStartup, warnings } = load({ ...bare(), Billing: {}, TaskIds: {}, TimeReport: timeReport(calls) });
    await new TimeReportOnStartup().invoke();
    assert.deepEqual(calls, []);
    assert.equal(warnings.length, 1, warnings.join("\n"));
    assert.match(warnings[0], /customJS\.Schedule isn't registered/);
    assert.match(warnings[0], /skipped/);
});

test("OBS-5: waits for Billing too, which the project timesheets need", async () => {
    const calls = [];
    const { TimeReportOnStartup, warnings } = load({ ...bare(), Schedule: {}, TaskIds: {}, TimeReport: timeReport(calls) });
    await new TimeReportOnStartup().invoke();
    assert.deepEqual(calls, []);
    assert.match(warnings[0], /customJS\.Billing isn't registered/);
});

test("OBS-185: waits for TaskIds too, which the task checks need", async () => {
    const calls = [];
    const { TimeReportOnStartup, warnings } = load({ ...bare(), Schedule: {}, Billing: {}, TimeReport: timeReport(calls) });
    await new TimeReportOnStartup().invoke();
    assert.deepEqual(calls, []);
    assert.match(warnings[0], /customJS\.TaskIds isn't registered/);
});
