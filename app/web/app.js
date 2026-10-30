const token = document.querySelector('meta[name="scenelingo-token"]').content;
const headers = { 'X-SceneLingo-Token': token, Accept: 'application/json' };
const $ = (selector) => document.querySelector(selector);
const state = { libraryPage: 1, detailPage: 1, subtitleId: null, resume: null, targetCueId: null, resumeReviewItemId: null };

async function api(path) {
  const response = await fetch(path, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error('request_failed');
  return response.json();
}
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('request_failed');
  return response.json();
}
async function put(path, body) {
  const response = await fetch(path, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('request_failed');
  return response.json();
}
async function uploadSubtitle(file) {
  const body = new FormData(); body.append('file', file);
  const response = await fetch('/api/v1/subtitles', { method: 'POST', headers, body });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error?.code || `http_${response.status}`); }
  return response.json();
}
function errorMessage(error) {
  const messages = { subtitle_already_exists: '相同字幕已经存在，可直接打开。', subtitle_file_too_large: '文件过大，请拆分后重试。', subtitle_format_unsupported: '仅支持 SRT 或 VTT 文件。', invalid_token: '页面会话已失效，请刷新页面。' };
  return messages[error.message] || (navigator.onLine ? '操作失败，请检查输入后重试。' : '外部网络不可用；本地功能仍可使用，请重试。');
}
function text(element, value) { element.textContent = value; }
function showOnly(selector) {
  ['#progress-dashboard', '#subtitle-library', '#subtitle-detail', '#vocabulary-library', '#vocabulary-detail', '#review-panel', '#chat-panel', '#settings-panel'].forEach((id) => { $(id).hidden = id !== selector; });
}

async function loadProgress() {
  showOnly('#progress-dashboard'); $('#back-to-library').hidden = true;
  try {
    const [summary, daily, resume] = await Promise.all([api('/api/v1/progress/summary'), api('/api/v1/progress/daily'), api('/api/v1/progress/continue')]);
    state.resume = resume;
    const stats = $('#progress-stats'); stats.replaceChildren();
    [['学习词条', summary.total_active], ['待学习', summary.new_count], ['学习中', summary.learning_count], ['已掌握', summary.mastered_count], ['今日到期', summary.due_today_count]].forEach(([label, value]) => {
      const card=document.createElement('article'); const number=document.createElement('strong'); text(number,String(value)); const name=document.createElement('span'); text(name,label); card.append(number,name); stats.append(card);
    });
    const records=$('#daily-records'); records.replaceChildren();
    daily.items.forEach(item=>{const row=document.createElement('article');row.className='daily-record';const accuracy=item.review_accuracy===null?'暂无':`${Math.round(item.review_accuracy*100)}%`;text(row,`${item.date} · 新增词条 ${item.new_learning_item_count} · 复习 ${item.review_attempt_count} 次（${item.distinct_review_item_count} 个词）· 正确 ${item.correct_review_count} · 正确率 ${accuracy} · AI 保存 ${item.ai_saved_content_count}`);records.append(row);});
    text($('#progress-message'),daily.total?'':'暂无学习记录。仅打开、导入或浏览不会产生学习日。');
    $('#continue-card').hidden=!resume.available;
    if(resume.available){const parts=[];if(resume.subtitle)parts.push(`${resume.subtitle.subtitle_title} · cue #${resume.subtitle.cue_sequence}`);if(resume.review)parts.push(`复习剩余 ${resume.review.remaining_count} 个`);text($('#continue-summary'),parts.join('；'));}
    text($('#continue-message'),resume.stale_reference?'部分上次位置已失效；可用位置仍可继续。':(resume.available?'':'还没有可继续的位置。'));
    if(resume.stale_reference&&!resume.available){await loadLibrary();text($('#library-message'),'上次学习位置已失效，已返回字幕库。');}
  } catch (_) { text($('#progress-message'),'学习记录加载失败，请重试。'); }
}

