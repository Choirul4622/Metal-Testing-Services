/**
 * FRONTEND LOGIC SYSTEM - CEK KADAR LOGAM SOVIA JEWELRY
 * 
 * Mengelola IndexedDB, Sync Queue, Antarmuka Single Page Application (SPA),
 * Form Dinamis, Kalkulasi Biaya Terotomatisasi, dan API call ke Google Apps Script.
 */

// URL Web App Google Apps Script yang ter-deploy
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwnBpPeh7rhPCvouGf7y2RWhHmLRNFM9W3SIU6Dpq3IAW5aEgIOSueM7TwsvHmACBUcNA/exec";

// State Management Global
const state = {
  activeTab: "dashboard",
  customers: [],
  transactions: [],
  masterData: {
    JenisProduk: [],
    JenisLogam: [],
    BiayaDasar: [],
    BiayaCetak: [],
    MetodePembayaran: []
  },
  activeValidationCategory: "JenisProduk"
};

// IndexedDB Helper
class IndexedDBManager {
  constructor(dbName = "db_kadar_logam", version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = (e) => reject("Gagal membuka IndexedDB: " + e.target.error);
      
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // Store untuk Master Data (Validasi)
        if (!db.objectStoreNames.contains("master_data")) {
          db.createObjectStore("master_data", { keyPath: "id", autoIncrement: true });
        }
        
        // Store untuk Pelanggan
        if (!db.objectStoreNames.contains("customers")) {
          db.createObjectStore("customers", { keyPath: "id" });
        }
        
        // Store untuk Transaksi Pelayanan
        if (!db.objectStoreNames.contains("transactions")) {
          db.createObjectStore("transactions", { keyPath: "id" });
        }
        
        // Store untuk Sync Queue (Antrean Sinkronisasi saat offline)
        if (!db.objectStoreNames.contains("sync_queue")) {
          db.createObjectStore("sync_queue", { keyPath: "id", autoIncrement: true });
        }
      };
    });
  }

  async clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async putItem(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteItem(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

const db = new IndexedDBManager();

// ==========================================
// API CLIENT (KOMUNIKASI DENGAN GAS)
// ==========================================

// Implementasi Fetch Client Sebenarnya (Membaca JSON dari GAS)
async function callGASApi(action, data = null) {
  if (!navigator.onLine) {
    throw new Error("offline");
  }
  
  try {
    const response = await fetch(GAS_API_URL, {
      method: "POST",
      redirect: "follow", // IKUTI redirect GAS tanpa gagal (Google Apps Script redirect otomatis)
      headers: {
        "Content-Type": "text/plain;charset=utf-8" // Hindari preflight CORS OPTIONS request
      },
      body: JSON.stringify({ action, data })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    if (result.status === "error") {
      throw new Error(result.message);
    }
    return result;
  } catch (err) {
    console.error(`Gagal call API [${action}]:`, err);
    throw err;
  }
}

// ==========================================
// SYNC QUEUE MANAGER (OFFLINE WORKFLOW)
// ==========================================
class SyncQueueManager {
  constructor() {
    this.isSyncing = false;
  }

  async addToQueue(action, data) {
    showToast("Disimpan secara lokal (Offline mode)");
    await db.putItem("sync_queue", { action, data, timestamp: Date.now() });
    this.updateQueueBadge();
  }

  async updateQueueBadge() {
    const queue = await db.getAll("sync_queue");
    const qBox = document.getElementById("queue-box");
    const qCount = document.getElementById("queue-count");
    
    if (queue.length > 0) {
      qBox.style.display = "flex";
      qCount.textContent = queue.length;
    } else {
      qBox.style.display = "none";
    }
  }

  async processQueue() {
    if (this.isSyncing || !navigator.onLine) return;
    
    const queue = await db.getAll("sync_queue");
    if (queue.length === 0) return;
    
    this.isSyncing = true;
    document.getElementById("sync-text").textContent = "Sinkronisasi data...";
    
    // Urutkan queue berdasarkan urutan penambahan (FIFO)
    queue.sort((a, b) => a.id - b.id);
    
    let processedCount = 0;
    
    for (const item of queue) {
      try {
        await callGASApi(item.action, item.data);
        // Hapus dari IndexedDB jika berhasil tersinkronisasi
        await db.deleteItem("sync_queue", item.id);
        processedCount++;
      } catch (err) {
        console.error("Gagal sinkronisasi antrean id:", item.id, err);
        // Jika error karena jaringan atau timeout, hentikan dulu proses sinkronisasi antrean
        if (err.message === "offline" || err.message.indexOf("Failed to fetch") > -1) {
          break;
        }
      }
    }
    
    this.isSyncing = false;
    this.updateQueueBadge();
    
    if (processedCount > 0) {
      showToast(`${processedCount} data berhasil disinkronisasi ke server.`);
      // Refresh data dari server
      await pullAllData();
    }
    
    updateOnlineStatus();
  }
}

const syncQueue = new SyncQueueManager();

// ==========================================
// UTILITIES (ID & DATE FORMATTING INDONESIA)
// ==========================================
function formatRupiah(amount) {
  return "Rp " + Number(amount || 0).toLocaleString("id-ID");
}

function formatTanggalIndo(dateStr) {
  if (!dateStr) return "-";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  
  const bulanIndo = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  
  const hari = parseInt(parts[2], 10);
  const bulan = parseInt(parts[1], 10) - 1;
  const tahun = parts[0];
  
  return `${hari} ${bulanIndo[bulan]} ${tahun}`;
}

function getDayNameIndo(dateStr) {
  const date = new Date(dateStr);
  const hariIndo = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return hariIndo[date.getDay()];
}

function getIndonesianRealtimeString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${date}`;
  return `${getDayNameIndo(dateStr)}, ${formatTanggalIndo(dateStr)}`;
}

// Convert File to Base64 Helper
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

// Toast Notification
function showToast(message) {
  const toast = document.getElementById("toast-notification");
  const msgEl = document.getElementById("toast-message");
  msgEl.textContent = message;
  toast.classList.add("show");
  
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

// Handle Online / Offline Event
function updateOnlineStatus() {
  const dot = document.getElementById("sync-dot");
  const text = document.getElementById("sync-text");
  
  if (navigator.onLine) {
    dot.className = "status-dot online";
    text.textContent = "Terhubung (Online)";
    syncQueue.processQueue();
  } else {
    dot.className = "status-dot offline";
    text.textContent = "Offline (Mode Lokal)";
  }
}

// ==========================================
// CORE DATA WORKFLOWS (PULL & CACHE)
// ==========================================
async function pullAllData() {
  if (!navigator.onLine) {
    // Muat dari Cache IndexedDB jika offline
    await loadFromLocalCache();
    return;
  }
  
  try {
    document.getElementById("sync-text").textContent = "Mengambil data dari Sheets...";
    
    // 1. Ambil Master Data
    const resMaster = await callGASApi("getMasterData");
    state.masterData = resMaster.data || {};
    await db.clearStore("master_data");
    // Masukkan ke IndexedDB
    for (const cat in state.masterData) {
      if (Array.isArray(state.masterData[cat])) {
        for (const item of state.masterData[cat]) {
          await db.putItem("master_data", { category: cat, name: item.name, value: item.value });
        }
      }
    }
    
    // 2. Ambil Pelanggan
    const resCust = await callGASApi("getCustomers");
    state.customers = Array.isArray(resCust.data) ? resCust.data : [];
    await db.clearStore("customers");
    for (const cust of state.customers) {
      if (cust && cust.id !== undefined && cust.id !== null) {
        cust.id = String(cust.id);
      }
      await db.putItem("customers", cust);
    }
    
    // 3. Ambil Transaksi Pelayanan
    const resTrx = await callGASApi("getTransactions", { startDate: "", endDate: "" });
    state.transactions = Array.isArray(resTrx.data) ? resTrx.data : [];
    await db.clearStore("transactions");
    for (const trx of state.transactions) {
      if (trx && trx.id !== undefined && trx.id !== null) {
        trx.id = String(trx.id);
      }
      await db.putItem("transactions", trx);
    }
    
    await renderAllViews();
    updateOnlineStatus();
  } catch (err) {
    console.error("Gagal sinkron data otomatis:", err);
    showToast("Gagal mengambil data dari Google Sheets. Menggunakan data lokal.");
    await loadFromLocalCache();
  }
}

async function loadFromLocalCache() {
  // Ambil data lokal
  const cachedMaster = await db.getAll("master_data");
  state.masterData = {
    JenisProduk: [],
    JenisLogam: [],
    BiayaDasar: [],
    BiayaCetak: [],
    MetodePembayaran: []
  };
  cachedMaster.forEach(item => {
    if (state.masterData[item.category]) {
      state.masterData[item.category].push({ name: item.name, value: item.value });
    }
  });
  
  state.customers = (await db.getAll("customers")) || [];
  state.customers.forEach(cust => {
    if (cust && cust.id !== undefined && cust.id !== null) {
      cust.id = String(cust.id);
    }
  });
  
  state.transactions = (await db.getAll("transactions")) || [];
  state.transactions.forEach(trx => {
    if (trx && trx.id !== undefined && trx.id !== null) {
      trx.id = String(trx.id);
    }
  });
  
  await renderAllViews();
}

async function renderAllViews() {
  renderDashboard();
  renderCustomersList();
  await renderTransactionsHistory();
  renderMasterValidationLists();
  populateDropdownSelectors();
}

// ==========================================
// SPA ROUTER
// ==========================================
function initRouter() {
  const navigate = () => {
    const hash = window.location.hash || "#dashboard";
    const panelId = "panel-" + hash.replace("#", "");
    
    document.querySelectorAll(".app-panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".menu-item").forEach(m => m.classList.remove("active"));
    
    const targetPanel = document.getElementById(panelId);
    const targetMenu = document.getElementById("nav-" + hash.replace("#", ""));
    
    if (targetPanel) {
      targetPanel.classList.add("active");
      if (targetMenu) targetMenu.classList.add("active");
      
      // Update page title
      const titles = {
        "#dashboard": "Dashboard Analitik",
        "#pelayanan": "Pelayanan & Riwayat Cek Kadar",
        "#pelanggan": "Pendaftaran Pelanggan",
        "#validasi": "Validasi Parameter Data"
      };
      document.getElementById("page-title").textContent = titles[hash] || "Dashboard";
      state.activeTab = hash.replace("#", "");
      
      // Render specific items
      if (hash === "#dashboard") {
        renderDashboard();
      }
    }
  };
  
  window.addEventListener("hashchange", navigate);
  // Initial navigate
  navigate();
}

// ==========================================
// 1. PANEL DASHBOARD ANALYTICS
// ==========================================
function renderDashboard() {
  const startInput = document.getElementById("dash-start-date");
  const endInput = document.getElementById("dash-end-date");
  
  // Set default filter tanggal jika belum diisi (Bulan berjalan)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  
  if (!startInput.value) {
    startInput.value = `${year}-${month}-01`;
  }
  if (!endInput.value) {
    // Dapatkan hari terakhir bulan berjalan
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    endInput.value = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
  }
  
  const startStr = startInput.value;
  const endStr = endInput.value;
  
  // Filter transaksi
  const filteredTrx = state.transactions.filter(t => {
    return t.tanggal >= startStr && t.tanggal <= endStr;
  });
  
  // Hitung Metrics
  let totalLayanan = filteredTrx.length;
  let totalPendapatan = 0;
  let totalBerat = 0;
  
  filteredTrx.forEach(t => {
    totalPendapatan += parseFloat(t.totalBiaya) || 0;
    if (t.items) {
      t.items.forEach(item => {
        totalBerat += parseFloat(item.berat) || 0;
      });
    }
  });
  
  document.getElementById("metric-total-layanan").textContent = totalLayanan;
  document.getElementById("metric-total-pendapatan").textContent = formatRupiah(totalPendapatan);
  document.getElementById("metric-total-berat").textContent = totalBerat.toFixed(2) + " gr";
  
  // Gambar SVG Chart
  drawDashboardChart(filteredTrx, startStr, endStr);
}

function drawDashboardChart(transactions, startStr, endStr) {
  const svg = document.getElementById("dashboard-svg-chart");
  svg.innerHTML = ""; // Bersihkan
  
  // Buat objek mapping total pendapatan per tanggal
  const dateTotals = {};
  
  // Buat array list tanggal dari startStr ke endStr secara timezone-safe
  const startParts = startStr.split("-");
  const start = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
  const endParts = endStr.split("-");
  const end = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  
  // Batasi agar label grafik tidak terlalu menumpuk
  const showLabelsStep = Math.ceil(daysDiff / 10) || 1;
  
  for (let i = 0; i < daysDiff; i++) {
    const d = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]) + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const date = String(d.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${date}`;
    dateTotals[dateStr] = 0;
  }
  
  // Isi data
  transactions.forEach(t => {
    if (dateTotals[t.tanggal] !== undefined) {
      dateTotals[t.tanggal] += parseFloat(t.totalBiaya) || 0;
    }
  });
  
  const dateList = Object.keys(dateTotals).sort();
  const maxRevenue = Math.max(...Object.values(dateTotals), 100000); // Minimal 100rb skala grafik
  
  // Chart dimensions
  const width = 800;
  const height = 250;
  const paddingLeft = 70;
  const paddingRight = 30;
  const paddingTop = 20;
  const paddingBottom = 40;
  
  const graphWidth = width - paddingLeft - paddingRight;
  const graphHeight = height - paddingTop - paddingBottom;
  
  // Render Y Axis Gridlines & Labels
  const gridLinesCount = 4;
  for (let i = 0; i <= gridLinesCount; i++) {
    const ratio = i / gridLinesCount;
    const y = paddingTop + graphHeight * (1 - ratio);
    const value = maxRevenue * ratio;
    
    // Line
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", paddingLeft);
    line.setAttribute("y1", y);
    line.setAttribute("x2", width - paddingRight);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "rgba(0,0,0,0.05)");
    line.setAttribute("stroke-dasharray", "4,4");
    svg.appendChild(line);
    
    // Text Label (Format Rupiah singkat, misal 1.5M, 500K)
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", paddingLeft - 10);
    text.setAttribute("y", y + 4);
    text.setAttribute("text-anchor", "end");
    text.setAttribute("fill", "#86868b");
    text.setAttribute("font-size", "10px");
    text.setAttribute("font-weight", "500");
    
    let labelVal = "";
    if (value >= 1000000) {
      labelVal = (value / 1000000).toFixed(1) + " Jt";
    } else if (value >= 1000) {
      labelVal = (value / 1000).toFixed(0) + " Rb";
    } else {
      labelVal = value.toString();
    }
    text.textContent = labelVal;
    svg.appendChild(text);
  }
  
  // Hitung Titik-titik Koordinat Data
  const points = [];
  dateList.forEach((date, idx) => {
    const xRatio = dateList.length > 1 ? idx / (dateList.length - 1) : 0.5;
    const x = paddingLeft + graphWidth * xRatio;
    
    const yRatio = dateTotals[date] / maxRevenue;
    const y = paddingTop + graphHeight * (1 - yRatio);
    
    points.push({ x, y, val: dateTotals[date], date });
  });
  
  // Render Area under the line (Gradient)
  if (points.length > 0) {
    // Linear Gradient
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    grad.setAttribute("id", "chart-grad");
    grad.setAttribute("x1", "0");
    grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0");
    grad.setAttribute("y2", "1");
    
    const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop1.setAttribute("offset", "0%");
    stop1.setAttribute("stop-color", "#007aff");
    stop1.setAttribute("stop-opacity", "0.25");
    grad.appendChild(stop1);
    
    const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop2.setAttribute("offset", "100%");
    stop2.setAttribute("stop-color", "#007aff");
    stop2.setAttribute("stop-opacity", "0.0");
    grad.appendChild(stop2);
    
    defs.appendChild(grad);
    svg.appendChild(defs);
    
    // Path Area
    let areaPathD = `M ${points[0].x} ${paddingTop + graphHeight} `;
    points.forEach(p => {
      areaPathD += `L ${p.x} ${p.y} `;
    });
    areaPathD += `L ${points[points.length - 1].x} ${paddingTop + graphHeight} Z`;
    
    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("d", areaPathD);
    area.setAttribute("fill", "url(#chart-grad)");
    svg.appendChild(area);
    
    // Draw Line (Smooth curve / Cardinal spline could be used, but straight segments with circles look clean and modern)
    let linePathD = `M ${points[0].x} ${points[0].y} `;
    for (let i = 1; i < points.length; i++) {
      linePathD += `L ${points[i].x} ${points[i].y} `;
    }
    
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", linePathD);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#007aff");
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);
    
    // Draw Dots with interactive Tooltip triggers
    points.forEach((p, idx) => {
      // Tampilkan label tanggal X axis secara periodik
      if (idx % showLabelsStep === 0 || idx === points.length - 1) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", p.x);
        text.setAttribute("y", height - paddingBottom + 18);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("fill", "#86868b");
        text.setAttribute("font-size", "9px");
        text.setAttribute("font-weight", "600");
        
        // Ambil Format Tanggal Singkat, misal: 03 Jul
        const tSplit = p.date.split("-");
        const monthShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        text.textContent = `${tSplit[2]} ${monthShort[parseInt(tSplit[1]) - 1]}`;
        svg.appendChild(text);
      }
      
      // Circle Dot
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", p.x);
      circle.setAttribute("cy", p.y);
      circle.setAttribute("r", "4");
      circle.setAttribute("fill", "#ffffff");
      circle.setAttribute("stroke", "#007aff");
      circle.setAttribute("stroke-width", "2");
      circle.style.cursor = "pointer";
      
      // Interactive tooltip title
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${formatTanggalIndo(p.date)}\nTotal: ${formatRupiah(p.val)}`;
      circle.appendChild(title);
      
      svg.appendChild(circle);
    });
  }
}

// ==========================================
// 2. PANEL PENDAFTARAN PELANGGAN
// ==========================================
function renderCustomersList() {
  const tbody = document.getElementById("body-pelanggan");
  tbody.innerHTML = "";
  
  const query = document.getElementById("search-customer").value.toLowerCase();
  
  const filtered = state.customers.filter(c => {
    if (!c) return false;
    const nameStr = c.name ? String(c.name).toLowerCase() : "";
    const phoneStr = c.phone ? String(c.phone) : "";
    return nameStr.includes(query) || phoneStr.includes(query);
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:#86868b;">Tidak ada data pelanggan.</td></tr>`;
    return;
  }
  
  filtered.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.id}</strong></td>
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td class="table-actions-cell">
        <button class="btn btn-secondary btn-sm" onclick="editCustomer('${c.id}')">Edit</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveCustomerForm() {
  const id = document.getElementById("customer-id").value;
  const name = document.getElementById("customer-name").value.trim();
  const phone = document.getElementById("customer-phone").value.trim();
  const address = document.getElementById("customer-address").value.trim();
  
  if (!name || !phone || !address) {
    showToast("Lengkapi semua isian form!");
    return;
  }
  
  const customerData = { id, name, address, phone };
  
  if (navigator.onLine) {
    try {
      showToast("Menyimpan ke server...");
      const result = await callGASApi("saveCustomer", customerData);
      
      if (!id) customerData.id = result.data.id;
      
      await db.putItem("customers", customerData);
      showToast("Pelanggan berhasil disimpan.");
    } catch (err) {
      console.error(err);
      await syncQueue.addToQueue("saveCustomer", customerData);
    }
  } else {
    // Mode Offline
    if (!id) {
      // Generate ID lokal sementara
      const tempId = "CUST-TEMP-" + Date.now();
      customerData.id = tempId;
    }
    await db.putItem("customers", customerData);
    await syncQueue.addToQueue("saveCustomer", customerData);
  }
  
  // Reset form
  resetCustomerForm();
  await pullAllData();
}

