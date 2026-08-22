/* ========================================
   POST /api/update
   登録済みの写真の情報（シーン・説明・タグ）を修正する。

   アップロード時に付け間違えても後から直せるようにするためのもの。
   写真そのもの（R2 上の画像）には触れない。
======================================== */

import { requireRole, readJsonBody } from './_auth.js';
import { readManifest, writeManifest } from './_r2.js';
import { normalizeScene, trimText, parseTags } from './_scenes.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST のみ受け付けます' });
  }
  if (!requireRole(req, res, true)) return;

  try {
    const body = readJsonBody(req);
    const { id } = body;

    if (!id) {
      return res.status(400).json({ error: '修正する写真が指定されていません' });
    }

    const manifest = await readManifest();
    const photo = manifest.photos.find((p) => p.id === id);
    if (!photo) {
      return res.status(404).json({ error: '指定された写真が見つかりません' });
    }

    /* 送られてきた項目だけを書き換える。
       保存先やファイル名、撮影時刻などは変更させない */
    if ('scene' in body) photo.scene = normalizeScene(body.scene);
    if ('caption' in body) photo.caption = trimText(body.caption, 300);
    if ('tags' in body) photo.tags = parseTags(body.tags);

    photo.updatedAt = new Date().toISOString();

    await writeManifest(manifest);

    return res.status(200).json({ ok: true, photo });
  } catch (err) {
    console.error('[update]', err);
    return res.status(500).json({ error: err.message || '写真情報の更新に失敗しました' });
  }
}