async function loadLibrary() {
  showOnly('#subtitle-library'); $('#back-to-library').hidden = true;
  const query = new URLSearchParams({ status: $('#subtitle-status').value, q: $('#subtitle-search').value, sort: $('#subtitle-sort').value, page: String(state.libraryPage), page_size: '50' });
  try {
    const data = await api(`/api/v1/subtitles?${query}`);
    const list = $('#subtitle-list'); list.replaceChildren();
    data.items.forEach((item) => {
      const card = document.createElement('article'); card.className = 'subtitle-card';
      const heading = document.createElement('h3'); text(heading, item.title);
      const stats = document.createElement('p');
      const invalid = item.invalid_cue_count === null ? '跳过数未知（旧数据）' : `跳过 ${item.invalid_cue_count} 条`;
      text(stats, `${item.source_format.toUpperCase()} · ${item.cue_count} cue · ${item.token_occurrence_count} 词次 · ${item.unique_token_count} 去重词形 · ${invalid}`);
      const button = document.createElement('button'); button.type = 'button'; button.dataset.subtitleId = item.id; text(button, '打开');
      const lifecycle = document.createElement('span');
      const archive = document.createElement('button'); archive.type = 'button'; archive.dataset.lifecycleId = item.id;
      archive.dataset.action = item.status === 'archived' ? 'restore' : 'archive'; text(archive, item.status === 'archived' ? '恢复' : '归档（推荐）');
      const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.lifecycleId = item.id; remove.dataset.action = 'delete'; text(remove, '删除…');
      lifecycle.append(archive, remove); card.append(heading, stats, button, lifecycle); list.append(card);
    });
    text($('#library-message'), data.total ? '' : '还没有导入字幕。字幕导入入口将在后续界面任务中完善。');
    text($('#library-page'), `第 ${data.page} 页 · 共 ${data.total} 条`);
    $('#library-prev').disabled = data.page <= 1; $('#library-next').disabled = data.page * data.page_size >= data.total;
  } catch (_) { text($('#library-message'), '字幕库加载失败，请刷新页面。'); }
}

async function loadDetail() {
  try {
    const data = await api(`/api/v1/subtitles/${state.subtitleId}?page=${state.detailPage}&page_size=50`);
    showOnly('#subtitle-detail'); $('#back-to-library').hidden = false;
    text($('#detail-title'), data.subtitle.title);
    text($('#detail-summary'), `${data.subtitle.cue_count} cue · ${data.subtitle.token_occurrence_count} 词次 · ${data.subtitle.unique_token_count} 去重词形`);
    const list = $('#cue-list'); list.replaceChildren();
    data.cues.forEach((cue) => {
      const item = document.createElement('li'); item.id = `cue-${cue.id}`;
      const timeline = document.createElement('span'); timeline.className = 'timeline'; text(timeline, `#${cue.sequence}  ${cue.start_time} → ${cue.end_time}`);
      const content = document.createElement('span'); text(content, cue.text); item.append(timeline, content); list.append(item);
      const play=document.createElement('button'); play.type='button'; play.dataset.speechText=cue.text; play.dataset.speechTarget='sentence'; text(play,'朗读句子'); item.append(play);
      const ask=document.createElement('button'); ask.type='button'; ask.dataset.chatCueId=cue.id; ask.dataset.chatContext=cue.text; text(ask,'用 AI 学习'); item.append(ask);
    });
    const resumeCue=data.cues.find(cue=>cue.id===state.targetCueId)||data.cues[0];
    if(resumeCue){await put('/api/v1/progress/continue',{subtitle_id:state.subtitleId,cue_id:resumeCue.id});state.targetCueId=null;}
    text($('#detail-message'), data.cues.length ? '' : '本页没有 cue。');
    text($('#cue-page'), `第 ${data.page} 页 · 共 ${data.total} 条`);
    $('#cue-prev').disabled = data.page <= 1; $('#cue-next').disabled = data.page * data.page_size >= data.total;
    await loadCandidates();
  } catch (_) { text($('#detail-message'), '字幕来源已不可用或加载失败。'); }
}

