(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");
  const sizeSlider = document.getElementById("nodeSize");

  let Graph;
  let nodes = [], links = [];
  let nodeSizeScale = 4; // default multiplier

  const TOTAL = 1000;
  const DISTRIBUTION = [
    { type: "none", pct: 0.30 },    // root only
    { type: "primary", pct: 0.36 }, // root +1
    { type: "extra", pct: 0.22 },   // root +1 + green
    { type: "2red", pct: 0.09 },    // root +1 +2 red
    { type: "3red", pct: 0.026 },   // root +1 +3 red
    { type: "4red", pct: 0.004 }    // root +1 +4 red
  ];

  const getId = v => (typeof v === "object" ? v.id : v);

  function genUniverse() {
    nodes = []; links = []; let id = 0;

    function addNode(type, parentId = null) {
      const node = { id: id++, type, highlight: null };
      nodes.push(node);
      if (parentId !== null) links.push({ source: parentId, target: node.id, highlight: null });
      return node.id;
    }

    function spawnChildren(parentId, pattern) {
      const primary = addNode("primary", parentId);

      if (pattern === "extra") addNode("extra", parentId);
      else if (pattern === "2red") {
        addNode("extra", parentId);
        addNode("extra", parentId);
      }
      else if (pattern === "3red") {
        for (let i = 0; i < 3; i++) addNode("extra", parentId);
      }
      else if (pattern === "4red") {
        for (let i = 0; i < 4; i++) addNode("extra", parentId);
      }
    }

    DISTRIBUTION.forEach(group => {
      const count = Math.round(group.pct * TOTAL);
      for (let i = 0; i < count; i++) {
        const root = addNode("root");
        if (group.type !== "none") spawnChildren(root, group.type);
      }
    });

    return { nodes, links };
  }

  function clearHighlights() {
    nodes.forEach(n => n.highlight = null);
    links.forEach(l => l.highlight = null);
  }

  function highlightPath(node) {
    clearHighlights();

    function visitDown(id) {
      const n = nodes.find(nn => nn.id === id); if (!n) return;
      if (n.highlight === "forward" || n.highlight === "selected") return;
      n.highlight = "forward";
      links.forEach(l => {
        if (getId(l.source) === id) {
          l.highlight = "forward";
          visitDown(getId(l.target));
        }
      });
    }

    function visitUp(id) {
      links.forEach(l => {
        if (getId(l.target) === id) {
          l.highlight = "back";
          const parent = nodes.find(nn => nn.id === getId(l.source));
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

  function draw({ nodes, links }) {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({ nodes, links })
      .nodeLabel(n => `<strong>${n.type}</strong> #${n.id}`)
      .nodeColor(n => {
        if (n.highlight === "selected") return "#fff";
        if (n.highlight === "forward") return "#00ff88";
        if (n.highlight === "back") return "#ffdd33";
        return n.type === "root" ? "#1f4aa8" :
               n.type === "primary" ? "#7cc3ff" :
               n.type === "extra" ? "#e74c3c" : "#999";
      })
      .nodeVal(n => {
        if (n.type === "root") return nodeSizeScale * 6;
        if (n.type === "primary") return nodeSizeScale * 4;
        if (n.type === "extra") return nodeSizeScale * 3;
        return nodeSizeScale * 2;
      })
      .linkColor(l => {
        if (l.highlight === "forward") return "#00ff88";
        if (l.highlight === "back") return "#ffdd33";
        return "rgba(180,180,180,0.2)";
      })
      .linkWidth(l => (l.highlight ? 2 : 0.4))
      .onNodeClick(node => highlightPath(node))
      .d3Force("charge", d3.forceManyBody().strength(-80)) // tighter clusters
      .d3Force("link", d3.forceLink().distance(30).strength(0.8))
      .d3Force("center", d3.forceCenter());

    if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  (async () => {
    const data = genUniverse();
    draw(data);

    // slider updates node size
    sizeSlider.addEventListener("input", e => {
      nodeSizeScale = parseFloat(e.target.value);
      Graph.nodeVal(n => {
        if (n.type === "root") return nodeSizeScale * 6;
        if (n.type === "primary") return nodeSizeScale * 4;
        if (n.type === "extra") return nodeSizeScale * 3;
        return nodeSizeScale * 2;
      });
      Graph.refresh();
    });
  })();
})();
