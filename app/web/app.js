const token = document.querySelector('meta[name="scenelingo-token"]').content;
const headers = { 'X-SceneLingo-Token': token, Accept: 'application/json' };
const $ = (selector) => document.querySelector(selector);
const state = { libraryPage: 1, detailPage: 1, subtitleId: null, resume: null, targetCueId: null, resumeReviewItemId: null, currentCue: null, selectedWord: null, dictationToken: null, cues: [] };
function parsePlatformUrl(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)return null;const host=url.hostname.toLowerCase();let id='';if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host)){if(url.pathname==='/watch')id=url.searchParams.get('v')||'';else id=(url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{6,})/)||[])[1]||'';if(id)return {provider:'YouTube',embed:`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1&rel=0`};}if(host==='youtu.be'){id=(url.pathname.match(/^\/([\w-]{6,})/)||[])[1]||'';if(id)return {provider:'YouTube',embed:`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1&rel=0`};}if(['bilibili.com','www.bilibili.com','m.bilibili.com'].includes(host)){const match=url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)/i);if(match){id=match[1];return {provider:'哔哩哔哩',embed:id.toLowerCase().startsWith('av')?`https://player.bilibili.com/player.html?aid=${encodeURIComponent(id.slice(2))}`:`https://player.bilibili.com/player.html?bvid=${encodeURIComponent(id)}`};}}return null;}catch(_){return null;}}

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
  const workbench = selector === '#subtitle-detail';
  document.body.dataset.view = workbench ? 'workbench' : 'standard';
  if (workbench) requestAnimationFrame(() => window.SceneLingoLayoutPreferences?.apply());
  const titles = { '#subtitle-library':'选择一份字幕，开始在语境里学习。', '#subtitle-detail':'在语境里，把词学活。', '#progress-dashboard':'看见积累，也看见节奏。', '#vocabulary-library':'把遇见的词，变成自己的。', '#review-panel':'按自己的节奏，完成今天的复习。', '#chat-panel':'让 AI 从当前问题开始帮助你。', '#settings-panel':'本地数据和云端发送都由你决定。' };
  const title = $('#page-title');
  if (selector === '#progress-dashboard') {
    title.replaceChildren();
    const greeting = document.createElement('span'); greeting.id = 'greeting-period';
    const encouragement = document.createElement('span'); encouragement.id = 'daily-encouragement';
    title.append(greeting, document.createTextNode('，'), encouragement);
    window.SceneLingoDailyGreeting?.refresh();
  } else text(title, titles[selector] || 'SceneLingo');
  const active = { '#progress-dashboard':'show-dashboard', '#subtitle-library':'show-library', '#subtitle-detail':'show-workbench', '#vocabulary-library':'show-vocabulary', '#vocabulary-detail':'show-vocabulary', '#review-panel':'show-review', '#chat-panel':'show-chat', '#settings-panel':'show-settings' }[selector];
  document.querySelectorAll('.side-nav button').forEach((button) => button.classList.toggle('is-active', button.id === active));
}

function appendWords(container, cue) {
  const pattern = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  let cursor = 0;
  for (const match of cue.text.matchAll(pattern)) {
    if (match.index > cursor) container.append(document.createTextNode(cue.text.slice(cursor, match.index)));
    const key = match[0].replace(/’/g, "'").toLowerCase();
    const button = document.createElement('button'); button.type = 'button'; button.className = 'word-token';
    button.dataset.word = key; button.dataset.cueId = cue.id; button.dataset.cueText = cue.text;
    if (cue.word_states?.[key]) { button.classList.add('is-saved'); button.dataset.learningItemId = cue.word_states[key]; }
    text(button, match[0]); container.append(button); cursor = match.index + match[0].length;
  }
  if (cursor < cue.text.length) container.append(document.createTextNode(cue.text.slice(cursor)));
}

