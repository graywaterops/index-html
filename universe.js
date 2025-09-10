(() => {
  // ----- load libs (Squarespace-safe) -----
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }
  async function needLibs() {
    if (!window.THREE)        await loadScript('https://unpkg.com/three@0.155.0/build/three.min.js');
    if (!window.ForceGraph3D) await loadScript('https://unpkg.com/3d-force-graph@1.71.6/dist/3d-force-graph.min.js');
  }

  needLibs().then(start).catch(err => {
    const el = document.getElementById('status');
    if (el) el.textContent = `Failed to load libs: ${err.message}`;
    console.error(err);
  });

  // ================= APP =================
  function start() {
    const container = document.getElementById('graph');
    const statusEl  = document.getElementById('status');
    const THREE = window.THREE;
    const ForceGraph3D = window.ForceGraph3D;

    let Graph;
    let nodes = [], links = [];
    let byId = new Map();

    // state
    let highlightNodes = new Set();
    let highlightLinkKeys = new Set();
    let selectedNode = null;

    let nodeSize = 8;          // bigger by default
    let universeSpread = 80;   // wider by default
    let zoomDist = 160;        // camera focus distance
    let heatByDonation = false; // OFF by default
    let isolateView = false;

    const visibleTypes = new Set(['root','primary','extra','down']);

    let minDonation = 0, maxDonation = 1;

    // hex colors (typed)
    const COLORS = {
      rootHex:    0x1f4aa8,
      primaryHex: 0x7cc3ff,
      extraHex:   0x2ecc71,
      downHex:    0xe74c3c,
      forward:    '#00ff88',
      back:       '#ffdd33'
    };
    const money = v => `$${(v||0).toLocaleString()}`;

    // ---------- data ----------
    function randomDonation() {
      const r = Math.random();
      if (r < 0.75) return Math.floor(50 + Math.random() * 50);
      if (r < 0.95) return Math.floor(100 + Math.random() * 400);
      return Math.floor(500 + Math.random() * 4500);
    }
    function pickBiasedParent() {
      const pool = nodes.filter(n => n.type === 'extra' || n.type === 'down');
      if (pool.length && Math.random() < 0.35) return pool[Math.floor(Math.random()*pool.length)];
      return nodes[Math.floor(Math.random()*nodes.length)];
    }
    function generateUniverse(total=3200, seedRoots=250) {
      nodes = []; links = []; byId = new Map();
      let id = 0;
      for (let i=0;i<seedRoots;i++) {
        const n = { id:id++, type:'root', donation:randomDonation(), children:[], parent:null, inactive:false };
        nodes.push(n); byId.set(n.id, n);
      }
      for (let i=seedRoots;i<total;i++) {
        const parent = pickBiasedParent();
        const donation = randomDonation();
        let type = 'primary';
        if (parent.children.length > 0) type = parent.type === 'primary' ? 'extra' : 'down';
        const child = { id:id++, type, donation, children:[], parent:parent.id, inactive:false };
        nodes.push(child); byId.set(child.id, child);
        parent.children.push(child.id);
        links.push({ source: parent.id, target: child.id });
      }
      nodes.forEach(n => { n.inactive = (n.children.length === 0); });
      minDonation = Math.min(...nodes.map(n=>n.donation));
      maxDonation = Math.max(...nodes.map(n=>n.donation));
      return { nodes, links };
    }

    // ---------- helpers ----------
    function getBloodlineTotal(rootId) {
      let total = 0; const seen = new Set();
      (function dfs(id){
        if (seen.has(id)) return; seen.add(id);
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
      const rows=[];
      (function dfs(id){
        const n = byId.get(id); if (!n) return;
        rows.push({ id:n.id, type:n.type, donation:n.donation, parent:n.parent, inactive:n.inactive });
        n.children.forEach(dfs);
      })(rootId);
      return rows;
    }

    // sizing/color
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
      const g = Math.round(255*(1-0.3*t));
      return rgbHex(r,g,60);
    }
    const fillHex = n => heatByDonation ? heatHex(n) : typeHex(n.type);
    const radiusFor = n => heatByDonation ? Math.max(3, nodeSize*(n.donation/100)) : nodeSize;

    const nodeIsVisibleByType = n => visibleTypes.has(n.type);
    function nodeShouldDisplay(n){
      if (!n) return true;
      if (!nodeIsVisibleByType(n)) return false;
      if (isolateView && selectedNode) return highlightNodes.has(n.id);
      return true;
    }
    function linkKey(l){
      const s = typeof l.source==='object' ? l.source.id : l.source;
      const t = typeof l.target==='object' ? l.target.id : l.target;
      return `${s}->${t}`;
    }

    // ---------- selection / camera ----------
    function clearHighlights(){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=null;
      updateAllNodeObjects();
      if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
      Graph.refresh(); updateExportState(); syncQuery();
    }
    function highlightPath(node){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=node;
      const visitDown=id=>{ highlightNodes.add(id); links.forEach(l=>{ if(l.source===id){ highlightLinkKeys.add(`${l.source}->${l.target}`); visitDown(l.target);} });};
      const visitUp=id=>{ links.forEach(l=>{ if(l.target===id){ highlightLinkKeys.add(`${l.source}->${l.target}`); highlightNodes.add(l.source); visitUp(l.source);} });};
      visitDown(node.id); visitUp(node.id);
      const stats=getSubtreeStats(node.id);
      if (statusEl) statusEl.textContent = `Focused coin #${node.id} — subtree: ${stats.count} donors, ${money(stats.total)} total, depth ${stats.depth}. (ESC to reset)`;
      updateAllNodeObjects();
      Graph.refresh(); updateExportState(); focusCamera(node); syncQuery();
    }
    function focusCamera(node){
      if (!node) return;
      const dist=zoomDist;
      Graph.cameraPosition(
        { x:node.x+dist, y:node.y+dist*0.8, z:node.z+dist },
        { x:node.x, y:node.y, z:node.z },
        600
      );
    }

    // ---------- draw ----------
    function draw({nodes,links}) {
      Graph = ForceGraph3D()(container)
        .backgroundColor('#000')
        .nodeThreeObject(n => {
          // fill only (no outline anywhere)
          const fill = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 16),
            new THREE.MeshBasicMaterial({ color: typeHex(n.type), transparent: true, opacity: 1 })
          );
          n.__fill = fill;  // stash for updates
          n.__obj  = fill;  // top-level object
          return fill;
        })
        .nodeLabel(n => {
          const total = getBloodlineTotal(n.id);
          return `<div><b>${n.type.toUpperCase()}</b><br/>Coin #: ${n.id}<br/>Donation: ${money(n.donation)}<br/><b>Bloodline Total:</b> ${money(total)}</div>`;
        })
        .linkColor(l => {
          const srcId=typeof l.source==='object'?l.source.id:l.source;
          const tgtId=typeof l.target==='object'?l.target.id:l.target;
          const srcNode=byId.get(srcId), tgtNode=byId.get(tgtId);
          if(!srcNode||!tgtNode) return 'rgba(0,0,0,0)';
          if(!nodeShouldDisplay(srcNode)||!nodeShouldDisplay(tgtNode)) return 'rgba(0,0,0,0)';
          if(selectedNode) return highlightLinkKeys.has(`${srcId}->${tgtId}`)?COLORS.forward:'rgba(100,100,100,0.18)';
          return 'rgba(180,180,180,0.2)';
        })
        .linkWidth(l => (highlightLinkKeys.has(linkKey(l)) ? 2.2 : 0.4))
        .onNodeClick(highlightPath)
        .graphData({ nodes, links });

      // force + controls
      try {
        Graph.d3Force('charge').strength(-universeSpread);
        Graph.d3Force('link').distance(universeSpread).strength(0.4);
      } catch(_) {}
      const ctrl = Graph.controls && Graph.controls();
      if (ctrl) {
        ctrl.minDistance = 20;
        ctrl.maxDistance = 3000;
        ctrl.zoomSpeed   = 2.5; // faster scroll zoom
        ctrl.enableDamping = true;
        ctrl.dampingFactor = 0.12;
      }

      updateAllNodeObjects();
      Graph.refresh();

      if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
      window.addEventListener('keydown', ev => { if (ev.key === 'Escape') clearHighlights(); });
    }

    function updateAllNodeObjects(){
      nodes.forEach(n => {
        const fill = n.__fill;
        if (!fill) return;

        // show/hide by filters
        const visible = nodeShouldDisplay(n);
        if (fill.visible !== visible) fill.visible = visible;

        // size
        const r = Math.max(0.001, radiusFor(n));
        fill.scale.set(r, r, r);

        // color strictly by type or heat (NO yellow ever)
        const hex = fillHex(n);
        fill.material.color.setHex(hex);

        // dimming by opacity only when not on focus path
        if (selectedNode) {
          fill.material.opacity = highlightNodes.has(n.id) ? 1.0 : 0.18;
        } else {
          fill.material.opacity = 1.0;
        }
      });
    }

    // ---------- overlays ----------
    // Controls
    const controls = document.createElement('div');
    Object.assign(controls.style, {
      position:'absolute', left:'20px', bottom:'20px',
      background:'rgba(0,0,0,0.6)', color:'#fff',
      padding:'10px', borderRadius:'8px', lineHeight:'1.1'
    });

    const lbl1 = document.createElement('label'); lbl1.textContent = 'Node Size:'; lbl1.style.display='block';
    const sliderNode = document.createElement('input');
    sliderNode.type='range'; sliderNode.min=2; sliderNode.max=24; sliderNode.value=nodeSize;
    sliderNode.oninput = e => { nodeSize = +e.target.value; updateAllNodeObjects(); Graph.refresh(); syncQuery(); };
    controls.append(lbl1, sliderNode, document.createElement('br'));

    const lbl2 = document.createElement('label'); lbl2.textContent = 'Universe Spread:'; lbl2.style.display='block';
    const sliderSpread = document.createElement('input');
    sliderSpread.type='range'; sliderSpread.min=20; sliderSpread.max=200; sliderSpread.value=universeSpread;
    sliderSpread.oninput = e => {
      universeSpread = +e.target.value;
      try {
        Graph.d3Force('charge').strength(-universeSpread);
        Graph.d3Force('link').distance(universeSpread).strength(0.4);
      } catch(_) {}
      Graph.refresh(); syncQuery();
    };
    controls.append(lbl2, sliderSpread, document.createElement('br'));

    const lbl3 = document.createElement('label'); lbl3.textContent = 'Zoom Distance:'; lbl3.style.display='block';
    const sliderZoom = document.createElement('input');
    sliderZoom.type='range'; sliderZoom.min=40; sliderZoom.max=600; sliderZoom.value=zoomDist;
    sliderZoom.oninput = e => { zoomDist = +e.target.value; syncQuery(); };
    controls.append(lbl3, sliderZoom);

    document.body.appendChild(controls);

    // Legend (no leaf line)
    const legend = document.createElement('div');
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
      <span style="color:${COLORS.back}">●</span> Backtrace<br>
    `;
    document.body.appendChild(legend);

    // Topbar
    const topbar = document.createElement('div');
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
      <label style="display:flex;gap:.35rem;align-items:center;">
        <input type="checkbox" id="heatChk"> Heat by $ </label>
      <label style="display:flex;gap:.35rem;align-items:center;">
        <input type="checkbox" id="isolateChk"> Isolate subtree </label>
      <button id="exportBtn" style="padding:.45rem .7rem;border-radius:.5rem;border:1px solid #444;background:#0b1220;color:#cfe3ff;opacity:.6;cursor:not-allowed;">
        Export CSV
      </button>
    `;
    document.body.appendChild(topbar);

    const findInput = topbar.querySelector('#findInput');
    const findBtn   = topbar.querySelector('#findBtn');
    const heatChk   = topbar.querySelector('#heatChk');
    const isolateChk= topbar.querySelector('#isolateChk');
    const exportBtn = topbar.querySelector('#exportBtn');

    findBtn.addEventListener('click', () => tryFindAndFocus(findInput.value));
    findInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryFindAndFocus(findInput.value); });
    heatChk.addEventListener('change', e => { heatByDonation = !!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });
    isolateChk.addEventListener('change', e => { isolateView = !!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });

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

    // Type filters only (no leaf toggle anymore)
    const filters = document.createElement('div');
    Object.assign(filters.style, {
      position:'absolute', left:'20px', top:'78px',
      background:'rgba(0,0,0,0.6)', color:'#fff', padding:'8px 10px',
      borderRadius:'8px', display:'grid', gridTemplateColumns:'auto auto', gap:'6px 16px'
    });
    const TYPES = [
      ['root','Root'], ['primary','Primary'], ['extra','Extra'], ['down','Downline']
    ];
    TYPES.forEach(([key,label])=>{
      const w = document.createElement('label');
      w.style.display='flex'; w.style.alignItems='center'; w.style.gap='.35rem';
      const c = document.createElement('input'); c.type='checkbox'; c.checked=true;
      c.addEventListener('change', ()=>{
        if (c.checked) visibleTypes.add(key); else visibleTypes.delete(key);
        updateAllNodeObjects(); Graph.refresh(); syncQuery();
      });
      w.appendChild(c); w.appendChild(document.createTextNode(label));
      filters.appendChild(w);
    });
    document.body.appendChild(filters);

    // ---- find + URL state ----
    function tryFindAndFocus(raw){
      const id = Number(String(raw||'').replace(/\D/g,''));
      if (!Number.isFinite(id)) return pulse(findInput,'#ff6b6b');
      const node = byId.get(id);
      if (!node) return pulse(findInput,'#ffb020');
      const wait = () => (Number.isFinite(node.x) ? Promise.resolve() : new Promise(res => setTimeout(()=>res(wait()), 80)));
      wait().then(()=>{ highlightPath(node); pulse(findInput,'#00ff9c'); });
    }
    function pulse(el, color){
      const old = el.style.boxShadow;
      el.style.boxShadow = `0 0 0 3px ${color}55`; setTimeout(()=> el.style.boxShadow = old, 450);
    }
    function applyQuery(){
      const p = new URLSearchParams(location.search);
      const qSize = +p.get('size');     if (qSize)  { nodeSize = qSize; sliderNode.value = nodeSize; }
      const qSpread = +p.get('spread'); if (qSpread){ universeSpread = qSpread; sliderSpread.value = universeSpread; }
      const qZoom = +p.get('zoom');     if (qZoom)  { zoomDist = qZoom; sliderZoom.value = zoomDist; }
      const qIsolate = p.get('isolate');if (qIsolate==='1'){ isolateView = true; isolateChk.checked=true; }
      const qHeat = p.get('heat');      if (qHeat==='1'){ heatByDonation = true; heatChk.checked=true; } else { heatByDonation=false; heatChk.checked=false; }
      const qTypes = p.get('types');
      if (qTypes){
        visibleTypes.clear();
        qTypes.split(',').forEach(t => { if (t) visibleTypes.add(t); });
        Array.from(filters.querySelectorAll('input[type=checkbox]')).forEach((cb,i)=>{
          const key = TYPES[i][0]; cb.checked = visibleTypes.has(key);
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
      p.set('types', Array.from(visibleTypes).join(','));
      window.history.replaceState({}, '', `${location.pathname}?${p.toString()}`);
    }

    // run
    const data = generateUniverse(3200, 250);
    draw(data);
    applyQuery();
  }
})();
