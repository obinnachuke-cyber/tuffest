/* TUFFEST — vibe archive. Plain JS, no build step.
   Sections: config · utils · storage · images · maps · caption · theme · state ·
             folders · deck · panel · composer · settings · boot                 */
(() => {
'use strict';

/* ============================== config ============================== */
const PALETTE = ['#7a1747', '#e5531f', '#1b8a5a', '#2547d0', '#d6202c', '#6a1b8f', '#b8307a', '#0f7f93'];
const TAB_X = [0, 36, 14, 50, 24, 44];            // % offsets: tabs stagger like the folder reference
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3).toUpperCase());
const DAYS3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const KEY_STORE = 'tuffest.mapsKey';
const THEME_STORE = 'tuffest.theme';
const THEME_COLORS = { white: '#ffffff', blue: '#d9e8ff', pink: '#ffdce8' };
const MAX_PHOTOS = 4;                 // photos per vibe
const GROUP_GAP = 3 * 3600 * 1000;    // photos taken more than 3h apart start a new vibe
const WEEKS_AFTER = MAX_PHOTOS;       // a month gets week/grid controls once it holds more than this many vibes

/* ============================== utils =============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hash = str => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** Small seeded random generator (mulberry32): same seed, same sequence, so a card always looks the same. */
const rng = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const parseISO = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = iso => {
  const d = parseISO(iso);
  return `${DAYS3[d.getDay()]} ${pad(d.getDate())} ${MON3[d.getMonth()]} ${d.getFullYear()}`;
};

