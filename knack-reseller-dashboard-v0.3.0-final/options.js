const DEFAULTS = {
  currency: "NZD",
  currencySymbol: "$",
  includeGST: false,
  gstRate: 0.15,
  roundTo: 2,
  tier: { baseLimit: 50000, basePrice: 250, stepSize: 25000, stepPrice: 100, zeroIsFree: true },
  customerOverrides: [],
  knackLimits: {
    maxRecords: 2500000,
    maxStorageGB: 920,
    monthlyRateUSD: 2280,
    exchangeRateUSDtoNZD: 1.65
  }
};

function load() {
  chrome.storage.sync.get(DEFAULTS, (data) => {
    const fields = ["currencySymbol","currency","includeGST","gstRate","roundTo"];
    for (const k of fields) {
      const el = document.getElementById(k);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = Boolean(data[k]);
      else el.value = data[k];
    }
    
    // Knack limits
    const limits = data.knackLimits || DEFAULTS.knackLimits;
    document.getElementById("monthlyRateUSD").value = limits.monthlyRateUSD;
    document.getElementById("exchangeRate").value = limits.exchangeRateUSDtoNZD;
    document.getElementById("maxRecords").value = limits.maxRecords;
    document.getElementById("maxStorageGB").value = limits.maxStorageGB;
    
    // Tier settings
    document.getElementById("baseLimit").value = data.tier.baseLimit;
    document.getElementById("basePrice").value = data.tier.basePrice;
    document.getElementById("stepSize").value = data.tier.stepSize;
    document.getElementById("stepPrice").value = data.tier.stepPrice;
    document.getElementById("zeroIsFree").checked = Boolean(data.tier.zeroIsFree);
    document.getElementById("customerOverrides").value = JSON.stringify(data.customerOverrides || [], null, 2);
  });
}

function save() {
  try {
    const cfg = {
      currencySymbol: document.getElementById("currencySymbol").value || "$",
      currency: document.getElementById("currency").value || "NZD",
      includeGST: document.getElementById("includeGST").checked,
      gstRate: Number(document.getElementById("gstRate").value) || 0,
      roundTo: Number(document.getElementById("roundTo").value) || 2,
      knackLimits: {
        monthlyRateUSD: Number(document.getElementById("monthlyRateUSD").value) || 2280,
        exchangeRateUSDtoNZD: Number(document.getElementById("exchangeRate").value) || 1.65,
        maxRecords: Number(document.getElementById("maxRecords").value) || 2500000,
        maxStorageGB: Number(document.getElementById("maxStorageGB").value) || 920
      },
      tier: {
        baseLimit: Number(document.getElementById("baseLimit").value) || 0,
        basePrice: Number(document.getElementById("basePrice").value) || 0,
        stepSize: Number(document.getElementById("stepSize").value) || 1,
        stepPrice: Number(document.getElementById("stepPrice").value) || 0,
        zeroIsFree: document.getElementById("zeroIsFree").checked
      },
      customerOverrides: JSON.parse(document.getElementById("customerOverrides").value || "[]")
    };
    chrome.storage.sync.set(cfg, () => alert("Saved."));
  } catch (e) {
    alert("Invalid JSON in overrides: " + e.message);
  }
}

function resetVals() {
  chrome.storage.sync.set(DEFAULTS, load);
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("reset").addEventListener("click", resetVals);
document.addEventListener("DOMContentLoaded", load);
