// 人物・部屋・時間帯・背景の固定データ
export const CHARACTERS = [
  { id: 'umi', short: 'うみ', full: '相澤うみ', profile: '相澤うみ.txt', user: true, aliases: [] },
  { id: 'shota', short: '消太', full: '相澤消太', profile: '相澤消太A3.txt', aliases: ['イレイザーヘッド', 'イレイザー'] },
  { id: 'kai', short: 'カイ', full: '狩屋カイ', profile: '狩屋カイA3.txt', aliases: ['狩屋'] },
  { id: 'keigo', short: '啓悟', full: '鷹見啓悟', profile: '鷹見啓悟A3.txt', aliases: ['ホークス', '鷹見'] },
  { id: 'saku', short: '朔', full: '相澤朔', profile: '相澤朔A3.txt', aliases: [] },
  { id: 'sora', short: '宙', full: '相澤宙', profile: '相澤宙A3 .txt', aliases: [] },
  { id: 'nanami', short: '七海', full: '相澤七海', profile: '相澤七海A3.txt', aliases: [] },
];
export const NPCS = CHARACTERS.filter(c => !c.user);
export const charById = (id) => CHARACTERS.find(c => c.id === id);

const norm = (s) => String(s || '').replace(/沢/g, '澤').replace(/[\s　]/g, '');
export function findChar(name) {
  const n = norm(name);
  if (!n) return null;
  for (const c of CHARACTERS) {
    const keys = [c.full, c.short, ...c.aliases].map(norm);
    if (keys.includes(n)) return c;
  }
  for (const c of CHARACTERS) {
    if (n.includes(norm(c.full))) return c;
  }
  for (const c of CHARACTERS) {
    if (c.short.length >= 2 && n.endsWith(norm(c.short))) return c;
    if (c.short.length === 1 && (n === c.short || n.endsWith('澤' + c.short))) return c;
  }
  return null;
}

// 背景：timed は時間帯で切り替わる（prefix-band.jpg）
export const FLOORS = [
  { id: 'ROOF', rooms: [{ id: 'roof', name: '屋上デッキ', icon: 'sun', timed: 'roof' }] },
  { id: '5F', rooms: [
    { id: 'lab', name: '研究室', icon: 'flask', bg: 'lab' },
    { id: 'medical', name: '医務室', icon: 'heartPulse', bg: 'medical' },
    { id: 'keigo-room', name: '啓悟の部屋', icon: 'home', bg: 'keigo' },
  ] },
  { id: '4F', rooms: [
    { id: 'couple-living', name: '夫婦リビング', icon: 'sofa', bg: 'couple-living', private: true, allowed: ['shota', 'umi', 'saku', 'sora', 'nanami'] },
    { id: 'couple-bedroom', name: '夫婦寝室', icon: 'home', bg: 'couple-bedroom' },
    { id: 'shota-study', name: '消太の書斎', icon: 'book', bg: 'shota-study' },
  ] },
  { id: '3F', rooms: [
    { id: 'security', name: 'セキュリティ室', icon: 'shield', bg: 'security' },
    { id: 'kai-room', name: 'カイの部屋', icon: 'home', bg: 'kai' },
    { id: 'training-room', name: 'トレーニングルーム', icon: 'dumbbell', bg: 'training-room' },
  ] },
  { id: '2F', rooms: [
    { id: 'saku-room', name: '朔の部屋', icon: 'home', bg: 'saku' },
    { id: 'sora-room', name: '宙の部屋', icon: 'home', bg: 'sora' },
    { id: 'nanami-room', name: '七海の部屋', icon: 'home', bg: 'nanami' },
  ] },
  { id: '1F', rooms: [{ id: 'kyoyu', name: '共有スペース', icon: 'users', timed: 'kyoyu' }] },
  { id: 'B1', rooms: [{ id: 'training-ground', name: '訓練場', icon: 'dumbbell', bg: 'training-ground' }] },
];
export const ROOMS = FLOORS.flatMap(f => f.rooms.map(r => ({ ...r, floor: f.id })));
export const OUTSIDE = { id: 'outside', name: '外出中', floor: 'OUT', icon: 'mapPin', bg: null };
export const roomById = (id) => ROOMS.find(r => r.id === id) || (id === 'outside' ? OUTSIDE : null);
export const roomLabel = (r) => r ? (r.floor === 'OUT' ? r.name : `${r.floor} ${r.name}`) : '';

