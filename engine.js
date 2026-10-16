// 生成エンジン：モードごとのシステムプロンプト、履歴ウィンドウ、各種生成。
import { runConversation } from './claude.js';
import { chatKey, chatModel } from './settings.js';
import { readDoc, searchAll } from './docs.js';
import { CHARACTERS, ROOMS, roomLabel } from './data.js';

const CONSULT_ON = /^\s*【(ナレーター相談|プロンプト相談|相談)】/;
const STORY_BACK = /^\s*【物語に戻る】/;
export const MEMORY_CMD = /^\s*【思い出】\s*$/;

export function classifyInput(text, thread) {
  if (MEMORY_CMD.test(text)) return { kind: 'memory' };
  if (CONSULT_ON.test(text)) return { kind: 'consult', consulting: true };
  if (STORY_BACK.test(text)) return { kind: 'story', consulting: false };
  return { kind: thread.consulting ? 'consult' : 'story', consulting: thread.consulting };
}

export const docGroup = (mode) => (mode === 'story' ? 'story' : 'live');

function commonBlock(refDocs, settings) {
  const list = refDocs.map(d => `・${d.name}（${d.content.length}文字）`).join('\n') || '（なし）';
  return `■ 資料の段階参照
常時資料以外に、次の資料をツールで読める。
${list}

・指示にある段階参照の条件が成立した時だけ、read_document（資料名を正確に指定）で該当資料を読む。必要箇所が分かる時は query に空白区切りのキーワードを入れる。
・どの資料にあるか分からない事柄は search_documents で探す。
・資料は本文を書き始める前に読む。読んだこと・調べたことは本文に書かない。
・会話履歴は直近分のみが送られている。それより前の出来事は「${settings.memoryDoc}」「${settings.liveRecordDoc}」や会話ログ資料で確認できる。
・人物名の表記：${CHARACTERS.map(c => c.full).join('、')}（相澤うみはユーザーが担当する）。`;
}

const MODE_BLOCK = {
  story: (s) => `【このアプリでの運用｜STORY】
あなたは「居住ビルの毎日」の通常ストーリーを生成する。下の常時資料（ストーリー生成指示・世界観など）に従う。
・思い出記録はアプリが別途「【思い出記録】」として依頼する。通常本文の中では記録しない。
・通常本文では画像生成を行わない（アプリの別機能）。「${s.illustDoc}」は外見が場面に作用する時だけ参照する。`,
  live: (s) => `【このアプリでの運用｜LIVE】
あなたは「居住ビルの毎日」LIVE MODE を運用する。下の常時資料（LIVE MODE・世界観など）に従う。ただし表示と状態管理はこのアプリの仕様を優先する。
・LIVEは通常ストーリーとは別の時間軸。全員が長期休み中で居住ビルに常駐しているので、人物を外出させない（現在地は居住ビル内の部屋）。STORYで起きた出来事は共有の記憶として話題にできるが、STORYの場面・居場所・進行中の用事は持ち込まない。
・CARD 1（現在地ボード）はアプリのHOME画面が表示する。本文には書かず、人物の現在地が確定・変化したら update_live_state で更新する。初回同期・時間帯を跨いだ同期では必ず全員分の現在地を update_live_state で送る。
・本文はCARD 2（現在の生活）にあたる場面だけを書く。「CARD」「HOUSE EVENT」などの見出しやラベルは書かない。地の文は「>」、台詞は引用の外に「人物名「台詞」」（人物名はフルネーム）。
・本文はうみが今いる部屋の場面を中心に書く。うみの居ない場所の出来事は、うみが知り得る形（物音、DM、来訪など）でだけ表に出す。
・NPCからうみへのDMは send_dm で送る（本文に書かない）。家族グループLINEへの投稿は send_dm の to を「グループ」にする。
・予定が生まれたら update_live_state の coming_up で更新する（うみに関係するものだけ）。
・未保存の終了日がある時は append_live_record でその日の記録を古い日付から保存する。
・Instagram は FEED 画面の別機能で扱う。`,
  dm: (s, extra) => `【このアプリでの運用｜DM】
あなたは${extra.char.full}として、相澤うみとの個別DM（スマホのメッセージ）に返信する。下の常時資料（世界観・LIVE MODEなど）と${extra.char.full}のPROFILEに従う。
・返信の前に read_document で「${extra.char.profile}」を読み、本人の口調・距離感・現在状態から返す（毎回でなくてよいが、口調が曖昧なら必ず読む）。
・出力は${extra.char.short}が送るメッセージ本文だけ。地の文・「」・名前の前置き・ト書きは書かない。複数の吹き出しに分けたい時は空行で区切る。
・スマホのメッセージとして自然な長さにする。現在時刻と本人の現在地・状況（システム内に記載）を反映する。
・うみの未入力の返事・感情を決めない。`,
  group: () => `【このアプリでの運用｜家族グループLINE】
あなたは相澤家の家族グループLINE「Family Group LINE」で、うみ以外のメンバーの投稿を生成する。下の常時資料と各人物PROFILEに従う。
・今の投稿に自然に反応するメンバーだけが返信する（全員が返す必要はない。0人でもよい）。
・出力は1行に1投稿、「人物名：本文」の形式だけ。地の文・ト書きは書かない。人物名は短い呼び名（消太・カイ・啓悟・朔・宙・七海）。
・各人物の口調が曖昧なら read_document でPROFILEを確認する。
・現在時刻と各人物の現在地・状況（システム内に記載）を反映する。`,
  feed: () => `【このアプリでの運用｜FEED】
あなたは相澤家の家族向けSNS（Instagram相当）の投稿・コメントを生成する。下の常時資料（LIVE MODE「16〜24 Instagram」など）と各人物PROFILEに従う。
・投稿者・写真内容・撮影者・投稿理由は、現在のLIVE状態から一つの撮影状況として整合させる。
・指定されたツールを一度だけ呼んで提出する。本文は書かない。`,
};

