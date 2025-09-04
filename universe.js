(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");

  let Graph;
  let nodes = [], links = [];
  let highlightNodes = new Set(), highlightLinks = new Set();
  let selectedNode = null;
  let nodeSize = 4;
  let spreadStrength = -40; // default spread

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

  // --- Donation generator (log-normal skewed) ---
  function generateDonation() {
    // log-normal distribution: many ~50-100, few ~500-1000, rare up to ~5000
    const mean = Math.log(80);  // center around $80
    const sigma = 0.8;          // skew
    let donation = Math.exp(mean + sigma * (Math.random() * 2 - 1));
    donation = Math.max(50, Math.min(donation, 5000));
    return Math.round(donation);
  }

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
      return PROBS[0];
    };

    for (let i = 0; i < total; i++) {
      const cat = pickCategory();
      const rootId = id++;
      nodes.push({ id: rootId, type: "root", donation: generateDonation() });

      if (cat.type === "root") {
        // root with no referrals = inactive
        nodes[rootId].type = "inactive";
        continue;
      }

      const primaryId = id++;
      nodes.push({ id: primaryId, type: "primary", donation: generateDonation() });
      links.push({ source: rootId, target: primaryId });

      if (cat.extras > 0) {
        for (let e = 0; e < cat.extras; e++) {
          const extraId = id++;
          nodes.push({ id: extraId, type: e === 0 ? "extra" : "down", donation: generateDonation() });
          links.push({ source: primaryId, target: extraId });

          // Short red chain under each extra
          let parent = extraId;
          const chainLen = Math.floor(Math.random() * 3) + 1;
          for (let d = 0; d < chainLen; d++) {
            const downId = id++;
            nodes.push({ id: downId, type: "down", donation: generateDonation() });
            links.push({ source: parent, target: downId });
            parent = downId;
          }
        }
      }
    }
    return { nodes, links };
  }

  // --- Compute bloodline total ---
  function computeBloodlineTotal(rootId) {
    let total = 0;
    const visited = new Set();
    function dfs(id) {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodes.find(n => n.id === id);
      if (node) total += node.donation || 0;
      links.forEach(l => {
        if (l.source.id === id || l.source === id) dfs(l.target.id || l.target);
      });
    }
    dfs(rootId);
    return total;
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
        let base = `<strong>${n.type.toUpperCase()}</strong> (ID ${n.id})<br/>Donation: $${n.donation}`;
        if (n.type === "root") {
          base += `<br/>Bloodline total: $${computeBloodlineTotal(n.id)}`;
        }
        return base;
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
      .linkColor(l => {
        if (selectedNode) {
          return highlightLinks.has(l) ? COLORS.forward : COLORS.faded;
        }
        return "rgba(180,180,180,0.3)";
      })
      .linkWidth(l => (highlightLinks.has(l) ? 2.5 : 0.4))
      .onNodeClick(highlightPath)
      .d3Force("charge", d3.forceManyBody().strength(spreadStrength))
      .d3Force("link", d3.forceLink().distance(40).strength(0.6));

    if (statusEl) {
      statusEl.textContent =
        `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    }
  }

  // --- Controls ---
  function addControls() {
    const panel = document.createElement("div");
    panel.style.position = "absolute";
    panel.style.left = "20px";
    panel.style.bottom = "20px";
    panel.style.background = "rgba(0,0,0,0.5)";
    panel.style.color = "#fff";
    panel.style.padding = "10px";
    panel.style.borderRadius = "6px";

    // Node size
    const nodeLabel = document.createElement("label");
    nodeLabel.textContent = "Node Size:";
    const nodeSlider = document.createElement("input");
    nodeSlider.type = "range";
    nodeSlider.min = 2;
    nodeSlider.max = 12;
    nodeSlider.value = nodeSize;
    nodeSlider.oninput = e => {
      nodeSize = +e.target.value;
      Graph.nodeVal(() => nodeSize);
      Graph.refresh();
    };

    // Universe spread
    const spreadLabel = document.createElement("label");
    spreadLabel.textContent = "Universe Spread:";
    const spreadSlider = document.createElement("input");
    spreadSlider.type = "range";
    spreadSlider.min = -200;
    spreadSlider.max = -10;
    spreadSlider.value = spreadStrength;
    spreadSlider.oninput = e => {
      spreadStrength = +e.target.value;
      Graph.d3Force("charge", d3.forceManyBody().strength(spreadStrength));
      Graph.d3ReheatSimulation();
    };

    panel.appendChild(nodeLabel);
    panel.appendChild(nodeSlider);
    panel.appendChild(document.createElement("br"));
    panel.appendChild(spreadLabel);
    panel.appendChild(spreadSlider);
    document.body.appendChild(panel);
  }

  // --- Legend ---
  function addLegend() {
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
      <span style="color:${COLORS.inactive}">●</span> Inactive (new donor)<br>
      <span style="color:${COLORS.forward}">●</span> Forward path<br>
      <span style="color:${COLORS.back}">●</span> Backtrace<br>
    `;
    document.body.appendChild(legend);
  }

  // --- ESC clear selection ---
  window.addEventListener("keydown", ev => {
    if (ev.key === "Escape") clearHighlights();
  });

  // --- Run ---
  const data = generateUniverse(1000);
  draw(data);
  addControls();
  addLegend();
})();
