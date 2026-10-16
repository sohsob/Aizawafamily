import { db } from './db.js';
import { S, saveDoc, guessBase, saveAvatars, saveBg, loadAll, saveLive } from './state.js';
import { saveSettings, DEFAULTS } from './settings.js';
import { CHARACTERS, NPCS, FLOORS, BANDS, bgUrl, isTimed, avatarUrl, dmBgUrl } from './data.js';
import { esc } from './render.js';
import { icon } from './icons.js';
import { $, $$, h, toast, modal, confirmBox, pickFiles, readText, shrinkImage, download } from './ui.js';
import { emit } from './services.js';

export async function render(root, params, { nav }) {
  let panel = params.panel || 'docs';
  root.innerHTML = `
    <div class="page vault">
      <header class="bar flat">
        <button class="iconbtn" data-act="back" aria-label="戻る">${icon('back', 26)}</button>
        <div class="bar-name">AI CORE</div><span class="grow"></span>
      </header>
      <div class="seg small">
        <button data-p="docs">Prompt Vault</button><button data-p="media">顔と部屋</button><button data-p="settings">設定</button>
      </div>
      <div class="panel"></div>
    </div>`;
  const body = $('.panel', root);
  const show = (p) => {
    panel = p;
    $$('.seg button', root).forEach(b => b.classList.toggle('on', b.dataset.p === p));
    ({ docs, media, settings })[p](body);
  };
  $$('.seg button', root).forEach(b => b.onclick = () => show(b.dataset.p));
  $('[data-act=back]', root).onclick = () => nav('home');
  show(panel);
}

// ───────── 資料 ─────────
function docs(b) {
  const s = S.settings;
  b.innerHTML = `
    <div class="actions"><button class="btn primary" id="d-import">txtを取り込む</button></div>
    <p class="hint">「STORY常時」「LIVE常時」は、そのモードで毎回Claudeに渡す資料です（ストーリー指示・LIVE MODE・世界観など）。それ以外は必要な時だけClaudeが読みに行きます。同じ名前のファイルを取り込むと上書きされます。DM・グループ・FEEDはLIVE側の資料を使います。</p>
    <div class="list"></div>`;
  const list = $('.list', b);
  for (const d of S.docs) {
    const tags = [];
    if (d.name === s.memoryDoc) tags.push('思い出の保存先');
    if (d.name === s.liveRecordDoc) tags.push('LIVE記録の保存先');
    if (d.name === s.illustDoc) tags.push('外見資料');
    const row = h(`<div class="item doc">
      <button class="item-main"><span>${esc(d.name)}</span><small>${d.content.length.toLocaleString()}文字${tags.length ? ' ・ ' + tags.join(' ・ ') : ''}</small></button>
      <div class="doc-acts">
        <button class="pill ${d.base.story ? 'on' : ''}" data-a="story">STORY常時</button>
        <button class="pill ${d.base.live ? 'on' : ''}" data-a="live">LIVE常時</button>
        <button class="icon" data-a="dl" aria-label="ダウンロード">${icon('download', 18)}</button>
        <button class="icon danger" data-a="del" aria-label="削除">${icon('trash', 18)}</button>
      </div></div>`);
    $('.item-main', row).onclick = async () => {
      const v = await modal({ title: d.name, wide: true, body: `<textarea class="field huge">${esc(d.content)}</textarea>`, actions: [{ label: '閉じる', value: () => null }, { label: '保存', kind: 'primary', value: (w) => $('textarea', w).value }] });
      if (v == null || v === d.content) return;
      d.content = v; await saveDoc(d); docs(b);
    };
    $('[data-a=story]', row).onclick = async () => { d.base = { ...d.base, story: !d.base.story }; await saveDoc(d); docs(b); };
    $('[data-a=live]', row).onclick = async () => { d.base = { ...d.base, live: !d.base.live }; await saveDoc(d); docs(b); };
    $('[data-a=dl]', row).onclick = () => download(d.name, d.content);
    $('[data-a=del]', row).onclick = async () => {
      if (!(await confirmBox('資料削除', `「${d.name}」を削除しますか？`, '削除', true))) return;
      await db.del('docs', d.name); S.docs = S.docs.filter(x => x.name !== d.name); docs(b);
    };
    list.appendChild(row);
  }
  if (!S.docs.length) list.innerHTML = '<div class="empty"><p>資料がまだありません</p><p class="sub">Claudeのプロジェクトにあるtxtをまとめて選んで取り込んでください。</p></div>';
  $('#d-import', b).onclick = async () => {
    const files = await pickFiles('.txt,.md,text/plain');
    if (!files.length) return;
    for (const f of files) {
      const name = f.name.trim();
      const old = S.docs.find(x => x.name === name);
      await saveDoc({ name, content: await readText(f), base: old ? old.base : guessBase(name) });
      if (/思い出/.test(name) && !S.docs.some(x => x.name === s.memoryDoc && x.name !== name)) s.memoryDoc = name;
      if (/LIVE記録/.test(name) && !S.docs.some(x => x.name === s.liveRecordDoc && x.name !== name)) s.liveRecordDoc = name;
      if (/イラスト/.test(name) && !S.docs.some(x => x.name === s.illustDoc && x.name !== name)) s.illustDoc = name;
    }
    saveSettings(s);
    docs(b);
    toast(`${files.length}件を取り込みました`);
  };
}