export function buildSystem({ mode, docs, settings, dyn, extra = {} }) {
  const g = docGroup(mode);
  const base = docs.filter(d => d.base && d.base[g]);
  const refs = docs.filter(d => !(d.base && d.base[g]));
  const stable = [MODE_BLOCK[mode](settings, extra), commonBlock(refs, settings)];
  for (const d of base) stable.push(`━━━━━━━━━━━━━━━━━━━━\n【常時資料：${d.name}】\n━━━━━━━━━━━━━━━━━━━━\n\n${d.content}`);
  const system = [{ type: 'text', text: stable.join('\n\n'), cache_control: { type: 'ephemeral' } }];
  if (dyn) system.push({ type: 'text', text: dyn });
  if (mode === 'live') system.push({ type: 'text', text: '【表示の最終ルール（LIVE MODE本文の表示構造より優先）】\n・「CARD 1」「CARD 2」「現在地ボード」「HOUSE EVENT」などの見出しと、人物ごとの現在地一覧は本文に書かない。現在地は update_live_state で送る（アプリがHOMEに表示する）。\n・本文は場面の地の文（>）と台詞だけ。' });
  return system;
}

// 直近履歴。上限を超えた時だけ開始位置を大きく進める（キャッシュが効きやすい）。
export function selectHistory(conv, windowStart, budget) {
  let start = Math.min(windowStart || 0, Math.max(0, conv.length - 1));
  const size = (from) => conv.slice(from).reduce((n, m) => n + m.content.length, 0);
  if (size(start) > budget) {
    while (start < conv.length - 1 && size(start) > budget * 0.7) start++;
  }
  const out = [];
  for (const m of conv.slice(start)) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: '（ここからの続き）' });
  return { history: out, windowStart: start };
}

export function withCacheOnLast(history) {
  const msgs = history.map(m => ({ role: m.role, content: m.content }));
  const last = msgs[msgs.length - 1];
  if (last && typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
  }
  return msgs;
}

// 履歴の最後に一時的な依頼文を足す（保存はしない）
export function appendInstruction(history, instruction) {
  const msgs = withCacheOnLast(history);
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'user') last.content = [...last.content, { type: 'text', text: '\n\n' + instruction }];
  else msgs.push({ role: 'user', content: instruction });
  return msgs;
}

