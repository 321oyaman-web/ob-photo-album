/* ========================================
   OB会 思い出アルバム - Cloudflare R2 アクセス層
   AWS SigV4 署名を Node 標準の crypto だけで実装（外部パッケージ不要）
   R2 は S3 互換 API のため、region は固定で "auto" を使う
======================================== */

import crypto from 'node:crypto';

const REGION = 'auto';
const SERVICE = 's3';

/* 写真のメタデータ一覧を保存するオブジェクトのキー（簡易データベースの代わり） */
export const MANIFEST_KEY = 'index/manifest.json';

/* ----------------------------------------
   環境変数の読み込み
   実キーはコードに書かず、Vercel の Environment Variables から取得する
---------------------------------------- */
function getConfig() {
  /* コピペ時に混入しがちな前後の空白・改行を取り除く */
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET || '').trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    const missing = [
      !accountId && 'R2_ACCOUNT_ID',
      !accessKeyId && 'R2_ACCESS_KEY_ID',
      !secretAccessKey && 'R2_SECRET_ACCESS_KEY',
      !bucket && 'R2_BUCKET',
    ].filter(Boolean).join(' / ');
    throw new Error(`R2 の環境変数が設定されていません: ${missing}`);
  }

  /* アカウントIDはホスト名の一部になるため、形式が違うと接続自体ができない。
     管理画面では末尾が「…」で省略表示されるため、途中までしか登録されていない事故が起きやすい */
  if (accountId.length !== 32 || !/^[a-z0-9]+$/i.test(accountId)) {
    throw new Error(
      `R2_ACCOUNT_ID の形式が正しくありません（32桁の英数字が必要ですが、現在 ${accountId.length} 文字です）。` +
      'Cloudflare の R2 → Overview → Account Details にあるコピーボタンで、省略されていない全体をコピーしてください。'
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/* ----------------------------------------
   署名まわりの小道具
---------------------------------------- */
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/* AWS の日付書式を作る（例: 20260731T091500Z / 20260731） */
function buildDate(date = new Date()) {
  const amz = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz, stamp: amz.slice(0, 8) };
}

/* 日付・リージョン・サービスを順に混ぜて署名鍵を導出する */
function deriveSigningKey(secretAccessKey, stamp) {
  const kDate = hmac(`AWS4${secretAccessKey}`, stamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

/* RFC 3986 準拠のエンコード。
   encodeURIComponent は ! ' ( ) * を変換しないが、AWS の署名では変換が必要。
   ここを揃えないとファイル名に「(1)」等が含まれる場合に署名が一致しなくなる */
function rfc3986Encode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/* S3 の正規化 URI 用エンコード（スラッシュは区切りとして残す） */
function encodeKey(key) {
  return key.split('/').map(rfc3986Encode).join('/');
}

/* ----------------------------------------
   署名付き URL の発行
   ブラウザから R2 へ直接アップロード／ダウンロードさせるために使う。
   これにより Vercel Functions のリクエストサイズ上限（4.5MB）を回避でき、
   かつ R2 のシークレットをブラウザに渡さずに済む。
---------------------------------------- */
export function presignUrl(method, key, expiresIn = 3600, extraQuery = {}) {
  const cfg = getConfig();
  const { amz, stamp } = buildDate();
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${cfg.bucket}/${encodeKey(key)}`;

  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${stamp}/${REGION}/${SERVICE}/aws4_request`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
    ...extraQuery,
  };

  /* クエリはキー名の辞書順に並べる決まり */
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986Encode(k)}=${rfc3986Encode(query[k])}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    `${stamp}/${REGION}/${SERVICE}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmac(
    deriveSigningKey(cfg.secretAccessKey, stamp),
    stringToSign
  ).toString('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/* ----------------------------------------
   サーバー側から R2 を直接呼ぶ（マニフェストの読み書き・削除に使用）
---------------------------------------- */
export async function r2Fetch(method, key, { body = null, contentType } = {}) {
  const cfg = getConfig();
  const { amz, stamp } = buildDate();
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${cfg.bucket}/${encodeKey(key)}`;
  const payload = body ?? '';
  const payloadHash = sha256Hex(payload);

  /* 署名対象ヘッダー（host は fetch が自動付与するので送信時は除外する） */
  const signedHeaderMap = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
  };
  if (contentType) signedHeaderMap['content-type'] = contentType;

  const sortedNames = Object.keys(signedHeaderMap).sort();
  const signedHeaders = sortedNames.join(';');
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(signedHeaderMap[name]).trim()}\n`)
    .join('');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    `${stamp}/${REGION}/${SERVICE}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmac(
    deriveSigningKey(cfg.secretAccessKey, stamp),
    stringToSign
  ).toString('hex');

  const sendHeaders = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${stamp}/${REGION}/${SERVICE}/aws4_request, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) sendHeaders['content-type'] = contentType;

  try {
    return await fetch(`https://${host}${canonicalUri}`, {
      method,
      headers: sendHeaders,
      body: body ?? undefined,
    });
  } catch (err) {
    /* ここに来るのは接続自体が成立しなかった場合（多くは接続先ホスト名の誤り）。
       認証情報の誤りなら R2 から 401/403 が返るので、この分岐には入らない */
    throw new Error(
      `R2 への接続に失敗しました（接続先: ${host}）。R2_ACCOUNT_ID が正しいか確認してください。詳細: ${err.message}`
    );
  }
}

/* ----------------------------------------
   マニフェスト（写真メタデータ一覧）の読み書き
   専用データベースを使わず R2 の JSON 1 ファイルで管理し、完全無料に収める
---------------------------------------- */
export async function readManifest() {
  const res = await r2Fetch('GET', MANIFEST_KEY);

  /* 初回起動時はまだファイルが無いので空の一覧を返す */
  if (res.status === 404) return { photos: [] };
  if (!res.ok) {
    throw new Error(`写真一覧の読み込みに失敗しました（R2 応答: ${res.status}）`);
  }

  const data = await res.json();
  return { photos: Array.isArray(data.photos) ? data.photos : [] };
}

export async function writeManifest(manifest) {
  const res = await r2Fetch('PUT', MANIFEST_KEY, {
    body: JSON.stringify(manifest),
    contentType: 'application/json',
  });
  if (!res.ok) {
    throw new Error(`写真一覧の保存に失敗しました（R2 応答: ${res.status}）`);
  }
}

export async function deleteObject(key) {
  const res = await r2Fetch('DELETE', key);
  /* 既に無い場合（404）も成功扱いにする */
  if (!res.ok && res.status !== 404) {
    throw new Error(`ファイルの削除に失敗しました（R2 応答: ${res.status}）`);
  }
}
