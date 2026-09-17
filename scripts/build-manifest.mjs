#!/usr/bin/env node
// Builds songs.json from the .docx files in a directory.
// Usage: node scripts/build-manifest.mjs <songs dir> <output path>
// Node 20, no npm dependencies. Needs `unzip` and `git` on PATH.

import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname, posix } from "node:path";

const [songsDir, outPath] = process.argv.slice(2);
if (!songsDir || !outPath) {
  console.error("Usage: build-manifest.mjs <songs dir> <output path>");
  process.exit(1);
}

const MAX_TITLE = 80;

// --- slug rule (keep in sync with site/js/slug.js) ---------------------------
function fold(text) {
  return String(text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/ë/g, "e")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
function slugify(text) {
  return fold(text)
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// --- helpers -----------------------------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Text of the first <w:p> whose concatenated <w:t> text is non-empty.
function firstParagraphText(xml) {
  const paraRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const para = m[0];
    let text = "";
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>/g;
    let t;
    while ((t = textRe.exec(para)) !== null) {
      text += t[1] === undefined ? " " : t[1];
    }
    text = decodeEntities(text).normalize("NFC").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

function readTitle(file, slug) {
  const fallback = titleFromSlug(slug);
  try {
    const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const text = firstParagraphText(xml);
    if (!text || text.length > MAX_TITLE) return fallback;
    return text;
  } catch (err) {
    console.warn(`warning: could not read title from ${file}: ${err.message.split("\n")[0]}`);
    return fallback;
  }
}

function lastCommitDate(file) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return new Date(out).toISOString();
  } catch {
    /* not a git checkout, or file not committed yet */
  }
  return new Date().toISOString();
}

// --- main --------------------------------------------------------------------
const files = readdirSync(songsDir)
  .filter((f) => f.toLowerCase().endsWith(".docx") && !f.startsWith("~$"))
  .sort();

const songs = files.map((f) => {
  const file = join(songsDir, f);
  const slug = basename(f, ".docx");
  return {
    slug,
    title: readTitle(file, slug),
    docx: posix.join(basename(songsDir), f),
    updated: lastCommitDate(file),
  };
});

songs.sort((a, b) => a.title.localeCompare(b.title, "sq"));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(songs, null, 2) + "\n");
console.log(`wrote ${outPath} with ${songs.length} song(s)`);
