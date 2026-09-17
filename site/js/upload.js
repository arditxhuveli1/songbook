import { OWNER, REPO } from "./config.js";
import { slugify } from "./slug.js";
import { REPO_URL, getToken, setToken, validateToken, songPath, getSha, putFile, writeError } from "./github.js";

const $ = (id) => document.getElementById(id);
const tokenSection = $("token-section");
const uploadSection = $("upload-section");
const tokenForm = $("token-form");
const tokenInput = $("token");
const tokenSave = $("token-save");
const tokenError = $("token-error");
const uploadForm = $("upload-form");
const filesInput = $("files");
const fileList = $("file-list");
const uploadBtn = $("upload-btn");
const resetBtn = $("reset-btn");
const uploadError = $("upload-error");
const uploadOk = $("upload-ok");

$("readme-link").href = `${REPO_URL}#creating-the-token`;
$("repo-link").href = REPO_URL;
$("repo-link").textContent = `${OWNER}/${REPO}`;

// --- token ------------------------------------------------------------------
function showTokenForm(message = "") {
  tokenSection.hidden = false;
  uploadSection.hidden = true;
  tokenInput.value = "";
  tokenError.textContent = message;
  tokenError.hidden = !message;
}

function showUploadForm() {
  tokenSection.hidden = true;
  uploadSection.hidden = false;
}

tokenForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) return;
  tokenSave.disabled = true;
  tokenError.hidden = true;
  try {
    const problem = await validateToken(token);
    if (problem) {
      tokenError.textContent = problem;
      tokenError.hidden = false;
      return;
    }
    setToken(token);
    showUploadForm();
  } catch (err) {
    tokenError.textContent = err.message;
    tokenError.hidden = false;
  } finally {
    tokenSave.disabled = false;
  }
});

$("forget").addEventListener("click", () => {
  if (!confirm("Forget the token on this device?")) return;
  setToken("");
  showTokenForm();
});

// --- file selection -----------------------------------------------------------
let items = []; // { file, slugInput, statusEl, done }

function slugFromFilename(name) {
  return slugify(name.replace(/\.docx$/i, ""));
}

function setStatus(item, text, cls = "") {
  item.statusEl.textContent = text;
  item.statusEl.className = `status ${cls}`.trim();
}

function renderFiles() {
  fileList.replaceChildren();
  items = [];
  for (const file of filesInput.files || []) {
    const li = document.createElement("li");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = file.name;
    const slugInput = document.createElement("input");
    slugInput.type = "text";
    slugInput.value = slugFromFilename(file.name);
    slugInput.setAttribute("aria-label", `File name on the site for ${file.name}`);
    slugInput.autocapitalize = "off";
    slugInput.spellcheck = false;
    const statusEl = document.createElement("div");
    statusEl.className = "status";
    li.append(name, slugInput, statusEl);
    fileList.append(li);
    const item = { file, slugInput, statusEl, done: false };
    items.push(item);
    if (!/\.docx$/i.test(file.name)) {
      item.done = true; // skipped, nothing to retry
      setStatus(item, "Not a .docx file, it will be skipped.", "error");
    }
  }
  uploadBtn.disabled = items.every((i) => i.done);
  resetBtn.hidden = items.length === 0;
  uploadError.hidden = true;
  uploadOk.hidden = true;
}

filesInput.addEventListener("change", renderFiles);
resetBtn.addEventListener("click", () => {
  filesInput.value = "";
  renderFiles();
});

// --- upload ---------------------------------------------------------------------
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

// Returns true when the file was uploaded, false when skipped.
async function uploadOne(token, item, content) {
  const slug = slugify(item.slugInput.value);
  if (!slug) throw new Error("The file name is empty.");
  item.slugInput.value = slug;
  const path = songPath(slug);

  setStatus(item, "Checking…");
  let sha = await getSha(token, path);
  if (sha && !confirm(`"${slug}.docx" already exists on the site. Replace it?`)) {
    setStatus(item, "Skipped.");
    return false;
  }

  setStatus(item, "Uploading…");
  const message = () => `${sha ? "Update" : "Add"} ${slug}.docx`;
  let res = await putFile(token, path, content, sha, message());
  if (res.status === 409 || res.status === 422) {
    // Changed since we read the sha: re-read once and retry.
    setStatus(item, "File changed on GitHub, retrying…");
    sha = await getSha(token, path);
    res = await putFile(token, path, content, sha, message());
  }
  if (!res.ok) throw writeError(res);
  return true;
}

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = getToken();
  if (!token) return showTokenForm("Enter the token first.");

  uploadError.hidden = true;
  uploadOk.hidden = true;
  uploadBtn.disabled = true;
  filesInput.disabled = true;

  // Reject duplicate names inside the same batch.
  const seen = new Map();
  for (const item of items) {
    if (item.done) continue;
    const s = slugify(item.slugInput.value);
    if (seen.has(s)) {
      uploadError.textContent = `Two files would be named "${s}.docx". Change one of them.`;
      uploadError.hidden = false;
      uploadBtn.disabled = false;
      filesInput.disabled = false;
      return;
    }
    seen.set(s, item);
  }

  let uploaded = 0;
  let failed = 0;
  let stop = false;
  for (const item of items) {
    if (item.done || !/\.docx$/i.test(item.file.name)) continue;
    try {
      const content = await readAsBase64(item.file);
      const did = await uploadOne(token, item, content);
      item.done = true;
      if (did) { uploaded++; setStatus(item, "Uploaded.", "ok"); }
    } catch (err) {
      failed++;
      setStatus(item, err.message, "error");
      if (err.network) { stop = true; break; }
      if (err.reauth) { setToken(""); showTokenForm(err.message); stop = true; break; }
    }
  }

  if (uploaded > 0) {
    uploadOk.innerHTML = `Uploaded. It will appear on the site in about a minute. <a href="${REPO_URL}/actions" target="_blank" rel="noopener">See the build</a>.`;
    uploadOk.hidden = false;
  }
  if (failed > 0 && !stop) {
    uploadError.textContent = "Some files were not uploaded. See the messages above.";
    uploadError.hidden = false;
  }
  // Keep the selection so a failed upload can be retried.
  uploadBtn.disabled = items.every((i) => i.done);
  filesInput.disabled = false;
});

// --- init ---------------------------------------------------------------------------
if (getToken()) showUploadForm(); else showTokenForm();
