/* eslint-disable */
const fs = require("fs");
const path = require("path");

function esc(x) {
  return String(x)
    .replace(/&/g, "&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function badge(sev, pass) {
  if (pass) return `<span style="background:#059669;color:#fff;border-radius:4px;padding:2px 6px;font-weight:600">PASS</span>`;
  const color = sev === "FAIL" ? "#DC2626" : "#D97706";
  return `<span style="background:${color};color:#fff;border-radius:4px;padding:2px 6px;font-weight:600">${sev}</span>`;
}

function main() {
  const root = process.cwd();
  const src = path.join(root, "reports", "phase2-results.json");
  const dst = path.join(root, "reports", "phase2-report.html");

  const data = JSON.parse(fs.readFileSync(src, "utf8"));

  const rows = data.items.map(it => `
    <tr>
      <td style="padding:8px;border-top:1px solid #eee">${esc(it.id)}</td>
      <td style="padding:8px;border-top:1px solid #eee">${esc(it.title)}</td>
      <td style="padding:8px;border-top:1px solid #eee">${badge(it.severity, it.pass)}</td>
      <td style="padding:8px;border-top:1px solid #eee">${esc(it.note || "")}</td>
    </tr>
  `).join("");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Phase-2 Compliance Report</title>
</head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:960px;margin:24px auto;padding:0 16px">
  <h1>Phase-2 Compliance Report</h1>
  <p><strong>Generated:</strong> ${esc(data.generatedAt)}</p>
  <h3>Addresses</h3>
  <pre style="background:#f6f6f6;padding:12px;border-radius:6px">${esc(JSON.stringify(data.addresses, null, 2))}</pre>
  <h3>Summary</h3>
  <div style="display:flex; gap:12px; margin:12px 0;">
    <div>✅ Pass: <strong>${data.summary.pass}</strong></div>
    <div>⚠️ Warn: <strong>${data.summary.warn}</strong></div>
    <div>❌ Fail: <strong>${data.summary.fail}</strong></div>
  </div>
  <table style="width:100%; border-collapse:collapse">
    <thead>
      <tr style="background:#fafafa">
        <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">Rule</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">Title</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">Outcome</th>
        <th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">Note</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <h3>Raw Data</h3>
  <pre style="background:#f6f6f6;padding:12px;border-radius:6px">${esc(JSON.stringify(data.data, null, 2))}</pre>
</body>
</html>`;

  fs.writeFileSync(dst, html);
  console.log("[phase2] HTML written:", dst);
}

main();