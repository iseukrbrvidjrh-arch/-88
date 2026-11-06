const test = require('node:test');
const assert = require('node:assert/strict');
const greeting = require('../assets/daily-greeting.js');

function localDate(hour, day = 2, month = 10, year = 2026) {
  return new Date(year, month, day, hour, 0, 0);
}

test('selects all local-time greeting boundaries', () => {
  for (const [hour, expected] of [
    [4, '夜深了'], [5, '早上好'], [10, '早上好'], [11, '中午好'],
    [13, '中午好'], [14, '下午好'], [17, '下午好'], [18, '晚上好'],
    [22, '晚上好'], [23, '夜深了'], [0, '夜深了']
  ]) assert.equal(greeting.getPeriod(localDate(hour)), expected, `${hour}:00`);
});

test('uses the real local calendar date and remains stable within a day', () => {
  const morning = localDate(5, 2);
  const evening = localDate(22, 2);
  const tomorrow = localDate(5, 3);
  assert.equal(greeting.dateKey(morning), greeting.dateKey(evening));
  assert.equal(greeting.encouragementFor(morning), greeting.encouragementFor(evening));
  assert.notEqual(greeting.dateKey(morning), greeting.dateKey(tomorrow));
  assert.notEqual(greeting.encouragementFor(morning), greeting.encouragementFor(tomorrow));
  assert.match(greeting.formatDate(morning), /2026/);
});

test('provides 30 concise daily messages without adjacent-day repeats', () => {
  assert.equal(greeting.encouragements.length, 30);
  assert.ok(greeting.encouragements.every(line => line.length >= 10 && line.length <= 25));
  for (let day = 1; day < 31; day++) {
    assert.notEqual(greeting.encouragementFor(localDate(12, day)), greeting.encouragementFor(localDate(12, day + 1)));
  }
});

test('updates the page through an injected Date without network or AI calls', () => {
  const nodes = Object.fromEntries(['local-date', 'greeting-period', 'daily-encouragement'].map(id => [id, { textContent: '' }]));
  const doc = { getElementById: id => nodes[id] || null };
  const date = localDate(11, 2);
  const result = greeting.update(date, doc);
  assert.equal(nodes['greeting-period'].textContent, '中午好');
  assert.equal(nodes['daily-encouragement'].textContent, result.encouragement);
  assert.equal(nodes['local-date'].textContent, result.dateLabel);
  assert.equal(greeting.aiGreetingProvider.enabled, false);
  assert.doesNotMatch(require('node:fs').readFileSync(require.resolve('../assets/daily-greeting.js'), 'utf8'), /\bfetch\s*\(/);
  return greeting.aiGreetingProvider.generateForDate(result.dateKey, result.greeting).then(value => assert.equal(value, null));
});