/** Accepts "51.5074, -0.1278" (what Google Maps copies) -> {lat, lng} or null. */
function parseCoords(str) {
  const m = String(str).match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
const fmtCoords = (lat, lng) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
const coordText = (lat, lng) => (lat == null ? '' : `${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}`);

/** The link hidden behind a place's name. Best available: the exact Google place > coordinates >
    the "find it on Maps" text > the name itself. Works without an API key (it's a plain search link).
    A place has two texts: `name` is what the caption shows ("maru"), `placeName`/`q` is what Maps looks up. */
function mapsLink(s) {
  let q;
  if (s.placeId) q = `query=${encodeURIComponent(s.placeName || s.q || s.name || '')}&query_place_id=${s.placeId}`;
  else if (s.lat != null) q = `query=${s.lat},${s.lng}`;
  else q = `query=${encodeURIComponent(s.q || s.name || '')}`;
  return `https://www.google.com/maps/search/?api=1&${q}`;
}
const locLabel = s => s.name || fmtCoords(s.lat, s.lng);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ============================== storage ============================= */
/* IndexedDB holds the vibes (photos stored as Blobs). Falls back to memory if unavailable. */
const DB = (() => {
  let dbp, mem = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('tuffest', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('vibes', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('vibes', mode);
      const req = fn(t.objectStore('vibes'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  };
  const guard = async (fn, memFn) => {
    if (mem) return memFn();
    try { return await fn(); }
    catch (e) { console.warn('IndexedDB unavailable, using memory', e); mem = []; toast('Storage unavailable — vibes won’t be saved'); return memFn(); }
  };
  return {
    all: () => guard(() => run('readonly', s => s.getAll()), () => mem),
    put: v => guard(() => run('readwrite', s => s.put(v)), () => { mem = mem.filter(x => x.id !== v.id).concat(v); }),
    del: id => guard(() => run('readwrite', s => s.delete(id)), () => { mem = mem.filter(x => x.id !== id); }),
    clear: () => guard(() => run('readwrite', s => s.clear()), () => { mem = []; }),
  };
})();

/* ============================== images ============================== */
/** Downscale to 1600px JPEG so a year of photos stays small. Respects EXIF rotation.
    Returns the blob plus its pixel size, which drives the card layout. */
async function compress(file, max = 1600, quality = 0.82) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    const blob = await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', quality));
    return { blob, w: c.width, h: c.height };
  } catch (e) {
    return { blob: file, ...(await dimsOf(file)) }; // unreadable by the canvas path: keep the original
  }
}

async function dimsOf(blob) {
  try {
    const b = await createImageBitmap(blob);
    const d = { w: b.width, h: b.height };
    b.close && b.close();
    return d;
  } catch (e) {
    return { w: 4, h: 3 };
  }
}

/* --- photo layout ---------------------------------------------------------------------------
   Every photo keeps its real shape (an iPhone portrait is 3:4, a landscape 4:3). For the photos in a
   vibe we build several candidate arrangements, in which each photo gets a frame that fits its own
   shape exactly, then score them:
     - crop:  how much of each photo the frame would cut off
     - height: the whole block must stay compact (never longer than ~1.4 x the card's width), so a
               tall arrangement is squashed, which costs crop
     - size:  no frame should be a tiny thumbnail
   The lowest score wins. So three portraits become one big 3:4 beside two small ones, three
   landscapes become one big on top with two below, and nothing is cropped when it doesn't have to be.

   All numbers are relative to the block's width (width = 1), so the same layout draws on screen,
   on the public page and on the story image.                                                       */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const PH_GAP = 0.02; // space between frames, as a fraction of the width

function layoutOf(dims, { hMax = 1.4, hMin = 0.55 } = {}) {
  const a = dims.map(([w, h]) => w / h);          // each photo's aspect, width / height
  const n = a.length, g = PH_GAP;
  const cands = [];
  const add = (name, label, cells) => cands.push({ name, label, cells, H: Math.max(...cells.map(c => c.y + c.h)) });
  const sum = arr => arr.reduce((s, x) => s + x, 0);

  if (n === 1) add('single', 'single frame', [{ x: 0, y: 0, w: 1, h: 1 / a[0] }]);

  if (n === 2) {
    const h = (1 - g) / (a[0] + a[1]);            // side by side, equal height
    add('side', 'side by side', [{ x: 0, y: 0, w: a[0] * h, h }, { x: a[0] * h + g, y: 0, w: a[1] * h, h }]);
    add('stack', 'stacked', [{ x: 0, y: 0, w: 1, h: 1 / a[0] }, { x: 0, y: 1 / a[0] + g, w: 1, h: 1 / a[1] }]);
  }

  if (n === 3) {
    const [A, B, C] = a;
    const h = (1 - 2 * g) / (A + B + C);          // row of three
    add('row', 'row of three', [{ x: 0, y: 0, w: A * h, h }, { x: A * h + g, y: 0, w: B * h, h }, { x: (A + B) * h + 2 * g, y: 0, w: C * h, h }]);
    { // one big on the left, two stacked on the right: widths solved so all three fit exactly
      const wR = (1 - g - A * g) / (A * (1 / B + 1 / C) + 1), hB = wR / B, hC = wR / C, H = hB + g + hC, wL = A * H;
      add('heroL', 'one big, two small', [{ x: 0, y: 0, w: wL, h: H }, { x: wL + g, y: 0, w: wR, h: hB }, { x: wL + g, y: hB + g, w: wR, h: hC }]);
    }
    { // one big on top, two side by side below
      const hA = 1 / A, h = (1 - g) / (B + C);
      add('heroT', 'one big, two small', [{ x: 0, y: 0, w: 1, h: hA }, { x: 0, y: hA + g, w: B * h, h }, { x: B * h + g, y: hA + g, w: C * h, h }]);
    }
    add('stack3', 'stacked', [{ x: 0, y: 0, w: 1, h: 1 / A }, { x: 0, y: 1 / A + g, w: 1, h: 1 / B }, { x: 0, y: 1 / A + 1 / B + 2 * g, w: 1, h: 1 / C }]);
  }

  if (n === 4) {
    const [A, B, C, D] = a;
    { // two justified rows
      const h1 = (1 - g) / (A + B), h2 = (1 - g) / (C + D), y2 = h1 + g;
      add('rows', 'two rows', [
        { x: 0, y: 0, w: A * h1, h: h1 }, { x: A * h1 + g, y: 0, w: B * h1, h: h1 },
        { x: 0, y: y2, w: C * h2, h: h2 }, { x: C * h2 + g, y: y2, w: D * h2, h: h2 }]);
    }
    { // even 2 x 2
      const s = (1 - g) / 2;
      add('grid', '2 × 2 grid', [{ x: 0, y: 0, w: s, h: s }, { x: s + g, y: 0, w: s, h: s }, { x: 0, y: s + g, w: s, h: s }, { x: s + g, y: s + g, w: s, h: s }]);
    }
    { // one big on the left, three stacked on the right
      const wR = (1 - g - A * 2 * g) / (A * (1 / B + 1 / C + 1 / D) + 1), hB = wR / B, hC = wR / C, hD = wR / D;
      const H = hB + hC + hD + 2 * g, wL = A * H;
      add('hero3', 'one big, three small', [{ x: 0, y: 0, w: wL, h: H }, { x: wL + g, y: 0, w: wR, h: hB }, { x: wL + g, y: hB + g, w: wR, h: hC }, { x: wL + g, y: hB + hC + 2 * g, w: wR, h: hD }]);
    }
  }

  let best = null;
  cands.forEach((c, order) => {
    if (c.H > hMax) { // too tall for the card: squash it, which crops the photos a little
      const k = hMax / c.H;
      c.cells = c.cells.map(f => ({ ...f, y: f.y * k, h: f.h * k }));
      c.H = hMax;
    }
    const crop = c.cells.reduce((s, f, i) => { const r = f.w / f.h; return s + (1 - Math.min(r, a[i]) / Math.max(r, a[i])); }, 0) / n;
    const small = Math.max(0, 0.32 - Math.min(...c.cells.map(f => f.w))); // a frame narrower than a third of the card is a thumbnail
    c.score = crop + 0.8 * Math.max(0, hMin - c.H) + small + order * 0.001;
    if (!best || c.score < best.score) best = c;
  });
  return best;
}

/** Frames for a layout as HTML: each is positioned by percentages of the block, so it scales with the card. */
function framesHTML(lay, urls) {
  return `<div class="mosaic ${lay.name}" style="--ar:${(1 / lay.H).toFixed(4)}">${lay.cells.map((c, i) =>
    `<div class="ph" style="left:${(c.x * 100).toFixed(3)}%;top:${(c.y / lay.H * 100).toFixed(3)}%;width:${(c.w * 100).toFixed(3)}%;height:${(c.h / lay.H * 100).toFixed(3)}%"><img src="${urls[i]}" alt="" draggable="false"></div>`).join('')}</div>`;
}

/* ============================== exif ================================ */
/* Reads the real capture time (and GPS, when the photo has it) from a JPEG's EXIF block.
   Used to sort a big camera-roll upload and to group it into vibes. */
async function readExif(file) {
  try {
    const v = new DataView(await file.slice(0, 262144).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return {};                       // not a JPEG (HEIC etc.): no EXIF here
    for (let off = 2; off < v.byteLength - 10;) {
      const marker = v.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
      off += 2 + v.getUint16(off + 2);
    }
  } catch (e) { /* unreadable: fall back to the file date */ }
  return {};
}

function parseTiff(v, base) {
  const le = v.getUint16(base) === 0x4949;
  const u16 = o => v.getUint16(base + o, le), u32 = o => v.getUint32(base + o, le);
  const ifd = o => {
    const out = {};
    for (let i = 0, n = u16(o); i < n; i++) { const e = o + 2 + i * 12; out[u16(e)] = { count: u32(e + 4), off: e + 8 }; }
    return out;
  };
  const text = t => {
    const at = t.count > 4 ? u32(t.off) : t.off;
    let s = '';
    for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(v.getUint8(base + at + i));
    return s;
  };
  const rational = (at, i) => u32(at + i * 8) / u32(at + i * 8 + 4);
  const out = {};
  const ifd0 = ifd(u32(4));
  if (ifd0[0x8769]) {                                               // Exif sub-IFD: DateTimeOriginal
    const ex = ifd(u32(ifd0[0x8769].off));
    const t = ex[0x9003] || ex[0x9004];
    const m = t && text(t).match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
    if (m) out.time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  if (ifd0[0x8825]) {                                               // GPS sub-IFD
    const g = ifd(u32(ifd0[0x8825].off));
    if (g[1] && g[2] && g[3] && g[4]) {
      const dms = t => { const at = u32(t.off); return rational(at, 0) + rational(at, 1) / 60 + rational(at, 2) / 3600; };
      let lat = dms(g[2]), lng = dms(g[4]);
      if (text(g[1]) === 'S') lat = -lat;
      if (text(g[3]) === 'W') lng = -lng;
      if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng; }
    }
  }
  return out;
}

/** Two compressions at a time: a 40-photo upload shouldn't freeze a phone. */
const pool = (() => {
  let active = 0;
  const waiting = [];
  const pump = () => {
    if (active >= 2 || !waiting.length) return;
    active++;
    const { fn, res, rej } = waiting.shift();
    fn().then(res, rej).finally(() => { active--; pump(); });
  };
  return fn => new Promise((res, rej) => { waiting.push({ fn, res, rej }); pump(); });
})();

/** Photos arrive as raw files and are compressed in the background; this resolves when p.blob is ready. */
function ensureReady(p) {
  if (p.blob) return Promise.resolve();
  if (!p.ready) {
    p.ready = pool(() => compress(p.file)).then(r => {
      p.blob = r.blob; p.w = r.w; p.h = r.h;
      if (draft && draft.photos.includes(p)) renderThumbs();       // layout hint can now use the real shape
    });
  }
  return p.ready;
}

/* ============================== maps ================================ */
/* Optional Google Places (New) autocomplete. Everything works without a key. */
const Maps = {
  lib: null,
  token: null,
  load() {
    if (this.lib) return this.lib;
    this.lib = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.mapsKey)}&v=weekly&loading=async`;
      s.async = true;
      s.onerror = () => { this.lib = null; rej(new Error('Maps script failed to load')); };
      s.onload = () => google.maps.importLibrary('places').then(res, e => { this.lib = null; rej(e); });
      document.head.appendChild(s);
    });
    return this.lib;
  },
  async suggest(input) {
    const lib = await this.load();
    this.token = this.token || new lib.AutocompleteSessionToken();
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: this.token });
    return suggestions.slice(0, 5).map(s => s.placePrediction).filter(Boolean);
  },
  async details(prediction) {
    const place = prediction.toPlace();
    await place.fetchFields({ fields: ['displayName', 'location', 'id', 'formattedAddress'] });
    this.token = null; // a pick ends the billing session
    return { name: place.displayName, address: place.formattedAddress || '', lat: place.location.lat(), lng: place.location.lng(), placeId: place.id };
  },
};
window.gm_authFailure = () => toast('Google rejected that Maps key');

/* ============================== caption ============================= */
/* A caption is a list of segments: {t:'text', v} and {t:'loc', name, lat, lng, placeId}.
   Text and locations can be mixed in any order, which is what the editor produces. */

const locsOf = v => v.caption.filter(s => s.t === 'loc');

/** Caption -> display lines. Each place ends its line ("we went sunset" / "then we went park"),
    punctuation stays with the place before it, and every line gets a random-but-stable sideways
    position r (0 = flush left, 1 = flush right), seeded by the card id. */
function captionLines(v) {
  const lines = [];
  let cur = [], justEndedOnLoc = false;
  const flush = () => { if (cur.length) lines.push(cur); cur = []; };

  v.caption.forEach(s => {
    if (s.t === 'loc') { cur.push(s); flush(); justEndedOnLoc = true; return; }
    s.v.split('\n').forEach((part, i, parts) => {
      let p = part;
      if (justEndedOnLoc && !cur.length && lines.length) {   // ". " after a place belongs to that place's line
        const m = p.match(/^\s*([.,!?;:)…]+)/);
        if (m) { lines[lines.length - 1].push({ t: 'text', v: m[1] }); p = p.slice(m[0].length); }
      }
      justEndedOnLoc = false;
      if (p.trim()) cur.push({ t: 'text', v: p });
      if (i < parts.length - 1) flush();                     // a line break the writer typed
    });
  });
  flush();

  const rnd = rng(hash(v.id));
  let prev = -1;
  return lines
    .map(segs => {
      const out = segs.map(s => ({ ...s }));
      if (out[0].t === 'text') out[0].v = out[0].v.replace(/^\s+/, '');
      const last = out[out.length - 1];
      if (last.t === 'text') last.v = last.v.replace(/\s+$/, '');
      return out.filter(s => s.t === 'loc' || s.v);
    })
    .filter(segs => segs.length)
    .map(segs => {
      let r;
      for (let tries = 0; tries < 8; tries++) { r = rnd(); if (Math.abs(r - prev) > 0.28) break; } // neighbours shouldn't line up
      prev = r;
      return { segs, r };
    });
}

/** Caption lines -> HTML for a card (places are Google Maps links). */
function captionHTML(v) {
  return captionLines(v).map(L => `<span class="cap-line" data-r="${L.r.toFixed(3)}">${L.segs.map(s => s.t === 'loc'
    ? `<a href="${esc(mapsLink(s))}" target="_blank" rel="noopener">${esc(locLabel(s))}</a>`
    : esc(s.v)).join('')}</span>`).join('');
}

/** Slide each line sideways by its r, using the width that's actually free (call after layout). */
function placeLines(root) {
  root.querySelectorAll('.cap-line').forEach(l => {
    l.style.marginLeft = '0px';
    const free = l.parentElement.clientWidth - l.offsetWidth;
    l.style.marginLeft = Math.max(0, Math.round(free * (+l.dataset.r))) + 'px';
  });
}

/** Older entries (stops + vibes) become a plain caption the first time they load. */
function legacyCaption(v) {
  const stops = v.stops || [], segs = [];
  stops.forEach((s, i) => {
    const lead = i === 0 ? (stops.length === 1 ? 'Ended up at ' : 'Started at ') : (i === stops.length - 1 ? ' and ended up at ' : ', ');
    segs.push({ t: 'text', v: lead }, { t: 'loc', name: s.name, lat: s.lat, lng: s.lng, placeId: s.placeId || null });
  });
  if (stops.length) segs.push({ t: 'text', v: '.' });
  if (v.vibes && v.vibes.length) segs.push({ t: 'text', v: `${stops.length ? ' ' : ''}Vibe: ${v.vibes.join(', ')}.` });
  return segs;
}

/* ============================== theme =============================== */
function setTheme(name, save) {
  document.documentElement.dataset.theme = name;
  document.querySelectorAll('#themes .sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === name)));
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[name] || '#ffffff';
  document.querySelectorAll('.deck').forEach(placeLines); // location highlight padding changes line widths
  if (save) { try { localStorage.setItem(THEME_STORE, name); } catch (e) { /* storage blocked */ } }
}

/* ============================== state =============================== */
const state = {
  list: [],          // all vibes
  year: 'all',       // year filter
  open: null,        // open folder key 'YYYY-MM'
  focusId: null,     // card to land on after saving
  mapsKey: '',
  urls: new Map(),   // vibe id -> object URLs
  views: {},         // month key -> {week: 'all' | 1..5, grid: bool}
  view: 'folders',   // which way of looking: 'folders' | 'calendar'
  calMonth: null,    // month shown in the calendar view, 'YYYY-MM'
};

const filed = () => state.list.filter(v => !v.unfiled);      // vibes shown in folders
const unfiled = () => state.list.filter(v => v.unfiled).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

function photoURLs(v) {
  if (!state.urls.has(v.id)) state.urls.set(v.id, v.photos.map(b => URL.createObjectURL(b)));
  return state.urls.get(v.id);
}
function dropURLs(id) {
  (state.urls.get(id) || []).forEach(u => URL.revokeObjectURL(u));
  state.urls.delete(id);
}

/** Visible vibes grouped by month, newest first. */
function groups() {
  const items = filed()
    .filter(v => state.year === 'all' || v.date.startsWith(String(state.year)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const map = new Map();
  items.forEach(v => {
    const k = v.date.slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  });
  return [...map].map(([key, its]) => ({ key, items: its, year: +key.slice(0, 4), month: +key.slice(5, 7) - 1 }));
}

function render() {
  const years = [...new Set(filed().map(v => +v.date.slice(0, 4)))];
  if (state.year !== 'all' && !years.includes(state.year)) state.year = 'all';
  renderYears(years.sort((a, b) => b - a));
  renderStack();
  renderChrome();
}

function renderYears(years) {
  const nav = $('#years');
  nav.innerHTML = '';
  const pending = unfiled().length;
  const showYears = years.length && state.view === 'folders'; // the calendar pages by month instead
  nav.hidden = !showYears && !pending;
  if (pending) { // photos waiting for words
    const u = el('button', 'chip unf mono', `Unfiled ${pending}`);
    u.type = 'button';
    u.onclick = openUnfiled;
    nav.append(u);
  }
  if (showYears) ['all', ...years].forEach(y => {
    const b = el('button', 'chip mono', y === 'all' ? 'All' : y);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.year === y));
    b.onclick = () => { state.year = y; state.open = null; render(); };
    nav.append(b);
  });
}

function renderChrome() {
  const gs = groups();
  const count = gs.reduce((n, g) => n + g.items.length, 0);
  $('#chromeRight').innerHTML = `${state.year === 'all' ? 'ALL' : state.year}<br>${pad(gs.length)} FLD<br>${pad(count)} VBS`;
}

/* ============================== folders ============================= */
function renderStack() {
  const stack = $('#stack');
  stack.innerHTML = '';
  if (state.view === 'calendar') return renderCalendar(stack);
  const gs = groups();
  if (!gs.length) { stack.append(emptyFolder()); return; }
  if (!gs.some(g => g.key === state.open)) state.open = gs[0].key;
  gs.forEach((g, i) => stack.append(folderEl(g, i)));
}

function emptyFolder() {
  const f = el('section', 'folder open');
  f.style.setProperty('--c', '#3a3a3a');
  f.innerHTML = `<div class="tab-row"><button class="tab" type="button" tabindex="-1"><span>Nothing filed yet</span></button></div>
    <div class="plate"><div class="strip"></div><div class="collapse"><div class="collapse-in"><div class="collapse-pad">
    <p class="empty">Drop in a few photos and write the caption.<span class="mono">Hit “+ add vibe” to file the first one</span></p>
    </div></div></div></div>`;
  return f;
}

function folderEl(g, i) {
  const f = el('section', 'folder');
  f.dataset.key = g.key;
  f.style.setProperty('--c', PALETTE[g.month % PALETTE.length]);
  f.style.setProperty('--x', TAB_X[i % TAB_X.length] + '%');
  f._group = g;
  const label = state.year === 'all' ? `${MONTHS[g.month].slice(0, 3)} ${g.year}` : MONTHS[g.month];
  const n = g.items.length;
  f.innerHTML = `<div class="tab-row"><button class="tab" type="button" aria-expanded="false"><span>${label}</span><span class="n mono">${pad(n)}</span></button></div>
    <div class="plate">
      <div class="strip"><span class="meta mono">${MON3[g.month]} ${g.year} · ${n} ${n === 1 ? 'vibe' : 'vibes'}</span></div>
      <div class="collapse"><div class="collapse-in"><div class="collapse-pad"></div></div></div>
    </div>`;
  bindTab($('.tab', f), g);
  if (g.key === state.open) { f.classList.add('open'); $('.tab', f).setAttribute('aria-expanded', 'true'); mountDeck(f); }
  return f;
}

/* --- month preview: most-visited places + a few photos, on hover (mouse), focus, or long-press (touch) --- */
function peekData(g) {
  const seen = new Map(); // place -> {label, count, last}
  g.items.forEach(v => locsOf(v).forEach(s => {
    const key = s.placeId || locLabel(s).toLowerCase();
    const e = seen.get(key) || { label: locLabel(s), count: 0, last: '' };
    e.count++;
    if (v.date > e.last) e.last = v.date;
    seen.set(key, e);
  }));
  const top = [...seen.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, 3);
  return { top, repeats: top.some(t => t.count > 1) };
}

function showPeek(tab, g) {
  const p = $('#peek');
  const { top, repeats } = peekData(g);
  const n = g.items.length;
  const list = top.length
    ? `<ul class="peek-list">${top.map(t => `<li><span class="nm">${esc(t.label)}</span>${t.count > 1 ? `<span class="mono">×${t.count}</span>` : ''}</li>`).join('')}</ul>`
    : '<div class="peek-none">No places added yet</div>';
  const thumbs = g.items.slice(0, 4).map(v => `<img src="${photoURLs(v)[0]}" alt="">`).join('');
  p.innerHTML = `<div class="peek-h mono"><span>${MON3[g.month]} ${g.year}</span><span>${repeats ? 'most visited' : 'places'}</span></div>${list}<div class="peek-thumbs">${thumbs}</div>`;
  p.hidden = false;
  // place under the tab, flip above it if there's no room, keep inside the screen
  const r = tab.getBoundingClientRect();
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = clamp(r.left, 8, innerWidth - w - 8) + 'px';
  p.style.top = (r.bottom + 8 + h > innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
  requestAnimationFrame(() => p.classList.add('on'));
}

function hidePeek() {
  const p = $('#peek');
  p.classList.remove('on');
  clearTimeout(hidePeek.t);
  hidePeek.t = setTimeout(() => { if (!p.classList.contains('on')) p.hidden = true; }, 200);
}

function bindTab(tab, g) {
  let press, pressed = false;
  tab.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showPeek(tab, g); });
  tab.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hidePeek(); });
  tab.addEventListener('focus', () => { if (tab.matches(':focus-visible')) showPeek(tab, g); });
  tab.addEventListener('blur', hidePeek);
  tab.addEventListener('contextmenu', e => e.preventDefault());
  tab.addEventListener('pointerdown', e => {            // touch: press and hold to peek
    if (e.pointerType !== 'touch') return;
    press = setTimeout(() => { pressed = true; showPeek(tab, g); }, 420);
  });
  const release = () => { clearTimeout(press); if (pressed) setTimeout(hidePeek, 1500); };
  tab.addEventListener('pointerup', release);
  tab.addEventListener('pointercancel', release);
  tab.addEventListener('click', () => {
    if (pressed) { pressed = false; return; }            // that was a long-press, not a tap
    hidePeek();
    toggleFolder(g.key);
  });
}
window.addEventListener('scroll', () => hidePeek(), { passive: true });

function toggleFolder(key) {
  state.open = state.open === key ? null : key;
  document.querySelectorAll('#stack .folder').forEach(f => {
    const on = f.dataset.key === state.open;
    f.classList.toggle('open', on);
    $('.tab', f).setAttribute('aria-expanded', String(on));
    if (on) mountDeck(f);
  });
  if (state.open) scrollIntoViewSoon(state.open);
}

function scrollIntoViewSoon(key) {
  setTimeout(() => {
    const f = $(`#stack .folder[data-key="${key}"]`);
    if (!f) return;
    const r = f.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) window.scrollBy({ top: r.top - 60, behavior: 'smooth' });
  }, 480);
}