export function docTools(allDocs) {
  const byName = (name) => {
    if (!name) return null;
    const exact = allDocs.find(d => d.name === name);
    if (exact) return exact;
    const n = name.replace(/\.txt$/, '').replace(/\s/g, '');
    return allDocs.find(d => d.name.replace(/\.txt$/, '').replace(/\s/g, '').includes(n))
      || allDocs.find(d => n.includes(d.name.replace(/\.txt$/, '').replace(/\s/g, ''))) || null;
  };
  return [
    {
      name: 'read_document',
      description: '資料を読む。name は資料名。query（空白区切りのキーワード）を入れると関係する箇所だけを返す。長い資料は offset で続きを読める。',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '資料名（例：相澤消太A3.txt）' },
          query: { type: 'string', description: '必要箇所のキーワード（空白区切り、任意）' },
          offset: { type: 'integer', description: '全文を読む時の開始位置（任意）' },
        },
        required: ['name'],
      },
      run: async ({ name, query, offset }) => {
        const d = byName(name);
        if (!d) return `資料「${name}」は見つかりません。存在する資料：${allDocs.map(x => x.name).join('、')}`;
        return readDoc(d, query, offset);
      },
    },
    {
      name: 'search_documents',
      description: 'すべての資料からキーワード（空白区切り）で該当箇所を探す。',
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async ({ query }) => searchAll(allDocs, query),
    },
  ];
}

export function roomListText() {
  return ROOMS.map(r => `・${roomLabel(r)}${r.private ? `（PRIVATE：入室可＝${(r.allowed || []).map(id => CHARACTERS.find(c => c.id === id).short).join('・')}）` : ''}`).join('\n');
}

// 汎用：ツールつきで本文を生成
export function generate({ settings, system, messages, docs, tools = [], onText, onTool, signal, maxTokens }) {
  return runConversation({
    provider: settings.provider, key: chatKey(settings),
    model: chatModel(settings),
    maxTokens: maxTokens || settings.maxTokens,
    system, messages,
    tools: [...docTools(docs), ...tools],
    onText, onTool, signal,
  });
}

// ツールを1回呼ばせて、その入力を受け取る
export async function collect({ settings, system, messages, docs, toolName, description, schema, signal, onTool, maxTokens = 4000, allowRead = true }) {
  let got = null;
  const tool = { name: toolName, description, input_schema: schema, run: async (input) => { got = input; return '受け付けました。本文は書かずに終了してください。'; } };
  const res = await runConversation({
    provider: settings.provider, key: chatKey(settings), model: chatModel(settings), maxTokens,
    system, messages,
    tools: [...(allowRead ? docTools(docs).filter(t => t.name === 'read_document') : []), tool],
    signal, onTool,
  });
  return { input: got, text: res.text, usage: res.usage };
}

export const MEMORY_INSTRUCTION = (hasState) => `【思い出記録】
ストーリー生成指示「26．思い出記録」に従い、${hasState ? '直近の思い出記録（システム内に記載）以降に' : 'これまでに'}確定した出来事を記録する。
・記録項目：現在の場所／主要人物の現在位置／確定した外見・服装／起きた出来事／約束／継続事項／関係へ影響した出来事／次回開始時に保持する現在状態。
・未確認情報は未確認として書く。相澤うみの未入力の感情・目的・身体状態は補完しない。過去記録を書き換えない。
・append_memory を一度だけ呼び、今回分の記録本文だけを渡す。物語本文・前置き・感想は書かない。
（この依頼は物語入力ではなく、物語の状態を変更しない）`;

export const IMAGE_INSTRUCTION = (request, illustDoc, names) => `【画像プロンプト作成】
依頼：${request || '現在の場面を一枚の絵にする'}
・まず read_document で「${illustDoc}」の該当人物の外見固定情報を読む。
・現在の場面で確定している服装・場所・姿勢・位置関係・一時的な外見状態を反映する。
・画風（高品質アニメイラスト調）・構図・光・表情まで具体的に書いた、画像生成AI向けのプロンプトを作る。絵の中に文字・吹き出し・名前を入れない指定も含める。
・characters には登場人物名（${names}）を入れる。
・submit_image_prompt を一度だけ呼ぶ。本文は書かない。
（この依頼は物語入力ではなく、物語の状態を変更しない）`;

export const IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: '画像生成AI向けの詳細なプロンプト' },
    characters: { type: 'array', items: { type: 'string' }, description: '画像に登場する人物名' },
  },
  required: ['prompt'],
};
