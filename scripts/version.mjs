#!/usr/bin/env node
// The app version lives in build/config.yml (info.version). These files carry copies of it:
// keep them in step with `node scripts/version.mjs set 1.2.3`, check with `... check`.
//
//   node scripts/version.mjs          print the version (fails if the copies disagree)
//   node scripts/version.mjs check    the same, but only says whether they agree
//   node scripts/version.mjs set X    write X everywhere
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// plain x.y.z: Windows only takes numbers in an exe's version resource
const SEMVER = /^\d+\.\d+\.\d+$/;

// file, the pattern whose first group is the version, and how many times it must appear
const COPIES = [
  ['build/config.yml', /^ {2}version: "([^"]+)"$/m, 1],
  ['build/windows/info.json', /"(?:file_version|product_version|FileVersion|ProductVersion)": "([^"]+)"/g, 4],
  ['build/linux/nfpm/nfpm.yaml', /^version: "([^"]+)"$/m, 1],
  ['internal/app/app.go', /^var Version = "([^"]+)"$/m, 1],
  ['frontend/package.json', /^ {2}"version": "([^"]+)"/m, 1],
  // the lock file has the project's own version twice: at the top and under packages[""]
  ['frontend/package-lock.json', /^ {2}"name": "[^"]+",\n {2}"version": "([^"]+)"|^ {4}"": \{\n {6}"name": "[^"]+",\n {6}"version": "([^"]+)"/gm, 2],
];

function read(file) {
  return readFileSync(join(root, file), 'utf8');
}

function found(file, re) {
  const text = read(file);
  const out = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of text.matchAll(g)) out.push(m[1] ?? m[2]);
  return out;
}

function check() {
  const problems = [];
  const main = found(COPIES[0][0], COPIES[0][1])[0];
  if (!main || !SEMVER.test(main)) problems.push(`build/config.yml: no usable info.version (${main})`);
  for (const [file, re, count] of COPIES) {
    const vs = found(file, re);
    if (vs.length !== count) problems.push(`${file}: expected ${count} version field(s), found ${vs.length}`);
    for (const v of vs) if (v !== main) problems.push(`${file}: ${v}, but build/config.yml says ${main}`);
  }
  return { main, problems };
}

function set(version) {
  if (!SEMVER.test(version)) {
    console.error(`"${version}" isn't a version like 1.2.3`);
    process.exit(1);
  }
  const { main } = check();
  for (const [file, re] of COPIES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const text = read(file).replace(g, (m) => m.replace(/"(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)"(?=[^"]*$)/, `"${version}"`));
    writeFileSync(join(root, file), text);
  }
  const after = check();
  if (after.problems.length) {
    console.error(after.problems.join('\n'));
    process.exit(1);
  }
  console.log(`${main} -> ${version}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'set') set(arg);
else {
  const { main, problems } = check();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(cmd === 'check' ? `all copies say ${main}` : main);
}