function positionPopover(anchor) {
  const popover = $('#word-popover'); popover.hidden = false;
  const rect = anchor.getBoundingClientRect(); const width = Math.min(340, window.innerWidth - 24);
  popover.style.width = `${width}px`; let left = Math.min(rect.left, window.innerWidth - width - 12); left = Math.max(12, left);
  let top = rect.bottom + 8; if (top + popover.offsetHeight > window.innerHeight - 12) top = rect.top - popover.offsetHeight - 8;
  popover.style.left = `${left}px`; popover.style.top = `${Math.max(12, top)}px`;
}

async function openWordPopover(button) {
  state.selectedWord = { word: button.dataset.word, cueId: Number(button.dataset.cueId), cueText: button.dataset.cueText, button };
  document.querySelectorAll('.word-token.is-selected').forEach((item) => item.classList.remove('is-selected')); button.classList.add('is-selected');
  text($('#popover-word'), button.textContent); text($('#popover-primary-ipa'), '正在查询本地词典…');
  text($('#popover-context-text'), button.dataset.cueText); text($('#popover-message'), '');
  const save = $('#popover-save'); save.disabled = Boolean(button.dataset.learningItemId); text(save.querySelector('span'), save.disabled ? '已在生词库' : '加入生词库');
  $('#popover-pronunciations').replaceChildren(); positionPopover(button);
  try {
    const result = await api(`/api/v1/pronunciation?word=${encodeURIComponent(button.dataset.word)}`);
    text($('#popover-primary-ipa'), result.display);
    const list = $('#popover-pronunciations');
    result.pronunciations.forEach((value, index) => { const row=document.createElement('div');row.className='pronunciation';const label=document.createElement('span');text(label,`读音 ${index+1}`);const ipa=document.createElement('strong');text(ipa,value);row.append(label,ipa);list.append(row); });
    if (!result.found) text($('#popover-message'),'本地美式 IPA 词典暂未收录。');
    positionPopover(button);
  } catch (_) { text($('#popover-primary-ipa'),'查询失败'); text($('#popover-message'),'无法读取本地 IPA，请重试。'); }
}

function closeWordPopover() { $('#word-popover').hidden=true; document.querySelectorAll('.word-token.is-selected').forEach((item)=>item.classList.remove('is-selected')); state.selectedWord=null; }

function setupWorkbenchChat() {
  const pane=$('.tutor-pane'); const head=$('.tutor-head'); const placeholder=$('.tutor-placeholder');
  placeholder.remove();
  const status=document.createElement('small');status.id='wb-chat-status';text(status,'真实会话 · 发送前确认');head.querySelector('div').append(status);
  const fresh=document.createElement('button');fresh.id='wb-new-chat';fresh.type='button';text(fresh,'新建');head.append(fresh);
  const contextToggle=document.createElement('label');contextToggle.className='context-toggle';const contextCheck=document.createElement('input');contextCheck.id='wb-attach-context';contextCheck.type='checkbox';contextCheck.checked=true;contextToggle.append(contextCheck,document.createTextNode(' 随本次问题发送当前句'));$('.context-card').append(contextToggle);
  const historyLabel=document.createElement('label');historyLabel.className='history-select';historyLabel.append(document.createTextNode('历史会话'));const history=document.createElement('select');history.id='wb-chat-history';const option=document.createElement('option');option.value='';text(option,'请选择或新建会话');history.append(option);historyLabel.append(history);
  const messages=document.createElement('div');messages.id='wb-chat-messages';messages.className='wb-chat-messages';messages.setAttribute('aria-live','polite');
  const preview=document.createElement('div');preview.id='wb-chat-preview';preview.className='wb-chat-preview';preview.hidden=true;const previewTitle=document.createElement('strong');text(previewTitle,'发送预览');const content=document.createElement('pre');content.id='wb-chat-preview-content';const meta=document.createElement('p');meta.id='wb-chat-preview-meta';const previewActions=document.createElement('div');const confirm=document.createElement('button');confirm.id='wb-confirm-chat';confirm.type='button';text(confirm,'确认并发送');const cancel=document.createElement('button');cancel.id='wb-cancel-preview';cancel.type='button';text(cancel,'取消');previewActions.append(confirm,cancel);preview.append(previewTitle,content,meta,previewActions);
  const composer=document.createElement('div');composer.className='wb-chat-composer';const input=document.createElement('textarea');input.id='wb-chat-input';input.rows=3;input.maxLength=4000;input.placeholder='输入英语学习问题… Enter 预览，Shift+Enter 换行';const actions=document.createElement('div');const stop=document.createElement('button');stop.id='wb-cancel-stream';stop.type='button';stop.disabled=true;text(stop,'取消生成');const send=document.createElement('button');send.id='wb-preview-chat';send.type='button';text(send,'预览发送');actions.append(stop,send);composer.append(input,actions);
  pane.append(historyLabel,messages,preview,composer);
}
setupWorkbenchChat();

