"use strict";
// ── STATE ────────────────────────────────────────────────
let devices = [],
  history = [],
  tasks = [];
let settings = { prefix: "IT", start: 1, padding: 4, counter: 1 };
let dashChart = null;
let currentDetailId = null;
let confirmCallback = null;
let lastConnectivity = null;
let connectivityTimer = null;
let sheetsConfig = null;
let backendConfig = null;
let syncStatus = "local";
let lastSyncTime = null;
let syncInterval = null;
let isSyncing = false;
let lastSyncError = "";

// import state
let importRawRows = [],
  importColHeaders = [],
  importMapping = {};
let importParsedRows = [],
  importSkipped = [],
  importUpdates = [];
let importUsedCounterMax = null;
let importCurrentStep = 1;

const TRIAL_DAYS = 7;
const LICENSE_KEY = "itassettrack_license";
const TRIAL_KEY = "itassettrack_trial_start";
const LICENSE_PACKAGE_SELECTION_KEY = "itassettrack_selected_package";
const SHEETS_CONFIG_KEY = "itassettrack_sheets_config";
const BACKEND_CONFIG_KEY = "itassettrack_backend_config";
const DEFAULT_PACKAGE_ID = "starter";
const PACKAGE_DEFS = {
  starter: {
    id: "starter",
    name: "Starter",
    badge: "Starter",
    billing: "One-time purchase",
    assetLimit: 50,
    seatLimit: 0,
    multiUser: false,
    taskLog: false,
    sheetsSync: false,
    financeReports: false,
    multiLocation: false,
    customFields: false,
    apiAccess: false,
  },
  pro: {
    id: "pro",
    name: "Pro",
    badge: "Pro",
    billing: "Monthly or annual",
    assetLimit: Infinity,
    seatLimit: 5,
    multiUser: true,
    taskLog: true,
    sheetsSync: true,
    financeReports: true,
    multiLocation: false,
    customFields: false,
    apiAccess: false,
  },
  business: {
    id: "business",
    name: "Business",
    badge: "Business",
    billing: "Unlimited staff",
    assetLimit: Infinity,
    seatLimit: Infinity,
    multiUser: true,
    taskLog: true,
    sheetsSync: true,
    financeReports: true,
    multiLocation: true,
    customFields: true,
    apiAccess: true,
  },
  trial: {
    id: "trial",
    name: "Full Trial",
    badge: "Trial",
    billing: "Trial access",
    assetLimit: Infinity,
    seatLimit: Infinity,
    multiUser: true,
    taskLog: true,
    sheetsSync: true,
    financeReports: true,
    multiLocation: true,
    customFields: true,
    apiAccess: true,
  },
};

// ── UTILS ────────────────────────────────────────────────
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s) {
  return escHtml(s).replace(/'/g, "&#39;");
}
function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}
function formatDateOnly(value) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function dateStamp() {
  return new Date().toISOString().split("T")[0];
}
function toDateInputValue(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}
function toast(msg, type = "info") {
  const icon =
    { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" }[type] || "ℹ️";
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icon}</span> ${escHtml(msg)}`;
  document.getElementById("toast-container").appendChild(t);
  setTimeout(() => (t.style.opacity = "0"), 3000);
  setTimeout(() => t.remove(), 3400);
}
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  d.setMilliseconds(-1);
  return d;
}
function getWeekBounds(base = new Date()) {
  const start = startOfDay(base);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  const end = endOfDay(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}
function getMonthBounds(base = new Date()) {
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}
function getQuarterBounds(base = new Date()) {
  const quarterStartMonth = Math.floor(base.getMonth() / 3) * 3;
  const start = new Date(base.getFullYear(), quarterStartMonth, 1);
  const end = new Date(base.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999);
  return { start, end };
}
function getYearBounds(base = new Date()) {
  const start = new Date(base.getFullYear(), 0, 1);
  const end = new Date(base.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end };
}
function getBoundsForPeriod(period, base = new Date()) {
  if (period === "week") return getWeekBounds(base);
  if (period === "month") return getMonthBounds(base);
  if (period === "quarter") return getQuarterBounds(base);
  if (period === "year") return getYearBounds(base);
  return null;
}

function normalisePackageId(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  if (
    key.includes("business") ||
    key.includes("unlimited") ||
    key.includes("enterprise") ||
    key.includes("premium")
  )
    return "business";
  if (
    /\bpro\b/.test(key) ||
    key.includes("team5") ||
    key.includes("team-5") ||
    key.includes("5 staff") ||
    key.includes("5-seat") ||
    key.includes("five staff")
  )
    return "pro";
  if (key.includes("starter") || key.includes("one-time") || key.includes("basic"))
    return "starter";
  if (key.includes("trial")) return "trial";
  return key;
}

function getPackageDef(packageId) {
  return PACKAGE_DEFS[normalisePackageId(packageId)] || PACKAGE_DEFS[DEFAULT_PACKAGE_ID];
}

function readStoredLicense() {
  try {
    return JSON.parse(localStorage.getItem(LICENSE_KEY) || "null");
  } catch (e) {
    return null;
  }
}

function getTrialDaysLeft() {
  const ts = localStorage.getItem(TRIAL_KEY);
  if (!ts) return 0;
  const daysUsed = Math.floor(
    (new Date() - new Date(ts)) / (1000 * 60 * 60 * 24),
  );
  return Math.max(0, TRIAL_DAYS - daysUsed);
}

function inferPackageId({
  packageId,
  productName,
  key,
  fallbackPackageId = DEFAULT_PACKAGE_ID,
} = {}) {
  const explicit = normalisePackageId(packageId);
  if (explicit) return explicit;
  const text = `${productName || ""} ${key || ""}`.toLowerCase();
  if (
    text.includes("business") ||
    text.includes("unlimited") ||
    text.includes("enterprise") ||
    text.includes("premium")
  )
    return "business";
  if (
    /\bpro\b/.test(text) ||
    text.includes("team5") ||
    text.includes("team 5") ||
    text.includes("5 staff") ||
    text.includes("five staff") ||
    text.includes("5-seat")
  )
    return "pro";
  if (
    text.includes("starter") ||
    text.includes("one-time") ||
    text.includes("basic") ||
    text.includes("single-user")
  )
    return "starter";
  return normalisePackageId(fallbackPackageId) || DEFAULT_PACKAGE_ID;
}

function getSelectedLicensePackageId() {
  const stored = normalisePackageId(
    localStorage.getItem(LICENSE_PACKAGE_SELECTION_KEY),
  );
  return stored && PACKAGE_DEFS[stored] ? stored : "starter";
}

function updateSelectedLicensePackageUI() {
  const selected = getSelectedLicensePackageId();
  document.querySelectorAll(".license-package-card").forEach((card) => {
    const isSelected = normalisePackageId(card.dataset.package) === selected;
    card.classList.toggle("selected", isSelected);
    card.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
  const note = document.getElementById("license-package-note");
  if (note) {
    const plan = getPackageDef(selected);
    note.textContent = `Selected package: ${plan.name}. Use a matching license key to activate it.`;
  }
}

function selectLicensePackage(packageId) {
  const normalised = normalisePackageId(packageId);
  if (!normalised || !PACKAGE_DEFS[normalised]) return;
  localStorage.setItem(LICENSE_PACKAGE_SELECTION_KEY, normalised);
  updateSelectedLicensePackageUI();
}

function initLicensePackagePicker() {
  document.querySelectorAll(".license-package-card").forEach((card) => {
    if (card.dataset.bound === "true") return;
    card.dataset.bound = "true";
    const packageId = normalisePackageId(card.dataset.package);
    card.addEventListener("click", () => selectLicensePackage(packageId));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectLicensePackage(packageId);
      }
    });
  });
  updateSelectedLicensePackageUI();
}

function getCurrentPackage() {
  const lic = readStoredLicense();
  if (lic && lic.key) return getPackageDef(inferPackageId(lic));
  if (getTrialDaysLeft() > 0) return getPackageDef("trial");
  return getPackageDef("starter");
}

function getSeatLimitText(limit) {
  return limit === Infinity ? "Unlimited" : String(limit);
}

function getAssetLimitText(limit) {
  return limit === Infinity ? "Unlimited" : String(limit);
}

function getAssetUsage() {
  return devices.length;
}

function getAssetLimitMessage(additional = 1) {
  const plan = getCurrentPackage();
  if (plan.assetLimit === Infinity) return "";
  const current = getAssetUsage();
  const nextTotal = current + additional;
  return `${plan.name} allows up to ${getAssetLimitText(plan.assetLimit)} tracked assets. You currently have ${current}, and this action would take you to ${nextTotal}. Upgrade to Pro or Business to continue.`;
}

function ensureAssetCapacity(additional = 1) {
  const plan = getCurrentPackage();
  if (plan.assetLimit === Infinity) return true;
  if (getAssetUsage() + additional <= plan.assetLimit) return true;
  toast(getAssetLimitMessage(additional), "warning");
  return false;
}

function isSeatCountedUser(user) {
  return !!(
    user &&
    user.status !== "inactive" &&
    String(user.username || "").toLowerCase() !== "admin"
  );
}

function getSeatUsage(users = getUsers()) {
  return users.filter((user) => isSeatCountedUser(user)).length;
}

function getProjectedSeatUsage(users, draftUser, editId = "") {
  const projected = users.map((user) =>
    user.id === editId ? { ...user, ...draftUser } : user,
  );
  if (!editId) projected.push(draftUser);
  return getSeatUsage(projected);
}

function getSeatLimitMessage() {
  const plan = getCurrentPackage();
  if (plan.id === "starter") {
    return "Starter is limited to one admin login. Upgrade to Pro or Business for staff accounts.";
  }
  return `${plan.name} allows up to ${getSeatLimitText(plan.seatLimit)} active staff account(s).`;
}

function ensureFeatureAccess(featureKey) {
  const plan = getCurrentPackage();
  if (plan[featureKey]) return true;
  const messages = {
    taskLog: "Task log is included in the Pro and Business packages.",
    sheetsSync: "Shared sync is included in the Pro and Business packages.",
    multiUser: "Additional staff accounts require Pro or Business.",
  };
  toast(messages[featureKey] || "This feature is not available in your current package.", "warning");
  return false;
}

function renderPlanSettings() {
  const el = document.getElementById("plan-settings-content");
  if (!el) return;
  const plan = getCurrentPackage();
  const license = checkLicense();
  const seatsUsed = getSeatUsage();
  const assetsUsed = getAssetUsage();
  const seatValue =
    !plan.multiUser
      ? "Admin only"
      : plan.seatLimit === Infinity
      ? `${seatsUsed} active`
      : `${seatsUsed}/${plan.seatLimit}`;
  const assetValue =
    plan.assetLimit === Infinity
      ? `${assetsUsed} tracked`
      : `${assetsUsed}/${plan.assetLimit}`;
  const statusText =
    license.type === "trial"
      ? `${license.daysLeft} day${license.daysLeft !== 1 ? "s" : ""} left`
      : plan.billing;
  const featureChip = (enabled, label) =>
    `<span class="plan-feature ${enabled ? "on" : "off"}">${enabled ? "Included" : "Upgrade"} · ${label}</span>`;
  el.innerHTML =
    `<div class="plan-card"><div class="plan-card-head"><div><div class="plan-name">${escHtml(plan.name)}</div><div class="plan-meta">${escHtml(statusText)}</div></div><span class="plan-badge ${escAttr(plan.id)}">${escHtml(plan.badge)}</span></div><div class="plan-grid"><div class="plan-mini-stat"><div class="plan-mini-label">Assets</div><div class="plan-mini-value">${escHtml(assetValue)}</div></div><div class="plan-mini-stat"><div class="plan-mini-label">Task Log</div><div class="plan-mini-value">${plan.taskLog ? "Enabled" : "Locked"}</div></div><div class="plan-mini-stat"><div class="plan-mini-label">Staff Seats</div><div class="plan-mini-value">${escHtml(seatValue)}</div></div><div class="plan-mini-stat"><div class="plan-mini-label">Shared Sync</div><div class="plan-mini-value">${plan.sheetsSync ? "Enabled" : "Locked"}</div></div></div><div class="plan-feature-list">${featureChip(true, "Asset tracking")}${featureChip(plan.taskLog, "Task log / help desk")}${featureChip(plan.multiUser, "Staff accounts")}${featureChip(plan.sheetsSync, "Shared sync")}${featureChip(plan.financeReports, "Finance reports")}${featureChip(plan.multiLocation, "Multi-location")}${featureChip(plan.customFields, "Custom fields")}${featureChip(plan.apiAccess, "API access")}</div><div class="plan-note">Yes, this can use a server and still be a PWA. Keep the app hosted over HTTPS, then use your API or Worker for license verification and shared sync while the app remains installable and offline-capable.</div></div>`;
}

function refreshAuthPackageUI() {
  const note = document.getElementById("login-package-note");
  const signInTab = document.querySelector('.login-tab[onclick*="tab-signin"]');
  const registerTab = document.querySelector('.login-tab[onclick*="tab-register"]');
  const signInPanel = document.getElementById("tab-signin");
  const registerPanel = document.getElementById("tab-register");
  if (!note || !signInTab || !registerTab || !signInPanel || !registerPanel) return;
  const plan = getCurrentPackage();
  const seatsUsed = getSeatUsage();
  const seatsText =
    plan.seatLimit === Infinity
      ? `${seatsUsed} active staff accounts`
      : plan.seatLimit === 0
        ? "single admin access"
        : `${seatsUsed}/${plan.seatLimit} staff seats used`;
  note.textContent = `${plan.name} · ${seatsText}`;
  note.style.display = "block";
  const canRegister =
    plan.multiUser &&
    (plan.seatLimit === Infinity || seatsUsed < plan.seatLimit);
  registerTab.style.display = canRegister ? "" : "none";
  if (!canRegister && registerPanel.classList.contains("active")) {
    registerTab.classList.remove("active");
    registerPanel.classList.remove("active");
    signInTab.classList.add("active");
    signInPanel.classList.add("active");
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener(
    "load",
    () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    },
    { once: true },
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generatePasswordSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function derivePasswordHash(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 120000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function createPasswordRecord(password, salt = generatePasswordSalt()) {
  return {
    passwordSalt: salt,
    passwordHash: await derivePasswordHash(password, salt),
    passwordUpdatedAt: new Date().toISOString(),
  };
}

function sanitizeUserRecord(user) {
  const copy = { ...(user || {}) };
  delete copy.password;
  return copy;
}

function sanitizeUsersForSync(users) {
  return (users || []).map((user) => sanitizeUserRecord(user));
}

async function verifyUserPassword(user, password) {
  if (!user) return false;
  if (user.passwordHash && user.passwordSalt) {
    const hash = await derivePasswordHash(password, user.passwordSalt);
    return hash === user.passwordHash;
  }
  if (typeof user.password === "string") return user.password === password;
  return false;
}

async function migrateLegacyUsersIfNeeded() {
  const users = getUsers();
  let changed = false;
  for (const user of users) {
    if (typeof user.password === "string" && !user.passwordHash) {
      Object.assign(user, await createPasswordRecord(user.password));
      delete user.password;
      changed = true;
    }
  }
  if (changed) saveUsers(users, false);
}

// ── STORAGE ──────────────────────────────────────────────
function loadData() {
  try {
    devices = JSON.parse(localStorage.getItem("itassettrack_devices") || "[]");
    history = JSON.parse(localStorage.getItem("itassettrack_history") || "[]");
    tasks = JSON.parse(localStorage.getItem("itassettrack_tasks") || "[]");
    const s = JSON.parse(localStorage.getItem("itassettrack_settings"));
    if (s) settings = { ...settings, ...s };
  } catch (e) {
    console.error(e);
  }
}
function saveDataLocal() {
  localStorage.setItem("itassettrack_devices", JSON.stringify(devices));
  localStorage.setItem("itassettrack_history", JSON.stringify(history));
  localStorage.setItem("itassettrack_tasks", JSON.stringify(tasks));
  localStorage.setItem("itassettrack_settings", JSON.stringify(settings));
}
function saveData() {
  saveDataLocal();
  if (getSyncUrl()) pushToSheets();
}

// ── NAVIGATION ────────────────────────────────────────────
const pageNames = {
  dashboard: "Dashboard / Overview",
  inventory: "Inventory / All Devices",
  assign: "Assign / Reassign Device",
  faulty: "Faulty / Device Tracking",
  tasks: "Task Log / Daily Activities",
  history: "History / Audit Log",
  reports: "Reports / Exports",
  settings: "Settings / Configuration",
};
function navigate(page) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add("active");
  const parts = pageNames[page].split(" / ");
  document.getElementById("topbar-title").innerHTML =
    `${escHtml(parts[0])} <span>/ ${escHtml(parts[1])}</span>`;
  if (page === "dashboard") updateDashboard();
  if (page === "inventory") renderInventory();
  if (page === "history") renderHistory();
  if (page === "faulty") {
    renderFaulty();
    refreshFaultySelect();
  }
  if (page === "tasks") renderTaskLogPage();
  if (page === "assign") {
    refreshAssignSelects();
    renderAssignedList();
  }
  if (page === "reports") renderReportSummary();
  if (page === "settings") {
    renderPlanSettings();
    renderBackendSettings();
    renderSheetsSettings();
    renderTeamUserList();
    applyRoleUI();
  }
}
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => navigate(item.dataset.page));
});

function switchTab(btn, tabId) {
  const parent = btn.closest(".tabs");
  parent
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  const page = btn.closest(".page");
  page
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("active"));
  page.querySelector("#" + tabId).classList.add("active");
  if (tabId === "reassign-tab") refreshReassignSelect();
}
function switchDetailTab(btn, panelId) {
  document
    .querySelectorAll(".detail-tab")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".detail-tab-panel")
    .forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(panelId).classList.add("active");
}

// ── ASSET TAG ────────────────────────────────────────────
function genTag(counter) {
  return `${settings.prefix}-${String(counter).padStart(settings.padding, "0")}`;
}
function nextTag() {
  return genTag(settings.counter);
}
function bumpCounter() {
  settings.counter++;
}

// ── ADD DEVICE ────────────────────────────────────────────
function openAddModal() {
  if (!ensureAssetCapacity(1)) return;
  document.getElementById("f-tag").value = nextTag();
  [
    "f-name",
    "f-serial",
    "f-brand",
    "f-oldtag",
    "f-dept",
    "f-assigneduser",
    "f-os",
    "f-processor",
    "f-generation",
    "f-display",
    "f-supplier",
    "f-invoice",
    "f-notes",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["f-ram", "f-rom", "f-disk", "f-value", "f-curvalue"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("f-purchase").value = new Date()
    .toISOString()
    .split("T")[0];
  [
    "f-received",
    "f-assigned-date",
    "f-returned",
    "f-warranty",
    "f-eol",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("f-category").value = "Laptop";
  document.getElementById("f-condition").value = "good";
  document.getElementById("modal-add").classList.add("open");
}

function addDevice() {
  if (!ensureAssetCapacity(1)) return;
  const name = document.getElementById("f-name").value.trim();
  const serial = document.getElementById("f-serial").value.trim();
  const tag = document.getElementById("f-tag").value;
  if (!name || !serial) {
    toast("Device name and serial number are required", "error");
    return;
  }
  if (devices.find((d) => d.serial.toLowerCase() === serial.toLowerCase())) {
    toast("Serial number already exists in inventory", "error");
    return;
  }
  const gv = (id) => document.getElementById(id)?.value?.trim() || "";
  const gn = (id) => parseFloat(document.getElementById(id)?.value) || "";
  const assignedUser = gv("f-assigneduser");
  const dept = gv("f-dept");
  const device = {
    id: Date.now().toString(),
    tag,
    name,
    serial,
    brand: gv("f-brand"),
    oldTag: gv("f-oldtag"),
    category: document.getElementById("f-category").value,
    condition: document.getElementById("f-condition").value,
    os: gv("f-os"),
    processor: gv("f-processor"),
    generation: gv("f-generation"),
    ram: gn("f-ram"),
    rom: gn("f-rom"),
    disk: gn("f-disk"),
    display: gv("f-display"),
    dept,
    assignedUser,
    assignedDept: dept,
    purchase: gv("f-purchase"),
    dateReceived: gv("f-received"),
    dateAssigned: gv("f-assigned-date"),
    dateReturned: gv("f-returned"),
    warrantyExpiry: gv("f-warranty"),
    eolDate: gv("f-eol"),
    purchaseValue: gn("f-value"),
    currentValue: gn("f-curvalue"),
    supplier: gv("f-supplier"),
    invoiceNo: gv("f-invoice"),
    notes: gv("f-notes"),
    status: assignedUser ? "Assigned" : "Available",
    addedDate: new Date().toISOString(),
    tickets: [],
  };
  devices.push(device);
  bumpCounter();
  addHistory(
    device,
    "Added",
    assignedUser || "",
    `${device.category}${device.ram ? " · " + device.ram + "GB RAM" : ""}${device.processor ? " · " + device.processor : ""}`,
  );
  if (assignedUser)
    addHistory(device, "Assigned", assignedUser, `Dept: ${dept}`);
  saveData();
  closeModal("modal-add");
  toast(`✅ ${tag} added to inventory`, "success");
  renderInventory();
  updateDashboard();
  refreshAssignSelects();
  refreshFaultySelect();
  updateFaultyBadge();
}

// ── ASSIGN ────────────────────────────────────────────────
function refreshAssignSelects() {
  const sel = document.getElementById("assign-device-select");
  sel.innerHTML = '<option value="">-- Choose device --</option>';
  devices
    .filter((d) => d.status === "Available")
    .forEach((d) => {
      sel.innerHTML += `<option value="${escAttr(d.id)}">${escHtml(d.tag)} - ${escHtml(d.name)}</option>`;
    });
}

function refreshReassignSelect() {
  const sel = document.getElementById("reassign-device-select");
  sel.innerHTML = '<option value="">-- Choose assigned device --</option>';
  devices
    .filter((d) => d.status === "Assigned")
    .forEach((d) => {
      sel.innerHTML += `<option value="${escAttr(d.id)}">${escHtml(d.tag)} - ${escHtml(d.name)} (${escHtml(d.assignedUser)})</option>`;
    });
  sel.onchange = function () {
    const d = devices.find((x) => x.id === this.value);
    const info = document.getElementById("reassign-current-info");
    if (d) {
      info.style.display = "block";
      document.getElementById("reassign-current-user").textContent =
        `${d.assignedUser} — ${d.assignedDept || d.dept || "—"}`;
    } else info.style.display = "none";
  };
}

function assignDevice() {
  const devId = document.getElementById("assign-device-select").value;
  const user = document.getElementById("assign-user").value.trim();
  const dept = document.getElementById("assign-dept").value.trim();
  if (!devId) {
    toast("Please select a device", "error");
    return;
  }
  if (!user) {
    toast("User name is required", "error");
    return;
  }
  const device = devices.find((d) => d.id === devId);
  device.status = "Assigned";
  device.assignedUser = user;
  device.assignedDept = dept || device.dept;
  addHistory(device, "Assigned", user, `Dept: ${dept}`);
  saveData();
  toast(`${device.tag} assigned to ${user}`, "success");
  document.getElementById("assign-user").value = "";
  document.getElementById("assign-dept").value = "";
  refreshAssignSelects();
  renderAssignedList();
  updateDashboard();
  renderInventory();
  updateFaultyBadge();
}

function reassignDevice() {
  const devId = document.getElementById("reassign-device-select").value;
  const newUser = document.getElementById("reassign-user").value.trim();
  const newDept = document.getElementById("reassign-dept").value.trim();
  if (!devId) {
    toast("Please select a device", "error");
    return;
  }
  if (!newUser) {
    toast("New user name is required", "error");
    return;
  }
  const device = devices.find((d) => d.id === devId);
  const prevUser = device.assignedUser;
  device.assignedUser = newUser;
  device.assignedDept = newDept || device.assignedDept;
  addHistory(device, "Reassigned", newUser, `From: ${prevUser} → ${newUser}`);
  saveData();
  toast(`${device.tag} reassigned from ${prevUser} to ${newUser}`, "success");
  document.getElementById("reassign-user").value = "";
  document.getElementById("reassign-dept").value = "";
  document.getElementById("reassign-current-info").style.display = "none";
  refreshReassignSelect();
  renderInventory();
  updateDashboard();
}

function renderAssignedList() {
  const assigned = devices.filter((d) => d.status === "Assigned");
  const el = document.getElementById("assigned-list");
  if (!assigned.length) {
    el.innerHTML =
      '<div class="empty-state"><div class="es-icon">🔗</div><p>No assigned devices</p></div>';
    return;
  }
  el.innerHTML = assigned
    .map(
      (d) =>
        `<div class="stat-row"><div class="s-label"><span class="tag" style="font-size:10px;">${escHtml(d.tag)}</span><div><div style="font-size:12.5px;font-weight:600;">${escHtml(d.assignedUser)}</div><div style="font-size:11px;color:var(--text3);">${escHtml(d.name)} · ${escHtml(d.assignedDept || d.dept || "—")}</div></div></div></div>`,
    )
    .join("");
}

// ── FAULTY ────────────────────────────────────────────────
function refreshFaultySelect() {
  const sel = document.getElementById("faulty-device-select");
  sel.innerHTML = '<option value="">-- Choose device --</option>';
  devices
    .filter((d) => d.status !== "Faulty")
    .forEach((d) => {
      sel.innerHTML += `<option value="${escAttr(d.id)}">${escHtml(d.tag)} - ${escHtml(d.name)} [${d.status}]</option>`;
    });
}

function markFaulty() {
  const devId = document.getElementById("faulty-device-select").value;
  const desc = document.getElementById("faulty-desc").value.trim();
  if (!devId) {
    toast("Please select a device", "error");
    return;
  }
  const device = devices.find((d) => d.id === devId);
  const prevUser = device.assignedUser || "Unassigned";
  device.status = "Faulty";
  device.assignedUser = "";
  device.assignedDept = "";
  addHistory(device, "Faulty", prevUser, desc || "Marked as faulty");
  saveData();
  toast(`${device.tag} marked as faulty`, "warning");
  document.getElementById("faulty-desc").value = "";
  refreshFaultySelect();
  renderFaulty();
  renderInventory();
  updateDashboard();
  updateFaultyBadge();
}

function restoreDevice(id) {
  const device = devices.find((d) => d.id === id);
  device.status = "Available";
  addHistory(device, "Restored", "", "Returned to inventory");
  saveData();
  toast(`${device.tag} restored to available`, "success");
  renderFaulty();
  renderInventory();
  updateDashboard();
  refreshFaultySelect();
  updateFaultyBadge();
}

function renderFaulty() {
  const faulty = devices.filter((d) => d.status === "Faulty");
  const tbody = document.getElementById("faulty-tbody");
  if (!faulty.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text3);">No faulty devices 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = faulty
    .map(
      (d) =>
        `<tr><td><span class="tag">${escHtml(d.tag)}</span></td><td>${escHtml(d.name)}</td><td class="mono" style="font-size:11px;color:var(--text3);">${escHtml(d.serial)}</td><td style="font-size:12px;">${getLastUser(d.id)}</td><td><button class="btn btn-success btn-sm" onclick="restoreDevice('${escAttr(d.id)}')">✅ Restore</button><button class="btn btn-outline btn-sm" onclick="showDetail('${escAttr(d.id)}')" style="margin-left:4px;">👁</button></td></tr>`,
    )
    .join("");
}

function getLastUser(devId) {
  const logs = history.filter((h) => h.deviceId === devId).reverse();
  for (const l of logs) {
    if (l.user && l.user !== "") return escHtml(l.user);
  }
  return "—";
}

function updateFaultyBadge() {
  const count = devices.filter((d) => d.status === "Faulty").length;
  const navEl = document.querySelector('.nav-item[data-page="faulty"]');
  if (!navEl) return;
  let badge = navEl.querySelector(".nav-badge");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      navEl.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) badge.remove();
}

// ── HISTORY ──────────────────────────────────────────────
function addHistory(device, action, user, notes) {
  history.unshift({
    id: Date.now().toString() + Math.random(),
    deviceId: device.id,
    tag: device.tag,
    serial: device.serial,
    name: device.name,
    action,
    user: user || "",
    notes: notes || "",
    date: new Date().toISOString(),
  });
  // Do NOT call saveData() here — callers are responsible for saving after all mutations
}

function renderHistory() {
  const search = (
    document.getElementById("history-search")?.value || ""
  ).toLowerCase();
  const filter = document.getElementById("history-filter")?.value || "";
  const tbody = document.getElementById("history-tbody");
  let data = history;
  if (search)
    data = data.filter(
      (h) =>
        h.tag.toLowerCase().includes(search) ||
        h.serial.toLowerCase().includes(search) ||
        (h.user || "").toLowerCase().includes(search) ||
        (h.name || "").toLowerCase().includes(search),
    );
  if (filter) data = data.filter((h) => h.action === filter);
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3);">No history records found</td></tr>`;
    return;
  }
  const ae = {
    Added: "📦",
    Assigned: "✅",
    Reassigned: "🔄",
    Faulty: "⚠️",
    Restored: "🔧",
    Ticket: "🎫",
    Updated: "📝",
    Returned: "↩",
  };
  const ac = {
    Added: "var(--blue)",
    Assigned: "var(--green)",
    Reassigned: "var(--orange)",
    Faulty: "var(--red)",
    Restored: "var(--accent)",
    Ticket: "#b400ff",
    Updated: "var(--text2)",
    Returned: "var(--text2)",
  };
  tbody.innerHTML = data
    .map(
      (h, i) =>
        `<tr><td class="mono" style="color:var(--text3);font-size:11px;">${data.length - i}</td><td class="mono" style="font-size:11px;color:var(--text2);">${formatDate(h.date)}</td><td><span class="tag">${escHtml(h.tag)}</span></td><td class="mono" style="font-size:12px;">${escHtml(h.serial)}</td><td><span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:${ac[h.action] || "var(--text)"};">${ae[h.action] || "•"} ${escHtml(h.action)}</span></td><td style="font-size:13px;">${escHtml(h.user) || "—"}</td><td style="font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(h.notes)}">${escHtml(h.notes) || "—"}</td></tr>`,
    )
    .join("");
}

