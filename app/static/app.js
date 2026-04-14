/* ===== GmailAi BD — Main App JS ===== */

let currentPage = 1;
const PAGE_SIZE = 50;
let totalAccounts = 0;
let filterTimer = null;
let selectedIds = new Set();
let allTags = [];

/* ===== PAGE NAVIGATION ===== */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');

  document.querySelectorAll(`.nav-item[data-page="${name}"]`).forEach(n => n.classList.add('active'));

  if (name === 'dashboard') loadDashboard();
  if (name === 'database') loadAccounts();
  if (name === 'settings') loadSettings();
  if (name === 'agent') loadChatHistory();

  closeSidebar();
  return false;
}

/* ===== MOBILE SIDEBAR ===== */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

/* ===== TOAST ===== */
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = {
    ok: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    err: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f8ef7" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  t.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('fadeout'); setTimeout(() => t.remove(), 300); }, 3000);
}

/* ===== COPY ===== */
function copyToClipboard(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    if (el) {
      el.classList.add('copy-flash');
      setTimeout(() => el.classList.remove('copy-flash'), 500);
    }
    toast('Скопировано!', 'ok');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Скопировано!', 'ok');
  });
}

/* ===== DASHBOARD ===== */
async function loadDashboard() {
  try {
    const [stats, breakdown, recent] = await Promise.all([
      fetch('/api/dashboard/stats').then(r => r.json()),
      fetch('/api/dashboard/status-breakdown').then(r => r.json()),
      fetch('/api/dashboard/recent?limit=15').then(r => r.json()),
    ]);

    document.getElementById('stat-total').textContent = stats.total_accounts;
    document.getElementById('stat-active').textContent = stats.active_accounts;
    document.getElementById('stat-appeal').textContent = stats.appeal_accounts;
    document.getElementById('stat-sold').textContent = stats.sold_accounts;
    document.getElementById('stat-recent').textContent = stats.recently_added;
    document.getElementById('stat-tags').textContent = stats.unique_tags;
    document.getElementById('nav-total').textContent = stats.total_accounts;

    renderStatusBreakdown(breakdown, stats.total_accounts);
    renderRecentActivity(recent);
  } catch (e) {
    toast('Ошибка загрузки дашборда', 'err');
  }
}

function renderStatusBreakdown(groups, total) {
  const el = document.getElementById('status-breakdown');
  if (!groups.length) {
    el.innerHTML = `<div class="empty-state"><p>Нет данных</p></div>`;
    return;
  }
  const statusNames = { active: 'Активный', sold: 'Продан', appeal: 'Аппеляция', banned: 'Забанен', unknown: 'Неизвестно' };
  el.innerHTML = groups.map(g => {
    const pct = total ? Math.round(g.count / total * 100) : 0;
    return `
      <div class="status-row">
        <div class="status-left">
          <div class="status-dot ${g.status}"></div>
          <span>${statusNames[g.status] || g.status}</span>
        </div>
        <div class="status-bar">
          <div class="status-bar-fill ${g.status}" style="width:${pct}%"></div>
        </div>
        <span class="status-count">${g.count}</span>
      </div>
    `;
  }).join('');
}

function renderRecentActivity(items) {
  const el = document.getElementById('recent-activity');
  if (!items.length) {
    el.innerHTML = `<div class="empty-state"><p>Нет активности</p></div>`;
    return;
  }
  el.innerHTML = items.map(a => `
    <div class="activity-item">
      <div class="activity-dot ${a.type}"></div>
      <div class="activity-text">${escHtml(a.description)}</div>
      <div class="activity-time">${timeAgo(a.created_at)}</div>
    </div>
  `).join('');
}

