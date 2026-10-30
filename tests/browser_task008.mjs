import { spawn } from 'node:child_process';

const base = process.argv[2] || 'http://127.0.0.1:18771';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = `/private/tmp/scenelingo-chrome-${process.pid}`;
const port = 19222;
const child = spawn(chrome, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', base], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
let id = 0;
const pending = new Map();
const requests = [];
async function command(method, params = {}) {
  const callId = ++id;
  ws.send(JSON.stringify({ id: callId, method, params }));
  return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.result.value;
}
async function waitFor(expression, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`timeout: ${expression}`);
}
async function pressEnter() {
  await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', key: 'Enter', windowsVirtualKeyCode: 13 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}
try {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = pages.find((page) => page.type === 'page'); if (target) break; } catch (_) {}
    await sleep(100);
  }
  if (!target) throw new Error('Chrome DevTools target unavailable');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message); }
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  };
  await command('Runtime.enable'); await command('Network.enable'); await command('DOM.enable');
  await waitFor(`document.querySelector('#subtitle-upload') && document.readyState === 'complete'`);
  for (const [width, height] of [[1280, 800], [1440, 900]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const overflow = await evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
    if (overflow) throw new Error(`horizontal overflow at ${width}x${height}`);
  }
  const doc = await command('DOM.getDocument');
  const input = await command('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#subtitle-file' });
  await command('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [`${process.cwd()}/tests/fixtures/task008-browser.srt`] });
  await evaluate(`document.querySelector('#subtitle-upload button').focus()`);
  await pressEnter();
  await waitFor(`document.querySelectorAll('.subtitle-card').length === 1`);
  await evaluate(`document.querySelector('[data-subtitle-id]').click()`); await waitFor(`!document.querySelector('#subtitle-detail').hidden && document.querySelector('[data-token-key]')`);
  const addableBefore = await evaluate(`document.querySelectorAll('[data-token-key]').length`);
  await evaluate(`Array.from(document.querySelectorAll('[data-token-key]')).find((button) => button.dataset.tokenKey === "don't").focus()`); await pressEnter(); await waitFor(`document.querySelectorAll('[data-token-key]').length < ${addableBefore}`);
  await evaluate(`document.querySelector('#show-vocabulary').click()`); await waitFor(`document.querySelector('[data-word-id]')`);
  await evaluate(`document.querySelector('[data-word-id]').click()`); await waitFor(`!document.querySelector('#vocabulary-detail').hidden`);
  await evaluate(`document.querySelector('#show-review').click(); document.querySelector('#load-review').click()`); await waitFor(`!document.querySelector('#review-card').hidden`);
  await evaluate(`document.querySelector('#review-input').value="don't"; document.querySelector('#submit-review').focus()`);
  await pressEnter();
  await waitFor(`document.querySelector('#review-message').textContent.includes('已保存')`);
  const external = requests.filter((url) => !url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('devtools:'));
  if (external.length) throw new Error(`external requests: ${external.join(', ')}`);
  const result = await evaluate(`({upload:document.querySelector('#upload-message').textContent,review:document.querySelector('#review-message').textContent})`);
  console.log(JSON.stringify({ ok: true, viewports: ['1280x800', '1440x900'], keyboard: ['upload', 'add-word', 'review'], externalRequests: 0, result }));
} finally {
  if (ws) ws.close(); child.kill('SIGTERM');
}
