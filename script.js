/* =========================================================================
   script.js — Expense Manager
   -------------------------------------------------------------------------
   Single shared module for every page. Loaded as:
     <script type="module" src="script.js"></script>
   Each HTML page sets <body data-page="dashboard"> (etc.) and the router
   at the bottom of this file calls the matching init function.
   ========================================================================= */

import {
  auth, db, storage,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
  query, where, orderBy, serverTimestamp, getDocs,
  ref, uploadBytes, getDownloadURL, deleteObject,
} from "./firebase.js";

/* -------------------------------------------------------------------------
   0. Constants
   ------------------------------------------------------------------------- */
const EXPENSE_CATEGORIES = ["Transport", "Printing", "Office", "Internet", "Others"];
const PAYMENT_METHODS = ["Cash", "Bank Transfer", "bKash", "Nagad", "Reimbursement", "Other"];
const VOUCHER_STATUSES = ["Pending", "Submitted", "Approved", "Rejected"];
const CURRENCY_SYMBOL = "৳";

const CATEGORY_COLORS = {
  Transport: "#D97706",
  Printing: "#DB2777", Office: "#0EA5E9", Internet: "#65A30D", Others: "#64748B",
};

const STATUS_TONE = { Pending: "warning", Submitted: "info", Approved: "success", Rejected: "danger" };

let CURRENT_USER = null;

/* -------------------------------------------------------------------------
   1. Small DOM / format utilities
   ------------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function money(amount) {
  const n = Number(amount) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}${CURRENCY_SYMBOL}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function toDateInputValue(d = new Date()) {
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function uid() { return Math.random().toString(36).slice(2, 10); }

/* -------------------------------------------------------------------------
   2. Toasts
   ------------------------------------------------------------------------- */
