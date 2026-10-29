const token = document.querySelector('meta[name="scenelingo-token"]').content;
const status = document.querySelector('#service-status');

fetch('/api/v1/system/info', {
  headers: { 'X-SceneLingo-Token': token, Accept: 'application/json' },
  cache: 'no-store',
})
  .then((response) => {
    if (!response.ok) throw new Error('服务状态获取失败');
    return response.json();
  })
  .then((info) => {
    status.textContent = `本地服务正常运行 · 版本 ${info.version}`;
  })
  .catch(() => {
    status.textContent = '无法获取服务状态，请刷新页面。';
  });