function editCustomer(id) {
  const customer = state.customers.find(c => String(c.id) === String(id));
  if (!customer) return;
  
  document.getElementById("form-pelanggan-title").textContent = "Edit Data Pelanggan";
  document.getElementById("customer-id").value = customer.id;
  document.getElementById("customer-name").value = customer.name;
  document.getElementById("customer-phone").value = customer.phone;
  document.getElementById("customer-address").value = customer.address;
  
  document.getElementById("btn-reset-pelanggan").style.display = "inline-flex";
}

function resetCustomerForm() {
  document.getElementById("form-pelanggan-title").textContent = "Pendaftaran Pelanggan Baru";
  document.getElementById("customer-id").value = "";
  document.getElementById("form-pelanggan").reset();
  document.getElementById("btn-reset-pelanggan").style.display = "none";
}

// ==========================================
// 3. PANEL VALIDASI DATA (MASTER DATA CONFIG)
// ==========================================
function renderMasterValidationLists() {
  const tbody = document.getElementById("body-validation-list");
  tbody.innerHTML = "";
  
  const currentCat = state.activeValidationCategory;
  const list = state.masterData[currentCat] || [];
  
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center" style="color:#86868b;">Tidak ada data opsi.</td></tr>`;
    return;
  }
  
  list.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.name}</td>
      <td>${item.value ? item.value : "-"}</td>
      <td class="table-actions-cell">
        <button class="btn btn-danger btn-sm" onclick="deleteMasterOption('${currentCat}', ${index})">Hapus</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function addMasterOption() {
  const category = document.getElementById("validasi-kategori").value;
  const name = document.getElementById("validasi-nama").value.trim();
  const value = document.getElementById("validasi-value").value.trim();
  
  if (!category || !name) {
    showToast("Isi kategori dan nama opsi!");
    return;
  }
  
  // Tambah ke array lokal
  if (!state.masterData[category]) {
    state.masterData[category] = [];
  }
  state.masterData[category].push({ name, value });
  
  // Cache ke IndexedDB
  await cacheMasterDataLocal();
  
  document.getElementById("form-validation-item").reset();
  showToast("Opsi ditambahkan secara lokal.");
  renderMasterValidationLists();
}