/* ============================== deck ================================ */
function photosHTML(v) {
  const dims = v.photos.map((_, i) => (v.dims && v.dims[i]) || [4, 3]);
  return framesHTML(layoutOf(dims), photoURLs(v));
}

function cardHTML(v, i) {
  const tilt = (i % 2 ? 1 : -1) * (1.2 + (i % 3) * 0.5);
  const caption = captionHTML(v);
  return `<article class="card" data-id="${v.id}" style="--r:${tilt}"><div class="card-in">
    <div class="cap"><div class="cap-top mono"><span>${fmtDate(v.date)}</span></div>${v.title ? `<h3 class="title">${esc(v.title)}</h3>` : ''}</div>
    ${photosHTML(v)}
    ${caption ? `<div class="write cap-lines">${caption}</div>` : ''}
    <div class="acts mono">${v.photos.length < MAX_PHOTOS ? '<button type="button" data-act="photos">+ photos</button>' : ''}<button type="button" data-act="share">share</button><button type="button" data-act="edit">edit</button><button type="button" data-act="del">delete</button></div>
  </div></article>`;
}

/** The links at the bottom of a card (+ photos / share / edit / delete), from a folder or from the calendar. */
function runCardAct(act, id) {
  if (act === 'edit') editVibe(id);
  else if (act === 'photos') { editVibe(id); $('#fileInput').click(); }
  else if (act === 'share') openStory(id);
  else deleteVibe(id);
}

/* --- inside a folder: weeks + grid (only once a month holds more than 4 vibes) --- */
const weekOf = iso => Math.min(5, Math.ceil(+iso.slice(8, 10) / 7)); // W1 = 1-7, W2 = 8-14 ... W5 = 29+
const viewOf = key => state.views[key] || (state.views[key] = { week: 'all', grid: false });

function mountDeck(f) {
  const host = $('.collapse-pad', f);
  if (host.dataset.mounted) return;
  host.dataset.mounted = '1';
  // one click handler for everything inside the folder, however many times the body is redrawn
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) { runCardAct(b.dataset.act, b.closest('.card').dataset.id); return; }
    const cell = e.target.closest('.gcell');
    if (cell) { viewOf(f._group.key).grid = false; state.focusId = cell.dataset.id; renderBody(f); state.focusId = null; }
  });
  renderBody(f);
}

function renderBody(f) {
  const host = $('.collapse-pad', f);
  const g = f._group, view = viewOf(g.key);
  const weeks = [...new Set(g.items.map(v => weekOf(v.date)))].sort();
  if (view.week !== 'all' && !weeks.includes(view.week)) view.week = 'all';
  const many = g.items.length > WEEKS_AFTER;
  const items = many && view.week !== 'all' ? g.items.filter(v => weekOf(v.date) === view.week) : g.items;

  const controls = many ? `<div class="views">
      <div class="wk">${['all', ...weeks].map(w => `<button type="button" data-w="${w}" aria-pressed="${view.week === w}">${w === 'all' ? 'All' : 'W' + w}</button>`).join('')}</div>
      <button type="button" class="gtog" aria-pressed="${view.grid}">Grid</button>
    </div>` : '';
  const body = many && view.grid
    ? `<div class="sheet">${items.map(v => `<button type="button" class="gcell" data-id="${v.id}"><img src="${photoURLs(v)[0]}" alt=""><span class="mono">${v.date.slice(8)} ${MON3[+v.date.slice(5, 7) - 1]}${v.photos.length > 1 ? ' · ' + v.photos.length : ''}</span></button>`).join('')}</div>`
    : `<div class="deck">${items.map(cardHTML).join('')}</div>
       <div class="deck-ctl"><button class="step prev" type="button" aria-label="Previous">←</button><span class="mono count"></span><button class="step next" type="button" aria-label="Next">→</button></div>`;
  host.innerHTML = controls + body;

  host.querySelectorAll('.wk button').forEach(b => {
    b.onclick = () => { view.week = b.dataset.w === 'all' ? 'all' : +b.dataset.w; renderBody(f); };
  });
  const tog = $('.gtog', host);
  if (tog) tog.onclick = () => { view.grid = !view.grid; renderBody(f); };
  if (!(many && view.grid)) initDeck(host, { ...g, items });
}

function initDeck(root, g) {
  const deck = $('.deck', root);
  const cards = [...deck.children];
  const counter = $('.count', $('.deck-ctl', root));
  const prev = $('.prev', root), next = $('.next', root);
  let cur = Math.max(0, g.items.findIndex(v => v.id === state.focusId));

  // Each card is as tall as its content (photo layout + text). The deck follows the front card,
  // and cards waiting behind borrow its height so the stack edge looks tidy.
  const natural = c => c.firstElementChild.offsetHeight;
  const fit = () => {
    placeLines(deck);
    const fh = natural(cards[cur]);
    deck.style.height = (fh + 28) + 'px';
    cards.forEach((c, i) => { c.style.height = (i > cur ? fh : natural(c)) + 'px'; });
  };
  const ro = new ResizeObserver(fit); // text reflow, late fonts, rotation
  cards.forEach(c => ro.observe(c.firstElementChild));

  const paint = () => {
    fit();
    cards.forEach((c, i) => {
      const p = i - cur;
      c.classList.toggle('is-turned', p < 0);
      c.classList.toggle('is-front', p === 0);
      c.classList.toggle('is-behind', p > 0);
      c.style.setProperty('--p', Math.min(Math.max(p, 0), 4));
      c.style.setProperty('--o', p > 3 ? 0 : 1);
      c.style.zIndex = p < 0 ? 10 + i : 100 - p;
      c.inert = p !== 0;
    });
    counter.textContent = `${pad(cur + 1)} / ${pad(cards.length)}`;
    prev.disabled = cur === 0;
    next.disabled = cur === cards.length - 1;
  };
  const go = d => {
    const n = Math.min(cards.length - 1, Math.max(0, cur + d));
    if (n !== cur) { cur = n; paint(); }
  };
  root._go = go;
  // the folder isn't in the page yet while it's being built, so measure again once it is
  requestAnimationFrame(fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);

  // Swipe to turn pages. The dragged card follows the finger, then the CSS transition finishes the turn.
  deck.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('button, a')) return;
    const x0 = e.clientX;
    let dx = 0, moved = false;
    const front = cards[cur], back = cards[cur - 1];
    const move = ev => {
      dx = ev.clientX - x0;
      if (Math.abs(dx) > 6) moved = true;
      if (!moved) return;
      deck.classList.add('dragging');
      if (dx < 0 && cur < cards.length - 1) front.style.transform = `rotateY(${Math.max(dx / 3.2, -100)}deg)`;
      if (dx > 0 && back) { back.style.opacity = 1; back.style.transform = `rotateY(${-98 + Math.min(dx / 3.2, 98)}deg)`; }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      deck.classList.remove('dragging');
      cards.forEach(c => { c.style.transform = ''; c.style.opacity = ''; });
      if (moved) { if (dx < -50) go(1); else if (dx > 50) go(-1); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  paint();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeViews(); closeDay(); closeStory(); closeSettings(); closePanel(); return; }
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || panelOpen() || e.target.closest('input, textarea, [contenteditable]')) return;
  const dir = e.key === 'ArrowRight' ? 1 : -1;
  if (!$('#day').hidden) { const b = $('#dayBody'); return b._go && b._go(dir); } // flipping through a day
  if (state.view === 'calendar') return stepMonth(dir);
  const open = $('#stack .folder.open .collapse-pad');
  if (open && open._go) open._go(dir);
});

/* ============================== views =============================== */
/* A small "views" link at the top switches how the archive is laid out: folders, calendar (more to come). */
const VIEWS = [{ id: 'folders', label: 'Folders' }, { id: 'calendar', label: 'Calendar' }];
const VIEW_STORE = 'tuffest.view';

function setView(id) {
  state.view = id;
  try { localStorage.setItem(VIEW_STORE, id); } catch (e) { /* storage blocked */ }
  closeDay();
  closeViews();
  render();
}

function openViews() {
  const menu = $('#viewsMenu'), btn = $('#viewsBtn');
  menu.innerHTML = VIEWS.map(v => `<button type="button" role="menuitemradio" aria-checked="${state.view === v.id}" data-view="${v.id}"><i>${state.view === v.id ? '●' : ''}</i>${v.label}</button>`).join('');
  menu.querySelectorAll('button').forEach(b => { b.onclick = () => setView(b.dataset.view); });
  menu.hidden = false;
  const r = btn.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  btn.setAttribute('aria-expanded', 'true');
}

function closeViews() {
  const menu = $('#viewsMenu');
  if (menu.hidden) return;
  menu.hidden = true;
  $('#viewsBtn').setAttribute('aria-expanded', 'false');
}

