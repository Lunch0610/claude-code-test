// ===== IndexedDB (マップ画像) =====
const MAP_DB_NAME = 'doujinshi-map-db';
const MAP_DB_STORE = 'images';
let _mapDB = null;

function openMapDB() {
  if (_mapDB) return Promise.resolve(_mapDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MAP_DB_NAME, 1);
    req.onupgradeneeded = (e) => { e.target.result.createObjectStore(MAP_DB_STORE); };
    req.onsuccess = (e) => { _mapDB = e.target.result; resolve(_mapDB); };
    req.onerror = () => reject(req.error);
  });
}

function saveMapImageToDB(eventId, blob) {
  return openMapDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_DB_STORE, 'readwrite');
    tx.objectStore(MAP_DB_STORE).put(blob, eventId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }));
}

function loadMapImageFromDB(eventId) {
  return openMapDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_DB_STORE, 'readonly');
    const req = tx.objectStore(MAP_DB_STORE).get(eventId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

function deleteMapImageFromDB(eventId) {
  return openMapDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_DB_STORE, 'readwrite');
    tx.objectStore(MAP_DB_STORE).delete(eventId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }));
}

// ===== データ管理 =====
const STORAGE_KEY = 'doujinshi-events';

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveData(events) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

let events = loadData();
let currentEventId = null;
let editingEventId = null;
let currentBudgetType = 'expense';
let pendingConfirm = null;

// ===== ユーティリティ =====
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDate(dateStr) {
  if (!dateStr) return '未設定';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${['日','月','火','水','木','金','土'][d.getDay()]}）`;
}

function getMonthStr(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}月`;
}

function getDayStr(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDate();
}

function getEventStatus(dateStr) {
  if (!dateStr) return 'upcoming';
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr === today) return 'today';
  if (dateStr < today) return 'past';
  return 'upcoming';
}

function getStatusLabel(status) {
  return { upcoming: '開催予定', today: '本日開催', past: '終了' }[status];
}

function formatMoney(n) {
  return '¥' + Number(n || 0).toLocaleString();
}

function getDueClass(dueStr) {
  if (!dueStr) return '';
  const today = new Date().toISOString().slice(0, 10);
  const diff = (new Date(dueStr) - new Date(today)) / 86400000;
  if (diff < 0) return 'overdue';
  if (diff <= 3) return 'soon';
  return '';
}

function getCategoryLabel(cat) {
  const map = {
    manuscript: '原稿', printing: '印刷・製本', preparation: '準備',
    application: '申込', other: 'その他',
    manga: '漫画', novel: '小説', illust: 'イラスト集', goods: 'グッズ',
    fee: '参加費', transport: '交通費', hotel: '宿泊費',
    material: '材料費', sales: '頒布収入'
  };
  return map[cat] || cat;
}

// ===== イベント一覧 =====
function renderEventList() {
  const list = document.getElementById('event-list');
  const empty = document.getElementById('empty-state');

  // 日付でソート（直近順）
  const sorted = [...events].sort((a, b) => {
    const today = new Date().toISOString().slice(0, 10);
    const aFuture = a.date >= today;
    const bFuture = b.date >= today;
    if (aFuture && !bFuture) return -1;
    if (!aFuture && bFuture) return 1;
    if (aFuture) return a.date < b.date ? -1 : 1;
    return a.date > b.date ? -1 : 1;
  });

  if (sorted.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = sorted.map(ev => {
    const status = getEventStatus(ev.date);
    return `
    <div class="event-card" data-id="${ev.id}">
      <div class="event-card-left">
        <div class="event-card-month">${getMonthStr(ev.date)}</div>
        <div class="event-card-day">${getDayStr(ev.date)}</div>
      </div>
      <div class="event-card-info">
        <div class="event-card-name">${escHtml(ev.name)}</div>
        <div class="event-card-meta">
          ${ev.venue ? `<span>&#127970; ${escHtml(ev.venue)}</span>` : ''}
          ${ev.space ? `<span>&#127914; ${escHtml(ev.space)}</span>` : ''}
          <span class="status-badge status-${status}">${getStatusLabel(status)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => openEventDetail(card.dataset.id));
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== イベント詳細 =====
function openEventDetail(id) {
  currentEventId = id;
  const ev = events.find(e => e.id === id);
  if (!ev) return;

  showView('detail');
  document.getElementById('header-title').textContent = ev.name;
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-add-event').classList.add('hidden');

  // タブをリセット
  switchTab('overview');
  renderDetail(ev);
}

function renderDetail(ev) {
  const status = getEventStatus(ev.date);
  const badge = document.getElementById('detail-status-badge');
  badge.textContent = getStatusLabel(status);
  badge.className = `status-badge status-${status}`;

  document.getElementById('detail-name').textContent = ev.name || '';
  document.getElementById('detail-date').textContent = formatDate(ev.date);
  document.getElementById('detail-venue').textContent = ev.venue || '未設定';
  document.getElementById('detail-space').textContent = ev.space || '未設定';
  const from = ev.setupTimeFrom || '';
  const to = ev.setupTimeTo || '';
  document.getElementById('detail-setup-time').textContent =
    from && to ? `${from} 〜 ${to}` : from || to || '未設定';
  document.getElementById('detail-note').textContent = ev.note || 'なし';

  renderSummary(ev);
  renderTasks(ev);
  renderItems(ev);
  renderSchedule(ev);
  renderBudget(ev);
  renderShopping(ev);
  renderMap(ev);
  setupMapControls(ev);
}

function renderSummary(ev) {
  const tasks = ev.tasks || [];
  const done = tasks.filter(t => t.done).length;
  document.getElementById('summary-tasks').textContent = `${done}/${tasks.length}`;

  const items = ev.items || [];
  document.getElementById('summary-items').textContent = items.length;

  const expenses = (ev.expenses || []).reduce((s, e) => s + Number(e.amount), 0);
  const incomes = (ev.incomes || []).reduce((s, i) => s + Number(i.amount), 0);
  const profit = incomes - expenses;
  const profitEl = document.getElementById('summary-profit');
  profitEl.textContent = formatMoney(profit);
  profitEl.style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
}

// ===== タスク =====
function renderTasks(ev) {
  const tasks = ev.tasks || [];
  const list = document.getElementById('task-list');
  const empty = document.getElementById('task-empty');

  if (tasks.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  const sorted = [...tasks].sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  });

  list.innerHTML = sorted.map(t => {
    const dueClass = t.done ? '' : getDueClass(t.due);
    return `
    <div class="task-item ${t.done ? 'completed' : ''}" data-id="${t.id}">
      <div class="task-checkbox ${t.done ? 'checked' : ''}" data-task-id="${t.id}">
        ${t.done ? '&#10003;' : ''}
      </div>
      <div class="task-info">
        <div class="task-name">${escHtml(t.name)}</div>
        <div class="task-meta">
          ${t.due ? `<span class="task-due ${dueClass}">&#128197; ${formatDate(t.due)}</span>` : ''}
          <span class="task-category">${getCategoryLabel(t.category)}</span>
        </div>
      </div>
      <button class="btn-icon danger" data-delete-task="${t.id}">&#128465;</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.task-checkbox').forEach(cb => {
    cb.addEventListener('click', () => toggleTask(cb.dataset.taskId));
  });

  list.querySelectorAll('[data-delete-task]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete('このタスクを削除しますか？', () => deleteTask(btn.dataset.deleteTask));
    });
  });
}