async function deleteMasterOption(category, index) {
  state.masterData[category].splice(index, 1);
  await cacheMasterDataLocal();
  showToast("Opsi dihapus.");
  renderMasterValidationLists();
  populateDropdownSelectors();
}

async function cacheMasterDataLocal() {
  await db.clearStore("master_data");
  for (const cat in state.masterData) {
    for (const item of state.masterData[cat]) {
      await db.putItem("master_data", { category: cat, name: item.name, value: item.value });
    }
  }
}

async function syncMasterDataToServer() {
  if (!navigator.onLine) {
    showToast("Harus dalam kondisi online untuk sync master data!");
    return;
  }
  
  try {
    showToast("Sinkronisasi Master Data ke Google Sheets...");
    
    // Susun payload
    const payload = [];
    for (const cat in state.masterData) {
      state.masterData[cat].forEach(item => {
        payload.push({ category: cat, name: item.name, value: item.value });
      });
    }
    
    await callGASApi("saveMasterData", payload);
    showToast("Master Data berhasil disimpan ke Google Sheets.");
  } catch (err) {
    console.error(err);
    showToast("Gagal menyimpan Master Data ke server: " + err.message);
  }
}

// Populate select options in various forms
function populateDropdownSelectors() {
  // 1. Pelanggan Dropdown
  const selectCust = document.getElementById("layanan-pelanggan-select");
  const currentValCust = selectCust.value;
  selectCust.innerHTML = `<option value="">-- Pilih Pelanggan --</option>`;
  state.customers.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.id})`;
    selectCust.appendChild(opt);
  });
  selectCust.value = currentValCust;
  
  // 2. Metode Pembayaran Dropdown
  const selectPay = document.getElementById("layanan-metode-bayar");
  const currentValPay = selectPay.value;
  selectPay.innerHTML = `<option value="">-- Metode Pembayaran --</option>`;
  (state.masterData.MetodePembayaran || []).forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    selectPay.appendChild(opt);
  });
  selectPay.value = currentValPay;
}

// ==========================================
// 4. CORE PELAYANAN & DYNAMIC ROWS
// ==========================================
let productRowCounter = 0;

// Auto-generate ID Layanan berikutnya secara offline-safe
function generateNextServiceId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  const prefix = `SRV-${year}${month}${date}`;
  
  let maxSeq = 1000;
  state.transactions.forEach(t => {
    if (t.id && t.id.startsWith(prefix)) {
      const parts = t.id.split("-");
      if (parts.length === 3) {
        const seq = parseInt(parts[2], 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  });
  
  // Tambahkan timestamp micro-sek untuk menghindari konflik ID saat rapid creation
  const microSuffix = Date.now().toString().slice(-4);
  return `${prefix}-${maxSeq + 1}${microSuffix}`;
}

// Toggle input persentase komposisi
window.toggleCompInput = function(chk, rowId) {
  const inputVal = chk.parentElement.querySelector(".row-comp-val");
  if (chk.checked) {
    inputVal.style.display = "inline-block";
    inputVal.required = true;
    inputVal.value = "100"; // default 100% jika dipilih
  } else {
    inputVal.style.display = "none";
    inputVal.required = false;
    inputVal.value = "";
  }
  updateCompositionString(rowId);
};

// Kompilasi komposisi bahan menjadi string (contoh: "Emas (75%) + Perak (25%)")
window.updateCompositionString = function(rowId) {
  const row = document.getElementById(`product-row-${rowId}`);
  if (!row) return;
  
  const compParts = [];
  row.querySelectorAll(".row-comp-check:checked").forEach(chk => {
    const inputVal = chk.parentElement.querySelector(".row-comp-val");
    const val = inputVal ? inputVal.value : "0";
    compParts.push(`${chk.value} (${val}%)`);
  });
  
  const compiled = compParts.join(" + ");
  document.getElementById(`composition-compiled-${rowId}`).value = compiled;
};

function addProductRow(data = null) {
  productRowCounter++;
  const container = document.getElementById("product-rows-container");
  
  const rowDiv = document.createElement("div");
  rowDiv.className = "product-item-row";
  rowDiv.id = `product-row-${productRowCounter}`;
  
  // Dapatkan ID Layanan aktif
  const idLayanan = document.getElementById("layanan-id-display").value || "SRV-TEMP";
  const numRows = container.querySelectorAll(".product-item-row").length + 1;
  const idSertifikat = data ? data.idSertifikat : `${idLayanan}-${("0" + numRows).slice(-2)}`;
  
  // Product options (dari Validasi Data: JenisProduk)
  let productOpts = `<option value="">-- Pilih Produk --</option>`;
  (state.masterData.JenisProduk || []).forEach(p => {
    productOpts += `<option value="${p.name}">${p.name}</option>`;
  });
  
  // Generate list bahan logam dari masterData.JenisLogam
  const baseMaterials = [];
  (state.masterData.JenisLogam || []).forEach(m => {
    const nameOnly = m.name.split(" ")[0]; // ambil kata depan logam, misal "Emas Murni" -> "Emas"
    if (nameOnly && !baseMaterials.includes(nameOnly)) {
      baseMaterials.push(nameOnly);
    }
  });
  if (baseMaterials.length === 0) {
    baseMaterials.push("Emas", "Perak", "Palladium", "Tembaga", "Zinc");
  }
  
  let compositionRows = "";
  baseMaterials.forEach(mat => {
    compositionRows += `
      <div class="comp-item-row" style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
        <input type="checkbox" class="row-comp-check" value="${mat}" onchange="toggleCompInput(this, ${productRowCounter})">
        <span style="font-size:11px; width:70px;">${mat}</span>
        <input type="number" class="row-comp-val" placeholder="%" style="width:50px; padding:2px 4px; font-size:10px; display:none;" min="0" max="100" step="0.1" oninput="updateCompositionString(${productRowCounter})">
      </div>
    `;
  });
  
  rowDiv.innerHTML = `
    <!-- Col 1: Detail Produk -->
    <div class="input-group">
      <label>Nama Produk &amp; Berat</label>
      <select class="row-product" required onchange="calculateRowCost(${productRowCounter})">
        ${productOpts}
      </select>
      <input type="number" step="0.01" class="row-weight" placeholder="Berat (gr)" required style="margin-top:6px;" oninput="calculateRowCost(${productRowCounter})">
    </div>
    
    <!-- Col 2: Komposisi (Multiple Select & Manual %) -->
    <div class="input-group">
      <label>Komposisi Kadar</label>
      <div class="checklist-container-row" style="max-height:100px;">
        ${compositionRows}
      </div>
      <input type="hidden" class="row-composition-compiled" id="composition-compiled-${productRowCounter}" value="">
    </div>
    
    <!-- Col 3: Upload Files & Preview -->
    <div class="input-group">
      <label>Media / Sertifikat</label>
      <input type="file" class="row-foto" accept="image/*" style="font-size:11px;" onchange="previewRowFile(this, ${productRowCounter}, 'foto')">
      <input type="file" class="row-sertifikat-ext" accept="image/*,application/pdf" style="font-size:11px; margin-top:6px;" onchange="previewRowFile(this, ${productRowCounter}, 'sert')">
      
      <div class="row-file-previews">
        <div class="file-preview-mini" id="preview-foto-${productRowCounter}"></div>
        <div class="file-preview-mini" id="preview-sert-${productRowCounter}"></div>
      </div>
    </div>
    
    <!-- Col 4: Ceklist Cetak & Biaya -->
    <div class="input-group" style="text-align: right;">
      <label style="display:flex; align-items:center; gap:4px; justify-content:flex-end;">
        <input type="checkbox" class="row-cetak-check" onchange="calculateRowCost(${productRowCounter})"> Cetak Fisik
      </label>
      <div class="row-subtotal-cost" id="cost-display-${productRowCounter}" style="font-weight:700; margin-top: 10px; font-size:13px; color:var(--accent-color);">
        Rp 0
      </div>
      <button type="button" class="btn btn-danger btn-sm" style="margin-top: 8px;" onclick="removeProductRow(${productRowCounter})">Hapus Baris</button>
    </div>
    
    <!-- Hidden / Temp Cache Base64 -->
    <input type="hidden" class="row-foto-base64" id="foto-base64-${productRowCounter}">
    <input type="hidden" class="row-foto-mime" id="foto-mime-${productRowCounter}">
    <input type="hidden" class="row-sert-base64" id="sert-base64-${productRowCounter}">
    <input type="hidden" class="row-sert-mime" id="sert-mime-${productRowCounter}">
    <input type="hidden" class="row-id-sertifikat" id="sertifikat-id-${productRowCounter}" value="${idSertifikat}">
    
    <div class="row-footer-calculator">
      <span style="font-size: 11px; color:#86868b;" id="cert-id-display-${productRowCounter}">ID Sertifikat: ${idSertifikat}</span>
    </div>
  `;
  
  container.appendChild(rowDiv);
  
  // Jika parameter data dikirim (untuk Edit Mode)
  if (data) {
    rowDiv.querySelector(".row-product").value = data.namaLogam;
    rowDiv.querySelector(".row-weight").value = data.berat;
    rowDiv.querySelector(".row-cetak-check").checked = data.cetakChecklist;
    document.getElementById(`sertifikat-id-${productRowCounter}`).value = data.idSertifikat;
    document.getElementById(`cert-id-display-${productRowCounter}`).textContent = `ID Sertifikat: ${data.idSertifikat}`;
    
    // Set checklist komposisi & persentase input
    const compParts = data.komposisi.split(" + ");
    compParts.forEach(part => {
      const match = part.match(/^([a-zA-Z\s]+)\(?([\d\.]+)%\)?/);
      if (match) {
        const material = match[1].trim();
        const percent = match[2];
        
        rowDiv.querySelectorAll(".row-comp-check").forEach(chk => {
          if (chk.value === material) {
            chk.checked = true;
            const inputVal = chk.parentElement.querySelector(".row-comp-val");
            if (inputVal) {
              inputVal.style.display = "inline-block";
              inputVal.value = percent;
            }
          }
        });
      }
    });
    
    document.getElementById(`composition-compiled-${productRowCounter}`).value = data.komposisi;
    
    // Render file preview jika url lama ada
    if (data.fotoUrl) {
      document.getElementById(`preview-foto-${productRowCounter}`).innerHTML = `<img src="${data.fotoUrl}" class="preview-thumbnail" onclick="window.open('${data.fotoUrl}')">`;
      rowDiv.dataset.fotoUrl = data.fotoUrl;
    }
    if (data.sertifikatUrl) {
      const isPdf = data.sertifikatUrl.toLowerCase().indexOf(".pdf") > -1;
      document.getElementById(`preview-sert-${productRowCounter}`).innerHTML = isPdf ? 
        `<div class="preview-doc-icon" onclick="window.open('${data.sertifikatUrl}')">PDF</div>` : 
        `<img src="${data.sertifikatUrl}" class="preview-thumbnail" onclick="window.open('${data.sertifikatUrl}')">`;
      rowDiv.dataset.sertifikatUrl = data.sertifikatUrl;
    }
  }
  
  calculateRowCost(productRowCounter);
}

function removeProductRow(id) {
  const row = document.getElementById(`product-row-${id}`);
  if (row) {
    row.remove();
  }
  calculateGrandTotal();
}

async function previewRowFile(input, rowId, type) {
  const file = input.files[0];
  if (!file) return;
  
  const base64 = await fileToBase64(file);
  const mime = file.type;
  
  if (type === "foto") {
    document.getElementById(`foto-base64-${rowId}`).value = base64;
    document.getElementById(`foto-mime-${rowId}`).value = mime;
    document.getElementById(`preview-foto-${rowId}`).innerHTML = `<img src="${base64}" class="preview-thumbnail">`;
  } else {
    document.getElementById(`sert-base64-${rowId}`).value = base64;
    document.getElementById(`sert-mime-${rowId}`).value = mime;
    
    const isPdf = file.type === "application/pdf";
    document.getElementById(`preview-sert-${rowId}`).innerHTML = isPdf ? 
      `<div class="preview-doc-icon">PDF</div>` : 
      `<img src="${base64}" class="preview-thumbnail">`;
  }
}

// Cost Calculator for Row
function calculateRowCost(rowId) {
  const row = document.getElementById(`product-row-${rowId}`);
  if (!row) return;
  
  // Dapatkan harga dasar layanan
  const basicFeeItem = state.masterData.BiayaDasar[0];
  const basicFee = basicFeeItem ? parseFloat(basicFeeItem.value) : 50000;
  
  // Dapatkan harga cetak sertifikat
  const printFeeItem = state.masterData.BiayaCetak[0];
  const printFee = printFeeItem ? parseFloat(printFeeItem.value) : 25000;
  
  const isPrintChecked = row.querySelector(".row-cetak-check").checked;
  const itemTotal = basicFee + (isPrintChecked ? printFee : 0);
  
  document.getElementById(`cost-display-${rowId}`).textContent = formatRupiah(itemTotal);
  document.getElementById(`cost-display-${rowId}`).dataset.value = itemTotal;
  
  calculateGrandTotal();
}

// Grand Total Calculator
function calculateGrandTotal() {
  let grandTotal = 0;
  document.querySelectorAll(".row-subtotal-cost").forEach(el => {
    grandTotal += parseFloat(el.dataset.value) || 0;
  });
  
  document.getElementById("layanan-grand-total").textContent = formatRupiah(grandTotal);
  document.getElementById("layanan-grand-total").dataset.value = grandTotal;
}

// Save Service Transaction Form
async function saveServiceTransaction() {
  const isEdit = !!document.getElementById("layanan-edit-id").value;
  const idLayanan = document.getElementById("layanan-id-display").value;
  const tanggal = document.getElementById("layanan-tanggal").value;
  const idPelanggan = document.getElementById("layanan-pelanggan-select").value;
  const metodePembayaran = document.getElementById("layanan-metode-bayar").value;
  
  if (!tanggal || !idPelanggan || !metodePembayaran) {
    showToast("Mohon lengkapi Identitas Layanan dan Metode Pembayaran!");
    return;
  }
  
  const customer = state.customers.find(c => String(c.id) === String(idPelanggan));
  const namaPelanggan = customer ? customer.name : "-";
  
  const rows = document.querySelectorAll(".product-item-row");
  if (rows.length === 0) {
    showToast("Tambahkan minimal 1 baris produk!");
    return;
  }
  
  const items = [];
  let isRowValid = true;
  
  rows.forEach(row => {
    const rowId = row.id.split("-").pop();
    const namaLogam = row.querySelector(".row-product").value;
    const berat = parseFloat(row.querySelector(".row-weight").value) || 0;
    const cetakChecklist = row.querySelector(".row-cetak-check").checked;
    const subtotal = parseFloat(document.getElementById(`cost-display-${rowId}`).dataset.value) || 0;
    const komposisi = document.getElementById(`composition-compiled-${rowId}`).value;
    
    if (!namaLogam || berat <= 0) {
      isRowValid = false;
      return;
    }
    
    items.push({
      idSertifikat: document.getElementById(`sertifikat-id-${rowId}`).value,
      namaLogam,
      berat,
      komposisi: komposisi || "Campuran Bebas",
      fotoUrl: row.dataset.fotoUrl || "",
      fotoBase64: document.getElementById(`foto-base64-${rowId}`).value,
      fotoMime: document.getElementById(`foto-mime-${rowId}`).value,
      sertifikatUrl: row.dataset.sertifikatUrl || "",
      sertifikatBase64: document.getElementById(`sert-base64-${rowId}`).value,
      sertifikatMime: document.getElementById(`sert-mime-${rowId}`).value,
      cetakChecklist,
      biayaLayanan: subtotal
    });
  });
  
  if (!isRowValid) {
    showToast("Isi Nama Produk dan Berat secara valid di setiap baris!");
    return;
  }
  
  const totalBiaya = parseFloat(document.getElementById("layanan-grand-total").dataset.value) || 0;
  
  // Bukti Transfer jika transfer non-cash
  const buktiBayarBase64 = document.getElementById("bukti-bayar-upload-group").style.display !== "none" ? 
    document.getElementById("bukti-bayar-preview").dataset.base64 : "";
  const buktiBayarMime = document.getElementById("bukti-bayar-upload-group").style.display !== "none" ? 
    document.getElementById("bukti-bayar-preview").dataset.mime : "";
  const buktiBayarUrl = document.getElementById("bukti-bayar-preview").dataset.url || "";
  
  const trxData = {
    id: idLayanan,
    tanggal,
    idPelanggan,
    namaPelanggan,
    totalBiaya,
    metodePembayaran,
    buktiBayarUrl,
    buktiBayarBase64,
    buktiBayarMime,
    items
  };
  
  showToast("Menyimpan transaksi...");
  
  if (navigator.onLine) {
    try {
      const result = await callGASApi("saveTransaction", trxData);
      
      // Jika add baru, set ID yang di-generate server
      if (!isEdit) {
        trxData.id = result.data.id;
        // Regenerate ID Sertifikat untuk cache lokal sesuai format server
        trxData.items.forEach((item, idx) => {
          item.idSertifikat = trxData.id + "-" + ("0" + (idx + 1)).slice(-2);
        });
      }
      
      // Cache ke local IndexedDB
      await db.putItem("transactions", trxData);
      showToast("Transaksi berhasil disimpan ke Google Sheets.");
    } catch (err) {
      console.error(err);
      await saveTransactionOffline(trxData, isEdit);
    }
  } else {
    await saveTransactionOffline(trxData, isEdit);
  }
  
  // Kembali ke riwayat & reload
  document.getElementById("form-transaksi-layanan").reset();
  document.getElementById("layanan-edit-id").value = "";
  document.getElementById("layanan-id-display").value = "[Otomatis]";
  document.getElementById("product-rows-container").innerHTML = "";
  document.getElementById("layanan-grand-total").textContent = "Rp 0";
  document.getElementById("layanan-grand-total").dataset.value = "0";
  document.getElementById("bukti-bayar-preview").innerHTML = "";
  delete document.getElementById("bukti-bayar-preview").dataset.base64;
  delete document.getElementById("bukti-bayar-preview").dataset.mime;
  delete document.getElementById("bukti-bayar-preview").dataset.url;
  document.getElementById("bukti-bayar-upload-group").style.display = "none";
  productRowCounter = 0;
  
  document.getElementById("sub-panel-layanan-form").style.display = "none";
  document.getElementById("sub-panel-layanan-riwayat").style.display = "block";
  document.getElementById("btn-seg-riwayat").classList.add("active");
  document.getElementById("btn-seg-input").classList.remove("active");
  
  await pullAllData();
}

async function saveTransactionOffline(trxData, isEdit) {
  if (!isEdit) {
    // Generate ID Layanan lokal
    trxData.id = "SRV-TEMP-" + Date.now();
    trxData.items.forEach((item, idx) => {
      item.idSertifikat = trxData.id + "-" + ("0" + (idx + 1)).slice(-2);
    });
  }
  
  await db.putItem("transactions", trxData);
  await syncQueue.addToQueue("saveTransaction", trxData);
}

// Edit Transaksi
function editTransaction(id) {
  const trx = state.transactions.find(t => String(t.id) === String(id));
  if (!trx) return;
  
  // Tampilkan panel input form
  document.getElementById("sub-panel-layanan-form").style.display = "block";
  document.getElementById("sub-panel-layanan-riwayat").style.display = "none";
  document.getElementById("btn-seg-input").classList.add("active");
  document.getElementById("btn-seg-riwayat").classList.remove("active");
  
  // Isi data header
  document.getElementById("layanan-edit-id").value = trx.id;
  document.getElementById("layanan-id-display").value = trx.id;
  document.getElementById("layanan-tanggal").value = trx.tanggal;
  document.getElementById("layanan-pelanggan-select").value = trx.idPelanggan;
  document.getElementById("layanan-metode-bayar").value = trx.metodePembayaran;
  
  // Kosongkan baris produk
  document.getElementById("product-rows-container").innerHTML = "";
  
  // Masukkan baris produk dari database
  trx.items.forEach(item => {
    addProductRow(item);
  });
  
  // Pembayaran bukti bayar
  const uploadGroup = document.getElementById("bukti-bayar-upload-group");
  const previewDiv = document.getElementById("bukti-bayar-preview");
  
  if (trx.metodePembayaran && trx.metodePembayaran.toLowerCase().indexOf("cash") === -1) {
    uploadGroup.style.display = "flex";
    if (trx.buktiBayarUrl) {
      previewDiv.innerHTML = `<img src="${trx.buktiBayarUrl}" class="preview-thumbnail" onclick="window.open('${trx.buktiBayarUrl}')">`;
      previewDiv.dataset.url = trx.buktiBayarUrl;
    } else {
      previewDiv.innerHTML = "";
    }
  } else {
    uploadGroup.style.display = "none";
    previewDiv.innerHTML = "";
  }
  
  calculateGrandTotal();
}

// Hapus Transaksi
async function confirmDeleteTransaction(id) {
  if (!confirm(`Apakah Anda yakin ingin menghapus transaksi ${id}?`)) return;
  
  showToast("Menghapus transaksi...");
  
  if (navigator.onLine) {
    try {
      await callGASApi("deleteTransaction", { id });
      await db.deleteItem("transactions", id);
      showToast("Transaksi berhasil dihapus dari Google Sheets.");
    } catch (err) {
      console.error(err);
      await queueDeleteOffline(id);
    }
  } else {
    await queueDeleteOffline(id);
  }
  
  await pullAllData();
}

async function queueDeleteOffline(id) {
  await db.deleteItem("transactions", id);
  await syncQueue.addToQueue("deleteTransaction", { id });
}

// ==========================================
// 5. RIWAYAT LAYANAN & PDF ACTIONS
// ==========================================
async function renderTransactionsHistory() {
  const tbody = document.getElementById("body-riwayat-layanan");
  tbody.innerHTML = "";
  
  const startFilter = document.getElementById("riwayat-start-date").value;
  const endFilter = document.getElementById("riwayat-end-date").value;
  const searchQuery = document.getElementById("riwayat-search-query").value.toLowerCase();
  
  // Ambil transaksi tertunda dari sync_queue untuk dirender instan
  const queue = await db.getAll("sync_queue");
  const pendingTrxs = [];
  queue.forEach(q => {
    if (q.action === "saveTransaction" && q.data) {
      pendingTrxs.push(q.data);
    }
  });
  
  // Gabungkan dengan transaksi synced
  const allTrxs = [...pendingTrxs];
  state.transactions.forEach(t => {
    if (t && t.id !== undefined && t.id !== null) {
      const tIdStr = String(t.id);
      if (!allTrxs.some(pt => pt && pt.id !== undefined && pt.id !== null && String(pt.id) === tIdStr)) {
        allTrxs.push(t);
      }
    }
  });
  
  const filtered = allTrxs.filter(t => {
    if (!t || t.id === undefined || t.id === null) return false; // Filter out empty or corrupt transactions
    const tIdStr = String(t.id).toLowerCase();
    const tTanggal = t.tanggal || "";
    
    const isDateMatch = (!startFilter || tTanggal >= startFilter) && (!endFilter || tTanggal <= endFilter);
    
    const namaPelangganStr = t.namaPelanggan ? String(t.namaPelanggan).toLowerCase() : "";
    const isSearchMatch = !searchQuery || 
                          tIdStr.includes(searchQuery) || 
                          namaPelangganStr.includes(searchQuery);
    return isDateMatch && isSearchMatch;
  }).sort((a, b) => {
    // Urutkan: transaksi terbaru di atas (menggunakan perbandingan string lokal)
    const aId = String(a.id);
    const bId = String(b.id);
    return bId.localeCompare(aId);
  });
  
  const emptyState = document.getElementById("empty-state-riwayat");
  if (filtered.length === 0) {
    emptyState.style.display = "flex";
    return;
  }
  emptyState.style.display = "none";
  
  filtered.forEach(t => {
    const tr = document.createElement("tr");
    
    // Status sinkronisasi badge
    let syncBadge = `<span class="badge badge-success">Synced</span>`;
    const tIdStr = String(t.id);
    const isPending = tIdStr.indexOf("TEMP") > -1 || queue.some(q => q.action === "saveTransaction" && q.data && q.data.id !== undefined && String(q.data.id) === tIdStr);
    if (isPending) {
      syncBadge = `<span class="badge badge-warning">Local</span>`;
    }
    
    tr.innerHTML = `
      <td><strong>${t.id}</strong></td>
      <td>${formatTanggalIndo(t.tanggal)}</td>
      <td>${t.namaPelanggan}</td>
      <td>${t.items ? t.items.map(i => `${i.namaLogam} (${i.berat}g)`).join("<br/>") : "-"}</td>
      <td style="font-weight:700;">${formatRupiah(t.totalBiaya)}</td>
      <td><span class="badge badge-info">${t.metodePembayaran}</span></td>
      <td>${syncBadge}</td>
      <td>
        <div class="table-actions-cell">
          <button class="btn btn-secondary btn-sm" onclick="printInvoicePDF('${t.id}')">Invoice</button>
          <button class="btn btn-secondary btn-sm" onclick="showCertificatesOption('${t.id}')">Sertifikat</button>
          <button class="btn btn-success btn-sm" onclick="sendWhatsAppInvoice('${t.id}')">WA</button>
          <button class="btn btn-secondary btn-sm" onclick="editTransaction('${t.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteTransaction('${t.id}')">Del</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Generate Invoice PDF
