#!/usr/bin/env node
// Consistency checks for the launch kit. No dependencies; run from the repository root:
//
//   node launch/check-launch-kit.mjs          # report placeholders, fail on errors
//   node launch/check-launch-kit.mjs --final  # also fail while any post still has a placeholder
//
// It checks what is easy to break by hand: required files, the canonical pitch, post lengths,
// banned phrasing, version and npm claims in posts, link hosts, and relative links.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const final = process.argv.includes("--final");
const errors = [];
const notes = [];

const PITCH = "Replay Room turns a failed webhook from a blind resend into a rehearsed, evidence-backed production change.";
const REQUIRED = [
  "README.md", "messaging.md", "x.md", "linkedin.md", "show-hn.md", "reddit.md", "product-hunt.md",
  "substack.md", "demo-script.md", "faq.md", "media-plan.md", "release-checklist.md", "link-map.md",
  "press-kit.md", "assets/README.md", "assets/social-banner.html", "assets/og-image.html",
  "assets/social-banner-1100x220.png", "assets/og-image-1200x630.png",
];
// Files whose text gets pasted into public channels.
const POSTS = ["x.md", "linkedin.md", "show-hn.md", "reddit.md", "substack.md", "product-hunt.md"];
const ALLOWED_HOSTS = new Set([
  "replay-room-web.onrender.com", "replay-room-api.onrender.com", "github.com", "huggingface.co",
  "abhid1234-replay-room.static.hf.space", "www.npmjs.com", "httpbin.org", "cyclonedx.org",
]);

const markdown = readdirSync(here, { recursive: true })
  .filter((file) => file.endsWith(".md"))
  .map((file) => ({ file: file.replaceAll("\\", "/"), text: readFileSync(join(here, file), "utf8") }));
const read = (file) => markdown.find((entry) => entry.file === file)?.text ?? "";
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const xLength = (text) => text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;

for (const file of REQUIRED) {
  if (!existsSync(join(here, file))) errors.push(`missing required file launch/${file}`);
}

for (const file of ["README.md", "messaging.md", "press-kit.md", "substack.md"]) {
  if (!read(file).includes(PITCH)) errors.push(`${file}: canonical pitch missing or reworded`);
}

for (const match of read("x.md").matchAll(/## (.+?)\n[\s\S]*?```text\n([\s\S]*?)\n```\n\nLength: (\d+) of 280/g)) {
  const [, title, body, stated] = match;
  const actual = xLength(body);
  if (actual > 280) errors.push(`x.md "${title}": ${actual} characters exceeds 280`);
  if (actual !== Number(stated)) errors.push(`x.md "${title}": stated length ${stated}, actual ${actual}`);
}

const fenced = (file, label) => read(file).match(new RegExp(`${label}[^\\n]*\\n\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\``))?.[1];
for (const [file, label, max] of [
  ["show-hn.md", "## Title", 80],
  ["product-hunt.md", "### Tagline", 60],
  ["product-hunt.md", "### Short description", 260],
]) {
  const value = fenced(file, label);
  if (value === undefined) errors.push(`${file}: could not find ${label.replaceAll("\\", "")}`);
  else if (value.length > max) errors.push(`${file}: ${label.replaceAll("\\", "")} is ${value.length} characters (limit ${max})`);
}

const banned = [
  { pattern: /\bhonest(ly)?\b/gi, reason: "banned word" },
  { pattern: /\bReplayRoom\b|\bReplay room\b|\breplay Room\b/g, reason: "product name must be \"Replay Room\"" },
  { pattern: /AI-powered/gi, reason: "no AI claims", allow: ["messaging.md"] },
  // Affirmative third-person claims only; questions such as "Does it guarantee exactly-once" are fine.
  { pattern: /\b(guarantees|provides|delivers|offers) exactly-once\b/gi, reason: "delivery is at-least-once" },
];
for (const { file, text } of markdown) {
  for (const { pattern, reason, allow = [] } of banned) {
    if (allow.includes(file)) continue;
    for (const match of text.matchAll(pattern)) errors.push(`${file}:${lineOf(text, match.index)}: "${match[0]}" (${reason})`);
  }
}

for (const file of POSTS) {
  const text = read(file);
  for (const match of text.matchAll(/\b(?:v?0\.4\.0)\b/g)) {
    errors.push(`${file}:${lineOf(text, match.index)}: version claim "${match[0]}" in a post; name versions only after readback`);
  }
  if (file === "product-hunt.md") continue; // its npm reply template is explicitly conditional
  for (const match of text.matchAll(/npx @avee1234\/replay-room|npm (?:install|i) @avee1234\/replay-room/g)) {
    errors.push(`${file}:${lineOf(text, match.index)}: npm usage in a post; use [[NPM_LINE]] until registry readback passes`);
  }
}

for (const { file, text } of markdown) {
  for (const match of text.matchAll(/https?:\/\/[^\s)>`"'\]]+/g)) {
    const host = new URL(match[0]).host;
    if (!ALLOWED_HOSTS.has(host)) errors.push(`${file}:${lineOf(text, match.index)}: unexpected link host ${host}`);
  }
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [path, anchor] = target.split("#");
    const absolute = resolve(here, dirname(file), path);
    if (!existsSync(absolute)) {
      errors.push(`${file}:${lineOf(text, match.index)}: broken relative link ${target}`);
      continue;
    }
    if (anchor && absolute.endsWith(".md")) {
      const slugs = [...readFileSync(absolute, "utf8").matchAll(/^#+ (.+)$/gm)]
        .map(([, heading]) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replaceAll(" ", "-"));
      if (!slugs.includes(anchor)) errors.push(`${file}:${lineOf(text, match.index)}: missing anchor #${anchor} in ${relative(root, absolute)}`);
    }
  }
  for (const match of text.matchAll(/\[\[[A-Z_]+(?::[^\]]*)?\]\]/g)) {
    const where = `${file}:${lineOf(text, match.index)}: ${match[0]}`;
    if (final && POSTS.includes(file) && insidePostCopy(file, text, match.index)) errors.push(`unresolved placeholder ${where}`);
    else notes.push(where);
  }
}

// The text that actually gets pasted: fenced ```text blocks, or the essay body after its header.
function insidePostCopy(file, text, index) {
  if (file === "substack.md") return index > text.indexOf("\n---\n", text.indexOf("\n---\n") + 1);
  for (const block of text.matchAll(/```text\n[\s\S]*?\n```/g)) {
    if (index > block.index && index < block.index + block[0].length) return true;
  }
  return false;
}

if (notes.length) {
  console.log(`Placeholders still to resolve before posting (${notes.length}):`);
  for (const note of notes) console.log(`  ${note}`);
}
if (errors.length) {
  console.error(`\nLaunch kit check failed (${errors.length}):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`\nLaunch kit check passed: ${markdown.length} Markdown files${final ? ", no placeholders in posts" : ""}.`);
