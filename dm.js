import { db } from './db.js';
import { S, avatarHtml, addMessage, saveUnread, saveLive } from './state.js';
import { NPCS, charById, findChar, dmBgUrl } from './data.js';
import { buildSystem, withCacheOnLast, appendInstruction, generate } from './engine.js';
import { requireKey, liveDyn, threadHistory, emit, recentLive } from './services.js';
import { esc } from './render.js';
import { icon } from './icons.js';
import { $, $$, h, toast, setStatus, sheet, confirmBox, promptBox, composer, timeHM, dateMD } from './ui.js';

const threadOf = (id) => (id === 'group' ? 'group' : 'dm:' + id);

async function lastOf(id) {
  const m = await db.messages(threadOf(id));
  return m.filter(x => x.role === 'user' || x.role === 'assistant').pop();
}

function stamp(ms) {
  const today = dateMD(Date.now());
  return dateMD(ms) === today ? timeHM(ms) : dateMD(ms);
}

export async function render(root, params, ctx) {
  if (params.chat) return renderChat(root, params.chat, ctx);
  return renderList(root, ctx);
}

async function renderList(root, { nav }) {
  const rows = [];
  for (const c of [{ id: 'group', full: 'Family Group LINE', short: 'グループ' }, ...NPCS]) {
    const last = await lastOf(c.id);
    rows.push({ c, last });
  }
  root.innerHTML = `
    <div class="page dm-list">
      <div class="eyebrow">AIZAWA FAMILY</div>
      <h1>DM</h1>
      <label class="search">${icon('search', 20)}<input placeholder="メンバーを検索"></label>
      <div class="rows"></div>
    </div>`;
  const box = $('.rows', root);
  const draw = (q = '') => {
    box.innerHTML = '';
    for (const { c, last } of rows) {
      if (q && !(c.full + c.short).includes(q)) continue;
      const unread = c.id === 'group' ? S.unread.group : S.unread.dm[c.id];
      const preview = last ? (last.role === 'user' ? last.content : last.content.split(/\n/)[0]) : (c.id === 'group' ? '家族のグループ' : 'メッセージを送る');
      const av = c.id === 'group'
        ? (S.avatars.group ? `<span class="avatar" style="width:62px;height:62px"><img src="${S.avatars.group}" alt=""></span>` : `<span class="avatar noimg" style="width:62px;height:62px">${icon('users', 26)}</span>`)
        : avatarHtml(c.id, 62);
      const row = h(`<button class="dm-row">${av}<div class="dm-mid"><div class="dm-top"><strong>${esc(c.full)}</strong><time>${last ? stamp(last.createdAt) : ''}</time></div><div class="dm-prev">${esc(preview)}</div></div>${unread ? `<i class="count">${unread}</i>` : ''}</button>`);
      row.onclick = () => nav('dm', { chat: c.id });
      box.appendChild(row);
    }
  };
  draw();
  $('.search input', root).oninput = (e) => draw(e.target.value.trim());
}