// ── INVENTORY ─────────────────────────────────────────────
function updateInventoryCategoryFilter() {
  const sel = document.getElementById("inv-category-filter");
  if (!sel) return;
  const cur = sel.value || "all";
  const defaults = [
    "Laptop",
    "Desktop",
    "Monitor",
    "Printer",
    "Tablet",
    "Phone",
    "Server",
    "Network Equipment",
    "External Storage",
    "Biometric",
    "Other",
  ];
  const extras = Array.from(
    new Set(devices.map((d) => (d.category || "").trim()).filter(Boolean)),
  )
    .filter(
      (c) => !defaults.map((d) => d.toLowerCase()).includes(c.toLowerCase()),
    )
    .sort();
  sel.innerHTML =
    '<option value="all">All Categories</option>' +
    defaults
      .map((c) => `<option value="${escAttr(c)}">${escHtml(c)}</option>`)
      .join("") +
    extras
      .map((c) => `<option value="${escAttr(c)}">${escHtml(c)}</option>`)
      .join("");
  if (cur && Array.from(sel.options).some((o) => o.value === cur))
    sel.value = cur;
}

function renderInventory() {
  updateInventoryCategoryFilter();
  const search = (
    document.getElementById("inv-search")?.value ||
    document.getElementById("global-search")?.value ||
    ""
  ).toLowerCase();
  const category =
    document.getElementById("inv-category-filter")?.value || "all";
  const tbody = document.getElementById("inventory-tbody");
  let data = devices;
  if (category !== "all")
    data = data.filter(
      (d) => (d.category || "").toLowerCase() === category.toLowerCase(),
    );
  if (search)
    data = data.filter(
      (d) =>
        d.tag.toLowerCase().includes(search) ||
        d.name.toLowerCase().includes(search) ||
        d.serial.toLowerCase().includes(search) ||
        (d.dept || "").toLowerCase().includes(search) ||
        (d.assignedUser || "").toLowerCase().includes(search),
    );
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="es-icon">🗃️</div><p>${devices.length ? "No results found" : "No devices in inventory. Add your first device!"}</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = data
    .map(
      (d) =>
        `<tr><td><span class="tag">${escHtml(d.tag)}</span></td><td style="font-weight:500;">${escHtml(d.name)}</td><td class="mono" style="font-size:12px;">${escHtml(d.serial)}</td><td style="font-size:13px;">${escHtml(d.dept) || "—"}</td><td>${statusBadge(d.status)}</td><td style="font-size:13px;">${escHtml(d.assignedUser) || "—"}</td><td><div class="qr-cell" id="qr-${d.id}"></div></td><td><div class="flex-row" style="gap:4px;flex-wrap:nowrap;"><button class="btn btn-outline btn-sm" onclick="showDetail('${escAttr(d.id)}')">👁</button><button class="btn btn-outline btn-sm" onclick="printLabel('${escAttr(d.id)}')">🖨️</button><button class="btn btn-danger btn-sm" onclick="confirmDelete('${escAttr(d.id)}')">🗑</button></div></td></tr>`,
    )
    .join("");
  data.forEach((d) => {
    const el = document.getElementById("qr-" + d.id);
    if (el && !el.querySelector("canvas")) {
      try {
        new QRCode(el, {
          text: qrData(d),
          width: 48,
          height: 48,
          colorDark: "#00d4ff",
          colorLight: "#111827",
        });
      } catch (e) {}
    }
  });
}

function qrData(d) {
  return `ITAssetTrack|TAG:${d.tag}|NAME:${d.name}|SERIAL:${d.serial}|DEPT:${d.dept || "—"}|USER:${d.assignedUser || "Unassigned"}|STATUS:${d.status}`;
}
function statusBadge(status) {
  const map = {
    Assigned: "badge-assigned",
    Available: "badge-available",
    Faulty: "badge-faulty",
  };
  return `<span class="status-badge ${map[status] || ""}">${escHtml(status)}</span>`;
}

// ── DETAIL ────────────────────────────────────────────────
function showDetail(id) {
  const d = devices.find((x) => x.id === id);
  if (!d) return;
  currentDetailId = id;
  if (!d.tickets) d.tickets = [];
  const taskTabBtn = document.querySelector('.detail-tab[onclick*="dtab-tickets"]');
  if (taskTabBtn) {
    taskTabBtn.style.display = getCurrentPackage().taskLog ? "" : "none";
  }
  document
    .querySelectorAll(".detail-tab")
    .forEach((b, i) => b.classList.toggle("active", i === 0));
  document
    .querySelectorAll(".detail-tab-panel")
    .forEach((p, i) => p.classList.toggle("active", i === 0));
  document.getElementById("detail-subtitle").textContent =
    `${d.name} · ${d.tag}`;
  const vp = document.getElementById("dd-value-pill");
  if (d.purchaseValue) {
    vp.style.display = "inline-flex";
    vp.textContent = "₦" + Number(d.purchaseValue).toLocaleString();
  } else vp.style.display = "none";
  document.getElementById("dd-status-badge").innerHTML = statusBadge(d.status);
  const condLabel = {
    excellent: "Excellent",
    good: "Good",
    fair: "Fair",
    poor: "Poor",
  };
  document.getElementById("dd-condition-badge").innerHTML =
    `<span class="condition-badge ${d.condition || "good"}">${condLabel[d.condition || "good"]}</span>`;
  const wnEl = document.getElementById("dd-warranty-note");
  if (d.warrantyExpiry) {
    const diff = Math.ceil(
      (new Date(d.warrantyExpiry) - new Date()) / 86400000,
    );
    wnEl.textContent =
      diff < 0
        ? "⚠ Warranty expired"
        : diff < 90
          ? `⏳ Warranty expires in ${diff}d`
          : "🛡 Warranty valid";
    wnEl.style.color =
      diff < 0 ? "var(--red)" : diff < 90 ? "var(--orange)" : "var(--green)";
  } else wnEl.textContent = "";
  document.getElementById("detail-grid-info").innerHTML =
    `<div class="detail-item"><label>Asset Tag</label><span class="mono" style="color:var(--accent);">${escHtml(d.tag)}</span></div><div class="detail-item"><label>Old Tag</label><span class="mono">${escHtml(d.oldTag) || "—"}</span></div><div class="detail-item"><label>Device Name</label><span>${escHtml(d.name)}</span></div><div class="detail-item"><label>Brand</label><span>${escHtml(d.brand) || "—"}</span></div><div class="detail-item"><label>Category</label><span>${escHtml(d.category) || "—"}</span></div><div class="detail-item"><label>Serial Number</label><span class="mono">${escHtml(d.serial)}</span></div><div class="detail-item"><label>Assigned User</label><span>${escHtml(d.assignedUser) || "—"}</span></div><div class="detail-item"><label>Department</label><span>${escHtml(d.dept) || "—"}</span></div><div class="detail-item"><label>Date Received</label><span>${escHtml(d.dateReceived) || "—"}</span></div><div class="detail-item"><label>Date Assigned</label><span>${escHtml(d.dateAssigned) || "—"}</span></div><div class="detail-item"><label>Date Returned</label><span>${d.dateReturned ? escHtml(d.dateReturned) : '<span style="color:var(--text3);">Not returned</span>'}</span></div><div class="detail-item"><label>Warranty Expiry</label><span>${escHtml(d.warrantyExpiry) || "—"}</span></div><div class="detail-item"><label>End-of-Life</label><span>${escHtml(d.eolDate) || "—"}</span></div><div class="detail-item"><label>Added to System</label><span class="mono" style="font-size:11px;">${formatDate(d.addedDate)}</span></div>${d.notes ? `<div class="detail-item" style="grid-column:1/-1;"><label>Notes</label><span style="color:var(--text2);">${escHtml(d.notes)}</span></div>` : ""}`;
  document.getElementById("detail-grid-specs").innerHTML =
    `<div class="detail-item"><label>OS</label><span>${escHtml(d.os) || "—"}</span></div><div class="detail-item"><label>Processor</label><span>${escHtml(d.processor) || "—"}</span></div><div class="detail-item"><label>Generation</label><span>${escHtml(d.generation) || "—"}</span></div><div class="detail-item"><label>RAM</label><span class="mono">${d.ram ? d.ram + "GB" : "—"}</span></div><div class="detail-item"><label>ROM / SSD</label><span class="mono">${d.rom ? d.rom + "GB" : "—"}</span></div><div class="detail-item"><label>Disk / HDD</label><span class="mono">${d.disk ? d.disk + "GB" : "—"}</span></div><div class="detail-item"><label>Display</label><span>${d.display ? d.display + '"' : "—"}</span></div>`;
  const pv = parseFloat(d.purchaseValue) || 0;
  const cv = parseFloat(d.currentValue) || 0;
  const totalRepair = (d.tickets || []).reduce(
    (s, t) => s + (parseFloat(t.cost) || 0),
    0,
  );
  const tco = pv + totalRepair;
  document.getElementById("detail-grid-finance").innerHTML =
    `<div class="detail-item"><label>Purchase Date</label><span>${escHtml(d.purchase) || "—"}</span></div><div class="detail-item"><label>Supplier</label><span>${escHtml(d.supplier) || "—"}</span></div><div class="detail-item"><label>Invoice No.</label><span class="mono">${escHtml(d.invoiceNo) || "—"}</span></div><div class="detail-item"><label>Purchase Value</label><span>${pv ? '<span class="value-pill">₦' + pv.toLocaleString() + "</span>" : "—"}</span></div><div class="detail-item"><label>Current Value</label><span>${cv ? '<span class="value-pill">₦' + cv.toLocaleString() + "</span>" : "—"}</span></div><div class="detail-item"><label>Total Repair Cost</label><span>${totalRepair ? '<span class="cost-pill">₦' + totalRepair.toLocaleString() + "</span>" : "₦0"}</span></div><div class="detail-item"><label>Total Cost of Ownership</label><span class="mono" style="font-weight:700;">${tco ? "₦" + tco.toLocaleString() : "—"}</span></div>`;
  const dw = document.getElementById("dd-depr-wrap");
  if (pv && d.purchase) {
    dw.style.display = "block";
    const ageYears =
      (new Date() - new Date(d.purchase)) / (1000 * 60 * 60 * 24 * 365);
    const ul = 4;
    const rem = Math.max(0, Math.min(100, ((ul - ageYears) / ul) * 100));
    document.getElementById("dd-depr-bar").style.width = rem + "%";
    document.getElementById("dd-depr-bar").style.background =
      rem < 25
        ? "var(--red)"
        : rem < 50
          ? "var(--orange)"
          : "linear-gradient(90deg,var(--green),var(--accent))";
    document.getElementById("dd-depr-pct").textContent =
      Math.round(rem) + "% remaining";
    document.getElementById("dd-depr-note").textContent =
      `Based on ${ul}-year useful life · Age: ${ageYears.toFixed(1)} years`;
  } else dw.style.display = "none";
  const cs = document.getElementById("dd-cost-summary");
  if (!totalRepair && !(d.tickets || []).length) {
    cs.innerHTML =
      '<p style="color:var(--text3);font-size:12px;">No tickets logged yet.</p>';
  } else {
    const bt = {};
    (d.tickets || []).forEach((t) => {
      bt[t.type] = (bt[t.type] || 0) + (parseFloat(t.cost) || 0);
    });
    cs.innerHTML =
      Object.entries(bt)
        .map(
          ([type, cost]) =>
            `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;border-bottom:1px solid var(--border);"><span style="color:var(--text2);text-transform:capitalize;">${escHtml(type)}</span><span class="mono" style="font-weight:600;">₦${cost.toLocaleString()}</span></div>`,
        )
        .join("") +
      `<div style="display:flex;justify-content:space-between;font-size:13px;padding:8px 0;font-weight:700;"><span>Total</span><span class="mono cost-pill">₦${totalRepair.toLocaleString()}</span></div>`;
  }
  renderTicketList(d);
  const devHistory = history.filter((h) => h.deviceId === id);
  const ac = {
    Added: "var(--blue)",
    Assigned: "var(--green)",
    Reassigned: "var(--orange)",
    Faulty: "var(--red)",
    Restored: "var(--accent)",
    Ticket: "#b400ff",
    Updated: "var(--text2)",
    Returned: "var(--text2)",
  };
  document.getElementById("detail-history").innerHTML = devHistory.length
    ? devHistory
        .map(
          (h) =>
            `<div class="history-item"><div><div style="font-size:13px;font-weight:600;color:${ac[h.action] || "var(--text)"};">${escHtml(h.action)}</div><div style="font-size:11px;color:var(--text3);font-family:var(--mono);">${formatDate(h.date)}</div></div><div style="font-size:12px;color:var(--text2);">${h.user ? "User: " + escHtml(h.user) : ""} ${h.notes ? "· " + escHtml(h.notes) : ""}</div></div>`,
        )
        .join("")
    : '<p style="color:var(--text3);font-size:13px;padding:10px 0;">No history for this device.</p>';
  const qrEl = document.getElementById("detail-qr");
  qrEl.innerHTML = "";
  try {
    new QRCode(qrEl, {
      text: qrData(d),
      width: 110,
      height: 110,
      colorDark: "#00d4ff",
      colorLight: "#111827",
    });
  } catch (e) {}
  document.getElementById("modal-detail").classList.add("open");
}