/* ============================== calendar ============================ */
/* A wall-calendar page: colour block with the month's first vibe as a round photo on top, a grid of
   day circles below. A day with a vibe is blotted out (filled in) and opens that day's vibes. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const shiftMonth = (key, d) => { const [y, m] = key.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; };

function stepMonth(d) { state.calMonth = shiftMonth(state.calMonth, d); renderStack(); }

function renderCalendar(stack) {
  const all = filed();
  if (!state.calMonth) state.calMonth = all.map(v => v.date.slice(0, 7)).sort().pop() || todayISO().slice(0, 7); // newest month with vibes
  const key = state.calMonth;
  const [y, m] = key.split('-').map(Number), month = m - 1;
  const color = PALETTE[month % PALETTE.length];

  const inMonth = all.filter(v => v.date.startsWith(key)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const byDay = new Map();
  inMonth.forEach(v => { const d = +v.date.slice(8); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(v); });
  const first = inMonth[0]; // its first photo is the page's picture

  const lead = (new Date(y, month, 1).getDay() + 6) % 7;      // weeks start on Monday
  const days = new Date(y, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < Math.ceil((lead + days) / 7) * 7; i++) {
    const d = i - lead + 1;
    if (d < 1 || d > days) cells.push('<span class="cd off"></span>');
    else if (byDay.has(d)) {
      const n = byDay.get(d).length;
      cells.push(`<button type="button" class="cd on" data-day="${d}" style="--t:${(d * 37 % 7) - 3}deg" aria-label="${n} vibe${n > 1 ? 's' : ''} on ${MONTHS[month]} ${d}"><span>${d}</span></button>`);
    } else cells.push(`<span class="cd">${d}</span>`);
  }

  const wrap = el('div', 'cal-wrap');
  wrap.innerHTML = `
    <section class="cal" style="--c:${color}; --cp:${PALETTE[(month + 7) % 8]}; --cn:${PALETTE[(month + 1) % 8]}">
      <div class="cal-top"><i class="hole"></i>
        <div class="cal-photo">${first ? `<img src="${photoURLs(first)[0]}" alt="">` : '<span class="mono">no vibes yet</span>'}</div>
      </div>
      <div class="cal-body">
        <div class="cal-head"><span>${MONTHS[month]}</span><span>${y}</span></div>
        <div class="cal-wk">${WEEKDAYS.map(d => `<span>${d}</span>`).join('')}</div>
        <div class="cal-grid">${cells.join('')}</div>
        <div class="cal-foot mono">${inMonth.length} vibe${inMonth.length === 1 ? '' : 's'} · tuffest</div>
      </div>
    </section>
    <div class="cal-nav">
      <button class="step" type="button" data-step="-1" aria-label="Previous month">←</button>
      <span class="mono">${MON3[month]} ${y}</span>
      <button class="step" type="button" data-step="1" aria-label="Next month">→</button>
    </div>`;
  wrap.querySelectorAll('[data-step]').forEach(b => { b.onclick = () => stepMonth(+b.dataset.step); });
  wrap.querySelectorAll('.cd.on').forEach(b => { b.onclick = () => openDay(byDay.get(+b.dataset.day)); });
  stack.append(wrap);
}

/* the vibes of one tapped day, flipped through in a sheet over the calendar */
function openDay(items) {
  const body = $('#dayBody');
  body.innerHTML = `<div class="deck">${items.map(cardHTML).join('')}</div>
    <div class="deck-ctl"><button class="step prev" type="button" aria-label="Previous">←</button><span class="mono count"></span><button class="step next" type="button" aria-label="Next">→</button></div>`;
  $('#day').hidden = false;
  document.body.classList.add('locked');
  initDeck(body, { items });
  $('.deck-ctl', body).hidden = items.length < 2;
}

function closeDay() {
  if ($('#day').hidden) return;
  $('#day').hidden = true;
  $('#dayBody').innerHTML = '';
  document.body.classList.remove('locked');
}

/* ============================== panel =============================== */
let draft = null;
const newDraft = () => ({ id: null, photos: [], caption: [], title: '', date: todayISO(), dateTouched: false, dirty: false });
const panelOpen = () => $('#panel').classList.contains('on') || $('#settings').classList.contains('on');

function setSheet(panel, on) {
  panel.classList.toggle('on', on);
  panel.setAttribute('aria-hidden', String(!on));
  $('#scrim').classList.toggle('on', on);
  document.body.classList.toggle('locked', on);
}

/* queue = the vibes being worked through one after another (a mass upload, or the Unfiled tray).
   A single add or an edit has no queue. */
let queue = null; // { drafts: [...], i, mode: 'new' | 'unfiled', last: id of the latest filed vibe }

function openPanel(d, title) {
  draft = d;
  $('#panelTitle').textContent = title;
  $('#dateInput').value = d.date;
  $('#titleInput').value = d.title;
  $('#mapsHint').textContent = state.mapsKey ? '' : 'Tip: add a Google Maps key in settings to search real places. Typed names still link to Maps.';
  writeEditor(d.caption);
  closeComposer();
  renderThumbs();
  renderSuggest();
  renderFoot();
  setSheet($('#panel'), true);
  $('#panel .panel-scroll').scrollTop = 0;
}

function renderFoot() {
  const n = queue ? queue.drafts.length : 0;
  const more = queue && queue.i < n - 1;
  $('#saveBtn').textContent = !queue ? 'Save' : more ? 'File it · next' : 'File it';
  $('#footRow').hidden = !queue;
  $('#laterBtn').textContent = queue && queue.mode === 'unfiled' ? 'skip for now' : 'caption later';
}

/** Throw away a draft's temporary preview URLs. */
const releaseDraft = d => d.photos.forEach(p => URL.revokeObjectURL(p.url));

function closePanel(force) {
  if (!$('#panel').classList.contains('on')) return;
  if (queue && !force) return abandonQueue();
  if (!force && draft && draft.dirty && !confirm('Discard this vibe?')) return;
  if (draft) releaseDraft(draft);
  draft = null;
  queue = null;
  setSheet($('#panel'), false);
}

/** Closing mid-way through a mass upload keeps everything: what's left goes to Unfiled. */
function abandonQueue() {
  const q = queue;
  if (q.mode === 'new' && q.drafts.length === 1) {                 // a single add: ordinary discard check
    if (draft.dirty && !confirm('Discard this vibe?')) return;
    return closePanel(true);
  }
  if (q.mode === 'unfiled') return closePanel(true);               // already stored as Unfiled
  draft.caption = readEditor();
  const rest = q.drafts.slice(q.i);
  closePanel(true);
  toast(`${rest.length} saved to Unfiled`);
  (async () => {
    for (const d of rest) { await persist(d, true); releaseDraft(d); }
    render();
  })();
}

/* --- working through a queue of drafts --- */
function showDraft() {
  const d = queue.drafts[queue.i];
  const n = queue.drafts.length;
  const label = queue.mode === 'unfiled' ? 'Unfiled' : 'New vibe';
  openPanel(d, n > 1 ? `${label} · ${queue.i + 1} of ${n}` : label);
  queue.drafts.slice(queue.i, queue.i + 3).forEach(x => x.photos.forEach(ensureReady)); // compress ahead while they type
}

function nextDraft() {
  queue.i++;
  if (queue.i < queue.drafts.length) return showDraft();
  const last = queue.last;
  closePanel(true);
  render();
  if (last) focusVibe(last);
}

/** Open the month a vibe lives in and land on its card. */
function focusVibe(id) {
  const v = state.list.find(x => x.id === id);
  if (!v || v.unfiled) return;
  state.focusId = id;
  state.calMonth = v.date.slice(0, 7);
  state.open = v.date.slice(0, 7);
  state.views[state.open] = { week: 'all', grid: false };
  if (state.year !== 'all' && state.year !== +v.date.slice(0, 4)) state.year = +v.date.slice(0, 4);
  render();
  state.focusId = null;
  scrollIntoViewSoon(state.open);
}

/** Turn a drafted vibe into a stored one. Waits for photo compression if it isn't done yet. */
async function persist(d, isUnfiled) {
  await Promise.all(d.photos.map(ensureReady));
  const existing = state.list.find(v => v.id === d.id);
  const rec = {
    id: d.id || uid(),
    createdAt: existing ? existing.createdAt : Date.now(),
    date: d.date || todayISO(),
    caption: d.caption,
    title: (d.title || '').trim(),
    photos: d.photos.map(p => p.blob),
    dims: d.photos.map(p => [p.w, p.h]),
    gps: d.gps || null,
    unfiled: !!isUnfiled,
    // cloud bookkeeping: where each photo lives online (null = not uploaded yet) and whether this needs pushing
    paths: d.photos.map(p => p.path || null),
    cloudPaths: existing ? existing.cloudPaths || [] : [],
    updatedAt: Date.now(),
    dirty: true,
  };
  await DB.put(rec);
  dropURLs(rec.id);
  state.list = state.list.filter(v => v.id !== rec.id).concat(rec);
  pushSoon(rec);
  return rec;
}

/** "File it" (or "caption later" when later = true). */
async function fileCurrent(later) {
  if (!draft.photos.length) return toast('Add at least one photo');
  const btn = $('#saveBtn');
  btn.disabled = true;
  draft.caption = readEditor();
  try {
    const rec = await persist(draft, later === true);
    releaseDraft(draft);
    btn.disabled = false;
    if (queue) { if (!later) queue.last = rec.id; return nextDraft(); }
    closePanel(true);
    render();
    toast('Filed');
    focusVibe(rec.id);
  } catch (e) {
    console.warn(e);
    btn.disabled = false;
    toast('Couldn’t save — storage is full or blocked');
  }
}

async function dropCurrent() {
  if (draft.id && !confirm('Delete this vibe and its photos?')) return;
  if (draft.id) { await removeLocal(draft.id); }
  releaseDraft(draft);
  nextDraft();
}

/** Add the current draft's photos to a vibe already filed for the same day. */
async function mergeInto(v) {
  const d = draft;
  await Promise.all(d.photos.map(ensureReady));
  v.photos = v.photos.concat(d.photos.map(p => p.blob));
  v.dims = v.dims.concat(d.photos.map(p => [p.w, p.h]));
  v.paths = (v.paths || v.photos.slice(0, v.photos.length - d.photos.length).map(() => null)).concat(d.photos.map(() => null));
  v.updatedAt = Date.now();
  v.dirty = true;
  await DB.put(v);
  dropURLs(v.id);
  pushSoon(v);
  releaseDraft(d);
  queue.last = v.id;
  toast('Added to that vibe');
  nextDraft();
}

/** One-tap shortcuts under the caption: photo location, and "add to the vibe from earlier that day". */
function renderSuggest() {
  const box = $('#suggest');
  box.innerHTML = '';
  if (!queue) return;
  const g = draft.gps;
  const hasLoc = g && [...editor().querySelectorAll('.loc')].some(c => {
    const l = JSON.parse(c.dataset.loc);
    return l.lat != null && Math.abs(l.lat - g.lat) < 1e-4 && Math.abs(l.lng - g.lng) < 1e-4;
  });
  if (g && !hasLoc) {
    const b = el('button', 'sug', `◎ add this photo’s location`);
    b.type = 'button';
    b.onclick = () => { const chip = placeChip({ name: '', lat: g.lat, lng: g.lng, placeId: null }); renderSuggest(); openComposer(chip); };
    box.append(b);
  }
  if (queue.mode === 'new') {
    state.list.filter(v => !v.unfiled && v.date === draft.date && v.photos.length + draft.photos.length <= MAX_PHOTOS).slice(0, 2).forEach(v => {
      const name = v.title || v.caption.map(s => (s.t === 'loc' ? locLabel(s) : s.v)).join('').trim().slice(0, 24) || fmtDate(v.date);
      const b = el('button', 'sug', `+ add to “${esc(name)}” (${v.photos.length} photo${v.photos.length > 1 ? 's' : ''})`);
      b.type = 'button';
      b.onclick = () => mergeInto(v);
      box.append(b);
    });
  }
}

