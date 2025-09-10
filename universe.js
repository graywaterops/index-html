(() => {
  // ------- Single-instance guard (prevents duplicate graphs/UI) -------
  if (window.__DONOR_GRAPH__?.destroy) {
    try { window.__DONOR_GRAPH__.destroy(); } catch (_) {}
  }

  const UI_IDS = {
    controls: 'dg-controls',
    legend:   'dg-legend',
    topbar:   'dg-topbar',
    filters:  'dg-filters'
  };
  function removeEl(id){ const el = document.getElementById(id); if (el) el.remove(); }

  // ---- Safe lib loader (won't double-load if already present) ----
  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }
  async function ensureLibs(){
    if (!window.THREE)        await loadScript('https://unpkg.com/three@0.155.0/build/three.min.js');
    if (!window.ForceGraph3D) await loadScript('https://unpkg.com/3d-force-graph@1.71.6/dist/3d-force-graph.min.js');
  }

  ensureLibs().then(start).catch(err => {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = `Failed to load libs: ${err.message}`;
    console.error(err);
  });

  // ============================== APP ==============================
  function start(){
    const container = document.getElementById('graph');
    const statusEl  = document.getElementById('status');
    if (!container) return console.error('Graph container #graph not found.');

    const THREE = window.THREE;
    const ForceGraph3D = window.ForceGraph3D;

    // Clean up any previous render/canvas + UI
    container.innerHTML = '';
    removeEl(UI_IDS.controls);
    removeEl(UI_IDS.legend);
    removeEl(UI_IDS.topbar);
    removeEl(UI_IDS.filters);

    let Graph;
    let nodes = [], links = [];
    let byId = new Map();

    let selectedNode = null;
    let highlightNodes = new Set();
    let highlightLinkKeys = new Set();

    // ---- Defaults tuned for visibility ----
    let nodeSize = 42;          // large by default
    let universeSpread = 160;   // wider
    let zoomDist = 320;         // camera snap distance
    let heatByDonation = false; // OFF by default
    let isolateView = false;
    let showLinksAll = false;   // OFF by default

    // All types visible by default (prevents "no nodes" surprises)
    const visibleTypes = new Set(['root','primary','extra','down']);

    // Donation range for heat
    let minDonation = 0, maxDonation = 1;

    // Colors
    const COLORS = {
      rootHex:    0x1f4aa8,
      primaryHex: 0x7cc3ff,
      extraHex:   0x2ecc71,
      downHex:    0xe74c3c,
      forward:    '#00ff9c',
      faded:      'rgba(100,100,100,0.12)'
    };
    const money = v => `$${(v||0).toLocaleString()}`;
    const idOf  = v => (typeof v === 'object' ? v.id : v);

    // ---------- Data ----------
    function randomDonation() {
      const r = Math.random();
      if (r < 0.75) return Math.floor(50 + Math.random() * 50);
      if (r < 0.95) return Math.floor(100 + Math.random() * 400);
      return Math.floor(500 + Math.random() * 4500);
    }
    function pickBiasedParent(){
      const pool = nodes.filter(n => n.type === 'extra' || n.type === 'down');
      if (pool.length && Math.random() < 0.35) return pool[Math.floor(Math.random()*pool.length)];
      return nodes[Math.floor(Math.random()*nodes.length)];
    }
    function generateUniverse(total=3200, seedRoots=250){
      nodes=[]; links=[]; byId=new Map();
      let id=0;
      for (let i=0;i<seedRoots;i++){
        const n={id:id++, type:'root', donation:randomDonation(), children:[], parent:null, inactive:false};
        nodes.push(n); byId.set(n.id,n);
      }
      for (let i=seedRoots;i<total;i++){
        const p = pickBiasedParent();
        const d = randomDonation();
        let type='primary';
        if (p.children.length > 0) type = (p.type==='primary') ? 'extra' : 'down';
        const c = {id:id++, type, donation:d, children:[], parent:p.id, inactive:false};
        nodes.push(c); byId.set(c.id,c);
        p.children.push(c.id);
        links.push({source:p.id, target:c.id}); // numbers are fine; 3d‑force‑graph objectifies
      }
      nodes.forEach(n => { n.inactive = (n.children.length === 0); });
      minDonation = Math.min(...nodes.map(n=>n.donation));
      maxDonation = Math.max(...nodes.map(n=>n.donation));
      return {nodes, links};
    }

    // ---------- Metrics ----------
    function getBloodlineTotal(rootId){
      let total=0; const seen=new Set();
      (function dfs(id){
        if (seen.has(id)) return; seen.add(id);
        const n = byId.get(id); if (!n) return;
        total += n.donation||0;
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
      const rows=[]; (function dfs(id){
        const n=byId.get(id); if(!n) return;
        rows.push({id:n.id,type:n.type,donation:n.donation,parent:n.parent,inactive:n.inactive});
        n.children.forEach(dfs);
      })(rootId);
      return rows;
    }

    // ---------- Appearance ----------
    const typeHex = t => (
      t==='root' ? COLORS.rootHex :
      t==='primary' ? COLORS.primaryHex :
      t==='extra' ? COLORS.extraHex :
      t==='down' ? COLORS.downHex : 0xaaaaaa
    );
    const rgbHex = (r,g,b) => ((r&255)<<16)|((g&255)<<8)|(b&255);
    function heatHex(n){
      const t = (n.donation - minDonation) / Math.max(1, (maxDonation - minDonation));
      const r = Math.round(255*t);
      const g = Math.round(255*(1 - 0.3*t));
      return rgbHex(r,g,60);
    }
    const fillHex = n => heatByDonation ? heatHex(n) : typeHex(n.type);

    const baseRadius = n => heatByDonation ? Math.max(10, nodeSize*(n.donation/100)) : nodeSize;
    function radiusFor(n){
      const base = baseRadius(n);
      if (!selectedNode) return base;
      if (!highlightNodes.has(n.id)) return base * 0.75;
      return n.id === selectedNode.id ? base * 2.8 : base * 1.9;
    }

    const nodeIsVisibleByType = n => visibleTypes.has(n.type);
    function nodeShouldDisplay(n){
      if (!n) return true;
      if (!nodeIsVisibleByType(n)) return false;
      if (isolateView && selectedNode) return highlightNodes.has(n.id);
      return true;
    }
    function linkKey(l){ return `${idOf(l.source)}->${idOf(l.target)}`; }
    function linkVisible(l){
      const s = byId.get(idOf(l.source));
      const t = byId.get(idOf(l.target));
      if (!s || !t) return false;
      if (!nodeShouldDisplay(s) || !nodeShouldDisplay(t)) return false;
      if (selectedNode) return showLinksAll || highlightLinkKeys.has(linkKey(l));
      return showLinksAll;
    }

    // ---------- Selection & Camera ----------
    function clearHighlights(){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=null;
      updateAllNodeObjects();
      if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
      Graph && Graph.refresh();
      updateExportState(); syncQuery();
    }
    function highlightPath(node){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=node;

      const down=id=>{
        highlightNodes.add(id);
        links.forEach(l => {
          if (idOf(l.source) === id) {
            highlightLinkKeys.add(linkKey(l));
            down(idOf(l.target));
          }
        });
      };
      const up=id=>{
        links.forEach(l => {
          if (idOf(l.target) === id) {
            highlightLinkKeys.add(linkKey(l));
            highlightNodes.add(idOf(l.source));
            up(idOf(l.source));
          }
        });
      };
      down(node.id); up(node.id);

      const s = getSubtreeStats(node.id);
      if (statusEl) statusEl.textContent = `Focused coin #${node.id} — subtree: ${s.count} donors, ${money(s.total)} total, depth ${s.depth}. (ESC to reset)`;

      updateAllNodeObjects();
      Graph.refresh(); updateExportState(); focusCamera(node); syncQuery();
    }
    function focusCamera(node){
      if (!node || !Graph) return;
      const d = zoomDist;
      Graph.cameraPosition(
        {x:node.x+d, y:node.y+d*0.8, z:node.z+d},
        {x:node.x,   y:node.y,        z:node.z},
        600
      );
    }
    function applyZoomNow(){
      if (!Graph) return;
      const cam = Graph.camera && Graph.camera(); if (!cam) return;
      const target = selectedNode
        ? new THREE.Vector3(selectedNode.x, selectedNode.y, selectedNode.z)
        : new THREE.Vector3(0,0,0);
      const cur = new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z);
      let dir = cur.sub(target);
      if (dir.length() === 0) dir = new THREE.Vector3(1,1,1);
      dir.normalize().multiplyScalar(zoomDist);
      const next = { x: target.x + dir.x, y: target.y + dir.y, z: target.z + dir.z };
      Graph.cameraPosition(next, {x:target.x, y:target.y, z:target.z}, 0);
    }

    // ---------- Draw ----------
    function draw({nodes,links}){
      Graph = ForceGraph3D()(container)
        .backgroundColor('#000')
        .nodeThreeObject(n => {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1,16,16),
            new THREE.MeshBasicMaterial({ color: typeHex(n.type), transparent: true, opacity: 1 })
          );
          n.__fill = mesh; n.__obj = mesh;
          return mesh;
        })
        .nodeLabel(n => {
          const total = getBloodlineTotal(n.id);
          return `<div><b>${n.type.toUpperCase()}</b><br/>Coin #: ${n.id}<br/>Donation: ${money(n.donation)}<br/><b>Bloodline Total:</b> ${money(total)}</div>`;
        })
        .linkVisibility(linkVisible)
        .linkColor(l => highlightLinkKeys.has(linkKey(l)) ? COLORS.forward : 'rgba(180,180,180,0.22)')
        .linkWidth(l => highlightLinkKeys.has(linkKey(l)) ? 3.8 : 0.35)
        .linkOpacity(l => highlightLinkKeys.has(linkKey(l)) ? 1 : (showLinksAll ? 0.08 : 0.0))
        .linkDirectionalParticles(l => highlightLinkKeys.has(linkKey(l)) ? 3 : 0)
        .linkDirectionalParticleWidth(3.0)
        .linkDirectionalParticleSpeed(0.010)
        .linkDirectionalParticleColor(l => highlightLinkKeys.has(linkKey(l)) ? COLORS.forward : '#000000')
        .onNodeClick(highlightPath)
        .graphData({nodes,links});

      // Forces + controls (guarded)
      try {
        Graph.d3Force('charge').strength(-universeSpread);
        Graph.d3Force('link').distance(universeSpread).strength(0.45);
        if (typeof Graph.d3ReheatSimulation === 'function') Graph.d3ReheatSimulation();
      } catch(_){}

      const ctrl = Graph.controls && Graph.controls();
      if (ctrl) {
        ctrl.zoomSpeed = 3.2;
        ctrl.minDistance = 40;
        ctrl.maxDistance = 6000;
        ctrl.enableDamping = true;
        ctrl.dampingFactor = 0.12;
      }

      updateAllNodeObjects();
      Graph.refresh();
      if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;

      // ESC to clear
      const keyHandler = (ev) => { if (ev.key === 'Escape') clearHighlights(); };
      window.addEventListener('keydown', keyHandler);

      // expose a destroyer so we can re-init cleanly next time
      window.__DONOR_GRAPH__ = {
        destroy(){
          try { window.removeEventListener('keydown', keyHandler); } catch(_){}
          try { Graph && Graph.pauseAnimation && Graph.pauseAnimation(); } catch(_){}
          try { container.innerHTML = ''; } catch(_){}
          removeEl(UI_IDS.controls);
          removeEl(UI_IDS.legend);
          removeEl(UI_IDS.topbar);
          removeEl(UI_IDS.filters);
        }
      };
    }

    function updateAllNodeObjects(){
      nodes.forEach(n => {
        const fill = n.__fill; if (!fill) return;
        fill.visible = nodeShouldDisplay(n);
        const r = Math.max(0.001, radiusFor(n));
        fill.scale.set(r,r,r);
        fill.material.color.setHex(fillHex(n));
        fill.material.opacity = selectedNode ? (highlightNodes.has(n.id) ? 1.0 : 0.10) : 1.0;
      });
      if (Graph && Graph.linkVisibility) Graph.linkVisibility(linkVisible);
    }

    // ---------- UI (idempotent; uses fixed IDs) ----------
    // Controls
    const controls = document.createElement('div');
    controls.id = UI_IDS.controls;
    Object.assign(controls.style, {
      position:'absolute', left:'20px', bottom:'20px',
      background:'rgba(0,0,0,0.6)', color:'#fff',
      padding:'10px', borderRadius:'8px', lineHeight:'1.1'
    });

    const lbl1 = document.createElement('label'); lbl1.textContent = 'Node Size:'; lbl1.style.display='block';
    const sliderNode = document.createElement('input');
    sliderNode.type='range'; sliderNode.min=12; sliderNode.max=140; sliderNode.value=nodeSize;
    sliderNode.oninput = e => { nodeSize = +e.target.value; updateAllNodeObjects(); Graph.refresh(); syncQuery(); };
    controls.append(lbl1, sliderNode, document.createElement('br'));

    const lbl2 = document.createElement('label'); lbl2.textContent = 'Universe Spread:'; lbl2.style.display='block';
    const sliderSpread = document.createElement('input');
    sliderSpread.type='range'; sliderSpread.min=60; sliderSpread.max=360; sliderSpread.value=universeSpread;
    sliderSpread.oninput = e => {
      universeSpread = +e.target.value;
      try {
        Graph.d3Force('charge').strength(-universeSpread);
        Graph.d3Force('link').distance(universeSpread).strength(0.45);
        if (typeof Graph.d3ReheatSimulation === 'function') Graph.d3ReheatSimulation();
      } catch(_){}
      Graph.refresh(); syncQuery();
    };
    controls.append(lbl2, sliderSpread, document.createElement('br'));

    const lbl3 = document.createElement('label'); lbl3.textContent = 'Zoom Distance:'; lbl3.style.display='block';
    const sliderZoom = document.createElement('input');
    sliderZoom.type='range'; sliderZoom.min=120; sliderZoom.max=1200; sliderZoom.value=zoomDist;
    sliderZoom.oninput = e => { zoomDist = +e.target.value; applyZoomNow(); syncQuery(); };
    controls.append(lbl3, sliderZoom);
    document.body.appendChild(controls);

    // Legend
    const legend = document.createElement('div');
    legend.id = UI_IDS.legend;
    Object.assign(legend.style, {
      position:'absolute', top:'10px', right:'10px',
      background:'rgba(0,0,0,0.7)', color:'#fff',
      padding:'10px', borderRadius:'6px'
    });
    legend.innerHTML = `
      <b>Legend</b><br>
      <span style="color:#1f4aa8">●</span> Root<br>
      <span style="color:#7cc3ff">●</span> Primary<br>
      <span style="color:#2ecc71">●</span> Extra<br>
      <span style="color:#e74c3c">●</span> Downline<br>
      <span style="color:${COLORS.forward}">●</span> Forward path<br>
    `;
    document.body.appendChild(legend);

    // Topbar
    const topbar = document.createElement('div');
    topbar.id = UI_IDS.topbar;
    Object.assign(topbar.style, {
      position:'absolute', left:'20px', top:'20px',
      display:'flex', gap:'.5rem', alignItems:'center',
      background:'rgba(0,0,0,0.6)', padding:'10px', borderRadius:'8px', color:'#fff'
    });
    topbar.innerHTML = `
      <input id="findInput" inputmode="numeric" pattern="[0-9]*"
        placeholder="Find coin # (e.g., 2436)"
        style="width:210px;padding:.5rem .65rem;border-radius:.5rem;border:1px solid #334;background:#0b1220;color:#cfe3ff;">
      <button id="findBtn" style="padding:.55rem .8rem;border-radius:.5rem;border:0;background:#3478f6;color:#fff;">Find</button>
      <label style="display:flex;gap:.35rem;align-items:center;"><input type="checkbox" id="heatChk"> Heat by $</label>
      <label style="display:flex;gap:.35rem;align-items:center;"><input type="checkbox" id="isolateChk"> Isolate subtree</label>
      <label style="display:flex;gap:.35rem;align-items:center;"><input type="checkbox" id="linksChk"> Show links</label>
      <button id="exportBtn" style="padding:.45rem .7rem;border-radius:.5rem;border:1px solid #444;background:#0b1220;color:#cfe3ff;opacity:.6;cursor:not-allowed;">Export CSV</button>
    `;
    document.body.appendChild(topbar);

    const findInput  = topbar.querySelector('#findInput');
    const findBtn    = topbar.querySelector('#findBtn');
    const heatChk    = topbar.querySelector('#heatChk');
    const isolateChk = topbar.querySelector('#isolateChk');
    const linksChk   = topbar.querySelector('#linksChk');
    const exportBtn  = topbar.querySelector('#exportBtn');

    findBtn.addEventListener('click', () => tryFindAndFocus(findInput.value));
    findInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryFindAndFocus(findInput.value); });
    heatChk.addEventListener('change',   e => { heatByDonation = !!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });
    isolateChk.addEventListener('change',e => { isolateView    = !!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });
    linksChk.addEventListener('change',  e => { showLinksAll   = !!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });

    function updateExportState(){
      if (selectedNode){ exportBtn.style.opacity='1'; exportBtn.style.cursor='pointer'; exportBtn.disabled=false; }
      else { exportBtn.style.opacity='.6'; exportBtn.style.cursor='not-allowed'; exportBtn.disabled=true; }
    }
    exportBtn.addEventListener('click', () => {
      if (!selectedNode) return;
      const rows = collectSubtree(selectedNode.id);
      const header = 'coin_id,type,donation,parent_id,inactive\n';
      const body = rows.map(r => `${r.id},${r.type},${r.donation},${r.parent??''},${r.inactive}`).join('\n');
      const blob = new Blob([header+body], {type:'text/csv'});
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=`subtree_${selectedNode.id}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });

    // Filters
    const filters = document.createElement('div');
    filters.id = UI_IDS.filters;
    Object.assign(filters.style, {
      position:'absolute', left:'20px', top:'78px',
      background:'rgba(0,0,0,0.6)', color:'#fff',
      padding:'8px 10px', borderRadius:'8px',
      display:'grid', gridTemplateColumns:'auto auto', gap:'6px 16px'
    });
    const TYPES = [['root','Root'],['primary','Primary'],['extra','Extra'],['down','Downline']];
    TYPES.forEach(([key,label]) => {
      const w = document.createElement('label');
      w.style.display='flex'; w.style.alignItems='center'; w.style.gap='.35rem';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=true;
      cb.addEventListener('change', ()=>{
        if (cb.checked) visibleTypes.add(key); else visibleTypes.delete(key);
        if (visibleTypes.size === 0) TYPES.forEach(([k]) => visibleTypes.add(k)); // never 0
        updateAllNodeObjects(); Graph.refresh(); syncQuery();
      });
      w.appendChild(cb); w.appendChild(document.createTextNode(label));
      filters.appendChild(w);
    });
    document.body.appendChild(filters);

    // ------------- Find & URL state -------------
    function tryFindAndFocus(raw){
      const id = Number(String(raw||'').replace(/\D/g,''));
      if (!Number.isFinite(id)) return pulse(findInput,'#ff6b6b');
      const node = byId.get(id);
      if (!node) return pulse(findInput,'#ffb020');
      const wait = () => (Number.isFinite(node.x) ? Promise.resolve() : new Promise(res => setTimeout(()=>res(wait()), 80)));
      wait().then(()=>{ highlightPath(node); pulse(findInput,'#00ff9c'); });
    }
    function pulse(el,color){ const old=el.style.boxShadow; el.style.boxShadow=`0 0 0 3px ${color}55`; setTimeout(()=>el.style.boxShadow=old,450); }

    function applyQuery(){
      const p = new URLSearchParams(location.search);
      const qSize   = +p.get('size');   if (qSize)   { nodeSize = qSize; sliderNode.value = nodeSize; }
      const qSpread = +p.get('spread'); if (qSpread) { universeSpread = qSpread; sliderSpread.value = universeSpread; }
      const qZoom   = +p.get('zoom');   if (qZoom)   { zoomDist = qZoom; sliderZoom.value = zoomDist; applyZoomNow(); }
      const qIso    = p.get('isolate'); if (qIso==='1'){ isolateView = true; isolateChk.checked = true; }
      const qHeat   = p.get('heat');    if (qHeat==='1'){ heatByDonation = true; heatChk.checked = true; } else { heatByDonation = false; heatChk.checked = false; }
      const qLinks  = p.get('links');   if (qLinks==='1'){ showLinksAll = true; linksChk.checked = true; } else { showLinksAll = false; linksChk.checked = false; }
      const qTypes  = p.get('types');
      if (qTypes){
        visibleTypes.clear();
        qTypes.split(',').forEach(t => { if (t) visibleTypes.add(t); });
        Array.from(filters.querySelectorAll('input[type=checkbox]')).forEach((cb,i)=>{
          const key=TYPES[i][0]; cb.checked = visibleTypes.has(key);
        });
      }
      updateAllNodeObjects(); Graph.refresh();
    }
    function syncQuery(){
      const p = new URLSearchParams(location.search);
      if (selectedNode) p.set('find', selectedNode.id); else p.delete('find');
      p.set('size', String(nodeSize));
      p.set('spread', String(universeSpread));
      p.set('zoom', String(zoomDist));
      p.set('isolate', isolateView ? '1' : '0');
      p.set('heat', heatByDonation ? '1' : '0');
      p.set('links', showLinksAll ? '1' : '0');
      p.set('types', Array.from(visibleTypes).join(','));
      history.replaceState({}, '', `${location.pathname}?${p.toString()}`);
    }

    // ---- run ----
    const data = generateUniverse(3200, 250);
    draw(data);
    applyQuery();
  }
})();
