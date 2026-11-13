// The shape every class file keeps, and how a class file is read outside the bundle (OBS-271).
//
// A class file is a module in plugin/src/commands/, startup/ or shared/ (each folder's index.js
// lists its classes, and isn't a class file):
//
//     import { MarkdownView, Notice } from "obsidian";
//     import { app, plainday } from "../host.js";
//
//     export default class ConvertToProject {
//         ...
//     }
//
// - Before the class: comments, blank lines and imports, one per line, each
//   `import { a, b } from "<module>";` or `import * as x from "<module>";`, from Obsidian, the host,
//   one of CodeMirror's three modules or ical.js (MODULES). No renaming, no default import but
//   ical.js's (`import ICAL from "ical.js";`, its only export, DEFAULT_IMPORTS; OBS-274), and no
//   import of another class file: the classes reach each other through the host's `plainday` at
//   run time, so there's no import cycle.
// - Then `export default class <Name>` at the left edge: the file's only export, and nothing else
//   at the top level.
//
// The build checks the shape of every class file it bundles (plugin/esbuild.config.mjs), and CI
// checks it too, with each file's folder and index (.github/ci/checkScripts.mjs).
//
// Outside the bundle, Node can't run the imports (Obsidian's package carries only types), so the
// tests, CI's check, the demo's render and the private tests read a class file through scriptOf():
// the script it is without its imports, which reads each imported name from the context's globals,
// where a test puts its stand-ins (`moment`, `Notice`, `app`, `plainday`). It needs no npm, except
// for a class that imports ical.js, whose test gives it the real one from node_modules.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.join(here, "src");
// The class files' folders, by what starts them: you run a command, a startup script starts with
// Plainday and acts on its own, and only other classes call a shared one
export const FOLDERS = ["commands", "startup", "shared"];
// ical.js reads calendar feeds (CalendarFeed, OBS-274). Unlike the others, it isn't Obsidian's: the
// build bundles it into main.js, with its license notice.
export const MODULES = ["obsidian", "../host.js", "@codemirror/view", "@codemirror/state", "@codemirror/language", "ical.js"];
// The modules whose only export is their default, so a class file imports them by a default import
export const DEFAULT_IMPORTS = ["ical.js"];

const NAME = /^[A-Za-z_$][\w$]*$/;
const NAMED = /^import \{([^}]*)\} from "([^"]+)";\s*$/;
const NAMESPACE = /^import \* as ([A-Za-z_$][\w$]*) from "([^"]+)";\s*$/;
const DEFAULT = /^import ([A-Za-z_$][\w$]*) from "([^"]+)";\s*$/;
const CLASS = /^export default class ([A-Za-z_$][\w$]*)(?=[\s{])/;

// One line before the class: what it imports, null for a comment or a blank line, or the problem
function importOf(line) {
    const t = line.trim();
    if (t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) return null;
    let m = NAMESPACE.exec(line);
    if (m) {
        if (!MODULES.includes(m[2])) return { problem: `imports from "${m[2]}": a class file imports only from ${MODULES.map((x) => `"${x}"`).join(", ")}` };
        return { names: [m[1]] };
    }
    m = DEFAULT.exec(line);
    if (m && DEFAULT_IMPORTS.includes(m[2])) return { names: [m[1]] };
    m = NAMED.exec(line);
    if (m) {
        if (!MODULES.includes(m[2])) return { problem: `imports from "${m[2]}": a class file imports only from ${MODULES.map((x) => `"${x}"`).join(", ")}` };
        const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
        const bad = names.find((n) => !NAME.test(n));
        if (bad) return { problem: `imports ${JSON.stringify(bad)}: no renaming, each name as it is` };
        if (!names.length) return { problem: "imports nothing" };
        return { names };
    }
    if (/^import\b/.test(t)) return { problem: `an import the loader can't read: one per line, \`import { a, b } from "<module>";\` or \`import * as x from "<module>";\`, no default import but ${DEFAULT_IMPORTS.map((x) => `"${x}"`).join(", ")}'s` };
    return { problem: "comes before the class: only comments, blank lines and imports may" };
}

// The parts of one class file: its imports and its class, or the problems with its shape, each
// naming the file and line
export function parse(file, source) {
    const lines = source.split("\n");
    const problems = [];
    const imports = [];
    const at = lines.findIndex((l) => CLASS.test(l));
    if (at < 0) return { problems: [`${file}: no \`export default class <Name>\` at the left edge`] };
    for (let i = 0; i < at; i++) {
        const got = importOf(lines[i]);
        if (!got) continue;
        if (got.problem) problems.push(`${file}:${i + 1} ${got.problem}: ${lines[i].trim()}`);
        else imports.push(...got.names.map((name) => ({ name, line: i + 1 })));
    }
    const seen = new Set();
    for (const { name, line } of imports) {
        if (seen.has(name)) problems.push(`${file}:${line} imports ${name} twice`);
        seen.add(name);
    }
    const name = CLASS.exec(lines[at])[1];
    // The class and what follows it must be one class expression, as the build's wrapper read the
    // whole file before OBS-271: anything else at the top level, a second export among it, fails to
    // parse that way
    const rest = lines.map((l, i) => (i < at ? "" : i === at ? l.replace(/^export default /, "") : l)).join("\n");
    try {
        new vm.Script(`(${rest}\n)`, { filename: file });
    } catch (e) {
        const line = /:(\d+)\n/.exec(String(e.stack))?.[1];
        problems.push(`${file}${line ? `:${line}` : ""} holds more than its class at the top level, or doesn't parse: ${e.message}`);
    }
    return { name, imports: imports.map((i) => i.name), problems };
}

// The problems with one class file's shape; none when it keeps it
export function shapeProblems(file, source) {
    return parse(file, source).problems;
}

// One class file as a script, for a vm context: each import line becomes a `var` that reads its
// names from the context's globals, on the same line, so line numbers stay, and `export default`
// goes. `var`, not `const`, so a context can load several class files that import the same names.
// It throws on a line it can't read, naming it. A file without `export default class` is given
// back as it is: a class file from before OBS-271 was already a script.
export function scriptOf(source, file = "class file") {
    const lines = source.split("\n");
    const at = lines.findIndex((l) => CLASS.test(l));
    if (at < 0) return source;
    return lines.map((line, i) => {
        if (i === at) return line.replace(/^export default /, "");
        if (i > at) {
            if (/^(import|export)\b/.test(line)) throw new Error(`${file}:${i + 1}: a line the loader can't read: ${line.trim()}`);
            return line;
        }
        const got = importOf(line);
        if (!got) return line;
        if (got.problem) throw new Error(`${file}:${i + 1}: a line the loader can't read (${got.problem}): ${line.trim()}`);
        return `var ${got.names.map((n) => `${n} = globalThis.${n}`).join(", ")};`;
    }).join("\n");
}

// The class files, as paths relative to plugin/src/ ("commands/schedule.js"), sorted
export function classFiles(src = SRC) {
    return FOLDERS.flatMap((folder) => {
        const dir = path.join(src, folder);
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "index.js").sort().map((f) => `${folder}/${f}`);
    });
}

