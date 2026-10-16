import { chatKey } from './settings.js';
import { db, uid } from './db.js';
import { S, avatarHtml, savePhoto } from './state.js';
import { NPCS, CHARACTERS, findChar, charById } from './data.js';
import { buildSystem, collect } from './engine.js';
import { requireKey, liveDyn, renderImage } from './services.js';
import { esc } from './render.js';
import { icon } from './icons.js';
import { $, h, toast, setStatus, modal, sheet, confirmBox, pickFiles, shrinkImage, download, dateMD, timeHM } from './ui.js';

// 画像を Claude に見せるため縮小 JPEG にする
function toJpeg(src, max = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

async function recentLive(maxChars = 4000) {
  const live = (await db.messages('live')).filter(m => m.role === 'assistant');
  return live.map(m => m.content).join('\n\n').slice(-maxChars);
}

async function feedSystem() {
  const dyn = (await liveDyn({ forMode: 'feed' })) + `\n\n【直近のLIVEの様子】\n${await recentLive() || '（なし）'}`;
  return buildSystem({ mode: 'feed', docs: S.docs, settings: S.settings, dyn });
}

const COMMENT_SCHEMA = {
  type: 'object',
  properties: { comments: { type: 'array', items: { type: 'object', properties: { author: { type: 'string' }, text: { type: 'string' } }, required: ['author', 'text'] } } },
  required: ['comments'],
};

async function askComments(post, signal) {
  const content = [];
  if (post.dataUrl) {
    try { content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await toJpeg(post.dataUrl) } }); } catch (_) {}
  }
  const author = charById(post.author);
  content.push({ type: 'text', text: `【コメント生成】
投稿者：${author ? author.full : post.author}
キャプション：${post.caption || '（なし）'}
タグ：${(post.tags || []).join(' ') || '（なし）'}
既存のコメント：
${(post.comments || []).map(c => `${(charById(c.author) || {}).short || c.author}：${c.text}`).join('\n') || '（なし）'}

この投稿に、相澤家のメンバー（うみ以外）が自然につけるコメントを生成する。反応しない人がいてよい。うみのコメントへの返信があればそれも含める。
add_comments を一度だけ呼ぶ。` });
  const { input } = await collect({
    settings: S.settings, system: await feedSystem(), docs: S.docs, signal, maxTokens: 2500,
    messages: [{ role: 'user', content }],
    toolName: 'add_comments', description: '投稿へのコメントを追加する。author は人物名。', schema: COMMENT_SCHEMA,
  });
  return ((input && input.comments) || []).map(c => ({ author: (findChar(c.author) || {}).id || c.author, text: c.text, at: Date.now() })).filter(c => c.author !== 'umi');
}

