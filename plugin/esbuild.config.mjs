// Builds Plainday: the class files in Config/Scripts/CustomJS/, unchanged on disk, bundled with
// the host into one main.js at the repository root.
//
// Each class file is one class, written the way CustomJS evals it: `(${file})`. The build wraps
// each one, on one line so the class keeps its own line numbers, give or take the first:
//
//     import { customJS, app, … } from "<plugin/src/host.js>"; export default (<the file>
//     );
//
// so the class reads `customJS` and `app` from the host instead of from globals. The virtual
// module `plainday:classes` exports every class, in file-name order.
//
// The class files still run under CustomJS in a vault that hasn't moved to Plainday, so the few
// lines that only work under CustomJS are rewritten here, in the bundle's copy, and nowhere else
// (REWRITES below). The build fails when a rewrite doesn't find its line as often as it expects,
// or when a line still reaches for CustomJS's plugin or its global: a class merged later with a
// new hook stops the build and names the line, instead of shipping a command that does nothing.
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
export const CLASSES = path.join(ROOT, "Config/Scripts/CustomJS");
export const OUTFILE = path.join(ROOT, "main.js");
const HOST = path.join(here, "src/host.js");
const ENTRY = path.join(here, "src/main.js");
// What Plainday ships beside main.js; styles.css only once there is one
const RELEASE = ["manifest.json", "styles.css"];

// The lines that work only under CustomJS, how many times each class file has them, and what the
// bundle gets instead. `from` is matched exactly.
export const REWRITES = [
    {
        // "Is CustomJS still on?" The listeners outlive CustomJS being switched off, so each one
        // checks before it acts. Here: is Plainday still loaded?
        from: 'app.plugins.enabledPlugins.has("customjs")',
        to: "plainday$loaded()",
        files: { "moveToProjectMenu.js": 1, "newNoteGuard.js": 2, "refoldOnOpen.js": 1, "syncArea.js": 1, "timeReportOnStartup.js": 1 },
    },
    {
        // An editor extension added through CustomJS. Here: Plainday's own, which Obsidian takes
        // away when the plugin unloads.
        from: "app.plugins.plugins.customjs.registerEditorExtension(",
        to: "plainday$registerEditorExtension(",
        files: { "checkOff.js": 1, "listCursor.js": 1, "trailingLinks.js": 1 },
    },
    {
        // The global, read this way so Raycast can load timeReport.js on its own, where there is no
        // customJS. Plainday sets no `customJS` global, so here it's the bundle's own.
        from: "globalThis.customJS",
        to: "customJS",
        files: { "addTaskNote.js": 3, "calendarSync.js": 1, "taskIds.js": 1, "timeReport.js": 9, "timeReportOnStartup.js": 1 },
    },
    {
        // UpdateObsidianPM's offer to reload CustomJS after an update. Under Plainday the copied
        // class files don't run (the bundle does), and turning CustomJS back on would show every
        // command twice, so the offer is left out.
        from: [
            '        if (!copied.some((p) => p.startsWith("Config/Scripts/CustomJS/") || p.endsWith("customjs/data.json"))) return;',
            "        if (await this.confirmReload()) {",
            '            await app.plugins.disablePlugin("customjs");',
            '            await app.plugins.enablePlugin("customjs");',
            '            new Notice("CustomJS reloaded");',
            "        }",
        ].join("\n"),
        to: "        return;",
        files: { "updateObsidianPM.js": 1 },
    },
];

