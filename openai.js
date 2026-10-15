// OpenAI 画像生成。参考画像があれば edits（参考画像つき）、なければ generations を使う。
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function explain(status, body) {
  let detail = '';
  try { detail = JSON.parse(body).error.message; } catch (_) { detail = body.slice(0, 300); }
  const hint = {
    400: '画像生成の依頼が受け付けられませんでした（内容の制限や設定値の可能性があります）。',
    401: 'OpenAI APIキーが正しくありません。設定を確認してください。',
    403: 'このOpenAIアカウントではこのモデルが使えません（組織認証が必要な場合があります）。',
    404: '画像モデル名が見つかりません。設定の画像モデル名を確認してください。',
    429: 'OpenAIの利用上限に達しました。',
  }[status];
  return (hint ? hint + '\n' : '') + `（${status}: ${detail}）`;
}

export async function generateImage({ key, model, prompt, size, quality, refImages = [], signal }) {
  let res;
  if (refImages.length) {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    if (size && size !== 'auto') fd.append('size', size);
    if (quality && quality !== 'auto') fd.append('quality', quality);
    refImages.slice(0, 10).forEach((r, i) => {
      const blob = dataUrlToBlob(r.dataUrl);
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      fd.append('image[]', blob, `ref${i}.${ext}`);
    });
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal,
    });
  } else {
    const body = { model, prompt, n: 1 };
    if (size && size !== 'auto') body.size = size;
    if (quality && quality !== 'auto') body.quality = quality;
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal,
    });
  }
  if (!res.ok) throw new Error(explain(res.status, await res.text()));
  const json = await res.json();
  const item = json.data && json.data[0];
  if (!item) throw new Error('画像が返ってきませんでした。');
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error('画像データの形式が想定外でした。');
}

// 参考画像を縮小してから保存（送信サイズと保存容量を抑える）
export function shrinkImage(file, maxSide = 1024) {
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
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}