// ── TICKETS ──────────────────────────────────────────────
function renderTicketList(d) {
  const el = document.getElementById("ticket-list");
  const badge = document.getElementById("ticket-count-badge");
  if (!getCurrentPackage().taskLog) {
    badge.style.display = "none";
    el.innerHTML =
      '<div class="feature-upgrade-note">Task log is part of the Pro and Business packages. Upgrade to log complaints, repairs, maintenance, and upgrades for each device.</div>';
    return;
  }
  const tickets = d.tickets || [];
  const open = tickets.filter(
    (t) => t.status !== "closed" && t.status !== "resolved",
  ).length;
  if (open) {
    badge.style.display = "inline";
    badge.textContent = open;
  } else badge.style.display = "none";
  if (!tickets.length) {
    el.innerHTML =
      '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px;">No task log entries yet. Click <strong>+ New Task</strong> to log a complaint, repair or maintenance event.</div>';
    return;
  }
  const typeLabel = {
    complaint: "🔴 Complaint",
    repair: "🟡 Repair",
    maintenance: "🔵 Maintenance",
    upgrade: "🟢 Upgrade",
  };
  el.innerHTML =
    '<div class="ticket-list">' +
    tickets
      .slice()
      .reverse()
      .map(
        (t) =>
          `<div class="ticket-card"><div class="ticket-card-hdr"><span class="ticket-type ${t.type}">${typeLabel[t.type] || t.type}</span><span class="ticket-title">${escHtml(t.title)}</span><span class="ticket-status ${t.status}">${t.status.replace("-", " ")}</span><button class="user-act-btn danger" style="margin-left:8px;" onclick="deleteTicket('${escAttr(d.id)}','${escAttr(t.id)}')">🗑</button></div><div class="ticket-meta"><span>📅 ${t.date || "—"}</span>${t.resolved ? `<span>✅ Resolved: ${t.resolved}</span>` : ""} ${t.tech ? `<span>🔧 ${escHtml(t.tech)}</span>` : ""} ${t.cost ? `<span class="ticket-cost">₦${Number(t.cost).toLocaleString()}</span>` : ""}</div>${t.desc ? `<div class="ticket-desc">${escHtml(t.desc)}</div>` : ""} ${t.resolution ? `<div class="ticket-desc" style="color:var(--green);margin-top:4px;">✅ ${escHtml(t.resolution)}</div>` : ""}</div>`,
      )
      .join("") +
    "</div>";
}

function openAddTicket(deviceId) {
  if (!ensureFeatureAccess("taskLog")) return;
  document.getElementById("ticket-device-id").value = deviceId;
  document.getElementById("ticket-modal-title").textContent =
    "📝 New Task Log Entry";
  document.getElementById("tk-title").value = "";
  document.getElementById("tk-type").value = "repair";
  document.getElementById("tk-status").value = "open";
  document.getElementById("tk-date").value = new Date()
    .toISOString()
    .split("T")[0];
  document.getElementById("tk-resolved").value = "";
  document.getElementById("tk-tech").value = "";
  document.getElementById("tk-cost").value = "";
  document.getElementById("tk-desc").value = "";
  document.getElementById("tk-resolution").value = "";
  document.getElementById("modal-ticket").classList.add("open");
}

function saveTicket() {
  if (!ensureFeatureAccess("taskLog")) return;
  const title = document.getElementById("tk-title").value.trim();
  if (!title) {
    toast("Ticket title is required", "error");
    return;
  }
  const deviceId = document.getElementById("ticket-device-id").value;
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return;
  if (!device.tickets) device.tickets = [];
  const ticket = {
    id: "tk_" + Date.now(),
    title,
    type: document.getElementById("tk-type").value,
    status: document.getElementById("tk-status").value,
    date: document.getElementById("tk-date").value,
    resolved: document.getElementById("tk-resolved").value,
    tech: document.getElementById("tk-tech").value.trim(),
    cost: parseFloat(document.getElementById("tk-cost").value) || 0,
    desc: document.getElementById("tk-desc").value.trim(),
    resolution: document.getElementById("tk-resolution").value.trim(),
    loggedAt: new Date().toISOString(),
  };
  device.tickets.push(ticket);
  addHistory(
    device,
    "Ticket",
    ticket.tech || "",
    `${ticket.type}: ${ticket.title}${ticket.cost ? " · ₦" + ticket.cost.toLocaleString() : ""}`,
  );
  saveData();
  closeModal("modal-ticket");
  toast("✅ Task log saved", "success");
  showDetail(deviceId);
}

function deleteTicket(deviceId, ticketId) {
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return;
  showConfirm(
    "Delete Ticket?",
    "This ticket will be permanently removed.",
    () => {
      device.tickets = (device.tickets || []).filter((t) => t.id !== ticketId);
      saveData();
      renderTicketList(device);
      toast("Ticket deleted", "info");
    },
  );
}

// ── EDIT DEVICE ───────────────────────────────────────────
function openEditDeviceModal(id) {
  const d = devices.find((x) => x.id === id);
  if (!d) return;
  document.getElementById("edit-device-id").value = id;
  const fmtDate = (v) => (v ? (v.includes("T") ? v.split("T")[0] : v) : "");
  document.getElementById("edit-device-body").innerHTML = `
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);font-family:var(--mono);margin-bottom:10px;">📋 Identity</div>
    <div class="form-grid">
      <div class="form-group"><label>Asset Tag</label><input type="text" id="ef-tag" value="${escAttr(d.tag)}" readonly style="color:var(--accent);font-family:var(--mono);"></div>
      <div class="form-group"><label>Old Tag</label><input type="text" id="ef-oldtag" value="${escAttr(d.oldTag || "")}"></div>
      <div class="form-group"><label>Device Name *</label><input type="text" id="ef-name" value="${escAttr(d.name)}"></div>
      <div class="form-group"><label>Brand</label><input type="text" id="ef-brand" value="${escAttr(d.brand || "")}"></div>
      <div class="form-group"><label>Serial Number</label><input type="text" id="ef-serial" value="${escAttr(d.serial)}"></div>
      <div class="form-group"><label>Category</label><select id="ef-category">${["Laptop", "Desktop", "Monitor", "Printer", "Tablet", "Phone", "Server", "Network Equipment", "External Storage", "Biometric", "Other"].map((c) => `<option ${d.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="form-group"><label>Condition</label><select id="ef-condition">${["excellent", "good", "fair", "poor"].map((c) => `<option value="${c}" ${d.condition === c ? "selected" : ""}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join("")}</select></div>
      <div class="form-group"><label>OS</label><input type="text" id="ef-os" value="${escAttr(d.os || "")}"></div>
    </div>
    <div class="divider"></div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);font-family:var(--mono);margin-bottom:10px;">⚙️ Specifications</div>
    <div class="form-grid">
      <div class="form-group"><label>Processor</label><input type="text" id="ef-processor" value="${escAttr(d.processor || "")}"></div>
      <div class="form-group"><label>Generation</label><input type="text" id="ef-generation" value="${escAttr(d.generation || "")}"></div>
      <div class="form-group"><label>RAM (GB)</label><input type="number" id="ef-ram" value="${d.ram || ""}"></div>
      <div class="form-group"><label>ROM / SSD (GB)</label><input type="number" id="ef-rom" value="${d.rom || ""}"></div>
      <div class="form-group"><label>Disk / HDD (GB)</label><input type="number" id="ef-disk" value="${d.disk || ""}"></div>
      <div class="form-group"><label>Display Size</label><input type="text" id="ef-display" value="${escAttr(d.display || "")}"></div>
    </div>
    <div class="divider"></div>
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);font-family:var(--mono);margin-bottom:10px;">👤 Assignment & Dates</div>
    <div class="form-grid">
      <div class="form-group"><label>Department</label><input type="text" id="ef-dept" value="${escAttr(d.dept || "")}"></div>
      <div class="form-group"><label>Assigned User</label><input type="text" id="ef-assigneduser" value="${escAttr(d.assignedUser || "")}"></div>
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
      <div class="form-group"><label>Purchase Value (₦)</label><input type="number" id="ef-value" value="${d.purchaseValue || ""}"></div>
      <div class="form-group"><label>Current Value (₦)</label><input type="number" id="ef-curvalue" value="${d.currentValue || ""}"></div>
      <div class="form-group"><label>Supplier</label><input type="text" id="ef-supplier" value="${escAttr(d.supplier || "")}"></div>
      <div class="form-group"><label>Invoice No.</label><input type="text" id="ef-invoice" value="${escAttr(d.invoiceNo || "")}"></div>
    </div>
    <div class="divider"></div>
    <div class="form-group"><label>Notes</label><textarea id="ef-notes" rows="2" style="resize:vertical;">${escHtml(d.notes || "")}</textarea></div>`;
  closeModal("modal-detail");
  document.getElementById("modal-edit-device").classList.add("open");
}

function saveEditDevice() {
  const id = document.getElementById("edit-device-id").value;
  const d = devices.find((x) => x.id === id);
  if (!d) return;
  const gv = (eid) => document.getElementById(eid)?.value?.trim() || "";
  const gn = (eid) => parseFloat(document.getElementById(eid)?.value) || "";
  const newName = gv("ef-name");
  if (!newName) {
    toast("Device name is required", "error");
    return;
  }
  const prevUser = d.assignedUser;
  const newUser = gv("ef-assigneduser");
  Object.assign(d, {
    name: newName,
    brand: gv("ef-brand"),
    oldTag: gv("ef-oldtag"),
    serial: gv("ef-serial") || d.serial,
    category: document.getElementById("ef-category").value,
    condition: document.getElementById("ef-condition").value,
    os: gv("ef-os"),
    processor: gv("ef-processor"),
    generation: gv("ef-generation"),
    ram: gn("ef-ram"),
    rom: gn("ef-rom"),
    disk: gn("ef-disk"),
    display: gv("ef-display"),
    dept: gv("ef-dept"),
    assignedUser: newUser,
    assignedDept: gv("ef-dept"),
    purchase: gv("ef-purchase"),
    dateReceived: gv("ef-received"),
    dateAssigned: gv("ef-assigned-date"),
    dateReturned: gv("ef-returned"),
    warrantyExpiry: gv("ef-warranty"),
    eolDate: gv("ef-eol"),
    purchaseValue: gn("ef-value"),
    currentValue: gn("ef-curvalue"),
    supplier: gv("ef-supplier"),
    invoiceNo: gv("ef-invoice"),
    notes: gv("ef-notes"),
    status: newUser ? "Assigned" : "Available",
  });
  if (newUser !== prevUser) {
    if (newUser)
      addHistory(
        d,
        prevUser ? "Reassigned" : "Assigned",
        newUser,
        `From: ${prevUser || "Unassigned"}`,
      );
    else addHistory(d, "Returned", prevUser, "Device returned to inventory");
  }
  addHistory(d, "Updated", "", "Device record updated");
  saveData();
  closeModal("modal-edit-device");
  toast(`✅ ${d.tag} updated`, "success");
  renderInventory();
  updateDashboard();
  refreshAssignSelects();
  refreshFaultySelect();
  showDetail(id);
}

// ── PRINT LABEL ───────────────────────────────────────────
function printLabel(id) {
  const d = devices.find((x) => x.id === id);
  if (!d) return;
  const win = window.open("", "_blank", "width=400,height=500");
  win.document.write(
    `<!DOCTYPE html><html><head><title>Asset Label - ${d.tag}</title><style>body{font-family:'Courier New',monospace;background:#fff;color:#000;margin:0;padding:20px;}.label{border:2px solid #000;padding:20px;max-width:340px;margin:auto;}.header{text-align:center;font-size:13px;font-weight:bold;letter-spacing:2px;margin-bottom:10px;border-bottom:1px solid #000;padding-bottom:8px;}.row{display:flex;justify-content:space-between;font-size:12px;padding:3px 0;}.label-val{font-weight:bold;}.qr-wrap{text-align:center;margin:14px 0 10px;}.footer{text-align:center;font-size:10px;color:#666;}#qrcode canvas,#qrcode img{width:120px!important;height:120px!important;}</styl><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script></head><body><div class="label"><div class="header">🖥️ IT DEPARTMENT — ASSET LABEL</div><div class="row"><span>Asset Tag:</span><span class="label-val">${d.tag}</span></div><div class="row"><span>Device:</span><span class="label-val">${d.name}</span></div><div class="row"><span>Serial:</span><span class="label-val">${d.serial}</span></div><div class="row"><span>Dept:</span><span class="label-val">${d.dept || "—"}</span></div><div class="row"><span>Status:</span><span class="label-val">${d.status}</span></div>${d.assignedUser ? `<div class="row"><span>Assigned:</span><span class="label-val">${d.assignedUser}</span></div>` : ""}<div class="qr-wrap"><div id="qrcode"></div></div><div class="footer">Scan QR for full device details · ${new Date().toLocaleDateString()}</div></div><script>new QRCode(document.getElementById('qrcode'),{text:${JSON.stringify(qrData(d))},width:120,height:120,colorDark:'#000',colorLight:'#fff'});setTimeout(()=>window.print(),600);<\/script></body></html>`,
  );
  win.document.close();
}

// ── DASHBOARD ─────────────────────────────────────────────
function updateDashboard() {
  const total = devices.length,
    assigned = devices.filter((d) => d.status === "Assigned").length,
    available = devices.filter((d) => d.status === "Available").length,
    faulty = devices.filter((d) => d.status === "Faulty").length;
  document.getElementById("kpi-total").textContent = total;
  document.getElementById("kpi-assigned").textContent = assigned;
  document.getElementById("kpi-available").textContent = available;
  document.getElementById("kpi-faulty").textContent = faulty;
  document.getElementById("last-sync").textContent =
    "Updated: " + new Date().toLocaleTimeString();
  const ctx = document.getElementById("dashboard-chart").getContext("2d");
  if (dashChart) dashChart.destroy();
  if (total === 0) {
    document.getElementById("dashboard-chart").style.display = "none";
    document.getElementById("dept-stats").innerHTML =
      '<div class="empty-state"><div class="es-icon">📊</div><p>Add devices to see stats</p></div>';
    return;
  }
  document.getElementById("dashboard-chart").style.display = "block";
  dashChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Assigned", "Available", "Faulty"],
      datasets: [
        {
          data: [assigned, available, faulty],
          backgroundColor: ["#00e676", "#2979ff", "#ff1744"],
          borderColor: "#111827",
          borderWidth: 3,
          hoverBorderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#8899b0",
            font: { size: 12, family: "IBM Plex Mono" },
            padding: 20,
          },
        },
      },
      cutout: "68%",
    },
  });
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
  document.getElementById("dept-stats").innerHTML =
    `<div class="stat-row"><div class="s-label"><span style="color:var(--green)">●</span> Assigned</div><div class="s-val" style="color:var(--green);">${pct(assigned)}%</div></div><div class="progress-bar"><div class="progress-fill" style="width:${pct(assigned)}%;background:var(--green);"></div></div><div class="stat-row" style="margin-top:10px;"><div class="s-label"><span style="color:var(--blue)">●</span> Available</div><div class="s-val" style="color:var(--blue);">${pct(available)}%</div></div><div class="progress-bar"><div class="progress-fill" style="width:${pct(available)}%;background:var(--blue);"></div></div><div class="stat-row" style="margin-top:10px;"><div class="s-label"><span style="color:var(--red)">●</span> Faulty</div><div class="s-val" style="color:var(--red);">${pct(faulty)}%</div></div><div class="progress-bar"><div class="progress-fill" style="width:${pct(faulty)}%;background:var(--red);"></div></div><div class="divider"></div><div class="stat-row"><div class="s-label">Total Registered</div><div class="s-val">${total}</div></div>`;
  const recentEl = document.getElementById("recent-activity");
  const recent = history.slice(0, 6);
  if (!recent.length) {
    recentEl.innerHTML =
      '<div class="empty-state"><div class="es-icon">📋</div><p>No activity yet</p></div>';
    return;
  }
  const ae = {
    Added: "📦",
    Assigned: "✅",
    Reassigned: "🔄",
    Faulty: "⚠️",
    Restored: "🔧",
    Ticket: "🎫",
  };
  const ac = {
    Added: "var(--blue)",
    Assigned: "var(--green)",
    Reassigned: "var(--orange)",
    Faulty: "var(--red)",
    Restored: "var(--accent)",
    Ticket: "#b400ff",
    Updated: "var(--text2)",
    Returned: "var(--text2)",
  };
  recentEl.innerHTML = recent
    .map(
      (h) =>
        `<div class="history-item"><div class="history-dot" style="background:${ac[h.action] || "var(--blue)"}22;">${ae[h.action] || "•"}</div><div class="history-body"><div class="history-action"><span style="color:${ac[h.action] || "var(--text)"};">${escHtml(h.action)}</span> — <span class="mono" style="font-size:12px;">${escHtml(h.tag)}</span> (${escHtml(h.name)})</div><div class="history-meta">${h.user ? "👤 " + escHtml(h.user) + " · " : ""}${formatDate(h.date)}</div></div></div>`,
    )
    .join("");
}

// ── TASK LOG ─────────────────────────────────────────────
function taskStatusBadge(status) {
  const meta = {
    completed: ["var(--green-dim)", "var(--green)", "Completed"],
    "in-progress": ["var(--blue-dim)", "var(--blue)", "In Progress"],
    planned: ["var(--surface2)", "var(--text2)", "Planned"],
    blocked: ["var(--red-dim)", "var(--red)", "Blocked"],
  };
  const [bg, color, label] = meta[status] || meta.planned;
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:999px;background:${bg};color:${color};font-size:10px;font-family:var(--mono);font-weight:700;text-transform:uppercase;letter-spacing:.6px;">${label}</span>`;
}

function getTaskEntriesForPeriod(period = "all", source = tasks) {
  if (period === "all") return [...source];
  const bounds = getBoundsForPeriod(period);
  if (!bounds) return [...source];
  return source.filter((task) => {
    const d = new Date(task.date || task.createdAt || Date.now());
    return d >= bounds.start && d <= bounds.end;
  });
}

function getFilteredTasks(options = {}) {
  const dateFilter =
    options.date !== undefined
      ? options.date
      : document.getElementById("task-date-filter")?.value || "";
  const periodFilter =
    options.period !== undefined
      ? options.period
      : document.getElementById("task-period-filter")?.value || "all";
  const statusFilter =
    options.status !== undefined
      ? options.status
      : document.getElementById("task-status-filter")?.value || "";
  const search = String(
    options.search !== undefined
      ? options.search
      : document.getElementById("task-search")?.value || "",
  )
    .trim()
    .toLowerCase();
  let filtered = getTaskEntriesForPeriod(periodFilter, tasks);
  if (dateFilter) {
    filtered = filtered.filter(
      (task) => toDateInputValue(task.date || task.createdAt) === dateFilter,
    );
  }
  if (statusFilter) {
    filtered = filtered.filter((task) => task.status === statusFilter);
  }
  if (search) {
    filtered = filtered.filter((task) =>
      [
        task.staff,
        task.dept,
        task.title,
        task.category,
        task.details,
        task.outcome,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search),
    );
  }
  return filtered.sort(
    (a, b) =>
      new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0),
  );
}

function renderTaskSummaryCards(filtered) {
  const total = filtered.length;
  const completed = filtered.filter((task) => task.status === "completed").length;
  const hours = filtered.reduce(
    (sum, task) => sum + (parseFloat(task.durationHours) || 0),
    0,
  );
  const staffCount = new Set(filtered.map((task) => task.staff).filter(Boolean)).size;
  document.getElementById("task-kpi-total").textContent = total;
  document.getElementById("task-kpi-completed").textContent = completed;
  document.getElementById("task-kpi-hours").textContent = `${hours.toFixed(hours % 1 ? 1 : 0)}h`;
  document.getElementById("task-kpi-staff").textContent = staffCount;
}