export function findRoom(text) {
  const t = String(text || '').replace(/\s/g, '');
  if (!t) return null;
  let best = null;
  for (const r of ROOMS) {
    if (t.includes(r.name)) { if (!best || r.name.length > best.name.length) best = r; }
  }
  if (best) return best;
  const alias = [
    [/リビング|共有|キッチン|1F|１階/, 'kyoyu'], [/屋上|デッキ/, 'roof'], [/研究/, 'lab'], [/医務/, 'medical'],
    [/寝室/, 'couple-bedroom'], [/書斎/, 'shota-study'], [/セキュリティ|警備/, 'security'], [/トレーニング|ジム/, 'training-room'],
    [/訓練場|地下|B1|シェルター/, 'training-ground'],
  ];
  for (const [re, id] of alias) if (re.test(t)) return roomById(id);
  for (const c of NPCS) if (t.includes(c.short + 'の部屋') || t.includes(c.short + '部屋')) return roomById(c.id === 'keigo' ? 'keigo-room' : c.id + '-room');
  return null;
}

// 同梱している背景
const BUNDLED = new Set([
  'home-dawn', 'home-morning', 'home-day', 'home-evening', 'home-night', 'home-late',
  'roof-dawn', 'roof-morning', 'roof-day', 'roof-evening', 'roof-night', 'roof-late',
  'kyoyu-dawn', 'kyoyu-day', 'kyoyu-evening', 'kyoyu-night', 'kyoyu-late', 'lab', 'medical', 'keigo', 'couple-living', 'couple-bedroom', 'shota-study',
  'security', 'kai', 'saku', 'training-room', 'sora', 'nanami', 'training-ground',
]);

export const BANDS = [
  { id: 'dawn', label: '薄明', from: 4, to: 6 },
  { id: 'morning', label: '朝', from: 6, to: 9 },
  { id: 'day', label: '昼', from: 9, to: 16 },
  { id: 'evening', label: '夕方', from: 16, to: 18 },
  { id: 'night', label: '夜', from: 18, to: 23 },
  { id: 'late', label: '深夜', from: 23, to: 28 },
];
const FALLBACK = {
  dawn: ['dawn', 'morning', 'late', 'night', 'day', 'evening'],
  morning: ['morning', 'day', 'dawn', 'evening', 'night', 'late'],
  day: ['day', 'morning', 'evening', 'dawn', 'night', 'late'],
  evening: ['evening', 'day', 'night', 'morning', 'dawn', 'late'],
  night: ['night', 'late', 'evening', 'dawn', 'day', 'morning'],
  late: ['late', 'night', 'dawn', 'evening', 'day', 'morning'],
};

export function jstParts(date = new Date()) {
  const f = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const hour = (+p.hour) % 24;
  return { y: p.year, m: p.month, d: p.day, hh: String(hour).padStart(2, '0'), mm: p.minute, hour, wd: p.weekday, date: `${p.year}-${p.month}-${p.day}` };
}

export function bandOf(date = new Date()) {
  const h = jstParts(date).hour;
  const hh = h < 4 ? h + 24 : h;
  return BANDS.find(b => hh >= b.from && hh < b.to) || BANDS[5];
}

// overrides: { 'roomId' : dataUrl, 'roomId:band': dataUrl }
export function bgUrl(roomId, overrides = {}, date = new Date()) {
  const band = bandOf(date).id;
  if (overrides[`${roomId}:${band}`]) return overrides[`${roomId}:${band}`];
  if (overrides[roomId]) return overrides[roomId];
  const prefix = roomId === 'home' ? 'home' : (roomById(roomId) || {}).timed;
  if (prefix) {
    for (const b of FALLBACK[band]) {
      if (overrides[`${roomId}:${b}`]) return overrides[`${roomId}:${b}`];
      if (BUNDLED.has(`${prefix}-${b}`)) return `bg-${prefix}-${b}.jpg`;
    }
    return null;
  }
  const r = roomById(roomId);
  return r && r.bg && BUNDLED.has(r.bg) ? `bg-${r.bg}.jpg` : null;
}

export const DEFAULT_AVATARS = new Set(['umi', 'shota', 'kai', 'keigo', 'saku', 'sora', 'nanami']);
export const avatarUrl = (id, own = {}) => own[id] || (DEFAULT_AVATARS.has(id) ? `avatar-${id}.jpg` : null);
export const dmBgUrl = (id, bg = {}) => bg['dm:' + id] || (id !== 'group' && id !== 'umi' && DEFAULT_AVATARS.has(id) ? `dmbg-${id}.jpg` : null);
export const isTimed = (roomId) => roomId === 'home' || !!(roomById(roomId) || {}).timed;
