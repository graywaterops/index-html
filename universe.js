(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");

  let Graph;
  let nodes = [], links = [];

  const COLORS = {
    root: "#1f4aa8",      // dark blue
    primary: "#7cc3ff",   // light blue
    extra: "#2ecc71",     // green
    down: "#e74c3c",      // red
    forward: "#00ff88",   // bright green
    back: "#ffdd33",      // yellow
    selected: "#ffffff"   // white
  };

  // --- Universe generator ---
  function genUniverse(totalDonors = 1000, seedCount = 250) {
    nodes = [];
    links = [];
    let id = 0;

    const addNode = (type, parentId = null) => {
      const node = { id: id++, type, gift: sampleGift(), highlight: null };
      nodes.push(node);
      if (parentId !== null) {
        links.push({ source: parentId, target: node.id, highlight: null });
      }
      return node.id;
    };

    // Simple gift sampler
    function sampleGift() {
      const tiers = [50, 100, 250, 500, 1000, 5000];
      const probs = [0.7, 0.2, 0.05, 0.04, 0.006, 0.004];
      const r = Math.random();
      let sum = 0;
      for (let i = 0; i < tiers.length; i++) {
        sum += probs[i];
        if (r <= sum) return tiers[i];
      }
      return 50;
    }

    // Seed donors
    const roots = [];
    for (let i = 0; i < seedCount; i++) {
      roots.push(addNode("root"));
    }

    // Remaining donors distributed among roots
    let remaining = totalDonors - seedCount;
    while (remaining > 0) {
      const parent = nodes[Math.floor(Math.random() * nodes.length)];
      let type = "primary";
      if (parent.type === "primary") type = "extra";
      if (parent.type === "extra") type = "down";
      if (parent.type === "down") type = "down"; // always down

      addNode(type, parent.id);
      remaining--;
    }

    return { nodes, links };
  }

  // --- Highlight logic ---
  function clearHighlights() {
    nodes.forEach(n => (n.highlight = null));
    links.forEach(l => (l.highlight = null));
  }

  function highlightPath(node) {
    clearHighlights();

    function visitDown(id) {
      const n = nodes.find(nn => nn.id === id);
      if (!n || n.highlight === "forward" || n.highlight === "selected") return;
      n.highlight = "forward";
      links.forEach(l => {
        if (l.source.id === id || l.source === id) {
          l.highlight = "forward";
          visitDown(l.target.id || l.target);
        }
      });
    }

    function visitUp(id) {
      links.forEach(l => {
        if (l.target.id === id || l.target === id) {
          l.highlight = "back";
          const parent = nodes.find(nn => nn.id === (l.source.id || l.source));
          if (parent && parent.highlight !== "back") {
            parent.highlight = "back";
            visitUp(parent.id);
          }
        }
      });
    }

    node.highlight = "selected";
    visitDown(node.id);
    visitUp(node.id);

    Graph.graphData({ nodes, links });
  }

  // --- Draw graph ---
  function draw({ nodes, links }) {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({ nodes, links })
      .nodeLabel(
        n =>
          `<strong>${n.type}</strong> #${n.id}<br/>Gift: $${n.gift}<br/>Direct referrals: ${
            links.filter(l => l.source.id === n.id || l.source === n.id).length
          }`
      )
      .nodeColor(n => {
        if (n.highlight === "selected") return COLORS.selected;
        if (n.highlight === "forward") return COLORS.forward;
        if (n.highlight === "back") return COLORS.back;
        return COLORS[n.type] || COLORS.down;
      })
      .nodeVal(n =>
        n.type === "root" ? 12 : n.type === "primary" ? 8 : n.type === "extra" ? 6 : 4
      )
      .linkColor(l => {
        if (l.highlight === "forward") return COLORS.forward;
        if (l.highlight === "back") return COLORS.back;
        return "rgba(180,180,180,0.15)";
      })
      .linkWidth(l => (l.highlight ? 2 : 0.3))
      .onNodeClick(node => highlightPath(node))
      .d3Force("charge", d3.forceManyBody().strength(-60))
      .d3Force("link", d3.forceLink().distance(40).strength(0.5))
      .d3Force("center", d3.forceCenter())
      .d3VelocityDecay(0.9);

    if (statusEl)
      statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  // --- Run ---
  (async () => {
    if (statusEl) statusEl.textContent = "Status: generating universe...";
    const data = genUniverse(1000, 250);
    draw(data);
  })();
})();
