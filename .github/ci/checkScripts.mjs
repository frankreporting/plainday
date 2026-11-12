// CI: every script loads, and Plainday's command list names only classes that exist.
//
// - Each class file (Config/Scripts/CustomJS/*.js) is evaluated in a bare vm context and must
//   leave behind the class it declares. This catches a syntax error or a top-level reference
//   that would break a command at startup, even when no test covers that script.
// - Templater/*.js must parse (`node --check`).
// - The tracked .obsidian/*.json files, Templater's data.json and the other tracked JSON must
//   parse as JSON.
// - Every command and startup script in Plainday's command list (plugin/src/commands.js) names a
//   class one of the class files defines, and no two commands share an id or a name.
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
const PLAINDAY_COMMANDS = "plugin/src/commands.js";

export function classNameOf(source) {
    return /^class\s+([A-Za-z_$][\w$]*)/m.exec(source)?.[1] ?? null;
}

// Loads one class file's source in a fresh context; returns null when it defines its class, else
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

// The classes the class files declare, by name
export function classesIn(root = ".") {
    const dir = path.join(root, CUSTOMJS);
    return new Set(fs.readdirSync(dir).filter((f) => f.endsWith(".js"))
        .map((f) => classNameOf(fs.readFileSync(path.join(dir, f), "utf8"))).filter(Boolean));
}

export function checkAll(root = ".") {
    const problems = [];

    const customJSDir = path.join(root, CUSTOMJS);
    for (const f of fs.readdirSync(customJSDir).filter((f) => f.endsWith(".js")).sort()) {
        const source = fs.readFileSync(path.join(customJSDir, f), "utf8");
        const problem = loadCustomJS(source, `${CUSTOMJS}/${f}`);
        if (problem) problems.push(problem);
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
    for (const f of tracked) {
        try {
            JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
        } catch (e) {
            problems.push(`${f}: not valid JSON: ${e.message}`);
        }
    }

    return problems;
}

// Plainday's command list: each command and startup script names a class that exists
export async function checkPlainday(root = ".") {
    const file = path.resolve(root, PLAINDAY_COMMANDS);
    if (!fs.existsSync(file)) return [`${PLAINDAY_COMMANDS}: missing`];
    const { COMMANDS = [], STARTUP = [] } = await import(pathToFileURL(file).href);
    const classes = classesIn(root);
    const problems = [];
    for (const c of COMMANDS) {
        if (!classes.has(c.script)) problems.push(`${PLAINDAY_COMMANDS}: the command ${JSON.stringify(c.id)} runs ${c.script}, which no ${CUSTOMJS} file defines`);
    }
    for (const name of STARTUP) {
        if (!classes.has(name)) problems.push(`${PLAINDAY_COMMANDS}: STARTUP names ${name}, which no ${CUSTOMJS} file defines`);
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
    console.log("Scripts load, settings parse, and Plainday's commands and startup scripts name classes that exist.");
}