async function printInvoicePDF(id) {
  if (String(id).indexOf("TEMP") > -1) {
    showToast("Transaksi offline belum disinkronisasi ke Drive!");
    return;
  }
  
  if (!navigator.onLine) {
    showToast("Anda sedang offline, tidak bisa men-generate PDF.");
    return;
  }
  
  showToast("Menyiapkan PDF Invoice...");
  try {
    const result = await callGASApi("generateInvoicePDF", { id });
    window.open(result.pdfUrl, "_blank");
  } catch (err) {
    showToast("Gagal men-generate PDF: " + err.message);
  }
}

// Print Certificate PDF
async function showCertificatesOption(id) {
  const trx = state.transactions.find(t => String(t.id) === String(id));
  if (!trx) return;
  
  if (String(id).indexOf("TEMP") > -1) {
    showToast("Transaksi offline belum disinkronisasi ke Drive!");
    return;
  }
  
  if (!navigator.onLine) {
    showToast("Anda sedang offline, tidak bisa men-generate PDF.");
    return;
  }
  
  // Jika item lebih dari 1, minta user memilih sertifikat produk yang mana
  if (trx.items.length === 1) {
    printCertificatePDF(trx.items[0].idSertifikat);
  } else {
    // Generate simple alert multiple choices
    let optStr = "Transaksi ini memiliki beberapa produk. Pilih ID Sertifikat:\n";
    trx.items.forEach((item, idx) => {
      optStr += `${idx + 1}. ${item.idSertifikat} - ${item.namaLogam} (${item.berat} gr)\n`;
    });
    
    const choice = prompt(optStr + "\nMasukkan nomor pilihan Anda (contoh: 1):");
    const idx = parseInt(choice) - 1;
    if (trx.items[idx]) {
      printCertificatePDF(trx.items[idx].idSertifikat);
    } else {
      showToast("Pilihan dibatalkan / tidak valid.");
    }
  }
}

