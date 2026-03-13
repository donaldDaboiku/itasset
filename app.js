 
  // ── STATE ──────────────────────────────────────────────────
let devices = [];
let history = [];
let tasks = [];
let settings = {
  prefix: 'IT',
  start: 1,
  padding: 4,
  counter: 1
};
let dashChart = null;
let currentDetailId = null;
let currentTaskPeriod = 'all';
let currentTaskFilter = 'all';
let currentTaskDetailId = null;

// ── INIT ───────────────────────────────────────────────────
function init() {
  loadData();
  updateDashboard();
  renderInventory();
  renderHistory();
  renderFaulty();
  refreshAssignSelects();
  refreshFaultySelect();
  loadSettingsForm();
  renderReportSummary();
  updateFaultyBadge();
  loadTasks();
  renderTaskBoard();
  updateOfflineBadge();
  startConnectivityMonitor();

  document.getElementById('global-search').addEventListener('input', function() {
    if (this.value.trim()) {
      navigate('inventory');
      document.getElementById('inv-search').value = this.value;
      renderInventory();
    }
  });

  // Settings live preview
  ['s-prefix','s-start','s-padding','s-counter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateTagPreview);
  });

  updateTagPreview();
}

function updateOfflineBadge() {
  const badge = document.getElementById('offline-badge');
  if (!badge) return;
  const online = typeof lastConnectivity === 'boolean' ? lastConnectivity : navigator.onLine;
  badge.classList.toggle('is-online', online);
  badge.classList.toggle('is-offline', !online);
  const text = badge.querySelector('.offline-badge-text');
  if (text) text.textContent = online ? 'Online' : 'Offline Ready';
  badge.title = online ? 'Local-first: internet optional' : 'Local-first: works without internet';
}

let lastConnectivity = null;
let connectivityTimer = null;

function checkConnectivity() {
  if (navigator.onLine === false) {
    lastConnectivity = false;
    updateOfflineBadge();
    return;
  }

  const timeoutMs = 4000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  fetch('https://www.gstatic.com/generate_204', { mode:'no-cors', cache:'no-store', signal: controller.signal })
    .then(() => { lastConnectivity = true; })
    .catch(() => { lastConnectivity = false; })
    .finally(() => {
      clearTimeout(t);
      updateOfflineBadge();
    });
}

window.addEventListener('online', () => { updateOfflineBadge(); checkConnectivity(); });
window.addEventListener('offline', () => { lastConnectivity = false; updateOfflineBadge(); });

function startConnectivityMonitor() {
  if (connectivityTimer) return;
  checkConnectivity();
  connectivityTimer = setInterval(checkConnectivity, 15000);
}

// ── STORAGE ────────────────────────────────────────────────
function loadData() {
  try {
    devices = JSON.parse(localStorage.getItem('itassettrack_devices') || '[]');
    loadTasks();
    history = JSON.parse(localStorage.getItem('itassettrack_history') || '[]');
    const s = JSON.parse(localStorage.getItem('itassettrack_settings'));
    if (s) settings = {...settings, ...s};
  } catch(e) { console.error(e); }
}

function saveData() {
  localStorage.setItem('itassettrack_devices', JSON.stringify(devices));
  localStorage.setItem('itassettrack_history', JSON.stringify(history));
  localStorage.setItem('itassettrack_settings', JSON.stringify(settings));
  saveTasks();
}

// ── NAVIGATION ─────────────────────────────────────────────
const pageNames = {
  dashboard: 'Dashboard / Overview',
  inventory: 'Inventory / All Devices',
  assign: 'Assign / Reassign Device',
  faulty: 'Faulty / Device Tracking',
  history: 'History / Audit Log',
  tasks: 'Task Log / Daily Tracker',
  reports: 'Reports / Exports',
  settings: 'Settings / Configuration'
};

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
  document.getElementById('topbar-title').innerHTML = pageNames[page].replace(' / ', ' <span>/ ') + '</span>';

  if (page === 'dashboard') updateDashboard();
  if (page === 'inventory') renderInventory();
  if (page === 'history') renderHistory();
  if (page === 'faulty') { renderFaulty(); refreshFaultySelect(); }
  if (page === 'assign') { refreshAssignSelects(); renderAssignedList(); }
  if (page === 'reports') renderReportSummary();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.page));
});

// ── TABS ───────────────────────────────────────────────────
function switchTab(btn, tabId) {
  btn.closest('.tabs').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const parent = btn.closest('.page');
  parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  parent.querySelector('#' + tabId).classList.add('active');
  if (tabId === 'reassign-tab') refreshReassignSelect();
}

// ── ASSET TAG ──────────────────────────────────────────────
function genTag(counter) {
  const num = String(counter).padStart(settings.padding, '0');
  return `${settings.prefix}-${num}`;
}

function nextTag() {
  return genTag(settings.counter);
}

function bumpCounter() {
  settings.counter++;
  saveData();
}

// ── ADD DEVICE ─────────────────────────────────────────────
function openAddModal() {
  document.getElementById('f-tag').value = nextTag();
  document.getElementById('f-name').value = '';
  document.getElementById('f-serial').value = '';
  document.getElementById('f-dept').value = '';
  document.getElementById('f-purchase').value = new Date().toISOString().split('T')[0];
  document.getElementById('modal-add').classList.add('open');
}

function addDevice() {
  const name     = document.getElementById('f-name').value.trim();
  const serial   = document.getElementById('f-serial').value.trim();
  const tag      = document.getElementById('f-tag').value;

  if (!name || !serial) { toast('Device name and serial number are required', 'error'); return; }
  if (devices.find(d => d.serial.toLowerCase() === serial.toLowerCase())) {
    toast('Serial number already exists in inventory', 'error'); return;
  }

  const gv = id => document.getElementById(id)?.value?.trim() || '';
  const gn = id => parseFloat(document.getElementById(id)?.value) || 0;

  const assignedUser = gv('f-assigneduser');
  const dept         = gv('f-dept');

  const device = {
    id: Date.now().toString(),
    tag,
    name,
    serial,
    brand:        gv('f-brand'),
    oldTag:       gv('f-oldtag'),
    category:     document.getElementById('f-category').value,
    condition:    document.getElementById('f-condition').value,
    os:           gv('f-os'),
    processor:    gv('f-processor'),
    generation:   gv('f-generation'),
    ram:          gn('f-ram') || '',
    rom:          gn('f-rom') || '',
    disk:         gn('f-disk') || '',
    display:      gv('f-display'),
    dept,
    assignedUser,
    assignedDept: dept,
    purchase:     gv('f-purchase'),
    dateReceived: gv('f-received'),
    dateAssigned: gv('f-assigned-date'),
    dateReturned: gv('f-returned'),
    warrantyExpiry: gv('f-warranty'),
    eolDate:      gv('f-eol'),
    purchaseValue: gn('f-value') || '',
    currentValue: gn('f-curvalue') || '',
    supplier:     gv('f-supplier'),
    invoiceNo:    gv('f-invoice'),
    notes:        gv('f-notes'),
    status:       assignedUser ? 'Assigned' : 'Available',
    addedDate:    new Date().toISOString(),
    tickets:      [],
  };

  devices.push(device);
  addHistory(device, 'Added', assignedUser || '', `${device.category}${device.ram ? ' · '+device.ram+'GB RAM' : ''}${device.processor ? ' · '+device.processor : ''}`);
  if (assignedUser) addHistory(device, 'Assigned', assignedUser, `Dept: ${dept}`);
  bumpCounter();
  saveData();
  closeModal('modal-add');
  toast(`✅ ${tag} added to inventory`, 'success');
  renderInventory();
  updateDashboard();
  refreshAssignSelects();
  refreshFaultySelect();
  updateFaultyBadge();
}

// ── ASSIGN ─────────────────────────────────────────────────
function refreshAssignSelects() {
  const sel = document.getElementById('assign-device-select');
  sel.innerHTML = '<option value="">-- Choose device --</option>';
  devices.filter(d => d.status === 'Available').forEach(d => {
    sel.innerHTML += `<option value="${d.id}">${d.tag} - ${d.name}</option>`;
  });
}

function refreshReassignSelect() {
  const sel = document.getElementById('reassign-device-select');
  sel.innerHTML = '<option value="">-- Choose assigned device --</option>';
  devices.filter(d => d.status === 'Assigned').forEach(d => {
    sel.innerHTML += `<option value="${d.id}">${d.tag} - ${d.name} (${d.assignedUser})</option>`;
  });
  sel.onchange = function() {
    const d = devices.find(x => x.id === this.value);
    const info = document.getElementById('reassign-current-info');
    if (d) {
      info.style.display = 'block';
      document.getElementById('reassign-current-user').textContent = `${d.assignedUser} - ${d.assignedDept}`;
    } else {
      info.style.display = 'none';
    }
  };
}

function assignDevice() {
  const devId = document.getElementById('assign-device-select').value;
  const user = document.getElementById('assign-user').value.trim();
  const dept = document.getElementById('assign-dept').value.trim();
  if (!devId) { toast('Please select a device', 'error'); return; }
  if (!user) { toast('User name is required', 'error'); return; }

  const device = devices.find(d => d.id === devId);
  device.status = 'Assigned';
  device.assignedUser = user;
  device.assignedDept = dept || device.dept;

  addHistory(device, 'Assigned', user, `Dept: ${dept}`);
  saveData();
  toast(`${device.tag} assigned to ${user}`, 'success');
  document.getElementById('assign-user').value = '';
  document.getElementById('assign-dept').value = '';
  refreshAssignSelects();
  renderAssignedList();
  updateDashboard();
  renderInventory();
  updateFaultyBadge();
}

function reassignDevice() {
  const devId = document.getElementById('reassign-device-select').value;
  const newUser = document.getElementById('reassign-user').value.trim();
  const newDept = document.getElementById('reassign-dept').value.trim();
  if (!devId) { toast('Please select a device', 'error'); return; }
  if (!newUser) { toast('New user name is required', 'error'); return; }

  const device = devices.find(d => d.id === devId);
  const prevUser = device.assignedUser;
  device.assignedUser = newUser;
  device.assignedDept = newDept || device.assignedDept;

  addHistory(device, 'Reassigned', newUser, `From: ${prevUser} → ${newUser}`);
  saveData();
  toast(`${device.tag} reassigned from ${prevUser} to ${newUser}`, 'success');
  document.getElementById('reassign-user').value = '';
  document.getElementById('reassign-dept').value = '';
  refreshReassignSelect();
  document.getElementById('reassign-current-info').style.display = 'none';
  renderInventory();
  updateDashboard();
}

function renderAssignedList() {
  const assigned = devices.filter(d => d.status === 'Assigned');
  const el = document.getElementById('assigned-list');
  if (!assigned.length) {
    el.innerHTML = '<div class="empty-state"><div class="es-icon">🔗</div><p>No assigned devices</p></div>';
    return;
  }
  el.innerHTML = assigned.map(d => `
    <div class="stat-row">
      <div class="s-label">
        <span class="tag" style="font-size:10px;">${d.tag}</span>
        <div>
          <div style="font-size:12.5px;font-weight:600;">${d.assignedUser}</div>
          <div style="font-size:11px;color:var(--text3);">${d.name} · ${d.assignedDept}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ── FAULTY ─────────────────────────────────────────────────
function refreshFaultySelect() {
  const sel = document.getElementById('faulty-device-select');
  sel.innerHTML = '<option value="">-- Choose device --</option>';
  devices.filter(d => d.status !== 'Faulty').forEach(d => {
    sel.innerHTML += `<option value="${d.id}">${d.tag} - ${d.name} [${d.status}]</option>`;
  });
}

function markFaulty() {
  const devId = document.getElementById('faulty-device-select').value;
  const desc = document.getElementById('faulty-desc').value.trim();
  if (!devId) { toast('Please select a device', 'error'); return; }

  const device = devices.find(d => d.id === devId);
  const prevUser = device.assignedUser || 'Unassigned';
  device.status = 'Faulty';
  device.assignedUser = '';
  device.assignedDept = '';

  addHistory(device, 'Faulty', prevUser, desc || 'Marked as faulty');
  saveData();
  toast(`${device.tag} marked as faulty`, 'warning');
  document.getElementById('faulty-desc').value = '';
  refreshFaultySelect();
  renderFaulty();
  renderInventory();
  updateDashboard();
  updateFaultyBadge();
}

function restoreDevice(id) {
  const device = devices.find(d => d.id === id);
  device.status = 'Available';
  addHistory(device, 'Restored', '', 'Returned to inventory');
  saveData();
  toast(`${device.tag} restored to available`, 'success');
  renderFaulty();
  renderInventory();
  updateDashboard();
  refreshFaultySelect();
  updateFaultyBadge();
}

function renderFaulty() {
  const faulty = devices.filter(d => d.status === 'Faulty');
  const tbody = document.getElementById('faulty-tbody');
  if (!faulty.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text3);">No faulty devices 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = faulty.map(d => `
    <tr>
      <td><span class="tag">${d.tag}</span></td>
      <td>${d.name}</td>
      <td class="mono" style="font-size:11px;color:var(--text3);">${d.serial}</td>
      <td style="font-size:12px;">${d.ram ? d.ram+'GB RAM' : ''}${d.ram && d.disk ? ' · ' : ''}${d.disk ? d.disk+'GB' : ''}</td>
      <td>${getLastUser(d.id)}</td>
      <td>
        <button class="btn btn-success btn-sm" onclick="restoreDevice('${d.id}')">✅ Restore</button>
        <button class="btn btn-outline btn-sm" onclick="showDetail('${d.id}')" style="margin-left:4px;">👁</button>
      </td>
    </tr>
  `).join('');
}

function getLastUser(devId) {
  const logs = history.filter(h => h.deviceId === devId).reverse();
  for (const l of logs) {
    if (l.user && l.user !== '') return l.user;
  }
  return '—';
}

function updateFaultyBadge() {
  const count = devices.filter(d => d.status === 'Faulty').length;
  const badge = document.querySelector('.nav-item[data-page="faulty"] .nav-badge');
  if (count > 0) {
    if (!badge) {
      document.querySelector('.nav-item[data-page="faulty"]').innerHTML += `<span class="nav-badge">${count}</span>`;
    } else {
      badge.textContent = count;
    }
  } else if (badge) {
    badge.remove();
  }
}

// ── HISTORY ────────────────────────────────────────────────
function addHistory(device, action, user, notes) {
  history.unshift({
    id: Date.now().toString() + Math.random(),
    deviceId: device.id,
    tag: device.tag,
    serial: device.serial,
    name: device.name,
    action,
    user: user || '',
    notes: notes || '',
    date: new Date().toISOString()
  });
  saveData();
}

function renderHistory() {
  const search = (document.getElementById('history-search')?.value || '').toLowerCase();
  const filter = document.getElementById('history-filter')?.value || '';
  const tbody = document.getElementById('history-tbody');

  let data = history;
  if (search) data = data.filter(h =>
    h.tag.toLowerCase().includes(search) ||
    h.serial.toLowerCase().includes(search) ||
    (h.user||'').toLowerCase().includes(search) ||
    (h.name||'').toLowerCase().includes(search)
  );
  if (filter) data = data.filter(h => h.action === filter);

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3);">No history records found</td></tr>`;
    return;
  }

  const actionEmoji = { Added:'📦', Assigned:'✅', Reassigned:'🔄', Faulty:'⚠️', Restored:'🔧' };
  const actionColor = { Added:'var(--blue)', Assigned:'var(--green)', Reassigned:'var(--orange)', Faulty:'var(--red)', Restored:'var(--accent)', Ticket:'#b400ff', Updated:'var(--text2)', Returned:'var(--text2)' };

  tbody.innerHTML = data.map((h, i) => `
    <tr>
      <td class="mono" style="color:var(--text3);font-size:11px;">${data.length - i}</td>
      <td class="mono" style="font-size:11px;color:var(--text2);">${formatDate(h.date)}</td>
      <td><span class="tag">${h.tag}</span></td>
      <td class="mono" style="font-size:12px;">${h.serial}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:${actionColor[h.action]||'var(--text)'};">
          ${actionEmoji[h.action]||'•'} ${h.action}
        </span>
      </td>
      <td style="font-size:13px;">${h.user || '—'}</td>
      <td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${h.notes}">${h.notes || '—'}</td>
    </tr>
  `).join('');
}