export async function render(root, params, { nav }) {
  let posts = (await db.all('posts')).sort((a, b) => b.createdAt - a.createdAt);
  const photos = Object.fromEntries((await db.all('photos')).map(p => [p.id, p]));
  let abort = null;

  root.innerHTML = `
    <div class="page feed">
      <header class="page-head">
        <div><div class="eyebrow">AIZAWA FAMILY</div><h1>FAMILY FEED</h1></div>
        <button class="fab" aria-label="投稿">${icon('plus', 28)}</button>
      </header>
      <section class="card info">人物が写らない物撮り・風景・隠し撮り風も投稿OK。ALBUMへ保存した写真は、成功／混在／失敗をあとから人物別に評価して、画像生成の参照BANKとして使えます。</section>
      <div class="posts"></div>
    </div>`;
  const box = $('.posts', root);

  const postEl = (p) => {
    const a = charById(p.author);
    const ph = p.photoId && photos[p.photoId];
    const ref = ph && (ph.overall === 'ok' || ph.overall === 'mix');
    const node = h(`<article class="card post">
      <header>${avatarHtml(p.author, 46)}<div><strong>${esc(a ? a.full : p.author)}</strong><small>${esc((p.tags || [])[0] || '')}${(p.tags || [])[0] ? ' · ' : ''}${dateMD(p.createdAt)} ${timeHM(p.createdAt)}</small></div>${ref ? '<span class="ref">REF</span>' : ''}<button class="iconbtn sm" data-a="more" aria-label="操作">${icon('more', 18)}</button></header>
      ${p.dataUrl ? `<img src="${p.dataUrl}" alt="" loading="lazy">` : ''}
      ${p.caption ? `<p class="caption">${esc(p.caption).replace(/\n/g, '<br>')}</p>` : ''}
      ${(p.tags || []).length ? `<div class="tags">${p.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <footer><button data-a="like" class="${p.liked ? 'liked' : ''}">${icon('heart', 24)}<span>${(p.likes || 0) + (p.liked ? 1 : 0)}</span></button>
      <button data-a="comments">${icon('comment', 24)}<span>${(p.comments || []).length}</span></button><span class="grow"></span>
      ${p.dataUrl ? `<button data-a="save" aria-label="画像を保存">${icon('send', 22)}</button>` : ''}</footer>
    </article>`);
    $('[data-a=like]', node).onclick = async () => { p.liked = !p.liked; await db.put('posts', p); node.replaceWith(postEl(p)); };
    $('[data-a=comments]', node).onclick = () => openComments(p, node);
    const sv = $('[data-a=save]', node); if (sv) sv.onclick = () => { const x = document.createElement('a'); x.href = p.dataUrl; x.download = `feed_${p.createdAt}.jpg`; x.click(); };
    $('[data-a=more]', node).onclick = async () => {
      const act = await sheet('投稿', [...(p.prompt ? [{ id: 'prompt', label: '使ったプロンプトを見る' }] : []), { id: 'delete', label: '削除', kind: 'danger' }]);
      if (act === 'prompt') modal({ title: 'プロンプト', body: `<pre class="pre">${esc(p.prompt)}</pre>`, actions: [{ label: '閉じる', kind: 'primary' }] });
      if (act === 'delete' && await confirmBox('削除', 'この投稿を削除しますか？（ALBUMの写真は残ります）', '削除', true)) { await db.del('posts', p.id); posts = posts.filter(x => x.id !== p.id); node.remove(); }
    };
    return node;
  };

  const drawAll = () => {
    box.innerHTML = posts.length ? '' : '<div class="empty"><p>まだ投稿はありません</p><p class="sub">右上の＋から、うみとして投稿するか、家族の投稿を見られます。</p></div>';
    for (const p of posts) box.appendChild(postEl(p));
  };

  async function openComments(p, node) {
    const body = h(`<div class="comments"><div class="clist"></div><div class="cinput"><input class="field" placeholder="うみとしてコメント"><button class="btn primary">送信</button></div></div>`);
    const draw = () => {
      $('.clist', body).innerHTML = (p.comments || []).map(c => `<div class="c">${avatarHtml(c.author, 30)}<div><b>${esc((charById(c.author) || {}).short || c.author)}</b> ${esc(c.text)}</div></div>`).join('') || '<p class="sub">まだコメントはありません</p>';
    };
    draw();
    const btn = $('.cinput .btn', body);
    btn.onclick = async () => {
      const v = $('.cinput input', body).value.trim();
      if (!v || S.busy || !requireKey()) return;
      p.comments = [...(p.comments || []), { author: 'umi', text: v, at: Date.now() }];
      $('.cinput input', body).value = '';
      await db.put('posts', p); draw();
      btn.disabled = true; btn.textContent = '…';
      try { const add = await askComments(p); p.comments.push(...add); await db.put('posts', p); draw(); }
      catch (e) { toast('返信を作れませんでした'); }
      finally { btn.disabled = false; btn.textContent = '送信'; }
    };
    await modal({ title: 'コメント', body, actions: [{ label: '閉じる', kind: 'primary' }], wide: true });
    node.replaceWith(postEl(p));
  }

  async function manualPost() {
    const body = h(`<div class="form">
      <button class="pick-img">${icon('image', 28)}<span>画像を選ぶ（任意）</span></button>
      <label>キャプション<textarea class="field" rows="3"></textarea></label>
      <label>タグ（空白区切り。1つ目はALBUMのアルバム名になります）<input class="field tags" placeholder="例：海 家族"></label>
      <label class="check"><input type="checkbox" class="react" checked> 家族の反応（コメント）をもらう</label>
    </div>`);
    let dataUrl = null;
    $('.pick-img', body).onclick = async () => {
      const [f] = await pickFiles('image/*', false); if (!f) return;
      dataUrl = await shrinkImage(f, 1440);
      $('.pick-img', body).innerHTML = `<img src="${dataUrl}" alt="">`;
    };
    const r = await modal({ title: 'うみとして投稿', body, wide: true, actions: [{ label: 'キャンセル', value: () => null }, { label: '投稿', kind: 'primary', value: (w) => ({ caption: $('textarea', w).value.trim(), tags: $('.tags', w).value.trim().split(/\s+/).filter(Boolean), react: $('.react', w).checked }) }] });
    if (!r || (!dataUrl && !r.caption)) return;
    let photoId = null;
    if (dataUrl) photoId = (await savePhoto({ dataUrl, album: r.tags[0] || 'FEED', source: 'feed' })).id;
    const p = { id: uid(), author: 'umi', dataUrl, caption: r.caption, tags: r.tags, likes: 0, liked: false, comments: [], photoId, createdAt: Date.now() };
    await db.put('posts', p); posts.unshift(p); drawAll();
    if (r.react && chatKey(S.settings)) {
      setStatus('家族の反応を待っています…');
      try { p.comments = await askComments(p); await db.put('posts', p); drawAll(); } catch (e) { toast('コメントを作れませんでした'); }
      finally { setStatus(''); }
    }
  }

  async function aiPost() {
    if (S.busy || !requireKey() || !requireKey('openai')) return;
    S.busy = true;
    abort = new AbortController();
    try {
      setStatus('誰が何を投稿するか考えています…');
      const recent = posts.slice(0, 5).map(p => `${(charById(p.author) || {}).short || p.author}：${p.caption}`).join('\n');
      const { input } = await collect({
        settings: S.settings, system: await feedSystem(), docs: S.docs, signal: abort.signal, maxTokens: 4000,
        messages: [{ role: 'user', content: `【Instagramを見る】
現在のLIVE状態から、今成立するInstagram投稿を1件作る。投稿者は ${NPCS.map(c => c.full).join('、')} から現在状態に合わせて選ぶ（うみは除く）。直近の投稿者に偏らない。
直近の投稿：
${recent || '（なし）'}

・まず read_document で「${S.settings.illustDoc}」の、写る人物の外見固定情報を読む。
・image_prompt は高品質アニメイラスト調の画像生成プロンプト。写真領域に文字・吹き出し・名前を入れない指定を含める。誰が・どこで・いつ・何を撮ったかを整合させる。
・comments は他のメンバーが最初につけるコメント（0〜3件、うみ以外）。
submit_post を一度だけ呼ぶ。` }],
        toolName: 'submit_post', description: 'Instagram投稿を提出する。',
        schema: {
          type: 'object',
          properties: {
            author: { type: 'string' }, caption: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
            image_prompt: { type: 'string' }, characters: { type: 'array', items: { type: 'string' } },
            comments: COMMENT_SCHEMA.properties.comments,
          },
          required: ['author', 'caption', 'image_prompt'],
        },
      });
      if (!input) throw new Error('投稿を作れませんでした。');
      const author = findChar(input.author);
      const { dataUrl } = await renderImage({ prompt: input.image_prompt, characters: input.characters || [], signal: abort.signal, onStatus: setStatus });
      const tags = input.tags || [];
      const photo = await savePhoto({ dataUrl, album: tags[0] || 'FEED', prompt: input.image_prompt, source: 'feed', characters: input.characters || [] });
      const p = {
        id: uid(), author: author ? author.id : input.author, dataUrl, caption: input.caption, tags, likes: Math.floor(Math.random() * 4), liked: false,
        comments: (input.comments || []).map(c => ({ author: (findChar(c.author) || {}).id || c.author, text: c.text, at: Date.now() })).filter(c => c.author !== 'umi'),
        prompt: input.image_prompt, photoId: photo.id, createdAt: Date.now(),
      };
      await db.put('posts', p); posts.unshift(p); photos[photo.id] = photo; drawAll();
      toast(`${author ? author.short : input.author}が投稿しました`);
    } catch (e) {
      if (e.name !== 'AbortError') modal({ title: '投稿を作れませんでした', body: `<p>${esc(e.message)}</p>`, actions: [{ label: '閉じる', kind: 'primary' }] });
    } finally { S.busy = false; setStatus(''); }
  }

  $('.fab', root).onclick = async () => {
    const act = await sheet('FEED', [{ id: 'manual', label: 'うみとして投稿する' }, { id: 'ai', label: '家族の投稿を見る（AIが生成）' }]);
    if (act === 'manual') manualPost(); else if (act === 'ai') aiPost();
  };
  drawAll();
  if (params.generate) aiPost();
}
