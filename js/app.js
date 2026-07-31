/* ========================================
   OB会 思い出アルバム - メインスクリプト
   ログイン／一覧表示／絞り込み／拡大表示／アップロード／削除を担当する
   チャットボットからは末尾の window.Album 経由で操作する
======================================== */

(function () {
  'use strict';

  /* ----------------------------------------
     アプリの状態
  ---------------------------------------- */
  const state = {
    token: '',
    role: '',
    photos: [],                                  // サーバーから取得した全写真
    visible: [],                                 // 絞り込み後に表示している写真
    filter: { year: null, event: null, query: '' },
    lightboxIndex: -1,
    pickedFiles: [],
  };

  const STORAGE_KEY = 'ob-album-token';

  /* 縮小設定：長辺2048pxなら鑑賞・印刷に十分で、容量は元の1/5〜1/10に収まる */
  const FULL_MAX_EDGE = 2048;
  const FULL_QUALITY = 0.85;
  const THUMB_MAX_EDGE = 480;
  const THUMB_QUALITY = 0.72;

  const $ = (id) => document.getElementById(id);

  const el = {
    loginScreen: $('login-screen'),
    loginForm: $('login-form'),
    loginBtn: $('login-btn'),
    password: $('password'),
    loginError: $('login-error'),
    app: $('app'),
    headerCount: $('header-count'),
    logoutBtn: $('logout-btn'),
    uploadOpenBtn: $('upload-open-btn'),
    searchInput: $('search-input'),
    filterChips: $('filter-chips'),
    statusBar: $('status-bar'),
    gallery: $('gallery'),
    emptyState: $('empty-state'),
    emptyText: $('empty-text'),
    uploadModal: $('upload-modal'),
    dropZone: $('drop-zone'),
    fileInput: $('file-input'),
    pickedInfo: $('picked-info'),
    metaYear: $('meta-year'),
    metaEvent: $('meta-event'),
    metaTags: $('meta-tags'),
    metaCaption: $('meta-caption'),
    uploadStartBtn: $('upload-start-btn'),
    uploadProgress: $('upload-progress'),
    progressFill: $('progress-fill'),
    progressText: $('progress-text'),
    lightbox: $('lightbox'),
    lbImg: $('lb-img'),
    lbMeta: $('lb-meta'),
    lbClose: $('lb-close'),
    lbPrev: $('lb-prev'),
    lbNext: $('lb-next'),
    lbDownload: $('lb-download'),
    lbDelete: $('lb-delete'),
    toast: $('toast'),
  };

  /* ----------------------------------------
     共通ユーティリティ
  ---------------------------------------- */
  let toastTimer = null;

  function toast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle('toast--error', isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  /* API 呼び出し。トークンを自動で付け、期限切れならログイン画面に戻す */
  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      signOut();
      throw new Error('合言葉の有効期限が切れました。もう一度入力してください。');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '通信に失敗しました');
    return data;
  }

  /* ----------------------------------------
     ログイン / ログアウト
  ---------------------------------------- */
  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.loginError.hidden = true;
    el.loginBtn.disabled = true;
    el.loginBtn.textContent = '確認中…';

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: el.password.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ログインに失敗しました');

      state.token = data.token;
      state.role = data.role;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: data.token, role: data.role }));
      await enterAlbum();
    } catch (err) {
      el.loginError.textContent = err.message;
      el.loginError.hidden = false;
    } finally {
      el.loginBtn.disabled = false;
      el.loginBtn.textContent = 'アルバムを開く';
    }
  });

  function signOut() {
    sessionStorage.removeItem(STORAGE_KEY);
    state.token = '';
    state.role = '';
    state.photos = [];
    el.app.hidden = true;
    el.loginScreen.hidden = false;
    el.password.value = '';
  }

  el.logoutBtn.addEventListener('click', signOut);

  /* アルバム画面へ入る（ログイン直後・再訪問時の共通処理） */
  async function enterAlbum() {
    el.loginScreen.hidden = true;
    el.app.hidden = false;
    el.uploadOpenBtn.hidden = state.role !== 'admin';
    await loadPhotos();
    document.dispatchEvent(new CustomEvent('album:ready'));
  }

  /* ----------------------------------------
     写真の読み込みと描画
  ---------------------------------------- */
  async function loadPhotos() {
    el.statusBar.textContent = '写真を読み込んでいます…';
    el.statusBar.hidden = false;

    try {
      const data = await api('/api/photos');
      state.photos = data.photos;
      el.statusBar.hidden = true;
      updateHeaderCount();
      renderChips();
      applyFilter();
      document.dispatchEvent(new CustomEvent('album:updated'));
    } catch (err) {
      el.statusBar.textContent = `読み込みエラー: ${err.message}`;
      toast(err.message, true);
    }
  }

  function updateHeaderCount() {
    const total = state.photos.length;
    const roleLabel = state.role === 'admin' ? '管理モード' : '閲覧モード';
    el.headerCount.textContent = `全 ${total} 枚 ・ ${roleLabel}`;
  }

  /* 年とイベントの選択肢を写真データから自動生成する */
  function getFacets() {
    const years = [...new Set(state.photos.map((p) => p.year).filter(Boolean))].sort((a, b) => b - a);
    const events = [...new Set(state.photos.map((p) => p.event).filter(Boolean))].sort();
    return { years, events };
  }

  function renderChips() {
    const { years, events } = getFacets();
    el.filterChips.innerHTML = '';

    const addChip = (label, isActive, onClick) => {
      const btn = document.createElement('button');
      btn.className = `chip${isActive ? ' is-active' : ''}`;
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      el.filterChips.appendChild(btn);
    };

    const noFilter = !state.filter.year && !state.filter.event;
    addChip('すべて', noFilter, () => {
      state.filter.year = null;
      state.filter.event = null;
      renderChips();
      applyFilter();
    });

    years.forEach((year) => {
      addChip(`${year}年`, state.filter.year === year, () => {
        state.filter.year = state.filter.year === year ? null : year;
        renderChips();
        applyFilter();
      });
    });

    events.forEach((event) => {
      addChip(event, state.filter.event === event, () => {
        state.filter.event = state.filter.event === event ? null : event;
        renderChips();
        applyFilter();
      });
    });
  }

  /* 写真1件が検索語に一致するか判定する（イベント・タグ・説明・年をまとめて対象にする） */
  function matchesQuery(photo, query) {
    if (!query) return true;
    const haystack = [
      photo.event,
      photo.caption,
      photo.filename,
      (photo.tags || []).join(' '),
      photo.year ? `${photo.year}年 ${photo.year}` : '',
    ].join(' ').toLowerCase();

    /* 空白区切りの語をすべて含むものを一致とみなす（AND 検索） */
    return query
      .toLowerCase()
      .split(/[\s　]+/)
      .filter(Boolean)
      .every((word) => haystack.includes(word));
  }

  function applyFilter() {
    const { year, event, query } = state.filter;

    state.visible = state.photos.filter((p) => {
      if (year && p.year !== year) return false;
      if (event && p.event !== event) return false;
      return matchesQuery(p, query);
    });

    renderGallery();
    return state.visible;
  }

  function renderGallery() {
    el.gallery.innerHTML = '';

    if (state.visible.length === 0) {
      el.emptyState.hidden = false;
      el.emptyText.textContent = state.photos.length === 0
        ? 'まだ写真が登録されていません。「写真を追加」から最初の1枚をアップロードしてみてください。'
        : '条件を変えてもう一度お試しください。';
      return;
    }
    el.emptyState.hidden = true;

    /* 大量の写真でも描画が重くならないよう、まとめて1回だけ差し込む */
    const fragment = document.createDocumentFragment();

    state.visible.forEach((photo, index) => {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.setAttribute('aria-label', buildLabel(photo) || '写真を拡大表示');

      const img = document.createElement('img');
      img.className = 'card__img';
      img.src = photo.thumbUrl;
      img.alt = buildLabel(photo) || '思い出の写真';
      img.loading = 'lazy';
      img.decoding = 'async';
      card.appendChild(img);

      const label = buildLabel(photo);
      if (label) {
        const overlay = document.createElement('div');
        overlay.className = 'card__overlay';
        const text = document.createElement('p');
        text.className = 'card__label';
        text.textContent = label;
        overlay.appendChild(text);
        card.appendChild(overlay);
      }

      card.addEventListener('click', () => openLightbox(index));
      fragment.appendChild(card);
    });

    el.gallery.appendChild(fragment);
  }

  /* カードやライトボックスに出す説明文を組み立てる */
  function buildLabel(photo) {
    const parts = [];
    if (photo.year) parts.push(`${photo.year}年`);
    if (photo.event) parts.push(photo.event);
    if (photo.caption) parts.push(photo.caption);
    return parts.join(' ・ ');
  }

  /* ----------------------------------------
     ライトボックス（拡大表示）
  ---------------------------------------- */
  async function openLightbox(index) {
    if (index < 0 || index >= state.visible.length) return;

    state.lightboxIndex = index;
    const photo = state.visible[index];

    el.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    el.lbImg.src = '';
    el.lbImg.alt = buildLabel(photo) || '思い出の写真';
    el.lbMeta.textContent = `${buildLabel(photo) || photo.filename}（${index + 1} / ${state.visible.length}）`;
    el.lbDelete.hidden = state.role !== 'admin';

    try {
      /* 原寸画像の URL は表示するタイミングで都度発行する */
      const data = await api(`/api/photos?id=${encodeURIComponent(photo.id)}`);
      if (state.lightboxIndex === index) el.lbImg.src = data.url;
    } catch (err) {
      toast(err.message, true);
    }
  }

  function closeLightbox() {
    el.lightbox.hidden = true;
    el.lbImg.src = '';
    state.lightboxIndex = -1;
    document.body.style.overflow = '';
  }

  function stepLightbox(delta) {
    const next = state.lightboxIndex + delta;
    if (next >= 0 && next < state.visible.length) openLightbox(next);
  }

  el.lbClose.addEventListener('click', closeLightbox);
  el.lbPrev.addEventListener('click', () => stepLightbox(-1));
  el.lbNext.addEventListener('click', () => stepLightbox(1));

  el.lightbox.addEventListener('click', (e) => {
    /* 画像の外側をクリックしたら閉じる */
    if (e.target === el.lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (el.lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });

  /* ダウンロード（写真を「出す」機能） */
  async function downloadPhoto(id) {
    try {
      const data = await api(`/api/photos?id=${encodeURIComponent(id)}&download=1`);
      const link = document.createElement('a');
      link.href = data.url;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast('ダウンロードを開始しました');
    } catch (err) {
      toast(err.message, true);
    }
  }

  el.lbDownload.addEventListener('click', () => {
    const photo = state.visible[state.lightboxIndex];
    if (photo) downloadPhoto(photo.id);
  });

  el.lbDelete.addEventListener('click', async () => {
    const photo = state.visible[state.lightboxIndex];
    if (!photo) return;
    if (!confirm(`この写真を削除します。元に戻せませんが、よろしいですか？\n\n${buildLabel(photo) || photo.filename}`)) return;

    try {
      await api('/api/delete', { method: 'POST', body: JSON.stringify({ id: photo.id }) });
      closeLightbox();
      toast('写真を削除しました');
      await loadPhotos();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* ----------------------------------------
     アップロード
  ---------------------------------------- */
  function openUpload() {
    if (state.role !== 'admin') {
      toast('写真の追加には管理用の合言葉が必要です', true);
      return false;
    }
    el.uploadModal.hidden = false;
    document.body.style.overflow = 'hidden';
    return true;
  }

  function closeUpload() {
    el.uploadModal.hidden = true;
    document.body.style.overflow = '';
    state.pickedFiles = [];
    el.fileInput.value = '';
    el.pickedInfo.hidden = true;
    el.uploadProgress.hidden = true;
    el.uploadStartBtn.disabled = true;
  }

  el.uploadOpenBtn.addEventListener('click', openUpload);

  document.querySelectorAll('[data-close-upload]').forEach((node) => {
    node.addEventListener('click', closeUpload);
  });

  el.fileInput.addEventListener('change', () => setPickedFiles([...el.fileInput.files]));

  /* ドラッグ＆ドロップ受け入れ */
  ['dragenter', 'dragover'].forEach((type) => {
    el.dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      el.dropZone.classList.add('is-over');
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    el.dropZone.addEventListener(type, (e) => {
      e.preventDefault();
      el.dropZone.classList.remove('is-over');
    });
  });

  el.dropZone.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    setPickedFiles(files);
  });

  function setPickedFiles(files) {
    state.pickedFiles = files;
    if (files.length === 0) {
      el.pickedInfo.hidden = true;
      el.uploadStartBtn.disabled = true;
      return;
    }

    const totalMb = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;
    el.pickedInfo.textContent = `${files.length} 枚を選択中（合計 ${totalMb.toFixed(1)} MB）`;
    el.pickedInfo.hidden = false;
    el.uploadStartBtn.disabled = false;
  }

  /* 画像をブラウザ上で縮小して JPEG 化する。通信量と保存容量の両方を節約できる */
  async function resizeImage(file, maxEdge, quality) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('画像の変換に失敗しました');
    return { blob, width, height };
  }

  /* 署名付き URL へ直接 PUT する */
  async function putToR2(url, blob) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (!res.ok) throw new Error(`アップロードに失敗しました（${res.status}）`);
  }

  el.uploadStartBtn.addEventListener('click', async () => {
    const files = state.pickedFiles;
    if (files.length === 0) return;

    el.uploadStartBtn.disabled = true;
    el.uploadProgress.hidden = false;

    const meta = {
      year: el.metaYear.value ? Number(el.metaYear.value) : null,
      event: el.metaEvent.value.trim(),
      tags: el.metaTags.value.trim(),
      caption: el.metaCaption.value.trim(),
    };

    let done = 0;
    const failed = [];

    /* マニフェスト更新の競合を避けるため、1枚ずつ順番に処理する */
    for (const file of files) {
      el.progressText.textContent = `${done + 1} / ${files.length} 枚目を処理中… （${file.name}）`;

      try {
        const [full, thumb] = await Promise.all([
          resizeImage(file, FULL_MAX_EDGE, FULL_QUALITY),
          resizeImage(file, THUMB_MAX_EDGE, THUMB_QUALITY),
        ]);

        const slot = await api('/api/upload-url', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name }),
        });

        await Promise.all([
          putToR2(slot.uploadUrl, full.blob),
          putToR2(slot.thumbUploadUrl, thumb.blob),
        ]);

        await api('/api/register', {
          method: 'POST',
          body: JSON.stringify({
            id: slot.id,
            key: slot.key,
            thumbKey: slot.thumbKey,
            filename: file.name,
            width: full.width,
            height: full.height,
            size: full.blob.size,
            takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : '',
            ...meta,
          }),
        });
      } catch (err) {
        console.error(err);
        failed.push(`${file.name}（${err.message}）`);
      }

      done += 1;
      el.progressFill.style.width = `${(done / files.length) * 100}%`;
    }

    const succeeded = files.length - failed.length;
    el.progressText.textContent = `完了：${succeeded} 枚を追加しました`;

    if (failed.length > 0) {
      toast(`${failed.length} 枚は失敗しました（HEIC 形式などは非対応の場合があります）`, true);
      console.warn('アップロードに失敗したファイル:', failed);
    } else {
      toast(`${succeeded} 枚をアルバムに追加しました`);
    }

    await loadPhotos();
    setTimeout(closeUpload, 1200);
  });

  /* ----------------------------------------
     検索ボックス（入力が落ち着いてから絞り込む）
  ---------------------------------------- */
  let searchTimer = null;

  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filter.query = el.searchInput.value.trim();
      applyFilter();
    }, 220);
  });

  /* ----------------------------------------
     チャットボットから使う公開インターフェース
  ---------------------------------------- */
  window.Album = {
    getRole: () => state.role,
    getPhotos: () => state.photos,
    getVisible: () => state.visible,
    getFacets,
    buildLabel,
    matchesQuery,
    toast,

    /* 条件を指定して絞り込み、表示中の写真を返す */
    setFilter(next) {
      state.filter = { year: null, event: null, query: '', ...next };
      el.searchInput.value = state.filter.query;
      renderChips();
      const result = applyFilter();
      /* 結果がギャラリーに反映されたことが分かるようスクロールする */
      el.gallery.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return result;
    },

    /* 写真 ID を指定して拡大表示する */
    openPhotoById(id) {
      const index = state.visible.findIndex((p) => p.id === id);
      if (index >= 0) openLightbox(index);
    },

    openUpload,
    downloadPhoto,
    reload: loadPhotos,
  };

  /* ----------------------------------------
     起動処理：前回のログインが有効なら合言葉入力を省略する
  ---------------------------------------- */
  (function init() {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const { token, role } = JSON.parse(saved);
      if (!token) return;
      state.token = token;
      state.role = role;
      enterAlbum();
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  })();
})();