async function loadCandidates() {
  try {
    const data = await api(`/api/v1/subtitles/${state.subtitleId}/candidates?page_size=50`);
    const list = $('#candidate-list'); list.replaceChildren();
    data.items.forEach((candidate) => {
      const row = document.createElement('div'); row.className = 'candidate';
      const label = document.createElement('span'); text(label, `${candidate.display_form} · ${candidate.occurrence_count} 次 · 首次 #${candidate.first_sequence}`);
      const button = document.createElement('button'); button.type = 'button';
      if (candidate.in_library) { text(button, '已加入'); button.disabled = true; }
      else { text(button, '加入学习库'); button.dataset.tokenKey = candidate.token_key; button.dataset.cueId = candidate.first_cue_id; }
      row.append(label, button); list.append(row);
    });
    text($('#candidate-message'), data.total ? '' : '没有可加入的词形。');
  } catch (_) { text($('#candidate-message'), '词汇候选加载失败。'); }
}

async function loadVocabulary() {
  showOnly('#vocabulary-library'); $('#back-to-library').hidden = true;
  const query = new URLSearchParams({ q: $('#vocabulary-search').value, sort: $('#vocabulary-sort').value });
  try {
    const data = await api(`/api/v1/vocabulary?${query}`); const list = $('#vocabulary-list'); list.replaceChildren();
    data.items.forEach((word) => {
      const row = document.createElement('div'); row.className = 'word-card';
      const label = document.createElement('span'); text(label, `${word.display_text} · 待学习 · ${word.context_count} 个语境`);
      const button = document.createElement('button'); button.type = 'button'; button.dataset.wordId = word.id; text(button, '查看详情');
      row.append(label, button); list.append(row);
    });
    text($('#vocabulary-message'), data.total ? '' : '学习库还没有词条。请从字幕候选中逐个加入。');
  } catch (_) { text($('#vocabulary-message'), '学习库加载失败。'); }
}

async function loadWord(itemId) {
  try {
    const word = await api(`/api/v1/vocabulary/${itemId}`); showOnly('#vocabulary-detail'); text($('#word-title'), word.display_text);
    const ipa=await api(`/api/v1/pronunciation?word=${encodeURIComponent(word.dedupe_key)}`);
    $('#play-word').dataset.speechText=word.display_text; $('#play-word').dataset.speechTarget='word';
    $('#word-title').dataset.wordId=word.id;
    const fields = $('#word-fields'); fields.replaceChildren();
    [['状态', '待学习'], ['IPA', ipa.display], ['音标来源', ipa.found ? `${ipa.source} · ${ipa.accent}` : '本地未收录'], ['释义', word.definition_display], ['下次复习', word.next_review_display], ['复习历史', word.review_history_display]].forEach(([name, value]) => {
      const term = document.createElement('dt'); const description = document.createElement('dd'); text(term, name); text(description, value); fields.append(term, description);
    });
    const contexts = $('#context-list'); contexts.replaceChildren();
    word.contexts.forEach((context) => {
      const row = document.createElement('div'); row.className = 'context-card';
      const label = document.createElement('span'); text(label, `${context.subtitle_title} · ${context.start_time} → ${context.end_time}\n${context.text}`);
      const link = document.createElement('button'); link.type = 'button'; text(link, context.available ? '定位 cue' : '来源已不可用'); link.disabled = !context.available;
      if (context.available) { link.dataset.subtitleId = context.subtitle_id; link.dataset.cueId = context.cue_id; }
      row.append(label, link); contexts.append(row);
    });
    const history=await api(`/api/v1/review/items/${itemId}/history`); const historyList=$('#review-history'); historyList.replaceChildren();
    history.items.forEach((attempt) => { const row=document.createElement('p'); text(row,`${attempt.attempted_local_date} · ${attempt.mode} · ${attempt.final_rating} · 下次 ${attempt.next_review_date}`); historyList.append(row); });
    if (!history.total) text(historyList,'暂无复习历史。');
  } catch (_) { text($('#vocabulary-message'), '词条详情加载失败。'); }
}

