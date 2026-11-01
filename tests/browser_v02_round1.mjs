import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root=process.cwd();const base='http://127.0.0.1:18772';const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sandbox=mkdtempSync(join(tmpdir(),'scenelingo-v02-round1-'));const dataDir=join(sandbox,'data');const subtitle=join(sandbox,'round1.srt');
writeFileSync(subtitle,Array.from({length:36},(_,i)=>`${i+1}\n00:00:${String(i).padStart(2,'0')},000 --> 00:00:${String(i+1).padStart(2,'0')},000\nPractice makes progress, and careful practice makes language memorable.`).join('\n\n'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitHealth(){for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/v1/health`)).ok)return;}catch(_){}await sleep(100);}throw new Error('server unavailable');}
function startServer(){return spawn(`${root}/.venv/bin/python`,['-m','app.main','--port','18772','--data-dir',dataDir],{cwd:root,stdio:'ignore'});}
let server=startServer();await waitHealth();
const profile=join(sandbox,'chrome');const debugPort=19227;const browser=spawn(chrome,['--headless=new',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking',base],{stdio:'ignore'});
let ws,id=0;const pending=new Map(),requests=[];
async function command(method,params={}){const call=++id;ws.send(JSON.stringify({id:call,method,params}));return new Promise((resolve,reject)=>pending.set(call,{resolve,reject}));}
async function evaluate(expression){const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.result.exceptionDetails)throw new Error(result.result.exceptionDetails.text);return result.result.result.value;}
async function waitFor(expression,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await sleep(100);}throw new Error(`timeout: ${expression}`);}
async function reconnectPage(){for(let i=0;i<100;i++){try{const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();const target=pages.find(page=>page.type==='page');if(target){ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const waiter=pending.get(message.id);pending.delete(message.id);message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message);}if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);};await command('Runtime.enable');await command('Network.enable');await command('DOM.enable');return;}}catch(_){}await sleep(100);}throw new Error('Chrome target unavailable');}
try{
  await reconnectPage();await waitFor(`!document.querySelector('#progress-dashboard').hidden`);
  await evaluate(`document.querySelector('#show-library').click()`);const doc=await command('DOM.getDocument');const input=await command('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'#subtitle-file'});await command('DOM.setFileInputFiles',{nodeId:input.result.nodeId,files:[subtitle]});await evaluate(`document.querySelector('#subtitle-upload').requestSubmit()`);await waitFor(`document.querySelector('.subtitle-card')`);
  await evaluate(`document.querySelector('[data-subtitle-id]').click()`);await waitFor(`document.querySelector('.word-token')`);
  const layouts={};for(const [label,width,height,scale] of [['1280x800',1280,800,1],['1440x900',1440,900,1],['125%',1280,800,1.25]]){await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await command('Emulation.setPageScaleFactor',{pageScaleFactor:scale});layouts[label]=await evaluate(`({noHorizontalOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth,workbenchVisible:!document.querySelector('#subtitle-detail').hidden,cueScroll:document.querySelector('#cue-list').scrollHeight>document.querySelector('#cue-list').clientHeight})`);}
  await command('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  await evaluate(`Array.from(document.querySelectorAll('.word-token')).find(button=>button.dataset.word==='practice').click()`);await waitFor(`!document.querySelector('#word-popover').hidden&&document.querySelector('#popover-primary-ipa').textContent!=='正在查询本地词典…'`);const ipa=await evaluate(`({primary:document.querySelector('#popover-primary-ipa').textContent,all:Array.from(document.querySelectorAll('.pronunciation strong')).map(node=>node.textContent)})`);
  await evaluate(`document.querySelector('#popover-speak').click()`);await waitFor(`document.querySelector('#popover-message').textContent.includes('本地语音')`);
  await evaluate(`document.querySelector('#popover-save').click()`);await waitFor(`document.querySelector('#popover-save').disabled`);const savedBefore=await evaluate(`document.querySelector('#popover-message').textContent`);
  server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));server=startServer();await waitHealth();await evaluate(`location.reload()`);await waitFor(`!document.querySelector('#progress-dashboard').hidden`);await evaluate(`document.querySelector('#show-library').click()`);await waitFor(`document.querySelector('.subtitle-card')`);await evaluate(`document.querySelector('[data-subtitle-id]').click()`);await waitFor(`document.querySelector('.word-token.is-saved')`);const persisted=await evaluate(`Array.from(document.querySelectorAll('.word-token.is-saved')).some(button=>button.dataset.word==='practice')`);
  const external=requests.filter(url=>!url.startsWith(base)&&!url.startsWith('data:')&&!url.startsWith('devtools:'));if(external.length)throw new Error(`external requests: ${external.join(',')}`);
  console.log(JSON.stringify({ok:true,layouts,ipa,speechRequested:true,savedBefore,persistedAfterRestart:persisted,externalRequests:0,dataDir},null,2));
}finally{if(ws)ws.close();browser.kill('SIGTERM');server.kill('SIGTERM');}
