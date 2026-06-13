const API = '';
let sources = [];
let selectedSource = '';
let ws = null;
let stepsData = {};

// ─── Source Import ───
document.getElementById('btn-import').onclick = async () => {
  const json = document.getElementById('source-json').value.trim();
  if (!json) return flash('请粘贴书源 JSON', 'warn');
  try {
    const res = await fetch(`${API}/api/source/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json
    });
    const data = await res.json();
    if (data.ok) {
      flash(`已导入 ${data.count} 个书源`, 'ok');
      document.getElementById('source-json').value = '';
      loadSources();
    } else {
      flash(`导入失败: ${data.error}`, 'error');
    }
  } catch (e) {
    flash(`请求失败: ${e.message}`, 'error');
  }
};

async function loadSources() {
  const res = await fetch(`${API}/api/sources`);
  sources = await res.json();
  const list = document.getElementById('source-list');
  const select = document.getElementById('source-select');
  const count = document.getElementById('source-count');
  list.innerHTML = '';
  select.innerHTML = '';
  count.textContent = sources.length;
  sources.forEach(s => {
    const div = document.createElement('div');
    div.className = 'source-item';
    div.textContent = s.name || s.url;
    div.onclick = () => selectSource(s.url);
    list.appendChild(div);
    const opt = document.createElement('option');
    opt.value = s.url;
    opt.textContent = s.name || s.url;
    select.appendChild(opt);
  });
  if (sources.length > 0) selectSource(sources[0].url);
}

function selectSource(url) {
  selectedSource = url;
  document.getElementById('source-select').value = url;
  document.querySelectorAll('.source-item').forEach(el => {
    el.classList.toggle('active', el.textContent === (sources.find(s => s.url === url)?.name || url));
  });
}

// ─── Debug ───
let pollTimer = null;
let debugRunning = false;

document.getElementById('btn-debug').onclick = async () => {
  if (debugRunning) return;
  const keyword = document.getElementById('keyword').value.trim();
  const sourceUrl = document.getElementById('source-select').value;
  if (!keyword) return flash('请输入搜索关键词', 'warn');
  if (!sourceUrl) return flash('请先导入书源', 'warn');

  stepsData = {};
  debugRunning = true;
  resetPipeline();
  clearPanels();
  setBtnState('启动中…', true);

  try {
    const res = await fetch(`${API}/api/debug/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl, keyword })
    });
    const data = await res.json();
    if (!data.ok) {
      flash(`启动失败: ${data.error || 'unknown'}`, 'error');
      setBtnState('运行', false);
      debugRunning = false;
      return;
    }
  } catch (e) {
    flash(`请求失败: ${e.message}`, 'error');
    setBtnState('运行', false);
    debugRunning = false;
    return;
  }

  setBtnState('调试中…', true);

  // Try WebSocket first, fallback to polling
  let wsConnected = false;
  let wsFailed = false;

  if (ws) ws.close();
  const wsUrl = `ws://${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    wsConnected = true;
    setWsStatus(true);
  };

  ws.onmessage = (e) => {
    try {
      const step = JSON.parse(e.data);
      stepsData[step.phase] = step;
      updateStepUI(step);
      // Check if done
      if (isDebugDone()) finishDebug();
    } catch (err) {
      console.error('WS parse error:', err);
    }
  };

  ws.onclose = () => {
    setWsStatus(false);
    if (!wsFailed && !isDebugDone()) {
      // WebSocket closed prematurely, fallback to polling
      startPolling();
    }
  };

  ws.onerror = () => {
    wsFailed = true;
    setWsStatus(false);
    startPolling();
  };

  // Timeout: if no WS connection in 3s, fallback to polling
  setTimeout(() => {
    if (!wsConnected && !wsFailed) {
      wsFailed = true;
      ws.close();
      startPolling();
    }
  }, 3000);
};

function startPolling() {
  if (pollTimer) return;
  flash('WebSocket 不可用，切换到轮询模式', 'warn');
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API}/api/debug/steps`);
      const steps = await res.json();
      steps.forEach(step => {
        stepsData[step.phase] = step;
        updateStepUI(step);
      });
      if (isDebugDone()) finishDebug();
    } catch (e) {
      console.error('Poll error:', e);
    }
  }, 1500);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function isDebugDone() {
  const phases = Object.values(stepsData);
  return phases.some(s => s.status === 'error') ||
    phases.filter(s => s.status === 'success').length >= 4;
}

