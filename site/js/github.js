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

// Turns a failed write response into an ApiError with a plain message.
export function writeError(res) {
  if (res.status === 401) return new ApiError("The token is invalid or expired. Enter a new one.", { reauth: true });
  if (res.status === 403 || res.status === 404) {
    return new ApiError("The token lacks Contents write access to this repository. Check its permissions or create a new one.");
  }
  return new ApiError(`GitHub answered ${res.status}${res.data?.message ? `: ${res.data.message}` : ""}.`);
}
