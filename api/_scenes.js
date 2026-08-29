/* ========================================
   OB会 思い出アルバム - シーン定義
   2026年8月29日の Sophia ESS Reunion 2026、1日分の写真を当日の流れで分類する。
   自由入力にすると表記ゆれ（「二次会」「2次会」等）で絞り込みが分裂するため、
   選択式の固定リストにしている。
======================================== */

/* 並び順がそのまま画面の絞り込みボタンの並びになる（当日の時間順） */
export const SCENES = [
  '受付・開会',
  '集合写真',
  '歓談',
  'スピーチ・挨拶',
  '余興・企画',
  '二次会',
  'その他',
];

/* 一覧に無い値や未指定は「その他」に寄せる */
export function normalizeScene(value) {
  return SCENES.includes(value) ? value : 'その他';
}

/* 入力文字列の長さを制限し、想定外の巨大データが混入するのを防ぐ */
export function trimText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

/* タグはカンマ・読点・空白いずれの区切りでも受け取れるようにする */
export function parseTags(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return raw
    .split(/[,、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}
