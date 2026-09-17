# Songbook

A small static site that keeps worship chord sheets as Word files and shows them in the browser, phone included. Upload a `.docx`, it appears in the list, tap it and read it.

- `songs/*.docx` is the only source of truth. Nothing is converted: the viewer renders the Word file itself, with its own fonts and layout, so chords written above lyrics with spaces stay above the right syllables.
- Every push to `main` runs a GitHub Actions workflow that copies `site/` and `songs/` into a Pages artifact, generates `songs.json` (title, file name, last change) from the documents, and deploys it. Nothing is built locally and no `songs.json` is ever committed.
- Uploads happen from `upload.html` on the site. It commits the file to `songs/` through the GitHub API with a fine-grained personal access token that is stored only in the browser of the device you upload from. The token never enters the repository or the deployed site.

Site pages:

| Page | What it does |
| --- | --- |
| `index.html` | Song list with search. Search ignores case and diacritics, so `miresin` finds `mirësin`. |
| `view.html?song=<slug>` | Renders the document. "Fit width" scales the page to the screen; "Actual size" shows it 1:1. Print shows only the document. Devices with the token also get a Remove button. |
| `upload.html` | Saves the token, then uploads one or more `.docx` files. |

The song title shown in the list is the first non-empty paragraph of the document. If that is empty or longer than 80 characters, the file name is used instead.

Fonts: phones usually lack Times New Roman, Arial, Calibri and Courier New. The viewer loads the metric-compatible fonts Tinos, Arimo, Carlito and Cousine from a CDN and declares them under those original names, so letter widths match Word and the chords keep their positions.

## One-time setup

1. Create the repository `xhuve/songbook` on GitHub (the owner and name live in `site/js/config.js`; change them there if the repository is different) and push this code to `main`.
2. On github.com open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push any change, or run the **Deploy songbook** workflow from the **Actions** tab. The site appears at `https://xhuve.github.io/songbook/`.

## Creating the token

The upload page needs a fine-grained personal access token that can write to this repository and nothing else.

1. On github.com open your profile menu → **Settings → Developer settings → Personal access tokens → Fine-grained tokens** and choose **Generate new token**.
2. Give it a name such as `songbook upload` and an expiry. Tokens expire after at most one year; pick what you are comfortable renewing.
3. **Repository access**: choose **Only select repositories** and pick this repository.
4. **Permissions → Repository permissions**: set **Contents** to **Read and write**. Leave everything else at *No access* (GitHub adds read-only *Metadata* automatically).
5. Generate the token and copy it. It begins with `github_pat`. GitHub shows it only once.
6. Open `upload.html` on the site, paste it and press **Save**. The page checks that the token can push to the repository before storing it. Repeat on each device you upload from.

Renewal: when the token expires the upload page reports it as invalid and asks for a new one. Create a new token the same way and paste it. Revoking: delete the token under **Fine-grained tokens** on github.com, and press **Forget token on this device** on the upload page.

## Uploading

Open `upload.html`, choose one or more `.docx` files, check the suggested file name under each one (letters, digits and hyphens; `ë` becomes `e`, `ç` becomes `c`) and press **Upload**. If a file with the same name already exists you are asked before it is replaced. All the files of one upload land in a single commit, so the site is built once, about a minute after the upload; the **Actions** tab shows the build.

## Removing a song

Open the song on a device that has the token saved and press **Remove** in the top bar. After confirmation the file is deleted from `songs/` and the song disappears from the list about a minute later. The button is not shown on devices without the token.

## Renaming a song

Rename the file directly in the `songs/` folder on github.com (open the file, use the pencil to rename, and commit to `main`), or remove it and upload it again under the new name. The title in the list comes from the document's first line, so to change the title edit the document and upload it again.

## Local check

`songs.json` can be generated locally with Node 20 or newer, `unzip` and `git` available:

```sh
node scripts/build-manifest.mjs songs /tmp/songs.json
```

To try the site locally, copy `site/` and `songs/` into one folder, generate `songs.json` there, and serve it with any static server (for example `python3 -m http.server`). Opening the HTML files directly from disk does not work because the pages fetch `songs.json`.