function toggleTask(taskId) {
  const ev = events.find(e => e.id === currentEventId);
  if (!ev) return;
  const task = (ev.tasks || []).find(t => t.id === taskId);
  if (!task) return;
  task.done = !task.done;
  saveData(events);
  renderTasks(ev);
  renderSummary(ev);
}

function deleteTask(taskId) {
  const ev = events.find(e => e.id === currentEventId);
  if (!ev) return;
  ev.tasks = (ev.tasks || []).filter(t => t.id !== taskId);
  saveData(events);
  renderTasks(ev);
  renderSummary(ev);
}

// ===== 頒布物 =====
function renderItems(ev) {
  const items = ev.items || [];
  const list = document.getElementById('item-list');
  const empty = document.getElementById('item-empty');
  const totalEl = document.getElementById('item-total');

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    totalEl.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  totalEl.classList.remove('hidden');

  const totalStock = items.reduce((s, i) => s + Number(i.stock || 0), 0);
  document.getElementById('item-total-count').textContent = totalStock;

  list.innerHTML = items.map(item => {
    const stock = Number(item.stock || 0);
    const sold = Number(item.sold || 0);
    const soldPct = stock > 0 ? Math.min(100, Math.round(sold / stock * 100)) : 0;
    return `
    <div class="item-card" data-id="${item.id}">
      <span class="item-type-badge">${getCategoryLabel(item.type)}</span>
      <div class="item-info">
        <div class="item-name">${escHtml(item.name)}</div>
        <div class="item-stats">
          <span class="item-price">${formatMoney(item.price)}</span>
          <span>持込 ${stock}部</span>
          ${sold > 0 ? `<span>頒布済 ${sold}部 (${soldPct}%)</span>` : ''}
        </div>
        ${stock > 0 ? `
        <div class="item-stock-bar">
          <div class="item-stock-fill" style="width:${soldPct}%"></div>
        </div>` : ''}
      </div>
      <button class="btn-icon danger" data-delete-item="${item.id}">&#128465;</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-delete-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmDelete('この頒布物を削除しますか？', () => deleteItem(btn.dataset.deleteItem));
    });
  });
}

function deleteItem(itemId) {
  const ev = events.find(e => e.id === currentEventId);
  if (!ev) return;
  ev.items = (ev.items || []).filter(i => i.id !== itemId);
  saveData(events);
  renderItems(ev);
  renderSummary(ev);
}

// ===== スケジュール =====
function renderSchedule(ev) {
  const schedules = [...(ev.schedules || [])].sort((a, b) => a.time < b.time ? -1 : 1);
  const list = document.getElementById('schedule-list');
  const empty = document.getElementById('schedule-empty');

  if (schedules.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = schedules.map(s => `
    <div class="schedule-item" data-id="${s.id}">
      <div class="schedule-time">${escHtml(s.time)}</div>
      <div class="schedule-dot"></div>
      <div class="schedule-content">
        <div class="schedule-title">${escHtml(s.title)}</div>
        ${s.note ? `<div class="schedule-note">${escHtml(s.note)}</div>` : ''}
      </div>
      <button class="btn-icon danger" data-delete-sched="${s.id}">&#128465;</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-delete-sched]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmDelete('このスケジュールを削除しますか？', () => deleteSchedule(btn.dataset.deleteSched));
    });
  });
}

function deleteSchedule(schedId) {
  const ev = events.find(e => e.id === currentEventId);
  if (!ev) return;
  ev.schedules = (ev.schedules || []).filter(s => s.id !== schedId);
  saveData(events);
  renderSchedule(ev);
}

// ===== 収支 =====
function renderBudget(ev) {
  const expenses = ev.expenses || [];
  const incomes = ev.incomes || [];

  renderBudgetList('expense-list', 'expense-empty', expenses, 'expense');
  renderBudgetList('income-list', 'income-empty', incomes, 'income');

  const totalExpense = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalIncome = incomes.reduce((s, i) => s + Number(i.amount), 0);
  const profit = totalIncome - totalExpense;

  document.getElementById('total-expense').textContent = formatMoney(totalExpense);
  document.getElementById('total-income').textContent = formatMoney(totalIncome);
  const profitEl = document.getElementById('total-profit');
  profitEl.textContent = formatMoney(profit);
  profitEl.style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
}

