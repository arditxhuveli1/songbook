import { OWNER, REPO } from "./config.js";
import { slugify } from "./slug.js";
import {
  REPO_URL, getToken, setToken, validateToken, songPath,
  getBranch, listSongs, createBlob, createTree, createCommit, updateRef,
} from "./github.js";

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
let items = []; // { file, slugInput, statusEl, done, slug }

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
    r.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    r.readAsDataURL(file);
  });
}

// "Add x.docx" for one file, "Add 3 songs, update 2 songs" plus the names for several.
function commitMessage(added, updated) {
  const names = [...added, ...updated];
  if (names.length === 1) return `${added.length ? "Add" : "Update"} ${names[0]}`;
  const count = (n) => `${n} ${n === 1 ? "song" : "songs"}`;
  const parts = [];
  if (added.length) parts.push(`add ${count(added.length)}`);
  if (updated.length) parts.push(`update ${count(updated.length)}`);
  const subject = parts.join(", ");
  return `${subject[0].toUpperCase()}${subject.slice(1)}\n\n${names.join("\n")}\n`;
}

// Writes every pending item to the branch in a single commit.
// Returns the number of files committed, or null when the user cancelled.
// Nothing is published until the final ref update, so an error before that
// leaves the repository untouched.
async function uploadBatch(token, pending) {
  let base = await getBranch(token);
  const existing = await listSongs(token);

  const replacing = pending.filter((i) => existing.has(songPath(i.slug)));
  if (replacing.length) {
    const names = replacing.map((i) => `${i.slug}.docx`).join(", ");
    const question = replacing.length === 1
      ? `"${names}" already exists on the site. Replace it?`
      : `${replacing.length} of these already exist and will be replaced: ${names}. Continue?`;
    if (!confirm(question)) return null;
  }

  const entries = [];
  const added = [];
  const updated = [];
  for (const item of pending) {
    setStatus(item, "Reading…");
    const content = await readAsBase64(item.file);
    setStatus(item, "Sending…");
    const sha = await createBlob(token, content);
    const path = songPath(item.slug);
    const old = existing.get(path);
    if (old === sha) {
      item.done = true;
      setStatus(item, "Unchanged, already on the site.", "ok");
      continue;
    }
    setStatus(item, "Sent.");
    entries.push({ path, mode: "100644", type: "blob", sha });
    (old ? updated : added).push(`${item.slug}.docx`);
  }
  const changed = pending.filter((i) => !i.done);
  if (!entries.length) return 0;

  for (const item of changed) setStatus(item, "Committing…");
  const message = commitMessage(added, updated);
  for (let attempt = 0; ; attempt++) {
    const tree = await createTree(token, base.tree, entries);
    const commit = await createCommit(token, message, tree, base.commit);
    if (await updateRef(token, commit)) break;
    // The branch moved meanwhile (a Remove from another device, for example).
    // Blobs are content-addressed, so only the tree and commit are redone.
    if (attempt > 0) throw new Error("The repository changed while uploading. Press Upload again.");
    base = await getBranch(token);
  }
  for (const item of changed) {
    item.done = true;
    setStatus(item, "Uploaded.", "ok");
  }
  return entries.length;
}

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = getToken();
  if (!token) return showTokenForm("Enter the token first.");

  uploadError.hidden = true;
  uploadOk.hidden = true;
  const fail = (message) => {
    uploadError.textContent = message;
    uploadError.hidden = false;
  };

  // Every name must be non-empty and unique inside the batch.
  const pending = items.filter((i) => !i.done);
  const seen = new Set();
  for (const item of pending) {
    const slug = slugify(item.slugInput.value);
    if (!slug) return fail(`The name for "${item.file.name}" is empty.`);
    if (seen.has(slug)) return fail(`Two files would be named "${slug}.docx". Change one of them.`);
    seen.add(slug);
    item.slug = slug;
    item.slugInput.value = slug;
  }
  if (!pending.length) return;

  uploadBtn.disabled = true;
  filesInput.disabled = true;
  try {
    const count = await uploadBatch(token, pending);
    if (count === null) {
      for (const item of pending) setStatus(item, "");
    } else if (count === 0) {
      uploadOk.textContent = "Already up to date. These files are on the site unchanged.";
      uploadOk.hidden = false;
    } else {
      uploadOk.innerHTML = `Uploaded. It will appear on the site in about a minute. <a href="${REPO_URL}/actions" target="_blank" rel="noopener">See the build</a>.`;
      uploadOk.hidden = false;
    }
  } catch (err) {
    // Keep the selection so the batch can be retried.
    for (const item of pending) if (!item.done) setStatus(item, "Not uploaded.", "error");
    if (err.reauth) {
      setToken("");
      showTokenForm(err.message);
    } else {
      fail(err.message);
    }
  } finally {
    uploadBtn.disabled = items.every((i) => i.done);
    filesInput.disabled = false;
  }
});

// --- init ---------------------------------------------------------------------------
if (getToken()) showUploadForm(); else showTokenForm();