/* ===== DATABASE TABLE ===== */
async function loadAccounts() {
  const search = document.getElementById('search-input').value.trim();
  const status = document.getElementById('status-filter').value;
  const tag = document.getElementById('tag-filter').value;
  const offset = (currentPage - 1) * PAGE_SIZE;

  const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  if (tag) params.set('tag', tag);

  const tbody = document.getElementById('accounts-tbody');
  tbody.innerHTML = `<tr><td colspan="10" class="loading-row"><div class="spinner"></div></td></tr>`;

  try {
    const data = await fetch(`/api/accounts?${params}`).then(r => r.json());
    totalAccounts = data.total;
    document.getElementById('db-subtitle').textContent = `${totalAccounts} аккаунтов найдено`;
    document.getElementById('nav-total').textContent = totalAccounts;
    renderTable(data.accounts);
    renderPagination(data.total);
    await loadTagsFilter();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="loading-row"><p style="color:var(--accent-red)">Ошибка загрузки</p></td></tr>`;
  }
}

function renderTable(accounts) {
  const tbody = document.getElementById('accounts-tbody');
  if (!accounts.length) {
    tbody.innerHTML = `
      <tr><td colspan="10">
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
          <h3>Нет аккаунтов</h3>
          <p>Используй ИИ Агента или добавь вручную</p>
        </div>
      </td></tr>`;
    return;
  }

  const statusLabels = { active: 'Активный', sold: 'Продан', appeal: 'Аппеляция', banned: 'Забанен', unknown: 'Неизвестно' };

  tbody.innerHTML = accounts.map((a, i) => {
    const num = (currentPage - 1) * PAGE_SIZE + i + 1;
    const tags = Array.isArray(a.tags) ? a.tags : [];
    const checked = selectedIds.has(a.id) ? 'checked' : '';

    return `
    <tr class="${selectedIds.has(a.id) ? 'selected' : ''}" data-id="${a.id}">
      <td class="col-check">
        <label class="checkbox-wrap">
          <input type="checkbox" ${checked} onchange="toggleSelect(${a.id}, this)" />
          <span class="checkbox-custom"></span>
        </label>
      </td>
      <td class="col-num" style="color:var(--text-muted);font-size:12px">${num}</td>
      <td>
        <div class="cell-copyable" onclick="copyToClipboard('${escAttr(a.email)}', this)" title="Скопировать email">
          <span class="cell-mono">${escHtml(a.email)}</span>
          <svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </div>
      </td>
      <td>
        <div class="cell-copyable" onclick="copyToClipboard('${escAttr(a.password)}', this)" title="Скопировать пароль">
          <span class="cell-mono">${escHtml(a.password)}</span>
          <svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </div>
      </td>
      <td>
        <span class="status-badge ${a.status}">${statusLabels[a.status] || a.status}</span>
      </td>
      <td class="hide-mobile">
        ${a.two_factor_code
          ? `<div class="cell-copyable" onclick="copyToClipboard('${escAttr(a.two_factor_code)}', this)" title="Скопировать 2FA">
              <span class="cell-mono" style="font-size:11px">${escHtml(a.two_factor_code)}</span>
              <svg class="copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </div>`
          : '<span style="color:var(--text-muted);font-size:12px">—</span>'
        }
      </td>
      <td class="hide-mobile">
        ${a.recovery_email
          ? `<span class="cell-mono" style="font-size:11px;cursor:default">${escHtml(a.recovery_email)}</span>`
          : '<span style="color:var(--text-muted);font-size:12px">—</span>'
        }
      </td>
      <td class="hide-mobile" style="max-width:160px">
        ${a.notes
          ? `<span style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;max-width:150px" title="${escAttr(a.notes)}">${escHtml(a.notes)}</span>`
          : '<span style="color:var(--text-muted);font-size:12px">—</span>'
        }
      </td>
      <td class="hide-mobile">
        <div class="tags-cell">
          ${tags.map(t => `<span class="tag-chip">${escHtml(t)}</span>`).join('')}
        </div>
      </td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="action-btn" onclick="copyRow(${JSON.stringify(a).replace(/"/g, '&quot;')})" title="Копировать всё">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="action-btn" onclick="openEditModal(${a.id})" title="Редактировать">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn delete" onclick="deleteAccount(${a.id})" title="Удалить">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function copyRow(account) {
  const parts = [account.email, account.password];
  if (account.two_factor_code) parts.push(`2FA: ${account.two_factor_code}`);
  if (account.recovery_email) parts.push(`Рез.почта: ${account.recovery_email}`);
  copyToClipboard(parts.join(' | '));
}

function renderPagination(total) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;
  for (let p = 1; p <= totalPages; p++) {
    if (totalPages > 7 && p !== 1 && p !== totalPages && Math.abs(p - currentPage) > 2) {
      if (p === 2 || p === totalPages - 1) html += `<span class="page-btn" style="cursor:default">…</span>`;
      continue;
    }
    html += `<button class="page-btn ${p===currentPage?'active':''}" onclick="goPage(${p})">${p}</button>`;
  }
  html += `<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===totalPages?'disabled':''}>›</button>`;
  el.innerHTML = html;
}