function renderTaskPeriodSummary(filtered) {
  const period = document.getElementById("task-period-filter")?.value || "all";
  const summaryEl = document.getElementById("task-period-summary");
  const staffEl = document.getElementById("task-staff-summary");
  if (!summaryEl || !staffEl) return;
  if (!filtered.length) {
    summaryEl.innerHTML =
      '<div class="empty-state"><div class="es-icon">📝</div><p>No task entries for this view</p></div>';
    staffEl.innerHTML =
      '<div style="font-size:12px;color:var(--text3);">No staff activity to summarise.</div>';
    return;
  }
  const hours = filtered.reduce(
    (sum, task) => sum + (parseFloat(task.durationHours) || 0),
    0,
  );
  const categories = {};
  filtered.forEach((task) => {
    categories[task.category || "other"] =
      (categories[task.category || "other"] || 0) + 1;
  });
  const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  summaryEl.innerHTML =
    `<div class="stat-row"><div class="s-label">Period</div><div class="s-val mono">${escHtml(period === "all" ? "All" : period)}</div></div><div class="stat-row"><div class="s-label">Entries</div><div class="s-val mono">${filtered.length}</div></div><div class="stat-row"><div class="s-label">Hours Logged</div><div class="s-val mono">${hours.toFixed(hours % 1 ? 1 : 0)}h</div></div><div class="stat-row"><div class="s-label">Completed</div><div class="s-val mono" style="color:var(--green);">${filtered.filter((task) => task.status === "completed").length}</div></div><div class="stat-row"><div class="s-label">Top Category</div><div class="s-val mono">${escHtml(topCategory ? topCategory[0] : "—")}</div></div>`;
  const staffMap = {};
  filtered.forEach((task) => {
    const key = task.staff || "Unknown";
    if (!staffMap[key]) staffMap[key] = { count: 0, hours: 0 };
    staffMap[key].count += 1;
    staffMap[key].hours += parseFloat(task.durationHours) || 0;
  });
  staffEl.innerHTML = Object.entries(staffMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(
      ([staff, info]) =>
        `<div class="stat-row"><div class="s-label">${escHtml(staff)}</div><div class="s-val mono">${info.count} · ${info.hours.toFixed(info.hours % 1 ? 1 : 0)}h</div></div>`,
    )
    .join("");
}

function renderTaskTable(filtered) {
  const tbody = document.getElementById("task-log-tbody");
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="8"><div class="empty-state"><div class="es-icon">📝</div><p>No task entries match this filter</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map(
      (task) =>
        `<tr><td class="mono" style="font-size:11px;">${escHtml(formatDateOnly(task.date || task.createdAt))}</td><td style="font-size:13px;font-weight:600;">${escHtml(task.staff)}</td><td style="font-size:12px;">${escHtml(task.dept) || "—"}</td><td><div style="font-size:13px;font-weight:600;">${escHtml(task.title)}</div><div style="font-size:11px;color:var(--text3);">${escHtml(task.outcome || task.details || "—")}</div></td><td><span class="tag" style="text-transform:capitalize;">${escHtml(task.category || "other")}</span></td><td>${taskStatusBadge(task.status)}</td><td class="mono" style="font-size:11px;">${task.durationHours ? escHtml(String(task.durationHours)) + "h" : "—"}</td><td><div class="flex-row" style="gap:4px;flex-wrap:nowrap;"><button class="btn btn-outline btn-sm" onclick="openTaskModal('${escAttr(task.id)}')">✏️</button><button class="btn btn-danger btn-sm" onclick="deleteTaskEntry('${escAttr(task.id)}')">🗑</button></div></td></tr>`,
    )
    .join("");
}

function renderTaskLogPage() {
  const noteEl = document.getElementById("task-log-upgrade-note");
  const kpiEl = document.getElementById("task-kpi-grid");
  if (!noteEl || !kpiEl) return;
  if (!getCurrentPackage().taskLog) {
    noteEl.style.display = "block";
    noteEl.textContent =
      "Daily activity task logging and weekly, monthly, quarterly, and yearly reporting are available on Pro and Business.";
    kpiEl.style.display = "none";
    renderTaskTable([]);
    renderTaskPeriodSummary([]);
    return;
  }
  noteEl.style.display = "none";
  kpiEl.style.display = "grid";
  const filtered = getFilteredTasks();
  renderTaskSummaryCards(filtered);
  renderTaskPeriodSummary(filtered);
  renderTaskTable(filtered);
}

function openTaskModal(taskId = "") {
  if (!ensureFeatureAccess("taskLog")) return;
  const task = taskId ? tasks.find((entry) => entry.id === taskId) : null;
  const currentUser = getCurrentUser();
  document.getElementById("task-entry-id").value = task ? task.id : "";
  document.getElementById("task-modal-title").textContent = task
    ? "📝 Edit Daily Activity"
    : "📝 Log Daily Activity";
  document.getElementById("tl-date").value = toDateInputValue(
    task ? task.date : new Date(),
  );
  document.getElementById("tl-staff").value =
    task?.staff || currentUser?.name || "";
  document.getElementById("tl-dept").value =
    task?.dept || currentUser?.dept || "";
  document.getElementById("tl-category").value = task?.category || "support";
  document.getElementById("tl-status").value = task?.status || "completed";
  document.getElementById("tl-duration").value = task?.durationHours || "";
  document.getElementById("tl-title").value = task?.title || "";
  document.getElementById("tl-details").value = task?.details || "";
  document.getElementById("tl-outcome").value = task?.outcome || "";
  document.getElementById("modal-task-log").classList.add("open");
}

function saveTaskEntry() {
  if (!ensureFeatureAccess("taskLog")) return;
  const id = document.getElementById("task-entry-id").value;
  const date = document.getElementById("tl-date").value;
  const staff = document.getElementById("tl-staff").value.trim();
  const dept = document.getElementById("tl-dept").value.trim();
  const category = document.getElementById("tl-category").value;
  const status = document.getElementById("tl-status").value;
  const durationHours =
    parseFloat(document.getElementById("tl-duration").value) || 0;
  const title = document.getElementById("tl-title").value.trim();
  const details = document.getElementById("tl-details").value.trim();
  const outcome = document.getElementById("tl-outcome").value.trim();
  const currentUser = getCurrentUser();
  if (!date || !staff || !title) {
    toast("Date, staff name, and task title are required", "error");
    return;
  }
  const payload = {
    id: id || "task_" + Date.now(),
    date,
    staff,
    dept,
    category,
    status,
    durationHours,
    title,
    details,
    outcome,
    updatedAt: new Date().toISOString(),
    createdBy: currentUser?.username || "system",
  };
  if (!id) {
    tasks.push({ ...payload, createdAt: new Date().toISOString() });
  } else {
    const idx = tasks.findIndex((entry) => entry.id === id);
    if (idx === -1) return;
    tasks[idx] = { ...tasks[idx], ...payload };
  }
  saveData();
  closeModal("modal-task-log");
  toast(id ? "Task activity updated" : "Daily activity logged", "success");
  renderTaskLogPage();
  renderReportSummary();
}

function deleteTaskEntry(taskId) {
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) return;
  showConfirm(
    "Delete Task Entry?",
    `This will permanently remove "${task.title}" from the task log.`,
    () => {
      tasks = tasks.filter((entry) => entry.id !== taskId);
      saveData();
      toast("Task activity deleted", "warning");
      renderTaskLogPage();
      renderReportSummary();
    },
  );
}

function exportTaskLogCSV(period = "all") {
  if (!ensureFeatureAccess("taskLog")) return;
  const data =
    period === "all"
      ? getFilteredTasks()
      : getFilteredTasks({ period, date: "", search: "", status: "" });
  const headers = [
    "Date",
    "Staff Name",
    "Department",
    "Task Title",
    "Category",
    "Status",
    "Duration (Hours)",
    "Details",
    "Outcome",
    "Created By",
    "Created At",
    "Updated At",
  ];
  const rows = data.map((task) => [
    formatDateOnly(task.date || task.createdAt),
    task.staff || "",
    task.dept || "",
    task.title || "",
    task.category || "",
    task.status || "",
    task.durationHours || "",
    task.details || "",
    task.outcome || "",
    task.createdBy || "",
    formatDate(task.createdAt),
    formatDate(task.updatedAt),
  ]);
  downloadCSV(`IT_Task_Log_${period}_${dateStamp()}.csv`, [headers, ...rows]);
  toast(`Task log exported (${data.length} entries)`, "success");
}

function renderTaskReportSummary() {
  const el = document.getElementById("task-report-summary");
  if (!el) return;
  if (!getCurrentPackage().taskLog) {
    el.innerHTML =
      '<div class="feature-upgrade-note">Task activity reporting is included in the Pro and Business packages.</div>';
    return;
  }
  const summaries = [
    ["Weekly", getTaskEntriesForPeriod("week")],
    ["Monthly", getTaskEntriesForPeriod("month")],
    ["Quarterly", getTaskEntriesForPeriod("quarter")],
    ["Yearly", getTaskEntriesForPeriod("year")],
  ];
  el.innerHTML = summaries
    .map(([label, entries]) => {
      const hours = entries.reduce(
        (sum, task) => sum + (parseFloat(task.durationHours) || 0),
        0,
      );
      const completed = entries.filter((task) => task.status === "completed").length;
      return `<div class="stat-row"><div class="s-label">${label}</div><div class="s-val mono">${entries.length} entries · ${completed} done · ${hours.toFixed(hours % 1 ? 1 : 0)}h</div></div>`;
    })
    .join("");
}

// ── REPORTS ───────────────────────────────────────────────
function exportCSV(filter = "all") {
  let data = devices;
  if (filter === "assigned")
    data = devices.filter((d) => d.status === "Assigned");
  if (filter === "available")
    data = devices.filter((d) => d.status === "Available");
  if (filter === "faulty") data = devices.filter((d) => d.status === "Faulty");
  const headers = [
    "Asset Tag",
    "Old Tag",
    "Device Name",
    "Brand",
    "Serial Number",
    "Category",
    "Condition",
    "OS",
    "Processor",
    "Generation",
    "RAM (GB)",
    "ROM (GB)",
    "Disk (GB)",
    "Display",
    "Department",
    "Assigned User",
    "Status",
    "Date Purchased",
    "Date Received",
    "Date Assigned",
    "Date Returned",
    "Warranty Expiry",
    "End-of-Life",
    "Purchase Value (₦)",
    "Current Value (₦)",
    "Total Repair Cost (₦)",
    "Supplier",
    "Invoice No",
    "Notes",
    "Added Date",
  ];
  const rows = data.map((d) => {
    const rc = (d.tickets || []).reduce(
      (s, t) => s + (parseFloat(t.cost) || 0),
      0,
    );
    return [
      d.tag,
      d.oldTag || "",
      d.name,
      d.brand || "",
      d.serial,
      d.category || "",
      d.condition || "",
      d.os || "",
      d.processor || "",
      d.generation || "",
      d.ram || "",
      d.rom || "",
      d.disk || "",
      d.display || "",
      d.dept || "",
      d.assignedUser || "",
      d.status,
      d.purchase || "",
      d.dateReceived || "",
      d.dateAssigned || "",
      d.dateReturned || "",
      d.warrantyExpiry || "",
      d.eolDate || "",
      d.purchaseValue || "",
      d.currentValue || "",
      rc || "",
      d.supplier || "",
      d.invoiceNo || "",
      d.notes || "",
      formatDate(d.addedDate),
    ];
  });
  downloadCSV("ITAssetTrack_" + filter + "_" + dateStamp() + ".csv", [
    headers,
    ...rows,
  ]);
  toast("Exported " + data.length + " records", "success");
}

function exportHistoryCSV() {
  const headers = [
    "#",
    "Date",
    "Asset Tag",
    "Serial",
    "Device",
    "Action",
    "User",
    "Notes",
  ];
  const rows = history.map((h, i) => [
    i + 1,
    formatDate(h.date),
    h.tag,
    h.serial,
    h.name,
    h.action,
    h.user || "",
    h.notes || "",
  ]);
  downloadCSV("IT_History_" + dateStamp() + ".csv", [headers, ...rows]);
  toast("History exported", "success");
}

function downloadCSV(filename, rows) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderReportSummary() {
  const total = devices.length,
    assigned = devices.filter((d) => d.status === "Assigned").length,
    available = devices.filter((d) => d.status === "Available").length,
    faulty = devices.filter((d) => d.status === "Faulty").length;
  document.getElementById("report-summary").innerHTML =
    `<div class="stat-row"><div class="s-label">Total Devices</div><div class="s-val mono">${total}</div></div><div class="stat-row"><div class="s-label">Assigned</div><div class="s-val mono" style="color:var(--green);">${assigned}</div></div><div class="stat-row"><div class="s-label">Available</div><div class="s-val mono" style="color:var(--blue);">${available}</div></div><div class="stat-row"><div class="s-label">Faulty</div><div class="s-val mono" style="color:var(--red);">${faulty}</div></div><div class="stat-row"><div class="s-label">History Records</div><div class="s-val mono">${history.length}</div></div><div class="stat-row"><div class="s-label">Task Entries</div><div class="s-val mono">${tasks.length}</div></div>`;
  renderTaskReportSummary();
}

// ── SETTINGS ─────────────────────────────────────────────
function loadSettingsForm() {
  document.getElementById("s-prefix").value = settings.prefix;
  document.getElementById("s-start").value = settings.start;
  document.getElementById("s-padding").value = settings.padding;
  document.getElementById("s-counter").value = settings.counter;
  updateTagPreview();
}
function updateTagPreview() {
  const prefix = document.getElementById("s-prefix").value.trim() || "IT";
  const padding = parseInt(document.getElementById("s-padding").value) || 4;
  const counter = parseInt(document.getElementById("s-counter").value) || 1;
  document.getElementById("tag-preview-val").textContent =
    `${prefix}-${String(counter).padStart(padding, "0")}`;
  document.getElementById("tag-preview-next").textContent =
    `${prefix}-${String(counter + 1).padStart(padding, "0")}`;
}
["s-prefix", "s-start", "s-padding", "s-counter"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", updateTagPreview);
});
["task-date-filter", "task-period-filter", "task-status-filter", "task-search"].forEach(
  (id) => {
    const el = document.getElementById(id);
    if (el) {
      const evt = id === "task-search" ? "input" : "change";
      el.addEventListener(evt, renderTaskLogPage);
    }
  },
);
function saveSettings() {
  settings.prefix = document.getElementById("s-prefix").value.trim() || "IT";
  settings.start = parseInt(document.getElementById("s-start").value) || 1;
  settings.padding = parseInt(document.getElementById("s-padding").value) || 4;
  settings.counter = parseInt(document.getElementById("s-counter").value) || 1;
  saveData();
  toast("Settings saved!", "success");
  updateTagPreview();
}

// ── DELETE ────────────────────────────────────────────────
function confirmDelete(id) {
  const d = devices.find((x) => x.id === id);
  showConfirm(
    `Delete ${d.tag}?`,
    `This will permanently remove "${d.name}" from inventory.`,
    () => {
      devices = devices.filter((x) => x.id !== id);
      saveData();
      toast(`${d.tag} deleted`, "warning");
      renderInventory();
      updateDashboard();
      renderFaulty();
      refreshAssignSelects();
      refreshFaultySelect();
      updateFaultyBadge();
    },
  );
}
function confirmClear() {
  showConfirm(
    "Clear All Data?",
    "This will permanently delete ALL devices, history, task logs, and reset settings.",
    () => {
      devices = [];
      history = [];
      tasks = [];
      settings = { prefix: "IT", start: 1, padding: 4, counter: 1 };
      saveData();
      toast("All data cleared", "warning");
      loadSettingsForm();
      renderInventory();
      updateDashboard();
      renderTaskLogPage();
      renderHistory();
      renderFaulty();
      refreshAssignSelects();
      refreshFaultySelect();
      updateFaultyBadge();
      renderReportSummary();
    },
  );
}

// ── MODALS ────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
document.querySelectorAll(".modal-overlay").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.remove("open");
  });
});
function showConfirm(title, msg, cb) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-msg").textContent = msg;
  confirmCallback = cb;
  document.getElementById("modal-confirm").classList.add("open");
}
document.getElementById("confirm-ok-btn").addEventListener("click", () => {
  if (confirmCallback) confirmCallback();
  closeModal("modal-confirm");
  confirmCallback = null;
});