async function loadProgress() {
  showOnly('#progress-dashboard'); $('#back-to-library').hidden = true;
  try {
    const [summary, daily, resume, subtitles] = await Promise.all([api('/api/v1/progress/summary'), api('/api/v1/progress/daily'), api('/api/v1/progress/continue'), api('/api/v1/subtitles?status=imported&sort=imported_at&page=1&page_size=4')]);
    state.resume = resume;
    const stats = $('#progress-stats'); stats.replaceChildren();
    [['学习词条', summary.total_active], ['待学习', summary.new_count], ['学习中', summary.learning_count], ['已掌握', summary.mastered_count], ['今日到期', summary.due_today_count]].forEach(([label, value]) => {
      const card=document.createElement('article'); const number=document.createElement('strong'); text(number,String(value)); const name=document.createElement('span'); text(name,label); card.append(number,name); stats.append(card);
    });
    const records=$('#daily-records'); records.replaceChildren();
    daily.items.forEach(item=>{const row=document.createElement('article');row.className='daily-record';const accuracy=item.review_accuracy===null?'暂无':`${Math.round(item.review_accuracy*100)}%`;text(row,`${item.date} · 新增词条 ${item.new_learning_item_count} · 复习 ${item.review_attempt_count} 次（${item.distinct_review_item_count} 个词）· 正确 ${item.correct_review_count} · 正确率 ${accuracy} · AI 保存 ${item.ai_saved_content_count}`);records.append(row);});
    text($('#progress-message'),daily.total?'':'暂无学习记录。仅打开、导入或浏览不会产生学习日。');
    $('#continue-card').hidden=!resume.available;
    $('#continue-empty').hidden=resume.available;
    if(resume.available){const parts=[];if(resume.subtitle)parts.push(`${resume.subtitle.subtitle_title} · cue #${resume.subtitle.cue_sequence}`);if(resume.review)parts.push(`复习剩余 ${resume.review.remaining_count} 个`);text($('#continue-summary'),parts.join('；'));}
    text($('#continue-message'),resume.stale_reference?'部分上次位置已失效；可用位置仍可继续。':(resume.available?'':'还没有可继续的位置。'));
    const recent = $('#dashboard-recent'); recent.replaceChildren();
    if (!subtitles.total) text(recent, '还没有字幕。导入一份 SRT 或 VTT，就可以开始学习。');
    subtitles.items.forEach((item) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.dashboardSubtitleId = item.id;
      const title = document.createElement('strong'); text(title, item.title);
      const meta = document.createElement('span'); text(meta, `${item.source_format.toUpperCase()} · ${item.cue_count} 句 · ${item.unique_token_count} 个词形`);
      button.append(title, meta); recent.append(button);
    });
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
    text($('#library-message'), data.total ? '' : '还没有字幕。点击右上角“导入字幕”，选择本机 SRT 或 VTT 文件。');
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
    const list = $('#cue-list'); list.replaceChildren(); state.cues = data.cues;
    data.cues.forEach((cue) => {
      const item = document.createElement('li'); item.id = `cue-${cue.id}`; item.className = 'cue'; item.dataset.cueId=cue.id; item.dataset.cueText=cue.text;
      const timeline = document.createElement('span'); timeline.className = 'cue-time'; text(timeline, `${cue.start_time.slice(3,8)}\n#${cue.sequence}`);
      const content = document.createElement('span'); content.className='cue-text'; appendWords(content,cue); item.append(timeline, content); list.append(item);
    });
    const resumeCue=data.cues.find(cue=>cue.id===state.targetCueId)||data.cues[0];
    if(resumeCue){state.currentCue=resumeCue; text($('#workbench-context'),resumeCue.text); document.querySelector(`#cue-${resumeCue.id}`)?.classList.add('is-active'); await put('/api/v1/progress/continue',{subtitle_id:state.subtitleId,cue_id:resumeCue.id});state.targetCueId=null;}
    text($('#detail-message'), data.cues.length ? '' : '本页没有 cue。');
    text($('#cue-page'), `第 ${data.page} 页 · 共 ${data.total} 条`);
    $('#cue-prev').disabled = data.page <= 1; $('#cue-next').disabled = data.page * data.page_size >= data.total;
    await Promise.all([loadCandidates(), loadEpisodeList(), loadWorkbenchConversations()]);
  } catch (_) { text($('#detail-message'), '字幕来源已不可用或加载失败。'); }
}

