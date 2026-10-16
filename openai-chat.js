// OpenAI Chat Completions 版の会話エンジン。claude.js の runConversation と同じ形で使える。
// 内部の会話データ（Anthropic形式）を OpenAI 形式に変換して送る。
const URL_ = 'https://api.openai.com/v1/chat/completions';

function explain(status, body) {
  let detail = '';
  try { detail = JSON.parse(body).error.message; } catch (_) { detail = body.slice(0, 300); }
  const hint = {
    401: 'OpenAI APIキーが正しくありません。設定を確認してください。',
    403: 'このOpenAIアカウントではこのモデルが使えません。',
    404: '会話モデル名が見つかりません。設定のモデル名を確認してください。',
    429: 'OpenAIの利用上限に達したか、混み合っています。少し待つか、利用枠を確認してください。',
  }[status];
  return (hint ? hint + '\n' : '') + `（${status}: ${detail}）`;
}

const textOf = (c) => typeof c === 'string' ? c : (c || []).filter(b => b.type === 'text').map(b => b.text).join('');

// Anthropic形式 → OpenAI形式
function convert(system, messages) {
  const sys = Array.isArray(system) ? system.map(b => b.text).join('\n\n') : String(system || '');
  const out = [{ role: 'system', content: sys }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const calls = m.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      const msg = { role: 'assistant', content: textOf(m.content) || null };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    // user：tool_result は tool メッセージへ、画像は image_url へ
    const results = m.content.filter(b => b.type === 'tool_result');
    for (const r of results) out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: String(r.content) });
    const parts = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
    }
    if (parts.length) out.push({ role: 'user', content: parts.every(p => p.type === 'text') ? parts.map(p => p.text).join('') : parts });
  }
  return out;
}

async function streamOnce({ key, body, onText, signal }) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!res.ok) throw new Error(explain(res.status, await res.text()));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', text = '', finish = null, usage = null;
  const calls = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch (_) { continue; }
      if (ev.error) throw new Error(ev.error.message || 'ストリーム中にエラーが発生しました');
      if (ev.usage) usage = ev.usage;
      const ch = ev.choices && ev.choices[0];
      if (!ch) continue;
      const d = ch.delta || {};
      if (d.content) { text += d.content; onText && onText(d.content); }
      for (const tc of d.tool_calls || []) {
        const c = calls[tc.index] = calls[tc.index] || { id: '', name: '', args: '' };
        if (tc.id) c.id = tc.id;
        if (tc.function && tc.function.name) c.name += tc.function.name;
        if (tc.function && tc.function.arguments) c.args += tc.function.arguments;
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  return { text, calls: calls.filter(Boolean), finish, usage };
}

export async function runConversationOpenAI({ key, model, maxTokens, system, messages, tools = [], onText, onTool, signal, maxSteps = 8 }) {
  const convo = convert(system, messages);
  const toolDefs = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));
  let committed = '';
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const calledTools = [];
  for (let step = 0; step < maxSteps; step++) {
    let current = '';
    const body = { model, messages: convo, max_completion_tokens: maxTokens };
    if (toolDefs.length) body.tools = toolDefs;
    const r = await streamOnce({ key, body, signal, onText: (t) => { current += t; onText && onText(committed + current); } });
    if (r.usage) {
      const cached = (r.usage.prompt_tokens_details && r.usage.prompt_tokens_details.cached_tokens) || 0;
      totalUsage.input_tokens += (r.usage.prompt_tokens || 0) - cached;
      totalUsage.cache_read_input_tokens += cached;
      totalUsage.output_tokens += r.usage.completion_tokens || 0;
    }
    if (!r.calls.length) {
      committed += current;
      return { text: committed, usage: totalUsage, calledTools, stop_reason: r.finish === 'length' ? 'max_tokens' : 'end_turn' };
    }
    onText && onText(committed);
    convo.push({ role: 'assistant', content: current || null, tool_calls: r.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
    for (const c of r.calls) {
      let input = {};
      try { input = c.args ? JSON.parse(c.args) : {}; } catch (_) {}
      calledTools.push({ name: c.name, input });
      onTool && onTool(c.name, input);
      let out;
      try { const t = toolMap[c.name]; out = t ? await t.run(input) : `不明なツール: ${c.name}`; }
      catch (e) { out = `ツール実行エラー: ${e.message}`; }
      convo.push({ role: 'tool', tool_call_id: c.id, content: String(out) });
    }
  }
  return { text: committed, usage: totalUsage, calledTools, stop_reason: 'max_steps' };
}
