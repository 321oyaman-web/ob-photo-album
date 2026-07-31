/* ========================================
   POST /api/upload-url
   ブラウザが R2 へ直接アップロードするための署名付き URL を発行する。
   画像そのものは Vercel を経由しないため、サイズ上限や実行時間を気にせず済む。
======================================== */

import crypto from 'node:crypto';
import { requireRole, readJsonBody } from './_auth.js';
import { presignUrl } from './_r2.js';

const UPLOAD_TTL_SECONDS = 15 * 60; // アップロード用 URL の有効期間: 15分

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST のみ受け付けます' });
  }
  if (!requireRole(req, res, true)) return;

  try {
    const { filename } = readJsonBody(req);
    if (!filename) {
      return res.status(400).json({ error: 'ファイル名が指定されていません' });
    }

    /* 元のファイル名は表示用にのみ使い、保存先キーには UUID を使って衝突と文字化けを防ぐ */
    const id = crypto.randomUUID();
    const key = `photos/${id}/full.jpg`;
    const thumbKey = `photos/${id}/thumb.jpg`;

    return res.status(200).json({
      id,
      key,
      thumbKey,
      uploadUrl: presignUrl('PUT', key, UPLOAD_TTL_SECONDS),
      thumbUploadUrl: presignUrl('PUT', thumbKey, UPLOAD_TTL_SECONDS),
    });
  } catch (err) {
    console.error('[upload-url]', err);
    return res.status(500).json({ error: err.message || 'アップロードの準備に失敗しました' });
  }
}
