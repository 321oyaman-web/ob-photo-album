/* 検証専用のモック（Git・デプロイ対象外）。実際の分類構成でデータを用意する */
(function () {
  const thumb = (hue, label) =>
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="hsl(${hue},45%,60%)"/><text x="200" y="210" font-size="26" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`
    );

  /* [大分類, 年, イベント, タグ, 説明] */
  const defs = [
    ['学生時代', 2019, 'ドラマ', '公演,舞台', '第30回公演'],
    ['学生時代', 2019, 'ドラマ', '公演', '本番前の舞台裏'],
    ['学生時代', 2019, 'ディベート', '大会', '全国大会にて'],
    ['学生時代', 2018, 'ディスカッション', '例会', '週例のディスカッション'],
    ['学生時代', 2018, 'サマーキャンプ', '合宿,海', '海辺での集合写真'],
    ['学生時代', 2018, 'サマーキャンプ', '合宿', '夜のレクリエーション'],
    ['学生時代', 2017, '花見', '桜', '構内の桜の下で'],
    ['学生時代', 2017, '入学', '式典', '入学式の日'],
    ['学生時代', 2021, '卒業', '式典', '卒業式にて'],
    ['OB/OG会', 2026, 'OB/OG会', '総会', '今年の集合写真'],
    ['OB/OG会', 2026, 'OB/OG会', '懇親会', '乾杯の様子'],
    ['OB/OG会', 2023, 'OB/OG会', '総会', '3年ぶりの再会'],
    ['OB/OG会', 2020, 'OB/OG会', '総会', 'オンライン開催'],
    ['OB/OG会', 2017, 'OB/OG会', '総会', '創立記念'],
    ['OB/OG会', 2014, 'OB/OG会', '総会', '当時の様子'],
    ['その他', 2022, '', '資料', '会報の表紙'],
  ];

  const photos = defs.map((d, i) => ({
    id: 'p' + i,
    filename: `IMG_${1000 + i}.jpg`,
    category: d[0], year: d[1], event: d[2],
    tags: d[3].split(',').filter(Boolean), caption: d[4],
    takenAt: `${d[1]}-06-01T10:00:00.000Z`, uploadedAt: `${d[1]}-06-02T10:00:00.000Z`,
    width: 2048, height: 1536, size: 620000,
    thumbUrl: thumb((i * 41) % 360, `${d[1]} ${d[2] || d[0]}`),
  }));

  window.__photos = photos;
  window.__uploads = [];
  window.__registered = [];

  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

    if (u.startsWith('https://mock-r2/')) {
      if (method === 'PUT') window.__uploads.push({ url: u, size: opts.body.size, blob: opts.body });
      return json(200, {});
    }
    if (u.startsWith('https://blocked-r2/')) {
      throw new TypeError('Failed to fetch');   // CORS 未設定を再現
    }
    if (u.includes('/api/login')) {
      const pw = JSON.parse(opts.body).password;
      if (pw === 'admin-pw') return json(200, { token: 'tok', role: 'admin' });
      if (pw === 'view-pw') return json(200, { token: 'tok', role: 'viewer' });
      return json(401, { error: '合言葉が違います' });
    }
    if (u.includes('/api/upload-url')) {
      const host = window.__simulateCorsFailure ? 'blocked-r2' : 'mock-r2';
      const id = 'new-' + (window.__registered.length + 1);
      return json(200, {
        id, key: `photos/${id}/full.jpg`, thumbKey: `photos/${id}/thumb.jpg`,
        uploadUrl: `https://${host}/${id}/full`, thumbUploadUrl: `https://${host}/${id}/thumb`,
      });
    }
    if (u.includes('/api/register')) {
      const b = JSON.parse(opts.body);
      window.__registered.push(b);
      photos.push({ ...b, tags: String(b.tags || '').split(/[,、\s]+/).filter(Boolean),
                    thumbUrl: thumb(200, '新規') });
      return json(200, { ok: true, photo: b, total: photos.length });
    }
    if (u.includes('/api/photos')) {
      if (/[?&]id=/.test(u)) return json(200, { url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' });
      return json(200, { photos: [...photos], total: photos.length });
    }
    return json(200, { ok: true });
  };
})();
