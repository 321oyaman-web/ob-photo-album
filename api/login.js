/* ========================================
   POST /api/login
   合言葉を検証し、以降の API 呼び出しに使うトークンを発行する
======================================== */

import { resolveRole, issueToken, readJsonBody } from './_auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST のみ受け付けます' });
  }

  try {
    const { password } = readJsonBody(req);

    if (!password) {
      return res.status(400).json({ error: '合言葉を入力してください' });
    }

    const role = resolveRole(password);
    if (!role) {
      return res.status(401).json({ error: '合言葉が違います' });
    }

    return res.status(200).json({ token: issueToken(role), role });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'サーバー側でエラーが発生しました' });
  }
}
