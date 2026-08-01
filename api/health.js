/* ========================================
   GET /api/health
   設定が揃っているかを確認するための診断用エンドポイント。

   「サイトが動かない」ときに、原因が設定漏れなのか別の要因なのかを
   合言葉を入力せずに切り分けられるようにする。

   返すのは「設定されているか（true/false）」だけで、
   値そのもの・接続先ホスト・写真の内容は一切返さない。
======================================== */

import { readManifest } from './_r2.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET のみ受け付けます' });
  }

  const has = (name) => Boolean((process.env[name] || '').trim());

  const settings = {
    ALBUM_PASSWORD: has('ALBUM_PASSWORD'),
    ADMIN_PASSWORD: has('ADMIN_PASSWORD'),
    SESSION_SECRET: has('SESSION_SECRET'),
    R2_ACCOUNT_ID: has('R2_ACCOUNT_ID'),
    R2_ACCESS_KEY_ID: has('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: has('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET: has('R2_BUCKET'),
  };

  const missing = Object.keys(settings).filter((k) => !settings[k]);

  /* R2 へ実際に到達できるかを確認する（写真の中身は返さない） */
  let storage = { reachable: false, note: '未確認' };
  if (missing.length === 0) {
    try {
      const { photos } = await readManifest();
      storage = { reachable: true, note: `正常（登録 ${photos.length} 件）` };
    } catch (err) {
      /* 接続先ホストにはアカウントIDが含まれるため、種別だけを伝える */
      const raw = String(err.message || '');
      storage = {
        reachable: false,
        note: raw.includes('接続に失敗')
          ? 'R2 に接続できません。R2_ACCOUNT_ID を確認してください'
          : raw.includes('形式が正しくありません')
            ? 'R2_ACCOUNT_ID の形式が正しくありません（32桁の英数字）'
            : raw.includes('R2 応答')
              ? 'R2 に拒否されました。アクセスキーの値と権限を確認してください'
              : '不明なエラーが発生しました',
      };
    }
  }

  const ok = missing.length === 0 && storage.reachable;

  /* 診断結果はキャッシュさせない（古い状態を見て誤判断しないように） */
  res.setHeader('Cache-Control', 'no-store');

  return res.status(ok ? 200 : 503).json({
    ok,
    summary: ok
      ? 'すべて正常です'
      : missing.length > 0
        ? `設定が不足しています: ${missing.join(' / ')}`
        : `保管庫に接続できません: ${storage.note}`,
    settings,
    storage,
    checkedAt: new Date().toISOString(),
  });
}
