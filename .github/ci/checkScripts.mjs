// CI: every script loads, and the settings that name them agree with them.
//
// - Each CustomJS/*.js is evaluated in a bare vm context, the way CustomJS does it, and must
//   leave behind the class it declares. This catches a syntax error or a top-level reference
//   that would break a command at startup, even when no test covers that script.
// - Every name in customjs/data.json (startup and invocable scripts) must be a class one of
//   those files defines.
// - Templater/*.js must parse (`node --check`).
// - The tracked .obsidian/*.json files, the plugin data.json files and the other tracked JSON
//   must parse as JSON.
// - Plainday's command list (plugin/src/commands.js) and customjs/data.json name the same
//   classes, apart from the commands only CustomJS has, and the same startup scripts in the same
//   order (OBS-226): until every vault has moved to Plainday, both run the same classes.
//
// Run from the repo root: node .github/ci/checkScripts.mjs
// Exits 1 with one line per problem.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SCRIPTS = "Config/Scripts";
const CUSTOMJS = `${SCRIPTS}/CustomJS`;
const TEMPLATER = `${SCRIPTS}/Templater`;
const CUSTOMJS_SETTINGS = ".obsidian/plugins/customjs/data.json";
const PLAINDAY_COMMANDS = "plugin/src/commands.js";

export function classNameOf(source) {
    return /^class\s+([A-Za-z_$][\w$]*)/m.exec(source)?.[1] ?? null;
}

// Loads one CustomJS source in a fresh context; returns null when it defines its class, else
// the problem.
export function loadCustomJS(source, file) {
    const name = classNameOf(source);
    if (!name) return `${file}: no top-level class declaration`;
    try {
        const cls = vm.runInContext(`${source}\n;${name}`, vm.createContext({}), { filename: file });
        if (typeof cls !== "function") return `${file}: evaluating it doesn't yield class ${name}`;
    } catch (e) {
        return `${file}: ${e.name}: ${e.message}`;
    }
    return null;
}

export function checkAll(root = ".") {
    const problems = [];
    const classes = new Set();

    const customJSDir = path.join(root, CUSTOMJS);
    for (const f of fs.readdirSync(customJSDir).filter((f) => f.endsWith(".js")).sort()) {
        const source = fs.readFileSync(path.join(customJSDir, f), "utf8");
        const problem = loadCustomJS(source, `${CUSTOMJS}/${f}`);
        if (problem) problems.push(problem);
        else classes.add(classNameOf(source));
    }

    const templaterDir = path.join(root, TEMPLATER);
    for (const f of fs.readdirSync(templaterDir).filter((f) => f.endsWith(".js")).sort()) {
        const r = spawnSync(process.execPath, ["--check", path.join(templaterDir, f)], { encoding: "utf8" });
        if (r.status !== 0) {
            const lines = r.stderr.trim().split("\n");
            problems.push(`${TEMPLATER}/${f}: ${lines.find((l) => /Error/.test(l)) ?? lines[0]}`);
        }
    }

    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).stdout
        .split("\0").filter((f) => f.endsWith(".json"));
    const settings = {};
    for (const f of tracked) {
        try {
            settings[f] = JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
        } catch (e) {
            problems.push(`${f}: not valid JSON: ${e.message}`);
        }
    }

    const customJSSettings = settings[CUSTOMJS_SETTINGS];
    if (!customJSSettings) {
        problems.push(`${CUSTOMJS_SETTINGS}: missing or unreadable`);
    } else {
        for (const key of ["startupScriptNames", "registeredInvocableScriptNames"]) {
            for (const name of customJSSettings[key] ?? []) {
                if (!classes.has(name)) problems.push(`${CUSTOMJS_SETTINGS}: ${key} names ${name}, which no ${CUSTOMJS} file defines`);
            }
        }
        const folder = customJSSettings.jsFolder?.replace(/\/$/, "");
        if (folder !== CUSTOMJS) problems.push(`${CUSTOMJS_SETTINGS}: jsFolder is ${JSON.stringify(customJSSettings.jsFolder)}, not ${CUSTOMJS}/`);
    }

    return problems;
}

// Plainday's command list against CustomJS's settings
export async function checkPlainday(root = ".") {
    const file = path.resolve(root, PLAINDAY_COMMANDS);
    if (!fs.existsSync(file)) return [`${PLAINDAY_COMMANDS}: missing`];
    const { COMMANDS = [], STARTUP = [], CUSTOMJS_ONLY = [] } = await import(pathToFileURL(file).href);
    let settings;
    try {
        settings = JSON.parse(fs.readFileSync(path.join(root, CUSTOMJS_SETTINGS), "utf8"));
    } catch {
        return [`${CUSTOMJS_SETTINGS}: missing or unreadable`];
    }
    const problems = [];
    const theirs = settings.registeredInvocableScriptNames ?? [];
    const ours = COMMANDS.map((c) => c.script);
    for (const name of theirs) {
        if (!ours.includes(name) && !CUSTOMJS_ONLY.includes(name)) problems.push(`${CUSTOMJS_SETTINGS} has a command for ${name}, and ${PLAINDAY_COMMANDS} doesn't: add it to COMMANDS, or to CUSTOMJS_ONLY`);
    }
    for (const name of ours) {
        if (!theirs.includes(name)) problems.push(`${PLAINDAY_COMMANDS} has a command for ${name}, and ${CUSTOMJS_SETTINGS} doesn't: add it to registeredInvocableScriptNames there`);
    }
    for (const name of CUSTOMJS_ONLY) {
        if (ours.includes(name)) problems.push(`${PLAINDAY_COMMANDS}: ${name} is in both COMMANDS and CUSTOMJS_ONLY`);
        else if (!theirs.includes(name)) problems.push(`${PLAINDAY_COMMANDS}: CUSTOMJS_ONLY names ${name}, which isn't a command in ${CUSTOMJS_SETTINGS}`);
    }
    const startup = settings.startupScriptNames ?? [];
    if (JSON.stringify(STARTUP) !== JSON.stringify(startup)) {
        problems.push(`${PLAINDAY_COMMANDS}: STARTUP is ${STARTUP.join(", ")}, and ${CUSTOMJS_SETTINGS} runs ${startup.join(", ")}: they must be the same, in the same order`);
    }
    for (const key of ["id", "name"]) {
        const seen = new Set();
        for (const c of COMMANDS) {
            if (seen.has(c[key])) problems.push(`${PLAINDAY_COMMANDS}: two commands have the ${key} ${JSON.stringify(c[key])}`);
            seen.add(c[key]);
        }
    }
    return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const problems = [...checkAll(), ...(await checkPlainday())];
    for (const p of problems) console.log(`::error::${p}`);
    if (problems.length) process.exit(1);
    console.log("Scripts load, settings parse and name only classes that exist, and Plainday's commands match CustomJS's.");
}