async function loadEpisodeList() {
  try {
    const data=await api('/api/v1/subtitles?status=imported&sort=imported_at&page=1&page_size=50'); const list=$('#episode-list');list.replaceChildren();
    data.items.forEach((subtitle)=>{const button=document.createElement('button');button.type='button';button.className='episode-item';button.classList.toggle('is-active',subtitle.id===state.subtitleId);button.dataset.episodeId=subtitle.id;const title=document.createElement('strong');text(title,subtitle.title);const meta=document.createElement('span');text(meta,`${subtitle.source_format.toUpperCase()} · ${subtitle.cue_count} 句 · ${subtitle.unique_token_count} 词形`);button.append(title,meta);list.append(button);});
  } catch (_) { text($('#detail-message'),'字幕列表暂时无法刷新。'); }
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
$('#show-workbench').addEventListener('click', () => { if (state.subtitleId) loadDetail(); else loadLibrary(); });
$('#show-dashboard').addEventListener('click', loadProgress);
$('#dashboard-import').addEventListener('click', () => { showOnly('#subtitle-library'); $('#subtitle-file').click(); loadLibrary(); });
$('#show-library-link').addEventListener('click', loadLibrary);
$('#dashboard-recent').addEventListener('click', (event) => { const button = event.target.closest('[data-dashboard-subtitle-id]'); if (!button) return; state.subtitleId = Number(button.dataset.dashboardSubtitleId); state.detailPage = 1; loadDetail(); });
$('#show-vocabulary').addEventListener('click', loadVocabulary);
$('#show-review').addEventListener('click', () => showOnly('#review-panel'));
$('#show-chat').addEventListener('click', () => { showOnly('#chat-panel'); loadConversations(); });
$('#show-settings').addEventListener('click', () => { showOnly('#settings-panel'); loadAiSettings(); });
$('#workbench-import').addEventListener('click', () => { loadLibrary().then(() => $('#subtitle-file').click()); });
$('#episode-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-episode-id]');if(!button)return;state.subtitleId=Number(button.dataset.episodeId);state.detailPage=1;closeWordPopover();loadDetail();});
function selectCue(cue) {
  document.querySelectorAll('.cue.is-active').forEach((item)=>item.classList.remove('is-active')); cue.classList.add('is-active');
  state.currentCue=state.cues.find(item=>item.id===Number(cue.dataset.cueId))||{id:Number(cue.dataset.cueId),text:cue.dataset.cueText}; state.dictationToken=crypto.randomUUID();
  const media=remoteMedia(); if(media&&!media.hidden&&Number.isFinite(state.currentCue.start_ms)) media.currentTime=state.currentCue.start_ms/1000;
  text($('#workbench-context'),cue.dataset.cueText); text($('#dictation-cue-label'),`第 ${cue.querySelector('.cue-time')?.textContent?.split('#').pop() || ''} 句`);
  $('#dictation-input').disabled=false; $('#dictation-submit').disabled=false; $('#dictation-play').disabled=false; $('#dictation-prev').disabled=false; $('#dictation-next').disabled=false; $('#dictation-input').value=''; $('#dictation-result').hidden=true; text($('#dictation-message'),'');
  put('/api/v1/progress/continue',{subtitle_id:state.subtitleId,cue_id:state.currentCue.id}).catch(()=>text($('#detail-message'),'当前位置暂未保存。'));
}
$('#cue-list').addEventListener('click',(event)=>{const word=event.target.closest('.word-token');if(word){openWordPopover(word);return;}const cue=event.target.closest('.cue');if(!cue)return;selectCue(cue);});
async function playDictationCue(){if(!state.currentCue)return;try{await post('/api/v1/speech/play',{text:state.currentCue.text,target:'sentence'});text($('#dictation-message'),'正在本地朗读，请凭记忆输入。');}catch(_){text($('#dictation-message'),'本地语音不可用或播放失败。');}}
$('#dictation-play').addEventListener('click',playDictationCue);
function moveDictation(delta){const rows=[...document.querySelectorAll('#cue-list .cue')];if(!state.currentCue||!rows.length)return;const index=rows.findIndex(row=>Number(row.dataset.cueId)===state.currentCue.id);const next=rows[index+delta];if(next){selectCue(next);next.scrollIntoView({block:'nearest'});}}
$('#dictation-prev').addEventListener('click',()=>moveDictation(-1));
$('#dictation-next').addEventListener('click',()=>moveDictation(1));
function remoteMedia(){return $('#remote-video').hidden ? $('#remote-audio') : $('#remote-video');}
function activateCueByTime(ms){const cue=state.cues.find(item=>ms>=item.start_ms&&ms<item.end_ms);if(!cue)return;const row=document.querySelector(`#cue-${cue.id}`);if(row&&!row.classList.contains('is-active')){document.querySelectorAll('.cue.is-active').forEach(item=>item.classList.remove('is-active'));row.classList.add('is-active');row.scrollIntoView({block:'nearest'});state.currentCue=cue;}}
function validRemoteUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.username===''&&url.password==='';}catch(_){return false;}}
function clearRemoteMedia(media){media.pause();media.removeAttribute('src');media.load();media.hidden=true;}
let remoteLoadToken=0;
function remoteCandidates(value){const path=new URL(value).pathname.toLowerCase();if(/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(path))return ['audio','video'];return ['video','audio'];}
function loadRemoteMedia(value){const token=++remoteLoadToken;const message=$('#remote-player-message');const embed=$('#remote-embed-wrap');const frame=$('#remote-embed');const source=$('#remote-open-source');const platform=parsePlatformUrl(value);clearRemoteMedia($('#remote-video'));clearRemoteMedia($('#remote-audio'));embed.hidden=true;source.hidden=true;frame.removeAttribute('src');if(platform){source.href=value;source.hidden=false;embed.hidden=false;frame.src=platform.embed;text(message,`正在加载${platform.provider}播放器；平台视频不支持字幕时间自动跟随。`);frame.onload=()=>{if(token===remoteLoadToken)text(message,`${platform.provider}播放器已加载；如受登录、地区或嵌入限制影响，可点击“在原网站打开”。`);};return;}const candidates=remoteCandidates(value);const tryCandidate=(index)=>{if(token!==remoteLoadToken)return; if(index>=candidates.length){text(message,'媒体加载失败：请确认这是可公开访问的 HTTPS 文件直链，而不是网页地址，并且服务器允许浏览器播放。');return;}const kind=candidates[index];const media=$(`#remote-${kind}`);const onReady=()=>{if(token!==remoteLoadToken)return;media.hidden=false;text(message,`${kind==='video'?'视频':'音频'}已加载；媒体由第三方服务器提供，SceneLingo 不下载或上传。`);cleanup();};const onError=()=>{cleanup();clearRemoteMedia(media);tryCandidate(index+1);};const cleanup=()=>{media.removeEventListener('loadedmetadata',onReady);media.removeEventListener('canplay',onReady);media.removeEventListener('error',onError);};media.addEventListener('loadedmetadata',onReady,{once:true});media.addEventListener('canplay',onReady,{once:true});media.addEventListener('error',onError,{once:true});media.src=value;media.load();};tryCandidate(0);}
$('#remote-player-form').addEventListener('submit',(event)=>{event.preventDefault();const value=$('#remote-player-url').value.trim();if(!validRemoteUrl(value)){text($('#remote-player-message'),'请输入 HTTPS 视频页面或媒体直链，且网址不能包含账号密码。');return;}loadRemoteMedia(value);});
['remote-video','remote-audio'].forEach(id=>$('#'+id).addEventListener('timeupdate',event=>activateCueByTime(event.target.currentTime*1000)));
$('#dictation-submit').addEventListener('click',async()=>{if(!state.currentCue)return;const input=$('#dictation-input').value;if(!input.trim()){text($('#dictation-message'),'请先输入听到的内容。');return;}$('#dictation-submit').disabled=true;text($('#dictation-message'),'正在保存听写结果…');try{const result=await post('/api/v1/dictation/attempts',{subtitle_id:state.subtitleId,cue_id:state.currentCue.id,user_input:input,attempt_token:state.dictationToken});const a=result.attempt;const box=$('#dictation-result');box.replaceChildren();const title=document.createElement('strong');text(title,a.is_exact?'完全正确':'需要再听一遍');const detail=document.createElement('p');text(detail,`${a.accuracy_percent}% · 匹配 ${a.matched_word_count}/${a.target_word_count} 个词`);const target=document.createElement('p');text(target,`原文：${a.target_text}`);const retry=document.createElement('button');retry.type='button';text(retry,'再听一次');retry.addEventListener('click',playDictationCue);box.append(title,detail,target,retry);box.hidden=false;text($('#dictation-message'),result.duplicate?'已恢复上次提交的结果。':'听写结果已保存到本机。');}catch(_){text($('#dictation-message'),'听写提交失败，请重试。');}finally{$('#dictation-submit').disabled=false;}});
$('#play-current-sentence').addEventListener('click',async()=>{if(!state.currentCue)return;try{const result=await post('/api/v1/speech/play',{text:state.currentCue.text,target:'sentence'});text($('#detail-message'),`正在本地朗读（${result.character_count} 字符）`);}catch(_){text($('#detail-message'),'本地语音不可用或播放失败。');}});
$('#close-word-popover').addEventListener('click',closeWordPopover);
$('#popover-speak').addEventListener('click',async()=>{if(!state.selectedWord)return;try{await post('/api/v1/speech/play',{text:state.selectedWord.word,target:'word'});text($('#popover-message'),'正在使用 macOS 本地语音朗读。');}catch(_){text($('#popover-message'),'本地语音不可用或播放失败。');}});
$('#popover-save').addEventListener('click',async()=>{if(!state.selectedWord)return;const selected=state.selectedWord;try{const result=await post('/api/v1/vocabulary',{subtitle_id:state.subtitleId,cue_id:selected.cueId,token_key:selected.word});selected.button.dataset.learningItemId=result.learning_item_id;document.querySelectorAll('.word-token').forEach((button)=>{if(button.dataset.word===selected.word){button.dataset.learningItemId=result.learning_item_id;button.classList.add('is-saved');}});$('#popover-save').disabled=true;text($('#popover-save span'),'已在生词库');text($('#popover-message'),result.created?'已保存到真实学习库。':'学习库中已有该词，已补充当前语境。');await loadCandidates();}catch(_){text($('#popover-message'),'保存失败，请重试。');}});
$('#back-to-vocabulary').addEventListener('click', loadVocabulary);
$('#vocabulary-controls').addEventListener('submit', (event) => { event.preventDefault(); loadVocabulary(); });
$('#candidate-list').addEventListener('click', async (event) => {
  if (!event.target.dataset.tokenKey) return;
  try { await post('/api/v1/vocabulary', { subtitle_id: state.subtitleId, cue_id: Number(event.target.dataset.cueId), token_key: event.target.dataset.tokenKey }); await loadDetail(); }
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
$('#view-logs').addEventListener('click',async()=>{try{const data=await api('/api/v1/system/logs?limit=100');text($('#log-output'),data.items.map(item=>`${item.time} · ${item.level} · ${item.operation} · ${item.code}`).join('\n'));$('#log-output').hidden=false;text($('#log-status'),`显示最近 ${data.total} 条本地诊断记录。`);}catch(_){text($('#log-status'),'日志读取失败，请检查本地数据目录。');}});
$('#clear-logs').addEventListener('click',async()=>{if(!window.confirm('确认清除 SceneLingo 本地诊断日志？此操作不会删除学习数据。'))return;try{const response=await fetch('/api/v1/system/logs',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})});if(!response.ok)throw new Error();$('#log-output').replaceChildren();$('#log-output').hidden=true;text($('#log-status'),'日志已清除；学习数据未改变。');}catch(_){text($('#log-status'),'日志未清除，请稍后重试。');}});
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
function renderWorkbenchMessage(message){const card=document.createElement('article');card.className=`wb-message ${message.role}`;const meta=document.createElement('span');text(meta,message.role==='assistant'?`AI · ${message.status}`:'你');const body=document.createElement('p');const fallback=message.status==='failed'?'请求失败，未产生完整回答；不会自动重试。':message.status==='cancelled'?'请求已取消，未产生完整回答。':'';text(body,message.content||fallback);card.append(meta,body);$('#wb-chat-messages').append(card);return card;}
async function loadWorkbenchConversations(){try{const data=await api('/api/v1/ai/chat/conversations');const select=$('#wb-chat-history');const current=chatState.conversationId;select.replaceChildren();const empty=document.createElement('option');empty.value='';text(empty,'请选择或新建会话');select.append(empty);data.items.forEach(item=>{const option=document.createElement('option');option.value=item.id;text(option,`${item.title} · ${item.message_count} 条`);select.append(option);});if(current)select.value=String(current);text($('#wb-chat-status'),current?'会话已连接 · 发送前确认':'请选择历史会话或新建');}catch(_){text($('#wb-chat-status'),'历史会话加载失败');}}
async function openWorkbenchConversation(id){try{const data=await api(`/api/v1/ai/chat/conversations/${id}`);chatState.conversationId=id;const list=$('#wb-chat-messages');list.replaceChildren();data.messages.forEach(renderWorkbenchMessage);$('#wb-chat-history').value=String(id);text($('#wb-chat-status'),`${data.title} · ${data.messages.length} 条消息`);list.scrollTop=list.scrollHeight;}catch(_){text($('#wb-chat-status'),'会话恢复失败，请重试');}}
async function newWorkbenchConversation(){try{const result=await post('/api/v1/ai/chat/conversations',{title:'字幕学习'});await loadWorkbenchConversations();await openWorkbenchConversation(result.id);$('#wb-chat-input').focus();}catch(_){text($('#wb-chat-status'),'新建会话失败');}}
async function previewWorkbenchChat(){const draft=$('#wb-chat-input').value.trim();if(!draft){text($('#wb-chat-status'),'请先输入问题');return;}if(!chatState.conversationId)await newWorkbenchConversation();if(!chatState.conversationId)return;try{const attach=$('#wb-attach-context').checked&&state.currentCue;chatState.plan=await post('/api/v1/ai/chat/send-plans',{conversation_id:chatState.conversationId,text:draft,template:'free',history_count:2,cue_id:attach?state.currentCue.id:null,learning_item_id:null});text($('#wb-chat-preview-content'),JSON.stringify(chatState.plan.actual_content,null,2));text($('#wb-chat-preview-meta'),`历史 ${chatState.plan.history_count} 条 · 附件 ${chatState.plan.attachments.length} 个 · 模型 ${chatState.plan.model} · 目的地 千问 API`);$('#wb-chat-preview').hidden=false;text($('#wb-chat-status'),'请检查实际发送内容');}catch(_){text($('#wb-chat-status'),'无法生成预览：请检查云端设置、Key 和输入；草稿已保留');}}
async function executeWorkbenchChat(){if(!chatState.plan)return;const plan=chatState.plan;chatState.plan=null;$('#wb-chat-preview').hidden=true;chatState.controller=new AbortController();$('#wb-cancel-stream').disabled=false;const pending=renderWorkbenchMessage({role:'assistant',status:'pending',content:''});const body=pending.querySelector('p');text($('#wb-chat-status'),'正在生成，可随时取消…');let finalStatus='pending';try{const response=await fetch('/api/v1/ai/chat/execute',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({plan_id:plan.plan_id,execution_token:plan.execution_token}),signal:chatState.controller.signal});if(!response.ok)throw new Error('request_failed');const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const blocks=buffer.split('\n\n');buffer=blocks.pop();for(const block of blocks){const event=block.match(/^event: (.+)$/m)?.[1];const raw=block.match(/^data: (.+)$/m)?.[1];if(!event||!raw)continue;const data=JSON.parse(raw);if(event==='delta'){body.textContent+=data.text;$('#wb-chat-messages').scrollTop=$('#wb-chat-messages').scrollHeight;}if(event==='done'){finalStatus=data.status;pending.querySelector('span').textContent=`AI · ${data.status}`;text($('#wb-chat-status'),data.status==='incomplete'?'回答已截断，保留为不完整内容':`完成 · 估算费用 ${data.cost.estimated_cost} ${data.cost.currency}`);}if(event==='error'){finalStatus=data.status;pending.querySelector('span').textContent=`AI · ${data.status}`;text($('#wb-chat-status'),data.message);}}}if(finalStatus==='complete'||finalStatus==='incomplete')$('#wb-chat-input').value='';await openWorkbenchConversation(chatState.conversationId);await loadWorkbenchConversations();}catch(error){pending.querySelector('span').textContent='AI · 未完成';text($('#wb-chat-status'),error.name==='AbortError'?'已取消，回答未标记为完成；草稿已保留':'请求失败，不会自动重试；草稿已保留');}finally{$('#wb-cancel-stream').disabled=true;chatState.controller=null;}}
$('#wb-new-chat').addEventListener('click',newWorkbenchConversation);$('#wb-chat-history').addEventListener('change',event=>{if(event.target.value)openWorkbenchConversation(Number(event.target.value));});$('#wb-preview-chat').addEventListener('click',previewWorkbenchChat);$('#wb-cancel-preview').addEventListener('click',()=>{chatState.plan=null;$('#wb-chat-preview').hidden=true;text($('#wb-chat-status'),'已取消，没有发送');});$('#wb-confirm-chat').addEventListener('click',executeWorkbenchChat);$('#wb-cancel-stream').addEventListener('click',()=>chatState.controller?.abort());$('#wb-chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();previewWorkbenchChat();}});
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