$('#library-controls').addEventListener('submit', (event) => { event.preventDefault(); state.libraryPage = 1; loadLibrary(); });
$('#subtitle-list').addEventListener('click', (event) => { const id = event.target.dataset.subtitleId; if (id) { state.subtitleId = Number(id); state.detailPage = 1; loadDetail(); } });
$('#subtitle-list').addEventListener('click', async (event) => {
  const id = Number(event.target.dataset.lifecycleId); const action = event.target.dataset.action;
  if (!id || !action) return;
  try {
    if (action === 'archive' || action === 'restore') await post(`/api/v1/subtitles/${id}/${action}`, {});
    else {
      const preview = await api(`/api/v1/subtitles/${id}/deletion-preview`);
      const strategy = preview.direct_delete_allowed ? 'direct' : 'freeze_snapshot';
      const warning = preview.direct_delete_allowed ? '确认永久删除该字幕？此操作不可撤销。' : `该字幕关联 ${preview.associated_context_count} 个学习语境。确认删除字幕并保留冻结快照？`;
      if (!window.confirm(warning)) return;
      await post(`/api/v1/subtitles/${id}/delete`, { strategy, confirmed: true });
    }
    await loadLibrary();
  } catch (_) { text($('#library-message'), '操作未完成；有关联字幕只能归档或确认保留冻结快照后删除。'); }
});
$('#library-prev').addEventListener('click', () => { state.libraryPage -= 1; loadLibrary(); });
$('#library-next').addEventListener('click', () => { state.libraryPage += 1; loadLibrary(); });
$('#cue-prev').addEventListener('click', () => { state.detailPage -= 1; loadDetail(); });
$('#cue-next').addEventListener('click', () => { state.detailPage += 1; loadDetail(); });
$('#back-to-library').addEventListener('click', loadLibrary);
$('#show-library').addEventListener('click', loadLibrary);
$('#show-dashboard').addEventListener('click', loadProgress);
$('#show-vocabulary').addEventListener('click', loadVocabulary);
$('#show-review').addEventListener('click', () => showOnly('#review-panel'));
$('#show-chat').addEventListener('click', () => { showOnly('#chat-panel'); loadConversations(); });
$('#show-settings').addEventListener('click', () => { showOnly('#settings-panel'); loadAiSettings(); });
$('#back-to-vocabulary').addEventListener('click', loadVocabulary);
$('#vocabulary-controls').addEventListener('submit', (event) => { event.preventDefault(); loadVocabulary(); });
$('#candidate-list').addEventListener('click', async (event) => {
  if (!event.target.dataset.tokenKey) return;
  try { await post('/api/v1/vocabulary', { subtitle_id: state.subtitleId, cue_id: Number(event.target.dataset.cueId), token_key: event.target.dataset.tokenKey }); await loadCandidates(); }
  catch (_) { text($('#candidate-message'), '加入失败，请重试。'); }
});
$('#vocabulary-list').addEventListener('click', (event) => { if (event.target.dataset.wordId) loadWord(Number(event.target.dataset.wordId)); });
$('#context-list').addEventListener('click', async (event) => {
  if (!event.target.dataset.subtitleId) return;
  state.subtitleId = Number(event.target.dataset.subtitleId);
  try {
    const located = await api(`/api/v1/subtitles/${state.subtitleId}/locate?cue_id=${event.target.dataset.cueId}`);
    if (!located.available) { text($('#vocabulary-message'), '来源已不可用。'); return; }
    state.detailPage = Math.ceil(located.target.sequence / 50); state.targetCueId=Number(event.target.dataset.cueId); await loadDetail();
    document.querySelector(`#cue-${event.target.dataset.cueId}`)?.scrollIntoView({ block: 'center' });
  } catch (_) { text($('#vocabulary-message'), '来源定位失败。'); }
});
document.addEventListener('click',async(event)=>{
  if (event.target.dataset.speechText) {
    try { const result=await post('/api/v1/speech/play',{text:event.target.dataset.speechText,target:event.target.dataset.speechTarget}); text($('#speech-message'),`正在本地朗读（${result.character_count} 字符）`); }
    catch (_) { text($('#speech-message'),'本地语音不可用或播放失败。'); }
  }
  if (event.target.classList.contains('stop-speech')) { try { await post('/api/v1/speech/stop',{}); text($('#speech-message'),'朗读已停止。'); } catch (_) { text($('#speech-message'),'停止朗读失败。'); } }
});
$('#subtitle-upload').addEventListener('submit', async (event) => {
  event.preventDefault(); const file=$('#subtitle-file').files[0]; if (!file) return;
  text($('#upload-message'),'正在本地解析并保存…');
  try { const result=await uploadSubtitle(file); text($('#upload-message'),`已导入 ${result.subtitle.title}：${result.subtitle.cue_count} 条 cue`); state.libraryPage=1; await loadLibrary(); }
  catch (error) { text($('#upload-message'),errorMessage(error)); }
});

