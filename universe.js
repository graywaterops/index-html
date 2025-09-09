(() => {
  const container = document.getElementById("graph");
  const statusEl  = document.getElementById("status");

  let Graph;
  let nodes = [], links = [];
  let byId = new Map();

  // selection/highlight
  let highlightNodes = new Set(), highlightLinks = new Set();
  let selectedNode = null;

  // view state
  let nodeSize = 4;
  let universeSpread = 60;
  let zoomDist = 90;
  let heatByDonation = false;
  let isolateView = false;
  const visibleTypes = new Set(["root","primary","extra","down","inactive"]); // "inactive" controls leaf outline visibility

  // donation range (for heat color)
  let minDonation = 0, maxDonation = 1;

  const COLORS = {
    root: "#1f4aa8", primary: "#7cc3ff", extra: "#2ecc71",
    down: "#e74c3c",
    inactiveOutline: 0xffdd00,          // yellow outline for leaves
    forward: "#00ff88", back: "#ffdd33",
    selected: "#ffffff", faded: "rgba(100,100,100,0.08)",
    hidden: "rgba(0,0,0,0)"
  };

  const money = v => `$${(v||0).toLocaleString()}`;

  // ------------------------ data generation ------------------------
  function randomDonation() {
    const r = Math.random();
    if (r < 0.75) return Math.floor(50 + Math.random() * 50);
    if (r < 0.95) return Math.floor(100 + Math.random() * 400);
    return Math.floor(500 + Math.random() * 4500);
  }

  function pickBiasedParent() {
    // 35% bias: try to grow branches under extras/downlines so more red appears
    const redPool = nodes.filter(n => n.type === "extra" || n.type === "down");
    if (redPool.length && Math.random() < 0.35) {
      return redPool[Math.floor(Math.random() * redPool.length)];
    }
    return nodes[Math.floor(Math.random() * nodes.length)];
  }

  function generateUniverse(total = 1000, seedRoots = 250) {
    nodes = []; links = []; byId = new Map();
    let id = 0;

    for (let i=0;i<seedRoots;i++) {
      const n = { id:id++, type:"root", donation:randomDonation(), children:[], parent:null, inactive:false };
      nodes.push(n); byId.set(n.id, n);
    }

    // Build remaining with a mild bias toward growing extras/downlines
    for (let i = seedRoots; i < total; i++) {
      const parent = pickBiasedParent();
      const donation = randomDonation();
      let type = "primary";
      if (parent.children.length > 0) type = parent.type === "primary" ? "extra" : "down";

      const child = { id:id++, type, donation, children:[], parent: parent.id, inactive:false };
      nodes.push(child); byId.set(child.id, child);
      parent.children.push(child.id);
      links.push({ source: parent.id, target: child.id });
    }

    // Mark leaves as inactive (boolean) WITHOUT changing their type/color
    nodes.forEach(n => { n.inactive = (n.children.length === 0); });

    // donation range for heat colors
    minDonation = Math.min(...nodes.map(n=>n.donation));
    maxDonation = Math.max(...nodes.map(n=>n.donation));

    return { nodes, links };
  }

  // ------------------------ metrics ------------------------
  function getBloodlineTotal(rootId){
    let total = 0; const seen = new Set();
    (function dfs(id){
      if (seen.has(id)) return;
      seen.add(id);
      const n = byId.get(id); if (!n) return;
      total += n.donation || 0;
      n.children.forEach(dfs);
    })(rootId);
    return total;
  }

  function getSubtreeStats(rootId){
    let count=0,total=0,depth=0;
    (function dfs(id,d){
      count++; depth = Math.max(depth,d);
      const n = byId.get(id); if (!n) return;
      total += n.donation||0;
      n.children.forEach(c=>dfs(c,d+1));
    })(rootId,0);
    return {count,total,depth};
  }

  function collectSubtree(rootId){
    const rows = [];
    (function dfs(id){
      const n = byId.get(id); if (!n) return;
      rows.push({ id:n.id, type:n.type, donation:n.donation, parent:n.parent, inactive:n.inactive });
      n.children.forEach(dfs);
    })(rootId);
    return rows;
  }

  // ------------------------ highlight ------------------------
  function clearHighlights(){
    highlightNodes.clear();
    highlightLinks.clear();
    selectedNode = null;
    if (statusEl) statusEl.textContent =
      `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    Graph.refresh();
    updateExportState();
    syncQuery();
  }

  function highlightPath(node){
    highlightNodes.clear();
    highlightLinks.clear();
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

    const stats = getSubtreeStats(node.id);
    if (statusEl){
      statusEl.textContent =
        `Focused coin #${node.id} — subtree: ${stats.count} donors, ${money(stats.total)} total, depth ${stats.depth}. (ESC to reset)`;
    }
    Graph.refresh();
    updateExportState();
    focusCamera(node);
    syncQuery();
  }

  function nodeIsVisibleByType(n){
    // Use "inactive" as a filter key to show/hide leaf outlines;
    // the node’s fill color always comes from its true type or heat.
    const key = n.inactive ? "inactive" : n.type;
    return visibleTypes.has(key);
  }
  function nodeShouldDisplay(n){
    if (!nodeIsVisibleByType(n)) return false;
    if (isolateView && selectedNode) return highlightNodes.has(n.id);
    return true;
  }

  // ------------------------ camera ------------------------
  function focusCamera(node){
    if (!node) return;
    const dist = zoomDist;
    const lookAt = { x: node.x, y: node.y, z: node.z };
    const camPos = { x: node.x + dist, y: node.y + dist*0.8, z: node.z + dist };
    Graph.cameraPosition(camPos, lookAt, 800);
  }

  // ------------------------ rendering helpers ------------------------
  // Radius from current settings
  function radiusFor(n){
    if (!nodeShouldDisplay(n)) return 0.001;
    if (heatByDonation) return Math.max(2, nodeSize * (n.donation / 100));
    return nodeSize;
  }

  // Base color for the node (without highlighting/fading)
  function baseColorFor(n){
    if (heatByDonation){
      // gradient: green (min) → yellow → red (max)
      const t = (n.donation - minDonation) / Math.max(1, (maxDonation - minDonation));
      const r = Math.floor(255 * t);
      const g = Math.floor(255 * (1 - 0.3*t));
      return new THREE.Color(`rgb(${r},${g},60)`);
    }
    const map = { root: COLORS.root, primary: COLORS.primary, extra: COLORS.extra, down: COLORS.down };
    return new THREE.Color(map[n.type] || "#aaaaaa");
  }

  // Update material/visibility/outline when state changes
  function updateNodeObject(obj, n){
    obj.visible = nodeShouldDisplay(n);
    if (!obj.visible) return;

    // scale the sphere (base sphere at radius 1)
    const r = Math.max(0.001, radiusFor(n));
    obj.scale.set(r, r, r);

    // choose display color considering selection state
    let color = baseColorFor(n);
    if (selectedNode){
      if (!highlightNodes.has(n.id)) {
        color = new THREE.Color(COLORS.faded);
      } else if (n.id === selectedNode.id){
        color = new THREE.Color(COLORS.selected);
      }
    }
    const mesh = obj.getObjectByName("__fill");
    if (mesh && mesh.material && mesh.material.color) {
      mesh.material.color.copy(color);
    }

    // outline only for leaves
    const outline = obj.getObjectByName("__outline");
    if (outline){
      outline.visible = !!n.inactive;
      // keep outline slightly larger than fill
      outline.scale.set(1.18, 1.18, 1.18);
    }
  }

  // ------------------------ draw ------------------------
  function draw({nodes, links}){
    Graph = ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({nodes, links})
      .nodeLabel(n => {
        const total = getBloodlineTotal(n.id);
        const key = n.inactive ? "inactive" : n.type;
        return `
          <div>
            <b>${key.toUpperCase()}</b><br/>
            Coin #: ${n.id}<br/>
            Donation: ${money(n.donation)}<br/>
            <b>Bloodline Total:</b> ${money(total)}
          </div>`;
      })
      // Custom 3D object so we can draw a leaf-outline
      .nodeThreeObject(n => {
        // base sphere at radius 1, we’ll scale it in update
        const geo = new THREE.SphereGeometry(1, 10, 10);
        const mat = new THREE.MeshPhongMaterial({ color: baseColorFor(n), shininess: 12 });
        const sphere = new THREE.Mesh(geo, mat);
        sphere.name = "__fill";

        const group = new THREE.Group();
        group.add(sphere);

        // yellow wireframe outline (hidden until we mark leaf)
        const wireGeo = new THREE.SphereGeometry(1.01, 10, 10);
        const wireMat = new THREE.MeshBasicMaterial({ color: COLORS.inactiveOutline, wireframe: true, transparent: true, opacity: 0.95 });
        const outline = new THREE.Mesh(wireGeo, wireMat);
        outline.name = "__outline";
        outline.visible = !!n.inactive;
        group.add(outline);

        // initial size/color
        updateNodeObject(group, n);
        return group;
      })
      .nodeThreeObjectUpdate(updateNodeObject)
      .linkColor(l => {
        const src = l.source, tgt = l.target;
        const show = nodeShouldDisplay(src) && nodeShouldDisplay(tgt);
        if (!show) return COLORS.hidden;
        if (selectedNode) return highlightLinks.has(l) ? COLORS.forward : COLORS.faded;
        return "rgba(180,180,180,0.2)";
      })
      .linkWidth(l => (highlightLinks.has(l) ? 2.2 : 0.4))
      .onNodeClick(highlightPath)
      .d3Force("charge", d3.forceManyBody().strength(-universeSpread))
      .d3Force("link",   d3.forceLink().distance(universeSpread).strength(0.4))
      .d3Force("center", d3.forceCenter(0,0,0));

    if (statusEl) statusEl.textContent =
      `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;

    // ESC to reset
    window.addEventListener("keydown", ev => { if (ev.key === "Escape") clearHighlights(); });

    // honor URL ?find= after layout
    Graph.onEngineStop(() => {
      const params = new URLSearchParams(location.search);
      const qFind = params.get("find");
      if (qFind) tryFindAndFocus(qFind);
    });
  }

  // ------------------------ UI: controls (bottom-left) ------------------------
  const controls = document.createElement("div");
  Object.assign(controls.style, {
    position:"absolute", left:"20px", bottom:"20px",
    background:"rgba(0,0,0,0.6)", color:"#fff",
    padding:"10px", borderRadius:"8px", lineHeight:"1.1"
  });

  // Node Size
  const labelNode = document.createElement("label");
  labelNode.textContent = "Node Size:";
  labelNode.style.display = "block";
  const sliderNode = document.createElement("input");
  sliderNode.type = "range"; sliderNode.min = 2; sliderNode.max = 12; sliderNode.value = nodeSize;
  sliderNode.oninput = e => { nodeSize = +e.target.value; Graph.refresh(); syncQuery(); };
  controls.append(labelNode, sliderNode, document.createElement("br"));

  // Universe Spread
  const labelSpread = document.createElement("label");
  labelSpread.textContent = "Universe Spread:";
  labelSpread.style.display = "block";
  const sliderSpread = document.createElement("input");
  sliderSpread.type = "range"; sliderSpread.min = 20; sliderSpread.max = 160; sliderSpread.value = universeSpread;
  sliderSpread.oninput = e => {
    universeSpread = +e.target.value;
    Graph.d3Force("charge", d3.forceManyBody().strength(-universeSpread));
    Graph.d3Force("link",   d3.forceLink().distance(universeSpread).strength(0.4));
    Graph.numDimensions(3);
    Graph.refresh(); syncQuery();
  };
  controls.append(labelSpread, sliderSpread, document.createElement("br"));

  // Zoom Distance
  const labelZoom = document.createElement("label");
  labelZoom.textContent = "Zoom Distance:";
  labelZoom.style.display = "block";
  const sliderZoom = document.createElement("input");
  sliderZoom.type = "range"; sliderZoom.min = 20; sliderZoom.max = 250; sliderZoom.value = zoomDist;
  sliderZoom.oninput = e => { zoomDist = +e.target.value; syncQuery(); };
  controls.append(labelZoom, sliderZoom);

  document.body.appendChild(controls);

  // ------------------------ UI: legend (top-right) ------------------------
  const legend = document.createElement("div");
  Object.assign(legend.style, {
    position:"absolute", top:"10px", right:"10px",
    background:"rgba(0,0,0,0.7)", color:"#fff",
    padding:"10px", borderRadius:"6px"
  });
  legend.innerHTML = `
    <b>Legend</b><br>
    <span style="color:${COLORS.root}">●</span> Root<br>
    <span style="color:${COLORS.primary}">●</span> Primary<br>
    <span style="color:${COLORS.extra}">●</span> Extra<br>
    <span style="color:${COLORS.down}">●</span> Downline<br>
    <span style="color:#ffdd00">◌</span> Leaf outline (inactive)<br>
    <span style="color:${COLORS.forward}">●</span> Forward path<br>
    <span style="color:${COLORS.back}">●</span> Backtrace<br>
  `;
  document.body.appendChild(legend);

  // ------------------------ UI: topbar (find/heat/isolate/export) ------------------------
  const topbar = document.createElement("div");
  Object.assign(topbar.style, {
    position:"absolute", left:"20px", top:"20px",
    display:"flex", gap:".5rem", alignItems:"center",
    background:"rgba(0,0,0,0.6)", padding:"10px", borderRadius:"8px", color:"#fff"
  });

  topbar.innerHTML = `
    <input id="findInput" inputmode="numeric" pattern="[0-9]*"
      placeholder="Find coin # (e.g., 2436)"
      style="width:210px;padding:.5rem .65rem;border-radius:.5rem;border:1px solid #334;background:#0b1220;color:#cfe3ff;">
    <button id="findBtn" style="padding:.55rem .8rem;border-radius:.5rem;border:0;background:#3478f6;color:#fff;">Find</button>
    <label style="display:flex;gap:.35rem;align-items:center;">
      <input type="checkbox" id="heatChk"> Heat by $ </label>
    <label style="display:flex;gap:.35rem;align-items:center;">
      <input type="checkbox" id="isolateChk"> Isolate subtree </label>
    <button id="exportBtn" style="padding:.45rem .7rem;border-radius:.5rem;border:1px solid #444;background:#0b1220;color:#cfe3ff;opacity:.6;cursor:not-allowed;">
      Export CSV
    </button>
  `;
  document.body.appendChild(topbar);

  const findInput = topbar.querySelector("#findInput");
  const findBtn   = topbar.querySelector("#findBtn");
  const heatChk   = topbar.querySelector("#heatChk");
  const isolateChk= topbar.querySelector("#isolateChk");
  const exportBtn = topbar.querySelector("#exportBtn");

  findBtn.addEventListener("click", () => tryFindAndFocus(findInput.value));
  findInput.addEventListener("keydown", e => { if (e.key === "Enter") tryFindAndFocus(findInput.value); });

  heatChk.addEventListener("change", e => { heatByDonation = !!e.target.checked; Graph.refresh(); syncQuery(); });
  isolateChk.addEventListener("change", e => { isolateView = !!e.target.checked; Graph.refresh(); syncQuery(); });

  function updateExportState(){
    if (selectedNode){
      exportBtn.style.opacity = "1"; exportBtn.style.cursor="pointer";
      exportBtn.disabled = false;
    } else {
      exportBtn.style.opacity = ".6"; exportBtn.style.cursor="not-allowed";
      exportBtn.disabled = true;
    }
  }

  exportBtn.addEventListener("click", () => {
    if (!selectedNode) return;
    const rows = collectSubtree(selectedNode.id);
    const header = "coin_id,type,donation,parent_id,inactive\n";
    const body = rows.map(r => `${r.id},${r.type},${r.donation},${r.parent??""},${r.inactive}`).join("\n");
    const blob = new Blob([header+body], {type:"text/csv"});
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `subtree_${selectedNode.id}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  // ------------------------ UI: type filters (under topbar) ------------------------
  const filters = document.createElement("div");
  Object.assign(filters.style, {
    position:"absolute", left:"20px", top:"78px",
    background:"rgba(0,0,0,0.6)", color:"#fff", padding:"8px 10px",
    borderRadius:"8px", display:"grid", gridTemplateColumns:"auto auto", gap:"6px 16px"
  });

  const TYPES = [
    ["root","Root"],["primary","Primary"],["extra","Extra"],["down","Downline"],["inactive","Inactive (leaf outline)"]
  ];

  TYPES.forEach(([key,label])=>{
    const w = document.createElement("label");
    w.style.display="flex"; w.style.alignItems="center"; w.style.gap=".35rem";
    const c = document.createElement("input"); c.type="checkbox"; c.checked = true;
    c.addEventListener("change", ()=>{ if (c.checked) visibleTypes.add(key); else visibleTypes.delete(key); Graph.refresh(); syncQuery(); });
    w.appendChild(c); w.appendChild(document.createTextNode(label));
    filters.appendChild(w);
  });
  document.body.appendChild(filters);

  // ------------------------ find logic ------------------------
  function tryFindAndFocus(raw){
    const id = Number(String(raw||"").replace(/\D/g,""));
    if (!Number.isFinite(id)) return pulse(findInput,"#ff6b6b");

    const node = byId.get(id);
    if (!node) return pulse(findInput,"#ffb020");

    const waitForPos = () => (Number.isFinite(node.x) ? Promise.resolve() :
      new Promise(res => setTimeout(()=>res(waitForPos()), 120)));

    waitForPos().then(()=>{
      highlightPath(node); // will camera-focus
      pulse(findInput, "#00ff9c");
    });
  }

  function pulse(el,color){
    const old = el.style.boxShadow;
    el.style.boxShadow = `0 0 0 3px ${color}55`;
    setTimeout(()=> el.style.boxShadow = old, 450);
  }

  // ------------------------ URL params ------------------------
  function applyQuery(){
    const p = new URLSearchParams(location.search);

    const qSize = +p.get("size");     if (qSize)  { nodeSize = qSize; sliderNode.value = nodeSize; }
    const qSpread = +p.get("spread"); if (qSpread){ universeSpread = qSpread; sliderSpread.value = universeSpread; }
    const qZoom = +p.get("zoom");     if (qZoom)  { zoomDist = qZoom; sliderZoom.value = zoomDist; }
    const qIsolate = p.get("isolate");if (qIsolate === "1"){ isolateView = true; isolateChk.checked = true; }
    const qHeat = p.get("heat");      if (qHeat === "1"){ heatByDonation = true; heatChk.checked = true; }
    const qTypes = p.get("types");
    if (qTypes){
      visibleTypes.clear();
      qTypes.split(",").forEach(t => { if (t) visibleTypes.add(t); });
      Array.from(filters.querySelectorAll("input[type=checkbox]")).forEach((cb,i)=>{
        const key = TYPES[i][0]; cb.checked = visibleTypes.has(key);
      });
    }
  }

  function syncQuery(){
    const p = new URLSearchParams(location.search);
    if (selectedNode) p.set("find", selectedNode.id); else p.delete("find");
    p.set("size", String(nodeSize));
    p.set("spread", String(universeSpread));
    p.set("zoom", String(zoomDist));
    p.set("isolate", isolateView ? "1" : "0");
    p.set("heat", heatByDonation ? "1" : "0");
    p.set("types", Array.from(visibleTypes).join(","));
    window.history.replaceState({}, "", `${location.pathname}?${p.toString()}`);
  }

  // ------------------------ run ------------------------
  const data = generateUniverse(3200, 250);
  draw(data);
  applyQuery(); // load URL state
})();
