/* ═══════════════════════════════════════════════════════════
   HZS ASSET LEDGER — 应用逻辑
   腾讯云开发 CloudBase（PostgreSQL 模式）云端存储 · 登录鉴权 · 实时同步
   ═══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const LEGACY_LS_KEY = 'hzs-assets-v1';   // 旧版本地数据（仅用于首次迁移）
  const CACHE_KEY = 'hzs-cloud-cache-v1';  // 云端数据本地缓存
  const MIGRATE_KEY = 'hzs-cloud-migrated-v1';
  const DAY = 86400000;

  /* ── 枚举 ─────────────────────────────────────── */
  const STATUS = {
    in_use:   { label: '在用',   cls: 'green' },
    idle:     { label: '闲置',   cls: 'amber' },
    repair:   { label: '维修中', cls: 'red'   },
    scrapped: { label: '已报废', cls: 'grey'  },
    suspended:{ label: '已停用', cls: 'grey'  },
    expired:  { label: '已过期', cls: 'red'   },
  };

  const PHYSICAL_STATUS = ['in_use', 'idle', 'repair', 'scrapped'];
  const VIRTUAL_STATUS  = ['in_use', 'suspended', 'expired'];

  const CATEGORIES = [
    '拍摄设备', '灯光设备', '录音设备', '办公设备',
    'IT/网络设备', '家具家私', '交通工具', '其他',
  ];

  const VIEWS = {
    dashboard: { title: '工作室资产<em>总览</em>', sub: '所有实体与虚拟资产的实时台账', add: '' },
    physical:  { title: '实体<em>资产</em>', sub: '设备、家具与实物财产台账', add: '新增实体资产' },
    virtual:   { title: '虚拟<em>资产</em>', sub: '账号、订阅与数字凭据台账', add: '新增虚拟资产' },
  };

  const SORTS = {
    dashboard: [],
    physical: [
      ['newest', '最新录入'], ['name', '名称 A→Z'],
      ['date', '购入日期'],
    ],
    virtual: [
      ['newest', '最新录入'], ['name', '名称 A→Z'], ['expire', '到期日最近'],
    ],
  };

  /* ── 状态 ─────────────────────────────────────── */
  const state = {
    items: [],
    ready: false,            // 云端首次加载完成
    booting: false,
    session: null,
    sync: 'connecting',      // connecting | online | offline
    view: 'dashboard',
    keyword: '',
    statusFilter: 'all',
    categoryFilter: 'all',
    sort: 'newest',
    showAllPasswords: false,
    revealed: new Set(),
  };

  let app = null;            // CloudBase 应用实例
  let auth = null;           // CloudBase 认证实例
  let accessToken = null;    // 当前登录用户 JWT（PostgREST 请求用）
  let liveChannel = null;    // 实时订阅频道
  let pollTimer = null;      // Realtime 不可用时的定时刷新兜底
  let crossTab = null;       // 同源标签页变更通知
  let fallbackActive = false;
  const POLL_INTERVAL = 20000;
  const CONFIG = window.HZS_CONFIG || {};

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');

  /* ═══════════════ 数据层 ═══════════════ */

  function uid() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ═══════════════ 云端数据层 ═══════════════ */

  function rowToItem(row) {
    const item = (row.data && typeof row.data === 'object') ? { ...row.data } : {};
    item.id = row.id;
    item.type = row.type;
    if (!item.createdAt) item.createdAt = row.created_at ? new Date(row.created_at).getTime() : Date.now();
    if (!item.updatedAt) item.updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : item.createdAt;
    return item;
  }

  const REST_BASE = () => `https://${CONFIG.ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;
  const FETCH_TIMEOUT_MS = 15000;   // 单次 REST 请求超时，防止网络挂起时界面无限等待

  // 向 SDK 取一次当前会话（必要时会自动刷新令牌）
  async function refreshAccessToken() {
    try {
      if (auth && typeof auth.getSession === 'function') {
        const res = await auth.getSession();
        const ses = res && res.data && res.data.session;
        if (ses && ses.access_token) {
          accessToken = ses.access_token;
          return accessToken;
        }
      }
    } catch (e) { /* 保留旧令牌，交由请求结果处理 */ }
    return accessToken;
  }

  function fetchWithTimeout(url, options, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...options, signal: ctrl.signal })
      .finally(() => clearTimeout(timer));
  }

  async function restFetch(path, options = {}) {
    const buildOpts = () => ({
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken || CONFIG.PUBLISHABLE_KEY}`,
        ...(options.headers || {}),
      },
    });

    let res;
    try {
      res = await fetchWithTimeout(REST_BASE() + path, buildOpts(), FETCH_TIMEOUT_MS);
    } catch (e) {
      const err = new Error(e && e.name === 'AbortError'
        ? '云端请求超时，请检查网络后重试'
        : '网络请求失败：' + ((e && e.message) || '未知错误'));
      throw err;
    }

    // 令牌过期：刷新一次后重试同一请求
    if (res.status === 401 && auth) {
      const fresh = await refreshAccessToken();
      if (fresh) {
        try {
          res = await fetchWithTimeout(REST_BASE() + path, buildOpts(), FETCH_TIMEOUT_MS);
        } catch (e) {
          throw new Error(e && e.name === 'AbortError'
            ? '云端请求超时，请检查网络后重试'
            : '网络请求失败：' + ((e && e.message) || '未知错误'));
        }
      }
    }

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = body.message || body.msg || body.error || msg;
      } catch (e) { /* 无 JSON 错误体 */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function cloudFetchAll() {
    const rows = await restFetch('/assets?select=*&order=created_at.asc');
    return (rows || []).map(rowToItem);
  }

  function toRow(item) {
    return {
      id: item.id,
      type: item.type,
      data: item,
      updated_at: new Date(item.updatedAt || Date.now()).toISOString(),
    };
  }

  async function cloudUpsert(item) {
    await restFetch('/assets', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(toRow(item)),
    });
  }

  async function cloudUpsertMany(items) {
    if (!items.length) return;
    await restFetch('/assets', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(items.map(toRow)),
    });
  }

  async function cloudDelete(id) {
    await restFetch(`/assets?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  function cacheItems() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.items)); } catch (e) { /* 忽略配额错误 */ }
  }

  function readCache() {
    try {
      const arr = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  // 读取旧版本地台账（首次迁移用）
  function readLegacyItems() {
    try {
      const raw = localStorage.getItem(LEGACY_LS_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      const items = Array.isArray(data.items) ? data.items : [];
      return items
        .filter(i => i && (i.type === 'physical' || i.type === 'virtual') && (i.name || i.platform))
        .map(i => {
          delete i.price;
          if (!i.id) i.id = uid();
          if (!i.createdAt) i.createdAt = Date.now();
          return i;
        });
    } catch (e) { return []; }
  }

  function friendlyErr(err) {
    const msg = (err && (err.message || err.error_description || err.msg)) || String(err);
    if (/[\u4e00-\u9fa5]/.test(msg)) return msg;  // 已是中文错误直接展示
    const map = [
      [/invalid (login )?credentials|incorrect.*password|username or password/i, '邮箱或密码错误'],
      [/user not found|user does not exist/i, '账号不存在，请联系管理员创建'],
      [/login.?type.*disabled|provider.*disabled|not.*enabled/i, '该登录方式未开启，请联系管理员在控制台开启'],
      [/at least 6|minimum.*8|password.*length/i, '密码长度或强度不符合要求（8-32 位，含字母和数字）'],
      [/rate limit|too many requests/i, '操作过于频繁，请稍后再试'],
      [/permission denied|unauthorized|forbidden/i, '没有操作权限，请确认账号已被允许访问'],
      [/failed to fetch|network|load failed|timeout/i, '无法连接云端服务器，请检查网络'],
    ];
    for (const [re, zh] of map) if (re.test(msg)) return zh;
    return msg;
  }

  function setSync(status) {
    state.sync = status;
    const dot = $('#syncDot');
    const text = $('#syncText');
    if (!dot || !text) return;
    // polling 复用 connecting 的琥珀色样式
    dot.className = 'sync-dot ' + (status === 'polling' ? 'connecting' : status);
    text.textContent = status === 'online' ? '实时同步已连接'
                     : status === 'polling' ? '已连接云端 · 自动刷新中'
                     : status === 'offline' ? '云端连接断开，重连中…'
                     : '正在连接云端…';
  }

  let flashTimer;
  function flashSync() {
    const text = $('#syncText');
    if (!text || (state.sync !== 'online' && state.sync !== 'polling')) return;
    text.textContent = '刚刚收到云端更新';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      text.textContent = state.sync === 'online' ? '实时同步已连接' : '已连接云端 · 自动刷新中';
    }, 1600);
  }

  function nextCode() {
    let max = 0;
    state.items.filter(i => i.type === 'physical').forEach(i => {
      const m = /^P-(\d+)$/.exec(i.code || '');
      if (m) max = Math.max(max, +m[1]);
    });
    return 'P-' + String(max + 1).padStart(3, '0');
  }

  /* ═══════════════ 工具函数 ═══════════════ */

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(d) {
    return d ? d.replace(/-/g, '/') : '—';
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    return Math.round((target - today) / DAY);
  }

  function expireInfo(dateStr) {
    const d = daysUntil(dateStr);
    if (d === null) return { text: '长期有效', cls: '' };
    if (d < 0)  return { text: `已过期 ${-d} 天`, cls: 'danger' };
    if (d === 0) return { text: '今日到期', cls: 'danger' };
    if (d <= 7)  return { text: `剩余 ${d} 天`, cls: 'danger' };
    if (d <= 30) return { text: `剩余 ${d} 天`, cls: 'warn' };
    return { text: `剩余 ${d} 天`, cls: '' };
  }

  function chip(status) {
    const s = STATUS[status] || STATUS.in_use;
    return `<span class="chip ${s.cls}">${s.label}</span>`;
  }

  function maskPwd(p) {
    return '•'.repeat(Math.min(Math.max((p || '').length, 6), 12));
  }

  function todayCN() {
    const d = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getFullYear()} 年 ${String(d.getMonth() + 1).padStart(2, '0')} 月 ${String(d.getDate()).padStart(2, '0')} 日 · 周${week}`;
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await Promise.race([
          navigator.clipboard.writeText(text),
          new Promise((_, rej) => setTimeout(() => rej(new Error('clipboard-timeout')), 1200)),
        ]);
        return true;
      } catch (e) { /* 权限拒绝 / 超时 → 回退 */ }
    }
    return legacyCopy(text);
  }

  /* ═══════════════ 筛选与排序 ═══════════════ */

  function filtered(type) {
    const kw = state.keyword.trim().toLowerCase();
    let list = state.items.filter(i => i.type === type);

    if (state.statusFilter !== 'all') list = list.filter(i => i.status === state.statusFilter);
    if (type === 'physical' && state.categoryFilter !== 'all') {
      list = list.filter(i => i.category === state.categoryFilter);
    }
    if (kw) {
      list = list.filter(i =>
        Object.values(i).some(v => String(v ?? '').toLowerCase().includes(kw))
      );
    }

    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      name:   (a, b) => (a.name || a.platform || '').localeCompare(b.name || b.platform || '', 'zh'),
      date:   (a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''),
      expire: (a, b) => {
        if (!a.expireDate) return 1;
        if (!b.expireDate) return -1;
        return a.expireDate.localeCompare(b.expireDate);
      },
    };
    return list.sort(sorters[state.sort] || sorters.newest);
  }

  /* ═══════════════ 渲染：公共头尾 ═══════════════ */

  function renderChrome() {
    const phys = state.items.filter(i => i.type === 'physical').length;
    const virt = state.items.filter(i => i.type === 'virtual').length;
    $('#countDashboard').textContent = state.items.length;
    $('#countPhysical').textContent = phys;
    $('#countVirtual').textContent = virt;

    $$('.nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.view === state.view));

    // 工具栏随视图切换
    const meta = VIEWS[state.view];
    $('#addBtn').hidden = state.view === 'dashboard';
    $('#addBtnText').textContent = meta.add;
    $('#revealAllBtn').hidden = state.view !== 'virtual';
    $('#revealAllBtn').classList.toggle('is-on', state.showAllPasswords);

    // 状态下拉
    const statuses = state.view === 'physical' ? PHYSICAL_STATUS
                   : state.view === 'virtual'  ? VIRTUAL_STATUS : [];
    const cur = state.statusFilter;
    $('#statusFilter').innerHTML = state.view === 'dashboard'
      ? '<option value="all">总览模式</option>'
      : `<option value="all">全部状态</option>` + statuses.map(s =>
          `<option value="${s}"${s === cur ? ' selected' : ''}>${STATUS[s].label}</option>`).join('');
    $('#statusFilter').disabled = state.view === 'dashboard';

    // 排序下拉
    const sorts = SORTS[state.view];
    $('#sortSelect').innerHTML = sorts.length
      ? sorts.map(([v, l]) => `<option value="${v}"${v === state.sort ? ' selected' : ''}>${l}</option>`).join('')
      : '<option value="newest">默认排序</option>';
    $('#sortSelect').disabled = !sorts.length;

    // 分类筛选（实体视图额外挂一个 select？直接并入搜索区左侧的简单做法：放进面板工具条）
  }

  function headHTML(resultsCount) {
    const meta = VIEWS[state.view];
    const sub = state.view === 'dashboard'
      ? `数据更新于 ${todayCN()}`
      : `共 <b style="color:var(--brass)">${resultsCount}</b> 项${state.keyword ? ` · 搜索“${esc(state.keyword)}”` : ''}`;
    return `
      <div class="view-head">
        <div class="kicker">HZS STUDIO · ${state.view === 'dashboard' ? 'DASHBOARD' : state.view === 'physical' ? 'PHYSICAL ASSETS' : 'VIRTUAL ASSETS'}</div>
        <h1 class="view-title">${meta.title}</h1>
        <div class="view-sub"><span>${meta.sub}</span><span class="dot"></span><span class="date-stamp">${sub}</span></div>
      </div>`;
  }

  /* ═══════════════ 渲染：总览 ═══════════════ */

  function renderDashboard() {
    const phys = state.items.filter(i => i.type === 'physical');
    const virt = state.items.filter(i => i.type === 'virtual');
    const repairCount = phys.filter(i => i.status === 'repair').length;
    const expiring = virt
      .filter(i => i.expireDate && daysUntil(i.expireDate) <= 30)
      .sort((a, b) => a.expireDate.localeCompare(b.expireDate));
    const attention = repairCount + expiring.length;

    // 状态分布
    const statusOrder = ['in_use', 'idle', 'repair', 'suspended', 'expired', 'scrapped'];
    const statusCounts = statusOrder
      .map(s => ({ s, n: state.items.filter(i => i.status === s).length }))
      .filter(x => x.n > 0);
    const maxStatus = Math.max(1, ...statusCounts.map(x => x.n));
    const statusColor = { in_use: 'var(--green)', idle: 'var(--amber)', repair: 'var(--red)', suspended: 'var(--grey)', expired: 'var(--red)', scrapped: 'var(--grey)' };

    // 类别分布
    const catMap = {};
    phys.forEach(i => { catMap[i.category] = (catMap[i.category] || 0) + 1; });
    const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxCat = Math.max(1, ...cats.map(c => c[1]));

    const recent = [...state.items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);

    view.innerHTML = headHTML(state.items.length) + `
      <div class="stat-grid">
        ${statCard('资产总数', state.items.length, '项', `实体 <b>${phys.length}</b> · 虚拟 <b>${virt.length}</b>`)}
        ${statCard('实体资产', phys.length, '件', `分布于 <b>${new Set(phys.map(i => i.location)).size}</b> 个位置`)}
        ${statCard('虚拟账号', virt.length, '个', `在用 <b>${virt.filter(i => i.status === 'in_use').length}</b> · 停用/过期 <b>${virt.length - virt.filter(i => i.status === 'in_use').length}</b>`)}
        ${statCard('待关注', attention, '项', `维修中 <b>${repairCount}</b> · 30 天内到期 <b>${expiring.length}</b>`)}
      </div>

      <div class="dash-grid">
        <div class="panel">
          <div class="panel-head"><div class="panel-title">资产状态分布</div><div class="panel-side">ALL ASSETS</div></div>
          <div class="panel-body">
            ${statusCounts.length ? statusCounts.map(x => `
              <div class="bar-row">
                <div class="bar-name" style="--c:${statusColor[x.s]}">${STATUS[x.s].label}</div>
                <div class="bar-track"><div class="bar-fill" data-w="${Math.round(x.n / maxStatus * 100)}" style="--c:${statusColor[x.s]}"></div></div>
                <div class="bar-num">${x.n}</div>
              </div>`).join('') : '<div class="empty-mini">暂无数据</div>'}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><div class="panel-title">实体资产类别</div><div class="panel-side">CATEGORY</div></div>
          <div class="panel-body">
            ${cats.length ? cats.map(([name, n]) => `
              <div class="bar-row">
                <div class="bar-name" style="--c:var(--brass)">${esc(name)}</div>
                <div class="bar-track"><div class="bar-fill" data-w="${Math.round(n / maxCat * 100)}" style="--c:var(--brass)"></div></div>
                <div class="bar-num">${n}</div>
              </div>`).join('') : '<div class="empty-mini">暂无实体资产</div>'}
          </div>
        </div>
      </div>

      <div class="panel recent-panel">
        <div class="panel-head">
          <div class="panel-title">到期提醒 · 30 天内</div>
          <div class="panel-side">${expiring.length} 项需关注</div>
        </div>
        <div class="panel-body" style="padding-top:10px">
          ${expiring.length ? `<ul class="expire-list">${expiring.map(i => {
            const e = expireInfo(i.expireDate);
            const color = e.cls === 'danger' ? 'var(--red)' : e.cls === 'warn' ? 'var(--amber)' : 'var(--green)';
            return `<li class="expire-item">
              <span class="expire-dot" style="background:${color}"></span>
              <span class="expire-name">${esc(i.platform)}</span>
              <span class="expire-when" style="color:${color}">${fmtDate(i.expireDate)} · ${e.text}</span>
            </li>`;
          }).join('')}</ul>` : '<div class="empty-mini">近 30 天内没有需要续费的账号，一切正常。</div>'}
        </div>
      </div>

      <div class="panel recent-panel">
        <div class="panel-head"><div class="panel-title">最近录入</div><div class="panel-side">RECENT</div></div>
        <div class="table-wrap">
          <table class="recent-table">
            <thead><tr><th>资产</th><th>类型</th><th>关键信息</th><th>状态</th></tr></thead>
            <tbody>${recent.map(i => `<tr style="cursor:pointer" data-open="${i.id}">
              <td><div class="cell-main">${esc(i.type === 'physical' ? i.name : i.platform)}</div>
                  <div class="cell-sub">${i.type === 'physical' ? esc(i.code) : 'VIRTUAL'}</div></td>
              <td>${i.type === 'physical' ? '实体' : '虚拟'}</td>
              <td class="asset-meta">${esc(i.type === 'physical' ? (i.location || '—') : i.account)}</td>
              <td>${chip(i.status)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;

    requestAnimationFrame(() => $$('.bar-fill').forEach(el => { el.style.width = el.dataset.w + '%'; }));
  }

  function statCard(label, value, unit, foot) {
    return `<div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
      <div class="stat-foot">${foot}</div>
    </div>`;
  }

  /* ═══════════════ 渲染：实体资产 ═══════════════ */

  function renderPhysical() {
    const list = filtered('physical');
    const catOptions = ['all', ...CATEGORIES];

    view.innerHTML = headHTML(list.length) + `
      <div class="panel" style="animation-delay:.08s">
        <div class="panel-head" style="padding-bottom:14px">
          <div class="panel-title">实物台账</div>
          <select class="select" id="catFilter" style="height:34px;font-size:12px">
            ${catOptions.map(c => `<option value="${esc(c)}"${c === state.categoryFilter ? ' selected' : ''}>${c === 'all' ? '全部类别' : esc(c)}</option>`).join('')}
          </select>
        </div>
        ${list.length ? `
        <div class="table-wrap">
          <table class="asset-table">
            <thead><tr>
              <th>编号 / 名称</th><th>类别</th><th>负责人</th><th>存放位置</th>
              <th>购入日期</th><th>状态</th><th></th>
            </tr></thead>
            <tbody>
              ${list.map(i => `
              <tr data-open="${i.id}">
                <td data-label="资产">
                  <div class="asset-name">${esc(i.name)}</div>
                  <div class="asset-code">${esc(i.code)}</div>
                </td>
                <td data-label="类别"><span class="asset-cat">${esc(i.category || '其他')}</span></td>
                <td data-label="负责人" class="asset-meta">${esc(i.owner || '—')}</td>
                <td data-label="位置" class="asset-meta">${esc(i.location || '—')}</td>
                <td data-label="购入日期" class="asset-code">${fmtDate(i.purchaseDate)}</td>
                <td data-label="状态">${chip(i.status)}</td>
                <td data-label="操作">
                  <div class="row-actions">
                    <button class="btn-mini" data-edit="${i.id}" title="编辑">${iconEdit}</button>
                    <button class="btn-mini danger" data-del="${i.id}" title="删除">${iconTrash}</button>
                  </div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : emptyBlock('实体资产', '登记相机、灯光、家具、IT 设备等实物财产')}
      </div>`;

    $('#catFilter')?.addEventListener('change', e => { state.categoryFilter = e.target.value; renderAll(); });
  }

  /* ═══════════════ 渲染：虚拟资产 ═══════════════ */

  function renderVirtual() {
    const list = filtered('virtual');

    view.innerHTML = headHTML(list.length) + (list.length ? `
      <div class="vcard-grid">
        ${list.map((i, idx) => vcardHTML(i, idx)).join('')}
      </div>` : emptyBlock('虚拟资产', '登记平台账号、订阅服务与数字凭据，支持一键复制'));
  }

  function vcardHTML(i, idx) {
    const show = state.showAllPasswords || state.revealed.has(i.id);
    const e = expireInfo(i.expireDate);
    const monogram = esc((i.platform || '?').trim()[0] || '?');
    return `
    <article class="vcard" style="--i:${idx}">
      <div class="vcard-top">
        <div class="vcard-logo">${monogram}</div>
        <div class="vcard-id">
          <div class="vcard-name">${esc(i.platform)}</div>
          ${i.url ? `<a class="vcard-url" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">
            <span>${esc(i.url.replace(/^https?:\/\//, ''))}</span>
            <svg viewBox="0 0 24 24" width="11" height="11"><path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>` : '<div class="vcard-url">未登记网址</div>'}
        </div>
        ${chip(i.status)}
      </div>

      <div class="cred">
        <span class="cred-label">账号 / Account</span>
        <div class="cred-field">
          <code class="cred-value" title="${esc(i.account)}">${esc(i.account)}</code>
          <button class="cred-act" data-copy="${esc(i.account)}" data-copy-label="账号" title="复制账号">${iconCopy}</button>
        </div>
      </div>

      <div class="cred">
        <span class="cred-label">密码 / Password</span>
        <div class="cred-field">
          <code class="cred-value ${show ? '' : 'is-masked'}" title="${show ? '点击右侧复制' : ''}">${show ? esc(i.password) : maskPwd(i.password)}</code>
          <button class="cred-act" data-toggle-pw="${i.id}" title="${show ? '隐藏密码' : '显示密码'}">${show ? iconEyeOff : iconEye}</button>
          <button class="cred-act" data-copy="${esc(i.password)}" data-copy-label="密码" title="复制密码">${iconCopy}</button>
        </div>
      </div>

      ${i.contact ? `<div class="asset-meta">关联：${esc(i.contact)}</div>` : ''}
      ${i.note ? `<div class="vcard-note">“${esc(i.note)}”</div>` : ''}

      <div class="vcard-foot">
        ${iconClock}
        <span class="expire-tag ${e.cls}">${fmtDate(i.expireDate)} · ${e.text}</span>
        <span class="spacer"></span>
        <span class="row-actions">
          <button class="btn-mini" data-edit="${i.id}" title="编辑">${iconEdit}</button>
          <button class="btn-mini danger" data-del="${i.id}" title="删除">${iconTrash}</button>
        </span>
      </div>
    </article>`;
  }

  function emptyBlock(noun, desc) {
    const searching = state.keyword || state.statusFilter !== 'all' ||
      (state.view === 'physical' && state.categoryFilter !== 'all');
    return `
      <div class="panel-body">
        <div class="empty-state">
          <div class="empty-glyph">∅</div>
          <h3>${searching ? '没有匹配的' + noun : '还没有' + noun}</h3>
          <p>${searching ? '试试更换关键词或清空筛选条件。' : desc}</p>
          ${searching ? '' : `<button class="btn btn-primary" data-add="${state.view}">立即登记</button>`}
        </div>
      </div>`;
  }

  /* ── 图标 ─────────────────────────────────────── */
  const iconEye = `<svg viewBox="0 0 24 24" width="15" height="15"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const iconEyeOff = `<svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 4l16 16M9.9 5.9A9.7 9.7 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-3.3 4M6.2 7.4A15.8 15.8 0 002.5 12S6 18.5 12 18.5a9.5 9.5 0 003.6-.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.9 9.9a3 3 0 004.2 4.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const iconCopy = `<svg viewBox="0 0 24 24" width="14" height="14"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const iconEdit = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5l3 3" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const iconTrash = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0l-.8 12.2A1.5 1.5 0 0115.7 20H8.3a1.5 1.5 0 01-1.5-1.3L6 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const iconClock = `<svg viewBox="0 0 24 24" width="13" height="13"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  const iconCheck = `<svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /* ═══════════════ 新增 / 编辑弹窗 ═══════════════ */

  function openForm(type, id) {
    const editing = id ? state.items.find(x => x.id === id) : null;
    const t = editing ? editing.type : type;
    const isVirtual = t === 'virtual';

    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="overlay" data-overlay>
        <div class="modal" role="dialog" aria-modal="true" aria-label="资产登记表单">
          <div class="modal-head">
            <div>
              <div class="modal-sub">${editing ? 'EDIT · 编辑资产' : 'NEW · 登记资产'}</div>
              <div class="modal-title">${editing ? '编辑资产档案' : '登记新资产'}</div>
            </div>
            <button class="modal-close" data-close aria-label="关闭">
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="modal-body">
            <div class="seg">
              <button data-type="physical" class="${!isVirtual ? 'is-on' : ''}" ${editing ? 'disabled' : ''}>实体资产</button>
              <button data-type="virtual" class="${isVirtual ? 'is-on' : ''}" ${editing ? 'disabled' : ''}>虚拟资产</button>
            </div>
            <form id="assetForm" class="form-grid" novalidate>
              ${isVirtual ? virtualFields(editing) : physicalFields(editing)}
            </form>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" data-close>取消</button>
            <button class="btn btn-primary" id="saveBtn" type="button">
              ${iconCheck}<span>${editing ? '保存修改' : '确认登记'}</span>
            </button>
          </div>
        </div>
      </div>`;

    // 类型切换（仅新建）
    $$('.seg button', root).forEach(b => b.addEventListener('click', () => {
      closeModal();
      openForm(b.dataset.type);
    }));
    $$('[data-close]', root).forEach(b => b.addEventListener('click', closeModal));
    $('[data-overlay]', root).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

    $('#saveBtn').addEventListener('click', () => saveForm(t, editing));
    $('#genPwd')?.addEventListener('click', () => { $('#f-password').value = genPassword(); toast('已生成随机密码', 'ok'); });
    document.addEventListener('keydown', escClose);
    setTimeout(() => $(isVirtual ? '#f-platform' : '#f-name')?.focus(), 60);
  }

  function physicalFields(d) {
    d = d || {};
    return `
      <div class="field">
        <label>资产编号</label>
        <input type="text" id="f-code" value="${esc(d.code || nextCode())}" placeholder="P-007">
      </div>
      <div class="field">
        <label>资产名称 <span class="req">*</span></label>
        <input type="text" id="f-name" value="${esc(d.name || '')}" placeholder="如：Sony A7M4 相机机身">
      </div>
      <div class="field">
        <label>类别</label>
        <select id="f-category">${CATEGORIES.map(c =>
          `<option ${ (d.category || '拍摄设备') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>状态</label>
        <select id="f-status">${PHYSICAL_STATUS.map(s =>
          `<option value="${s}" ${(d.status || 'in_use') === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>购入日期</label>
        <input type="date" id="f-date" value="${esc(d.purchaseDate || '')}">
      </div>
      <div class="field">
        <label>负责人</label>
        <input type="text" id="f-owner" value="${esc(d.owner || '')}" placeholder="如：林越">
      </div>
      <div class="field full">
        <label>存放位置</label>
        <input type="text" id="f-location" value="${esc(d.location || '')}" placeholder="如：摄影棚 A · 防潮柜 1">
      </div>
      <div class="field full">
        <label>备注</label>
        <textarea id="f-note" placeholder="配件、保修、序列号等补充信息">${esc(d.note || '')}</textarea>
      </div>`;
  }

  function virtualFields(d) {
    d = d || {};
    return `
      <div class="field full">
        <label>平台 / 服务名称 <span class="req">*</span></label>
        <input type="text" id="f-platform" value="${esc(d.platform || '')}" placeholder="如：Adobe Creative Cloud">
      </div>
      <div class="field full">
        <label>登录网址</label>
        <input type="url" id="f-url" value="${esc(d.url || '')}" placeholder="https://…">
      </div>
      <div class="field">
        <label>登录账号 <span class="req">*</span></label>
        <input type="text" id="f-account" value="${esc(d.account || '')}" placeholder="邮箱 / 用户名 / 手机号">
      </div>
      <div class="field">
        <label>登录密码 <span class="req">*</span></label>
        <div class="input-affix">
          <input type="text" id="f-password" value="${esc(d.password || '')}" placeholder="登录密码" autocomplete="off">
          <button type="button" class="gen-btn" id="genPwd">随机</button>
        </div>
      </div>
      <div class="field">
        <label>关联邮箱 / 手机 / 持有人</label>
        <input type="text" id="f-contact" value="${esc(d.contact || '')}" placeholder="找回凭据用">
      </div>
      <div class="field">
        <label>到期日期</label>
        <input type="date" id="f-expire" value="${esc(d.expireDate || '')}">
      </div>
      <div class="field">
        <label>状态</label>
        <select id="f-status">${VIRTUAL_STATUS.map(s =>
          `<option value="${s}" ${(d.status || 'in_use') === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}</select>
      </div>
      <div class="field full">
        <label>备注</label>
        <textarea id="f-note" placeholder="二次验证方式、席位数量、续费策略等">${esc(d.note || '')}</textarea>
      </div>`;
  }

  function saveForm(type, editing) {
    const isVirtual = type === 'virtual';
    const required = isVirtual
      ? [['#f-platform', '请填写平台名称'], ['#f-account', '请填写登录账号'], ['#f-password', '请填写登录密码']]
      : [['#f-name', '请填写资产名称']];

    let ok = true;
    required.forEach(([sel]) => {
      const el = $(sel);
      const bad = !el.value.trim();
      el.classList.toggle('invalid', bad);
      if (bad) ok = false;
    });
    if (!ok) { toast('请填写必填项', 'err'); return; }

    const base = {
      status: $('#f-status').value,
      note: $('#f-note').value.trim(),
    };

    const record = isVirtual ? {
      ...base,
      type: 'virtual',
      platform: $('#f-platform').value.trim(),
      url: $('#f-url').value.trim(),
      account: $('#f-account').value.trim(),
      password: $('#f-password').value,
      contact: $('#f-contact').value.trim(),
      expireDate: $('#f-expire').value,
    } : {
      ...base,
      type: 'physical',
      code: $('#f-code').value.trim() || nextCode(),
      name: $('#f-name').value.trim(),
      category: $('#f-category').value,
      purchaseDate: $('#f-date').value,
      location: $('#f-location').value.trim(),
      owner: $('#f-owner').value.trim(),
    };

    const now = Date.now();
    let saved;
    if (editing) {
      Object.assign(editing, record, { updatedAt: now });
      saved = editing;
    } else {
      saved = { id: uid(), createdAt: now, updatedAt: now, ...record };
      state.items.push(saved);
    }

    closeModal();
    renderAll();
    cloudUpsert(saved)
      .then(() => { cacheItems(); notifyOtherTabs(); toast(editing ? '已保存并同步到云端' : '资产已登记并同步到云端', 'ok'); })
      .catch(async err => {
        toast('云端保存失败：' + friendlyErr(err) + '，正在恢复数据…', 'err');
        try { state.items = await cloudFetchAll(); } catch (e2) { /* 保留本地乐观态 */ }
        renderAll();
      });
  }

  function genPassword(len = 16) {
    const sets = [
      'ABCDEFGHJKLMNPQRSTUVWXYZ',
      'abcdefghijkmnpqrstuvwxyz',
      '23456789',
      '!@#$%^&*-_=+?#',
    ];
    const all = sets.join('');
    const arr = sets.map(s => s[rand(s.length)]);
    while (arr.length < len) arr.push(all[rand(all.length)]);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
  }
  function rand(n) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }

  /* ── 删除确认 ─────────────────────────────────── */
  async function confirmDelete(item) {
    const name = item.type === 'physical' ? item.name : item.platform;
    const root = $('#modalRoot');
    root.innerHTML = `
      <div class="overlay" data-overlay>
        <div class="modal confirm" role="alertdialog" aria-modal="true">
          <div class="modal-head">
            <div>
              <div class="modal-sub" style="color:var(--red)">DANGER · 删除确认</div>
              <div class="modal-title">删除这项资产？</div>
            </div>
          </div>
          <div class="confirm-body">
            <p>即将从台账中移除 <span class="target">「${esc(name)}」</span>，该操作不可撤销。</p>
          </div>
          <div class="modal-foot">
            <button class="btn btn-ghost" data-close>取消</button>
            <button class="btn btn-danger" id="confirmDel">确认删除</button>
          </div>
        </div>
      </div>`;
    document.addEventListener('keydown', escClose);
    return new Promise(resolve => {
      $('[data-overlay]', root).addEventListener('click', e => { if (e.target === e.currentTarget) { closeModal(); resolve(false); } });
      $$('[data-close]', root).forEach(b => b.addEventListener('click', () => { closeModal(); resolve(false); }));
      $('#confirmDel').addEventListener('click', () => { closeModal(); resolve(true); });
    });
  }

  function escClose(e) {
    if (e.key === 'Escape') closeModal();
  }
  function closeModal() {
    $('#modalRoot').innerHTML = '';
    document.removeEventListener('keydown', escClose);
  }

  /* 通用确认弹窗（Promise 版，替代原生 confirm，避免冻结页面） */
  function confirmChoice(opts) {
    opts = opts || {};
    const sub = opts.sub || 'CONFIRM';
    const title = opts.title || '请确认';
    const bodyHtml = opts.bodyHtml || '';
    const okText = opts.okText || '确定';
    const danger = !!opts.danger;
    const root = $('#modalRoot');
    root.innerHTML =
      '<div class="overlay" data-overlay>' +
        '<div class="modal confirm" role="alertdialog" aria-modal="true">' +
          '<div class="modal-head"><div>' +
            '<div class="modal-sub" style="color:var(--' + (danger ? 'red' : 'accent') + ')">' + esc(sub) + '</div>' +
            '<div class="modal-title">' + esc(title) + '</div>' +
          '</div></div>' +
          '<div class="confirm-body">' + bodyHtml + '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" data-close>取消</button>' +
            '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="confirmChoiceOk">' + esc(okText) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.addEventListener('keydown', escClose);
    return new Promise(resolve => {
      $('[data-overlay]', root).addEventListener('click', e => { if (e.target === e.currentTarget) { closeModal(); resolve(false); } });
      $('[data-close]', root).forEach(b => b.addEventListener('click', () => { closeModal(); resolve(false); }));
      $('#confirmChoiceOk').addEventListener('click', () => { closeModal(); resolve(true); });
    });
  }

  /* ═══════════════ Toast ═══════════════ */

  let toastTimer;
  function toast(msg, type = '') {
    const root = $('#toastRoot');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${type === 'ok' ? iconCheck : ''}<span>${esc(msg)}</span>`;
    root.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 2200);
  }

  /* ═══════════════ 导入 / 导出 ═══════════════ */

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ app: 'HZS Asset Ledger', version: 1, exportedAt: new Date().toISOString(), items: state.items }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hzs-assets-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 JSON 备份', 'ok');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const items = Array.isArray(data) ? data : data.items;
        if (!Array.isArray(items)) throw new Error('bad');
        const valid = items.filter(i => i && (i.type === 'physical' || i.type === 'virtual') && (i.name || i.platform));
        if (!valid.length) throw new Error('empty');
        const now = Date.now();
        valid.forEach(i => {
          if (!i.id) i.id = uid();
          if (!i.createdAt) i.createdAt = now;
          i.updatedAt = now;
        });
        confirmChoice({
          sub: 'IMPORT · 导入确认',
          title: `导入 ${valid.length} 条资产？`,
          bodyHtml: '<p>相同 ID 的资产会被更新，其他资产不受影响。</p>',
          okText: '确认导入',
        }).then(proceed => { if (!proceed) return; doImport(); });
        return;
        function doImport() {
          toast('正在导入云端…');
        cloudUpsertMany(valid)
          .then(async () => {
            state.items = await cloudFetchAll();
            cacheItems();
            renderAll();
            notifyOtherTabs();
            toast(`成功导入 ${valid.length} 条资产到云端`, 'ok');
          })
          .catch(err => toast('导入失败：' + friendlyErr(err), 'err'));
        }
      } catch (e) {
        toast('导入失败：文件格式不正确', 'err');
      }
    };
    reader.readAsText(file);
  }

  /* ═══════════════ 渲染入口 ═══════════════ */

  function renderAll() {
    renderChrome();
    if (state.view === 'dashboard') renderDashboard();
    else if (state.view === 'physical') renderPhysical();
    else renderVirtual();
  }

  /* ═══════════════ 事件绑定 ═══════════════ */

  $('#nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    state.view = btn.dataset.view;
    state.keyword = '';
    state.statusFilter = 'all';
    state.categoryFilter = 'all';
    state.sort = 'newest';
    $('#searchInput').value = '';
    renderAll();
    window.scrollTo({ top: 0 });
  });

  $('#searchInput').addEventListener('input', e => {
    state.keyword = e.target.value;
    if (state.view !== 'dashboard') renderAll();
  });
  $('#statusFilter').addEventListener('change', e => { state.statusFilter = e.target.value; renderAll(); });
  $('#sortSelect').addEventListener('change', e => { state.sort = e.target.value; renderAll(); });
  $('#addBtn').addEventListener('click', () => openForm(state.view));
  $('#revealAllBtn').addEventListener('click', () => {
    state.showAllPasswords = !state.showAllPasswords;
    renderAll();
  });
  $('#exportBtn').addEventListener('click', exportJSON);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  // 视图内事件委托
  view.addEventListener('click', async e => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const ok = await copyText(copyBtn.dataset.copy);
      if (ok) {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = iconCheck;
        setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.innerHTML = iconCopy; }, 1200);
        toast(`${copyBtn.dataset.copyLabel || '内容'}已复制到剪贴板`, 'ok');
      } else toast('复制失败，请手动选择文本', 'err');
      return;
    }

    const toggle = e.target.closest('[data-toggle-pw]');
    if (toggle) {
      const id = toggle.dataset.togglePw;
      state.revealed.has(id) ? state.revealed.delete(id) : state.revealed.add(id);
      renderVirtual();
      return;
    }

    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) { e.stopPropagation(); openForm(null, editBtn.dataset.edit); return; }

    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      e.stopPropagation();
      const item = state.items.find(i => i.id === delBtn.dataset.del);
      if (item && await confirmDelete(item)) {
        state.items = state.items.filter(i => i.id !== item.id);
        state.revealed.delete(item.id);
        renderAll();
        cloudDelete(item.id)
          .then(() => { cacheItems(); notifyOtherTabs(); toast('资产已删除并同步', 'ok'); })
          .catch(async err => {
            toast('云端删除失败：' + friendlyErr(err), 'err');
            try { state.items = await cloudFetchAll(); } catch (e2) { /* 保留本地态 */ }
            renderAll();
          });
      }
      return;
    }

    const addBtn = e.target.closest('[data-add]');
    if (addBtn) { openForm(addBtn.dataset.add); return; }

    // 点击行/卡片 → 编辑；虚拟卡片上排除交互元素
    const opener = e.target.closest('[data-open]');
    if (opener) openForm(null, opener.dataset.open);
  });

  /* ═══════════════ 登录与启动 ═══════════════ */

  const gate = $('#authGate');

  function showGate(pane) {
    gate.hidden = false;
    $$('.auth-pane', gate).forEach(p => { p.hidden = p.dataset.pane !== pane; });
  }
  function hideGate() { gate.hidden = true; }

  function showAuthError(msg) {
    const el = $('#authError');
    el.textContent = msg;
    el.hidden = false;
  }
  function clearAuthError() { $('#authError').hidden = true; }

  function renderUser(user) {
    if (!user) { $('#userBox').hidden = true; return; }
    $('#userBox').hidden = false;
    const meta = user.user_metadata || {};
    const name = meta.name || meta.nickName || meta.username
      || user.username || user.user_name
      || (user.email && user.email.trim())
      || (user.phone && user.phone.trim())
      || user.name || '成员';
    $('#userEmail').textContent = name;
    $('#userAvatar').textContent = name.trim()[0] || '·';
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    clearAuthError();
    const account = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    if (!account || password.length < 8) {
      showAuthError('请填写账号（用户名 / 邮箱 / 手机号），密码为 8-32 位且包含字母和数字');
      return;
    }
    const btn = $('#authSubmit');
    btn.disabled = true;
    btn.textContent = '请稍候…';
    try {
      // CloudBase 用户名密码登录：账号可填用户名 / 邮箱 / 手机号，SDK 统一归一化
      const { error } = await auth.signInWithPassword({ email: account, password });
      if (error) throw error;
      // 登录成功后 onAuthStateChange(SIGNED_IN) 会自动触发 bootstrap
    } catch (err) {
      showAuthError(friendlyErr(err));
    } finally {
      btn.disabled = false;
      $('#authSubmit').textContent = '登录';
    }
  }

  // 云端拉取：网络偶发挂起时短间隔重试，避免首屏一直停在加载页
  async function cloudFetchAllWithRetry(tries = 2) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        if (i > 0) await new Promise(r => setTimeout(r, 800));
        return await cloudFetchAll();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async function bootstrap(session) {
    if (state.booting) return;
    state.booting = true;
    state.session = session;
    setSync('connecting');
    showGate('loading');

    // 启动前先确保令牌可用（长期未打开的标签令牌可能已过期）
    await refreshAccessToken();

    let settled = false;
    let watchdog = null;

    const settleOnline = items => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      state.items = items;
      cacheItems();
      state.ready = true;
      state.booting = false;
      renderUser(session.user);
      hideGate();
      renderAll();
      subscribeRealtime();
      startCrossTabSync();
    };

    const settleOffline = err => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      state.booting = false;
      setSync('offline');
      // 加载失败时允许用本地缓存只读查看，避免完全白屏
      const cached = readCache();
      if (cached.length) {
        state.items = cached;
        renderUser(session.user);
        hideGate();
        renderAll();
        toast('云端连接失败，当前显示本机缓存（只读参考）：' + friendlyErr(err), 'err');
      } else {
        showGate('form');
        showAuthError('无法加载云端数据：' + friendlyErr(err) + '（可重新登录或稍后重试）');
      }
    };

    // 兜底看门狗：无论何种原因，加载遮罩都不应永久停留
    watchdog = setTimeout(async () => {
      if (state.ready || settled) return;
      try {
        settleOnline(await cloudFetchAll());
      } catch (err) {
        settleOffline(err);
      }
    }, 20000);

    let items;
    try {
      items = await cloudFetchAllWithRetry(2);
    } catch (err) {
      settleOffline(err);
      return;
    }
    if (settled) return;

    // 首次进入：云端为空且本机存在旧版数据 → 询问是否迁移（空数据绝不上传）
    if (!localStorage.getItem(MIGRATE_KEY)) {
      localStorage.setItem(MIGRATE_KEY, '1');
      if (items.length === 0) {
        const legacy = readLegacyItems();
        if (legacy.length) {
          const upload = await confirmChoice({
            sub: 'LEGACY · 发现本机旧数据',
            title: '把本机资产上传到云端？',
            bodyHtml:
              '<p>云端资产库目前是空的，检测到本机浏览器里还有 <span class="target">' + legacy.length + ' 条</span> 资产数据（可能是之前的示例/本地数据）。</p>' +
              '<p>上传后所有成员立即可见；取消则放弃本机数据，从空白资产库开始。</p>',
            okText: '上传到云端',
          });
          if (upload) {
            try {
              await cloudUpsertMany(legacy);
              items = await cloudFetchAll();
              toast(`已将 ${legacy.length} 条本机资产迁移到云端`, 'ok');
            } catch (err) {
              toast('本机数据迁移失败：' + friendlyErr(err) + '（可稍后用“导入”功能手动迁移）', 'err');
            }
          }
        }
      }
    }

    settleOnline(items);
  }

  /* ── 云端变更同步：Realtime 优先，失败自动降级为定时刷新 ── */

  function signatureOf(items) {
    return items.map(i => i.id + ':' + (i.updatedAt || 0)).sort().join('|');
  }

  let refreshing = false;
  async function refreshFromCloud(flash = true) {
    if (refreshing || !state.ready) return;
    // 编辑/确认弹窗打开时不刷新，避免打断正在编辑的对象
    if ($('#modalRoot') && $('#modalRoot').querySelector('.modal')) return;
    refreshing = true;
    try {
      const items = await cloudFetchAll();
      if (signatureOf(items) !== signatureOf(state.items)) {
        state.items = items;
        cacheItems();
        renderAll();
        if (flash) flashSync();
      }
    } catch (e) {
      // 单次轮询失败不打扰用户，等下一轮
      if (state.sync === 'online') setSync('offline');
    } finally {
      refreshing = false;
    }
  }

  function startFallbackPolling() {
    if (fallbackActive) return;
    fallbackActive = true;
    setSync('polling');
    pollTimer = setInterval(() => refreshFromCloud(), POLL_INTERVAL);
    document.addEventListener('visibilitychange', onVisibilityRefresh);
    window.addEventListener('focus', onFocusRefresh);
  }

  function stopFallbackPolling() {
    fallbackActive = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    document.removeEventListener('visibilitychange', onVisibilityRefresh);
    window.removeEventListener('focus', onFocusRefresh);
  }

  function onVisibilityRefresh() {
    if (fallbackActive && document.visibilityState === 'visible') refreshFromCloud();
  }
  function onFocusRefresh() {
    if (fallbackActive) refreshFromCloud();
  }

  // 同一浏览器内多个标签页：任一页写入后立即互相同步
  function startCrossTabSync() {
    if (crossTab || typeof BroadcastChannel !== 'function') return;
    crossTab = new BroadcastChannel('hzs-assets-sync');
    crossTab.onmessage = ev => {
      if (ev.data && ev.data.type === 'assets-changed') refreshFromCloud();
    };
  }

  function notifyOtherTabs() {
    try {
      if (crossTab) crossTab.postMessage({ type: 'assets-changed', at: Date.now() });
    } catch (e) { /* 忽略 */ }
  }

  function subscribeRealtime() {
    if (liveChannel) return;
    let errorCount = 0;
    let subscribed = false;
    const ch = app.realtime().channel('assets-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets' }, payload => {
        const type = String(payload.eventType || payload.type || '').toUpperCase();
        if (type === 'DELETE') {
          const id = (payload.oldRecord || payload.old || {}).id;
          if (id) {
            state.items = state.items.filter(i => i.id !== id);
            state.revealed.delete(id);
          }
        } else {
          const row = payload.newRecord || payload.new;
          if (row) {
            const item = rowToItem(row);
            const idx = state.items.findIndex(i => i.id === item.id);
            if (idx === -1) state.items.push(item);
            else state.items[idx] = item;
          }
        }
        cacheItems();
        flashSync();
        renderAll();
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          errorCount = 0;
          if (fallbackActive) stopFallbackPolling();
          setSync('online');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // SDK 内部会持续重连；实时通道暂不可用时立即降级为定时刷新保证多端同步，
          // 一旦后续重连成功（SUBSCRIBED）会自动停掉轮询并升级为实时状态
          errorCount += 1;
          startFallbackPolling();
        } else if (!fallbackActive) {
          setSync('connecting');
        }
      });
    liveChannel = ch;

    // 实时通道在部分环境下长时间无回调（传输层反复失败），
    // 8 秒内未订阅成功就先启用定时刷新兜底，待 SUBSCRIBED 后自动升级为实时
    setTimeout(() => {
      if (!subscribed && liveChannel === ch) startFallbackPolling();
    }, 8000);
  }

  async function handleSignOut() {
    stopFallbackPolling();
    if (crossTab) {
      try { crossTab.close(); } catch (e) { /* 忽略 */ }
      crossTab = null;
    }
    if (liveChannel) {
      try {
        await liveChannel.unsubscribe();
        await app.realtime().removeChannel(liveChannel);
      } catch (e) { /* 忽略 */ }
      liveChannel = null;
    }
    accessToken = null;
    state.ready = false;
    state.session = null;
    state.items = [];
    state.revealed.clear();
    localStorage.removeItem(CACHE_KEY);
    renderUser(null);
    renderAll();
    showGate('form');
  }

  function bindAuthUI() {
    $('#authForm').addEventListener('submit', handleAuthSubmit);
    $('#logoutBtn').addEventListener('click', () => auth.signOut());
  }

  function init() {
    const cfgOk = CONFIG.ENV_ID && CONFIG.PUBLISHABLE_KEY
      && window.cloudbase && typeof window.cloudbase.init === 'function';
    if (!cfgOk) { showGate('config'); return; }

    try {
      app = window.cloudbase.init({
        env: CONFIG.ENV_ID,
        region: CONFIG.REGION || 'ap-shanghai',
        accessKey: CONFIG.PUBLISHABLE_KEY,
      });
      // v3 中 app.auth 为对象；兼容个别版本以函数形式获取
      auth = (typeof app.auth === 'function' && !app.auth.signInWithPassword)
        ? app.auth({ persistence: 'local' })
        : app.auth;
    } catch (e) {
      showGate('config');
      return;
    }
    if (!auth || typeof auth.signInWithPassword !== 'function') { showGate('config'); return; }

    renderAll();
    setSync('connecting');
    showGate('loading');
    bindAuthUI();

    auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        handleSignOut();
      } else if (event === 'INITIAL_SESSION') {
        accessToken = session ? (session.access_token || null) : null;
        // 已完成启动后忽略 SDK 可能重复抛出的初始事件，避免闪回加载页
        if (state.ready) return;
        if (session) bootstrap(session);
        else showGate('form');
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        accessToken = session ? (session.access_token || accessToken) : accessToken;
        if (session && event === 'SIGNED_IN' && !state.ready && !state.booting) bootstrap(session);
      }
    });
  }

  init();
})();
