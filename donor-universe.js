/* Donor Universe (controls-fixed)
   - Forces canvas & toolbar to top of a new stacking context
   - Guarantees pointer events (drag/pan/zoom, button clicks)
   - Three.js + OrbitControls with robust fallbacks
*/

(() => {
  // ---- load-once guard ----
  if (window.__DU_SCRIPT_ACTIVE__) { console.warn('[DU] already loaded; skipping'); return; }
  window.__DU_SCRIPT_ACTIVE__ = true;

  // ---- DOM handles ----
  const $ = (id) => document.getElementById(id);
  const host = $('gl');             // required container (DIV or CANVAS)
  const coinsEl  = $('coins');      // optional counters
  const raisedEl = $('raised');
  const statusEl = $('status');
  const setStatus = (m)=>{ if(statusEl) statusEl.textContent = 'Status: ' + m; console.log('[DU]', m); };
  const fmt$ = (n)=> n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

  if(!host){ console.error('[DU] Missing #gl container'); return; }

  // ---- ensure our own stacking context and top layers ----
  // hostWrap is the element we control; we create it if host is a CANVAS
  let hostWrap = host;
  if (host.tagName === 'CANVAS') {
    // Wrap the canvas so we can layer UI above it without breaking layout
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.style.isolation = 'isolate';                  // new stacking context
    wrap.style.width = '100%';
    wrap.style.height = host.style.height || '75vh';
    const parent = host.parentElement;
    parent.insertBefore(wrap, host);
    wrap.appendChild(host);
    hostWrap = wrap;
  } else {
    host.style.position = 'relative';
    host.style.isolation = 'isolate';                  // new stacking context
  }

  // ---- UI overlay container (never blocks canvas except on buttons) ----
  const overlay = document.createElement('div');
  overlay.id = 'du-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:2147483000;pointer-events:none;';
  hostWrap.appendChild(overlay);

  // Legend (top-left)
  const legend = document.createElement('div');
  legend.style.cssText = 'position:absolute;left:10px;top:10px;background:#121a36;border:1px solid #1f2a4d;border-radius:8px;padding:8px 10px;font-size:12px;color:#cfe1ff;pointer-events:auto;';
  legend.innerHTML = `
    <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#1e3a8a;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Dark blue: roots</div>
    <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#93c5fd;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Light blue: primary (+1)</div>
    <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Green: extras</div>
    <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Red: downstream of any green</div>
  `;
  overlay.appendChild(legend);

  // Toolbar (top-right)
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'position:absolute;right:14px;top:14px;display:flex;gap:8px;pointer-events:auto;';
  const mkBtn=(label)=>{ const b=document.createElement('button'); b.textContent=label;
    b.style.cssText='padding:6px 10px;border-radius:10px;background:#131a2f;color:#cfe1ff;border:1px solid #2a355a;cursor:pointer;font-size:12px;'; return b; };
  const btnReset = mkBtn('Reset View');
  const btnSpin  = mkBtn('⏸ Spin');
  const btnEdges = mkBtn('Hide Edges');
  const btnHelp  = mkBtn('Help');
  toolbar.append(btnReset, btnSpin, btnEdges, btnHelp);
  overlay.appendChild(toolbar);

  // ---- Three.js loader with fallbacks ----
  async function loadThree() {
    // Prefer ESM
    try {
      const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
      let OrbitControls=null;
      try { ({ OrbitControls } = await import('https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module')); } catch {}
      return { THREE, OrbitControls };
    } catch (e1) {
      try {
        const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
        let OrbitControls=null;
        try { ({ OrbitControls } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js')); } catch {}
        return { THREE, OrbitControls };
      } catch (e2) {
        // Absolute last resort: global UMD
        await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://unpkg.com/three@0.149.0/build/three.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
        if (!window.THREE) throw new Error('Three failed to load');
        return { THREE: window.THREE, OrbitControls: null };
      }
    }
  }

  // Fallback orbit control (if OrbitControls missing)
  function makeSimpleOrbit(THREE, camera, dom, target = new THREE.Vector3()) {
    let az = 0, el = 0, r = camera.position.distanceTo(target);
    let dragging=false, rotating=true, lastX=0, lastY=0;
    function apply(){
      const cosE=Math.cos(el), sinE=Math.sin(el), cosA=Math.cos(az), sinA=Math.sin(az);
      camera.position.set(target.x + r*cosE*sinA, target.y + r*sinE, target.z + r*cosE*cosA);
      camera.lookAt(target);
    }
    dom.addEventListener('contextmenu', e=>e.preventDefault());
    dom.addEventListener('mousedown', e=>{ dragging=true; rotating=!(e.button===2||e.ctrlKey||e.shiftKey); lastX=e.clientX; lastY=e.clientY; dom.style.cursor='grabbing'; });
    window.addEventListener('mouseup', ()=>{ dragging=false; dom.style.cursor='grab'; });
    window.addEventListener('mousemove', e=>{
      if(!dragging) return;
      const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
      if(rotating){ az+=dx*0.005; el=Math.max(-1.2,Math.min(1.2,el+dy*0.005)); }
      else{
        const panScale=r*0.0016;
        const right=new THREE.Vector3().subVectors(camera.position,target).cross(camera.up).normalize();
        const up=new THREE.Vector3().copy(camera.up).normalize();
        target.addScaledVector(right,-dx*panScale);
        target.addScaledVector(up,   dy*panScale);
      }
      apply();
    });
    dom.addEventListener('wheel', e=>{ e.preventDefault(); r=Math.max(10,Math.min(5000,r+e.deltaY*0.5)); apply(); }, {passive:false});
    apply();
    return { update: apply, target };
  }

  (async () => {
    setStatus('initializing…');

    const { THREE, OrbitControls } = await loadThree();

    // ---- Renderer ----
    const isCanvas = host.tagName === 'CANVAS';
    const renderer = isCanvas
      ? new THREE.WebGLRenderer({ antialias:true, canvas:host, alpha:false })
      : new THREE.WebGLRenderer({ antialias:true, alpha:false });

    // Make sure the canvas is topmost and interactive
    const canvas = renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0;z-index:2147482800;pointer-events:auto;touch-action:none;cursor:grab;';
    if (!isCanvas) {
      // put our canvas inside hostWrap
      hostWrap.appendChild(canvas);
    } else {
      // if host was canvas, ensure it gets the same styling
      host.style.position = 'absolute'; host.style.inset = '0';
      host.style.zIndex = '2147482800'; host.style.pointerEvents = 'auto'; host.style.touchAction='none';
    }

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
    renderer.setClearColor(0x000000, 1);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20000);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(300,500,400); scene.add(dir);

    // Controls
    let controls;
    if (OrbitControls) {
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true; controls.dampingFactor = 0.06;
      controls.rotateSpeed=0.9; controls.zoomSpeed=0.8; controls.panSpeed=0.8;
    } else {
      controls = makeSimpleOrbit(THREE, camera, canvas);
    }

    // Resize
    function resize(){
      const w = hostWrap.clientWidth || window.innerWidth;
      const h = hostWrap.clientHeight || Math.round(window.innerHeight*0.7);
      camera.aspect = Math.max(0.2, w/Math.max(1,h));
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    window.addEventListener('resize', resize);
    setTimeout(resize, 30); setTimeout(resize, 250);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hostWrap);

    // ---- Generate donor graph ----
    const COLOR = { dark:0x1e3a8a, light:0x93c5fd, green:0x22c55e, red:0xef4444 };
    const EDGE=0x5b6b95, HILITE=0x6ee7ff;

    const SEEDS=250, RADIUS=820, JITTER=34, EX_MIN=2, EX_RAND=3, RED_MIN=2, RED_RAND=4, COIN=50;

    const nodes=[], links=[]; let id=0;
    function add(type,parent=null){ const n={id:id++,type,parent,x:0,y:0,z:0,children:[]}; nodes.push(n); if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);} return n;}
    function fib(n,r){const pts=[],phi=Math.PI*(3-Math.sqrt(5)); for(let i=0;i<n;i++){const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i; pts.push(new THREE.Vector3(Math.cos(th)*rad*r,y*r,Math.sin(th)*rad*r));} return pts;}
    const rnd = ()=> (Math.random()*2-1)*JITTER;

    for(let i=0;i<SEEDS;i++) add('dark',null);
    const roots = nodes.filter(n=>n.type==='dark');
    const pts=fib(roots.length,RADIUS); roots.forEach((n,i)=>{n.x=pts[i].x; n.y=pts[i].y; n.z=pts[i].z;});
    for(const r of roots){
      const l=add('light',r.id); l.x=r.x+rnd(); l.y=r.y+rnd(); l.z=r.z+rnd();
      const greens = EX_MIN + ((Math.random()* (EX_RAND+1))|0); // 2..5
      for(let g=0; g<greens; g++){
        const gn=add('green',r.id); gn.x=r.x+rnd(); gn.y=r.y+rnd(); gn.z=r.z+rnd();
        const reds = RED_MIN + ((Math.random()*(RED_RAND+1))|0); // 2..6
        for(let k=0;k<reds;k++){ const d=add('red',gn.id); d.x=gn.x+rnd(); d.y=gn.y+rnd(); d.z=gn.z+rnd(); }
      }
    }

    // ---- Spheres ----
    const MATS={
      dark : new THREE.MeshStandardMaterial({color:COLOR.dark ,metalness:0.2,roughness:0.45}),
      light: new THREE.MeshStandardMaterial({color:COLOR.light,metalness:0.2,roughness:0.45}),
      green: new THREE.MeshStandardMaterial({color:COLOR.green,metalness:0.2,roughness:0.45}),
      red  : new THREE.MeshStandardMaterial({color:COLOR.red  ,metalness:0.2,roughness:0.45})
    };
    const GEOS={
      dark : new THREE.SphereGeometry(5.5,18,18),
      light: new THREE.SphereGeometry(4.2,18,18),
      green: new THREE.SphereGeometry(4.7,18,18),
      red  : new THREE.SphereGeometry(3.7,18,18)
    };
    const spheres=[];
    for(const n of nodes){ const m=new THREE.Mesh(GEOS[n.type], MATS[n.type]); m.position.set(n.x,n.y,n.z); m.userData.id=n.id; spheres.push(m); scene.add(m); }

    // ---- Edges ----
    const pos=new Float32Array(links.length*6); let kk=0;
    for(const l of links){ const a=nodes[l.source], b=nodes[l.target]; pos[kk++]=a.x; pos[kk++]=a.y; pos[kk++]=a.z; pos[kk++]=b.x; pos[kk++]=b.y; pos[kk++]=b.z; }
    const edgeGeo=new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const edges=new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({color:EDGE, transparent:true, opacity:0.28}));
    scene.add(edges);

    // ---- Fit camera ----
    const box=new THREE.Box3(); for(const s of spheres) box.expandByPoint(s.position);
    const size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const maxDim=Math.max(size.x,size.y,size.z);
    const fitDist = maxDim / (2*Math.tan((Math.PI/180)*camera.fov/2));
    const dist = fitDist*1.35;
    camera.position.copy(center.clone().add(new THREE.Vector3(0,0,dist)));
    camera.near=dist/100; camera.far=dist*400; camera.updateProjectionMatrix();
    if (controls.target) controls.target.copy(center);
    if (controls.update) controls.update();

    // ---- Picking & highlight ----
    let glow=null; const ray=new THREE.Raycaster(), mouse=new THREE.Vector2();
    function clearHi(){ if(glow){ scene.remove(glow); glow.geometry.dispose(); glow.material.dispose(); glow=null; }
      for(const m of spheres){ m.material.transparent=false; m.material.opacity=1; }
      edges.material.opacity=0.28; setStatus('ready — click a node to explore.'); }
    function highlight(startId){
      clearHi();
      const keep=new Set([startId]), q=[startId];
      while(q.length){ const cur=q.shift(); for(const l of links) if(l.source===cur && !keep.has(l.target)){ keep.add(l.target); q.push(l.target); } }
      for(const m of spheres){ const on=keep.has(m.userData.id); m.material.transparent=true; m.material.opacity=on?1:0.12; }
      edges.material.opacity=0.08;
      const kept=links.filter(l=> keep.has(l.source)&&keep.has(l.target));
      const gpos=new Float32Array(kept.length*6); let i=0;
      for(const l of kept){ const a=nodes[l.source], b=nodes[l.target]; gpos[i++]=a.x; gpos[i++]=a.y; gpos[i++]=a.z; gpos[i++]=b.x; gpos[i++]=b.y; gpos[i++]=b.z; }
      const ggeo=new THREE.BufferGeometry(); ggeo.setAttribute('position', new THREE.BufferAttribute(gpos,3));
      glow=new THREE.LineSegments(ggeo, new THREE.LineBasicMaterial({color:HILITE, transparent:true, opacity:0.95}));
      scene.add(glow); setStatus(`selected node ${startId} — downline highlighted`);
    }
    function onPick(ev){
      const rect=canvas.getBoundingClientRect();
      const px=((ev.clientX ?? ev.touches?.[0]?.clientX)-rect.left)/rect.width;
      const py=((ev.clientY ?? ev.touches?.[0]?.clientY)-rect.top)/rect.height;
      mouse.x=px*2-1; mouse.y=-(py*2-1);
      ray.setFromCamera(mouse,camera);
      const hits=ray.intersectObjects(spheres,true);
      if(hits.length) highlight(hits[0].object.userData.id);
      else clearHi();
    }
    canvas.addEventListener('click', onPick, {passive:true});
    canvas.addEventListener('touchend', onPick, {passive:true});

    // ---- Toolbar actions ----
    let autoSpin=true, showEdges=true;
    btnReset.onclick = ()=>{ if(controls.target) controls.target.copy(center); camera.position.copy(center.clone().add(new THREE.Vector3(0,0,dist))); camera.updateProjectionMatrix(); if(controls.update) controls.update(); clearHi(); };
    btnSpin.onclick  = ()=>{ autoSpin=!autoSpin; btnSpin.textContent = autoSpin?'⏸ Spin':'⏵ Spin'; };
    btnEdges.onclick = ()=>{ showEdges=!showEdges; edges.visible=showEdges; btnEdges.textContent=showEdges?'Hide Edges':'Show Edges'; };
    btnHelp.onclick  = ()=> alert('Controls:\\n• Rotate: left-drag\\n• Pan: right/Ctrl/Shift + drag\\n• Zoom: wheel/trackpad\\n• Click a node: highlight downline\\n• Reset View: re-center');

    // ---- Counters ----
    const totalCoins=nodes.length, totalRaised=totalCoins*COIN;
    let shown=0; (function tick(){ if(shown<totalCoins){ shown=Math.min(totalCoins, shown+Math.ceil(totalCoins/120)); if(coinsEl) coinsEl.textContent=shown.toLocaleString('en-US'); if(raisedEl) raisedEl.textContent=fmt$(shown*COIN); requestAnimationFrame(tick);} else { if(coinsEl) coinsEl.textContent=totalCoins.toLocaleString('en-US'); if(raisedEl) raisedEl.textContent=fmt$(totalRaised);} })();

    // ---- Animate ----
    setStatus('ready — drag to rotate; click a node to explore.');
    function loop(){
      if(autoSpin){
        if (controls.update) { /* OrbitControls handles damping */ }
        else { camera.position.applyAxisAngle(new THREE.Vector3(0,1,0), 0.002); if(controls.update) controls.update(); }
      }
      if(controls.update) controls.update();
      renderer.render(scene,camera);
      requestAnimationFrame(loop);
    }
    resize(); loop();
  })().catch(e=>{ console.error(e); setStatus('Error: ' + (e?.message||e)); });
})();
