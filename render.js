// 本文の表示。「>」の引用は地の文、名前「…」は台詞として整形する。
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
}

function lineHtml(line) {
  const m = line.match(/^([^「」\s]{1,24}?)\s*(「[\s\S]*)$/);
  if (m && !/[。、！？]/.test(m[1])) {
    return `<p class="say"><span class="speaker">${esc(m[1])}</span><span class="speech">${inline(m[2])}</span></p>`;
  }
  if (/^#{1,6}\s/.test(line)) return `<p class="heading">${inline(line.replace(/^#{1,6}\s/, ''))}</p>`;
  if (/^(-{3,}|━{3,}|＿{3,})$/.test(line.trim())) return '<hr>';
  return `<p>${inline(line)}</p>`;
}

export function renderStory(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let quote = null;
  const flushQuote = () => {
    if (!quote) return;
    const paras = [];
    let cur = [];
    for (const l of quote) {
      if (!l.trim()) { if (cur.length) { paras.push(cur); cur = []; } }
      else cur.push(l);
    }
    if (cur.length) paras.push(cur);
    out.push(`<blockquote>${paras.map(p => `<p>${p.map(inline).join('<br>')}</p>`).join('')}</blockquote>`);
    quote = null;
  };
  for (const raw of lines) {
    const qm = raw.match(/^\s*>\s?(.*)$/);
    if (qm) { (quote = quote || []).push(qm[1]); continue; }
    if (!raw.trim()) { if (quote) quote.push(''); continue; }
    flushQuote();
    out.push(lineHtml(raw.trim()));
  }
  flushQuote();
  return out.join('');
}

export function renderUser(text) {
  return esc(text)
    .replace(/（([^（）]*)）|\(([^()]*)\)/g, (m) => `<span class="action">${m}</span>`)
    .replace(/\n/g, '<br>');
}

// LIVE表示用：本文を「話者ごとの吹き出し」に分ける
export function segmentLive(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let narr = [];
  let para = [];
  const flushPara = () => { if (para.length) { narr.push(para.join('\n')); para = []; } };
  for (const raw of lines) {
    const q = raw.match(/^\s*>\s?(.*)$/);
    const line = q ? q[1] : raw;
    if (!line.trim()) { flushPara(); continue; }
    const m = !q && line.trim().match(/^([^「」\s]{1,24}?)\s*(「[\s\S]*)$/);
    if (m && !/[。、！？]/.test(m[1])) {
      flushPara();
      const last = out[out.length - 1];
      if (last && last.speaker === m[1] && !narr.length) last.speech.push(line.trim());
      else out.push({ speaker: m[1], narr, speech: [line.trim()] });
      narr = [];
      continue;
    }
    if (/^(-{3,}|━{3,})$/.test(line.trim())) { flushPara(); continue; }
    para.push(line.trim());
  }
  flushPara();
  if (narr.length) out.push({ speaker: null, narr, speech: [] });
  return out;
}

export function renderSegment(seg) {
  const n = seg.narr.map(p => `<p class="narr">${inline(p).replace(/\n/g, '<br>')}</p>`).join('');
  const s = seg.speech.map(l => `<p class="speech-line">${inline(l)}</p>`).join('');
  return n + s;
}
