"use strict";

// Standard chapter counts for the 66 books of the World English Bible.
const books = [
  ["Genesis",50],["Exodus",40],["Leviticus",27],["Numbers",36],["Deuteronomy",34],
  ["Joshua",24],["Judges",21],["Ruth",4],["1 Samuel",31],["2 Samuel",24],
  ["1 Kings",22],["2 Kings",25],["1 Chronicles",29],["2 Chronicles",36],["Ezra",10],
  ["Nehemiah",13],["Esther",10],["Job",42],["Psalms",150],["Proverbs",31],
  ["Ecclesiastes",12],["Song of Solomon",8],["Isaiah",66],["Jeremiah",52],
  ["Lamentations",5],["Ezekiel",48],["Daniel",12],["Hosea",14],["Joel",3],
  ["Amos",9],["Obadiah",1],["Jonah",4],["Micah",7],["Nahum",3],["Habakkuk",3],
  ["Zephaniah",3],["Haggai",2],["Zechariah",14],["Malachi",4],
  ["Matthew",28],["Mark",16],["Luke",24],["John",21],["Acts",28],["Romans",16],
  ["1 Corinthians",16],["2 Corinthians",13],["Galatians",6],["Ephesians",6],
  ["Philippians",4],["Colossians",4],["1 Thessalonians",5],["2 Thessalonians",3],
  ["1 Timothy",6],["2 Timothy",4],["Titus",3],["Philemon",1],["Hebrews",13],
  ["James",5],["1 Peter",5],["2 Peter",3],["1 John",5],["2 John",1],["3 John",1],
  ["Jude",1],["Revelation",22]
];
const $ = id => document.getElementById(id);
const BOOKMARK_KEY = "bible-reader-bookmarks-v1";
const SIZE_KEY = "bible-reader-size-v1";
let bookmarks = [];
let fontSize = 20;
let current = null;
let controller = null;
let requestNumber = 0;
let lastReference = "John 1";
let displayedVerses = [];
const cache = new Map();

function storageWarning() {
  $("storage-message").textContent = "Browser storage is unavailable or full. Changes will last only while this page stays open.";
}
try {
  const saved = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]");
  if (Array.isArray(saved)) bookmarks = saved.filter(b => b && typeof b.reference === "string" && typeof b.text === "string");
  fontSize = Math.min(30, Math.max(16, Number(localStorage.getItem(SIZE_KEY)) || 20));
} catch { storageWarning(); }

function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { storageWarning(); }
}
function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function fillChapters(chapter = 1) {
  const count = books[Number($("book").value)][1];
  $("chapter").replaceChildren(...Array.from({length: count}, (_, i) => new Option(i + 1, i + 1)));
  $("chapter").value = String(Math.min(count, chapter));
}
function applySize() {
  document.documentElement.style.setProperty("--verse-size", fontSize + "px");
  $("smaller").disabled = fontSize <= 16;
  $("larger").disabled = fontSize >= 30;
}
function updateNavigation() {
  const busy = $("verses").getAttribute("aria-busy") === "true";
  $("previous").disabled = busy || !current || (current.book === 0 && current.chapter === 1);
  $("next").disabled = busy || !current || (current.book === books.length - 1 && current.chapter === 22);
}
function renderVerses() {
  $("verses").replaceChildren();
  for (const verse of displayedVerses) {
    const reference = `${verse.book_name} ${verse.chapter}:${verse.verse}`;
    const row = make("div", "verse");
    const paragraph = make("p");
    paragraph.append(make("sup", "", String(verse.verse)), document.createTextNode(verse.text.trim()));
    const saved = bookmarks.some(b => b.reference === reference);
    const button = make("button", "outline save", saved ? "Saved ✓" : "Save");
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", `${saved ? "Remove bookmark for" : "Bookmark"} ${reference}`);
    button.addEventListener("click", () => {
      if (bookmarks.some(b => b.reference === reference)) bookmarks = bookmarks.filter(b => b.reference !== reference);
      else bookmarks.push({reference, text: verse.text.trim()});
      persist(BOOKMARK_KEY, bookmarks);
      renderBookmarks();
      renderVerses();
    });
    row.append(paragraph, button);
    $("verses").append(row);
  }
}
function renderBookmarks() {
  const list = $("bookmark-list");
  list.replaceChildren();
  if (!bookmarks.length) list.append(make("li", "hint", "No bookmarks yet. Your favorite verses will appear here."));
  for (const bookmark of bookmarks) {
    const item = make("li");
    const open = make("button", "bookmark-open", bookmark.reference);
    open.addEventListener("click", () => loadPassage(bookmark.reference));
    const remove = make("button", "outline remove", "Remove");
    remove.setAttribute("aria-label", `Remove ${bookmark.reference}`);
    remove.addEventListener("click", () => {
      bookmarks = bookmarks.filter(b => b.reference !== bookmark.reference);
      persist(BOOKMARK_KEY, bookmarks);
      renderBookmarks();
      renderVerses();
    });
    item.append(open, make("p", "bookmark-text", bookmark.text), remove);
    list.append(item);
  }
}