async function printCertificatePDF(idSertifikat) {
  showToast("Menyiapkan PDF Sertifikat...");
  try {
    const result = await callGASApi("generateCertificatePDF", { idSertifikat });
    window.open(result.pdfUrl, "_blank");
  } catch (err) {
    showToast("Gagal men-generate PDF: " + err.message);
  }
}

// Send Invoice WhatsApp Link
function sendWhatsAppInvoice(id) {
  const trx = state.transactions.find(t => String(t.id) === String(id));
  if (!trx) return;
  
  // Dapatkan nomor telpon pelanggan
  const customer = state.customers.find(c => String(c.id) === String(trx.idPelanggan));
  if (!customer || !customer.phone) {
    showToast("Nomor HP pelanggan tidak terdaftar!");
    return;
  }
  
  // Format nomor WA Indonesia (misal 08 menjadi 628)
  let rawPhone = String(customer.phone).replace(/[^0-9]/g, "");
  if (rawPhone.startsWith("0")) {
    rawPhone = "62" + rawPhone.slice(1);
  }
  
  // Pesan Template
  const itemsText = trx.items.map(item => `- ${item.namaLogam} (${item.berat} gr) : ${item.komposisi}`).join("%0A");
  
  const text = `Halo Kak *${customer.name}*, berikut ringkasan invoice untuk cek kadar logam Anda di *Sovia Jewelry*:%0A%0A` +
               `*ID Transaksi:* ${trx.id}%0A` +
               `*Tanggal:* ${formatTanggalIndo(trx.tanggal)}%0A` +
               `*Rincian Produk:*%0A${itemsText}%0A%0A` +
               `*Total Biaya:* *${formatRupiah(trx.totalBiaya)}*%0A` +
               `*Metode Pembayaran:* ${trx.metodePembayaran}%0A%0A` +
               `Terima kasih telah mempercayai layanan laboratorium kami.`;
               
  const waUrl = `https://wa.me/${rawPhone}?text=${text}`;
  window.open(waUrl, "_blank");
}

