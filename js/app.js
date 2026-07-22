/* ================= State ================= */
const state = {
  lang: localStorage.getItem("lang") || "en",
  theme: localStorage.getItem("theme") || "dark",
  selected: new Set(JSON.parse(localStorage.getItem("selected") || "[]")), // "book|lesson"
  specified: new Set(),   // word ids chosen in "specify" (subset of selected lessons)
  deck: [], index: 0, flipped: false,
  known: new Set(), review: new Set(), deckTitle: "", sourceWords: [],
  favorites: new Set(JSON.parse(localStorage.getItem("favorites") || "[]")),
};

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const t = (k) => (UI[state.lang] && UI[state.lang][k]) || UI.en[k] || k;
const lkey = (b, l) => b + "|" + l;
const wordById = new Map(WORDS.map(w => [w.id, w]));

/* Build the front-of-card markup with real furigana: the small reading sits
   only above the kanji part of the word, not above a trailing hiragana
   ending (e.g. します in 留学します) since that part is already plain kana. */
function frontFurigana(w){
  if(!w.rd) return `<div class="fc-jp-line">${w.jp}</div>`;
  const isHiragana = ch => /[ぁ-んー]/.test(ch);
  let cut = w.jp.length;
  while(cut > 0 && isHiragana(w.jp[cut - 1])) cut--;
  const kanjiPart = w.jp.slice(0, cut);
  const suffix = w.jp.slice(cut);
  if(!kanjiPart) return `<div class="fc-jp-line">${w.jp}</div>`;   // whole word is kana, no furigana needed
  const reading = suffix ? w.rd.slice(0, w.rd.length - suffix.length) : w.rd;
  return `<div class="fc-jp-line"><ruby>${kanjiPart}<rt class="fc-reading">${reading}</rt></ruby>${suffix}</div>`;
}

/* shrink the word on the front of the card just enough to keep it on one
   line, in case the furigana is wide enough to push it past the card edge */
function fitFrontLine(){
  const line = $("#cardFront .fc-jp-line");
  const face = $("#cardFront");
  if(!line || !face) return;
  line.style.fontSize = "";
  const maxWidth = face.clientWidth - 40; // roughly matches the card's own padding
  let size = parseFloat(getComputedStyle(line).fontSize);
  let guard = 30;
  while(line.scrollWidth > maxWidth && size > 18 && guard-- > 0){
    size -= 2;
    line.style.fontSize = size + "px";
  }
}

/* save the in-progress flashcard session so a page refresh doesn't lose it */
function persistSession(){
  const session = JSON.parse(localStorage.getItem("session") || "{}");
  session.view = document.body.dataset.view;
  session.deckIds = state.deck.map(w => w.id);
  session.sourceIds = state.sourceWords.map(w => w.id);
  session.index = state.index;
  session.known = [...state.known];
  session.review = [...state.review];
  session.deckTitle = state.deckTitle;
  localStorage.setItem("session", JSON.stringify(session));
}

/* words present for a given book+lesson */
const hasWords = (b, l) => WORDS.some(w => w.b === b && w.l === l);
const wordsInLesson = (b, l) => WORDS.filter(w => w.b === b && w.l === l);

function selectedWords(){
  const out = [];
  for(const key of state.selected){
    const [b, l] = key.split("|");
    out.push(...wordsInLesson(b, +l));
  }
  return out;
}

/* ================= i18n ================= */
function applyI18n(){
  $$("[data-i18n]").forEach(el => el.textContent = t(el.dataset.i18n));
  $("#langSelect").value = state.lang;
  // refresh dynamic screens that show translations
  if(document.body.dataset.view === "specify") renderSpecify();
  if(document.body.dataset.view === "cards") renderCard();
  if(document.body.dataset.view === "lessons") { renderSingleBooks(); }
  renderBooks();
  updateActionbar();
}