async function renderChat(root, id, { nav, setBackground }) {
  document.body.dataset.view = 'dmchat';
  setBackground(dmBgUrl(id, S.bg));
  const isGroup = id === 'group';
  const char = isGroup ? null : charById(id);
  const tid = threadOf(id);
  let msgs = await db.messages(tid);
  let abort = null;
  if (isGroup) S.unread.group = 0; else S.unread.dm[id] = 0;
  await saveUnread(); emit('unread');

  root.innerHTML = `
    <div class="chat dm-chat">
      <header class="bar">
        <button class="iconbtn" data-act="back" aria-label="戻る">${icon('back', 26)}</button>
        ${isGroup ? (S.avatars.group ? `<span class="avatar" style="width:36px;height:36px"><img src="${S.avatars.group}" alt=""></span>` : `<span class="avatar noimg" style="width:36px;height:36px">${icon('users', 18)}</span>`) : avatarHtml(id, 36)}
        <div class="bar-name">${esc(isGroup ? 'Family Group LINE' : char.full)}</div>
        <span class="grow"></span>
      </header>
      <div class="scroller"><div class="list"></div><div class="tail"></div></div>
    </div>`;
  const list = $('.list', root);
  const sc = $('.scroller', root);
  const comp = composer({ placeholder: 'メッセージ', onSend: (v) => v == null ? abort && abort.abort() : send(v), onPlus: plusMenu });
  $('.chat', root).appendChild(comp);
  const busy = (b) => { S.busy = b; comp.setBusy(b); };
  const scroll = () => { sc.scrollTop = sc.scrollHeight; };

  const bubblesOf = (m) => {
    if (m.role === 'user') return [{ who: 'umi', text: m.content }];
    if (isGroup) {
      return m.content.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const mm = l.match(/^([^：:]{1,12})[：:]\s*(.*)$/);
        const c = mm && findChar(mm[1]);
        return c ? { who: c.id, text: mm[2] } : { who: m.from || null, text: l };
      });
    }
    return m.content.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean).map(t => ({ who: id, text: t }));
  };
  const el = (m) => {
    const node = h('<div class="dgroup"></div>');
    if (m.role === 'error') { node.appendChild(h(`<div class="err">${esc(m.content)}</div>`)); }
    else {
      for (const b of bubblesOf(m)) {
        const me = b.who === 'umi';
        node.appendChild(h(`<div class="drow ${me ? 'me' : ''}">${me ? '' : (b.who ? avatarHtml(b.who, 34) : '<span class="side-gap sm"></span>')}<div class="dcol">${isGroup && !me && b.who ? `<small class="dname">${esc(charById(b.who).short)}</small>` : ''}<div class="dbubble ${me ? 'me' : ''}">${esc(b.text).replace(/\n/g, '<br>')}</div></div></div>`));
      }
      node.appendChild(h(`<time class="dtime ${m.role === 'user' ? 'me' : ''}">${stamp(m.createdAt)}</time>`));
    }
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(m); });
    let t = 0;
    node.addEventListener('touchstart', () => { t = setTimeout(() => menu(m), 550); }, { passive: true });
    node.addEventListener('touchend', () => clearTimeout(t));
    node.addEventListener('touchmove', () => clearTimeout(t), { passive: true });
    node.dataset.id = m.id;
    return node;
  };
  const drawAll = () => {
    list.innerHTML = msgs.length ? '' : `<div class="empty"><p>${esc(isGroup ? '家族のグループです' : char.full + 'とのDM')}</p><p class="sub">メッセージは長押しでコピー・削除できます。</p></div>`;
    for (const m of msgs) list.appendChild(el(m));
    scroll();
  };
  const push = (m) => { if (!msgs.length) list.innerHTML = ''; msgs.push(m); list.appendChild(el(m)); scroll(); };

  async function reply(nudge = false) {
    if (S.busy || !requireKey()) return;
    busy(true);
    abort = new AbortController();
    const typing = h(`<div class="drow">${isGroup ? '<span class="side-gap sm"></span>' : avatarHtml(id, 34)}<div class="dbubble"><div class="typing"><span></span><span></span><span></span></div></div></div>`);
    list.appendChild(typing); scroll();
    try {
      const winKey = 'win:' + tid;
      const { history, windowStart } = await threadHistory(tid, S.live[winKey] || 0, (m) => (isGroup && m.role === 'user' ? `うみ：${m.content}` : m.content));
      S.live[winKey] = windowStart; saveLive();
      const dyn = (await liveDyn({ forMode: isGroup ? 'group' : 'dm' })) + `\n\n【直近のLIVEの様子（参考。${isGroup ? '各人物' : char.short}が知り得る範囲だけを使う）】\n${await recentLive() || '（なし）'}`;
      const system = buildSystem({ mode: isGroup ? 'group' : 'dm', docs: S.docs, settings: S.settings, dyn, extra: { char } });
      let messages = withCacheOnLast(history);
      if (nudge || !history.length || history[history.length - 1].role !== 'user') {
        messages = appendInstruction(history, isGroup
          ? '（うみはまだ何も送っていない。今の生活の流れから、誰かが自然にグループへ投稿するなら、その投稿を書く。）'
          : `（うみからの新しいメッセージはない。${char.short}に今うみへ送る理由が自然にあるなら、そのメッセージを書く。）`);
      }
      const res = await generate({
        settings: S.settings, system, messages, docs: S.docs, signal: abort.signal, maxTokens: 2000,
        onTool: (n, i) => setStatus(n === 'read_document' ? `資料を確認中：${i.name || ''}` : ''),
      });
      setStatus(''); typing.remove();
      S.lastUsage = res.usage;
      const text = res.text.trim();
      if (text) push(await addMessage(tid, 'assistant', text, isGroup ? {} : { from: id }));
      else toast(isGroup ? '今は誰も投稿しませんでした' : '今は返信がありませんでした');
    } catch (e) {
      setStatus(''); typing.remove();
      if (e.name !== 'AbortError') push(await addMessage(tid, 'error', `送信に失敗しました。\n${e.message}`));
    } finally { busy(false); }
  }

  async function send(text) {
    if (S.busy || !requireKey()) return;
    push(await addMessage(tid, 'user', text));
    await reply();
  }

  async function menu(m) {
    if (S.busy) return;
    const act = await sheet('メッセージ', [{ id: 'copy', label: 'コピー' }, ...(m.role !== 'user' ? [{ id: 'regen', label: '返信を作り直す' }] : []), { id: 'delete', label: '削除', kind: 'danger' }]);
    if (act === 'copy') { try { await navigator.clipboard.writeText(m.content); toast('コピーしました'); } catch (_) {} }
    else if (act === 'delete') { await db.del('messages', m.id); msgs = msgs.filter(x => x.id !== m.id); drawAll(); }
    else if (act === 'regen') { await db.del('messages', m.id); msgs = msgs.filter(x => x.id !== m.id); drawAll(); await reply(); }
  }

  async function plusMenu() {
    const act = await sheet(isGroup ? 'グループ' : char.short, [
      { id: 'nudge', label: isGroup ? '誰かの投稿を待つ' : `${char.short}からのメッセージを待つ` },
      { id: 'clear', label: 'このトークを全部消す', kind: 'danger' },
    ]);
    if (act === 'nudge') reply(true);
    else if (act === 'clear') {
      if (!(await confirmBox('トーク削除', 'このトークの履歴をすべて削除します。', '削除', true))) return;
      await db.deleteThreadMessages(tid); msgs = []; drawAll();
    }
  }

  $('[data-act=back]', root).onclick = () => nav('dm');
  drawAll();
  if (S.busy) comp.setBusy(true);
}