// ── CONNECTIVITY ──────────────────────────────────────────
function updateOfflineBadge() {
  const badge = document.getElementById("offline-badge");
  if (!badge) return;
  const online =
    typeof lastConnectivity === "boolean" ? lastConnectivity : navigator.onLine;
  badge.classList.toggle("is-online", online);
  badge.classList.toggle("is-offline", !online);
  document.getElementById("offline-text").textContent = online
    ? "Online"
    : "Offline Ready";
}
function checkConnectivity() {
  if (navigator.onLine === false) {
    lastConnectivity = false;
    updateOfflineBadge();
    return;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  fetch("https://www.gstatic.com/generate_204", {
    mode: "no-cors",
    cache: "no-store",
    signal: controller.signal,
  })
    .then(() => {
      lastConnectivity = true;
    })
    .catch(() => {
      lastConnectivity = false;
    })
    .finally(() => {
      clearTimeout(t);
      updateOfflineBadge();
    });
}
window.addEventListener("online", () => checkConnectivity());
window.addEventListener("offline", () => {
  lastConnectivity = false;
  updateOfflineBadge();
});
function startConnectivityMonitor() {
  if (connectivityTimer) return;
  checkConnectivity();
  connectivityTimer = setInterval(checkConnectivity, 15000);
}

// ── GOOGLE SHEETS SYNC ────────────────────────────────────
function loadSheetsConfig() {
  try {
    sheetsConfig = JSON.parse(localStorage.getItem(SHEETS_CONFIG_KEY));
  } catch (e) {
    sheetsConfig = null;
  }
  try {
    backendConfig = JSON.parse(localStorage.getItem(BACKEND_CONFIG_KEY));
  } catch (e) {
    backendConfig = null;
  }
  updateSyncBar();
}
function saveSheetsConfig(cfg) {
  sheetsConfig = cfg;
  localStorage.setItem(SHEETS_CONFIG_KEY, JSON.stringify(cfg));
}
function saveBackendConfig(cfg) {
  backendConfig = cfg;
  localStorage.setItem(BACKEND_CONFIG_KEY, JSON.stringify(cfg));
  updateSyncBar();
}
function getBackendUrl() {
  if (!getCurrentPackage().sheetsSync) return null;
  return backendConfig && backendConfig.apiUrl ? backendConfig.apiUrl : null;
}
function getBackendSyncToken() {
  return backendConfig && backendConfig.syncToken
    ? backendConfig.syncToken
    : "";
}
function getSheetsUrl() {
  return sheetsConfig && sheetsConfig.scriptUrl ? sheetsConfig.scriptUrl : null;
}
function getSheetsSyncSecret() {
  return sheetsConfig && sheetsConfig.syncSecret ? sheetsConfig.syncSecret : "";
}
function getSyncProvider() {
  if (!getCurrentPackage().sheetsSync) return null;
  const backendUrl = getBackendUrl();
  if (backendUrl) {
    return {
      id: "backend",
      name: "Backend Database",
      url: backendUrl,
    };
  }
  const sheetsUrl = getSheetsUrl();
  if (sheetsUrl) {
    return {
      id: "sheets",
      name: "Google Sheets",
      url: sheetsUrl,
    };
  }
  return null;
}
function getSyncUrl() {
  const provider = getSyncProvider();
  return provider ? provider.url : null;
}
function buildSheetsUrl(url, params = {}) {
  const fullUrl = new URL(url, location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      fullUrl.searchParams.set(key, value);
    }
  });
  return fullUrl.toString();
}
function getSheetsRequestParams() {
  return {
    auth: getSheetsSyncSecret(),
    v: Date.now().toString(),
  };
}
function getSyncHeaders(provider, includeContentType = false) {
  const headers = {};
  if (includeContentType) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  if (provider && provider.id === "backend" && getBackendSyncToken()) {
    headers.Authorization = `Bearer ${getBackendSyncToken()}`;
  }
  return headers;
}
function updateSyncBar() {
  const dot = document.getElementById("sync-dot");
  const txt = document.getElementById("sync-text");
  const timeEl = document.getElementById("sync-time");
  if (!getCurrentPackage().sheetsSync) {
    dot.className = "sync-dot local";
    txt.textContent = "Shared sync is available on Pro and Business";
    timeEl.textContent = "";
    return;
  }
  const provider = getSyncProvider();
  if (!provider) {
    dot.className = "sync-dot local";
    txt.textContent = "Shared sync: Not configured — running locally";
    timeEl.textContent = "";
    return;
  }
  const states = {
    local: ["local", "Local mode"],
    online: ["online", `Synced with ${provider.name}`],
    syncing: ["syncing", "Syncing…"],
    offline: ["offline", "Sync failed — check connection"],
  };
  const [cls, label] = states[syncStatus] || states.local;
  dot.className = `sync-dot ${cls}`;
  txt.textContent = label;
  timeEl.textContent = lastSyncTime
    ? `Last sync: ${new Date(lastSyncTime).toLocaleTimeString()}`
    : "";
}
function setSyncStatus(s) {
  syncStatus = s;
  updateSyncBar();
}
async function pullFromSheets() {
  if (!ensureFeatureAccess("sheetsSync")) return false;
  const provider = getSyncProvider();
  const url = provider ? provider.url : null;
  if (!url || isSyncing) return false;
  isSyncing = true;
  setSyncStatus("syncing");
  try {
    const requestUrl =
      provider && provider.id === "sheets"
        ? buildSheetsUrl(url, { action: "read", ...getSheetsRequestParams() })
        : `${url}?action=read&v=${Date.now()}`;
    const res = await fetch(requestUrl, {
      method: "GET",
      mode: "cors",
      headers: getSyncHeaders(provider),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    if (data.devices !== undefined) {
      devices = data.devices || [];
      history = data.history || [];
      tasks = data.tasks || [];
      settings = { ...settings, ...(data.settings || {}) };
      if (data.users !== undefined)
        saveUsers(data.users || [...DEFAULT_USERS], false);
      saveDataLocal();
      lastSyncTime = new Date().toISOString();
      setSyncStatus("online");
      isSyncing = false;
      lastSyncError = "";
      return true;
    }
    throw new Error("Invalid response");
  } catch (err) {
    lastSyncError = err && err.message ? err.message : "Sync failed";
    console.warn("Google/backend pull failed:", lastSyncError);
    setSyncStatus("offline");
    isSyncing = false;
    return false;
  }
}
async function pushToSheets() {
  if (!ensureFeatureAccess("sheetsSync")) return false;
  await migrateLegacyUsersIfNeeded();
  const provider = getSyncProvider();
  const url = provider ? provider.url : null;
  if (!url) return false;
  setSyncStatus("syncing");
  try {
    const body = new URLSearchParams({
      action: "write",
      data: JSON.stringify({
        devices,
        history,
        tasks,
        settings,
        users: sanitizeUsersForSync(getUsers()),
      }),
    });
    if (provider && provider.id === "sheets" && getSheetsSyncSecret()) {
      body.set("auth", getSheetsSyncSecret());
    }
    const res = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: getSyncHeaders(provider, true),
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (result.ok) {
      lastSyncTime = new Date().toISOString();
      setSyncStatus("online");
      lastSyncError = "";
      return true;
    }
    throw new Error(result.error || "Write failed");
  } catch (err) {
    lastSyncError = err && err.message ? err.message : "Sync failed";
    console.warn("Google/backend push failed:", lastSyncError);
    setSyncStatus("offline");
    return false;
  }
}
async function doSyncNow() {
  if (!ensureFeatureAccess("sheetsSync")) return false;
  const ok = await pullFromSheets();
  if (ok) {
    renderInventory();
    updateDashboard();
    renderTaskLogPage();
    renderReportSummary();
    renderHistory();
    renderFaulty();
    refreshAssignSelects();
    updateFaultyBadge();
    toast("Shared data synced", "success");
  } else toast(`Sync failed — ${lastSyncError || "check URL, secret, or connection"}`, "error");
}
function startAutoSync() {
  if (!getCurrentPackage().sheetsSync) return;
  if (!getSyncUrl()) return;
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    const ok = await pullFromSheets();
    if (ok) {
      renderInventory();
      updateDashboard();
    }
  }, 30000);
}
function disconnectSheets() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
  localStorage.removeItem(SHEETS_CONFIG_KEY);
  sheetsConfig = null;
  setSyncStatus("local");
  renderSheetsSettings();
  toast("Google Sheets disconnected", "warning");
}
function disconnectBackend() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = null;
  localStorage.removeItem(BACKEND_CONFIG_KEY);
  backendConfig = null;
  setSyncStatus("local");
  renderBackendSettings();
  toast("Backend database disconnected", "warning");
}
function saveBackendSettings() {
  const raw = document.getElementById("backend-api-url")?.value.trim() || "";
  const syncToken =
    document.getElementById("backend-api-token")?.value.trim() || "";
  if (!raw) {
    toast("Enter a backend API URL", "error");
    return;
  }
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith("/")) {
    toast("Use an absolute URL or a same-host path like /api/data", "error");
    return;
  }
  if (!syncToken) {
    toast("Enter the backend sync token before saving", "error");
    return;
  }
  saveBackendConfig({
    apiUrl: raw,
    syncToken,
    configuredAt: new Date().toISOString(),
  });
  renderBackendSettings();
  updateSyncBar();
  toast("Backend database configured", "success");
}
function useBuiltinBackend() {
  const syncToken =
    document.getElementById("backend-api-token")?.value.trim() ||
    getBackendSyncToken();
  if (!syncToken) {
    toast("Enter the backend sync token first", "error");
    return;
  }
  saveBackendConfig({
    apiUrl: "/api/data",
    syncToken,
    configuredAt: new Date().toISOString(),
    mode: "builtin-sqlite",
  });
  renderBackendSettings();
  updateSyncBar();
  toast("Built-in database endpoint enabled", "success");
}
function renderBackendSettings() {
  const el = document.getElementById("backend-settings-content");
  if (!el) return;
  if (!getCurrentPackage().sheetsSync) {
    el.innerHTML =
      '<div class="feature-upgrade-note">Shared backend database sync is available on Pro and Business.</div>';
    return;
  }
  const url = getBackendUrl();
  if (url) {
    el.innerHTML = `<div class="sheets-status-card"><div style="font-size:28px;">🗄️</div><div><div style="font-size:13px;font-weight:600;color:var(--text);">Backend Database Connected</div><div style="font-size:11px;color:var(--text2);font-family:var(--mono);">${escHtml(url)}</div></div></div><div class="flex-row"><button class="btn btn-outline" onclick="doSyncNow()">📥 Pull Now</button><button class="btn btn-outline" onclick="pushToSheets().then(ok=>toast(ok?'Pushed!':'Push failed',ok?'success':'error'))">📤 Push Now</button><button class="btn btn-danger" onclick="disconnectBackend()">🔌 Disconnect</button></div><div class="plan-note">This mode uses the server API instead of Google Sheets. The server should be configured with <span class="mono">ITASSET_SYNC_TOKEN</span>, and this app sends that token in the Authorization header.</div>`;
    return;
  }
  el.innerHTML = `<div class="sheets-status-card"><div style="font-size:28px;">🗄️</div><div><div style="font-size:13px;font-weight:600;color:var(--text);">No Backend Database Yet</div><div style="font-size:11px;color:var(--text2);">Use the built-in SQLite API or point to another backend endpoint.</div></div></div><div class="form-grid" style="margin-bottom:12px;"><div class="form-group" style="grid-column:1/-1;"><label>Backend API URL</label><input type="text" id="backend-api-url" value="${escAttr(backendConfig?.apiUrl || "")}" placeholder="/api/data" style="font-family:var(--mono);font-size:12px;"></div><div class="form-group" style="grid-column:1/-1;"><label>Sync Token</label><input type="password" id="backend-api-token" value="${escAttr(getBackendSyncToken())}" placeholder="Paste ITASSET_SYNC_TOKEN" style="font-family:var(--mono);font-size:12px;"></div></div><div class="flex-row"><button class="btn btn-primary" onclick="useBuiltinBackend()">⚡ Use Built-in DB</button><button class="btn btn-outline" onclick="saveBackendSettings()">💾 Save URL</button></div><div class="plan-note">Backend sync is preferred over Google Sheets when both are configured. Set <span class="mono">ITASSET_SYNC_TOKEN</span> on the server, then paste the same token here.</div>`;
}
function renderSheetsSettings() {
  const el = document.getElementById("sheets-settings-content");
  if (!el) return;
  if (!getCurrentPackage().sheetsSync) {
    el.innerHTML = `<div class="feature-upgrade-note">Starter runs fully offline on one machine. Upgrade to Pro or Business to unlock shared Google Sheets sync and server-backed collaboration.${sheetsConfig && sheetsConfig.scriptUrl ? " Your saved sync URL will remain stored until you upgrade." : ""}</div>`;
    return;
  }
  if (getBackendUrl()) {
    el.innerHTML = `<div class="plan-note">Google Sheets is available as a fallback, but backend database sync is currently active and will be used first.</div><div class="flex-row"><button class="btn btn-outline" onclick="openSetupWizard()">⚙ Configure Sheets Fallback</button>${sheetsConfig?.scriptUrl ? `<button class="btn btn-danger" onclick="disconnectSheets()">🔌 Disconnect Sheets</button>` : ""}</div>`;
    return;
  }
  const url = getSheetsUrl();
  if (url) {
    el.innerHTML = `<div class="sheets-status-card"><div style="font-size:28px;">✅</div><div><div style="font-size:13px;font-weight:600;color:var(--text);">Connected to Google Sheets</div><div style="font-size:11px;color:var(--text2);font-family:var(--mono);">${escHtml(url.substring(0, 55))}…</div><div style="font-size:11px;color:var(--text3);margin-top:4px;">Secret: ${getSheetsSyncSecret() ? "Configured" : "Not set"}</div></div></div><div class="flex-row"><button class="btn btn-outline" onclick="doSyncNow()">📥 Pull Now</button><button class="btn btn-outline" onclick="pushToSheets().then(ok=>toast(ok?'Pushed!':('Push failed: ' + (lastSyncError || 'check secret')),ok?'success':'error'))">📤 Push Now</button><button class="btn btn-outline" onclick="openSetupWizard()">⚙ Reconfigure</button><button class="btn btn-danger" onclick="disconnectSheets()">🔌 Disconnect</button></div>`;
  } else {
    el.innerHTML = `<div class="sheets-status-card"><div style="font-size:28px;">📊</div><div><div style="font-size:13px;font-weight:600;color:var(--text);">Not Connected</div><div style="font-size:11px;color:var(--text2);">Connect to sync data across devices</div></div></div><button class="btn btn-primary" onclick="openSetupWizard()">🔗 Connect Google Sheets</button>`;
  }
}

// ── SETUP WIZARD ──────────────────────────────────────────
let setupStep = 1;
const TOTAL_STEPS = 4;
function escapeSingleQuotedJs(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function buildAppsScriptCode(secret = "CHANGE_ME_SYNC_SECRET") {
  const safeSecret = escapeSingleQuotedJs(secret || "CHANGE_ME_SYNC_SECRET");
  return `var SYNC_SECRET='${safeSecret}';
var TAB_NAMES={
  devices:'Devices',
  history:'History',
  tasks:'Tasks',
  users:'Users',
  settings:'Settings',
  meta:'Meta'
};
function jsonOut(payload){
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
function isAuthorized(e){
  var provided=(e.parameter&&e.parameter.auth)||'';
  return !!provided && provided===SYNC_SECRET;
}
function safeParse(text,fallback){
  try{return JSON.parse(text);}catch(err){return fallback;}
}
function ensureSheet(book,name,headers){
  var sh=book.getSheetByName(name)||book.insertSheet(name);
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  return sh;
}
function getSheet(book,name,headers){
  var sh=book.getSheetByName(name)||book.insertSheet(name);
  if(sh.getLastRow()===0){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}
function deriveRowId(prefix,row,index){
  if(row&&row.id){return String(row.id);}
  var base=[prefix,index,row&&(row.date||row.username||row.serial||row.staff),row&&(row.action||row.title||row.name||row.tag)].filter(Boolean).join('_');
  return base||prefix+'_'+index;
}
function writeCollection(book,name,prefix,rows){
  var sh=ensureSheet(book,name,['id','sortOrder','updatedAt','json']);
  if(!rows.length){return sh;}
  var values=rows.map(function(row,index){
    return [
      deriveRowId(prefix,row,index),
      index,
      (row&&(row.updatedAt||row.lastLogin||row.date))||'',
      JSON.stringify(row||{})
    ];
  });
  sh.getRange(2,1,values.length,4).setValues(values);
  return sh;
}
function readCollection(book,name){
  var sh=getSheet(book,name,['id','sortOrder','updatedAt','json']);
  if(sh.getLastRow()<2){return [];}
  return sh
    .getRange(2,1,sh.getLastRow()-1,4)
    .getValues()
    .filter(function(row){return row[0]||row[3];})
    .sort(function(a,b){return Number(a[1]||0)-Number(b[1]||0);})
    .map(function(row){return safeParse(row[3],{});});
}
function writeSettings(book,settings){
  var sh=ensureSheet(book,TAB_NAMES.settings,['key','value']);
  var keys=Object.keys(settings||{}).sort();
  if(!keys.length){return sh;}
  var values=keys.map(function(key){
    return [key,JSON.stringify(settings[key])];
  });
  sh.getRange(2,1,values.length,2).setValues(values);
  return sh;
}
function readSettings(book){
  var sh=getSheet(book,TAB_NAMES.settings,['key','value']);
  if(sh.getLastRow()<2){return {};}
  return sh
    .getRange(2,1,sh.getLastRow()-1,2)
    .getValues()
    .filter(function(row){return row[0];})
    .reduce(function(acc,row){
      acc[row[0]]=safeParse(row[1],row[1]);
      return acc;
    },{});
}
function writeMeta(book,lastSync){
  var sh=ensureSheet(book,TAB_NAMES.meta,['key','value']);
  sh.getRange(2,1,2,2).setValues([
    ['last_sync',lastSync],
    ['layout','split-tabs-v1']
  ]);
  return sh;
}
function readMeta(book){
  var sh=getSheet(book,TAB_NAMES.meta,['key','value']);
  if(sh.getLastRow()<2){return {};}
  return sh
    .getRange(2,1,sh.getLastRow()-1,2)
    .getValues()
    .filter(function(row){return row[0];})
    .reduce(function(acc,row){
      acc[row[0]]=row[1];
      return acc;
    },{});
}
function readLegacySnapshot(book){
  var legacy=book.getSheetByName('ITData');
  if(!legacy){return null;}
  var cell=legacy.getRange('A1').getValue();
  return cell?safeParse(cell,null):null;
}
function doGet(e){return handleRequest(e);}
function doPost(e){return handleRequest(e);}
function handleRequest(e){
  try{
    if(!isAuthorized(e)){return jsonOut({error:'Unauthorized'});}
    var book=SpreadsheetApp.getActiveSpreadsheet();
    var action=(e.parameter&&e.parameter.action)||'read';
    var meta=readMeta(book);
    if(action==='health'){
      return jsonOut({ok:true,service:'google-sheets-sync',layout:meta.layout||'split-tabs-v1',updatedAt:meta.last_sync||''});
    }
    if(action==='read'){
      var payload={
        devices:readCollection(book,TAB_NAMES.devices),
        history:readCollection(book,TAB_NAMES.history),
        tasks:readCollection(book,TAB_NAMES.tasks),
        users:readCollection(book,TAB_NAMES.users),
        settings:readSettings(book)
      };
      if(!payload.devices.length&&!payload.history.length&&!payload.tasks.length&&!payload.users.length&&!Object.keys(payload.settings).length){
        var legacy=readLegacySnapshot(book);
        if(legacy){return jsonOut(legacy);}
      }
      return jsonOut(payload);
    }
    if(action==='write'){
      var incoming=JSON.parse((e.parameter&&e.parameter.data)||'{}');
      var now=new Date().toISOString();
      writeCollection(book,TAB_NAMES.devices,'device',Array.isArray(incoming.devices)?incoming.devices:[]);
      writeCollection(book,TAB_NAMES.history,'history',Array.isArray(incoming.history)?incoming.history:[]);
      writeCollection(book,TAB_NAMES.tasks,'task',Array.isArray(incoming.tasks)?incoming.tasks:[]);
      writeCollection(book,TAB_NAMES.users,'user',Array.isArray(incoming.users)?incoming.users:[]);
      writeSettings(book,incoming.settings||{});
      writeMeta(book,now);
      return jsonOut({ok:true,layout:'split-tabs-v1',updatedAt:now});
    }
    return jsonOut({error:'Unknown action'});
  }catch(err){
    return jsonOut({error:err && err.message ? err.message : String(err)});
  }
}`;
}
function getSheetsSetupSecretInput() {
  return document.getElementById("setup-sync-secret")?.value.trim() || "";
}
function updateSetupCodePreview() {
  const preview = document.getElementById("setup-code-preview");
  if (!preview) return;
  const secret = getSheetsSetupSecretInput() || "CHANGE_ME_SYNC_SECRET";
  const code = buildAppsScriptCode(secret).split("\n").slice(0, 10).join("\n");
  preview.textContent = `${code}\n...`;
}
function isValidAppsScriptUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "script.google.com") return false;
    return /\/macros\/s\/[^/]+\/(exec|dev)\/?$/i.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function openSetupWizard() {
  if (!ensureFeatureAccess("sheetsSync")) return;
  setupStep = 1;
  const secretInput = document.getElementById("setup-sync-secret");
  if (secretInput) {
    secretInput.value = getSheetsSyncSecret();
  }
  renderSetupStep();
  updateSetupCodePreview();
  document.getElementById("setup-overlay").classList.add("open");
}
function renderSetupStep() {
  document
    .querySelectorAll(".setup-step")
    .forEach((s) => s.classList.remove("active"));
  const active = document.getElementById(`setup-step-${setupStep}`);
  if (active) active.classList.add("active");
  ["pip1", "pip2", "pip3", "pip4"].forEach((id, i) => {
    const p = document.getElementById(id);
    if (!p) return;
    p.className =
      "setup-pip" +
      (i + 1 < setupStep ? " done" : i + 1 === setupStep ? " active" : "");
  });
}
function setupNext() {
  if (setupStep === 2) {
    const secret = getSheetsSetupSecretInput();
    if (!secret || secret.length < 8) {
      toast("Enter a Google sync secret with at least 8 characters", "error");
      return;
    }
  }
  if (setupStep === 3) {
    const url = document.getElementById("setup-script-url").value.trim();
    const syncSecret = getSheetsSetupSecretInput();
    if (!isValidAppsScriptUrl(url)) {
      toast("Paste the deployed Apps Script Web App URL, for example https://script.google.com/macros/s/.../exec", "error");
      return;
    }
    if (!syncSecret || syncSecret.length < 8) {
      toast("Google sync secret is missing. Go back to Step 2 and set it.", "error");
      return;
    }
    saveSheetsConfig({
      scriptUrl: url,
      syncSecret,
      setupAt: new Date().toISOString(),
    });
  }
  if (setupStep < TOTAL_STEPS) {
    setupStep++;
    renderSetupStep();
  } else {
    document.getElementById("setup-overlay").classList.remove("open");
    toast("✅ Google Sheets sync configured!", "success");
    pullFromSheets().then((ok) => {
      if (ok) {
        renderInventory();
        updateDashboard();
        toast("📥 Data pulled from Google Sheets", "success");
      }
    });
    startAutoSync();
    renderSheetsSettings();
  }
}
function setupBack() {
  if (setupStep > 1) {
    setupStep--;
    renderSetupStep();
  }
}
function copyScriptCode() {
  const code = buildAppsScriptCode(
    getSheetsSetupSecretInput() || "CHANGE_ME_SYNC_SECRET",
  );
  navigator.clipboard
    .writeText(code)
    .then(() => toast("Apps Script code copied!", "success"))
    .catch(() => {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Code copied!", "success");
    });
}
document
  .getElementById("setup-sync-secret")
  ?.addEventListener("input", updateSetupCodePreview);

// ── AUTH / USER MANAGEMENT ────────────────────────────────
const DEFAULT_USERS = [
  {
    id: "usr_admin",
    username: "admin",
    name: "Administrator",
    email: "",
    role: "admin",
    dept: "IT",
    status: "active",
    passwordSalt: "d8f3b9e4c1a72f56b0e89123c4d5e6f7",
    passwordHash:
      "4160850519fc0b3a36c4ff3eb7edea8606ffbc9f8d625ff0d235189e5ade628f",
    passwordUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: "system",
    lastLogin: null,
  },
];
function getUsers() {
  try {
    const s = JSON.parse(localStorage.getItem("itassettrack_users") || "null");
    if (!s) return [...DEFAULT_USERS];
    return s.map((u, i) => {
      if (!u.id) u.id = "usr_" + Date.now() + "_" + i;
      if (!u.role) u.role = u.username === "admin" ? "admin" : "staff";
      if (!u.status) u.status = "active";
      return u;
    });
  } catch (e) {
    return [...DEFAULT_USERS];
  }
}
function saveUsers(u, syncRemote = true) {
  const cleaned = (u || []).map((user) => sanitizeUserRecord(user));
  localStorage.setItem("itassettrack_users", JSON.stringify(cleaned));
  if (syncRemote && getSyncUrl()) pushToSheets();
}
function getCurrentUser() {
  try {
    return JSON.parse(sessionStorage.getItem("itassettrack_session") || "null");
  } catch (e) {
    return null;
  }
}
function setCurrentUser(u) {
  try {
    sessionStorage.setItem("itassettrack_session", JSON.stringify(u));
  } catch (e) {}
}
function clearCurrentUser() {
  try {
    sessionStorage.removeItem("itassettrack_session");
  } catch (e) {}
}
function isAdmin() {
  const u = getCurrentUser();
  return u && (u.role === "admin" || u.username === "admin");
}