async function loadPassage(reference) {
  const query = reference.trim().replace(/[–—]/g, "-");
  if (!query) return;
  lastReference = query;
  const request = ++requestNumber;
  if (controller) controller.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => controller && request === requestNumber && controller.abort(), 15000);
  $("verses").setAttribute("aria-busy", "true");
  $("verses").replaceChildren();
  displayedVerses = [];
  current = null;
  $("passage-title").textContent = "Opening passage…";
  $("message").className = "";
  $("message").textContent = "Loading your passage…";
  $("retry").hidden = true;
  updateNavigation();
  try {
    let data = cache.get(query.toLowerCase());
    if (!data) {
      // This option returns the entire chapter for single-chapter books.
      const url = `https://bible-api.com/${encodeURIComponent(query)}?translation=web&single_chapter_book_matching=indifferent`;
      const response = await fetch(url, {signal});
      if (response.status === 429) throw new Error("Too many requests. Please wait 30 seconds and try again.");
      if (response.status === 404 || response.status === 400) throw new Error("Passage not found. Try a reference such as John 3:16 or Psalm 23.");
      if (!response.ok) throw new Error(`The Bible service is unavailable (HTTP ${response.status}). Please try again later.`);
      data = await response.json();
      if (data.error || !Array.isArray(data.verses) || !data.verses.length) throw new Error("No verses found. Check the book, chapter, and verse numbers.");
      if (cache.size >= 30) cache.delete(cache.keys().next().value);
      cache.set(query.toLowerCase(), data);
    }
    if (request !== requestNumber) return;
    displayedVerses = data.verses;
    $("passage-title").textContent = data.reference || query;
    $("message").textContent = "World English Bible · Tap Save to bookmark a verse.";
    const first = data.verses[0];
    const index = books.findIndex(b => b[0].toLowerCase() === first.book_name.toLowerCase());
    if (index >= 0) {
      current = {book: index, chapter: Number(first.chapter)};
      $("book").value = String(index);
      fillChapters(current.chapter);
    }
    renderVerses();
  } catch (error) {
    if (request !== requestNumber) return;
    $("passage-title").textContent = "Unable to load passage";
    $("message").className = "error";
    $("message").textContent = error.name === "AbortError"
      ? "The request took too long. Check your internet connection and try again."
      : error instanceof TypeError
        ? "Could not connect to the Bible service. Check your internet connection or try again later."
        : error.message;
    $("retry").hidden = false;
  } finally {
    clearTimeout(timer);
    if (request === requestNumber) {
      $("verses").setAttribute("aria-busy", "false");
      updateNavigation();
    }
  }
}

function navigate(direction) {
  if (!current) return;
  let {book, chapter} = current;
  chapter += direction;
  if (chapter < 1) { book--; if (book < 0) return; chapter = books[book][1]; }
  if (chapter > books[book][1]) { book++; if (book >= books.length) return; chapter = 1; }
  loadPassage(`${books[book][0]} ${chapter}`);
}
$("book").replaceChildren(...books.map((book, i) => new Option(book[0], i)));
$("book").value = String(books.findIndex(b => b[0] === "John"));
fillChapters();
$("book").addEventListener("change", () => fillChapters());
$("chapter-form").addEventListener("submit", event => {
  event.preventDefault();
  loadPassage(`${books[Number($("book").value)][0]} ${$("chapter").value}`);
});
$("search-form").addEventListener("submit", event => { event.preventDefault(); loadPassage($("search").value); });
$("retry").addEventListener("click", () => loadPassage(lastReference));
$("previous").addEventListener("click", () => navigate(-1));
$("next").addEventListener("click", () => navigate(1));
for (const [id, delta] of [["smaller", -2], ["larger", 2]]) {
  $(id).addEventListener("click", () => { fontSize = Math.min(30, Math.max(16, fontSize + delta)); applySize(); persist(SIZE_KEY, fontSize); });
}
applySize();
renderBookmarks();
loadPassage("John 1");
