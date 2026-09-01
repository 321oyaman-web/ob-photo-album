/* ========================================
   OB会 思い出アルバム - 登録できるファイル種別の定義

   写真（画像）と資料（PDF）を同じ一覧で扱う。
   保存先のキーは種別で決まるため、ここに集約して
   発行（upload-url）と登録（register）で食い違わないようにする。
======================================== */

export const TYPES = ['photo', 'pdf'];

export function normalizeType(value) {
  return TYPES.includes(value) ? value : 'photo';
}

/* 保存先のキー。ファイル名は表示用にのみ使い、キーには UUID を使って
   衝突と文字化けを防ぐ */
export function keysFor(type, id) {
  return type === 'pdf'
    ? { key: `photos/${id}/file.pdf`, thumbKey: null }
    : { key: `photos/${id}/full.jpg`, thumbKey: `photos/${id}/thumb.jpg` };
}

/* 送られてきたキーが、その種別の正しい形式かを確かめる。
   任意のパスへ書き込まれるのを防ぐための検証 */
export function keysMatch(type, id, key, thumbKey) {
  const expected = keysFor(type, id);
  if (key !== expected.key) return false;
  return type === 'pdf'
    ? !thumbKey                       // PDF はサムネイルを持たない
    : thumbKey === expected.thumbKey;
}

export const CONTENT_TYPE = { photo: 'image/jpeg', pdf: 'application/pdf' };
