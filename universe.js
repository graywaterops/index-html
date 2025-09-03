(() => {
  const CSV_DISTRIBUTION = {
    noLinks: 0.30,
    oneLink: 0.36,
    oneExtra: 0.22,
    twoExtras: 0.09,
    threeExtras: 0.026,
    fourExtras: 0.004 // balance
  };

  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");
  const slider = document.getElementById("nodeSize");

  let Graph;
  let nodes = [], links = [];
  let nodeScale = 4;

  slider.addEventListener("input", e => {
    nodeScale = +e.target.value;
    Graph.nodeVal(n => getNodeSize(n));
  });

  const getId = v => (typeof v === "object" ? v.id : v);

  // --- Universe generation ---
  function genUniverse(seeds = 250, total = 1000) {
    nodes = [];
    links = [];
    let id = 0;

    const addNode = (type, parentId = null) => {
      const node = { id: id++, type, highlight: null };
      nodes.push(node);
      if (parentId !== null) links.push({ source: parentId, target: node.id, highlight: null });
      return node.id;
    };

    // Build seeds
    for (let i = 0; i < seeds; i++) {
      const rootId = addNode("root");
      grow(rootId);
    }

    function grow(parentId) {
      const r = Math.random();
      let children = 0;

      if (r < CSV_DISTRIBUTION.noLinks) children = 0;
      else if (r < CSV_DISTRIBUTION.noLinks + CSV_DISTRIBUTION.oneLink) children = 1;
      else if (r < CSV_DISTRIBUTION.noLinks + CSV_DISTRIBUTION.oneLink + CSV_DISTRIBUTION.oneExtra) children = 2;
      else if (r < CSV_DISTRIBUTION.noLinks + CSV_DISTRIBUTION.oneLink + CSV_DISTRIBUTION.oneExtra + CSV_DISTRIBUTION.twoExtras) children = 3;
      else if (r < CSV_DISTRIBUTION.noLinks + CSV_DISTRIBUTION.oneLink + CSV_DISTRIBUTION.oneExtra + CSV_DISTRIBUTION.twoExtras + CSV_DISTRIBUTION.threeExtras) children = 4;
      else children = 5;

      if (children > 0) {
        const first = addNode("primary", parentId);
        for (let i = 1; i < children; i++) {
          addNode("extra", parentId);
        }
      }
    }

    return { nodes, links };
  }

  // --- Highlighting ---
  function clearHighlights() {
    nodes.forEach(n => n.highlight = null);
    links.forEach(l => l.highlight = null);
  }

  function highlightPath(node) {
    clearHighlights();

    const visitDown = id => {
      const n = nodes.find(nn => nn.id === id);
      if (!n) return;
      if (n.highlight === "forward" || n.highlight === "selected") return;
      n.highlight = "forward";
      links.forEach(l => {
        const sid = getId(l.source), tid = getId(l.target);
        if (sid === id) {
          l.highlight = "forward";
          visitDown(tid);
        }
      });
    };

    const visitUp = id => {
      links.forEach(l => {
        const sid = getId(l.source), tid = getId(l.target);
        if (tid === id) {
          l.highlight = "back";
          const parent = nodes.find(nn => nn.id === sid);
          if (parent && parent.highlight !== "back") {
            parent.highlight = "back";
            visitUp(parent.id);
          }
        }
      });
    };

    node.highlight = "selected";
    visitDown(node.id);
    visitUp(node.id);

    Graph.graphData({ nodes, links });
  }

  // --- Node size ---
  function getNodeSize(n) {
    if (n.type === "root") return nodeScale * 3;
    if (n.type === "primary") return nodeScale * 2.2;
    if (n.type === "extra") return nodeScale * 2.0;
    return nodeScale * 1.8;
  }

  // --- Draw graph ---
  function draw({ nodes, links }) {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({ nodes, links })
      .nodeLabel(n => `<strong>${n.type}</strong> #${n.id}`)
      .nodeColor(n => {
        if (n.highlight === "selected") return "#ffffff";
        if (n.highlight === "forward") return "#00ff88";
        if (n.highlight === "back") return "#ffdd33";
        if (nodes.some(nn => nn.highlight)) return "rgba(100,100,100,0.2)";
        return n.type === "root" ? "#1f4aa8" :
               n.type === "primary" ? "#7cc3ff" :
               n.type === "extra" ? "#2ecc71" : "#e74c3c";
      })
      .nodeVal(n => getNodeSize(n))
      .linkColor(l => {
        if (l.highlight === "forward") return "#00ff88";
        if (l.highlight === "back") return "#ffdd33";
        return "rgba(150,150,150,0.2)";
      })
      .linkWidth(l => (l.highlight ? 2 : 0.4))
      .onNodeClick(node => highlightPath(node))
      .d3Force("charge", d3.forceManyBody().strength(-60))
      .d3Force("link", d3.forceLink().distance(50).strength(0.6))
      .d3VelocityDecay(0.25);

    if (statusEl) statusEl.textContent =
      `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  // --- Run ---
  (() => {
    if (statusEl) statusEl.textContent = "Status: building layout...";
    const data = genUniverse(250, 1000);
    draw(data);
  })();
})();