let reviewItems = [];
$('#load-review').addEventListener('click', async () => {
  try {
    const mode=$('#review-mode').value; const data=await api(`/api/v1/review/queue?mode=${mode}`); reviewItems=data.items;
    if(state.resumeReviewItemId){const index=reviewItems.findIndex(item=>item.learning_item_id===state.resumeReviewItemId);if(index>0)reviewItems=reviewItems.slice(index).concat(reviewItems.slice(0,index));state.resumeReviewItemId=null;}
    text($('#review-message'), data.message || `到期 ${data.total} 个词条`); $('#review-card').hidden=!data.total;
    if (data.total) { text($('#review-prompt'), mode === 'spelling' ? (data.items[0].context || '请根据记忆拼写当前词条。') : data.items[0].display_text); await put('/api/v1/progress/continue',{review_item_id:data.items[0].learning_item_id}); }
    else await put('/api/v1/progress/continue',{clear_review:true});
    $('#review-input').hidden = mode !== 'spelling';
  } catch (_) { text($('#review-message'),'复习队列加载失败。'); }
});
$('#submit-review').addEventListener('click', async () => {
  if (!reviewItems.length) return; const mode=$('#review-mode').value;
  const rating=document.querySelector('input[name="rating"]:checked').value;
  try {
    const result=await post('/api/v1/review/attempts',{learning_item_id:reviewItems[0].learning_item_id,mode,user_input:mode==='spelling'?$('#review-input').value:null,final_rating:rating,attempt_token:crypto.randomUUID()});
    text($('#review-message'),`已保存：${result.status}，下次 ${result.next_review_date}`); reviewItems.shift();
    if(reviewItems.length){text($('#review-prompt'),mode==='spelling'?(reviewItems[0].context||'请根据记忆拼写当前词条。'):reviewItems[0].display_text);await put('/api/v1/progress/continue',{review_item_id:reviewItems[0].learning_item_id});$('#review-input').value='';}
    else {await put('/api/v1/progress/continue',{clear_review:true});$('#review-card').hidden=true;}
  } catch (_) { text($('#review-message'),'提交失败；未确认保存前不会产生复习记录。'); }
});

api('/api/v1/system/info')
  .then((info) => text($('#service-status'), `本地服务正常运行 · 版本 ${info.version}`))
  .catch(() => text($('#service-status'), '无法获取服务状态，请刷新页面。'));
loadProgress();