function ensureToastStack() {
  let stack = $(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

function toast(message, type = "info") {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms ease, transform 200ms ease";
    el.style.opacity = "0";
    el.style.transform = "translateX(30px)";
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* -------------------------------------------------------------------------
   3. Theme (light / dark)
   ------------------------------------------------------------------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("em-theme", theme);
  $$(".theme-toggle").forEach((btn) => btn.setAttribute("aria-checked", theme === "dark"));
}

function initTheme() {
  const saved = localStorage.getItem("em-theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  $$(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  });
}

/* -------------------------------------------------------------------------
   4. Sidebar (mobile drawer) + active nav link
   ------------------------------------------------------------------------- */
function initSidebar() {
  const sidebar = $(".sidebar");
  const menuBtn = $(".menu-btn");
  let scrim = $(".sidebar-scrim");
  if (!scrim && sidebar) {
    scrim = document.createElement("div");
    scrim.className = "sidebar-scrim";
    document.body.appendChild(scrim);
  }
  function close() { sidebar?.classList.remove("open"); scrim?.classList.remove("show"); }
  function open() { sidebar?.classList.add("open"); scrim?.classList.add("show"); }
  menuBtn?.addEventListener("click", open);
  scrim?.addEventListener("click", close);
  $$(".nav-link").forEach((l) => l.addEventListener("click", close));

  const page = document.body.dataset.page;
  $$(".nav-link").forEach((link) => {
    if (link.dataset.nav === page) link.classList.add("active");
  });
}

/* -------------------------------------------------------------------------
   5. Auth guard + logout + user chip
   ------------------------------------------------------------------------- */
function initials(email) {
  if (!email) return "U";
  return email.slice(0, 2).toUpperCase();
}

function guardAuth(onReady) {
  onAuthStateChanged(auth, (user) => {
    const page = document.body.dataset.page;
    if (!user && page !== "login") {
      window.location.href = "login.html";
      return;
    }
    if (user && page === "login") {
      window.location.href = "dashboard.html";
      return;
    }
    CURRENT_USER = user;
    if (user) {
      $$(".user-chip-name").forEach((el) => (el.textContent = user.email.split("@")[0]));
      $$(".user-chip-email").forEach((el) => (el.textContent = user.email));
      $$(".avatar").forEach((el) => (el.textContent = initials(user.email)));
    }
    onReady && onReady(user);
  });
}

function initLogoutButtons() {
  $$(".logout-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "login.html";
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

/* -------------------------------------------------------------------------
   6. Firestore collection helpers
   ------------------------------------------------------------------------- */
const paymentsCol = () => collection(db, "payments");
const expensesCol = () => collection(db, "expenses");
const vouchersCol = () => collection(db, "vouchers");

function listenCollection(colRef, onData) {
  return onSnapshot(
    query(colRef, orderBy("date", "desc")),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => toast(err.message, "error")
  );
}

/* -------------------------------------------------------------------------
   7. PAGE: login.html
   ------------------------------------------------------------------------- */
function initLogin() {
  guardAuth(); // will redirect to dashboard if already logged in
  const form = $("#login-form");
  const errorEl = $("#login-error");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const btn = $("#login-submit");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in…';
    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = "dashboard.html";
    } catch (err) {
      errorEl.textContent = mapAuthError(err.code);
      btn.disabled = false;
      btn.textContent = "Sign In";
    }
  });
}

function mapAuthError(code) {
  const map = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Try again.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
  };
  return map[code] || "Couldn't sign in. Please check your details.";
}

/* -------------------------------------------------------------------------
   8. PAGE: dashboard.html
   ------------------------------------------------------------------------- */
let dashboardData = { payments: [], expenses: [], vouchers: [] };
let pieChartInstance = null;
let barChartInstance = null;

function initDashboard() {
  guardAuth(() => {
    listenCollection(paymentsCol(), (rows) => { dashboardData.payments = rows; renderDashboard(); });
    listenCollection(expensesCol(), (rows) => { dashboardData.expenses = rows; renderDashboard(); });
    listenCollection(vouchersCol(), (rows) => { dashboardData.vouchers = rows; renderDashboard(); });
  });
}

function sum(rows, pred = () => true) {
  return rows.filter(pred).reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
}

function renderDashboard() {
  const { payments, expenses, vouchers } = dashboardData;

  const totalReceived = sum(payments);
  const totalExpenses = sum(expenses);
  const currentBalance = totalReceived - totalExpenses;
  const voucherPending = sum(vouchers, (v) => v.status === "Pending");
  const voucherSubmitted = sum(vouchers, (v) => v.status === "Submitted");
  const companyReimbursed = sum(payments, (p) => p.method === "Reimbursement");
  const companyDue = voucherSubmitted - companyReimbursed;

  setText("#stat-received", money(totalReceived));
  setText("#stat-expenses", money(totalExpenses));
  setText("#stat-pending", money(voucherPending));
  setText("#stat-submitted", money(voucherSubmitted));
  setText("#stat-balance", money(currentBalance));
  setText("#stat-due", money(companyDue));

  const balEl = $("#stat-balance");
  if (balEl) balEl.classList.toggle("text-danger", currentBalance < 0);

  renderPieChart(expenses);
  renderBarChart(expenses);
  renderRecentTransactions(payments, expenses, vouchers);
}

function setText(sel, val) { const el = $(sel); if (el) el.textContent = val; }

function renderPieChart(expenses) {
  const canvas = $("#pieChart");
  if (!canvas || typeof Chart === "undefined") return;
  const totals = {};
  EXPENSE_CATEGORIES.forEach((c) => (totals[c] = 0));
  expenses.forEach((e) => { totals[e.category] = (totals[e.category] || 0) + (Number(e.amount) || 0); });
  const labels = Object.keys(totals).filter((k) => totals[k] > 0);
  const data = labels.map((l) => totals[l]);
  const colors = labels.map((l) => CATEGORY_COLORS[l] || "#94A3B8");

  if (pieChartInstance) pieChartInstance.destroy();

  if (!labels.length) {
    $("#pieChartEmpty")?.classList.remove("hidden");
    return;
  }
  $("#pieChartEmpty")?.classList.add("hidden");

  pieChartInstance = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle", font: { family: "Inter", size: 11.5, weight: "600" }, color: getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted") } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.raw)}` } },
      },
      maintainAspectRatio: false,
    },
  });
}

function renderBarChart(expenses) {
  const canvas = $("#barChart");
  if (!canvas || typeof Chart === "undefined") return;

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-US", { month: "short" }) });
  }
  const totals = months.map((m) => sum(expenses, (e) => (e.date || "").startsWith(m.key)));

  if (barChartInstance) barChartInstance.destroy();
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim();
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue("--color-border").trim();
  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted").trim();

  barChartInstance = new Chart(canvas, {
    type: "bar",
    data: { labels: months.map((m) => m.label), datasets: [{ data: totals, backgroundColor: primary, borderRadius: 8, maxBarThickness: 34 }] },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${money(ctx.raw)}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { family: "Inter", size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: "Inter", size: 11 }, callback: (v) => CURRENCY_SYMBOL + v } },
      },
    },
  });
}

function renderRecentTransactions(payments, expenses, vouchers) {
  const box = $("#recent-transactions");
  if (!box) return;
  const merged = [
    ...payments.map((p) => ({ ...p, _type: "Payment" })),
    ...expenses.map((e) => ({ ...e, _type: "Expense" })),
    ...vouchers.map((v) => ({ ...v, _type: "Voucher" })),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);

  if (!merged.length) {
    box.innerHTML = emptyStateHtml("No transactions yet", "Add a payment, expense, or voucher to see it here.");
    return;
  }

  box.innerHTML = merged.map((t) => {
    const isIncome = t._type === "Payment";
    const label = t._type === "Payment" ? (t.note || "Company payment") : t._type === "Expense" ? (t.category || "Expense") : `Voucher · ${t.category || ""}`;
    const tone = isIncome ? "success" : t._type === "Voucher" ? (STATUS_TONE[t.status] || "info") : "danger";
    return `
      <div class="flex items-center justify-between" style="padding:12px 0;border-bottom:1px solid var(--color-border);">
        <div class="flex items-center gap-12">
          <div class="stat-icon tone-${tone}" style="width:34px;height:34px;">${transactionIcon(t._type)}</div>
          <div>
            <div style="font-weight:600;font-size:13.5px;">${escapeHtml(label)}</div>
            <div style="font-size:11.5px;color:var(--color-text-faint);">${formatDateLabel(t.date)} · ${t._type}</div>
          </div>
        </div>
        <div class="amount ${isIncome ? "text-success" : "text-danger"}" style="font-weight:700;font-size:13.75px;">
          ${isIncome ? "+" : "−"}${money(t.amount)}
        </div>
      </div>`;
  }).join("");
}

function transactionIcon(type) {
  if (type === "Payment") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  if (type === "Expense") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';
}

function emptyStateHtml(title, sub) {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
    <h4>${escapeHtml(title)}</h4><p>${escapeHtml(sub)}</p>
  </div>`;
}

