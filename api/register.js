/* ========================================
   POST /api/register
   R2 へのアップロード完了後に呼び出し、写真のメタデータを一覧に追加する
======================================== */

import { requireRole, readJsonBody } from './_auth.js';
import { readManifest, writeManifest } from './_r2.js';

/* 入力文字列の長さを制限し、想定外の巨大データが混入するのを防ぐ */
function trimText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST のみ受け付けます' });
  }
  if (!requireRole(req, res, true)) return;

  try {
    const body = readJsonBody(req);
    const { id, key, thumbKey } = body;

    if (!id || !key || !thumbKey) {
      return res.status(400).json({ error: '写真の情報が不足しています' });
    }
    /* 発行済みのキー形式と一致するか確認し、任意のパスへの書き込みを防ぐ */
    if (key !== `photos/${id}/full.jpg` || thumbKey !== `photos/${id}/thumb.jpg`) {
      return res.status(400).json({ error: '写真の保存先が不正です' });
    }

    const manifest = await readManifest();
    if (manifest.photos.some((p) => p.id === id)) {
      return res.status(409).json({ error: 'この写真は既に登録されています' });
    }

    /* タグはカンマ・読点・空白いずれの区切りでも受け取れるようにする */
    const rawTags = Array.isArray(body.tags) ? body.tags.join(',') : String(body.tags ?? '');
    const tags = rawTags
      .split(/[,、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);

    const year = Number(body.year);

    const photo = {
      id,
      key,
      thumbKey,
      filename: trimText(body.filename, 120) || `${id}.jpg`,
      year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
      event: trimText(body.event, 60),
      caption: trimText(body.caption, 300),
      tags,
      takenAt: trimText(body.takenAt, 30),
      width: Number(body.width) || null,
      height: Number(body.height) || null,
      size: Number(body.size) || null,
      uploadedAt: new Date().toISOString(),
    };

    manifest.photos.push(photo);
    await writeManifest(manifest);

    return res.status(200).json({ ok: true, photo, total: manifest.photos.length });
  } catch (err) {
    console.error('[register]', err);
    return res.status(500).json({ error: err.message || '写真の登録に失敗しました' });
  }
}
