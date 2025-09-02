// universe.js
(() => {
  // === CONFIG: your published Google Sheet (Outputs tab) via GViz JSON ===
  // (GViz JSON avoids CORS issues by loading as a <script> tag)
  const GVIZ_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/gviz/tq?tqx=out:json&gid=665678863";

  const container = document.getElementById('graph');
  const statusEl  = document.getElementById('status');
  if (!container) {
    console.error('[3D map] Missing #graph container.');
    return;
  }

  let Graph = null;
  let selectedNode = null;
  const hiNodes = new Set();
  const hiLinks = new Set();

  const linkKey = (l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    return `${s}-${t}`;
  };

  function detectColumn(headers, rows) {
    // Try header match first
    let idx = headers.findIndex(h =>
      h.includes('cumulative') && (h.includes('donor') || h.includes('per seed'))
    );
    if (idx >= 0) return idx;

    // Fallback to column C (index 2)
    if (rows.length && Number.isFinite(+rows[0][2])) return 2;

    // Fallback to first numeric-looking column
    for (let c = 0; c < headers.length; c++) {
      if (rows.some(r => Number.isFinite(+r[c]))) return c;
    }
    return -1;
  }

  function draw(values) {
    const nodes = values.map((val, i) => ({
      id: i,
      donors: val,
      val: Math.max(2, Math.sqrt(Math.max(0, val)) * 1.8),
      label: `Generation ${i}\nCumulative donors/seed: ${Number(val).toLocaleString()}`
    }));

    const links = values.slice(1).map((_, i) => ({ source: i, target: i + 1 }));

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

    setTimeout(() => Graph.zoomToFit(500), 400);
    if (statusEl) statusEl.textContent = `Status: ${nodes.length} generations loaded — click any node to highlight its forward chain. Esc to clear.`;
  }

  function handleGVizResponse(resp) {
    try {
      const cols = (resp.table.cols || []).map(c => (c.label || c.id || '').toString().trim().toLowerCase());
      const rows = (resp.table.rows || []).map(r => (r.c || []).map(cell => (cell && 'v' in cell) ? cell.v : null));

      const colIndex = detectColumn(cols, rows);
      if (colIndex < 0) throw new Error('Could not find the cumulative donors/seed column.');

      const values = rows
        .map(r => parseFloat(r[colIndex]))
        .filter(v => Number.isFinite(v));

      if (!values.length) throw new Error('No numeric values found in the selected column.');
      draw(values);
    } catch (err) {
      console.error('[3D map] Data error:', err);
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
      container.innerHTML = `<div style="color:#fff;padding:16px;font:14px/1.4 system-ui">Data error: ${err.message}</div>`;
    }
  }

  // Stub the GViz callback and inject the script (JSONP-like)
  window.google = window.google || {};
  window.google.visualization = window.google.visualization || {};
  window.google.visualization.Query = window.google.visualization.Query || {};
  window.google.visualization.Query.setResponse = handleGVizResponse;

  const s = document.createElement('script');
  s.src = GVIZ_URL;
  s.onerror = () => {
    console.error('[3D map] Failed to load GViz JSON.');
    if (statusEl) statusEl.textContent = 'Error: failed to load sheet.';
    container.innerHTML = `<div style="color:#fff;padding:16px;font:14px/1.4 system-ui">Failed to load sheet data.</div>`;
  };
  document.body.appendChild(s);
})();