/* -------------------------------------------------------------------------
   9. PAGE: payments.html
   ------------------------------------------------------------------------- */
function initPayments() {
  guardAuth(() => {
    const form = $("#payment-form");
    $("#payment-date") && ($("#payment-date").value = toDateInputValue());

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#payment-submit");
      const editId = form.dataset.editId;
      const payload = {
        amount: parseFloat($("#payment-amount").value),
        date: $("#payment-date").value,
        method: $("#payment-method").value,
        note: $("#payment-note").value.trim(),
        uid: CURRENT_USER.uid,
      };
      if (!payload.amount || payload.amount <= 0) return toast("Enter a valid amount", "error");
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
      try {
        if (editId) {
          await updateDoc(doc(db, "payments", editId), payload);
          toast("Payment updated", "success");
        } else {
          payload.createdAt = serverTimestamp();
          await addDoc(paymentsCol(), payload);
          toast("Payment recorded", "success");
        }
        resetPaymentForm();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false; btn.innerHTML = "Save Payment";
      }
    });

    $("#payment-cancel-edit")?.addEventListener("click", resetPaymentForm);

    listenCollection(paymentsCol(), renderPaymentsList);
  });
}

function resetPaymentForm() {
  const form = $("#payment-form");
  if (!form) return;
  form.reset();
  delete form.dataset.editId;
  $("#payment-date").value = toDateInputValue();
  $("#payment-submit").textContent = "Save Payment";
  $("#payment-cancel-edit")?.classList.add("hidden");
}

