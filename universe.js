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

  // --- Node builder ---
  function addNode(type, parent = null) {
    const node = { id: nodes.length, type, children: 0 };
    nodes.push(node);
    if (parent !== null) {
      links.push({ source: parent.id, target: node.id });
      parent.children++;
    }
    return node;
  }

  // --- Universe generator ---
  function generateUniverse(total = 1000) {
    nodes = [];
    links = [];

    for (let i = 0; i < total; i++) {
      const root = addNode("root");

      // Each root can have exactly one primary
      if (Math.random() < 0.7) {
        const primary = addNode("primary", root);

        // Decide how many referrals this primary makes
        const referralCount = Math.floor(Math.random() * 5); // 0–4
        for (let r = 0; r < referralCount; r++) {
          if (r === 0) {
            // First referral from light blue is also light blue
            addNode("primary", primary);
          } else {
            // Additional referrals are green
            const extra = addNode("extra", primary);

            // Green children spawn red downline
            const downCount = Math.floor(Math.random() * 3); // 0–2
            for (let d = 0; d < downCount; d++) {
              addNode("down", extra);
            }
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