function renderBudgetList(listId, emptyId, items, type) {
  const list = document.getElementById(listId);
  const empty = document.getElementById(emptyId);

  if (items.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = items.map(item => `
    <div class="budget-item" data-id="${item.id}">
      <span class="budget-category">${getCategoryLabel(item.category)}</span>
      <span class="budget-name">${escHtml(item.name)}</span>
      <span class="budget-amount ${type}">${formatMoney(item.amount)}</span>
      <button class="btn-icon danger" data-delete-budget="${item.id}" data-budget-type="${type}">&#128465;</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-delete-budget]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmDelete('この項目を削除しますか？', () => deleteBudgetItem(btn.dataset.deleteBudget, btn.dataset.budgetType));
    });
  });
}

function deleteBudgetItem(itemId, type) {
  const ev = events.find(e => e.id === currentEventId);
  if (!ev) return;
  const key = type === 'income' ? 'incomes' : 'expenses';
  ev[key] = (ev[key] || []).filter(i => i.id !== itemId);
  saveData(events);
  renderBudget(ev);
  renderSummary(ev);
}

// ===== ビュー切替 =====
function showView(name) {
  document.getElementById('view-list').classList.toggle('hidden', name !== 'list');
  document.getElementById('view-detail').classList.toggle('hidden', name !== 'detail');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === `tab-${tabName}`);
  });
  // マップタブ表示時にスケールを再計算（非表示時は clientWidth=0 のため）
  if (tabName === 'map') {
    const img = document.getElementById('map-image');
    const viewport = document.getElementById('map-viewport');
    if (img && img.naturalWidth && viewport.clientWidth) {
      mapScale = Math.min(
        viewport.clientWidth / img.naturalWidth,
        viewport.clientHeight / img.naturalHeight
      );
      mapPanX = 0; mapPanY = 0;
      applyMapTransform();
    }
  }
}

// ===== モーダル =====
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function clearForm(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
}

// ===== 確認ダイアログ =====
function confirmDelete(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  pendingConfirm = onConfirm;
  openModal('modal-confirm');
}

// ===== イベント保存 =====
function saveEvent() {
  const name = document.getElementById('input-event-name').value.trim();
  const date = document.getElementById('input-event-date').value;
  if (!name || !date) {
    alert('イベント名と開催日は必須です');
    return;
  }

  if (editingEventId) {
    const ev = events.find(e => e.id === editingEventId);
    if (ev) {
      ev.name = name;
      ev.date = date;
      ev.venue = document.getElementById('input-event-venue').value.trim();
      ev.space = document.getElementById('input-event-space').value.trim();
      ev.setupTimeFrom = document.getElementById('input-event-setup-from').value;
      ev.setupTimeTo = document.getElementById('input-event-setup-to').value;
      ev.note = document.getElementById('input-event-note').value.trim();
    }
  } else {
    events.push({
      id: genId(),
      name,
      date,
      venue: document.getElementById('input-event-venue').value.trim(),
      space: document.getElementById('input-event-space').value.trim(),
      setupTimeFrom: document.getElementById('input-event-setup-from').value,
      setupTimeTo: document.getElementById('input-event-setup-to').value,
      note: document.getElementById('input-event-note').value.trim(),
      tasks: [],
      items: [],
      schedules: [],
      expenses: [],
      incomes: []
    });
  }

  saveData(events);
  closeModal('modal-event');
  editingEventId = null;

  if (currentEventId) {
    const ev = events.find(e => e.id === currentEventId);
    if (ev) {
      document.getElementById('header-title').textContent = ev.name;
      renderDetail(ev);
    }
  } else {
    renderEventList();
  }
}

// ===== イベントのデフォルトタスク =====
function addDefaultTasks(ev) {
  const defaults = [
    { name: '申込み完了確認', category: 'application', daysOffset: 60 },
    { name: '原稿完成', category: 'manuscript', daysOffset: 14 },
    { name: '入稿', category: 'printing', daysOffset: 10 },
    { name: '製本・受取確認', category: 'printing', daysOffset: 3 },
    { name: '持込品リスト作成', category: 'preparation', daysOffset: 2 },
    { name: 'お釣り準備', category: 'preparation', daysOffset: 1 },
  ];

  const eventDate = new Date(ev.date + 'T00:00:00');
  ev.tasks = defaults.map(d => {
    const due = new Date(eventDate);
    due.setDate(due.getDate() - d.daysOffset);
    return {
      id: genId(),
      name: d.name,
      category: d.category,
      due: due.toISOString().slice(0, 10),
      done: false
    };
  });
}

// ===== イベント削除 =====
function deleteCurrentEvent() {
  events = events.filter(e => e.id !== currentEventId);
  saveData(events);
  goBack();
}

function goBack() {
  currentEventId = null;
  showView('list');
  document.getElementById('header-title').textContent = '同人イベントスケジューラー';
  document.getElementById('btn-back').classList.add('hidden');
  document.getElementById('btn-add-event').classList.remove('hidden');
  renderEventList();
}

// ===== イベントリスナー =====
document.addEventListener('DOMContentLoaded', () => {
  renderEventList();

  // 戻るボタン
  document.getElementById('btn-back').addEventListener('click', goBack);

  // イベント追加ボタン
  document.getElementById('btn-add-event').addEventListener('click', () => {
    editingEventId = null;
    document.getElementById('modal-event-title').textContent = 'イベント追加';
    clearForm('input-event-name', 'input-event-date', 'input-event-venue', 'input-event-space', 'input-event-setup-from', 'input-event-setup-to', 'input-event-note');
    openModal('modal-event');
  });

  // イベント編集
  document.getElementById('btn-edit-event').addEventListener('click', () => {
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    editingEventId = ev.id;
    document.getElementById('modal-event-title').textContent = 'イベント編集';
    document.getElementById('input-event-name').value = ev.name || '';
    document.getElementById('input-event-date').value = ev.date || '';
    document.getElementById('input-event-venue').value = ev.venue || '';
    document.getElementById('input-event-space').value = ev.space || '';
    document.getElementById('input-event-setup-from').value = ev.setupTimeFrom || '';
    document.getElementById('input-event-setup-to').value = ev.setupTimeTo || '';
    document.getElementById('input-event-note').value = ev.note || '';
    openModal('modal-event');
  });

  // イベント削除
  document.getElementById('btn-delete-event').addEventListener('click', () => {
    confirmDelete('このイベントを削除しますか？すべてのデータが失われます。', deleteCurrentEvent);
  });

  // イベント保存
  document.getElementById('btn-save-event').addEventListener('click', saveEvent);

  // タブ切替
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // モーダルを閉じる
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal;
      if (modalId) closeModal(modalId);
    });
  });

  // オーバーレイクリックで閉じる
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // ===== タスク =====
  document.getElementById('btn-add-task').addEventListener('click', () => {
    clearForm('input-task-name', 'input-task-due', 'input-task-category');
    openModal('modal-task');
  });

  document.getElementById('btn-save-task').addEventListener('click', () => {
    const name = document.getElementById('input-task-name').value.trim();
    if (!name) { alert('タスク名を入力してください'); return; }
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    if (!ev.tasks) ev.tasks = [];
    ev.tasks.push({
      id: genId(),
      name,
      due: document.getElementById('input-task-due').value,
      category: document.getElementById('input-task-category').value,
      done: false
    });
    saveData(events);
    closeModal('modal-task');
    renderTasks(ev);
    renderSummary(ev);
  });

  // ===== 頒布物 =====
  document.getElementById('btn-add-item').addEventListener('click', () => {
    clearForm('input-item-name', 'input-item-type', 'input-item-price', 'input-item-stock', 'input-item-sold');
    openModal('modal-item');
  });

  document.getElementById('btn-save-item').addEventListener('click', () => {
    const name = document.getElementById('input-item-name').value.trim();
    if (!name) { alert('タイトルを入力してください'); return; }
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    if (!ev.items) ev.items = [];
    ev.items.push({
      id: genId(),
      name,
      type: document.getElementById('input-item-type').value,
      price: document.getElementById('input-item-price').value,
      stock: document.getElementById('input-item-stock').value,
      sold: document.getElementById('input-item-sold').value || 0
    });
    saveData(events);
    closeModal('modal-item');
    renderItems(ev);
    renderSummary(ev);
  });

  // ===== スケジュール =====
  document.getElementById('btn-add-schedule').addEventListener('click', () => {
    clearForm('input-sched-time', 'input-sched-title', 'input-sched-note');
    openModal('modal-schedule');
  });

  document.getElementById('btn-save-schedule').addEventListener('click', () => {
    const time = document.getElementById('input-sched-time').value;
    const title = document.getElementById('input-sched-title').value.trim();
    if (!time || !title) { alert('時刻と内容を入力してください'); return; }
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    if (!ev.schedules) ev.schedules = [];
    ev.schedules.push({
      id: genId(),
      time,
      title,
      note: document.getElementById('input-sched-note').value.trim()
    });
    saveData(events);
    closeModal('modal-schedule');
    renderSchedule(ev);
  });

  // ===== 収支 =====
  document.getElementById('btn-add-expense').addEventListener('click', () => {
    currentBudgetType = 'expense';
    document.getElementById('modal-budget-title').textContent = '支出追加';
    clearForm('input-budget-name', 'input-budget-amount', 'input-budget-category');
    openModal('modal-budget');
  });

  document.getElementById('btn-add-income').addEventListener('click', () => {
    currentBudgetType = 'income';
    document.getElementById('modal-budget-title').textContent = '収入追加';
    clearForm('input-budget-name', 'input-budget-amount', 'input-budget-category');
    openModal('modal-budget');
  });

  document.getElementById('btn-save-budget').addEventListener('click', () => {
    const name = document.getElementById('input-budget-name').value.trim();
    const amount = document.getElementById('input-budget-amount').value;
    if (!name || !amount) { alert('項目名と金額を入力してください'); return; }
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    const key = currentBudgetType === 'income' ? 'incomes' : 'expenses';
    if (!ev[key]) ev[key] = [];
    ev[key].push({
      id: genId(),
      name,
      amount: Number(amount),
      category: document.getElementById('input-budget-category').value
    });
    saveData(events);
    closeModal('modal-budget');
    renderBudget(ev);
    renderSummary(ev);
  });

  // ===== 確認ダイアログ =====
  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    if (pendingConfirm) {
      pendingConfirm();
      pendingConfirm = null;
    }
    closeModal('modal-confirm');
  });

  document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
    pendingConfirm = null;
    closeModal('modal-confirm');
  });

  // ===== サンプルデータ（初回のみ） =====
  if (events.length === 0) {
    const sampleDate = new Date();
    sampleDate.setDate(sampleDate.getDate() + 30);
    const dateStr = sampleDate.toISOString().slice(0, 10);

    const sample = {
      id: genId(),
      name: 'サンプルイベント',
      date: dateStr,
      venue: '東京ビッグサイト',
      space: '東L-01a',
      setupTimeFrom: '10:00',
      setupTimeTo: '11:30',
      note: 'はじめてのイベント参加！',
      tasks: [],
      items: [
        { id: genId(), name: '新刊A「星屑のソナタ」', type: 'manga', price: 700, stock: 50, sold: 0 },
        { id: genId(), name: '既刊B「月光のワルツ」', type: 'manga', price: 500, stock: 30, sold: 0 }
      ],
      schedules: [
        { id: genId(), time: '09:00', title: '搬入・設営開始', note: '台車を借りること' },
        { id: genId(), time: '10:00', title: '開場', note: '' },
        { id: genId(), time: '16:00', title: '閉場・撤収', note: '' },
        { id: genId(), time: '17:30', title: '完全撤収', note: '' }
      ],
      expenses: [
        { id: genId(), name: '印刷費（新刊A）', amount: 25000, category: 'printing' },
        { id: genId(), name: '参加費', amount: 8000, category: 'fee' },
        { id: genId(), name: '交通費', amount: 3000, category: 'transport' }
      ],
      incomes: []
    };
    addDefaultTasks(sample);
    events.push(sample);
    saveData(events);
    renderEventList();
  }

  // ===== 買い物リスト =====
  document.getElementById('btn-import-circles').addEventListener('click', () => {
    document.getElementById('input-import-text').value = '';
    document.getElementById('import-preview').classList.add('hidden');
    openModal('modal-import');
  });

  // ===== 欲しいものモーダル =====
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentWishRelease = btn.dataset.release;
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  document.getElementById('btn-save-wish').addEventListener('click', () => {
    const title = document.getElementById('input-wish-title').value.trim();
    if (!title) { alert('タイトルを入力してください'); return; }
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    const c = (ev.circles || []).find(c => c.id === currentWishCircleId);
    if (!c) return;
    if (!c.wishItems) c.wishItems = [];
    c.wishItems.push({
      id: genId(),
      release: currentWishRelease,
      title,
      type: document.getElementById('input-wish-type').value,
      price: document.getElementById('input-wish-price').value,
      qty: Math.max(1, parseInt(document.getElementById('input-wish-qty').value) || 1),
      memo: document.getElementById('input-wish-memo').value.trim(),
      bought: false
    });
    c.priority = true;
    saveData(events);
    closeModal('modal-wish');
    renderShopping(ev);
  });

  // 個数±ボタン
  document.getElementById('qty-minus').addEventListener('click', () => {
    const el = document.getElementById('input-wish-qty');
    el.value = Math.max(1, (parseInt(el.value) || 1) - 1);
  });
  document.getElementById('qty-plus').addEventListener('click', () => {
    const el = document.getElementById('input-wish-qty');
    el.value = (parseInt(el.value) || 1) + 1;
  });

  // テキスト出力
  document.getElementById('btn-share-circles').addEventListener('click', () => {
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    document.getElementById('share-text-output').value = generateShareText(ev);
    openModal('modal-share');
  });

  document.getElementById('btn-copy-share').addEventListener('click', () => {
    const ta = document.getElementById('share-text-output');
    navigator.clipboard.writeText(ta.value).then(() => {
      const btn = document.getElementById('btn-copy-share');
      btn.textContent = '✓ コピーしました';
      setTimeout(() => { btn.textContent = '📋 コピー'; }, 2000);
    }).catch(() => {
      ta.select();
      document.execCommand('copy');
    });
  });

  document.getElementById('input-import-text').addEventListener('input', () => {
    const text = document.getElementById('input-import-text').value;
    const circles = parseCircleList(text);
    const preview = document.getElementById('import-preview');
    if (circles.length > 0) {
      preview.classList.remove('hidden');
      preview.textContent = `${circles.length}サークルを検出しました`;
    } else {
      preview.classList.add('hidden');
    }
  });

  document.getElementById('btn-do-import').addEventListener('click', () => {
    const text = document.getElementById('input-import-text').value;
    const circles = parseCircleList(text);
    if (circles.length === 0) { alert('サークルを検出できませんでした'); return; }
    const ev = events.find(e => e.id === currentEventId);
    if (!ev) return;
    if (!ev.circles) ev.circles = [];
    // 既存スペース番号と重複しないものだけ追加
    const existingSpaces = new Set(ev.circles.map(c => c.space));
    const newCircles = circles.filter(c => !existingSpaces.has(c.space));
    ev.circles.push(...newCircles);
    saveData(events);
    closeModal('modal-import');
    renderShopping(ev);
  });
});

// ===== サークルリストのパース =====
function parseCircleList(text) {
  const lines = text.split('\n').map(l => l.trim());
  const circles = [];
  // 全角セクションヘッダー (Ａ, Ｂ, ... or 英字1文字)
  const sectionRe = /^[A-ZＡ-Ｚ]$/;
  // スペース番号パターン: A-01, A01, など
  const spaceRe = /^([A-Za-zＡ-Ｚａ-ｚ][0-9０-９]{1,2}-[0-9０-９]{2,3}|[A-Za-zＡ-Ｚａ-ｚ]-[0-9０-９]{2,3})/;

  let i = 0;
  // ヘッダー行をスキップ
  while (i < lines.length && !spaceRe.test(lines[i])) i++;

  while (i < lines.length) {
    const line = lines[i];
    if (!line || sectionRe.test(line)) { i++; continue; }

    const match = line.match(/^([A-Za-zＡ-Ｚａ-ｚ][0-9０-９\-]+)\t(.+?)\t(.+?)(?:\t.*)?$/);
    if (match) {
      const space = match[1].replace(/[Ａ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
                            .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      const name = match[2].trim();
      const rep = match[3].trim();
      // 次の3行 = web, pixiv, tw
      const web = i+1 < lines.length ? lines[i+1] : '';
      const pixiv = i+2 < lines.length ? lines[i+2] : '';
      const tw = i+3 < lines.length ? lines[i+3] : '';

      circles.push({
        id: genId(),
        space,
        section: space.charAt(0).toUpperCase(),
        name,
        rep,
        web: web && web !== '#' ? web : null,
        pixiv: pixiv && pixiv !== '#' ? pixiv : null,
        twitter: tw && tw !== '#' ? tw : null,
        visited: false,
        priority: false,
        memo: ''
      });
      i += 4;
    } else {
      i++;
    }
  }
  return circles;
}

// ===== 買い物リスト描画 =====
function renderShopping(ev) {
  const circles = ev.circles || [];
  const list = document.getElementById('circle-list');
  const empty = document.getElementById('circle-empty');
  const filterEl = document.getElementById('shopping-filter');
  const statsEl = document.getElementById('shopping-stats');

  if (circles.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    filterEl.classList.add('hidden');
    statsEl.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  filterEl.classList.remove('hidden');
  statsEl.classList.remove('hidden');

  // セクション一覧
  const sections = [...new Set(circles.map(c => c.section))].sort();
  const activeFilter = filterEl.dataset.active || 'all';

  // フィルターボタン生成
  filterEl.innerHTML = `<button class="filter-btn ${activeFilter === 'all' ? 'active' : ''}" data-section="all">全て</button>` +
    sections.map(s => `<button class="filter-btn ${activeFilter === s ? 'active' : ''}" data-section="${s}">${s}</button>`).join('');

  filterEl.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterEl.dataset.active = btn.dataset.section;
      renderShopping(ev);
    });
  });

  // 統計
  const filtered = activeFilter === 'all' ? circles : circles.filter(c => c.section === activeFilter);
  const visited = filtered.filter(c => c.visited).length;
  const priority = filtered.filter(c => c.priority).length;
  const grandTotal = filtered.reduce((s, c) =>
    s + (c.wishItems || []).reduce((cs, w) => cs + (Number(w.price) || 0) * (Number(w.qty) || 1), 0), 0);
  statsEl.textContent = `${visited}/${filtered.length}チェック済み　★優先: ${priority}${grandTotal > 0 ? `　合計: ¥${grandTotal.toLocaleString()}` : ''}`;

  // リスト描画（優先を上に、チェック済みを下に）
  const sorted = [...filtered].sort((a, b) => {
    if (a.visited !== b.visited) return a.visited ? 1 : -1;
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return a.space.localeCompare(b.space);
  });

  // セクション区切り
  let currentSection = null;
  list.innerHTML = sorted.map(c => {
    let sectionHdr = '';
    if (activeFilter === 'all' && c.section !== currentSection) {
      currentSection = c.section;
      sectionHdr = `<div class="circle-section-header">ブロック ${c.section}</div>`;
    }
    const links = [
      c.twitter ? `<a class="circle-link" href="${escHtml(c.twitter)}" target="_blank">&#120143; Twitter/X</a>` : '',
      c.pixiv ? `<a class="circle-link" href="${escHtml(c.pixiv)}" target="_blank">&#127912; pixiv</a>` : '',
      c.web ? `<a class="circle-link" href="${escHtml(c.web)}" target="_blank">&#127760; web</a>` : ''
    ].filter(Boolean).join('');

    return `${sectionHdr}<div class="circle-item ${c.visited ? 'visited' : ''} ${c.priority ? 'priority-high' : ''}" data-id="${c.id}">
      <div class="circle-check ${c.visited ? 'checked' : ''}" data-circle-id="${c.id}">
        ${c.visited ? '&#10003;' : ''}
      </div>
      <div class="circle-info">
        <div class="circle-header">
          <span class="circle-space">${escHtml(c.space)}</span>
          <span class="circle-name">${escHtml(c.name)}</span>
        </div>
        <div class="circle-rep">${escHtml(c.rep)}</div>
        ${links ? `<div class="circle-links">${links}</div>` : ''}
        ${renderWishItems(c)}
        <button class="btn-add-wish" data-add-wish="${c.id}">＋ 欲しいものを追加</button>
      </div>
      <div class="circle-actions">
        <button class="btn-star ${c.priority ? 'active' : ''}" data-star-id="${c.id}" title="優先">&#9733;</button>
        <button class="btn-icon danger" data-delete-circle="${c.id}" style="font-size:12px">&#128465;</button>
      </div>
    </div>`;
  }).join('');

  // チェック
  list.querySelectorAll('.circle-check').forEach(el => {
    el.addEventListener('click', () => toggleCircleVisited(ev, el.dataset.circleId));
  });
  // 優先星
  list.querySelectorAll('.btn-star').forEach(el => {
    el.addEventListener('click', () => toggleCirclePriority(ev, el.dataset.starId));
  });
  // 削除
  list.querySelectorAll('[data-delete-circle]').forEach(el => {
    el.addEventListener('click', () => {
      confirmDelete('このサークルをリストから削除しますか？', () => {
        ev.circles = ev.circles.filter(c => c.id !== el.dataset.deleteCircle);
        saveData(events);
        renderShopping(ev);
      });
    });
  });
  // 欲しいもの追加
  list.querySelectorAll('[data-add-wish]').forEach(el => {
    el.addEventListener('click', () => openWishModal(ev, el.dataset.addWish));
  });
  // 欲しいもの購入チェック
  list.querySelectorAll('[data-wish-check]').forEach(el => {
    el.addEventListener('click', () => {
      const c = (ev.circles || []).find(c => (c.wishItems || []).some(w => w.id === el.dataset.wishCheck));
      if (!c) return;
      const w = c.wishItems.find(w => w.id === el.dataset.wishCheck);
      if (w) { w.bought = !w.bought; saveData(events); renderShopping(ev); }
    });
  });
  // 欲しいもの削除
  list.querySelectorAll('[data-delete-wish]').forEach(el => {
    el.addEventListener('click', () => {
      const c = (ev.circles || []).find(c => (c.wishItems || []).some(w => w.id === el.dataset.deleteWish));
      if (!c) return;
      c.wishItems = c.wishItems.filter(w => w.id !== el.dataset.deleteWish);
      saveData(events);
      renderShopping(ev);
    });
  });
}

