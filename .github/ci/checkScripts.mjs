// CI: every script loads, each class file keeps its shape in the right folder, and Plainday's
// command list names only classes that exist.
//
// - Each class file (plugin/src/commands/, startup/ and shared/, each folder's index.js aside)
//   keeps the shape plugin/classShape.mjs describes, and, read as a script the way the tests read
//   it, evaluates in a bare vm context to the class it declares. This catches a syntax error, or a
//   class that needs something only Obsidian or another class gives while its module loads, which
//   would break Plainday at startup, even when no test covers that script.
// - Templater/*.js must parse (`node --check`).
// - The tracked .obsidian/*.json files, Templater's data.json and the other tracked JSON must
//   parse as JSON.
// - Each class file sits in the folder its kind says, and its folder's index lists it: commands/
//   holds exactly the classes the command list (commands/index.js) names, startup/ the ones STARTUP
//   (startup/index.js) names, and shared/ the rest. No two commands share an id or a name.
//
// Run from the repo root: node .github/ci/checkScripts.mjs
// Exits 1 with one line per problem. Plain Node: it reads the indexes without running the classes,
// which import Obsidian's module.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { classFiles, FOLDERS, parse, readIndex, scriptOf } from "../../plugin/classShape.mjs";

const SCRIPTS = "Config/Scripts";
const SRC = "plugin/src";
const TEMPLATER = `${SCRIPTS}/Templater`;

// One class file's shape, and its class loaded in a fresh context; the problems, none when it's
// fine
export function loadClass(source, file) {
    const { name, problems } = parse(file, source);
    if (!name || problems.length) return problems;
    try {
        const cls = vm.runInContext(`${scriptOf(source, file)}\n;${name}`, vm.createContext({}), { filename: file });
        if (typeof cls !== "function") return [`${file}: evaluating it doesn't yield class ${name}`];
    } catch (e) {
        return [`${file}: ${e.name}: ${e.message}`];
    }
    return [];
}

export function checkAll(root = ".") {
    const problems = [];

    const src = path.join(root, SRC);
    for (const f of classFiles(src)) {
        problems.push(...loadClass(fs.readFileSync(path.join(src, f), "utf8"), `${SRC}/${f}`));
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

// The folders, their indexes and the command list: each class file in the folder its kind says,
// listed in its folder's index, and each command and startup script naming a class there
export async function checkPlainday(root = ".") {
    const src = path.join(root, SRC);
    const problems = [];
    const index = Object.fromEntries(FOLDERS.map((folder) => [folder, readIndex(folder, src)]));
    for (const { problems: p } of Object.values(index)) problems.push(...p.map((x) => `${SRC}/${x}`));
    if (problems.length) return problems;

    // The class each file declares, by its path ("commands/schedule.js")
    const declared = new Map(classFiles(src).map((f) => [f, parse(f, fs.readFileSync(path.join(src, f), "utf8")).name]));
    const where = new Map();
    for (const [f, name] of declared) {
        if (!name) continue;
        if (where.has(name)) problems.push(`${SRC}/${f}: ${name} is declared in ${SRC}/${where.get(name)} too`);
        else where.set(name, f);
    }

    for (const folder of FOLDERS) {
        const { file, imports, exports } = index[folder];
        const listed = new Set(Object.keys(exports.CLASSES ?? {}));
        if (!exports.CLASSES) problems.push(`${SRC}/${file}: exports no CLASSES`);
        for (const [f, name] of declared) {
            if (!f.startsWith(`${folder}/`)) continue;
            const own = path.basename(f);
            const as = Object.keys(imports).find((n) => imports[n] === own);
            if (!as) problems.push(`${SRC}/${f}: ${file} doesn't import it`);
            else if (as !== name) problems.push(`${SRC}/${file}: imports ./${own} as ${as}, but it declares ${name}`);
            else if (!listed.has(name)) problems.push(`${SRC}/${file}: ${name} isn't in its CLASSES`);
        }
        for (const [as, own] of Object.entries(imports)) {
            if (!declared.has(`${folder}/${own}`)) problems.push(`${SRC}/${file}: imports ./${own} as ${as}, which isn't a class file in ${folder}/`);
        }
        for (const name of listed) {
            if (!imports[name]) problems.push(`${SRC}/${file}: CLASSES names ${name}, which it doesn't import`);
        }
    }

    const { COMMANDS = [] } = index.commands.exports;
    const { STARTUP = [] } = index.startup.exports;
    const commandFile = `${SRC}/${index.commands.file}`;
    const startupFile = `${SRC}/${index.startup.file}`;
    const run = new Set(COMMANDS.map((c) => c.script));
    const started = new Set(STARTUP);
    for (const c of COMMANDS) {
        if (!where.has(c.script)) problems.push(`${commandFile}: the command ${JSON.stringify(c.id)} runs ${c.script}, which no class file declares`);
    }
    for (const name of STARTUP) {
        if (!where.has(name)) problems.push(`${startupFile}: STARTUP names ${name}, which no class file declares`);
    }
    for (const [name, f] of where) {
        const folder = f.split("/")[0];
        if (run.has(name) && started.has(name)) {
            problems.push(`${SRC}/${f}: ${name} is both a command and a startup script; a class is one or the other`);
            continue;
        }
        const kind = run.has(name) ? "commands" : started.has(name) ? "startup" : "shared";
        if (folder === kind) continue;
        const why = { commands: "a command runs it", startup: "STARTUP runs it", shared: "no command or startup script runs it" }[kind];
        problems.push(`${SRC}/${f}: ${why}, so ${name} belongs in ${kind}/`);
    }
    for (const key of ["id", "name"]) {
        const seen = new Set();
        for (const c of COMMANDS) {
            if (seen.has(c[key])) problems.push(`${commandFile}: two commands have the ${key} ${JSON.stringify(c[key])}`);
            seen.add(c[key]);
        }
    }
    return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const problems = [...checkAll(), ...(await checkPlainday())];
    for (const p of problems) console.log(`::error::${p}`);
    if (problems.length) process.exit(1);
    console.log("Scripts load, class files keep their shape in the right folders, settings parse, and Plainday's commands and startup scripts name classes that exist.");
}
