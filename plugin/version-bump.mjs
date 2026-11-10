// npm's `version` step: `npm version 0.0.2 --no-git-tag-version`, run in a worktree, raises the
// version in package.json and its lockfile, then runs this, which raises it in manifest.json and
// adds it to versions.json with the oldest Obsidian it runs on (the manifest's minAppVersion).
// Obsidian reads versions.json to offer an older release to someone on an older Obsidian.
//
// No tag: the release workflow (.github/workflows/release.yml) tags the merge commit. CLAUDE.md
// ("Releases") has the steps.
import fs from "node:fs";

const version = process.env.npm_package_version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    console.error(`plainday: a release's version is three numbers, such as 0.0.2, not "${version}"`);
    process.exit(1);
}

const write = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
manifest.version = version;
write("manifest.json", manifest);

const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
write("versions.json", versions);
