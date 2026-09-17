# Plan: one commit per upload batch

## Goal

Uploading several files from `upload.html` produces a single commit on `main`
("Add 40 songs") instead of one commit per file. One push, one workflow run,
one deploy. Removing a song stays a single-file operation and is unchanged.

## Why it is easy

The fine-grained token already has Contents: Read and write, which covers the
Git Data endpoints (blobs, trees, commits, refs). No new permission, no new
library, no change to the workflow, the manifest script or the viewer. The
work is confined to `site/js/github.js` and `site/js/upload.js`.

## API flow per batch

All calls use the existing `api()` helper and headers.

1. `GET /repos/{owner}/{repo}/branches/{branch}`
   → `commit.sha` (base commit) and `commit.commit.tree.sha` (base tree).
2. `GET /repos/{owner}/{repo}/contents/songs?ref={branch}`
   → list of existing files with their shas, in one call. Used to detect
   overwrites for the whole batch up front (404 means the folder is empty).
3. For each file: `POST /repos/{owner}/{repo}/git/blobs`
   `{ content: <base64>, encoding: "base64" }` → blob sha.
   Files run one after another so the per-file status still updates.
4. `POST /repos/{owner}/{repo}/git/trees`
   `{ base_tree: <base tree sha>, tree: [ { path: "songs/<slug>.docx",
   mode: "100644", type: "blob", sha: <blob sha> }, … ] }` → tree sha.
   Entries whose blob sha equals the existing file sha are dropped (nothing
   changed); if nothing is left, stop with "Already up to date".
5. `POST /repos/{owner}/{repo}/git/commits`
   `{ message, tree: <tree sha>, parents: [<base commit sha>] }` → commit sha.
6. `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}`
   `{ sha: <commit sha> }` (no `force`, so it must be a fast-forward).

Commit message: `Add <slug>.docx` for one file; for several,
`Add 3 songs, update 2 songs` with the file names listed in the body.

Calls for 40 files: 40 blobs + 4 = 44, down from 80, and one deploy.

## Overwrite confirmation

Before any write, compare the batch against the listing from step 2 and show
one confirmation naming every file that already exists: "3 of these already
exist and will be replaced: a.docx, b.docx, c.docx. Continue?". Cancel aborts
the whole batch with nothing written. This replaces the per-file `confirm()`.

## Error handling

- 401 on any call: same as today, clear the token and show the token form.
- 403/404 on a write: token lacks Contents write access.
- 422 on the ref update (branch moved since step 1, for example a Remove
  from another device): redo steps 1, 4, 5, 6 once with the fresh base.
  Blobs are content-addressed and can be reused. A second failure is
  reported as "The repository changed while uploading, press Upload again".
- Network error mid-batch: nothing has been committed yet, because only the
  ref update publishes anything. Report it, keep the selection, and mark no
  file as done. Blobs already created are harmless orphans.
- Per-file status wording: "Reading…", "Sending…" (blob created),
  then "Committing…" for all, then "Uploaded." for all at once.

## Code changes

`site/js/github.js`
- add `getBranch(token)`, `listSongs(token)` (contents of `songs/`, [] on 404),
  `createBlob(token, base64)`, `createTree(token, baseTree, entries)`,
  `createCommit(token, message, tree, parent)`, `updateRef(token, sha)`.
- keep `getSha`, `putFile`, `deleteFile` for the Remove button.

`site/js/upload.js`
- replace the per-file loop (`uploadOne`) with `uploadBatch(items)`
  implementing the flow above; duplicate-name check stays as it is.
- success message unchanged: "Uploaded. It will appear on the site in about a
  minute." with the Actions link.

`README.md`
- one sentence in "Uploading": a batch becomes a single commit.

No change to `config.js`, `slug.js`, the viewer, the workflow or the script.

## Tests (mocked API in the page, as before)

- 3 new files → 3 blob calls, 1 tree, 1 commit, 1 ref update, all "Uploaded."
- 2 files where one exists → single confirmation naming it; cancel writes
  nothing; accept commits both.
- Ref update answers 422 once → second attempt succeeds, no duplicate blobs.
- Network failure at the tree step → error shown, selection kept, no file
  marked done.
- 401 at the blob step → token form shown, token cleared.
- Real run: upload 3 files from the phone, check the Actions tab shows one
  run, the list shows all three.

## Estimate

About 120 lines changed, an hour including tests.
