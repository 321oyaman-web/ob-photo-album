/* ========================================
   POST /api/upload-url
   ブラウザが R2 へ直接アップロードするための署名付き URL を発行する。
   画像そのものは Vercel を経由しないため、サイズ上限や実行時間を気にせず済む。
======================================== */

import crypto from 'node:crypto';
import { requireRole, readJsonBody } from './_auth.js';
import { presignUrl } from './_r2.js';
import { normalizeType, keysFor } from './_items.js';

const UPLOAD_TTL_SECONDS = 15 * 60; // アップロード用 URL の有効期間: 15分

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST のみ受け付けます' });
  }
  if (!requireRole(req, res, true)) return;

  try {
    const body = readJsonBody(req);
    if (!body.filename) {
      return res.status(400).json({ error: 'ファイル名が指定されていません' });
    }

    const type = normalizeType(body.type);
    const id = crypto.randomUUID();
    const { key, thumbKey } = keysFor(type, id);

    return res.status(200).json({
      id,
      type,
      key,
      thumbKey,
      uploadUrl: presignUrl('PUT', key, UPLOAD_TTL_SECONDS),
      /* PDF はサムネイルを作らないため、送信先も発行しない */
      thumbUploadUrl: thumbKey ? presignUrl('PUT', thumbKey, UPLOAD_TTL_SECONDS) : null,
    });
  } catch (err) {
    console.error('[upload-url]', err);
    return res.status(500).json({ error: err.message || 'アップロードの準備に失敗しました' });
  }
}
