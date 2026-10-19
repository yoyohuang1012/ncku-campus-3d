// 介面文字一律透過 t() 取得，文字內容放在 public/data/i18n/<語言>.json。
let strings: Record<string, string> = {};

export function setStrings(s: Record<string, string>) {
  strings = s;
}

/** 取得文字；{name} 這類參數會被 params 取代。找不到 key 時回傳 key 本身，方便發現漏翻。 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = strings[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
