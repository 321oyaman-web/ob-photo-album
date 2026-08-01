/* ========================================
   POST /api/login
   合言葉を検証し、以降の API 呼び出しに使うトークンを発行する
======================================== */

import { resolveRole, issueToken, readJsonBody, getConfiguredRoles } from './_auth.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST のみ受け付けます' });
  }

  try {
    const { password } = readJsonBody(req);

    /* 空白のみの入力は「未入力」として扱う */
    if (!String(password ?? '').trim()) {
      return res.status(400).json({ error: '合言葉を入力してください' });
    }

    const role = resolveRole(password);
    if (!role) {
      /* 「合言葉が違う」のか「サーバー側に登録されていない」のかを区別して案内する。
         設定漏れのときは何を入力しても通らないため、原因が分からず詰まりやすい。
         有無だけを伝え、値そのものは一切返さない */
      const configured = getConfiguredRoles();

      if (!configured.admin && !configured.viewer) {
        return res.status(500).json({
          error: '合言葉がサーバー側に設定されていません（ALBUM_PASSWORD / ADMIN_PASSWORD）。Vercel の環境変数を確認してください。',
        });
      }
      if (!configured.admin) {
        return res.status(401).json({
          error: '合言葉が違います。なお、管理用の合言葉（ADMIN_PASSWORD）はサーバー側に未設定です。',
        });
      }
      return res.status(401).json({ error: '合言葉が違います' });
    }

    return res.status(200).json({ token: issueToken(role), role });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'サーバー側でエラーが発生しました' });
  }
}
