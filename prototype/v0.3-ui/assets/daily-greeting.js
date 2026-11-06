(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SceneLingoDailyGreeting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const encouragements = [
    '今天也向英语世界迈进一步。',
    '每次读懂一句，都是新的收获。',
    '把遇见的表达，慢慢变成自己的。',
    '听懂一点点，理解就更深一点。',
    '好奇一个新词，就是学习的开始。',
    '熟悉的句子，也藏着新的发现。',
    '今天的积累，会成为明天的底气。',
    '给自己一点时间，读懂新的表达。',
    '反复遇见的词，会渐渐变得亲切。',
    '从一句对白开始，打开新的视角。',
    '稳稳积累，让理解慢慢扎根。',
    '听见表达背后的意思，也是一种进步。',
    '带着好奇学习，语言会慢慢靠近。',
    '记住一个短语，就是今天的小收获。',
    '每次练习，都让理解多一分把握。',
    '把新词连起来，成为自己的表达。',
    '一点点听读，正在累积成理解。',
    '慢慢来，每次练习都有它的价值。',
    '读懂语境，让新表达找到位置。',
    '坚持回看，熟悉感会一点点增加。',
    '在真实对话里，发现语言的细节。',
    '把今天的小发现，收进英语记忆。',
    '每个新表达，都拓宽一点理解。',
    '让练习贴近日常，收获就在其中。',
    '留心一句地道表达，多一份新收获。',
    '从听懂到会用，正在一步步靠近。',
    '耐心积累，让理解在熟悉中生长。',
    '用自己的节奏，走稳英语学习路。',
    '多一点输入，表达就多一分从容。',
    '继续探索，让英语更贴近日常生活。'
  ];

  const periods = [
    { start: 5, end: 11, greeting: '早上好' },
    { start: 11, end: 14, greeting: '中午好' },
    { start: 14, end: 18, greeting: '下午好' },
    { start: 18, end: 23, greeting: '晚上好' },
    { start: 23, end: 24, greeting: '夜深了' },
    { start: 0, end: 5, greeting: '夜深了' }
  ];

  // Future production adapter boundary only. The prototype intentionally does
  // not fetch, store credentials, or call a paid model. Production should put
  // this behind the existing FastAPI/Qwen gateway and Keychain. Require a
  // separate opt-in after disclosing network use and possible cost, then enforce
  // at most one request per local date with a date-keyed cache and no study data.
  const aiGreetingProvider = Object.freeze({
    enabled: false,
    async generateForDate(_dateKey, _period) { return null; }
  });

  function getPeriod(date) {
    const hour = date.getHours();
    return periods.find(period => hour >= period.start && hour < period.end).greeting;
  }

  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    }).format(date).toUpperCase().replace(/, /g, ', ').replace(/^([A-Z]+), /, '$1 · ');
  }

  function encouragementFor(date) {
    const [year, month, day] = dateKey(date).split('-').map(Number);
    // Use the local calendar date as the seed; UTC here only counts Gregorian
    // calendar days, avoiding DST-length days and fixed-time-zone assumptions.
    const ordinal = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
    return encouragements[((ordinal % encouragements.length) + encouragements.length) % encouragements.length];
  }

  function update(date, documentRef) {
    const now = date || new Date();
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const greeting = getPeriod(now);
    const encouragement = encouragementFor(now);
    if (doc) {
      const dateNode = doc.getElementById('local-date');
      const periodNode = doc.getElementById('greeting-period');
      const encouragementNode = doc.getElementById('daily-encouragement');
      if (dateNode) dateNode.textContent = formatDate(now);
      if (periodNode) periodNode.textContent = greeting;
      if (encouragementNode) encouragementNode.textContent = encouragement;
    }
    return { dateKey: dateKey(now), greeting, encouragement, dateLabel: formatDate(now) };
  }

  function getNow() {
    if (typeof window !== 'undefined' && typeof window.SceneLingoGreetingClock === 'function') {
      return window.SceneLingoGreetingClock();
    }
    return new Date();
  }

  function refresh() { return update(getNow()); }

  function start() {
    refresh();
    // Polling plus visibility refresh handles time-boundary changes and tabs
    // that were background-throttled while the Mac was asleep.
    if (typeof window !== 'undefined') {
      window.setInterval(refresh, 30000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh();
      });
    }
  }

  return Object.freeze({ encouragements, aiGreetingProvider, getPeriod, dateKey, formatDate, encouragementFor, update, refresh, start });
});
