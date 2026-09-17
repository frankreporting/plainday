// Tests for Templater/eventTimes.js. Run from the vault root:
//   node --test "00 Meta/02 Scripts/tests/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const eventTimes = createRequire(import.meta.url)("../Templater/eventTimes.js");

const DAY = [
    "---",
    "aliases: 9/9/26 Wednesday",
    "---",
    "- [<] 9:00am\tTeam standup",
    "\t- 10:15am",
    "- [<] 1:30pm\t[[2026-09-09 Intro call with Imogen Fenwick|Intro call with Imogen Fenwick]]   ",
    "\t- 1:40pm",
    "- [<] 10:00am\t[[2026-09-08 Usability session – Soren and Odile|Beta: Walkthrough]] [[Pinecone Studio|⭕]]",
    "\t- 10:00am - 10:40am: ran long",
    "- [<] All day\t[[2026-09-09 Offsite|Offsite]]",
    "- [>] Send handoff note [[2026-09-02 Launch retro - wrapup|🔗]]",
    "\t- 2:57pm - 3:15pm",
    "- [<] 5:00pm\t[[2026-09-09 Board call (Q3)|Board call]]",
    "- [x] Write",
].join("\n");

test("start from the event line, end from the calendar sync's line under it (OBS-6)", () => {
    assert.deepEqual(eventTimes(DAY, "2026-09-09 Intro call with Imogen Fenwick"), { time: "1:30pm", endTime: "1:40pm" });
});

test("an event line you've turned into a time entry: endTime is the entry's last time", () => {
    assert.deepEqual(eventTimes(DAY, "2026-09-08 Usability session – Soren and Odile"), { time: "10:00am", endTime: "10:40am" });
});

test("no end line: endTime is empty; regex characters in the name are literal", () => {
    assert.deepEqual(eventTimes(DAY, "2026-09-09 Board call (Q3)"), { time: "5:00pm", endTime: "" });
});

test("older daily notes: time, a space and a tab, no checkbox", () => {
    const old = "4:30pm \t[[2024-11-12 Chat with Tamsin Varga|Chat with Tamsin Varga]]\n7:00pm \t[[2024-11-12 Coffee chat|Coffee chat]]";
    assert.deepEqual(eventTimes(old, "2024-11-12 Chat with Tamsin Varga"), { time: "4:30pm", endTime: "" });
});

test("not an event: a task linking the log, an all-day event, a name that only starts the same, no note", () => {
    assert.equal(eventTimes(DAY, "2026-09-02 Launch retro - wrapup"), null);
    assert.equal(eventTimes(DAY, "2026-09-09 Offsite"), null);
    assert.equal(eventTimes(DAY, "2026-09-09 Intro call"), null);
    assert.equal(eventTimes(null, "2026-09-09 Intro call with Imogen Fenwick"), null);
});
