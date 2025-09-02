(() => {
  // --- CONFIG ---------------------------------------------------------------
  const CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/pub?gid=317266263&single=true&output=csv";

  const MIN_GIFT = 50;                // hard floor
  const COOL_TICKS = 200;             // layout warm-up ticks
  const FREEZE_DELAY_MS = 0;          // freeze as soon as engine stops

  // --- DOM ------------------------------------------------------------------
  const elGraph = document.getElementById("graph");
  const elStatus = document.getElementById("status");
  const clearBtn = document.getElementById("clearBtn");
  const fitBtn = document.getElementById("fitBtn");

  // --- STATE ----------------------------------------------------------------
  let Graph;                          // 3D force graph instance
  let nodes = [];                     // node objects { id, type, gift, h }
  let links = [];                     // link objects { source, target, h }
  let pinned = false;                 // whether we've frozen node positions
  let selectedId = null;              // currently selected node id

  // adjacency caches (never rebuilt on click)
  const childrenMap = new Map();      // id -> Set(childIds)
  const parentMap = new Map();        // childId -> parentId
  const linkByKey = new Map();        // "sid-tid" -> link
  const nodeById = new Map();         // id -> node

  const getId = v => (typeof v === "object" ? v.id : v);

  // --- UTILS ----------------------------------------------------------------
  function csvParseLine(line) {
    const out = []; let cur = "", inQuotes = false;
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
  const num = s => {
    if (s == null) return NaN;
    const v = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(v) ? v : NaN;
  };
  const prob = s => {
    if (s == null) return NaN;
    let v = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(v)) return NaN;
    // Handle "30" (percent) vs "0.3" (fraction)
    if (v > 1) v = v / 100;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    return v;
  };
  const normalize = arr => {
    const sum = arr.reduce((a, b) => a + b.p, 0) || 1;
    arr.forEach(o => (o.p = o.p / sum));
    return arr;
  };
  const clampMinGift = v => Math.max(MIN_GIFT, Math.round(v));

  // Build adjacency caches once after graph data is created
  function buildAdjacency() {
    childrenMap.clear(); parentMap.clear(); linkByKey.clear(); nodeById.clear();
    nodes.forEach(n => nodeById.set(n.id, n));
    links.forEach(l => {
      const s = getId(l.source), t = getId(l.target);
      if (!childrenMap.has(s)) childrenMap.set(s, new Set());
      childrenMap.get(s).add(t);
      parentMap.set(t, s);
      linkByKey.set(`${s}-${t}`, l);
    });
  }

  // Clear all highlight flags (nodes & links)
  function clearHighlights() {
    selectedId = null;
    nodes.forEach(n => (n.h = 0));
    links.forEach(l => (l.h = 0));
    refreshStyles();
    status(`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`);
  }

  // Highlight forward/downline (green) and backtrace (amber) from a node
  function highlightFrom(startNode) {
    if (!startNode) return;
    clearHighlights(); // reset first (does not reheat)
    selectedId = startNode.id;
    const sel = nodeById.get(selectedId);
    if (!sel) return;
    sel.h = 3; // selected

    // backtrace to root(s)
    let cur = sel.id;
    while (parentMap.has(cur)) {
      const p = parentMap.get(cur);
      const pn = nodeById.get(p);
      if (pn && pn.h !== 3) pn.h = Math.max(pn.h || 0, 2); // back color
      const lk = linkByKey.get(`${p}-${cur}`);
      if (lk) lk.h = Math.max(lk.h || 0, 2);
      cur = p;
    }

    // forward / downline
    const stack = [sel.id];
    const seen = new Set([sel.id]);
    while (stack.length) {
      const id = stack.pop();
      const childs = childrenMap.get(id);
      if (!childs) continue;
      for (const c of childs) {
        if (!seen.has(c)) {
          const cn = nodeById.get(c);
          if (cn && cn.h !== 3) cn.h = Math.max(cn.h || 0, 1); // forward color
          const lk = linkByKey.get(`${id}-${c}`);
          if (lk) lk.h = Math.max(lk.h || 0, 1);
          seen.add(c);
          stack.push(c);
        }
      }
    }

    refreshStyles();
    status(
      `Selected #${sel.id} — forward path (green) and backtrace to root (amber) highlighted.`
    );
  }

  // Force 3d-force-graph to re-evaluate styling WITHOUT reheating
  function refreshStyles() {
    if (!Graph) return;
    if (typeof Graph.refresh === "function") {
      Graph.refresh();
    } else {
      // fallback: reapply accessors to force reevaluation
      Graph
        .nodeColor(Graph.nodeColor())
        .nodeVal(Graph.nodeVal())
        .linkColor(Graph.linkColor())
        .linkWidth(Graph.linkWidth())
        .linkDirectionalParticles(Graph.linkDirectionalParticles())
        .linkDirectionalParticleWidth(Graph.linkDirectionalParticleWidth())
        .linkDirectionalParticleSpeed(Graph.linkDirectionalParticleSpeed());
    }
  }

  function status(msg) {
    if (elStatus) elStatus.textContent = `Status: ${msg}`;
  }

  // --- INPUTS ---------------------------------------------------------------
  async function loadInputs() {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    const text = await res.text();

    const rows = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(csvParseLine);

    const referral = []; // {k, p}
    const gifts = [];    // {amount, p}
    let seeds = 1000;
    let generations = 6;

    for (const r of rows) {
      const a = r[0]?.trim();
      const b = r[1]?.trim();

      // config rows
      if (/seed/i.test(a)) {
        const v = num(b);
        if (Number.isFinite(v) && v > 0) seeds = Math.floor(v);
        continue;
      }
      if (/generation/i.test(a)) {
        const v = num(b);
        if (Number.isFinite(v) && v > 0) generations = Math.floor(v);
        continue;
      }

      // probability tables (Column B = probabilities for both tables)
      const aval = num(a);
      const pval = prob(b);

      // referral counts: small integer k (0..10) with a probability
      if (Number.isInteger(aval) && aval >= 0 && aval <= 10 && Number.isFinite(pval)) {
        referral.push({ k: aval, p: pval });
        continue;
      }

      // donation amounts: dollars (>= 50) with a probability
      if (Number.isFinite(aval) && aval >= MIN_GIFT && Number.isFinite(pval)) {
        gifts.push({ amount: clampMinGift(aval), p: pval });
        continue;
      }
    }

    // Fallbacks if the sheet is missing something
    if (!referral.length) {
      // default: 0..3 (40%/30%/20%/10%)
      referral.push({ k: 0, p: 0.4 }, { k: 1, p: 0.3 }, { k: 2, p: 0.2 }, { k: 3, p: 0.1 });
    }
    if (!gifts.length) {
      gifts.push(
        { amount: 50, p: 0.4 },
        { amount: 100, p: 0.35 },
        { amount: 250, p: 0.15 },
        { amount: 500, p: 0.1 }
      );
    }

    normalize(referral);
    normalize(gifts);

    return { referralProbs: referral, giftProbs: gifts, seeds, generations };
  }

  // --- UNIVERSE GENERATION --------------------------------------------------
  function sampleFrom(dist, valueKey) {
    const r = Math.random();
    let acc = 0;
    for (const d of dist) {
      acc += d.p;
      if (r <= acc) return d[valueKey];
    }
    return dist.at(-1)[valueKey]; // fallback
  }

  function generateUniverse({ referralProbs, giftProbs, seeds, generations }) {
    nodes = []; links = [];
    let nextId = 0;

    const addNode = (type, parentId = null) => {
      const gift = sampleFrom(giftProbs, "amount");
      const n = { id: nextId++, type, gift: clampMinGift(gift), h: 0 };
      nodes.push(n);
      if (parentId != null) links.push({ source: parentId, target: n.id, h: 0 });
      return n.id;
    };

    function grow(parentId, depth, parentType) {
      if (depth >= generations) return;
      const k = sampleFrom(referralProbs, "k");
      if (k <= 0) return;

      // first referral is "primary", siblings as "extra" (red)
      const firstId = addNode("primary", parentId);
      grow(firstId, depth + 1, "primary");
      for (let i = 1; i < k; i++) {
        const cId = addNode("extra", parentId);
        grow(cId, depth + 1, "extra");
      }
    }

    for (let i = 0; i < seeds; i++) {
      const rootId = addNode("root", null);
      grow(rootId, 0, "root");
    }

    return { nodes, links };
  }

  // --- GRAPH ----------------------------------------------------------------
  function initGraph() {
    Graph = ForceGraph3D()(elGraph)
      .backgroundColor("#000")
      .graphData({ nodes, links })

      // labels
      .nodeLabel(n => `
        <div style="font-size:12px">
          <b>${n.type}</b> #${n.id}<br/>
          Gift: $${n.gift.toLocaleString()}
        </div>`)

      // draw sizes and colors read from flags (no reheat on change)
      .nodeVal(n => (n.h === 3 ? 12 : n.type === "root" ? 10 : n.type === "primary" ? 8 : 6))
      .nodeColor(n => {
        if (n.h === 3) return "#ffffff";     // selected
        if (n.h === 2) return "#ffcc33";     // backtrace
        if (n.h === 1) return "#00ff88";     // forward
        // base palette
        return n.type === "root"   ? "#153d8a" :
               n.type === "primary"? "#7cc3ff" :
               n.type === "extra"  ? "#e74c3c" : "#9e9e9e";
      })

      .linkColor(l => (l.h === 2 ? "#ffcc33" : l.h === 1 ? "#00ff88" : "rgba(170,170,170,0.16)"))
      .linkWidth(l => (l.h ? 2.2 : 0.5))
      .linkDirectionalParticles(l => (l.h ? 4 : 0))
      .linkDirectionalParticleWidth(l => (l.h ? 2 : 0))
      .linkDirectionalParticleSpeed(l => (l.h === 2 ? 0.003 : l.h === 1 ? 0.006 : 0.0))

      // interaction
      .onNodeClick(n => {
        highlightFrom(n);          // never calls graphData() -> no reheat
      })
      .onNodeRightClick(() => {    // quick reset
        clearHighlights();
      })

      // simulation tune (no direct d3 reference needed)
      .cooldownTicks(COOL_TICKS)
      .d3VelocityDecay(0.9);

    // spacing: stretch the graph a bit without making it explosive
    const linkForce = Graph.d3Force("link");
    if (linkForce && typeof linkForce.distance === "function") {
      linkForce.distance(60).strength(0.2);
    }
    const chargeForce = Graph.d3Force("charge");
    if (chargeForce && typeof chargeForce.strength === "function") {
      chargeForce.strength(-25);
    }

    // Freeze layout once the engine stops, so it NEVER drifts
    Graph.onEngineStop(() => {
      if (pinned) return;
      setTimeout(() => {
        // Pin current coordinates & kill velocities
        nodes.forEach(n => {
          n.fx = n.x; n.fy = n.y; n.fz = n.z;
          n.vx = 0; n.vy = 0; n.vz = 0;
        });
        // Remove forces to avoid accidental reheats
        Graph.d3Force("link", null);
        Graph.d3Force("charge", null);
        Graph.d3Force("center", null);
        Graph.d3VelocityDecay(1);
        pinned = true;
        status(`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`);
      }, FREEZE_DELAY_MS);
    });
  }

  // --- RUN ------------------------------------------------------------------
  (async function main() {
    try {
      status("loading sheet data…");
      const inputs = await loadInputs();

      const data = generateUniverse(inputs);
      nodes = data.nodes;
      links = data.links;

      buildAdjacency();
      initGraph();
      status("building layout… (pins when settled)");
    } catch (err) {
      console.error(err);
      status("error loading inputs");
    }
  })();

  // --- UI -------------------------------------------------------------------
  clearBtn?.addEventListener("click", () => clearHighlights());
  fitBtn?.addEventListener("click", () => {
    if (!Graph) return;
    Graph.zoomToFit(600, 100);
  });
})();