function goPage(p) {
  if (p < 1) return;
  currentPage = p;
  loadAccounts();
}

async function loadTagsFilter() {
  try {
    const tags = await fetch('/api/tags').then(r => r.json());
    allTags = tags;
    const sel = document.getElementById('tag-filter');
    const current = sel.value;
    sel.innerHTML = '<option value="">Все теги</option>' +
      tags.map(t => `<option value="${escAttr(t)}" ${t===current?'selected':''}>${escHtml(t)}</option>`).join('');
  } catch (e) {}
}

/* ===== FILTERS ===== */
function debounceFilter() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { currentPage = 1; loadAccounts(); }, 350);
}

function applyFilters() { currentPage = 1; loadAccounts(); }

function clearFilters() {
  document.getElementById('search-input').value = '';
  document.getElementById('status-filter').value = '';
  document.getElementById('tag-filter').value = '';
  currentPage = 1;
  loadAccounts();
}

/* ===== SELECTION ===== */
function toggleSelect(id, cb) {
  if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
  updateBulkActions();
  const row = cb.closest('tr');
  if (row) row.classList.toggle('selected', cb.checked);
}

function toggleSelectAll(cb) {
  document.querySelectorAll('#accounts-tbody input[type="checkbox"]').forEach(c => {
    c.checked = cb.checked;
    const id = parseInt(c.closest('tr').dataset.id);
    if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
    c.closest('tr').classList.toggle('selected', cb.checked);
  });
  updateBulkActions();
}

function updateBulkActions() {
  const btn = document.getElementById('bulk-delete-btn');
  const cnt = document.getElementById('bulk-count');
  if (selectedIds.size > 0) {
    btn.style.display = 'flex';
    cnt.textContent = selectedIds.size;
  } else {
    btn.style.display = 'none';
  }
}

async function bulkDelete() {
  if (!selectedIds.size) return;
  if (!confirm(`Удалить ${selectedIds.size} аккаунт(ов)?`)) return;
  try {
    await fetch('/api/accounts/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    selectedIds.clear();
    updateBulkActions();
    toast(`Удалено ${selectedIds.size || 'несколько'} аккаунтов`, 'ok');
    loadAccounts();
  } catch (e) {
    toast('Ошибка удаления', 'err');
  }
}

/* ===== CRUD MODAL ===== */
function openAddModal() {
  document.getElementById('modal-title').textContent = 'Добавить аккаунт';
  document.getElementById('modal-id').value = '';
  document.getElementById('modal-email').value = '';
  document.getElementById('modal-password').value = '';
  document.getElementById('modal-status').value = 'active';
  document.getElementById('modal-2fa').value = '';
  document.getElementById('modal-rec-email').value = '';
  document.getElementById('modal-rec-phone').value = '';
  document.getElementById('modal-notes').value = '';
  document.getElementById('modal-tags').value = '';
  document.getElementById('account-modal').classList.add('open');
}

async function openEditModal(id) {
  try {
    const a = await fetch(`/api/accounts/${id}`).then(r => r.json());
    document.getElementById('modal-title').textContent = 'Редактировать аккаунт';
    document.getElementById('modal-id').value = a.id;
    document.getElementById('modal-email').value = a.email;
    document.getElementById('modal-password').value = a.password;
    document.getElementById('modal-status').value = a.status;
    document.getElementById('modal-2fa').value = a.two_factor_code || '';
    document.getElementById('modal-rec-email').value = a.recovery_email || '';
    document.getElementById('modal-rec-phone').value = a.recovery_phone || '';
    document.getElementById('modal-notes').value = a.notes || '';
    document.getElementById('modal-tags').value = (a.tags || []).join(', ');
    document.getElementById('account-modal').classList.add('open');
  } catch (e) {
    toast('Ошибка загрузки', 'err');
  }
}

async function saveAccount() {
  const id = document.getElementById('modal-id').value;
  const email = document.getElementById('modal-email').value.trim();
  const password = document.getElementById('modal-password').value.trim();

  if (!email || !password) { toast('Email и пароль обязательны', 'err'); return; }

  const tagsRaw = document.getElementById('modal-tags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const body = {
    email,
    password,
    status: document.getElementById('modal-status').value,
    two_factor_code: document.getElementById('modal-2fa').value.trim() || null,
    recovery_email: document.getElementById('modal-rec-email').value.trim() || null,
    recovery_phone: document.getElementById('modal-rec-phone').value.trim() || null,
    notes: document.getElementById('modal-notes').value.trim() || null,
    tags,
  };

  try {
    if (id) {
      await fetch(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast('Аккаунт обновлён', 'ok');
    } else {
      await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast('Аккаунт добавлен', 'ok');
    }
    closeModal();
    loadAccounts();
  } catch (e) {
    toast('Ошибка сохранения', 'err');
  }
}

async function deleteAccount(id) {
  if (!confirm('Удалить этот аккаунт?')) return;
  try {
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    toast('Аккаунт удалён', 'ok');
    loadAccounts();
  } catch (e) {
    toast('Ошибка удаления', 'err');
  }
}

function closeModal() {
  document.getElementById('account-modal').classList.remove('open');
}
function closeModalOnOverlay(e) {
  if (e.target === e.currentTarget) closeModal();
}

/* ===== SETTINGS ===== */
async function loadSettings() {
  try {
    const [s, keyRaw] = await Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/settings/api-key').then(r => r.json()),
    ]);
    document.getElementById('s-endpoint').value = s.api_endpoint || '';
    document.getElementById('s-apikey').value = keyRaw.api_key || '';
    document.getElementById('s-model').value = s.ai_model || '';
    document.getElementById('s-prompt').value = s.system_prompt || '';

    const warn = document.getElementById('nav-key-warn');
    warn.style.display = keyRaw.api_key ? 'none' : 'inline';
  } catch (e) {
    toast('Ошибка загрузки настроек', 'err');
  }
}