// Where a class file is, by its file name ("schedule.js"), in whichever folder holds it
export function classPath(file, src = SRC) {
    const found = classFiles(src).filter((f) => path.basename(f) === file);
    if (found.length !== 1) throw new Error(`${file}: ${found.length ? `in ${found.length} folders` : "no class file has that name"} under ${src}`);
    return path.join(src, found[0]);
}

// A class file's source as it is, and as a script for a vm context, by its file name
export function classSource(file, src = SRC) {
    return fs.readFileSync(classPath(file, src), "utf8");
}
export function classScript(file, src = SRC) {
    return scriptOf(classSource(file, src), file);
}

// Loads a class into a vm context and returns the class: `load("schedule.js", context)`
export function loadClass(file, context, src = SRC) {
    const source = classSource(file, src);
    const { name } = parse(file, source);
    if (!name) throw new Error(`${file}: no \`export default class <Name>\``);
    return vm.runInContext(`${scriptOf(source, file)}\n;${name}`, context, { filename: file });
}

// One folder's index.js: the class files it imports, by class name, and what it exports. Read
// without running the classes: each import stands for its class's name, so `CLASSES` maps each
// name to itself, and the lists (COMMANDS, STARTUP) are what they say.
//
//     import Schedule from "./schedule.js";
//     export const CLASSES = { Schedule };
export function readIndex(folder, src = SRC) {
    const file = path.join(src, folder, "index.js");
    const rel = `${folder}/index.js`;
    if (!fs.existsSync(file)) return { file: rel, imports: {}, exports: {}, problems: [`${rel}: missing`] };
    const problems = [];
    const imports = {};
    const names = [];
    const body = fs.readFileSync(file, "utf8").split("\n").map((line, i) => {
        const m = /^import ([A-Za-z_$][\w$]*) from "\.\/([^"/]+\.js)";\s*$/.exec(line);
        if (m) {
            imports[m[1]] = m[2];
            return `var ${m[1]} = ${JSON.stringify(m[1])};`;
        }
        if (/^import\b/.test(line)) problems.push(`${rel}:${i + 1}: an index imports only its folder's class files, one per line: \`import <Name> from "./<file>.js";\``);
        const e = /^export const ([A-Za-z_$][\w$]*)\s*=/.exec(line);
        if (e) {
            names.push(e[1]);
            return line.replace(/^export const/, "var");
        }
        if (/^export\b/.test(line)) problems.push(`${rel}:${i + 1}: an index exports only \`export const\`s`);
        return line;
    }).join("\n");
    let exports = {};
    if (!problems.length) {
        try {
            // Plain data, brought out of the vm's context so it compares like any other
            exports = JSON.parse(JSON.stringify(vm.runInContext(`${body}\n;({ ${names.join(", ")} })`, vm.createContext({}), { filename: rel })));
        } catch (e) {
            problems.push(`${rel}: ${e.name}: ${e.message}`);
        }
    }
    return { file: rel, imports, exports, problems };
}
