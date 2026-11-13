// Builds Plainday: the plugin's code in plugin/src/, bundled into one main.js at the repository
// root. The entry is plugin/src/main.js, which imports the three folders' indexes (commands/,
// startup/, shared/), each importing its class files.
//
// Each class file is a module of one shape (plugin/classShape.mjs): its imports, then
// `export default class <Name>`, and nothing else. The build checks that shape in every class file
// it bundles, and stops on a file without it, naming the line.
//
// ical.js, which reads calendar feeds (plugin/src/shared/calendarFeed.js), is bundled in, under the
// Mozilla Public License 2.0. Its notice doesn't survive bundling by itself, so the build puts one
// at the top of main.js, naming where its source is (notices()).
//
// The class files are written for Plainday alone (OBS-257). A line that still reaches for the
// CustomJS plugin, by its id or one of its command ids, or for its global or its `customJS` name,
// would do nothing here, so it stops the build, which names the line (LEFT below).
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
import { FOLDERS, shapeProblems } from "./classShape.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const SRC = path.join(here, "src");
export const OUTFILE = path.join(ROOT, "main.js");
// What Plainday ships beside main.js; styles.css only once there is one
const RELEASE = ["manifest.json", "styles.css"];
// The notices for what the build bundles from node_modules, at the top of main.js: the package as
// installed, its license, and where its source is, as the MPL asks of a copy in another form
export function notices(root = ROOT) {
    const ical = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "ical.js", "package.json"), "utf8"));
    return `/*! Plainday bundles ical.js ${ical.version} (https://github.com/kewisch/ical.js), whose source is`
        + " there, under the Mozilla Public License, v. 2.0 (https://mozilla.org/MPL/2.0/)."
        + " Portions Copyright (C) Philipp Kewisch. */";
}

// What no line in a class file may say: the CustomJS plugin by its id, one of its command ids, its
// global, or `customJS` at all, which Plainday calls `plainday` (OBS-271)
const LEFT = [
    /["'`]customjs["'`]/,
    /\bcustomjs:/,
    /\.\s*customjs\b/,
    /\bcustomJS\b/,
];
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
            problems.push(`${file}:${i + 1} reaches for CustomJS: ${line.trim()}. Plainday doesn't run CustomJS: the plugin is \`plainday.plugin\`,`
                + " and the classes are on `plainday` (plugin/src/host.js).");
        }
    });
    return problems;
}

// A class file is a .js file in one of the three folders, other than its index
function isClassFile(src, file) {
    const rel = path.relative(src, file);
    const parts = rel.split(path.sep);
    return parts.length === 2 && FOLDERS.includes(parts[0]) && parts[1].endsWith(".js") && parts[1] !== "index.js";
}

// The CustomJS check and the shape check on every class file, which the build otherwise reads as it is
function classesPlugin(dir) {
    // esbuild gives each file's real path, so a folder reached through a link (macOS's temporary
    // folder is one) is compared by its real path too
    const src = fs.realpathSync(dir);
    return {
        name: "plainday-classes",
        setup(build) {
            build.onLoad({ filter: /\.js$/ }, async (args) => {
                if (!isClassFile(src, args.path)) return undefined;
                const file = path.relative(src, args.path).split(path.sep).join("/");
                const text = await fs.promises.readFile(args.path, "utf8");
                const problems = [...check(file, text), ...shapeProblems(file, text)];
                if (problems.length) return { errors: problems.map((p) => ({ text: p })), watchFiles: [args.path] };
                return { contents: text, loader: "js" };
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

// `src`: the folder to build from, plugin/src/ unless a test builds a copy
export function options({ src = SRC, outfile = OUTFILE, watch = false, logLevel = "info" } = {}) {
    return {
        entryPoints: [path.join(src, "main.js")],
        // esbuild names each file in main.js in a comment, relative to this folder: the repository's
        // root, wherever the build starts, so a build anywhere matches the release (OBS-230)
        absWorkingDir: ROOT,
        // ical.js comes from the repository's node_modules, also for a copy of plugin/src/ built
        // elsewhere (the bundle tests build one in a temporary folder)
        nodePaths: [path.join(ROOT, "node_modules")],
        bundle: true,
        format: "cjs",
        platform: "browser",
        target: "es2022",
        outfile,
        // Obsidian's plugin loader provides these, as for every plugin. The class files import
        // Obsidian's module and CodeMirror's, and `require` a few of Node's modules, on the desktop
        // only, inside their functions.
        external: [
            "obsidian", "electron", "@codemirror/view", "@codemirror/state", "@codemirror/language",
            ...builtinModules, ...builtinModules.map((m) => `node:${m}`),
        ],
        // A class's own name shows in its errors, and the bundle test checks every class keeps it
        keepNames: true,
        banner: { js: notices() },
        sourcemap: watch ? "inline" : false,
        logLevel,
        plugins: [classesPlugin(src), copyOut(outfile)],
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