function applyRoleUI() {
  const admin = isAdmin();
  const sec = document.getElementById("team-mgmt-section");
  if (sec) sec.style.display = admin ? "block" : "none";
  const addUserBtn = document.getElementById("team-add-user-btn");
  if (addUserBtn) {
    const canAddUsers = admin && getCurrentPackage().multiUser;
    addUserBtn.disabled = !canAddUsers;
    addUserBtn.style.opacity = canAddUsers ? "1" : ".55";
    addUserBtn.style.cursor = canAddUsers ? "pointer" : "not-allowed";
  }
  const u = getCurrentUser();
  const infoEl = document.getElementById("my-account-info");
  if (infoEl && u) {
    const roleColors = {
      admin: "var(--red)",
      manager: "var(--blue)",
      staff: "var(--accent)",
      viewer: "var(--text3)",
    };
    infoEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--blue));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#000;flex-shrink:0;">${u.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(
        0,
        2,
      )}</div><div><div style="font-size:13px;font-weight:600;">${escHtml(u.name)}</div><div style="font-size:11px;color:var(--text3);font-family:var(--mono);">@${escHtml(u.username)} · <span style="color:${roleColors[u.role] || "var(--text3)"};font-weight:700;">${u.role || "staff"}</span>${u.dept ? " · " + escHtml(u.dept) : ""}</div></div></div>`;
  }
}

function renderTeamUserList() {
  const el = document.getElementById("team-user-list");
  if (!el) return;
  if (!isAdmin()) {
    el.innerHTML =
      '<div class="admin-only-notice">Only admins can manage team accounts.</div>';
    return;
  }
  const plan = getCurrentPackage();
  const users = getUsers();
  const cu = getCurrentUser();
  if (!plan.multiUser) {
    el.innerHTML =
      '<div class="feature-upgrade-note">Starter is limited to the main admin account. Upgrade to Pro or Business to add team members and separate staff logins.</div><div style="margin-top:8px;font-size:11px;color:var(--text3);">Seats: ' +
      getSeatUsage(users) +
      " / 0</div>";
    return;
  }
  if (!users.length) {
    el.innerHTML =
      '<div class="admin-only-notice">No users yet. Click + Add User.</div>';
    return;
  }
  const avColors = [
    "#0e7490",
    "#7c3aed",
    "#0f766e",
    "#b45309",
    "#be185d",
    "#1d4ed8",
    "#15803d",
    "#9333ea",
  ];
  el.innerHTML =
    '<div class="user-list-wrap">' +
    users
      .map((u, i) => {
        const initials = u.name
          .split(" ")
          .map((w) => w[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
        const isSelf = cu && u.username === cu.username;
        const ll = u.lastLogin
          ? "Last login: " + formatDate(u.lastLogin)
          : "Never logged in";
        return `<div class="user-row"><div class="user-avatar" style="background:${avColors[i % avColors.length]};color:#fff;">${initials}</div><div class="user-info"><div class="user-name">${escHtml(u.name)}${isSelf ? ' <span style="font-size:9px;color:var(--accent);font-family:var(--mono);">YOU</span>' : ""}</div><div class="user-meta">@${escHtml(u.username)}${u.email ? " · " + escHtml(u.email) : ""}${u.dept ? " · " + escHtml(u.dept) : ""}</div><div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-top:1px;">${ll}</div></div><span class="role-badge ${u.role || "staff"}">${u.role || "staff"}</span><div style="display:flex;align-items:center;gap:5px;"><div class="status-dot-u ${u.status || "active"}"></div><span style="font-size:10px;color:var(--text3);">${u.status || "active"}</span></div><div class="user-actions"><button class="user-act-btn" onclick="openEditUserModal('${escAttr(u.id)}')">✏️ Edit</button><button class="user-act-btn" onclick="openResetPassModal('${escAttr(u.id)}')">🔑 Reset</button>${!isSelf ? `<button class="user-act-btn danger" onclick="toggleUserStatus('${escAttr(u.id)}')">${u.status === "inactive" ? "✅ Activate" : "🚫 Deactivate"}</button>` : ""}</div></div>`;
      })
      .join("") +
    '</div><div style="margin-top:8px;font-size:11px;color:var(--text3);">Total: ' +
    users.length +
    " account(s) · " +
    users.filter((u) => u.status !== "inactive").length +
    " active · Seats: " +
    getSeatUsage(users) +
    " / " +
    getSeatLimitText(plan.seatLimit) +
    "</div>";
}

function openAddUserModal() {
  const plan = getCurrentPackage();
  if (!plan.multiUser) {
    ensureFeatureAccess("multiUser");
    return;
  }
  if (
    plan.seatLimit !== Infinity &&
    getProjectedSeatUsage(getUsers(), { username: "new-user", status: "active" }) >
      plan.seatLimit
  ) {
    toast(getSeatLimitMessage(), "warning");
    return;
  }
  document.getElementById("user-modal-title").textContent =
    "👤 Add Team Member";
  document.getElementById("user-modal-sub").textContent =
    "Create a new login account for a staff member";
  document.getElementById("u-save-btn").textContent = "✅ Create Account";
  document.getElementById("u-edit-id").value = "";
  document.getElementById("u-name").value = "";
  document.getElementById("u-username").value = "";
  document.getElementById("u-email").value = "";
  document.getElementById("u-dept").value = "";
  document.getElementById("u-role").value = "staff";
  document.getElementById("u-status").value = "active";
  document.getElementById("u-password").value = "";
  document.getElementById("u-password2").value = "";
  document.getElementById("u-pass-label").innerHTML =
    'Password <span style="color:var(--red)">*</span>';
  document.getElementById("u-msg").style.display = "none";
  document.getElementById("modal-user").classList.add("open");
}

function openEditUserModal(userId) {
  const users = getUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  document.getElementById("user-modal-title").textContent = "✏️ Edit Account";
  document.getElementById("user-modal-sub").textContent =
    "Update account details for " + user.name;
  document.getElementById("u-save-btn").textContent = "💾 Save Changes";
  document.getElementById("u-edit-id").value = userId;
  document.getElementById("u-name").value = user.name;
  document.getElementById("u-username").value = user.username;
  document.getElementById("u-email").value = user.email || "";
  document.getElementById("u-dept").value = user.dept || "";
  document.getElementById("u-role").value = user.role || "staff";
  document.getElementById("u-status").value = user.status || "active";
  document.getElementById("u-password").value = "";
  document.getElementById("u-password2").value = "";
  document.getElementById("u-pass-label").innerHTML =
    'New Password <span style="color:var(--text3);font-weight:400;">(leave blank to keep)</span>';
  document.getElementById("u-msg").style.display = "none";
  document.getElementById("modal-user").classList.add("open");
}

async function saveUser() {
  const name = document.getElementById("u-name").value.trim();
  const username = document
    .getElementById("u-username")
    .value.trim()
    .toLowerCase();
  const email = document.getElementById("u-email").value.trim();
  const dept = document.getElementById("u-dept").value.trim();
  const role = document.getElementById("u-role").value;
  const status = document.getElementById("u-status").value;
  const pass = document.getElementById("u-password").value;
  const pass2 = document.getElementById("u-password2").value;
  const editId = document.getElementById("u-edit-id").value;
  const msgEl = document.getElementById("u-msg");
  function showMsg(txt, isErr) {
    msgEl.textContent = txt;
    msgEl.style.display = "block";
    msgEl.style.background = isErr ? "var(--red-dim)" : "var(--green-dim)";
    msgEl.style.color = isErr ? "var(--red)" : "var(--green)";
  }
  if (!name || !username) {
    showMsg("Full name and username are required.", true);
    return;
  }
  if (!getCurrentPackage().multiUser && !editId) {
    showMsg(getSeatLimitMessage(), true);
    return;
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    showMsg("Username: letters, numbers, dots, dashes only.", true);
    return;
  }
  const users = getUsers();
  if (!editId) {
    if (!pass) {
      showMsg("Password is required for new accounts.", true);
      return;
    }
    if (pass.length < 6) {
      showMsg("Password must be at least 6 characters.", true);
      return;
    }
    if (pass !== pass2) {
      showMsg("Passwords do not match.", true);
      return;
    }
    if (users.find((u) => u.username === username)) {
      showMsg("That username is already taken.", true);
      return;
    }
    if (
      getCurrentPackage().seatLimit !== Infinity &&
      getProjectedSeatUsage(users, { username, status }) >
        getCurrentPackage().seatLimit
    ) {
      showMsg(getSeatLimitMessage(), true);
      return;
    }
    const passwordRecord = await createPasswordRecord(pass);
    users.push({
      id: "usr_" + Date.now(),
      username,
      name,
      email,
      role,
      dept,
      status,
      ...passwordRecord,
      createdAt: new Date().toISOString(),
      createdBy: getCurrentUser() ? getCurrentUser().username : "admin",
      lastLogin: null,
    });
    saveUsers(users);
    closeModal("modal-user");
    toast("✅ Account created for " + name, "success");
    renderTeamUserList();
    refreshAuthPackageUI();
  } else {
    const idx = users.findIndex((u) => u.id === editId);
    if (idx === -1) {
      showMsg("User not found.", true);
      return;
    }
    if (users.find((u) => u.username === username && u.id !== editId)) {
      showMsg("That username is taken by another account.", true);
      return;
    }
    if (
      getCurrentPackage().seatLimit !== Infinity &&
      getProjectedSeatUsage(users, { username, status }, editId) >
        getCurrentPackage().seatLimit
    ) {
      showMsg(getSeatLimitMessage(), true);
      return;
    }
    if (pass) {
      if (pass.length < 6) {
        showMsg("Password must be at least 6 characters.", true);
        return;
      }
      if (pass !== pass2) {
        showMsg("Passwords do not match.", true);
        return;
      }
      Object.assign(users[idx], await createPasswordRecord(pass));
    }
    users[idx] = { ...users[idx], name, username, email, dept, role, status };
    saveUsers(users);
    closeModal("modal-user");
    toast("✅ " + name + "'s account updated", "success");
    renderTeamUserList();
    refreshAuthPackageUI();
  }
}

function toggleUserStatus(userId) {
  const cu = getCurrentUser();
  if (cu && cu.id === userId) {
    toast("You cannot deactivate your own account", "error");
    return;
  }
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return;
  const user = users[idx];
  const newStatus = user.status === "inactive" ? "active" : "inactive";
  if (
    newStatus === "active" &&
    getCurrentPackage().seatLimit !== Infinity &&
    getProjectedSeatUsage(users, { username: user.username, status: "active" }, userId) >
      getCurrentPackage().seatLimit
  ) {
    toast(getSeatLimitMessage(), "warning");
    return;
  }
  showConfirm(
    newStatus === "inactive" ? "Deactivate Account?" : "Activate Account?",
    newStatus === "inactive"
      ? user.name + " will not be able to log in."
      : user.name + "'s account will be reactivated.",
    () => {
      users[idx].status = newStatus;
      saveUsers(users);
      toast(
        (newStatus === "active" ? "✅ " : "🚫 ") + user.name + " " + newStatus,
        "success",
      );
      renderTeamUserList();
      refreshAuthPackageUI();
    },
  );
}

function openResetPassModal(userId) {
  const users = getUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  document.getElementById("rp-user-id").value = userId;
  document.getElementById("reset-pass-sub").textContent =
    "Set a new password for " + user.name;
  document.getElementById("rp-pass").value = "";
  document.getElementById("rp-pass2").value = "";
  document.getElementById("rp-msg").style.display = "none";
  document.getElementById("modal-reset-pass").classList.add("open");
}

async function doResetPassword() {
  const userId = document.getElementById("rp-user-id").value;
  const pass = document.getElementById("rp-pass").value;
  const pass2 = document.getElementById("rp-pass2").value;
  const msgEl = document.getElementById("rp-msg");
  function showMsg(txt, isErr) {
    msgEl.textContent = txt;
    msgEl.style.display = "block";
    msgEl.style.background = isErr ? "var(--red-dim)" : "var(--green-dim)";
    msgEl.style.color = isErr ? "var(--red)" : "var(--green)";
  }
  if (!pass) {
    showMsg("Please enter a new password.", true);
    return;
  }
  if (pass.length < 6) {
    showMsg("Password must be at least 6 characters.", true);
    return;
  }
  if (pass !== pass2) {
    showMsg("Passwords do not match.", true);
    return;
  }
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) {
    showMsg("User not found.", true);
    return;
  }
  Object.assign(users[idx], await createPasswordRecord(pass));
  saveUsers(users);
  closeModal("modal-reset-pass");
  toast("🔑 Password reset for " + users[idx].name, "success");
  renderTeamUserList();
}

// ── LOGIN ─────────────────────────────────────────────────
function switchLoginTab(btn, panelId) {
  document
    .querySelectorAll(".login-tab")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".login-panel")
    .forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(panelId).classList.add("active");
  document.getElementById("signin-error").style.display = "none";
  document.getElementById("register-error").style.display = "none";
}

async function doSignIn() {
  const username = document.getElementById("signin-user").value.trim();
  const password = document.getElementById("signin-pass").value;
  const errEl = document.getElementById("signin-error");
  if (!username || !password) {
    errEl.textContent = "Please enter your username and password.";
    errEl.style.display = "block";
    return;
  }
  const users = getUsers();
  const user = users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase(),
  );
  const validPassword = await verifyUserPassword(user, password);
  if (!user || !validPassword) {
    errEl.textContent = "Incorrect username or password.";
    errEl.style.display = "block";
    document.getElementById("signin-pass").value = "";
    return;
  }
  if (user.status === "inactive") {
    errEl.textContent =
      "This account has been deactivated. Contact your admin.";
    errEl.style.display = "block";
    return;
  }
  const allUsers = getUsers();
  const idx = allUsers.findIndex((u) => u.username === user.username);
  if (idx !== -1) {
    if (typeof allUsers[idx].password === "string" && !allUsers[idx].passwordHash) {
      Object.assign(allUsers[idx], await createPasswordRecord(allUsers[idx].password));
      delete allUsers[idx].password;
    }
    allUsers[idx].lastLogin = new Date().toISOString();
    saveUsers(allUsers);
  }
  errEl.style.display = "none";
  setCurrentUser({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role || "staff",
    dept: user.dept || "",
  });
  showApp(user);
}

async function doRegister() {
  const name = document.getElementById("reg-name").value.trim();
  const uname = document.getElementById("reg-user").value.trim();
  const pass = document.getElementById("reg-pass").value;
  const pass2 = document.getElementById("reg-pass2").value;
  const errEl = document.getElementById("register-error");
  const plan = getCurrentPackage();
  if (!plan.multiUser) {
    errEl.textContent = getSeatLimitMessage();
    errEl.style.display = "block";
    return;
  }
  if (!name || !uname || !pass || !pass2) {
    errEl.textContent = "All fields are required.";
    errEl.style.display = "block";
    return;
  }
  if (pass.length < 6) {
    errEl.textContent = "Password must be at least 6 characters.";
    errEl.style.display = "block";
    return;
  }
  if (pass !== pass2) {
    errEl.textContent = "Passwords do not match.";
    errEl.style.display = "block";
    return;
  }
  const users = getUsers();
  if (users.find((u) => u.username.toLowerCase() === uname.toLowerCase())) {
    errEl.textContent = "That username is already taken.";
    errEl.style.display = "block";
    return;
  }
  if (
    plan.seatLimit !== Infinity &&
    getProjectedSeatUsage(
      users,
      { username: uname.toLowerCase(), status: "active" },
      "",
    ) > plan.seatLimit
  ) {
    errEl.textContent = getSeatLimitMessage();
    errEl.style.display = "block";
    return;
  }
  const passwordRecord = await createPasswordRecord(pass);
  const newUser = {
    id: "usr_" + Date.now(),
    username: uname.toLowerCase(),
    name,
    email: "",
    role: "staff",
    dept: "",
    status: "active",
    ...passwordRecord,
    createdAt: new Date().toISOString(),
    createdBy: "self",
    lastLogin: new Date().toISOString(),
  };
  users.push(newUser);
  saveUsers(users);
  errEl.style.display = "none";
  setCurrentUser({
    id: newUser.id,
    username: newUser.username,
    name: newUser.name,
    role: "staff",
    dept: "",
  });
  showApp(newUser);
}

function showApp(user) {
  document.getElementById("login-screen").classList.remove("visible");
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  document.getElementById("topbar-avatar").textContent = initials;
  document.getElementById("topbar-username").textContent =
    user.name.split(" ")[0];
  document.getElementById("topbar-role").textContent = user.role || "staff";
  document.getElementById("ud-fullname").textContent = user.name;
  document.getElementById("ud-uname").textContent = "@" + user.username;
  const licBadge = getLicenseBadgeText();
  document.getElementById("sidebar-footer").innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--blue));display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#000;">${initials}</div><div><div style="font-size:12px;font-weight:600;color:var(--text);">${escHtml(user.name)}</div><div style="font-size:10px;color:var(--text3);font-family:var(--mono);">@${escHtml(user.username)}</div></div></div><div style="font-size:10px;font-family:var(--mono);color:var(--green);margin-bottom:6px;">${licBadge}</div><div style="cursor:pointer;font-size:11px;color:var(--red);display:flex;align-items:center;gap:5px;" onclick="doSignOut()">🚪 Sign Out</div>`;
  initApp();
}

function doSignOut() {
  closeUserDropdown();
  clearCurrentUser();
  devices = [];
  history = [];
  tasks = [];
  settings = { prefix: "IT", start: 1, padding: 4, counter: 1 };
  if (dashChart) {
    dashChart.destroy();
    dashChart = null;
  }
  document.getElementById("login-screen").classList.add("visible");
  document.getElementById("signin-user").value = "";
  document.getElementById("signin-pass").value = "";
  document.getElementById("signin-error").style.display = "none";
  document.getElementById("sidebar-footer").textContent = "ITAssetTrack v1.0";
  refreshAuthPackageUI();
}

function toggleUserDropdown() {
  document.getElementById("user-dropdown").classList.toggle("open");
}
function closeUserDropdown() {
  document.getElementById("user-dropdown").classList.remove("open");
}
document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("topbar-user");
  if (wrapper && !wrapper.contains(e.target)) closeUserDropdown();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const active = document.querySelector(".login-panel.active");
    if (!active) return;
    if (active.id === "tab-signin") doSignIn();
    else if (active.id === "tab-register") doRegister();
  }
});

async function updateAccount() {
  const newUser = document.getElementById("s-new-username").value.trim();
  const curPass = document.getElementById("s-cur-pass").value;
  const newPass = document.getElementById("s-new-pass").value;
  const newPass2 = document.getElementById("s-new-pass2").value;
  const msgEl = document.getElementById("account-msg");
  const session = getCurrentUser();
  if (!session) {
    doSignOut();
    return;
  }
  function showMsg(txt, ok) {
    msgEl.style.display = "block";
    msgEl.style.background = ok ? "var(--green-dim)" : "var(--red-dim)";
    msgEl.style.color = ok ? "var(--green)" : "var(--red)";
    msgEl.textContent = txt;
  }
  if (!curPass) {
    showMsg("Current password is required.", false);
    return;
  }
  const users = getUsers();
  const idx = users.findIndex(
    (u) => u.username.toLowerCase() === session.username.toLowerCase(),
  );
  if (idx === -1 || !(await verifyUserPassword(users[idx], curPass))) {
    showMsg("Current password is incorrect.", false);
    return;
  }
  if (typeof users[idx].password === "string" && !users[idx].passwordHash) {
    Object.assign(users[idx], await createPasswordRecord(users[idx].password));
    delete users[idx].password;
  }
  if (newUser) {
    if (
      users.find(
        (u, i) =>
          i !== idx && u.username.toLowerCase() === newUser.toLowerCase(),
      )
    ) {
      showMsg("That username is already taken.", false);
      return;
    }
    users[idx].username = newUser;
  }
  if (newPass) {
    if (newPass.length < 6) {
      showMsg("New password must be at least 6 characters.", false);
      return;
    }
    if (newPass !== newPass2) {
      showMsg("New passwords do not match.", false);
      return;
    }
    Object.assign(users[idx], await createPasswordRecord(newPass));
  }
  saveUsers(users);
  setCurrentUser({
    ...session,
    username: users[idx].username,
    name: users[idx].name,
  });
  document.getElementById("topbar-username").textContent =
    users[idx].name.split(" ")[0];
  document.getElementById("ud-uname").textContent = "@" + users[idx].username;
  showMsg("✅ Credentials updated successfully.", true);
  document.getElementById("s-cur-pass").value = "";
  document.getElementById("s-new-pass").value = "";
  document.getElementById("s-new-pass2").value = "";
}

