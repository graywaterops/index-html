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
    forward: "#00ff88",    // highlight forward
    back: "#ffdd33",       // highlight back
    selected: "#ffffff",   // clicked node
    faded: "rgba(100,100,100,0.15)"
  };

  // --- Probability distribution ---
  const PROBS = [
    { type: "root", pct: 0.30, extras: 0 },
    { type: "primary", pct: 0.36, extras: 0 },
    { type: "extra", pct: 0.22, extras: 1 },
    { type: "extra2", pct: 0.09, extras: 2 },
    { type: "extra3", pct: 0.026, extras: 3 },
    { type: "extra4", pct: 0.004, extras: 4 }
  ];

  // --- Build universe ---
  function generateUniverse(total = 1000) {
    nodes = [];
    links = [];
    let id = 0;

    const pickCategory = () => {
      const r = Math.random();
      let sum = 0;
      for (const p of PROBS) {
        sum += p.pct;
        if (r <= sum) return p;
      }
      return PROBS[0]; // fallback
    };

    for (let i = 0; i < total; i++) {
      const cat = pickCategory();
      const rootId = id++;
      nodes.push({ id: rootId, type: "root" });

      if (cat.type === "root") continue;

      const primaryId = id++;
      nodes.push({ id: primaryId, type: "primary" });
      links.push({ source: rootId, target: primaryId });

      if (cat.extras > 0) {
        for (let e = 0; e < cat.extras; e++) {
          const extraId = id++;
          nodes.push({ id: extraId, type: e === 0 ? "extra" : "down" });
          links.push({ source: primaryId, target: extraId });

          // Add a short red chain under each extra
          let parent = extraId;
          const chainLen = Math.floor(Math.random() * 3) + 1;
          for (let d = 0; d < chainLen; d++) {
            const downId = id++;
            nodes.push({ id: downId, type: "down" });
            links.push({ source: parent, target: downId });
            parent = downId;
          }
        }
      }
    }
    return { nodes, links };
  }

  // --- Highlight logic ---
  function clearHighlights() {
    highlightNodes.clear();
    highlightLinks.clear();
    selectedNode = null;
  }

  function highlightPath(node) {
    clearHighlights();
    selectedNode = node;

    // Downline
    const visitDown = (id) => {
      highlightNodes.add(id);
      links.forEach(l => {
        if (l.source.id === id) {
          highlightLinks.add(l);
          visitDown(l.target.id);
        }
      });
    };

    // Upline
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
      .d3Force("charge", d3.forceManyBody().strength(-40))
      .d3Force("link", d3.forceLink().distance(40).strength(0.6));

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
    <span style="color:${COLORS.root}">●</span> Root (no referrals)<br>
    <span style="color:${COLORS.primary}">●</span> Primary<br>
    <span style="color:${COLORS.extra}">●</span> Extra<br>
    <span style="color:${COLORS.down}">●</span> Downline<br>
    <span style="color:${COLORS.forward}">●</span> Forward path<br>
    <span style="color:${COLORS.back}">●</span> Backtrace<br>
  `;
  document.body.appendChild(legend);

  // --- Run ---
  const data = generateUniverse(1000);
  draw(data);
})();
