// 画面をまたいで使う生成処理（LIVE状態・DM送信・画像生成など）
import { db } from './db.js';
import { S, saveLive, saveUnread, addMessage, appendToDoc, albumRefs, savePhoto } from './state.js';
import { NPCS, CHARACTERS, findChar, findRoom, roomById, roomLabel, jstParts, charById } from './data.js';
import { yokohamaWeather } from './weather.js';
import { buildSystem, selectHistory, appendInstruction, collect, IMAGE_INSTRUCTION, IMAGE_SCHEMA, roomListText } from './engine.js';
import { generateImage } from './openai.js';
import { toast } from './ui.js';

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

export function requireKey(kind = 'anthropic') {
  if (kind === 'anthropic' && !S.settings.anthropicKey) { toast('先に設定でClaude APIキーを入力してください', 3500); emit('nav', { to: 'vault', panel: 'settings' }); return false; }
  if (kind === 'openai' && !S.settings.openaiKey) { toast('先に設定でOpenAI APIキーを入力してください', 3500); emit('nav', { to: 'vault', panel: 'settings' }); return false; }
  return true;
}

export function locText() {
  const lines = [];
  for (const c of NPCS) {
    const v = S.live.locations[c.id];
    const r = v && roomById(v.room);
    lines.push(`・${c.full}：${r ? roomLabel(r) : '未確定'}${v && v.room === 'outside' && v.label ? `（${v.label}）` : ''}`);
  }
  lines.push(`・相澤うみ：${roomLabel(roomById(S.live.umiRoom))}`);
  return lines.join('\n');
}

function pendingDates(now = new Date()) {
  if (!S.live.lastSync) return [];
  const out = [];
  const today = jstParts(now).date;
  let t = S.live.lastSync;
  for (let i = 0; i < 14; i++) {
    const d = jstParts(new Date(t)).date;
    if (d >= today) break;
    if (!S.live.recordedDates.includes(d) && !out.includes(d)) out.push(d);
    t += 24 * 3600 * 1000;
  }
  return out;
}

export async function liveDyn({ forMode = 'live', now = new Date() } = {}) {
  const p = jstParts(now);
  const weather = await yokohamaWeather();
  let t = `【現在の状態（アプリが管理）】
現在JST日時：${p.y}年${p.m}月${p.d}日（${p.wd}）${p.hh}:${p.mm}
天気：${weather || '取得できなかった（具体的な天候を確定しない）'}`;
  if (forMode === 'live') {
    if (S.live.lastSync) {
      const lp = jstParts(new Date(S.live.lastSync));
      const mins = Math.round((now - S.live.lastSync) / 60000);
      t += `\n前回確定LIVE時刻：${lp.m}/${lp.d} ${lp.hh}:${lp.mm}（${mins >= 60 ? `${Math.floor(mins / 60)}時間${mins % 60}分` : `${mins}分`}前）`;
    } else {
      t += '\n前回確定LIVE時刻：なし（初回起動。現在時刻の状態を初期状態として成立させる）';
    }
    const pend = pendingDates(now);
    if (pend.length) t += `\n未保存の終了日：${pend.join('、')}（append_live_record で古い順に保存する）`;
  }
  t += `\n\n【各人物の現在地（前回確定）】\n${locText()}`;
  if (S.live.comingUp.length) t += `\n\n【COMING UP（うみの予定）】\n${S.live.comingUp.map(c => `・${c.time} ${c.room}：${c.text}`).join('\n')}`;
  if (forMode === 'live') t += `\n\n【居住ビルの部屋】\n${roomListText()}`;
  return t;
}