function finishDebug() {
  stopPolling();
  if (ws) ws.close();
  debugRunning = false;
  setBtnState('运行', false);

  // Auto-select last success or first error
  const phases = ['content', 'toc', 'detail', 'search'];
  for (const ph of phases) {
    if (stepsData[ph]) {
      showStepDetail(stepsData[ph]);
      if (stepsData[ph].status === 'error') break;
      if (stepsData[ph].status === 'success') break;
    }
  }
}

function setBtnState(text, running) {
  const btn = document.getElementById('btn-debug');
  btn.classList.toggle('running', running);
  btn.innerHTML = running ? `<span class="run-icon">●</span> ${text}` : `<span class="run-icon">▶</span> ${text}`;
}

function setWsStatus(connected) {
  document.getElementById('ws-status').classList.toggle('connected', connected);
  document.getElementById('ws-label').textContent = connected ? '已连接' : '未连接';
}

// ─── Pipeline UI ───
function resetPipeline() {
  document.querySelectorAll('.pipeline-step').forEach(el => {
    el.className = 'pipeline-step';
    el.querySelector('.pipe-status').textContent = '等待';
    el.querySelector('.pipe-num').textContent = el.dataset.phase === 'search' ? '1' :
      el.dataset.phase === 'detail' ? '2' :
      el.dataset.phase === 'toc' ? '3' : '4';
  });
  document.querySelectorAll('.pipeline-connector').forEach(el => {
    el.classList.remove('done');
  });
}

const phaseOrder = ['search', 'detail', 'toc', 'content'];

function updateStepUI(step) {
  const el = document.querySelector(`.pipeline-step[data-phase="${step.phase}"]`);
  if (!el) return;

  el.className = `pipeline-step ${step.status}`;
  const statusText = { running: '执行中…', success: '完成 ✓', error: '失败 ✗' };
  el.querySelector('.pipe-status').textContent = statusText[step.status] || step.status;

  if (step.status === 'success') {
    el.querySelector('.pipe-num').textContent = '✓';
    // Mark previous connectors as done
    const idx = phaseOrder.indexOf(step.phase);
    if (idx > 0) {
      document.querySelectorAll('.pipeline-connector')[idx - 1]?.classList.add('done');
    }
  } else if (step.status === 'error') {
    el.querySelector('.pipe-num').textContent = '✗';
  }

  el.onclick = () => showStepDetail(step);

  // Auto-show on error
  if (step.status === 'error') {
    showStepDetail(step);
  }
}