// What no line may still say once the rewrites are done: CustomJS's plugin by its id, one of its
// command ids, or the customJS global
const LEFT = [
    /["'`]customjs["'`]/,
    /\bcustomjs:/,
    /\.\s*customjs\b/,
    /\b(?:globalThis|window|self)\s*(?:\?\.|\.)\s*customJS\b/,
    /\b(?:globalThis|window|self)\s*\[\s*["'`]customJS["'`]\s*\]/,
];

const classFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort((a, b) => a.localeCompare(b));
const newlines = (s) => s.split("\n").length - 1;
// A line without its comment: good enough to keep comments that mention CustomJS out of the check
const code = (line) => {
    const t = line.trimStart();
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) return "";
    return line.replace(/(^|[\s;,{}()])\/\/.*$/, "$1");
};
const lineNumbers = (text, needle) => {
    const out = [];
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) out.push(newlines(text.slice(0, at)) + 1);
    return out;
};
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

// The bundle's copy of one class file, or the reasons it can't be built
export function rewrite(file, source, rewrites = REWRITES) {
    let text = source;
    const problems = [];
    for (const r of rewrites) {
        const want = r.files[file] ?? 0;
        const at = lineNumbers(text, r.from);
        const first = r.from.split("\n")[0].trim();
        if (at.length !== want) {
            problems.push(`${file} has \`${first}\` ${at.length ? `${times(at.length)} (line ${at.join(", ")})` : "nowhere"}, where the build expects it ${want ? times(want) : "nowhere"}.`
                + " If Plainday should treat it the same way, change its count in REWRITES (plugin/esbuild.config.mjs); otherwise add a rewrite for it there.");
            continue;
        }
        // Pad a shorter replacement with blank lines, so the lines after it keep their numbers
        if (want) text = text.split(r.from).join(r.to + "\n".repeat(Math.max(0, newlines(r.from) - newlines(r.to))));
    }
    text.split("\n").forEach((line, i) => {
        if (LEFT.some((p) => p.test(code(line)))) {
            problems.push(`${file}:${i + 1} still reaches for CustomJS: ${line.trim()}. Add a rewrite for it to REWRITES (plugin/esbuild.config.mjs).`);
        }
    });
    return { text, problems };
}

// The plugin that turns each class file into a module, and lists them all in `plainday:classes`
function classesPlugin(dir, rewrites) {
    return {
        name: "plainday-classes",
        setup(build) {
            build.onResolve({ filter: /^plainday:classes$/ }, () => ({ path: "classes", namespace: "plainday" }));
            build.onResolve({ filter: /^plainday:class\// }, (args) => ({ path: path.join(dir, args.path.slice("plainday:class/".length)), namespace: "plainday-class" }));
            build.onLoad({ filter: /.*/, namespace: "plainday" }, () => {
                const files = classFiles(dir);
                const missing = rewrites.flatMap((r) => Object.keys(r.files).filter((f) => !files.includes(f)).map((f) => `${f}: REWRITES names it, but there's no such class file`));
                if (missing.length) return { errors: missing.map((text) => ({ text })) };
                const lines = files.map((f, i) => `import c${i} from ${JSON.stringify(`plainday:class/${f}`)};`);
                lines.push(`export default [${files.map((_, i) => `c${i}`).join(", ")}];`);
                return { contents: lines.join("\n"), loader: "js", resolveDir: here, watchDirs: [dir] };
            });
            build.onLoad({ filter: /.*/, namespace: "plainday-class" }, async (args) => {
                const file = path.basename(args.path);
                const { text, problems } = rewrite(file, await fs.promises.readFile(args.path, "utf8"), rewrites);
                if (problems.length) return { errors: problems.map((p) => ({ text: p })), watchFiles: [args.path] };
                const host = "import { customJS, app, loaded as plainday$loaded, registerEditorExtension as plainday$registerEditorExtension }";
                return { contents: `${host} from ${JSON.stringify(HOST)}; export default (${text}\n);\n`, loader: "js", resolveDir: dir, watchFiles: [args.path] };
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

export function options({ classes = CLASSES, outfile = OUTFILE, rewrites = REWRITES, watch = false, logLevel = "info" } = {}) {
    return {
        entryPoints: [ENTRY],
        bundle: true,
        format: "cjs",
        platform: "browser",
        target: "es2022",
        outfile,
        // Obsidian's plugin loader provides these, as for every plugin. The class files `require`
        // CodeMirror and, on the desktop only, a few of Node's modules, inside their functions.
        external: [
            "obsidian", "electron", "@codemirror/view", "@codemirror/state", "@codemirror/language",
            ...builtinModules, ...builtinModules.map((m) => `node:${m}`),
        ],
        // The host keeps every class by name (customJS.Schedule), so names must survive
        keepNames: true,
        sourcemap: watch ? "inline" : false,
        logLevel,
        plugins: [classesPlugin(classes, rewrites), copyOut(outfile)],
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
