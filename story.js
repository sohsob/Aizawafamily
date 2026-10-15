import { db, uid } from './db.js';
import { S, addMessage, appendToDoc } from './state.js';
import { buildSystem, selectHistory, withCacheOnLast, appendInstruction, generate, collect, classifyInput, MEMORY_INSTRUCTION } from './engine.js';
import { requireKey, sceneImage } from './services.js';
import { parseLog } from './docs.js';
import { renderStory, renderUser, esc } from './render.js';
import { icon } from './icons.js';
import { $, h, toast, setStatus, modal, confirmBox, promptBox, sheet, download, pickFiles, readText, composer } from './ui.js';

let T = null;          // 現在のスレッド
let msgs = [];
let abort = null;

async function ensureThread() {
  S.threads = (await db.all('threads')).sort((a, b) => b.updatedAt - a.updatedAt);
  let last = null;
  try { last = localStorage.getItem('kyojuu-last-thread'); } catch (_) {}
  T = S.threads.find(t => t.id === last) || S.threads[0];
  if (!T) T = await newThread('居住ビルの毎日');
}

async function newThread(title) {
  const t = { id: uid(), title, turnCount: 0, consulting: false, state: '', lastMemoryTurn: 0, windowStart: 0, createdAt: Date.now(), updatedAt: Date.now() };
  await db.put('threads', t);
  S.threads.unshift(t);
  return t;
}

async function saveThread() { T.updatedAt = Date.now(); await db.put('threads', T); }

function dyn() {
  let d = `【現在のスレッド状態】\nスレッド名：${T.title}\n物語入力の累計手数：${T.turnCount || 0}`;
  if (T.consulting) d += '\n現在はナレーター相談中（物語外の相談として応答する。ユーザーが【物語に戻る】と書いたら本文へ戻る）。';
  if (T.state) d += `\n\n【直近の思い出記録（前回記録時点の継続状態）】\n${T.state}`;
  return d;
}

function ctx() {
  const system = buildSystem({ mode: 'story', docs: S.docs, settings: S.settings, dyn: dyn() });
  const conv = msgs.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
  const { history, windowStart } = selectHistory(conv, T.windowStart, S.settings.historyChars);
  T.windowStart = windowStart;
  return { system, history };
}

function usageText(u) {
  if (!u) return '';
  const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return `入力 ${inTok.toLocaleString()}（キャッシュ ${(u.cache_read_input_tokens || 0).toLocaleString()}）／出力 ${(u.output_tokens || 0).toLocaleString()}`;
}