function generateShareText(ev) {
  const circles = (ev.circles || []).filter(c => (c.wishItems || []).length > 0);
  if (circles.length === 0) return '欲しいものが登録されていません';

  const priorityFirst = [...circles].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return a.space.localeCompare(b.space);
  });

  let grandTotal = 0;
  const lines = [];
  lines.push(`📋 ${ev.name} 買い物リスト`);
  lines.push(`📅 ${formatDate(ev.date)}`);
  lines.push('');

  priorityFirst.forEach(c => {
    const items = c.wishItems || [];
    const circleTotal = items.reduce((s, w) => s + (Number(w.price) || 0) * (Number(w.qty) || 1), 0);
    grandTotal += circleTotal;
    lines.push(`${c.priority ? '⭐' : '　'}【${c.space}】${c.name}`);
    items.forEach(w => {
      const qty = Number(w.qty) || 1;
      const price = Number(w.price) || 0;
      let line = `　  ${w.release}「${w.title}」(${w.type})`;
      if (price) line += ` ¥${price.toLocaleString()}`;
      if (qty > 1) line += ` ×${qty}`;
      if (price && qty > 1) line += ` =¥${(price * qty).toLocaleString()}`;
      if (w.memo) line += ` ※${w.memo}`;
      lines.push(line);
    });
    if (circleTotal > 0) lines.push(`　  小計: ¥${circleTotal.toLocaleString()}`);
    lines.push('');
  });

  lines.push(`💰 合計: ¥${grandTotal.toLocaleString()}`);
  return lines.join('\n');
}

