/* ========================================
   OB会 思い出アルバム - チャットボット「アルバム係」
   2026年8月29日のOB/OG会、1日分の写真を会話から探せるようにする。
   ルールベース（API 費用ゼロ）で動く。
======================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const el = {
    toggle: $('bot-toggle'),
    panel: $('bot-panel'),
    close: $('bot-close'),
    log: $('bot-log'),
    quick: $('bot-quick'),
    form: $('bot-form'),
    input: $('bot-input'),
  };

  /* 返答に添えるサムネイルの最大枚数（多すぎると会話が読みにくくなる） */
  const THUMB_LIMIT = 6;

  /* シーン名の言い換え。話し言葉でも聞き取れるようにする */
  const SCENE_ALIASES = {
    '受付・開会': ['開会', 'オープニング', '始まり', 'はじまり', '冒頭'],
    '集合写真': ['全体写真', '記念写真', 'みんなで', '全員'],
    '歓談': ['談笑', 'おしゃべり', '交流', 'テーブル'],
    'スピーチ・挨拶': ['スピーチ', '挨拶', 'あいさつ', '祝辞', '乾杯'],
    '余興・企画': ['余興', '出し物', '企画', 'ゲーム'],
    '二次会': ['2次会', '２次会', '打ち上げ', 'アフター'],
  };

  let greeted = false;

  /* ----------------------------------------
     メッセージの表示
  ---------------------------------------- */
  function addMessage(role, text, photos = []) {
    const bubble = document.createElement('div');
    bubble.className = `msg msg--${role}`;
    bubble.textContent = text;

    /* 検索結果はサムネイル付きで返し、その場でクリックして拡大できるようにする */
    if (photos.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'msg__thumbs';

      photos.slice(0, THUMB_LIMIT).forEach((photo) => {
        const button = document.createElement('button');
        button.className = 'msg__thumb';
        button.type = 'button';
        button.title = window.Album.buildLabel(photo) || photo.filename;

        const img = document.createElement('img');
        img.src = photo.thumbUrl;
        img.alt = window.Album.buildLabel(photo) || '思い出の写真';
        img.loading = 'lazy';
        button.appendChild(img);

        button.addEventListener('click', () => window.Album.openPhotoById(photo.id));
        grid.appendChild(button);
      });

      bubble.appendChild(grid);
    }

    el.log.appendChild(bubble);
    el.log.scrollTop = el.log.scrollHeight;
  }

  /* ボットは少し間を置いて返答すると会話らしくなる */
  function botSay(text, photos = [], quickReplies = null) {
    setTimeout(() => {
      addMessage('bot', text, photos);
      if (quickReplies) setQuickReplies(quickReplies);
    }, 260);
  }

  function setQuickReplies(labels) {
    el.quick.innerHTML = '';
    labels.forEach((label) => {
      const button = document.createElement('button');
      button.className = 'quick';
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => handleInput(label));
      el.quick.appendChild(button);
    });
  }

  /* ----------------------------------------
     入力の解析（ルールベース）
  ---------------------------------------- */

  /* 文中からシーン名を拾う。正式名・部分名・言い換えの順に照合する */
  function extractScene(text) {
    const scenes = window.Album.getScenes();

    const exact = scenes.find((s) => text.includes(s));
    if (exact) return exact;

    /* 「スピーチ・挨拶」に対する「スピーチ」のような部分一致 */
    for (const scene of scenes) {
      for (const part of scene.split('・')) {
        if (part.length >= 2 && text.includes(part)) return scene;
      }
    }

    /* 言い換え。ただしアルバムに実在するシーンに限る */
    for (const scene of scenes) {
      const words = SCENE_ALIASES[scene] || [];
      if (words.some((w) => text.includes(w))) return scene;
    }
    return null;
  }

  /* 検索対象となるキーワードを取り出す。助詞や定型句は落とす */
  function extractKeywords(text) {
    const noise = [
      'の写真', '写真', 'を', 'が', 'は', 'に', 'で', 'と', 'も', 'から', 'まで',
      '見せて', 'みせて', '見たい', 'みたい', '見る', '表示', '探して', 'さがして',
      '検索', 'ある', 'ありますか', 'ください', 'ちょうだい', 'お願い', 'おねがい',
      'って', 'どんな', 'なに', '何', 'とき', '時', 'ころ', '頃', 'あたり',
      '教えて', 'おしえて', 'です', 'ますか', 'かな', 'たい', 'シーン', '場面',
    ];

    let base = text;
    noise.forEach((word) => { base = base.split(word).join(' '); });

    return base
      .replace(/[。、．，！？!?~〜「」（）()]/g, ' ')
      .split(/[\s　]+/)
      /* 2文字以上を残す。ただし1文字でも意味を持つ漢字・カタカナ・英数は残す
         （ひらがな1文字は助詞の可能性が高いので落とす） */
      .filter((word) => word.length >= 2 || /[^ぁ-ゖ]/.test(word))
      .join(' ')
      .trim();
  }

  const has = (text, words) => words.some((word) => text.includes(word));

  /* ----------------------------------------
     返答の組み立て
  ---------------------------------------- */
  function respond(rawText) {
    const text = rawText.trim();
    if (!text) return;

    const photos = window.Album.getPhotos();
    const scenes = window.Album.getScenes();
    const isAdmin = window.Album.getRole() === 'admin';

    /* --- 写真が1枚も無いとき --- */
    if (photos.length === 0 && !has(text, ['使い方', 'ヘルプ', '追加', 'アップロード'])) {
      botSay(
        'まだ写真が1枚も登録されていません。\n' +
        '8月29日のOB/OG会が終わったら、幹事が写真をアップロードします。もう少しお待ちください。',
        [],
        isAdmin ? ['写真を追加したい', '使い方'] : ['使い方']
      );
      return;
    }

    /* --- 挨拶 --- */
    if (has(text, ['こんにちは', 'こんばんは', 'おはよう', 'はじめまして', 'よろしく'])) {
      botSay(
        'こんにちは！ 8月29日のOB/OG会アルバム係です。\n' +
        '「集合写真を見せて」「二次会の写真ある？」のように話しかけてください。',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- 使い方 --- */
    if (has(text, ['使い方', 'ヘルプ', 'help', 'できること', '何ができ', 'なにができ'])) {
      botSay(
        'このアルバムは、2026年8月29日のOB/OG会の写真をまとめたものです。\n\n' +
        '【写真を探す】\n' +
        '・「集合写真」「二次会」など場面で絞り込み\n' +
        '・「乾杯」などキーワードでも検索できます\n' +
        '・「最初の方」「最後の方」で時間帯を指定\n' +
        '・「ランダムで見せて」でおまかせ表示\n\n' +
        '【写真を保存する】\n' +
        '・写真をタップ →「ダウンロード」で元の画質で保存\n\n' +
        (isAdmin
          ? '【幹事の方】\n' +
            '・「写真を追加したい」でアップロード画面を開きます\n' +
            '・写真をタップ →「情報を修正」でシーンや説明を直せます\n\n'
          : '') +
        '【そのほか】\n' +
        '・「何枚ある？」…シーン別の枚数\n' +
        '・「シーン一覧」…どんな場面の写真があるか',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- 写真を追加（幹事のみ） --- */
    if (has(text, ['アップロード', 'あっぷろーど', '追加', '入れ', 'いれ', '登録', 'あげたい', '上げたい', '投稿'])) {
      if (!isAdmin) {
        botSay(
          '写真の追加は幹事が行います。\n' +
          'お手元に当日の写真がある場合は、幹事にお送りいただければアルバムに追加します。'
        );
        return;
      }
      if (window.Album.openUpload()) {
        botSay(
          'アップロード画面を開きました。\n' +
          'シーンを選んでからアップロードすると、あとで探しやすくなります。\n' +
          '同じシーンの写真をまとめて選ぶのがおすすめです。'
        );
      }
      return;
    }

    /* --- 情報の修正（幹事のみ） --- */
    if (has(text, ['修正', '直し', '直す', '変更', '付け直', 'つけ直', '編集'])) {
      botSay(isAdmin
        ? '直したい写真をタップして拡大表示し、「情報を修正」を押してください。\nシーン・タグ・説明を後からいつでも変更できます。'
        : '写真の情報の修正は幹事のみが行えます。お気づきの点は幹事までお知らせください。');
      return;
    }

    /* --- 削除の案内 --- */
    if (has(text, ['削除', '消し', '消す', '取り消'])) {
      botSay(isAdmin
        ? '削除したい写真をタップして拡大表示し、「削除」を押してください。\n削除すると元に戻せないのでご注意ください。'
        : '写真の削除は幹事のみが行えます。掲載を控えてほしい写真があれば、幹事までお知らせください。');
      return;
    }

    /* --- ダウンロードの案内 --- */
    if (has(text, ['ダウンロード', 'だうんろーど', '保存', '持ち帰', '取り出'])) {
      botSay(
        '写真をタップして拡大表示すると、「ダウンロード」から元の画質で保存できます。\n' +
        'まず見たい写真の場面を教えてください。',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- 枚数・統計 --- */
    if (has(text, ['何枚', 'なんまい', '枚数', 'いくつ', '合計', '全部で'])) {
      const summary = scenes
        .map((s) => `・${s}：${photos.filter((p) => p.scene === s).length} 枚`)
        .join('\n');
      botSay(
        `8月29日のOB/OG会の写真は、全部で ${photos.length} 枚です。\n\n【シーン別】\n${summary}`,
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- シーン一覧 --- */
    if (has(text, ['シーン一覧', '一覧', 'どんな写真', '何がある', 'どんな場面'])) {
      const list = scenes
        .map((s) => `・${s}（${photos.filter((p) => p.scene === s).length} 枚）`)
        .join('\n');
      botSay(`こんな場面の写真があります。\n\n${list}\n\n見たい場面を教えてください。`, [], scenes.slice(0, 6));
      return;
    }

    /* --- すべて表示 / 絞り込み解除 --- */
    if (has(text, ['全部', 'すべて', '全て', 'ぜんぶ', 'リセット', '解除', '最初から'])) {
      const result = window.Album.setFilter({});
      botSay(`絞り込みを解除して、全 ${result.length} 枚を表示しました。`, result, defaultQuickReplies());
      return;
    }

    /* --- 時間帯（1日のイベントなので、序盤・終盤の指定が効く） --- */
    if (has(text, ['最初', '序盤', '前半', 'はじめの方', '始めの方'])) {
      const result = window.Album.setFilter({});
      botSay('会の序盤の写真です（撮影時刻の早い順に並んでいます）。',
        result.slice(0, THUMB_LIMIT), defaultQuickReplies());
      return;
    }
    if (has(text, ['最後', '終盤', '後半', '終わり', 'ラスト'])) {
      const result = window.Album.setFilter({});
      botSay('会の終盤の写真です。',
        result.slice(-THUMB_LIMIT).reverse(), defaultQuickReplies());
      return;
    }

    /* --- ランダム表示 --- */
    if (has(text, ['ランダム', 'おすすめ', '適当', 'なんでも', 'おまかせ'])) {
      const picked = [...photos].sort(() => Math.random() - 0.5).slice(0, THUMB_LIMIT);
      botSay('こんな写真はいかがですか？ タップすると大きく表示されます。', picked, defaultQuickReplies());
      return;
    }

    /* --- シーン・キーワードによる検索（主要機能） --- */
    const scene = extractScene(text);
    const keywords = extractKeywords(text);

    if (!scene && !keywords) {
      botSay(
        'すみません、うまく聞き取れませんでした。\n' +
        '「集合写真」「二次会」のような場面や、「乾杯」などのキーワードで教えてください。',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* シーンが特定できた場合、キーワードはシーン名の一部である可能性が高いので使わない */
    const result = window.Album.setFilter(scene ? { scene } : { query: keywords });

    if (result.length === 0) {
      window.Album.setFilter({});
      botSay(
        `「${scene || keywords}」の写真は見つかりませんでした。\n` +
        `登録があるのは次の場面です。\n${scenes.map((s) => `・${s}`).join('\n')}\n\n` +
        '（ギャラリーは全件表示に戻しました）',
        [],
        defaultQuickReplies()
      );
      return;
    }

    botSay(
      `「${scene || keywords}」の写真を ${result.length} 枚見つけました。` +
      (result.length > THUMB_LIMIT ? `\n下のギャラリーに全 ${result.length} 枚を表示しています。` : ''),
      result,
      ['すべて表示', '何枚ある？', '使い方']
    );
  }

  /* 状況に応じたクイック返信を組み立てる */
  function defaultQuickReplies() {
    const replies = window.Album.getScenes().slice(0, 3);
    replies.push('何枚ある？');
    if (window.Album.getRole() === 'admin') replies.push('写真を追加したい');
    replies.push('使い方');
    return replies;
  }

  /* ----------------------------------------
     入力の受け付け
  ---------------------------------------- */
  function handleInput(text) {
    addMessage('user', text);
    el.quick.innerHTML = '';
    respond(text);
  }

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.input.value.trim();
    if (!text) return;
    el.input.value = '';
    handleInput(text);
  });

  /* ----------------------------------------
     パネルの開閉
  ---------------------------------------- */
  function openPanel() {
    el.panel.hidden = false;
    el.toggle.hidden = true;

    /* 初回だけ挨拶する */
    if (!greeted) {
      greeted = true;
      const total = window.Album.getPhotos().length;
      addMessage(
        'bot',
        'こんにちは！ 8月29日のOB/OG会アルバム係です。\n' +
        (total > 0
          ? `当日の写真を ${total} 枚お預かりしています。\n見たい場面やキーワードを教えてください。`
          : 'まだ写真が登録されていません。会が終わったら幹事がアップロードします。')
      );
      setQuickReplies(defaultQuickReplies());
    }

    setTimeout(() => el.input.focus(), 60);
  }

  function closePanel() {
    el.panel.hidden = true;
    el.toggle.hidden = false;
  }

  el.toggle.addEventListener('click', openPanel);
  el.close.addEventListener('click', closePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.panel.hidden) closePanel();
  });

  /* ----------------------------------------
     ログイン前はチャットボットを隠しておく
  ---------------------------------------- */
  el.toggle.hidden = true;

  document.addEventListener('album:ready', () => {
    el.toggle.hidden = false;
  });
})();