function renderPaymentsList(rows) {
  const box = $("#payments-list");
  if (!box) return;
  if (!rows.length) { box.innerHTML = emptyStateHtml("No payments yet", "Payments received from the company will show up here."); return; }
  box.innerHTML = rows.map((p) => `
    <div class="flex items-center justify-between" style="padding:14px 0;border-bottom:1px solid var(--color-border);">
      <div class="flex items-center gap-12">
        <div class="stat-icon tone-success" style="width:38px;height:38px;">${transactionIcon("Payment")}</div>
        <div>
          <div style="font-weight:700;font-size:14px;">${money(p.amount)}</div>
          <div style="font-size:12px;color:var(--color-text-faint);">${formatDateLabel(p.date)} · ${escapeHtml(p.method || "—")}${p.note ? " · " + escapeHtml(p.note) : ""}</div>
        </div>
      </div>
      <div class="row-actions">
        <button data-edit="${p.id}" title="Edit">${iconEdit()}</button>
        <button data-delete="${p.id}" title="Delete">${iconTrash()}</button>
      </div>
    </div>`).join("");

  $$("[data-edit]", box).forEach((btn) => btn.addEventListener("click", () => {
    const row = rows.find((r) => r.id === btn.dataset.edit);
    const form = $("#payment-form");
    form.dataset.editId = row.id;
    $("#payment-amount").value = row.amount;
    $("#payment-date").value = row.date;
    $("#payment-method").value = row.method;
    $("#payment-note").value = row.note || "";
    $("#payment-submit").textContent = "Update Payment";
    $("#payment-cancel-edit")?.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));

  $$("[data-delete]", box).forEach((btn) => btn.addEventListener("click", () => confirmDelete("payments", btn.dataset.delete)));
}

/* -------------------------------------------------------------------------
   10. PAGE: expenses.html
   ------------------------------------------------------------------------- */
function initExpenses() {
  guardAuth(() => {
    const form = $("#expense-form");
    $("#expense-date") && ($("#expense-date").value = toDateInputValue());
    populateSelect("#expense-category", EXPENSE_CATEGORIES);

    $$(".radio-pill", $("#voucher-toggle")).forEach((pill) => {
      pill.addEventListener("click", () => {
        $$(".radio-pill", $("#voucher-toggle")).forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        $("input", pill).checked = true;
      });
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#expense-submit");
      const editId = form.dataset.editId;
      const payload = {
        amount: parseFloat($("#expense-amount").value),
        category: $("#expense-category").value,
        date: $("#expense-date").value,
        description: $("#expense-description").value.trim(),
        voucherAvailable: $('input[name="voucherAvailable"]:checked')?.value === "yes",
        uid: CURRENT_USER.uid,
      };
      if (!payload.amount || payload.amount <= 0) return toast("Enter a valid amount", "error");
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
      try {
        if (editId) {
          await updateDoc(doc(db, "expenses", editId), payload);
          toast("Expense updated", "success");
        } else {
          payload.createdAt = serverTimestamp();
          await addDoc(expensesCol(), payload);
          toast("Expense added", "success");
        }
        resetExpenseForm();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false; btn.innerHTML = "Save Expense";
      }
    });

    $("#expense-cancel-edit")?.addEventListener("click", resetExpenseForm);

    listenCollection(expensesCol(), renderExpensesList);
  });
}

function resetExpenseForm() {
  const form = $("#expense-form");
  if (!form) return;
  form.reset();
  delete form.dataset.editId;
  $("#expense-date").value = toDateInputValue();
  $$(".radio-pill", $("#voucher-toggle")).forEach((p, i) => p.classList.toggle("active", i === 1));
  $('input[name="voucherAvailable"][value="no"]').checked = true;
  $("#expense-submit").textContent = "Save Expense";
  $("#expense-cancel-edit")?.classList.add("hidden");
}

function populateSelect(sel, options) {
  const el = $(sel);
  if (!el || el.dataset.filled) return;
  el.innerHTML = options.map((o) => `<option value="${o}">${o}</option>`).join("");
  el.dataset.filled = "1";
}

function renderExpensesList(rows) {
  const box = $("#expenses-list");
  if (!box) return;
  if (!rows.length) { box.innerHTML = emptyStateHtml("No expenses yet", "Expenses you add will show up here."); return; }
  box.innerHTML = rows.map((ex) => `
    <div class="flex items-center justify-between" style="padding:14px 0;border-bottom:1px solid var(--color-border);">
      <div class="flex items-center gap-12">
        <div class="stat-icon" style="width:38px;height:38px;background:${CATEGORY_COLORS[ex.category] || "#64748B"}22;color:${CATEGORY_COLORS[ex.category] || "#64748B"};">${transactionIcon("Expense")}</div>
        <div>
          <div style="font-weight:700;font-size:14px;">${money(ex.amount)} <span style="font-weight:600;font-size:11.5px;color:var(--color-text-faint);">· ${escapeHtml(ex.category)}</span></div>
          <div style="font-size:12px;color:var(--color-text-faint);">${formatDateLabel(ex.date)}${ex.description ? " · " + escapeHtml(ex.description) : ""} ${ex.voucherAvailable ? '· <span class="text-success">Voucher available</span>' : ""}</div>
        </div>
      </div>
      <div class="row-actions">
        <button data-edit="${ex.id}" title="Edit">${iconEdit()}</button>
        <button data-delete="${ex.id}" title="Delete">${iconTrash()}</button>
      </div>
    </div>`).join("");

  $$("[data-edit]", box).forEach((btn) => btn.addEventListener("click", () => {
    const row = rows.find((r) => r.id === btn.dataset.edit);
    const form = $("#expense-form");
    form.dataset.editId = row.id;
    $("#expense-amount").value = row.amount;
    $("#expense-category").value = row.category;
    $("#expense-date").value = row.date;
    $("#expense-description").value = row.description || "";
    $(`input[name="voucherAvailable"][value="${row.voucherAvailable ? "yes" : "no"}"]`).checked = true;
    $$(".radio-pill", $("#voucher-toggle")).forEach((p) => p.classList.toggle("active", p.querySelector("input").value === (row.voucherAvailable ? "yes" : "no")));
    $("#expense-submit").textContent = "Update Expense";
    $("#expense-cancel-edit")?.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));

  $$("[data-delete]", box).forEach((btn) => btn.addEventListener("click", () => confirmDelete("expenses", btn.dataset.delete)));
}

/* -------------------------------------------------------------------------
   11. PAGE: voucher.html
   ------------------------------------------------------------------------- */
function initVoucher() {
  guardAuth(() => {
    const form = $("#voucher-form");
    $("#voucher-date") && ($("#voucher-date").value = toDateInputValue());
    populateSelect("#voucher-category", EXPENSE_CATEGORIES);
    populateSelect("#voucher-status", VOUCHER_STATUSES);

    let selectedFile = null;
    const dropZone = $("#voucher-file-drop");
    const fileInput = $("#voucher-file-input");
    const preview = $("#voucher-file-preview");

    dropZone?.addEventListener("click", () => fileInput.click());
    fileInput?.addEventListener("change", () => {
      selectedFile = fileInput.files[0] || null;
      if (selectedFile) {
        preview.style.display = "block";
        preview.innerHTML = `<img src="${URL.createObjectURL(selectedFile)}" alt="Voucher preview" />`;
      }
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#voucher-submit");
      const editId = form.dataset.editId;
      const amount = parseFloat($("#voucher-amount").value);
      if (!amount || amount <= 0) return toast("Enter a valid amount", "error");

      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
      try {
        let imageUrl = form.dataset.existingImage || "";
        if (selectedFile) {
          const path = `vouchers/${CURRENT_USER.uid}/${Date.now()}_${selectedFile.name}`;
          const storageRef = ref(storage, path);
          await uploadBytes(storageRef, selectedFile);
          imageUrl = await getDownloadURL(storageRef);
        }
        const payload = {
          amount, date: $("#voucher-date").value, category: $("#voucher-category").value,
          status: $("#voucher-status").value, imageUrl, uid: CURRENT_USER.uid,
        };
        if (editId) {
          await updateDoc(doc(db, "vouchers", editId), payload);
          toast("Voucher updated", "success");
        } else {
          payload.createdAt = serverTimestamp();
          await addDoc(vouchersCol(), payload);
          toast("Voucher added", "success");
        }
        resetVoucherForm();
        selectedFile = null;
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false; btn.innerHTML = "Save Voucher";
      }
    });

    $("#voucher-cancel-edit")?.addEventListener("click", resetVoucherForm);

    $$(".status-filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$(".status-filter-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        renderVoucherGrid(voucherRows, chip.dataset.status);
      });
    });

    let voucherRows = [];
    listenCollection(vouchersCol(), (rows) => {
      voucherRows = rows;
      const activeChip = $(".status-filter-chip.active");
      renderVoucherGrid(rows, activeChip ? activeChip.dataset.status : "All");
    });

    function resetVoucherForm() {
      form.reset();
      delete form.dataset.editId;
      delete form.dataset.existingImage;
      $("#voucher-date").value = toDateInputValue();
      $("#voucher-submit").textContent = "Save Voucher";
      $("#voucher-cancel-edit")?.classList.add("hidden");
      preview.style.display = "none";
      preview.innerHTML = "";
    }

    window.__editVoucher = (id) => {
      const row = voucherRows.find((r) => r.id === id);
      if (!row) return;
      form.dataset.editId = row.id;
      form.dataset.existingImage = row.imageUrl || "";
      $("#voucher-amount").value = row.amount;
      $("#voucher-date").value = row.date;
      $("#voucher-category").value = row.category;
      $("#voucher-status").value = row.status;
      if (row.imageUrl) { preview.style.display = "block"; preview.innerHTML = `<img src="${row.imageUrl}" alt="Voucher"/>`; }
      $("#voucher-submit").textContent = "Update Voucher";
      $("#voucher-cancel-edit")?.classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.__deleteVoucher = (id) => confirmDelete("vouchers", id);
  });
}

