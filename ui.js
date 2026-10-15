import { esc } from './render.js';
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

export function setStatus(text) {
  const el = $('#status');
  el.textContent = text || '';
  el.classList.toggle('show', !!text);
}

export function modal({ title, body, actions, wide = false }) {
  return new Promise((resolve) => {
    const wrap = h(`<div class="modal-wrap"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-title">${esc(title)}</div>` : ''}
      <div class="modal-body"></div><div class="modal-actions"></div></div></div>`);
    const bodyEl = $('.modal-body', wrap);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    if (!body) bodyEl.remove();
    const acts = $('.modal-actions', wrap);
    const close = (v) => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 150); resolve(v); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.kind || '');
      b.textContent = a.label;
      b.onclick = () => close(a.value ? a.value(wrap) : a.label);
      acts.appendChild(b);
    }
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    const f = $('textarea, input:not([type=checkbox]):not([type=file])', wrap);
    if (f && !('ontouchstart' in window)) setTimeout(() => f.focus(), 60);
  });
}

export const confirmBox = (title, text, ok = 'OK', danger = false) => modal({
  title, body: `<p>${esc(text)}</p>`,
  actions: [{ label: 'キャンセル', value: () => false }, { label: ok, kind: danger ? 'danger' : 'primary', value: () => true }],
});

export const promptBox = (title, value = '', { multiline = false, placeholder = '' } = {}) => modal({
  title,
  body: multiline
    ? `<textarea class="field big" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="field" value="${esc(value)}" placeholder="${esc(placeholder)}">`,
  actions: [{ label: 'キャンセル', value: () => null }, { label: 'OK', kind: 'primary', value: (w) => $('.field', w).value }],
});

// アクションシート（選択肢を縦に並べる）
export const sheet = (title, items) => modal({
  title, body: '',
  actions: [...items.map(i => ({ label: i.label, kind: i.kind || '', value: () => i.id })), { label: '閉じる', kind: 'ghost', value: () => null }],
});

export function download(name, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    inp.click();
  });
}

export const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });

export function shrinkImage(file, maxSide = 1280, quality = 0.88) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

export function timeHM(ms) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}
export function dateMD(ms) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

// 入力欄（テキスト＋［＋］［（）］［【】］＋送信）
export function composer({ placeholder, onSend, onPlus }) {
  const el = h(`<div class="composer">
    <textarea rows="1" placeholder="${esc(placeholder)}" enterkeyhint="enter"></textarea>
    <div class="composer-row">
      <button class="cbtn plus" aria-label="その他">${icon('plus', 22)}</button>
      <button class="cbtn pill" data-ins="（）" aria-label="かっこを入れる">()</button>
      <button class="cbtn pill" data-ins="【】" aria-label="すみ付きかっこを入れる">【】</button>
      <span class="grow"></span>
      <button class="send" aria-label="送信">${icon('send', 22)}</button>
    </div></div>`);
  const ta = $('textarea', el);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.35) + 'px'; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('.send', el).click(); } });
  $$('[data-ins]', el).forEach(b => b.onclick = () => {
    const ins = b.dataset.ins;
    const s = ta.selectionStart ?? ta.value.length, e2 = ta.selectionEnd ?? ta.value.length;
    const sel = ta.value.slice(s, e2);
    ta.value = ta.value.slice(0, s) + ins[0] + sel + ins[1] + ta.value.slice(e2);
    const pos = s + 1 + sel.length;
    ta.focus(); ta.setSelectionRange(pos, pos); grow();
  });
  $('.plus', el).onclick = () => onPlus && onPlus();
  $('.send', el).onclick = () => {
    if (el.classList.contains('busy')) { onSend(null); return; }
    const v = ta.value.trim();
    if (!v) return;
    ta.value = ''; grow();
    onSend(v);
  };
  el.setBusy = (b) => {
    el.classList.toggle('busy', b);
    $('.send', el).innerHTML = icon(b ? 'stop' : 'send', 22);
    $('.send', el).setAttribute('aria-label', b ? '停止' : '送信');
  };
  el.setValue = (v) => { ta.value = v; grow(); };
  return el;
}
