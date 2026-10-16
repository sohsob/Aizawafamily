// 設定（APIキーを含む）はこの端末の localStorage にだけ保存する。
const KEY = 'kyojuu-settings';

export const DEFAULTS = {
  anthropicKey: '',
  openaiKey: '',
  provider: 'openai',      // 会話に使うAI：'openai' または 'claude'
  openaiModel: 'gpt-5.5',
  model: 'claude-opus-5-5',
  maxTokens: 6000,
  historyChars: 60000,      // 毎回送る直近履歴の上限（文字数）
  memoryInterval: 40,       // 何手ごとに思い出を自動記録するか（0で無効）
  memoryDoc: '思い出(1).txt',
  illustDoc: 'イラスト生成指示.txt',
  liveRecordDoc: '居住ビルLIVE記録.txt',
  syncOn: true,            // LIVEの現実時間同期
  groupAuto: true,         // 家族グループLINEの自動投稿
  groupInterval: 120,      // 自動投稿の間隔（分）
  imageModel: 'gpt-image-2',
  imageSize: '1024x1536',
  imageQuality: 'high',
  fontSize: 16,
};

export const chatKey = (s) => (s.provider === 'claude' ? s.anthropicKey : s.openaiKey);
export const chatModel = (s) => (s.provider === 'claude' ? s.model : s.openaiModel);

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
}