// ── LICENSE ───────────────────────────────────────────────
//
// HYBRID LICENSE VERIFICATION
// ─────────────────────────────────────────────────────────
// Priority order:
//   1. Already-cached local license  → instant, no network
//   2. Offline fallback keys below   → works with no internet
//   3. Cloudflare Worker → Gumroad API → real-time when online
//
// HOW TO SET UP THE CLOUDFLARE WORKER (free, ~5 mins):
//   1. Go to https://workers.cloudflare.com → sign up free
//   2. Create a new Worker, paste the code from WORKER_CODE below
//   3. Deploy it — you get a URL like:
//      https://itassettrack-license.YOUR-NAME.workers.dev
//   4. Replace WORKER_URL below with your actual Worker URL
//   5. In the Worker, set GUMROAD_PRODUCT_ID = 'cusufrz'
//
// OFFLINE FALLBACK KEYS:
//   Add any keys you want to work offline to OFFLINE_KEYS below.
//   Format: 'XXXX-XXXX-XXXX-XXXX'  (must be uppercase, hyphens included)
//   These are useful for: your own dev machine, demo units,
//   customers in areas with no internet access.
//   ⚠️  These are visible in source — treat as secondary fallback only.
// ─────────────────────────────────────────────────────────

// ▼▼▼  CONFIGURE THESE  ▼▼▼
const WORKER_URL = "https://itasset.donalddaboiku.workers.dev"; // e.g. 'https://itassettrack-license.you.workers.dev'
const GUMROAD_PERMALINK = "https://gitsystem.gumroad.com/l/cusufrz"; // your Gumroad product permalink
const DEMO_LICENSE_KEYS = {
  starter: "DEMO-STR1-0001-0001",
  pro: "DEMO-PRO1-0001-0001",
  business: "DEMO-BIZ1-0001-0001",
};
const OFFLINE_KEYS = [
  { key: DEMO_LICENSE_KEYS.starter, packageId: "starter" },
  { key: DEMO_LICENSE_KEYS.pro, packageId: "pro" },
  { key: DEMO_LICENSE_KEYS.business, packageId: "business" },
  // Add your offline/hardcoded keys here, e.g.:
  // 'ITAT-DEMO-0001-ABCD',
  // { key: 'ITAT-PRO-0001-ABCD', packageId: 'pro' },
  // { key: 'ITAT-STARTER-0001-ABCD', packageId: 'starter' },
  // 'ITAT-XXXX-YYYY-ZZZZ',
];
// ▲▲▲  CONFIGURE THESE  ▲▲▲

/*
──────────────────────────────────────────────────────────
CLOUDFLARE WORKER CODE  (copy-paste into your Worker)
──────────────────────────────────────────────────────────
const PRODUCT_ID = 'cusufrz'; // your Gumroad permalink

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response(JSON.stringify({ valid: false, error: 'Method not allowed' }), { headers: cors });

    let body;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ valid: false, error: 'Invalid request body' }), { headers: cors }); }

    const key = (body.license_key || '').trim();
    if (!key) return new Response(JSON.stringify({ valid: false, error: 'No license key provided' }), { headers: cors });

    const gumroadRes = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ product_id: PRODUCT_ID, license_key: key, increment_uses_count: 'false' }),
    });

    const gumroadData = await gumroadRes.json();

    if (gumroadData.success && gumroadData.purchase) {
      return new Response(JSON.stringify({
        valid: true,
        purchaser: gumroadData.purchase.email,
        uses: gumroadData.uses,
      }), { headers: cors });
    }

    return new Response(JSON.stringify({
      valid: false,
      error: gumroadData.message || 'License key not found or invalid.',
    }), { headers: cors });
  }
};
──────────────────────────────────────────────────────────
*/

function formatLicenseKey(input) {
  let val = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let fmt = "";
  for (let i = 0; i < val.length && i < 16; i++) {
    if (i === 4 || i === 8 || i === 12) fmt += "-";
    fmt += val[i];
  }
  input.value = fmt;
}
document
  .getElementById("license-key-input")
  .addEventListener("input", function () {
    formatLicenseKey(this);
  });

// Check offline fallback keys (case-insensitive, strips hyphens for comparison)
function checkOfflineKey(key) {
  const normalise = (k) => String(k || "").toUpperCase().replace(/-/g, "");
  const normKey = normalise(key);
  for (const item of OFFLINE_KEYS) {
    const rawKey = typeof item === "string" ? item : item && item.key;
    if (rawKey && normalise(rawKey) === normKey) {
      return typeof item === "string"
        ? { key: rawKey }
        : item;
    }
  }
  return null;
}

// Save a validated license to localStorage
function storeLicense(key, source, extra = {}) {
  const packageId = inferPackageId(extra);
  localStorage.setItem(
    LICENSE_KEY,
    JSON.stringify({
      key,
      source,
      activatedAt: new Date().toISOString(),
      type: "full",
      packageId,
      ...extra,
    }),
  );
}

async function activateLicense() {
  const key = document
    .getElementById("license-key-input")
    .value.trim()
    .toUpperCase();
  const selectedPackageId = getSelectedLicensePackageId();
  const errEl = document.getElementById("license-error");
  const okEl = document.getElementById("license-success");
  errEl.style.display = "none";
  okEl.style.display = "none";

  if (!key || key.replace(/-/g, "").length < 8) {
    errEl.textContent = "Please enter a valid license key.";
    errEl.style.display = "block";
    return;
  }

  okEl.textContent = "⏳ Verifying license…";
  okEl.style.display = "block";

  // ── Step 1: Offline fallback keys (instant, no network) ──
  const offlineMatch = checkOfflineKey(key);
  if (offlineMatch) {
    const packageId = inferPackageId({
      packageId: offlineMatch.packageId,
      key,
      fallbackPackageId: selectedPackageId,
    });
    storeLicense(key, "offline", { packageId });
    okEl.innerHTML = `✅ ${escHtml(getPackageDef(packageId).name)} activated! (offline mode)`;
    okEl.style.display = "block";
    setTimeout(() => showLoginFromLicense(), 1000);
    return;
  }

  // ── Step 2: Cloudflare Worker → Gumroad API ──
  if (WORKER_URL) {
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.valid) {
        const packageId = inferPackageId({
          packageId: data.packageId,
          productName: data.productName,
          key,
          fallbackPackageId: selectedPackageId,
        });
        storeLicense(key, "gumroad", {
          purchaser: data.purchaser || "",
          productName: data.productName || "",
          packageId,
        });
        okEl.innerHTML = `✅ ${escHtml(getPackageDef(packageId).name)} activated!${data.purchaser ? " Welcome, " + escHtml(data.purchaser.split("@")[0]) + "!" : ""}`;
        okEl.style.display = "block";
        setTimeout(() => showLoginFromLicense(), 1200);
        return;
      }
      // Gumroad said invalid
      errEl.innerHTML = `❌ ${escHtml(data.error || "Invalid license key.")} <br><span style="font-size:11px;opacity:.8;">Check your Gumroad purchase confirmation email.</span>`;
      errEl.style.display = "block";
      okEl.style.display = "none";
      return;
    } catch (networkErr) {
      // Network failed — fall through to offline-only message
    }
  }

  // ── Step 3: No Worker configured or network failed ──
  if (!WORKER_URL) {
    // Worker not yet configured — give a helpful setup message
    errEl.innerHTML = `❌ Online verification not configured yet.<br>
      <span style="font-size:11px;line-height:1.8;">
        To enable Gumroad verification, deploy the Cloudflare Worker<br>
        and set <code style="color:var(--accent)">WORKER_URL</code> in the app source.<br>
        Or add your key to <code style="color:var(--accent)">OFFLINE_KEYS</code> for offline use.
      </span>`;
    errEl.style.display = "block";
    okEl.style.display = "none";
  } else {
    // Worker configured but network failed
    errEl.innerHTML = `❌ Could not reach the license server — check your internet connection.<br>
      <span style="font-size:11px;opacity:.8;">Selected package: ${escHtml(getPackageDef(selectedPackageId).name)}. If you're offline, ask your admin to add your key to the offline list.</span>`;
    errEl.style.display = "block";
    okEl.style.display = "none";
  }
}

function startTrial() {
  const existing = localStorage.getItem(TRIAL_KEY);
  if (existing) {
    const left = getTrialDaysLeft();
    if (left <= 0) {
      document.getElementById("license-error").innerHTML =
        `⏰ Your ${TRIAL_DAYS}-day trial has expired. <a href="https://gumroad.com/l/${GUMROAD_PERMALINK}" target="_blank" style="color:var(--accent);">Purchase a license →</a>`;
      document.getElementById("license-error").style.display = "block";
      return;
    }
    document.getElementById("trial-note").textContent =
      `Trial active — ${left} day${left !== 1 ? "s" : ""} remaining.`;
  } else {
    localStorage.setItem(TRIAL_KEY, new Date().toISOString());
    document.getElementById("trial-note").textContent =
      `Trial started — ${TRIAL_DAYS} days remaining.`;
  }
  showLoginFromLicense();
}

function useDemoPackage(packageId) {
  const normalised = normalisePackageId(packageId);
  const key = DEMO_LICENSE_KEYS[normalised];
  if (!key) return;
  selectLicensePackage(normalised);
  const input = document.getElementById("license-key-input");
  if (input) input.value = key;
  activateLicense();
}

function fillDemoLogin() {
  const userEl = document.getElementById("signin-user");
  const passEl = document.getElementById("signin-pass");
  if (userEl) userEl.value = "admin";
  if (passEl) passEl.value = "admin123";
}

function checkLicense() {
  // Full license cached locally
  const lic = readStoredLicense();
  if (lic && lic.key) {
    return {
      valid: true,
      type: "full",
      source: lic.source || "unknown",
      packageId: inferPackageId(lic),
    };
  }
  // Active trial
  const daysLeft = getTrialDaysLeft();
  if (daysLeft > 0)
    return { valid: true, type: "trial", daysLeft, packageId: "trial" };
  return { valid: false };
}

function showLoginFromLicense() {
  document.getElementById("license-screen").classList.remove("visible");
  document.getElementById("login-screen").classList.add("visible");
  refreshAuthPackageUI();
}

function getLicenseBadgeText() {
  const lic = readStoredLicense();
  if (lic && lic.key) {
    const plan = getPackageDef(inferPackageId(lic));
    return `✦ ${plan.badge}`;
  }
  const daysLeft = getTrialDaysLeft();
  if (daysLeft > 0) return `⏳ Trial — ${daysLeft}d left`;
  return "v1.0";
}

// ── IMPORT ─────────────────────────────────────────────────
const APP_FIELDS = [
  {
    key: "tag",
    label: "Asset Tag",
    aliases: [
      "asset tag",
      "new tag",
      "tag",
      "asset_tag",
      "assetid",
      "id",
      "asset no",
      "asset number",
    ],
  },
  {
    key: "oldTag",
    label: "Old / Prev Tag",
    aliases: ["old tag", "previous tag", "old_tag", "prev tag", "former tag"],
  },
  {
    key: "name",
    label: "Device Name",
    aliases: ["device name", "device", "model", "name", "description", "item"],
  },
  { key: "brand", label: "Brand", aliases: ["brand", "make", "manufacturer"] },
  {
    key: "serial",
    label: "Serial Number",
    aliases: ["serial number", "serial", "sn", "serial no", "s/n", "serialno"],
  },
  {
    key: "category",
    label: "Category",
    aliases: ["category", "type", "device type", "asset type"],
  },
  {
    key: "condition",
    label: "Condition",
    aliases: ["condition", "state", "physical condition"],
  },
  {
    key: "os",
    label: "OS",
    aliases: ["os", "operating system", "o/s", "platform"],
  },
  {
    key: "processor",
    label: "Processor",
    aliases: ["processor", "cpu", "chip"],
  },
  {
    key: "generation",
    label: "Generation",
    aliases: ["generation", "gen", "processor gen"],
  },
  {
    key: "ram",
    label: "RAM (GB)",
    aliases: ["ram", "ram (gb)", "memory", "memory (gb)", "ram gb"],
  },
  {
    key: "rom",
    label: "ROM/SSD (GB)",
    aliases: [
      "rom",
      "ssd",
      "rom (gb)",
      "ssd (gb)",
      "internal storage",
      "storage (gb)",
    ],
  },
  {
    key: "disk",
    label: "Disk/HDD (GB)",
    aliases: [
      "disk",
      "hdd",
      "disk (gb)",
      "hdd (gb)",
      "hard disk",
      "hard drive",
    ],
  },
  {
    key: "display",
    label: "Display (inches)",
    aliases: ["display", "screen", "screen size", "display size"],
  },
  {
    key: "dept",
    label: "Department",
    aliases: ["department", "dept", "division", "unit", "section", "office"],
  },
  {
    key: "assignedUser",
    label: "Assigned User",
    aliases: [
      "assigned user",
      "user",
      "staff",
      "staff name",
      "employee",
      "assigned to",
      "issued to",
      "name of user",
    ],
  },
  {
    key: "status",
    label: "Status",
    aliases: ["status", "availability", "device status"],
  },
  {
    key: "purchase",
    label: "Date Purchased",
    aliases: [
      "date purchased",
      "purchase date",
      "bought",
      "date bought",
      "procurement date",
    ],
  },
  {
    key: "dateReceived",
    label: "Date Received",
    aliases: ["date received", "received", "received date", "receipt date"],
  },
  {
    key: "dateAssigned",
    label: "Date Assigned",
    aliases: ["date assigned", "assigned date", "issued date", "date issued"],
  },
  {
    key: "dateReturned",
    label: "Date Returned",
    aliases: ["date returned", "returned", "return date", "date of return"],
  },
  {
    key: "warrantyExpiry",
    label: "Warranty Expiry",
    aliases: [
      "warranty",
      "warranty expiry",
      "warranty expiration",
      "warranty date",
      "warranty end",
    ],
  },
  {
    key: "eolDate",
    label: "End-of-Life",
    aliases: ["eol", "end of life", "eol date", "retirement date"],
  },
  {
    key: "purchaseValue",
    label: "Purchase Value (₦)",
    aliases: [
      "purchase value",
      "value",
      "cost",
      "price",
      "purchase price",
      "amount",
    ],
  },
  {
    key: "currentValue",
    label: "Current Value (₦)",
    aliases: ["current value", "present value", "book value"],
  },
  {
    key: "supplier",
    label: "Supplier",
    aliases: ["supplier", "vendor", "seller", "purchased from", "source"],
  },
  {
    key: "invoiceNo",
    label: "Invoice No.",
    aliases: [
      "invoice",
      "invoice no",
      "po number",
      "purchase order",
      "invoice number",
      "lpo",
    ],
  },
  {
    key: "notes",
    label: "Notes",
    aliases: ["notes", "remarks", "comments", "note", "additional info"],
  },
];

function fieldSimilarity(colName, aliases) {
  const cn = colName
    .toLowerCase()
    .replace(/[_\-\.]/g, " ")
    .trim();
  if (aliases.includes(cn)) return 100;
  for (const a of aliases) {
    if (cn.startsWith(a) || a.startsWith(cn)) return 85;
  }
  for (const a of aliases) {
    if (cn.includes(a) || a.includes(cn)) return 70;
  }
  const cnWords = cn.split(" ");
  for (const a of aliases) {
    const aWords = a.split(" ");
    const overlap = cnWords.filter((w) => aWords.includes(w)).length;
    if (overlap > 0) return 40 + overlap * 10;
  }
  return 0;
}

function autoDetectMapping(headers) {
  const mapping = {};
  const usedHeaders = new Set();
  APP_FIELDS.forEach((field) => {
    let best = { score: 0, header: "" };
    headers.forEach((h) => {
      if (usedHeaders.has(h)) return;
      const score = fieldSimilarity(h, field.aliases);
      if (score > best.score) {
        best.score = score;
        best.header = h;
      }
    });
    if (best.score >= 40) {
      mapping[field.key] = best.header;
      usedHeaders.add(best.header);
    } else mapping[field.key] = "";
  });
  return mapping;
}

function openImportModal() {
  resetImport();
  document.getElementById("modal-import").classList.add("open");
}

document
  .getElementById("import-file-input")
  .addEventListener("change", function () {
    handleImportFile(this.files[0]);
  });
document
  .getElementById("import-drop-zone")
  .addEventListener("dragover", (e) => {
    e.preventDefault();
    e.currentTarget.classList.add("drag-over");
  });
document
  .getElementById("import-drop-zone")
  .addEventListener("dragleave", (e) => {
    e.currentTarget.classList.remove("drag-over");
  });
document.getElementById("import-drop-zone").addEventListener("drop", (e) => {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  handleImportFile(e.dataTransfer.files[0]);
});
document
  .getElementById("import-merge-toggle")
  .addEventListener("change", () => {
    if (importRawRows.length) renderColumnMapper();
  });
document.getElementById("col-map-body").addEventListener("change", (e) => {
  const sel = e.target.closest(".col-map-select");
  if (sel) onMappingChange(sel);
});
document
  .getElementById("inv-search")
  .addEventListener("input", renderInventory);
document
  .getElementById("inv-category-filter")
  .addEventListener("change", renderInventory);
document
  .getElementById("history-search")
  .addEventListener("input", renderHistory);
document
  .getElementById("history-filter")
  .addEventListener("change", renderHistory);
document.getElementById("global-search").addEventListener("input", function () {
  if (this.value.trim()) {
    navigate("inventory");
    document.getElementById("inv-search").value = this.value;
    renderInventory();
  }
});
document
  .getElementById("reassign-device-select")
  .addEventListener("change", function () {
    const d = devices.find((x) => x.id === this.value);
    const info = document.getElementById("reassign-current-info");
    if (d) {
      info.style.display = "block";
      document.getElementById("reassign-current-user").textContent =
        `${d.assignedUser} — ${d.assignedDept || d.dept || "—"}`;
    } else info.style.display = "none";
  });

function handleImportFile(file) {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    toast("Unsupported file type. Use .xlsx, .xls, or .csv", "error");
    return;
  }
  document.getElementById("dz-icon").textContent = "⏳";
  document.getElementById("dz-text").textContent = "Reading " + file.name + "…";
  document.getElementById("dz-sub").textContent = "Analysing columns…";
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      let rows = [];
      if (ext === "csv") {
        rows = parseCSVImport(e.target.result);
      } else {
        if (typeof XLSX === "undefined")
          throw new Error("XLSX library not loaded.");
        const wb = XLSX.read(e.target.result, {
          type: "array",
          cellDates: true,
        });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
      }
      if (!rows.length) {
        toast("No data rows found in file", "error");
        return;
      }
      rows = rows.filter((r) =>
        Object.values(r).some((v) => String(v).trim() !== ""),
      );
      if (!rows.length) {
        toast("No data rows found in file", "error");
        return;
      }
      importRawRows = rows;
      importColHeaders = Object.keys(rows[0]);
      importMapping = autoDetectMapping(importColHeaders);
      renderColumnMapper();
      goToImportStep(2);
    } catch (err) {
      toast("Failed to read file: " + err.message, "error");
      document.getElementById("dz-icon").textContent = "❌";
      document.getElementById("dz-text").textContent =
        "Error reading file. Try again.";
    }
  };
  if (ext === "csv") reader.readAsText(file);
  else reader.readAsArrayBuffer(file);
}

function getImportMergeMode() {
  const el = document.getElementById("import-merge-toggle");
  return !!(el && el.checked);
}

function countDuplicateStats() {
  const existingTags = new Set(devices.map((d) => d.tag.toLowerCase()));
  const existingSerials = new Set(devices.map((d) => d.serial.toLowerCase()));
  const mergeMode = getImportMergeMode();
  let updates = 0,
    skips = 0;
  importRawRows.forEach((row) => {
    const tagCol = importMapping["tag"]
      ? String(row[importMapping["tag"]] || "").trim()
      : "";
    const snCol = importMapping["serial"]
      ? String(row[importMapping["serial"]] || "").trim()
      : "";
    const hasDup =
      (tagCol && existingTags.has(tagCol.toLowerCase())) ||
      (snCol && existingSerials.has(snCol.toLowerCase()));
    if (hasDup) {
      if (mergeMode) updates++;
      else skips++;
    }
  });
  return { updates, skips };
}

