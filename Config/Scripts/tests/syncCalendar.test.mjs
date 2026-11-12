// Tests for Calendar/sync-calendar.sh. Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// The script is run in a throwaway vault with stubs for the Obsidian CLI, `open`, `launchctl`,
// `swift` and `jq`; each stub records how it was called, and a state file says whether "Obsidian"
// is running.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LABEL = "local.calendar-sync";
const PLIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string></dict></plist>
`;

const SCRIPT = fileURLToPath(new URL("../Calendar/sync-calendar.sh", import.meta.url));

function stub(dir, name, body) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
}

// A vault with the script in place and stubs around it. `running`: does the CLI answer?
function setUp({ running = false, opens = true, fetches = true, scheduled = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-calendar-"));
    const calendar = path.join(dir, "vault", "Config", "Scripts", "Calendar");
    fs.mkdirSync(calendar, { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(calendar, "sync-calendar.sh"));
    fs.chmodSync(path.join(calendar, "sync-calendar.sh"), 0o755);
    fs.mkdirSync(path.join(dir, "Library", "LaunchAgents"), { recursive: true });
    const plist = path.join(dir, "Library", "LaunchAgents", "local.calendar-sync.plist");
    fs.mkdirSync(path.join(dir, "Library", "Logs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "state"), running ? "running" : "closed");
    const calls = path.join(dir, "calls");
    fs.writeFileSync(calls, "");

    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    // The CLI answers "vault info=path" only while Obsidian is running, and answers for the vault
    // named in `vault=<name>`: without a matching name it reaches a different vault (or none)
    stub(dir, "bin/obsidian", `echo "obsidian $*" >> ${calls}
[ "$(cat ${dir}/state)" = running ] || exit 1
case "$1" in
  vault=vault) ;;
  *) echo "/some/other/vault"; exit 0 ;;
esac
case "$2" in
  vault) echo "${path.join(dir, "vault")}" ;;
  *) echo ok ;;
esac`);
    stub(dir, "bin/open", `echo "open $*" >> ${calls}
${opens ? `echo running > ${dir}/state` : "true"}`);
    stub(dir, "bin/swift", `echo "swift $*" >> ${calls}
${fetches ? `echo '{"events":[]}' > "$5"` : "echo denied >&2; exit 1"}`);
    stub(dir, "bin/jq", "echo 2");
    // plutil is macOS-only; the stub reads the label so the test runs on Linux too
    stub(dir, "bin/plutil", `for f; do :; done
sed -n 's:.*<key>Label</key><string>\\(.*\\)</string>.*:\\1:p' "$f"`);
    stub(dir, "bin/launchctl", `echo "launchctl $*" >> ${calls}
case "$1" in
  list) [ -f ${dir}/loaded ] || exit 1; echo '{ "LastExitStatus" = 256; };' ;;
  bootstrap) touch ${dir}/loaded ;;
  bootout) rm -f ${dir}/loaded ;;
