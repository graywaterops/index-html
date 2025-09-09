(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");

  let Graph;
  let nodes = [], links = [];
  let highlightNodes = new Set(), highlightLinks = new Set();
  let selectedNode = null;
  let nodeSize = 4;
  let universeSpread = 60; // starting spread

  const COLORS = {
    root: "#1f4aa8",       // dark blue
    primary: "#7cc3ff",    // light blue
    extra: "#2ecc71",      // green
    down: "#e74c3c",       // red
    inactive: "#ffdd00",   // yellow
    forward: "#00ff88",    // highlight forward
    back: "#ffdd33",       // highlight back
    selected: "#ffffff",   // clicked node
    faded: "rgba(100,100,100,0.1)"
  };

  // --- Donation generator
  function randomDonation() {
    const r = Math.random();
    if (r < 0.75) return Math.floor(50 + Math.random() * 50);   // 75% between $50-$100
    if (r < 0.95) return Math.floor(100 + Math.random() * 400); // 20% between $100-$500
    return Math.floor(500 + Math.random() * 4500);              // 5% between $500-$5000
  }

  // --- Universe builder
  function generateUniverse(total = 1000, seedRoots = 250) {
    nodes = [];
    links = [];
    let id = 0;

    // Create initial roots
    for (let i = 0; i < seedRoots; i++) {
      nodes.push({ id: id++, type: "root", donation: randomDonation(), children: [] });
    }

    // Build rest of the donors
    for (let i = seedRoots; i < total; i++) {
      const parent = nodes[Math.floor(Math.random() * nodes.length)];
      const donation = randomDonation();

      // Assign type: first referral = primary, second+ = extra, under extra = downline
      let type = "primary";
      if (parent.children.length > 0) type = parent.type === "primary" ? "extra" : "down";

      const child = { id: id++, type, donation, children: [] };
      nodes.push(child);
      parent.children.push(child.id);
      links.push({ source: parent.id, target: child.id });
    }

    // Mark inactive nodes (no children)
    nodes.forEach(n => {
      if (n.children.length === 0) n.type = "inactive";
    });

    return { nodes, links };
  }

  // --- Bloodline total calculation
  function getBloodlineTotal(rootId) {
    let total = 0;
    const visited = new Set();
    function dfs(id) {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodes.find(n => n.id === id);
      if (!node) return;
      total += node.donation || 0;
      node.children.forEach(dfs);
    }
    dfs(rootId);
    return total;
  }

  // --- Highlight logic
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

  // --- Draw graph
  function draw({ nodes, links }) {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({ nodes, links })
      .nodeLabel(n => {
        const total = n.type === "root" ? getBloodlineTotal(n.id) : null;
        return `
          <div>
            <b>${n.type.toUpperCase()}</b><br/>
            Coin #: ${n.id}<br/>
            Donation: $${n.donation}<br/>
            ${total ? `<b>Bloodline Total:</b> $${total}` : ""}
          </div>`;
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
        return "rgba(180,180,180,0.2)";
      })
      .linkWidth(l => (highlightLinks.has(l) ? 2.2 : 0.4))
      .onNodeClick(highlightPath)
      .d3Force("charge", d3.forceManyBody().strength(-universeSpread))
      .d3Force("link", d3.forceLink().distance(universeSpread).strength(0.4))
      .d3Force("center", d3.forceCenter(0, 0, 0));

    if (statusEl) {
      statusEl.textContent =
        `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    }

    // ESC to reset
    window.addEventListener("keydown", ev => {
      if (ev.key === "Escape") clearHighlights();
    });

    // After engine settles, honor any ?find= query
    Graph.onEngineStop(() => {
      const params = new URLSearchParams(location.search);
      const q = params.get("find");
      if (q) tryFindAndFocus(q);
    });
  }

  // --- Controls
  const controls = document.createElement("div");
  controls.style.position = "absolute";
  controls.style.left = "20px";
  controls.style.bottom = "20px";
  controls.style.background = "rgba(0,0,0,0.6)";
  controls.style.color = "#fff";
  controls.style.padding = "10px";
  controls.style.borderRadius = "8px";

  // Node Size
  const sliderNode = document.createElement("input");
  sliderNode.type = "range";
  sliderNode.min = 2;
  sliderNode.max = 12;
  sliderNode.value = nodeSize;
  sliderNode.oninput = e => {
    nodeSize = +e.target.value;
    Graph.nodeVal(() => nodeSize);
    Graph.refresh();
  };
  controls.append("Node Size:", sliderNode, document.createElement("br"));

  // Universe Spread
  const sliderSpread = document.createElement("input");
  sliderSpread.type = "range";
  sliderSpread.min = 20;
  sliderSpread.max = 120;
  sliderSpread.value = universeSpread;
  sliderSpread.oninput = e => {
    universeSpread = +e.target.value;
    Graph.d3Force("charge", d3.forceManyBody().strength(-universeSpread));
    Graph.d3Force("link", d3.forceLink().distance(universeSpread).strength(0.4));
    Graph.numDimensions(3); // keep globe-like
    Graph.refresh();
  };
  controls.append("Universe Spread:", sliderSpread);

  document.body.appendChild(controls);

  // --- Legend
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

  // --- Finder UI (top-left above controls)
  const finder = document.createElement("div");
  finder.style.position = "absolute";
  finder.style.left = "20px";
  finder.style.top = "20px";
  finder.style.display = "flex";
  finder.style.gap = ".5rem";
  finder.style.alignItems = "center";
  finder.style.background = "rgba(0,0,0,0.6)";
  finder.style.padding = "10px";
  finder.style.borderRadius = "8px";
  finder.innerHTML = `
    <input id="findInput" inputmode="numeric" pattern="[0-9]*"
      placeholder="Find coin # (e.g., 2436)"
      style="width:210px;padding:.5rem .65rem;border-radius:.5rem;border:1px solid #334;background:#0b1220;color:#cfe3ff;">
    <button id="findBtn" style="padding:.55rem .8rem;border-radius:.5rem;border:0;background:#3478f6;color:#fff;">
      Find
    </button>
  `;
  document.body.appendChild(finder);

  const findInput = finder.querySelector("#findInput");
  const findBtn = finder.querySelector("#findBtn");
  findBtn.addEventListener("click", () => tryFindAndFocus(findInput.value));
  findInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryFindAndFocus(findInput.value); });

  function tryFindAndFocus(raw) {
    const id = Number(String(raw || "").replace(/\D/g, ""));
    if (!id && id !== 0) return pulse(findInput, "#ff6b6b");

    const node = nodes.find(n => n.id === id);
    if (!node) return pulse(findInput, "#ffb020");

    // If layout hasn't assigned coordinates yet, wait for it
    const waitForPos = () => (Number.isFinite(node.x) ? Promise.resolve() :
      new Promise(res => setTimeout(() => res(waitForPos()), 120)));
    waitForPos().then(() => {
      highlightPath(node);
      // camera fly-to with a small offset to frame the node
      const dist = 40; // adjust for your scene scale
      const lookAt = { x: node.x, y: node.y, z: node.z };
      const camPos = {
        x: node.x + dist,
        y: node.y + dist * 0.8,
        z: node.z + dist
      };
      Graph.cameraPosition(camPos, lookAt, 900);
      pulse(findInput, "#00ff9c");
    });
  }

  function pulse(el, color) {
    const old = el.style.boxShadow;
    el.style.boxShadow = `0 0 0 3px ${color}55`;
    setTimeout(() => (el.style.boxShadow = old), 450);
  }

  // --- Run
  const data = generateUniverse(3200, 250);
  draw(data);
})();
