(() => {
  const container = document.getElementById("graph");
  const statusEl  = document.getElementById("status");

  let Graph;
  let nodes = [], links = [];
  let byId = new Map();

  let highlightNodes = new Set();
  let highlightLinkKeys = new Set();
  let selectedNode = null;

  let nodeSize = 4;
  let universeSpread = 60;
  let zoomDist = 90;
  let heatByDonation = false;
  let isolateView = false;
  const visibleTypes = new Set(["root","primary","extra","down","inactive"]);

  let minDonation = 0, maxDonation = 1;

  const COLORS = {
    root: "#1f4aa8", primary: "#7cc3ff", extra: "#2ecc71", down: "#e74c3c",
    inactiveOutline: 0xffdd00,
    forward: "#00ff88", back: "#ffdd33",
    selected: "#ffffff", faded: "rgba(100,100,100,0.08)", hidden: "rgba(0,0,0,0)"
  };

  const money = v => `$${(v||0).toLocaleString()}`;

  // ---------- generate data ----------
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
      links.push({source:parent.id, target:child.id});
    }
    nodes.forEach(n=>{ n.inactive=(n.children.length===0); });
    minDonation=Math.min(...nodes.map(n=>n.donation));
    maxDonation=Math.max(...nodes.map(n=>n.donation));
    return {nodes,links};
  }

  // ---------- helpers ----------
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
  function radiusFor(n){ return heatByDonation? Math.max(2,nodeSize*(n.donation/100)):nodeSize; }
  function baseColorFor(n){
    if (heatByDonation){
      const t=(n.donation-minDonation)/Math.max(1,(maxDonation-minDonation));
      const r=Math.floor(255*t), g=Math.floor(255*(1-0.3*t));
      return new THREE.Color(`rgb(${r},${g},60)`);
    }
    const map={root:COLORS.root, primary:COLORS.primary, extra:COLORS.extra, down:COLORS.down};
    return new THREE.Color(map[n.type]||"#aaa");
  }
  function nodeIsVisibleByType(n){ const key=n.inactive?"inactive":n.type; return visibleTypes.has(key); }
  function nodeShouldDisplay(n){ if(!n) return true; if(!nodeIsVisibleByType(n)) return false; if(isolateView && selectedNode) return highlightNodes.has(n.id); return true; }

  function linkKey(l){
    const s = typeof l.source==="object"? l.source.id:l.source;
    const t = typeof l.target==="object"? l.target.id:l.target;
    return `${s}->${t}`;
  }

  // ---------- selection / camera ----------
  function clearHighlights(){ highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=null;
    if(statusEl) statusEl.textContent=`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`; Graph.refresh(); updateExportState(); syncQuery(); }
  function highlightPath(node){
    highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=node;
    const visitDown=id=>{ highlightNodes.add(id); links.forEach(l=>{ if(l.source===id){ highlightLinkKeys.add(`${l.source}->${l.target}`); visitDown(l.target);} });};
    const visitUp=id=>{ links.forEach(l=>{ if(l.target===id){ highlightLinkKeys.add(`${l.source}->${l.target}`); highlightNodes.add(l.source); visitUp(l.source);} });};
    visitDown(node.id); visitUp(node.id);
    const stats=getSubtreeStats(node.id);
    if(statusEl) statusEl.textContent=`Focused coin #${node.id} — subtree: ${stats.count} donors, ${money(stats.total)} total, depth ${stats.depth}. (ESC to reset)`;
    Graph.refresh(); updateExportState(); focusCamera(node); syncQuery();
  }
  function focusCamera(node){ if(!node) return; const dist=zoomDist;
    Graph.cameraPosition({x:node.x+dist,y:node.y+dist*0.8,z:node.z+dist},{x:node.x,y:node.y,z:node.z},800); }

  // ---------- draw ----------
  function draw({nodes,links}){
    Graph=ForceGraph3D()(container)
      .backgroundColor("#000")
      .nodeThreeObject(n=>{
        const r=radiusFor(n); const group=new THREE.Group();
        const fill=new THREE.Mesh(new THREE.SphereGeometry(r,12,12), new THREE.MeshBasicMaterial({color:baseColorFor(n)}));
        group.add(fill);
        if(n.inactive){ const outline=new THREE.Mesh(new THREE.SphereGeometry(r*1.2,12,12),
          new THREE.MeshBasicMaterial({color:COLORS.inactiveOutline,wireframe:true}));
          group.add(outline);}
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
      .linkWidth(l=>(highlightLinkKeys.has(linkKey(l))?2.2:0.4))
      .onNodeClick(highlightPath)
      .d3Force("charge", d3.forceManyBody().strength(-universeSpread))
      .d3Force("link", d3.forceLink().distance(universeSpread).strength(0.4))
      .d3Force("center", d3.forceCenter(0,0,0))
      .graphData({nodes,links});
    if(statusEl) statusEl.textContent=`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    window.addEventListener("keydown",ev=>{ if(ev.key==="Escape") clearHighlights(); });
  }

  // ---------- overlays (controls, legend, topbar, filters) ----------
  // same as your last working overlay setup…
  // (for brevity, keep the existing Node Size, Universe Spread, Zoom Distance sliders,
  //  Legend, Topbar with Find/Heat/Isolate/Export, Filters, and associated handlers)

  // ---------- run ----------
  const data=generateUniverse(3200,250);
  draw(data);
})();