$('#progress-range').addEventListener('submit',async event=>{event.preventDefault();try{const query=new URLSearchParams();if($('#progress-start').value)query.set('start_date',$('#progress-start').value);if($('#progress-end').value)query.set('end_date',$('#progress-end').value);const data=await api(`/api/v1/progress/daily?${query}`);const records=$('#daily-records');records.replaceChildren();data.items.forEach(item=>{const row=document.createElement('article');row.className='daily-record';const accuracy=item.review_accuracy===null?'暂无':`${Math.round(item.review_accuracy*100)}%`;text(row,`${item.date} · 新增词条 ${item.new_learning_item_count} · 复习 ${item.review_attempt_count} 次（${item.distinct_review_item_count} 个词）· 正确 ${item.correct_review_count} · 正确率 ${accuracy} · AI 保存 ${item.ai_saved_content_count}`);records.append(row);});text($('#progress-message'),data.total?'':'所选日期暂无学习记录。');}catch(_){text($('#progress-message'),'日期范围无效。');}});
$('#continue-learning').addEventListener('click',async()=>{const resume=state.resume;if(!resume)return;if(resume.subtitle){state.subtitleId=resume.subtitle.subtitle_id;state.detailPage=Math.ceil(resume.subtitle.cue_sequence/50);state.targetCueId=resume.subtitle.cue_id;await loadDetail();document.querySelector(`#cue-${resume.subtitle.cue_id}`)?.scrollIntoView({block:'center'});}else if(resume.review){state.resumeReviewItemId=resume.review.learning_item_id;showOnly('#review-panel');$('#load-review').click();}else{await loadLibrary();text($('#library-message'),'上次位置已失效，已返回字幕库。');}});
function updateNetworkState() { text($('#network-state'),navigator.onLine?'当前可联网；本地功能不依赖网络。':'当前离线；字幕、学习库和复习仍可使用。'); }
window.addEventListener('online',updateNetworkState); window.addEventListener('offline',updateNetworkState); updateNetworkState();

