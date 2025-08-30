/* donor-universe.js — Three.js 3D donor universe with probabilities + click stats
   Works with:
     <canvas id="gl"
             data-seeds="80"
             data-p-primary="0.85"
             data-lambda-extras="0.8"
             data-lambda-reds="0.9"
             data-red-depth="3"></canvas>
   Buttons:
     #btnPlay  (Play/Pause spin + counters)
     #btnAll   (Show/Hide edges; clear highlight)
     #btnDebug (Yellow Dots on/off)
   Optional HUD:
     #coins, #raised, #status, #fill
*/

(() => {
  /* ---------- load-once guard ---------- */
  if (window.__DU_SCRIPT_ACTIVE__) { console.warn('[DU] already loaded; skipping'); return; }
  window.__DU_SCRIPT_ACTIVE__ = true;

  /* ---------- DOM ---------- */
  const $ = (id)=>document.getElementById(id);
  const canvas   = $('gl');
  const btnPlay  = $('btnPlay');
  const btnAll   = $('btnAll');
  const btnDebug = $('btnDebug');
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const statusEl = $('status');
  const fillEl   = $('fill');

  const setStatus=(m)=>{ if(statusEl) statusEl.textContent='Status: '+m; console.log('[DU]', m); };
  const fmt$=(n)=> n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

  if (!canvas) { console.error('[DU] Missing <canvas id="gl">'); return; }
  canvas.style.pointerEvents='auto'; canvas.style.touchAction='none'; canvas.style.cursor='grab';

  /* ---------- knobs from HTML (all optional) ---------- */
  const cfg = {
    seeds       : +canvas.dataset.seeds        || 250,
    pPrimary    : +canvas.dataset.pPrimary     || 0.85,
    lambdaExtras: +canvas.dataset.lambdaExtras || 0.8,  // Poisson λ for greens/root
    lambdaReds  : +canvas.dataset.lambdaReds   || 0.9,  // Poisson λ for reds/green
    redDepth    : +canvas.dataset.redDepth     || 3     // max red generations
  };

  /* ---------- RNG & helpers ---------- */
  function xmur3(str){for(var i=0,h=1779033703^str.length;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),3432918353),h=h<<13|h>>>19;return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return(h^(h>>>16))>>>0}}
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  const mkRNG=(seed)=>{ const s=xmur3(String(seed||'du-seed'))(); return mulberry32(s); };
  function poisson(lambda,rand){ if(lambda<=0) return 0; const L=Math.exp(-lambda); let k=0,p=1; do{k++;p*=rand();}while(p>L); return k-1; }
  function sampleGift(rand){
    const u=rand();
    if (u<0.60) return 50;
    if (u<0.78) return Math.round(50 + rand()*100);     // 50–150
    if (u<0.90) return Math.round(150 + rand()*350);    // 150–500
    if (u<0.98) return Math.round(500 + rand()*1500);   // 500–2000
    return Math.round(2000 + rand()*3000);              // 2000–5000
  }

  /* ---------- load Three.js (ESM with fallback) ---------- */
  async function loadThree(){
    try{
      const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
      let OrbitControls=null;
      try{ ({ OrbitControls } = await import('https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module')); }catch{}
      return { THREE, OrbitControls };
    }catch(e1){
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      let OrbitControls=null;
      try{ ({ OrbitControls } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js')); }catch{}
      return { THREE, OrbitControls };
    }
  }

  /* ---------- fallback orbit (if OrbitControls missing) ---------- */
  function makeSimpleOrbit(THREE, camera, dom, target=new THREE.Vector3()){
    let az=0, el=0, r=camera.position.distanceTo(target);
    let dragging=false, rotating=true, lastX=0,lastY=0;
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
        target.addScaledVector(up,   dy*panScale);
      }
      apply();
    });
    dom.addEventListener('wheel', e=>{ e.preventDefault(); r=Math.max(10,Math.min(5000,r+e.deltaY*0.5)); apply(); }, {passive:false});
    apply();
    return { update: apply, target };
  }

  (async ()=>{
    setStatus('initializing…');
    const { THREE, OrbitControls } = await loadThree();

    /* ---------- renderer / scene ---------- */
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, canvas });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
    renderer.setClearColor(0x000000,1);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20000);

    scene.add(new THREE.AmbientLight(0xffffff,0.9));
    const dir=new THREE.DirectionalLight(0xffffff,0.6); dir.position.set(300,500,400); scene.add(dir);

    let controls;
    if (OrbitControls){
      controls = new OrbitControls(camera, canvas);
      controls.enableDamping=true; controls.dampingFactor=0.06;
      controls.rotateSpeed=0.9; controls.zoomSpeed=0.8; controls.panSpeed=0.8;
      controls.autoRotate=true; controls.autoRotateSpeed=0.6;
    } else {
      controls = makeSimpleOrbit(THREE, camera, canvas);
    }

    function resize(){
      const w = canvas.parentElement?.clientWidth || window.innerWidth;
      const h = canvas.parentElement?.clientHeight || Math.round(window.innerHeight*0.8);
      camera.aspect = Math.max(0.2, w/Math.max(1,h));
      camera.updateProjectionMatrix();
      renderer.setSize(w,h,false);
    }
    window.addEventListener('resize', resize);
    setTimeout(resize,30); setTimeout(resize,250);
    if('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas.parentElement||canvas);

    /* ---------- model: probabilities ---------- */
    const rnd = mkRNG('du-prob');
    const COLOR={ dark:0x1e3a8a, light:0x93c5fd, green:0x22c55e, red:0xef4444 };
    const EDGE =0x5b6b95, HILITE=0x6ee7ff;
    const RADIUS=820, JITTER=34, COIN=50;

    const nodes=[], links=[]; let nid=0;
    function add(type,parent=null,gift=50){ const n={id:nid++,type,parent,x:0,y:0,z:0,children:[],gift}; nodes.push(n); if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);} return n; }
    function fib(n,r){ const pts=[],phi=Math.PI*(3-Math.sqrt(5));
      for(let i=0;i<n;i++){ const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i; pts.push(new THREE.Vector3(Math.cos(th)*rad*r,y*r,Math.sin(th)*rad*r)); } return pts; }
    const j=()=> (rnd()*2-1)*JITTER;

    // roots
    for(let i=0;i<cfg.seeds;i++) add('dark',null,sampleGift(rnd));
    const roots=nodes.filter(n=>n.type==='dark');
    const rpts=fib(roots.length,RADIUS); roots.forEach((n,i)=>{ n.x=rpts[i].x; n.y=rpts[i].y; n.z=rpts[i].z; });

    // growth with probabilities
    function growPrimaryAndExtras(parentIdx){
      const p = nodes[parentIdx];
      // primary (+1) with probability pPrimary
      if (rnd() < cfg.pPrimary) {
        const l = add('light', p.id, sampleGift(rnd));
        l.x=p.x+j(); l.y=p.y+j(); l.z=p.z+j();
      }
      // extras (greens) ~ Poisson(λExtras)
      const kExtras = poisson(cfg.lambdaExtras, rnd);
      for (let i=0;i<kExtras;i++){
        const g = add('green', p.id, sampleGift(rnd));
        g.x=p.x+j(); g.y=p.y+j(); g.z=p.z+j();
        // reds below each green: limited depth, Poisson each level
        growReds(g.id, 1);
      }
    }
    function growReds(parentId, depth){
      if (depth > cfg.redDepth) return;
      const p = nodes[parentId];
      const kReds = poisson(cfg.lambdaReds, rnd);
      for (let i=0;i<kReds;i++){
        const r = add('red', p.id, sampleGift(rnd));
        r.x=p.x+j(); r.y=p.y+j(); r.z=p.z+j();
        growReds(r.id, depth+1);
      }
    }

    // run growth for each root (independently, with probs)
    for (const r of roots) growPrimaryAndExtras(r.id);

    // Spheres
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

    // Edges
    const epos=new Float32Array(links.length*6); let ek=0;
    for(const l of links){ const a=nodes[l.source], b=nodes[l.target]; epos[ek++]=a.x; epos[ek++]=a.y; epos[ek++]=a.z; epos[ek++]=b.x; epos[ek++]=b.y; epos[ek++]=b.z; }
    const edgeGeo=new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.BufferAttribute(epos,3));
    const edges=new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({color:EDGE,transparent:true,opacity:0.40}));
    scene.add(edges);

    // Fit camera
    const box=new THREE.Box3(); for(const s of spheres) box.expandByPoint(s.position);
    const size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const maxDim=Math.max(size.x,size.y,size.z);
    const fitDist=maxDim/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2));
    const dist=fitDist*1.35;
    camera.position.copy(center.clone().add(new THREE.Vector3(0,0,dist)));
    camera.near=dist/100; camera.far=dist*400; camera.updateProjectionMatrix();
    if(controls.target) controls.target.copy(center);
    if(controls.update) controls.update();

    /* ---------- click → stats + highlight ---------- */
    let glow=null; const ray=new THREE.Raycaster(), mouse=new THREE.Vector2();
    function clearHi(){ if(glow){ scene.remove(glow); glow.geometry.dispose(); glow.material.dispose(); glow=null; }
      for(const m of spheres){ m.material.transparent=false; m.material.opacity=1; }
      edges.material.opacity = edges.visible ? 0.40 : 0.02;
      setStatus('ready — click a node to explore.'); }
    function subtreeStats(startId){
      let count=0, gifts=0, coins=0;
      const keep=new Set([startId]), q=[startId];
      while(q.length){
        const cur=q.shift(); count++; coins++;
        gifts += nodes[cur].gift || 0;
        for(const l of links) if(l.source===cur && !keep.has(l.target)){ keep.add(l.target); q.push(l.target); }
      }
      return { keep, count, gifts, coins };
    }
    function highlight(startId){
      clearHi();
      const { keep, count, gifts, coins } = subtreeStats(startId);
      for(const m of spheres){ const on=keep.has(m.userData.id); m.material.transparent=true; m.material.opacity=on?1:0.12; }
      edges.material.opacity=0.08;

      const kept=links.filter(l=> keep.has(l.source)&&keep.has(l.target));
      const gpos=new Float32Array(kept.length*6); let i=0;
      for(const l of kept){ const a=nodes[l.source], b=nodes[l.target]; gpos[i++]=a.x; gpos[i++]=a.y; gpos[i++]=a.z; gpos[i++]=b.x; gpos[i++]=b.y; gpos[i++]=b.z; }
      const ggeo=new THREE.BufferGeometry(); ggeo.setAttribute('position', new THREE.BufferAttribute(gpos,3));
      glow=new THREE.LineSegments(ggeo, new THREE.LineBasicMaterial({color:HILITE,transparent:true,opacity:0.95}));
      scene.add(glow);

      const direct = (nodes[startId].gift||0) + COIN;
      const raised = gifts + coins*COIN;
      setStatus(`node #${startId} — direct ${fmt$(direct)} | subtree: ${count-1} donors, gifts ${fmt$(gifts)}, total raised ${fmt$(raised)}`);
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

    /* ---------- Buttons ---------- */
    let playing = true;          // master pause: spin + counters
    let showEdges = true;
    let yellow = false;

    function setYellow(on){
      yellow = !!on;
      if(on){ for(const k of Object.keys(MATS)) MATS[k].color.setHex(0xffff00); }
    }
    const MATS={
      dark : new THREE.MeshStandardMaterial({color:COLOR.dark ,metalness:0.2,roughness:0.45}),
      light: new THREE.MeshStandardMaterial({color:COLOR.light,metalness:0.2,roughness:0.45}),
      green: new THREE.MeshStandardMaterial({color:COLOR.green,metalness:0.2,roughness:0.45}),
      red  : new THREE.MeshStandardMaterial({color:COLOR.red  ,metalness:0.2,roughness:0.45})
    };
    // Reapply correct colors after Yellow mode off
    function restoreColors(){
      MATS.dark .color.setHex(COLOR.dark );
      MATS.light.color.setHex(COLOR.light);
      MATS.green.color.setHex(COLOR.green);
      MATS.red  .color.setHex(COLOR.red  );
    }

    if(btnPlay){
      btnPlay.onclick = ()=>{
        playing = !playing;
        btnPlay.textContent = playing ? '⏸ Play/Pause' : '⏵ Play';
        if (controls && 'autoRotate' in controls) controls.autoRotate = playing;
      };
    }
    if(btnAll){
      btnAll.onclick = ()=>{
        showEdges = !showEdges;
        edges.visible = showEdges;
        edges.material.opacity = showEdges ? 0.40 : 0.02;
        if(!showEdges){ clearHi(); for(const m of spheres){ m.material.transparent=false; m.material.opacity=1; } }
        btnAll.textContent = showEdges ? 'Hide All' : 'Show All';
      };
    }
    if(btnDebug){
      btnDebug.onclick = ()=>{
        if(!yellow){ setYellow(true); }
        else { restoreColors(); yellow=false; }
        btnDebug.textContent = yellow ? 'Normal Dots' : 'Yellow Dots';
      };
    }

    /* ---------- Counters & progress (respect Play/Pause) ---------- */
    const totalCoins=nodes.length, totalRaised=totalCoins*COIN;
    let shown=0;
    (function step(){
      if (playing && shown < totalCoins) {
        shown = Math.min(totalCoins, shown + Math.ceil(Math.max(1, totalCoins/180))); // ~3s to fill
        if(coinsEl)  coinsEl.textContent = shown.toLocaleString('en-US');
        if(raisedEl) raisedEl.textContent = fmt$(shown * COIN);
        if(fillEl)   fillEl.style.width   = (shown/totalCoins*100).toFixed(1)+'%';
      }
      requestAnimationFrame(step);
    })();

    /* ---------- Animate ---------- */
    setStatus('ready — rotate (left-drag), pan (right/Ctrl/Shift-drag), wheel to zoom. Click a node for stats.');
    function loop(){
      if(controls && 'autoRotate' in controls) controls.autoRotate = !!playing;
      if(!('autoRotate' in controls) && playing){
        camera.position.applyAxisAngle(new THREE.Vector3(0,1,0), 0.002);
      }
      if(controls.update) controls.update();
      edges.visible = showEdges;
      renderer.render(scene,camera);
      requestAnimationFrame(loop);
    }
    resize(); loop();

  })().catch(e=>{ console.error(e); if(statusEl) statusEl.textContent='Status: Error: '+(e?.message||e); });
})();
