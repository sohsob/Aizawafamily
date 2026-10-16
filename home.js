import { S, avatarHtml, saveLive } from './state.js';
import { NPCS, FLOORS, bgUrl, jstParts, roomById, charById } from './data.js';
import { db } from './db.js';
import { icon } from './icons.js';
import { esc } from './render.js';
import { $, $$, confirmBox, toast } from './ui.js';
import { bus } from './services.js';
import { saveSettings } from './settings.js';
import { yokohamaWeather } from './weather.js';

export async function render(root, params, { nav, setBackground }) {
  const draw = async () => {
    const p = jstParts();
    const groupMsgs = await db.messages('group');
    const lastGroup = groupMsgs[groupMsgs.length - 1];
    const lastMode = (() => { try { return localStorage.getItem('kyojuu-mode') || 'live'; } catch (_) { return 'live'; } })();
    const present = {};
    for (const c of NPCS) {
      const v = S.live.locations[c.id];
      if (v) (present[v.room] = present[v.room] || []).push(c);
    }
    (present[S.live.umiRoom] = present[S.live.umiRoom] || []).push(charById('umi'));
    const outside = present.outside || [];

    root.innerHTML = `
    <div class="home">
      <header class="home-head">
        <div class="eyebrow">AIZAWA FAMILY</div>
        <div class="clock">${p.m}/${p.d} ${p.hh}:${p.mm}</div>
        <button class="sync ${S.settings.syncOn ? 'on' : ''}"><i></i>現実時間同期 ${S.settings.syncOn ? 'ON' : 'OFF'}</button>
        <div class="weather"></div>
        <div class="bgstat"></div>
      </header>
      <div class="seg">
        <button data-mode="story" class="${lastMode === 'story' ? 'on' : ''}">STORY</button>
        <button data-mode="live" class="${lastMode === 'live' ? 'on' : ''}">LIVE</button>
      </div>
      <section class="card avatars">
        ${NPCS.map(c => `<button class="av" data-dm="${c.id}">${avatarHtml(c.id, 62)}${S.unread.dm[c.id] ? '<i class="dot"></i>' : ''}<span>${esc(c.short)}</span></button>`).join('')}
      </section>
      <section class="card group-card">
        <button class="group-av">${S.avatars.group ? `<span class="avatar" style="width:84px;height:84px"><img src="${S.avatars.group}" alt="Family Group"></span>` : `<span class="avatar noimg" style="width:84px;height:84px">${icon('users', 34)}</span>`}</button>
        <button class="group-body">
          <div class="row"><strong>Family Group LINE</strong>${S.unread.group ? '<em>通知</em>' : ''}</div>
          <div class="preview">${lastGroup ? esc(lastGroup.role === 'user' ? 'うみ：' + lastGroup.content : lastGroup.content.split('\n')[0]) : 'まだメッセージはありません'}</div>
        </button>
      </section>
      <h2 class="section">RESIDENCE MAP</h2>
      ${FLOORS.map(f => `
        <section class="card floor">
          <div class="floor-id">${f.id}</div>
          <div class="rooms">
            ${f.rooms.map(r => `
              <button class="room" data-room="${r.id}">
                <div class="room-row">${icon(r.icon, 24)}<span class="room-name">${esc(r.name)}</span>${r.private ? `<span class="private">${icon('lock', 16)}PRIVATE</span>` : ''}</div>
                ${r.private ? `<div class="allowed">入室可：${r.allowed.map(id => charById(id).short).join('・')}</div>` : ''}
                ${present[r.id] ? `<div class="chips">${present[r.id].map(c => `<span class="chip ${c.user ? 'me' : ''}">${esc(c.short)}</span>`).join('')}</div>` : ''}
              </button>`).join('')}
          </div>
        </section>`).join('')}
      ${outside.length ? `<section class="card floor"><div class="floor-id">OUT</div><div class="rooms"><div class="room static">
        <div class="room-row">${icon('mapPin', 24)}<span class="room-name">外出中</span></div>
        <div class="chips">${outside.map(c => `<span class="chip" title="${esc((S.live.locations[c.id] || {}).label || '')}">${esc(c.short)}${(S.live.locations[c.id] || {}).label ? `<small>${esc(S.live.locations[c.id].label)}</small>` : ''}</span>`).join('')}</div>
      </div></div></section>` : ''}
      <h2 class="section">COMING UP</h2>
      ${S.live.comingUp.length ? S.live.comingUp.map(c => `
        <section class="card upcoming">${icon('calendar', 30)}<div><div class="up-title">${esc(c.time)}${c.room ? ` ・ ${esc(c.room)}` : ''}</div><div class="up-text">${esc(c.text)}</div></div></section>`).join('')
        : '<section class="card upcoming empty">予定はまだありません</section>'}
      <h2 class="section">AI CORE</h2>
      <button class="card core" data-panel="docs">${icon('database', 30)}<div><div class="core-title">Prompt Vault</div><div class="core-sub">原文保管庫</div></div><span class="open">OPEN</span></button>
      <button class="card core" data-panel="media">${icon('image', 30)}<div><div class="core-title">Faces & Rooms</div><div class="core-sub">アイコン・部屋の背景</div></div><span class="open">OPEN</span></button>
      <button class="card core" data-panel="settings">${icon('settings', 30)}<div><div class="core-title">Settings</div><div class="core-sub">APIキー・モデル・バックアップ${S.settings.anthropicKey ? '' : '（APIキー未入力）'}</div></div><span class="open">OPEN</span></button>
    </div>`;

    setBackground(bgUrl('home', S.bg));
    yokohamaWeather().then(w => { const el = $('.weather', root); if (el && w) el.textContent = w.replace(/^横浜：/, '横浜 '); });
    $('.sync', root).onclick = () => { S.settings.syncOn = !S.settings.syncOn; saveSettings(S.settings); draw(); };
    $$('.seg button', root).forEach(b => b.onclick = () => { try { localStorage.setItem('kyojuu-mode', b.dataset.mode); } catch (_) {} nav(b.dataset.mode); });
    $$('[data-dm]', root).forEach(b => b.onclick = () => nav('dm', { chat: b.dataset.dm }));
    $('.group-av', root).onclick = $('.group-body', root).onclick = () => nav('dm', { chat: 'group' });
    $$('[data-room]', root).forEach(b => b.onclick = async () => {
      const r = roomById(b.dataset.room);
      if (r.id === S.live.umiRoom) { nav('live'); return; }
      if (!(await confirmBox('移動', `うみが「${r.floor} ${r.name}」へ移動します。`, '移動する'))) return;
      nav('live', { move: r.id });
    });
    $$('[data-panel]', root).forEach(b => b.onclick = () => nav('vault', { panel: b.dataset.panel }));
  };
  await draw();
  const timer = setInterval(() => {
    const p = jstParts();
    const c = $('.clock', root);
    if (c) c.textContent = `${p.m}/${p.d} ${p.hh}:${p.mm}`;
    setBackground(bgUrl('home', S.bg));
  }, 15000);
  const re = () => draw();
  const bgs = (e) => { const el = $('.bgstat', root); if (el) el.textContent = e.detail.text || ''; };
  bus.addEventListener('bg', bgs);
  bus.addEventListener('live-state', re);
  bus.addEventListener('unread', re);
  return () => { bus.removeEventListener('bg', bgs); clearInterval(timer); bus.removeEventListener('live-state', re); bus.removeEventListener('unread', re); };
}
