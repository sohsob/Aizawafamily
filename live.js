import { db } from './db.js';
import { S, addMessage, avatarHtml, saveLive } from './state.js';
import { NPCS, FLOORS, roomById, roomLabel, bgUrl, jstParts, findChar, charById } from './data.js';
import { buildSystem, withCacheOnLast, generate } from './engine.js';
import { requireKey, liveDyn, liveTools, threadHistory, sceneImage, bus, needsSync } from './services.js';
import { segmentLive, renderSegment, renderUser, esc } from './render.js';
import { icon } from './icons.js';
import { $, h, toast, setStatus, modal, confirmBox, promptBox, sheet, composer, timeHM } from './ui.js';

let abort = null;

export async function render(root, params, { nav, setBackground }) {
  try { localStorage.setItem('kyojuu-mode', 'live'); } catch (_) {}
  let all = await db.messages('live');

  root.innerHTML = `
    <div class="chat live-view">
      <header class="bar">
        <div class="bar-title"><span class="tag">LIVE</span><span class="room-title"></span></div>
        <span class="grow"></span>
        <button class="move" aria-label="移動">${icon('mapPin', 22)}<span>移動</span></button>
        <button class="iconbtn" data-act="home" aria-label="HOME">${icon('home', 26)}</button>
      </header>
      <div class="present"></div>
      <div class="scroller"><div class="list"></div><div class="tail"></div></div>
    </div>`;
  const list = $('.list', root);
  const sc = $('.scroller', root);
  const comp = composer({ placeholder: 'ここに入力…', onSend: (v) => v == null ? abort && abort.abort() : runLive({ kind: 'input', text: v }), onPlus: plusMenu });
  $('.chat', root).appendChild(comp);
  const busy = (b) => { S.busy = b; comp.setBusy(b); };
  const scroll = (force) => { if (force || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 200) sc.scrollTop = sc.scrollHeight; };

  const header = () => {
    const r = roomById(S.live.umiRoom);
    $('.room-title', root).textContent = roomLabel(r);
    const here = [charById('umi'), ...NPCS.filter(c => (S.live.locations[c.id] || {}).room === S.live.umiRoom)];
    $('.present', root).innerHTML = here.map(c => `<span class="pchip">${esc(c.short)}</span>`).join('');
    setBackground(bgUrl(S.live.umiRoom, S.bg));
  };

  const speakerAvatar = (name) => { const c = name && findChar(name); return c ? avatarHtml(c.id, 46, 'side') : ''; };

  const el = (m) => {
    let node;
    if (m.role === 'user' && m.sync) {
      node = h(`<div class="divider"><span>${timeHM(m.createdAt)} ・ 現在時刻へ同期</span></div>`);
    } else if (m.role === 'user') {
      node = h(`<article class="lmsg me"><div class="lbubble me">${renderUser(m.content)}<time>${timeHM(m.createdAt)}</time></div>${avatarHtml('umi', 46, 'side')}</article>`);
    } else if (m.role === 'assistant') {
      const segs = segmentLive(m.content);
      node = h('<div class="lgroup"></div>');
      segs.forEach((s, i) => {
        node.appendChild(h(`<article class="lmsg">${speakerAvatar(s.speaker) || '<span class="side-gap"></span>'}<div class="lbubble">${renderSegment(s)}${i === segs.length - 1 ? `<time>${timeHM(m.createdAt)}</time>` : ''}</div></article>`));
      });
    } else if (m.role === 'image') {
      node = h(`<article class="lmsg img"><figure class="gen-image">${m.dataUrl ? `<img src="${m.dataUrl}" alt="生成画像" loading="lazy">` : '<div class="img-pending">画像を生成中…</div>'}${m.error ? `<div class="err">${esc(m.error)}</div>` : ''}</figure></article>`);
    } else {
      node = h(`<article class="lmsg"><div class="err">${esc(m.content)}</div></article>`);
    }
    if (!(m.role === 'user' && m.sync)) {
      const acts = h(`<div class="lacts ${m.role === 'user' ? 'me' : ''}"><button data-a="copy">${icon('copy', 14)}コピー</button><button data-a="more">${icon('more', 14)}</button></div>`);
      $('[data-a=copy]', acts).onclick = async () => { try { await navigator.clipboard.writeText(m.content || m.prompt || ''); toast('コピーしました'); } catch (_) { toast('コピーできませんでした'); } };
      $('[data-a=more]', acts).onclick = () => msgMenu(m);
      node.appendChild(acts);
    }
    node.dataset.id = m.id;
    return node;
  };

  const visible = () => all.filter(m => m.room === S.live.umiRoom);
  const drawAll = () => {
    list.innerHTML = '';
    const v = visible();
    if (!v.length) list.innerHTML = `<div class="empty"><p>${esc(roomLabel(roomById(S.live.umiRoom)))}</p><p class="sub">${S.settings.anthropicKey ? '話しかけるか、＋ →「今の様子を見る」で始まります。' : 'HOME → Settings でAPIキーを入力してください。'}</p></div>`;
    for (const m of v) list.appendChild(el(m));
    header();
    scroll(true);
  };
  const push = (m) => { all.push(m); if (m.room === S.live.umiRoom) { if (list.querySelector('.empty')) list.innerHTML = ''; list.appendChild(el(m)); scroll(true); } };

  async function runLive({ kind, text, room }) {
    if (S.busy || !requireKey()) return;
    busy(true);
    abort = new AbortController();
    if (kind === 'move') {
      S.live.umiRoom = room; await saveLive(); header(); drawAll();
      push(await addMessage('live', 'user', `（${roomLabel(roomById(room))}へ移動する）`, { room }));
    } else if (kind === 'sync') {
      push(await addMessage('live', 'user', `【LIVE同期 ${timeHM(Date.now())}】現在時刻へ同期し、今の生活を表示する。`, { room: S.live.umiRoom, sync: true }));
    } else {
      push(await addMessage('live', 'user', text, { room: S.live.umiRoom }));
    }
    const pend = h('<div class="lgroup pending"><article class="lmsg"><span class="side-gap"></span><div class="lbubble"><div class="typing"><span></span><span></span><span></span></div></div></article></div>');
    list.appendChild(pend); scroll(true);
    let txt = '', raf = 0;
    const paint = () => {
      raf = 0;
      const segs = segmentLive(txt);
      pend.innerHTML = segs.map(s => `<article class="lmsg">${speakerAvatar(s.speaker) || '<span class="side-gap"></span>'}<div class="lbubble">${renderSegment(s)}</div></article>`).join('') || '<article class="lmsg"><span class="side-gap"></span><div class="lbubble"><div class="typing"><span></span><span></span><span></span></div></div></article>';
      scroll();
    };
    try {
      const { history, windowStart } = await threadHistory('live', S.live.windowStart, (m) => m.role === 'user' ? `［${timeHM(m.createdAt)}｜${roomLabel(roomById(m.room))}］\n${m.content}` : m.content);
      S.live.windowStart = windowStart;
      const system = buildSystem({ mode: 'live', docs: S.docs, settings: S.settings, dyn: await liveDyn({ forMode: 'live' }) });
      const res = await generate({
        settings: S.settings, system, messages: withCacheOnLast(history), docs: S.docs, tools: liveTools(), signal: abort.signal,
        onText: (t) => { txt = t; if (!raf) raf = requestAnimationFrame(paint); },
        onTool: (n, i) => setStatus({ read_document: `資料を確認中：${i.name || ''}`, search_documents: '資料を探しています…', update_live_state: '現在地を更新中…', send_dm: 'DMが届きました', append_live_record: 'LIVE記録を保存中…' }[n] || ''),
      });
      setStatus(''); pend.remove();
      S.live.lastSync = Date.now();
      await saveLive();
      S.lastUsage = res.usage;
      if (res.text.trim()) push(await addMessage('live', 'assistant', res.text, { room: S.live.umiRoom, usage: res.usage }));
      header();
      if (res.stop_reason === 'max_tokens') toast('出力上限で途中までになりました', 3500);
    } catch (e) {
      setStatus(''); pend.remove();
      if (e.name === 'AbortError') {
        if (txt.trim()) push(await addMessage('live', 'assistant', txt, { room: S.live.umiRoom }));
        toast('停止しました');
      } else {
        push(await addMessage('live', 'error', `生成に失敗しました。\n${e.message}`, { room: S.live.umiRoom }));
      }
    } finally { busy(false); }
  }

  async function chooseRoom() {
    const body = h(`<div class="room-pick">${FLOORS.map(f => `<div class="rp-floor"><b>${f.id}</b>${f.rooms.map(r => `<button data-r="${r.id}" class="${r.id === S.live.umiRoom ? 'on' : ''}">${esc(r.name)}</button>`).join('')}</div>`).join('')}</div>`);
    let picked = null;
    body.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { picked = b.dataset.r; document.querySelector('.modal-wrap .btn.ghost').click(); });
    await modal({ title: '移動先', body, actions: [{ label: '閉じる', kind: 'ghost', value: () => null }] });
    return picked;
  }

  async function moveTo(roomId) {
    if (!roomId || roomId === S.live.umiRoom) return;
    await runLive({ kind: 'move', room: roomId });
  }

  async function makeImage() {
    if (S.busy || !requireKey() || !requireKey('openai')) return;
    const req = await promptBox('画像を作る', '', { multiline: true, placeholder: '例：ソファで寝落ちした消太。空欄なら今の場面' });
    if (req == null) return;
    busy(true);
    abort = new AbortController();
    const m = await addMessage('live', 'image', '', { room: S.live.umiRoom, dataUrl: '', prompt: '' });
    push(m);
    try {
      const { history } = await threadHistory('live', S.live.windowStart);
      const system = buildSystem({ mode: 'live', docs: S.docs, settings: S.settings, dyn: await liveDyn({ forMode: 'live' }) });
      const out = await sceneImage({ mode: 'live', system, history, request: req.trim(), signal: abort.signal, onStatus: setStatus });
      Object.assign(m, { dataUrl: out.dataUrl, prompt: out.prompt, photoId: out.photoId });
    } catch (e) {
      m.error = e.name === 'AbortError' ? '停止しました' : `画像を作れませんでした。\n${e.message}`;
    } finally {
      await db.put('messages', m);
      const old = list.querySelector(`[data-id="${m.id}"]`); if (old) old.replaceWith(el(m));
      setStatus(''); busy(false);
    }
  }

  async function msgMenu(m) {
    if (S.busy) return;
    const lastA = all.filter(x => x.role === 'assistant').pop() === m;
    const items = [];
    if (m.role === 'user') items.push({ id: 'edit', label: '編集して送り直す' });
    if (m.role === 'assistant') items.push({ id: 'fix', label: '本文を直接修正' });
    if (lastA) items.push({ id: 'regen', label: '再生成', kind: 'primary' });
    items.push({ id: 'delete', label: '削除', kind: 'danger' });
    const act = await sheet('メッセージ', items);
    if (act === 'fix') {
      const v = await promptBox('本文を修正', m.content, { multiline: true }); if (v == null) return;
      m.content = v; await db.put('messages', m); drawAll();
    } else if (act === 'edit') {
      const v = await promptBox('入力を編集', m.content, { multiline: true }); if (v == null || !v.trim()) return;
      const after = all.filter(x => x.seq > m.seq);
      if (after.length && !(await confirmBox('送り直し', `この入力より後の${after.length}件を消して生成し直します。`, '送り直す'))) return;
      for (const x of [m, ...after]) await db.del('messages', x.id);
      all = all.filter(x => x.seq < m.seq); drawAll();
      await runLive({ kind: 'input', text: v.trim() });
    } else if (act === 'regen') {
      const prevUser = all.filter(x => x.seq < m.seq && x.role === 'user').pop();
      await db.del('messages', m.id); all = all.filter(x => x.id !== m.id);
      if (prevUser) { await db.del('messages', prevUser.id); all = all.filter(x => x.id !== prevUser.id); }
      drawAll();
      if (prevUser) await runLive(prevUser.sync ? { kind: 'sync' } : { kind: 'input', text: prevUser.content });
    } else if (act === 'delete') {
      if (!(await confirmBox('削除', 'このメッセージを削除しますか？', '削除', true))) return;
      await db.del('messages', m.id); all = all.filter(x => x.id !== m.id); drawAll();
    }
  }

  async function plusMenu() {
    const act = await sheet('LIVE', [
      { id: 'sync', label: '今の様子を見る（現在時刻へ同期）' },
      { id: 'move', label: '部屋を移動する' },
      { id: 'image', label: '画像を作る' },
      { id: 'insta', label: 'Instagramを見る（FEEDで生成）' },
    ]);
    if (act === 'sync') runLive({ kind: 'sync' });
    else if (act === 'move') moveTo(await chooseRoom());
    else if (act === 'image') makeImage();
    else if (act === 'insta') nav('feed', { generate: true });
  }

  $('.move', root).onclick = async () => moveTo(await chooseRoom());
  $('[data-act=home]', root).onclick = () => nav('home');
  const onState = () => header();
  bus.addEventListener('live-state', onState);
  drawAll();
  if (S.busy) comp.setBusy(true);

  if (params.move && params.move !== S.live.umiRoom) await moveTo(params.move);
  else if (S.settings.syncOn && S.settings.anthropicKey && !S.busy && needsSync()) runLive({ kind: 'sync' });

  return () => bus.removeEventListener('live-state', onState);
}