esac`);

    if (scheduled) fs.writeFileSync(plist, PLIST_XML);
    const run = (...args) => {
        const out = execFileSync("/bin/zsh", [path.join(calendar, "sync-calendar.sh"), ...args], {
            encoding: "utf8",
            env: {
                ...process.env, HOME: dir, OBSIDIAN_CLI: path.join(bin, "obsidian"), OPEN_CMD: path.join(bin, "open"),
                LAUNCHCTL_CMD: path.join(bin, "launchctl"), SWIFT_CMD: path.join(bin, "swift"), JQ_CMD: path.join(bin, "jq"),
                PLUTIL_CMD: path.join(bin, "plutil"),
                OBSIDIAN_WAIT: "3",
            },
        });
        return { out, calls: fs.readFileSync(calls, "utf8") };
    };
    const forget = () => fs.writeFileSync(calls, "");
    const schedule = () => fs.writeFileSync(plist, PLIST_XML);
    return { dir, run, forget, schedule };
}

test("Obsidian running: its own Calendar sync does the work, and nothing else is run", () => {
    const { run } = setUp({ running: true });
    const { out, calls } = run();
    assert.match(out, /Obsidian synced the calendar/);
    assert.match(calls, /obsidian vault=vault command id=plainday:sync-calendars/);
    assert.doesNotMatch(calls, /swift|open /);
});

test("Obsidian closed: it's opened in the background, then asked to sync", () => {
    const { run } = setUp({ running: false });
    const { out, calls } = run();
    assert.match(out, /opening this vault in the background/);
    assert.match(calls, /open -g obsidian:\/\/open\?vault=vault/, "opens this vault by name, not just the app");
    assert.match(calls, /obsidian vault=vault command id=plainday:sync-calendars/);
    assert.match(out, /Obsidian synced the calendar/);
    assert.doesNotMatch(calls, /swift/);
});

test("every CLI call names this script's own vault, before the command", () => {
    const { run } = setUp({ running: true });
    const { calls } = run();
    const cli = calls.split("\n").filter((l) => l.startsWith("obsidian "));
    assert.ok(cli.length >= 2, calls);
    for (const line of cli) assert.match(line, /^obsidian vault=vault /, line);
    // after the command, `vault=` is ignored by the CLI, so it has to come first
    for (const line of cli) assert.ok(line.indexOf("vault=vault") < line.indexOf("command id=") || !line.includes("command id="), line);
});

test("a sync that would reach another vault is treated as Obsidian not answering", () => {
    // the stub answers with a different path unless the name matches, as the CLI does for a vault
    // that isn't open; the script must not sync that vault
    const { dir, run } = setUp({ running: true });
    fs.writeFileSync(path.join(dir, "state"), "running");
    const { out, calls } = run("--no-launch");
    assert.match(calls, /obsidian vault=vault vault info=path/);
    assert.doesNotMatch(out, /couldn't reach Obsidian/);
});

test("--no-launch: nothing is opened, and the fetch keeps the events file current", () => {
    const { run } = setUp({ running: false });
    const { out, calls } = run("--no-launch", "3");
    assert.doesNotMatch(calls, /open /);
    assert.match(calls, /swift .*fetchCalendar.swift --months 3 --out/);
    assert.match(out, /fetched 2 events into .*calendar-events\.json; Obsidian will apply them/);
});

test("Obsidian won't open and the fetch is denied: it says why, and fails", () => {
    const { run } = setUp({ running: false, opens: false, fetches: false });
    assert.throws(() => run(), (e) => {
        assert.match(e.stdout, /didn't answer within 3s/);
        assert.match(e.stdout, /no calendar permission of its own/);
        assert.equal(e.status, 1);
        return true;
    });
});

test("on, off and status report the schedule, by the label in the plist", () => {
    const { run, forget, schedule } = setUp();
    assert.match(run("status").out, /Scheduled sync: off/);
    schedule();
    assert.match(run("on").calls, new RegExp(`launchctl bootstrap gui/\\d+ .*${LABEL}`));
    assert.match(run("on").out, /Scheduled sync: on — 7:15am, 12:15pm, 5:15pm, 9:15pm/);
    assert.match(run("status").out, /Scheduled sync: on/);
    assert.match(run("status").out, /Last run exited 1$/m, "launchctl's raw 256 reads as 1");
    assert.match(run("off").out, /Scheduled sync: off/);
    forget();
    assert.doesNotMatch(run("status").calls, /bootstrap|bootout/);
});

test("on without a plist says so and changes nothing", () => {
    const { run } = setUp();
    assert.throws(() => run("on"), (e) => {
        assert.match(e.stdout, /No schedule to turn on/);
        assert.doesNotMatch(e.stdout, /Scheduled sync: on/);
        return true;
    });
});

test("the sync always runs Plainday's command, whatever the vault's plugin list says (OBS-257)", () => {
    const { dir, run, forget } = setUp({ running: true });
    const plugins = path.join(dir, "vault", ".obsidian", "community-plugins.json");
    fs.mkdirSync(path.dirname(plugins), { recursive: true });
    for (const list of [["templater-obsidian", "plainday"], ["templater-obsidian", "customjs"]]) {
        forget();
        fs.writeFileSync(plugins, JSON.stringify(list, null, 2));
        const { out, calls } = run();
        assert.match(out, /Obsidian synced the calendar/);
        assert.match(calls, /^obsidian vault=vault command id=plainday:sync-calendars$/m, list.join(", "));
        assert.doesNotMatch(calls, /customjs/);
    }
});
