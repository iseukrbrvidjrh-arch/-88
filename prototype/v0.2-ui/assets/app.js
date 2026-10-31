/* SceneLingo V0.2 — prototype interactions.
 * Everything is local and deterministic: no network, no real API keys, no personal data.
 */
(() => {
  'use strict';

  const D = window.SL_DATA;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (value) => esc(value).replace(/"/g, '&quot;');
  const escapeReg = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const icon = (name, extra = '') =>
    `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  const firstArticle = D.articles[0];
  const firstParagraph = firstArticle.chapters[0].paragraphs[0];

  const state = {
    route: 'home',
    workbenchMode: 'subtitle',
    episodeId: D.episodes[0].id,
    cueId: 'ml-5',
    articleId: firstArticle.id,
    paragraphId: firstParagraph.id,
    materials: D.materials.map((material) => ({ ...material })),
    materialFilter: 'all',
    materialSearch: '',
    candidateSearch: '',
    vocab: D.seedWords.map((word) => ({ ...word })),
    filter: 'all',
    search: '',
    selectedWord: null,
    lastWordEl: null,
    popoverContext: null,
    pendingAsk: null,
    thinking: false,
    review: null,
    modalTrigger: null,
    settings: {
      provider: '通义千问 · DashScope',
      baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
      model: 'qwen3.8-max',
      maxTokens: 800,
      cloudEnabled: true,
      confirmBeforeSend: true,
      test: 'idle'
    },
    aiMessages: [{
      role: 'ai',
      text: '你好，我是你的 AI Tutor。\n点一句字幕或一个单词，我们从语境开始。'
    }],
    playback: { playing: false, timer: null }
  };

  const TITLES = {
    home: { eyebrow: '今天的学习', title: () => `${greeting()}，继续看一段故事。` },
    materials: { eyebrow: '学习资料', title: () => '字幕、文章和长书，放在同一个学习台。' },
    workbench: { eyebrow: '学习工作台', title: () => '在语境里，把词学活。' },
    vocabulary: { eyebrow: '生词库', title: () => '把遇见的词，变成自己的。' },
    stats: { eyebrow: '学习统计', title: () => '看见积累，也看见节奏。' },
    settings: { eyebrow: '设置', title: () => 'AI 与本地数据，都由你决定。' }
  };

  const popover = $('#wordPopover');

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function lookup(word) {
    return D.dictionary[word] || { ipa: '/—/', pos: 'word', zh: '本地词典暂未收录这个词。' };
  }

  function currentEpisode() {
    return D.episodes.find((episode) => episode.id === state.episodeId) || D.episodes[0];
  }

  function flatCues(episode = currentEpisode()) {
    return episode.scenes.flatMap((scene) => scene.cues);
  }

  function currentCue() {
    const cues = flatCues();
    return cues.find((cue) => cue.id === state.cueId) || cues[0];
  }

  function materialById(id) {
    return state.materials.find((material) => material.id === id) || null;
  }

  function subtitleEpisodes() {
    return state.materials
      .filter((material) => material.kind === 'subtitle')
      .map((material) => D.episodes.find((episode) => episode.id === material.episodeId))
      .filter(Boolean);
  }

  function isArticleMode() {
    return state.workbenchMode === 'article';
  }

  function currentArticle() {
    return D.articles.find((article) => article.id === state.articleId) || D.articles[0];
  }

  function articleParagraphs(article = currentArticle()) {
    return article.chapters.flatMap((chapter) => chapter.paragraphs);
  }

  function currentParagraph() {
    return articleParagraphs().find((paragraph) => paragraph.id === state.paragraphId)
      || articleParagraphs()[0];
  }

  function currentChapter() {
    const paragraph = currentParagraph();
    return currentArticle().chapters.find((chapter) =>
      chapter.paragraphs.some((item) => item.id === paragraph.id)
    ) || currentArticle().chapters[0];
  }

  function currentPassage() {
    return isArticleMode() ? currentParagraph() : currentCue();
  }

  function currentSourceTitle() {
    return isArticleMode() ? currentArticle().title : currentEpisode().title;
  }

  function wordPattern(word) {
    return new RegExp(`\\b${escapeReg(word)}\\b`, 'i');
  }

  function cueContaining(word, episode = currentEpisode()) {
    return flatCues(episode).find((cue) => wordPattern(word).test(cue.text)) || null;
  }

  function paragraphContaining(word) {
    return articleParagraphs().find((paragraph) => wordPattern(word).test(paragraph.text)) || null;
  }

  function exampleFor(word) {
    if (isArticleMode()) {
      const paragraph = paragraphContaining(word);
      if (paragraph) return { text: paragraph.text, zh: paragraph.zh };
    }
    for (const episode of D.episodes) {
      const cue = cueContaining(word, episode);
      if (cue) return { text: cue.text, zh: cue.zh };
    }
    const articleParagraph = articleParagraphs().find((paragraph) => wordPattern(word).test(paragraph.text));
    if (articleParagraph) return { text: articleParagraph.text, zh: articleParagraph.zh };
    const entry = lookup(word);
    if (entry.example) return { text: entry.example, zh: '补充例句' };
    return { text: `Try using “${word}” in a sentence about your own day.`, zh: '试着用它描述你的一天。' };
  }

  function wordize(text) {
    return esc(text).replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (match) => {
      const key = match.toLowerCase().replace(/’/g, "'");
      return `<button type="button" class="word" data-word="${attr(key)}" aria-label="查询单词 ${attr(match)}">${match}</button>`;
    });
  }

  function highlightWord(text, word) {
    return esc(text).replace(new RegExp(`\\b(${escapeReg(word)})\\b`, 'gi'), '<mark>$1</mark>');
  }

  function todayLabel() {
    const now = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}`;
  }

  function statusPill(item) {
    return item.status === 'mastered'
      ? '<span class="pill pill--green">已掌握</span>'
      : '<span class="pill pill--amber">学习中</span>';
  }

  function updateVocabBadge() {
    const badge = $('#navVocabCount');
    if (badge) badge.textContent = String(state.vocab.length);
  }

  let toastTimer = null;
  function toast(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2300);
  }

  function speak(text, label = '') {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
      toast('当前浏览器不支持本地朗读');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.88;
      const voice = window.speechSynthesis.getVoices().find((item) => /^en[-_]US/i.test(item.lang));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
      toast(`正在本地朗读：${label || text}`);
    } catch (error) {
      toast('本地朗读暂不可用');
    }
  }

  /* ——— Rendering ——— */
  function render() {
    document.body.dataset.route = state.route;
    updateVocabBadge();
    $$('.nav-item').forEach((item) => {
      if (item.dataset.nav === state.route) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    const meta = TITLES[state.route] || TITLES.home;
    $('#pageEyebrow').textContent = meta.eyebrow;
    $('#pageTitle').textContent = meta.title();
    document.title = `${meta.eyebrow} · SceneLingo V0.2 原型`;

    const view = $('#view');
    if (state.route === 'workbench') view.innerHTML = workbenchHTML();
    else if (state.route === 'materials') view.innerHTML = materialsHTML();
    else if (state.route === 'vocabulary') view.innerHTML = vocabularyHTML();
    else if (state.route === 'stats') view.innerHTML = statsHTML();
    else if (state.route === 'settings') view.innerHTML = settingsHTML();
    else view.innerHTML = homeHTML();

    if (state.route !== 'workbench') view.scrollTop = 0;
    else afterWorkbenchRender();
  }

  function homeHTML() {
    const total = state.vocab.length;
    const mastered = state.vocab.filter((item) => item.status === 'mastered').length;
    const recent = state.vocab.slice(0, 4);
    const weeklyMax = Math.max(...D.weekly.map((day) => day.minutes));
    const weeklyTotal = D.weekly.reduce((sum, day) => sum + day.minutes, 0);
    return `
      <div class="home">
        <div class="home-top">
          <article class="continue-card">
            <div class="continue-top">
              <div>
                <p class="continue-kicker">${icon('film')} 继续学习 · 42%</p>
                <h2>Morning <em>Light</em></h2>
                <p class="continue-zh">晨光之前 · 第 2 幕 · 河岸</p>
                <div class="continue-meta">
                  <span class="pill">日常对话 · 入门</span>
                  <span class="pill">SRT 字幕</span>
                  <span class="pill">12 句</span>
                  <span class="pill">5 个生词</span>
                </div>
              </div>
            </div>
            <div class="continue-bottom">
              <div class="progress-block">
                <div class="progress-labels"><span>本集进度</span><strong>5 / 12 句</strong></div>
                <div class="progress-track"><i class="progress-fill" style="width:42%"></i></div>
              </div>
              <button class="btn btn-amber" type="button" data-action="open-material" data-material="morning-light">继续学习 ${icon('arrow')}</button>
            </div>
          </article>

          <article class="card goal-card">
            <div class="goal-head">
              <h2>今日目标</h2>
              <span class="pill pill--green">已坚持 12 天</span>
            </div>
            <div class="goal-body">
              <div class="ring" style="--p:70">
                <div class="ring-copy"><strong>14</strong><span>/ 20 分钟</span></div>
              </div>
              <div class="goal-copy">
                <strong>还差 6 分钟</strong>
                <p>完成一小段字幕，就够今天的节奏。</p>
              </div>
            </div>
            <div class="goal-foot">${icon('flame')} 连续学习比一次学很久更重要</div>
          </article>
        </div>

        <div class="stat-strip">
          <article class="card stat-card">
            <span class="stat-icon stat-icon--green">${icon('book')}</span>
            <div class="stat-copy"><span>生词库</span><strong>${total}</strong></div>
            <span class="stat-delta">+2 本周</span>
          </article>
          <article class="card stat-card">
            <span class="stat-icon stat-icon--amber">${icon('check')}</span>
            <div class="stat-copy"><span>已掌握</span><strong>${mastered}</strong></div>
            <span class="stat-delta">${Math.round(mastered / total * 100)}%</span>
          </article>
          <article class="card stat-card">
            <span class="stat-icon stat-icon--blue">${icon('rotate')}</span>
            <div class="stat-copy"><span>今日复习</span><strong>8</strong></div>
            <span class="stat-delta">准确率 82%</span>
          </article>
          <article class="card stat-card">
            <span class="stat-icon">${icon('clock')}</span>
            <div class="stat-copy"><span>本周学习</span><strong>${(weeklyTotal / 60).toFixed(1)}<small>小时</small></strong></div>
            <span class="stat-delta">稳定</span>
          </article>
        </div>

        <div class="home-lower">
          <section class="card">
            <div class="section-head">
              <h2>最近加入</h2>
              <a class="more" href="#/vocabulary" data-nav="vocabulary">查看生词库 ${icon('chevron')}</a>
            </div>
            <div class="recent-list">
              ${recent.map((item) => {
                const entry = lookup(item.word);
                return `<div class="recent-row">
                  <div class="recent-word"><strong>${esc(item.word)}</strong><span>${esc(entry.ipa)} · ${esc(entry.zh)}</span></div>
                  ${statusPill(item)}
                  <button class="icon-btn mini-speak" type="button" data-action="speak-word" data-word="${attr(item.word)}" aria-label="朗读 ${attr(item.word)}">${icon('volume')}</button>
                </div>`;
              }).join('')}
            </div>
          </section>

          <section class="card">
            <div class="section-head">
              <h2>本周学习</h2>
              <a class="more" href="#/stats" data-nav="stats">学习统计 ${icon('chevron')}</a>
            </div>
            <div class="weekly">
              ${D.weekly.map((day) => `<div class="bar-col" title="${day.day} · ${day.minutes} 分钟">
                <i class="bar" style="--h:${Math.max(6, Math.round(day.minutes / weeklyMax * 100))}%"></i>
                <span class="bar-day">${day.day}</span>
              </div>`).join('')}
            </div>
            <div class="weekly-foot"><strong>${(weeklyTotal / 60).toFixed(1)} 小时</strong><span>比上周多 24 分钟</span></div>
          </section>
        </div>

        <section class="card daily-line">
          <span class="daily-quote" aria-hidden="true">“</span>
          <div class="daily-copy">
            <p class="daily-kicker">今日一句 · Morning Light</p>
            <p class="daily-en">Some mornings are worth slowing down for.</p>
            <p class="daily-zh">有些早晨，值得为它放慢脚步。</p>
          </div>
          <div class="daily-side">
            <span class="pill pill--amber">worth · 值得</span>
            <button class="btn btn-secondary btn-sm" type="button" data-action="open-material" data-material="morning-light">去跟读 ${icon('arrow')}</button>
          </div>
        </section>
      </div>`;
  }

  /* ——— Learning materials ——— */
  function materialStatusLabel(material) {
    if (!material.available) return material.preview ? '界面预览' : '待开发';
    return material.progress > 0 ? `已学 ${material.progress}%` : '未开始';
  }

  function materialActionLabel(material) {
    if (material.preview) return '阅读模式预览';
    if (!material.available) return '查看接入计划';
    return material.progress > 0 ? '继续学习' : '开始学习';
  }

  function materialCardHTML(material) {
    const planned = !material.available;
    const preview = Boolean(material.preview);
    const formatIcon = material.kind === 'subtitle' ? 'film' : material.kind === 'ebook' ? 'book' : 'file';
    const pillClass = planned ? (preview ? 'pill--amber' : 'pill--line') : 'pill--green';
    return `<article class="material-card ${planned ? 'is-planned' : ''}" data-material-card="${attr(material.id)}">
      <div class="material-cover" data-tone="${attr(material.tone)}">
        <span class="material-format">${esc(material.format)}</span>
        <span class="material-cover-icon">${icon(formatIcon)}</span>
        <span class="material-cover-note">${esc(material.typeLabel)}</span>
      </div>
      <div class="material-body">
        <div class="material-top">
          <span class="material-type">${esc(material.typeLabel)} · ${esc(material.level)}</span>
          <div class="material-top-actions">
            <span class="pill ${pillClass}">${materialStatusLabel(material)}</span>
            <button class="icon-btn material-delete" type="button" data-action="delete-material" data-material="${attr(material.id)}" aria-label="从资料库移除 ${attr(material.title)}">${icon('trash')}</button>
          </div>
        </div>
        <h3>${esc(material.title)}</h3>
        <p class="material-zh">${esc(material.zh)}</p>
        <div class="material-meta"><span>${esc(material.topic)}</span><span>${esc(material.meta)}</span></div>
        ${material.available ? `
          <div class="material-progress">
            <div><span>学习进度</span><span>${esc(material.updated)}</span></div>
            <div class="progress-track"><i style="width:${material.progress}%"></i></div>
          </div>` : `
          <p class="material-planned-note">${preview ? '章节与段落阅读可预览；文本解析待正式接入。' : '该格式的解析与阅读模式尚未开发。'}</p>
        `}
        <button class="btn ${material.available ? 'btn-primary' : 'btn-secondary'} material-open" type="button" data-action="open-material" data-material="${attr(material.id)}">
          ${materialActionLabel(material)} ${icon(material.available ? 'arrow' : preview ? 'book' : 'info')}
        </button>
      </div>
    </article>`;
  }

  function filteredMaterials() {
    const query = state.materialSearch.trim().toLowerCase();
    return state.materials.filter((material) => {
      if (state.materialFilter !== 'all' && material.category !== state.materialFilter) return false;
      if (!query) return true;
      return [material.title, material.zh, material.topic, material.typeLabel, material.format]
        .some((value) => value.toLowerCase().includes(query));
    });
  }

  function materialGridHTML(items) {
    if (!items.length) {
      return `<div class="material-empty">
        <span>${icon('search')}</span>
        <strong>没有找到匹配的资料</strong>
        <p>换个关键词，或清除筛选条件。</p>
        <button class="btn btn-secondary btn-sm" type="button" data-action="clear-material-search">清除搜索与筛选</button>
      </div>`;
    }
    return items.map(materialCardHTML).join('');
  }

  function materialsHTML() {
    const items = filteredMaterials();
    const counts = {
      all: state.materials.length,
      subtitle: state.materials.filter((item) => item.category === 'subtitle').length,
      article: state.materials.filter((item) => item.category === 'article').length,
      ebook: state.materials.filter((item) => item.category === 'ebook').length,
      pdf: state.materials.filter((item) => item.category === 'pdf').length
    };
    const ready = state.materials.filter((item) => item.available).length;
    const filters = [
      ['all', '全部'], ['subtitle', '字幕'], ['article', '文章'], ['ebook', '电子书'], ['pdf', 'PDF']
    ];
    return `<div class="materials-page">
      <section class="library-hero">
        <div class="library-hero-copy">
          <span class="library-kicker">${icon('library')} 学习资料库</span>
          <h2>从一段字幕，到一本长书。</h2>
          <p>把已经在学的影视字幕，和以后要读的文章、电子书放在同一个地方。继续学习时，查词、朗读和 AI Tutor 都会跟着内容走。</p>
          <div class="library-summary">
            <span><strong>${ready}</strong> 份可学习</span>
            <span><strong>${state.materials.length - ready}</strong> 种格式待接入</span>
            <span><strong>2</strong> 种字幕格式已支持</span>
          </div>
          <div class="library-formats" aria-label="资料格式支持状态">
            <span class="format-chip is-ready">SRT 可用</span>
            <span class="format-chip is-ready">VTT 可用</span>
            <span class="format-chip">TXT 待开发</span>
            <span class="format-chip">Markdown 待开发</span>
            <span class="format-chip">EPUB 待开发</span>
            <span class="format-chip">PDF 待开发</span>
          </div>
        </div>
        <aside class="library-import-card">
          <span class="import-card-icon">${icon('upload')}</span>
          <div class="import-card-copy">
            <strong>导入新的学习资料</strong>
            <p>当前可直接导入 SRT / VTT 字幕。</p>
          </div>
          <button class="btn btn-amber" type="button" data-action="open-import">${icon('plus')} 导入资料</button>
          <small>${icon('shield')} 文件只在本机处理；原型不会读取或上传文件。</small>
        </aside>
      </section>

      <div class="library-toolbar">
        <div class="segmented" role="group" aria-label="按资料类型筛选">
          ${filters.map(([value, label]) => `<button class="segment ${state.materialFilter === value ? 'is-active' : ''}" type="button" data-action="material-filter" data-filter="${value}">${label} ${counts[value]}</button>`).join('')}
        </div>
        <div class="vocab-search library-search">${icon('search')}<input id="materialSearch" type="search" value="${attr(state.materialSearch)}" placeholder="搜索标题、主题或格式" aria-label="搜索学习资料"></div>
      </div>

      <div class="library-meta"><strong id="materialMetaCount">${items.length}</strong><span>份资料 · 仅展示原创模拟内容</span></div>
      <div class="material-grid" id="materialGrid">${materialGridHTML(items)}</div>
      <p class="library-note">${icon('info')} TXT、Markdown、EPUB 和 PDF 目前只在资料库中展示规划状态，尚未接入解析器或阅读入口。</p>
    </div>`;
  }

  function renderMaterialsGrid() {
    const grid = $('#materialGrid');
    if (!grid) return;
    const items = filteredMaterials();
    grid.innerHTML = materialGridHTML(items);
    const count = $('#materialMetaCount');
    if (count) count.textContent = String(items.length);
  }

  function openFormatInfo(material) {
    const descriptions = {
      MD: 'Markdown 资料将按标题、章节和段落阅读，复用查词、朗读和 AI Tutor。当前只展示资料管理设计，尚未开发 Markdown 解析。',
      EPUB: 'EPUB 电子书将按目录和章节阅读。当前只展示资料管理设计，尚未开发电子书解析、目录提取与章节导航。',
      PDF: '仅计划支持可提取文字的 PDF；扫描版不纳入本阶段。当前尚未开发 PDF 文本提取与分页阅读。'
    };
    openModal(`<div class="dialog-head">
      <span class="dialog-mark">${icon('file')}</span>
      <div><h2>${esc(material.format)} 阅读将于后续接入</h2><p>${esc(material.title)} · ${esc(material.zh)}</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <div class="planned-callout"><span class="pill pill--amber">待开发</span><p>${esc(descriptions[material.format] || '该格式尚未接入。')}</p></div>
      <div class="dialog-list">
        <div><strong>已有基础</strong><span>资料卡片、分类、查词、朗读、AI Tutor 和阅读进度将复用现有能力。</span></div>
        <div><strong>仍需后端</strong><span>文件解码、格式解析、章节/段落模型、数据库迁移和导入校验。</span></div>
      </div>
      <p class="dialog-note">${icon('info')} 这是功能规划说明，不代表该格式已经可以导入。</p>
    </div>
    <div class="dialog-foot"><button class="btn btn-primary" type="button" data-action="close-modal">知道了</button></div>`, '格式接入说明');
  }

  function openDeleteDialog(material) {
    openModal(`<div class="dialog-head">
      <span class="dialog-mark dialog-mark--danger">${icon('trash')}</span>
      <div><h2>从资料库移除？</h2><p>${esc(material.title)} · ${esc(material.zh)}</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <p class="dialog-copy">这个操作只会移除当前原型里的资料卡片，不会删除电脑上的原文件，也不会修改正式应用或学习记录。</p>
      <div class="dialog-note danger-note">${icon('info')} 原型状态在刷新页面后恢复。</div>
    </div>
    <div class="dialog-foot">
      <button class="btn btn-secondary" type="button" data-action="close-modal">取消</button>
      <button class="btn btn-danger" type="button" data-action="confirm-delete-material" data-material="${attr(material.id)}">移除资料</button>
    </div>`, '移除学习资料');
  }

  function deleteMaterial(id) {
    const material = materialById(id);
    if (!material) {
      closeModal();
      return;
    }
    state.materials = state.materials.filter((item) => item.id !== id);
    const remaining = subtitleEpisodes();
    if (material.episodeId && state.workbenchMode === 'subtitle' && state.episodeId === material.episodeId) {
      if (remaining.length) {
        state.episodeId = remaining[0].id;
        state.cueId = flatCues(remaining[0])[0].id;
      }
    }
    closeModal();
    if (state.route === 'materials') render();
    toast(`已从原型资料库移除：${material.title}`);
  }

  function openImportModal() {
    openModal(`<div class="dialog-head">
      <span class="dialog-mark">${icon('upload')}</span>
      <div><h2>导入学习资料</h2><p>影视字幕现在可用，文章与电子书格式后续接入。</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <label class="import-drop" for="importFile">
        <span class="import-drop-icon">${icon('upload')}</span>
        <strong>选择 SRT / VTT 文件</strong>
        <span class="import-drop-sub">正式应用会在本机解析字幕；本原型只演示选择流程，不读取文件内容。</span>
        <span class="btn btn-primary btn-sm">选择字幕文件</span>
        <input id="importFile" type="file" accept=".srt,.vtt" hidden>
      </label>
      <p class="import-selected" id="importSelected" aria-live="polite">尚未选择文件</p>
      <div class="import-formats">
        <span class="format-chip is-ready">SRT · 已支持</span>
        <span class="format-chip is-ready">VTT · 已支持</span>
        <span class="format-chip">TXT · 待开发</span>
        <span class="format-chip">Markdown · 待开发</span>
        <span class="format-chip">EPUB · 待开发</span>
        <span class="format-chip">PDF · 待开发</span>
      </div>
      <div class="dialog-note">${icon('shield')} 不联网、不上传、不读取真实字幕；正式导入仍沿用 V0.1 的本地 SRT/VTT 能力。</div>
    </div>
    <div class="dialog-foot"><button class="btn btn-secondary" type="button" data-action="close-modal">关闭</button></div>`, '导入学习资料');
  }

  function openMaterial(id) {
    const material = materialById(id);
    if (!material) return;
    if (material.episodeId) {
      const episode = D.episodes.find((item) => item.id === material.episodeId);
      if (!episode) return;
      state.workbenchMode = 'subtitle';
      if (state.episodeId !== episode.id) {
        state.episodeId = episode.id;
        state.cueId = flatCues(episode)[0].id;
      }
      closeModal();
      navigate('workbench', episode.id);
      return;
    }
    if (material.preview) {
      const article = D.articles.find((item) => item.id === material.id);
      if (!article) return;
      state.workbenchMode = 'article';
      state.articleId = article.id;
      state.paragraphId = article.chapters[0].paragraphs[0].id;
      closeModal();
      navigate('workbench', article.id);
      return;
    }
    openFormatInfo(material);
  }

  function episodeItem(episode) {
    const active = episode.id === state.episodeId;
    return `<button class="episode-item ${active ? 'is-active' : ''}" type="button" data-action="switch-episode" data-episode="${attr(episode.id)}" data-tone="${attr(episode.tone)}">
      <span class="episode-thumb">${icon('film')}</span>
      <span class="episode-copy">
        <strong>${esc(episode.title)}</strong>
        <span>${esc(episode.format)} · ${esc(episode.zh)} · ${esc(episode.level)}</span>
        <span>${esc(episode.note)}</span>
        <span class="episode-progress"><i style="width:${Math.round(episode.progress * 100)}%"></i></span>
      </span>
    </button>`;
  }

  function cueHTML(cue) {
    return `<div class="cue ${cue.id === state.cueId ? 'is-active' : ''}" data-cue-row="${attr(cue.id)}">
      <button class="cue-time" type="button" data-action="jump" data-cue="${attr(cue.id)}" aria-label="跳到 ${attr(cue.time)}">${esc(cue.time)}</button>
      <p class="cue-text">${wordize(cue.text)}</p>
    </div>`;
  }

  function aiHTML() {
    const rows = state.aiMessages.map((message) => {
      if (message.role === 'user') {
        return `<div class="msg msg--user"><div class="msg-bubble">${esc(message.text)}</div></div>`;
      }
      return `<div class="msg"><span class="msg-avatar">${icon('spark')}</span><div class="msg-bubble">${esc(message.text)}</div></div>`;
    });
    if (state.thinking) {
      rows.push(`<div class="msg"><span class="msg-avatar">${icon('spark')}</span><div class="msg-bubble"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
    }
    return rows.join('');
  }

  function tutorPaneHTML(passage, unit = '这句') {
    const cloudOn = state.settings.cloudEnabled;
    return `<aside class="pane tutor-pane">
      <div class="tutor-head">
        <span class="tutor-mark">${icon('spark')}</span>
        <div class="tutor-title"><strong>AI Tutor</strong><span><i class="${cloudOn ? '' : 'is-off'}"></i>${cloudOn ? '模拟回复 · 不联网' : '云端已关闭 · 本地演示'}</span></div>
        <button class="icon-btn" type="button" data-action="chat-history" aria-label="查看会话历史">${icon('clock')}</button>
        <button class="icon-btn" type="button" data-nav="settings" aria-label="AI 模型设置">${icon('settings')}</button>
      </div>
      <div class="tutor-body">
        <div class="context-card"><span>${isArticleMode() ? '当前段落' : '当前语境'}</span><p id="contextText">${esc(passage.text)}</p></div>
        <div class="ai-messages" id="aiMessages" aria-live="polite">${aiHTML()}</div>
        <div class="chips">
          <button class="chip" type="button" data-action="prompt" data-prompt="解释当前${unit}">解释${unit}</button>
          <button class="chip" type="button" data-action="prompt" data-prompt="给我一个例句">给我例句</button>
          <button class="chip" type="button" data-action="prompt" data-prompt="翻译当前${unit}">帮我翻译</button>
          <button class="chip" type="button" data-action="prompt" data-prompt="纠正我的表达">纠正表达</button>
        </div>
        <form class="ai-composer" id="aiForm">
          <label class="sr-only" for="aiInput">向 AI Tutor 提问</label>
          <textarea class="ai-input" id="aiInput" rows="1" placeholder="问问${unit}的用法…"></textarea>
          <button class="ai-send" type="submit" aria-label="发送">${icon('send')}</button>
        </form>
        <p class="ai-note">模拟回复 · 不连接网络 · 不发送学习数据</p>
      </div>
    </aside>`;
  }

  function subtitleWorkbenchHTML() {
    const episode = currentEpisode();
    const cues = flatCues(episode);
    const cue = currentCue();
    const index = Math.max(0, cues.findIndex((item) => item.id === cue.id));
    const episodes = subtitleEpisodes();
    return `<div class="workbench">
      <section class="pane episode-pane">
        <div class="pane-head"><h2>学习资料</h2><a class="pane-link" href="#/materials" data-nav="materials">全部 ${icon('chevron')}</a></div>
        <div class="episode-list">${episodes.map(episodeItem).join('')}</div>
        <div class="pane-foot pane-foot--action">
          <button class="pane-action" type="button" data-action="open-candidates">${icon('book')} 本集词汇候选</button>
          <span>${episodes.length} 份字幕</span>
        </div>
      </section>

      <section class="pane reader-pane">
        <div class="reader-head">
          <div class="reader-title">
            <h2>${esc(episode.title)} <span>${esc(episode.zh)}</span></h2>
            <p>${esc(episode.format)} · ${esc(episode.note)} · ${cues.length} 句 · ${esc(episode.level)}</p>
          </div>
          <div class="reader-controls">
            <button class="btn btn-secondary btn-sm reader-speak" type="button" data-action="speak-cue" aria-label="朗读当前句子">${icon('volume')}<span>朗读本句</span></button>
            <span class="reader-time" id="readerTime">${esc(cue.time)} / ${esc(episode.duration)}</span>
            <button class="icon-btn icon-btn--round" type="button" id="playBtn" data-action="play" aria-label="${state.playback.playing ? '暂停字幕' : '播放字幕'}">
              ${icon(state.playback.playing ? 'pause' : 'play', 'icon--fill')}
            </button>
          </div>
        </div>
        <div class="reader-progress"><i id="readerFill" style="width:${Math.round((index + 1) / cues.length * 100)}%"></i></div>
        <div class="cue-list" id="cueList">
          ${episode.scenes.map((scene) => `
            <div class="scene-head">${esc(scene.heading)} <span>${esc(scene.zh)}</span></div>
            ${scene.cues.map(cueHTML).join('')}
          `).join('')}
        </div>
        <div class="reader-tip">${icon('bookmark')} 点击任意英文单词查词；选中后可朗读、加入生词库或问 AI。</div>
      </section>

      ${tutorPaneHTML(cue, '这句')}
    </div>`;
  }

  function articleWorkbenchHTML() {
    const article = currentArticle();
    const chapter = currentChapter();
    const chapterIndex = article.chapters.findIndex((item) => item.id === chapter.id);
    const nextChapter = article.chapters[chapterIndex + 1];
    const chapterNumber = String(chapterIndex + 1).padStart(2, '0');
    return `<div class="workbench">
      <section class="pane outline-pane">
        <div class="pane-head"><h2>章节</h2><span class="sub">${article.chapters.length} 章</span></div>
        <div class="outline-list">
          ${article.chapters.map((item, index) => `<button class="outline-item ${item.id === chapter.id ? 'is-active' : ''}" type="button" data-action="go-chapter" data-chapter="${attr(item.id)}">
            <span class="outline-num">${String(index + 1).padStart(2, '0')}</span>
            <span class="outline-copy"><strong>${esc(item.title)}</strong><span>${esc(item.zh)}</span></span>
          </button>`).join('')}
        </div>
        <div class="outline-foot">
          <button class="outline-library" type="button" data-nav="materials">${icon('library')} 全部学习资料</button>
          <p>${icon('info')} 阅读模式界面预览</p>
        </div>
      </section>

      <section class="pane reader-pane article-reader">
        <div class="reader-head">
          <div class="reader-title">
            <h2>${esc(article.title)} <span>${esc(article.zh)}</span></h2>
            <p>${esc(article.format)} · 阅读模式预览 · 第 ${chapterIndex + 1} / ${article.chapters.length} 章</p>
          </div>
          <div class="reader-controls">
            <button class="btn btn-secondary btn-sm reader-speak" type="button" data-action="speak-passage" aria-label="朗读当前段落">${icon('volume')}<span>朗读本段</span></button>
          </div>
        </div>
        <div class="preview-banner">${icon('info')}<div><strong>界面预览</strong><span>${esc(article.notice)}</span></div></div>
        <div class="article-scroll" id="articleScroll">
          <article class="article-doc">
            <p class="article-chapter-kicker">CHAPTER ${chapterNumber} · READING PREVIEW</p>
            <h2 class="article-title">${esc(chapter.title)}</h2>
            <p class="article-chapter-zh">${esc(chapter.zh)}</p>
            <div class="article-rule"></div>
            <div class="article-body">
              ${chapter.paragraphs.map((paragraph, index) => `<div class="article-para ${paragraph.id === state.paragraphId ? 'is-active' : ''}" data-para-row="${attr(paragraph.id)}">
                <button class="para-mark" type="button" data-action="select-para" data-para="${attr(paragraph.id)}" aria-label="把第 ${index + 1} 段设为 AI 语境" title="设为 AI 语境">${index + 1}</button>
                <p>${wordize(paragraph.text)}</p>
              </div>`).join('')}
            </div>
            <div class="article-next">
              ${nextChapter
                ? `<span>下一章 · ${esc(nextChapter.zh)}</span><button class="btn btn-secondary btn-sm" type="button" data-action="go-chapter" data-chapter="${attr(nextChapter.id)}">继续阅读 ${icon('arrow')}</button>`
                : `<span>本章预览结束</span><button class="btn btn-secondary btn-sm" type="button" data-nav="materials">返回资料库 ${icon('arrow')}</button>`}
            </div>
          </article>
        </div>
        <div class="reader-tip">${icon('bookmark')} 点击单词查词；点击段号，把这一段设为 AI Tutor 的语境。</div>
      </section>

      ${tutorPaneHTML(currentParagraph(), '这段')}
    </div>`;
  }

  function workbenchHTML() {
    return isArticleMode() ? articleWorkbenchHTML() : subtitleWorkbenchHTML();
  }

  function afterWorkbenchRender() {
    if (isArticleMode()) {
      const articleScroll = $('#articleScroll');
      if (articleScroll) articleScroll.scrollTop = 0;
    } else {
      const active = $('.cue.is-active');
      if (active) requestAnimationFrame(() => active.scrollIntoView({ block: 'center' }));
    }
    const messages = $('#aiMessages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    if (state.pendingAsk) {
      const word = state.pendingAsk;
      state.pendingAsk = null;
      state.selectedWord = word;
      sendAi(`“${word}” 在这里是什么意思？`);
    }
  }

  function filteredVocab() {
    const query = state.search.trim().toLowerCase();
    return state.vocab.filter((item) => {
      if (state.filter !== 'all' && item.status !== state.filter) return false;
      if (!query) return true;
      const entry = lookup(item.word);
      return item.word.toLowerCase().includes(query)
        || entry.zh.toLowerCase().includes(query)
        || item.source.toLowerCase().includes(query);
    });
  }

  function vocabGridHTML(items) {
    if (!items.length) {
      return `<div class="vocab-empty"><strong>没有匹配的单词</strong>换个筛选条件，或回到字幕里点一个新词。</div>`;
    }
    return items.map((item) => {
      const entry = lookup(item.word);
      return `<article class="vocab-card" data-action="open-vocab-word" data-word="${attr(item.word)}">
        <div class="vocab-card-top">
          <div><h3><button class="vocab-open" type="button" data-action="open-vocab-word" data-word="${attr(item.word)}">${esc(item.word)}</button></h3><p class="ipa">${esc(entry.ipa)}</p></div>
          ${statusPill(item)}
        </div>
        <p class="zh">${esc(entry.zh)}</p>
        <div class="vocab-card-foot">
          <span>${esc(item.source)} · ${esc(item.added)}</span>
          <button class="icon-btn" type="button" data-action="speak-word" data-word="${attr(item.word)}" aria-label="朗读 ${attr(item.word)}">${icon('volume')}</button>
        </div>
      </article>`;
    }).join('');
  }

  function vocabularyHTML() {
    if (state.review) return reviewHTML();
    const items = filteredVocab();
    const all = state.vocab.length;
    const learning = state.vocab.filter((item) => item.status === 'learning').length;
    const mastered = state.vocab.filter((item) => item.status === 'mastered').length;
    return `<div class="vocab-page">
      <div class="vocab-toolbar">
        <div class="segmented" role="group" aria-label="筛选生词">
          <button class="segment ${state.filter === 'all' ? 'is-active' : ''}" type="button" data-action="filter" data-filter="all">全部 ${all}</button>
          <button class="segment ${state.filter === 'learning' ? 'is-active' : ''}" type="button" data-action="filter" data-filter="learning">学习中 ${learning}</button>
          <button class="segment ${state.filter === 'mastered' ? 'is-active' : ''}" type="button" data-action="filter" data-filter="mastered">已掌握 ${mastered}</button>
        </div>
        <div class="vocab-search">${icon('search')}<input id="vocabSearch" type="search" value="${attr(state.search)}" placeholder="搜索单词或释义" aria-label="搜索生词"></div>
        <button class="btn btn-primary" type="button" data-action="start-review">${icon('rotate')} 开始复习</button>
      </div>
      <div class="vocab-meta"><strong id="vocabMetaCount">${items.length}</strong><span>个单词 · 来自原创模拟字幕</span></div>
      <div class="vocab-grid" id="vocabGrid">${vocabGridHTML(items)}</div>
    </div>`;
  }

  function renderVocabGrid() {
    const grid = $('#vocabGrid');
    if (!grid) return;
    const items = filteredVocab();
    grid.innerHTML = vocabGridHTML(items);
    const count = $('#vocabMetaCount');
    if (count) count.textContent = String(items.length);
  }

  function reviewHTML() {
    const review = state.review;
    if (!review) return vocabularyHTML();
    if (review.done) {
      const total = review.queue.length;
      return `<div class="review-shell">
        <div class="review-top">
          <button class="back" type="button" data-action="exit-review">${icon('chevron')} 返回生词库</button>
          <span class="review-count">本轮完成</span>
        </div>
        <div class="card review-summary">
          <span class="summary-mark">${icon('check')}</span>
          <h2>这一轮完成了</h2>
          <p>复习了 ${total} 个词。下一轮会优先出现还不熟的词。</p>
          <div class="summary-grid">
            <div class="summary-cell"><strong>${review.results.good}</strong><span>认识</span></div>
            <div class="summary-cell"><strong>${review.results.hard}</strong><span>有点印象</span></div>
            <div class="summary-cell"><strong>${review.results.again}</strong><span>不认识</span></div>
          </div>
          <div class="summary-actions">
            <button class="btn btn-primary" type="button" data-action="restart-review">${icon('rotate')} 再来一轮</button>
            <button class="btn btn-secondary" type="button" data-action="exit-review">返回生词库</button>
          </div>
        </div>
      </div>`;
    }

    const word = review.queue[review.index];
    const entry = lookup(word);
    const example = exampleFor(word);
    return `<div class="review-shell">
      <div class="review-top">
        <button class="back" type="button" data-action="exit-review">${icon('chevron')} 返回生词库</button>
        <span class="review-count">${review.index + 1} / ${review.queue.length}</span>
      </div>
      <div class="review-bar"><i style="width:${Math.round(review.index / review.queue.length * 100)}%"></i></div>
      <div class="card review-card">
        <p class="review-kicker">复习 · 说出它的意思</p>
        <div class="review-word">${esc(word)}</div>
        <div class="review-ipa">${esc(entry.ipa)}</div>
        <button class="icon-btn" type="button" data-action="speak-word" data-word="${attr(word)}" aria-label="朗读 ${attr(word)}">${icon('volume')}</button>
        ${review.revealed ? `
          <div class="review-answer">
            <p class="zh">${esc(entry.zh)}</p>
            <p class="pos">${esc(entry.pos)}</p>
            <p class="review-ex">${esc(example.text)}<br><span>${esc(example.zh)}</span></p>
            <div class="review-ratings">
              <button class="rate-btn rate-btn--again" type="button" data-action="rate" data-rate="again">不认识<small>明天再来</small></button>
              <button class="rate-btn rate-btn--hard" type="button" data-action="rate" data-rate="hard">有点印象<small>继续复习</small></button>
              <button class="rate-btn rate-btn--good" type="button" data-action="rate" data-rate="good">认识<small>标记掌握</small></button>
            </div>
          </div>` : `
          <p class="review-hint">先在心里说出它的意思，再显示答案。</p>
          <button class="btn btn-secondary review-reveal" type="button" data-action="reveal">显示释义</button>
        `}
      </div>
    </div>`;
  }

  function statsHTML() {
    const total = state.vocab.length;
    const mastered = state.vocab.filter((item) => item.status === 'mastered').length;
    const learning = total - mastered;
    const mastery = Math.round(mastered / total * 100);
    const weeklyTotal = D.weekly.reduce((sum, day) => sum + day.minutes, 0);
    const weeklyMax = Math.max(...D.weekly.map((day) => day.minutes));
    return `<div class="stats-page">
      <div class="stats-tiles">
        <article class="card stats-tile"><span>累计学习</span><strong>6.5<small>小时</small></strong><em>本周 +4.8 小时</em></article>
        <article class="card stats-tile"><span>复习准确率</span><strong>82<small>%</small></strong><em>较上周 +4%</em></article>
        <article class="card stats-tile"><span>生词库</span><strong>${total}<small>词</small></strong><em>${learning} 个学习中</em></article>
        <article class="card stats-tile"><span>掌握率</span><strong>${mastery}<small>%</small></strong><em>${mastered} 个已掌握</em></article>
      </div>

      <div class="stats-row">
        <section class="card chart-card">
          <div class="section-head"><h2>最近 7 天学习时长</h2><span class="pill pill--line">共 ${weeklyTotal} 分钟</span></div>
          <div class="chart">
            ${D.weekly.map((day) => `<div class="chart-col" title="${day.day} · ${day.minutes} 分钟">
              <strong>${day.minutes}</strong>
              <i class="chart-bar" style="--h:${Math.max(5, Math.round(day.minutes / weeklyMax * 100))}%"></i>
              <span class="chart-day">${day.day}</span>
            </div>`).join('')}
          </div>
        </section>

        <section class="card donut-card">
          <div class="section-head"><h2>词汇掌握分布</h2><span class="pill pill--green">${mastery}%</span></div>
          <div class="donut-wrap">
            <div class="donut" style="--p:${mastery}">
              <div class="donut-center"><strong>${mastered}</strong><span>已掌握</span></div>
            </div>
            <div class="legend">
              <div class="legend-row"><i style="background:var(--pine)"></i>已掌握<span>${mastered}</span></div>
              <div class="legend-row"><i style="background:#ddb172"></i>学习中<span>${learning}</span></div>
              <div class="legend-row"><i style="background:#eee9dd"></i>待复习<span>0</span></div>
            </div>
          </div>
        </section>
      </div>

      <div class="stats-row">
        <section class="card heatmap-card">
          <div class="section-head"><h2>最近 5 周学习节奏</h2><span class="pill pill--line">颜色越深，学习越久</span></div>
          <div class="heatmap-layout">
            <div class="heatmap-block">
              <div class="heatmap">
                ${D.heatmap.map((level) => `<i class="heat" data-level="${level}"></i>`).join('')}
              </div>
              <div class="heatmap-days"><span>六</span><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span></div>
            </div>
            <div class="heatmap-stats">
              <div><strong>28</strong><span>天有学习记录</span></div>
              <div><strong>12</strong><span>最长连续天数</span></div>
              <div><strong>41</strong><span>日均分钟</span></div>
            </div>
          </div>
        </section>

        <section class="card activity-card">
          <div class="section-head"><h2>最近学习记录</h2><a class="more" href="#/workbench" data-nav="workbench">去学习 ${icon('chevron')}</a></div>
          <div class="activity-list">
            ${D.recentActivity.map((item) => `<div class="activity-row">
              <span class="activity-icon">${icon(item.kind === 'review' ? 'rotate' : item.kind === 'word' ? 'plus' : 'film')}</span>
              <div><strong>${esc(item.title)}</strong><span>${esc(item.meta)}</span></div>
            </div>`).join('')}
          </div>
        </section>
      </div>
    </div>`;
  }

  /* ——— Settings and dialogs ——— */
  function toggleHTML(key, checked, label) {
    return `<button class="toggle ${checked ? 'is-on' : ''}" type="button" role="switch" aria-checked="${checked}" data-action="toggle-setting" data-key="${attr(key)}" aria-label="${attr(label)}"><i></i><span>${checked ? '开启' : '关闭'}</span></button>`;
  }

  function settingsHTML() {
    const s = state.settings;
    return `<div class="settings-page">
      <section class="settings-hero">
        <div>
          <span class="settings-kicker">${icon('spark')} AI 模型</span>
          <h2>连接由你控制，发送前先看清楚。</h2>
          <p>保留 V0.1 的千问网关与钥匙串密钥管理，把模型、用量和发送授权放到一个可检查的设置页。原型不会读取真实密钥，也不会发起网络请求。</p>
        </div>
        <span class="cloud-state ${s.cloudEnabled ? 'is-on' : ''}" id="cloudState"><i></i>${s.cloudEnabled ? '云端 AI 已开启' : '云端 AI 已关闭'}</span>
      </section>

      <div class="settings-layout">
        <div class="settings-main">
          <section class="card settings-card">
            <div class="settings-card-head">
              <div><h2>服务连接</h2><p>默认展示当前使用的千问服务配置。</p></div>
              <span class="pill pill--line">设置页原型</span>
            </div>
            <div class="settings-fields">
              <div class="field">
                <span class="field-label">AI 服务提供商</span>
                <div class="field-static"><span class="provider-mark">${icon('spark')}</span><strong>通义千问 · DashScope</strong><span class="pill pill--green">当前</span></div>
                <p class="field-hint">本阶段仅支持当前供应商，不接入其他云端模型。</p>
              </div>
              <label class="field" for="settingsBaseUrl">
                <span class="field-label">API Base URL</span>
                <input class="field-input" id="settingsBaseUrl" type="url" value="${attr(s.baseUrl)}" spellcheck="false" autocomplete="off">
                <span class="field-hint">正式应用要求 HTTPS，并以 <code>/compatible-mode/v1</code> 结尾。</span>
              </label>
              <label class="field" for="settingsModel">
                <span class="field-label">模型名称</span>
                <input class="field-input" id="settingsModel" type="text" value="${attr(s.model)}" spellcheck="false" autocomplete="off">
                <span class="field-hint">当前默认 <code>qwen3.8-max</code>。正式后端尚无可选模型目录与可用性检查。</span>
              </label>
              <label class="field field--short" for="settingsMaxTokens">
                <span class="field-label">最大输出 Token</span>
                <select class="field-input" id="settingsMaxTokens">
                  ${[256, 512, 800, 1024, 2048, 4096].map((value) => `<option value="${value}" ${Number(s.maxTokens) === value ? 'selected' : ''}>${value}</option>`).join('')}
                </select>
                <span class="field-hint">正式默认 800，允许范围 1–4096。</span>
              </label>
            </div>

            <div class="key-status">
              <span class="key-icon">${icon('key')}</span>
              <div><strong>API Key</strong><span>正式应用保存在 macOS 钥匙串 · 原型仅显示脱敏状态 <b>••••••••</b></span></div>
              <span class="pill pill--green">${icon('shield')} 安全设计</span>
              <button class="btn btn-ghost btn-sm" type="button" data-action="key-note">管理密钥</button>
            </div>
            <p class="settings-disclaimer">${icon('info')} 原型不包含真实密钥输入，也不会把密钥写入 HTML、JavaScript 或浏览器本地存储。</p>

            <div class="toggle-row">
              <div><strong>允许云端 AI</strong><span>关闭后，Tutor 只显示本地演示回复，不发起任何云端请求。</span></div>
              ${toggleHTML('cloudEnabled', s.cloudEnabled, '允许云端 AI')}
            </div>

            <div class="settings-actions">
              <span class="settings-saved" id="settingsSaved">设置在原型会话内生效</span>
              <button class="btn btn-primary" type="button" data-action="save-settings">保存设置</button>
            </div>
          </section>

          <section class="card settings-card">
            <div class="settings-card-head">
              <div><h2>隐私与发送</h2><p>每次请求的语境和授权范围都可以检查。</p></div>
              <span class="pill pill--green">${icon('shield')} 本地优先</span>
            </div>
            <div class="toggle-row">
              <div><strong>发送前确认</strong><span>在正式应用中，发送前展示将要发送的语境、问题和预计用量。</span></div>
              ${toggleHTML('confirmBeforeSend', s.confirmBeforeSend, '发送前确认')}
            </div>
            <div class="send-rule-grid">
              <div><span>会发送</span><strong>当前字幕或段落、你的问题、模型参数</strong></div>
              <div><span>不会发送</span><strong>完整学习记录、生词库、API Key、本机路径</strong></div>
            </div>
            <div class="settings-inline-actions">
              <button class="btn btn-secondary" type="button" data-action="send-preview">${icon('file')} 查看发送预览</button>
              <span>预览不会发出请求。</span>
            </div>
          </section>
        </div>

        <aside class="settings-side">
          <section class="card side-card">
            <div class="side-card-head"><span class="side-icon side-icon--green">${icon('cloud')}</span><div><h2>连接测试</h2><p>检查配置是否完整</p></div></div>
            <div class="connection-status" id="connectionStatus">
              <i></i><span>${s.test === 'success' ? '连接成功（模拟）' : '尚未测试'}</span>
            </div>
            <button class="btn btn-secondary connection-button" id="connectionTestBtn" type="button" data-action="test-connection">${icon('rotate')} 测试连接</button>
            <p class="side-note">仅模拟界面状态，不发起网络请求。正式后端目前尚无模型连通性检查接口。</p>
          </section>

          <section class="card side-card">
            <div class="side-card-head"><span class="side-icon side-icon--amber">${icon('chart')}</span><div><h2>使用量与费用</h2><p>本机原型 · 模拟数据</p></div></div>
            <div class="usage-grid">
              <div><span>今日调用</span><strong>3<small>次</small></strong></div>
              <div><span>本月调用</span><strong>42<small>次</small></strong></div>
              <div><span>本月估算</span><strong>¥0.38</strong></div>
            </div>
            <div class="usage-meter"><i style="width:18%"></i></div>
            <p class="side-note">正式应用已有 <code>/ai/costs</code> 数据接口，但 V0.1 尚无用量页面；此卡用于恢复入口设计。</p>
          </section>

          <section class="card side-card">
            <div class="side-card-head"><span class="side-icon">${icon('shield')}</span><div><h2>本地数据与诊断</h2><p>学习记录不离开本机</p></div></div>
            <div class="data-row"><div><strong>本地诊断日志</strong><span>查看服务状态，不记录字幕正文。</span></div><button class="btn btn-ghost btn-sm" type="button" data-action="log-preview">查看</button></div>
            <div class="data-row"><div><strong>数据备份与恢复</strong><span>应用内导出尚未实现；目前只能手动备份数据库。</span></div><span class="pill pill--line">后续开发</span></div>
            <div class="data-row"><div><strong>学习记录</strong><span>保存在本机 SQLite，不随 AI 请求发送。</span></div><span class="pill pill--green">本机</span></div>
          </section>
        </aside>
      </div>
    </div>`;
  }

  function openModal(html, label, trigger = null) {
    const root = $('#modalRoot');
    state.modalTrigger = trigger || document.activeElement;
    root.innerHTML = `<div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${attr(label)}">${html}</section>
    </div>`;
    root.hidden = false;
    document.body.classList.add('modal-open');
    closePopover(false);
    const focusTarget = root.querySelector('[data-autofocus]') || root.querySelector('button');
    requestAnimationFrame(() => {
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    });
  }

  function closeModal(restoreFocus = true) {
    const root = $('#modalRoot');
    if (!root || root.hidden) return;
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
    if (restoreFocus && state.modalTrigger && document.contains(state.modalTrigger)) {
      state.modalTrigger.focus({ preventScroll: true });
    }
    state.modalTrigger = null;
  }

  function openKeyNote() {
    openModal(`<div class="dialog-head">
      <span class="dialog-mark">${icon('key')}</span>
      <div><h2>密钥保存在系统钥匙串</h2><p>原型只展示状态，不显示真实密钥。</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <p class="dialog-copy">正式应用通过 macOS 钥匙串保存千问 API Key。网页端不会读取、显示或写入密钥，也不会把密钥存进浏览器本地存储。</p>
      <div class="dialog-list">
        <div><strong>可以查看</strong><span>是否已配置、Key 的脱敏状态、最近一次连接测试结果。</span></div>
        <div><strong>不会展示</strong><span>完整 Key、请求头、系统凭据或本机钥匙串路径。</span></div>
      </div>
    </div>
    <div class="dialog-foot"><button class="btn btn-primary" type="button" data-action="close-modal">知道了</button></div>`, 'API Key 安全说明');
  }

  function openSendPreview() {
    const passage = currentPassage();
    const word = state.selectedWord;
    openModal(`<div class="dialog-head">
      <span class="dialog-mark">${icon('file')}</span>
      <div><h2>发送预览</h2><p>如果现在向 AI Tutor 提问，将发送这些内容。</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <div class="send-preview-card"><span>当前语境</span><p>${esc(passage.text)}</p></div>
      <div class="send-preview-card"><span>学习问题</span><p>${word ? `“${esc(word)}” 在这里怎么用？` : '帮我解释这段的意思和用法。'}</p></div>
      <div class="sent-meta-grid">
        <div><span>服务商</span><strong>${esc(state.settings.provider)}</strong></div>
        <div><span>模型</span><strong>${esc(state.settings.model)}</strong></div>
        <div><span>最大输出</span><strong>${esc(state.settings.maxTokens)} token</strong></div>
        <div><span>云端 AI</span><strong>${state.settings.cloudEnabled ? '已开启' : '已关闭'}</strong></div>
      </div>
      <div class="privacy-checklist">
        <span>${icon('check')} 只发送当前语境和问题</span>
        <span>${icon('check')} 不发送完整学习记录</span>
        <span>${icon('check')} 不发送 API Key 或本机路径</span>
      </div>
      <p class="dialog-note">${icon('info')} 这是授权流程的界面演示，原型不会发出任何请求。</p>
    </div>
    <div class="dialog-foot">
      <span class="dialog-foot-note">发送前确认：${state.settings.confirmBeforeSend ? '已开启' : '已关闭'}</span>
      <button class="btn btn-primary" type="button" data-action="close-modal">关闭预览</button>
    </div>`, 'AI 发送预览');
  }

  function openLogPreview() {
    openModal(`<div class="dialog-head">
      <span class="dialog-mark">${icon('file')}</span>
      <div><h2>本地诊断日志</h2><p>原型示例，不会读取真实日志文件。</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <div class="log-preview">
        <div><span>10:42:08</span><em class="log-ok">INFO</em><p>本地服务已启动</p></div>
        <div><span>10:42:19</span><em class="log-ok">INFO</em><p>字幕格式校验通过</p></div>
        <div><span>10:45:03</span><em class="log-warn">WARN</em><p>云端 AI 请求已阻止：发送前未确认</p></div>
        <div><span>10:46:31</span><em class="log-ok">INFO</em><p>学习记录已保存到本机</p></div>
      </div>
      <p class="dialog-note">${icon('shield')} 日志不记录字幕正文、个人路径、API Key 或账号信息；正式入口沿用 V0.1 的本地诊断日志。</p>
    </div>
    <div class="dialog-foot"><button class="btn btn-secondary" type="button" data-action="close-modal">关闭</button></div>`, '本地诊断日志');
  }

  function testConnection() {
    const button = $('#connectionTestBtn');
    const status = $('#connectionStatus');
    const base = $('#settingsBaseUrl');
    const url = base ? base.value.trim() : state.settings.baseUrl;
    if (!url) {
      if (status) {
        status.classList.add('is-error');
        status.querySelector('span').textContent = '请先填写 API Base URL';
      }
      toast('请先填写 API Base URL');
      return;
    }
    state.settings.test = 'testing';
    if (status) {
      status.classList.remove('is-error', 'is-success');
      status.querySelector('span').textContent = '正在检查配置…';
    }
    if (button) {
      button.disabled = true;
      button.innerHTML = `${icon('rotate')} 测试中…`;
    }
    setTimeout(() => {
      state.settings.test = 'success';
      if (state.route === 'settings') {
        const currentStatus = $('#connectionStatus');
        const currentButton = $('#connectionTestBtn');
        if (currentStatus) {
          currentStatus.classList.add('is-success');
          currentStatus.querySelector('span').textContent = '连接成功（模拟）';
        }
        if (currentButton) {
          currentButton.disabled = false;
          currentButton.innerHTML = `${icon('rotate')} 测试连接`;
        }
      }
      toast('配置检查完成 · 原型未发出网络请求');
    }, 720);
  }

  function toggleSetting(key) {
    if (!(key in state.settings)) return;
    state.settings[key] = !state.settings[key];
    const button = $(`.toggle[data-key="${key}"]`);
    if (button) {
      button.classList.toggle('is-on', state.settings[key]);
      button.setAttribute('aria-checked', String(state.settings[key]));
      const label = button.querySelector('span');
      if (label) label.textContent = state.settings[key] ? '开启' : '关闭';
    }
    if (key === 'cloudEnabled') {
      const cloud = $('#cloudState');
      if (cloud) {
        cloud.classList.toggle('is-on', state.settings.cloudEnabled);
        cloud.innerHTML = `<i></i>${state.settings.cloudEnabled ? '云端 AI 已开启' : '云端 AI 已关闭'}`;
      }
      toast(state.settings.cloudEnabled ? '云端 AI 已开启（原型状态）' : '云端 AI 已关闭：Tutor 将使用本地演示回复');
    } else {
      toast('设置已更新（原型状态）');
    }
  }

  function saveSettings() {
    const base = $('#settingsBaseUrl');
    const model = $('#settingsModel');
    const maxTokens = $('#settingsMaxTokens');
    if (base) state.settings.baseUrl = base.value.trim();
    if (model) state.settings.model = model.value.trim();
    if (maxTokens) state.settings.maxTokens = Number(maxTokens.value);
    const saved = $('#settingsSaved');
    if (saved) saved.textContent = '已保存在当前原型会话';
    toast('设置已保存（仅当前原型会话）');
  }

  function selectParagraph(id) {
    const paragraph = articleParagraphs().find((item) => item.id === id);
    if (!paragraph) return;
    state.paragraphId = paragraph.id;
    $$('.article-para').forEach((row) => row.classList.toggle('is-active', row.dataset.paraRow === paragraph.id));
    const context = $('#contextText');
    if (context) context.textContent = paragraph.text;
    toast('已设为 AI 语境');
  }

  function selectChapter(id) {
    const chapter = currentArticle().chapters.find((item) => item.id === id);
    if (!chapter) return;
    state.paragraphId = chapter.paragraphs[0].id;
    closePopover(false);
    render();
  }

  /* ——— Vocabulary candidates and chat history ——— */
  const STOP_WORDS = new Set(('a an the and or but if of to in on at for with by as is are was were be been ' +
    'being it this that these those i you he she we they me him her us them my your his its our their ' +
    'do does did not no so too very can will just up out from when while though before after then there ' +
    'here what how who why').split(' '));

  function rankedCandidates(episode = currentEpisode()) {
    const counts = new Map();
    for (const scene of episode.scenes) {
      for (const cue of scene.cues) {
        const words = cue.text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
        for (const match of words) {
          const key = match.toLowerCase().replace(/’/g, "'");
          if (STOP_WORDS.has(key) || key.length < 2) continue;
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    return Array.from(counts.entries())
      .map(([word, count]) => ({ word, count, entry: lookup(word) }))
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  }

  function filteredCandidates() {
    const query = state.candidateSearch.trim().toLowerCase();
    return rankedCandidates().filter((item) => {
      if (!query) return true;
      return item.word.includes(query) || item.entry.zh.toLowerCase().includes(query);
    });
  }

  function candidateListHTML(items) {
    if (!items.length) {
      return `<div class="candidate-empty"><strong>没有匹配的候选词</strong><span>换个关键词试试。</span></div>`;
    }
    return items.map((item) => {
      const inLibrary = state.vocab.some((entry) => entry.word === item.word);
      return `<div class="candidate-row" data-candidate-word="${attr(item.word)}">
        <div class="candidate-main">
          <div><strong>${esc(item.word)}</strong><span class="candidate-ipa">${esc(item.entry.ipa)}</span><span class="candidate-pos">${esc(item.entry.pos)}</span></div>
          <p>${esc(item.entry.zh)}</p>
        </div>
        <span class="candidate-freq">出现 ${item.count} 次</span>
        <button class="icon-btn candidate-speak" type="button" data-action="speak-word" data-word="${attr(item.word)}" aria-label="朗读 ${attr(item.word)}">${icon('volume')}</button>
        <button class="btn btn-secondary btn-sm candidate-add" type="button" data-action="add-word" data-word="${attr(item.word)}" ${inLibrary ? 'disabled' : ''}>${inLibrary ? `${icon('check')} 已加入` : `${icon('plus')} 加入`}</button>
      </div>`;
    }).join('');
  }

  function renderCandidateList() {
    const list = $('#candidateList');
    if (!list) return;
    const items = filteredCandidates();
    list.innerHTML = candidateListHTML(items);
    const count = $('#candidateCount');
    if (count) count.textContent = String(items.length);
  }

  function openCandidates() {
    if (isArticleMode()) return;
    state.candidateSearch = '';
    const items = filteredCandidates();
    const episode = currentEpisode();
    openModal(`<div class="dialog-head">
      <span class="dialog-mark">${icon('book')}</span>
      <div><h2>词汇候选与词频</h2><p>${esc(episode.title)} · ${esc(episode.zh)}</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <div class="candidate-toolbar">
        <div class="vocab-search candidate-search">${icon('search')}<input id="candidateSearch" type="search" value="" placeholder="搜索候选词或释义" aria-label="搜索词汇候选"></div>
        <span class="candidate-total"><strong id="candidateCount">${items.length}</strong> 个候选词</span>
      </div>
      <div class="candidate-list" id="candidateList">${candidateListHTML(items)}</div>
      <p class="dialog-note">${icon('info')} 按出现次数排序，已过滤常见功能词；释义与音标来自原型本地词典。</p>
    </div>
    <div class="dialog-foot"><button class="btn btn-secondary" type="button" data-action="close-modal">关闭</button></div>`, '词汇候选与词频');
  }

  const CHAT_HISTORY = [
    {
      id: 'morning', title: '早晨的表达', meta: '今天 · Morning Light', preview: '“catch my breath” 在这里是喘口气。',
      messages: [
        { role: 'user', text: '“catch my breath” 在这里是什么意思？' },
        { role: 'ai', text: '“catch my breath” 字面是“接住呼吸”，语境里就是停下来喘口气、缓一缓。\n\nI usually stop here to catch my breath.\n我通常会在这里停下来喘口气。' }
      ]
    },
    {
      id: 'interview', title: '面试里的压力', meta: '10月28日 · The Interview', preview: 'handle pressure 是“应对压力”，不是“处理压力的人”。',
      messages: [
        { role: 'user', text: 'handle pressure 怎么用？' },
        { role: 'ai', text: 'handle 是动词，表示“应对、处理”；pressure 是不可数名词。\n\nShe asked how I handle pressure at work.\n她问我如何应对工作中的压力。\n\n试试换成 “handle a difficult question”。' }
      ]
    },
    {
      id: 'rooftop', title: '屋顶花园', meta: '10月29日 · Rooftop Club', preview: 'fixed the old bench 用的是过去式。',
      messages: [
        { role: 'user', text: '为什么这里用 fixed？' },
        { role: 'ai', text: '这是发生在过去的一次动作，所以用过去式 fixed。\n\nMaya planted tomatoes while I fixed the old bench.\n玛雅种西红柿，我修那张旧长椅。\n\nwhile 连接两个同时发生的动作。' }
      ]
    }
  ];

  function openChatHistory() {
    openModal(`<div class="dialog-head">
      <span class="dialog-mark">${icon('clock')}</span>
      <div><h2>会话历史</h2><p>原型会话示例，不会读取真实聊天记录。</p></div>
      <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭" data-autofocus>${icon('close')}</button>
    </div>
    <div class="dialog-body">
      <div class="history-list">
        ${CHAT_HISTORY.map((item) => `<button class="history-row" type="button" data-action="load-chat" data-chat="${attr(item.id)}">
          <span class="history-icon">${icon('spark')}</span>
          <span class="history-copy"><strong>${esc(item.title)}</strong><span>${esc(item.meta)}</span><em>${esc(item.preview)}</em></span>
          ${icon('chevron')}
        </button>`).join('')}
      </div>
      <p class="dialog-note">${icon('shield')} 正式应用会把会话保存在本机 SQLite；当前原型只切换本地示例内容。</p>
    </div>
    <div class="dialog-foot">
      <button class="btn btn-secondary" type="button" data-action="new-chat">新建会话</button>
      <button class="btn btn-primary" type="button" data-action="close-modal">关闭</button>
    </div>`, '会话历史');
  }

  function loadChat(id) {
    const history = CHAT_HISTORY.find((item) => item.id === id);
    if (!history) return;
    state.aiMessages = history.messages.map((message) => ({ ...message }));
    state.selectedWord = null;
    state.thinking = false;
    closeModal();
    if (state.route === 'workbench') render();
    toast(`已打开原型会话：${history.title}`);
  }

  function newChat() {
    state.aiMessages = [{
      role: 'ai',
      text: '你好，我是你的 AI Tutor。\n点一句字幕或一个单词，我们从语境开始。'
    }];
    state.selectedWord = null;
    state.thinking = false;
    closeModal();
    if (state.route === 'workbench') render();
    toast('已开始新的原型会话');
  }

  /* ——— Navigation / playback ——— */
  function resetRouteFromHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const allowed = ['home', 'materials', 'workbench', 'vocabulary', 'stats', 'settings'];
    const route = allowed.includes(parts[0]) ? parts[0] : 'home';
    state.route = route;
    if (route === 'workbench') {
      const episode = D.episodes.find((item) => item.id === parts[1]);
      const article = D.articles.find((item) => item.id === parts[1]);
      if (episode) {
        state.workbenchMode = 'subtitle';
        state.episodeId = episode.id;
        if (!flatCues().some((cue) => cue.id === state.cueId)) state.cueId = flatCues()[0].id;
      } else if (article) {
        state.workbenchMode = 'article';
        state.articleId = article.id;
        if (!articleParagraphs().some((paragraph) => paragraph.id === state.paragraphId)) {
          state.paragraphId = article.chapters[0].paragraphs[0].id;
        }
      }
    }
    render();
  }

  function navigate(route, sub = null) {
    const hash = `#/${route}${sub ? `/${sub}` : ''}`;
    if (location.hash === hash) {
      resetRouteFromHash();
      return;
    }
    if (state.route === route && !sub) {
      render();
      return;
    }
    stopPlayback();
    closePopover(false);
    closeModal(false);
    if (route !== 'vocabulary') state.review = null;
    state.route = route;
    location.hash = hash;
  }

  function switchEpisode(id) {
    const target = D.episodes.find((episode) => episode.id === id);
    if (!target) return;
    stopPlayback();
    closePopover(false);
    state.workbenchMode = 'subtitle';
    state.episodeId = id;
    state.cueId = flatCues(target)[0].id;
    state.selectedWord = null;
    render();
  }

  function updateReaderMeta() {
    const episode = currentEpisode();
    const cues = flatCues(episode);
    const cue = currentCue();
    const index = Math.max(0, cues.findIndex((item) => item.id === cue.id));
    const time = $('#readerTime');
    if (time) time.textContent = `${cue.time} / ${episode.duration}`;
    const fill = $('#readerFill');
    if (fill) fill.style.width = `${Math.round((index + 1) / cues.length * 100)}%`;
    const context = $('#contextText');
    if (context) context.textContent = cue.text;
  }

  function selectCue(id, shouldScroll = true) {
    state.cueId = id;
    $$('.cue').forEach((row) => row.classList.toggle('is-active', row.dataset.cueRow === id));
    updateReaderMeta();
    if (shouldScroll) {
      const active = $('.cue.is-active');
      if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function setPlayButton() {
    const button = $('#playBtn');
    if (!button) return;
    button.innerHTML = icon(state.playback.playing ? 'pause' : 'play', 'icon--fill');
    button.setAttribute('aria-label', state.playback.playing ? '暂停字幕' : '播放字幕');
  }

  function stopPlayback() {
    if (state.playback.timer) clearInterval(state.playback.timer);
    state.playback.timer = null;
    state.playback.playing = false;
    setPlayButton();
  }

  function togglePlayback() {
    if (state.playback.playing) {
      stopPlayback();
      return;
    }
    const cues = flatCues();
    let index = cues.findIndex((cue) => cue.id === state.cueId);
    if (index >= cues.length - 1) index = -1;
    closePopover(false);
    state.playback.playing = true;
    setPlayButton();
    state.playback.timer = setInterval(() => {
      const list = flatCues();
      const current = list.findIndex((cue) => cue.id === state.cueId);
      if (current >= list.length - 1) {
        stopPlayback();
        toast('本集播放完毕');
        return;
      }
      selectCue(list[current + 1].id);
    }, 2600);
  }

  /* ——— AI Tutor ——— */
  function renderAiMessages() {
    const box = $('#aiMessages');
    if (!box) return;
    box.innerHTML = aiHTML();
    box.scrollTop = box.scrollHeight;
  }

  function generateReply(prompt) {
    const cue = currentPassage();
    const word = state.selectedWord;
    const entry = word ? lookup(word) : null;
    const example = word ? exampleFor(word) : null;
    const unit = isArticleMode() ? '这段' : '这句';

    if (/翻译/.test(prompt)) {
      return `${unit}可以译为：\n${cue.zh}\n\n语气比较平静，像是在记录一个日常瞬间。`;
    }
    if (/例句/.test(prompt)) {
      if (word) return `“${word}” 的一个例句：\n${example.text}\n${example.zh}\n\n把时间或地点换掉，再说一遍。`;
      return `用当前${unit}做模板：\n${cue.text}\n\n把主语换成 “I”，再描述你今天的某个时刻。`;
    }
    if (/发音|怎么读/.test(prompt) && entry) {
      if (entry.pronunciations && entry.pronunciations.length > 1) {
        return `“${word}” 有 ${entry.pronunciations.length} 种常见读法：\n${entry.pronunciations.map((item) => `${item.label} ${item.ipa} · ${item.zh}`).join('\n')}\n\n先根据词性判断该读哪一种。`;
      }
      return `“${word}” 的美式音标是 ${entry.ipa}。\n先慢读两遍，再把重音放到标记的位置。`;
    }
    if (/纠正|语法/.test(prompt)) {
      return `把你写的英文发给我，我会从时态、介词和搭配三处检查。\n先借用当前${unit}的结构：\n${cue.text}`;
    }
    if (/解释/.test(prompt)) {
      return `${unit}在说：${cue.zh}\n\n${word ? `注意 “${word}”（${entry.zh}）在语境里的具体含义。` : '先找主语和谓语，再看时间或转折。'}跟读一遍，再遮住中文复述。`;
    }
    if (word && entry) {
      const reading = entry.pronunciations && entry.pronunciations.length > 1
        ? `（${entry.pronunciations.map((item) => item.ipa).join(' / ')}）`
        : entry.ipa;
      return `“${word}” ${reading} · ${entry.zh}\n在这里：${example.text}\n${example.zh}\n\n试着用它造一句和你自己有关的句子？`;
    }
    return `我们从当前${unit}开始：\n“${cue.text}”\n${cue.zh}\n\n先找出主语和动词，再试着自己复述一遍。`;
  }

  function sendAi(raw) {
    const text = String(raw || '').trim();
    if (!text || state.thinking) return;
    state.aiMessages.push({ role: 'user', text });
    state.thinking = true;
    const input = $('#aiInput');
    if (input) input.value = '';
    renderAiMessages();
    setTimeout(() => {
      state.aiMessages.push({ role: 'ai', text: generateReply(text) });
      state.thinking = false;
      renderAiMessages();
    }, 620);
  }

  /* ——— Word card ——— */
  function positionPopover(anchor) {
    popover.hidden = false;
    const gap = 8;
    const rect = anchor.getBoundingClientRect();
    const pane = anchor.closest('.reader-pane') || anchor.closest('.vocab-page') || anchor.closest('.review-card');
    let bounds = { left: 12, right: window.innerWidth - 12, top: 12, bottom: window.innerHeight - 12 };
    if (pane) {
      const paneRect = pane.getBoundingClientRect();
      bounds = {
        left: paneRect.left + 10,
        right: paneRect.right - 10,
        top: Math.max(12, paneRect.top + 8),
        bottom: Math.min(window.innerHeight - 12, paneRect.bottom - 8)
      };
    }
    const width = Math.min(popover.offsetWidth, Math.max(260, bounds.right - bounds.left));
    popover.style.width = `${Math.round(width)}px`;
    const height = popover.offsetHeight;
    let left = Math.min(Math.max(bounds.left, rect.left), bounds.right - width);
    let top = rect.bottom + gap;
    if (top + height > bounds.bottom) top = rect.top - height - gap;
    top = Math.max(bounds.top, Math.min(top, bounds.bottom - height));
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function openWord(word, anchor, cueOverride = null) {
    const entry = lookup(word);
    let cue = cueOverride;
    if (!cue && isArticleMode()) {
      const row = anchor && anchor.closest ? anchor.closest('[data-para-row]') : null;
      const paragraph = row ? articleParagraphs().find((item) => item.id === row.dataset.paraRow) : null;
      if (paragraph) {
        state.paragraphId = paragraph.id;
        cue = paragraph;
        $$('.article-para').forEach((item) => item.classList.toggle('is-active', item.dataset.paraRow === paragraph.id));
        const context = $('#contextText');
        if (context) context.textContent = paragraph.text;
      } else {
        cue = currentParagraph();
      }
    }
    if (!cue) cue = (wordPattern(word).test(currentCue().text) ? currentCue() : cueContaining(word)) || currentCue();
    const inLibrary = state.vocab.some((item) => item.word === word);
    const pronunciations = entry.pronunciations || [];
    state.selectedWord = word;
    state.lastWordEl = anchor;
    state.popoverContext = cue;
    $$('.word.is-selected').forEach((node) => node.classList.remove('is-selected'));
    if (anchor && anchor.classList && anchor.classList.contains('word')) anchor.classList.add('is-selected');

    popover.innerHTML = `<div class="pop-top">
      <div class="pop-word"><h2>${esc(word)}</h2><p>${esc(entry.ipa)}</p></div>
      <div class="pop-actions">
        <button class="icon-btn" type="button" data-action="speak-word" data-word="${attr(word)}" aria-label="朗读 ${attr(word)}">${icon('volume')}</button>
        <button class="icon-btn" type="button" data-action="close-word" aria-label="关闭单词卡片">${icon('close')}</button>
      </div>
    </div>
    ${pronunciations.length > 1 ? `
      <div class="pop-pron-head"><span>多读音</span><span>${pronunciations.length} 种常见读法</span></div>
      <div class="pop-pron-list">
        ${pronunciations.map((item) => `<div class="pop-pron">
          <span class="pron-label">${esc(item.label)}</span>
          <div><strong>${esc(item.ipa)}</strong><span>${esc(item.pos)} · ${esc(item.zh)}</span></div>
        </div>`).join('')}
      </div>` : `
      <p class="pop-pos">${esc(entry.pos)}</p>
      <p class="pop-zh">${esc(entry.zh)}</p>
    `}
    <div class="pop-ex">
      <div class="pop-ex-head"><span>语境</span><button class="pop-speak-context" type="button" data-action="speak-context" aria-label="朗读当前语境">${icon('volume')} 朗读</button></div>
      <p>${highlightWord(cue.text, word)}</p><p>${esc(cue.zh || '')}</p>
    </div>
    <div class="pop-foot">
      <button class="btn btn-primary" type="button" data-action="add-word" data-word="${attr(word)}" ${inLibrary ? 'disabled' : ''}>
        ${inLibrary ? `${icon('check')} 已在生词库` : `${icon('plus')} 加入生词库`}
      </button>
      <button class="btn btn-secondary" type="button" data-action="ask-word" data-word="${attr(word)}">${icon('spark')} 问 AI</button>
    </div>`;
    positionPopover(anchor);
    popover.setAttribute('tabindex', '-1');
    requestAnimationFrame(() => popover.focus({ preventScroll: true }));
  }

  function closePopover(restoreFocus = false) {
    if (popover.hidden) return;
    popover.hidden = true;
    popover.innerHTML = '';
    $$('.word.is-selected').forEach((node) => node.classList.remove('is-selected'));
    state.selectedWord = null;
    state.popoverContext = null;
    if (restoreFocus && state.lastWordEl && document.contains(state.lastWordEl)) {
      state.lastWordEl.focus({ preventScroll: true });
    }
  }

  function addWord(word) {
    if (state.vocab.some((item) => item.word === word)) {
      toast('这个词已经在生词库里了');
      return;
    }
    state.vocab.unshift({
      word,
      status: 'learning',
      source: currentSourceTitle(),
      added: '刚刚'
    });
    updateVocabBadge();
    toast(`已加入生词库：${word}`);
    $$('[data-action="add-word"]').forEach((button) => {
      if (button.dataset.word !== word) return;
      button.disabled = true;
      button.innerHTML = button.classList.contains('candidate-add')
        ? `${icon('check')} 已加入`
        : `${icon('check')} 已在生词库`;
    });
  }

  function askAboutWord(word) {
    closePopover(false);
    state.selectedWord = word;
    state.pendingAsk = word;
    if (state.route !== 'workbench') {
      navigate('workbench');
    } else {
      state.pendingAsk = null;
      sendAi(`“${word}” 在这里是什么意思？`);
    }
  }

  function openVocabWord(card) {
    const word = card.dataset.word;
    if (!word) return;
    const item = state.vocab.find((entry) => entry.word === word);
    const episode = item ? D.episodes.find((ep) => ep.title === item.source) : null;
    const article = item ? D.articles.find((entry) => entry.title === item.source) : null;
    const paragraph = article
      ? article.chapters.flatMap((chapter) => chapter.paragraphs).find((entry) => wordPattern(word).test(entry.text))
      : null;
    const cue = paragraph || (episode && cueContaining(word, episode)) || cueContaining(word) || currentCue();
    openWord(word, card, cue);
  }

  /* ——— Review ——— */
  function startReview() {
    const queue = state.vocab.filter((item) => item.status === 'learning').map((item) => item.word);
    if (!queue.length) {
      toast('暂时没有需要复习的生词');
      return;
    }
    state.review = {
      queue,
      index: 0,
      revealed: false,
      done: false,
      results: { good: 0, hard: 0, again: 0 }
    };
    if (state.route !== 'vocabulary') {
      navigate('vocabulary');
    } else {
      render();
    }
  }

  function rateReview(rate) {
    const review = state.review;
    if (!review || review.done) return;
    const word = review.queue[review.index];
    const item = state.vocab.find((entry) => entry.word === word);
    if (item) item.status = rate === 'good' ? 'mastered' : 'learning';
    review.results[rate] += 1;
    review.index += 1;
    review.revealed = false;
    if (review.index >= review.queue.length) review.done = true;
    render();
  }

  /* ——— Events ——— */
  function handleAction(element) {
    const action = element.dataset.action;
    if (!action) return;
    switch (action) {
      case 'play': togglePlayback(); break;
      case 'jump':
        if (state.playback.playing) stopPlayback();
        closePopover(false);
        selectCue(element.dataset.cue);
        break;
      case 'switch-episode': switchEpisode(element.dataset.episode); break;
      case 'speak-word': speak(element.dataset.word, element.dataset.word); break;
      case 'speak-cue': speak(currentCue().text, '当前句子'); break;
      case 'speak-passage': speak(currentParagraph().text, '当前段落'); break;
      case 'speak-context': if (state.popoverContext) speak(state.popoverContext.text, '当前语境'); break;
      case 'add-word': addWord(element.dataset.word); break;
      case 'ask-word': askAboutWord(element.dataset.word); break;
      case 'close-word': closePopover(true); break;
      case 'open-vocab-word': openVocabWord(element); break;
      case 'filter':
        state.filter = element.dataset.filter;
        render();
        break;
      case 'start-review': startReview(); break;
      case 'reveal':
        if (state.review) {
          state.review.revealed = true;
          render();
        }
        break;
      case 'rate': rateReview(element.dataset.rate); break;
      case 'restart-review': startReview(); break;
      case 'exit-review':
        state.review = null;
        navigate('vocabulary');
        break;
      case 'prompt': sendAi(element.dataset.prompt); break;
      case 'open-material': openMaterial(element.dataset.material); break;
      case 'material-filter':
        state.materialFilter = element.dataset.filter;
        render();
        break;
      case 'clear-material-search':
        state.materialFilter = 'all';
        state.materialSearch = '';
        render();
        break;
      case 'open-import': openImportModal(); break;
      case 'open-candidates': openCandidates(); break;
      case 'chat-history': openChatHistory(); break;
      case 'load-chat': loadChat(element.dataset.chat); break;
      case 'new-chat': newChat(); break;
      case 'delete-material': {
        const material = materialById(element.dataset.material);
        if (material) openDeleteDialog(material);
        break;
      }
      case 'confirm-delete-material': deleteMaterial(element.dataset.material); break;
      case 'close-modal': closeModal(); break;
      case 'select-para': selectParagraph(element.dataset.para); break;
      case 'go-chapter': selectChapter(element.dataset.chapter); break;
      case 'toggle-setting': toggleSetting(element.dataset.key); break;
      case 'test-connection': testConnection(); break;
      case 'save-settings': saveSettings(); break;
      case 'send-preview': openSendPreview(); break;
      case 'key-note': openKeyNote(); break;
      case 'log-preview': openLogPreview(); break;
      default: break;
    }
  }

  document.addEventListener('click', (event) => {
    if (event.target.classList && event.target.classList.contains('modal-backdrop')) {
      closeModal();
      return;
    }
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      closeModal(false);
      navigate(nav.dataset.nav);
      return;
    }
    const word = event.target.closest('.word');
    if (word) {
      event.preventDefault();
      openWord(word.dataset.word, word);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      event.preventDefault();
      handleAction(action);
      return;
    }
    if (!event.target.closest('#wordPopover')) closePopover(false);
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'vocabSearch') {
      state.search = event.target.value;
      renderVocabGrid();
    }
    if (event.target.id === 'materialSearch') {
      state.materialSearch = event.target.value;
      renderMaterialsGrid();
    }
    if (event.target.id === 'candidateSearch') {
      state.candidateSearch = event.target.value;
      renderCandidateList();
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'importFile') {
      const file = event.target.files && event.target.files[0];
      const target = $('#importSelected');
      if (!file || !target) return;
      const extension = file.name.split('.').pop().toLowerCase();
      if (!['srt', 'vtt'].includes(extension)) {
        target.classList.add('is-error');
        target.textContent = `暂不支持 .${extension}：当前只有 SRT / VTT 可以导入。`;
        return;
      }
      target.classList.remove('is-error');
      target.textContent = `已选择：${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB · 原型未读取文件内容`;
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.id === 'aiForm') {
      event.preventDefault();
      sendAi($('#aiInput') ? $('#aiInput').value : '');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#modalRoot').hidden) {
      closeModal();
      return;
    }
    if (event.key === 'Escape' && !popover.hidden) {
      closePopover(true);
      return;
    }
    if (event.target.id === 'aiInput' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendAi(event.target.value);
    }
  });

  document.addEventListener('scroll', () => {
    if (!popover.hidden) closePopover(false);
  }, true);

  window.addEventListener('resize', () => closePopover(false));
  window.addEventListener('hashchange', resetRouteFromHash);

  /* ——— Boot ——— */
  $('#todayLabel').textContent = todayLabel();
  if (!location.hash) history.replaceState(null, '', '#/home');
  resetRouteFromHash();
})();
