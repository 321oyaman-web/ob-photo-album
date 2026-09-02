/* ========================================
   OB会 思い出アルバム - メインスクリプト
   2026年8月29日の Sophia ESS Reunion 2026、1日分の写真をシーンごとに整理する。
   ログイン／一覧表示／絞り込み／拡大表示／アップロード／修正／削除を担当し、
   チャットボットからは末尾の window.Album 経由で操作する
======================================== */

(function () {
  'use strict';

  /* シーンの一覧と並び順。api/_scenes.js と同じ内容を保つこと
     （画面と保存側で食い違うと、選んだシーンが「その他」に寄せられてしまう） */
  const SCENES = [
    '受付・開会',
    '集合写真',
    '歓談',
    'スピーチ・挨拶',
    '余興・企画',
    '二次会',
    'その他',
  ];

  /* ----------------------------------------
     アプリの状態
  ---------------------------------------- */
  const state = {
    token: '',
    role: '',
    photos: [],                                  // サーバーから取得した全写真
    videos: [],                                  // YouTube 限定公開へのリンク
    visible: [],                                 // 絞り込み後に表示している写真
    filter: { scene: null, query: '' },
    editingId: null,
    docId: null,
    lightboxIndex: -1,
    pickedFiles: [],
  };

  const STORAGE_KEY = 'ob-album-token';

  /* 縮小設定：長辺2048pxなら鑑賞・印刷に十分で、容量は元の1/5〜1/10に収まる */
  const FULL_MAX_EDGE = 2048;
  const FULL_QUALITY = 0.85;
  const THUMB_MAX_EDGE = 480;
  const THUMB_QUALITY = 0.72;

  /* PDF かどうかの判定。ブラウザが種別を空で渡すことがあるため拡張子でも見る。
     ファイル選択・ドロップ・アップロードの3箇所で使う */
  const isPdfFile = (file) =>
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

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
    sceneChips: $('scene-chips'),
    statusBar: $('status-bar'),
    gallery: $('gallery'),
    emptyState: $('empty-state'),
    emptyText: $('empty-text'),
    uploadModal: $('upload-modal'),
    dropZone: $('drop-zone'),
    fileInput: $('file-input'),
    pickedInfo: $('picked-info'),
    metaScene: $('meta-scene'),
    policyOpenBtn: $('policy-open-btn'),
    policyModal: $('policy-modal'),
    videoOpenBtn: $('video-open-btn'),
    videoSection: $('video-section'),
    videoList: $('video-list'),
    videoModal: $('video-modal'),
    videoUrl: $('video-url'),
    videoName: $('video-name'),
    videoNote: $('video-note'),
    videoSaveBtn: $('video-save-btn'),
    editModal: $('edit-modal'),
    editTarget: $('edit-target'),
    editScene: $('edit-scene'),
    editTags: $('edit-tags'),
    editCaption: $('edit-caption'),
    editSaveBtn: $('edit-save-btn'),
    lbEdit: $('lb-edit'),
    docModal: $('doc-modal'),
    docName: $('doc-name'),
    docFrame: $('doc-frame'),
    docOpen: $('doc-open'),
    docDownload: $('doc-download'),
    docEdit: $('doc-edit'),
    docDelete: $('doc-delete'),
    docClose: $('doc-close'),
    metaTags: $('meta-tags'),
    metaCaption: $('meta-caption'),
    uploadStartBtn: $('upload-start-btn'),
    uploadProgress: $('upload-progress'),
    progressFill: $('progress-fill'),
    progressText: $('progress-text'),
    lightbox: $('lightbox'),
    lbImg: $('lb-img'),
    lbMeta: $('lb-meta'),
    lbTags: $('lb-tags'),
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
    state.videos = [];
    el.videoSection.hidden = true;
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
    el.videoOpenBtn.hidden = state.role !== 'admin';
    await Promise.all([loadPhotos(), loadVideos()]);
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
    const docs = state.photos.filter((p) => p.type === 'pdf').length;
    const photos = state.photos.length - docs;

    /* 0件の種別は省き、表示が長くなりすぎないようにする */
    const parts = [`写真 ${photos} 枚`];
    if (docs > 0) parts.push(`資料 ${docs} 件`);
    if (state.videos.length > 0) parts.push(`動画 ${state.videos.length} 本`);
    parts.push(state.role === 'admin' ? '管理モード' : '閲覧モード');

    el.headerCount.textContent = parts.join(' ・ ');
  }

  /* ----------------------------------------
     写真の取り扱いについて（フッターから開く）
  ---------------------------------------- */
  el.policyOpenBtn.addEventListener('click', () => {
    el.policyModal.hidden = false;
    document.body.style.overflow = 'hidden';
  });

  document.querySelectorAll('[data-close-policy]').forEach((node) => {
    node.addEventListener('click', () => {
      el.policyModal.hidden = true;
      document.body.style.overflow = '';
    });
  });

  /* ----------------------------------------
     動画（YouTube 限定公開へのリンク）
  ---------------------------------------- */
  async function loadVideos() {
    try {
      const data = await api('/api/videos');
      state.videos = data.videos;
      renderVideos();
      updateHeaderCount();
    } catch (err) {
      /* 動画は補助的な機能なので、失敗しても写真の表示は妨げない */
      console.error('[videos]', err);
    }
  }

  function renderVideos() {
    el.videoList.innerHTML = '';
    /* 1本も無いときは、閲覧者には見出しごと隠す */
    el.videoSection.hidden = state.videos.length === 0;
    if (el.videoSection.hidden) return;

    state.videos.forEach((video) => {
      const card = document.createElement('a');
      card.className = 'vcard';
      card.href = video.watchUrl;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';

      const thumb = document.createElement('div');
      thumb.className = 'vcard__thumb';

      const img = document.createElement('img');
      img.src = video.thumbUrl;
      img.alt = '';
      img.loading = 'lazy';
      /* YouTube 側のサムネイルが取れない場合は枠だけ残す */
      img.addEventListener('error', () => { img.remove(); });
      thumb.appendChild(img);

      const play = document.createElement('span');
      play.className = 'vcard__play';
      play.setAttribute('aria-hidden', 'true');
      play.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26">' +
        '<circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.5)"/>' +
        '<path d="M10 8l6 4-6 4Z" fill="#fff"/></svg>';
      thumb.appendChild(play);
      card.appendChild(thumb);

      const body = document.createElement('div');
      body.className = 'vcard__body';

      const name = document.createElement('p');
      name.className = 'vcard__name';
      name.textContent = video.title;
      body.appendChild(name);

      if (video.note) {
        const note = document.createElement('p');
        note.className = 'vcard__note';
        note.textContent = video.note;
        body.appendChild(note);
      }
      card.appendChild(body);

      if (state.role === 'admin') {
        const del = document.createElement('button');
        del.className = 'vcard__del';
        del.type = 'button';
        del.textContent = '×';
        del.title = 'この動画リンクを削除';
        del.setAttribute('aria-label', `${video.title} のリンクを削除`);
        del.addEventListener('click', async (e) => {
          /* カード全体がリンクなので、YouTube を開かないよう止める */
          e.preventDefault();
          e.stopPropagation();
          if (!confirm(`「${video.title}」のリンクを削除します。よろしいですか？\n\n（YouTube 上の動画は消えません）`)) return;
          try {
            await api('/api/videos', { method: 'DELETE', body: JSON.stringify({ id: video.id }) });
            toast('動画リンクを削除しました');
            await loadVideos();
          } catch (err) {
            toast(err.message, true);
          }
        });
        card.appendChild(del);
      }

      el.videoList.appendChild(card);
    });
  }

  function openVideoModal() {
    if (state.role !== 'admin') {
      toast('動画の登録には管理用の合言葉が必要です', true);
      return false;
    }
    el.videoUrl.value = '';
    el.videoName.value = '';
    el.videoNote.value = '';
    el.videoModal.hidden = false;
    setTimeout(() => el.videoUrl.focus(), 60);
    return true;
  }

  function closeVideoModal() {
    el.videoModal.hidden = true;
  }

  el.videoOpenBtn.addEventListener('click', openVideoModal);

  document.querySelectorAll('[data-close-video]').forEach((node) => {
    node.addEventListener('click', closeVideoModal);
  });

  el.videoSaveBtn.addEventListener('click', async () => {
    const url = el.videoUrl.value.trim();
    if (!url) {
      toast('YouTube のURLを入力してください', true);
      return;
    }

    el.videoSaveBtn.disabled = true;
    try {
      await api('/api/videos', {
        method: 'POST',
        body: JSON.stringify({
          url,
          title: el.videoName.value.trim(),
          note: el.videoNote.value.trim(),
        }),
      });
      closeVideoModal();
      toast('動画リンクを登録しました');
      await loadVideos();
    } catch (err) {
      toast(err.message, true);
    } finally {
      el.videoSaveBtn.disabled = false;
    }
  });

  /* 実際に写真があるシーンだけを、SCENES の並び順で返す */
  function getScenes() {
    const used = new Set(state.photos.map((p) => p.scene).filter(Boolean));
    return SCENES.filter((s) => used.has(s));
  }

  /* チャットボットから参照する選択肢 */
  function getFacets() {
    return { scenes: getScenes() };
  }

  function makeChip(container, label, isActive, onClick) {
    const btn = document.createElement('button');
    btn.className = `chip${isActive ? ' is-active' : ''}`;
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    container.appendChild(btn);
  }

  function renderChips() {
    const scenes = getScenes();

    el.sceneChips.innerHTML = '';
    /* 1種類しか無いうちは並べても意味がないので隠す */
    el.sceneChips.hidden = scenes.length < 2;
    if (el.sceneChips.hidden) return;

    makeChip(el.sceneChips, 'すべて', !state.filter.scene, () => {
      state.filter.scene = null;
      renderChips();
      applyFilter();
    });

    scenes.forEach((scene) => {
      const count = state.photos.filter((p) => p.scene === scene).length;
      makeChip(el.sceneChips, `${scene}（${count}）`, state.filter.scene === scene, () => {
        state.filter.scene = state.filter.scene === scene ? null : scene;
        renderChips();
        applyFilter();
      });
    });
  }

  /* 写真1件が検索語に一致するか判定する（シーン・タグ・説明をまとめて対象にする） */
  function matchesQuery(photo, query) {
    if (!query) return true;
    const haystack = [
      photo.scene,
      photo.caption,
      photo.filename,
      (photo.tags || []).join(' '),
    ].join(' ').toLowerCase();

    /* 空白区切りの語をすべて含むものを一致とみなす（AND 検索） */
    return query
      .toLowerCase()
      .split(/[\s　]+/)
      .filter(Boolean)
      .every((word) => haystack.includes(word));
  }

  function applyFilter() {
    const { scene, query } = state.filter;

    state.visible = state.photos.filter((p) => {
      if (scene && p.scene !== scene) return false;
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
        ? 'まだ何も登録されていません。「写真を追加」から最初の1枚をアップロードしてみてください。'
        : '条件を変えてもう一度お試しください。';
      return;
    }
    el.emptyState.hidden = true;

    /* 大量の写真でも描画が重くならないよう、まとめて1回だけ差し込む */
    const fragment = document.createDocumentFragment();

    state.visible.forEach((photo, index) => {
      const isPdf = photo.type === 'pdf';

      const card = document.createElement('button');
      card.className = isPdf ? 'card card--doc' : 'card';
      card.type = 'button';
      card.setAttribute('aria-label',
        isPdf ? `資料を開く: ${photo.filename}` : (buildLabel(photo) || '写真を拡大表示'));

      if (isPdf) {
        /* PDF はサムネイルを作れないため、書類アイコンとファイル名で示す */
        const icon = document.createElement('span');
        icon.className = 'card__doc-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34">' +
          '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Zm0 0v5h5" ' +
          'fill="none" stroke="currentColor" stroke-width="1.6" ' +
          'stroke-linecap="round" stroke-linejoin="round"/></svg>';
        card.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'card__doc-name';
        name.textContent = photo.caption || photo.filename;
        card.appendChild(name);

        const docTags = formatTags(photo);
        if (docTags) {
          const tagEl = document.createElement('span');
          tagEl.className = 'card__doc-tags';
          tagEl.textContent = docTags;
          card.appendChild(tagEl);
        }
      } else {
        const img = document.createElement('img');
        img.className = 'card__img';
        img.src = photo.thumbUrl;
        img.alt = buildLabel(photo) || '思い出の写真';
        img.loading = 'lazy';
        img.decoding = 'async';
        card.appendChild(img);

        const label = buildLabel(photo);
        const tagText = formatTags(photo);
        if (label || tagText) {
          const overlay = document.createElement('div');
          overlay.className = 'card__overlay';

          if (label) {
            const text = document.createElement('p');
            text.className = 'card__label';
            text.textContent = label;
            overlay.appendChild(text);
          }
          if (tagText) {
            const tagEl = document.createElement('p');
            tagEl.className = 'card__tags';
            tagEl.textContent = tagText;
            overlay.appendChild(tagEl);
          }
          card.appendChild(overlay);
        }
      }

      /* PDF は拡大表示ではなく、ブラウザのPDFビューアーで開く */
      card.addEventListener('click', () => (isPdf ? openDocument(photo) : openLightbox(index)));
      fragment.appendChild(card);
    });

    el.gallery.appendChild(fragment);
  }

  /* PDF はアルバム内で開く。別タブに飛ばすとポップアップの扱いに左右され、
     戻る手段も分かりにくくなるため、「閉じる」で一覧へ戻れる形にする */
  async function openDocument(photo) {
    state.docId = photo.id;
    el.docName.textContent = photo.caption
      ? `${photo.caption}（${photo.filename}）`
      : photo.filename;
    el.docFrame.src = 'about:blank';
    el.docModal.hidden = false;
    document.body.style.overflow = 'hidden';

    el.docEdit.hidden = state.role !== 'admin';
    el.docDelete.hidden = state.role !== 'admin';

    try {
      const data = await api(`/api/photos?id=${encodeURIComponent(photo.id)}`);
      /* 表示中に別の資料へ切り替わっていたら、古い応答は捨てる */
      if (state.docId !== photo.id) return;
      el.docFrame.src = data.url;
      /* 端末によっては枠内でPDFを表示できないため、逃げ道を用意する */
      el.docOpen.href = data.url;
    } catch (err) {
      toast(err.message, true);
      closeDocument();
    }
  }

  function closeDocument() {
    el.docModal.hidden = true;
    el.docFrame.src = 'about:blank';
    el.docOpen.removeAttribute('href');
    state.docId = null;
    document.body.style.overflow = '';
  }

  el.docClose.addEventListener('click', closeDocument);

  el.docDownload.addEventListener('click', () => {
    if (state.docId) downloadPhoto(state.docId);
  });

  el.docEdit.addEventListener('click', () => {
    const photo = state.photos.find((p) => p.id === state.docId);
    if (!photo) return;
    closeDocument();
    openEdit(photo);
  });

  el.docDelete.addEventListener('click', async () => {
    const photo = state.photos.find((p) => p.id === state.docId);
    if (!photo) return;
    if (!confirm(`この資料を削除します。元に戻せませんが、よろしいですか？\n\n${photo.filename}`)) return;

    try {
      await api('/api/delete', { method: 'POST', body: JSON.stringify({ id: photo.id }) });
      closeDocument();
      toast('資料を削除しました');
      await loadPhotos();
    } catch (err) {
      toast(err.message, true);
    }
  });

  /* タグを「#合宿 #海」の形にする。タグが無ければ空文字 */
  function formatTags(photo) {
    const tags = photo.tags || [];
    return tags.length ? tags.map((t) => `#${t}`).join(' ') : '';
  }

  /* カードやライトボックスに出す説明文を組み立てる */
  function buildLabel(photo) {
    const parts = [];
    if (photo.scene) parts.push(photo.scene);
    if (photo.caption) parts.push(photo.caption);
    return parts.join(' ・ ');
  }

  /* 撮影時刻を「14:32」の形にする（1日のイベントなので時刻だけで十分） */
  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

    const time = formatTime(photo.takenAt);
    el.lbMeta.textContent = [
      buildLabel(photo) || photo.filename,
      time && `${time} 撮影`,
      `${index + 1} / ${state.visible.length}`,
    ].filter(Boolean).join(' ・ ');

    const tagText = formatTags(photo);
    el.lbTags.textContent = tagText;
    el.lbTags.hidden = !tagText;

    el.lbDelete.hidden = state.role !== 'admin';
    el.lbEdit.hidden = state.role !== 'admin';

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
    if (!el.docModal.hidden) {
      if (e.key === 'Escape') closeDocument();
      return;
    }
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
    const dropped = [...(e.dataTransfer?.files || [])];
    const files = dropped.filter((f) => isPdfFile(f) || f.type.startsWith('image/'));
    const skipped = dropped.length - files.length;

    setPickedFiles(files);
    if (skipped > 0) {
      toast(`${skipped} 件は対象外のため除きました（写真とPDFのみ）`, true);
    }
  });

  function setPickedFiles(files) {
    state.pickedFiles = files;
    if (files.length === 0) {
      el.pickedInfo.hidden = true;
      el.uploadStartBtn.disabled = true;
      return;
    }

    const pdfCount = files.filter(isPdfFile).length;
    const photoCount = files.length - pdfCount;
    const totalMb = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;

    const parts = [];
    if (photoCount > 0) parts.push(`写真 ${photoCount} 枚`);
    if (pdfCount > 0) parts.push(`資料(PDF) ${pdfCount} 件`);

    el.pickedInfo.textContent = `${parts.join(' ・ ')} を選択中（合計 ${totalMb.toFixed(1)} MB）`;
    el.pickedInfo.hidden = false;
    el.uploadStartBtn.disabled = false;
  }

  /* 読み込み済みの画像から、指定サイズの JPEG を1つ作る */
  async function drawToJpeg(bitmap, maxEdge, quality) {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

    /* 生成後すぐ canvas を最小化して、大きな写真を連続処理してもメモリが積み上がらないようにする */
    canvas.width = 0;
    canvas.height = 0;

    if (!blob) throw new Error('画像の変換に失敗しました');
    return { blob, width, height };
  }

  /* 1枚の写真から「原寸用」と「サムネイル用」を作る。
     画像の展開（デコード）は1回だけ行う。2回に分けると、高画素の写真では
     展開後のデータが二重にメモリへ載り、スマホでは失敗しやすくなるため */
  async function makeVariants(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new Error('この形式の画像は読み込めません（HEIC など）');
    }

    try {
      const full = await drawToJpeg(bitmap, FULL_MAX_EDGE, FULL_QUALITY);
      const thumb = await drawToJpeg(bitmap, THUMB_MAX_EDGE, THUMB_QUALITY);
      return { full, thumb };
    } finally {
      bitmap.close();
    }
  }

  /* 署名付き URL へ直接 PUT する。
     ここで指定した種別が R2 に記録され、閲覧時のブラウザの挙動を決める
     （image/jpeg なら画像として、application/pdf ならPDFビューアーで開く） */
  async function putToR2(url, blob, contentType = 'image/jpeg') {
    let res;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: blob,
      });
    } catch {
      /* 通信が成立しない＝ブラウザ側で止められている。原因はほぼ CORS 設定漏れ */
      throw new Error('R2 への送信がブラウザにブロックされました。R2 のCORS設定を確認してください');
    }
    if (res.status === 403) {
      throw new Error('R2 に拒否されました（403）。APIトークンの権限を確認してください');
    }
    if (!res.ok) throw new Error(`R2 への保存に失敗しました（${res.status}）`);
  }

  el.uploadStartBtn.addEventListener('click', async () => {
    const files = state.pickedFiles;
    if (files.length === 0) return;

    el.uploadStartBtn.disabled = true;
    el.uploadProgress.hidden = false;

    const meta = {
      scene: el.metaScene.value,
      tags: el.metaTags.value.trim(),
      caption: el.metaCaption.value.trim(),
    };

    let done = 0;
    const failed = [];

    /* マニフェスト更新の競合を避けるため、1枚ずつ順番に処理する */
    for (const file of files) {
      el.progressText.textContent = `${done + 1} / ${files.length} 件目を処理中… （${file.name}）`;

      try {
        const type = isPdfFile(file) ? 'pdf' : 'photo';

        const slot = await api('/api/upload-url', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, type }),
        });

        let detail;
        if (type === 'pdf') {
          /* PDF は縮小もサムネイル作成もできないため、そのまま送る */
          await putToR2(slot.uploadUrl, file, 'application/pdf');
          detail = { width: null, height: null, size: file.size };
        } else {
          const { full, thumb } = await makeVariants(file);
          await Promise.all([
            putToR2(slot.uploadUrl, full.blob),
            putToR2(slot.thumbUploadUrl, thumb.blob),
          ]);
          detail = { width: full.width, height: full.height, size: full.blob.size };
        }

        await api('/api/register', {
          method: 'POST',
          body: JSON.stringify({
            id: slot.id,
            type,
            key: slot.key,
            thumbKey: slot.thumbKey,
            filename: file.name,
            ...detail,
            takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : '',
            ...meta,
          }),
        });
      } catch (err) {
        console.error(`[アップロード失敗] ${file.name}`, err);
        /* どのファイルが、どう認識されて失敗したのかを残す。
           種別の判定を誤ると原因が分かりにくくなるため */
        failed.push({
          name: file.name,
          detected: isPdfFile(file) ? 'PDF' : `写真（${file.type || '種別不明'}）`,
          reason: err.message,
        });
      }

      done += 1;
      el.progressFill.style.width = `${(done / files.length) * 100}%`;
    }

    const succeeded = files.length - failed.length;

    if (failed.length > 0) {
      /* 失敗理由を推測で書かず、実際に起きたことをそのまま画面に出す */
      const f = failed[0];
      el.progressText.textContent =
        `${succeeded} 件成功 / ${failed.length} 件失敗\n` +
        `${f.name}\n${f.detected} として処理 → ${f.reason}`;
      toast(`${failed.length} 件失敗: ${f.reason}`, true);
      console.warn('アップロードに失敗したファイル:', failed);
    } else {
      el.progressText.textContent = `完了：${succeeded} 件を追加しました`;
      toast(`${succeeded} 件をアルバムに追加しました`);
    }

    await loadPhotos();

    if (failed.length === 0) {
      setTimeout(closeUpload, 1200);
    } else {
      /* 失敗時は画面を閉じない。理由を読めるようにし、そのまま再試行できるようにする */
      el.uploadStartBtn.disabled = false;
    }
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
     写真情報の修正（管理モードのみ）
  ---------------------------------------- */
  function fillSceneOptions(select) {
    select.innerHTML = '';
    SCENES.forEach((scene) => {
      const option = document.createElement('option');
      option.value = scene;
      option.textContent = scene;
      select.appendChild(option);
    });
  }

  fillSceneOptions(el.metaScene);
  fillSceneOptions(el.editScene);

  function openEdit(photo) {
    if (state.role !== 'admin' || !photo) return;

    state.editingId = photo.id;
    el.editTarget.textContent = `${photo.filename}${formatTime(photo.takenAt) ? `（${formatTime(photo.takenAt)} 撮影）` : ''}`;
    el.editScene.value = SCENES.includes(photo.scene) ? photo.scene : 'その他';
    el.editTags.value = (photo.tags || []).join(', ');
    el.editCaption.value = photo.caption || '';
    el.editModal.hidden = false;
  }

  function closeEdit() {
    el.editModal.hidden = true;
    state.editingId = null;
  }

  document.querySelectorAll('[data-close-edit]').forEach((node) => {
    node.addEventListener('click', closeEdit);
  });

  el.lbEdit.addEventListener('click', () => openEdit(state.visible[state.lightboxIndex]));

  el.editSaveBtn.addEventListener('click', async () => {
    const id = state.editingId;
    if (!id) return;

    el.editSaveBtn.disabled = true;
    try {
      await api('/api/update', {
        method: 'POST',
        body: JSON.stringify({
          id,
          scene: el.editScene.value,
          tags: el.editTags.value,
          caption: el.editCaption.value,
        }),
      });
      closeEdit();
      closeLightbox();
      toast('写真の情報を更新しました');
      await loadPhotos();
    } catch (err) {
      toast(err.message, true);
    } finally {
      el.editSaveBtn.disabled = false;
    }
  });

  /* ----------------------------------------
     チャットボットから使う公開インターフェース
  ---------------------------------------- */
  window.Album = {
    getRole: () => state.role,
    getPhotos: () => state.photos,
    getVideos: () => state.videos,
    getVisible: () => state.visible,
    getFacets,
    getScenes,
    buildLabel,
    matchesQuery,
    toast,
    SCENES,

    /* 条件を指定して絞り込み、表示中の写真を返す */
    setFilter(next) {
      state.filter = { scene: null, query: '', ...next };
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
    openVideoModal,
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
