import { requestPersist } from './db.js';
import { S, loadAll, totalUnread } from './state.js';
import { bus } from './services.js';
import { icon } from './icons.js';
import { $, $$ } from './ui.js';
import * as home from './home.js';
import * as live from './live.js';
import * as story from './story.js';
import * as dm from './dm.js';
import * as feed from './feed.js';
import * as album from './album.js';
import * as vault from './vault.js';

const VIEWS = { home, live, story, dm, feed, album, vault };
const TAB_OF = { home: 'home', vault: 'home', live: 'live', story: 'story', dm: 'dm', feed: 'feed', album: 'album' };
const TABS = [
  ['home', 'home', 'HOME'], ['live', 'live', 'LIVE'], ['story', 'book', 'STORY'],
  ['dm', 'dm', 'DM'], ['feed', 'feed', 'FEED'], ['album', 'album', 'ALBUM'],
];

let current = null;
let cleanup = null;

export async function nav(to, params = {}) {
  if (cleanup) { try { cleanup(); } catch (_) {} cleanup = null; }
  current = to;
  const root = $('#view');
  root.innerHTML = '';
  root.scrollTop = 0;
  document.body.dataset.view = to;
  setBackground(null);
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === TAB_OF[to]));
  try { localStorage.setItem('kyojuu-last-view', to === 'vault' ? 'home' : to); } catch (_) {}
  const r = await VIEWS[to].render(root, params, { nav, setBackground });
  cleanup = typeof r === 'function' ? r : null;
}

let bgCur = null;
export function setBackground(url) {
  const el = $('#bg');
  if (url === bgCur) return;
  bgCur = url;
  if (!url) { el.style.backgroundImage = ''; el.classList.remove('on'); return; }
  const img = new Image();
  img.onload = () => { if (bgCur === url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('on'); } };
  img.src = url;
}

function renderTabs() {
  const bar = $('#tabbar');
  bar.innerHTML = TABS.map(([id, ic, label]) => `<button class="tab" data-tab="${id}">${icon(ic, 26)}<span>${label}</span>${id === 'dm' ? '<i class="badge" hidden></i>' : ''}</button>`).join('');
  $$('.tab', bar).forEach(b => b.onclick = () => nav(b.dataset.tab));
  updateBadge();
}

function updateBadge() {
  const n = totalUnread();
  const b = $('#tabbar .badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : n;
}

function applyFont() { document.documentElement.style.setProperty('--fs', S.settings.fontSize + 'px'); }

async function init() {
  applyFont();
  requestPersist();
  await loadAll();
  renderTabs();
  bus.addEventListener('unread', updateBadge);
  bus.addEventListener('nav', (e) => nav(e.detail.to, e.detail));
  bus.addEventListener('settings', applyFont);
  let last = 'home';
  try { last = localStorage.getItem('kyojuu-last-view') || 'home'; } catch (_) {}
  await nav(VIEWS[last] ? last : 'home');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