function renderColumnMapper() {
  const tbody = document.getElementById("col-map-body");
  const fieldOptions =
    '<option value="">— Skip —</option>' +
    APP_FIELDS.map((f) => `<option value="${f.key}">${f.label}</option>`).join(
      "",
    );
  let rows = "";
  importColHeaders.forEach((col) => {
    let mappedTo = "";
    Object.entries(importMapping).forEach(([k, v]) => {
      if (v === col) mappedTo = k;
    });
    let sample = "";
    for (let i = 0; i < Math.min(3, importRawRows.length); i++) {
      const v = String(importRawRows[i][col] || "").trim();
      if (v) {
        sample = v;
        break;
      }
    }
    const opts =
      '<option value="">— Skip —</option>' +
      APP_FIELDS.map(
        (f) =>
          `<option value="${f.key}"${f.key === mappedTo ? " selected" : ""}>${f.label}</option>`,
      ).join("");
    rows += `<tr class="col-map-row"><td><span style="font-family:var(--mono);font-size:11px;">${escHtml(col)}</span></td><td style="color:var(--text3);">${mappedTo ? '<span style="color:var(--green);">✓</span>' : "→"}</td><td><select class="col-map-select ${mappedTo ? "matched" : "unmatched"}" data-col="${escAttr(col)}">${opts}</select></td><td><span class="sample-val" title="${escAttr(sample)}">${escHtml(sample)}</span></td></tr>`;
  });
  tbody.innerHTML = rows;
  const stats = countDuplicateStats();
  document.getElementById("imp-total").textContent = importRawRows.length;
  document.getElementById("imp-new").textContent =
    importRawRows.length - stats.skips - stats.updates;
  document.getElementById("imp-update").textContent = stats.updates;
  document.getElementById("imp-skip").textContent = stats.skips;
  renderImportMappingSummary();
  renderImportWarnings();
}

function renderImportMappingSummary() {
  const summaryEl = document.getElementById("import-map-summary");
  const countEl = document.getElementById("import-map-count");
  const mapped = Object.entries(importMapping).filter(([, v]) => !!v);
  if (countEl) countEl.textContent = String(mapped.length);
  if (!summaryEl) return;
  if (!mapped.length) {
    summaryEl.innerHTML =
      '<span class="chip" style="color:var(--text3);">No columns mapped yet</span>';
    return;
  }
  summaryEl.innerHTML = mapped
    .map(([key, col]) => {
      const field = APP_FIELDS.find((f) => f.key === key);
      return `<span class="chip" style="color:var(--accent);">${escHtml(field ? field.label : key)} ← ${escHtml(col)}</span>`;
    })
    .join("");
}

function renderImportWarnings() {
  const warnings = [];
  if (!importMapping.tag)
    warnings.push("Missing Asset Tag column — tags will be auto-generated.");
  if (!importMapping.serial)
    warnings.push("Missing Serial Number column — serials will be set to N/A.");
  if (!importMapping.name)
    warnings.push(
      "Missing Device Name column — names will be generated from Brand/Type.",
    );
  const wEl = document.getElementById("import-warnings");
  if (!wEl) return;
  if (warnings.length) {
    wEl.style.display = "block";
    wEl.innerHTML = "⚠️ " + warnings.join("<br>");
  } else wEl.style.display = "none";
}

function onMappingChange(select) {
  const col = select.getAttribute("data-col");
  const newField = select.value;
  Object.keys(importMapping).forEach((k) => {
    if (importMapping[k] === col) importMapping[k] = "";
  });
  if (newField) {
    Object.keys(importMapping).forEach((k) => {
      if (k !== newField && importMapping[k] === col) importMapping[k] = "";
    });
    importMapping[newField] = col;
  }
  select.className = "col-map-select " + (newField ? "matched" : "unmatched");
  renderImportMappingSummary();
  renderImportWarnings();
}

function applyMappingAndPreview() {
  importParsedRows = [];
  importSkipped = [];
  importUpdates = [];
  importUsedCounterMax = null;
  const existingTags = new Map(devices.map((d) => [d.tag.toLowerCase(), d]));
  const existingSerials = new Map(
    devices.map((d) => [d.serial.toLowerCase(), d]),
  );
  const seenTags = new Set();
  const seenSerials = new Set();
  const mergeMode = getImportMergeMode();
  let tempCounter = settings.counter;

  function nextImportTag() {
    let candidate = "";
    while (true) {
      candidate = genTag(tempCounter);
      tempCounter++;
      const low = candidate.toLowerCase();
      if (!existingTags.has(low) && !seenTags.has(low)) break;
    }
    const num = parseInt(candidate.split("-").pop());
    if (!isNaN(num))
      importUsedCounterMax =
        importUsedCounterMax === null
          ? num
          : Math.max(importUsedCounterMax, num);
    return candidate;
  }
  function getField(row, fieldKey, fallback = "") {
    const col = importMapping[fieldKey];
    if (!col) return fallback;
    const raw = row[col];
    if (raw === undefined || raw === null) return fallback;
    return String(raw).trim();
  }
  function getNum(row, k) {
    const v = getField(row, k, "").replace(/[^0-9.]/g, "");
    return v ? parseFloat(v) : "";
  }
  function getDate(row, k) {
    const v = getField(row, k, "");
    if (!v) return "";
    if (/\d{4}-\d{2}-\d{2}/.test(v)) return v.match(/\d{4}-\d{2}-\d{2}/)[0];
    try {
      const d = new Date(v);
      if (!isNaN(d)) return d.toISOString().split("T")[0];
    } catch (e) {}
    return v;
  }
  function normCondition(val) {
    const c = String(val || "")
      .trim()
      .toLowerCase();
    return ["excellent", "good", "fair", "poor"].includes(c) ? c : "good";
  }

  importRawRows.forEach((row) => {
    let tag = getField(row, "tag");
    const serial = getField(row, "serial") || "N/A";
    let name = getField(row, "name");
    const brand = getField(row, "brand");
    if (!name && brand) name = brand + " Device";
    if (!name) name = "Unknown Device";
    if (!name.trim() && !serial.trim() && !tag.trim()) return;
    const tagLower = tag ? tag.toLowerCase() : "";
    const serialLower = serial !== "N/A" ? serial.toLowerCase() : "";
    const tagMatch = tagLower ? existingTags.get(tagLower) : null;
    const serialMatch = serialLower ? existingSerials.get(serialLower) : null;
    if (tagMatch || serialMatch) {
      if (mergeMode) {
        if (tagMatch && serialMatch && tagMatch.id !== serialMatch.id) {
          importSkipped.push({
            tag,
            name,
            serial,
            reason: "Conflicting tag/serial",
          });
          return;
        }
        const target = tagMatch || serialMatch;
        const patch = {};
        const fields = [
          "tag",
          "name",
          "brand",
          "serial",
          "oldTag",
          "category",
          "condition",
          "os",
          "processor",
          "generation",
          "ram",
          "rom",
          "disk",
          "display",
          "dept",
          "assignedUser",
          "status",
          "purchase",
          "dateReceived",
          "dateAssigned",
          "dateReturned",
          "warrantyExpiry",
          "eolDate",
          "purchaseValue",
          "currentValue",
          "supplier",
          "invoiceNo",
          "notes",
        ];
        fields.forEach((k) => {});
        const inc = {
          name,
          brand,
          serial,
          oldTag: getField(row, "oldTag"),
          category: getField(row, "category"),
          condition: normCondition(getField(row, "condition")),
          os: getField(row, "os"),
          processor: getField(row, "processor"),
          generation: getField(row, "generation"),
          ram: getNum(row, "ram"),
          rom: getNum(row, "rom"),
          disk: getNum(row, "disk"),
          display: getField(row, "display"),
          dept: getField(row, "dept"),
          assignedUser: getField(row, "assignedUser"),
          purchase: getDate(row, "purchase"),
          dateReceived: getDate(row, "dateReceived"),
          dateAssigned: getDate(row, "dateAssigned"),
          dateReturned: getDate(row, "dateReturned"),
          warrantyExpiry: getDate(row, "warrantyExpiry"),
          eolDate: getDate(row, "eolDate"),
          purchaseValue: getNum(row, "purchaseValue"),
          currentValue: getNum(row, "currentValue"),
          supplier: getField(row, "supplier"),
          invoiceNo: getField(row, "invoiceNo"),
          notes: getField(row, "notes"),
        };
        Object.keys(inc).forEach((k) => {
          const v = inc[k];
          if (v === undefined || v === null) return;
          if (typeof v === "string" && v.trim() === "") return;
          if (String(target[k] || "").trim() !== String(v).trim()) patch[k] = v;
        });
        if (!Object.keys(patch).length) {
          importSkipped.push({
            tag,
            name,
            serial,
            reason: "No new data to merge",
          });
          return;
        }
        importUpdates.push({
          id: target.id,
          patch,
          tag: target.tag,
          name: target.name,
        });
        return;
      }
      if (tagMatch) {
        importSkipped.push({ tag, name, serial, reason: "Duplicate tag" });
        return;
      }
      if (serialMatch) {
        importSkipped.push({ tag, name, serial, reason: "Duplicate serial" });
        return;
      }
    }
    if (!tag) {
      tag = nextImportTag();
    }
    seenTags.add(tag.toLowerCase());
    if (serial !== "N/A") seenSerials.add(serial.toLowerCase());
    let status = getField(row, "status");
    const sn = String(status || "")
      .trim()
      .toLowerCase();
    if (["assigned", "in use", "issued"].includes(sn)) status = "Assigned";
    else if (["available", "in stock", "spare"].includes(sn))
      status = "Available";
    else if (["faulty", "damaged", "repair"].includes(sn)) status = "Faulty";
    else status = getField(row, "assignedUser") ? "Assigned" : "Available";
    const user = getField(row, "assignedUser");
    const dept = getField(row, "dept");
    importParsedRows.push({
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      tag,
      name,
      brand,
      serial,
      oldTag: getField(row, "oldTag"),
      category:
        getField(row, "category") ||
        guessCategory(brand, getField(row, "name"), ""),
      condition: normCondition(getField(row, "condition")),
      os: getField(row, "os"),
      processor: getField(row, "processor"),
      generation: getField(row, "generation"),
      ram: getNum(row, "ram"),
      rom: getNum(row, "rom"),
      disk: getNum(row, "disk"),
      display: getField(row, "display"),
      dept,
      assignedUser: user,
      assignedDept: dept,
      status,
      purchase: getDate(row, "purchase"),
      dateReceived: getDate(row, "dateReceived"),
      dateAssigned: getDate(row, "dateAssigned"),
      dateReturned: getDate(row, "dateReturned"),
      warrantyExpiry: getDate(row, "warrantyExpiry"),
      eolDate: getDate(row, "eolDate"),
      purchaseValue: getNum(row, "purchaseValue"),
      currentValue: getNum(row, "currentValue"),
      supplier: getField(row, "supplier"),
      invoiceNo: getField(row, "invoiceNo"),
      notes: getField(row, "notes"),
      addedDate: new Date().toISOString(),
      tickets: [],
    });
  });
  document.getElementById("imp-total-3").textContent = importRawRows.length;
  document.getElementById("imp-new-3").textContent = importParsedRows.length;
  document.getElementById("imp-update-3").textContent = importUpdates.length;
  document.getElementById("imp-skip-3").textContent = importSkipped.length;
  document.getElementById("import-confirm-count").textContent =
    importParsedRows.length + importUpdates.length;
  const cols = [
    "tag",
    "name",
    "serial",
    "category",
    "ram",
    "disk",
    "status",
    "assignedUser",
    "dept",
    "purchase",
  ];
  const colLabels = [
    "Tag",
    "Device",
    "Serial",
    "Category",
    "RAM",
    "Disk",
    "Status",
    "User",
    "Dept",
    "Purchased",
  ];
  document.getElementById("import-preview-head").innerHTML = colLabels
    .map(
      (h) =>
        `<th style="background:var(--surface2);color:var(--text3);font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:7px 11px;border-bottom:1px solid var(--border);font-family:var(--mono);white-space:nowrap;">${h}</th>`,
    )
    .join("");
  const previewRows = importParsedRows.slice(0, 8);
  document.getElementById("import-preview-body").innerHTML = previewRows.length
    ? previewRows
        .map(
          (d, i) =>
            `<tr style="background:${i % 2 ? "var(--surface2)" : "var(--surface)"};border-bottom:1px solid var(--border);"><td style="padding:6px 11px;font-family:var(--mono);font-size:11px;color:var(--accent);">${escHtml(d.tag)}</td><td style="padding:6px 11px;font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(d.name)}</td><td style="padding:6px 11px;font-family:var(--mono);font-size:10px;color:var(--text3);">${escHtml(d.serial)}</td><td style="padding:6px 11px;font-size:11px;">${escHtml(d.category)}</td><td style="padding:6px 11px;font-family:var(--mono);font-size:11px;">${d.ram ? d.ram + "GB" : "—"}</td><td style="padding:6px 11px;font-family:var(--mono);font-size:11px;">${d.disk ? d.disk + "GB" : "—"}</td><td style="padding:6px 11px;">${statusBadge(d.status)}</td><td style="padding:6px 11px;font-size:11px;">${escHtml(d.assignedUser || "—")}</td><td style="padding:6px 11px;font-size:11px;">${escHtml(d.dept || "—")}</td><td style="padding:6px 11px;font-size:11px;font-family:var(--mono);">${escHtml(d.purchase || "—")}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text3);">${importUpdates.length ? importUpdates.length + " update(s) will be applied." : "No importable rows found. Check column mapping."}</td></tr>`;
  if (importSkipped.length) {
    document.getElementById("skipped-wrap").style.display = "block";
    document.getElementById("skipped-list").innerHTML = importSkipped
      .map(
        (s) =>
          `<div style="padding:2px 0;">${escHtml(s.tag)} · ${escHtml(s.name)} — <span style="color:var(--orange);">${escHtml(s.reason)}</span></div>`,
      )
      .join("");
  }
  document.getElementById("import-confirm-btn").style.display =
    importParsedRows.length || importUpdates.length ? "inline-flex" : "none";
  goToImportStep(3);
}

function goToImportStep(step) {
  importCurrentStep = step;
  [1, 2, 3].forEach((s) => {
    document.getElementById("import-step-" + s).style.display =
      s === step ? "block" : "none";
    const dot = document.getElementById("sdot-" + s);
    dot.className =
      "import-step-dot" + (s < step ? " done" : s === step ? " active" : "");
    dot.textContent = s < step ? "✓" : String(s);
  });
  const labels = {
    1: "Upload any Excel or CSV — the app will auto-detect your columns",
    2: "Review & adjust column mapping, then click Apply",
    3: "Preview imported data and confirm",
  };
  document.getElementById("import-step-label").textContent = labels[step];
  document.getElementById("import-back-btn").style.display =
    step > 1 ? "inline-flex" : "none";
}
function importGoBack() {
  if (importCurrentStep > 1) goToImportStep(importCurrentStep - 1);
}

function resetImport() {
  importRawRows = [];
  importColHeaders = [];
  importMapping = {};
  importParsedRows = [];
  importSkipped = [];
  importUpdates = [];
  importUsedCounterMax = null;
  document.getElementById("import-file-input").value = "";
  document.getElementById("dz-icon").textContent = "📊";
  document.getElementById("dz-text").textContent =
    "Click to browse or drag & drop your file here";
  document.getElementById("dz-sub").textContent =
    "Accepts .xlsx, .xls or .csv — any column names, any format";
  document.getElementById("import-confirm-btn").style.display = "none";
  document.getElementById("import-warnings").style.display = "none";
  const mergeEl = document.getElementById("import-merge-toggle");
  if (mergeEl) mergeEl.checked = false;
  try {
    document.getElementById("skipped-wrap").style.display = "none";
  } catch (e) {}
  goToImportStep(1);
}

function downloadImportTemplate() {
  const headers = APP_FIELDS.map((f) => f.label);
  const example = [
    "MSC-0001",
    "",
    "HP EliteBook 840 G9",
    "HP",
    "5CG2040KLM",
    "Laptop",
    "Good",
    "Windows 11 Pro",
    "Intel Core i7-1265U",
    "12th Gen",
    "16",
    "256",
    "1000",
    "15.6",
    "Finance",
    "John Doe",
    "Assigned",
    "2023-01-15",
    "2023-01-20",
    "2023-01-22",
    "",
    "2026-01-15",
    "2027-01-15",
    "450000",
    "380000",
    "TechMart Ltd",
    "INV-2023-0042",
    "Good condition",
  ];
  if (typeof XLSX === "undefined") {
    toast("XLSX library not available", "error");
    return;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws, "Devices");
  XLSX.writeFile(wb, "ITAssetTrack_Import_Template.xlsx");
  toast("✅ Template downloaded", "success");
}

function guessCategory(brand, device, model) {
  const all = [brand, device, model]
    .map((s) => String(s || "").toLowerCase())
    .join(" ");
  if (all.includes("biometric") || all.includes("fingerprint"))
    return "Biometric";
  if (
    all.includes("external hd") ||
    all.includes("seagate") ||
    all.includes("hdd")
  )
    return "External Storage";
  if (all.includes("all-in-one") || all.includes("desktop")) return "Desktop";
  if (all.includes("monitor") || all.includes("display")) return "Monitor";
  if (all.includes("printer")) return "Printer";
  if (all.includes("phone") || all.includes("mobile")) return "Phone";
  if (all.includes("tablet") || all.includes("ipad")) return "Tablet";
  if (
    all.includes("laptop") ||
    all.includes("elitebook") ||
    all.includes("thinkpad") ||
    all.includes("macbook") ||
    all.includes("latitude") ||
    all.includes("xps")
  )
    return "Laptop";
  return "Other";
}

function confirmImport() {
  if (!importParsedRows.length && !importUpdates.length) {
    toast("Nothing to import", "error");
    return;
  }
  if (importParsedRows.length && !ensureAssetCapacity(importParsedRows.length)) {
    return;
  }
  const importedCount = importParsedRows.length;
  const updatedCount = importUpdates.length;
  const skippedCount = importSkipped.length;
  devices.push(...importParsedRows);
  importParsedRows.forEach((d) => {
    addHistory(
      d,
      "Added",
      d.assignedUser || "",
      `Imported · ${d.processor ? d.processor + " · " : ""}${d.ram ? d.ram + "GB RAM" : ""}`,
    );
    if (d.status === "Assigned" && d.assignedUser)
      addHistory(d, "Assigned", d.assignedUser, `Dept: ${d.dept}`);
  });
  importUpdates.forEach((u) => {
    const d = devices.find((x) => x.id === u.id);
    if (!d) return;
    const changedKeys = Object.keys(u.patch || {});
    changedKeys.forEach((k) => {
      d[k] = u.patch[k];
    });
    if (changedKeys.length)
      addHistory(d, "Updated", "", `Import merge · ${changedKeys.join(", ")}`);
  });
  importParsedRows.forEach((d) => {
    if (d.tag && d.tag.startsWith(settings.prefix + "-")) {
      const num = parseInt(d.tag.split("-").pop());
      if (!isNaN(num) && num >= settings.counter) settings.counter = num + 1;
    }
  });
  if (importUsedCounterMax !== null)
    settings.counter = Math.max(settings.counter, importUsedCounterMax + 1);
  importParsedRows = [];
  importUpdates = [];
  importSkipped = [];
  importUsedCounterMax = null;
  saveData();
  closeModal("modal-import");
  let msg = `✅ Imported ${importedCount} device${importedCount !== 1 ? "s" : ""}`;
  if (updatedCount) msg += ` · ${updatedCount} updated`;
  if (skippedCount) msg += ` · ${skippedCount} skipped`;
  toast(msg, "success");
  renderInventory();
  updateDashboard();
  renderHistory();
  renderFaulty();
  refreshAssignSelects();
  refreshFaultySelect();
  updateFaultyBadge();
  renderReportSummary();
}

function parseCSVImport(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    field = "",
    inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = String(cols[i] || "").trim();
    });
    return obj;
  });
}

// ── INIT ─────────────────────────────────────────────────
function initApp() {
  migrateLegacyUsersIfNeeded();
  loadData();
  loadSheetsConfig();
  loadSettingsForm();
  renderPlanSettings();
  refreshAuthPackageUI();
  updateDashboard();
  renderInventory();
  renderTaskLogPage();
  renderHistory();
  renderFaulty();
  refreshAssignSelects();
  refreshFaultySelect();
  renderReportSummary();
  updateFaultyBadge();
  renderBackendSettings();
  renderSheetsSettings();
  applyRoleUI();
  renderTeamUserList();
  startConnectivityMonitor();
  if (getSheetsUrl()) {
    pullFromSheets().then((ok) => {
      if (ok) {
        renderInventory();
        updateDashboard();
        renderTaskLogPage();
        renderReportSummary();
      }
    });
    startAutoSync();
  }
}

// ── BOOT ─────────────────────────────────────────────────
(function boot() {
  registerServiceWorker();
  initLicensePackagePicker();
  const licStatus = checkLicense();
  if (!licStatus.valid) {
    document.getElementById("license-screen").classList.add("visible");
    document.getElementById("login-screen").classList.remove("visible");
    const ts = localStorage.getItem(TRIAL_KEY);
    if (ts) {
      const du = Math.floor(
        (new Date() - new Date(ts)) / (1000 * 60 * 60 * 24),
      );
      if (du >= TRIAL_DAYS)
        document.getElementById("trial-note").innerHTML =
          '<span style="color:var(--red)">Trial expired. Please purchase a license.</span>';
    }
    return;
  }
  document.getElementById("license-screen").classList.remove("visible");
  const session = getCurrentUser();
  if (session) {
    showApp(session);
  } else {
    document.getElementById("login-screen").classList.add("visible");
    refreshAuthPackageUI();
  }
})();