// LIVE系で使うツール
export function liveTools() {
  return [
    {
      name: 'update_live_state',
      description: '人物の現在地と、うみの予定（COMING UP）を更新する。locations は {人物名: 部屋名}。外出中なら「外出中：行き先」。coming_up を渡すと一覧を置き換える。',
      input_schema: {
        type: 'object',
        properties: {
          locations: { type: 'object', additionalProperties: { type: 'string' } },
          coming_up: { type: 'array', items: { type: 'object', properties: { time: { type: 'string' }, room: { type: 'string' }, text: { type: 'string' } }, required: ['time', 'text'] } },
        },
      },
      run: async ({ locations, coming_up }) => {
        const done = [];
        for (const [name, place] of Object.entries(locations || {})) {
          const c = findChar(name);
          if (!c) continue;
          const outside = /外出|外|不在|出張|仕事|学校|雄英/.test(place) && !findRoom(place);
          const r = outside ? null : findRoom(place);
          if (c.id === 'umi') { if (r) S.live.umiRoom = r.id; continue; }
          S.live.locations[c.id] = r ? { room: r.id } : { room: 'outside', label: String(place).replace(/^外出中[:：]?/, '') };
          done.push(`${c.short}→${r ? r.name : '外出中'}`);
        }
        if (Array.isArray(coming_up)) S.live.comingUp = coming_up.slice(0, 6).map(x => ({ time: x.time || '', room: x.room || '', text: x.text || '' }));
        await saveLive();
        emit('live-state');
        return `更新しました：${done.join('、') || '現在地の変更なし'}`;
      },
    },
    {
      name: 'send_dm',
      description: 'NPCからうみへ個別DMを送る。to を「グループ」にすると家族グループLINEへ投稿する。',
      input_schema: {
        type: 'object',
        properties: { from: { type: 'string' }, text: { type: 'string' }, to: { type: 'string', description: '「うみ」または「グループ」' } },
        required: ['from', 'text'],
      },
      run: async ({ from, text, to }) => {
        const c = findChar(from);
        if (!c || c.user) return '送信者が見つかりません。';
        if (to && /グループ|group|LINE/i.test(to)) {
          await addMessage('group', 'assistant', `${c.short}：${text}`, { from: c.id });
          S.unread.group = (S.unread.group || 0) + 1;
        } else {
          await addMessage('dm:' + c.id, 'assistant', text, { from: c.id });
          S.unread.dm[c.id] = (S.unread.dm[c.id] || 0) + 1;
        }
        await saveUnread();
        emit('unread');
        return '送信しました。';
      },
    },
    {
      name: 'append_live_record',
      description: '終了した日のLIVE記録を「居住ビルLIVE記録」へ追記する。',
      input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, text: { type: 'string' } }, required: ['date', 'text'] },
      run: async ({ date, text }) => {
        if (S.live.recordedDates.includes(date)) return 'その日は保存済みです。';
        await appendToDoc(S.settings.liveRecordDoc, `━━━━━━━━━━━━━━━━━━━━\nLIVE記録｜${date}\n━━━━━━━━━━━━━━━━━━━━`, text);
        S.live.recordedDates.push(date);
        await saveLive();
        return '保存しました。';
      },
    },
  ];
}

// 会話スレッドの履歴（Claudeへ送る形）
export async function threadHistory(threadId, windowStart, transform) {
  const msgs = (await db.messages(threadId)).filter(m => m.role === 'user' || m.role === 'assistant');
  const conv = msgs.map(m => ({ role: m.role, content: transform ? transform(m) : m.content }));
  return selectHistory(conv, windowStart, S.settings.historyChars);
}

// 場面から画像を作る（STORY / LIVE 共通）
export async function sceneImage({ mode, system, history, request, direct, signal, onStatus }) {
  let prompt = request, characters = [];
  if (!direct) {
    onStatus && onStatus('場面から画像プロンプトを作成中…');
    const names = CHARACTERS.map(c => c.full).join('、');
    const { input } = await collect({
      settings: S.settings, system, docs: S.docs, signal,
      messages: appendInstruction(history, IMAGE_INSTRUCTION(request, S.settings.illustDoc, names)),
      toolName: 'submit_image_prompt', description: '画像生成AIへ渡すプロンプトと登場人物名を提出する。', schema: IMAGE_SCHEMA,
    });
    if (!input || !input.prompt) throw new Error('画像プロンプトを作成できませんでした。');
    prompt = input.prompt; characters = input.characters || [];
  } else {
    characters = CHARACTERS.filter(c => prompt.includes(c.short) || prompt.includes(c.full)).map(c => c.full);
  }
  const { dataUrl, used } = await renderImage({ prompt, characters, signal, onStatus });
  const photo = await savePhoto({ dataUrl, album: mode === 'live' ? 'LIVE' : 'STORY', prompt, source: mode, characters });
  return { dataUrl, prompt, characters, photoId: photo.id, refsUsed: used };
}

export async function renderImage({ prompt, characters = [], signal, onStatus }) {
  const { refs, ng } = await albumRefs(characters);
  let finalPrompt = prompt;
  if (ng.length) finalPrompt += `\n\n避けること（過去の失敗例より）：\n${ng.map(x => '- ' + x).join('\n')}`;
  if (refs.length) finalPrompt += `\n\n添付画像は登場人物の外見参考（顔立ち・髪型・髪色・目の色・体格の同一性を保つ）。添付画像の構図や背景はまねない。`;
  onStatus && onStatus(`画像を生成中…${refs.length ? `（参考画像${refs.length}枚）` : ''}`);
  const dataUrl = await generateImage({
    key: S.settings.openaiKey, model: S.settings.imageModel, prompt: finalPrompt,
    size: S.settings.imageSize, quality: S.settings.imageQuality, refImages: refs, signal,
  });
  return { dataUrl, used: refs.length };
}

export { buildSystem, charById };