function toggleCircleVisited(ev, id) {
  const c = (ev.circles || []).find(c => c.id === id);
  if (!c) return;
  c.visited = !c.visited;
  saveData(events);
  renderShopping(ev);
}

function toggleCirclePriority(ev, id) {
  const c = (ev.circles || []).find(c => c.id === id);
  if (!c) return;
  c.priority = !c.priority;
  saveData(events);
  renderShopping(ev);
}

// ===== 欲しいもの =====
let currentWishCircleId = null;
let currentWishRelease = '新刊';

function openWishModal(ev, circleId) {
  const c = (ev.circles || []).find(c => c.id === circleId);
  if (!c) return;
  currentWishCircleId = circleId;
  currentWishRelease = '新刊';
  document.getElementById('modal-wish-circle-name').textContent = c.name;
  document.getElementById('input-wish-title').value = '';
  document.getElementById('input-wish-price').value = '';
  document.getElementById('input-wish-memo').value = '';
  document.getElementById('input-wish-type').selectedIndex = 0;
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.release === '新刊');
  });
  openModal('modal-wish');
}

function renderWishItems(c) {
  const items = c.wishItems || [];
  if (items.length === 0) return '';
  const circleTotal = items.reduce((s, w) => s + (Number(w.price) || 0) * (Number(w.qty) || 1), 0);
  return `<div class="wish-list">${items.map(w => {
    const qty = Number(w.qty) || 1;
    const subtotal = (Number(w.price) || 0) * qty;
    return `
    <div class="wish-item ${w.bought ? 'wish-bought' : ''}" data-wish-id="${w.id}">
      <div class="wish-check ${w.bought ? 'checked' : ''}" data-wish-check="${w.id}">
        ${w.bought ? '&#10003;' : ''}
      </div>
      <span class="wish-release ${w.release === '新刊' ? 'new' : 'existing'}">${escHtml(w.release)}</span>
      <span class="wish-type">${escHtml(w.type)}</span>
      <span class="wish-title">${escHtml(w.title)}</span>
      ${w.price ? `<span class="wish-price">¥${Number(w.price).toLocaleString()}</span>` : ''}
      ${qty > 1 ? `<span class="wish-qty">×${qty}</span>` : ''}
      ${w.price && qty > 1 ? `<span class="wish-subtotal">=¥${subtotal.toLocaleString()}</span>` : ''}
      ${w.memo ? `<span class="wish-memo-text">${escHtml(w.memo)}</span>` : ''}
      <button class="btn-icon danger" data-delete-wish="${w.id}" style="font-size:11px;padding:2px 4px">&#10005;</button>
    </div>`;
  }).join('')}
  ${circleTotal > 0 ? `<div class="circle-total">小計 ¥${circleTotal.toLocaleString()}</div>` : ''}
  </div>`;
}

