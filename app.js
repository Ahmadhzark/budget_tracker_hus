(() => {
  "use strict";

  const STORAGE_KEY = "budget-tracker-transactions";
  const PROJECTS_KEY = "budget-tracker-projects";
  const ACTIVE_PROJECT_KEY = "budget-tracker-active-project";
  const ATTACHMENTS_DB = "budget-tracker-attachments";
  const ATTACHMENTS_STORE = "files";
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

  const CATEGORIES = {
    expense: ["Food", "Transport", "Housing", "Utilities", "Entertainment", "Health", "Shopping", "Other"],
    income: ["Salary", "Freelance", "Investment", "Gift", "Other"],
  };

  const CHART_COLORS = [
    "#3b6ef6", "#d9534f", "#f0ad4e", "#5bc0de",
    "#1a9e6a", "#9b59b6", "#e67e22", "#34495e",
  ];

  const DEFAULT_PROJECTS = [
    { id: "personal", name: "Personal" },
    { id: "business", name: "Business" },
  ];

  // ---------- state ----------
  let transactions = loadTransactions();
  let projects = loadProjects();
  let activeProject = loadActiveProject();
  let viewDate = new Date(); // month currently displayed
  viewDate.setDate(1);
  let currentType = "expense";
  let chart = null;
  let selectedAttachment = null;
  let previewObjectUrl = null;
  let attachmentDbPromise = null;

  migrateLegacyTransactions();

  // ---------- elements ----------
  const el = {
    currentMonth: document.getElementById("currentMonth"),
    prevMonth: document.getElementById("prevMonth"),
    nextMonth: document.getElementById("nextMonth"),
    projectPills: document.getElementById("projectPills"),
    manageProjectsBtn: document.getElementById("manageProjectsBtn"),
    projectModalOverlay: document.getElementById("projectModalOverlay"),
    closeModalBtn: document.getElementById("closeModalBtn"),
    projectManageList: document.getElementById("projectManageList"),
    newProjectForm: document.getElementById("newProjectForm"),
    newProjectName: document.getElementById("newProjectName"),
    totalIncome: document.getElementById("totalIncome"),
    totalExpense: document.getElementById("totalExpense"),
    totalBalance: document.getElementById("totalBalance"),
    grandTotalBalance: document.getElementById("grandTotalBalance"),
    form: document.getElementById("txForm"),
    typeButtons: document.querySelectorAll(".type-btn"),
    desc: document.getElementById("txDesc"),
    amount: document.getElementById("txAmount"),
    category: document.getElementById("txCategory"),
    date: document.getElementById("txDate"),
    txList: document.getElementById("txList"),
    listEmptyHint: document.getElementById("listEmptyHint"),
    filterCategory: document.getElementById("filterCategory"),
    chartCanvas: document.getElementById("categoryChart"),
    chartEmptyHint: document.getElementById("chartEmptyHint"),
    receipt: document.getElementById("txReceipt"),
    uploadDropzone: document.getElementById("uploadDropzone"),
    fileSelection: document.getElementById("fileSelection"),
    selectedFileName: document.getElementById("selectedFileName"),
    removeSelectedFile: document.getElementById("removeSelectedFile"),
    txSearch: document.getElementById("txSearch"),
    attachmentPreview: document.getElementById("attachmentPreview"),
    previewTitle: document.getElementById("previewTitle"),
    previewContent: document.getElementById("previewContent"),
    closePreview: document.getElementById("closePreview"),
    downloadAttachment: document.getElementById("downloadAttachment"),
    exportBtn: document.getElementById("exportBtn"),
    clearBtn: document.getElementById("clearBtn"),
  };

  // ---------- storage ----------
  function loadTransactions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveTransactions() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }

  function loadProjects() {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.length ? parsed : [...DEFAULT_PROJECTS];
    } catch {
      return [...DEFAULT_PROJECTS];
    }
  }

  function saveProjects() {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }

  function loadActiveProject() {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || projects[0].id;
  }

  function saveActiveProject() {
    localStorage.setItem(ACTIVE_PROJECT_KEY, activeProject);
  }

  function migrateLegacyTransactions() {
    // Transactions saved before the Projects feature existed have no `project` field.
    // Attach them to the first project instead of losing them.
    const fallbackId = projects[0].id;
    let changed = false;
    transactions.forEach((t) => {
      if (!t.project) {
        t.project = fallbackId;
        changed = true;
      }
    });
    if (changed) saveTransactions();
    if (!projects.some((p) => p.id === activeProject)) {
      activeProject = projects[0].id;
      saveActiveProject();
    }
  }

  // Attachments live in IndexedDB so photos and PDFs do not bloat localStorage.
  function getAttachmentDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("File storage is not supported in this browser."));
    if (!attachmentDbPromise) {
      attachmentDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(ATTACHMENTS_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(ATTACHMENTS_STORE)) db.createObjectStore(ATTACHMENTS_STORE, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open file storage."));
      });
    }
    return attachmentDbPromise;
  }

  async function storeAttachment(file) {
    const db = await getAttachmentDb();
    const record = {
      id: crypto.randomUUID ? crypto.randomUUID() : `file-${Date.now()}-${Math.random()}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      blob: file,
      createdAt: new Date().toISOString(),
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENTS_STORE, "readwrite");
      tx.objectStore(ATTACHMENTS_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Could not save attachment."));
      tx.onabort = () => reject(tx.error || new Error("Attachment save was cancelled."));
    });
    return { id: record.id, name: record.name, type: record.type, size: record.size };
  }

  async function getAttachment(id) {
    const db = await getAttachmentDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACHMENTS_STORE, "readonly");
      const request = tx.objectStore(ATTACHMENTS_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read attachment."));
    });
  }

  async function deleteAttachment(id) {
    if (!id) return;
    try {
      const db = await getAttachmentDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(ATTACHMENTS_STORE, "readwrite");
        tx.objectStore(ATTACHMENTS_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Could not remove attachment."));
      });
    } catch (error) {
      console.warn("Attachment cleanup failed:", error);
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function clearSelectedAttachment() {
    selectedAttachment = null;
    el.receipt.value = "";
    el.fileSelection.hidden = true;
    el.selectedFileName.textContent = "";
    el.uploadDropzone.classList.remove("has-file");
  }

  // ---------- helpers ----------
  function formatCurrency(n) {
    return n.toLocaleString("en-LK", { style: "currency", currency: "LKR" });
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function slugify(name) {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    let id = base || "project";
    let suffix = 1;
    while (projects.some((p) => p.id === id)) {
      id = `${base}-${++suffix}`;
    }
    return id;
  }

  function transactionsForMonth() {
    const key = monthKey(viewDate);
    return transactions.filter((t) => t.project === activeProject && t.date.slice(0, 7) === key);
  }

  function populateCategorySelect() {
    el.category.innerHTML = "";
    CATEGORIES[currentType].forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      el.category.appendChild(opt);
    });
  }

  function populateFilterCategories() {
    const monthTx = transactionsForMonth();
    const cats = [...new Set(monthTx.map((t) => t.category))].sort();
    const prev = el.filterCategory.value;
    el.filterCategory.innerHTML = '<option value="all">All categories</option>';
    cats.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      el.filterCategory.appendChild(opt);
    });
    if ([...el.filterCategory.options].some((o) => o.value === prev)) {
      el.filterCategory.value = prev;
    }
  }

  // ---------- project rendering ----------
  function renderProjectPills() {
    el.projectPills.innerHTML = "";
    projects.forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "project-pill" + (p.id === activeProject ? " active" : "");
      btn.textContent = p.name;
      btn.addEventListener("click", () => {
        activeProject = p.id;
        saveActiveProject();
        renderProjectPills();
        render();
      });
      el.projectPills.appendChild(btn);
    });
  }

  function renderProjectManageList() {
    el.projectManageList.innerHTML = "";
    projects.forEach((p) => {
      const li = document.createElement("li");

      const input = document.createElement("input");
      input.type = "text";
      input.value = p.name;
      input.addEventListener("change", () => {
        const name = input.value.trim();
        if (!name) {
          input.value = p.name;
          return;
        }
        p.name = name;
        saveProjects();
        renderProjectPills();
      });

      const del = document.createElement("button");
      del.className = "tx-delete";
      del.setAttribute("aria-label", `Delete ${p.name}`);
      del.textContent = "✕";
      del.disabled = projects.length <= 1;
      del.title = projects.length <= 1 ? "At least one project is required" : "Delete project";
      del.addEventListener("click", () => {
        const count = transactions.filter((t) => t.project === p.id).length;
        const warning = count
          ? `Delete "${p.name}" and its ${count} transaction${count === 1 ? "" : "s"}?`
          : `Delete "${p.name}"?`;
        if (!confirm(warning)) return;

        transactions.filter((t) => t.project === p.id && t.attachment).forEach((t) => deleteAttachment(t.attachment.id));
        transactions = transactions.filter((t) => t.project !== p.id);
        saveTransactions();
        projects = projects.filter((x) => x.id !== p.id);
        saveProjects();
        if (activeProject === p.id) {
          activeProject = projects[0].id;
          saveActiveProject();
        }
        renderProjectPills();
        renderProjectManageList();
        render();
      });

      li.append(input, del);
      el.projectManageList.appendChild(li);
    });
  }

  function openProjectModal() {
    renderProjectManageList();
    el.projectModalOverlay.classList.add("open");
  }

  function closeProjectModal() {
    el.projectModalOverlay.classList.remove("open");
  }

  // ---------- rendering ----------
  function render() {
    el.currentMonth.textContent = viewDate.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });

    const monthTx = transactionsForMonth();
    const income = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

    el.totalIncome.textContent = formatCurrency(income);
    el.totalExpense.textContent = formatCurrency(expense);
    el.totalBalance.textContent = formatCurrency(income - expense);

    const allTx = transactions.filter((t) => t.project === activeProject);
    const allIncome = allTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const allExpense = allTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    el.grandTotalBalance.textContent = formatCurrency(allIncome - allExpense);

    populateFilterCategories();
    renderList(monthTx);
    renderChart(monthTx);
  }

  function renderList(monthTx) {
    const filter = el.filterCategory.value;
    const query = (el.txSearch.value || "").trim().toLocaleLowerCase();
    const filtered = monthTx.filter((t) => {
      const categoryMatch = filter === "all" || t.category === filter;
      const searchMatch = !query || [t.description, t.category, t.date, t.type].some((value) => String(value || "").toLocaleLowerCase().includes(query));
      return categoryMatch && searchMatch;
    });
    const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

    el.txList.innerHTML = "";
    el.listEmptyHint.style.display = sorted.length ? "none" : "block";

    sorted.forEach((t) => {
      const li = document.createElement("li");

      const info = document.createElement("div");
      info.className = "tx-info";
      const desc = document.createElement("span");
      desc.className = "tx-desc";
      desc.textContent = t.description;
      const meta = document.createElement("span");
      meta.className = "tx-meta";
      meta.textContent = `${t.category} · ${new Date(t.date + "T00:00:00").toLocaleDateString()}`;
      info.append(desc, meta);
      if (t.attachment) {
        const fileBtn = document.createElement("button");
        fileBtn.type = "button";
        fileBtn.className = "attachment-chip";
        fileBtn.textContent = `▧ ${t.attachment.name || "View receipt"}`;
        fileBtn.title = "Open attached receipt or screenshot";
        fileBtn.addEventListener("click", () => openAttachment(t.attachment));
        info.appendChild(fileBtn);
      }

      const amount = document.createElement("span");
      amount.className = `tx-amount ${t.type}`;
      amount.textContent = `${t.type === "income" ? "+" : "-"}${formatCurrency(t.amount)}`;

      const del = document.createElement("button");
      del.className = "tx-delete";
      del.setAttribute("aria-label", "Delete transaction");
      del.textContent = "✕";
      del.title = "Delete transaction";
      del.addEventListener("click", () => {
        if (!confirm(`Delete transaction “${t.description}”?`)) return;
        if (t.attachment) deleteAttachment(t.attachment.id);
        transactions = transactions.filter((x) => x.id !== t.id);
        saveTransactions();
        render();
      });

      li.append(info, amount, del);
      el.txList.appendChild(li);
    });
  }

  function renderChart(monthTx) {
    const expenses = monthTx.filter((t) => t.type === "expense");
    const totals = {};
    expenses.forEach((t) => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });

    const labels = Object.keys(totals);
    const data = Object.values(totals);

    el.chartEmptyHint.style.display = labels.length ? "none" : "block";
    el.chartCanvas.style.display = labels.length ? "block" : "none";

    if (!labels.length) {
      if (chart) { chart.destroy(); chart = null; }
      return;
    }

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].backgroundColor = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
      chart.options.plugins.legend.labels.color = getComputedStyle(document.body).getPropertyValue("--text") || "#333";
      chart.update("none");
      return;
    }

    chart = new Chart(el.chartCanvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: getComputedStyle(document.body).getPropertyValue("--text") || "#333" },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed)}`,
            },
          },
        },
      },
    });
  }

  async function openAttachment(metadata) {
    try {
      const record = await getAttachment(metadata.id);
      if (!record || !record.blob) {
        alert("This attachment is missing from this browser. It may have been cleared or the data may have been imported from another device.");
        return;
      }
      closeAttachmentPreview();
      previewObjectUrl = URL.createObjectURL(record.blob);
      el.previewTitle.textContent = record.name || metadata.name || "Attachment";
      el.previewContent.innerHTML = "";
      if ((record.type || "").startsWith("image/")) {
        const img = document.createElement("img");
        img.src = previewObjectUrl;
        img.alt = record.name || "Transaction attachment";
        el.previewContent.appendChild(img);
      } else if (record.type === "application/pdf") {
        const frame = document.createElement("iframe");
        frame.src = previewObjectUrl;
        frame.title = record.name || "PDF receipt";
        el.previewContent.appendChild(frame);
      } else {
        const message = document.createElement("p");
        message.textContent = "Preview is not available for this file type. Use Download file.";
        el.previewContent.appendChild(message);
      }
      el.downloadAttachment.href = previewObjectUrl;
      el.downloadAttachment.download = record.name || "attachment";
      el.attachmentPreview.hidden = false;
      el.closePreview.focus();
    } catch (error) {
      alert(`Could not open attachment. ${error.message || "Please try again."}`);
    }
  }

  function closeAttachmentPreview() {
    if (el.attachmentPreview.hidden) return;
    el.attachmentPreview.hidden = true;
    el.previewContent.innerHTML = "";
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }

  // ---------- events ----------
  el.typeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentType = btn.dataset.type;
      el.typeButtons.forEach((b) => b.classList.toggle("active", b === btn));
      populateCategorySelect();
    });
  });

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = parseFloat(el.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!el.date.value) return;

    const submitButton = el.form.querySelector(".submit-btn");
    submitButton.disabled = true;
    submitButton.textContent = "Saving…";
    try {
      let attachment = null;
      if (selectedAttachment) attachment = await storeAttachment(selectedAttachment);
      transactions.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        project: activeProject,
        type: currentType,
        description: el.desc.value.trim() || "(no description)",
        amount,
        category: el.category.value,
        date: el.date.value,
        ...(attachment ? { attachment } : {}),
      });
      saveTransactions();
    } catch (error) {
      alert(`Could not save this transaction${selectedAttachment ? " and its attachment" : ""}. ${error.message || "Please try again."}`);
      return;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Add Transaction";
    }

    // Jump the view to whatever month this transaction was dated for, so it's
    // never silently hidden if it doesn't fall in the month currently shown.
    const [y, m] = el.date.value.split("-").map(Number);
    viewDate = new Date(y, m - 1, 1);

    el.form.reset();
    clearSelectedAttachment();
    el.date.value = defaultDateForView();
    populateCategorySelect();
    render();
  });

  el.receipt.addEventListener("change", () => {
    const file = el.receipt.files && el.receipt.files[0];
    if (!file) { clearSelectedAttachment(); return; }
    const allowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!allowed) {
      alert("Choose an image or PDF file.");
      clearSelectedAttachment();
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      alert("This file is larger than 10 MB. Choose a smaller image or PDF.");
      clearSelectedAttachment();
      return;
    }
    selectedAttachment = file;
    el.selectedFileName.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    el.fileSelection.hidden = false;
    el.uploadDropzone.classList.add("has-file");
  });

  el.removeSelectedFile.addEventListener("click", clearSelectedAttachment);
  el.txSearch.addEventListener("input", () => renderList(transactionsForMonth()));
  el.closePreview.addEventListener("click", closeAttachmentPreview);
  el.attachmentPreview.addEventListener("click", (event) => {
    if (event.target === el.attachmentPreview) closeAttachmentPreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAttachmentPreview();
  });
  el.filterCategory.addEventListener("change", () => render());

  el.prevMonth.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    el.date.value = defaultDateForView();
    render();
  });

  el.nextMonth.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    el.date.value = defaultDateForView();
    render();
  });

  el.manageProjectsBtn.addEventListener("click", openProjectModal);
  el.closeModalBtn.addEventListener("click", closeProjectModal);
  el.projectModalOverlay.addEventListener("click", (e) => {
    if (e.target === el.projectModalOverlay) closeProjectModal();
  });

  el.newProjectForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = el.newProjectName.value.trim();
    if (!name) return;
    const id = slugify(name);
    projects.push({ id, name });
    saveProjects();
    activeProject = id;
    saveActiveProject();
    el.newProjectForm.reset();
    renderProjectPills();
    renderProjectManageList();
    render();
  });

  el.exportBtn.addEventListener("click", () => {
    const data = { projects, transactions };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-export-${monthKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  el.clearBtn.addEventListener("click", () => {
    if (confirm(`This will permanently delete all transactions in "${projects.find((p) => p.id === activeProject).name}". Continue?`)) {
      transactions.filter((t) => t.project === activeProject && t.attachment).forEach((t) => deleteAttachment(t.attachment.id));
      transactions = transactions.filter((t) => t.project !== activeProject);
      saveTransactions();
      render();
    }
  });

  // ---------- init ----------
  function todayISO() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }

  function defaultDateForView() {
    const today = new Date();
    if (today.getFullYear() === viewDate.getFullYear() && today.getMonth() === viewDate.getMonth()) {
      return todayISO();
    }
    return `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, "0")}-01`;
  }

  el.date.value = defaultDateForView();
  populateCategorySelect();
  renderProjectPills();
  render();
})();