function renderVoucherGrid(rows, statusFilter) {
  const grid = $("#voucher-grid");
  if (!grid) return;
  const filtered = statusFilter && statusFilter !== "All" ? rows.filter((r) => r.status === statusFilter) : rows;
  if (!filtered.length) { grid.innerHTML = emptyStateHtml("No vouchers found", "Upload a voucher image to get started."); return; }

  grid.innerHTML = filtered.map((v) => `
    <div class="card" style="overflow:hidden;">
      <div style="height:140px;background:var(--color-surface-alt);display:flex;align-items:center;justify-content:center;overflow:hidden;">
        ${v.imageUrl ? `<img src="${v.imageUrl}" style="width:100%;height:100%;object-fit:cover;" alt="Voucher"/>` : `<span style="color:var(--color-text-faint);font-size:12px;">No image</span>`}
      </div>
      <div class="card-pad" style="padding:14px 16px;">
        <div class="flex items-center justify-between mb-16" style="margin-bottom:8px;">
          <span class="amount" style="font-weight:700;font-size:15px;">${money(v.amount)}</span>
          <span class="badge tone-${STATUS_TONE[v.status] || "info"}">${v.status}</span>
        </div>
        <div style="font-size:12px;color:var(--color-text-faint);margin-bottom:12px;">${escapeHtml(v.category)} · ${formatDateLabel(v.date)}</div>
        <div class="flex gap-8">
          <button class="btn btn-outline btn-sm w-full" onclick="window.__editVoucher('${v.id}')">${iconEdit()} Edit</button>
          <button class="btn btn-danger btn-sm w-full" onclick="window.__deleteVoucher('${v.id}')">${iconTrash()} Delete</button>
        </div>
      </div>
    </div>`).join("");
}

