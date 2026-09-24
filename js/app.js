/* ═══════════════════════════════════════════════════════════
   HZS ASSET LEDGER — 应用逻辑
   纯原生 JS · 数据保存在 localStorage
   ═══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const LS_KEY = 'hzs-assets-v1';
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

  /* ── 示例数据（首次打开时写入） ────────────────── */
  const SEED = [
    { id: uid(), type: 'physical', code: 'P-001', name: 'Sony A7M4 相机机身', category: '拍摄设备',
      purchaseDate: '2023-05-12', location: '摄影棚 A · 防潮柜 1', owner: '林越',
      status: 'in_use', note: '配两块原厂电池', createdAt: Date.now() - 90 * DAY },
    { id: uid(), type: 'physical', code: 'P-002', name: '大疆 RS 3 Pro 稳定器', category: '拍摄设备',
      purchaseDate: '2023-08-02', location: '摄影棚 A · 器材架 B2', owner: '林越',
      status: 'in_use', note: '', createdAt: Date.now() - 80 * DAY },
    { id: uid(), type: 'physical', code: 'P-003', name: 'Apple Studio Display 27"', category: '办公设备',
      purchaseDate: '2024-01-15', location: '剪辑工位 03', owner: '沈澈',
      status: 'in_use', note: '纳米纹理玻璃版', createdAt: Date.now() - 70 * DAY },
    { id: uid(), type: 'physical', code: 'P-004', name: '爱图仕 LS 600d Pro 影视灯', category: '灯光设备',
      purchaseDate: '2023-11-20', location: '摄影棚 B · 灯架区', owner: '周屿',
      status: 'idle', note: '含柔光箱', createdAt: Date.now() - 60 * DAY },
    { id: uid(), type: 'physical', code: 'P-005', name: '群晖 DS923+ NAS 存储', category: 'IT/网络设备',
      purchaseDate: '2023-03-08', location: '机房机柜 U12', owner: '沈澈',
      status: 'in_use', note: '4×8TB 希捷酷狼', createdAt: Date.now() - 55 * DAY },
    { id: uid(), type: 'physical', code: 'P-006', name: 'Herman Miller Aeron 人体工学椅', category: '家具家私',
      purchaseDate: '2022-09-01', location: '主会议室', owner: '行政',
      status: 'repair', note: '扶手松动待修', createdAt: Date.now() - 40 * DAY },

    { id: uid(), type: 'virtual', platform: 'Adobe Creative Cloud', url: 'https://creative.adobe.com',
      account: 'studio@hzs.studio', password: 'Acr0bat!Hzs#2026', contact: '林越 · 138****6621',
      expireDate: '2026-10-18', status: 'in_use', note: '团队版 5 席位', createdAt: Date.now() - 50 * DAY },
    { id: uid(), type: 'virtual', platform: '阿里云控制台', url: 'https://signin.aliyun.com',
      account: 'hzs-studio', password: 'Cl0ud$Ali#92kQ', contact: 'admin@hzs.studio',
      expireDate: '', status: 'in_use', note: '主账号已开启 MFA', createdAt: Date.now() - 45 * DAY },
    { id: uid(), type: 'virtual', platform: 'GitHub Organization', url: 'https://github.com/login',
      account: 'hzs-studio', password: '0ct0cat!Push#77', contact: '沈澈',
      expireDate: '', status: 'in_use', note: '组织名 hzs-workshop', createdAt: Date.now() - 35 * DAY },
    { id: uid(), type: 'virtual', platform: '微信公众平台', url: 'https://mp.weixin.qq.com',
      account: 'HZS 工作室', password: 'WxMp!Hzs2024#', contact: '周屿 · 运营号',
      expireDate: '', status: 'in_use', note: '需管理员扫码二次验证', createdAt: Date.now() - 28 * DAY },
    { id: uid(), type: 'virtual', platform: 'hzs.studio 域名', url: 'https://wanwang.aliyun.com',
      account: 'hzs@hzs.studio', password: 'D0main#Renew@09', contact: '阿里云 · 沈澈',
      expireDate: '2026-10-02', status: 'in_use', note: '开启了自动续费，留意扣款', createdAt: Date.now() - 20 * DAY },
    { id: uid(), type: 'virtual', platform: 'Figma Professional', url: 'https://www.figma.com/login',
      account: 'design@hzs.studio', password: 'F1gma*Design#z9', contact: '设计组共用',
      expireDate: '2027-02-14', status: 'in_use', note: '年度订阅', createdAt: Date.now() - 12 * DAY },
    { id: uid(), type: 'virtual', platform: '旧版 4K 素材库会员', url: 'https://example-stock.com',
      account: 'hzsvip01', password: 'OldStock#2023', contact: '',
      expireDate: '2026-08-30', status: 'expired', note: '已停用，考虑是否续费', createdAt: Date.now() - 8 * DAY },
  ];

  /* ── 状态 ─────────────────────────────────────── */
  const state = {
    items: load(),
    view: 'dashboard',
    keyword: '',
    statusFilter: 'all',
    categoryFilter: 'all',
    sort: 'newest',
    showAllPasswords: false,
    revealed: new Set(),
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const view = $('#view');

  /* ═══════════════ 数据层 ═══════════════ */

  function uid() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.items)) return data.items.map(i => { delete i.price; return i; });
      }
    } catch (e) { /* 损坏则回退到示例数据 */ }
    return SEED.map(x => ({ ...x }));
  }

  function persist() {
    localStorage.setItem(LS_KEY, JSON.stringify({ version: 1, items: state.items }));
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

    if (editing) {
      Object.assign(editing, record);
      toast('已保存修改', 'ok');
    } else {
      state.items.push({ id: uid(), createdAt: Date.now(), ...record });
      toast('资产已登记入库', 'ok');
    }
    persist();
    closeModal();
    renderAll();
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
        const proceed = window.confirm(`将导入 ${valid.length} 条资产并覆盖当前台账，此操作不可撤销。确定继续吗？`);
        if (!proceed) return;
        valid.forEach(i => { if (!i.id) i.id = uid(); if (!i.createdAt) i.createdAt = Date.now(); });
        state.items = valid;
        persist();
        renderAll();
        toast(`成功导入 ${valid.length} 条资产`, 'ok');
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
        persist();
        renderAll();
        toast('资产已删除', 'ok');
      }
      return;
    }

    const addBtn = e.target.closest('[data-add]');
    if (addBtn) { openForm(addBtn.dataset.add); return; }

    // 点击行/卡片 → 编辑；虚拟卡片上排除交互元素
    const opener = e.target.closest('[data-open]');
    if (opener) openForm(null, opener.dataset.open);
  });

  /* ── 启动 ─────────────────────────────────────── */
  persist();           // 首次访问写入示例数据；之后为幂等保存
  renderAll();
})();
