/* ========================================
   /api/videos
     GET    … 登録された動画リンクの一覧
     POST   … 動画リンクを追加（幹事のみ）
     DELETE … 動画リンクを削除（幹事のみ）

   動画そのものは R2 に置かず、YouTube の「限定公開」に置いてリンクだけを預かる。
   動画は圧縮できず容量が大きいため、10GB の無料枠を写真のために残す判断。
======================================== */

import crypto from 'node:crypto';
import { requireRole, readJsonBody } from './_auth.js';
import { readManifest, writeManifest } from './_r2.js';
import { trimText } from './_scenes.js';

/* YouTube の動画IDは11文字の英数字・ハイフン・アンダースコア */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/* さまざまな形式の YouTube URL から動画IDを取り出す。
   YouTube 以外の URL は受け付けない（サムネイル取得と再生の保証ができないため） */
export function extractYouTubeId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  /* URL ではなく動画IDが直接貼られた場合 */
  if (VIDEO_ID.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  /* https://youtu.be/ID */
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID.test(id) ? id : null;
  }

  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtube-nocookie.com') {
    return null;
  }

  /* https://www.youtube.com/watch?v=ID */
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  /* https://www.youtube.com/embed/ID , /live/ID , /shorts/ID */
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['embed', 'live', 'shorts', 'v'].includes(parts[0])) {
    return VIDEO_ID.test(parts[1]) ? parts[1] : null;
  }

  return null;
}

function toItem(video) {
  return {
    id: video.id,
    videoId: video.videoId,
    title: video.title,
    note: video.note || '',
    /* 再生ページと、一覧に出すサムネイル画像 */
    watchUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
    thumbUrl: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
    addedAt: video.addedAt,
  };
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();

  /* 一覧は閲覧者も見られる。追加と削除は幹事のみ */
  const needAdmin = method !== 'GET';
  if (!requireRole(req, res, needAdmin)) return;

  try {
    const manifest = await readManifest();

    if (method === 'GET') {
      /* 追加した順に並べる */
      const items = [...manifest.videos]
        .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''))
        .map(toItem);
      return res.status(200).json({ videos: items, total: items.length });
    }

    if (method === 'POST') {
      const body = readJsonBody(req);
      const videoId = extractYouTubeId(body.url);

      if (!videoId) {
        return res.status(400).json({
          error: 'YouTube の動画URLを入力してください（例: https://youtu.be/xxxxxxxxxxx）',
        });
      }
      if (manifest.videos.some((v) => v.videoId === videoId)) {
        return res.status(409).json({ error: 'この動画は既に登録されています' });
      }

      const video = {
        id: crypto.randomUUID(),
        videoId,
        title: trimText(body.title, 100) || '無題の動画',
        note: trimText(body.note, 200),
        addedAt: new Date().toISOString(),
      };

      manifest.videos.push(video);
      await writeManifest(manifest);

      return res.status(200).json({ ok: true, video: toItem(video), total: manifest.videos.length });
    }

    if (method === 'DELETE') {
      const body = readJsonBody(req);
      const id = body.id || req.query?.id;

      if (!id) {
        return res.status(400).json({ error: '削除する動画が指定されていません' });
      }
      if (!manifest.videos.some((v) => v.id === id)) {
        return res.status(404).json({ error: '指定された動画が見つかりません' });
      }

      manifest.videos = manifest.videos.filter((v) => v.id !== id);
      await writeManifest(manifest);

      return res.status(200).json({ ok: true, total: manifest.videos.length });
    }

    return res.status(405).json({ error: 'GET / POST / DELETE のみ受け付けます' });
  } catch (err) {
    console.error('[videos]', err);
    return res.status(500).json({ error: err.message || '動画リンクの処理に失敗しました' });
  }
}