/* --- camera-roll upload: sort by capture time, split into vibes of at most 4 --- */
const pickImages = files => [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
const isoOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function makePhoto(file) {
  return { file, url: URL.createObjectURL(file), blob: null, w: 4, h: 3, ready: null };
}

/** An even split, so 9 photos become 3 + 3 + 3 rather than 4 + 4 + 1. */
function balancedChunks(arr, max) {
  const parts = Math.ceil(arr.length / max), size = Math.ceil(arr.length / parts), out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function groupByTime(items) {
  if (items.length <= MAX_PHOTOS) return [items];                  // a small pick is one vibe, whatever the dates
  const runs = [];
  let cur = [items[0]];
  for (let i = 1; i < items.length; i++) {
    if (items[i].t - items[i - 1].t > GROUP_GAP) { runs.push(cur); cur = []; }
    cur.push(items[i]);
  }
  runs.push(cur);
  return runs.flatMap(r => balancedChunks(r, MAX_PHOTOS));
}

async function startUpload(files) {
  const imgs = pickImages(files);
  if (!imgs.length) return;
  if (imgs.length > 8) toast(`Reading ${imgs.length} photos…`);
  const meta = await Promise.all(imgs.map(async file => ({ file, ...(await readExif(file)) })));
  meta.forEach(m => { m.t = m.time || m.file.lastModified || Date.now(); });
  meta.sort((a, b) => a.t - b.t);
  const drafts = groupByTime(meta).map(g => {
    const d = newDraft();
    d.photos = g.map(m => makePhoto(m.file));
    d.date = isoOf(g[0].t);
    d.dateTouched = true;
    d.dirty = true;
    const pin = g.find(m => m.lat != null);
    if (pin) d.gps = { lat: pin.lat, lng: pin.lng };
    return d;
  });
  queue = { drafts, i: 0, mode: 'new', last: null };
  showDraft();
}

/** The Unfiled tray: vibes saved without words, worked through oldest first. */
function openUnfiled() {
  const list = unfiled();
  if (!list.length) return;
  queue = { drafts: list.map(draftFromVibe), i: 0, mode: 'unfiled', last: null };
  showDraft();
}

/* --- photos --- */
function renderThumbs() {
  const wrap = $('#thumbs');
  wrap.innerHTML = '';
  draft.photos.forEach((p, i) => {
    const t = el('div', 'thumb', `<img src="${p.url}" alt=""><button class="rm" type="button" aria-label="Remove photo">×</button>`);
    t.style.setProperty('--r', ((i % 3) - 1) * 2.2 + 'deg');
    $('.rm', t).onclick = () => { URL.revokeObjectURL(p.url); draft.photos.splice(i, 1); draft.dirty = true; renderThumbs(); };
    wrap.append(t);
  });
  if (draft.photos.length < MAX_PHOTOS) {
    const add = el('button', 'thumb add', '+');
    add.type = 'button';
    add.setAttribute('aria-label', 'Add photos');
    add.onclick = () => $('#fileInput').click();
    wrap.append(add);
  }
  // tell the user how the card will arrange these
  const n = draft.photos.length;
  $('#layoutHint').textContent = n
    ? `${n} of ${MAX_PHOTOS} · ${layoutOf(draft.photos.map(p => [p.w, p.h])).label}`
    : `Up to ${MAX_PHOTOS} photos. They arrange themselves.`;
}

/** "+" tile or "+ photos": more photos for the vibe that's open (4 max). */
function addFilesToDraft(files) {
  const imgs = pickImages(files);
  if (!imgs.length) return;
  const room = MAX_PHOTOS - draft.photos.length;
  if (imgs.length > room) {
    toast(room ? `Only room for ${room} more — ${MAX_PHOTOS} max per vibe` : `${MAX_PHOTOS} photos max per vibe`);
  }
  imgs.slice(0, Math.max(room, 0)).forEach(f => {
    const p = makePhoto(f);
    draft.photos.push(p);
    ensureReady(p);
  });
  draft.dirty = true;
  renderThumbs();
}

/* --- caption editor ---
   A contenteditable box. Locations are non-editable inline chips, so you can type
   before, after, or between them. The box is read back into segments on save. */
const editor = () => $('#editor');
let savedRange = null; // caret position, remembered while the composer has focus

function chipEl(loc) {
  const c = el('span', 'loc');
  c.contentEditable = 'false';
  c.dataset.loc = JSON.stringify({
    name: loc.name || '', lat: loc.lat ?? null, lng: loc.lng ?? null, placeId: loc.placeId || null,
    placeName: loc.placeName || '', address: loc.address || '', q: loc.q || '',
  });
  c.textContent = locLabel(loc);
  return c;
}

function writeEditor(segs) {
  const ed = editor();
  ed.innerHTML = '';
  segs.forEach(s => ed.append(s.t === 'loc' ? chipEl(s) : document.createTextNode(s.v)));
  syncEmpty();
}

function readEditor() {
  const segs = [];
  let buf = '';
  const flush = () => { if (buf) segs.push({ t: 'text', v: buf.replace(/ /g, ' ') }); buf = ''; };
  const walk = node => node.childNodes.forEach(c => {
    if (c.nodeType === 3) buf += c.nodeValue;
    else if (c.nodeName === 'BR') buf += '\n';
    else if (c.classList && c.classList.contains('loc')) { flush(); segs.push({ t: 'loc', ...JSON.parse(c.dataset.loc) }); }
    else { if (buf && !buf.endsWith('\n') && c.nodeName === 'DIV') buf += '\n'; walk(c); }
  });
  walk(editor());
  flush();
  // trim stray whitespace at the very ends
  if (segs.length && segs[0].t === 'text') segs[0].v = segs[0].v.replace(/^\s+/, '');
  const last = segs[segs.length - 1];
  if (last && last.t === 'text') last.v = last.v.replace(/\s+$/, '');
  return segs.filter(s => s.t === 'loc' || s.v);
}

function syncEmpty() {
  const ed = editor();
  ed.classList.toggle('is-empty', !ed.querySelector('.loc') && !ed.textContent.trim());
}

function bindEditor() {
  const ed = editor();
  ed.addEventListener('input', () => { syncEmpty(); if (draft) draft.dirty = true; });
  ed.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  ed.addEventListener('paste', e => { // plain text only
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  ed.addEventListener('click', e => {
    const chip = e.target.closest('.loc');
    if (chip) openComposer(chip);
  });
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (sel.rangeCount && ed.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  });
}

/** Insert (or swap) a location chip at the remembered caret, with a space either side. */
function placeChip(loc, replacing) {
  const ed = editor();
  const chip = chipEl(loc);
  if (replacing) { replacing.replaceWith(chip); }
  else {
    const range = savedRange && ed.contains(savedRange.startContainer) ? savedRange : (() => {
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); return r;
    })();
    range.deleteContents();
    range.insertNode(chip);
    const before = chip.previousSibling, after = chip.nextSibling;
    if (before && !(before.nodeType === 3 && /\s$/.test(before.nodeValue))) chip.before(document.createTextNode(' '));
    else if (!before && ed.firstChild !== chip) chip.before(document.createTextNode(' '));
    if (!after || !(after.nodeType === 3 && /^[\s.,!?;:)]/.test(after.nodeValue))) chip.after(document.createTextNode(' '));
  }
  // caret goes right after the chip so typing continues naturally
  ed.focus();
  const sp = chip.nextSibling && chip.nextSibling.nodeType === 3 ? chip.nextSibling : null;
  const r = document.createRange();
  if (sp) r.setStart(sp, Math.min(1, sp.length)); else r.setStartAfter(chip);
  r.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  savedRange = r.cloneRange();
  syncEmpty();
  draft.dirty = true;
  return chip;
}

/* ============================== composer ============================ */
/* The small "add location" form. Two separate things, like a link's text and its address:
     1. "Name in the caption"  - whatever you want it to read as ("maru")
     2. "Find it on Google Maps" - where you actually search for the place; that result is hidden behind the name
   plus optional coordinates. */
const loc = {
  name: '', nameTouched: false,                       // the caption text
  q: '', placeId: null, placeName: '', address: '',   // the Google Maps side
  lat: null, lng: null, pickedCoords: false,          // pickedCoords: the coordinates came from a Maps pick
  text: '', showCoords: false, chip: null,
};
let suggTimer;

function syncComposer() {
  $('#locCoords').hidden = !loc.showCoords;
  $('#locToggle').textContent = loc.showCoords ? 'hide coordinates'
    : loc.lat != null ? `◎ ${fmtCoords(loc.lat, loc.lng)} · edit` : '+ add coordinates';
  // linked-place confirmation under the search box
  const found = $('#locFound');
  found.hidden = !loc.placeId;
  if (loc.placeId) $('#locFoundText').textContent = `✓ ${loc.placeName}${loc.address ? ' · ' + loc.address : ''}`;
  $('#locHint').hidden = !!state.mapsKey || !!loc.placeId;
}

function hideSugg() { const s = $('#locSugg'); s.hidden = true; s.innerHTML = ''; }

function openComposer(chip) {
  // grab the caret now, before focus moves to the composer (selectionchange can lag a tick)
  const sel = getSelection();
  if (!chip && sel.rangeCount && editor().contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  const data = chip ? JSON.parse(chip.dataset.loc) : {};
  Object.assign(loc, {
    name: data.name || '', nameTouched: !!data.name,
    q: data.q || data.placeName || '', placeId: data.placeId || null, placeName: data.placeName || '', address: data.address || '',
    lat: data.lat ?? null, lng: data.lng ?? null, pickedCoords: !!data.placeId,
    text: coordText(data.lat, data.lng), showCoords: false, chip: chip || null,
  });
  $('#locName').value = loc.name;
  $('#locFind').value = loc.q;
  $('#locCoordInput').value = loc.text;
  $('#locCoordInput').classList.remove('bad');
  $('#locOk').textContent = chip ? 'Update' : 'Add to caption';
  $('#locRemove').hidden = !chip;
  $('#composer').hidden = false;
  $('#addLoc').hidden = true;
  syncComposer();
  hideSugg();
  $('#locName').focus();
  $('#composer').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function closeComposer() {
  $('#composer').hidden = true;
  $('#addLoc').hidden = false;
  loc.chip = null;
  hideSugg();
}

function setLocCoords(lat, lng) {
  loc.lat = lat; loc.lng = lng; loc.text = coordText(lat, lng);
  $('#locCoordInput').value = loc.text;
  $('#locCoordInput').classList.remove('bad');
  syncComposer();
}

function bindComposer() {
  $('#addLoc').onclick = () => openComposer(null);
  $('#locCancel').onclick = closeComposer;
  $('#locToggle').onclick = () => { loc.showCoords = !loc.showCoords; syncComposer(); if (loc.showCoords) $('#locCoordInput').focus(); };

  $('#locCoordInput').oninput = e => {
    loc.text = e.target.value;
    const c = parseCoords(loc.text);
    e.target.classList.toggle('bad', !c && !!loc.text.trim());
    loc.lat = c ? c.lat : null; loc.lng = c ? c.lng : null;
    loc.pickedCoords = false; // hand-edited, so unlinking the place later won't wipe it
  };
  $('#locHere').onclick = () => {
    if (!navigator.geolocation) return toast('Location isn’t available here');
    navigator.geolocation.getCurrentPosition(
      p => setLocCoords(p.coords.latitude, p.coords.longitude),
      () => toast('Couldn’t get your location'),
      { enableHighAccuracy: true, timeout: 10000 });
  };

  // 1. the name that shows in the caption: plain text, no search
  const name = $('#locName');
  name.oninput = () => { loc.name = name.value; loc.nameTouched = true; };
  name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#locFind').focus(); } };

  // 2. finding the place on Google Maps. With a key you get live suggestions; without one the text
  //    you type is still saved and used as the search behind the link.
  const find = $('#locFind');
  const unlink = () => { // forget the picked place (and the coordinates it supplied)
    loc.placeId = null; loc.placeName = ''; loc.address = '';
    if (loc.pickedCoords) { loc.lat = loc.lng = null; loc.text = ''; $('#locCoordInput').value = ''; }
    loc.pickedCoords = false;
    syncComposer();
  };
  find.oninput = () => {
    loc.q = find.value;
    if (loc.placeId && loc.q !== loc.placeName) unlink();   // typed away from the picked place
    clearTimeout(suggTimer);
    const q = find.value.trim();
    if (!state.mapsKey || q.length < 2) return hideSugg();
    suggTimer = setTimeout(async () => {
      try {
        const preds = await Maps.suggest(q);
        if (find.value.trim() !== q || !preds.length) return hideSugg();
        const list = $('#locSugg');
        list.innerHTML = '';
        preds.forEach(p => {
          const li = el('li', '', `${esc(p.mainText ? p.mainText.text : p.text.text)}${p.secondaryText ? `<span>${esc(p.secondaryText.text)}</span>` : ''}`);
          li.onpointerdown = async e => {
            e.preventDefault();
            hideSugg();
            try {
              const d = await Maps.details(p);
              Object.assign(loc, { placeId: d.placeId, placeName: d.name, address: d.address, q: d.name, pickedCoords: true });
              find.value = d.name;
              if (!loc.nameTouched || !loc.name.trim()) { loc.name = d.name; name.value = d.name; } // never overwrite what you typed
              setLocCoords(d.lat, d.lng);
            } catch (err) { console.warn(err); toast('Couldn’t load that place'); }
          };
          list.append(li);
        });
        list.hidden = false;
      } catch (err) { console.warn(err); hideSugg(); }
    }, 260);
  };
  find.onblur = () => setTimeout(hideSugg, 200);
  find.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#locOk').click(); } };
  $('#locUnlink').onclick = () => { unlink(); find.value = loc.q = ''; find.focus(); };

  $('#locOk').onclick = () => {
    if (loc.text.trim() && parseCoords(loc.text) == null) return toast('Check the coordinates — try 51.5074, -0.1278');
    const clean = {
      name: loc.name.trim() || loc.placeName || loc.q.trim(),   // empty name falls back to what you searched
      lat: loc.lat, lng: loc.lng, placeId: loc.placeId, placeName: loc.placeName, address: loc.address, q: loc.q.trim(),
    };
    if (!clean.name && clean.lat == null) return toast('Give the place a name');
    placeChip(clean, loc.chip);
    closeComposer();
  };
  $('#locRemove').onclick = () => {
    if (loc.chip) { loc.chip.remove(); syncEmpty(); draft.dirty = true; }
    closeComposer();
  };
}

/* ============================== save / edit / delete ================ */
/** A stored vibe as an editable draft (for Edit and for the Unfiled tray). */
function draftFromVibe(v) {
  const d = newDraft();
  Object.assign(d, {
    id: v.id, date: v.date, title: v.title || '', dateTouched: true, gps: v.gps || null,
    photos: v.photos.map((b, i) => ({ blob: b, w: v.dims[i][0], h: v.dims[i][1], url: URL.createObjectURL(b), path: (v.paths && v.paths[i]) || null })),
    caption: v.caption,
  });
  return d;
}

function editVibe(id) {
  const v = state.list.find(x => x.id === id);
  if (!v) return;
  queue = null;
  openPanel(draftFromVibe(v), 'Edit vibe');
}

async function deleteVibe(id) {
  if (!confirm('Delete this vibe and its photos?')) return;
  await removeLocal(id);
  render();
}

/** Delete a vibe here, and queue the same deletion for the cloud so the other phone loses it too. */
async function removeLocal(id) {
  const v = state.list.find(x => x.id === id);
  if (v && Cloud.on) Cloud.addPendingDelete(id, v.cloudPaths || []);
  await DB.del(id);
  dropURLs(id);
  state.list = state.list.filter(x => x.id !== id);
  syncAll();
}

/* ============================== story =============================== */
/* Instagram Story size is 9:16 (1080 x 1920). The card is drawn onto a canvas in the month's colour,
   kept inside the area Instagram doesn't cover with its own buttons. A web page can't post straight
   into Instagram, so the phone's share sheet (or a saved image) is the hand-off. */
const STORY = { w: 1080, h: 1920, top: 230, bottom: 230, cardW: 920, pad: 30, gap: 14 };
const CAP_FONT = 'italic 400 46px Newsreader, "Iowan Old Style", Georgia, serif'; // caption on the story image
const CAP_LH = 62;
const LOC_INK = { blue: '#0a2a9c', pink: '#b0104a', white: '#fff' }; // matches the CSS location colours

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Photo frames inside the card in pixels: the same layout as on screen, scaled to the story card's width. */
function storyFrames(lay, innerW, top) {
  const { pad } = STORY;
  return lay.cells.map(c => ({ x: pad + c.x * innerW, y: top + c.y * innerW, w: c.w * innerW, h: c.h * innerW }));
}

/** Split styled segments into words, then wrap to maxW. Returns visual lines of {text, loc, w}. */
function wrapTokens(g, segs, maxW) {
  const tokens = segs.flatMap(s => (s.t === 'loc' ? locLabel(s) : s.v).split(/(\s+)/).filter(Boolean).map(text => ({ text, loc: s.t === 'loc' })));
  const out = [];
  let cur = [], w = 0;
  tokens.forEach(t => {
    const tw = g.measureText(t.text).width;
    if (w + tw > maxW && cur.some(x => x.text.trim())) { out.push({ toks: cur, w }); cur = []; w = 0; }
    if (!cur.length && !t.text.trim()) return; // no leading spaces on a wrapped line
    cur.push({ ...t, w: tw }); w += tw;
  });
  if (cur.length) out.push({ toks: cur, w });
  out.forEach(l => { // drop trailing space from the measured width
    const last = l.toks[l.toks.length - 1];
    if (!last.text.trim()) { l.w -= last.w; l.toks.pop(); }
  });
  return out;
}

/** A place that Google Maps knows: it has coordinates (picked from Maps, or pasted in). */
const hasPin = s => s.t === 'loc' && s.lat != null;

/** mode 'names' = the caption as written. mode 'coords' = every Maps-linked place shows its
    coordinates instead of its name ("started at 35.6613° N 139.6670° E"). Plain typed places stay as names. */
async function renderStory(v, mode = 'names') {
  const fonts = ['italic 400 64px Newsreader', 'italic 400 46px Newsreader', '400 22px "IBM Plex Mono"'];
  await Promise.all(fonts.map(f => document.fonts.load(f).catch(() => {}))); // fall back quietly if offline
  const bmps = await Promise.all(v.photos.map(b => createImageBitmap(b)));
  const lay = layoutOf(bmps.map(b => [b.width, b.height]), { hMax: 1.05 }); // a little more compact than on screen so the text stays big
  const { w: W, h: H, cardW, pad } = STORY;
  const innerW = cardW - pad * 2;

  // measure text so the card height is known before anything is drawn.
  // Order, top to bottom: date, title (if any), photos, caption.
  const m = document.createElement('canvas').getContext('2d');
  let y = pad;
  const dateY = y; y += 22 + (v.title ? 8 : 16); // date alone only needs a little room
  let titleLines = [];
  if (v.title) {
    m.font = 'italic 400 64px Newsreader, Georgia, serif';
    titleLines = wrapTokens(m, [{ t: 'text', v: v.title }], innerW);
  }
  const titleY = y; y += titleLines.length * 72 + (v.title ? 10 : 0);
  const frames = storyFrames(lay, innerW, y);
  y = Math.max(...frames.map(f => f.y + f.h)) + 6;
  m.font = CAP_FONT;
  const asCoords = s => (mode === 'coords' && hasPin(s) ? { ...s, name: '' } : s); // empty name -> label falls back to coordinates
  const capBlocks = captionLines(v).map(L => ({ r: L.r, lines: wrapTokens(m, L.segs.map(asCoords), innerW - 24) }));
  const capY = y + (capBlocks.length ? 22 : 0);
  y = capY + capBlocks.reduce((n, b) => n + b.lines.length * CAP_LH, 0);
  const cardH = y + pad * 0.4; // tight bottom edge, like the on-screen card
  const theme = document.documentElement.dataset.theme || 'white';

  // the card draws in its own coordinates, then gets scaled to fit the safe area
  const draw = g => {
    frames.forEach((f, i) => {
      const b = bmps[i], k = Math.max(f.w / b.width, f.h / b.height);
      g.save();
      g.beginPath(); g.rect(f.x, f.y, f.w, f.h); g.clip();
      g.drawImage(b, f.x + (f.w - b.width * k) / 2, f.y + (f.h - b.height * k) / 2, b.width * k, b.height * k);
      g.restore();
    });
    g.textBaseline = 'top';
    g.fillStyle = '#5a5a5a';
    g.font = '400 22px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(fmtDate(v.date), pad + 4, dateY);
    g.fillStyle = '#141414';
    g.font = 'italic 400 64px Newsreader, Georgia, serif';
    titleLines.forEach((l, i) => g.fillText(l.toks.map(t => t.text).join(''), pad + 4, titleY + i * 72));
    // caption: small bold typewriter. Places follow the page background, as on screen:
    // white -> white text in a black box, blue -> dark blue, pink -> deep pink (no underlines)
    g.font = CAP_FONT;
    let cy = capY;
    capBlocks.forEach(b => {
      b.lines.forEach(l => {
        let x = pad + 12 + (b.lines.length === 1 ? b.r * (innerW - 24 - l.w) : 0); // wrapped lines stay flush left
        l.toks.forEach((t, ti) => {
          if (t.loc && theme === 'white') {
            // one unbroken black box per place, including the spaces inside multi-word names or coordinates
            const padL = ti === 0 || !l.toks[ti - 1].loc ? 5 : 0, padR = ti === l.toks.length - 1 || !l.toks[ti + 1].loc ? 5 : 0;
            g.fillStyle = '#000';
            g.fillRect(x - padL, cy - 3, t.w + padL + padR, CAP_LH - 10);
            g.fillStyle = '#fff';
          } else {
            g.fillStyle = t.loc ? LOC_INK[theme] : '#000';
          }
          g.fillText(t.text, x, cy);
          x += t.w;
        });
        cy += CAP_LH;
      });
    });
  };

  const availH = H - STORY.top - STORY.bottom;
  const s = Math.min(1, availH / cardH);
  const cw = cardW * s, ch = cardH * s;
  const x = (W - cw) / 2, top = STORY.top + (availH - ch) / 2;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE[parseISO(v.date).getMonth() % PALETTE.length];
  g.fillRect(0, 0, W, H);
  g.save(); // a second sheet behind, slightly turned, like the deck
  g.translate(W / 2, top + ch / 2); g.rotate(-0.028);
  g.fillStyle = 'rgba(243,241,236,.55)';
  roundRectPath(g, -cw / 2, -ch / 2 + 10, cw, ch, 8); g.fill();
  g.restore();
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 56; g.shadowOffsetY = 26;
  g.fillStyle = '#f3f1ec';
  roundRectPath(g, x, top, cw, ch, 8); g.fill();
  g.restore();
  g.save(); g.translate(x, top); g.scale(s, s); draw(g); g.restore();
  bmps.forEach(b => b.close && b.close());
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
}

/* The preview shows the versions side by side: names on the left and, only when at least one place
   is linked to Google Maps, the coordinates version on the right. Each has its own Share / Save. */
const storyOut = { names: null, coords: null }; // mode -> { blob, url, name }

async function openStory(id) {
  const v = state.list.find(x => x.id === id);
  if (!v) return;
  const modes = v.caption.some(hasPin) ? ['names', 'coords'] : ['names'];
  toast('Making your story…');
  try {
    const blobs = await Promise.all(modes.map(m => renderStory(v, m)));
    modes.forEach((m, i) => {
      if (storyOut[m]) URL.revokeObjectURL(storyOut[m].url);
      storyOut[m] = { blob: blobs[i], url: URL.createObjectURL(blobs[i]), name: `tuffest-${v.date}${m === 'coords' ? '-coordinates' : ''}.jpg` };
    });
  } catch (e) { console.warn(e); return toast('Couldn’t make the story image'); }

  const canShare = navigator.canShare && matchMedia('(pointer: coarse)').matches; // share sheet = phones/tablets
  document.querySelectorAll('#storyOpts .story-opt').forEach(opt => {
    const m = opt.dataset.mode, on = modes.includes(m);
    opt.hidden = !on;
    if (!on) return;
    $('img', opt).src = storyOut[m].url;
    $('.share', opt).hidden = !canShare;
  });
  $('#storyOpts').classList.toggle('one', modes.length === 1);
  storyId = id;
  $('#storyLinkRow').hidden = !Cloud.ready();                      // a link needs an account (the copy goes online)
  $('#storyUnshare').hidden = !shareMap()[id];
  $('#toast').classList.remove('on'); // clear "Making your story…"
  $('#story').hidden = false;
  document.body.classList.add('locked');
}

function closeStory() {
  if ($('#story').hidden) return;
  $('#story').hidden = true;
  document.body.classList.remove('locked');
}

// sharing starts from a fresh tap on the preview, which is what phone share sheets require
async function shareStory(mode) {
  const { blob, name } = storyOut[mode];
  const file = new File([blob], name, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
    else saveStory(mode);
  } catch (e) { if (e.name !== 'AbortError') saveStory(mode); }
}

function saveStory(mode) {
  const { url, name } = storyOut[mode];
  const a = el('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  toast('Saved — add it to your story from Photos');
}

/* ============================== cloud =============================== */
/* Optional sync through Supabase (see supabase-setup.sql). The phone always keeps its own copy in
   IndexedDB, so the app stays instant and works offline; the cloud copy is what follows your login.
   Leave config.js empty and none of this runs. */
const Cloud = {
  sb: null, user: null, space: null, on: false,
  init() {
    const c = window.TUFFEST_CONFIG || {};
    if (!c.supabaseUrl || !c.supabaseAnonKey || !window.supabase) return (this.on = false);
    this.sb = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    return (this.on = true);
  },
  ready() { return !!(this.sb && this.user && this.space); },

  async session() {
    const { data } = await this.sb.auth.getSession();
    return (this.user = data.session ? data.session.user : null);
  },
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
  },
  async signUp(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw error;
    this.user = data.session ? data.user : null; // no session yet = the project wants the email confirmed first
    return data;
  },
  async signOut() { await this.sb.auth.signOut(); this.user = this.space = null; },

  /** Find this account's space, or join one with the invite code, or start a new one. */
  async ensureSpace() {
    let r = await this.sb.rpc('my_space');
    if (r.error) throw r.error;
    if (r.data && r.data.length) return (this.space = r.data[0]);
    const code = (localStorage.getItem('tuffest.joincode') || '').trim();
    r = code ? await this.sb.rpc('join_space', { invite: code }) : await this.sb.rpc('create_space');
    if (r.error) throw r.error;
    localStorage.removeItem('tuffest.joincode');
    return (this.space = Array.isArray(r.data) ? r.data[0] : r.data);
  },
  /* remembered so the app can sync later even if it opens without a connection */
  cachedSpace() { try { return JSON.parse(localStorage.getItem('tuffest.space') || 'null'); } catch (e) { return null; } },

  /* ids this device has already seen in the cloud: a local vibe that's missing online AND was seen
     before has been deleted elsewhere; one that was never seen is new and gets uploaded */
  _k(name) { return `tuffest.${name}.${this.space.id}`; },
  known() { try { return new Set(JSON.parse(localStorage.getItem(this._k('known')) || '[]')); } catch (e) { return new Set(); } },
  setKnown(set) { try { localStorage.setItem(this._k('known'), JSON.stringify([...set])); } catch (e) { /* storage blocked */ } },
  pendingDeletes() { try { return JSON.parse(localStorage.getItem(this._k('del')) || '{}'); } catch (e) { return {}; } },
  addPendingDelete(id, paths) {
    if (!this.space) return;
    const d = this.pendingDeletes(); d[id] = paths;
    try { localStorage.setItem(this._k('del'), JSON.stringify(d)); } catch (e) { /* storage blocked */ }
  },
  clearPendingDelete(id) {
    const d = this.pendingDeletes(); delete d[id];
    try { localStorage.setItem(this._k('del'), JSON.stringify(d)); } catch (e) { /* storage blocked */ }
  },
};

function setSync(text) { $('#syncState').textContent = text ? `· ${text}` : ''; }

const pushing = new Set();

/** Upload any photos not online yet, then write the vibe's row. Throws if offline; the vibe stays dirty and retries. */
async function pushRecord(rec) {
  if (pushing.has(rec.id)) return;
  pushing.add(rec.id);
  try {
    const { sb, space } = Cloud;
    rec.paths = rec.paths || rec.photos.map(() => null);
    for (let i = 0; i < rec.photos.length; i++) {
      if (rec.paths[i]) continue;
      const path = `${space.id}/${rec.id}/${uid()}.jpg`;
      const { error } = await sb.storage.from('photos').upload(path, rec.photos[i], { contentType: 'image/jpeg' });
      if (error) throw error;
      rec.paths[i] = path;
    }
    rec.updatedAt = rec.updatedAt || Date.now();
    const { error } = await sb.from('vibes').upsert({
      id: rec.id, space_id: space.id, date: rec.date, title: rec.title || '', caption: rec.caption,
      gps: rec.gps || null, unfiled: !!rec.unfiled,
      photos: rec.paths.map((p, i) => ({ path: p, w: rec.dims[i][0], h: rec.dims[i][1] })),
      created_at: new Date(rec.createdAt).toISOString(), updated_at: new Date(rec.updatedAt).toISOString(),
    });
    if (error) throw error;
    const stale = (rec.cloudPaths || []).filter(p => !rec.paths.includes(p)); // photos removed by an edit
    if (stale.length) await sb.storage.from('photos').remove(stale).catch(() => {});
    rec.cloudPaths = [...rec.paths];
    // if it was edited again while uploading, the newer copy pushes itself; don't overwrite it
    if (state.list.find(v => v.id === rec.id) === rec) { rec.dirty = false; await DB.put(rec); }
  } finally { pushing.delete(rec.id); }
}

/** Fire-and-forget push right after saving. */
function pushSoon(rec) {
  if (!Cloud.ready()) return;
  setSync('saving…');
  pushRecord(rec).then(() => { const k = Cloud.known(); k.add(rec.id); Cloud.setKnown(k); setSync('synced'); })
    .catch(e => { console.warn(e); setSync('offline · will retry'); });
}

/** Bring one cloud row down into the local copy, fetching only the photos this phone doesn't have. */
async function pullRow(row, local) {
  const have = new Map();
  if (local) local.photos.forEach((b, i) => { const p = local.paths && local.paths[i]; if (p) have.set(p, b); });
  const photos = [];
  for (const ph of row.photos) {
    let blob = have.get(ph.path);
    if (!blob) {
      const { data, error } = await Cloud.sb.storage.from('photos').download(ph.path);
      if (error) throw error;
      blob = data;
    }
    photos.push(blob);
  }
  const rec = {
    id: row.id, createdAt: Date.parse(row.created_at), date: row.date, title: row.title || '',
    caption: row.caption || [], gps: row.gps || null, unfiled: !!row.unfiled,
    photos, dims: row.photos.map(p => [p.w, p.h]),
    paths: row.photos.map(p => p.path), cloudPaths: row.photos.map(p => p.path),
    updatedAt: Date.parse(row.updated_at), dirty: false,
  };
  await DB.put(rec);
  dropURLs(rec.id);
  state.list = state.list.filter(v => v.id !== rec.id).concat(rec);
}

let syncing = false, syncAgain = false;

/** Two-way sync: send deletions and new/edited vibes up, then pull whatever is new or newer. */
async function syncAll() {
  if (!Cloud.ready()) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSync('syncing…');
  try {
    let changed = false;
    for (const [id, paths] of Object.entries(Cloud.pendingDeletes())) {           // 1. deletions made here
      await Cloud.sb.from('vibes').delete().eq('id', id);
      if (paths.length) await Cloud.sb.storage.from('photos').remove(paths).catch(() => {});
      Cloud.clearPendingDelete(id);
    }
    const { data: rows, error } = await Cloud.sb.from('vibes').select('*').eq('space_id', Cloud.space.id); // 2. what's online
    if (error) throw error;
    const online = new Map(rows.map(r => [r.id, r]));
    const known = Cloud.known();

    for (const v of [...state.list]) {                                             // 3. local vs online
      const row = online.get(v.id);
      if (!row) {
        if (known.has(v.id) && !v.dirty) {                                         //    deleted on another device
          await DB.del(v.id); dropURLs(v.id);
          state.list = state.list.filter(x => x.id !== v.id);
          changed = true;
        } else await pushRecord(v);                                                //    new here: upload
      } else if (v.dirty && (v.updatedAt || 0) >= Date.parse(row.updated_at)) await pushRecord(v); // edited here
    }

    let n = 0;
    for (const row of rows) {                                                      // 4. pull new / newer
      const v = state.list.find(x => x.id === row.id);
      if (v && (v.dirty || Date.parse(row.updated_at) <= (v.updatedAt || 0))) continue;
      setSync(`syncing ${++n}…`);
      await pullRow(row, v);
      changed = true;
      if (n % 6 === 0) render(); // first sync on a new phone: show vibes as they arrive
    }
    Cloud.setKnown(new Set([...rows.map(r => r.id), ...state.list.filter(v => !v.dirty).map(v => v.id)]));
    if (changed) render();
    setSync('synced');
  } catch (e) {
    console.warn(e);
    setSync('offline · will retry');
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; syncAll(); }
  }
}

/* --- sign in screen --- */
let authMode = 'in';

function syncAuthMode() {
  const up = authMode === 'up';
  $('#authCodeRow').hidden = !up;
  $('#authGo').textContent = up ? 'Create account' : 'Sign in';
  $('#authSwap').textContent = up ? 'I already have an account' : 'New here? Create an account';
  $('#authPass').autocomplete = up ? 'new-password' : 'current-password';
  const invited = localStorage.getItem('tuffest.joincode');       // came in through an invite link
  $('#authNote').textContent = up
    ? (invited ? 'You’ve been invited to a shared space. Create your account to join it.'
      : 'Joining someone? Enter the space code they gave you. First one in? Leave it empty and you’ll get a code to share.')
    : '';
  if (up && invited) $('#authCode').value = invited;
  $('#authErr').hidden = true;
}

function showAuth() {
  syncAuthMode();
  $('#auth').hidden = false;
  document.body.classList.add('locked');
}
function hideAuth() {
  $('#auth').hidden = true;
  document.body.classList.remove('locked');
}

const authMessage = e => {
  const m = (e && e.message) || 'Something went wrong';
  if (/invalid login/i.test(m)) return 'That email and password don’t match.';
  if (/already registered/i.test(m)) return 'That email already has an account. Try signing in.';
  if (/password should be/i.test(m)) return 'Use a password with at least 6 characters.';
  return m;
};

async function submitAuth(e) {
  e.preventDefault();
  const email = $('#authEmail').value.trim(), pass = $('#authPass').value, err = $('#authErr'), go = $('#authGo');
  if (!email || !pass) { err.textContent = 'Enter your email and a password.'; err.hidden = false; return; }
  go.disabled = true; err.hidden = true;
  try {
    if (authMode === 'up') {
      const code = $('#authCode').value.trim().toLowerCase();
      if (code) localStorage.setItem('tuffest.joincode', code); else localStorage.removeItem('tuffest.joincode');
      const data = await Cloud.signUp(email, pass);
      if (!data.session) { // the project asks for email confirmation first
        authMode = 'in'; syncAuthMode();
        err.textContent = 'Check your email to confirm your account, then sign in here.'; err.hidden = false;
        return;
      }
    } else await Cloud.signIn(email, pass);
    await afterLogin();
    hideAuth();
  } catch (ex) {
    console.warn(ex);
    err.textContent = authMessage(ex); err.hidden = false;
  } finally { go.disabled = false; }
}

/** The link someone taps to join this space: the sign-up page opens with the code already in. */
function inviteLink() {
  const code = $('#acctCode').textContent.trim();
  return code ? `${location.origin}${location.pathname}?join=${encodeURIComponent(code)}` : '';
}

async function shareInvite() {
  const url = inviteLink();
  if (!url) return toast('Sign in first');
  try {
    if (navigator.share) { await navigator.share({ title: 'Tuffest', text: 'Come add to our vibes on Tuffest:', url }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }              // closed the share sheet: nothing to do
  try { await navigator.clipboard.writeText(url); toast('Invite link copied. Paste it into a message'); }
  catch (e) { window.prompt('Copy this invite link:', url); }
}

async function afterLogin() {
  try {
    await Cloud.ensureSpace();
    localStorage.removeItem('tuffest.joincode');                   // used up (or not needed)
    try { localStorage.setItem('tuffest.space', JSON.stringify({ id: Cloud.space.id, code: Cloud.space.code })); } catch (e) { /* storage blocked */ }
  } catch (e) {
    const cached = Cloud.cachedSpace();             // offline: carry on with the space we already know
    if (!cached) throw e;
    Cloud.space = cached;
  }
  updateAccountUI();
  await syncAll();
}

function updateAccountUI() {
  const on = Cloud.ready();
  $('#acct').hidden = !on;
  if (on) { $('#acctEmail').textContent = Cloud.user.email; $('#acctCode').textContent = Cloud.space.code; }
}

async function signOutNow() {
  const unsynced = state.list.filter(v => v.dirty).length;
  if (unsynced && !confirm(`${unsynced} vibe${unsynced > 1 ? 's haven’t' : ' hasn’t'} synced yet and would be lost. Sign out anyway?`)) return;
  await Cloud.signOut();
  try { localStorage.removeItem('tuffest.space'); } catch (e) { /* storage blocked */ }
  await DB.clear();                         // this phone's copy belongs to the account that just left
  state.urls.forEach(urls => urls.forEach(u => URL.revokeObjectURL(u)));
  state.urls.clear();
  state.list = [];
  state.open = null; state.views = {};
  closeSettings();
  setSync('');
  updateAccountUI();
  render();
  authMode = 'in';          // back on the sign-in form, not "create account"
  showAuth();
}

/* ============================== share a link ======================== */
/* "Share as a link" puts a snapshot of one vibe (date, title, caption, photos) online under a long random
   token. The link  https://SITE/s/TOKEN  previews in messages (netlify/functions/share.js) and opens the
   vibe for anyone, signed in or not. Nothing else in the space is reachable from it. */
let storyId = null;

const shareMap = () => { try { return JSON.parse(localStorage.getItem('tuffest.shares') || '{}'); } catch (e) { return {}; } };
const saveShareMap = m => { try { localStorage.setItem('tuffest.shares', JSON.stringify(m)); } catch (e) { /* storage blocked */ } };
const newToken = () => {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
};
const shareUrl = token => `${location.origin}/s/${token}`;

/** Upload public copies of the photos and write the snapshot row. Returns the token. */
async function createShare(v) {
  const { sb, space } = Cloud;
  const map = shareMap();
  const token = map[v.id] || newToken();               // sharing the same vibe again reuses (and refreshes) its link
  const urls = [];
  for (let i = 0; i < v.photos.length; i++) {
    const path = `${space.id}/${token}/${i}.jpg`;
    const { error } = await sb.storage.from('shared').upload(path, v.photos[i], { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    urls.push(sb.storage.from('shared').getPublicUrl(path).data.publicUrl + `?t=${v.updatedAt || 0}`);
  }
  const { error } = await sb.from('shares').upsert({
    token, vibe_id: v.id, space_id: space.id, date: v.date, title: v.title || '', caption: v.caption,
    photos: v.photos.map((_, i) => ({ url: urls[i], w: v.dims[i][0], h: v.dims[i][1] })),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  map[v.id] = token;
  saveShareMap(map);
  return token;
}

async function shareLinkNow() {
  const v = state.list.find(x => x.id === storyId);
  if (!v || !Cloud.ready()) return toast('Sign in to share a link');
  const btn = $('#storyLink');
  btn.disabled = true;
  toast('Making your link…');
  try {
    const url = shareUrl(await createShare(v));
    $('#storyUnshare').hidden = false;
    $('#toast').classList.remove('on');
    try {
      if (navigator.share) { await navigator.share({ title: v.title || 'A vibe', text: 'Look at this vibe:', url }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Link copied. Paste it into a message'); }
    catch (e) { window.prompt('Copy this link:', url); }
  } catch (e) {
    console.warn(e);
    toast('Couldn’t make the link. Is the share setup (supabase-share.sql) run?');
  } finally { btn.disabled = false; }
}

/** Take the link down: the snapshot row and its public photo copies are deleted. */
async function stopSharing() {
  const map = shareMap(), token = map[storyId];
  if (!token || !Cloud.ready()) return;
  if (!confirm('Stop sharing? The link will stop working.')) return;
  try {
    await Cloud.sb.from('shares').delete().eq('token', token);
    await Cloud.sb.storage.from('shared').remove([0, 1, 2, 3].map(i => `${Cloud.space.id}/${token}/${i}.jpg`)).catch(() => {});
    delete map[storyId];
    saveShareMap(map);
    $('#storyUnshare').hidden = true;
    toast('Link turned off');
  } catch (e) { console.warn(e); toast('Couldn’t turn the link off. Try again'); }
}

/* --- the page a shared link opens --- */
function sharedCardHTML(s, token) {
  const dims = s.photos.map(p => [p.w || 4, p.h || 3]);
  const frames = framesHTML(layoutOf(dims), s.photos.map(p => esc(p.url)));
  const v = { id: token, caption: s.caption || [] }; // same caption layout as a card: one place per line, steady random offsets
  const caption = captionHTML(v);
  return `<article class="card static"><div class="card-in">
    <div class="cap"><div class="cap-top mono"><span>${fmtDate(s.date)}</span></div>${s.title ? `<h3 class="title">${esc(s.title)}</h3>` : ''}</div>
    ${frames}
    ${caption ? `<div class="write cap-lines">${caption}</div>` : ''}
  </div></article>`;
}

async function showShared(token) {
  const box = $('#sharedCard');
  box.innerHTML = '';
  $('#shared').hidden = false;
  document.body.classList.add('locked');
  let share = null;
  try {
    const { data, error } = await Cloud.sb.rpc('get_share', { t: token });
    if (error) throw error;
    share = data && data[0];
  } catch (e) { console.warn(e); }
  if (!share) {
    box.innerHTML = '<p class="shared-gone">This vibe isn’t shared anymore.</p>';
    $('#sharedAdd').textContent = 'Make your own';
    return;
  }
  $('#sharedOpen').textContent = Cloud.ready() ? 'go to my vibes' : 'I already have an account';
  box.innerHTML = sharedCardHTML(share, token);
  requestAnimationFrame(() => placeLines(box));
  replaceOnImageLoad(box);
}

/** Once the photos load, re-place the caption lines (their widths can change the layout). */
function replaceOnImageLoad(root) { root.querySelectorAll('img').forEach(i => i.addEventListener('load', () => placeLines(root), { once: true })); }

function hideShared() {
  $('#shared').hidden = true;
  document.body.classList.remove('locked');
}

/** The small link under "Add vibe": back to your own vibes, or sign in if you already have an account. */
function openFromShared() {
  hideShared();
  if (!Cloud.ready()) { authMode = 'in'; showAuth(); }
}

/** "Add vibe" on a shared vibe: signed-in people go straight to adding; everyone else signs up first (their own space). */
function addFromShared() {
  hideShared();
  if (Cloud.ready()) { $('#fileInput').click(); return; }
  try { localStorage.removeItem('tuffest.joincode'); } catch (e) { /* storage blocked */ } // a fresh account, not the sender's space
  authMode = 'up';
  showAuth();
}

/* ============================== settings ============================ */
function openSettings() { $('#keyInput').value = state.mapsKey; setSheet($('#settings'), true); }
function closeSettings() { if ($('#settings').classList.contains('on')) setSheet($('#settings'), false); }

/* ============================== boot ================================ */
function bind() {
  $('#addBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => {
    const files = [...e.target.files];
    e.target.value = '';
    // panel open = more photos for that vibe; otherwise it's a fresh camera-roll upload
    if (draft && $('#panel').classList.contains('on')) addFilesToDraft(files); else startUpload(files);
  };
  $('#panelClose').onclick = () => closePanel();
  $('#scrim').onclick = () => { closeSettings(); closePanel(); };
  $('#saveBtn').onclick = () => fileCurrent(false);
  $('#laterBtn').onclick = () => fileCurrent(true);
  $('#dropBtn').onclick = dropCurrent;
  $('#dateInput').oninput = e => { draft.date = e.target.value; draft.dateTouched = true; draft.dirty = true; };
  $('#titleInput').oninput = e => { draft.title = e.target.value; draft.dirty = true; };
  bindEditor();
  bindComposer();

  document.querySelectorAll('#themes .sw').forEach(b => { b.onclick = () => setTheme(b.dataset.theme, true); });
  document.querySelectorAll('#storyOpts .story-opt').forEach(opt => {
    $('.share', opt).onclick = () => shareStory(opt.dataset.mode);
    $('.keep', opt).onclick = () => saveStory(opt.dataset.mode);
  });
  $('#storyClose').onclick = closeStory;
  $('#storyLink').onclick = shareLinkNow;
  $('#storyUnshare').onclick = stopSharing;
  $('#sharedAdd').onclick = addFromShared;
  $('#sharedOpen').onclick = openFromShared;
  $('#story').onclick = e => { if (e.target.id === 'story') closeStory(); };
  $('#settingsBtn').onclick = openSettings;
  $('#settingsClose').onclick = closeSettings;
  $('#keySave').onclick = () => {
    const key = $('#keyInput').value.trim();
    try { key ? localStorage.setItem(KEY_STORE, key) : localStorage.removeItem(KEY_STORE); } catch (e) { return toast('Couldn’t store the key on this device'); }
    toast(key ? 'Key saved' : 'Key cleared');
    setTimeout(() => location.reload(), 500); // Maps loads once per page, so reload to apply
  };

  // views menu + the calendar's day sheet
  $('#viewsBtn').onclick = e => { e.stopPropagation(); $('#viewsMenu').hidden ? openViews() : closeViews(); };
  document.addEventListener('click', e => { if (!e.target.closest('#viewsMenu')) closeViews(); });
  $('#dayClose').onclick = closeDay;
  $('#day').onclick = e => { if (e.target.id === 'day') closeDay(); };
  $('#dayBody').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('.card').dataset.id;
    closeDay(); // the editor / story / delete prompt takes over; the calendar redraws behind it
    runCardAct(b.dataset.act, id);
  });

  // account + sync
  $('#authForm').onsubmit = submitAuth;
  $('#authSwap').onclick = () => { authMode = authMode === 'up' ? 'in' : 'up'; syncAuthMode(); };
  $('#syncNow').onclick = () => { toast('Syncing…'); syncAll(); };
  $('#inviteBtn').onclick = shareInvite;
  $('#signOut').onclick = signOutNow;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAll(); });
  window.addEventListener('online', syncAll);
}

async function boot() {
  // the key saved on this phone wins; otherwise the one in config.js (so a hosted site needs no pasting per phone)
  try { state.mapsKey = localStorage.getItem(KEY_STORE) || ''; } catch (e) { /* storage blocked */ }
  state.mapsKey = state.mapsKey || (window.TUFFEST_CONFIG && window.TUFFEST_CONFIG.mapsKey) || '';
  setTheme(document.documentElement.dataset.theme || 'white', false);
  try { const v = localStorage.getItem(VIEW_STORE); if (VIEWS.some(x => x.id === v)) state.view = v; } catch (e) { /* storage blocked */ }
  bind();
  try { state.list = await DB.all(); } catch (e) { console.warn(e); }
  // bring older entries up to date: caption, optional title, and photo sizes (they drive the layout)
  await Promise.all(state.list.map(async v => {
    if (!v.caption) v.caption = legacyCaption(v);
    if (v.title === undefined) v.title = (v.note || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!v.dims || v.dims.length !== v.photos.length) {
      v.dims = [];
      for (const b of v.photos) { const d = await dimsOf(b); v.dims.push([d.w, d.h]); }
      DB.put(v).catch(() => {});
    }
  }));
  render();

  // an invite link looks like  .../app/?join=CODE : remember the code and open the sign-up form
  const invite = (new URLSearchParams(location.search).get('join') || '').trim().toLowerCase();
  if (invite) {
    try { localStorage.setItem('tuffest.joincode', invite); } catch (e) { /* storage blocked */ }
    history.replaceState(null, '', location.pathname);              // keep the address bar tidy
    authMode = 'up';
  }

  // a shared-vibe link looks like  .../app/?v=TOKEN : anyone can open it, no account needed
  const sharedToken = (new URLSearchParams(location.search).get('v') || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);

  // cloud: show what's on this phone straight away, then sign in / sync in the background
  if (Cloud.init()) {
    try {
      if (await Cloud.session()) { if (invite) toast('You’re already signed in'); await afterLogin(); }
      else if (!sharedToken) showAuth();                              // a shared vibe is shown first; sign-up comes from "Add vibe"
    } catch (e) { console.warn(e); setSync('offline · will retry'); }
    if (sharedToken) showShared(sharedToken);
  }
}
boot();

})();
