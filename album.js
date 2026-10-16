import { db, uid } from './db.js';
import { S, savePhoto } from './state.js';
import { CHARACTERS } from './data.js';
import { esc } from './render.js';
import { icon } from './icons.js';
import { $, $$, h, toast, modal, promptBox, confirmBox, pickFiles, shrinkImage } from './ui.js';

const LABEL = { ok: 'OK', mix: 'MIX', ng: 'NG' };

function autoOverall(p) {
  const v = Object.values(p.persons || {}).filter(Boolean);
  if (!v.length) return p.overall || '';
  if (v.every(x => x === 'ok')) return 'ok';
  if (v.every(x => x === 'ng')) return 'ng';
  return 'mix';
}

export async function render(root, params, { nav }) {
  let photos = (await db.all('photos')).sort((a, b) => b.createdAt - a.createdAt);

  root.innerHTML = `
    <div class="page album">
      <header class="page-head">
        <div><div class="eyebrow">AIZAWA FAMILY</div><h1>FAMILY ALBUM</h1></div>
        <button class="fab" aria-label="写真を追加">${icon('camera', 28)}</button>
      </header>
      <section class="card bank">
        <div class="bank-title">PHOTO REFERENCE BANK</div>
        写真全体だけでなく、集合写真は人物ごとに成功／混在／失敗を評価できます。人物ごとに「OK」にした写真は次回の画像生成で外見の正例として送られ、「NG」の人物につけたメモは避ける情報として使われます。
      </section>
      <div class="albums"></div>
    </div>`;
  const box = $('.albums', root);

  const draw = () => {
    box.innerHTML = '';
    if (!photos.length) { box.innerHTML = '<div class="empty"><p>まだ写真はありません</p><p class="sub">右上のカメラから追加できます。生成した画像も自動でここに入ります。</p></div>'; return; }
    const groups = new Map();
    for (const p of photos) { if (!groups.has(p.album)) groups.set(p.album, []); groups.get(p.album).push(p); }
    for (const [name, list] of groups) {
      const sec = h(`<section class="alb"><h2>${esc(name)}</h2><div class="grid"></div></section>`);
      const grid = $('.grid', sec);
      for (const p of list) {
        const o = autoOverall(p);
        const t = h(`<button class="thumb"><img src="${p.dataUrl}" alt="" loading="lazy">${o ? `<span class="rate ${o}">${LABEL[o]}</span>` : '<span class="rate none"></span>'}</button>`);
        t.onclick = () => detail(p);
        grid.appendChild(t);
      }
      box.appendChild(sec);
    }
  };

  async function detail(p) {
    const body = h(`<div class="photo-detail">
      <img src="${p.dataUrl}" alt="">
      <label>アルバム名<input class="field album-name" value="${esc(p.album)}"></label>
      <div class="lbl">写真全体の評価</div>
      <div class="rate-row overall">${['', 'ok', 'mix', 'ng'].map(v => `<button data-v="${v}" class="${(p.overall || '') === v ? 'on' : ''} ${v}">${v ? LABEL[v] : '未評価'}</button>`).join('')}</div>
      <div class="lbl">人物ごとの評価（写っている人だけ）</div>
      <div class="persons">${CHARACTERS.map(c => `<div class="prow" data-c="${c.id}"><span>${esc(c.short)}</span>${['', 'ok', 'ng'].map(v => `<button data-v="${v}" class="${((p.persons || {})[c.id] || '') === v ? 'on' : ''} ${v}">${v ? LABEL[v] : '―'}</button>`).join('')}</div>`).join('')}</div>
      <label>メモ（失敗した部分・注意点。NGの人物の生成時に「避けること」として使われます）<textarea class="field note" rows="3">${esc(p.note || '')}</textarea></label>
      ${p.prompt ? `<details><summary>生成プロンプト</summary><pre class="pre">${esc(p.prompt)}</pre></details>` : ''}
    </div>`);
    let overall = p.overall || '';
    const persons = { ...(p.persons || {}) };
    $$('.overall button', body).forEach(b => b.onclick = () => { overall = b.dataset.v; $$('.overall button', body).forEach(x => x.classList.toggle('on', x === b)); });
    $$('.prow', body).forEach(row => $$('button', row).forEach(b => b.onclick = () => {
      if (b.dataset.v) persons[row.dataset.c] = b.dataset.v; else delete persons[row.dataset.c];
      $$('button', row).forEach(x => x.classList.toggle('on', x === b));
      const o = autoOverall({ persons, overall });
      if (Object.keys(persons).length) { overall = o; $$('.overall button', body).forEach(x => x.classList.toggle('on', x.dataset.v === o)); }
    }));
    const act = await modal({ body, wide: true, actions: [
      { label: '削除', kind: 'danger', value: () => 'delete' },
      { label: 'FEEDに投稿', value: () => 'feed' },
      { label: '保存', kind: 'primary', value: (w) => ({ album: $('.album-name', w).value.trim() || p.album, note: $('.note', w).value.trim() }) },
    ] });
    if (act === 'delete') {
      if (await confirmBox('削除', 'この写真を削除しますか？', '削除', true)) { await db.del('photos', p.id); photos = photos.filter(x => x.id !== p.id); draw(); }
      return;
    }
    if (act === 'feed') {
      const cap = await promptBox('キャプション', '', { multiline: true });
      if (cap == null) return;
      await db.put('posts', { id: uid(), author: 'umi', dataUrl: p.dataUrl, caption: cap.trim(), tags: [p.album], likes: 0, liked: false, comments: [], photoId: p.id, createdAt: Date.now() });
      toast('FEEDに投稿しました');
      return;
    }
    if (act && typeof act === 'object') {
      Object.assign(p, { album: act.album, note: act.note, overall, persons });
      await db.put('photos', p); draw();
    }
  }

  $('.fab', root).onclick = async () => {
    const files = await pickFiles('image/*');
    if (!files.length) return;
    const name = await promptBox('アルバム名', photos[0] ? photos[0].album : '', { placeholder: '例：海水浴' });
    if (name == null) return;
    for (const f of files) {
      try { const dataUrl = await shrinkImage(f, 1440); photos.unshift(await savePhoto({ dataUrl, album: name.trim() || '未分類', source: 'upload' })); }
      catch (e) { toast(e.message); }
    }
    draw();
    toast(`${files.length}枚を追加しました。写真をタップして評価できます`, 3500);
  };
  draw();
}