/* -------------------------------------------------------------------------
   12. PAGE: transactions.html
   ------------------------------------------------------------------------- */
let txState = { rows: [], sortKey: "date", sortDir: "desc", search: "", typeFilter: "All", statusFilter: "All" };

function initTransactions() {
  guardAuth(() => {
    let payments = [], expenses = [], vouchers = [];
    const rebuild = () => {
      txState.rows = [
        ...payments.map((p) => ({ id: p.id, col: "payments", date: p.date, type: "Payment", category: p.method || "—", amount: p.amount, status: "—", note: p.note || "" })),
        ...expenses.map((e) => ({ id: e.id, col: "expenses", date: e.date, type: "Expense", category: e.category, amount: e.amount, status: e.voucherAvailable ? "Has voucher" : "No voucher", note: e.description || "" })),
        ...vouchers.map((v) => ({ id: v.id, col: "vouchers", date: v.date, type: "Voucher", category: v.category, amount: v.amount, status: v.status, note: "" })),
      ];
      renderTransactionsTable();
    };
    listenCollection(paymentsCol(), (r) => { payments = r; rebuild(); });
    listenCollection(expensesCol(), (r) => { expenses = r; rebuild(); });
    listenCollection(vouchersCol(), (r) => { vouchers = r; rebuild(); });

    $("#tx-search")?.addEventListener("input", (e) => { txState.search = e.target.value.toLowerCase(); renderTransactionsTable(); });
    $("#tx-type-filter")?.addEventListener("change", (e) => { txState.typeFilter = e.target.value; renderTransactionsTable(); });
    $$("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (txState.sortKey === key) txState.sortDir = txState.sortDir === "asc" ? "desc" : "asc";
      else { txState.sortKey = key; txState.sortDir = "asc"; }
      renderTransactionsTable();
    }));

    window.__editTransaction = (id, col) => {
      if (col === "payments") window.location.href = "payments.html";
      else if (col === "expenses") window.location.href = "expenses.html";
      else window.location.href = "voucher.html";
    };
    window.__deleteTransaction = (id, col) => confirmDelete(col, id);
  });
}

