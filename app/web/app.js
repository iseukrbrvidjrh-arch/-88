const token = document.querySelector('meta[name="scenelingo-token"]').content;
const headers = { 'X-SceneLingo-Token': token, Accept: 'application/json' };
const $ = (selector) => document.querySelector(selector);
const state = { libraryPage: 1, detailPage: 1, subtitleId: null };

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
  ['#subtitle-library', '#subtitle-detail', '#vocabulary-library', '#vocabulary-detail', '#review-panel', '#settings-panel'].forEach((id) => { $(id).hidden = id !== selector; });
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
    });
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
    const fields = $('#word-fields'); fields.replaceChildren();
    [['状态', '待学习'], ['IPA', word.ipa_display], ['释义', word.definition_display], ['下次复习', word.next_review_display], ['复习历史', word.review_history_display]].forEach(([name, value]) => {
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
$('#show-vocabulary').addEventListener('click', loadVocabulary);
$('#show-review').addEventListener('click', () => showOnly('#review-panel'));
$('#show-settings').addEventListener('click', () => showOnly('#settings-panel'));
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
    state.detailPage = Math.ceil(located.target.sequence / 50); await loadDetail();
    document.querySelector(`#cue-${event.target.dataset.cueId}`)?.scrollIntoView({ block: 'center' });
  } catch (_) { text($('#vocabulary-message'), '来源定位失败。'); }
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
    text($('#review-message'), data.message || `到期 ${data.total} 个词条`); $('#review-card').hidden=!data.total;
    if (data.total) text($('#review-prompt'), mode === 'spelling' ? (data.items[0].context || '请根据记忆拼写当前词条。') : data.items[0].display_text);
    $('#review-input').hidden = mode !== 'spelling';
  } catch (_) { text($('#review-message'),'复习队列加载失败。'); }
});
$('#submit-review').addEventListener('click', async () => {
  if (!reviewItems.length) return; const mode=$('#review-mode').value;
  const rating=document.querySelector('input[name="rating"]:checked').value;
  try {
    const result=await post('/api/v1/review/attempts',{learning_item_id:reviewItems[0].learning_item_id,mode,user_input:mode==='spelling'?$('#review-input').value:null,final_rating:rating,attempt_token:crypto.randomUUID()});
    text($('#review-message'),`已保存：${result.status}，下次 ${result.next_review_date}`); reviewItems.shift(); $('#review-card').hidden=true;
  } catch (_) { text($('#review-message'),'提交失败；未确认保存前不会产生复习记录。'); }
});

api('/api/v1/system/info')
  .then((info) => text($('#service-status'), `本地服务正常运行 · 版本 ${info.version}`))
  .catch(() => text($('#service-status'), '无法获取服务状态，请刷新页面。'));
loadLibrary();
function updateNetworkState() { text($('#network-state'),navigator.onLine?'当前可联网；本地功能不依赖网络。':'当前离线；字幕、学习库和复习仍可使用。'); }
window.addEventListener('online',updateNetworkState); window.addEventListener('offline',updateNetworkState); updateNetworkState();