// ── INVENTORY TABLE ────────────────────────────────────────
function updateInventoryCategoryFilter() {
  const sel = document.getElementById('inv-category-filter');
  if (!sel) return;

  const current = sel.value || 'all';
  const defaults = ['Laptop','Desktop','Monitor','Printer','Tablet','Phone','Server','Network Equipment','External Storage','Biometric','Other'];
  const fromData = Array.from(new Set(devices.map(d => (d.category||'').trim()).filter(Boolean)));
  const lowerDefaults = defaults.map(d => d.toLowerCase());
  const extras = fromData.filter(c => !lowerDefaults.includes(c.toLowerCase())).sort();

  const options = ['<option value="all">All Categories</option>']
    .concat(defaults.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`))
    .concat(extras.map(c => `<option value="${escAttr(c)}">${escHtml(c)}</option>`))
    .join('');

  sel.innerHTML = options;
  sel.value = (current && Array.from(sel.options).some(o => o.value === current)) ? current : 'all';
}

function renderInventory() {
  updateInventoryCategoryFilter();
  const search = (document.getElementById('inv-search')?.value || document.getElementById('global-search')?.value || '').toLowerCase();
  const category = document.getElementById('inv-category-filter')?.value || 'all';
  const tbody = document.getElementById('inventory-tbody');

  let data = devices;
  if (category !== 'all') data = data.filter(d => (d.category||'').toLowerCase() === category.toLowerCase());
  if (search) data = data.filter(d =>
    d.tag.toLowerCase().includes(search) ||
    d.name.toLowerCase().includes(search) ||
    d.serial.toLowerCase().includes(search) ||
    (d.dept||'').toLowerCase().includes(search)
  );

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="es-icon">🗃️</div><p>${devices.length ? 'No results found' : 'No devices in inventory. Add your first device!'}</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(d => `
    <tr>
      <td><span class="tag">${d.tag}</span></td>
      <td style="font-weight:500;">${d.name}</td>
      <td class="mono" style="font-size:12px;">${d.serial}</td>
      <td style="font-size:13px;">${d.dept || '—'}</td>
      <td>${statusBadge(d.status)}</td>
      <td style="font-size:13px;">${d.assignedUser || '—'}</td>
      <td><div class="qr-cell" id="qr-${d.id}"></div></td>
      <td>
        <div class="flex-row" style="gap:4px;flex-wrap:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="showDetail('${d.id}')">👁</button>
          <button class="btn btn-outline btn-sm" onclick="printLabel('${d.id}')">🖨️</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDelete('${d.id}')">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');

  // Render QR codes
  data.forEach(d => {
    const el = document.getElementById('qr-' + d.id);
    if (el && !el.querySelector('canvas')) {
      try {
        new QRCode(el, {
          text: qrData(d),
          width: 50, height: 50,
          colorDark: '#00d4ff',
          colorLight: '#111827'
        });
      } catch(e) {}
    }
  });
}

function qrData(d) {
  return `ITAssetTrack|TAG:${d.tag}|NAME:${d.name}|SERIAL:${d.serial}|DEPT:${d.dept||'—'}|USER:${d.assignedUser||'Unassigned'}|STATUS:${d.status}|RAM:${d.ram||'—'}GB|DISK:${d.disk||'—'}GB`;
}

function statusBadge(status) {
  const map = {
    'Assigned': 'badge-assigned',
    'Available': 'badge-available',
    'Faulty': 'badge-faulty'
  };
  return `<span class="status-badge ${map[status]||''}">${status}</span>`;
}

// ── DETAIL MODAL ───────────────────────────────────────────
function switchDetailTab(btn, panelId) {
  document.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.detail-tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(panelId).classList.add('active');
}

function showDetail(id) {
  const d = devices.find(x => x.id === id);
  if (!d) return;
  currentDetailId = id;
  if (!d.tickets) d.tickets = [];

  // Reset to first tab
  document.querySelectorAll('.detail-tab').forEach((b,i) => b.classList.toggle('active', i===0));
  document.querySelectorAll('.detail-tab-panel').forEach((p,i) => p.classList.toggle('active', i===0));

  document.getElementById('detail-subtitle').textContent = `${d.name} · ${d.tag}`;

  // Value pill
  const vp = document.getElementById('dd-value-pill');
  if (d.purchaseValue) { vp.style.display='inline-flex'; vp.textContent = '₦' + Number(d.purchaseValue).toLocaleString(); }
  else vp.style.display = 'none';

  // Status & condition
  document.getElementById('dd-status-badge').innerHTML = statusBadge(d.status);
  const condMap = { excellent:'excellent', good:'good', fair:'fair', poor:'poor' };
  const condLabel = { excellent:'Excellent', good:'Good', fair:'Fair', poor:'Poor' };
  const cond = condMap[d.condition] || 'good';
  document.getElementById('dd-condition-badge').innerHTML = `<span class="condition-badge ${cond}">${condLabel[cond]}</span>`;

  // Warranty note
  const wnEl = document.getElementById('dd-warranty-note');
  if (d.warrantyExpiry) {
    const diff = Math.ceil((new Date(d.warrantyExpiry) - new Date()) / 86400000);
    wnEl.textContent = diff < 0 ? '⚠ Warranty expired' : diff < 90 ? `⏳ Warranty expires in ${diff}d` : `🛡 Warranty valid`;
    wnEl.style.color = diff < 0 ? 'var(--red)' : diff < 90 ? 'var(--orange)' : 'var(--green)';
  } else { wnEl.textContent = ''; }

  // INFO tab
  document.getElementById('detail-grid-info').innerHTML = `
    <div class="detail-item"><label>Asset Tag</label><span class="mono" style="color:var(--accent);">${d.tag}</span></div>
    <div class="detail-item"><label>Old Tag</label><span class="mono">${d.oldTag||'—'}</span></div>
    <div class="detail-item"><label>Device Name</label><span>${d.name}</span></div>
    <div class="detail-item"><label>Brand</label><span>${d.brand||'—'}</span></div>
    <div class="detail-item"><label>Category</label><span>${d.category||'—'}</span></div>
    <div class="detail-item"><label>Serial Number</label><span class="mono">${d.serial}</span></div>
    <div class="detail-item"><label>Assigned User</label><span>${d.assignedUser||'—'}</span></div>
    <div class="detail-item"><label>Department</label><span>${d.dept||'—'}</span></div>
    <div class="detail-item"><label>Date Received</label><span>${d.dateReceived||'—'}</span></div>
    <div class="detail-item"><label>Date Assigned</label><span>${d.dateAssigned||'—'}</span></div>
    <div class="detail-item"><label>Date Returned</label><span>${d.dateReturned || '<span style="color:var(--text3);">Not returned</span>'}</span></div>
    <div class="detail-item"><label>Warranty Expiry</label><span>${d.warrantyExpiry||'—'}</span></div>
    <div class="detail-item"><label>End-of-Life Date</label><span>${d.eolDate||'—'}</span></div>
    <div class="detail-item"><label>Added to System</label><span class="mono" style="font-size:11px;">${formatDate(d.addedDate)}</span></div>
    ${d.notes ? `<div class="detail-item" style="grid-column:1/-1;"><label>Notes</label><span style="color:var(--text2);">${d.notes}</span></div>` : ''}
  `;

  // SPECS tab
  document.getElementById('detail-grid-specs').innerHTML = `
    <div class="detail-item"><label>Operating System</label><span>${d.os||'—'}</span></div>
    <div class="detail-item"><label>Processor / CPU</label><span>${d.processor||'—'}</span></div>
    <div class="detail-item"><label>Generation</label><span>${d.generation||'—'}</span></div>
    <div class="detail-item"><label>RAM</label><span class="mono">${d.ram ? d.ram+'GB' : '—'}</span></div>
    <div class="detail-item"><label>ROM / SSD (Internal)</label><span class="mono">${d.rom ? d.rom+'GB' : '—'}</span></div>
    <div class="detail-item"><label>Disk / HDD</label><span class="mono">${d.disk ? d.disk+'GB' : '—'}</span></div>
    <div class="detail-item"><label>Display Size</label><span>${d.display ? d.display+'"' : '—'}</span></div>
  `;

  // FINANCE tab
  const purchaseVal = parseFloat(d.purchaseValue) || 0;
  const currentVal  = parseFloat(d.currentValue) || 0;
  const totalRepairCost = (d.tickets||[]).reduce((sum, t) => sum + (parseFloat(t.cost)||0), 0);
  const tco = purchaseVal + totalRepairCost;

  document.getElementById('detail-grid-finance').innerHTML = `
    <div class="detail-item"><label>Purchase Date</label><span>${d.purchase||'—'}</span></div>
    <div class="detail-item"><label>Supplier / Vendor</label><span>${d.supplier||'—'}</span></div>
    <div class="detail-item"><label>Invoice / PO No.</label><span class="mono">${d.invoiceNo||'—'}</span></div>
    <div class="detail-item"><label>Purchase Value</label><span class="value-pill" style="${!purchaseVal?'display:none;':''}">₦${purchaseVal.toLocaleString()}</span>${!purchaseVal?'<span>—</span>':''}</div>
    <div class="detail-item"><label>Current Value</label><span class="${currentVal?'value-pill':''}">${currentVal ? '₦'+currentVal.toLocaleString() : '—'}</span></div>
    <div class="detail-item"><label>Total Repair Cost</label><span class="${totalRepairCost?'cost-pill':''}">${totalRepairCost ? '₦'+totalRepairCost.toLocaleString() : '₦0'}</span></div>
    <div class="detail-item"><label>Total Cost of Ownership</label><span class="mono" style="font-weight:700;">${tco ? '₦'+tco.toLocaleString() : '—'}</span></div>
  `;

  // Depreciation bar
  const deprWrap = document.getElementById('dd-depr-wrap');
  if (purchaseVal && d.purchase) {
    deprWrap.style.display = 'block';
    const ageYears = (new Date() - new Date(d.purchase)) / (1000*60*60*24*365);
    const usefulLife = 4; // assume 4-year useful life
    const remaining = Math.max(0, Math.min(100, ((usefulLife - ageYears) / usefulLife) * 100));
    document.getElementById('dd-depr-bar').style.width = remaining + '%';
    document.getElementById('dd-depr-bar').style.background = remaining < 25 ? 'var(--red)' : remaining < 50 ? 'var(--orange)' : 'linear-gradient(90deg,var(--green),var(--accent))';
    document.getElementById('dd-depr-pct').textContent = Math.round(remaining) + '% remaining';
    document.getElementById('dd-depr-note').textContent = `Based on ${usefulLife}-year useful life · Age: ${ageYears.toFixed(1)} years`;
  } else { deprWrap.style.display = 'none'; }

  // Cost summary
  const csEl = document.getElementById('dd-cost-summary');
  if (!totalRepairCost && !(d.tickets||[]).length) {
    csEl.innerHTML = '<p style="color:var(--text3);font-size:12px;">No tickets logged yet.</p>';
  } else {
    const byType = {};
    (d.tickets||[]).forEach(t => { byType[t.type] = (byType[t.type]||0) + (parseFloat(t.cost)||0); });
    csEl.innerHTML = Object.entries(byType).map(([type, cost]) =>
      `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;border-bottom:1px solid var(--border);">
        <span style="color:var(--text2);text-transform:capitalize;">${type}</span>
        <span class="mono" style="font-weight:600;">₦${cost.toLocaleString()}</span>
      </div>`
    ).join('') + `<div style="display:flex;justify-content:space-between;font-size:13px;padding:8px 0;font-weight:700;">
      <span>Total</span><span class="mono cost-pill">₦${totalRepairCost.toLocaleString()}</span>
    </div>`;
  }

  // TICKETS tab
  renderTicketList(d);

  // HISTORY tab
  const devHistory = history.filter(h => h.deviceId === id);
  const histEl = document.getElementById('detail-history');
  if (!devHistory.length) {
    histEl.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:10px 0;">No history for this device.</p>';
  } else {
    const actionColor = { Added:'var(--blue)', Assigned:'var(--green)', Reassigned:'var(--orange)', Faulty:'var(--red)', Restored:'var(--accent)', Ticket:'#b400ff', Updated:'var(--text2)', Returned:'var(--text2)' };
    histEl.innerHTML = devHistory.map(h => `
      <div class="history-item">
        <div>
          <div style="font-size:13px;font-weight:600;color:${actionColor[h.action]||'var(--text)'};">${h.action}</div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--mono);">${formatDate(h.date)}</div>
        </div>
        <div style="font-size:12px;color:var(--text2);">${h.user ? 'User: '+h.user : ''} ${h.notes ? '· '+h.notes : ''}</div>
      </div>`).join('');
  }

  // QR
  const qrEl = document.getElementById('detail-qr');
  qrEl.innerHTML = '';
  try {
    new QRCode(qrEl, { text: qrData(d), width:110, height:110, colorDark:'#00d4ff', colorLight:'#111827' });
  } catch(e) {}

  document.getElementById('modal-detail').classList.add('open');
}

// ── TICKET SYSTEM ──────────────────────────────────────────
function renderTicketList(d) {
  const el = document.getElementById('ticket-list');
  const badge = document.getElementById('ticket-count-badge');
  const tickets = d.tickets || [];
  const open = tickets.filter(t => t.status !== 'closed' && t.status !== 'resolved').length;
  if (open) { badge.style.display='inline'; badge.textContent=open; }
  else badge.style.display='none';

  if (!tickets.length) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px;">No tickets logged. Click <strong>+ New Ticket</strong> to log a complaint, repair or maintenance event.</div>';
    return;
  }
  el.innerHTML = '<div class="ticket-list">' + tickets.slice().reverse().map(t => `
    <div class="ticket-card">
      <div class="ticket-card-hdr">
        <span class="ticket-type ${t.type}">${{complaint:'🔴 Complaint',repair:'🟡 Repair',maintenance:'🔵 Maintenance',upgrade:'🟢 Upgrade'}[t.type]||t.type}</span>
        <span class="ticket-title">${t.title}</span>
        <span class="ticket-status ${t.status}">${t.status.replace('-',' ')}</span>
        <button class="task-act-btn" style="margin-left:8px;color:var(--red);flex-shrink:0;" onclick="deleteTicket('${d.id}','${t.id}')">🗑</button>
      </div>
      <div class="ticket-meta">
        <span>📅 ${t.date||'—'}</span>
        ${t.resolved ? `<span>✅ Resolved: ${t.resolved}</span>` : ''}
        ${t.tech ? `<span>🔧 ${t.tech}</span>` : ''}
        ${t.cost ? `<span class="ticket-cost">₦${Number(t.cost).toLocaleString()}</span>` : ''}
      </div>
      ${t.desc ? `<div class="ticket-desc">${t.desc}</div>` : ''}
      ${t.resolution ? `<div class="ticket-desc" style="color:var(--green);margin-top:4px;">✅ ${t.resolution}</div>` : ''}
    </div>`).join('') + '</div>';
}

