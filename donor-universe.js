/* Donor Universe — Three.js version with working orbit/pan/zoom,
   node click highlight, edges, legend, toolbar, counters.
   Safe to load on Squarespace. No duplicate globals. */

(() => {
  // ---- load-once guard (prevents “already been declared”) ----
  if (window.__DU_SCRIPT_ACTIVE__) {
    console.warn('[DonorUniverse] script already loaded, skipping');
    return;
  }
  window.__DU_SCRIPT_ACTIVE__ = true;

  // ---- DOM handles ----
  const $ = (id) => document.getElementById(id);
  const rootEl   = $('gl');       // container <div> (preferred) or <canvas>
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const statusEl = $('status');

  const setStatus = (m) => { if (statusEl) statusEl.textContent = 'Status: ' + m; console.log('[DonorUniverse]', m); };
  const fmt$ = (n) => n.toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 });

  // ---- safety checks ----
  if (!rootEl) { console.error('[DU] Missing #gl container'); return; }
  if (!coinsEl || !raisedEl || !statusEl) console.warn('[DU] Counters or status not found; visualization will still run');

  // ---- load Three + (try) OrbitControls, with robust fallback ----
  async function loadThree() {
    try {
      // unpkg first
      const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
      let OrbitControls = null;
      try {
        ({ OrbitControls } = await import('https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js?module'));
      } catch (e) { console.warn('[DU] OrbitControls via unpkg failed, will fall back or use built-in controls'); }
      return { THREE, OrbitControls };
    } catch (e1) {
      console.warn('[DU] unpkg failed, trying jsdelivr', e1);
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
      let OrbitControls = null;
      try {
        ({ OrbitControls } = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js'));
      } catch (e2) { console.warn('[DU] OrbitControls via jsDelivr failed; using built-in controls'); }
      return { THREE, OrbitControls };
    }
  }

  // ---- lightweight in-file orbit controller (fallback) ----
  function makeSimpleOrbit(THREE, camera, dom, target = new THREE.Vector3()) {
    let az = 0, el = 0, r = camera.position.distanceTo(target);
    let dragging = false, rotating = true, lastX = 0, lastY = 0;
    function apply() {
      const cosE = Math.cos(el), sinE = Math.sin(el);
      const cosA = Math.cos(az), sinA = Math.sin(az);
      camera.position.set(
        target.x + r * cosE * sinA,
        target.y + r * sinE,
        target.z + r * cosE * cosA
      );
      camera.lookAt(target);
    }
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('mousedown', e => {
      dragging = true;
      rotating = !(e.button === 2 || e.ctrlKey || e.shiftKey);
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => dragging = false);
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (rotating) {
        az += dx * 0.005;
        el = Math.max(-1.2, Math.min(1.2, el + dy * 0.005));
      } else {
        // pan in camera plane
        const panScale = r * 0.0015;
        const right = new THREE.Vector3().subVectors(camera.position, target).cross(camera.up).normalize();
        const up = new THREE.Vector3().copy(camera.up).normalize();
        target.addScaledVector(right, -dx * panScale);
        target.addScaledVector(up,    dy * panScale);
      }
      apply();
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      r = Math.max(10, Math.min(5000, r + e.deltaY * 0.5));
      apply();
    }, { passive: false });
    apply();
    return { update: apply, target };
  }

  // ---- main ----
  (async () => {
    setStatus('initializing…');

    // Build UI overlays we control (legend + toolbar)
    buildLegend();
    const ui = buildToolbar();

    const { THREE, OrbitControls } = await loadThree();

    // Container + renderer
    const isCanvas = rootEl.tagName === 'CANVAS';
    const renderer = isCanvas
      ? new THREE.WebGLRenderer({ antialias:true, canvas: rootEl, alpha:false })
      : new THREE.WebGLRenderer({ antialias:true, alpha:false });

    if (!isCanvas) rootEl.appendChild(renderer.domElement);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 1);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 20000);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(300, 500, 400);
    scene.add(dir);

    // Controls (OrbitControls or fallback)
    let controls;
    if (OrbitControls) {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.rotateSpeed   = 0.9;
      controls.zoomSpeed     = 0.7;
      controls.panSpeed      = 0.7;
    } else {
      controls = makeSimpleOrbit(THREE, camera, renderer.domElement);
    }

    // Resize
    function resize() {
      const w = rootEl.clientWidth || rootEl.parentElement?.clientWidth || window.innerWidth;
      const h = rootEl.clientHeight || rootEl.parentElement?.clientHeight || Math.round(window.innerHeight * 0.7);
      camera.aspect = Math.max(0.2, w / Math.max(1, h));
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    window.addEventListener('resize', resize);
    setTimeout(resize, 30); setTimeout(resize, 250);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(rootEl);

    // ---- build donor graph (same visual model as your screenshots) ----
    setStatus('building donor universe…');

    const COLOR = {
      dark  : 0x1e3a8a, // roots
      light : 0x93c5fd, // primary referral (max 1 per parent)
      green : 0x22c55e, // extra donations (same parent)
      red   : 0xef4444  // downstream of any green
    };
    const EDGE       = 0x5b6b95;
    const HIGHLIGHT  = 0x6ee7ff;

    const SEEDS        = 250;     // initial donors (roots)
    const RADIUS       = 820;     // sphere radius
    const JITTER       = 34;      // positional jitter for children
    const EXTRAS_MIN   = 2;       // greens per root (min)
    const EXTRAS_RAND  = 3;       // +0..3
    const REDS_MIN     = 2;       // reds per green (min)
    const REDS_RAND    = 4;       // +0..4
    const COIN_VALUE   = 50;      // $50 / donor

    const nodes = [], links = [];
    let id = 0;
    function addNode(type, parent = null) {
      const n = { id: id++, type, parent, children: [], x:0,y:0,z:0 };
      nodes.push(n);
      if (parent != null) {
        links.push({ source: parent, target: n.id });
        nodes[parent].children.push(n.id);
      }
      return n;
    }

    // roots on Fibonacci sphere
    function fibSphere(n, r) {
      const pts = [], phi = Math.PI * (3 - Math.sqrt(5));
      for (let i=0;i<n;i++) {
        const y = 1 - (i / Math.max(1, n - 1)) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y*y));
        const th = phi * i;
        pts.push(new THREE.Vector3(Math.cos(th)*rad*r, y*r, Math.sin(th)*rad*r));
      }
      return pts;
    }
    // jitter
    const rnd = () => (Math.random() * 2 - 1) * JITTER;

    // build
    for (let i=0;i<SEEDS;i++) addNode('dark', null);
    const roots = nodes.filter(n => n.type === 'dark');
    const pts   = fibSphere(roots.length, RADIUS);
    roots.forEach((n,i)=>{ n.x=pts[i].x; n.y=pts[i].y; n.z=pts[i].z; });

    for (const r of roots) {
      const l = addNode('light', r.id);
      l.x = r.x + rnd(); l.y = r.y + rnd(); l.z = r.z + rnd();
      const greens = EXTRAS_MIN + (Math.random() * (EXTRAS_RAND+1) | 0); // 2..5
      for (let gk=0; gk<greens; gk++) {
        const g = addNode('green', r.id);
        g.x = r.x + rnd(); g.y = r.y + rnd(); g.z = r.z + rnd();
        const reds = REDS_MIN + (Math.random() * (REDS_RAND+1) | 0);      // 2..6
        for (let rk=0; rk<reds; rk++) {
          const d = addNode('red', g.id);
          d.x = g.x + rnd(); d.y = g.y + rnd(); d.z = g.z + rnd();
        }
      }
    }

    // ---- draw spheres (reuse geometries/materials per type) ----
    const MATS = {
      dark : new THREE.MeshStandardMaterial({ color: COLOR.dark,  metalness:0.2, roughness:0.45 }),
      light: new THREE.MeshStandardMaterial({ color: COLOR.light, metalness:0.2, roughness:0.45 }),
      green: new THREE.MeshStandardMaterial({ color: COLOR.green, metalness:0.2, roughness:0.45 }),
      red  : new THREE.MeshStandardMaterial({ color: COLOR.red,   metalness:0.2, roughness:0.45 })
    };
    const GEOS = {
      dark : new THREE.SphereGeometry(5.5, 18, 18),
      light: new THREE.SphereGeometry(4.2, 18, 18),
      green: new THREE.SphereGeometry(4.7, 18, 18),
      red  : new THREE.SphereGeometry(3.7, 18, 18)
    };

    const spheres = [];
    for (const n of nodes) {
      const mesh = new THREE.Mesh(GEOS[n.type], MATS[n.type]);
      mesh.position.set(n.x, n.y, n.z);
      mesh.userData.id = n.id;
      spheres.push(mesh);
      scene.add(mesh);
    }

    // ---- draw edges (single LineSegments) ----
    const pos = new Float32Array(links.length * 6);
    let k = 0;
    for (const l of links) {
      const a = nodes[l.source], b = nodes[l.target];
      pos[k++]=a.x; pos[k++]=a.y; pos[k++]=a.z;
      pos[k++]=b.x; pos[k++]=b.y; pos[k++]=b.z;
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: EDGE, transparent:true, opacity:0.28 }));
    scene.add(edges);

    // ---- camera fit + controls target ----
    const box = new THREE.Box3();
    for (const s of spheres) box.expandByPoint(s.position);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fitDist = maxDim / (2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2));
    const dist = fitDist * 1.35;

    camera.position.copy(center.clone().add(new THREE.Vector3(0, 0, dist)));
    camera.near = dist / 100;
    camera.far  = dist * 400;
    camera.updateProjectionMatrix();

    if (controls.target) controls.target.copy(center);
    if (controls.update) controls.update();

    // ---- click to highlight downline ----
    let glow = null;
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    function clearHighlight() {
      if (glow) { scene.remove(glow); glow.geometry.dispose(); glow.material.dispose(); glow = null; }
      for (const m of spheres) { m.material.transparent = false; m.material.opacity = 1; }
      edges.material.opacity = 0.28;
      setStatus('ready — click a node to explore. H=help');
    }

    function highlight(startId) {
      clearHighlight();
      const keep = new Set([startId]);
      const q = [startId];
      while (q.length) {
        const cur = q.shift();
        for (const l of links) if (l.source === cur && !keep.has(l.target)) { keep.add(l.target); q.push(l.target); }
      }
      for (const m of spheres) { const on = keep.has(m.userData.id); m.material.transparent = true; m.material.opacity = on ? 1 : 0.12; }
      edges.material.opacity = 0.08;

      const kept = links.filter(l => keep.has(l.source) && keep.has(l.target));
      const gpos = new Float32Array(kept.length * 6);
      let i=0;
      for (const l of kept) {
        const a = nodes[l.source], b = nodes[l.target];
        gpos[i++]=a.x; gpos[i++]=a.y; gpos[i++]=a.z; gpos[i++]=b.x; gpos[i++]=b.y; gpos[i++]=b.z;
      }
      const ggeo = new THREE.BufferGeometry();
      ggeo.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
      glow = new THREE.LineSegments(ggeo, new THREE.LineBasicMaterial({ color:HIGHLIGHT, transparent:true, opacity:0.95 }));
      scene.add(glow);
      setStatus(`selected node ${startId} — showing its downline`);
    }

    function onPick(ev) {
      const rect = renderer.domElement.getBoundingClientRect();
      const px = ((ev.clientX ?? ev.touches?.[0]?.clientX) - rect.left) / rect.width;
      const py = ((ev.clientY ?? ev.touches?.[0]?.clientY) - rect.top) / rect.height;
      mouse.x = px * 2 - 1; mouse.y = -(py * 2 - 1);
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(spheres, true);
      if (hits.length) highlight(hits[0].object.userData.id);
      else clearHighlight();
    }
    renderer.domElement.addEventListener('click', onPick, { passive:true });
    renderer.domElement.addEventListener('touchend', onPick, { passive:true });

    // ---- toolbar actions ----
    ui.btnReset.onclick = () => {
      if (controls.target) controls.target.copy(center);
      camera.position.copy(center.clone().add(new THREE.Vector3(0, 0, dist)));
      camera.updateProjectionMatrix();
      if (controls.update) controls.update();
      clearHighlight();
    };
    let autoSpin = true;
    ui.btnSpin.onclick = () => { autoSpin = !autoSpin; ui.btnSpin.textContent = autoSpin ? '⏸ Spin' : '⏵ Spin'; };
    let showEdges = true;
    ui.btnEdges.onclick = () => {
      showEdges = !showEdges;
      edges.visible = showEdges;
      ui.btnEdges.textContent = showEdges ? 'Hide Edges' : 'Show Edges';
    };
    ui.btnHelp.onclick = () => {
      alert(
`Controls:
• Rotate: left-drag
• Pan: right-drag or Ctrl/Shift + drag
• Zoom: mouse wheel / trackpad
• Click a node to highlight its downline
• Reset: re-centers and clears highlight`
      );
    };

    // ---- counters (front-end demo) ----
    const totalCoins = nodes.length;
    const totalRaised = totalCoins * COIN_VALUE;
    let shown = 0;
    function tickCounters() {
      if (shown < totalCoins) {
        shown = Math.min(totalCoins, shown + Math.ceil(totalCoins / 120));
        if (coinsEl) coinsEl.textContent = shown.toLocaleString('en-US');
        if (raisedEl) raisedEl.textContent = fmt$(shown * COIN_VALUE);
        requestAnimationFrame(tickCounters);
      } else {
        if (coinsEl) coinsEl.textContent = totalCoins.toLocaleString('en-US');
        if (raisedEl) raisedEl.textContent = fmt$(totalRaised);
      }
    }
    tickCounters();

    // ---- animate ----
    setStatus('ready — click a node to explore. H=help');
    function loop() {
      if (autoSpin) {
        if (OrbitControls && controls) { /* let damping run */ }
        else { // simple fallback: tiny azimuth
          const t = Date.now() * 0.00006;
          camera.position.applyAxisAngle(new THREE.Vector3(0,1,0), 0.002);
          if (controls && controls.update) controls.update();
        }
      }
      if (controls && controls.update) controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    }
    resize();
    loop();

  })().catch(e => {
    console.error(e);
    setStatus('Error: ' + (e?.message || e));
  });

  // ---------- UI builders ----------
  function buildLegend() {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:10px;top:10px;z-index:20;background:#121a36;border:1px solid #1f2a4d;border-radius:8px;padding:8px 10px;font-size:12px;color:#cfe1ff';
    box.innerHTML = `
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#1e3a8a;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Dark blue: roots</div>
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#93c5fd;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Light blue: primary (+1)</div>
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Green: extras (same parent)</div>
      <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;border:1px solid #2f3b66;margin-right:6px;vertical-align:middle;"></span>Red: downstream of any green</div>
    `;
    const host = $('gl');
    if (host && host.parentElement) {
      host.parentElement.style.position = 'relative';
      host.parentElement.appendChild(box);
    }
  }

  function buildToolbar() {
    const host = $('gl');
    const wrap = host?.parentElement;
    if (!wrap) return {};
    wrap.style.position = 'relative';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;right:14px;top:14px;z-index:25;display:flex;gap:8px;';
    const mk = (label) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:6px 10px;border-radius:10px;background:#131a2f;color:#cfe1ff;border:1px solid #2a355a;cursor:pointer;font-size:12px;';
      return b;
    };
    const btnReset = mk('Reset View');
    const btnSpin  = mk('⏸ Spin');
    const btnEdges = mk('Hide Edges');
    const btnHelp  = mk('Help');
    bar.append(btnReset, btnSpin, btnEdges, btnHelp);
    wrap.appendChild(bar);
    return { btnReset, btnSpin, btnEdges, btnHelp };
  }
})();
