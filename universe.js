(() => {
  // ---------- SINGLETON GUARD ----------
  if (window.__DG_LOCK__) return;              // already starting
  window.__DG_LOCK__ = true;

  if (window.__DG_APP__?.destroy) {
    try { window.__DG_APP__.destroy(); } catch (_) {}
  }

  const UI_IDS = {
    controls: 'dg-controls',
    legend:   'dg-legend',
    topbar:   'dg-topbar',
    filters:  'dg-filters'
  };
  const $  = (sel) => document.querySelector(sel);
  const rm = (id) => { const el = document.getElementById(id); if (el) el.remove(); };

  // ---------- LIB LOADER ----------
  // Do NOT reload THREE – Squarespace already injects it.
  function loadScript(src){
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res; s.onerror = () => rej(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }
  async function ensureLibs(){
    if (!window.ForceGraph3D) {
      // Pinned, stable build
      await loadScript('https://unpkg.com/3d-force-graph@1.71.6/dist/3d-force-graph.min.js');
    }
    if (!window.THREE) {
      // As a last resort, only if Squarespace didn't include THREE
      await loadScript('https://unpkg.com/three@0.152.2/build/three.min.js');
    }
  }

  // Wait until #graph has a real size (prevents 'tick' crash)
  function waitForSize(el, timeoutMs=4000){
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      (function check(){
        const w = el.clientWidth, h = el.clientHeight;
        if (w > 0 && h > 0) return resolve();
        if (performance.now() - t0 > timeoutMs) return reject(new Error('graph container has zero size'));
        requestAnimationFrame(check);
      })();
    });
  }

  ensureLibs()
    .then(start)
    .catch(err => {
      const s = $('#status'); if (s) s.textContent = `Failed to load libs: ${err.message}`;
      console.error(err);
      window.__DG_LOCK__ = false;
    });

  // ============================== APP ==============================
  function start(){
    const container = document.getElementById('graph');
    const statusEl  = document.getElementById('status');
    if (!container) { console.error('#graph not found'); window.__DG_LOCK__ = false; return; }

    // Clean any previous canvas + UI
    container.innerHTML = '';
    Object.values(UI_IDS).forEach(rm);

    const THREE = window.THREE;
    const ForceGraph3D = window.ForceGraph3D;

    // ---------- STATE ----------
    let Graph;
    let nodes=[], links=[], byId=new Map();

    let selectedNode=null, highlightNodes=new Set(), highlightLinkKeys=new Set();

    // BIGGER defaults
    let nodeSize=48;
    let universeSpread=170;
    let zoomDist=340;
    let heatByDonation=false;
    let isolateView=false;
    let showLinksAll=false; // off by default

    const visibleTypes = new Set(['root','primary','extra','down']);
    let minDonation=0, maxDonation=1;

    const COLORS = {
      rootHex:0x1f4aa8, primaryHex:0x7cc3ff, extraHex:0x2ecc71, downHex:0xe74c3c,
      forward:'#00ff9c', faded:'rgba(100,100,100,0.12)'
    };
    const money=v=>`$${(v||0).toLocaleString()}`;
    const idOf = v => (typeof v === 'object' ? v.id : v);

    // ---------- DATA ----------
    function randomDonation(){ const r=Math.random();
      if (r<.75) return Math.floor(50+Math.random()*50);
      if (r<.95) return Math.floor(100+Math.random()*400);
      return Math.floor(500+Math.random()*4500);
    }
    function pickBiasedParent(){
      const pool = nodes.filter(n=>n.type==='extra'||n.type==='down');
      if (pool.length && Math.random()<.35) return pool[Math.floor(Math.random()*pool.length)];
      return nodes[Math.floor(Math.random()*nodes.length)];
    }
    function generateUniverse(total=3200, seedRoots=250){
      nodes=[]; links=[]; byId=new Map();
      let id=0;
      for(let i=0;i<seedRoots;i++){
        const n={id:id++, type:'root', donation:randomDonation(), children:[], parent:null, inactive:false};
        nodes.push(n); byId.set(n.id,n);
      }
      for(let i=seedRoots;i<total;i++){
        const p=pickBiasedParent(), d=randomDonation();
        let type='primary'; if (p.children.length>0) type = p.type==='primary' ? 'extra' : 'down';
        const c={id:id++, type, donation:d, children:[], parent:p.id, inactive:false};
        nodes.push(c); byId.set(c.id,c); p.children.push(c.id);
        links.push({source:p.id, target:c.id}); // numbers OK; FG will objectify
      }
      nodes.forEach(n=>{ n.inactive=(n.children.length===0); });
      minDonation=Math.min(...nodes.map(n=>n.donation));
      maxDonation=Math.max(...nodes.map(n=>n.donation));
      return {nodes,links};
    }

    // ---------- METRICS ----------
    function getBloodlineTotal(rootId){
      let t=0; const seen=new Set();
      (function dfs(id){ if(seen.has(id))return; seen.add(id);
        const n=byId.get(id); if(!n)return; t+=n.donation||0; n.children.forEach(dfs);
      })(rootId);
      return t;
    }
    function getSubtreeStats(rootId){
      let c=0,t=0,d=0;
      (function dfs(id,dep){
        c++; d=Math.max(d,dep);
        const n=byId.get(id); if(!n)return; t+=n.donation||0; n.children.forEach(x=>dfs(x,dep+1));
      })(rootId,0);
      return {count:c,total:t,depth:d};
    }
    function collectSubtree(rootId){
      const rows=[]; (function dfs(id){ const n=byId.get(id); if(!n)return;
        rows.push({id:n.id,type:n.type,donation:n.donation,parent:n.parent,inactive:n.inactive});
        n.children.forEach(dfs);
      })(rootId);
      return rows;
    }

    // ---------- APPEARANCE ----------
    const typeHex = t => t==='root'?COLORS.rootHex : t==='primary'?COLORS.primaryHex : t==='extra'?COLORS.extraHex : t==='down'?COLORS.downHex : 0xaaaaaa;
    const rgbHex  = (r,g,b)=>((r&255)<<16)|((g&255)<<8)|(b&255);
    const heatHex = n => { const tt=(n.donation-minDonation)/Math.max(1,(maxDonation-minDonation));
      const r=Math.round(255*tt), g=Math.round(255*(1-0.3*tt)); return rgbHex(r,g,60); };
    const fillHex = n => heatByDonation ? heatHex(n) : typeHex(n.type);

    const baseRadius = n => heatByDonation ? Math.max(12, nodeSize*(n.donation/100)) : nodeSize;
    function radiusFor(n){
      const b=baseRadius(n);
      if (!selectedNode) return b;
      if (!highlightNodes.has(n.id)) return b*0.75;
      return n.id===selectedNode.id ? b*3.0 : b*2.0;
    }

    const nodeIsVisibleByType = n => visibleTypes.has(n.type);
    function nodeShouldDisplay(n){ if(!n) return true;
      if(!nodeIsVisibleByType(n)) return false;
      if(isolateView && selectedNode) return highlightNodes.has(n.id);
      return true;
    }
    const linkKey = l => `${idOf(l.source)}->${idOf(l.target)}`;
    function linkVisible(l){
      const s=byId.get(idOf(l.source)), t=byId.get(idOf(l.target));
      if(!s||!t) return false;
      if(!nodeShouldDisplay(s)||!nodeShouldDisplay(t)) return false;
      if(selectedNode) return showLinksAll || highlightLinkKeys.has(linkKey(l));
      return showLinksAll;
    }

    // ---------- SELECTION + CAMERA ----------
    function clearHighlights(){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=null;
      updateAllNodeObjects(); Graph.refresh(); updateExportState(); syncQuery();
      if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
    }
    function highlightPath(node){
      highlightNodes.clear(); highlightLinkKeys.clear(); selectedNode=node;
      const down=id=>{ highlightNodes.add(id);
        links.forEach(l=>{ if(idOf(l.source)===id){ highlightLinkKeys.add(linkKey(l)); down(idOf(l.target)); }});
      };
      const up=id=>{ links.forEach(l=>{ if(idOf(l.target)===id){ highlightLinkKeys.add(linkKey(l)); highlightNodes.add(idOf(l.source)); up(idOf(l.source)); }});
      };
      down(node.id); up(node.id);
      const s=getSubtreeStats(node.id);
      if (statusEl) statusEl.textContent = `Focused coin #${node.id} — subtree: ${s.count} donors, ${money(s.total)} total, depth ${s.depth}. (ESC to reset)`;
      updateAllNodeObjects(); Graph.refresh(); updateExportState(); focusCamera(node); syncQuery();
    }
    function focusCamera(node){
      if (!node || !Graph) return;
      const d=zoomDist;
      Graph.cameraPosition({x:node.x+d, y:node.y+d*0.8, z:node.z+d},{x:node.x,y:node.y,z:node.z},600);
    }
    function applyZoomNow(){
      if (!Graph) return;
      const cam=Graph.camera&&Graph.camera(); if(!cam) return;
      const target = selectedNode ? new THREE.Vector3(selectedNode.x,selectedNode.y,selectedNode.z) : new THREE.Vector3(0,0,0);
      const cur = new THREE.Vector3(cam.position.x,cam.position.y,cam.position.z);
      let dir = cur.sub(target); if (dir.length()===0) dir = new THREE.Vector3(1,1,1);
      dir.normalize().multiplyScalar(zoomDist);
      Graph.cameraPosition({x:target.x+dir.x,y:target.y+dir.y,z:target.z+dir.z},{x:target.x,y:target.y,z:target.z},0);
    }

    // ---------- DRAW ----------
    function draw({nodes,links}){
      Graph = ForceGraph3D()(container)
        .backgroundColor('#000')
        .nodeThreeObject(n=>{
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1,16,16),
            new THREE.MeshBasicMaterial({color:typeHex(n.type), transparent:true, opacity:1})
          );
          n.__fill = mesh; n.__obj = mesh; return mesh;
        })
        .nodeLabel(n=>{
          const total=getBloodlineTotal(n.id);
          return `<div><b>${n.type.toUpperCase()}</b><br/>Coin #: ${n.id}<br/>Donation: ${money(n.donation)}<br/><b>Bloodline Total:</b> ${money(total)}</div>`;
        })
        .linkVisibility(linkVisible)
        .linkColor(l=> highlightLinkKeys.has(linkKey(l)) ? COLORS.forward : 'rgba(180,180,180,0.22)')
        .linkWidth(l=> highlightLinkKeys.has(linkKey(l)) ? 3.8 : 0.35)
        .linkOpacity(l=> highlightLinkKeys.has(linkKey(l)) ? 1 : (showLinksAll ? 0.08 : 0.0))
        .linkDirectionalParticles(l=> highlightLinkKeys.has(linkKey(l)) ? 3 : 0)
        .linkDirectionalParticleWidth(3.0)
        .linkDirectionalParticleSpeed(0.010)
        .linkDirectionalParticleColor(l=> highlightLinkKeys.has(linkKey(l)) ? COLORS.forward : '#000000')
        .onNodeClick(highlightPath)
        .graphData({nodes,links});

      // Force parameters (guarded)
      try {
        Graph.d3Force('charge').strength(-universeSpread);
        Graph.d3Force('link').distance(universeSpread).strength(0.45);
        if (typeof Graph.d3ReheatSimulation === 'function') Graph.d3ReheatSimulation();
      } catch(_){}

      const ctrl = Graph.controls && Graph.controls();
      if (ctrl){
        ctrl.zoomSpeed = 3.2; ctrl.minDistance=40; ctrl.maxDistance=6000;
        ctrl.enableDamping = true; ctrl.dampingFactor = 0.12;
      }

      // Size to container & keep updated
      const fit = () => {
        const w = container.clientWidth || 800;
        const h = container.clientHeight || 600;
        if (Graph.width) Graph.width(w);
        if (Graph.height) Graph.height(h);
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(container);

      updateAllNodeObjects(); Graph.refresh();
      if (statusEl) statusEl.textContent = `Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;

      // ESC to clear
      const keyHandler = (ev) => { if (ev.key === 'Escape') clearHighlights(); };
      window.addEventListener('keydown', keyHandler);

      // expose destroyer
      window.__DG_APP__ = {
        destroy(){
          try { window.removeEventListener('keydown', keyHandler); } catch(_){}
          try { ro.disconnect(); } catch(_){}
          try { Graph && Graph.pauseAnimation && Graph.pauseAnimation(); } catch(_){}
          try { container.innerHTML=''; } catch(_){}
          Object.values(UI_IDS).forEach(rm);
        }
      };
      // release init lock
      window.__DG_LOCK__ = false;
    }

    function updateAllNodeObjects(){
      nodes.forEach(n=>{
        const fill=n.__fill; if(!fill) return;
        fill.visible = nodeShouldDisplay(n);
        const r = Math.max(0.001, radiusFor(n));
        fill.scale.set(r,r,r);
        fill.material.color.setHex(fillHex(n));
        fill.material.opacity = selectedNode ? (highlightNodes.has(n.id)?1.0:0.10) : 1.0;
      });
      if (Graph && Graph.linkVisibility) Graph.linkVisibility(linkVisible);
    }

    // ---------- UI (fixed IDs; no duplicates) ----------
    const controls = document.createElement('div');
    controls.id = UI_IDS.controls;
    Object.assign(controls.style,{position:'absolute',left:'20px',bottom:'20px',background:'rgba(0,0,0,0.6)',color:'#fff',padding:'10px',borderRadius:'8px',lineHeight:'1.1'});

    const lbl1=document.createElement('label'); lbl1.textContent='Node Size:'; lbl1.style.display='block';
    const sliderNode=document.createElement('input'); sliderNode.type='range'; sliderNode.min=16; sliderNode.max=160; sliderNode.value=nodeSize;
    sliderNode.oninput=e=>{ nodeSize=+e.target.value; updateAllNodeObjects(); Graph.refresh(); syncQuery(); };
    controls.append(lbl1, sliderNode, document.createElement('br'));

    const lbl2=document.createElement('label'); lbl2.textContent='Universe Spread:'; lbl2.style.display='block';
    const sliderSpread=document.createElement('input'); sliderSpread.type='range'; sliderSpread.min=60; sliderSpread.max=380; sliderSpread.value=universeSpread;
    sliderSpread.oninput=e=>{ universeSpread=+e.target.value;
      try { Graph.d3Force('charge').strength(-universeSpread); Graph.d3Force('link').distance(universeSpread).strength(0.45);
            if (typeof Graph.d3ReheatSimulation==='function') Graph.d3ReheatSimulation(); } catch(_){}
      Graph.refresh(); syncQuery(); };
    controls.append(lbl2, sliderSpread, document.createElement('br'));

    const lbl3=document.createElement('label'); lbl3.textContent='Zoom Distance:'; lbl3.style.display='block';
    const sliderZoom=document.createElement('input'); sliderZoom.type='range'; sliderZoom.min=120; sliderZoom.max=1400; sliderZoom.value=zoomDist;
    sliderZoom.oninput=e=>{ zoomDist=+e.target.value; applyZoomNow(); syncQuery(); };
    controls.append(lbl3, sliderZoom);
    document.body.appendChild(controls);

    const legend=document.createElement('div');
    legend.id = UI_IDS.legend;
    Object.assign(legend.style,{position:'absolute',top:'10px',right:'10px',background:'rgba(0,0,0,0.7)',color:'#fff',padding:'10px',borderRadius:'6px'});
    legend.innerHTML=`<b>Legend</b><br>
      <span style="color:#1f4aa8">●</span> Root<br>
      <span style="color:#7cc3ff">●</span> Primary<br>
      <span style="color:#2ecc71">●</span> Extra<br>
      <span style="color:#e74c3c">●</span> Downline<br>
      <span style="color:${COLORS.forward}">●</span> Forward path<br>`;
    document.body.appendChild(legend);

    const topbar=document.createElement('div');
    topbar.id = UI_IDS.topbar;
    Object.assign(topbar.style,{position:'absolute',left:'20px',top:'20px',display:'flex',gap:'.5rem',alignItems:'center',background:'rgba(0,0,0,0.6)',padding:'10px',borderRadius:'8px',color:'#fff'});
    topbar.innerHTML=`
      <input id="findInput" inputmode="numeric" pattern="[0-9]*" placeholder="Find coin # (e.g., 2436)"
        style="width:210px;padding:.5rem .65rem;border-radius:.5rem;border:1px solid #334;background:#0b1220;color:#cfe3ff;">
      <button id="findBtn" style="padding:.55rem .8rem;border-radius:.5rem;border:0;background:#3478f6;color:#fff;">Find</button>
      <label style="display:flex;gap:.35rem;align-items:center;"><input type="checkbox" id="heatChk"> Heat by $</label>
      <label style="display:flex;gap:.35rem;align-items:center;"><input type="checkbox" id="isolateChk"> Isolate subtree</label>
      <label style="display:flex;gap:.35rem;align-items:center;"><input type="checkbox" id="linksChk"> Show links</label>
      <button id="exportBtn" style="padding:.45rem .7rem;border-radius:.5rem;border:1px solid #444;background:#0b1220;color:#cfe3ff;opacity:.6;cursor:not-allowed;">Export CSV</button>`;
    document.body.appendChild(topbar);

    const findInput = $('#findInput'), findBtn = $('#findBtn');
    const heatChk   = $('#heatChk'),   isolateChk = $('#isolateChk'), linksChk = $('#linksChk');
    const exportBtn = $('#exportBtn');

    findBtn.addEventListener('click',()=> tryFindAndFocus(findInput.value));
    findInput.addEventListener('keydown',e=>{ if(e.key==='Enter') tryFindAndFocus(findInput.value); });
    heatChk.addEventListener('change',   e=>{ heatByDonation=!!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });
    isolateChk.addEventListener('change',e=>{ isolateView   =!!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });
    linksChk.addEventListener('change',  e=>{ showLinksAll  =!!e.target.checked; updateAllNodeObjects(); Graph.refresh(); syncQuery(); });

    function updateExportState(){
      if (selectedNode){ exportBtn.style.opacity='1'; exportBtn.style.cursor='pointer'; exportBtn.disabled=false; }
      else { exportBtn.style.opacity='.6'; exportBtn.style.cursor='not-allowed'; exportBtn.disabled=true; }
    }

    exportBtn.addEventListener('click', ()=>{
      if (!selectedNode) return;
      const rows=collectSubtree(selectedNode.id);
      const header='coin_id,type,donation,parent_id,inactive\n';
      const body=rows.map(r=>`${r.id},${r.type},${r.donation},${r.parent??''},${r.inactive}`).join('\n');
      const blob=new Blob([header+body],{type:'text/csv'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download=`subtree_${selectedNode.id}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });

    const filters=document.createElement('div');
    filters.id = UI_IDS.filters;
    Object.assign(filters.style,{position:'absolute',left:'20px',top:'78px',background:'rgba(0,0,0,0.6)',color:'#fff',padding:'8px 10px',borderRadius:'8px',display:'grid',gridTemplateColumns:'auto auto',gap:'6px 16px'});
    const TYPES=[['root','Root'],['primary','Primary'],['extra','Extra'],['down','Downline']];
    TYPES.forEach(([key,label])=>{
      const w=document.createElement('label'); w.style.display='flex'; w.style.alignItems='center'; w.style.gap='.35rem';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=true;
      cb.addEventListener('change',()=>{ if(cb.checked) visibleTypes.add(key); else visibleTypes.delete(key);
        if (visibleTypes.size===0) TYPES.forEach(([k])=>visibleTypes.add(k)); // never 0
        updateAllNodeObjects(); Graph.refresh(); syncQuery(); });
      w.appendChild(cb); w.appendChild(document.createTextNode(label)); filters.appendChild(w);
    });
    document.body.appendChild(filters);

    // ---- Find + URL ----
    function tryFindAndFocus(raw){
      const id = Number(String(raw||'').replace(/\D/g,'')); if(!Number.isFinite(id)) return pulse(findInput,'#ff6b6b');
      const node = byId.get(id); if(!node) return pulse(findInput,'#ffb020');
      const wait = () => (Number.isFinite(node.x)?Promise.resolve():new Promise(r=>setTimeout(()=>r(wait()),80)));
      wait().then(()=>{ highlightPath(node); pulse(findInput,'#00ff9c'); });
    }
    function pulse(el,color){ const old=el.style.boxShadow; el.style.boxShadow=`0 0 0 3px ${color}55`; setTimeout(()=>el.style.boxShadow=old,450); }

    function applyQuery(){
      const p=new URLSearchParams(location.search);
      const qs=+p.get('size');   if(qs){ nodeSize=qs; sliderNode.value=nodeSize; }
      const qsp=+p.get('spread');if(qsp){ universeSpread=qsp; sliderSpread.value=universeSpread; }
      const qz=+p.get('zoom');   if(qz){ zoomDist=qz; sliderZoom.value=zoomDist; applyZoomNow(); }
      const qi=p.get('isolate'); if(qi==='1'){ isolateView=true; $('#isolateChk').checked=true; }
      const qh=p.get('heat');    if(qh==='1'){ heatByDonation=true; $('#heatChk').checked=true; } else { heatByDonation=false; $('#heatChk').checked=false; }
      const ql=p.get('links');   if(ql==='1'){ showLinksAll=true; $('#linksChk').checked=true; } else { showLinksAll=false; $('#linksChk').checked=false; }
      const qt=p.get('types');   if(qt){ visibleTypes.clear(); qt.split(',').forEach(t=>t&&visibleTypes.add(t));
        Array.from(filters.querySelectorAll('input[type=checkbox]')).forEach((cb,i)=>{ const key=TYPES[i][0]; cb.checked=visibleTypes.has(key); }); }
      updateAllNodeObjects(); Graph.refresh();
    }
    function syncQuery(){
      const p=new URLSearchParams(location.search);
      if (selectedNode) p.set('find', selectedNode.id); else p.delete('find');
      p.set('size', String(nodeSize)); p.set('spread', String(universeSpread)); p.set('zoom', String(zoomDist));
      p.set('isolate', isolateView?'1':'0'); p.set('heat', heatByDonation?'1':'0'); p.set('links', showLinksAll?'1':'0');
      p.set('types', Array.from(visibleTypes).join(',')); history.replaceState({},'',`${location.pathname}?${p.toString()}`);
    }

    // ---------- BOOT WHEN CONTAINER HAS SIZE ----------
    waitForSize(container)
      .then(() => {
        const data = generateUniverse(3200,250);
        draw(data);
        applyQuery();
      })
      .catch(err => {
        if (statusEl) statusEl.textContent = `Layout error: ${err.message}`;
        console.error(err);
        window.__DG_LOCK__ = false;
      });
  }
})();
