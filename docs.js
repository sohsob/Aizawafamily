// 資料まわり：役割の自動判定、本文の読み出し、キーワードによる該当箇所の抜き出し。
export const READ_LIMIT = 40000; // 1回の read_document で返す最大文字数

export function guessRole(name) {
  if (/ストーリープロンプト|ストーリー生成/.test(name)) return 'base';
  if (/世界観/.test(name)) return 'base';
  return 'ref';
}

// 段落単位で分割し、近い段落をまとめて検索用の塊にする
function chunks(text, size = 1600) {
  const paras = text.split(/\n{2,}/);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if (cur && (cur.length + p.length > size || /^━{5,}|^╔/.test(p))) { out.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) out.push(cur);
  return out;
}

function terms(query) {
  return String(query || '').split(/[\s、,，・/／]+/).map(s => s.trim()).filter(s => s.length > 0);
}

function score(chunk, ts) {
  let s = 0;
  for (const t of ts) {
    let i = -1, n = 0;
    while ((i = chunk.indexOf(t, i + 1)) >= 0 && n < 20) n++;
    if (n) s += 3 + n;
  }
  return s;
}

export function excerpt(text, query, maxChars = 12000) {
  const ts = terms(query);
  if (!ts.length) return null;
  const cs = chunks(text).map((c, i) => ({ c, i, s: score(c, ts) })).filter(x => x.s > 0);
  if (!cs.length) return null;
  cs.sort((a, b) => b.s - a.s);
  const picked = [];
  let total = 0;
  for (const x of cs) {
    if (total + x.c.length > maxChars && picked.length) break;
    picked.push(x); total += x.c.length;
  }
  picked.sort((a, b) => a.i - b.i);
  return picked.map(x => x.c).join('\n\n……（中略）……\n\n');
}

export function readDoc(doc, query, offset = 0) {
  if (!doc) return null;
  if (query) {
    const ex = excerpt(doc.content, query);
    if (ex) return `【${doc.name}｜「${query}」に関係する箇所】\n\n${ex}`;
    return `【${doc.name}】「${query}」に一致する箇所はありませんでした。別のキーワードを空白区切りで試すか、query なしで全文を読んでください。`;
  }
  const text = doc.content;
  const start = Math.max(0, offset | 0);
  const part = text.slice(start, start + READ_LIMIT);
  const rest = text.length - (start + part.length);
  let head = `【${doc.name}】（全${text.length}文字`;
  if (start > 0 || rest > 0) head += `／${start}文字目から${part.length}文字を表示`;
  head += '）';
  const tail = rest > 0 ? `\n\n……続きあり（残り${rest}文字）。offset=${start + part.length} で続きを読むか、query で必要箇所だけ読んでください。` : '';
  return `${head}\n\n${part}${tail}`;
}

export function searchAll(docs, query) {
  const ts = terms(query);
  if (!ts.length) return '検索語を指定してください。';
  const hits = [];
  for (const d of docs) {
    for (const [i, c] of chunks(d.content).entries()) {
      const s = score(c, ts);
      if (s > 0) hits.push({ name: d.name, i, c, s });
    }
  }
  if (!hits.length) return `「${query}」はどの資料にも見つかりませんでした。`;
  hits.sort((a, b) => b.s - a.s);
  let out = '';
  for (const h of hits.slice(0, 6)) {
    const snippet = h.c.length > 1800 ? h.c.slice(0, 1800) + '…' : h.c;
    out += `■ ${h.name}\n${snippet}\n\n`;
  }
  return out.trim();
}

// [USER] / [ASSISTANT] 形式の会話ログを {role, content}[] に変換
export function parseLog(text) {
  const re = /^=+\s*\n\[(USER|ASSISTANT)\]\s*\n=+\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ role: m[1] === 'USER' ? 'user' : 'assistant', start: m.index, end: re.lastIndex });
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : text.length).trim();
    if (body) out.push({ role: marks[i].role, content: body });
  }
  return out;
}