function renderTransactionsTable() {
  const tbody = $("#tx-tbody");
  if (!tbody) return;
  let rows = [...txState.rows];

  if (txState.typeFilter && txState.typeFilter !== "All") rows = rows.filter((r) => r.type === txState.typeFilter);
  if (txState.search) {
    rows = rows.filter((r) => [r.category, r.note, r.status, r.type].join(" ").toLowerCase().includes(txState.search));
  }
  rows.sort((a, b) => {
    let av = a[txState.sortKey], bv = b[txState.sortKey];
    if (txState.sortKey === "amount") { av = Number(av); bv = Number(bv); }
    else { av = String(av || "").toLowerCase(); bv = String(bv || "").toLowerCase(); }
    if (av < bv) return txState.sortDir === "asc" ? -1 : 1;
    if (av > bv) return txState.sortDir === "asc" ? 1 : -1;
    return 0;
  });

  $("#tx-count") && ($("#tx-count").textContent = `${rows.length} transaction${rows.length === 1 ? "" : "s"}`);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml("No transactions found", "Try a different search or filter.")}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${formatDateLabel(r.date)}</td>
      <td><span class="type-pill tone-${r.type === "Payment" ? "success" : r.type === "Expense" ? "danger" : "info"}">${r.type}</span></td>
      <td>${escapeHtml(r.category)}</td>
      <td class="amount">${money(r.amount)}</td>
      <td>${r.status !== "—" ? `<span class="badge tone-${STATUS_TONE[r.status] || "primary"}">${escapeHtml(r.status)}</span>` : "—"}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.note) || "—"}</td>
      <td>
        <div class="row-actions">
          <button title="Edit" onclick="window.__editTransaction('${r.id}','${r.col}')">${iconEdit()}</button>
          <button title="Delete" onclick="window.__deleteTransaction('${r.id}','${r.col}')">${iconTrash()}</button>
        </div>
      </td>
    </tr>`).join("");
}

/* -------------------------------------------------------------------------
   13. PAGE: reports.html
   ------------------------------------------------------------------------- */
function initReports() {
  guardAuth(() => {
    let payments = [], expenses = [], vouchers = [];
    listenCollection(paymentsCol(), (r) => (payments = r));
    listenCollection(expensesCol(), (r) => (expenses = r));
    listenCollection(vouchersCol(), (r) => (vouchers = r));

    $$(".report-range-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$(".report-range-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const range = computeRange(chip.dataset.range);
        $("#report-from").value = range.from;
        $("#report-to").value = range.to;
        generateReport();
      });
    });

    $("#report-generate")?.addEventListener("click", generateReport);
    $("#report-export-pdf")?.addEventListener("click", () => exportReport("pdf"));
    $("#report-export-excel")?.addEventListener("click", () => exportReport("excel"));
    $("#report-export-csv")?.addEventListener("click", () => exportReport("csv"));

    const todayRange = computeRange("today");
    $("#report-from").value = todayRange.from;
    $("#report-to").value = todayRange.to;

    function generateReport() {
      const from = $("#report-from").value;
      const to = $("#report-to").value;
      if (!from || !to) return toast("Pick a valid date range", "error");

      const inRange = (d) => d >= from && d <= to;
      const p = payments.filter((x) => inRange(x.date));
      const e = expenses.filter((x) => inRange(x.date));
      const v = vouchers.filter((x) => inRange(x.date));

      const totalReceived = sum(p);
      const totalExpense = sum(e);
      const voucherTotal = sum(v);
      const balance = totalReceived - totalExpense;

      setText("#report-received", money(totalReceived));
      setText("#report-expense", money(totalExpense));
      setText("#report-voucher", money(voucherTotal));
      setText("#report-balance", money(balance));

      const rows = [
        ...p.map((x) => ({ date: x.date, type: "Payment", category: x.method, amount: x.amount, status: "—", note: x.note || "" })),
        ...e.map((x) => ({ date: x.date, type: "Expense", category: x.category, amount: x.amount, status: x.voucherAvailable ? "Has voucher" : "No voucher", note: x.description || "" })),
        ...v.map((x) => ({ date: x.date, type: "Voucher", category: x.category, amount: x.amount, status: x.status, note: "" })),
      ].sort((a, b) => a.date.localeCompare(b.date));

      window.__reportRows = rows;
      window.__reportMeta = { from, to, totalReceived, totalExpense, voucherTotal, balance };

      const tbody = $("#report-tbody");
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml("Nothing in this range", "Try widening the date range.")}</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td>${formatDateLabel(r.date)}</td>
          <td><span class="type-pill tone-${r.type === "Payment" ? "success" : r.type === "Expense" ? "danger" : "info"}">${r.type}</span></td>
          <td>${escapeHtml(r.category)}</td>
          <td class="amount">${money(r.amount)}</td>
          <td>${r.status !== "—" ? `<span class="badge tone-${STATUS_TONE[r.status] || "primary"}">${escapeHtml(r.status)}</span>` : "—"}</td>
          <td>${escapeHtml(r.note) || "—"}</td>
        </tr>`).join("");
    }

    // generate an initial report once data starts flowing
    setTimeout(generateReport, 400);
  });
}

function computeRange(kind) {
  const now = new Date();
  const to = toDateInputValue(now);
  let from = to;
  if (kind === "today") from = to;
  else if (kind === "week") { const d = new Date(now); d.setDate(d.getDate() - 6); from = toDateInputValue(d); }
  else if (kind === "month") { const d = new Date(now.getFullYear(), now.getMonth(), 1); from = toDateInputValue(d); }
  return { from, to };
}