export async function render(root, params, { nav }) {
  try { localStorage.setItem('kyojuu-mode', 'story'); } catch (_) {}
  await ensureThread();
  msgs = await db.messages(T.id);

  root.innerHTML = `
    <div class="chat story-view">
      <header class="bar">
        <button class="bar-title" aria-label="スレッドを切り替える"><span class="brand">STORY</span><small class="thread-name"></small></button>
        <span class="grow"></span>
        <button class="iconbtn" data-act="home" aria-label="HOME">${icon('home', 26)}</button>
      </header>
      <div class="meta-line"></div>
      <div class="scroller"><div class="list"></div><div class="tail"></div></div>
    </div>`;
  const list = $('.list', root);
  const sc = $('.scroller', root);
  const comp = composer({ placeholder: '物語の続きを入力…', onSend: (v) => v == null ? abort && abort.abort() : send(v), onPlus: plusMenu });
  $('.chat', root).appendChild(comp);

  const header = () => {
    $('.thread-name', root).textContent = T.title;
    const iv = S.settings.memoryInterval | 0;
    const meta = [`${T.turnCount || 0}手`];
    if (iv > 0) meta.push(`思い出まで${iv - ((T.turnCount || 0) % iv)}手`);
    if (T.consulting) meta.push('ナレーター相談中');
    if (S.lastUsage) meta.push(usageText(S.lastUsage));
    $('.meta-line', root).textContent = meta.join(' ・ ');
  };
  const scroll = (force) => { if (force || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 200) sc.scrollTop = sc.scrollHeight; };

  const el = (m) => {
    let node;
    if (m.role === 'user') node = h(`<article class="msg user"><div class="bubble">${renderUser(m.content)}</div></article>`);
    else if (m.role === 'assistant') node = h(`<article class="msg assistant"><div class="story">${renderStory(m.content)}</div></article>`);
    else if (m.role === 'image') node = h(`<article class="msg image"><figure class="gen-image">${m.dataUrl ? `<img src="${m.dataUrl}" alt="生成画像" loading="lazy">` : '<div class="img-pending">画像を生成中…</div>'}${m.prompt ? `<details><summary>使ったプロンプト</summary><pre>${esc(m.prompt)}</pre></details>` : ''}${m.error ? `<div class="err">${esc(m.error)}</div>` : ''}</figure></article>`);
    else if (m.role === 'note') node = h(`<article class="msg note"><details><summary>${esc(m.title || 'お知らせ')}</summary><pre>${esc(m.content)}</pre></details></article>`);
    else node = h(`<article class="msg error"><div class="err">${esc(m.content)}</div></article>`);
    const more = h(`<button class="more" aria-label="メッセージの操作">${icon('more', 18)}</button>`);
    more.onclick = () => msgMenu(m);
    node.appendChild(more);
    node.dataset.id = m.id;
    return node;
  };
  const drawAll = () => {
    list.innerHTML = '';
    if (!msgs.length) list.innerHTML = `<div class="empty"><p>ここに物語が続いていきます。</p><p class="sub">${S.docs.length ? '前のチャットの続きから始めるなら、＋ →「会話ログを取り込む」で読み込めます。' : 'はじめに HOME → Prompt Vault で資料のtxtを取り込んでください。'}</p></div>`;
    for (const m of msgs) list.appendChild(el(m));
    header();
    scroll(true);
  };
  const push = (m) => { if (!msgs.length) list.innerHTML = ''; msgs.push(m); list.appendChild(el(m)); scroll(true); };
  const busy = (b) => { S.busy = b; comp.setBusy(b); };

  async function send(text) {
    if (S.busy || !requireKey()) return;
    const cls = classifyInput(text, T);
    if (cls.kind === 'memory') { await runMemory('manual'); return; }
    T.consulting = !!cls.consulting;
    if (cls.kind === 'story') T.turnCount = (T.turnCount || 0) + 1;
    push(await addMessage(T.id, 'user', text));
    await saveThread();
    header();
    await runStory(cls.kind === 'story');
  }

  async function runStory(counted = false) {
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'user') { toast('送る入力がありません'); return; }
    busy(true);
    abort = new AbortController();
    const pend = h('<article class="msg assistant pending"><div class="story"><div class="typing"><span></span><span></span><span></span></div></div></article>');
    list.appendChild(pend); scroll(true);
    let text = '', raf = 0;
    const paint = () => { raf = 0; $('.story', pend).innerHTML = renderStory(text) || '<div class="typing"><span></span><span></span><span></span></div>'; scroll(); };
    try {
      const { system, history } = ctx();
      const res = await generate({
        settings: S.settings, system, messages: withCacheOnLast(history), docs: S.docs, signal: abort.signal,
        onText: (t) => { text = t; if (!raf) raf = requestAnimationFrame(paint); },
        onTool: (n, i) => setStatus(n === 'search_documents' ? '資料を探しています…' : `資料を確認中：${i.name || ''}`),
      });
      setStatus(''); pend.remove();
      if (!res.text.trim()) throw new Error('本文が空でした。再生成してください。');
      S.lastUsage = res.usage;
      push(await addMessage(T.id, 'assistant', res.text, { usage: res.usage }));
      await saveThread();
      if (res.stop_reason === 'max_tokens') toast('出力上限で途中までになりました（設定で上限を上げられます）', 4000);
    } catch (e) {
      setStatus(''); pend.remove();
      if (e.name === 'AbortError') {
        if (text.trim()) push(await addMessage(T.id, 'assistant', text));
        toast('停止しました');
      } else {
        push(await addMessage(T.id, 'error', `生成に失敗しました。\n${e.message}\n\n最後の入力の ⋯ →「編集して送り直す」で再試行できます。`));
      }
      busy(false); header(); return;
    }
    busy(false); header();
    const iv = S.settings.memoryInterval | 0;
    if (counted && iv > 0 && T.turnCount % iv === 0 && T.lastMemoryTurn !== T.turnCount) await runMemory('auto');
  }

  async function runMemory(source) {
    if (!requireKey()) return;
    if (!msgs.some(m => m.role === 'assistant')) { toast('まだ記録する物語がありません'); return; }
    busy(true);
    abort = new AbortController();
    setStatus(source === 'auto' ? `${T.turnCount}手に達したので思い出を記録中…` : '思い出を記録中…');
    try {
      const { system, history } = ctx();
      let recorded = null;
      const { text } = await collect({
        settings: S.settings, system, docs: S.docs, signal: abort.signal, maxTokens: Math.max(S.settings.maxTokens, 4000),
        messages: appendInstruction(history, MEMORY_INSTRUCTION(!!T.state)),
        toolName: 'append_memory', description: '今回分の思い出記録本文を渡す。アプリが思い出資料の末尾へ追記する。旧記録は含めない。',
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      }).then(r => { recorded = r.input && r.input.text; return r; });
      recorded = (recorded || text || '').trim();
      if (!recorded) throw new Error('思い出記録が作成されませんでした。');
      const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
      await appendToDoc(S.settings.memoryDoc, `━━━━━━━━━━━━━━━━━━━━\n思い出記録｜${T.title}｜累計${T.turnCount}手｜${p}\n━━━━━━━━━━━━━━━━━━━━`, recorded);
      T.state = recorded;
      T.lastMemoryTurn = T.turnCount;
      await saveThread();
      push(await addMessage(T.id, 'note', recorded, { title: `思い出を「${S.settings.memoryDoc}」に追記しました（${T.turnCount}手目）` }));
      toast('思い出を記録しました');
    } catch (e) {
      if (e.name !== 'AbortError') push(await addMessage(T.id, 'error', `思い出の記録に失敗しました。\n${e.message}\n\n【思い出】と送ると、もう一度記録できます。`));
    } finally { setStatus(''); busy(false); header(); }
  }

  async function makeImage() {
    if (S.busy || !requireKey() || !requireKey('openai')) return;
    const body = h(`<div><textarea class="field big" placeholder="例：車を降りて担当者と握手するカイ。空欄なら今の場面"></textarea>
      <label class="check"><input type="checkbox" class="direct"> プロンプトを自分で書く（Claudeを通さない）</label></div>`);
    const res = await modal({ title: '画像を作る', body, actions: [{ label: 'キャンセル', value: () => null }, { label: '作る', kind: 'primary', value: (w) => ({ text: $('textarea', w).value.trim(), direct: $('.direct', w).checked }) }] });
    if (!res || (res.direct && !res.text)) return;
    busy(true);
    abort = new AbortController();
    const m = await addMessage(T.id, 'image', '', { prompt: '', dataUrl: '' });
    push(m);
    try {
      const { system, history } = ctx();
      const out = await sceneImage({ mode: 'story', system, history, request: res.text, direct: res.direct, signal: abort.signal, onStatus: setStatus });
      Object.assign(m, { dataUrl: out.dataUrl, prompt: out.prompt, photoId: out.photoId });
    } catch (e) {
      m.error = e.name === 'AbortError' ? '停止しました' : `画像を作れませんでした。\n${e.message}`;
    } finally {
      await db.put('messages', m);
      list.querySelector(`[data-id="${m.id}"]`).replaceWith(el(m));
      setStatus(''); busy(false); scroll(true);
    }
  }

  async function msgMenu(m) {
    if (S.busy) return;
    const isLastA = m.role === 'assistant' && msgs.filter(x => x.role === 'assistant').pop() === m;
    const items = [];
    if (m.role === 'user' || m.role === 'assistant') items.push({ id: 'copy', label: 'コピー' });
    if (m.role === 'user') items.push({ id: 'edit', label: '編集して送り直す' });
    if (m.role === 'assistant') items.push({ id: 'fix', label: '本文を直接修正' });
    if (isLastA) items.push({ id: 'regen', label: '再生成', kind: 'primary' });
    items.push({ id: 'delete', label: '削除', kind: 'danger' });
    const act = await sheet('メッセージ', items);
    if (act === 'copy') { try { await navigator.clipboard.writeText(m.content); toast('コピーしました'); } catch (_) { toast('コピーできませんでした'); } }
    else if (act === 'edit') {
      const v = await promptBox('入力を編集', m.content, { multiline: true });
      if (v == null || !v.trim()) return;
      const after = msgs.filter(x => x.seq > m.seq);
      if (after.length && !(await confirmBox('送り直し', `この入力より後の${after.length}件を消して、生成し直します。`, '送り直す'))) return;
      for (const x of after) await db.del('messages', x.id);
      msgs = msgs.filter(x => x.seq <= m.seq);
      m.content = v.trim(); await db.put('messages', m);
      drawAll(); await runStory();
    } else if (act === 'fix') {
      const v = await promptBox('本文を修正', m.content, { multiline: true });
      if (v == null) return;
      m.content = v; await db.put('messages', m); drawAll();
    } else if (act === 'regen') {
      await db.del('messages', m.id); msgs = msgs.filter(x => x.id !== m.id); drawAll(); await runStory();
    } else if (act === 'delete') {
      if (!(await confirmBox('削除', 'このメッセージを削除しますか？', '削除', true))) return;
      await db.del('messages', m.id); msgs = msgs.filter(x => x.id !== m.id); drawAll();
    }
  }

  async function plusMenu() {
    const act = await sheet('STORY', [
      { id: 'image', label: '画像を作る' },
      { id: 'memory', label: '今すぐ思い出を記録' },
      { id: 'threads', label: 'スレッドを切り替える' },
      { id: 'import', label: '会話ログを取り込む' },
      { id: 'export', label: 'このスレッドを書き出す' },
    ]);
    if (act === 'image') makeImage();
    else if (act === 'memory') runMemory('manual');
    else if (act === 'threads') threadMenu();
    else if (act === 'import') importLog();
    else if (act === 'export') {
      const txt = msgs.filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => `${'='.repeat(70)}\n[${m.role === 'user' ? 'USER' : 'ASSISTANT'}]\n${'='.repeat(70)}\n${m.content}\n`).join('\n');
      download(`${T.title}_会話ログ.txt`, txt);
    }
  }

  async function threadMenu() {
    const body = h('<div class="thread-list"></div>');
    for (const t of S.threads) {
      const row = h(`<div class="item ${t.id === T.id ? 'current' : ''}"><button class="item-main"><span>${esc(t.title)}</span><small>${t.turnCount || 0}手 ・ ${new Date(t.updatedAt).toLocaleString('ja-JP')}</small></button>
        <button class="icon" data-a="rename" aria-label="名前を変更">${icon('edit', 18)}</button><button class="icon danger" data-a="del" aria-label="削除">${icon('trash', 18)}</button></div>`);
      $('.item-main', row).onclick = () => { body.dispatchEvent(new CustomEvent('pick', { detail: t })); };
      $('[data-a=rename]', row).onclick = async () => { const v = await promptBox('スレッド名', t.title); if (v) { t.title = v.trim(); await db.put('threads', t); $('.item-main span', row).textContent = t.title; header(); } };
      $('[data-a=del]', row).onclick = async () => {
        if (!(await confirmBox('スレッド削除', `「${t.title}」と会話をすべて削除します。元に戻せません。`, '削除', true))) return;
        await db.deleteThreadMessages(t.id); await db.del('threads', t.id);
        S.threads = S.threads.filter(x => x.id !== t.id); row.remove();
        if (t.id === T.id) { T = S.threads[0] || await newThread('居住ビルの毎日'); msgs = await db.messages(T.id); drawAll(); }
      };
      body.appendChild(row);
    }
    let picked = null;
    body.addEventListener('pick', (e) => { picked = e.detail; document.querySelector('.modal-wrap .btn.primary').click(); });
    const r = await modal({ title: 'スレッド', body, actions: [{ label: '新しいスレッド', value: () => 'new' }, { label: '閉じる', kind: 'primary', value: () => picked }] });
    if (r === 'new') {
      const v = await promptBox('新しいスレッド名', '居住ビルの毎日'); if (!v) return;
      T = await newThread(v.trim());
    } else if (r && r.id) T = r;
    else return;
    try { localStorage.setItem('kyojuu-last-thread', T.id); } catch (_) {}
    msgs = await db.messages(T.id); drawAll();
  }

  async function importLog() {
    const [f] = await pickFiles('.txt,text/plain', false); if (!f) return;
    const parsed = parseLog(await readText(f));
    if (!parsed.length) { toast('[USER]/[ASSISTANT] の区切りが見つかりませんでした', 3500); return; }
    T = await newThread(f.name.replace(/\.txt$/, ''));
    for (const p of parsed) await addMessage(T.id, p.role, p.content);
    try { localStorage.setItem('kyojuu-last-thread', T.id); } catch (_) {}
    msgs = await db.messages(T.id); drawAll();
    toast(`${parsed.length}件の会話を取り込みました`);
  }

  $('.bar-title', root).onclick = threadMenu;
  $('[data-act=home]', root).onclick = () => nav('home');
  try { localStorage.setItem('kyojuu-last-thread', T.id); } catch (_) {}
  drawAll();
  if (S.busy) comp.setBusy(true);
  // 画面を離れても生成は続ける（結果は保存される）

}
