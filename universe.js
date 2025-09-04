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
    inactive: "#ffff00",   // yellow
    forward: "#00ff88",    // highlight forward
    back: "#ffdd33",       // highlight back
    selected: "#ffffff",   // clicked node
    faded: "rgba(100,100,100,0.15)"
  };

  // --- Weighted random donation ---
  function randomDonation() {
    const r = Math.random();
    if (r < 0.80) return 50 + Math.floor(Math.random() * 51);          // 80% $50–100
    if (r < 0.95) return 101 + Math.floor(Math.random() * 899);        // 15% $101–999
    return 1000 + Math.floor(Math.random() * 4001);                    // 5% $1000–5000
  }

  // --- Probability categories ---
  const PROBS = [
    { type: "root", pct: 0.30, extras: 0 },
    { type: "primary", pct: 0.36, extras: 0 },
    { type: "extra", pct: 0.22, extras: 1 },
    { type: "extra2", pct: 0.09, extras: 2 },
    { type: "extra3", pct: 0.026, extras: 3 },
    { type: "extra4", pct: 0.004, extras: 4 }
  ];

  // --- Spherical placement (biased for inactive at edge) ---
  function randomSphere(radius = 200, edgeBias = false) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = edgeBias ? radius * (0.8 + 0.2 * Math.random()) : radius * Math.cbrt(Math.random());
    return {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi)
    };
  }

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
      return PROBS[0];
    };

    for (let i = 0; i < total; i++) {
      const cat = pickCategory();
      const donation = randomDonation();

      // Root donor
      const rootId = id++;
      const rootPos = randomSphere(200, false);
      nodes.push({ id: rootId, type: "root", donation, ...rootPos });

      // Some roots remain inactive (placed near edge)
      if (cat.type === "root" && Math.random() < 0.5) {
        nodes[rootId].type = "inactive";
        Object.assign(nodes[rootId], randomSphere(200, true));
        continue;
      }

      // Primary (bloodline link)
      const primaryId = id++;
      nodes.push({ id: primaryId, type: "primary", donation: randomDonation(), ...randomSphere() });
      links.push({ source: rootId, target: primaryId });

      // Extras under this donor
      if (cat.extras > 0) {
        for (let e = 0; e < cat.extras; e++) {
          const extraId = id++;
          nodes.push({ id: extraId, type: e === 0 ? "extra" : "down", donation: randomDonation(), ...randomSphere() });
          links.push({ source: primaryId, target: extraId });

          // Red chain below each extra
          let parent = extraId;
          const chainLen = Math.floor(Math.random() * 3) + 1;
          for (let d = 0; d < chainLen; d++) {
            const downId = id++;
            nodes.push({ id: downId, type: "down", donation: randomDonation(), ...randomSphere() });
            links.push({ source: parent, target: downId });
            parent = downId;
          }
        }
      }
    }
    return { nodes, links };
  }

  // --- Chain total calculator ---
  function chainTotal(rootId) {
    const visited = new Set();
    let total = 0;

    const dfs = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodes.find(n => n.id === id);
      if (node) total += node.donation;
      links.forEach(l => {
        if ((l.source.id || l.source) === id) dfs(l.target.id || l.target);
      });
    };

    dfs(rootId);
    return total;
  }

  // --- Highlight logic ---
  function clearHighlights() {
    highlightNodes.clear();
    highlightLinks.clear();
    selectedNode = null;
    Graph.refresh();
    if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  function highlightPath(node) {
    clearHighlights();
    selectedNode = node;

    const visitDown = (id) => {
      highlightNodes.add(id);
      links.forEach(l => {
        if ((l.source.id || l.source) === id) {
          highlightLinks.add(l);
          visitDown(l.target.id || l.target);
        }
      });
    };

    const visitUp = (id) => {
      links.forEach(l => {
        if ((l.target.id || l.target) === id) {
          highlightLinks.add(l);
          highlightNodes.add(l.source.id || l.source);
          visitUp(l.source.id || l.source);
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
      .nodeLabel(n => {
        const referrals = links.filter(l => (l.source.id || l.source) === n.id).length;
        if (n.type === "root") {
          return `<strong>ROOT</strong> (ID ${n.id})<br/>Donation: $${n.donation}<br/>Chain Total: $${chainTotal(n.id)}<br/>Direct Referrals: ${referrals}`;
        }
        return `<strong>${n.type.toUpperCase()}</strong> (ID ${n.id})<br/>Donation: $${n.donation}<br/>Direct Referrals: ${referrals}`;
      })
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
      .linkColor(l => selectedNode ? (highlightLinks.has(l) ? COLORS.forward : COLORS.faded) : "rgba(180,180,180,0.3)")
      .linkWidth(l => (highlightLinks.has(l) ? 2.5 : 0.4))
      .onNodeClick(highlightPath)
      .d3Force("charge", d3.forceManyBody().strength(-30))
      .d3Force("link", d3.forceLink().distance(40).strength(0.6));

    if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  // --- Slider ---
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
    <span style="color:${COLORS.inactive}">●</span> Inactive<br>
    <span style="color:${COLORS.forward}">●</span> Forward path<br>
    <span style="color:${COLORS.back}">●</span> Backtrace<br>
  `;
  document.body.appendChild(legend);

  // --- ESC clears ---
  window.addEventListener("keydown", e => {
    if (e.key === "Escape") clearHighlights();
  });

  // --- Run ---
  const data = generateUniverse(1000);
  draw(data);
})();
