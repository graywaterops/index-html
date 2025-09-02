// universe.js — fetches published CSV, builds a gen→gen chain, highlights forward from clicked node.
(() => {
  // Use your *published to web* CSV URL (works cross-origin).
  const CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/pub?gid=665678863&single=true&output=csv";

  const container = document.getElementById('graph');
  const statusEl  = document.getElementById('status');
  let Graph = null;
  let selectedNode = null;
  const hiNodes = new Set();
  const hiLinks = new Set();

  const linkKey = (l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    return `${s}-${t}`;
  };

  // Minimal CSV line parser (handles quoted fields and commas inside quotes)
  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
          else { inQuotes = false; }
        } else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  async function loadValuesFromCsv() {
    const res = await fetch(CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    // If the sheet isn’t published or the link is wrong, Google returns HTML, not CSV.
    const trimmed = text.trim().slice(0, 120).toLowerCase();
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
      throw new Error('Received HTML, not CSV — check that the sheet/tab is “Published to the web”.');
    }

    const lines = text.split(/\r?\n/);
    console.log("First few lines:", lines.slice(0,5));

    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = parseCsvLine(line);
      // We want Column C (zero-index 2). This skips header cells automatically.
      const raw = cols[2];
      if (raw == null) continue;
      // Strip non-numeric clutter (commas, spaces, etc.) then parse
      const n = parseFloat(String(raw).replace(/[^0-9eE.\-+]/g, ''));
      if (Number.isFinite(n)) values.push(n);
    }

    if (!values.length) {
      throw new Error('No numeric values found in Column C of the published CSV.');
    }
    return values;
  }

  function draw(values) {
    const nodes = values.map((val, i) => ({
      id: i,
      donors: val,
      val: Math.max(2, Math.sqrt(Math.max(0, val)) * 1.8),
      label: `Generation ${i}\nCumulative donors/seed: ${Number(val).toLocaleString()}`
    }));

    const links = values.length > 1
      ? values.slice(1).map((_, i) => ({ source: i, target: i + 1 }))
      : [];

    Graph = ForceGraph3D()(container)
      .backgroundColor('#000')
      .showNavInfo(false)
      .graphData({ nodes, links })
      .nodeLabel(n => n.label)
      .nodeVal(n => n.val)
      .nodeColor(n => (selectedNode && !hiNodes.has(n.id) ? 'rgba(90,110,150,0.35)' : '#7cc3ff'))
      .linkColor(l => (hiLinks.has(linkKey(l)) ? '#ffff66' : 'rgba(160,160,160,0.35)'))
      .linkWidth(l => (hiLinks.has(linkKey(l)) ? 3 : 1))
      .onNodeClick(node => {
        selectedNode = node;
        hiNodes.clear();
        hiLinks.clear();
        for (let i = node.id; i < nodes.length - 1; i++) {
          hiNodes.add(i);
          hiNodes.add(i + 1);
          hiLinks.add(`${i}-${i + 1}`);
        }
        Graph.refresh();
      });

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        selectedNode = null;
        hiNodes.clear();
        hiLinks.clear();
        Graph.refresh();
      }
    });

    setTimeout(() => Graph.zoomToFit(600), 400);
    if (statusEl) statusEl.textContent = `Status: ${nodes.length} generations loaded — click any node to highlight forward. Esc to clear.`;
  }

  (async () => {
    try {
      const values = await loadValuesFromCsv();
      draw(values);
    } catch (err) {
      console.error('[3D map] Load error:', err);
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      container.innerHTML = `<div style="color:#fff;padding:16px;font:14px/1.4 system-ui">${err.message}</div>`;
    }
  })();
})();


