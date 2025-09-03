(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");
  const slider = document.getElementById("nodeSize");

  let Graph, nodes = [], links = [];
  let selectedNode = null;

  // ---- Generate donors ----
  function generateUniverse(seedCount = 250, total = 1000) {
    nodes = [];
    links = [];
    let id = 0;

    const addNode = (type, parent = null, donation = 50) => {
      const node = { id: id++, type, donation, highlight: null };
      nodes.push(node);
      if (parent !== null) links.push({ source: parent, target: node.id, highlight: null });
      return node.id;
    };

    // Probability spread
    const distribution = [
      { k: 0, p: 0.30 },   // 30% find no one
      { k: 1, p: 0.36 },   // 36% find 1
      { k: 2, p: 0.22 },   // 22% find 2
      { k: 3, p: 0.09 },   // 9% find 3
      { k: 4, p: 0.026 },  // 2.6% find 4
      { k: 5, p: 0.004 }   // balance find 5
    ];

    function sampleK() {
      const r = Math.random();
      let sum = 0;
      for (let { k, p } of distribution) {
        sum += p;
        if (r <= sum) return k;
      }
      return 0;
    }

    // Create seed donors
    for (let i = 0; i < seedCount; i++) {
      const root = addNode("root", null, 50);
      grow(root, "root");
    }

    function grow(parent, parentType) {
      const k = sampleK();
      if (k === 0) return;

      // First is primary
      const primary = addNode("primary", parent, 50);
      grow(primary, "primary");

      // Extra children become downline
      for (let i = 1; i < k; i++) {
        const extra = addNode("extra", parent, 50);
        grow(extra, "extra");
      }
    }

    return { nodes, links };
  }

  // ---- Highlighting ----
  function clearHighlights() {
    nodes.forEach(n => n.highlight = null);
    links.forEach(l => l.highlight = null);
  }

  function highlightPath(node) {
    clearHighlights();
    selectedNode = node;

    // Forward downline
    function forward(id) {
      nodes[id].highlight = "forward";
      links.forEach(l => {
        if (l.source === id) {
          l.highlight = "forward";
          forward(l.target);
        }
      });
    }

    // Backtrace to root
    function backtrace(id) {
      links.forEach(l => {
        if (l.target === id) {
          l.highlight = "back";
          nodes[l.source].highlight = "back";
          backtrace(l.source);
        }
      });
    }

    node.highlight = "selected";
    forward(node.id);
    backtrace(node.id);

    updateStatus(node);
    Graph.graphData({ nodes, links });
  }

  // ---- Chain stats ----
  function getChainStats(node) {
    let visited = new Set();
    let totalDonation = 0;

    function dfs(id) {
      if (visited.has(id)) return;
      visited.add(id);
      const n = nodes.find(nn => nn.id === id);
      if (n) totalDonation += n.donation;
      links.forEach(l => { if (l.source === id) dfs(l.target); });
    }

    dfs(node.id);
    return { count: visited.size, totalDonation };
  }

  function updateStatus(node = null) {
    if (!node) {
      statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    } else {
      const { count, totalDonation } = getChainStats(node);
      statusEl.textContent = `Selected node #${node.id} | Chain size: ${count} | Chain total: $${totalDonation}`;
    }
  }

  // ---- Build Graph ----
  function draw({ nodes, links }) {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({ nodes, links })
      .nodeLabel(n => `${n.type} #${n.id}<br/>Donation: $${n.donation}`)
      .nodeColor(n => {
        if (n.highlight === "selected") return "#ffffff";
        if (n.highlight === "forward") return "#00ff88";
        if (n.highlight === "back") return "#ffdd33";
        if (n.type === "root") return "#1f4aa8";
        if (n.type === "primary") return "#7cc3ff";
        if (n.type === "extra") return "#2ecc71";
        return "#e74c3c";
      })
      .nodeVal(n => {
        const scale = slider.value;
        return n.type === "root" ? 12 * scale : 6 * scale;
      })
      .linkColor(l => l.highlight === "forward" ? "#00ff88" :
        l.highlight === "back" ? "#ffdd33" : "rgba(180,180,180,0.15)")
      .linkWidth(l => l.highlight ? 2 : 0.4)
      .onNodeClick(node => highlightPath(node))
      .d3Force("charge", d3.forceManyBody().strength(-50))
      .d3Force("link", d3.forceLink().distance(40).strength(0.8));

    updateStatus();
  }

  // ---- Reset ----
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      selectedNode = null;
      clearHighlights();
      updateStatus();
      Graph.graphData({ nodes, links });
    }
  });

  // ---- Init ----
  (function init() {
    const data = generateUniverse(250, 1000);
    draw(data);
  })();
})();
