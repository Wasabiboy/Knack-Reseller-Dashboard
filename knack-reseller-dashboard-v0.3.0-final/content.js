// content.js — Knack Reseller Dashboard v0.3.0
(function() {
  const STATE = { lastProcessedAt: 0 };

  const DEFAULTS = {
    currency: "NZD",
    currencySymbol: "$",
    includeGST: false,
    gstRate: 0.15,
    roundTo: 2,
    tier: {
      baseLimit: 50000,
      basePrice: 250,
      stepSize: 25000,
      stepPrice: 100,
      zeroIsFree: true
    },
    customerOverrides: [],
    knackLimits: {
      maxRecords: 2500000,
      maxStorageGB: 920,
      monthlyRateUSD: 2280,
      exchangeRateUSDtoNZD: 1.65 // Approximate rate, user can adjust in options
    }
  };

  function loadSettings() {
    return new Promise(resolve => chrome.storage.sync.get(DEFAULTS, resolve));
  }

  // ===== Pricing logic =====
  function matchOverride(name, overrides) {
    for (const ov of overrides || []) {
      if (typeof ov.match === "string") {
        if (name.trim().toLowerCase() === ov.match.trim().toLowerCase()) return ov;
      } else {
        const src = String(ov.match || "");
        const m = src.match(/^\/(.*)\/(\w+)?$/);
        if (m) {
          try { if (new RegExp(m[1], m[2] || "").test(name)) return ov; } catch {}
        }
      }
    }
    return null;
  }
  function parseIntSafe(text) {
    const m = String(text || "").replace(/[,\s]/g, "").match(/-?\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function parseStorageGB(text) {
    const cleanText = String(text || "").replace(/[,\s]/g, "").toLowerCase();
    const match = cleanText.match(/([\d.]+)\s*(gb|mb|kb)?/);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2] || 'gb';
    
    switch(unit) {
      case 'kb': return value / (1024 * 1024);
      case 'mb': return value / 1024;
      case 'gb': return value;
      default: return value;
    }
  }
  function formatCurrency(val, symbol, roundTo) {
    const n = (typeof val === "number" ? val : 0);
    return symbol + n.toFixed(roundTo);
  }
  function tieredCost(records, tier) {
    const r = Math.max(0, records|0);
    if (r === 0 && tier.zeroIsFree) return 0;
    if (r <= tier.baseLimit) return r > 0 ? tier.basePrice : 0;
    const extra = r - tier.baseLimit;
    const steps = Math.ceil(extra / tier.stepSize);
    return tier.basePrice + steps * tier.stepPrice;
  }
  function computeCost(name, records, settings) {
    const ov = matchOverride(name, settings.customerOverrides);
    const tier = { ...settings.tier, ...(ov?.tier || {}) };
    let cost = tieredCost(records, tier);
    if (settings.includeGST) cost *= (1 + (settings.gstRate || 0));
    return cost;
  }

  // ===== DOM helpers for Knack's div-table =====
  function findAppsTable() {
    return document.querySelector('[data-testid="apps-table"]');
  }
  function findHeaderRow(tableRoot) {
    const rows = Array.from(tableRoot.querySelectorAll('.table-row'));
    return rows.find(r => Array.from(r.querySelectorAll('.table-cell')).some(c => c.textContent.trim().toLowerCase() === 'records'));
  }
  function ensureCostHeader(headerRow) {
    if (!headerRow) return false;
    const has = Array.from(headerRow.querySelectorAll('.table-cell')).some(c => c.dataset.kccCostHeader === '1' || c.textContent.trim().toLowerCase() === 'cost');
    if (has) return true;
    const th = document.createElement('div');
    th.className = 'table-cell p-2 border-b border-subtle w-[6ch] text-right';
    th.textContent = 'Cost';
    th.dataset.kccCostHeader = '1';
    headerRow.appendChild(th);
    return true;
  }
  function ensureCostCell(row, text) {
    let cell = row.querySelector('.kcc-cost-cell');
    if (!cell) {
      cell = document.createElement('div');
      cell.className = 'text-right table-cell px-2 align-middle group-hover:bg-subtle kcc-cost-cell';
      row.appendChild(cell);
    }
    cell.textContent = text;
  }

  // ===== Exporters =====
  function exportCSV() {
    const tableRoot = findAppsTable();
    if (!tableRoot) return alert("No Knack apps table found.");
    const headerRow = findHeaderRow(tableRoot);
    const headerCells = Array.from(headerRow?.querySelectorAll('.table-cell') || []).map(c => c.textContent.trim()).concat(['Cost']);
    const rows = Array.from(tableRoot.querySelectorAll('[data-testid="apps-table-row"]'));
    
    const lines = [headerCells.join(',')];
    let totalCost = 0;
    let totalRecords = 0;
    
    for (const r of rows) {
      const name = (r.querySelector('[data-testid="apps-table-app-name-field"]')?.textContent || '').trim();
      const records = (r.querySelector('[data-testid="apps-table-app-records-count"]')?.textContent || '').trim();
      const storage = (r.querySelector('[data-testid="apps-table-app-storage-count"]')?.textContent || '').trim();
      const tasks = (r.querySelector('[data-testid="apps-table-app-tasks-count"]')?.textContent || '').trim();
      const cost = (r.querySelector('.kcc-cost-cell')?.textContent || '').trim();
      const fields = [name, records, storage, tasks, '', '', cost];
      const escaped = fields.map(v => {
        const t = String(v).replace(/"/g, '""');
        return /[",\n]/.test(t) ? `"${t}"` : t;
      });
      lines.push(escaped.join(','));
      
      // Calculate totals for export
      totalRecords += parseIntSafe(records);
      totalCost += parseFloat(cost.replace(/[^0-9.-]/g, '')) || 0;
    }
    
    // Add total row
    const totalFields = ['TOTAL', totalRecords.toLocaleString(), '', '', '', '', `$${totalCost.toFixed(2)}`];
    const escapedTotalFields = totalFields.map(v => {
      const t = String(v).replace(/"/g, '""');
      return /[",\n]/.test(t) ? `"${t}"` : t;
    });
    lines.push(escapedTotalFields.join(','));
    
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'knack-apps-with-cost.csv'; a.click();
    URL.revokeObjectURL(url);
  }
  function exportExcel() {
    const tableRoot = findAppsTable();
    if (!tableRoot) return alert("No Knack apps table found.");
    const headerRow = findHeaderRow(tableRoot);
    const headerCells = Array.from(headerRow?.querySelectorAll('.table-cell') || []).map(c => c.textContent.trim()).concat(['Cost']);
    const rows = Array.from(tableRoot.querySelectorAll('[data-testid="apps-table-row"]'));
    
    let html = '<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>';
    for (const h of headerCells) html += '<th>' + h.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</th>';
    html += '</tr></thead><tbody>';
    
    let totalCost = 0;
    let totalRecords = 0;
    
    for (const r of rows) {
      const tds = [];
      const name = (r.querySelector('[data-testid="apps-table-app-name-field"]')?.textContent || '').trim();
      const records = (r.querySelector('[data-testid="apps-table-app-records-count"]')?.textContent || '').trim();
      const storage = (r.querySelector('[data-testid="apps-table-app-storage-count"]')?.textContent || '').trim();
      const tasks = (r.querySelector('[data-testid="apps-table-app-tasks-count"]')?.textContent || '').trim();
      const cost = (r.querySelector('.kcc-cost-cell')?.textContent || '').trim();
      
      tds.push(name);
      tds.push(records);
      tds.push(storage);
      tds.push(tasks);
      tds.push(''); // Description
      tds.push(''); // Actions
      tds.push(cost);
      html += '<tr>' + tds.map(v => '<td>' + String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</td>').join('') + '</tr>';
      
      // Calculate totals for export
      totalRecords += parseIntSafe(records);
      totalCost += parseFloat(cost.replace(/[^0-9.-]/g, '')) || 0;
    }
    
    // Add total row
    const totalTds = ['TOTAL', totalRecords.toLocaleString(), '', '', '', '', `$${totalCost.toFixed(2)}`];
    html += '<tr style="font-weight:bold;background-color:#f0f0f0;">' + 
            totalTds.map(v => '<td>' + String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</td>').join('') + '</tr>';
    
    html += '</tbody></table></body></html>';
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'knack-apps-with-cost.xls'; a.click();
    URL.revokeObjectURL(url);
  }

  // ===== Toolbar (clean UI) =====
  function makeToolbar() {
    if (document.getElementById("knack-cost-toolbar")) return;
    const bar = document.createElement("div");
    bar.id = "knack-cost-toolbar";
    bar.innerHTML = `
      <div id="kcc-drag-handle">⋮⋮ Knack Reseller Dashboard</div>
      <div id="kcc-totals" style="font-size: 12px; color: #e6edf3; margin: 0 8px; display: flex; gap: 12px; white-space: nowrap;">
        <span id="kcc-total-records">Records: -</span>
        <span id="kcc-total-storage">Storage: -</span>
        <span id="kcc-total-cost">Cost: -</span>
      </div>
      <button id="kcc-export" class="secondary">Export CSV</button>
      <button id="kcc-export-xls" class="secondary">Export Excel</button>
      <button id="kcc-analytics" class="primary">Analytics</button>
      <button id="kcc-open-options" class="primary">Options</button>
    `;
    document.body.appendChild(bar);
    
    // Make toolbar draggable
    makeDraggable(bar);
    
    bar.querySelector("#kcc-export").addEventListener("click", () => exportCSV());
    bar.querySelector("#kcc-export-xls").addEventListener("click", () => exportExcel());
    bar.querySelector("#kcc-analytics").addEventListener("click", () => showAnalyticsPanel());
    bar.querySelector("#kcc-open-options").addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: "openOptions" });
    });
  }

  // ===== Update toolbar totals =====
  function updateToolbarTotals(totalRecords, totalStorage, totalCost, settings) {
    const recordsEl = document.getElementById('kcc-total-records');
    const storageEl = document.getElementById('kcc-total-storage');
    const costEl = document.getElementById('kcc-total-cost');
    
    if (recordsEl) {
      recordsEl.textContent = `Records: ${totalRecords.toLocaleString()}`;
    }
    
    if (storageEl) {
      storageEl.textContent = `Storage: ${totalStorage.toFixed(1)}GB`;
    }
    
    if (costEl) {
      costEl.textContent = `Cost: ${formatCurrency(totalCost, settings.currencySymbol || '$', settings.roundTo ?? 2)}`;
    }
  }

  // ===== Analytics Panel =====
  function showAnalyticsPanel() {
    // Remove existing panel if present
    const existing = document.getElementById('kcc-analytics-panel');
    if (existing) {
      existing.remove();
      return;
    }

    const tableRoot = findAppsTable();
    if (!tableRoot) return;

    // Calculate current usage
    const rows = Array.from(tableRoot.querySelectorAll('[data-testid="apps-table-row"]'));
    let totalRecords = 0;
    let totalStorage = 0;
    let totalCost = 0;

    loadSettings().then(settings => {
      rows.forEach(r => {
        const name = (r.querySelector('[data-testid="apps-table-app-name-field"]')?.textContent || '').trim();
        const recTxt = (r.querySelector('[data-testid="apps-table-app-records-count"]')?.textContent || '').trim();
        const storageTxt = (r.querySelector('[data-testid="apps-table-app-storage-count"]')?.textContent || '').trim();
        const records = parseIntSafe(recTxt);
        const storage = parseStorageGB(storageTxt);
        const cost = computeCost(name, records, settings);
        
        totalRecords += records;
        totalStorage += storage;
        totalCost += cost;
      });

      // Create analytics panel
      const panel = document.createElement('div');
      panel.id = 'kcc-analytics-panel';
      panel.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 16px 32px rgba(0,0,0,0.4);
        z-index: 10001;
        font-family: system-ui, -apple-system, sans-serif;
        color: #e6edf3;
        min-width: 500px;
        max-width: 600px;
      `;

      const limits = settings.knackLimits;
      const recordsUsedPct = (totalRecords / limits.maxRecords) * 100;
      const storageUsedPct = (totalStorage / limits.maxStorageGB) * 100;
      const monthlyCostNZD = limits.monthlyRateUSD * limits.exchangeRateUSDtoNZD;
      const marginNZD = totalCost - monthlyCostNZD;
      const marginPct = totalCost > 0 ? ((marginNZD / totalCost) * 100) : 0;

      panel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0; color: #f0f6fc; font-size: 20px;">📊 Knack Usage Analytics</h2>
          <button id="kcc-close-analytics" style="background: none; border: none; color: #8b949e; font-size: 18px; cursor: pointer;">✕</button>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
          <!-- Records Usage -->
          <div style="background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #79c0ff; font-weight: 600;">📝 Records</span>
              <span style="color: ${recordsUsedPct > 80 ? '#f85149' : '#2ea043'};">${recordsUsedPct.toFixed(1)}%</span>
            </div>
            <div style="background: #0d1117; border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 8px;">
              <div style="background: ${recordsUsedPct > 80 ? '#f85149' : '#2ea043'}; height: 100%; width: ${Math.min(recordsUsedPct, 100)}%; transition: width 0.3s;"></div>
            </div>
            <div style="font-size: 12px; color: #8b949e;">
              ${totalRecords.toLocaleString()} / ${limits.maxRecords.toLocaleString()}<br>
              <span style="color: #2ea043;">${(limits.maxRecords - totalRecords).toLocaleString()} remaining</span>
            </div>
          </div>

          <!-- Storage Usage -->
          <div style="background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #a5a5a5; font-weight: 600;">💾 Storage</span>
              <span style="color: ${storageUsedPct > 80 ? '#f85149' : '#2ea043'};">${storageUsedPct.toFixed(1)}%</span>
            </div>
            <div style="background: #0d1117; border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 8px;">
              <div style="background: ${storageUsedPct > 80 ? '#f85149' : '#2ea043'}; height: 100%; width: ${Math.min(storageUsedPct, 100)}%; transition: width 0.3s;"></div>
            </div>
            <div style="font-size: 12px; color: #8b949e;">
              ${totalStorage.toFixed(1)}GB / ${limits.maxStorageGB}GB<br>
              <span style="color: #2ea043;">${(limits.maxStorageGB - totalStorage).toFixed(1)}GB remaining</span>
            </div>
          </div>
        </div>

        <!-- Financial Summary -->
        <div style="background: #0f1419; border: 1px solid #21262d; border-radius: 8px; padding: 20px;">
          <h3 style="margin: 0 0 16px 0; color: #f0f6fc; display: flex; align-items: center; gap: 8px;">
            💰 Financial Summary
          </h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; text-align: center;">
            <div>
              <div style="font-size: 24px; font-weight: bold; color: #ffa657;">$${limits.monthlyRateUSD}</div>
              <div style="font-size: 12px; color: #8b949e;">Monthly Rate (USD)</div>
            </div>
            <div>
              <div style="font-size: 24px; font-weight: bold; color: #79c0ff;">$${totalCost.toFixed(0)}</div>
              <div style="font-size: 12px; color: #8b949e;">Customer Revenue (NZD)</div>
            </div>
            <div>
              <div style="font-size: 24px; font-weight: bold; color: ${marginNZD > 0 ? '#2ea043' : '#f85149'};">$${marginNZD.toFixed(0)}</div>
              <div style="font-size: 12px; color: #8b949e;">Profit Margin (${marginPct.toFixed(1)}%)</div>
            </div>
          </div>
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #21262d; font-size: 12px; color: #8b949e; text-align: center;">
            Monthly Cost: $${limits.monthlyRateUSD} USD × ${limits.exchangeRateUSDtoNZD} = $${monthlyCostNZD.toFixed(0)} NZD
          </div>
        </div>
      `;

      document.body.appendChild(panel);

      // Close button functionality
      panel.querySelector('#kcc-close-analytics').addEventListener('click', () => {
        panel.remove();
      });

      // Click outside to close
      panel.addEventListener('click', (e) => {
        if (e.target === panel) {
          panel.remove();
        }
      });
    });
  }

  // ===== Draggable functionality =====
  function makeDraggable(element) {
    const handle = element.querySelector('#kcc-drag-handle');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    // Set initial position and styling
    element.style.position = 'fixed';
    element.style.bottom = '20px';
    element.style.right = '20px';
    element.style.zIndex = '10000';
    element.style.background = '#1a1d23';
    element.style.border = '1px solid #2d333b';
    element.style.borderRadius = '8px';
    element.style.padding = '12px';
    element.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    element.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    element.style.fontSize = '14px';
    element.style.color = '#e6edf3';
    element.style.display = 'flex';
    element.style.alignItems = 'center';
    element.style.gap = '8px';
    element.style.minWidth = 'max-content';
    element.style.width = 'auto';

    // Style the drag handle
    handle.style.cursor = 'grab';
    handle.style.userSelect = 'none';
    handle.style.padding = '4px 8px';
    handle.style.borderRadius = '4px';
    handle.style.background = '#2d333b';
    handle.style.fontWeight = '600';
    
    // Style buttons
    const buttons = element.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.style.padding = '6px 10px';
      btn.style.borderRadius = '4px';
      btn.style.border = 'none';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '12px';
      btn.style.fontWeight = '500';
    });

    const primaryBtn = element.querySelector('button:not(.secondary)');
    if (primaryBtn) {
      primaryBtn.style.background = '#0969da';
      primaryBtn.style.color = 'white';
    }

    const secondaryBtns = element.querySelectorAll('button.secondary');
    secondaryBtns.forEach(btn => {
      btn.style.background = '#21262d';
      btn.style.color = '#e6edf3';
      btn.style.border = '1px solid #30363d';
    });


    function dragStart(e) {
      if (e.type === "touchstart") {
        initialX = e.touches[0].clientX - xOffset;
        initialY = e.touches[0].clientY - yOffset;
      } else {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
      }

      if (e.target === handle) {
        isDragging = true;
        handle.style.cursor = 'grabbing';
      }
    }

    function dragEnd() {
      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      handle.style.cursor = 'grab';
    }

    function drag(e) {
      if (isDragging) {
        e.preventDefault();
        
        if (e.type === "touchmove") {
          currentX = e.touches[0].clientX - initialX;
          currentY = e.touches[0].clientY - initialY;
        } else {
          currentX = e.clientX - initialX;
          currentY = e.clientY - initialY;
        }

        xOffset = currentX;
        yOffset = currentY;

        // Constrain to viewport
        const rect = element.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;
        
        currentX = Math.max(0, Math.min(currentX, maxX));
        currentY = Math.max(0, Math.min(currentY, maxY));

        element.style.transform = `translate(${currentX}px, ${currentY}px)`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
        element.style.left = '0px';
        element.style.top = '0px';
      }
    }

    handle.addEventListener("mousedown", dragStart);
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", dragEnd);

    handle.addEventListener("touchstart", dragStart);
    document.addEventListener("touchmove", drag);
    document.addEventListener("touchend", dragEnd);
  }

  // ===== Sorting =====
  function sortByRecords(tableRoot, descending = true) {
    const rows = Array.from(tableRoot.querySelectorAll('[data-testid="apps-table-row"]'));
    const getRec = r => {
      const t = (r.querySelector('[data-testid="apps-table-app-records-count"]')?.textContent || '').trim();
      const m = t.replace(/[,\s]/g, '').match(/-?\d+/);
      return m ? parseInt(m[0], 10) : 0;
    };
    rows.sort((a,b) => {
      const da = getRec(a), db = getRec(b);
      return descending ? (db - da) : (da - db);
    });
    for (const r of rows) tableRoot.appendChild(r);
  }


  // ===== Main processing =====
  async function processAll(settings) {
    const tableRoot = findAppsTable();
    if (!tableRoot) return;
    const headerRow = findHeaderRow(tableRoot);
    ensureCostHeader(headerRow);

    const rows = Array.from(tableRoot.querySelectorAll('[data-testid="apps-table-row"]'));
    let totalCost = 0;
    let totalRecords = 0;
    let totalStorage = 0;

    for (const r of rows) {
      const name = (r.querySelector('[data-testid="apps-table-app-name-field"]')?.textContent || '').trim();
      const recTxt = (r.querySelector('[data-testid="apps-table-app-records-count"]')?.textContent || '').trim();
      const storageTxt = (r.querySelector('[data-testid="apps-table-app-storage-count"]')?.textContent || '').trim();
      const records = parseIntSafe(recTxt);
      const storage = parseStorageGB(storageTxt);
      const cost = computeCost(name, records, settings);
      totalCost += cost;
      totalRecords += records;
      totalStorage += storage;
      ensureCostCell(r, formatCurrency(cost, settings.currencySymbol || '$', settings.roundTo ?? 2));
    }

    // Update toolbar totals
    updateToolbarTotals(totalRecords, totalStorage, totalCost, settings);
    
    sortByRecords(tableRoot, true);
  }

  async function init() {
    const settings = await loadSettings();
    makeToolbar();
    const attempt = () => processAll(settings);
    attempt();
    const obs = new MutationObserver(() => {
      const now = Date.now();
      if (now - STATE.lastProcessedAt > 800) {
        STATE.lastProcessedAt = now;
        attempt();
      }
    });
    obs.observe(document.documentElement, { subtree: true, childList: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