let aiPlan = null;
async function loadAiSettings() {
  try { const data=await api('/api/v1/ai/settings'); $('#cloud-enabled').checked=data.cloud_enabled; $('#cloud-consent').checked=data.consent_accepted; $('#cloud-model').value=data.model; text($('#ai-status'),`Key：${data.key_status==='configured'?'已配置（已掩码）':'未配置'} · 云端：${data.cloud_enabled?'已启用':'已关闭'}`); }
  catch (_) { text($('#ai-status'),'云端设置读取失败；本地功能不受影响。'); }
}
$('#save-ai-settings').addEventListener('click',async()=>{ try { await fetch('/api/v1/ai/settings',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({cloud_enabled:$('#cloud-enabled').checked,consent_accepted:$('#cloud-consent').checked,model:$('#cloud-model').value})}).then(r=>{if(!r.ok)throw new Error();return r.json();}); await loadAiSettings(); } catch (_) { text($('#ai-status'),'设置保存失败。'); } });
$('#save-api-key').addEventListener('click',async()=>{ try { await fetch('/api/v1/ai/key',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({key:$('#api-key').value})}).then(r=>{if(!r.ok)throw new Error();return r.json();}); $('#api-key').value=''; await loadAiSettings(); } catch (_) { $('#api-key').value=''; text($('#ai-status'),'Key 未保存，请检查 Keychain。'); } });
$('#delete-api-key').addEventListener('click',async()=>{ try { await fetch('/api/v1/ai/key',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'}}).then(r=>{if(!r.ok)throw new Error();}); await loadAiSettings(); } catch (_) { text($('#ai-status'),'Key 删除失败。'); } });
$('#preview-ai').addEventListener('click',async()=>{ try { aiPlan=await post('/api/v1/ai/send-plans',{kind:$('#ai-kind').value,text:$('#ai-text').value,context:$('#ai-context').value}); text($('#ai-preview-content'),JSON.stringify(aiPlan.actual_content,null,2)); $('#ai-preview').hidden=false; text($('#ai-result'),'请逐项检查以上内容；确认后才会联网。'); } catch (_) { text($('#ai-result'),'无法生成预览：请检查云端同意、开关与 Key。'); } });
$('#cancel-ai').addEventListener('click',()=>{aiPlan=null;$('#ai-preview').hidden=true;text($('#ai-result'),'已取消，没有发送。');});
$('#confirm-ai').addEventListener('click',async()=>{ if(!aiPlan)return; const current=aiPlan; aiPlan=null; $('#ai-preview').hidden=true; try { const result=await post('/api/v1/ai/execute',{plan_id:current.plan_id,execution_token:current.execution_token}); text($('#ai-result'),`${result.result}\n来源：${result.source==='local_cache'?'本地缓存':'千问 API'} · 模型：${result.model}`); } catch (_) { text($('#ai-result'),'千问调用失败；没有自动重试，本地功能仍可使用。'); } });

const chatState={conversationId:null,plan:null,context:null,controller:null,saveMessageId:null};
async function loadConversations(){
  try { const data=await api('/api/v1/ai/chat/conversations'); const list=$('#conversation-list'); list.replaceChildren(); data.items.forEach(c=>{const row=document.createElement('div');const open=document.createElement('button');open.type='button';open.dataset.conversationId=c.id;text(open,`${c.title} (${c.message_count})`);const del=document.createElement('button');del.type='button';del.dataset.deleteConversation=c.id;text(del,'删除');row.append(open,del);list.append(row);}); if(!data.items.length)text($('#chat-status'),'请新建会话。'); }
  catch(_){text($('#chat-status'),'会话列表加载失败。');}
}
async function openConversation(id){
  try { const data=await api(`/api/v1/ai/chat/conversations/${id}`);chatState.conversationId=id;const list=$('#chat-messages');list.replaceChildren();data.messages.forEach(renderChatMessage);text($('#chat-status'),data.title); }
  catch(_){text($('#chat-status'),'会话加载失败。');}
}
function renderChatMessage(message){const card=document.createElement('article');card.className=`chat-message ${message.role}`;const meta=document.createElement('span');meta.className='message-meta';text(meta,message.role==='assistant'?`AI 生成，可能不准确 · ${message.status}`:`你 · ${message.status}`);const body=document.createElement('span');text(body,message.content);card.append(meta,body);if(message.role==='assistant'&&message.status==='complete'){const save=document.createElement('button');save.type='button';save.dataset.saveMessageId=message.id;save.dataset.saveText=message.content;text(save,'保存选中内容');card.append(save);}$('#chat-messages').append(card);return card;}
$('#new-chat').addEventListener('click',async()=>{try{const c=await post('/api/v1/ai/chat/conversations',{title:'新会话'});await loadConversations();await openConversation(c.id);}catch(_){text($('#chat-status'),'新建会话失败。');}});
$('#conversation-list').addEventListener('click',async event=>{if(event.target.dataset.conversationId)openConversation(Number(event.target.dataset.conversationId));if(event.target.dataset.deleteConversation){const id=Number(event.target.dataset.deleteConversation);if(!window.confirm('删除会话？已保存学习内容会保留。'))return;try{await fetch(`/api/v1/ai/chat/conversations/${id}`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'}}).then(r=>{if(!r.ok)throw new Error();});if(chatState.conversationId===id){chatState.conversationId=null;$('#chat-messages').replaceChildren();}loadConversations();}catch(_){text($('#chat-status'),'删除会话失败。');}}});
document.addEventListener('click',event=>{if(event.target.dataset.chatCueId){chatState.context={cue_id:Number(event.target.dataset.chatCueId),text:event.target.dataset.chatContext};text($('#chat-context'),`当前字幕：${chatState.context.text}`);$('#remove-chat-context').hidden=false;showOnly('#chat-panel');loadConversations();}});
$('#remove-chat-context').addEventListener('click',()=>{chatState.context=null;text($('#chat-context'),'未引用字幕或词条');$('#remove-chat-context').hidden=true;});
$('#ask-word-ai').addEventListener('click',()=>{chatState.context={learning_item_id:Number($('#word-title').dataset.wordId),text:$('#word-title').textContent};text($('#chat-context'),`选中词：${chatState.context.text}`);$('#remove-chat-context').hidden=false;showOnly('#chat-panel');loadConversations();});
$('#preview-chat').addEventListener('click',async()=>{if(!chatState.conversationId){text($('#chat-status'),'请先新建或打开会话。');return;}try{chatState.plan=await post('/api/v1/ai/chat/send-plans',{conversation_id:chatState.conversationId,text:$('#chat-input').value,template:$('#chat-template').value,history_count:$('#chat-history').checked?2:0,cue_id:chatState.context?.cue_id||null,learning_item_id:chatState.context?.learning_item_id||null});text($('#chat-preview-content'),JSON.stringify(chatState.plan.actual_content,null,2));text($('#chat-preview-meta'),`历史 ${chatState.plan.history_count} 条 · 附件 ${chatState.plan.attachments.length} 个 · 模型 ${chatState.plan.model} · 目的地 千问 API`);$('#chat-preview').hidden=false;}catch(_){text($('#chat-status'),'无法生成预览，请检查云端设置、Key 和输入。');}});
$('#cancel-chat').addEventListener('click',()=>{chatState.plan=null;$('#chat-preview').hidden=true;text($('#chat-status'),'已取消，没有发送。');});
$('#confirm-chat').addEventListener('click',async()=>{if(!chatState.plan)return;const plan=chatState.plan;chatState.plan=null;$('#chat-preview').hidden=true;chatState.controller=new AbortController();$('#cancel-stream').disabled=false;const pending=renderChatMessage({role:'assistant',status:'pending',content:''});const body=pending.querySelector('span:not(.message-meta)');try{const response=await fetch('/api/v1/ai/chat/execute',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({plan_id:plan.plan_id,execution_token:plan.execution_token}),signal:chatState.controller.signal});if(!response.ok)throw new Error();const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const blocks=buffer.split('\n\n');buffer=blocks.pop();for(const block of blocks){const event=block.match(/^event: (.+)$/m)?.[1];const raw=block.match(/^data: (.+)$/m)?.[1];if(!event||!raw)continue;const data=JSON.parse(raw);if(event==='delta')body.textContent+=data.text;if(event==='done'){pending.querySelector('.message-meta').textContent=`AI 生成，可能不准确 · ${data.status}`;text($('#chat-status'),data.status==='incomplete'?`回答不完整（达到输出限制）· 估算费用 ${data.cost.estimated_cost} ${data.cost.currency}`:`完成 · 估算费用 ${data.cost.estimated_cost} ${data.cost.currency}`);}if(event==='error'){pending.querySelector('.message-meta').textContent=`AI 生成，可能不准确 · ${data.status}`;text($('#chat-status'),data.message);}}}await openConversation(chatState.conversationId);await loadConversations();}catch(error){text($('#chat-status'),error.name==='AbortError'?'已取消生成；未标记为完成。':'网络错误；草稿仍保留，可手动重试。');}finally{$('#cancel-stream').disabled=true;chatState.controller=null;}});
$('#cancel-stream').addEventListener('click',()=>chatState.controller?.abort());
$('#chat-messages').addEventListener('click',event=>{if(!event.target.dataset.saveMessageId)return;chatState.saveMessageId=Number(event.target.dataset.saveMessageId);$('#save-ai-text').value=event.target.dataset.saveText;$('#save-ai-panel').hidden=false;});
$('#cancel-save-ai').addEventListener('click',()=>{$('#save-ai-panel').hidden=true;chatState.saveMessageId=null;});
$('#confirm-save-ai').addEventListener('click',async()=>{try{const result=await post('/api/v1/ai/chat/save',{message_id:chatState.saveMessageId,entry_type:$('#save-ai-type').value,text:$('#save-ai-text').value,confirmed:true});text($('#chat-status'),result.duplicate?'相同内容已存在，请选择合并或取消；未重复创建。':'已确认保存到学习库。');$('#save-ai-panel').hidden=true;}catch(_){text($('#chat-status'),'保存失败，请检查类型和内容。');}});
