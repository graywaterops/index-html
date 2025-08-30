/* Donor Universe — wires page buttons (#btnPlay, #btnAll, #btnDebug),
   orbit/pan/zoom, click-to-highlight, counters, progress. No duplicate globals. */

(() => {
  // ---- load-once guard ----
  if (window.__DU_SCRIPT_ACTIVE__) { console.warn('[DU] already loaded; skipping'); return; }
  window.__DU_SCRIPT_ACTIVE__ = true;

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const host     = $('gl');           // <canvas id="gl"> (on your page)
  const cv2d     = $('cv2d');         // fallback canvas (hidden by CSS)
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const statusEl = $('status');
  const fillEl   = $('fill');
  const btnPlay  = $('btnPlay');      // ⏸ Play/Pause
  const btnAll   = $('btnAll');       // Show All (edges toggle)
  const btnDebug = $('btnDebug');     // Yellow Dots

  const setStatus = (m)=>{ if(statusEl) statusEl.textContent = 'Status: ' + m; console.log('[DU]', m); };
  const fmt$ = (n)=> n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

  if (!host) { console.error('[DU] Missing #gl canvas'); return; }
  // Safety: make sure fallback canvas never blocks input
  if (cv2d) { cv2d.style.display = 'none'; cv2d.style.pointerEvents = 'none'; }

  // Force interactive styling on the WebGL canvas (in case theme CSS overrides)
  host.style.pointerEvents = 'auto';
  host.style.touchAction   = 'none';
  host.style.cursor        = 'grab';

  // ---- Load Three + OrbitControls (robust) ----
  async function loadThree(){
    try {
      const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
      let OrbitControls = null;
      try { ({ OrbitControls } = await import('https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module')); } catch {}
      return { THREE, OrbitControls };
    } catch(e1){
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      let OrbitControls = null;
      try { ({ OrbitControls } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js')); } catch {}
      return { THREE, OrbitControls };
    }
  }

  // Fallback orbit controller if OrbitControls is unavailable
  function makeSimpleOrbit(THREE, camera, dom, target = new THREE.Vector3()){
    let az=0, el=0, r=camera.position.distanceTo(target);
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
        const up   =new THREE.Vector3().copy(camera.up).normalize();
        target.addScaledVector(right,-dx*panScale);
        target.addScaledVector(up,    dy*panScale);
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

    // --- Renderer on your <canvas id="gl"> ---
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, canvas: host });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
    renderer.setClearColor(0x000000, 1);
    const canvas = renderer.domElement; // equals host
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
      const w = canvas.parentElement?.clientWidth || window.innerWidth;
      const h = canvas.parentElement?.clientHeight || Math.round(window.innerHeight*0.8);
      camera.aspect = Math.max(0.2, w/Math.max(1,h));
      camera.updateProjectionMatrix();
      renderer.setSize(w,h,false);
    }
    window.addEventListener('resize', resize);
    setTimeout(resize, 30); setTimeout(resize, 250);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas.parentElement || canvas);

    // ---- Build donor graph (same semantics as before) ----
    const COLOR = { dark:0x1e3a8a, light:0x93c5fd, green:0x22c55e, red:0xef4444 };
    const EDGE  = 0x5b6b95, HILITE=0x6ee7ff;
    const SEEDS=250, RADIUS=820, JITTER=34, EX_MIN=2, EX_RAND=3, RED_MIN=2, RED_RAND=4, COIN=50;

    const nodes=[], links=[]; let id=0;
    function add(type,parent=null){ const n={id:id++,type,parent,x:0,y:0,z:0,children:[]}; nodes.push(n); if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);} return n;}
    function fib(n,r){const pts=[],phi=Math.PI*(3-Math.sqrt(5)); for(let i=0;i<n;i++){const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i; pts.push(new THREE.Vector3(Math.cos(th)*rad*r,y*r,Math.sin(th)*rad*r));} return pts;}
    const rnd=()=> (Math.random()*2-1)*JITTER;

    for(let i=0;i<SEEDS;i++) add('dark',null);
    const roots=nodes.filter(n=>n.type==='dark');
    const pts=fib(roots.length,RADIUS); roots.forEach((n,i)=>{n.x=pts[i].x; n.y=pts[i].y; n.z=pts[i].z;});
    for(const r of roots){
      const l=add('light',r.id); l.x=r.x+rnd(); l.y=r.y+rnd(); l.z=r.z+rnd();
      const greens = EX_MIN + ((Math.random()*(EX_RAND+1))|0); // 2..5
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
    const epos=new Float32Array(links.length*6); let kk=0;
    for(const l of links){ const a=nodes[l.source], b=nodes[l.target]; epos[kk++]=a.x; epos[kk++]=a.y; epos[kk++]=a.z; epos[kk++]=b.x; epos[kk++]=b.y; epos[kk++]=b.z; }
    const edgeGeo=new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.BufferAttribute(epos,3));
    const edges=new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({color:EDGE, transparent:true, opacity:0.28}));
    scene.add(edges);

    // ---- Fit camera ----
    const box=new THREE.Box3(); for(const s of spheres) box.expandByPoint(s.position);
    const size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const maxDim=Math.max(size.x,size.y,size.z);
    const fitDist=maxDim/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2));
    const dist=fitDist*1.35;
    camera.position.copy(center.clone().add(new THREE.Vector3(0,0,dist)));
    camera.near=dist/100; camera.far=dist*400; camera.updateProjectionMatrix();
    if (controls.target) controls.target.copy(center);
    if (controls.update) controls.update();

    // ---- Picking & highlight ----
    let glow=null; const ray=new THREE.Raycaster(); const mouse=new THREE.Vector2();
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

    // ---- Button wiring (your page buttons) ----
    let autoSpin = true;
    let showEdges = true;
    let yellowMode = false;

    function setYellow(on){
      yellowMode = !!on;
      if (on) {
        for (const key of Object.keys(MATS)) MATS[key].color.setHex(0xffff00);
      } else {
        MATS.dark .color.setHex(COLOR.dark );
        MATS.light.color.setHex(COLOR.light);
        MATS.green.color.setHex(COLOR.green);
        MATS.red  .color.setHex(COLOR.red  );
      }
    }

    if (btnPlay) {
      btnPlay.onclick = () => {
        autoSpin = !autoSpin;
        btnPlay.textContent = autoSpin ? '⏸ Play/Pause' : '⏵ Play';
      };
    }
    if (btnAll) {
      btnAll.onclick = () => {
        showEdges = !showEdges;
        edges.visible = showEdges;
        btnAll.textContent = showEdges ? 'Hide All' : 'Show All';
      };
    }
    if (btnDebug) {
      btnDebug.onclick = () => {
        setYellow(!yellowMode);
        btnDebug.textContent = yellowMode ? 'Normal Dots' : 'Yellow Dots';
      };
    }

    // If your page buttons are missing (different template), create a tiny in-canvas toolbar as a fallback
    if (!btnPlay && !btnAll && !btnDebug) {
      const bar=document.createElement('div');
      bar.style.cssText='position:absolute;right:14px;top:14px;z-index:10;display:flex;gap:8px;pointer-events:auto;';
      const mk=(t)=>{const b=document.createElement('button'); b.textContent=t; b.style.cssText='padding:6px 10px;border-radius:10px;background:#131a2f;color:#cfe1ff;border:1px solid #2a355a;cursor:pointer;font-size:12px;'; return b;};
      const b1=mk('⏸ Play/Pause'), b2=mk('Hide All'), b3=mk('Yellow Dots');
      b1.onclick=()=>{ autoSpin=!autoSpin; b1.textContent=autoSpin?'⏸ Play/Pause':'⏵ Play'; };
      b2.onclick=()=>{ showEdges=!showEdges; edges.visible=showEdges; b2.textContent=showEdges?'Hide All':'Show All'; };
      b3.onclick=()=>{ setYellow(!yellowMode); b3.textContent=yellowMode?'Normal Dots':'Yellow Dots'; };
      (canvas.parentElement||document.body).appendChild(bar);
      bar.append(b1,b2,b3);
    }

    // ---- Counters + progress ----
    const totalCoins = nodes.length;
    const totalRaised = totalCoins * COIN;
    let shown = 0;
    (function step(){
      if (shown < totalCoins) {
        shown = Math.min(totalCoins, shown + Math.ceil(totalCoins/120)); // ~2 seconds
        if (coinsEl)  coinsEl.textContent = shown.toLocaleString('en-US');
        if (raisedEl) raisedEl.textContent = fmt$(shown * COIN);
        if (fillEl)   fillEl.style.width = (shown/totalCoins*100).toFixed(1)+'%';
        requestAnimationFrame(step);
      } else {
        if (coinsEl)  coinsEl.textContent = totalCoins.toLocaleString('en-US');
        if (raisedEl) raisedEl.textContent = fmt$(totalRaised);
        if (fillEl)   fillEl.style.width = '100%';
      }
    })();

    // ---- Animate ----
    setStatus('ready — rotate (left‑drag), pan (right/Ctrl/Shift‑drag), wheel to zoom. Click a node to highlight.');
    function loop(){
      if (autoSpin) {
        // OrbitControls: damping runs in update(); fallback: nudge camera
        if (!OrbitControls) { camera.position.applyAxisAngle(new THREE.Vector3(0,1,0), 0.002); }
      }
      if (controls.update) controls.update();
      edges.visible = showEdges;
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    }
    resize(); loop();

  })().catch(e => {
    console.error(e);
    setStatus('Error: ' + (e?.message || e));
  });
})();
