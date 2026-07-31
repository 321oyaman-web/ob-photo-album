/* ========================================
   OB会 思い出アルバム - 合言葉による簡易認証
   ・閲覧用の合言葉（ALBUM_PASSWORD）… 写真を見る／ダウンロードする
   ・管理用の合言葉（ADMIN_PASSWORD）… 写真をアップロードする／削除する
   合言葉は環境変数でのみ管理し、コードには一切書かない
======================================== */

import crypto from 'node:crypto';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 有効期間: 7日間

/* ----------------------------------------
   タイミング攻撃に強い文字列比較
---------------------------------------- */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  /* 長さが違うと timingSafeEqual が例外を投げるため、先にハッシュ化して長さを揃える */
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET が設定されていません');
  }
  return secret;
}

/* ----------------------------------------
   合言葉から権限を判定する
   戻り値: 'admin' | 'viewer' | null
---------------------------------------- */
export function resolveRole(password) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const albumPassword = process.env.ALBUM_PASSWORD;

  if (adminPassword && safeEqual(password, adminPassword)) return 'admin';
  if (albumPassword && safeEqual(password, albumPassword)) return 'viewer';
  return null;
}

/* ----------------------------------------
   HMAC 署名付きトークンの発行と検証
   形式: <role>.<有効期限>.<署名>
---------------------------------------- */
export function issueToken(role) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${role}.${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [role, expiresAt, signature] = parts;
  if (role !== 'admin' && role !== 'viewer') return null;
  if (!Number(expiresAt) || Number(expiresAt) < Date.now()) return null;

  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`${role}.${expiresAt}`)
    .digest('hex');

  return safeEqual(signature, expected) ? role : null;
}

/* ----------------------------------------
   API ハンドラー用のガード
   権限が足りなければレスポンスを返して null を戻す
---------------------------------------- */
export function requireRole(req, res, needAdmin = false) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const role = verifyToken(token);

  if (!role) {
    res.status(401).json({ error: '合言葉を入力してください' });
    return null;
  }
  if (needAdmin && role !== 'admin') {
    res.status(403).json({ error: 'この操作には管理用の合言葉が必要です' });
    return null;
  }
  return role;
}

/* ----------------------------------------
   リクエストボディを JSON として取り出す
   Vercel が自動パースする場合と文字列で渡る場合の両方に対応
---------------------------------------- */
export function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}
