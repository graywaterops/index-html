(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");
  const sizeSlider = document.getElementById("nodeSize");

  let Graph, nodes = [], links = [];
  let selectedNode = null;

  // ---- Generate Demo Data ----
  function generateUniverse(seeds = 50, generations = 4) {
    nodes = [];
    links = [];
    let id = 0;

    function addNode(type, parentId = null, donation = 50) {
      const node = { id: id++, type, donation, highlight: null };
      nodes.push(node);
      if (parentId !== null) links.push({ source: parentId, target: node.id, highlight: null });
      return node.id;
    }

    function grow(parentId, depth) {
      if (depth >= generations) return;
      const children = Math.floor(Math.random() * 3); // 0–2 children
      for (let i = 0; i < children; i++) {
        const type = i === 0 ? "primary" : "extra";
        const donation = [50, 100, 250, 500][Math.floor(Math.random()*4)];
        const childId = addNode(type, parentId, donation);
        grow(childId, depth + 1);
      }
    }

    for (let i = 0; i < seeds; i++) {
      const root = addNode("root", null, 50);
      grow(root, 0);
    }
    return { nodes, links };
  }

  // ---- Highlight Path ----
  function clearHighlights() {
    nodes.forEach(n => n.highlight = null);
    links.forEach(l => l.highlight = null);
  }

  function highlightPath(node) {
    clearHighlights();
    node.highlight = "selected";

    // Forward
    function visitDown(id) {
      links.forEach(l => {
        if (l.source === id) {
          l.highlight = "forward";
          const child = nodes.find(n => n.id === l.target);
          if (child) {
            child.highlight = "forward";
            visitDown(child.id);
          }
        }
      });
    }

    // Backtrace
    function visitUp(id) {
      links.forEach(l => {
        if (l.target === id) {
          l.highlight = "back";
          const parent = nodes.find(n => n.id === l.source);
          if (parent) {
            parent.highlight = "back";
            visitUp(parent.id);
          }
        }
      });
    }

    visitDown(node.id);
    visitUp(node.id);

    const chainDonations = nodes
      .filter(n => n.highlight === "forward" || n.highlight === "selected")
      .reduce((sum,n)=>sum+n.donation,0);

    statusEl.textContent = `Selected node #${node.id} | Chain total: $${chainDonations.toLocaleString()}`;
    Graph.graphData({ nodes, links });
  }

  // ---- Init Graph ----
  function draw() {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({ nodes, links })
      .nodeLabel(n => `${n.type.toUpperCase()} #${n.id}<br/>Donation: $${n.donation}`)
      .nodeColor(n => {
        if (n.highlight === "selected") return "#fff";
        if (n.highlight === "forward") return "#0f0";
        if (n.highlight === "back") return "#ff0";
        if (n.type === "root") return "#1f4aa8";
        if (n.type === "primary") return "#7cc3ff";
        if (n.type === "extra") return "#2ecc71";
        return "#e74c3c";
      })
      .nodeVal(n => n.highlight ? 12 : sizeSlider.value)
      .linkColor(l => l.highlight === "forward" ? "#0f0" :
                      l.highlight === "back" ? "#ff0" :
                      "rgba(200,200,200,0.2)")
      .linkWidth(l => l.highlight ? 2 : 0.4)
      .onNodeClick(node => highlightPath(node));

    statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  // ---- Slider ----
  sizeSlider.addEventListener("input", () => {
    Graph.nodeVal(n => n.highlight ? 12 : sizeSlider.value);
    Graph.refresh();
  });

  // ---- ESC Reset ----
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      clearHighlights();
      Graph.graphData({ nodes, links });
      statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals.`;
    }
  });

  // ---- Run ----
  const data = generateUniverse(50, 5);
  draw(data);
})();
