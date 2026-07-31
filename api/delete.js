/* ========================================
   POST /api/delete
   写真の実体（原寸・サムネイル）と一覧の登録を削除する
======================================== */

import { requireRole, readJsonBody } from './_auth.js';
import { readManifest, writeManifest, deleteObject } from './_r2.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST のみ受け付けます' });
  }
  if (!requireRole(req, res, true)) return;

  try {
    const { id } = readJsonBody(req);
    if (!id) {
      return res.status(400).json({ error: '削除する写真が指定されていません' });
    }

    const manifest = await readManifest();
    const photo = manifest.photos.find((p) => p.id === id);
    if (!photo) {
      return res.status(404).json({ error: '指定された写真が見つかりません' });
    }

    /* 実体を先に消し、その後で一覧から外す（順序が逆だと孤立ファイルが残る） */
    await deleteObject(photo.key);
    await deleteObject(photo.thumbKey);

    manifest.photos = manifest.photos.filter((p) => p.id !== id);
    await writeManifest(manifest);

    return res.status(200).json({ ok: true, total: manifest.photos.length });
  } catch (err) {
    console.error('[delete]', err);
    return res.status(500).json({ error: err.message || '写真の削除に失敗しました' });
  }
}