// ===== マップ機能 =====
let mapScale = 1, mapPanX = 0, mapPanY = 0;
let mapTouchStartX = 0, mapTouchStartY = 0, mapTouchStartTime = 0;
let mapLastPanX = 0, mapLastPanY = 0, mapLastDist = 0;
let mapPinMode = false;
let pendingPinX = 0, pendingPinY = 0;
let viewingPinId = null;
let mapInitialized = false;

function renderMap(ev) {
  const uploadArea = document.getElementById('map-upload-area');
  const containerCard = document.getElementById('map-container-card');

  // Migrate old base64 format to IndexedDB
  if (ev.mapImage && !ev.hasMapImage) {
    setUploadState('loading');
    const base64 = ev.mapImage;
    const tmpImg = new Image();
    tmpImg.onload = () => {
      const c = document.createElement('canvas');
      c.width = tmpImg.width; c.height = tmpImg.height;
      c.getContext('2d').drawImage(tmpImg, 0, 0);
      c.toBlob((blob) => {
        if (!blob) { setUploadState('error', '移行に失敗しました'); return; }
        saveMapImageToDB(ev.id, blob).then(() => {
          ev.hasMapImage = true;
          delete ev.mapImage;
          saveData(events);
          renderMap(ev);
        }).catch(() => setUploadState('error', '移行に失敗しました'));
      }, 'image/png');
    };
    tmpImg.src = base64;
    return;
  }

  if (ev.hasMapImage) {
    uploadArea.classList.add('hidden');
    containerCard.classList.remove('hidden');
    if (!mapInitialized) initMapInteraction(ev);

    loadMapImageFromDB(ev.id).then(blob => {
      if (!blob) return;
      const img = document.getElementById('map-image');
      if (img._objectURL) URL.revokeObjectURL(img._objectURL);
      const url = URL.createObjectURL(blob);
      img._objectURL = url;
      img.onload = () => {
        document.getElementById('map-inner').style.width = img.naturalWidth + 'px';
        document.getElementById('map-inner').style.height = img.naturalHeight + 'px';
        mapScale = Math.min(
          document.getElementById('map-viewport').clientWidth / img.naturalWidth,
          document.getElementById('map-viewport').clientHeight / img.naturalHeight
        );
        mapPanX = 0; mapPanY = 0;
        applyMapTransform();
        renderMapMarkers(ev);
      };
      img.src = url;
    });
  } else {
    uploadArea.classList.remove('hidden');
    setUploadState('');
    containerCard.classList.add('hidden');
  }
}

