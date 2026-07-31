/* ========================================
   OB会 思い出アルバム - チャットボット「アルバム係」
   ルールベース（API 費用ゼロ）で、写真の「出し入れ」を会話から操作する
     出す … 年・イベント・キーワードでの検索、拡大表示、ダウンロード
     入れる … アップロード画面の呼び出し（管理用の合言葉が必要）
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

  /* 和暦・西暦のどちらでも年を拾う */
  function extractYear(text) {
    const western = text.match(/(19\d{2}|20\d{2})\s*年?/);
    if (western) return Number(western[1]);

    const eras = [
      { pattern: /令和\s*(元|\d{1,2})\s*年?/, base: 2018 },
      { pattern: /平成\s*(元|\d{1,2})\s*年?/, base: 1988 },
      { pattern: /昭和\s*(元|\d{1,2})\s*年?/, base: 1925 },
    ];

    for (const era of eras) {
      const matched = text.match(era.pattern);
      if (matched) {
        const nth = matched[1] === '元' ? 1 : Number(matched[1]);
        return era.base + nth;
      }
    }
    return null;
  }

  /* 検索対象となるキーワードを取り出す。助詞や定型句は落とす */
  function extractKeywords(text) {
    /* 年は extractYear が別途拾うので、キーワードからは取り除く。
       残しておくと「2019年の写真」が「2019年 の 2019」のような表示になってしまう */
    let base = text
      .replace(/(19\d{2}|20\d{2})\s*年?/g, ' ')
      .replace(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年?/g, ' ');

    const noise = [
      'の写真', '写真', 'を', 'が', 'は', 'に', 'で', 'と', 'も', 'から', 'まで',
      '見せて', 'みせて', '見たい', 'みたい', '見る', '表示', '探して', 'さがして',
      '検索', 'ある', 'ありますか', 'ください', 'ちょうだい', 'お願い', 'おねがい',
      'って', 'どんな', 'なに', '何', 'とき', '時', '年', 'ころ', '頃', 'あたり',
      '教えて', 'おしえて', 'です', 'ますか', 'かな', 'たい',
    ];

    noise.forEach((word) => { base = base.split(word).join(' '); });

    return base
      .replace(/[。、．，！？!?~〜「」（）()]/g, ' ')
      .split(/[\s　]+/)
      /* 2文字以上を残す。ただし「海」「山」「桜」のように1文字でも意味を持つ
         漢字・カタカナ・英数は残す（ひらがな1文字は助詞の可能性が高いので落とす） */
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
    const { years, events } = window.Album.getFacets();

    /* --- 挨拶 --- */
    if (has(text, ['こんにちは', 'こんばんは', 'おはよう', 'はじめまして', 'よろしく'])) {
      botSay(
        'こんにちは！ OB会の思い出アルバム係です。\n' +
        '「2019年の写真を見せて」「合宿の写真ある？」のように話しかけてください。',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- 使い方 --- */
    if (has(text, ['使い方', 'ヘルプ', 'help', 'できること', '何ができ', 'なにができ'])) {
      botSay(
        'できることは次のとおりです。\n\n' +
        '【写真を出す】\n' +
        '・「2019年の写真」…年で絞り込み\n' +
        '・「夏合宿の写真ある？」…イベント名やタグで検索\n' +
        '・「最近の写真」「ランダムで見せて」\n' +
        '・写真をタップすると拡大表示され、そこからダウンロードできます\n\n' +
        '【写真を入れる】\n' +
        '・「写真を追加したい」…アップロード画面を開きます\n' +
        '　（管理用の合言葉でログインしている場合のみ）\n\n' +
        '【そのほか】\n' +
        '・「何枚ある？」…登録枚数を確認\n' +
        '・「イベント一覧」…登録されているイベントを表示',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- 写真を入れる（アップロード） --- */
    if (has(text, ['アップロード', 'あっぷろーど', '追加', '入れ', 'いれ', '登録', '保存したい', 'あげたい', '上げたい', '投稿'])) {
      if (window.Album.getRole() !== 'admin') {
        botSay(
          '写真の追加には「管理用の合言葉」が必要です。\n' +
          '幹事の方から管理用の合言葉を受け取って、いったんログアウトしてから入り直してください。'
        );
        return;
      }
      const opened = window.Album.openUpload();
      if (opened) {
        botSay(
          'アップロード画面を開きました。\n' +
          '写真を選んで、撮影年・イベント名・タグを入れておくと、あとから探しやすくなります。\n' +
          '（アップロード時に自動で縮小するので、枚数が多くても大丈夫です）'
        );
      }
      return;
    }

    /* --- 削除の案内 --- */
    if (has(text, ['削除', '消し', '消す', '取り消'])) {
      if (window.Album.getRole() !== 'admin') {
        botSay('写真の削除には「管理用の合言葉」が必要です。幹事の方にご相談ください。');
      } else {
        botSay('削除したい写真をタップして拡大表示し、「削除」ボタンを押してください。\n削除すると元に戻せないのでご注意ください。');
      }
      return;
    }

    /* --- ダウンロードの案内 --- */
    if (has(text, ['ダウンロード', 'だうんろーど', '出し', 'だし', '取り出', '持ち帰', '保存'])) {
      botSay(
        '写真をタップして拡大表示すると、「ダウンロード」ボタンから元の画質で保存できます。\n' +
        'まず探したい写真の条件を教えてください。（例：「2019年の合宿」）',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- 枚数・統計 --- */
    if (has(text, ['何枚', 'なんまい', '枚数', 'いくつ', '合計', '全部で'])) {
      if (photos.length === 0) {
        botSay('まだ写真が1枚も登録されていません。');
        return;
      }
      const yearSummary = years
        .map((year) => `・${year}年：${photos.filter((p) => p.year === year).length} 枚`)
        .join('\n');
      botSay(
        `現在 ${photos.length} 枚の写真が登録されています。\n\n【年別】\n${yearSummary || '（年の情報が未設定の写真のみです）'}`,
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* --- イベント一覧 --- */
    if (has(text, ['イベント一覧', 'イベント', '行事', '一覧', 'どんな写真', '何がある'])) {
      if (events.length === 0) {
        botSay('まだイベント名が登録された写真がありません。');
        return;
      }
      const list = events
        .map((event) => `・${event}（${photos.filter((p) => p.event === event).length} 枚）`)
        .join('\n');
      botSay(`登録されているイベントはこちらです。\n\n${list}\n\n見たいイベント名を教えてください。`, [], events.slice(0, 6));
      return;
    }

    /* --- すべて表示 / 絞り込み解除 --- */
    if (has(text, ['全部', 'すべて', '全て', 'ぜんぶ', 'リセット', '解除', '最初から'])) {
      const result = window.Album.setFilter({});
      botSay(`絞り込みを解除して、全 ${result.length} 枚を表示しました。`, result, defaultQuickReplies());
      return;
    }

    /* --- 最近の写真 --- */
    if (has(text, ['最近', '新しい', '最新', '直近'])) {
      const result = window.Album.setFilter({});
      botSay(
        result.length > 0
          ? `新しい順に並べています。上位 ${Math.min(THUMB_LIMIT, result.length)} 枚はこちらです。`
          : 'まだ写真が登録されていません。',
        result
      );
      return;
    }

    /* --- ランダム表示 --- */
    if (has(text, ['ランダム', 'おすすめ', '適当', 'なんでも', 'おまかせ'])) {
      if (photos.length === 0) {
        botSay('まだ写真が登録されていません。');
        return;
      }
      const picked = [...photos].sort(() => Math.random() - 0.5).slice(0, THUMB_LIMIT);
      botSay('こんな写真はいかがですか？ タップすると大きく表示されます。', picked, defaultQuickReplies());
      return;
    }

    /* --- 年・キーワードによる検索（ここが主要機能） --- */
    const year = extractYear(text);
    const keywords = extractKeywords(text);

    /* 年もキーワードも取れない場合は聞き返す */
    if (!year && !keywords) {
      botSay(
        'すみません、うまく聞き取れませんでした。\n' +
        '「2019年の写真」「合宿の写真ある？」のように、年やイベント名を入れて教えてください。',
        [],
        defaultQuickReplies()
      );
      return;
    }

    /* イベント名と完全に一致する語があれば、イベント絞り込みとして扱う */
    const matchedEvent = events.find((event) => text.includes(event));

    const filter = {};
    if (year) filter.year = year;
    if (matchedEvent) {
      filter.event = matchedEvent;
    } else if (keywords) {
      filter.query = keywords;
    }

    let result = window.Album.setFilter(filter);

    /* 見つからなかった場合は、条件を緩めて再検索し、代わりの候補を提案する */
    if (result.length === 0) {
      const conditionText = [
        year ? `${year}年` : '',
        matchedEvent || keywords,
      ].filter(Boolean).join(' の ');

      /* 年だけ、またはキーワードだけで再検索してみる */
      const fallbackFilter = year ? { year } : { query: keywords };
      const fallback = window.Album.setFilter(fallbackFilter);

      if (fallback.length > 0) {
        const fallbackLabel = year ? `${year}年` : keywords;
        botSay(
          `「${conditionText}」に一致する写真は見つかりませんでした。\n` +
          `代わりに「${fallbackLabel}」で ${fallback.length} 枚が見つかったので表示しています。`,
          fallback,
          defaultQuickReplies()
        );
      } else {
        /* 該当が無いときは絞り込みを解除し、その旨も伝える */
        window.Album.setFilter({});
        botSay(
          `「${conditionText}」の写真は見つかりませんでした。\n` +
          (years.length > 0 ? `登録があるのは ${years.join('年 / ')}年 です。` : '') +
          (events.length > 0 ? `\nイベント：${events.slice(0, 8).join(' / ')}` : '') +
          '\n\n（ギャラリーは全件表示に戻しました）',
          [],
          defaultQuickReplies()
        );
      }
      return;
    }

    const conditionLabel = [
      year ? `${year}年` : '',
      matchedEvent || keywords,
    ].filter(Boolean).join(' の ');

    botSay(
      `「${conditionLabel}」の写真を ${result.length} 枚見つけました。` +
      (result.length > THUMB_LIMIT
        ? `\n下のギャラリーに全 ${result.length} 枚を表示しています。`
        : ''),
      result,
      ['ダウンロードしたい', 'すべて表示', '使い方']
    );
  }

  /* 状況に応じたクイック返信を組み立てる */
  function defaultQuickReplies() {
    const { years, events } = window.Album.getFacets();
    const replies = [];

    if (years.length > 0) replies.push(`${years[0]}年の写真`);
    if (events.length > 0) replies.push(events[0]);
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
        'こんにちは！ 思い出アルバム係です。\n' +
        (total > 0
          ? `現在 ${total} 枚の写真をお預かりしています。`
          : 'まだ写真が登録されていません。') +
        '\n見たい写真の年やイベント名を教えてください。'
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
