/* ========================================
   GET /api/photos           … 写真一覧＋サムネイルの署名付き URL を返す
   GET /api/photos?id=xxxxx  … 指定した写真の原寸画像の署名付き URL を返す

   バケットは非公開のまま運用し、都度発行する期限付き URL でのみ配信する。
   （URL が外部に漏れても一定時間で無効になる）
======================================== */

import { requireRole } from './_auth.js';
import { readManifest, presignUrl } from './_r2.js';

const URL_TTL_SECONDS = 2 * 60 * 60; // 署名付き URL の有効期間: 2時間

/* ダウンロード時のファイル名指定を組み立てる。
   HTTP ヘッダーには非 ASCII をそのまま書けないため、RFC 5987 形式で日本語名を渡し、
   古いブラウザ向けに ASCII のみの簡易名も併記する */
function buildContentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET のみ受け付けます' });
  }
  if (!requireRole(req, res)) return;

  try {
    const { photos } = await readManifest();
    const { id, download } = req.query;

    /* 個別指定: 原寸画像の URL を返す（ライトボックス表示・ダウンロード用） */
    if (id) {
      const photo = photos.find((p) => p.id === id);
      if (!photo) {
        return res.status(404).json({ error: '指定された写真が見つかりません' });
      }

      /* download=1 のときはブラウザに保存ダイアログを出させる */
      const extraQuery = download
        ? {
            'response-content-disposition': buildContentDisposition(
              photo.filename || `${photo.id}.jpg`
            ),
          }
        : {};

      return res.status(200).json({
        url: presignUrl('GET', photo.key, URL_TTL_SECONDS, extraQuery),
      });
    }

    /* 一覧: 1日のイベントなので、当日の流れを追えるよう撮影時刻の古い順に並べる。
       撮影時刻が不明なものは、登録した順で末尾にまとめる */
    const sorted = [...photos].sort((a, b) => {
      const byTaken = (a.takenAt || '￿').localeCompare(b.takenAt || '￿');
      return byTaken !== 0 ? byTaken : (a.uploadedAt || '').localeCompare(b.uploadedAt || '');
    });

    const items = sorted.map((p) => ({
      id: p.id,
      filename: p.filename,
      /* シーン導入前に登録された写真は値を持たないため「その他」に寄せる */
      scene: p.scene || 'その他',
      tags: p.tags || [],
      caption: p.caption || '',
      takenAt: p.takenAt || '',
      uploadedAt: p.uploadedAt,
      updatedAt: p.updatedAt || '',
      width: p.width,
      height: p.height,
      size: p.size,
      thumbUrl: presignUrl('GET', p.thumbKey, URL_TTL_SECONDS),
    }));

    return res.status(200).json({ photos: items, total: items.length });
  } catch (err) {
    console.error('[photos]', err);
    return res.status(500).json({ error: err.message || '写真一覧の取得に失敗しました' });
  }
}