async function saveSettings() {
  const body = {
    api_endpoint: document.getElementById('s-endpoint').value.trim(),
    api_key: document.getElementById('s-apikey').value.trim(),
    ai_model: document.getElementById('s-model').value.trim(),
    system_prompt: document.getElementById('s-prompt').value,
  };

  const statusEl = document.getElementById('settings-status');
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    statusEl.textContent = '✓ Сохранено';
    statusEl.className = 'settings-status ok';
    toast('Настройки сохранены', 'ok');
    const warn = document.getElementById('nav-key-warn');
    warn.style.display = body.api_key ? 'none' : 'inline';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  } catch (e) {
    statusEl.textContent = '✕ Ошибка сохранения';
    statusEl.className = 'settings-status err';
    toast('Ошибка сохранения', 'err');
  }
}

function setModel(name) {
  document.getElementById('s-model').value = name;
}

function toggleApiKeyVisibility() {
  const inp = document.getElementById('s-apikey');
  const icon = document.getElementById('eye-icon');
  if (inp.type === 'password') {
    inp.type = 'text';
    icon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;
  } else {
    inp.type = 'password';
    icon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }
}

function resetPrompt() {
  if (confirm('Сбросить системный промпт к стандартному?')) {
    fetch('/api/settings').then(r => r.json()).then(s => {});
    toast('Перезагружаю стандартный промпт...', 'info');
    fetch('/api/settings/reset-prompt', { method: 'POST' })
      .then(r => r.ok ? loadSettings() : null)
      .catch(() => toast('Нет эндпоинта сброса — очисти поле и сохрани', 'info'));
  }
}

/* ===== EXPORT ===== */
async function exportCSV() {
  try {
    const data = await fetch('/api/accounts?limit=9999').then(r => r.json());
    const cols = ['id', 'email', 'password', 'status', 'two_factor_code', 'recovery_email', 'recovery_phone', 'notes', 'tags', 'created_at'];
    const header = cols.join(';');
    const rows = data.accounts.map(a =>
      cols.map(c => {
        let v = a[c];
        if (Array.isArray(v)) v = v.join(', ');
        if (v == null) v = '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(';')
    );
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'gmailai_bd.csv'; a.click();
    URL.revokeObjectURL(url);
    toast('CSV экспортирован', 'ok');
  } catch (e) {
    toast('Ошибка экспорта', 'err');
  }
}

/* ===== UTILS ===== */
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  if (!s) return '';
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff/60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff/3600)}ч назад`;
  return `${Math.floor(diff/86400)}д назад`;
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  showPage('dashboard');
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(filterTimer); currentPage = 1; loadAccounts(); }
  });
});
