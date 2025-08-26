# Knack Cost Calculator (Tiered, MV3)

Injects a **Cost** column into tables on `https://dashboard.knack.com/apps*` using tiered pricing:

- First **50,000** records => **$250**
- Every **25,000** records (or part) after => **+$100**
- **0** records can be **$0** (toggleable)

## Install (Unpacked)
1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open **Options** to confirm the tier values
4. Visit `https://dashboard.knack.com/apps` → toolbar → **Recalculate**

## Per-customer overrides
JSON array of objects:
```json
[
  {"match":"Just Hardwood Floors","tier":{"basePrice":300}},
  {"match":"/^Toyota/i","tier":{"stepPrice":80}}
]
```

## Notes
- Matches the table by a header containing “Records”. If Knack changes markup, tweak header matching in `content.js`.
- Export CSV includes the injected Cost column.

- Export **Excel (.xls)** via HTML-based workbook for quick analysis in Excel.


Version **0.2.1**: cleaned toolbar (no Recalculate/Import JSON); auto-sort descending by Records.

Version **0.2.2**: fixed toolbar + processing script; auto-calc & auto-sort restored.