// Renders one .docx with docx-preview, scaled to the screen width.
import { REPO_URL, getToken, setToken, songPath, getSha, deleteFile, writeError } from "./github.js";

const FIT_KEY = "songbook.fit"; // "width" | "actual"

const titleEl = document.getElementById("title");
const fitBtn = document.getElementById("fit");
const downloadEl = document.getElementById("download");
const removeBtn = document.getElementById("remove");
const removedEl = document.getElementById("removed");
const loading = document.getElementById("loading");
const errorEl = document.getElementById("error");
const doc = document.getElementById("doc");
const scaleEl = document.getElementById("doc-scale");

let mode = localStorage.getItem(FIT_KEY) === "actual" ? "actual" : "width";

function fail(message) {
  loading.hidden = true;
  doc.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

// Scale the rendered pages so the widest page fills the container, and
// correct the container height so nothing scrolls into an empty gap.
function layout() {
  const pages = scaleEl.querySelectorAll("section.docx");
  if (!pages.length) return;

  let pageWidth = 0;
  for (const p of pages) pageWidth = Math.max(pageWidth, p.offsetWidth);
  if (!pageWidth) return;

  const scale = mode === "width" ? doc.clientWidth / pageWidth : 1;
  scaleEl.style.transform = scale === 1 ? "" : `scale(${scale})`;
  doc.style.height = `${Math.ceil(scaleEl.offsetHeight * scale)}px`;
  doc.classList.toggle("actual", mode === "actual");
  fitBtn.textContent = mode === "width" ? "Actual size" : "Fit width";
}

fitBtn.addEventListener("click", () => {
  mode = mode === "width" ? "actual" : "width";
  localStorage.setItem(FIT_KEY, mode);
  layout();
});

window.addEventListener("resize", layout);
window.addEventListener("orientationchange", () => setTimeout(layout, 50));
window.addEventListener("afterprint", layout);

// ---------------------------------------------------------------------------
// Fidelity fixes applied to docx-preview's output. Chord sheets depend on
// exact line and column breaks, and three renderer defaults move them:
//
// 1. Word computes "auto" line spacing (e.g. 1.38 lines) as a multiple of
//    the font's own line height (ascent + descent + line gap), the browser
//    as a multiple of the font size. Times New Roman 13pt at 1.38 is 20.6pt
//    in Word but only 17.9pt in the browser, so more lines fit per column.
// 2. CSS balances multi-column content; Word fills column 1 to the bottom
//    of the page before starting column 2.
// 3. A column gap given per column (<w:col w:space>) is ignored, and the
//    browser default (1em) is narrower than Word's 0.5in.
// ---------------------------------------------------------------------------

// Line height / font size of common Word fonts (from their hhea metrics).
const LINE_RATIOS = {
  "times new roman": 1.15, tinos: 1.15, "liberation serif": 1.15,
  arial: 1.15, arimo: 1.15, "liberation sans": 1.15, helvetica: 1.15,
  calibri: 1.22, carlito: 1.22,
  cambria: 1.17, caladea: 1.17,
  "courier new": 1.13, cousine: 1.13, "liberation mono": 1.13,
  georgia: 1.136, verdana: 1.215, tahoma: 1.207, "segoe ui": 1.33,
  "book antiqua": 1.13, garamond: 1.13, "comic sans ms": 1.39,
};
const measuredRatios = new Map();

function lineRatio(fontFamily) {
  const family = fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (LINE_RATIOS[family]) return LINE_RATIOS[family];
  if (measuredRatios.has(family)) return measuredRatios.get(family);
  // Unknown font: ask the browser for its normal line height.
  const probe = document.createElement("span");
  probe.textContent = "Hg";
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:${fontFamily};font-size:100px;line-height:normal`;
  document.body.append(probe);
  const ratio = probe.offsetHeight / 100 || 1.15;
  probe.remove();
  measuredRatios.set(family, ratio);
  return ratio;
}

function fixLineHeights(root) {
  for (const p of root.querySelectorAll("p")) {
    const lh = p.style.lineHeight;
    if (!/^[\d.]+$/.test(lh)) continue; // only unitless values come from "auto" spacing
    const sample = p.querySelector("span") || p;
    const cs = getComputedStyle(sample);
    const ratio = lineRatio(cs.fontFamily);
    p.style.lineHeight = (parseFloat(lh) * ratio).toFixed(4);
    if (sample !== p) {
      // Give the paragraph's own strut the font of its first run, otherwise
      // the document default font (often Arial 11pt) sits on a different
      // baseline and pads every line box by a fraction of a pixel.
      p.style.fontFamily = cs.fontFamily;
      p.style.fontSize = cs.fontSize;
    }
  }
}

function fixColumns(root) {
  for (const section of root.querySelectorAll("section.docx")) {
    const articles = [...section.querySelectorAll(":scope > article")].filter((a) => a.style.columnCount);
    if (!articles.length) continue;
    for (const a of articles) {
      if (!a.style.columnGap) a.style.columnGap = "36pt"; // Word's default column spacing
    }
    // Fill columns top to bottom: give the page its real height and let the
    // column block take what is left. If the content does not fit on the
    // page (Word would add a page), fall back to the growing, balanced layout
    // so nothing is cut off.
    const pageHeight = section.style.minHeight;
    if (!pageHeight) continue;
    section.style.height = pageHeight;
    for (const a of articles) {
      a.style.flex = "1 1 auto";
      a.style.minHeight = "0";
      a.style.marginBottom = "0";
      a.style.columnFill = "auto";
    }
    const overflows =
      section.scrollHeight > section.clientHeight + 1 ||
      articles.some((a) => a.scrollWidth > a.clientWidth + 1);
    if (overflows) {
      section.style.height = "";
      for (const a of articles) {
        a.style.flex = a.style.minHeight = a.style.marginBottom = a.style.columnFill = "";
      }
    }
  }
}

// Remove: only offered on a device that holds the upload token.
async function removeSong(song) {
  const token = getToken();
  if (!token) return;
  if (!confirm(`Remove "${song.title}" from the site? The file ${song.slug}.docx will be deleted from the repository.`)) return;

  removeBtn.disabled = true;
  removeBtn.textContent = "Removing…";
  const path = songPath(song.slug);
  try {
    let sha = await getSha(token, path);
    if (!sha) throw new Error("The file is no longer in the repository. It will disappear from the list after the next build.");
    let res = await deleteFile(token, path, sha, `Remove ${song.slug}.docx`);
    if (res.status === 409 || res.status === 422) {
      sha = await getSha(token, path);
      if (sha) res = await deleteFile(token, path, sha, `Remove ${song.slug}.docx`);
    }
    if (!res.ok) throw writeError(res);
    removeBtn.hidden = true;
    removedEl.innerHTML = `Removed. It disappears from the list in about a minute. <a href="${REPO_URL}/actions" target="_blank" rel="noopener">See the build</a> or <a href="index.html">go back to the list</a>.`;
    removedEl.hidden = false;
  } catch (err) {
    if (err.reauth) setToken("");
    errorEl.textContent = err.reauth ? `${err.message} Open the upload page to enter it.` : err.message;
    errorEl.hidden = false;
    removeBtn.disabled = false;
    removeBtn.textContent = "Remove";
  }
}

async function main() {
  const slug = new URLSearchParams(location.search).get("song");
  if (!slug) return fail("No song selected.");

  let song;
  try {
    const res = await fetch("songs.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    song = (await res.json()).find((s) => s.slug === slug);
  } catch (err) {
    return fail(`Could not load the song list (${err.message}).`);
  }
  if (!song) return fail("This song does not exist. It may have been renamed or removed.");

  titleEl.textContent = song.title;
  document.title = `${song.title} – Songbook`;
  downloadEl.href = song.docx;
  downloadEl.hidden = false;
  if (getToken()) {
    removeBtn.hidden = false;
    removeBtn.addEventListener("click", () => removeSong(song));
  }

  if (typeof docx === "undefined" || typeof JSZip === "undefined") {
    return fail("The document viewer failed to load. Check your connection and reload.");
  }

  let blob;
  try {
    const res = await fetch(song.docx, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch (err) {
    return fail(`Could not download the document (${err.message}).`);
  }

  try {
    await docx.renderAsync(blob, scaleEl, null, {
      inWrapper: true,
      ignoreWidth: false,
      breakPages: true,
      // Only break pages where Word did (page size change, explicit break,
      // or a page break Word recorded), not at every section boundary, so a
      // continuous section (title above two columns) stays on its page.
      ignoreLastRenderedPageBreak: false,
    });
  } catch (err) {
    console.error(err);
    return fail("This document could not be rendered. Download it instead.");
  }

  // Trigger layout so the browser starts fetching the web fonts the
  // document uses, then wait for them before measuring and showing.
  doc.hidden = false;
  void scaleEl.offsetHeight;
  try { await document.fonts.ready; } catch { /* ignore */ }

  fixLineHeights(scaleEl);
  fixColumns(scaleEl);

  loading.hidden = true;
  fitBtn.hidden = false;
  layout();
  // Some browsers report the final page size a frame later.
  requestAnimationFrame(layout);
}

main();
