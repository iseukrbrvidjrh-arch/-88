import { spawn } from 'node:child_process';

const base=process.argv[2]||'http://127.0.0.1:18768';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=`/private/tmp/scenelingo-task012-chrome-${process.pid}`;const port=19224;
const child=spawn(chrome,['--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking',base],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let ws,id=0;const pending=new Map();const requests=[];
async function command(method,params={}){const call=++id;ws.send(JSON.stringify({id:call,method,params}));return new Promise((resolve,reject)=>pending.set(call,{resolve,reject}));}
async function evaluate(expression){const message=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(message.result.exceptionDetails)throw new Error(message.result.exceptionDetails.text);return message.result.result.value;}
async function waitFor(expression,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await sleep(100);}throw new Error(`timeout: ${expression}`);}
try{
  let target;for(let attempt=0;attempt<100;attempt++){try{const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();target=pages.find(page=>page.type==='page');if(target)break;}catch(_){}await sleep(100);}if(!target)throw new Error('Chrome target unavailable');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const waiter=pending.get(message.id);pending.delete(message.id);message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message);}if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);};
  await command('Runtime.enable');await command('Network.enable');await command('DOM.enable');
  await waitFor(`!document.querySelector('#progress-dashboard').hidden`);
  const empty=await evaluate(`({message:document.querySelector('#progress-message').textContent,total:document.querySelector('#progress-stats article strong').textContent})`);
  for(const [width,height] of [[1280,800],[1440,900]]){await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});if(await evaluate(`document.documentElement.scrollWidth>document.documentElement.clientWidth`))throw new Error(`overflow ${width}x${height}`);}
  await evaluate(`document.querySelector('#show-library').click()`);await waitFor(`!document.querySelector('#subtitle-library').hidden`);
  const doc=await command('DOM.getDocument');const input=await command('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'#subtitle-file'});await command('DOM.setFileInputFiles',{nodeId:input.result.nodeId,files:[`${process.cwd()}/tests/fixtures/task008-browser.srt`]});
  await evaluate(`document.querySelector('#subtitle-upload').requestSubmit()`);await waitFor(`document.querySelectorAll('.subtitle-card').length===1`);
  await evaluate(`document.querySelector('[data-subtitle-id]').click()`);await waitFor(`!document.querySelector('#subtitle-detail').hidden&&document.querySelector('[data-token-key]')`);
  await evaluate(`Array.from(document.querySelectorAll('[data-token-key]')).find(button=>button.dataset.tokenKey==="don't").click()`);await waitFor(`!Array.from(document.querySelectorAll('[data-token-key]')).some(button=>button.dataset.tokenKey==="don't")`);
  await evaluate(`document.querySelector('#show-review').click();document.querySelector('#load-review').click()`);await waitFor(`!document.querySelector('#review-card').hidden`);
  await evaluate(`document.querySelector('#review-input').value="don't";document.querySelector('#submit-review').click()`);await waitFor(`document.querySelector('#review-message').textContent.includes('已保存')`);
  await evaluate(`document.querySelector('#show-dashboard').click()`);await waitFor(`!document.querySelector('#progress-dashboard').hidden&&document.querySelectorAll('.daily-record').length===1`);
  const populated=await evaluate(`({stats:[...document.querySelectorAll('#progress-stats article')].map(x=>x.textContent),record:document.querySelector('.daily-record').textContent,continueVisible:!document.querySelector('#continue-card').hidden,continueText:document.querySelector('#continue-summary').textContent})`);
  await evaluate(`document.querySelector('#continue-learning').click()`);await waitFor(`!document.querySelector('#subtitle-detail').hidden`);
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  const localStillRendered=await evaluate(`document.querySelector('#detail-title').textContent.length>0&&document.querySelectorAll('#cue-list li').length>0`);
  const external=requests.filter(url=>!url.startsWith(base)&&!url.startsWith('data:')&&!url.startsWith('devtools:'));
  if(external.length)throw new Error(`external requests: ${external.join(',')}`);
  console.log(JSON.stringify({ok:true,empty,populated,continuedToCue:true,offlineLocalRendered:localStillRendered,viewports:['1280x800','1440x900'],externalRequests:0},null,2));
}finally{if(ws)ws.close();child.kill('SIGTERM');}
