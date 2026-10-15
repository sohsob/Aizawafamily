// Claude API（Messages API）をブラウザから直接呼ぶ。ストリーミングとツール実行ループを担当。
const API_URL = 'https://api.anthropic.com/v1/messages';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function headers(key) {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function explain(status, body) {
  let detail = '';
  try { detail = JSON.parse(body).error.message; } catch (_) { detail = body.slice(0, 300); }
  const hint = {
    401: 'Claude APIキーが正しくありません。設定を確認してください。',
    403: 'このAPIキーではこの操作が許可されていません。',
    404: 'モデル名が見つかりません。設定のモデル名を確認してください。',
    429: '利用上限に達しました。少し待つか、Anthropicの利用枠を確認してください。',
    529: 'Claude側が混み合っています。少し待ってから再生成してください。',
  }[status];
  return (hint ? hint + '\n' : '') + `（${status}: ${detail}）`;
}

// 1回分のストリーミング呼び出し。返り値は { content, stop_reason, usage }
export async function streamOnce({ key, body, onText, signal }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) throw new ApiError(explain(res.status, await res.text()), res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const blocks = [];
  const jsonBuf = {};
  let stop_reason = null;
  const usage = {};

  const handle = (ev) => {
    switch (ev.type) {
      case 'message_start':
        Object.assign(usage, ev.message.usage || {});
        break;
      case 'content_block_start':
        blocks[ev.index] = { ...ev.content_block };
        if (ev.content_block.type === 'tool_use') jsonBuf[ev.index] = '';
        if (ev.content_block.type === 'text') blocks[ev.index].text = ev.content_block.text || '';
        break;
      case 'content_block_delta': {
        const b = blocks[ev.index];
        if (ev.delta.type === 'text_delta') { b.text += ev.delta.text; onText && onText(ev.delta.text); }
        else if (ev.delta.type === 'input_json_delta') jsonBuf[ev.index] += ev.delta.partial_json;
        break;
      }
      case 'content_block_stop': {
        const b = blocks[ev.index];
        if (b && b.type === 'tool_use') {
          try { b.input = jsonBuf[ev.index] ? JSON.parse(jsonBuf[ev.index]) : {}; } catch (_) { b.input = {}; }
        }
        break;
      }
      case 'message_delta':
        if (ev.delta && ev.delta.stop_reason) stop_reason = ev.delta.stop_reason;
        Object.assign(usage, ev.usage || {});
        break;
      case 'error':
        throw new ApiError((ev.error && ev.error.message) || 'ストリーム中にエラーが発生しました', 500);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if (!dataLine) continue;
      let ev;
      try { ev = JSON.parse(dataLine); } catch (_) { continue; }
      handle(ev);
    }
  }
  return { content: blocks.filter(Boolean), stop_reason, usage };
}

// ツールを実行しながら最後まで回す。
// tools: [{ name, description, input_schema, run: async (input) => string }]
// onText(fullTextSoFar) は表示用。ツール呼び出しが起きた回の前置きテキストは表示から外す。
export async function runConversation({ key, model, maxTokens, system, messages, tools = [], onText, onTool, signal, maxSteps = 8 }) {
  const convo = messages.slice();
  const toolDefs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));
  let committed = '';   // ツールを伴わなかった回で確定したテキスト
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const calledTools = [];

  for (let step = 0; step < maxSteps; step++) {
    let current = '';
    const body = { model, max_tokens: maxTokens, system, messages: convo };
    if (toolDefs.length) body.tools = toolDefs;
    const result = await streamOnce({
      key, body, signal,
      onText: (t) => { current += t; onText && onText(committed + current); },
    });
    for (const k of Object.keys(totalUsage)) totalUsage[k] += result.usage[k] || 0;

    const toolUses = result.content.filter(b => b.type === 'tool_use');
    if (result.stop_reason !== 'tool_use' || !toolUses.length) {
      committed += current;
      return { text: committed, usage: totalUsage, calledTools, stop_reason: result.stop_reason };
    }

    // ツール実行回：前置きテキストは表示から外す
    onText && onText(committed);
    convo.push({ role: 'assistant', content: result.content });
    const results = [];
    for (const tu of toolUses) {
      calledTools.push({ name: tu.name, input: tu.input });
      onTool && onTool(tu.name, tu.input);
      let out;
      try {
        const t = toolMap[tu.name];
        out = t ? await t.run(tu.input || {}) : `不明なツール: ${tu.name}`;
      } catch (e) {
        out = `ツール実行エラー: ${e.message}`;
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out) });
    }
    convo.push({ role: 'user', content: results });
  }
  return { text: committed, usage: totalUsage, calledTools, stop_reason: 'max_steps' };
}