// ───────── 顔と部屋 ─────────
function media(b) {
  b.innerHTML = `
    <h3>アイコン</h3>
    <div class="face-grid"></div>
    <h3>背景</h3>
    <p class="hint">タップで画像を差し替えられます（この端末に保存）。時間で変わる場所は時間帯ごとに設定できます。</p>
    <div class="bg-list"></div>`;
  const faces = $('.face-grid', b);
  for (const c of [...CHARACTERS, { id: 'group', short: 'グループ' }]) {
    const au = avatarUrl(c.id, S.avatars);
    const f = h(`<button class="face">${au ? `<span class="avatar" style="width:64px;height:64px"><img src="${au}" alt=""></span>` : `<span class="avatar noimg" style="width:64px;height:64px">${esc(c.short.slice(0, 1))}</span>`}<span>${esc(c.short)}</span></button>`);
    f.onclick = async () => {
      const act = S.avatars[c.id] ? await modal({ title: c.short, body: '', actions: [{ label: '元に戻す', kind: 'danger', value: () => 'del' }, { label: '画像を選ぶ', kind: 'primary', value: () => 'pick' }] }) : 'pick';
      if (act === 'del') { delete S.avatars[c.id]; await saveAvatars(); media(b); emit('unread'); return; }
      if (act !== 'pick') return;
      const [file] = await pickFiles('image/*', false); if (!file) return;
      S.avatars[c.id] = await squareAvatar(file);
      await saveAvatars(); media(b);
    };
    faces.appendChild(f);
  }
  const list = $('.bg-list', b);
  const places = [{ id: 'home', name: 'HOME', floor: '' }, ...NPCS.map(c => ({ id: 'dm:' + c.id, name: `DM背景（${c.short}）`, floor: '', dm: c.id })), ...FLOORS.flatMap(f => f.rooms.map(r => ({ ...r, floor: f.id })))];
  for (const r of places) {
    const slots = r.dm ? [{ key: r.id, label: '', url: dmBgUrl(r.dm, S.bg) }] : isTimed(r.id) ? BANDS.map(x => ({ key: `${r.id}:${x.id}`, label: x.label, url: S.bg[`${r.id}:${x.id}`] || bgUrl(r.id, S.bg, bandDate(x)) })) : [{ key: r.id, label: '', url: bgUrl(r.id, S.bg) }];
    const row = h(`<div class="bg-row"><div class="bg-name">${esc(r.floor ? r.floor + ' ' : '')}${esc(r.name)}</div><div class="bg-slots"></div></div>`);
    for (const s of slots) {
      const own = !!S.bg[s.key];
      const t = h(`<button class="bg-slot ${own ? 'own' : ''}">${s.url ? `<img src="${s.url}" alt="" loading="lazy">` : '<span class="none">なし</span>'}${s.label ? `<small>${s.label}</small>` : ''}</button>`);
      t.onclick = async () => {
        const act = own ? await modal({ title: '背景', body: '', actions: [{ label: '元に戻す', kind: 'danger', value: () => 'reset' }, { label: '画像を選ぶ', kind: 'primary', value: () => 'pick' }] }) : 'pick';
        if (act === 'reset') { delete S.bg[s.key]; await saveBg(); media(b); return; }
        if (act !== 'pick') return;
        const [file] = await pickFiles('image/*', false); if (!file) return;
        S.bg[s.key] = await shrinkImage(file, 1280, 0.82);
        await saveBg(); media(b);
      };
      $('.bg-slots', row).appendChild(t);
    }
    list.appendChild(row);
  }
}

