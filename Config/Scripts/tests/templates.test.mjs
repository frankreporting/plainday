// Tests that every template the system names exists (OBS-255). Run from the vault root:
//   node --test "Config/Scripts/tests/*.test.mjs"
// A template another template includes by a wikilink, or one Templater's settings name, that isn't
// in Config/Templates/ shows only as Templater's "Template parsing error" when a note is made, so a
// renamed or dropped template could go unnoticed (Get Template's ¶ route called a [[Writing]] that
// was never there).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TEMPLATES = "Config/Templates";
const SETTINGS = ".obsidian/plugins/templater-obsidian/data.json";
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const templateFiles = fs.readdirSync(path.join(ROOT, TEMPLATES)).filter((f) => f.endsWith(".md"));

test("templates: every template a template includes by a wikilink is in Config/Templates", () => {
    const include = /tp\.file\.include\(\s*["'`]\[\[([^\]|#]+)/g;
    const missing = [];
    let found = 0;
    for (const file of templateFiles) {
        const text = fs.readFileSync(path.join(ROOT, TEMPLATES, file), "utf8");
        for (const [, name] of text.matchAll(include)) {
            found++;
            if (!exists(`${TEMPLATES}/${name.trim()}.md`)) missing.push(`${file} includes [[${name}]]`);
        }
    }
    assert.ok(found > 0, "no includes found: the pattern no longer matches how Get Template includes its templates");
    assert.deepEqual(missing, []);
});

test("templates: every template Templater's settings name exists, and so do its templates and scripts folders", () => {
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, SETTINGS), "utf8"));
    const named = [
        ...(settings.folder_templates ?? []).map((t) => ["folder_templates", t.template]),
        ...(settings.file_templates ?? []).map((t) => ["file_templates", t.template]),
        ...(settings.enabled_templates_hotkeys ?? []).map((t) => ["enabled_templates_hotkeys", t.template]),
        ...(settings.startup_templates ?? []).map((t) => ["startup_templates", t]),
    ].filter(([, t]) => t);
    const missing = named
        .filter(([, t]) => !exists(t.endsWith(".md") ? t : `${t}.md`))
        .map(([key, t]) => `${key}: ${t}`);
    assert.deepEqual(missing, []);
    assert.equal(settings.templates_folder, TEMPLATES);
    for (const key of ["templates_folder", "user_scripts_folder"]) {
        assert.ok(exists(settings[key]) && fs.statSync(path.join(ROOT, settings[key])).isDirectory(), `${key}: ${settings[key]} isn't a folder`);
    }
});
