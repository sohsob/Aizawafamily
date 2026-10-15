// 横浜の現在の天気（Open-Meteo、キー不要）。30分キャッシュ。
const CODES = {
  0: '快晴', 1: '晴れ', 2: '晴れ時々曇り', 3: '曇り', 45: '霧', 48: '霧（着氷）',
  51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨', 61: '弱い雨', 63: '雨', 65: '強い雨',
  66: '着氷性の雨', 67: '強い着氷性の雨', 71: '弱い雪', 73: '雪', 75: '大雪', 77: '霧雪',
  80: 'にわか雨', 81: '強いにわか雨', 82: '激しいにわか雨', 85: 'にわか雪', 86: '強いにわか雪',
  95: '雷雨', 96: '雹を伴う雷雨', 99: '激しい雹を伴う雷雨',
};
let cache = null;

export async function yokohamaWeather() {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.text;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=35.4437&longitude=139.638&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&timezone=Asia%2FTokyo';
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const c = (await res.json()).current;
    const text = `横浜：${CODES[c.weather_code] || '不明'}、気温${Math.round(c.temperature_2m)}℃、湿度${c.relative_humidity_2m}%、風速${Math.round(c.wind_speed_10m)}km/h${c.precipitation > 0 ? `、降水${c.precipitation}mm` : ''}`;
    cache = { at: Date.now(), text };
    return text;
  } catch (_) {
    return null;
  }
}
