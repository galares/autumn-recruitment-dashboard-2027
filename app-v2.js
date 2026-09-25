(() => {
  let baseJobs = window.JOB_DATA || [];
  let discoveredJobs = [];
  const statusOptions = ['已发现', '待核实', '材料就绪', '待本人操作', '已提交', '笔试/面试', '结束'];
  const decisionScore = {'优先投': 0, '优先筛选': 1, '可尝试': 2, '待核实': 3, '不符合': 9};
  const storageKey = 'chenjie-job-board-v2';
  const legacyKey = 'chenjie-job-board-v1';
  const memoryStorage = {};
  const storage = {
    getItem(key) { try { return window.localStorage.getItem(key); } catch { return memoryStorage[key] || null; } },
    setItem(key, value) { try { window.localStorage.setItem(key, value); } catch { memoryStorage[key] = value; } }
  };
  function readStoredJson(key, fallback) {
    try { return JSON.parse(storage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  }
  const rawStore = readStoredJson(storageKey, null);
  const legacy = readStoredJson(legacyKey, {});
  const store = rawStore && rawStore.version === 2
    ? rawStore
    : {version: 2, jobs: legacy, customJobs: [], updatedAt: new Date().toISOString()};
  const state = {query: '', decision: '全部', status: '全部', city: '全部', resume: '全部', sort: 'priority', priorityOnly: false};

  const $ = id => document.getElementById(id);
  const els = {
    summary: $('summary'), grid: $('jobGrid'), count: $('resultCount'), empty: $('emptyState'),
    query: $('searchInput'), decision: $('decisionFilter'), status: $('statusFilter'), city: $('cityFilter'),
    resume: $('resumeFilter'), sort: $('sortSelect'), drawer: $('drawer'), drawerContent: $('drawerContent'),
    focusBtn: $('focusBtn'), modal: $('jobModal'), form: $('jobForm'), restoreInput: $('restoreInput'),
    readyQueue: $('readyQueue'), triageQueue: $('triageQueue'), deadlineQueue: $('deadlineQueue'), pipeline: $('pipelineRow'),
    resumeModal: $('resumeModal'), resumeForm: $('resumeForm'), resumeJobSelect: $('resumeJobSelect')
  };

  const allJobs = () => {
    const merged = new Map();
    [...discoveredJobs, ...baseJobs, ...(store.customJobs || [])].forEach(job => merged.set(job.id, job));
    return [...merged.values()];
  };
  const local = job => store.jobs[job.id] || {};
  const currentStatus = job => local(job).status || job.status;
  const currentNote = job => local(job).note || '';
  const isFavorite = job => Boolean(local(job).favorite);
  const persist = () => {
    store.updatedAt = new Date().toISOString();
    storage.setItem(storageKey, JSON.stringify(store));
  };
  const updateLocal = (job, patch, event) => {
    const previous = local(job);
    const history = [...(previous.history || [])];
    if (event) history.unshift({at: new Date().toISOString(), text: event});
    store.jobs[job.id] = {...previous, ...patch, history: history.slice(0, 30)};
    persist();
  };

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function safeUrl(value = '') {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }
  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    if (button) { const original = button.textContent; button.textContent = '已复制'; setTimeout(() => { button.textContent = original; }, 1400); }
  }
  function setOptions(select, values) {
    const current = select.value;
    select.innerHTML = ['全部', ...values.filter(Boolean).sort((a,b) => a.localeCompare(b, 'zh-CN'))]
      .map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if ([...select.options].some(x => x.value === current)) select.value = current;
  }
  function setSyncState(kind, title, detail) {
    const strip = $('syncStrip'); strip.classList.remove('online', 'error'); if (kind) strip.classList.add(kind);
    $('syncTitle').textContent = title; $('syncDetail').textContent = detail;
  }
  async function refreshOnlineJobs(manual = false) {
    const configured = window.JOB_UPDATE_URL || (/^https?:$/.test(location.protocol) ? 'jobs.json' : '');
    if (!configured) {
      setSyncState('', '当前为本地版', '使用“下载手机版”离线查看；发布联网版后会自动更新岗位');
      return;
    }
    setSyncState('', '正在检查更新', '连接岗位数据源……'); $('syncBtn').disabled = true;
    try {
      const separator = configured.includes('?') ? '&' : '?';
      const response = await fetch(`${configured}${separator}v=${Date.now()}`, {cache: 'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const jobs = await response.json();
      if (!Array.isArray(jobs) || jobs.some(j => !j || !j.id || !j.company || !j.role)) throw new Error('岗位数据格式不正确');
      const discoveryUrl = window.DISCOVERY_UPDATE_URL || 'discoveries.json';
      try {
        const discoverySeparator = discoveryUrl.includes('?') ? '&' : '?';
        const discoveryResponse = await fetch(`${discoveryUrl}${discoverySeparator}v=${Date.now()}`, {cache: 'no-store'});
        const discoveries = discoveryResponse.ok ? await discoveryResponse.json() : [];
        discoveredJobs = Array.isArray(discoveries) ? discoveries.filter(j => j && j.id && j.company && j.role) : [];
      } catch { discoveredJobs = []; }
      baseJobs = jobs; const checkedAt = new Date(); storage.setItem(`${storageKey}-last-sync`, checkedAt.toISOString());
      setSyncState('online', '已连接在线岗位库', `${jobs.length}个正式岗位 · ${discoveredJobs.length}条每日发现 · ${checkedAt.toLocaleString('zh-CN')}更新`); render();
    } catch (error) {
      setSyncState('error', '在线更新暂不可用', `继续使用已保存的${baseJobs.length}个岗位 · ${error.message}`);
      if (manual) window.setTimeout(() => setSyncState('error', '在线更新暂不可用', '当前数据仍可正常查看和记录'), 2500);
    } finally { $('syncBtn').disabled = false; }
  }
  function broadCity(city = '') {
    const found = ['上海','苏州','杭州'].filter(x => city.includes(x));
    return found.length ? found : ['其他'];
  }
  function resumeFamily(resume = '') {
    return ['测试验证','应用技术','制造工艺'].filter(x => resume.includes(x));
  }
  function tagClass(decision = '') {
    if (decision.includes('优先')) return 'priority';
    if (decision === '可尝试' || decision === '待核实') return 'try';
    if (decision === '不符合') return 'stop';
    return '';
  }
  function isUnknown(text = '') {
    return !text || /未公开|待核实|待确认|尚未|面议|未知/.test(text);
  }
  function readiness(job) {
    const checks = [
      {label: '具体岗位', ok: !/入口|公司级|尚未选定/.test(job.kind || '') && !/入口|方向$/.test(job.role || ''), weight: 15},
      {label: '资格已核验', ok: Boolean(job.qualification) && !/待核实|尚未读取|不继续核验/.test(job.qualification), weight: 20},
      {label: '有匹配证据', ok: Boolean(job.fit) && !/^待/.test(job.fit), weight: 15},
      {label: '简历已确定', ok: Boolean(job.resume) && !/待定|选岗后|暂不|无$/.test(job.resume), weight: 15},
      {label: '限投规则已知', ok: Boolean(job.quota) && !isUnknown(job.quota), weight: 10},
      {label: '薪资有数字或范围', ok: /\d/.test(job.salary || '') && !/未公开/.test(job.salary || ''), weight: 10},
      {label: '截止日期明确', ok: Boolean(job.deadline), weight: 10},
      {label: '官方链接可用', ok: Boolean(safeUrl(job.url)), weight: 5}
    ];
    let score = checks.filter(x => x.ok).reduce((sum, x) => sum + x.weight, 0);
    if (job.decision === '不符合' || currentStatus(job) === '结束') score = 0;
    return {score, checks, missing: checks.filter(x => !x.ok).map(x => x.label)};
  }
  function daysUntil(dateText) {
    if (!dateText) return null;
    const target = new Date(`${dateText}T23:59:59`);
    if (Number.isNaN(target.getTime())) return null;
    return Math.ceil((target - new Date()) / 86400000);
  }
  function actionRank(job) {
    const deadlineDays = daysUntil(job.deadline);
    const deadlineBoost = deadlineDays !== null && deadlineDays >= 0 ? Math.max(0, 20 - deadlineDays) : 0;
    return (100 - (decisionScore[job.decision] ?? 5) * 15) + readiness(job).score + deadlineBoost + (isFavorite(job) ? 25 : 0);
  }
  function nextReason(job) {
    const r = readiness(job);
    if (currentStatus(job) === '待本人操作') return '需要本人登录、验证或补充信息';
    if (r.missing.length) return `还缺：${r.missing.slice(0, 2).join('、')}`;
    return job.next || '打开详情继续推进';
  }

  function filteredJobs() {
    const q = state.query.trim().toLowerCase();
    return allJobs().filter(job => {
      const haystack = Object.values(job).filter(v => typeof v === 'string').join(' ').toLowerCase();
      return (!q || haystack.includes(q))
        && (state.decision === '全部' || job.decision === state.decision)
        && (state.status === '全部' || currentStatus(job) === state.status)
        && (state.city === '全部' || broadCity(job.city).includes(state.city))
        && (state.resume === '全部' || resumeFamily(job.resume).includes(state.resume))
        && (!state.priorityOnly || job.decision.includes('优先') || isFavorite(job));
    }).sort((a,b) => {
      if (state.sort === 'company') return a.company.localeCompare(b.company, 'zh-CN');
      if (state.sort === 'deadline') return (a.deadline || '9999').localeCompare(b.deadline || '9999');
      return actionRank(b) - actionRank(a) || a.company.localeCompare(b.company, 'zh-CN');
    });
  }

  function renderSummary() {
    const jobs = allJobs();
    const cards = [
      ['岗位总数', jobs.length, 'accent'],
      ['可继续推进', jobs.filter(j => currentStatus(j) !== '结束' && j.decision !== '不符合').length, ''],
      ['优先岗位', jobs.filter(j => j.decision.includes('优先')).length, ''],
      ['待本人操作', jobs.filter(j => currentStatus(j) === '待本人操作').length, 'warning'],
      ['已提交', jobs.filter(j => currentStatus(j) === '已提交').length, ''],
      ['笔试/面试', jobs.filter(j => currentStatus(j) === '笔试/面试').length, '']
    ];
    els.summary.innerHTML = cards.map(([label,value,cls]) => `<article class="stat-card ${cls}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></article>`).join('');
  }
  function hasTailoredResume(job) {
    return Boolean(local(job).resumeFile || job.resume_file || /岗位版|公司版|专用/.test(job.resume || ''));
  }
  function renderResumeFactory() {
    const jobs = allJobs();
    $('resumeLinkedCount').textContent = jobs.filter(hasTailoredResume).length;
    $('resumeRequestCount').textContent = jobs.filter(j => local(j).aiTaskDraftAt).length;
  }
  function miniItem(job, note) {
    const r = readiness(job);
    return `<button class="mini-item" data-open-job="${escapeHtml(job.id)}">
      <span><strong>${escapeHtml(job.company)}</strong><small>${escapeHtml(job.role)}</small></span>
      <span class="mini-score">${r.score}<small>准备度</small></span>
      <em>${escapeHtml(note)}</em>
    </button>`;
  }
  function renderActionCenter() {
    const active = allJobs().filter(j => currentStatus(j) !== '结束' && j.decision !== '不符合');
    const ready = active.filter(j => ['优先投','优先筛选','可尝试'].includes(j.decision) && readiness(j).score >= 60 && currentStatus(j) !== '待本人操作').sort((a,b) => actionRank(b) - actionRank(a)).slice(0, 5);
    const triage = active.filter(j => currentStatus(j) === '待本人操作' || j.decision === '待核实' || readiness(j).score < 60).sort((a,b) => actionRank(b) - actionRank(a)).slice(0, 5);
    const deadline = active.filter(j => { const days = daysUntil(j.deadline); return days !== null && days >= 0 && days <= 30; }).sort((a,b) => a.deadline.localeCompare(b.deadline)).slice(0, 5);
    $('readyCount').textContent = ready.length; $('triageCount').textContent = triage.length; $('deadlineCount').textContent = deadline.length;
    els.readyQueue.innerHTML = ready.length ? ready.map(j => miniItem(j, nextReason(j))).join('') : '<p class="quiet">暂无可直接推进的岗位</p>';
    els.triageQueue.innerHTML = triage.length ? triage.map(j => miniItem(j, nextReason(j))).join('') : '<p class="quiet">没有待处理阻碍</p>';
    els.deadlineQueue.innerHTML = deadline.length ? deadline.map(j => miniItem(j, `还剩 ${daysUntil(j.deadline)} 天`)).join('') : '<p class="quiet">30天内没有明确截止日期</p>';
    document.querySelectorAll('[data-open-job]').forEach(btn => btn.addEventListener('click', () => {
      const job = allJobs().find(j => j.id === btn.dataset.openJob); if (job) openDrawer(job);
    }));
  }
  function renderPipeline() {
    const jobs = allJobs();
    els.pipeline.innerHTML = statusOptions.map(status => `<button class="pipeline-step ${state.status === status ? 'active' : ''}" data-pipeline-status="${status}"><strong>${jobs.filter(j => currentStatus(j) === status).length}</strong><span>${status}</span></button>`).join('');
    els.pipeline.querySelectorAll('[data-pipeline-status]').forEach(btn => btn.addEventListener('click', () => {
      state.status = state.status === btn.dataset.pipelineStatus ? '全部' : btn.dataset.pipelineStatus;
      els.status.value = state.status; render();
    }));
  }
  function changeStatus(job, status) {
    if (status === '已提交' && !local(job).receipt) { openDrawer(job, true); return false; }
    updateLocal(job, {status}, `状态改为“${status}”`); return true;
  }

  function render() {
    setOptions(els.decision, [...new Set(allJobs().map(j => j.decision))]);
    const list = filteredJobs();
    els.count.textContent = list.length; els.empty.hidden = list.length > 0; els.grid.innerHTML = '';
    list.forEach(job => {
      const card = $('jobCardTemplate').content.firstElementChild.cloneNode(true);
      const r = readiness(job);
      card.dataset.id = job.id; card.querySelector('.company').textContent = job.company; card.querySelector('.role').textContent = job.role;
      card.querySelector('.meta').textContent = `${job.city || '城市待核实'} · ${job.resume || '简历待定'}`;
      card.querySelector('.next').textContent = job.next;
      card.querySelector('.tags').innerHTML = `<span class="tag ${tagClass(job.decision)}">${escapeHtml(job.decision)}</span><span class="tag">${escapeHtml(currentStatus(job))}</span>${job.auto_discovered ? '<span class="tag auto-tag">每日发现</span>' : ''}<span class="tag score-tag">准备度 ${r.score}</span>${hasTailoredResume(job) ? '<span class="tag resume-ready-tag">专用简历</span>' : ''}${local(job).aiTaskDraftAt && !hasTailoredResume(job) ? '<span class="tag resume-request-tag">AI任务待确认</span>' : ''}${job.deadline ? `<span class="tag">截止 ${escapeHtml(job.deadline)}</span>` : ''}`;
      const star = card.querySelector('.star-btn'); star.textContent = isFavorite(job) ? '★' : '☆'; star.classList.toggle('active', isFavorite(job));
      star.addEventListener('click', () => { updateLocal(job, {favorite: !isFavorite(job)}); render(); });
      const status = card.querySelector('.status-select');
      status.innerHTML = statusOptions.map(x => `<option ${x === currentStatus(job) ? 'selected' : ''}>${x}</option>`).join('');
      status.addEventListener('change', e => { if (!changeStatus(job, e.target.value)) e.target.value = currentStatus(job); render(); });
      card.querySelector('.detail-btn').addEventListener('click', () => openDrawer(job)); els.grid.appendChild(card);
      card.querySelector('.resume-btn').addEventListener('click', () => openResumeModal(job));
    });
    renderSummary(); renderResumeFactory(); renderActionCenter(); renderPipeline();
  }

  function block(title, text, cls = '') {
    if (!text) return '';
    return `<section class="detail-block ${cls}"><h3>${title}</h3><p>${escapeHtml(text)}</p></section>`;
  }
  function resumeLinks(job) {
    const resume = job.resume || '';
    const savedFile = String(local(job).resumeFile || job.resume_file || '').split(/[\\/]/).pop();
    if (savedFile && /\.docx$/i.test(savedFile)) {
      if (window.ONLINE_PUBLIC_MODE) return `<span class="file-chip">${escapeHtml(savedFile.replace(/\.docx$/i, ''))}（个人文件未公开）</span>`;
      return `<a class="file-chip" href="../resumes/${encodeURIComponent(savedFile)}">${escapeHtml(savedFile.replace(/\.docx$/i, ''))}</a>`;
    }
    if (resume.includes('TE泰科电子')) {
      return `<a class="file-chip" href="../resumes/${encodeURIComponent('陈杰_2027届简历_测试验证_TE泰科电子.docx')}">TE泰科电子岗位版</a>`;
    }
    const families = resumeFamily(resume);
    if (!families.length) return '<span class="muted-inline">尚未确定</span>';
    return families.map(name => `<a class="file-chip" href="../resumes/${encodeURIComponent(`陈杰_2027届简历_${name}.docx`)}">${name}简历</a>`).join('');
  }
  function sourceLinks(job) {
    const urls = String(job.sources || '').split('|').map(x => safeUrl(x.trim())).filter(Boolean);
    return urls.length ? urls.map((url, i) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">来源${i + 1}</a>`).join(' · ') : '未保存独立来源链接';
  }
  function openDrawer(job, requireProof = false) {
    const r = readiness(job); const info = local(job); const history = info.history || []; const official = safeUrl(job.url);
    els.drawerContent.innerHTML = `
      <p class="drawer-company">${escapeHtml(job.company)}</p><h2 id="drawerTitle">${escapeHtml(job.role)}</h2>
      <div class="tags drawer-tags"><span class="tag ${tagClass(job.decision)}">${escapeHtml(job.decision)}</span><span class="tag">${escapeHtml(currentStatus(job))}</span><span class="tag">${escapeHtml(job.city || '城市待核实')}</span></div>
      ${requireProof ? '<div class="notice">要标记为“已提交”，请先保存成功页面、申请编号或确认邮件信息。</div>' : ''}
      <section class="readiness-card"><div><strong>推进准备度 ${r.score}/100</strong><span>用于衡量资料是否齐全，不等于岗位匹配率</span></div><div class="progress"><i style="width:${r.score}%"></i></div><div class="check-grid">${r.checks.map(x => `<span class="${x.ok ? 'done' : ''}">${x.ok ? '✓' : '○'} ${escapeHtml(x.label)}</span>`).join('')}</div></section>
      ${block('匹配理由', job.fit)}${block('资格依据', job.qualification)}${block('缺口与不确定性', job.gaps, 'risk-block')}${block('下一步', job.next)}${block('薪资信息', job.salary)}${block('限投与修改规则', job.quota)}${block('截止信息', job.deadline || job.deadline_note)}${block('来源备注', job.sourceNote)}${job.rawText ? block('导入的原始文字', job.rawText, 'raw-text') : ''}
      <section class="detail-block"><h3>使用简历</h3><div class="file-chips">${resumeLinks(job)}</div><button class="resume-inline-btn" id="makeResume">交给AI处理</button></section>
      <section class="detail-block"><h3>信息来源</h3><p class="link-line">${sourceLinks(job)}</p></section>
      <div class="detail-actions">${official ? `<a class="official-link" href="${escapeHtml(official)}" target="_blank" rel="noreferrer">打开官方页面</a>` : ''}<button class="secondary-action" id="copyVerify">复制给AI核验</button></div>
      <section class="detail-block proof-block"><h3>投递凭证</h3><p class="form-help">只有保存成功页面、申请编号、确认邮件或等效证据后，才会标记为已提交。</p><div class="form-grid proof-grid"><label>凭证类型<select id="evidenceType"><option>申请编号</option><option>成功页面</option><option>确认邮件</option><option>其他等效证据</option></select></label><label>提交时间<input id="submittedAt" type="datetime-local" value="${escapeHtml(info.submittedAt || '')}"></label></div><label class="full-label">凭证内容<input id="receiptInput" value="${escapeHtml(info.receipt || '')}" placeholder="填写申请编号，或说明截图/确认邮件保存位置"></label><button class="save-note" id="saveProof">保存凭证并标记已提交</button><p class="inline-error" id="proofError"></p></section>
      <section class="detail-block"><h3>我的备注（只保存在本机浏览器）</h3><textarea id="noteInput" placeholder="例如：内推人、沟通记录、待补材料……">${escapeHtml(currentNote(job))}</textarea><button class="save-note" id="saveNote">保存备注</button></section>
      <section class="detail-block"><h3>操作记录</h3><div class="history-list">${history.length ? history.map(h => `<p><time>${escapeHtml(new Date(h.at).toLocaleString('zh-CN'))}</time>${escapeHtml(h.text)}</p>`).join('') : '<p class="quiet">暂无操作记录</p>'}</div></section>
      ${job.custom ? '<button class="danger-link" id="deleteCustom">删除这个手动导入岗位</button>' : ''}`;
    $('copyVerify').addEventListener('click', () => copyText(`请作为陈杰的秋招执行助手，核验下面这个岗位。优先检查企业官网和官方校招系统，确认岗位是否仍在招聘、2027届海外硕士毕业窗口、专业要求、必备技能、工作地点、截止日期、薪资信息、限投数量和志愿规则。结合陈杰的真实经历给出“优先投、可尝试、不符合、待核实”结论；不要编造经历，不要把小组实验写成独立完成。\n\n公司：${job.company}\n岗位：${job.role}\n城市：${job.city || '待核实'}\n链接：${job.url || '未提供'}\n岗位或内推原文：\n${job.rawText || job.qualification || '未提供完整JD'}`, $('copyVerify')));
    $('makeResume').addEventListener('click', () => { closeDrawer(); openResumeModal(job); });
    $('saveNote').addEventListener('click', () => { updateLocal(job, {note: $('noteInput').value}, '更新备注'); $('saveNote').textContent = '已保存'; renderSummary(); });
    $('saveProof').addEventListener('click', () => {
      const receipt = $('receiptInput').value.trim(); if (!receipt) { $('proofError').textContent = '请填写可以追溯的凭证内容。'; return; }
      const submittedAt = $('submittedAt').value || new Date().toISOString().slice(0,16);
      updateLocal(job, {receipt, submittedAt, evidenceType: $('evidenceType').value, status: '已提交'}, `保存${$('evidenceType').value}并标记为“已提交”`);
      openDrawer(job); render();
    });
    if ($('deleteCustom')) $('deleteCustom').addEventListener('click', () => {
      if (!window.confirm('确定删除这个手动导入岗位吗？')) return;
      store.customJobs = store.customJobs.filter(x => x.id !== job.id); delete store.jobs[job.id]; persist(); closeDrawer(); render();
    });
    els.drawer.classList.add('open'); els.drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
  }
  function closeDrawer() { els.drawer.classList.remove('open'); els.drawer.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  function openModal() { els.modal.classList.add('open'); els.modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
  function closeModal() { els.modal.classList.remove('open'); els.modal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }

  function selectedResumeJob() {
    return allJobs().find(j => j.id === els.resumeJobSelect.value);
  }
  function suggestedResumeFile(job, focus) {
    const clean = value => String(value || '').replace(/[\\/:*?"<>|（）()]/g, '').replace(/\s+/g, '').slice(0, 18);
    return `陈杰_2027届简历_${clean(focus)}_${clean(job.company)}_${clean(job.role)}.docx`;
  }
  function populateResumeForm(job) {
    if (!job) return;
    const info = local(job); const family = resumeFamily(job.resume || '')[0] || '测试验证';
    els.resumeJobSelect.value = job.id;
    $('resumeCompany').value = job.company || '';
    $('resumeRole').value = job.role || '';
    $('resumeCity').value = job.city || '';
    $('resumeFocus').value = ['测试验证','应用技术','制造工艺'].includes(info.resumeFocus) ? info.resumeFocus : family;
    $('resumeJD').value = info.resumeJD || job.rawText || `任职资格：${job.qualification || '待补充'}\n\n岗位信息：${job.fit || ''}`;
    $('resumeExtra').value = info.resumeExtra || '';
    $('resumeTaskType').value = info.aiTaskType || '生成岗位专用简历';
  }
  function openResumeModal(job) {
    const candidates = allJobs().filter(j => currentStatus(j) !== '结束' && j.decision !== '不符合').sort((a,b) => actionRank(b) - actionRank(a));
    els.resumeJobSelect.innerHTML = candidates.map(j => `<option value="${escapeHtml(j.id)}">${escapeHtml(j.company)}｜${escapeHtml(j.role)}｜${escapeHtml(j.city || '待核实')}</option>`).join('');
    populateResumeForm(job || candidates[0]);
    els.resumeModal.classList.add('open'); els.resumeModal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    const body = els.resumeForm.querySelector('.resume-modal-body'); if (body) body.scrollTop = 0;
  }
  function closeResumeModal() { els.resumeModal.classList.remove('open'); els.resumeModal.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  const requestRepo = 'galares/autumn-recruitment-requests';
  function buildAiRequest(job) {
    const taskType = $('resumeTaskType').value; const focus = $('resumeFocus').value;
    const jd = $('resumeJD').value.trim(); const extra = $('resumeExtra').value.trim();
    const outputFile = suggestedResumeFile(job, focus);
    return `## AI执行任务\n\n- 任务：${taskType}\n- 岗位ID：${job.id}\n- 公司：${job.company}\n- 岗位：${job.role}\n- 城市：${job.city || '待核实'}\n- 官方链接：${job.url || '未提供'}\n- 简历方向：${focus}\n- 建议输出文件：output/autumn2027/resumes/${outputFile}\n\n## JD或内推文字\n\n${jd || '尚未取得完整JD，请先核验官方页面。'}\n\n## 本次补充说明\n\n${extra || '无额外要求，以岗位硬性条件和真实匹配度为准。'}\n\n## 执行要求\n\n1. 优先核验企业官网和官方校招入口，确认岗位有效性、2027届海外硕士毕业窗口、专业、技能、城市、截止日期、薪资和限投规则。\n2. 使用“找工作”项目内已有原始简历、报告、论文材料和用户明确确认的信息。以前生成的简历措辞不能单独作为新增事实。\n3. 不得添加不存在的成绩、排名、项目、专利、技能熟练度或量化成果；德国实验按小组共同参与、互相讨论表述。\n4. 如任务涉及简历，直接生成DOCX并渲染检查，保存到 resumes 文件夹，自动命名并关联岗位，无需用户填写文件名。\n5. 如任务涉及投递，先准备并检查资料；遇到登录、验证码、未知必填事实或最终提交时再请用户确认。没有成功页面、申请编号或确认邮件时不得标记“已提交”。\n6. 完成后更新看板与投递记录，并说明已完成内容、真实缺口和文件入口。\n\n> 此任务由求职看板创建。提交该私人任务单表示授权AI按以上范围开始处理。请勿在任务单中填写密码或验证码。`;
  }
  function openPrivateRequest(job) {
    const taskType = $('resumeTaskType').value; const focus = $('resumeFocus').value;
    const title = `[AI任务] ${taskType}｜${job.company}｜${job.role}`;
    const body = buildAiRequest(job).slice(0, 7000);
    updateLocal(job, {aiTaskDraftAt: new Date().toISOString(), aiTaskType: taskType, resumeFocus: focus, resumeJD: $('resumeJD').value, resumeExtra: $('resumeExtra').value}, '已打开私人AI任务确认页，等待提交确认');
    const url = `https://github.com/${requestRepo}/issues/new?labels=ai-task&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener');
    closeResumeModal(); render();
  }

  function exportBackup() {
    const payload = {...store, version: 2, exportedAt: new Date().toISOString(), baseJobIds: baseJobs.map(j => j.id)};
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `陈杰_秋招看板备份_${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  }
  function restoreBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.version !== 2 || typeof data.jobs !== 'object' || !Array.isArray(data.customJobs)) throw new Error('格式不正确');
        storage.setItem(`${storageKey}-before-restore`, JSON.stringify(store));
        store.jobs = data.jobs; store.customJobs = data.customJobs; persist(); render();
      } catch (error) { window.alert(`无法恢复备份：${error.message}`); }
      els.restoreInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  setOptions(els.status, statusOptions); setOptions(els.city, ['上海','苏州','杭州','其他']); setOptions(els.resume, ['测试验证','应用技术','制造工艺']);
  els.query.addEventListener('input', e => { state.query = e.target.value; render(); });
  [['decision',els.decision],['status',els.status],['city',els.city],['resume',els.resume],['sort',els.sort]].forEach(([key,el]) => el.addEventListener('change', e => { state[key] = e.target.value; render(); }));
  $('clearFilters').addEventListener('click', () => { Object.assign(state,{query:'',decision:'全部',status:'全部',city:'全部',resume:'全部',sort:'priority',priorityOnly:false}); els.query.value=''; els.decision.value=els.status.value=els.city.value=els.resume.value='全部'; els.sort.value='priority'; els.focusBtn.textContent='只看优先项'; render(); });
  els.focusBtn.addEventListener('click', () => { state.priorityOnly=!state.priorityOnly; els.focusBtn.textContent=state.priorityOnly?'显示全部':'只看优先项'; render(); });
  $('addJobBtn').addEventListener('click', openModal); $('exportBtn').addEventListener('click', exportBackup); $('restoreBtn').addEventListener('click', () => els.restoreInput.click());
  $('syncBtn').addEventListener('click', () => refreshOnlineJobs(true));
  $('resumeFactoryBtn').addEventListener('click', () => openResumeModal()); $('resumeFactoryMainBtn').addEventListener('click', () => openResumeModal());
  els.restoreInput.addEventListener('change', () => { if (els.restoreInput.files[0]) restoreBackup(els.restoreInput.files[0]); });
  els.resumeJobSelect.addEventListener('change', () => populateResumeForm(selectedResumeJob()));
  $('sendToAi').addEventListener('click', () => { const job = selectedResumeJob(); if (job) openPrivateRequest(job); });
  els.form.addEventListener('submit', e => {
    e.preventDefault(); const data = new FormData(els.form); const id = `CUSTOM-${Date.now()}`; const url = safeUrl(data.get('url'));
    const createResume = data.get('createResume') === 'on';
    const job = {id, company: String(data.get('company')).trim(), role: String(data.get('role')).trim(), city: String(data.get('city')).trim() || '待核实', kind: '微信内推/手动导入', decision: '待核实', status: '已发现', fit: '待根据完整JD与真实经历库核验。', gaps: '资格、技能、薪资、截止日期和限投规则尚未核验。', qualification: '待核验', salary: '待核实', deadline: null, deadline_note: '待核实', quota: '待核实', url, sources: url, resume: '待确定', next: '核验官方岗位页面、毕业窗口、技能要求、薪资和限投规则。', rawText: String(data.get('rawText')).trim(), sourceNote: String(data.get('sourceNote')).trim(), submitted_at: null, receipt: null, custom: true};
    store.customJobs.unshift(job); updateLocal(job, {}, '手动导入岗位，进入待核实队列'); els.form.reset(); closeModal(); render();
    if (createResume) openResumeModal(job); else openDrawer(job);
  });
  els.drawer.querySelectorAll('[data-close]').forEach(x => x.addEventListener('click', closeDrawer)); els.modal.querySelectorAll('[data-modal-close]').forEach(x => x.addEventListener('click', closeModal));
  els.resumeModal.querySelectorAll('[data-resume-close]').forEach(x => x.addEventListener('click', closeResumeModal));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeModal(); closeResumeModal(); } });
  persist(); render(); refreshOnlineJobs(false);
  if (location.hash === '#resume-factory') openResumeModal();
})();