function setUploadState(state, message) {
  const area = document.getElementById('map-upload-area');
  if (!area) return;
  area.dataset.uploadState = state;
  if (message) {
    const msgEl = area.querySelector('.upload-error-msg');
    if (msgEl) msgEl.textContent = message;
  }
}

function applyMapTransform() {
  document.getElementById('map-inner').style.transform =
    `translate(${mapPanX}px, ${mapPanY}px) scale(${mapScale})`;
}

function renderMapMarkers(ev) {
  const markersEl = document.getElementById('map-markers');
  const pins = ev.mapPins || [];
  const circles = ev.circles || [];

  markersEl.innerHTML = pins.map(pin => {
    const c = circles.find(c => c.id === pin.circleId);
    if (!c) return '';
    const hasWish = (c.wishItems || []).length > 0;
    const cls = c.visited ? 'visited' : hasWish ? 'wish' : 'plain';
    const icon = c.visited ? '✓' : hasWish ? '★' : '●';
    return `<div class="map-pin ${cls}" style="left:${pin.x}%;top:${pin.y}%" data-pin-id="${pin.id}">
      <div class="map-pin-dot"><span>${icon}</span></div>
      <div class="map-pin-label">${escHtml(c.space)}</div>
    </div>`;
  }).join('');

  markersEl.querySelectorAll('.map-pin').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mapPinMode) return;
      showPinInfo(ev, el.dataset.pinId);
    });
  });
}

function initMapInteraction(ev) {
  mapInitialized = true;
  const viewport = document.getElementById('map-viewport');

  // タッチをIDで追跡
  const activeTouches = new Map();

  // パン状態
  let panStartX = 0, panStartY = 0, panStartTime = 0;
  let panOriginX = 0, panOriginY = 0;

  // ピンチ状態（ジェスチャー開始時に固定）
  let pinchStartDist = 0, pinchStartScale = 0;
  let pinchOriginPanX = 0, pinchOriginPanY = 0;
  let pinchMidX = 0, pinchMidY = 0;

  // ピンチ後の誤タップ防止
  let wasPinching = false;

  function getTouches() {
    return Array.from(activeTouches.values());
  }

  viewport.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    const list = getTouches();

    if (list.length === 1) {
      panStartX = list[0].x;
      panStartY = list[0].y;
      panStartTime = Date.now();
      panOriginX = mapPanX;
      panOriginY = mapPanY;
      wasPinching = false;
    } else if (list.length === 2) {
      // ピンチ開始 — 開始時の状態を固定して以降はそこからの比率で計算
      pinchStartDist = Math.hypot(list[1].x - list[0].x, list[1].y - list[0].y);
      pinchStartScale = mapScale;
      pinchOriginPanX = mapPanX;
      pinchOriginPanY = mapPanY;
      const rect = viewport.getBoundingClientRect();
      pinchMidX = (list[0].x + list[1].x) / 2 - rect.left;
      pinchMidY = (list[0].y + list[1].y) / 2 - rect.top;
      wasPinching = true;
    }
  }, { passive: false });

  viewport.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    const list = getTouches();

    if (list.length === 1 && !wasPinching) {
      mapPanX = panOriginX + (list[0].x - panStartX);
      mapPanY = panOriginY + (list[0].y - panStartY);
      applyMapTransform();
    } else if (list.length === 2) {
      const dist = Math.hypot(list[1].x - list[0].x, list[1].y - list[0].y);
      if (pinchStartDist > 0) {
        // 開始時の距離との比率でスケールを計算（誤差蓄積なし）
        const newScale = Math.min(10, Math.max(0.2, pinchStartScale * (dist / pinchStartDist)));
        const scaleRatio = newScale / pinchStartScale;
        mapScale = newScale;
        mapPanX = pinchMidX - (pinchMidX - pinchOriginPanX) * scaleRatio;
        mapPanY = pinchMidY - (pinchMidY - pinchOriginPanY) * scaleRatio;
        applyMapTransform();
      }
    }
  }, { passive: false });

  viewport.addEventListener('touchend', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];

    // 全指離した時にタップ判定
    if (e.touches.length === 0 && !wasPinching) {
      const dx = Math.abs(touch.clientX - panStartX);
      const dy = Math.abs(touch.clientY - panStartY);
      const dt = Date.now() - panStartTime;
      if (dx < 20 && dy < 20 && dt < 400) {
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const pinEl = target && target.closest('.map-pin');
        if (pinEl && !mapPinMode) {
          showPinInfo(ev, pinEl.dataset.pinId);
        } else if (!pinEl && mapPinMode) {
          const rect = document.getElementById('map-inner').getBoundingClientRect();
          const x = ((touch.clientX - rect.left) / rect.width) * 100;
          const y = ((touch.clientY - rect.top) / rect.height) * 100;
          if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
            pendingPinX = x; pendingPinY = y;
            openPinSelectModal(ev);
          }
        }
      }
    }

    for (const t of e.changedTouches) activeTouches.delete(t.identifier);

    // 2本指 → 1本指になったときパン基準をリセット（ジャンプ防止）
    if (e.touches.length === 1) {
      const remaining = e.touches[0];
      panStartX = remaining.clientX;
      panStartY = remaining.clientY;
      panStartTime = Date.now();
      panOriginX = mapPanX;
      panOriginY = mapPanY;
      wasPinching = false;
    } else if (e.touches.length === 0) {
      wasPinching = false;
    }
  }, { passive: false });

  // PCマウス対応
  let mouseDown = false, mouseStartX = 0, mouseStartY = 0;
  let mouseOriginX = 0, mouseOriginY = 0, mouseMoved = false;
  viewport.addEventListener('mousedown', (e) => {
    mouseDown = true;
    mouseStartX = e.clientX; mouseStartY = e.clientY;
    mouseOriginX = mapPanX; mouseOriginY = mapPanY;
    mouseMoved = false;
  });
  viewport.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    const dx = e.clientX - mouseStartX, dy = e.clientY - mouseStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mouseMoved = true;
    mapPanX = mouseOriginX + dx;
    mapPanY = mouseOriginY + dy;
    applyMapTransform();
  });
  viewport.addEventListener('mouseup', (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    if (!mouseMoved && mapPinMode) {
      const rect = document.getElementById('map-inner').getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
        pendingPinX = x; pendingPinY = y;
        openPinSelectModal(ev);
      }
    }
  });
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.15;
    const newScale = Math.min(10, Math.max(0.2, mapScale * delta));
    const rect = viewport.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    mapPanX = ox - (ox - mapPanX) * (newScale / mapScale);
    mapPanY = oy - (oy - mapPanY) * (newScale / mapScale);
    mapScale = newScale;
    applyMapTransform();
  }, { passive: false });
}

