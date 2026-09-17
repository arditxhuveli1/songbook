// Shared slug + diacritic folding.
// Used by the upload page (browser). scripts/build-manifest.mjs carries a copy
// of the same rule because the site and the script are not bundled together.

// Fold Albanian and other diacritics: "mirësin" -> "miresin", "Çelës" -> "celes".
export function fold(text) {
  return String(text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/ë/g, "e")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// NFC-normalise, lowercase, ë→e, ç→c, strip other diacritics, drop apostrophes,
// non-alphanumerics to "-", collapse repeats, trim hyphens.
export function slugify(text) {
  return fold(text)
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// "nuk-di-pse-zoti-miresin" -> "Nuk Di Pse Zoti Miresin"
export function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