function bandDate(band) {
  // その時間帯の代表時刻（JST）を作る
  const hour = band.from % 24;
  const d = new Date();
  const utcHour = (hour - 9 + 24) % 24;
  d.setUTCHours(utcHour, 30, 0, 0);
  return d;
}

function squareAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, Math.max(0, (img.height - s) / 2 - s * 0.08), s, s, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

// ───────── 設定 ─────────
function settings(b) {
  const s = S.settings;
  const docOpts = (cur) => [...new Set([cur, ...S.docs.map(d => d.name)])].map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const models = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-5-5'];
  b.innerHTML = `
    <form class="form" autocomplete="off">
      <h3>APIキー</h3>
      <label>Claude APIキー<input type="password" name="anthropicKey" value="${esc(s.anthropicKey)}" placeholder="sk-ant-..."></label>
      <label>OpenAI APIキー（画像用）<input type="password" name="openaiKey" value="${esc(s.openaiKey)}" placeholder="sk-..."></label>
      <p class="hint">キーはこの端末の中にだけ保存され、AnthropicとOpenAI以外には送られません。</p>

      <h3>会話</h3>
      <label>モデル<select name="modelSel">${models.map(m => `<option ${m === s.model ? 'selected' : ''}>${m}</option>`).join('')}<option value="custom" ${models.includes(s.model) ? '' : 'selected'}>その他（下に入力）</option></select></label>
      <label class="custom-model" ${models.includes(s.model) ? 'hidden' : ''}>モデル名<input name="modelCustom" value="${esc(models.includes(s.model) ? '' : s.model)}"></label>
      <label>1回の出力上限（トークン）<input type="number" name="maxTokens" value="${s.maxTokens}" min="1000" max="32000" step="500"></label>
      <label>毎回送る直近履歴（文字数）<input type="number" name="historyChars" value="${s.historyChars}" min="5000" step="5000"></label>
      <p class="hint">履歴を増やすと話のつながりは良くなりますが、1回あたりの料金が上がります。</p>

      <h3>STORY</h3>
      <label>思い出の自動記録（何手ごと。0で無効）<input type="number" name="memoryInterval" value="${s.memoryInterval}" min="0"></label>
      <label>思い出の追記先<select name="memoryDoc">${docOpts(s.memoryDoc)}</select></label>

      <h3>LIVE</h3>
      <label class="check"><input type="checkbox" name="syncOn" ${s.syncOn ? 'checked' : ''}> 現実時間同期（LIVEを開いた時、時間が進んでいれば自動で今の様子を生成）</label>
      <label class="check"><input type="checkbox" name="groupAuto" ${s.groupAuto ? 'checked' : ''}> 家族グループLINEに自動で投稿が届く（アプリを開いている間）</label>
      <label>グループ投稿の間隔（分）<input type="number" name="groupInterval" value="${s.groupInterval}" min="15" step="15"></label>
      <label>LIVE記録の追記先<select name="liveRecordDoc">${docOpts(s.liveRecordDoc)}</select></label>

      <h3>画像</h3>
      <label>外見資料<select name="illustDoc">${docOpts(s.illustDoc)}</select></label>
      <label>画像モデル<input name="imageModel" value="${esc(s.imageModel)}"></label>
      <label>サイズ<select name="imageSize">${['1024x1536', '1024x1024', '1536x1024', 'auto'].map(v => `<option ${v === s.imageSize ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>品質<select name="imageQuality">${['high', 'medium', 'low', 'auto'].map(v => `<option ${v === s.imageQuality ? 'selected' : ''}>${v}</option>`).join('')}</select></label>

      <h3>表示</h3>
      <label>文字サイズ<input type="number" name="fontSize" value="${s.fontSize}" min="12" max="24"></label>

      <div class="actions"><button type="submit" class="btn primary">保存</button></div>

      <h3>バックアップ</h3>
      <p class="hint">データはこの端末のブラウザ内にあります。機種変更やデータ消去に備えて、ときどき書き出してください（APIキーは含まれません）。</p>
      <div class="actions">
        <button type="button" class="btn" id="b-export">書き出す</button>
        <button type="button" class="btn" id="b-import">読み込む</button>
      </div>
      <h3>リセット</h3>
      <div class="actions"><button type="button" class="btn danger" id="r-live">LIVEの会話と状態を消す</button></div>
    </form>`;
  const f = $('form', b);
  f.modelSel.onchange = () => { $('.custom-model', f).hidden = f.modelSel.value !== 'custom'; };
  f.onsubmit = (e) => {
    e.preventDefault();
    s.anthropicKey = f.anthropicKey.value.trim();
    s.openaiKey = f.openaiKey.value.trim();
    s.model = f.modelSel.value === 'custom' ? (f.modelCustom.value.trim() || DEFAULTS.model) : f.modelSel.value;
    s.maxTokens = Math.max(1000, +f.maxTokens.value || DEFAULTS.maxTokens);
    s.historyChars = Math.max(5000, +f.historyChars.value || DEFAULTS.historyChars);
    s.memoryInterval = Math.max(0, +f.memoryInterval.value | 0);
    s.memoryDoc = f.memoryDoc.value;
    s.syncOn = f.syncOn.checked;
    s.groupAuto = f.groupAuto.checked;
    s.groupInterval = Math.max(15, +f.groupInterval.value || 120);
    s.liveRecordDoc = f.liveRecordDoc.value;
    s.illustDoc = f.illustDoc.value;
    s.imageModel = f.imageModel.value.trim() || DEFAULTS.imageModel;
    s.imageSize = f.imageSize.value;
    s.imageQuality = f.imageQuality.value;
    s.fontSize = Math.min(24, Math.max(12, +f.fontSize.value || 16));
    saveSettings(s);
    emit('settings');
    toast('保存しました');
  };
  $('#b-export', b).onclick = exportBackup;
  $('#b-import', b).onclick = importBackup;
  $('#r-live', b).onclick = async () => {
    if (!(await confirmBox('LIVEリセット', 'LIVEの会話・人物の現在地・予定を消して、初回起動の状態に戻します。DMや資料は残ります。', '消す', true))) return;
    await db.deleteThreadMessages('live');
    Object.assign(S.live, { lastSync: null, locations: {}, comingUp: [], windowStart: 0 });
    await saveLive();
    toast('LIVEをリセットしました');
  };
}

async function exportBackup() {
  const { anthropicKey, openaiKey, ...settings } = S.settings;
  const data = {
    app: 'kyojuu-biru', version: 2, exportedAt: new Date().toISOString(), settings,
    docs: await db.all('docs'), threads: await db.all('threads'), messages: await db.all('messages'),
    posts: await db.all('posts'), photos: await db.all('photos'), kv: await db.allKV(),
  };
  const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).replace(/-/g, '');
  download(`居住ビル_バックアップ_${d}.json`, JSON.stringify(data), 'application/json');
}

async function importBackup() {
  const [f] = await pickFiles('.json,application/json', false); if (!f) return;
  let data;
  try { data = JSON.parse(await readText(f)); } catch (_) { toast('バックアップファイルを読めませんでした'); return; }
  if (data.app !== 'kyojuu-biru') { toast('このアプリのバックアップではありません'); return; }
  if (!(await confirmBox('読み込み', '今のデータをすべてバックアップの内容に置き換えます。よろしいですか？', '置き換える', true))) return;
  for (const n of ['docs', 'threads', 'messages', 'posts', 'photos']) {
    await db.clear(n);
    for (const x of data[n] || []) await db.put(n, x);
  }
  await db.clear('kv');
  for (const [k, v] of data.kv || []) await db.setKV(k, v);
  Object.assign(S.settings, data.settings || {});
  saveSettings(S.settings);
  await loadAll();
  toast('読み込みました');
  emit('nav', { to: 'home' });
}
