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

  // --- Probability distribution for referrals ---
  const REFERRAL_DIST = [
    { k: 0, p: 0.30 },  // 30% no referrals
    { k: 1, p: 0.36 },  // 36% find 1
    { k: 2, p: 0.22 },  // 22% find 2
    { k: 3, p: 0.09 },  // 9% find 3
    { k: 4, p: 0.026 }, // 2.6% find 4
    { k: 5, p: 0.004 }  // 0.4% find 5
  ];

  function sampleReferrals() {
    const r = Math.random();
    let sum = 0;
    for (const dist of REFERRAL_DIST) {
      sum += dist.p;
      if (r <= sum) return dist.k;
    }
    return 0;
  }

  // --- Build universe ---
  function generateUniverse(total = 1000) {
    nodes = [];
    links = [];
    let id = 0;

    function addNode(type, parent = null) {
      const node = { id: id++, type };
      nodes.push(node);
      if (parent !== null) {
        links.push({ source: parent.id, target: node.id });
      }
      return node;
    }

    function grow(parent, parentType) {
      const num = sampleReferrals();
      if (num === 0) return;

      // First referral is always primary (light blue), unless parent is "extra" or "down"
      let mainChild;
      if (parentType === "extra" || parentType === "down") {
        // under extras, everything is red
        mainChild = addNode("down", parent);
        grow(mainChild, "down");
      } else {
        // true bloodline continues as primary
        mainChild = addNode("primary", parent);
        grow(mainChild, "primary");
      }

      // Additional referrals are extras (green), their descendants are all red
      for (let i = 1; i < num; i++) {
        const extraChild = addNode("extra", parent);
        // anything under extra is forced downline (red)
        const downChild = addNode("down", extraChild);
        grow(downChild, "down");
      }
    }

    // Generate seed roots
    for (let i = 0; i < total; i++) {
      const root = addNode("root");
      grow(root, "root");
    }

    return { nodes, links };
  }

  // --- Highlight logic ---
  function clearHighlights() {
    highlightNodes.clear();
    highlightLinks.clear();
    selectedNode = null;
    Graph.refresh();
    if (statusEl) {
      statusEl.textContent =
        `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    }
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
      .d3Force("charge", d3.forceManyBody().strength(-50))
      .d3Force("link", d3.forceLink().distance(60).strength(0.7))
      .d3Force("center", d3.forceCenter(0, 0, 0));

    if (statusEl) {
      statusEl.textContent =
        `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    }

    // ESC clears selection
    window.addEventListener("keydown", e => {
      if (e.key === "Escape") clearHighlights();
    });
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
