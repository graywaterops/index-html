(() => {
  const container = document.getElementById("graph");
  const statusEl  = document.getElementById("status");

  let Graph;
  let nodes = [], links = [];
  let byId = new Map();

  let highlightNodes = new Set(), highlightLinks = new Set();
  let selectedNode = null;

  // view state
  let nodeSize = 4;
  let universeSpread = 60;
  let zoomDist = 90;
  let heatByDonation = false;
  let isolateView = false;
  const visibleTypes = new Set(["root","primary","extra","down","inactive"]);

  const COLORS = {
    root: "#1f4aa8",
    primary: "#7cc3ff",
    extra: "#2ecc71",
    down: "#e74c3c",
    inactive: "#ffdd00",
    forward: "#00ff88",
    back: "#ffdd33",
    selected: "#ffffff",
    faded: "rgba(100,100,100,0.08)",
    hidden: "rgba(0,0,0,0)"
  };

  const money = v => `$${(v||0).toLocaleString()}`;

  function randomDonation() {
    const r = Math.random();
    if (r < 0.75) return Math.floor(50 + Math.random() * 50);
    if (r < 0.95) return Math.floor(100 + Math.random() * 400);
    return Math.floor(500 + Math.random() * 4500);
  }

  function generateUniverse(total = 1000, seedRoots = 250) {
    nodes = []; links = []; byId = new Map();
    let id = 0;

    for (let i=0;i<seedRoots;i++) {
      const n = { id:id++, type:"root", donation:randomDonation(), children:[], parent:null };
      nodes.push(n); byId.set(n.id, n);
    }

    for (let i = seedRoots; i < total; i++) {
      const parent = nodes[Math.floor(Math.random() * nodes.length)];
      const donation = randomDonation();
      let type = "primary";
      if (parent.children.length > 0) type = parent.type === "primary" ? "extra" : "down";

      const child = { id:id++, type, donation, children:[], parent: parent.id };
      nodes.push(child); byId.set(child.id, child);
      parent.children.push(child.id);
      links.push({ source: parent.id, target: child.id });
    }

    nodes.forEach(n => { if (n.children.length === 0) n.type = "inactive"; });
    return { nodes, links };
  }

  function getBloodlineTotal(rootId){
    let total = 0; const seen = new Set();
    (function dfs(id){
      if (seen.has(id)) return;
      seen.add(id);
      const n = byId.get(id); if (!n) return;
      total += n.donation || 0;
      n.children.forEach(dfs);
    })(rootId);
    return total;
  }

  function getSubtreeStats(rootId){
    let count=0,total=0,depth=0;
    (function dfs(id,d){
      count++; depth = Math.max(depth,d);
      const n = byId.get(id); if (!n) return;
      total += n.donation||0;
      n.children.forEach(c=>dfs(c,d+1));
    })(rootId,0);
    return {count,total,depth};
  }

  function collectSubtree(rootId){
    const rows = [];
    (function dfs(id){
      const n = byId.get(id); if (!n) return;
      rows.push({ id:n.id, type:n.type, donation:n.donation, parent:n.parent });
      n.children.forEach(dfs);
    })(rootId);
    return rows;
  }

  function clearHighlights(){
    highlightNodes.clear();
    highlightLinks.clear();
    selectedNode = null;
    if (statusEl) statusEl.textContent =
      `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    Graph.refresh();
    updateExportState();
    syncQuery();
  }

  function highlightPath(node){
    highlightNodes.clear();
    highlightLinks.clear();
    selectedNode = node;

    const visitDown = (id) => {
      highlightNodes.add(id);
      links.forEach(l => {
        if (l.source.id === id) {
          highlightLinks.add(l);
          visitDown(l.target.id);
        }
      });
    };
    const visitUp = (id) => {
      links.forEach(l => {
        if (l.target.id === id) {
          highlightLinks.add(l);
          highlightNodes.add(l.source.id);
          visitUp(l.source.id);
        }
      });
    };

    visitDown(node.id);
    visitUp(node.id);

    const stats = getSubtreeStats(node.id);
    if (statusEl){
      statusEl.textContent =
        `Focused coin #${node.id} — subtree: ${stats.count} donors, ${money(stats.total)} total, depth ${stats.depth}. (ESC to reset)`;
    }
    Graph.refresh();
    updateExportState();
    focusCamera(node);
    syncQuery();
  }

  function nodeIsVisibleByType(n){
    return visibleTypes.has(n.type);
  }
  function nodeShouldDisplay(n){
    if (!nodeIsVisibleByType(n)) return false;
    if (isolateView && selectedNode) return highlightNodes.has(n.id);
    return true;
  }

  function focusCamera(node){
    if (!node) return;
    const dist = zoomDist;
    const lookAt = { x: node.x, y: node.y, z: node.z };
    const camPos = {
      x: node.x + dist,
      y: node.y + dist * 0.8,
      z: node.z + dist
    };
    Graph.cameraPosition(camPos, lookAt, 800);
  }

  function draw({nodes, links}){
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({nodes, links})
      .nodeLabel(n => {
        const total = getBloodlineTotal(n.id);
        return `
          <div>
            <b>${n.type.toUpperCase()}</b><br/>
            Coin #: ${n.id}<br/>
            Donation: ${money(n.donation)}<br/>
            <b>Bloodline Total:</b> ${money(total)}
          </div>`;
      })
      .nodeVal(n => {
        if (!nodeShouldDisplay(n)) return 0.001;
        if (heatByDonation){
          return Math.max(2, nodeSize * (n.donation/100)); // scale by donation
        }
        return nodeSize;
      })
      .nodeColor(n => {
        if (!nodeShouldDisplay(n)) return COLORS.hidden;
        if (heatByDonation){
          // scale 50→green, 5000→red
          const ratio = Math.min(1, n.donation / 5000);
          const r = Math.floor(255 * ratio);
          const g = Math.floor(255 * (1-ratio));
          return `rgb(${r},${g},80)`; // green→yellow→red
        }
        if (selectedNode) {
          if (highlightNodes.has(n.id)) {
            if (n.id === selectedNode.id) return COLORS.selected;
            return COLORS[n.type] || "#aaa";
          }
          return COLORS.faded;
        }
        return COLORS[n.type] || "#aaa";
      })
      .linkColor(l => {
        const src = l.source, tgt = l.target;
        const show = nodeShouldDisplay(src) && nodeShouldDisplay(tgt);
        if (!show) return COLORS.hidden;
        if (selectedNode) return highlightLinks.has(l) ? COLORS.forward : COLORS.faded;
        return "rgba(180,180,180,0.2)";
      })
      .linkWidth(l => (highlightLinks.has(l) ? 2.2 : 0.4))
      .onNodeClick(highlightPath)
      .d3Force("charge", d3.forceManyBody().strength(-universeSpread))
      .d3Force("link",   d3.forceLink().distance(universeSpread).strength(0.4))
      .d3Force("center", d3.forceCenter(0,0,0));

    if (statusEl) statusEl.textContent =
      `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;

    window.addEventListener("keydown", ev => { if (ev.key === "Escape") clearHighlights(); });

    Graph.onEngineStop(() => {
      const params = new URLSearchParams(location.search);
      const qFind = params.get("find");
      if (qFind) tryFindAndFocus(qFind);
    });
  }

  // --- UI omitted for brevity (controls, sliders, finder, filters, export) ---
  // Keep your existing controls/finder code. Just make sure the heat checkbox toggles:
  // heatChk.addEventListener("change", e => { heatByDonation = !!e.target.checked; Graph.refresh(); syncQuery(); });

  const data = generateUniverse(3200, 250);
  draw(data);
})();
