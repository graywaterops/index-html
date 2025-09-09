(() => {
  // ---------- Safe-load required libs (Three.js and 3d-force-graph) ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function ensureLibs() {
    if (typeof window.THREE === 'undefined') {
      await loadScript('https://unpkg.com/three@0.155.0/build/three.min.js');
    }
    if (typeof window.ForceGraph3D === 'undefined') {
      await loadScript('https://unpkg.com/3d-force-graph@1.71.6/dist/3d-force-graph.min.js');
    }
  }

  // Kickoff once libs are ready
  ensureLibs().then(start).catch(err => {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = `Failed to load libraries: ${err.message}`;
    console.error(err);
  });

  // ============================== APP ==============================
  function start() {
    const container = document.getElementById("graph");
    const statusEl  = document.getElementById("status");

    const THREE = window.THREE; // guaranteed by ensureLibs()

    let Graph;
    let nodes = [], links = [];
    let byId = new Map();

    // selection/highlight
    let highlightNodes = new Set();
    let highlightLinkKeys = new Set();
    let selectedNode = null;

    // view state
    let nodeSize = 4;
    let universeSpread = 60;
    let zoomDist = 90;
    let heatByDonation = false;
    let isolateView = false;
    const visibleTypes = new Set(["root","primary","extra","down","inactive"]);

    // donation range (for heat)
    let minDonation = 0, maxDonation = 1;

    const COLORS = {
      root: "#1f4aa8", primary: "#7cc3ff", extra: "#2ecc71", down: "#e74c3c",
      inactiveOutline: 0xffdd00,
      forward: "#00ff88", back: "#ffdd33",
      selected: "#ffffff", faded: "rgba(100,100,100,0.08)", hidden: "rgba(0,0,0,0)"
    };

    const money = v => `$${(v||0).toLocaleString()}`;

    // --------- generate data ----------
    function randomDonation() {
      const r = Math.random();
      if (r < 0.75) return Math.floor(50 + Math.random() * 50);
      if (r < 0.95) return Math.floor(100 + Math.random() * 400);
      return Math.floor(500 + Math.random() * 4500);
    }
    function pickBiasedParent() {
      const pool = nodes.filter(n => n.type === "extra" || n.type === "down");
      if (pool.length && Math.random() < 0.35) return pool[Math.floor(Math.random() * pool.length)];
      return nodes[Math.floor(Math.random() * nodes.length)];
    }
    function generateUniverse(total=3200, seedRoots=250){
      nodes=[]; links=[]; byId=new Map();
      let id=0;
      for(let i=0;i<seedRoots;i++){
        const n={id:id++, type:"root", donation:randomDonation(), children:[], parent:null, inactive:false};
        nodes.push(n); byId.set(n.id,n);
      }
      for(let i=seedRoots;i<total;i++){
        const parent=pickBiasedParent();
        const donation=randomDonation();
        let type="primary";
        if(parent.children.length>0) type= parent.type==="primary"?"extra":"down";
        const child={id:id++, type, donation, children:[], parent:parent.id, inactive:false};
        nodes.push(child); byId.set(child.id,child);
        parent.children.push(child.id);
        links.push({source:parent.id, target:child.id}); // keep numeric ids
      }
      nodes.forEach(n=>{ n.inactive=(n.children.length===0); });
      minDonation=Math.min(...nodes.map(n=>n.donation));
      maxDonation=Math.max(...nodes.map(n=>n.donation));
      return {nodes,links};
    }

    // --------- helpers ----------
    function getBloodlineTotal(rootId){
      let total=0; const seen=new Set();
      (function dfs(id){ if(seen.has(id)) return; seen.add(id);
        const n=byId.get(id); if(!n) return;
        total+=n.donation||0; n.children.forEach(dfs);
      })(rootId);
      return total;
    }
    function getSubtreeStats(rootId){
      let count=0,total=0,depth=0;
      (function dfs(id,d){ count++; depth=Math.max(depth,d);
        const n=byId.get(id); if(!n) return;
        total+=n.donation||0; n.children.forEach(c=>dfs(c,d+1));
      })(rootId,0);
      return {count,total,depth};
    }
    function collectSubtree(rootId){
      const rows=[]; (function dfs(id){ const n=byId.get(id); if(!n) return;
        rows.push({id:n.id,type:n.type,donation:n.donation,parent:n.parent,inactive:n.inactive});
        n.children.forEach(dfs);
      })(rootId); return rows;
    }

    // appearance/filters
    function radiusFor(n){
      if (!nodeShouldDisplay(n)) return 0.001;
      return heatByDonation ? Math.max(2, nodeSize * (n.donation / 100)) : nodeSize;
    }
    function baseColorFor(n){
      if (heatByDonation){
        const t=(n.donation-minDonation)/Math.max(1,(maxDonation-minDonation));
        const r=Math.floor(255*t), g=Math.floor(255*(1-0.3*t));
        return new THREE.Color(`rgb(${r},${g},60)`); // green→yellow→red
      }
      const map={root:COLORS.root, primary:COLORS.primary, extra:COLORS.extra, down:COLORS.down};
      return new THREE.Color(map[n.type]||"#aaa");
    }
    function nodeIsVisibleByType(n){
      const key = n.inactive ? "inactive" : n.type;
      return visibleTypes.has(key);
    }
    function nodeShouldDisplay(n){
      if(!n) return true; // defensive during hydration
      if(!nodeIsVisibleByType(n)) return false;
      if(isolateView && selectedNode) return highlightNodes.has(n.id);
      return true;
    }
    function linkKey(l){
      const s = typeof l.source==="object"? l.source.id:l.source;
      const t = typeof l.target==="object"? l.target.id:l.target;
      return `${s}->${t}`;
    }

    // --------- selection / camera ----------
    function clearHighlights(){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=null;
      updateAllNodeObjects();
      if(statusEl) statusEl.textContent=`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
      Graph.refresh(); updateExportState(); syncQuery();
    }
    function highlightPath(node){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=node;
      const visitDown=id=>{ highlightNodes.add(id); links.forEach(l=>{ if(l.source===id){ highlightLinkKeys.add(`${l.source}->${l.target}`); visitDown(l.target);} });};
      const visitUp=id=>{ links.forEach(l=>{ if(l.target===id){ highlightLinkKeys.add(`${l.source}->${l.target}`); highlightNodes.add(l.source); visitUp(l.source);} });};
      visitDown(node.id); visitUp(node.id);
      const stats=getSubtreeStats(node.id);
      if(statusEl) statusEl.textContent=`Focused coin #${node.id} — subtree: ${stats.count} donors, ${money(stats.total)} total, depth ${stats.depth}. (ESC to reset)`;
      updateAllNodeObjects();
      Graph.refresh(); updateExportState(); focusCamera(node); syncQuery();
    }
    function focusCamera(node){
      if(!node) return;
      const dist=zoomDist;
      Graph.cameraPosition({x:node.x+dist,y:node.y+dist*0.8,z:node.z+dist},{x:node.x,y:node.y,z:node.z},800);
    }

    // --------- draw (NO nodeThreeObjectUpdate) ----------
    function draw({nodes,links}){
      Graph = ForceGraph3D()(container)
        .backgroundColor("#000")
        .nodeThreeObject(n => {
          // Create once; store refs so we can update later
          const group = new THREE.Group();
          const fill = new THREE.Mesh(
            new THREE.SphereGeometry(1, 12, 12),
            new THREE.MeshBasicMaterial({ color: baseColorFor(n) })
          );
          fill.name = "__fill";
          group.add(fill);

          const outline = new THREE.Mesh(
            new THREE.SphereGeometry(1.01, 12, 12),
            new THREE.MeshBasicMaterial({ color: COLORS.inactiveOutline, wireframe: true, transparent: true, opacity: 0.95 })
          );
          outline.name = "__outline";
          group.add(outline);

          // stash refs on node for updates
          n.__obj = group;
          n.__fill = fill;
          n.__outline = outline;

          return group;
        })
        .nodeLabel(n=>{
          const total=getBloodlineTotal(n.id); const key=n.inactive?"inactive":n.type;
          return `<div><b>${key.toUpperCase()}</b><br/>Coin #: ${n.id}<br/>Donation: ${money(n.donation)}<br/><b>Bloodline Total:</b> ${money(total)}</div>`;
        })
        .linkColor(l=>{
          const srcId=typeof l.source==="object"?l.source.id:l.source;
          const tgtId=typeof l.target==="object"?l.target.id:l.target;
          const srcNode=byId.get(srcId), tgtNode=byId.get(tgtId);
          if(!srcNode||!tgtNode) return COLORS.hidden;
          if(!nodeShouldDisplay(srcNode)||!nodeShouldDisplay(tgtNode)) return COLORS.hidden;
          if(selectedNode) return highlightLinkKeys.has(`${srcId}->${tgtId}`)?COLORS.forward:COLORS.faded;
          return "rgba(180,180,180,0.2)";
        })
        .linkWidth(l => (highlightLinkKeys.has(linkKey(l)) ? 2.2 : 0.4))
        .onNodeClick(highlightPath)
        .d3Force("charge", d3.forceManyBody().strength(-universeSpread))
        .d3Force("link",   d3.forceLink().distance(universeSpread).strength(0.4))
        .d3Force("center", d3.forceCenter(0,0,0))
        .graphData({nodes,links});

      // After first render, size/color/visibility pass
      setTimeout(() => { updateAllNodeObjects(); Graph.refresh(); }, 0);

      if(statusEl) statusEl.textContent=`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
      window.addEventListener("keydown",ev=>{ if(ev.key==="Escape") clearHighlights(); });
    }

    // --------- update pass (called on any state change) ----------
    function updateAllNodeObjects(){
      nodes.forEach(n => {
        const obj = n.__obj, fill = n.__fill, outline = n.__outline;
        if (!obj || !fill || !outline) return;

        // visibility (filters / isolate)
        obj.visible = nodeShouldDisplay(n);

        const r = Math.max(0.001, radiusFor(n));

        // color with selection/fade logic
        let color = baseColorFor(n);
        if (selectedNode){
          if (!highlightNodes.has(n.id)) color = new THREE.Color(COLORS.faded);
          else if (n.id === selectedNode.id) color = new THREE.Color(COLORS.selected);
        }
        fill.material.color.copy(color);

        // scale spheres
        fill.scale.set(r, r, r);
        outline.visible = !!n.inactive;
        outline.scale.set(r*1.18, r*1.18, r*1.18);
      });
    }

    // ============================== UI overlays ==============================
    // Controls (bottom-left)
    const controls = document.createElement("div");
    Object.assign(controls.style, {
      position:"absolute", left:"20px", bottom:"20px",
      background:"rgba(0,0,0,0.6)", color:"#fff",
      padding:"10px", borderRadius:"8px", lineHeight:"1.1"
    });

    const lbl1 = document.createElement("label"); lbl1.textContent="Node Size:"; lbl1.style.display="block";
    const sliderNode = document.createElement("input");
    sliderNode.type="range"; sliderNode.min=2; sliderNode.max=12; sliderNode.value=nodeSize;
    sliderNode.oninput = e => { nodeSize = +e.target.value; updateAllNodeObjects(); Graph.refresh(); syncQuery(); };
    controls.append(lbl1, sliderNode, document.createElement("br"));

    const lbl2 = document.createElement("label"); lbl2.textContent="Universe Spread:"; lbl2.style.display="block";
    const sliderSpread = document.createElement("input");
    sliderSpread.type="range"; sliderSpread.min=20; sliderSpread.max=160; sliderSpread.value=universeSpread;
    sliderSpread.oninput = e => {
      universeSpread = +e.target.value;
      Graph.d3Force("charge", d3.forceManyBody().strength(-universeSpread));
      Graph.d3Force("link",   d3.forceLink().distance(universeSpread).strength(0.4));
      Graph.numDimensions(3);
      Graph.refresh(); syncQuery();
    };
    controls.append(lbl2, sliderSpread, document.createElement("br"));

    const lbl3 = document.createElement("label"); lbl3.textContent="Zoom Distance:"; lbl3.style.display="block";
    const sliderZoom = document.createElement("input");
    sliderZoom.type="range"; sliderZoom.min=20; sliderZoom.max=250; sliderZoom.value=zoomDist;
    sliderZoom.oninput = e => { zoomDist = +e.target.value; syncQuery(); };
    controls.append(lbl3, sliderZoom);

    document.body.appendChild(controls);

    // Legend (top-right)
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

    // Topbar (find / heat / isolate / export)
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
    heatChk.addEventListener("change", e => { heatByDonation = !!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });
    isolateChk.addEventListener("change", e => { isolateView = !!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });

    function updateExportState(){
      if (selectedNode){
        exportBtn.style.opacity = "1"; exportBtn.style.cursor="pointer"; exportBtn.disabled = false;
      } else {
        exportBtn.style.opacity = ".6"; exportBtn.style.cursor="not-allowed"; exportBtn.disabled = true;
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

    // Filters (under topbar)
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
      c.addEventListener("change", ()=>{
        if (c.checked) visibleTypes.add(key); else visibleTypes.delete(key);
        updateAllNodeObjects(); Graph.refresh(); syncQuery();
      });
      w.appendChild(c); w.appendChild(document.createTextNode(label));
      filters.appendChild(w);
    });
    document.body.appendChild(filters);

    // --------- find + URL state ----------
    function tryFindAndFocus(raw){
      const id = Number(String(raw||"").replace(/\D/g,""));
      if (!Number.isFinite(id)) return pulse(findInput,"#ff6b6b");
      const node = byId.get(id);
      if (!node) return pulse(findInput,"#ffb020");
      const wait = () => (Number.isFinite(node.x) ? Promise.resolve() : new Promise(res => setTimeout(() => res(wait()), 80)));
      wait().then(()=>{ highlightPath(node); pulse(findInput, "#00ff9c"); });
    }
    function pulse(el, color){
      const old = el.style.boxShadow;
      el.style.boxShadow = `0 0 0 3px ${color}55`;
      setTimeout(()=> el.style.boxShadow = old, 450);
    }
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
      updateAllNodeObjects(); Graph.refresh();
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

    // --------- run ----------
    const data = generateUniverse(3200, 250);
    draw(data);
    applyQuery(); // optional URL restore
  }
})();
