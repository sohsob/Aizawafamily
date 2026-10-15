// アプリ全体の状態と保存まわり
import { db, uid } from './db.js';
import { loadSettings } from './settings.js';
import { CHARACTERS, charById, findChar, avatarUrl } from './data.js';
import { esc } from './render.js';

export const S = {
  settings: loadSettings(),
  docs: [],
  threads: [],
  avatars: {},
  bg: {},
  live: null,
  unread: { dm: {}, group: 0 },
  busy: false,
  lastUsage: null,
};

const LIVE_DEFAULT = () => ({ lastSync: null, locations: {}, umiRoom: 'kyoyu', comingUp: [], recordedDates: [], windowStart: 0 });

export async function loadAll() {
  S.docs = (await db.all('docs')).map(migrateDoc).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  S.threads = (await db.all('threads')).sort((a, b) => b.updatedAt - a.updatedAt);
  S.avatars = await db.getKV('avatars', {});
  S.bg = await db.getKV('bg', {});
  S.live = { ...LIVE_DEFAULT(), ...(await db.getKV('live', {})) };
  S.unread = await db.getKV('unread', { dm: {}, group: 0 });
}

// 旧形式（role）からの移行
function migrateDoc(d) {
  if (!d.base) {
    d.base = guessBase(d.name);
    if (d.role === 'base' && !d.base.story && !d.base.live) d.base = { story: true, live: false };
  }
  return d;
}

export function guessBase(name) {
  if (/LIVE\s*MODE|LIVEMODE/i.test(name)) return { story: false, live: true };
  if (/ストーリープロンプト|ストーリー生成/.test(name)) return { story: true, live: false };
  if (/世界観/.test(name)) return { story: true, live: true };
  return { story: false, live: false };
}

export const saveLive = () => db.setKV('live', S.live);
export const saveUnread = () => db.setKV('unread', S.unread);
export const saveAvatars = () => db.setKV('avatars', S.avatars);
export const saveBg = () => db.setKV('bg', S.bg);

export async function saveDoc(d) {
  d.updatedAt = Date.now();
  await db.put('docs', d);
  S.docs = S.docs.filter(x => x.name !== d.name).concat(d).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export async function appendToDoc(name, header, text) {
  let d = S.docs.find(x => x.name === name);
  if (!d) d = { name, content: '', base: { story: false, live: false } };
  d.content = (d.content ? d.content.replace(/\s+$/, '') + '\n\n\n' : '') + header + '\n\n' + text.trim() + '\n';
  await saveDoc(d);
  return d;
}

let lastSeq = 0;
export async function addMessage(threadId, role, content, extra = {}) {
  lastSeq = Math.max(lastSeq + 1, Date.now() * 100);
  const m = { id: uid(), threadId, seq: lastSeq, role, content, createdAt: Date.now(), ...extra };
  await db.put('messages', m);
  return m;
}

export function avatarHtml(id, size = 40, cls = '') {
  const c = charById(id);
  const url = avatarUrl(id, S.avatars);
  const label = c ? c.short : '?';
  return url
    ? `<span class="avatar ${cls}" style="width:${size}px;height:${size}px"><img src="${url}" alt="${esc(label)}"></span>`
    : `<span class="avatar noimg ${cls}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${esc(label.slice(0, 1))}</span>`;
}

// ALBUMから参考画像とNG情報を選ぶ
export async function albumRefs(names = []) {
  const ids = [...new Set(names.map(n => (findChar(n) || {}).id).filter(Boolean))];
  if (!ids.length) return { refs: [], ng: [] };
  const photos = (await db.all('photos')).sort((a, b) => b.createdAt - a.createdAt);
  const refs = [];
  const ng = [];
  for (const id of ids) {
    const ok = photos.filter(p => p.persons && p.persons[id] === 'ok').slice(0, 2);
    for (const p of ok) if (!refs.includes(p)) refs.push(p);
    const bad = photos.filter(p => p.persons && p.persons[id] === 'ng' && p.note).slice(0, 3);
    for (const p of bad) ng.push(`${charById(id).full}：${p.note}`);
  }
  return { refs: refs.slice(0, 8), ng };
}

export async function savePhoto({ dataUrl, album, prompt = '', source = 'upload', characters = [] }) {
  const p = { id: uid(), album: album || '未分類', dataUrl, overall: '', persons: {}, note: '', prompt, source, characters, createdAt: Date.now() };
  await db.put('photos', p);
  return p;
}

export function totalUnread() {
  return Object.values(S.unread.dm || {}).reduce((a, b) => a + b, 0) + (S.unread.group || 0);
}

export { CHARACTERS };
