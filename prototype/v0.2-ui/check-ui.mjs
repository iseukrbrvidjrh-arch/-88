#!/usr/bin/env node
/* Local, dependency-free UI check for the V0.2 prototype.
 * Drives the system Chrome over the DevTools protocol; writes screenshots to reports/.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const URL = `file://${join(ROOT, 'index.html')}#/home`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 19231;
const PROFILE = `/private/tmp/scenelingo-v02-prototype-${process.pid}`;
const OUT = join(ROOT, 'reports');

await mkdir(OUT, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--disable-background-networking',
  '--allow-file-access-from-files',
  '--window-size=1440,900',
  URL
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let ws;
let id = 0;
const pending = new Map();
const requests = [];
const consoleErrors = [];
const pageErrors = [];
const results = {};
const failures = [];

function check(name, condition, detail = '') {
  if (!condition) failures.push({ name, detail });
}

function command(method, params = {}) {
  const call = ++id;
  ws.send(JSON.stringify({ id: call, method, params }));
  return new Promise((resolveCall, reject) => pending.set(call, { resolve: resolveCall, reject }));
}

async function evaluate(expression) {
  const message = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (message.result.exceptionDetails) {
    throw new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text);
  }
  return message.result.result.value;
}

async function waitFor(expression, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${expression}`);
}

async function shot(name) {
  await evaluate(`document.querySelector('#toast')?.classList.remove('is-visible')`);
  await sleep(320);
  const message = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(OUT, name), Buffer.from(message.result.data, 'base64'));
}

async function viewport(width, height) {
  await command('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false
  });
  await sleep(180);
}

try {
  let target = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = pages.find((page) => page.type === 'page');
      if (target) break;
    } catch (_) { /* chrome still starting */ }
    await sleep(100);
  }
  if (!target) throw new Error('Chrome target unavailable');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.onopen = resolveOpen;
    ws.onerror = rejectOpen;
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message);
    }
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
    }
  };

  await command('Runtime.enable');
  await command('Network.enable');
  await command('Page.enable');
  await command('Page.reload', { ignoreCache: true });
  await waitFor(`!!document.querySelector('.home')`);
  results.title = await evaluate('document.title');
  results.resources = await evaluate(`performance.getEntriesByType('resource').map((entry) => entry.name)`);
  results.homeCards = await evaluate(`document.querySelectorAll('.stat-card').length`);
  results.navItems = await evaluate(`document.querySelectorAll('.nav-item').length`);

  const overflow = {};
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 640]]) {
    await viewport(width, height);
    overflow[`${width}x${height}`] = await evaluate(`({
      x: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      y: document.body.scrollHeight <= window.innerHeight + 1
    })`);
  }
  results.homeOverflow = overflow;

  await viewport(1440, 900);
  await shot('01-home-1440.png');

  await evaluate(`document.querySelector('[data-nav="workbench"]').click()`);
  await waitFor(`!!document.querySelector('.workbench')`);
  results.workbench = await evaluate(`(() => {
    const reader = document.querySelector('.reader-pane').getBoundingClientRect();
    const tutor = document.querySelector('.tutor-pane').getBoundingClientRect();
    const cues = document.querySelector('#cueList');
    const pop = document.querySelector('#wordPopover');
    return {
      episodes: document.querySelectorAll('.episode-item').length,
      cues: document.querySelectorAll('.cue').length,
      sideBySide: Math.abs(reader.top - tutor.top) < 2 && tutor.left >= reader.right,
      cueListScrolls: cues.scrollHeight > cues.clientHeight + 10,
      tutorVisible: tutor.width > 260 && tutor.right <= window.innerWidth,
      words: document.querySelectorAll('.cue .word').length,
      popoverHidden: pop.hidden
    };
  })()`);
  await shot('02-workbench-1440.png');
  results.a11y = await evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const empty = buttons.filter((button) => !button.textContent.trim() && !button.getAttribute('aria-label'));
    return {
      lang: document.documentElement.lang,
      h1: document.querySelectorAll('h1').length,
      emptyButtonNames: empty.length,
      wordsFocusable: Array.from(document.querySelectorAll('.word')).every((word) => word.tagName === 'BUTTON'),
      navCurrent: document.querySelectorAll('.nav-item[aria-current="page"]').length
    };
  })()`);

  // Simulated playback advances exactly one cue at a time.
  const playBefore = await evaluate(`document.querySelector('.cue.is-active').dataset.cueRow`);
  await evaluate(`document.querySelector('#playBtn').click()`);
  await sleep(2900);
  results.playback = await evaluate(`({
    before: '${playBefore}',
    after: document.querySelector('.cue.is-active').dataset.cueRow,
    label: document.querySelector('#playBtn').getAttribute('aria-label')
  })`);
  await evaluate(`document.querySelector('#playBtn').click()`);
  await sleep(100);
  results.playback.stoppedLabel = await evaluate(`document.querySelector('#playBtn').getAttribute('aria-label')`);

  // Switch episode and confirm the transcript/context change.
  const firstCueBefore = await evaluate(`document.querySelector('.cue-text').textContent`);
  await evaluate(`document.querySelector('[data-episode="the-interview"]').click()`);
  await sleep(150);
  results.episodeSwitch = await evaluate(`({
    title: document.querySelector('.reader-title h2').textContent.trim(),
    cues: document.querySelectorAll('.cue').length,
    firstCue: document.querySelector('.cue-text').textContent
  })`);
  results.episodeSwitch.changed = results.episodeSwitch.firstCue !== firstCueBefore;

  await evaluate(`document.querySelector('[data-episode="morning-light"]').click()`);
  await sleep(150);
  await evaluate(`document.querySelector('[data-action="jump"][data-cue="ml-5"]').click()`);
  await sleep(150);

  // Word card: IPA, Chinese meaning, add to library, local speech.
  await evaluate(`document.querySelector('.word[data-word="glass"]').click()`);
  await waitFor(`!document.querySelector('#wordPopover').hidden`);
  results.wordCard = await evaluate(`(() => {
    const pop = document.querySelector('#wordPopover');
    const rect = pop.getBoundingClientRect();
    const reader = document.querySelector('.reader-pane').getBoundingClientRect();
    const tutor = document.querySelector('.tutor-pane').getBoundingClientRect();
    return {
      word: pop.querySelector('h2').textContent,
      ipa: pop.querySelector('.pop-word p').textContent,
      zh: pop.querySelector('.pop-zh').textContent,
      hasAdd: !!pop.querySelector('[data-action="add-word"]'),
      hasSpeak: !!pop.querySelector('[data-action="speak-word"]'),
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      keepsTutorClear: rect.right <= tutor.left + 1,
      insideReader: rect.left >= reader.left - 1 && rect.right <= reader.right + 1
    };
  })()`);
  await shot('03-word-card.png');

  results.vocabCountBefore = await evaluate(`document.querySelector('#navVocabCount').textContent`);
  await evaluate(`document.querySelector('#wordPopover [data-action="add-word"]').click()`);
  await sleep(120);
  results.addWord = await evaluate(`({
    count: document.querySelector('#navVocabCount').textContent,
    buttonDisabled: document.querySelector('#wordPopover [data-action="add-word"]').disabled,
    buttonText: document.querySelector('#wordPopover [data-action="add-word"]').textContent.trim(),
    toast: document.querySelector('#toast').textContent
  })`);

  await evaluate(`document.querySelector('#wordPopover [data-action="speak-word"]').click()`);
  await sleep(120);
  results.speechToast = await evaluate(`document.querySelector('#toast').textContent`);

  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(100);
  results.popoverClosed = await evaluate(`document.querySelector('#wordPopover').hidden`);

  // Ask AI about a clicked word; reply is generated locally.
  await evaluate(`document.querySelector('.word[data-word="river"]').click()`);
  await waitFor(`!document.querySelector('#wordPopover').hidden`);
  const aiBefore = await evaluate(`document.querySelectorAll('#aiMessages .msg').length`);
  await evaluate(`document.querySelector('#wordPopover [data-action="ask-word"]').click()`);
  await waitFor(`document.querySelectorAll('#aiMessages .msg--user').length > 0`, 4000);
  await sleep(900);
  results.ai = await evaluate(`(() => {
    const messages = Array.from(document.querySelectorAll('#aiMessages .msg'));
    return {
      before: ${aiBefore},
      after: messages.length,
      last: messages[messages.length - 1].textContent.trim().slice(0, 120),
      context: document.querySelector('#contextText').textContent
    };
  })()`);
  await shot('04-ai-tutor.png');

  // Vocabulary page, filters, search, review flow.
  await evaluate(`document.querySelector('[data-nav="vocabulary"]').click()`);
  await waitFor(`!!document.querySelector('.vocab-page')`);
  results.vocabulary = await evaluate(`({
    cards: document.querySelectorAll('.vocab-card').length,
    learning: document.querySelectorAll('.pill--amber').length,
    mastered: document.querySelectorAll('.pill--green').length
  })`);
  await shot('05-vocabulary.png');

  await evaluate(`document.querySelector('[data-action="filter"][data-filter="mastered"]').click()`);
  await sleep(100);
  results.masteredFilter = await evaluate(`document.querySelectorAll('.vocab-card').length`);
  await evaluate(`document.querySelector('[data-action="filter"][data-filter="all"]').click()`);
  await sleep(100);
  await evaluate(`(() => { const input = document.querySelector('#vocabSearch'); input.value = 'bak'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);
  results.search = await evaluate(`document.querySelectorAll('.vocab-card').length`);
  await evaluate(`(() => { const input = document.querySelector('#vocabSearch'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);

  await evaluate(`document.querySelector('[data-action="start-review"]').click()`);
  await waitFor(`!!document.querySelector('.review-card')`);
  results.reviewBefore = await evaluate(`({
    word: document.querySelector('.review-word').textContent,
    hiddenAnswer: !document.querySelector('.review-answer')
  })`);
  await evaluate(`document.querySelector('[data-action="reveal"]').click()`);
  await waitFor(`!!document.querySelector('.review-answer')`);
  results.reviewRevealed = await evaluate(`({
    zh: document.querySelector('.review-answer .zh').textContent,
    ratings: document.querySelectorAll('.rate-btn').length
  })`);
  await shot('06-review.png');
  await evaluate(`document.querySelector('[data-action="rate"][data-rate="good"]').click()`);
  await sleep(150);
  results.reviewAfterRate = await evaluate(`document.querySelector('.review-count').textContent`);
  await evaluate(`document.querySelector('[data-action="exit-review"]').click()`);
  await waitFor(`!!document.querySelector('.vocab-page')`);

  // Stats page.
  await evaluate(`document.querySelector('[data-nav="stats"]').click()`);
  await waitFor(`!!document.querySelector('.stats-page')`);
  results.stats = await evaluate(`({
    tiles: document.querySelectorAll('.stats-tile').length,
    bars: document.querySelectorAll('.chart-bar').length,
    heat: document.querySelectorAll('.heat').length,
    donut: document.querySelector('.donut-center strong').textContent,
    activity: document.querySelectorAll('.activity-row').length
  })`);
  await shot('07-stats.png');

  await viewport(1024, 640);
  results.statsCompact = await evaluate(`({
    noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    heatmap: document.querySelectorAll('.heat').length,
    bars: document.querySelectorAll('.chart-bar').length
  })`);
  await shot('12-stats-1024-zoom125.png');
  await evaluate(`document.querySelector('[data-nav="vocabulary"]').click()`);
  await waitFor(`!!document.querySelector('.vocab-page')`);
  results.vocabCompact = await evaluate(`({
    noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    columns: getComputedStyle(document.querySelector('.vocab-grid')).gridTemplateColumns.split(' ').length,
    cards: document.querySelectorAll('.vocab-card').length
  })`);
  await shot('13-vocabulary-1024-zoom125.png');
  await viewport(1440, 900);

  // Compact desktop home / vocabulary / stats.
  await evaluate(`document.querySelector('[data-nav="home"]').click()`);
  await waitFor(`!!document.querySelector('.home')`);
  await viewport(1280, 800);
  await shot('10-home-1280.png');
  await viewport(1024, 640);
  results.homeCompact = await evaluate(`({
    noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    heroWidth: Math.round(document.querySelector('.continue-card').getBoundingClientRect().width),
    dailyLine: !!document.querySelector('.daily-line')
  })`);
  await shot('11-home-1024-zoom125.png');
  await viewport(1440, 900);

  // Compact desktop sizes, including 125% browser zoom on 1280 (1024 CSS px).
  await evaluate(`document.querySelector('[data-nav="workbench"]').click()`);
  await waitFor(`!!document.querySelector('.workbench')`);
  for (const [width, height, name] of [[1280, 800, '08-workbench-1280.png'], [1024, 640, '09-workbench-1024-zoom125.png']]) {
    await viewport(width, height);
    const layout = await evaluate(`(() => {
      const tutor = document.querySelector('.tutor-pane').getBoundingClientRect();
      const reader = document.querySelector('.reader-pane').getBoundingClientRect();
      return {
        noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        sideBySide: Math.abs(reader.top - tutor.top) < 2 && tutor.right <= innerWidth + 1,
        tutorWidth: Math.round(tutor.width),
        cueText: getComputedStyle(document.querySelector('.cue-text')).fontSize,
        playVisible: (() => { const r = document.querySelector('#playBtn').getBoundingClientRect(); return r.right <= innerWidth && r.width >= 30; })()
      };
    })()`);
    results[`layout${width}`] = layout;
    await shot(name);
  }

  await evaluate(`document.querySelector('.word[data-word="glass"]').click()`);
  await waitFor(`!document.querySelector('#wordPopover').hidden`);
  results.popover1024 = await evaluate(`(() => {
    const rect = document.querySelector('#wordPopover').getBoundingClientRect();
    const reader = document.querySelector('.reader-pane').getBoundingClientRect();
    return {
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      insideReader: rect.left >= reader.left - 1 && rect.right <= reader.right + 1
    };
  })()`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(80);
  await viewport(1440, 900);

  // Scroll independence: page itself stays fixed while the cue list scrolls.
  const pageBefore = await evaluate(`window.scrollY`);
  await evaluate(`document.querySelector('#cueList').scrollTop = 300`);
  await sleep(120);
  results.independentScroll = await evaluate(`window.scrollY === ${pageBefore}`);

  // ——— Learning material library ———
  await viewport(1440, 900);
  await evaluate(`document.querySelector('[data-nav="materials"]').click()`);
  await waitFor(`!!document.querySelector('.materials-page')`);
  results.library = await evaluate(`(() => {
    const importButton = document.querySelector('[data-action="open-import"]').getBoundingClientRect();
    const grid = document.querySelector('.material-grid');
    return {
      cards: document.querySelectorAll('.material-card').length,
      available: document.querySelectorAll('.material-card:not(.is-planned)').length,
      planned: document.querySelectorAll('.material-card.is-planned').length,
      readyChips: document.querySelectorAll('.format-chip.is-ready').length,
      plannedChips: document.querySelectorAll('.format-chip:not(.is-ready)').length,
      importAboveFold: importButton.top >= 0 && importButton.bottom <= innerHeight,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth
    };
  })()`);
  check('library has 7 material cards', results.library.cards === 7, JSON.stringify(results.library));
  check('library separates 3 ready and 4 planned', results.library.available === 3 && results.library.planned === 4);
  check('import entry is above the fold', results.library.importAboveFold);
  await shot('14-materials-1440.png');

  await evaluate(`document.querySelector('[data-action="material-filter"][data-filter="subtitle"]').click()`);
  await sleep(100);
  results.library.subtitles = await evaluate(`document.querySelectorAll('.material-card').length`);
  await evaluate(`document.querySelector('[data-action="material-filter"][data-filter="article"]').click()`);
  await sleep(100);
  results.library.articles = await evaluate(`document.querySelectorAll('.material-card').length`);
  check('subtitle and article filters', results.library.subtitles === 3 && results.library.articles === 2);
  await evaluate(`document.querySelector('[data-action="material-filter"][data-filter="all"]').click()`);
  await evaluate(`(() => { const input = document.querySelector('#materialSearch'); input.value = 'rooftop'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);
  results.library.search = await evaluate(`document.querySelectorAll('.material-card').length`);
  check('library search narrows to one result', results.library.search === 1);
  await evaluate(`(() => { const input = document.querySelector('#materialSearch'); input.value = 'no-such-material'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);
  results.library.emptyState = await evaluate(`!!document.querySelector('.material-empty')`);
  check('library shows an empty state', results.library.emptyState);
  await evaluate(`document.querySelector('[data-action="clear-material-search"]').click()`);
  await sleep(100);

  await evaluate(`document.querySelector('[data-material-card="slow-reading"] [data-action="open-material"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.plannedFormat = await evaluate(`({
    text: document.querySelector('.modal').innerText,
    hasPreviewReader: !!document.querySelector('.article-reader'),
    pill: document.querySelector('.planned-callout .pill').textContent.trim()
  })`);
  check('planned format explains it is not implemented', /待开发/.test(results.plannedFormat.text) && !results.plannedFormat.hasPreviewReader);
  await shot('15-planned-format-modal.png');
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await sleep(80);

  await evaluate(`document.querySelector('[data-action="open-import"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.importModal = await evaluate(`({
    accept: document.querySelector('#importFile').accept,
    chips: document.querySelectorAll('.import-formats .format-chip').length,
    ready: document.querySelectorAll('.import-formats .format-chip.is-ready').length,
    noDragClaim: !document.querySelector('.import-drop').textContent.includes('拖入')
  })`);
  await evaluate(`(() => {
    const input = document.querySelector('#importFile');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['prototype'], 'notes.txt', { type: 'text/plain' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(80);
  results.importModal.txtMessage = await evaluate(`document.querySelector('#importSelected').textContent`);
  await evaluate(`(() => {
    const input = document.querySelector('#importFile');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['prototype subtitle bytes'], 'sample.srt', { type: 'text/plain' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(80);
  results.importModal.srtMessage = await evaluate(`document.querySelector('#importSelected').textContent`);
  check('unsupported import is rejected', /暂不支持 \.txt/.test(results.importModal.txtMessage));
  check('SRT import stays a metadata-only demo', /sample\.srt/.test(results.importModal.srtMessage) && /未读取文件内容/.test(results.importModal.srtMessage));
  await shot('16-import-modal.png');
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await sleep(80);

  // ——— Article reading mode ———
  await evaluate(`document.querySelector('[data-action="open-material"][data-material="a-small-theory"]').click()`);
  await waitFor(`!!document.querySelector('.article-reader')`);
  results.article = await evaluate(`({
    title: document.querySelector('.article-title').textContent.trim(),
    outline: document.querySelectorAll('.outline-item').length,
    paragraphs: document.querySelectorAll('.article-para').length,
    preview: document.querySelector('.preview-banner').innerText,
    context: document.querySelector('#contextText').textContent,
    tutorVisible: (() => { const r = document.querySelector('.tutor-pane').getBoundingClientRect(); return r.width > 260 && r.right <= innerWidth; })()
  })`);
  check('article preview renders chapters and paragraphs', results.article.outline === 2 && results.article.paragraphs === 3);
  check('article is visibly marked as a preview', /界面预览/.test(results.article.preview) && /尚未接入/.test(results.article.preview));
  await shot('17-article-reader-1440.png');

  await evaluate(`(() => {
    const word = document.querySelector('[data-para-row="theory-1-p2"] .word[data-word="read"]');
    word.scrollIntoView({ block: 'center' });
  })()`);
  await sleep(120);
  await evaluate(`document.querySelector('[data-para-row="theory-1-p2"] .word[data-word="read"]').click()`);
  await waitFor(`!document.querySelector('#wordPopover').hidden`);
  results.multiplePronunciations = await evaluate(`({
    readings: Array.from(document.querySelectorAll('#wordPopover .pop-pron')).map((row) => row.innerText),
    context: document.querySelector('#wordPopover .pop-ex p').textContent,
    ipa: document.querySelector('#wordPopover .pop-word p').textContent,
    inViewport: (() => { const r = document.querySelector('#wordPopover').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()
  })`);
  check('word card shows both readings of read', results.multiplePronunciations.readings.length === 2 && results.multiplePronunciations.readings.some((row) => row.includes('/rɛd/')));
  check('article word context follows the clicked paragraph', /I used to wake up/.test(results.multiplePronunciations.context));
  await shot('18-multiple-pronunciation.png');
  await evaluate(`document.querySelector('#wordPopover [data-action="speak-context"]').click()`);
  await sleep(100);
  results.article.contextSpeech = await evaluate(`document.querySelector('#toast').textContent`);
  check('article context can be read locally', /当前语境/.test(results.article.contextSpeech));
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(80);

  await evaluate(`document.querySelector('[data-action="select-para"][data-para="theory-1-p3"]').click()`);
  await sleep(80);
  results.article.paragraphContext = await evaluate(`({
    context: document.querySelector('#contextText').textContent,
    active: document.querySelector('.article-para.is-active').dataset.paraRow
  })`);
  check('paragraph number switches the AI context', results.article.paragraphContext.active === 'theory-1-p3');

  await evaluate(`document.querySelector('[data-action="go-chapter"][data-chapter="theory-2"]').click()`);
  await sleep(120);
  results.article.chapterSwitch = await evaluate(`({
    title: document.querySelector('.article-title').textContent.trim(),
    paragraphs: document.querySelectorAll('.article-para').length,
    active: document.querySelector('.outline-item.is-active .outline-copy strong').textContent
  })`);
  check('chapter navigation opens the second chapter', /The Art of Noticing/.test(results.article.chapterSwitch.title) && results.article.chapterSwitch.paragraphs === 3);

  await evaluate(`(() => {
    const word = document.querySelector('[data-para-row="theory-2-p2"] .word[data-word="record"]');
    word.scrollIntoView({ block: 'center' });
  })()`);
  await sleep(120);
  await evaluate(`document.querySelector('[data-para-row="theory-2-p2"] .word[data-word="record"]').click()`);
  await waitFor(`!document.querySelector('#wordPopover').hidden`);
  results.recordPronunciations = await evaluate(`Array.from(document.querySelectorAll('#wordPopover .pop-pron strong')).map((node) => node.textContent)`);
  check('record shows noun and verb IPA', results.recordPronunciations.length === 2 && results.recordPronunciations.some((ipa) => ipa.includes('ˈrɛkərd')));
  await evaluate(`document.querySelector('#wordPopover [data-action="ask-word"]').click()`);
  await waitFor(`Array.from(document.querySelectorAll('#aiMessages .msg--user')).some((row) => row.textContent.includes('record'))`, 3000);
  await sleep(850);
  results.article.ai = await evaluate(`({
    context: document.querySelector('#contextText').textContent,
    last: Array.from(document.querySelectorAll('#aiMessages .msg')).pop().innerText,
    active: document.querySelector('.article-para.is-active').dataset.paraRow
  })`);
  check('asking AI from article keeps paragraph context', results.article.ai.active === 'theory-2-p2' && /record/.test(results.article.ai.last));
  await shot('19-article-ai.png');
  await evaluate(`document.querySelector('[data-action="speak-passage"]').click()`);
  await sleep(100);
  results.article.passageSpeech = await evaluate(`document.querySelector('#toast').textContent`);
  check('current paragraph can be read locally', /当前段落/.test(results.article.passageSpeech));

  for (const [width, height, name] of [[1280, 800, null], [1024, 640, '20-article-1024-zoom125.png']]) {
    await viewport(width, height);
    const layout = await evaluate(`(() => {
      const tutor = document.querySelector('.tutor-pane').getBoundingClientRect();
      const reader = document.querySelector('.reader-pane').getBoundingClientRect();
      return {
        noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        sideBySide: Math.abs(reader.top - tutor.top) < 2 && tutor.right <= innerWidth + 1,
        tutorWidth: Math.round(tutor.width),
        outlineVisible: document.querySelector('.outline-pane').getBoundingClientRect().width >= 180,
        articleScrolls: (() => { const pane = document.querySelector('#articleScroll'); return pane.scrollHeight >= pane.clientHeight; })()
      };
    })()`);
    results[`articleLayout${width}`] = layout;
    check(`article layout ${width} has no horizontal overflow`, layout.noXOverflow && layout.sideBySide);
    if (name) await shot(name);
  }
  await evaluate(`(() => {
    const word = document.querySelector('[data-para-row="theory-2-p2"] .word[data-word="record"]');
    word.scrollIntoView({ block: 'center' });
  })()`);
  await sleep(100);
  await evaluate(`document.querySelector('[data-para-row="theory-2-p2"] .word[data-word="record"]').click()`);
  await waitFor(`!document.querySelector('#wordPopover').hidden`);
  results.articleCompactPopover = await evaluate(`(() => {
    const rect = document.querySelector('#wordPopover').getBoundingClientRect();
    const reader = document.querySelector('.reader-pane').getBoundingClientRect();
    return { inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, insideReader: rect.left >= reader.left - 1 && rect.right <= reader.right + 1 };
  })()`);
  check('pronunciation card stays inside the article pane at 1024', results.articleCompactPopover.inViewport && results.articleCompactPopover.insideReader);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(80);
  await viewport(1440, 900);

  // ——— Settings ———
  await evaluate(`document.querySelector('[data-nav="settings"]').click()`);
  await waitFor(`!!document.querySelector('.settings-page')`);
  results.settings = await evaluate(`(() => {
    const backup = Array.from(document.querySelectorAll('.data-row')).find((row) => row.textContent.includes('数据备份'));
    return {
      provider: document.querySelector('.field-static strong').textContent,
      baseUrl: document.querySelector('#settingsBaseUrl').value,
      model: document.querySelector('#settingsModel').value,
      maxTokens: document.querySelector('#settingsMaxTokens').value,
      maskedKey: document.querySelector('.key-status').innerText,
      toggles: document.querySelectorAll('.toggle').length,
      usage: document.querySelectorAll('.usage-grid > div').length,
      backup: backup ? backup.innerText : '',
      cards: document.querySelectorAll('.settings-card, .side-card').length,
      noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      storageKeys: (() => { try { return localStorage.length; } catch (_) { return -1; } })(),
      looksLikeRawKey: /sk-[A-Za-z0-9]{10,}/.test(document.documentElement.innerHTML)
    };
  })()`);
  check('settings default to the current Qwen configuration', results.settings.provider.includes('通义千问') && results.settings.model === 'qwen3.8-max' && results.settings.maxTokens === '800');
  check('settings expose masked key, usage and backup status', /•/.test(results.settings.maskedKey) && results.settings.usage === 3 && /后续开发/.test(results.settings.backup));
  check('settings contain no raw key or browser storage secrets', !results.settings.looksLikeRawKey && results.settings.storageKeys === 0);
  await shot('21-settings-1440.png');

  await evaluate(`(() => { const input = document.querySelector('#settingsBaseUrl'); window.__prototypeBaseUrl = input.value; input.value = ''; })()`);
  await evaluate(`document.querySelector('[data-action="test-connection"]').click()`);
  await sleep(80);
  results.settings.blankTest = await evaluate(`({
    text: document.querySelector('#connectionStatus').innerText,
    error: document.querySelector('#connectionStatus').classList.contains('is-error')
  })`);
  check('connection test shows a clear validation error', results.settings.blankTest.error && /请先填写/.test(results.settings.blankTest.text));
  await evaluate(`(() => { document.querySelector('#settingsBaseUrl').value = window.__prototypeBaseUrl; })()`);
  await evaluate(`document.querySelector('[data-action="test-connection"]').click()`);
  await sleep(90);
  results.settings.testing = await evaluate(`document.querySelector('#connectionTestBtn').textContent.trim()`);
  await sleep(850);
  results.settings.test = await evaluate(`({
    text: document.querySelector('#connectionStatus').innerText,
    success: document.querySelector('#connectionStatus').classList.contains('is-success')
  })`);
  check('connection test uses a clearly simulated success state', results.settings.test.success && /模拟/.test(results.settings.test.text));

  await evaluate(`document.querySelector('.toggle[data-key="cloudEnabled"]').click()`);
  await sleep(80);
  results.settings.cloudOff = await evaluate(`({ toggle: document.querySelector('.toggle[data-key="cloudEnabled"]').getAttribute('aria-checked'), label: document.querySelector('#cloudState').innerText })`);
  await evaluate(`document.querySelector('.toggle[data-key="cloudEnabled"]').click()`);
  await sleep(80);
  results.settings.cloudOn = await evaluate(`document.querySelector('#cloudState').innerText`);
  check('cloud AI can be switched off and on', results.settings.cloudOff.toggle === 'false' && /已关闭/.test(results.settings.cloudOff.label) && /已开启/.test(results.settings.cloudOn));

  await evaluate(`document.querySelector('[data-action="send-preview"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.settings.sendPreview = await evaluate(`({
    text: document.querySelector('.modal').innerText,
    cards: document.querySelectorAll('.send-preview-card').length,
    meta: document.querySelectorAll('.sent-meta-grid > div').length,
    checks: document.querySelectorAll('.privacy-checklist span').length
  })`);
  check('send preview shows context, model and privacy scope', results.settings.sendPreview.cards === 2 && /不发送 API Key/.test(results.settings.sendPreview.text) && results.settings.sendPreview.meta === 4);
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('[data-action="key-note"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.settings.keyNote = await evaluate(`document.querySelector('.modal').innerText`);
  check('key note explains the key is masked', /不会展示/.test(results.settings.keyNote) && /完整 Key/.test(results.settings.keyNote));
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await evaluate(`document.querySelector('[data-action="log-preview"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.settings.logRows = await evaluate(`document.querySelectorAll('.log-preview > div').length`);
  check('diagnostic log preview is present', results.settings.logRows === 4);
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await sleep(80);
  await evaluate(`document.querySelector('[data-action="save-settings"]').click()`);
  await sleep(60);
  results.settings.saved = await evaluate(`document.querySelector('#settingsSaved').textContent`);
  check('settings save reports the prototype-session scope', /原型会话/.test(results.settings.saved));

  for (const [width, height, name] of [[1280, 800, null], [1024, 640, '22-settings-1024-zoom125.png']]) {
    await viewport(width, height);
    const layout = await evaluate(`(() => {
      const layout = document.querySelector('.settings-layout');
      const side = document.querySelector('.settings-side');
      return {
        noXOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        layoutColumns: getComputedStyle(layout).gridTemplateColumns.split(' ').length,
        sideColumns: getComputedStyle(side).gridTemplateColumns.split(' ').length,
        fields: document.querySelectorAll('.field-input').length
      };
    })()`);
    results[`settingsLayout${width}`] = layout;
    check(`settings layout ${width} has no horizontal overflow`, layout.noXOverflow);
    if (name) await shot(name);
  }
  await viewport(1440, 900);

  // ——— Vocabulary candidates and AI chat history ———
  await evaluate(`location.hash = '#/workbench/morning-light'`);
  await waitFor(`!!document.querySelector('.cue-list')`);
  await evaluate(`document.querySelector('[data-action="open-candidates"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.candidates = await evaluate(`({
    rows: document.querySelectorAll('.candidate-row').length,
    frequency: document.querySelector('.candidate-freq').textContent.trim(),
    hasIpa: !!document.querySelector('.candidate-ipa'),
    search: !!document.querySelector('#candidateSearch')
  })`);
  check('candidate list shows frequency and dictionary detail', results.candidates.rows > 0 && /出现/.test(results.candidates.frequency) && results.candidates.hasIpa);
  await evaluate(`(() => { const input = document.querySelector('#candidateSearch'); input.value = 'river'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);
  results.candidates.filtered = await evaluate(`document.querySelectorAll('.candidate-row').length`);
  const vocabBeforeCandidate = await evaluate(`Number(document.querySelector('#navVocabCount').textContent)`);
  await evaluate(`document.querySelector('.candidate-row [data-action="add-word"]').click()`);
  await sleep(100);
  results.candidates.added = await evaluate(`({
    disabled: document.querySelector('.candidate-row [data-action="add-word"]').disabled,
    count: Number(document.querySelector('#navVocabCount').textContent)
  })`);
  check('candidate search narrows the list and adds a word once', results.candidates.filtered === 1 && results.candidates.added.disabled && results.candidates.added.count === vocabBeforeCandidate + 1);
  await shot('23-vocabulary-candidates.png');
  await evaluate(`document.querySelector('[data-action="close-modal"]').click()`);
  await sleep(80);

  await evaluate(`document.querySelector('[data-action="chat-history"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.chatHistory = await evaluate(`({ rows: document.querySelectorAll('.history-row').length, previews: document.querySelectorAll('.history-copy em').length })`);
  check('chat history lists saved prototype sessions', results.chatHistory.rows === 3 && results.chatHistory.previews === 3);
  await shot('24-chat-history.png');
  await evaluate(`document.querySelector('.history-row').click()`);
  await waitFor(`document.querySelector('#modalRoot').hidden && document.querySelectorAll('#aiMessages .msg').length === 2`);
  results.chatLoaded = await evaluate(`({
    messages: document.querySelectorAll('#aiMessages .msg').length,
    user: document.querySelector('#aiMessages .msg--user').innerText,
    toast: document.querySelector('#toast').textContent
  })`);
  check('loading a chat restores its messages', /catch my breath/.test(results.chatLoaded.user));
  await evaluate(`document.querySelector('[data-action="chat-history"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  await evaluate(`document.querySelector('[data-action="new-chat"]').click()`);
  await waitFor(`document.querySelector('#modalRoot').hidden`);
  results.newChatMessages = await evaluate(`document.querySelectorAll('#aiMessages .msg').length`);
  check('new chat resets the tutor conversation', results.newChatMessages === 1);

  // ——— Delete is session-only and restorable on reload ———
  await evaluate(`document.querySelector('[data-nav="materials"]').click()`);
  await waitFor(`!!document.querySelector('.materials-page')`);
  await evaluate(`document.querySelector('[data-material-card="slow-reading"] [data-action="delete-material"]').click()`);
  await waitFor(`!document.querySelector('#modalRoot').hidden`);
  results.deleteDialog = await evaluate(`({
    text: document.querySelector('.modal').innerText,
    hasDanger: !!document.querySelector('.dialog-mark--danger')
  })`);
  check('delete dialog explains it is prototype-only', /不会删除电脑上的原文件/.test(results.deleteDialog.text) && results.deleteDialog.hasDanger);
  await shot('25-delete-confirm.png');
  await evaluate(`document.querySelector('[data-action="confirm-delete-material"]').click()`);
  await waitFor(`document.querySelector('#modalRoot').hidden`);
  await sleep(100);
  results.afterDelete = await evaluate(`({
    cards: document.querySelectorAll('.material-card').length,
    removed: !document.querySelector('[data-material-card="slow-reading"]')
  })`);
  check('confirming delete removes only the prototype card', results.afterDelete.cards === 6 && results.afterDelete.removed);
  await command('Page.reload', { ignoreCache: true });
  await sleep(400);
  await waitFor(`!!document.querySelector('.materials-page')`);
  results.afterReload = await evaluate(`document.querySelectorAll('.material-card').length`);
  check('reload restores the in-memory prototype data', results.afterReload === 7);

  const external = requests.filter((url) =>
    /^https?:/i.test(url) && !url.startsWith('http://127.0.0.1')
  );
  results.network = {
    totalRequests: requests.length,
    external,
    consoleErrors,
    pageErrors
  };
  results.failures = failures;
  results.ok = pageErrors.length === 0 && consoleErrors.length === 0
    && external.length === 0 && failures.length === 0;

  console.log(JSON.stringify(results, null, 2));
  if (!results.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill('SIGTERM');
}