// ─── Detail Panels ───
function showStepDetail(step) {
  // Highlight pipeline step
  document.querySelectorAll('.pipeline-step').forEach(el => el.classList.remove('active'));
  document.querySelector(`.pipeline-step[data-phase="${step.phase}"]`)?.classList.add('active');

  // Update meta
  const meta = document.getElementById('detail-meta');
  const phaseNames = { search: '搜索', detail: '详情', toc: '目录', content: '正文' };
  meta.textContent = `${phaseNames[step.phase] || step.phase} · ${step.status === 'success' ? '成功' : step.status === 'error' ? '失败' : '进行中'}`;

  // Extracted
  const extPanel = document.getElementById('panel-extracted');
  if (step.extracted && Object.keys(step.extracted).length > 0) {
    const entries = Object.entries(step.extracted).map(([k, v]) => {
      let display = v;
      if (v && typeof v === 'object' && v.name) display = v.name;
      else if (Array.isArray(v)) display = `[${v.length} 项]`;
      else if (typeof v === 'object') display = JSON.stringify(v);
      return `<div class="kv-row"><span class="key">${esc(k)}</span><span class="str">${esc(String(display ?? ''))}</span></div>`;
    }).join('');
    const errHtml = step.error ? `<div class="err" style="margin-top:8px">✗ ${esc(step.error)}</div>` : '';
    extPanel.innerHTML = entries + errHtml;
  } else if (step.error) {
    extPanel.innerHTML = `<div class="err">✗ ${esc(step.error)}</div>`;
  } else {
    extPanel.innerHTML = '<div class="panel-empty">暂无数据</div>';
  }

  // Request
  const reqPanel = document.getElementById('panel-request');
  if (step.request) {
    const r = step.request;
    const headersStr = Object.entries(r.headers || {}).map(([k, v]) => `  <span class="key">${esc(k)}</span>: <span class="str">${esc(v)}</span>`).join('\n');
    reqPanel.innerHTML =
      `<span class="method">${esc(r.method)}</span> <span class="url">${esc(r.url)}</span>\n\n` +
      `<span class="dim">Headers:</span>\n${headersStr || '  <span class="dim">(无)</span>'}\n\n` +
      `<span class="dim">Body:</span>\n  ${r.body ? esc(r.body) : '<span class="dim">(无)</span>'}`;
  } else {
    reqPanel.innerHTML = '<div class="panel-empty">无请求信息</div>';
  }

  // Response
  const resPanel = document.getElementById('panel-response');
  if (step.response) {
    const r = step.response;
    const codeClass = r.code < 300 ? 's2xx' : r.code < 500 ? 's4xx' : 's5xx';
    resPanel.innerHTML =
      `<span class="http-code ${codeClass}">HTTP ${r.code}</span>  <span class="dim">${esc(r.contentType || '')}</span>\n` +
      `<span class="dim">Body Length:</span> <span class="num">${r.bodyLength}</span>\n` +
      `${'─'.repeat(60)}\n` +
      esc(r.bodyPreview || '');
  } else {
    resPanel.innerHTML = '<div class="panel-empty">无响应信息</div>';
  }

  // Rules
  const rulesPanel = document.getElementById('panel-rules');
  if (step.ruleHits && step.ruleHits.length > 0) {
    rulesPanel.innerHTML = step.ruleHits.map(r =>
      `${r.success ? '<span class="ok">✓</span>' : '<span class="err">✗</span>'} <span class="key">[${esc(r.field)}]</span> <span class="dim">${esc(r.rule)}</span>\n  → ${r.value ? esc(r.value) : '<span class="dim">(空)</span>'}`
    ).join('\n\n');
  } else {
    rulesPanel.innerHTML = '<div class="panel-empty">暂无规则命中记录 (Phase 2)</div>';
  }

  // Preview
  const previewPanel = document.getElementById('panel-preview');
  if (step.preview) {
    previewPanel.innerHTML = `<div class="preview-text">${esc(step.preview)}</div>`;
  } else {
    previewPanel.innerHTML = '<div class="panel-empty">无正文预览</div>';
  }

  // Show extracted tab by default
  switchTab('extracted');
}

// ─── Tabs ───
function switchTab(name) {
  document.querySelectorAll('.dtab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.dpanel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`panel-${name}`)?.classList.remove('hidden');
}

document.querySelectorAll('.dtab').forEach(tab => {
  tab.onclick = () => switchTab(tab.dataset.tab);
});

function clearPanels() {
  ['extracted', 'request', 'response', 'rules', 'preview'].forEach(id => {
    const el = document.getElementById(`panel-${id}`);
    if (el) el.innerHTML = '<div class="panel-empty">点击左侧管道步骤查看详情</div>';
  });
  document.getElementById('detail-meta').textContent = '';
}

// ─── Flash Messages ───
function flash(msg, type = 'info') {
  const div = document.createElement('div');
  div.textContent = msg;
  Object.assign(div.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '9999',
    padding: '10px 16px', borderRadius: '6px', fontSize: '12px',
    fontFamily: 'var(--sans)', fontWeight: '500',
    background: type === 'ok' ? 'var(--success-dim)' : type === 'error' ? 'var(--error-dim)' : 'var(--accent-dim)',
    color: type === 'ok' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--accent)',
    border: `1px solid ${type === 'ok' ? 'var(--success)' : type === 'error' ? 'var(--error)' : 'var(--accent)'}`,
    opacity: '0', transform: 'translateY(-10px)', transition: 'all 0.3s'
  });
  document.body.appendChild(div);
  requestAnimationFrame(() => { div.style.opacity = '1'; div.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateY(-10px)';
    setTimeout(() => div.remove(), 300);
  }, 2500);
}

// ─── Utility ───
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Keyboard shortcuts ───
document.getElementById('keyword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-debug').click();
});

// ─── Init ───
loadSources();
