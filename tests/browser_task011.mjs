const targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
const target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1:18767'));
if (!target) throw new Error('SceneLingo Chrome target not found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const {resolve,reject}=pending.get(message.id); pending.delete(message.id); message.error?reject(new Error(message.error.message)):resolve(message.result); } };
function send(method, params={}) { const call=++id; ws.send(JSON.stringify({id:call,method,params})); return new Promise((resolve,reject)=>pending.set(call,{resolve,reject})); }
async function evaluate(expression) { const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(result.exceptionDetails)throw new Error(result.exceptionDetails.text); return result.result.value; }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await evaluate(`new Promise(r => document.readyState==='complete'?r(true):addEventListener('load',()=>r(true)))`);

const results={};
for (const [width,height] of [[1280,800],[1440,900]]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  results[`${width}x${height}`]=await evaluate(`({
    viewport:[innerWidth,innerHeight],
    noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth,
    navVisible:!document.querySelector('#show-chat').hidden,
    inputVisible:!!document.querySelector('#chat-input')
  })`);
}

await evaluate(`document.querySelector('#show-settings').click()`); await pause(150);
results.settings=await evaluate(`({key:document.querySelector('#ai-status').textContent, passwordType:document.querySelector('#api-key').type, keyValue:document.querySelector('#api-key').value})`);
await evaluate(`document.querySelector('#cloud-enabled').checked=true;document.querySelector('#cloud-consent').checked=true;document.querySelector('#save-ai-settings').click()`); await pause(200);
await evaluate(`document.querySelector('#show-chat').click();document.querySelector('#new-chat').click()`); await pause(250);
await send('Runtime.evaluate',{expression:`document.querySelector('#chat-input').focus()`});
await send('Input.insertText',{text:'Explain why this original sentence uses the past perfect.'});
await evaluate(`document.querySelector('#chat-history').checked=true;document.querySelector('#preview-chat').click()`); await pause(250);
results.preview=await evaluate(`({
  visible:!document.querySelector('#chat-preview').hidden,
  content:document.querySelector('#chat-preview-content').textContent,
  meta:document.querySelector('#chat-preview-meta').textContent,
  messageCount:document.querySelectorAll('.chat-message').length,
  draft:document.querySelector('#chat-input').value
})`);
await evaluate(`document.querySelector('#cancel-chat').click()`); await pause(50);
results.cancel=await evaluate(`({previewHidden:document.querySelector('#chat-preview').hidden,status:document.querySelector('#chat-status').textContent,messageCount:document.querySelectorAll('.chat-message').length,draft:document.querySelector('#chat-input').value})`);

await send('Network.setBlockedURLs',{urls:['*qianwenaiapi.com*','*dashscope.aliyuncs.com*']});
results.offlineLocal=await evaluate(`fetch('/api/v1/health').then(r=>r.json()).then(x=>x.status).catch(()=>null)`);
results.security=await evaluate(`({externalScripts:[...document.scripts].filter(s=>s.src&&!s.src.startsWith(location.origin)).length,usesTextOnly:!document.documentElement.innerHTML.includes('innerHTML')})`);
console.log(JSON.stringify(results,null,2));
ws.close();
