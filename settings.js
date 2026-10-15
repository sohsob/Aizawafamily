// 設定（APIキーを含む）はこの端末の localStorage にだけ保存する。
const KEY = 'kyojuu-settings';

export const DEFAULTS = {
  anthropicKey: '',
  openaiKey: '',
  model: 'claude-opus-5-5',
  maxTokens: 6000,
  historyChars: 60000,      // 毎回送る直近履歴の上限（文字数）
  memoryInterval: 40,       // 何手ごとに思い出を自動記録するか（0で無効）
  memoryDoc: '思い出(1).txt',
  illustDoc: 'イラスト生成指示.txt',
  liveRecordDoc: '居住ビルLIVE記録.txt',
  syncOn: true,            // LIVEの現実時間同期
  imageModel: 'gpt-image-2',
  imageSize: '1024x1536',
  imageQuality: 'high',
  fontSize: 16,
};

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
