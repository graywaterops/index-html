(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");

  let Graph;
  let nodes = [], links = [];
  let highlightNodes = new Set(), highlightLinks = new Set();
  let selectedNode = null;
  let nodeSize = 4;

  const COLORS = {
    root: "#1f4aa8",       // dark blue
    primary: "#7cc3ff",    // light blue
    extra: "#2ecc71",      // green
    down: "#e74c3c",       // red
    forward: "#00ff88",
    back: "#ffdd33",
    selected: "#ffffff",
    faded: "rgba(100,100,100,0.15)"
  };

  // --- Build longer chains ---
  function generateUniverse(total = 1000) {
    nodes = [];
    links = [];
    let id = 0;

    const addNode = (type, parentId = null) => {
      const node = { id: id++, type };
      nodes.push(node);
      if (parentId !== null) {
        links.push({ source: parentId, target: node.id });
      }
      return node.id;
    };

    // Recursive growth
    const growChain = (parentId, depth = 0) => {
      if (depth > 12) return; // prevent infinite growth

      const children = Math.floor(Math.random() * 3); // 0–2 children
      for (let i = 0; i < children; i++) {
        const type = depth === 0
          ? (i === 0 ? "primary" : "extra")
          : (depth === 1 && i > 0 ? "extra" : "down");

        const childId = addNode(type, parentId);

        // 50% chance to keep chain going deeper
        if (Math.random() < 0.5) {
          growChain(childId, depth + 1);
        }
      }
    };

    // Seed roots
    for (let i = 0; i < total / 2; i++) {
      const rootId = addNode("root");
      growChain(rootId, 0);
    }

    return { nodes, links };
  }

  // --- Highlight logic ---
  function clearHighlights() {
    highlightNodes.clear();
    highlightLinks.clear();
    selectedNode = null;
    Graph.refresh();
  }

  function highlightPath(node) {
    clearHighlights();
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
    Graph.refresh();
  }

  // --- Draw graph ---
  function draw({ nodes, links }) {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({ nodes, links })
      .nodeLabel(n => `<strong>${n.type.toUpperCase()}</strong> (ID ${n.id})`)
      .nodeVal(() => nodeSize)
      .nodeColor(n => {
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
        if (selectedNode) {
          return highlightLinks.has(l) ? COLORS.forward : COLORS.faded;
        }
        return "rgba(180,180,180,0.3)";
      })
      .linkWidth(l => (highlightLinks.has(l) ? 2.5 : 0.4))
      .onNodeClick(highlightPath)
      .d3Force("charge", d3.forceManyBody().strength(-60))
      .d3Force("link", d3.forceLink().distance(40).strength(0.5))
      .d3Force("radial", d3.forceRadial(200, 0, 0).strength(0.05)); // globe-like

    if (statusEl) {
      statusEl.textContent =
        `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    }
  }

  // --- Slider control ---
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 2;
  slider.max = 12;
  slider.value = nodeSize;
  slider.style.position = "absolute";
  slider.style.left = "20px";
  slider.style.bottom = "20px";
  slider.oninput = e => {
    nodeSize = +e.target.value;
    Graph.nodeVal(() => nodeSize);
    Graph.refresh();
  };
  document.body.appendChild(slider);

  // --- Legend ---
  const legend = document.createElement("div");
  legend.style.position = "absolute";
  legend.style.top = "10px";
  legend.style.right = "10px";
  legend.style.background = "rgba(0,0,0,0.7)";
  legend.style.color = "#fff";
  legend.style.padding = "10px";
  legend.style.borderRadius = "6px";
  legend.innerHTML = `
    <b>Legend</b><br>
    <span style="color:${COLORS.root}">●</span> Root<br>
    <span style="color:${COLORS.primary}">●</span> Primary<br>
    <span style="color:${COLORS.extra}">●</span> Extra<br>
    <span style="color:${COLORS.down}">●</span> Downline<br>
    <span style="color:${COLORS.forward}">●</span> Forward path<br>
    <span style="color:${COLORS.back}">●</span> Backtrace<br>
  `;
  document.body.appendChild(legend);

  // --- ESC reset ---
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearHighlights();
    }
  });

  // --- Run ---
  const data = generateUniverse(1000);
  draw(data);
})();