/* ================= Views + browser history ================= */
function setView(name){
  document.body.dataset.view = name;
  window.scrollTo({top:0, behavior:"instant"});
  // remember which screen was open, so a refresh can return to it
  const session = JSON.parse(localStorage.getItem("session") || "{}");
  session.view = name;
  localStorage.setItem("session", JSON.stringify(session));
}
/* go() = navigate AND add a step to browser history, so the back/forward
   arrows move between screens instead of leaving the site. */
function go(name){
  if(document.body.dataset.view !== name){
    history.pushState({view:name}, "");
  }
  setView(name);
}

/* ================= Home: multi-select lesson grid ================= */
function tileEl(b, l){
  const el = document.createElement("button");
  const filled = hasWords(b, l);
  el.className = "tile" + (filled ? "" : " is-empty") + (state.selected.has(lkey(b,l)) ? " is-selected" : "");
  el.dataset.book = b; el.dataset.lesson = l; el.dataset.fill = filled ? "1" : "0";
  const count = filled ? wordsInLesson(b,l).length : 0;
  const label = filled ? `${count} ${count === 1 ? t("word") : t("word_plural")}` : "";
  el.innerHTML = `${l}<small>${label}</small>`;
  return el;
}

function bookBlock(book, single=false){
  const wrap = document.createElement("div");
  wrap.className = "book";
  const activeCount = Array.from({length:book.lessons}, (_,i)=>book.start+i)
    .filter(l => hasWords(book.id, l)).length;
  wrap.innerHTML = `
    <div class="book__head">
      <span class="book__name">${book.name}</span>
      <span class="badge ${book.level==='n4'?'badge--n4':''}">${book.level.toUpperCase()}</span>
      <span class="book__hint">${activeCount ? activeCount + " ready" : "coming soon"}</span>
    </div>`;
  const grid = document.createElement("div");
  grid.className = "lessons-grid";
  for(let i=0;i<book.lessons;i++){
    const l = book.start + i;
    grid.appendChild(tileEl(book.id, l));
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderBooks(){
  const wrap = $("#booksWrap");
  wrap.innerHTML = "";
  BOOKS.forEach(b => wrap.appendChild(bookBlock(b)));
  if(!wrap.dataset.dragReady){ enableDragSelect(wrap); wrap.dataset.dragReady = "1"; }
  updateActionbar();
}

/* --- drag to select many tiles (works with mouse & touch) --- */
function enableDragSelect(root){
  let dragging = false, mode = true, touched = new Set();

  const tileAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest(".tile") : null;
  };
  const apply = (tile) => {
    if(!tile || tile.dataset.fill !== "1") return;
    const key = lkey(tile.dataset.book, +tile.dataset.lesson);
    if(touched.has(key)) return;
    touched.add(key);
    if(mode){ state.selected.add(key); tile.classList.add("is-selected"); }
    else    { state.selected.delete(key); tile.classList.remove("is-selected"); }
  };

  root.addEventListener("pointerdown", (e) => {
    const tile = e.target.closest(".tile");
    if(!tile || tile.dataset.fill !== "1") return;
    dragging = true; touched = new Set();
    mode = !state.selected.has(lkey(tile.dataset.book, +tile.dataset.lesson)); // select vs deselect
    apply(tile);
    e.preventDefault();
  });
  document.addEventListener("pointermove", (e) => {
    if(!dragging) return;
    apply(tileAt(e.clientX, e.clientY));
    e.preventDefault();
  }, {passive:false});
  const end = () => {
    if(!dragging) return;
    dragging = false;
    state.specified.clear();               // changing lessons resets word picks
    persist(); updateActionbar();
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
}

/* ================= Action bar ================= */
function updateActionbar(){
  const words = state.specified.size ? [...state.specified] : selectedWords();
  const n = state.specified.size || words.length;
  $("#selCount").textContent = n;
  $("#studyBtn").disabled = n === 0;
  $("#specifyBtn").disabled = selectedWords().length === 0;
}

/* ================= Specify words ================= */
function renderSpecify(){
  const list = $("#specifyList");
  const q = ($("#wordSearch").value || "").trim().toLowerCase();
  const groups = {};
  selectedWords().forEach(w => {
    const g = w.b + "|" + w.l;
    (groups[g] = groups[g] || []).push(w);
  });
  const keys = Object.keys(groups);
  if(keys.length === 0){
    list.innerHTML = `<p class="empty-note">${t("no_words")}</p>`;
    return;
  }
  list.innerHTML = "";
  keys.forEach(g => {
    const [b, l] = g.split("|");
    const book = BOOKS.find(x=>x.id===b);
    const items = groups[g].filter(w =>
      !q || w.jp.toLowerCase().includes(q) || w.ro.toLowerCase().includes(q) ||
      (w[state.lang]||"").toLowerCase().includes(q) || w.en.toLowerCase().includes(q));
    if(!items.length) return;
    const gr = document.createElement("div");
    gr.className = "specify-group";
    gr.innerHTML = `<h3>${book.name} · ${t("lessons")==="Lessons"?"Lesson":t("lessons")} ${l}</h3>`;
    items.forEach(w => {
      const on = state.specified.has(w.id);
      const row = document.createElement("label");
      row.className = "check-word" + (on ? " is-on" : "");
      row.innerHTML = `
        <input type="checkbox" ${on?"checked":""} data-id="${w.id}">
        <span class="jp">${w.jp}</span>
        <span class="rd">${w.rd}</span>
        <span class="tr">${w[state.lang]}</span>`;
      row.querySelector("input").addEventListener("change", (e) => {
        if(e.target.checked){ state.specified.add(w.id); row.classList.add("is-on"); }
        else { state.specified.delete(w.id); row.classList.remove("is-on"); }
        updateActionbar();
      });
      gr.appendChild(row);
    });
    list.appendChild(gr);
  });
}

/* ================= Single lesson page ================= */
function renderSingleBooks(){
  const wrap = $("#singleBooks");
  wrap.innerHTML = "";
  BOOKS.forEach(book => {
    const block = bookBlock(book, true);
    // single-select behaviour: tap shows preview
    block.querySelectorAll(".tile").forEach(tile => {
      tile.classList.remove("is-selected");
      tile.addEventListener("click", () => {
        if(tile.dataset.fill !== "1") return;
        showLessonPreview(tile.dataset.book, +tile.dataset.lesson, block);
      });
    });
    wrap.appendChild(block);
  });
  $("#lessonPreview").hidden = true;
}

function showLessonPreview(b, l, block){
  $$("#singleBooks .tile").forEach(x=>x.classList.remove("is-selected"));
  block.querySelector(`.tile[data-book="${b}"][data-lesson="${l}"]`).classList.add("is-selected");
  const words = wordsInLesson(b, l);
  const book = BOOKS.find(x=>x.id===b);
  const pv = $("#lessonPreview");
  pv.hidden = false;
  pv.innerHTML = `<h3>${book.name} · ${l}</h3>` +
    words.map(w => `
      <div class="word-row">
        <span class="jp">${w.jp}</span>
        <span class="rd">${w.rd}</span>
        <span class="tr">${w[state.lang]}</span>
      </div>`).join("") +
    `<button class="btn btn--primary" style="margin-top:16px;width:100%" id="studyLessonBtn">${t("study_lesson")}</button>`;
  $("#studyLessonBtn").addEventListener("click", () => {
    startDeck(words, `${book.name} · ${l}`);
  });
  pv.scrollIntoView({behavior:"smooth", block:"nearest"});
}

/* ================= Flashcards ================= */
function startDeck(words, title){
  if(!words.length) return;
  state.deck = words.slice();
  state.sourceWords = words.slice();
  state.deckTitle = title;
  state.index = 0; state.flipped = false;
  state.known = new Set(); state.review = new Set();
  $("#deckTitle").textContent = title;
  showDone(false);
  go("cards");
  renderCard();
}

function renderCard(){
  const w = state.deck[state.index];
  if(!w) return;
  $("#soundBtn").hidden = !canSpeak;
  $("#favBtn").classList.toggle("is-fav", state.favorites.has(w.id));
  const done = state.known.size + state.review.size;
  $("#deckProgress").textContent =
    `${state.index+1} / ${state.deck.length}  ·  ${t("known")} ${state.known.size}  ·  ${t("review")} ${state.review.size}`;
  const fc = $("#flashcard");
  const inner = fc.querySelector(".flashcard__inner");
  // snap the new card to its FRONT with no animation, so you never
  // catch a glimpse of the previous card's back flipping around
  inner.style.transition = "none";
  fc.classList.remove("is-flipped");
  fc.style.transition = "none";
  fc.style.transform = "";
  fc.style.opacity = "1";
  void fc.offsetWidth;              // force the browser to apply it now
  inner.style.transition = "";     // re-enable the flip animation
  state.flipped = false;
  // show the reading as furigana, sitting only above the kanji part
  $("#cardFront").innerHTML = frontFurigana(w);
  fitFrontLine();   // shrink to fit if the furigana makes the line too wide to stay on one line
  // on the back, show kanji only (never hiragana/katakana); katakana/kana-only
  // words show just their meaning + picture
  const hasKanji = /[㐀-䶿一-鿿]/.test(w.jp);
  const subParts = [];
  if(hasKanji) subParts.push(w.jp);
  if(state.lang !== "en" && w.en !== w[state.lang]) subParts.push(w.en);
  const pic = pictureFor(w);
  $("#cardBack").innerHTML = `
    ${pic ? `<div class="fc-pic">${pic}</div>` : ""}
    <div class="fc-mean">${w[state.lang]}</div>
    <div class="fc-mean-sub">${subParts.join(" · ")}</div>`;
  persistSession();
}

/* speak the current card's Japanese word aloud using the browser's built-in voice */
const canSpeak = "speechSynthesis" in window;
function speakJapanese(text){
  if(!canSpeak || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  speechSynthesis.speak(u);
}

function flip(){ state.flipped = !state.flipped; $("#flashcard").classList.toggle("is-flipped", state.flipped); }

/* slide the current card out of the way, swap its content, then slide the new one in */
function advanceCard(newIndex, dir){
  const card = $("#flashcard");
  card.style.transition = "transform .22s ease, opacity .22s ease";
  card.style.transform = `translateX(${dir > 0 ? -50 : 50}px)`;
  card.style.opacity = "0";
  setTimeout(() => {
    state.index = newIndex;
    renderCard();   // snaps new content in place instantly, hidden by the steps below
    card.style.transition = "none";
    card.style.transform = `translateX(${dir > 0 ? 50 : -50}px)`;
    card.style.opacity = "0";
    void card.offsetWidth;   // apply that instantly before animating
    card.style.transition = "transform .22s ease, opacity .22s ease";
    card.style.transform = "translateX(0)";
    card.style.opacity = "1";
  }, 220);
}
function nextCard(){ if(state.index < state.deck.length-1){ advanceCard(state.index+1, 1); } else finishDeck(); }
function prevCard(){ if(state.index > 0){ advanceCard(state.index-1, -1); } }
function shuffleDeck(){
  for(let i=state.deck.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [state.deck[i],state.deck[j]] = [state.deck[j],state.deck[i]];
  }
  state.index = 0; renderCard();
}

/* mark current card known / review, then move on */
function markCard(isKnown){
  const w = state.deck[state.index];
  if(!w) return;
  if(isKnown){ state.known.add(w.id); state.review.delete(w.id); }
  else { state.review.add(w.id); state.known.delete(w.id); }
  if(state.index < state.deck.length-1){ state.index++; renderCard(); }
  else finishDeck();
}

/* keyboard version of marking known/review: slide the card up (known)
   or down (unknown) so it matches the swipe gesture visually */
function markCardWithSlide(isKnown){
  const w = state.deck[state.index];
  if(!w) return;
  const card = $("#flashcard");
  card.style.transition = "transform .22s ease, opacity .22s ease";
  card.style.transform = `translateY(${isKnown ? -60 : 60}px)`;
  card.style.opacity = "0";
  setTimeout(() => {
    markCard(isKnown);   // updates state and (if not finished) re-renders the next card
    card.style.transition = "none";
    card.style.transform = `translateY(${isKnown ? 60 : -60}px)`;
    card.style.opacity = "0";
    void card.offsetWidth;
    card.style.transition = "transform .22s ease, opacity .22s ease";
    card.style.transform = "translateY(0)";
    card.style.opacity = "1";
  }, 220);
}

/* show / hide the end-of-deck screen */
function showDone(on){
  $("#cardStage").hidden = on;
  $("#cardControls").hidden = on;
  $("#deckDone").hidden = !on;
}
function finishDeck(){
  const reviewWords = state.sourceWords.filter(w => state.review.has(w.id));
  const total = state.deck.length;
  $("#doneTitle").textContent = t("session_done");
  $("#doneSub").textContent = reviewWords.length
    ? `${t("known")} ${state.known.size} / ${total}  ·  ${t("review")} ${reviewWords.length}`
    : t("done_all");
  const rBtn = $("#reviewAgainBtn");
  rBtn.hidden = reviewWords.length === 0;
  rBtn.textContent = t("review_again");
  $("#restartBtn").textContent = t("restart");
  showDone(true);
  persistSession();
}

/* ---- swipe gesture on the card (right = known, left = review) ---- */
function enableSwipe(){
  const card = $("#flashcard");
  let sx=0, sy=0, dragging=false, moved=false, decided=false;
  const TH = 90; // pixels to count as a real swipe

  card.addEventListener("pointerdown", e => {
    dragging=true; moved=false; decided=false;
    sx=e.clientX; sy=e.clientY;
    card.style.transition="none";
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", e => {
    if(!dragging) return;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    if(Math.abs(dx)>6 || Math.abs(dy)>6) moved=true;
    if(Math.abs(dx) < Math.abs(dy)) return; // vertical → let page scroll
    card.style.transform = `translateX(${dx}px) rotate(${dx/22}deg)`;
    $("#badgeKnown").style.opacity = Math.max(0, Math.min(1, dx/TH));
    $("#badgeAgain").style.opacity = Math.max(0, Math.min(1, -dx/TH));
  });
  const release = e => {
    if(!dragging) return;
    dragging=false;
    const dx=e.clientX-sx, dy=e.clientY-sy;
    card.style.transition="transform .28s ease, opacity .28s ease";
    $("#badgeKnown").style.opacity=0; $("#badgeAgain").style.opacity=0;
    if(Math.abs(dx) > TH && Math.abs(dx) > Math.abs(dy)){
      const known = dx > 0;
      card.style.transform = `translateX(${known?520:-520}px) rotate(${known?24:-24}deg)`;
      card.style.opacity = "0";
      setTimeout(() => markCard(known), 220);
    } else {
      card.style.transform = "";
      if(!moved) flip(); // it was a tap, not a swipe
    }
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", () => { dragging=false; card.style.transform=""; $("#badgeKnown").style.opacity=0; $("#badgeAgain").style.opacity=0; });
}

/* ================= Theme ================= */
function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.theme);
  const btn = $("#themeToggle");
  if(btn) btn.textContent = state.theme === "light" ? "◑" : "◐";
  localStorage.setItem("theme", state.theme);
}
function toggleTheme(){
  state.theme = state.theme === "light" ? "dark" : "light";
  applyTheme();
}

/* ================= Persist ================= */
function persist(){
  localStorage.setItem("lang", state.lang);
  localStorage.setItem("selected", JSON.stringify([...state.selected]));
  localStorage.setItem("favorites", JSON.stringify([...state.favorites]));
}

/* bring back an in-progress flashcard session after a page refresh.
   Returns true if a session was actually restored. */
function restoreSession(){
  let session;
  try { session = JSON.parse(localStorage.getItem("session") || "null"); }
  catch(e){ session = null; }
  if(!session || session.view !== "cards" || !Array.isArray(session.deckIds) || !session.deckIds.length) return false;

  const deck = session.deckIds.map(id => wordById.get(id)).filter(Boolean);
  if(!deck.length) return false;
  const sourceWords = (session.sourceIds || []).map(id => wordById.get(id)).filter(Boolean);

  state.deck = deck;
  state.sourceWords = sourceWords.length ? sourceWords : deck.slice();
  state.index = Math.min(Math.max(session.index || 0, 0), deck.length - 1);
  state.known = new Set(session.known || []);
  state.review = new Set(session.review || []);
  state.deckTitle = session.deckTitle || t("flashcards");
  $("#deckTitle").textContent = state.deckTitle;
  document.body.dataset.view = "cards";

  if(state.known.size + state.review.size >= state.deck.length) finishDeck();
  else { showDone(false); renderCard(); }
  return true;
}

/* ================= Wire up ================= */
function init(){
  applyTheme();
  renderBooks();
  applyI18n();
  $("#themeToggle").addEventListener("click", toggleTheme);
  const restored = restoreSession();   // put a refreshed page back where it left off
  history.replaceState({view: restored ? "cards" : "home"}, ""); // first history step
  window.addEventListener("popstate", e => setView((e.state && e.state.view) || "home"));

  $("#langSelect").addEventListener("change", e => { state.lang = e.target.value; persist(); applyI18n(); });
  $("#brandBtn").addEventListener("click", () => go("home"));

  $("#navFlashcards").addEventListener("click", () => {
    const words = state.specified.size ? selectedWords().filter(w=>state.specified.has(w.id)) : selectedWords();
    if(!words.length){ go("home"); return; }
    startDeck(words, t("flashcards"));
  });
  $("#navLessons").addEventListener("click", () => { renderSingleBooks(); go("lessons"); });

  $("#studyBtn").addEventListener("click", () => {
    const words = state.specified.size ? selectedWords().filter(w=>state.specified.has(w.id)) : selectedWords();
    startDeck(words, t("flashcards"));
  });
  $("#specifyBtn").addEventListener("click", () => { renderSpecify(); go("specify"); });

  $$("[data-goto]").forEach(b => b.addEventListener("click", () => history.back()));

  $("#wordSearch").addEventListener("input", renderSpecify);
  $("#selectAllWords").addEventListener("click", () => {
    selectedWords().forEach(w => state.specified.add(w.id)); renderSpecify(); updateActionbar();
  });
  $("#clearWords").addEventListener("click", () => { state.specified.clear(); renderSpecify(); updateActionbar(); });

  // flashcard controls
  enableSwipe();
  $("#flipBtn").addEventListener("click", flip);
  $("#soundBtn").addEventListener("click", () => {
    const w = state.deck[state.index];
    if(w) speakJapanese(w.jp);
  });
  // the star sits inside the flashcard, so stop its taps from also
  // triggering the card's own tap-to-flip / swipe behavior
  $("#favBtn").addEventListener("pointerdown", e => e.stopPropagation());
  $("#favBtn").addEventListener("click", () => {
    const w = state.deck[state.index];
    if(!w) return;
    if(state.favorites.has(w.id)) state.favorites.delete(w.id);
    else state.favorites.add(w.id);
    persist();
    $("#favBtn").classList.toggle("is-fav", state.favorites.has(w.id));
  });
  $("#nextBtn").addEventListener("click", nextCard);
  $("#prevBtn").addEventListener("click", prevCard);
  $("#shuffleBtn").addEventListener("click", shuffleDeck);
  $("#reviewAgainBtn").addEventListener("click", () => {
    const reviewWords = state.sourceWords.filter(w => state.review.has(w.id));
    startDeck(reviewWords, t("review"));
  });
  $("#restartBtn").addEventListener("click", () => startDeck(state.sourceWords, state.deckTitle));
  document.addEventListener("keydown", e => {
    if(document.body.dataset.view !== "cards") return;
    if(e.key === "ArrowRight") nextCard();
    if(e.key === "ArrowLeft") prevCard();
    if(e.key === "ArrowUp"){ e.preventDefault(); markCardWithSlide(true); }
    if(e.key === "ArrowDown"){ e.preventDefault(); markCardWithSlide(false); }
    if(e.key === " " || e.key === "Enter"){ e.preventDefault(); flip(); }
  });
}

document.addEventListener("DOMContentLoaded", init);