function exportReport(kind) {
  const rows = window.__reportRows || [];
  const meta = window.__reportMeta;
  if (!rows.length) return toast("Generate a report first", "error");

  if (kind === "csv") {
    const header = ["Date", "Type", "Category", "Amount", "Status", "Note"];
    const csv = [header, ...rows.map((r) => [r.date, r.type, r.category, r.amount, r.status, r.note])]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(csv, `expense-report-${meta.from}_to_${meta.to}.csv`, "text/csv");
    toast("CSV exported", "success");
    return;
  }

  if (kind === "excel") {
    if (typeof XLSX === "undefined") return toast("Excel library not loaded", "error");
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({ Date: r.date, Type: r.type, Category: r.category, Amount: r.amount, Status: r.status, Note: r.note })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `expense-report-${meta.from}_to_${meta.to}.xlsx`);
    toast("Excel file exported", "success");
    return;
  }

  if (kind === "pdf") {
    if (typeof window.jspdf === "undefined") return toast("PDF library not loaded", "error");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    pdf.setFontSize(16); pdf.text("Expense Manager — Report", 14, 18);
    pdf.setFontSize(10); pdf.setTextColor(100);
    pdf.text(`Range: ${meta.from} to ${meta.to}`, 14, 25);
    pdf.text(`Received: ${money(meta.totalReceived)}   Expense: ${money(meta.totalExpense)}   Voucher: ${money(meta.voucherTotal)}   Balance: ${money(meta.balance)}`, 14, 31);
    pdf.autoTable({
      startY: 38,
      head: [["Date", "Type", "Category", "Amount", "Status", "Note"]],
      body: rows.map((r) => [formatDateLabel(r.date), r.type, r.category, money(r.amount), r.status, r.note]),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    pdf.save(`expense-report-${meta.from}_to_${meta.to}.pdf`);
    toast("PDF exported", "success");
  }
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/* -------------------------------------------------------------------------
   14. PAGE: settings.html
   ------------------------------------------------------------------------- */
function initSettings() {
  guardAuth((user) => {
    $("#settings-email") && ($("#settings-email").textContent = user.email);
    $("#settings-uid") && ($("#settings-uid").textContent = user.uid);

    const darkToggle = $("#settings-dark-toggle");
    if (darkToggle) {
      darkToggle.setAttribute("aria-checked", document.documentElement.getAttribute("data-theme") === "dark");
    }

    $("#settings-backup")?.addEventListener("click", async () => {
      try {
        const [p, e, v] = await Promise.all([getDocs(paymentsCol()), getDocs(expensesCol()), getDocs(vouchersCol())]);
        const backup = {
          exportedAt: new Date().toISOString(),
          payments: p.docs.map((d) => ({ id: d.id, ...d.data() })),
          expenses: e.docs.map((d) => ({ id: d.id, ...d.data() })),
          vouchers: v.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
        downloadBlob(JSON.stringify(backup, null, 2), `expense-manager-backup-${toDateInputValue()}.json`, "application/json");
        toast("Backup downloaded", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("#settings-restore-input")?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm("Restore will ADD all records from this backup file into your live data. Continue?")) { e.target.value = ""; return; }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        let count = 0;
        for (const p of data.payments || []) { const { id, ...rest } = p; await addDoc(paymentsCol(), rest); count++; }
        for (const ex of data.expenses || []) { const { id, ...rest } = ex; await addDoc(expensesCol(), rest); count++; }
        for (const v of data.vouchers || []) { const { id, ...rest } = v; await addDoc(vouchersCol(), rest); count++; }
        toast(`Restored ${count} records`, "success");
      } catch (err) {
        toast("Couldn't read that backup file", "error");
      } finally {
        e.target.value = "";
      }
    });
  });
}

/* -------------------------------------------------------------------------
   15. Delete confirmation modal
   ------------------------------------------------------------------------- */
function confirmDelete(collectionName, id) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal card card-pad">
      <h3 style="font-size:17px;margin-bottom:8px;">Delete this record?</h3>
      <p class="text-muted" style="font-size:13.5px;margin-bottom:20px;">This action can't be undone.</p>
      <div class="form-actions" style="margin-top:0;">
        <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-ok">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  $("#confirm-cancel", overlay).addEventListener("click", () => overlay.remove());
  $("#confirm-ok", overlay).addEventListener("click", async () => {
    try {
      await deleteDoc(doc(db, collectionName, id));
      toast("Deleted", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      overlay.remove();
    }
  });
}

/* -------------------------------------------------------------------------
   16. Small inline icons reused across renders
   ------------------------------------------------------------------------- */
function iconEdit() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'; }
function iconTrash() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>'; }

/* -------------------------------------------------------------------------
   17. Router — runs on every page
   ------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSidebar();
  initLogoutButtons();

  const page = document.body.dataset.page;
  const routes = {
    login: initLogin,
    dashboard: initDashboard,
    payments: initPayments,
    expenses: initExpenses,
    voucher: initVoucher,
    transactions: initTransactions,
    reports: initReports,
    settings: initSettings,
  };
  (routes[page] || (() => guardAuth()))();
});
