(() => {
  const CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/pub?gid=317266263&single=true&output=csv";

  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");

  let Graph;

  // ---- Utility: CSV line parser ----
  function parseCsvLine(line) {
    const out = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  async function loadInputs() {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const rows = lines.map(parseCsvLine);

    // Find the referral distribution block
    const referralRows = [];
    for (let r of rows) {
      if (/^0$|^1$|^2$|^3$|^4$|^5$/.test(r[0])) {
        referralRows.push([parseInt(r[0]), parseFloat(r[1])]);
      }
    }

    const probs = referralRows.map(([k, p]) => ({ k, p: p / 100 })); // % to fraction

    // Seed coins
    const seedRow = rows.find(r => r[0] && r[0].toLowerCase().includes("seed coins"));
    const seeds = seedRow ? parseInt(seedRow[1]) : 100;

    // Generations
    const genRow = rows.find(r => r[0] && r[0].toLowerCase().includes("hand-off generations"));
    const generations = genRow ? parseInt(genRow[1]) : 6;

    return { probs, seeds, generations };
  }

  // ---- Simulation generator ----
  function genUniverse({ probs, seeds, generations }) {
    const nodes = [], links = [];
    let id = 0;

    const addNode = (type, parentId = null) => {
      const node = { id: id++, type };
      nodes.push(node);
      if (parentId !== null) links.push({ source: parentId, target: node.id });
      return node.id;
    };

    // Pick k from distribution
    function sampleK() {
      const r = Math.random();
      let sum = 0;
      for (let { k, p } of probs) {
        sum += p;
        if (r <= sum) return k;
      }
      return 0;
    }

    // Recursive growth
    function grow(parentId, depth, parentType = "root") {
      if (depth >= generations) return;
      const k = sampleK();
      if (k <= 0) return;

      // First referral is "primary" unless parent was extra/down
      const firstType = (parentType === "extra" || parentType === "down") ? "down" : "primary";
      const first = addNode(firstType, parentId);
      grow(first, depth + 1, firstType);

      // Extras become "extra" only if parent is root/primary; otherwise cascade "down"
      for (let i = 1; i < k; i++) {
        const type = (parentType === "extra" || parentType === "down") ? "down" : "extra";
        const child = addNode(type, parentId);
        grow(child, depth + 1, type);
      }
    }

    // Seeds
    const roots = [];
    for (let i = 0; i < seeds; i++) {
      roots.push(addNode("root"));
    }
    roots.forEach(r => grow(r, 0, "root"));

    return { nodes, links };
  }

  // ---- Draw with ForceGraph3D ----
  function draw({ nodes, links }) {
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .showNavInfo(false)
      .graphData({ nodes, links })
      .nodeLabel(n => `${n.type} #${n.id}`)
      .nodeColor(n =>
        n.type === "root" ? "#1f4aa8" :
        n.type === "primary" ? "#7cc3ff" :
        n.type === "extra" ? "#2ecc71" :
        "#e74c3c"
      )
      .nodeVal(n =>
        n.type === "root" ? 12 :
        n.type === "primary" ? 8 :
        n.type === "extra" ? 6 : 4
      )
      .linkColor(() => "rgba(180,180,180,0.5)")
      .linkWidth(() => 0.8);

    setTimeout(() => Graph.zoomToFit(600), 500);
    if (statusEl) statusEl.textContent =
      `Status: ${nodes.length} donors, ${links.length} referrals — click/drag to explore.`;
  }

  // ---- Run ----
  (async () => {
    try {
      const { probs, seeds, generations } = await loadInputs();
      console.log("Parsed inputs:", { probs, seeds, generations });
      const data = genUniverse({ probs, seeds, generations });
      draw(data);
    } catch (err) {
      console.error("[3D map] Load error:", err);
      container.innerHTML = `<div style="color:#fff;padding:16px;font:14px/1.4 system-ui">Error: ${err.message}</div>`;
    }
  })();
})();
