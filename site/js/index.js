import { fold } from "./slug.js";

const list = document.getElementById("list");
const state = document.getElementById("state");
const count = document.getElementById("count");
const q = document.getElementById("q");

let songs = [];

function setState(text, isError = false) {
  state.textContent = text || "";
  state.hidden = !text;
  state.classList.toggle("error", isError);
}

function render() {
  const needle = fold(q.value.trim());
  const shown = needle ? songs.filter((s) => s._folded.includes(needle)) : songs;

  list.replaceChildren(
    ...shown.map((s) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "song";
      a.href = `view.html?song=${encodeURIComponent(s.slug)}`;
      a.textContent = s.title;
      li.append(a);
      return li;
    })
  );

  if (songs.length === 0) {
    setState("No songs yet. Upload one from the link below.");
    count.hidden = true;
  } else if (shown.length === 0) {
    setState("Nothing matches.");
    count.hidden = true;
  } else {
    setState("");
    count.textContent = needle ? `${shown.length} of ${songs.length}` : `${songs.length} songs`;
    count.hidden = false;
  }
}

async function load() {
  try {
    const res = await fetch("songs.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    songs = data
      .map((s) => ({ ...s, _folded: fold(s.title) }))
      .sort((a, b) => a.title.localeCompare(b.title, "sq"));
    render();
  } catch (err) {
    setState(`Could not load the song list (${err.message}). Check your connection and reload.`, true);
  }
}

q.addEventListener("input", render);
load();
