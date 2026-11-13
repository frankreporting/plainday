// Builds Plainday: the class files in plugin/src/classes/, as they are on disk, bundled with the
// host into one main.js at the repository root. Every .js file in that folder is a class file, so
// Plainday's own modules (main.js, host.js, commands.js) sit beside it, in plugin/src/.
//
// Each class file is one class, a single expression: `(${file})` evaluates to it. The build wraps
// each one, on one line so the class keeps its own line numbers, give or take the first:
//
//     import { customJS, app } from "<plugin/src/host.js>"; export default (<the file>
//     );
//
// so the class reads `customJS` and `app` from the host instead of from globals. The virtual
// module `plainday:classes` exports every class, in file-name order.
//
// The class files are written for Plainday alone (OBS-257). A line that still reaches for the
// CustomJS plugin, by its id or one of its command ids, or for its global, would do nothing here,
// so it stops the build, which names the line (LEFT below).
//
//   npm run build                         main.js at the repository root
//   npm run dev                           the same, rebuilt on every change
//   PLAINDAY_OUT=<folder> npm run build   also copies main.js and manifest.json into <folder>,
//                                         such as a test vault's .obsidian/plugins/plainday/
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const CLASSES = path.join(here, "src/classes");
export const OUTFILE = path.join(ROOT, "main.js");
const HOST = path.join(here, "src/host.js");
const ENTRY = path.join(here, "src/main.js");
// What Plainday ships beside main.js; styles.css only once there is one
const RELEASE = ["manifest.json", "styles.css"];

// What no line in a class file may say: the CustomJS plugin by its id, one of its command ids, or
// its global. Plainday's own are `customJS.plugin` and the host's `customJS`.
const LEFT = [
    /["'`]customjs["'`]/,
    /\bcustomjs:/,
    /\.\s*customjs\b/,
    /\b(?:globalThis|window|self)\s*(?:\?\.|\.)\s*customJS\b/,
    /\b(?:globalThis|window|self)\s*\[\s*["'`]customJS["'`]\s*\]/,
];

const classFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort((a, b) => a.localeCompare(b));
// A line without its comment: good enough to keep comments that mention CustomJS out of the check
const code = (line) => {
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) return "";
    return line.replace(/(^|[\s;,{}()])\/\/.*$/, "$1");
};
// The lines of one class file that reach for CustomJS, as problems that stop the build
export function check(file, source) {
    const problems = [];
    source.split("\n").forEach((line, i) => {
        if (LEFT.some((p) => p.test(code(line)))) {
            problems.push(`${file}:${i + 1} reaches for CustomJS: ${line.trim()}. Plainday doesn't run CustomJS: the plugin is \`customJS.plugin\`,`
                + " and the classes are on `customJS` (plugin/src/host.js).");
        }
    });
    return problems;
}

// The plugin that turns each class file into a module, and lists them all in `plainday:classes`
function classesPlugin(dir) {
    return {
        name: "plainday-classes",
        setup(build) {
            build.onResolve({ filter: /^plainday:classes$/ }, () => ({ path: "classes", namespace: "plainday" }));
            // By file name, not the absolute path: esbuild writes the path into main.js as a comment, and
            // the community directory rebuilds the release in its own folder to compare (OBS-230)
            build.onResolve({ filter: /^plainday:class\// }, (args) => ({ path: args.path.slice("plainday:class/".length), namespace: "plainday-class" }));
            build.onLoad({ filter: /.*/, namespace: "plainday" }, () => {
                const files = classFiles(dir);
                const lines = files.map((f, i) => `import c${i} from ${JSON.stringify(`plainday:class/${f}`)};`);
                lines.push(`export default [${files.map((_, i) => `c${i}`).join(", ")}];`);
                return { contents: lines.join("\n"), loader: "js", resolveDir: here, watchDirs: [dir] };
            });
            build.onLoad({ filter: /.*/, namespace: "plainday-class" }, async (args) => {
                const file = args.path;
                const abs = path.join(dir, file);
                const text = await fs.promises.readFile(abs, "utf8");
                const problems = check(file, text);
                if (problems.length) return { errors: problems.map((p) => ({ text: p })), watchFiles: [abs] };
                return { contents: `import { customJS, app } from ${JSON.stringify(HOST)}; export default (${text}\n);\n`, loader: "js", resolveDir: dir, watchFiles: [abs] };
            });
        },
    };
}

function copyOut(outfile) {
    return {
        name: "plainday-copy-out",
        setup(build) {
            build.onEnd((result) => {
                const out = process.env.PLAINDAY_OUT;
                if (!out || result.errors.length) return;
                fs.mkdirSync(out, { recursive: true });
                fs.copyFileSync(outfile, path.join(out, "main.js"));
                for (const f of RELEASE) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(out, f));
                console.log(`plainday: copied main.js and ${RELEASE.filter((f) => fs.existsSync(path.join(ROOT, f))).join(" and ")} to ${out}`);
            });
        },
    };
}

export function options({ classes = CLASSES, outfile = OUTFILE, watch = false, logLevel = "info" } = {}) {
    return {
        entryPoints: [ENTRY],
        bundle: true,
        format: "cjs",
        platform: "browser",
        target: "es2022",
        outfile,
        // Obsidian's plugin loader provides these, as for every plugin. The host imports Obsidian's
        // module and CodeMirror's; the class files `require` a few of Node's modules, on the
        // desktop only, inside their functions.
        external: [
            "obsidian", "electron", "@codemirror/view", "@codemirror/state", "@codemirror/language",
            ...builtinModules, ...builtinModules.map((m) => `node:${m}`),
        ],
        // The host keeps every class by name (customJS.Schedule), so names must survive
        keepNames: true,
        sourcemap: watch ? "inline" : false,
        logLevel,
        plugins: [classesPlugin(classes), copyOut(outfile)],
    };
}

export async function build(opts = {}) {
    return esbuild.build(options(opts));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.includes("--watch")) {
        const ctx = await esbuild.context(options({ watch: true }));
        await ctx.watch();
    } else {
        try {
            await build();
        } catch {
            // esbuild has printed the errors
            process.exit(1);
        }
    }
}