function openAddTicket(deviceId) {
  document.getElementById('ticket-device-id').value = deviceId;
  document.getElementById('ticket-edit-id').value = '';
  document.getElementById('ticket-modal-title').textContent = '🎫 New Ticket';
  document.getElementById('tk-title').value = '';
  document.getElementById('tk-type').value = 'repair';
  document.getElementById('tk-status').value = 'open';
  document.getElementById('tk-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('tk-resolved').value = '';
  document.getElementById('tk-tech').value = '';
  document.getElementById('tk-cost').value = '';
  document.getElementById('tk-desc').value = '';
  document.getElementById('tk-resolution').value = '';
  document.getElementById('modal-ticket').classList.add('open');
}

function saveTicket() {
  const title = document.getElementById('tk-title').value.trim();
  if (!title) { toast('Ticket title is required', 'error'); return; }
  const deviceId = document.getElementById('ticket-device-id').value;
  const device   = devices.find(d => d.id === deviceId);
  if (!device) return;
  if (!device.tickets) device.tickets = [];

  const ticket = {
    id:         'tk_' + Date.now(),
    title,
    type:       document.getElementById('tk-type').value,
    status:     document.getElementById('tk-status').value,
    date:       document.getElementById('tk-date').value,
    resolved:   document.getElementById('tk-resolved').value,
    tech:       document.getElementById('tk-tech').value.trim(),
    cost:       parseFloat(document.getElementById('tk-cost').value) || 0,
    desc:       document.getElementById('tk-desc').value.trim(),
    resolution: document.getElementById('tk-resolution').value.trim(),
    loggedAt:   new Date().toISOString(),
  };

  device.tickets.push(ticket);
  addHistory(device, 'Ticket', ticket.tech||'', `${ticket.type}: ${ticket.title}${ticket.cost ? ' · ₦'+ticket.cost.toLocaleString() : ''}`);
  saveData();
  closeModal('modal-ticket');
  toast('✅ Ticket logged', 'success');
  showDetail(deviceId); // refresh detail view
}

function deleteTicket(deviceId, ticketId) {
  const device = devices.find(d => d.id === deviceId);
  if (!device) return;
  showConfirm('Delete Ticket?', 'This ticket will be permanently removed.', () => {
    device.tickets = (device.tickets||[]).filter(t => t.id !== ticketId);
    saveData();
    renderTicketList(device);
    toast('Ticket deleted', 'info');
  });
}

// ── EDIT DEVICE ────────────────────────────────────────────
function openEditDeviceModal(id) {
  const d = devices.find(x => x.id === id);
  if (!d) return;
  document.getElementById('edit-device-id').value = id;

  // Reuse same form fields but populate them
  const body = document.getElementById('edit-device-body');
  const fmtDate = v => v ? (v.includes('T') ? v.split('T')[0] : v) : '';
  body.innerHTML = `
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);font-family:var(--mono);margin-bottom:10px;">📋 Identity</div>
    <div class="form-grid">
      <div class="form-group"><label>Asset Tag</label><input type="text" id="ef-tag" value="${d.tag}" readonly style="color:var(--accent);font-family:var(--mono);"></div>
      <div class="form-group"><label>Old Tag</label><input type="text" id="ef-oldtag" value="${d.oldTag||''}"></div>
      <div class="form-group"><label>Device Name *</label><input type="text" id="ef-name" value="${d.name}"></div>
      <div class="form-group"><label>Brand</label><input type="text" id="ef-brand" value="${d.brand||''}"></div>
      <div class="form-group"><label>Serial Number</label><input type="text" id="ef-serial" value="${d.serial}"></div>
      <div class="form-group"><label>Category</label>
        <select id="ef-category">
          ${['Laptop','Desktop','Monitor','Printer','Tablet','Phone','Server','Network Equipment','External Storage','Biometric','Other'].map(c=>`<option ${d.category===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Condition</label>
        <select id="ef-condition">
          ${['excellent','good','fair','poor'].map(c=>`<option value="${c}" ${d.condition===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Operating System</label><input type="text" id="ef-os" value="${d.os||''}"></div>
    </div>
    <div class="divider"></div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);font-family:var(--mono);margin-bottom:10px;">⚙️ Specifications</div>
    <div class="form-grid">
      <div class="form-group"><label>Processor</label><input type="text" id="ef-processor" value="${d.processor||''}"></div>
      <div class="form-group"><label>Generation</label><input type="text" id="ef-generation" value="${d.generation||''}"></div>
      <div class="form-group"><label>RAM (GB)</label><input type="number" id="ef-ram" value="${d.ram||''}"></div>
      <div class="form-group"><label>ROM / SSD (GB)</label><input type="number" id="ef-rom" value="${d.rom||''}"></div>
      <div class="form-group"><label>Disk / HDD (GB)</label><input type="number" id="ef-disk" value="${d.disk||''}"></div>
      <div class="form-group"><label>Display Size</label><input type="text" id="ef-display" value="${d.display||''}"></div>
    </div>
    <div class="divider"></div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);font-family:var(--mono);margin-bottom:10px;">👤 Assignment & Dates</div>
    <div class="form-grid">
      <div class="form-group"><label>Department</label><input type="text" id="ef-dept" value="${d.dept||''}"></div>
      <div class="form-group"><label>Assigned User</label><input type="text" id="ef-assigneduser" value="${d.assignedUser||''}"></div>
      <div class="form-group"><label>Date Purchased</label><input type="date" id="ef-purchase" value="${fmtDate(d.purchase)}"></div>
      <div class="form-group"><label>Date Received</label><input type="date" id="ef-received" value="${fmtDate(d.dateReceived)}"></div>
      <div class="form-group"><label>Date Assigned</label><input type="date" id="ef-assigned-date" value="${fmtDate(d.dateAssigned)}"></div>
      <div class="form-group"><label>Date Returned</label><input type="date" id="ef-returned" value="${fmtDate(d.dateReturned)}"></div>
      <div class="form-group"><label>Warranty Expiry</label><input type="date" id="ef-warranty" value="${fmtDate(d.warrantyExpiry)}"></div>
      <div class="form-group"><label>End-of-Life Date</label><input type="date" id="ef-eol" value="${fmtDate(d.eolDate)}"></div>
    </div>
    <div class="divider"></div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);font-family:var(--mono);margin-bottom:10px;">💰 Financial</div>
    <div class="form-grid">
      <div class="form-group"><label>Purchase Value (₦)</label><input type="number" id="ef-value" value="${d.purchaseValue||''}"></div>
      <div class="form-group"><label>Current Value (₦)</label><input type="number" id="ef-curvalue" value="${d.currentValue||''}"></div>
      <div class="form-group"><label>Supplier</label><input type="text" id="ef-supplier" value="${d.supplier||''}"></div>
      <div class="form-group"><label>Invoice / PO No.</label><input type="text" id="ef-invoice" value="${d.invoiceNo||''}"></div>
    </div>
    <div class="divider"></div>
    <div class="form-group"><label>Notes</label><textarea id="ef-notes" rows="2" style="resize:vertical;">${d.notes||''}</textarea></div>
  `;
  closeModal('modal-detail');
  document.getElementById('modal-edit-device').classList.add('open');
}

function saveEditDevice() {
  const id = document.getElementById('edit-device-id').value;
  const d  = devices.find(x => x.id === id);
  if (!d) return;

  const gv = eid => document.getElementById(eid)?.value?.trim() || '';
  const gn = eid => parseFloat(document.getElementById(eid)?.value) || '';

  const newName = gv('ef-name');
  if (!newName) { toast('Device name is required', 'error'); return; }

  const prevUser = d.assignedUser;
  const newUser  = gv('ef-assigneduser');

  Object.assign(d, {
    name: newName,
    brand: gv('ef-brand'),
    oldTag: gv('ef-oldtag'),
    serial: gv('ef-serial') || d.serial,
    category: document.getElementById('ef-category').value,
    condition: document.getElementById('ef-condition').value,
    os: gv('ef-os'),
    processor: gv('ef-processor'),
    generation: gv('ef-generation'),
    ram: gn('ef-ram'),
    rom: gn('ef-rom'),
    disk: gn('ef-disk'),
    display: gv('ef-display'),
    dept: gv('ef-dept'),
    assignedUser: newUser,
    assignedDept: gv('ef-dept'),
    purchase: gv('ef-purchase'),
    dateReceived: gv('ef-received'),
    dateAssigned: gv('ef-assigned-date'),
    dateReturned: gv('ef-returned'),
    warrantyExpiry: gv('ef-warranty'),
    eolDate: gv('ef-eol'),
    purchaseValue: gn('ef-value'),
    currentValue: gn('ef-curvalue'),
    supplier: gv('ef-supplier'),
    invoiceNo: gv('ef-invoice'),
    notes: gv('ef-notes'),
    status: newUser ? 'Assigned' : 'Available',
  });

  if (newUser !== prevUser) {
    if (newUser) addHistory(d, prevUser ? 'Reassigned' : 'Assigned', newUser, `From: ${prevUser||'Unassigned'}`);
    else         addHistory(d, 'Returned', prevUser, 'Device returned to inventory');
  }
  addHistory(d, 'Updated', '', 'Device record updated');

  saveData();
  closeModal('modal-edit-device');
  toast(`✅ ${d.tag} updated`, 'success');
  renderInventory();
  updateDashboard();
  refreshAssignSelects();
  refreshFaultySelect();
  showDetail(id);
}


// ── PRINT LABEL ────────────────────────────────────────────
function printLabel(id) {
  const d = devices.find(x => x.id === id);
  if (!d) return;

  const win = window.open('', '_blank', 'width=400,height=500');
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Asset Label - ${d.tag}</title>
      <style>
        body { font-family: 'Courier New', monospace; background:#fff; color:#000; margin:0; padding:20px; }
        .label { border: 2px solid #000; padding: 20px; max-width: 340px; margin: auto; }
        .header { text-align:center; font-size:13px; font-weight:bold; letter-spacing:2px; margin-bottom:10px; border-bottom:1px solid #000; padding-bottom:8px; }
        .row { display:flex; justify-content:space-between; font-size:12px; padding:3px 0; }
        .label-val { font-weight:bold; }
        .qr-wrap { text-align:center; margin: 14px 0 10px; }
        .footer { text-align:center; font-size:10px; color:#666; }
        #qrcode canvas, #qrcode img { width:120px!important;height:120px!important; }
      </style>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    </head>
    <body>
      <div class="label">
        <div class="header">🖥️ IT DEPARTMENT — ASSET LABEL</div>
        <div class="row"><span>Asset Tag:</span><span class="label-val">${d.tag}</span></div>
        <div class="row"><span>Device:</span><span class="label-val">${d.name}</span></div>
        <div class="row"><span>Serial:</span><span class="label-val">${d.serial}</span></div>
        <div class="row"><span>Dept:</span><span class="label-val">${d.dept||'—'}</span></div>
        <div class="row"><span>Status:</span><span class="label-val">${d.status}</span></div>
        ${d.assignedUser ? `<div class="row"><span>Assigned:</span><span class="label-val">${d.assignedUser}</span></div>` : ''}
        ${d.ram ? `<div class="row"><span>RAM:</span><span class="label-val">${d.ram}GB</span></div>` : ''}
        ${d.disk ? `<div class="row"><span>Disk:</span><span class="label-val">${d.disk}GB</span></div>` : ''}
        ${d.warrantyExpiry ? `<div class="row"><span>Warranty:</span><span class="label-val">${d.warrantyExpiry}</span></div>` : ''}
        <div class="qr-wrap">
          <div id="qrcode"></div>
        </div>
        <div class="footer">Scan QR for full device details · ${new Date().toLocaleDateString()}</div>
      </div>
      <script>
        new QRCode(document.getElementById('qrcode'), {
          text: ${JSON.stringify(qrData(d))},
          width:120, height:120, colorDark:'#000', colorLight:'#fff'
        });
        setTimeout(() => window.print(), 600);
      <\/script>
    </body>
    </html>
  `);
  win.document.close();
}

// ── DASHBOARD ──────────────────────────────────────────────
function updateDashboard() {
  const total = devices.length;
  const assigned = devices.filter(d => d.status === 'Assigned').length;
  const available = devices.filter(d => d.status === 'Available').length;
  const faulty = devices.filter(d => d.status === 'Faulty').length;

  document.getElementById('kpi-total').textContent = total;
  document.getElementById('kpi-assigned').textContent = assigned;
  document.getElementById('kpi-available').textContent = available;
  document.getElementById('kpi-faulty').textContent = faulty;
  document.getElementById('last-sync').textContent = 'Last sync: ' + new Date().toLocaleTimeString();

  // Chart
  const ctx = document.getElementById('dashboard-chart').getContext('2d');
  if (dashChart) dashChart.destroy();

  if (total === 0) {
    document.getElementById('dashboard-chart').style.display = 'none';
    return;
  }
  document.getElementById('dashboard-chart').style.display = 'block';

  dashChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Assigned', 'Available', 'Faulty'],
      datasets: [{
        data: [assigned, available, faulty],
        backgroundColor: ['#00e676', '#2979ff', '#ff1744'],
        borderColor: '#111827',
        borderWidth: 3,
        hoverBorderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#8899b0', font: { size: 12, family: 'IBM Plex Mono' }, padding: 20 }
        }
      },
      cutout: '68%'
    }
  });

  // Asset overview stats
  const deptEl = document.getElementById('dept-stats');
  if (total === 0) {
    deptEl.innerHTML = '<div class="empty-state"><div class="es-icon">📊</div><p>Add devices to see stats</p></div>';
    return;
  }

  const pct = (n) => total > 0 ? Math.round((n/total)*100) : 0;
  deptEl.innerHTML = `
    <div class="stat-row">
      <div class="s-label"><span style="color:var(--green)">●</span> Assigned</div>
      <div class="s-val" style="color:var(--green);">${pct(assigned)}%</div>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct(assigned)}%;background:var(--green);"></div></div>
    <div class="stat-row" style="margin-top:12px;">
      <div class="s-label"><span style="color:var(--blue)">●</span> Available</div>
      <div class="s-val" style="color:var(--blue);">${pct(available)}%</div>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct(available)}%;background:var(--blue);"></div></div>
    <div class="stat-row" style="margin-top:12px;">
      <div class="s-label"><span style="color:var(--red)">●</span> Faulty</div>
      <div class="s-val" style="color:var(--red);">${pct(faulty)}%</div>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct(faulty)}%;background:var(--red);"></div></div>
    <div class="divider"></div>
    <div class="stat-row">
      <div class="s-label">Total Registered</div>
      <div class="s-val">${total}</div>
    </div>
  `;

  // Recent activity
  const recentEl = document.getElementById('recent-activity');
  const recent = history.slice(0, 6);
  if (!recent.length) {
    recentEl.innerHTML = '<div class="empty-state"><div class="es-icon">📋</div><p>No activity yet</p></div>';
  } else {
    const actionEmoji = { Added:'📦', Assigned:'✅', Reassigned:'🔄', Faulty:'⚠️', Restored:'🔧' };
    const actionColor = { Added:'var(--blue)', Assigned:'var(--green)', Reassigned:'var(--orange)', Faulty:'var(--red)', Restored:'var(--accent)', Ticket:'#b400ff', Updated:'var(--text2)', Returned:'var(--text2)' };
    recentEl.innerHTML = recent.map(h => `
      <div class="history-item">
        <div class="history-dot dot-${h.action.toLowerCase()}" style="background:${actionColor[h.action]||'var(--blue)'}22;">
          <span>${actionEmoji[h.action]||'•'}</span>
        </div>
        <div class="history-body">
          <div class="history-action">
            <span style="color:${actionColor[h.action]||'var(--text)'};">${h.action}</span>
            — <span class="mono" style="font-size:12px;">${h.tag}</span> (${h.name})
          </div>
          <div class="history-meta">${h.user ? '👤 '+h.user+' · ' : ''}${formatDate(h.date)}</div>
        </div>
      </div>
    `).join('');
  }
}

// ── REPORTS ────────────────────────────────────────────────
function exportCSV(filter = 'all') {
  let data = devices;
  if (filter === 'assigned')  data = devices.filter(d => d.status === 'Assigned');
  if (filter === 'available') data = devices.filter(d => d.status === 'Available');
  if (filter === 'faulty')    data = devices.filter(d => d.status === 'Faulty');

  const headers = [
    'Asset Tag','Old Tag','Device Name','Brand','Serial Number','Category','Condition','OS',
    'Processor','Generation','RAM (GB)','ROM (GB)','Disk (GB)','Display',
    'Department','Assigned User','Status',
    'Date Purchased','Date Received','Date Assigned','Date Returned',
    'Warranty Expiry','End-of-Life Date',
    'Purchase Value (₦)','Current Value (₦)','Total Repair Cost (₦)',
    'Supplier','Invoice No','Notes','Added Date'
  ];
  const rows = data.map(d => {
    const repairCost = (d.tickets||[]).reduce((s,t)=>s+(parseFloat(t.cost)||0),0);
    return [
      d.tag, d.oldTag||'', d.name, d.brand||'', d.serial, d.category||'', d.condition||'', d.os||'',
      d.processor||'', d.generation||'', d.ram||'', d.rom||'', d.disk||'', d.display||'',
      d.dept||'', d.assignedUser||'', d.status,
      d.purchase||'', d.dateReceived||'', d.dateAssigned||'', d.dateReturned||'',
      d.warrantyExpiry||'', d.eolDate||'',
      d.purchaseValue||'', d.currentValue||'', repairCost||'',
      d.supplier||'', d.invoiceNo||'', d.notes||'',
      formatDate(d.addedDate)
    ];
  });

  downloadCSV('ITAssetTrack_' + filter + '_' + dateStamp() + '.csv', [headers, ...rows]);
  toast('Exported ' + data.length + ' records', 'success');
}

function exportHistoryCSV() {
  const headers = ['#','Date','Asset Tag','Serial','Device','Action','User','Notes'];
  const rows = history.map((h, i) => [
    i+1, formatDate(h.date), h.tag, h.serial, h.name, h.action, h.user||'', h.notes||''
  ]);
  downloadCSV('IT_History_' + dateStamp() + '.csv', [headers, ...rows]);
  toast('History exported', 'success');
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function renderReportSummary() {
  const el = document.getElementById('report-summary');
  const total = devices.length;
  const assigned = devices.filter(d => d.status === 'Assigned').length;
  const available = devices.filter(d => d.status === 'Available').length;
  const faulty = devices.filter(d => d.status === 'Faulty').length;

  el.innerHTML = `
    <div class="stat-row"><div class="s-label">Total Devices</div><div class="s-val mono">${total}</div></div>
    <div class="stat-row"><div class="s-label">Assigned</div><div class="s-val mono" style="color:var(--green);">${assigned}</div></div>
    <div class="stat-row"><div class="s-label">Available</div><div class="s-val mono" style="color:var(--blue);">${available}</div></div>
    <div class="stat-row"><div class="s-label">Faulty</div><div class="s-val mono" style="color:var(--red);">${faulty}</div></div>
    <div class="stat-row"><div class="s-label">History Records</div><div class="s-val mono">${history.length}</div></div>
  `;
}

// ── SETTINGS ───────────────────────────────────────────────
function loadSettingsForm() {
  document.getElementById('s-prefix').value = settings.prefix;
  document.getElementById('s-start').value = settings.start;
  document.getElementById('s-padding').value = settings.padding;
  document.getElementById('s-counter').value = settings.counter;
  updateTagPreview();
}

function updateTagPreview() {
  const prefix = document.getElementById('s-prefix').value.trim() || 'IT';
  const padding = parseInt(document.getElementById('s-padding').value) || 4;
  const counter = parseInt(document.getElementById('s-counter').value) || 1;
  document.getElementById('tag-preview-val').textContent = `${prefix}-${String(counter).padStart(padding,'0')}`;
  document.getElementById('tag-preview-next').textContent = `${prefix}-${String(counter+1).padStart(padding,'0')}`;
}

function saveSettings() {
  settings.prefix = document.getElementById('s-prefix').value.trim() || 'IT';
  settings.start = parseInt(document.getElementById('s-start').value) || 1;
  settings.padding = parseInt(document.getElementById('s-padding').value) || 4;
  settings.counter = parseInt(document.getElementById('s-counter').value) || 1;
  saveData();
  toast('Settings saved!', 'success');
  updateTagPreview();
}

// ── DELETE ─────────────────────────────────────────────────
function confirmDelete(id) {
  const d = devices.find(x => x.id === id);
  showConfirm(`Delete ${d.tag}?`, `This will permanently remove "${d.name}" from inventory.`, () => {
    devices = devices.filter(x => x.id !== id);
    saveData();
    toast(`${d.tag} deleted`, 'warning');
    renderInventory();
    updateDashboard();
    renderFaulty();
    refreshAssignSelects();
    refreshFaultySelect();
    updateFaultyBadge();
  });
}

function confirmClear() {
  showConfirm('Clear All Data?', 'This will permanently delete ALL devices, history, and reset settings.', () => {
    devices = []; history = [];
    settings = { prefix:'IT', start:1, padding:4, counter:1 };
    saveData();
    toast('All data cleared', 'warning');
    loadSettingsForm();
    renderInventory();
    updateDashboard();
    renderHistory();
    renderFaulty();
    refreshAssignSelects();
    refreshFaultySelect();
    updateFaultyBadge();
    renderReportSummary();
  });
}

// ── MODALS ─────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
});

let confirmCallback = null;
function showConfirm(title, msg, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = cb;
  document.getElementById('modal-confirm').classList.add('open');
}

document.getElementById('confirm-ok-btn').addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  closeModal('modal-confirm');
  confirmCallback = null;
});

// ── TOAST ──────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icon = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' }[type] || 'ℹ️';
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.style.opacity = '0', 3000);
  setTimeout(() => t.remove(), 3400);
}

// ── UTILS ──────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function dateStamp() {
  return new Date().toISOString().split('T')[0];
}

// ── IMPORT ─────────────────────────────────────────────────
let importParsedRows = [];   // all parsed rows ready for import
let importSkipped    = [];   // rows skipped as duplicates
let importUpdates    = [];   // existing devices to update (merge mode)
let importUsedCounterMax = null; // highest counter used for generated tags during import

function openImportModal() {
  resetImport();
  document.getElementById('modal-import').classList.add('open');
}
// ═══════════════════════════════════════════════════════════
// SMART IMPORT SYSTEM
// ═══════════════════════════════════════════════════════════

// All app fields and their aliases (what we try to auto-detect)
var APP_FIELDS = [
  { key:'tag',            label:'Asset Tag',         aliases:['asset tag','new tag','tag','asset_tag','assetid','id','asset no','asset number','asset#'] },
  { key:'oldTag',         label:'Old / Prev Tag',    aliases:['old tag','previous tag','old_tag','prev tag','former tag'] },
  { key:'name',           label:'Device Name',       aliases:['device name','device','model','name','description','item'] },
  { key:'brand',          label:'Brand / Make',      aliases:['brand','make','manufacturer','make/model','vendor brand'] },
  { key:'serial',         label:'Serial Number',     aliases:['serial number','serial','sn','serial_number','serial no','s/n','serialno'] },
  { key:'category',       label:'Category / Type',   aliases:['category','type','device type','asset type','item type','class'] },
  { key:'condition',      label:'Condition',         aliases:['condition','state','physical condition','device condition'] },
  { key:'os',             label:'Operating System',  aliases:['os','operating system','o/s','platform'] },
  { key:'processor',      label:'Processor / CPU',   aliases:['processor','cpu','processors','chip','processor model'] },
  { key:'generation',     label:'Generation',        aliases:['generation','gen','processor gen'] },
  { key:'ram',            label:'RAM (GB)',           aliases:['ram','ram (gb)','memory','memory (gb)','ram gb','memory gb','installed ram'] },
  { key:'rom',            label:'ROM / SSD (GB)',    aliases:['rom','ssd','rom (gb)','ssd (gb)','internal storage','storage (gb)','flash'] },
  { key:'disk',           label:'Disk / HDD (GB)',   aliases:['disk','hdd','disk (gb)','hdd (gb)','hard disk','hard drive','disk size'] },
  { key:'display',        label:'Display (inches)',  aliases:['display','screen','screen size','display size','monitor size'] },
  { key:'dept',           label:'Department',        aliases:['department','dept','division','unit','section','office','location'] },
  { key:'assignedUser',   label:'Assigned User',     aliases:['assigned user','user','staff','staff name','employee','assigned to','issued to','username','name of user'] },
  { key:'status',         label:'Status',            aliases:['status','state','availability','device status'] },
  { key:'purchase',       label:'Date Purchased',    aliases:['date purchased','purchase date','bought','date bought','procurement date','date of purchase'] },
  { key:'dateReceived',   label:'Date Received',     aliases:['date received','received','date received','received date','receipt date','date of receipt'] },
  { key:'dateAssigned',   label:'Date Assigned',     aliases:['date assigned','assigned date','issued date','date issued','date of assignment'] },
  { key:'dateReturned',   label:'Date Returned',     aliases:['date returned','returned','return date','date of return','retrieved date'] },
  { key:'warrantyExpiry', label:'Warranty Expiry',   aliases:['warranty','warranty expiry','warranty expiration','warranty date','warranty end','warranty end date'] },
  { key:'eolDate',        label:'End-of-Life Date',  aliases:['eol','end of life','eol date','retirement date','dispose date'] },
  { key:'purchaseValue',  label:'Purchase Value (₦)',aliases:['purchase value','value','cost','price','purchase price','amount','purchase amount','original cost'] },
  { key:'currentValue',   label:'Current Value (₦)', aliases:['current value','present value','book value','current price','resale value'] },
  { key:'supplier',       label:'Supplier / Vendor', aliases:['supplier','vendor','seller','purchased from','source','procurement source'] },
  { key:'invoiceNo',      label:'Invoice / PO No.',  aliases:['invoice','invoice no','po number','purchase order','po#','invoice number','lpo','lpo number'] },
  { key:'notes',          label:'Notes / Remarks',   aliases:['notes','remarks','comments','note','additional info','description','extra','info','column1'] },
];

var importRawRows    = [];   // raw rows from the file
var importColHeaders = [];   // original column headers from file
var importMapping    = {};   // { appFieldKey: 'Original Column Name' | '' }
var importCurrentStep = 1;

// ── Similarity scorer (fuzzy match) ──────────────────────────
function fieldSimilarity(colName, aliases) {
  var cn = colName.toLowerCase().replace(/[_\-\.]/g,' ').trim();
  // Exact match
  if (aliases.includes(cn)) return 100;
  // Starts with
  for (var a of aliases) { if (cn.startsWith(a) || a.startsWith(cn)) return 85; }
  // Contains
  for (var a of aliases) { if (cn.includes(a) || a.includes(cn)) return 70; }
  // Word overlap
  var cnWords = cn.split(' ');
  for (var a of aliases) {
    var aWords = a.split(' ');
    var overlap = cnWords.filter(w => aWords.includes(w)).length;
    if (overlap > 0) return 40 + (overlap * 10);
  }
  return 0;
}

// ── Auto-detect column mappings ───────────────────────────────
function autoDetectMapping(headers) {
  var mapping = {};
  var usedHeaders = new Set();

  APP_FIELDS.forEach(function(field) {
    var best = { score: 0, header: '' };
    headers.forEach(function(h) {
      if (usedHeaders.has(h)) return;
      var score = fieldSimilarity(h, field.aliases);
      if (score > best.score) { best.score = score; best.header = h; }
    });
    if (best.score >= 40) {
      mapping[field.key] = best.header;
      usedHeaders.add(best.header);
    } else {
      mapping[field.key] = '';
    }
  });
  return mapping;
}

function getImportMergeMode() {
  var el = document.getElementById('import-merge-toggle');
  return !!(el && el.checked);
}

function getAppFieldLabel(key) {
  var field = APP_FIELDS.find(function(f){ return f.key === key; });
  return field ? field.label : key;
}

function renderImportSummary() {
  var summaryEl = document.getElementById('import-map-summary');
  var countEl = document.getElementById('import-map-count');
  if (!summaryEl) return;

  var mapped = Object.entries(importMapping).filter(function(e){ return !!e[1]; });
  if (countEl) countEl.textContent = String(mapped.length);

  if (!mapped.length) {
    summaryEl.innerHTML = '<span class="chip" style="color:var(--text3);">No columns mapped yet</span>';
    return;
  }

  summaryEl.innerHTML = mapped.map(function(e) {
    var key = e[0];
    var col = e[1];
    return '<span class="chip" style="color:var(--accent);">' +
      escHtml(getAppFieldLabel(key)) + ' ← ' + escHtml(col) + '</span>';
  }).join('');
}

function renderImportWarnings() {
  var warnings = [];
  if (!importMapping.tag) {
    warnings.push('Missing Asset Tag column — tags will be generated using the current prefix (e.g., ' +
      settings.prefix + '-' + String(settings.counter).padStart(settings.padding,'0') + ').');
  }
  if (!importMapping.serial) {
    warnings.push('Missing Serial Number column — serials will be set to N/A.');
  }
  if (!importMapping.name) {
    warnings.push('Missing Device Name column — names will be generated from Brand/Type.');
  }

  var wEl = document.getElementById('import-warnings');
  if (!wEl) return;
  if (warnings.length) {
    wEl.style.display = 'block';
    wEl.innerHTML = '⚠️ ' + warnings.join('<br>');
  } else {
    wEl.style.display = 'none';
  }
}

function countDuplicateStats() {
  var existingTags    = new Set(devices.map(function(d){ return d.tag.toLowerCase(); }));
  var existingSerials = new Set(devices.map(function(d){ return d.serial.toLowerCase(); }));
  var mergeMode = getImportMergeMode();
  var updates = 0;
  var skips = 0;

  importRawRows.forEach(function(row) {
    var tagCol = importMapping['tag'] ? String(row[importMapping['tag']]||'').trim() : '';
    var snCol  = importMapping['serial'] ? String(row[importMapping['serial']]||'').trim() : '';
    var hasDup = (tagCol && existingTags.has(tagCol.toLowerCase())) ||
                 (snCol  && existingSerials.has(snCol.toLowerCase()));
    if (hasDup) {
      if (mergeMode) updates++;
      else skips++;
    }
  });

  return { updates: updates, skips: skips };
}

// ── STEP 1 → 2: File uploaded ────────────────────────────────
function handleImportFile(file) {
  if (!file) return;
  var ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls','csv'].includes(ext)) {
    toast('Unsupported file type. Use .xlsx, .xls, or .csv', 'error'); return;
  }

  var dz = document.getElementById('import-drop-zone');
  document.getElementById('dz-icon').textContent = '⏳';
  document.getElementById('dz-text').textContent = 'Reading ' + file.name + '…';
  document.getElementById('dz-sub').textContent = 'Analysing columns…';

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var rows = [];
      if (ext === 'csv') {
        rows = parseCSVImport(e.target.result);
      } else {
        if (typeof XLSX === 'undefined') {
          throw new Error('XLSX library failed to load. Refresh the page and try again.');
        }
        var wb = XLSX.read(e.target.result, { type:'array', cellDates:true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval:'', raw:false });
      }

      if (!rows.length) { toast('No data rows found in file', 'error'); return; }

      // Drop completely empty rows (common in CSV exports)
      rows = rows.filter(r => Object.values(r).some(v => String(v).trim() !== ''));
      if (!rows.length) { toast('No data rows found in file', 'error'); return; }

      importRawRows = rows;
      importColHeaders = Object.keys(rows[0]);
      importMapping = autoDetectMapping(importColHeaders);

      renderColumnMapper();
      goToImportStep(2);

    } catch(err) {
      toast('Failed to read file: ' + err.message, 'error');
      document.getElementById('dz-icon').textContent = '❌';
      document.getElementById('dz-text').textContent = 'Error reading file. Try again.';
      document.getElementById('dz-sub').textContent = err && err.message ? err.message : 'Please check the file and try again.';
    }
  };
  if (ext === 'csv') reader.readAsText(file);
  else               reader.readAsArrayBuffer(file);
}

// ── Render the column mapping table ──────────────────────────
function renderColumnMapper() {
  var tbody = document.getElementById('col-map-body');
  var fieldOptions = '<option value="">— Skip this column —</option>' +
    APP_FIELDS.map(function(f) {
      return '<option value="' + f.key + '">' + f.label + '</option>';
    }).join('');

  // Show mapped columns (one row per app field that has a detected match)
  // Plus allow manual assignment for all file columns
  var rows = '';
  var mappedFileHeaders = new Set(Object.values(importMapping).filter(Boolean));

  // Rows for each file column
  importColHeaders.forEach(function(col) {
    // Find which app field this column is mapped to
    var mappedTo = '';
    Object.entries(importMapping).forEach(function(e) {
      if (e[1] === col) mappedTo = e[0];
    });

    // Sample value
    var sample = '';
    for (var i = 0; i < Math.min(3, importRawRows.length); i++) {
      var v = String(importRawRows[i][col] || '').trim();
      if (v) { sample = v; break; }
    }

    var isMatched = mappedTo !== '';
    var selectHtml = '<select class="col-map-select ' + (isMatched ? 'matched' : 'unmatched') + '" ' +
      'data-col="' + escAttr(col) + '" onchange="onMappingChange(this)">' + fieldOptions + '</select>';

    // Set selected option
    var opts = '<option value="">— Skip this column —</option>' +
      APP_FIELDS.map(function(f) {
        return '<option value="' + f.key + '"' + (f.key === mappedTo ? ' selected' : '') + '>' + f.label + '</option>';
      }).join('');
    selectHtml = '<select class="col-map-select ' + (isMatched ? 'matched' : 'unmatched') + '" ' +
      'data-col="' + escAttr(col) + '" onchange="onMappingChange(this)">' + opts + '</select>';

    rows += '<tr class="col-map-row">' +
      '<td><span style="font-family:var(--mono);font-size:11px;color:var(--text);">' + escHtml(col) + '</span></td>' +
      '<td style="color:var(--text3);">' + (isMatched ? '<span style="color:var(--green);">✓</span>' : '→') + '</td>' +
      '<td>' + selectHtml + '</td>' +
      '<td><span class="sample-val" title="' + escAttr(sample) + '">' + escHtml(sample) + '</span></td>' +
      '</tr>';
  });

  tbody.innerHTML = rows;

  // Stats
  var stats = countDuplicateStats();
  document.getElementById('imp-total').textContent = importRawRows.length;
  document.getElementById('imp-new').textContent   = importRawRows.length - stats.skips - stats.updates;
  document.getElementById('imp-update').textContent = stats.updates;
  document.getElementById('imp-skip').textContent  = stats.skips;

  renderImportSummary();
  renderImportWarnings();
}

function onMappingChange(select) {
  var col      = select.getAttribute('data-col');
  var newField = select.value;

  // Remove this column from any existing mapping
  Object.keys(importMapping).forEach(function(k) {
    if (importMapping[k] === col) importMapping[k] = '';
  });
  // If a field is selected, also remove it from any other column
  if (newField) {
    Object.keys(importMapping).forEach(function(k) {
      if (k !== newField && importMapping[k] === col) importMapping[k] = '';
    });
    importMapping[newField] = col;
  }
  select.className = 'col-map-select ' + (newField ? 'matched' : 'unmatched');
  renderImportSummary();
  renderImportWarnings();
}

function countDuplicates() {
  return countDuplicateStats().skips;
}

// ── STEP 2 → 3: Apply mapping & build preview ────────────────
function applyMappingAndPreview() {
  importParsedRows = [];
  importSkipped    = [];
  importUpdates    = [];
  importUsedCounterMax = null;

  var existingTags    = new Set(devices.map(function(d){ return d.tag.toLowerCase(); }));
  var existingSerials = new Set(devices.map(function(d){ return d.serial.toLowerCase(); }));
  var existingByTag    = new Map(devices.map(function(d){ return [d.tag.toLowerCase(), d]; }));
  var existingBySerial = new Map(devices.map(function(d){ return [d.serial.toLowerCase(), d]; }));
  var seenTags        = new Set();
  var seenSerials     = new Set();
  var mergeMode       = getImportMergeMode();
  var tempCounter     = settings.counter;

  function nextImportTag() {
    var candidate = '';
    while (true) {
      candidate = genTag(tempCounter);
      tempCounter++;
      var low = candidate.toLowerCase();
      if (!existingTags.has(low) && !seenTags.has(low)) break;
    }
    var num = parseInt(candidate.split('-').pop());
    if (!isNaN(num)) {
      importUsedCounterMax = importUsedCounterMax === null ? num : Math.max(importUsedCounterMax, num);
    }
    return candidate;
  }

  function buildMergePatch(existing, incoming) {
    var fields = [
      'tag','name','brand','serial','oldTag','category','condition','os','processor','generation',
      'ram','rom','disk','display','dept','assignedUser','assignedDept','status','purchase',
      'dateReceived','dateAssigned','dateReturned','warrantyExpiry','eolDate',
      'purchaseValue','currentValue','supplier','invoiceNo','notes'
    ];
    var patch = {};
    fields.forEach(function(k) {
      var v = incoming[k];
      if (v === undefined || v === null) return;
      if (typeof v === 'string' && v.trim() === '') return;
      if (k === 'serial' && String(v).trim().toUpperCase() === 'N/A') return;
      if (String(existing[k] || '').trim() !== String(v).trim()) patch[k] = v;
    });
    return patch;
  }

  function normalizeConditionVal(val) {
    var c = String(val || '').trim().toLowerCase();
    return ['excellent','good','fair','poor'].includes(c) ? c : 'good';
  }

  importRawRows.forEach(function(row, idx) {
    // Pull each field using mapping
    function getField(fieldKey, fallback) {
      var col = importMapping[fieldKey];
      if (!col) return fallback || '';
      var raw = row[col];
      if (raw === undefined || raw === null) return fallback || '';
      return String(raw).trim();
    }

    var generatedTag = false;
    var tag    = getField('tag');
    var serial = getField('serial') || 'N/A';
    var name   = getField('name');
    var brand  = getField('brand');

    // Build name if not found
    if (!name && brand) name = brand + ' Device';
    if (!name) name = 'Unknown Device';

    // Skip blank rows
    if (!name.trim() && !serial.trim() && !tag.trim()) return;

    // Duplicate detection / merge mode
    var tagLower = tag ? tag.toLowerCase() : '';
    var serialLower = serial !== 'N/A' ? serial.toLowerCase() : '';
    var tagMatch = tagLower ? existingByTag.get(tagLower) : null;
    var serialMatch = serialLower ? existingBySerial.get(serialLower) : null;

    if (tagMatch || serialMatch) {
      if (mergeMode) {
        if (tagMatch && serialMatch && tagMatch.id !== serialMatch.id) {
          importSkipped.push({ tag, name, serial, reason:'Conflicting tag/serial' }); return;
        }
        var target = tagMatch || serialMatch;
        var patch = buildMergePatch(target, {
          id: target.id,
          tag: generatedTag ? '' : tag,
          name: name,
          brand: brand,
          serial: serial,
          oldTag: getField('oldTag'),
          category: getField('category') || guessCategory(brand, getField('name'), ''),
          condition: normalizeConditionVal(getField('condition')),
          os: getField('os'),
          processor: getField('processor'),
          generation: getField('generation'),
          ram: getNum('ram'),
          rom: getNum('rom'),
          disk: getNum('disk'),
          display: getField('display'),
          dept: getField('dept'),
          assignedUser: getField('assignedUser'),
          assignedDept: getField('dept'),
          status: status,
          purchase: getDate('purchase'),
          dateReceived: getDate('dateReceived'),
          dateAssigned: getDate('dateAssigned'),
          dateReturned: getDate('dateReturned'),
          warrantyExpiry: getDate('warrantyExpiry'),
          eolDate: getDate('eolDate'),
          purchaseValue: getNum('purchaseValue'),
          currentValue: getNum('currentValue'),
          supplier: getField('supplier'),
          invoiceNo: getField('invoiceNo'),
          notes: getField('notes')
        });
        if (!Object.keys(patch).length) {
          importSkipped.push({ tag, name, serial, reason:'No new data to merge' }); return;
        }
        importUpdates.push({ id: target.id, patch: patch, tag: target.tag, name: target.name });
        return;
      } else {
        if (tagMatch) { importSkipped.push({ tag, name, serial, reason:'Duplicate tag' }); return; }
        if (serialMatch) { importSkipped.push({ tag, name, serial, reason:'Duplicate serial' }); return; }
      }
    }

    if (!tag) { tag = nextImportTag(); generatedTag = true; tagLower = tag.toLowerCase(); }
    seenTags.add(tagLower);
    if (serial !== 'N/A') seenSerials.add(serial.toLowerCase());

    var user   = getField('assignedUser');
    var dept   = getField('dept');
    var status = getField('status');
    var statusNorm = String(status || '').trim().toLowerCase();
    if (statusNorm === 'assigned' || statusNorm === 'in use' || statusNorm === 'issued') status = 'Assigned';
    else if (statusNorm === 'available' || statusNorm === 'in stock' || statusNorm === 'spare') status = 'Available';
    else if (statusNorm === 'faulty' || statusNorm === 'damaged' || statusNorm === 'repair') status = 'Faulty';
    else status = user ? 'Assigned' : 'Available';

    // Clean numeric fields
    function getNum(k) {
      var v = getField(k,'').replace(/[^0-9.]/g,'');
      return v ? parseFloat(v) : '';
    }

    // Clean date fields
    function getDate(k) {
      var v = getField(k,'');
      if (!v) return '';
      // Already looks like a date string
      if (/\d{4}-\d{2}-\d{2}/.test(v)) return v.match(/\d{4}-\d{2}-\d{2}/)[0];
      // Try parsing
      try {
        var d = new Date(v);
        if (!isNaN(d)) return d.toISOString().split('T')[0];
      } catch(e) {}
      return v;
    }

    var categoryRaw = getField('category');
    var category = categoryRaw || guessCategory(brand, getField('name'), '');

    var device = {
      id:             Date.now().toString() + Math.random().toString(36).slice(2),
      tag:            tag,
      name:           name,
      brand:          brand,
      serial:         serial,
      oldTag:         getField('oldTag'),
      category:       category,
      condition:      normalizeConditionVal(getField('condition')),
      os:             getField('os'),
      processor:      getField('processor'),
      generation:     getField('generation'),
      ram:            getNum('ram'),
      rom:            getNum('rom'),
      disk:           getNum('disk'),
      display:        getField('display'),
      dept:           dept,
      assignedUser:   user,
      assignedDept:   dept,
      status:         status,
      purchase:       getDate('purchase'),
      dateReceived:   getDate('dateReceived'),
      dateAssigned:   getDate('dateAssigned'),
      dateReturned:   getDate('dateReturned'),
      warrantyExpiry: getDate('warrantyExpiry'),
      eolDate:        getDate('eolDate'),
      purchaseValue:  getNum('purchaseValue'),
      currentValue:   getNum('currentValue'),
      supplier:       getField('supplier'),
      invoiceNo:      getField('invoiceNo'),
      notes:          getField('notes'),
      addedDate:      new Date().toISOString(),
      tickets:        [],
    };

  importParsedRows.push(device);
  });

  // Update step 3 stats
  document.getElementById('imp-total-3').textContent = importRawRows.length;
  document.getElementById('imp-new-3').textContent   = importParsedRows.length;
  document.getElementById('imp-update-3').textContent = importUpdates.length;
  document.getElementById('imp-skip-3').textContent  = importSkipped.length;
  document.getElementById('import-confirm-count').textContent = importParsedRows.length + importUpdates.length;

  // Render preview table
  var previewRows = importParsedRows.slice(0, 8);
  var cols = ['tag','name','serial','category','ram','disk','status','assignedUser','dept','purchase'];
  var colLabels = ['Tag','Device','Serial','Category','RAM','Disk','Status','User','Dept','Purchased'];

  document.getElementById('import-preview-head').innerHTML = colLabels.map(function(h) {
    return '<th style="background:var(--surface2);color:var(--text3);font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:8px 12px;border-bottom:1px solid var(--border);font-family:var(--mono);white-space:nowrap;">' + h + '</th>';
  }).join('');

  document.getElementById('import-preview-body').innerHTML = previewRows.length ?
    previewRows.map(function(d, i) {
      return '<tr style="background:' + (i%2?'var(--surface2)':'var(--surface)') + ';border-bottom:1px solid var(--border);">' +
        '<td style="padding:7px 12px;font-family:var(--mono);font-size:11px;color:var(--accent);">' + escHtml(d.tag) + '</td>' +
        '<td style="padding:7px 12px;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(d.name) + '</td>' +
        '<td style="padding:7px 12px;font-family:var(--mono);font-size:10px;color:var(--text3);">' + escHtml(d.serial) + '</td>' +
        '<td style="padding:7px 12px;font-size:11px;">' + escHtml(d.category) + '</td>' +
        '<td style="padding:7px 12px;font-family:var(--mono);font-size:11px;">' + (d.ram ? d.ram+'GB' : '—') + '</td>' +
        '<td style="padding:7px 12px;font-family:var(--mono);font-size:11px;">' + (d.disk ? d.disk+'GB' : '—') + '</td>' +
        '<td style="padding:7px 12px;">' + statusBadge(d.status) + '</td>' +
        '<td style="padding:7px 12px;font-size:11px;">' + escHtml(d.assignedUser||'—') + '</td>' +
        '<td style="padding:7px 12px;font-size:11px;">' + escHtml(d.dept||'—') + '</td>' +
        '<td style="padding:7px 12px;font-size:11px;font-family:var(--mono);">' + escHtml(d.purchase||'—') + '</td>' +
      '</tr>';
    }).join('') :
    '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text3);">' +
      (importUpdates.length ? 'No new devices. ' + importUpdates.length + ' update' + (importUpdates.length>1?'s':'') + ' will be applied.' :
       'No importable rows found. Go back and check your column mapping.') +
    '</td></tr>';

  // Skipped rows
  if (importSkipped.length) {
    document.getElementById('skipped-wrap').style.display = 'block';
    document.getElementById('skipped-list').innerHTML = importSkipped.map(function(s) {
      return '<div style="padding:2px 0;">' + escHtml(s.tag) + ' · ' + escHtml(s.name) + ' — <span style="color:var(--orange);">' + escHtml(s.reason) + '</span></div>';
    }).join('');
  }

  document.getElementById('import-confirm-btn').style.display = importParsedRows.length ? 'inline-flex' : 'none';
  goToImportStep(3);
}

// ── Step navigation ───────────────────────────────────────────
function goToImportStep(step) {
  importCurrentStep = step;
  [1,2,3].forEach(function(s) {
    document.getElementById('import-step-' + s).style.display = s === step ? 'block' : 'none';
    var dot = document.getElementById('sdot-' + s);
    dot.className = 'import-step-dot' + (s < step ? ' done' : s === step ? ' active' : '');
    if (s < step) dot.textContent = '✓';
    else dot.textContent = String(s);
  });

  var labels = {
    1: 'Upload any Excel or CSV — the app will auto-detect your columns',
    2: 'Review & adjust column mapping, then click Apply',
    3: 'Preview imported data and confirm'
  };
  document.getElementById('import-step-label').textContent = labels[step];
  document.getElementById('import-back-btn').style.display = step > 1 ? 'inline-flex' : 'none';
}

function importGoBack() {
  if (importCurrentStep > 1) goToImportStep(importCurrentStep - 1);
}

// ── Confirm Import ────────────────────────────────────────────
// ── Reset ─────────────────────────────────────────────────────
function resetImport() {
  importRawRows = []; importColHeaders = []; importMapping = {};
  importParsedRows = []; importSkipped = []; importUpdates = [];
  importUsedCounterMax = null;
  document.getElementById('import-file-input').value = '';
  document.getElementById('dz-icon').textContent  = '📊';
  document.getElementById('dz-text').textContent  = 'Click to browse or drag & drop your file here';
  document.getElementById('dz-sub').textContent   = 'Accepts any .xlsx, .xls or .csv file — any column names, any format';
  document.getElementById('import-confirm-btn').style.display = 'none';
  document.getElementById('import-warnings').style.display   = 'none';
  var mergeEl = document.getElementById('import-merge-toggle');
  if (mergeEl) mergeEl.checked = false;
  var mapSummary = document.getElementById('import-map-summary');
  if (mapSummary) mapSummary.innerHTML = '';
  var mapCount = document.getElementById('import-map-count');
  if (mapCount) mapCount.textContent = '0';
  var upd = document.getElementById('imp-update');
  if (upd) upd.textContent = '0';
  var upd3 = document.getElementById('imp-update-3');
  if (upd3) upd3.textContent = '0';
  try { document.getElementById('skipped-wrap').style.display = 'none'; } catch(e) {}
  goToImportStep(1);
}

// ── Download Template ─────────────────────────────────────────
function downloadImportTemplate() {
  var headers = APP_FIELDS.map(function(f){ return f.label; });
  var example = [
    'MSC-0001','','HP EliteBook 840 G9','HP','5CG2040KLM','Laptop','Good','Windows 11 Pro',
    'Intel Core i7-1265U','12th Gen','16','256','1000','15.6',
    'Finance','John Doe','Assigned',
    '2023-01-15','2023-01-20','2023-01-22','','2026-01-15','2027-01-15',
    '450000','380000','TechMart Ltd','INV-2023-0042','Good condition'
  ];
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet([headers, example]);

  // Column widths
  ws['!cols'] = headers.map(function(){ return { wch:20 }; });

  XLSX.utils.book_append_sheet(wb, ws, 'Devices');
  XLSX.writeFile(wb, 'ITAssetTrack_Import_Template.xlsx');
  toast('✅ Template downloaded', 'success');
}


function guessCategory(brand, device, model) {
  const all = [brand,device,model].map(s => String(s||'').toLowerCase()).join(' ');
  if (all.includes('biometric') || all.includes('fingerprint')) return 'Biometric';
  if (all.includes('external hd') || all.includes('seagate') || all.includes('hdd')) return 'External Storage';
  if (all.includes('blower')) return 'Equipment';
  if (all.includes('all-in-one') || all.includes('desktop') || all.includes('aegis') || all.includes('ms-7')) return 'Desktop';
  if (all.includes('monitor') || all.includes('display')) return 'Monitor';
  if (all.includes('printer')) return 'Printer';
  if (all.includes('phone') || all.includes('mobile')) return 'Phone';
  if (all.includes('tablet') || all.includes('ipad')) return 'Tablet';
  if (all.includes('laptop') || all.includes('elitebook') || all.includes('thinkpad') ||
      all.includes('macbook') || all.includes('zbook') || all.includes('latitude') ||
      all.includes('xps') || all.includes('alienware') || all.includes('rog') ||
      all.includes('tuf') || all.includes('ge66') || all.includes('raider')) return 'Laptop';
  return 'Other';
}

function confirmImport() {
  if (!importParsedRows.length && !importUpdates.length) { toast('Nothing to import', 'error'); return; }

  // Capture counts BEFORE clearing arrays
  const importedCount = importParsedRows.length;
  const updatedCount  = importUpdates.length;
  const skippedCount  = importSkipped.length;

  devices.push(...importParsedRows);

  // Log each new import in history
  importParsedRows.forEach(d => {
    addHistory(d, 'Added', d.assignedUser || '', `Imported · ${d.processor ? d.processor+' · ' : ''}${d.ram ? d.ram+'GB RAM' : ''}`);
    if (d.status === 'Assigned' && d.assignedUser) {
      addHistory(d, 'Assigned', d.assignedUser, `Dept: ${d.dept}`);
    }
  });

  // Apply merge updates
  importUpdates.forEach(u => {
    const d = devices.find(x => x.id === u.id);
    if (!d) return;
    const changedKeys = Object.keys(u.patch || {});
    changedKeys.forEach(k => { d[k] = u.patch[k]; });
    if (changedKeys.length) {
      addHistory(d, 'Updated', '', `Import merge · ${changedKeys.join(', ')}`);
    }
  });

  // Bump counter if imported tags match current prefix
  function bumpCounterFromTag(tag) {
    if (!tag) return;
    if (tag.startsWith(settings.prefix + '-')) {
      const num = parseInt(tag.split('-').pop());
      if (!isNaN(num) && num >= settings.counter) settings.counter = num + 1;
    }
  }
  importParsedRows.forEach(d => bumpCounterFromTag(d.tag));
  importUpdates.forEach(u => {
    if (u.patch && u.patch.tag) bumpCounterFromTag(u.patch.tag);
  });
  if (importUsedCounterMax !== null) {
    settings.counter = Math.max(settings.counter, importUsedCounterMax + 1);
  }

  // Clear BEFORE saveData
  importParsedRows = [];
  importUpdates    = [];
  importSkipped    = [];
  importUsedCounterMax = null;

  saveData();
  closeModal('modal-import');

  // Toast uses saved counts
  let msg = `✅ Applied ${importedCount} import${importedCount!==1?'s':''}`;
  if (updatedCount) msg += ` · ${updatedCount} update${updatedCount!==1?'s':''}`;
  if (skippedCount) msg += ` · ${skippedCount} skipped`;
  toast(msg, 'success');

  renderInventory();
  updateDashboard();
  renderHistory();
  renderFaulty();
  refreshAssignSelects();
  refreshFaultySelect();
  updateFaultyBadge();
  renderReportSummary();
}

// Drag & drop on the zone
document.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('import-drop-zone');
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleImportFile(file);
  });

  const mergeToggle = document.getElementById('import-merge-toggle');
  if (mergeToggle) {
    mergeToggle.addEventListener('change', () => {
      if (!importRawRows.length) return;
      renderColumnMapper();
    });
  }
});

function parseCSVImport(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(cols[i] || '').trim(); });
    return obj;
  });
}

// ── GOOGLE SHEETS SYNC (v1.5) ──────────────────────────────

const SHEETS_CONFIG_KEY = 'itassettrack_sheets_config';
const SYNC_VERSION = '1.5';
let sheetsConfig = null;
let syncStatus = 'local'; // local | online | syncing | offline
let lastSyncTime = null;
let syncInterval = null;
let isSyncing = false;

// ── Apps Script deployed URL structure ─────────────────────
// The Apps Script acts as a REST proxy:
//   GET  ?action=read              → returns all data JSON
//   POST action=write, data={}     → writes all data, returns {ok:true}

function loadSheetsConfig() {
  try {
    sheetsConfig = JSON.parse(localStorage.getItem(SHEETS_CONFIG_KEY));
  } catch(e) { sheetsConfig = null; }
  updateSyncBar();
}

function saveSheetsConfig(cfg) {
  sheetsConfig = cfg;
  localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(cfg));
}

function getSheetsUrl() {
  return sheetsConfig && sheetsConfig.scriptUrl ? sheetsConfig.scriptUrl : null;
}

// ── SYNC BAR UI ─────────────────────────────────────────────
function updateSyncBar() {
  const bar = document.getElementById('sync-bar');
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  const timeEl = document.getElementById('sync-time');
  if (!bar) return;

  const url = getSheetsUrl();
  if (!url) {
    dot.className = 'sync-dot local';
    txt.textContent = 'Google Sheets: Not configured — running locally';
    timeEl.textContent = '';
    return;
  }

  const states = {
    local:   ['local',   'Local mode only'],
    online:  ['online',  'Synced with Google Sheets'],
    syncing: ['syncing', 'Syncing…'],
    offline: ['offline', 'Sync failed — check connection'],
  };
  const [cls, label] = states[syncStatus] || states.local;
  dot.className = `sync-dot ${cls}`;
  txt.textContent = label;
  timeEl.textContent = lastSyncTime
    ? `Last sync: ${new Date(lastSyncTime).toLocaleTimeString()}`
    : '';
}

function setSyncStatus(s) {
  syncStatus = s;
  updateSyncBar();
}

// ── PULL from Google Sheets ─────────────────────────────────
async function pullFromSheets() {
  const url = getSheetsUrl();
  if (!url || isSyncing) return false;
  isSyncing = true;
  setSyncStatus('syncing');

  try {
    const res = await fetch(`${url}?action=read&v=${Date.now()}`, {
      method: 'GET',
      mode: 'cors',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.devices !== undefined) {
      devices  = data.devices  || [];
      history  = data.history  || [];
      settings = { ...settings, ...(data.settings || {}) };
      saveData(); // also save locally as cache
      lastSyncTime = new Date().toISOString();
      setSyncStatus('online');
      isSyncing = false;
      return true;
    }
    throw new Error('Invalid response structure');
  } catch(err) {
    console.error('Pull failed:', err);
    setSyncStatus('offline');
    isSyncing = false;
    return false;
  }
}

// ── PUSH to Google Sheets ───────────────────────────────────
async function pushToSheets() {
  const url = getSheetsUrl();
  if (!url) return false;
  setSyncStatus('syncing');

  try {
    const payload = {
      action: 'write',
      data: JSON.stringify({ devices, history, settings })
    };
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload).toString()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (result.ok) {
      lastSyncTime = new Date().toISOString();
      setSyncStatus('online');
      return true;
    }
    throw new Error(result.error || 'Write failed');
  } catch(err) {
    console.error('Push failed:', err);
    setSyncStatus('offline');
    return false;
  }
}

// ── AUTO SYNC every 30 seconds ──────────────────────────────
function startAutoSync() {
  if (!getSheetsUrl()) return;
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    const ok = await pullFromSheets();
    if (ok) {
      renderInventory();
      updateDashboard();
      renderHistory();
      renderFaulty();
      refreshAssignSelects();
      updateFaultyBadge();
    }
  }, 30000); // every 30s
}

function stopAutoSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
}

// ── Override saveData to also push ─────────────────────────
const _origSaveData = saveData;
// Reassign instead of redeclare to avoid hoisting recursion.
saveData = function saveDataWithSheets() {
  _origSaveData();
  if (getSheetsUrl()) {
    pushToSheets(); // fire and forget
  }
};

// ── SETUP WIZARD ────────────────────────────────────────────
let setupStep = 1;
const TOTAL_STEPS = 4;

const APPS_SCRIPT_CODE = `function doGet(e) {
  return handleRequest(e);
}
function doPost(e) {
  return handleRequest(e);
}
function handleRequest(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  var action = (e.parameter && e.parameter.action) || 'read';
  
  if (action === 'read') {
    var dataSheet = sheet.getSheetByName('ITData') || sheet.insertSheet('ITData');
    var cell = dataSheet.getRange('A1').getValue();
    var data = cell ? JSON.parse(cell) : {devices:[],history:[],settings:{}};
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'write') {
    var dataSheet = sheet.getSheetByName('ITData') || sheet.insertSheet('ITData');
    var incoming = JSON.parse(e.parameter.data || '{}');
    dataSheet.getRange('A1').setValue(JSON.stringify(incoming));
    dataSheet.getRange('B1').setValue(new Date().toISOString());
    return ContentService
      .createTextOutput(JSON.stringify({ok:true}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({error:'Unknown action'}))
    .setMimeType(ContentService.MimeType.JSON);
}`;

function openSetupWizard() {
  setupStep = 1;
  renderSetupStep();
  const overlay = document.getElementById('setup-overlay');
  if (!overlay) { toast('Setup wizard UI is not available in this build.', 'error'); return; }
  overlay.classList.add('open');
}

function closeSetupWizard() {
  const overlay = document.getElementById('setup-overlay');
  if (overlay) overlay.classList.remove('open');
}

function renderSetupStep() {
  const steps = document.querySelectorAll('.setup-step');
  const activeStep = document.getElementById(`setup-step-${setupStep}`);
  if (!steps.length || !activeStep) return;

  steps.forEach(s => s.classList.remove('active'));
  activeStep.classList.add('active');

  // Progress pips (optional in some templates)
  const pips = document.querySelectorAll('.setup-pip');
  if (!pips.length) return;
  pips.forEach((p, i) => {
    p.className = 'setup-pip' + (i+1 < setupStep ? ' done' : i+1 === setupStep ? ' active' : '');
  });
}

function setupNext() {
  if (setupStep === 3) {
    // Validate URL before proceeding
    const urlEl = document.getElementById('setup-script-url');
    if (!urlEl) { toast('Setup wizard UI is not available in this build.', 'error'); return; }
    const url = urlEl.value.trim();
    if (!url.includes('script.google.com') && !url.startsWith('https://')) {
      toast('Please enter a valid Google Apps Script URL', 'error'); return;
    }
    saveSheetsConfig({ scriptUrl: url, setupAt: new Date().toISOString() });
  }
  if (setupStep < TOTAL_STEPS) { setupStep++; renderSetupStep(); }
  else {
    closeSetupWizard();
    toast('✅ Google Sheets sync configured!', 'success');
    pullFromSheets().then(ok => {
      if (ok) {
        renderInventory(); updateDashboard(); renderHistory();
        renderFaulty(); refreshAssignSelects(); updateFaultyBadge();
        toast('📥 Data pulled from Google Sheets', 'success');
      }
    });
    startAutoSync();
    renderSheetsSettings();
  }
}

function setupBack() {
  if (setupStep > 1) { setupStep--; renderSetupStep(); }
}

function copyScriptCode() {
  navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
    toast('Apps Script code copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = APPS_SCRIPT_CODE;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Code copied!', 'success');
  });
}

function disconnectSheets() {
  stopAutoSync();
  localStorage.removeItem(SHEETS_CONFIG_KEY);
  sheetsConfig = null;
  setSyncStatus('local');
  renderSheetsSettings();
  toast('Google Sheets disconnected', 'warning');
}

function renderSheetsSettings() {
  const el = document.getElementById('sheets-settings-content');
  if (!el) return;
  const url = getSheetsUrl();
  if (url) {
    el.innerHTML = `
      <div class="sheets-status-card">
        <div class="sheets-status-icon">✅</div>
        <div>
          <div class="sheets-status-label">Connected to Google Sheets</div>
          <div class="sheets-status-sub">${url.substring(0,60)}…</div>
        </div>
      </div>
      <div class="flex-row">
        <button class="btn btn-outline" onclick="pullFromSheets().then(ok=>{if(ok){renderInventory();updateDashboard();renderHistory();renderFaulty();refreshAssignSelects();updateFaultyBadge();toast('Pulled latest data','success');}else toast('Sync failed','error');})">📥 Pull Now</button>
        <button class="btn btn-outline" onclick="pushToSheets().then(ok=>toast(ok?'Pushed to Sheets':'Push failed — check URL',ok?'success':'error'))">📤 Push Now</button>
        <button class="btn btn-danger" onclick="disconnectSheets()">🔌 Disconnect</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="sheets-status-card">
        <div class="sheets-status-icon">📊</div>
        <div>
          <div class="sheets-status-label">Not Connected</div>
          <div class="sheets-status-sub">Connect to Google Sheets to sync data across devices</div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="openSetupWizard()">🔗 Connect Google Sheets</button>`;
  }
}

// ── INIT SYNC on app load ────────────────────────────────────
function initSync() {
  loadSheetsConfig();
  renderSheetsSettings();
  if (getSheetsUrl()) {
    pullFromSheets().then(ok => {
      if (ok) {
        renderInventory(); updateDashboard(); renderHistory();
        renderFaulty(); refreshAssignSelects(); updateFaultyBadge();
      }
    });
    startAutoSync();
  }
}
// ── LICENSE SYSTEM ─────────────────────────────────────────
// Valid license keys — replace/add your real Gumroad keys here
// Format: ITAT-XXXX-XXXX-XXXX  (ITAssetTrack prefix)
const VALID_LICENSES = [
  // These are the keys you generate and embed per sale
  // For Gumroad: use their license key API or embed static keys
  'ITAT-2024-PRO1-BETA',
  'ITAT-2024-PRO2-BETA',
  'ITAT-DEMO-FULL-0001',
  'ITAT-DEMO-FULL-0002',
  'ITAT-DEMO-FULL-0003',
  // Add more keys below as you sell on Gumroad:
  // 'ITAT-XXXX-XXXX-XXXX',
];

const TRIAL_DAYS = 7;
const LICENSE_KEY = 'itassettrack_license';
const TRIAL_KEY   = 'itassettrack_trial_start';

function formatLicenseKey(input) {
  let val = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Auto-insert dashes: ITAT-XXXX-XXXX-XXXX
  let formatted = '';
  for (let i = 0; i < val.length && i < 16; i++) {
    if (i === 4 || i === 8 || i === 12) formatted += '-';
    formatted += val[i];
  }
  input.value = formatted;
}

function activateLicense() {
  const key = document.getElementById('license-key-input').value.trim().toUpperCase();
  const errEl = document.getElementById('license-error');
  const okEl  = document.getElementById('license-success');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!key || key.length < 10) {
    errEl.textContent = 'Please enter a valid license key.';
    errEl.style.display = 'block'; return;
  }

  if (VALID_LICENSES.includes(key)) {
    // Valid — save and proceed
    localStorage.setItem(LICENSE_KEY, JSON.stringify({
      key,
      activatedAt: new Date().toISOString(),
      type: 'full',
      version: '1.0'
    }));
    okEl.innerHTML = '✅ License activated successfully! Welcome to ITAssetTrack.';
    okEl.style.display = 'block';
    setTimeout(() => showLoginFromLicense(), 1200);
  } else {
    errEl.innerHTML = '❌ Invalid license key. Please check your Gumroad purchase email and try again.<br><span style="font-size:11px;opacity:0.8;">Keys are case-insensitive and look like: ITAT-XXXX-XXXX-XXXX</span>';
    errEl.style.display = 'block';
  }
}

function startTrial() {
  const existing = localStorage.getItem(TRIAL_KEY);
  if (existing) {
    const start = new Date(existing);
    const now   = new Date();
    const daysUsed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const daysLeft = TRIAL_DAYS - daysUsed;
    if (daysLeft <= 0) {
      const errEl = document.getElementById('license-error');
      errEl.innerHTML = `⏰ Your ${TRIAL_DAYS}-day trial has expired. Please <a href="https://itassettrack.gumroad.com/l/itassettrack" target="_blank" style="color:var(--accent);">purchase a license on Gumroad</a> to continue.`;
      errEl.style.display = 'block'; return;
    }
    // Still in trial
    document.getElementById('trial-note').textContent = `Trial active — ${daysLeft} day${daysLeft!==1?'s':''} remaining.`;
  } else {
    localStorage.setItem(TRIAL_KEY, new Date().toISOString());
  }
  showLoginFromLicense();
}

function checkLicense() {
  // Check full license
  const lic = localStorage.getItem(LICENSE_KEY);
  if (lic) {
    try {
      const parsed = JSON.parse(lic);
      if (VALID_LICENSES.includes(parsed.key)) return { valid: true, type: 'full' };
    } catch(e) {}
  }

  // Check trial
  const trialStart = localStorage.getItem(TRIAL_KEY);
  if (trialStart) {
    const daysUsed = Math.floor((new Date() - new Date(trialStart)) / (1000 * 60 * 60 * 24));
    if (daysUsed < TRIAL_DAYS) return { valid: true, type: 'trial', daysLeft: TRIAL_DAYS - daysUsed };
  }

  return { valid: false };
}

function showLoginFromLicense() {
  document.getElementById('license-screen').classList.remove('visible');
  document.getElementById('login-screen').classList.add('visible');
}

function getLicenseBadgeText() {
  const lic = localStorage.getItem(LICENSE_KEY);
  if (lic) return '✦ Licensed';
  const trialStart = localStorage.getItem(TRIAL_KEY);
  if (trialStart) {
    const daysUsed = Math.floor((new Date() - new Date(trialStart)) / (1000 * 60 * 60 * 24));
    const left = TRIAL_DAYS - daysUsed;
    return `⏳ Trial — ${left}d left`;
  }
  return 'v1.0';
}

// ── AUTH SYSTEM ────────────────────────────────────────────
const DEFAULT_USERS = [{ username: 'admin', password: 'admin123', name: 'Administrator' }];

function getUsers() {
  try { return JSON.parse(localStorage.getItem('itassettrack_users') || 'null') || DEFAULT_USERS; } catch(e) { return DEFAULT_USERS; }
}
function saveUsers(u) { localStorage.setItem('itassettrack_users', JSON.stringify(u)); }

function getCurrentUser() {
  try { return JSON.parse(sessionStorage.getItem('itassettrack_session') || 'null'); } catch(e) { return null; }
}
function setCurrentUser(u) { sessionStorage.setItem('itassettrack_session', JSON.stringify(u)); }
function clearCurrentUser() { sessionStorage.removeItem('itassettrack_session'); }

function switchLoginTab(btn, panelId) {
  document.querySelectorAll('.login-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.login-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(panelId).classList.add('active');
  document.getElementById('signin-error').style.display = 'none';
  document.getElementById('register-error').style.display = 'none';
}

function doSignIn() {
  const username = document.getElementById('signin-user').value.trim();
  const password = document.getElementById('signin-pass').value;
  const errEl = document.getElementById('signin-error');

  if (!username || !password) {
    errEl.textContent = 'Please enter your username and password.';
    errEl.style.display = 'block'; return;
  }

  const users = getUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

  if (!user) {
    errEl.textContent = 'Incorrect username or password. Please try again.';
    errEl.style.display = 'block';
    document.getElementById('signin-pass').value = '';
    return;
  }

  errEl.style.display = 'none';
  setCurrentUser({ username: user.username, name: user.name });
  showApp(user);
}

function doRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const uname = document.getElementById('reg-user').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  const pass2 = document.getElementById('reg-pass2').value;
  const errEl = document.getElementById('register-error');

  if (!name || !uname || !pass || !pass2) {
    errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return;
  }
  if (pass.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return;
  }
  if (pass !== pass2) {
    errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return;
  }

  const users = getUsers();
  if (users.find(u => u.username.toLowerCase() === uname.toLowerCase())) {
    errEl.textContent = 'That username is already taken.'; errEl.style.display = 'block'; return;
  }

  users.push({ username: uname, password: pass, name });
  saveUsers(users);
  errEl.style.display = 'none';
  setCurrentUser({ username: uname, name });
  showApp({ username: uname, name });
}

function showApp(user) {
  document.getElementById('login-screen').classList.remove('visible');

  // Update topbar
  const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  document.getElementById('topbar-avatar').textContent = initials;
  document.getElementById('topbar-username').textContent = user.name.split(' ')[0];
  document.getElementById('ud-fullname').textContent = user.name;
  document.getElementById('ud-uname').textContent = '@' + user.username;

  // Update sidebar footer
  document.getElementById('sidebar-footer').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--blue));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#000;flex-shrink:0;">${initials}</div>
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text);">${user.name}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);">@${user.username}</div>
      </div>
    </div>
    <div style="font-size:10px;font-family:var(--mono);color:var(--green);margin-bottom:8px;display:flex;align-items:center;gap:5px;">
      <span style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;"></span>
      ${getLicenseBadgeText()}
    </div>
    <div style="cursor:pointer;font-size:11px;color:var(--red);display:flex;align-items:center;gap:5px;" onclick="doSignOut()">🚪 Sign Out</div>
  `;

  init();
}

function doSignOut() {
  closeUserDropdown();
  clearCurrentUser();
  // Reset app state
  devices = []; history = []; settings = { prefix:'IT', start:1, padding:4, counter:1 };
  if (dashChart) { dashChart.destroy(); dashChart = null; }
  document.getElementById('login-screen').classList.add('visible');
  document.getElementById('signin-user').value = '';
  document.getElementById('signin-pass').value = '';
  document.getElementById('signin-error').style.display = 'none';
  document.getElementById('sidebar-footer').innerHTML = 'ITAssetTrack v1.0 · Licensed';
}

function toggleUserDropdown() {
  document.getElementById('user-dropdown').classList.toggle('open');
}

function closeUserDropdown() {
  document.getElementById('user-dropdown').classList.remove('open');
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  const wrapper = document.getElementById('topbar-user');
  if (wrapper && !wrapper.contains(e.target)) closeUserDropdown();
});

// Enter key on login inputs
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const active = document.querySelector('.login-panel.active');
    if (!active) return;
    if (active.id === 'tab-signin') doSignIn();
    else if (active.id === 'tab-register') doRegister();
  }
});

// Update account credentials
function updateAccount() {
  const newUser  = document.getElementById('s-new-username').value.trim();
  const curPass  = document.getElementById('s-cur-pass').value;
  const newPass  = document.getElementById('s-new-pass').value;
  const newPass2 = document.getElementById('s-new-pass2').value;
  const msgEl    = document.getElementById('account-msg');

  const session = getCurrentUser();
  if (!session) { doSignOut(); return; }

  if (!curPass) {
    msgEl.style.display = 'block';
    msgEl.style.background = 'var(--red-dim)'; msgEl.style.color = 'var(--red)';
    msgEl.textContent = 'Current password is required.'; return;
  }

  const users = getUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === session.username.toLowerCase());
  if (idx === -1 || users[idx].password !== curPass) {
    msgEl.style.display = 'block';
    msgEl.style.background = 'var(--red-dim)'; msgEl.style.color = 'var(--red)';
    msgEl.textContent = 'Current password is incorrect.'; return;
  }

  if (newUser) {
    const taken = users.find((u,i) => i !== idx && u.username.toLowerCase() === newUser.toLowerCase());
    if (taken) {
      msgEl.style.display = 'block';
      msgEl.style.background = 'var(--red-dim)'; msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'That username is already taken.'; return;
    }
    users[idx].username = newUser;
  }

  if (newPass) {
    if (newPass.length < 6) {
      msgEl.style.display = 'block';
      msgEl.style.background = 'var(--red-dim)'; msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'New password must be at least 6 characters.'; return;
    }
    if (newPass !== newPass2) {
      msgEl.style.display = 'block';
      msgEl.style.background = 'var(--red-dim)'; msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'New passwords do not match.'; return;
    }
    users[idx].password = newPass;
  }

  saveUsers(users);
  setCurrentUser({ username: users[idx].username, name: users[idx].name });

  msgEl.style.display = 'block';
  msgEl.style.background = 'var(--green-dim)'; msgEl.style.color = 'var(--green)';
  msgEl.textContent = '✅ Credentials updated successfully.';

  // Update topbar display
  document.getElementById('topbar-username').textContent = users[idx].name.split(' ')[0];
  document.getElementById('ud-uname').textContent = '@' + users[idx].username;

  document.getElementById('s-cur-pass').value = '';
  document.getElementById('s-new-pass').value = '';
  document.getElementById('s-new-pass2').value = '';
}

// ── REMOVE IMPORTED ────────────────────────────────────────
function confirmRemoveImported() {
  // Mark devices added via import — they have processor/ram/generation/os/brand fields set
  const importedDevices = devices.filter(d => d.brand !== undefined || d.processor !== undefined);
  if (!importedDevices.length) {
    toast('No imported devices found to remove', 'warning'); return;
  }
  showConfirm(
    `Remove ${importedDevices.length} Imported Device${importedDevices.length>1?'s':''}?`,
    `This will permanently delete ${importedDevices.length} device${importedDevices.length>1?'s that were':'that was'} added via the Import feature. Manually-added devices will be kept.`,
    () => {
      const removedIds = new Set(importedDevices.map(d => d.id));
      devices = devices.filter(d => !removedIds.has(d.id));
      // Also clean history entries for removed devices
      history = history.filter(h => !removedIds.has(h.deviceId));
      saveData();
      toast(`Removed ${importedDevices.length} imported device${importedDevices.length>1?'s':''}`, 'success');
      renderInventory(); updateDashboard(); renderHistory();
      renderFaulty(); refreshAssignSelects(); refreshFaultySelect();
      updateFaultyBadge(); renderReportSummary();
    }
  );
}

// ══════════════════════════════════════════════════════════
//  TASK MODULE
// ══════════════════════════════════════════════════════════

const TASK_CATS = {
  device:   { label:'Device/HW',  cls:'cat-device' },
  software: { label:'Software',   cls:'cat-software' },
  network:  { label:'Network',    cls:'cat-network' },
  support:  { label:'Support',    cls:'cat-support' },
  admin:    { label:'Admin',      cls:'cat-admin' },
  other:    { label:'Other',      cls:'cat-other' },
};

// ── persistence ──────────────────────────────────────────
function loadTasks() {
  try { tasks = JSON.parse(localStorage.getItem('itassettrack_tasks') || '[]'); } catch(e) { tasks=[]; }
}
function saveTasks() {
  localStorage.setItem('itassettrack_tasks', JSON.stringify(tasks));
}

// ── period filter ─────────────────────────────────────────
function switchPeriod(btn) {
  document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentTaskPeriod = btn.dataset.period;
  renderTaskBoard();
}

function setTaskFilter(btn) {
  document.querySelectorAll('.task-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentTaskFilter = btn.dataset.filter;
  renderTaskBoard();
}

function taskInPeriod(task) {
  if (currentTaskPeriod === 'all') return true;
  const now = new Date();
  const created = new Date(task.createdAt);
  if (currentTaskPeriod === 'day') {
    return created.toDateString() === now.toDateString();
  }
  if (currentTaskPeriod === 'week') {
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0,0,0,0);
    return created >= weekStart;
  }
  if (currentTaskPeriod === 'month') {
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }
  return true;
}

function isOverdue(task) {
  if (!task.due || task.status === 'done') return false;
  return new Date(task.due) < new Date(new Date().toDateString());
}

// ── render ────────────────────────────────────────────────
function renderTaskBoard() {
  const search   = (document.getElementById('task-search')?.value || '').toLowerCase();
  const assigneeF = document.getElementById('task-assignee-filter')?.value || '';

  let filtered = tasks.filter(t => {
    if (!taskInPeriod(t)) return false;
    if (search && !t.title.toLowerCase().includes(search) && !(t.desc||'').toLowerCase().includes(search)) return false;
    if (assigneeF && !(t.assignees||[]).includes(assigneeF)) return false;
    if (currentTaskFilter === 'pending')  return t.status === 'pending';
    if (currentTaskFilter === 'progress') return t.status === 'progress';
    if (currentTaskFilter === 'done')     return t.status === 'done';
    if (currentTaskFilter === 'overdue')  return isOverdue(t);
    return true;
  });

  const cols = { pending:[], progress:[], done:[] };
  filtered.forEach(t => { if (cols[t.status]) cols[t.status].push(t); });

  // sort: pending/progress by due date asc (overdue first), done by updatedAt desc
  const sortByDue = (a,b) => (a.due||'9999') < (b.due||'9999') ? -1 : 1;
  const sortByUpd = (a,b) => new Date(b.updatedAt||b.createdAt) - new Date(a.updatedAt||a.createdAt);
  cols.pending.sort(sortByDue);
  cols.progress.sort(sortByDue);
  cols.done.sort(sortByUpd);

  ['pending','progress','done'].forEach(col => {
    const el = document.getElementById('col-' + col);
    const cnt = document.getElementById('col-count-' + col);
    cnt.textContent = cols[col].length;
    if (!cols[col].length) {
      el.innerHTML = `<div class="task-empty"><div class="task-empty-icon">${col==='done'?'🎉':col==='progress'?'🔵':'📋'}</div>No ${col==='progress'?'in-progress':col} tasks</div>`;
      return;
    }
    el.innerHTML = cols[col].map(t => taskCardHTML(t)).join('');
  });

  updateTaskStats(filtered);
  updateTaskBadge();

  // populate assignee filter
  const af = document.getElementById('task-assignee-filter');
  if (af) {
    const curVal = af.value;
    const allAssignees = [...new Set(tasks.flatMap(t => t.assignees||[]))].sort();
    af.innerHTML = '<option value="">All Assignees</option>' +
      allAssignees.map(a => `<option value="${a}" ${a===curVal?'selected':''}>${a}</option>`).join('');
  }
}

function taskCardHTML(t) {
  const cat  = TASK_CATS[t.category] || TASK_CATS.other;
  const over = isOverdue(t);
  let dueHTML = '';
  if (t.due) {
    const dueDate = new Date(t.due + 'T00:00:00');
    const today   = new Date(new Date().toDateString());
    const diff    = Math.round((dueDate - today) / 86400000);
    const cls     = over ? 'overdue' : diff === 0 ? 'today' : 'ok';
    const label   = over ? `⚠ Overdue ${Math.abs(diff)}d` : diff === 0 ? '📅 Due today' : diff === 1 ? '📅 Tomorrow' : `📅 ${dueDate.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`;
    dueHTML = `<span class="task-due ${cls}">${label}</span>`;
  }

  const assigneesHTML = (t.assignees||[]).length
    ? (t.assignees||[]).map(a => {
        const initials = a.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
        return `<span class="task-assignee"><span class="task-assignee-dot">${initials}</span> ${a}</span>`;
      }).join('')
    : '<span class="task-assignee" style="color:var(--text3);">Unassigned</span>';

  const priorityColors = { high:'var(--red)', medium:'var(--orange)', low:'var(--green)' };
  const pColor = priorityColors[t.priority] || 'var(--text3)';

  let actButtons = '';
  if (t.status === 'pending')  actButtons = `<button class="task-act-btn start" onclick="event.stopPropagation();quickMoveTask('${t.id}','progress')">▶ Start</button><button class="task-act-btn complete" onclick="event.stopPropagation();quickMoveTask('${t.id}','done')">✓ Done</button>`;
  if (t.status === 'progress') actButtons = `<button class="task-act-btn complete" onclick="event.stopPropagation();quickMoveTask('${t.id}','done')">✓ Complete</button>`;
  if (t.status === 'done')     actButtons = `<button class="task-act-btn reopen" onclick="event.stopPropagation();quickMoveTask('${t.id}','pending')">↩ Reopen</button>`;

  const commentCount = (t.comments||[]).length;

  return `
  <div class="task-card priority-${t.priority} ${t.status==='done'?'done-card':''}" onclick="openTaskDetail('${t.id}')">
    <div class="task-title">${escHtml(t.title)}</div>
    ${t.desc ? `<div style="font-size:11.5px;color:var(--text3);margin-top:3px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escHtml(t.desc)}</div>` : ''}
    <div class="task-meta">
      <span class="task-tag ${cat.cls}">${cat.label}</span>
      <span style="font-size:10px;color:${pColor};font-family:var(--mono);font-weight:700;">${t.priority?.toUpperCase()}</span>
      ${dueHTML}
      ${t.linkedAsset ? `<span class="task-tag cat-admin">${escHtml(t.linkedAsset)}</span>` : ''}
      ${commentCount ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-left:auto;">💬 ${commentCount}</span>` : ''}
    </div>
    <div class="task-meta" style="margin-top:5px;">${assigneesHTML}</div>
    <div class="task-actions">${actButtons}
      <button class="task-act-btn" onclick="event.stopPropagation();openEditTask('${t.id}')" style="margin-left:auto;">✏️</button>
      <button class="task-act-btn" style="color:var(--red);" onclick="event.stopPropagation();deleteTask('${t.id}')">🗑</button>
    </div>
  </div>`;
}

function updateTaskStats(filtered) {
  const total   = filtered.length;
  const pending  = filtered.filter(t => t.status==='pending').length;
  const progress = filtered.filter(t => t.status==='progress').length;
  const done     = filtered.filter(t => t.status==='done').length;
  const overdue  = filtered.filter(t => isOverdue(t)).length;

  document.getElementById('task-stats-bar').innerHTML = `
    <div class="task-stat pending"><div class="task-stat-num">${pending}</div><div class="task-stat-lbl">Pending</div></div>
    <div class="task-stat progress"><div class="task-stat-num">${progress}</div><div class="task-stat-lbl">In Progress</div></div>
    <div class="task-stat done"><div class="task-stat-num">${done}</div><div class="task-stat-lbl">Completed</div></div>
    <div class="task-stat overdue"><div class="task-stat-num">${overdue}</div><div class="task-stat-lbl">Overdue</div></div>
  `;
}

function updateTaskBadge() {
  const open = tasks.filter(t => t.status !== 'done').length;
  const badge = document.getElementById('task-badge');
  if (!badge) return;
  if (open > 0) { badge.style.display = 'inline'; badge.textContent = open; }
  else { badge.style.display = 'none'; }
}

// ── create / edit task modal ──────────────────────────────
function openTaskModal(prefill) {
  document.getElementById('task-edit-id').value = '';
  document.getElementById('task-modal-title').textContent = '➕ New Task';
  document.getElementById('task-modal-sub').textContent = 'Create a task and assign it to a team member';
  document.getElementById('t-title').value = '';
  document.getElementById('t-desc').value = '';
  document.getElementById('t-cat').value = prefill?.category || 'device';
  document.getElementById('t-due').value = prefill?.due || '';
  document.getElementById('t-asset').value = prefill?.asset || '';
  document.getElementById('t-notes').value = '';

  // Priority
  selectPriority('medium');

  // Populate asset datalist
  const dl = document.getElementById('t-asset-list');
  dl.innerHTML = devices.map(d => `<option value="${d.tag}">${d.tag} – ${d.name}</option>`).join('');

  // Populate assignee chips
  populateAssigneeChips([]);

  document.getElementById('modal-task').classList.add('open');
  setTimeout(() => document.getElementById('t-title').focus(), 100);
}

function openEditTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  closeModal('modal-task-detail');

  document.getElementById('task-edit-id').value = t.id;
  document.getElementById('task-modal-title').textContent = '✏️ Edit Task';
  document.getElementById('task-modal-sub').textContent = 'Update task details';
  document.getElementById('t-title').value = t.title;
  document.getElementById('t-desc').value = t.desc || '';
  document.getElementById('t-cat').value = t.category || 'device';
  document.getElementById('t-due').value = t.due || '';
  document.getElementById('t-asset').value = t.linkedAsset || '';
  document.getElementById('t-notes').value = t.notes || '';

  selectPriority(t.priority || 'medium');

  const dl = document.getElementById('t-asset-list');
  dl.innerHTML = devices.map(d => `<option value="${d.tag}">${d.tag} – ${d.name}</option>`).join('');

  populateAssigneeChips(t.assignees || []);

  document.getElementById('modal-task').classList.add('open');
}

function populateAssigneeChips(selected) {
  const users = getUsers();
  const wrap = document.getElementById('t-assignee-list');
  wrap.innerHTML = users.map(u => {
    const initials = u.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const sel = selected.includes(u.name);
    return `<div class="assignee-chip ${sel?'selected':''}" onclick="toggleAssigneeChip(this,'${escHtml(u.name)}')" data-name="${escHtml(u.name)}">
      <div class="assignee-chip-av">${initials}</div>${u.name}
    </div>`;
  }).join('');
  if (!users.length) wrap.innerHTML = '<span style="font-size:12px;color:var(--text3);">No users registered yet. Add users via Register on the login screen.</span>';
}

function toggleAssigneeChip(el, name) {
  el.classList.toggle('selected');
}

function selectPriority(p) {
  document.querySelectorAll('.priority-opt').forEach(el => {
    el.classList.remove('selected');
    if (el.classList.contains(p)) el.classList.add('selected');
  });
}

function getSelectedPriority() {
  const el = document.querySelector('.priority-opt.selected');
  if (el) { for (const c of ['high','medium','low']) if (el.classList.contains(c)) return c; }
  return 'medium';
}

function getSelectedAssignees() {
  return [...document.querySelectorAll('.assignee-chip.selected')].map(el => el.dataset.name);
}

function saveTask() {
  const title = document.getElementById('t-title').value.trim();
  if (!title) { toast('Task title is required', 'error'); return; }

  const session = getCurrentUser();
  const editId  = document.getElementById('task-edit-id').value;
  const now     = new Date().toISOString();

  const taskData = {
    title,
    desc:        document.getElementById('t-desc').value.trim(),
    category:    document.getElementById('t-cat').value,
    due:         document.getElementById('t-due').value,
    priority:    getSelectedPriority(),
    linkedAsset: document.getElementById('t-asset').value.trim(),
    notes:       document.getElementById('t-notes').value.trim(),
    assignees:   getSelectedAssignees(),
    updatedAt:   now,
  };

  if (editId) {
    const idx = tasks.findIndex(t => t.id === editId);
    if (idx !== -1) {
      tasks[idx] = { ...tasks[idx], ...taskData };
      toast('Task updated', 'success');
    }
  } else {
    tasks.unshift({
      id:        'task_' + Date.now(),
      status:    'pending',
      createdBy: session?.name || 'Unknown',
      createdAt: now,
      comments:  [],
      ...taskData,
    });
    toast('Task created', 'success');
  }

  saveTasks();
  closeModal('modal-task');
  renderTaskBoard();
}

// ── quick status moves ────────────────────────────────────
function quickMoveTask(id, newStatus) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.status = newStatus;
  t.updatedAt = new Date().toISOString();
  if (newStatus === 'done') t.completedAt = new Date().toISOString();
  saveTasks();
  renderTaskBoard();
  toast(newStatus === 'done' ? '✅ Task completed!' : newStatus === 'progress' ? '▶ Task started' : '↩ Task reopened', newStatus==='done'?'success':'info');
}

function moveTask(newStatus) {
  if (!currentTaskDetailId) return;
  quickMoveTask(currentTaskDetailId, newStatus);
  // refresh detail modal status
  openTaskDetail(currentTaskDetailId);
}

// ── delete ────────────────────────────────────────────────
function deleteTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  showConfirm('Delete Task?', `"${t.title}" will be permanently deleted.`, () => {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    renderTaskBoard();
    toast('Task deleted', 'info');
  });
}

// ── detail view ───────────────────────────────────────────
function openTaskDetail(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  currentTaskDetailId = id;

  const cat = TASK_CATS[t.category] || TASK_CATS.other;
  const priorityLabels = { high:'🔴 High', medium:'🟡 Medium', low:'🟢 Low' };
  const statusLabels   = { pending:'Pending', progress:'In Progress', done:'Completed' };

  document.getElementById('td-status-badge').textContent = statusLabels[t.status] || t.status;
  document.getElementById('td-status-badge').className = `task-detail-badge ${t.status}`;
  document.getElementById('td-cat-tag').textContent  = cat.label;
  document.getElementById('td-cat-tag').className    = `task-tag ${cat.cls}`;
  document.getElementById('td-priority-tag').textContent = priorityLabels[t.priority] || '';
  document.getElementById('td-title').textContent = t.title;
  document.getElementById('td-desc').textContent  = t.desc || 'No description provided.';
  document.getElementById('td-creator').textContent  = t.createdBy || '—';
  document.getElementById('td-assignees').textContent = (t.assignees||[]).join(', ') || 'Unassigned';
  document.getElementById('td-asset').textContent    = t.linkedAsset || '—';
  document.getElementById('td-created').textContent  = formatDate(t.createdAt);
  document.getElementById('td-updated').textContent  = formatDate(t.updatedAt||t.createdAt);

  // Due date
  let dueText = t.due ? new Date(t.due + 'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}) : '—';
  if (isOverdue(t)) dueText += ' ⚠ OVERDUE';
  document.getElementById('td-due').textContent = dueText;

  // Notes
  const notesWrap = document.getElementById('td-notes-wrap');
  if (t.notes) {
    notesWrap.style.display = 'block';
    document.getElementById('td-notes').textContent = t.notes;
  } else {
    notesWrap.style.display = 'none';
  }

  // Comments / Activity
  const commentsEl = document.getElementById('td-comments');
  commentsEl.innerHTML = (t.comments||[]).map(c => `
    <div class="task-comment">
      <div class="task-comment-av">${(c.author||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}</div>
      <div class="task-comment-body">
        <div class="task-comment-meta">${escHtml(c.author)} · ${formatDate(c.at)}</div>
        ${escHtml(c.text)}
      </div>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text3);padding:4px 0;">No activity yet.</div>';

  document.getElementById('td-comment-input').value = '';

  // Button visibility
  document.getElementById('td-start-btn').style.display    = t.status==='pending'  ? 'inline-flex' : 'none';
  document.getElementById('td-complete-btn').style.display = t.status!=='done'      ? 'inline-flex' : 'none';
  document.getElementById('td-reopen-btn').style.display   = t.status==='done'      ? 'inline-flex' : 'none';

  document.getElementById('modal-task-detail').classList.add('open');
}

function editTaskFromDetail() {
  if (currentTaskDetailId) openEditTask(currentTaskDetailId);
}

// ── comments ──────────────────────────────────────────────
function addTaskComment() {
  const input = document.getElementById('td-comment-input');
  const text  = input.value.trim();
  if (!text || !currentTaskDetailId) return;
  const t = tasks.find(t => t.id === currentTaskDetailId);
  if (!t) return;
  if (!t.comments) t.comments = [];
  const session = getCurrentUser();
  t.comments.push({ text, author: session?.name || 'Unknown', at: new Date().toISOString() });
  t.updatedAt = new Date().toISOString();
  saveTasks();
  openTaskDetail(currentTaskDetailId); // refresh
  renderTaskBoard();
}

// ── utility ───────────────────────────────────────────────
function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g,'&#39;');
}

// ── AUTO-LOGIN (resume session) ────────────────────────────
(function checkSession() {
  const licStatus = checkLicense();

  if (!licStatus.valid) {
    // Show license gate
    document.getElementById('license-screen').classList.add('visible');
    document.getElementById('login-screen').classList.remove('visible');
    // Update trial note if trial expired
    const trialStart = localStorage.getItem(TRIAL_KEY);
    if (trialStart) {
      const daysUsed = Math.floor((new Date() - new Date(trialStart)) / (1000 * 60 * 60 * 24));
      if (daysUsed >= TRIAL_DAYS) {
        document.getElementById('trial-note').innerHTML =
          `<span style="color:var(--red)">Trial expired. Please purchase a license.</span>`;
      }
    }
    return;
  }

  // License valid — check if already logged in
  document.getElementById('license-screen').classList.remove('visible');

  const session = getCurrentUser();
  if (session) {
    showApp(session);
  } else {
    document.getElementById('login-screen').classList.add('visible');
  }
})();

// ── START ──────────────────────────────────────────────────
// init() is called by showApp() after successful login
init();


 