// ==========================================
// CONTEXTUAL EVENT LISTENERS & INITS
// ==========================================
function setupEventListeners() {
  // Pendaftaran Pelanggan Submit
  document.getElementById("form-pelanggan").addEventListener("submit", (e) => {
    e.preventDefault();
    saveCustomerForm();
  });
  document.getElementById("btn-reset-pelanggan").addEventListener("click", resetCustomerForm);
  
  // Search customer input
  document.getElementById("search-customer").addEventListener("input", renderCustomersList);
  
  // Master data category buttons
  document.querySelectorAll(".val-tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".val-tab-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      state.activeValidationCategory = e.target.dataset.cat;
      renderMasterValidationLists();
    });
  });
  
  // Add master option form
  document.getElementById("form-validation-item").addEventListener("submit", (e) => {
    e.preventDefault();
    addMasterOption();
  });
  
  // Sync master data button
  document.getElementById("btn-sync-master-data").addEventListener("click", syncMasterDataToServer);
  
  // Dashboard filter button
  document.getElementById("btn-filter-dashboard").addEventListener("click", renderDashboard);
  
  // Layanan Segmented switch
  document.getElementById("btn-seg-riwayat").addEventListener("click", (e) => {
    document.getElementById("sub-panel-layanan-form").style.display = "none";
    document.getElementById("sub-panel-layanan-riwayat").style.display = "block";
    e.target.classList.add("active");
    document.getElementById("btn-seg-input").classList.remove("active");
  });
  
  document.getElementById("btn-seg-input").addEventListener("click", (e) => {
    document.getElementById("sub-panel-layanan-form").style.display = "block";
    document.getElementById("sub-panel-layanan-riwayat").style.display = "none";
    e.target.classList.add("active");
    document.getElementById("btn-seg-riwayat").classList.remove("active");
    
    // Mulai form baru jika kosong
    if (!document.getElementById("layanan-edit-id").value) {
      document.getElementById("form-transaksi-layanan").reset();
      document.getElementById("product-rows-container").innerHTML = "";
      
      const now = new Date();
      document.getElementById("layanan-tanggal").value = now.toISOString().split("T")[0];
      
      // Auto-generate ID Layanan dan tampilkan di form
      const nextId = generateNextServiceId();
      document.getElementById("layanan-id-display").value = nextId;
      
      // Tambah baris awal
      addProductRow();
    }
  });
  
  // Add product row dynamic button
  document.getElementById("btn-add-item-row").addEventListener("click", () => addProductRow());
  
  // Cancel/Batal Layanan
  document.getElementById("btn-cancel-layanan").addEventListener("click", () => {
    if (confirm("Batalkan pengisian form? Seluruh perubahan belum disimpan.")) {
      document.getElementById("form-transaksi-layanan").reset();
      document.getElementById("layanan-edit-id").value = "";
      document.getElementById("layanan-id-display").value = "[Otomatis]";
      document.getElementById("sub-panel-layanan-form").style.display = "none";
      document.getElementById("sub-panel-layanan-riwayat").style.display = "block";
      document.getElementById("btn-seg-riwayat").classList.add("active");
      document.getElementById("btn-seg-input").classList.remove("active");
    }
  });
  
  // Save Transaction Submit
  document.getElementById("form-transaksi-layanan").addEventListener("submit", (e) => {
    e.preventDefault();
    saveServiceTransaction();
  });
  
  // Conditionally show Proof of Transfer
  document.getElementById("layanan-metode-bayar").addEventListener("change", (e) => {
    const val = e.target.value.toLowerCase();
    const group = document.getElementById("bukti-bayar-upload-group");
    if (val && val.indexOf("cash") === -1 && val.indexOf("tunai") === -1) {
      group.style.display = "flex";
    } else {
      group.style.display = "none";
      const preview = document.getElementById("bukti-bayar-preview");
      preview.innerHTML = "";
      delete preview.dataset.base64;
      delete preview.dataset.mime;
      delete preview.dataset.url;
    }
  });
  
  // Bukti bayar file upload preview handler
  document.getElementById("layanan-bukti-bayar").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const base64 = await fileToBase64(file);
    const preview = document.getElementById("bukti-bayar-preview");
    
    preview.dataset.base64 = base64;
    preview.dataset.mime = file.type;
    
    const isPdf = file.type === "application/pdf";
    preview.innerHTML = isPdf ? 
      `<div class="preview-doc-icon">PDF</div>` : 
      `<img src="${base64}" class="preview-thumbnail">`;
  });
  
  // Riwayat search and date filter
  document.getElementById("riwayat-search-query").addEventListener("input", renderTransactionsHistory);
  document.getElementById("riwayat-start-date").addEventListener("input", renderTransactionsHistory);
  document.getElementById("riwayat-end-date").addEventListener("input", renderTransactionsHistory);
  document.getElementById("btn-reset-filter-riwayat").addEventListener("click", () => {
    document.getElementById("riwayat-start-date").value = "";
    document.getElementById("riwayat-end-date").value = "";
    document.getElementById("riwayat-search-query").value = "";
    renderTransactionsHistory();
  });
  
  // Master parameter Category select behavior to show/hide value field
  document.getElementById("validasi-kategori").addEventListener("change", (e) => {
    const cat = e.target.value;
    const valGroup = document.getElementById("validasi-value-group");
    const valInput = document.getElementById("validasi-value");
    
    if (cat === "JenisLogam" || cat === "BiayaDasar" || cat === "BiayaCetak") {
      valGroup.style.display = "flex";
      valInput.required = true;
      if (cat === "JenisLogam") {
        valInput.placeholder = "Persentase logam, contoh: 92.5";
      } else {
        valInput.placeholder = "Besaran nominal rupiah, contoh: 50000";
      }
    } else {
      valGroup.style.display = "none";
      valInput.required = false;
      valInput.value = "";
    }
  });

  // Listener status jaringan
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
}

// Inisialisasi awal
async function initApp() {
  // 1. Tampilkan tanggal realtime Indonesia di content header
  document.getElementById("current-date-indo").textContent = getIndonesianRealtimeString();
  
  // 2. Inisialisasi IndexedDB
  await db.init();
  
  // 3. Set router tab SPA
  initRouter();
  
  // 4. Setup event triggers
  setupEventListeners();
  
  // 5. Muat data awal
  await pullAllData();
  
  // 6. Jalankan pendaftaran Service Worker
  registerServiceWorker();
}

// Service Worker Registration
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(reg => {
          console.log("Service Worker berhasil didaftarkan dengan scope:", reg.scope);
        })
        .catch(err => {
          console.error("Gagal mendaftarkan Service Worker:", err);
        });
    });
  }
}

// Jalankan sistem
window.onload = initApp;
