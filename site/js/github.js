// Shared GitHub API helpers for the upload and view pages.
// The token lives only in this browser's localStorage.
import { OWNER, REPO, BRANCH, SONGS_DIR } from "./config.js";

const TOKEN_KEY = "songbook.token";
const API = "https://api.github.com";
export const REPO_URL = `https://github.com/${OWNER}/${REPO}`;

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
export function setToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(message, { reauth = false, network = false } = {}) {
    super(message);
    this.reauth = reauth;
    this.network = network;
  }
}

export async function api(token, method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", { network: true });
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, ok: res.ok, data };
}

// Returns null when the token is usable, otherwise a message for the user.
export async function validateToken(token) {
  const { status, ok, data } = await api(token, "GET", `/repos/${OWNER}/${REPO}`);
  if (status === 401) return "The token is invalid or expired.";
  if (status === 404) return `The token cannot see ${OWNER}/${REPO}. Give it access to this repository.`;
  if (!ok) return `GitHub answered ${status}. Try again.`;
  if (!data?.permissions?.push) return "The token has no write access to this repository. It needs Contents: Read and write.";
  return null;
}

export function songPath(slug) {
  return `${SONGS_DIR}/${slug}.docx`;
}

// Contents API helpers, used by the Remove button on the song page.
// sha of the file on the branch, or null when it does not exist.
export async function getSha(token, path) {
  const { status, ok, data } = await api(token, "GET", `/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`);
  if (status === 404) return null;
  if (status === 401) throw new ApiError("The token is invalid or expired. Enter a new one.", { reauth: true });
  if (!ok) throw new ApiError(`GitHub answered ${status} while checking the file.`);
  return data?.sha ?? null;
}

export function putFile(token, path, content, sha, message) {
  const body = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  return api(token, "PUT", `/repos/${OWNER}/${REPO}/contents/${path}`, body);
}

export function deleteFile(token, path, sha, message) {
  return api(token, "DELETE", `/repos/${OWNER}/${REPO}/contents/${path}`, { message, sha, branch: BRANCH });
}

// --- one commit per batch (Git Data API) ---------------------------------------
function readError(res, what) {
  if (res.status === 401) return new ApiError("The token is invalid or expired. Enter a new one.", { reauth: true });
  return new ApiError(`GitHub answered ${res.status} while ${what}.`);
}

// Head commit of the branch and the tree it points to.
export async function getBranch(token) {
  const res = await api(token, "GET", `/repos/${OWNER}/${REPO}/branches/${encodeURIComponent(BRANCH)}`);
  if (!res.ok) throw readError(res, "reading the branch");
  return { commit: res.data.commit.sha, tree: res.data.commit.commit.tree.sha };
}

// Map of path -> blob sha for every file in the songs folder, empty when the folder does not exist.
export async function listSongs(token) {
  const res = await api(token, "GET", `/repos/${OWNER}/${REPO}/contents/${SONGS_DIR}?ref=${encodeURIComponent(BRANCH)}`);
  const files = new Map();
  if (res.status === 404) return files;
  if (!res.ok) throw readError(res, "listing the songs");
  for (const f of Array.isArray(res.data) ? res.data : []) if (f.type === "file") files.set(f.path, f.sha);
  return files;
}

export async function createBlob(token, base64) {
  const res = await api(token, "POST", `/repos/${OWNER}/${REPO}/git/blobs`, { content: base64, encoding: "base64" });
  if (!res.ok) throw writeError(res);
  return res.data.sha;
}

// entries: [{ path, mode: "100644", type: "blob", sha }]
export async function createTree(token, baseTree, entries) {
  const res = await api(token, "POST", `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: baseTree, tree: entries });
  if (!res.ok) throw writeError(res);
  return res.data.sha;
}

export async function createCommit(token, message, tree, parent) {
  const res = await api(token, "POST", `/repos/${OWNER}/${REPO}/git/commits`, { message, tree, parents: [parent] });
  if (!res.ok) throw writeError(res);
  return res.data.sha;
}

// Moves the branch to the commit. Returns false when that is not a fast-forward,
// meaning the branch moved since getBranch() and the caller must start over.
export async function updateRef(token, sha) {
  const res = await api(token, "PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(BRANCH)}`, { sha });
  if (res.status === 422 || res.status === 409) return false;
  if (!res.ok) throw writeError(res);
  return true;
}

// Turns a failed write response into an ApiError with a plain message.
export function writeError(res) {
  if (res.status === 401) return new ApiError("The token is invalid or expired. Enter a new one.", { reauth: true });
  if (res.status === 403 || res.status === 404) {
    return new ApiError("The token lacks Contents write access to this repository. Check its permissions or create a new one.");
  }
  return new ApiError(`GitHub answered ${res.status}${res.data?.message ? `: ${res.data.message}` : ""}.`);
}
