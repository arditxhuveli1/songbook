// Renders one .docx with docx-preview, scaled to the screen width.

const FIT_KEY = "songbook.fit"; // "width" | "actual"

const titleEl = document.getElementById("title");
const fitBtn = document.getElementById("fit");
const downloadEl = document.getElementById("download");
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

  loading.hidden = true;
  fitBtn.hidden = false;
  layout();
  // Some browsers report the final page size a frame later.
  requestAnimationFrame(layout);
}

main();
