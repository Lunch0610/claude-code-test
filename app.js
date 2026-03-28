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
  document.getElementById('detail-setup-time').textContent = ev.setupTime || '未設定';
  document.getElementById('detail-note').textContent = ev.note || 'なし';

  renderSummary(ev);
  renderTasks(ev);
  renderItems(ev);
  renderSchedule(ev);
  renderBudget(ev);
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
      ev.setupTime = document.getElementById('input-event-setup').value;
      ev.note = document.getElementById('input-event-note').value.trim();
    }
  } else {
    events.push({
      id: genId(),
      name,
      date,
      venue: document.getElementById('input-event-venue').value.trim(),
      space: document.getElementById('input-event-space').value.trim(),
      setupTime: document.getElementById('input-event-setup').value,
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
    clearForm('input-event-name', 'input-event-date', 'input-event-venue', 'input-event-space', 'input-event-setup', 'input-event-note');
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
    document.getElementById('input-event-setup').value = ev.setupTime || '';
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
      setupTime: '10:00-11:30',
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
});