function openPinSelectModal(ev) {
  const circles = ev.circles || [];
  const search = document.getElementById('pin-search');
  search.value = '';
  renderPinCircleList(ev, '');
  search.oninput = () => renderPinCircleList(ev, search.value);
  openModal('modal-pin');
}

function renderPinCircleList(ev, query) {
  const circles = ev.circles || [];
  const q = query.toLowerCase();
  const filtered = circles.filter(c =>
    !q || c.name.toLowerCase().includes(q) || c.space.toLowerCase().includes(q)
  ).slice(0, 60);

  const list = document.getElementById('pin-circle-list');
  list.innerHTML = filtered.map(c => {
    const hasWish = (c.wishItems || []).length > 0;
    const alreadyPinned = (ev.mapPins || []).some(p => p.circleId === c.id);
    return `<div class="pin-circle-option" data-circle-id="${c.id}">
      <span class="circle-space">${escHtml(c.space)}</span>
      <span class="pin-circle-option-name">${escHtml(c.name)}</span>
      ${hasWish ? '<span class="pin-circle-option-badge">★</span>' : ''}
      ${alreadyPinned ? '<span style="font-size:11px;color:var(--text-muted)">📍</span>' : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('.pin-circle-option').forEach(el => {
    el.addEventListener('click', () => {
      if (!ev.mapPins) ev.mapPins = [];
      ev.mapPins.push({ id: genId(), circleId: el.dataset.circleId, x: pendingPinX, y: pendingPinY });
      saveData(events);
      closeModal('modal-pin');
      renderMapMarkers(ev);
    });
  });
}

function showPinInfo(ev, pinId) {
  const pin = (ev.mapPins || []).find(p => p.id === pinId);
  if (!pin) return;
  const c = (ev.circles || []).find(c => c.id === pin.circleId);
  if (!c) return;
  viewingPinId = pinId;

  document.getElementById('pin-info-space').textContent = `${c.space} ${c.name}`;
  const links = [
    c.twitter ? `<a class="circle-link" href="${escHtml(c.twitter)}" target="_blank">𝕏 Twitter/X</a>` : '',
    c.pixiv ? `<a class="circle-link" href="${escHtml(c.pixiv)}" target="_blank">🎨 pixiv</a>` : '',
  ].filter(Boolean).join('');

  const wishHtml = renderWishItems(c);
  document.getElementById('pin-info-body').innerHTML =
    `<div class="circle-rep" style="margin-bottom:8px">${escHtml(c.rep)}</div>` +
    (links ? `<div class="circle-links" style="margin-bottom:8px">${links}</div>` : '') +
    (wishHtml || '<p style="color:var(--text-muted);font-size:13px">欲しいものなし</p>');

  openModal('modal-pin-info');
}

function setupMapControls(ev) {
  document.getElementById('btn-upload-map').onclick = () =>
    document.getElementById('input-map-file').click();

  document.getElementById('input-map-file').onchange = (e) => loadMapImage(e, ev);
  document.getElementById('input-map-file2').onchange = (e) => loadMapImage(e, ev);

  // ドラッグ＆ドロップ
  const dropzone = document.getElementById('map-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        const fakeEvt = { target: { files: [file], value: '' } };
        loadMapImage(fakeEvt, ev);
      }
    });
  }

  document.getElementById('btn-map-change').onclick = () =>
    document.getElementById('input-map-file2').click();

  document.getElementById('btn-map-pin-mode').onclick = () => {
    mapPinMode = !mapPinMode;
    const btn = document.getElementById('btn-map-pin-mode');
    btn.classList.toggle('active', mapPinMode);
    document.getElementById('map-pin-hint').classList.toggle('hidden', !mapPinMode);
  };

  document.getElementById('btn-map-reset').onclick = () => {
    const img = document.getElementById('map-image');
    const viewport = document.getElementById('map-viewport');
    mapScale = Math.min(
      viewport.clientWidth / img.naturalWidth,
      viewport.clientHeight / img.naturalHeight
    );
    mapPanX = 0; mapPanY = 0;
    applyMapTransform();
  };

  document.getElementById('btn-delete-pin').onclick = () => {
    ev.mapPins = (ev.mapPins || []).filter(p => p.id !== viewingPinId);
    saveData(events);
    closeModal('modal-pin-info');
    renderMapMarkers(ev);
  };
}

function loadMapImage(e, ev) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  setUploadState('loading');

  // URL.createObjectURL を使用 (iOS Safariでメモリ効率が良い)
  const objectURL = URL.createObjectURL(file);
  const img = new Image();
  img.onerror = () => {
    URL.revokeObjectURL(objectURL);
    setUploadState('error', '画像の読み込みに失敗しました');
  };
  img.onload = () => {
    URL.revokeObjectURL(objectURL);
    const MAX = 2400;
    let w = img.width, h = img.height;
    if (w > MAX || h > MAX) {
      const ratio = Math.min(MAX / w, MAX / h);
      w = Math.round(w * ratio); h = Math.round(h * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) { setUploadState('error', '画像の変換に失敗しました'); return; }
      saveMapImageToDB(ev.id, blob).then(() => {
        ev.hasMapImage = true;
        delete ev.mapImage;
        ev.mapPins = ev.mapPins || [];
        saveData(events);
        setUploadState('success');
        mapInitialized = false;
        setTimeout(() => renderMap(ev), 900);
      }).catch((err) => {
        console.error('saveMapImageToDB error', err);
        setUploadState('error', '保存に失敗しました');
      });
    }, 'image/png');
  };
  img.src = objectURL;
}
