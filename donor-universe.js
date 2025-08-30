/* donor-universe.js — WebGL triangle → auto 3D galaxy (simple yaw/pitch/scale) + 2D fallback
   - One guarded startup
   - Yellow TRIANGLE proves WebGL draws
   - Galaxy uses simple uniforms (yaw, pitch, scale, pan, zoom)
   - Per-star billboard quads (two triangles each), no point sprites
   - 2D fallback if WebGL not available
*/

(() => {
  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const glCanvas = $('gl');   // WebGL canvas (index.html)
  const cv2d     = $('cv2d'); // 2D fallback canvas (index.html)
  const setStatus = (m) => { if (statusEl) statusEl.textContent = 'Status: ' + m; console.log('[DonorUniverse]', m); };
  const fmt$ = (n) => n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

  // ---------- ENSURE AREA HEIGHT ----------
  (function ensureVisibleSize(){
    const wrap = glCanvas?.parentElement;
    if (wrap && wrap.clientHeight < 200) { wrap.style.minHeight='80vh'; wrap.style.display='block'; }
  })();

  // ---------- RNG ----------
  function xmur3(str){for(var i=0,h=1779033703^str.length;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),3432918353),h=h<<13|h>>>19;return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return(h^(h>>>16))>>>0}}
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  const mkRNG = (seed) => { const s=xmur3(String(seed))(); return mulberry32(s); };

  // ---------- DOM verify ----------
  (function verifyDOM(){
    const missing=[];
    if(!statusEl) missing.push('#status');
    if(!coinsEl)  missing.push('#coins');
    if(!raisedEl) missing.push('#raised');
    if(!glCanvas) missing.push('#gl');
    if(!cv2d)     missing.push('#cv2d');
    if(missing.length){ setStatus('Error: missing DOM ids: '+missing.join(', ')); return; }
  })();

  // ---------- WEBGL OR FALLBACK ----------
  let gl = null;
  try { gl = glCanvas.getContext('webgl', {antialias:true, alpha:false}); } catch {}
  if (!gl) { setStatus('WebGL not available — switching to Canvas 2D.'); run2D(); return; }

  // TRIANGLE TEST
  try {
    runWebGLTriangle(gl);
    setStatus('WebGL triangle OK — loading galaxy…');
  } catch (e) {
    setStatus('WebGL TRIANGLE ERROR: '+(e?.message||e));
    return run2D();
  }

  // Guarded auto start
  if (!window.__DU_BOOTED__) {
    window.__DU_BOOTED__ = true;
    setTimeout(()=> runWebGLGalaxy(gl), 300);
  }

  // ====================================================================================
  // TRIANGLE
  function runWebGLTriangle(gl){
    resizeGL(glCanvas, gl);
    const vs=`attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;
    const fs=`precision mediump float; void main(){ gl_FragColor=vec4(1.0,0.9,0.1,1.0); }`;
    const prog = link(gl, vs, fs);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.9,-0.9, 0.9,-0.9, 0.0,0.8]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog,'aPos');
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  // ====================================================================================
  // GALAXY (simple yaw/pitch/scale/pan in shader; billboard quads per star)
  function runWebGLGalaxy(gl){
    if (window.__DU_GALAXY_ACTIVE__) { setStatus('Galaxy already running'); return; }
    window.__DU_GALAXY_ACTIVE__ = true;

    // Build a visible, dense model (no bloom gating)
    const P={ roots:250, radius:800, jitter:36, cap:12000, seed:'galaxy-simple' };
    const rand=mkRNG(P.seed), randJ=mkRNG(P.seed+'j');
    const nodes=[], links=[], roots=[]; let id=0;

    function add(type,parent=null){
      if(nodes.length>=P.cap) return null;
      const n={id:id++,type,parent,x:0,y:0,z:0,children:[]};
      nodes.push(n); if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);} return n;
    }
    function fib(n,r){const pts=[],phi=Math.PI*(3-Math.sqrt(5));
      for(let i=0;i<n;i++){ const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i;
        pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r}); } return pts; }
    for(let i=0;i<P.roots;i++){ const r=add('dark',null); roots.push(r.id); }
    const pts=fib(roots.length,P.radius); roots.forEach((rid,i)=>{ const r=nodes[rid]; r.x=pts[i].x; r.y=pts[i].y; r.z=pts[i].z; });

    // for each root: 1 light + 2–4 greens (dense & obvious)
    for(const rid of roots){
      if(nodes.length>=P.cap) break;
      const p=nodes[rid], j=()=> (rand()*2-1)*P.jitter;
      const l=add('light', rid); if(!l) break; l.x=p.x+j(); l.y=p.y+j(); l.z=p.z+j();
      const greens=2+((rand()*3)|0);
      for(let k=0;k<greens && nodes.length<P.cap;k++){ const g=add('green', rid); if(!g) break; g.x=p.x+j(); g.y=p.y+j(); g.z=p.z+j(); }
    }

    const N=nodes.length, E=links.length;
    if(!N){ setStatus('Galaxy: empty model'); return; }

    // Build billboards: 6 vertices per star (two triangles), so TRIANGLES draw works everywhere
    const C_D=[0x1e/255,0x3a/255,0x8a/255], C_L=[0x93/255,0xc5/255,0xfd/255],
          C_G=[0x22/255,0xc5/255,0x5e/255], C_R=[0xef/255,0x44/255,0x44/255];
    const baseSize = (t)=> t==='dark'? 12.0 : t==='light'? 11.5 : t==='green'? 11.8 : 11.2;

    const starVerts = new Float32Array(N * 6 * (3+2+3)); // per-vertex: center(3) + corner(2) + color(3)
    // two triangles: (-1,-1)->(1,-1)->(1,1),  (-1,-1)->(1,1)->(-1,1)
    const corners = [
      -1,-1, 1,-1, 1,1,
      -1,-1, 1,1, -1,1
    ];

    let off=0;
    for(let i=0;i<N;i++){
      const n=nodes[i];
      const col = n.type==='dark'? C_D : n.type==='light'? C_L : n.type==='green'? C_G : C_R;
      const s = baseSize(n.type);
      for(let t=0;t<6;t++){
        const cx = corners[t*2]*s;
        const cy = corners[t*2+1]*s;
        // center (3)
        starVerts[off++] = n.x;
        starVerts[off++] = n.y;
        starVerts[off++] = n.z;
        // corner in pixels (2)
        starVerts[off++] = cx;
        starVerts[off++] = cy;
        // color (3)
        starVerts[off++] = col[0];
        starVerts[off++] = col[1];
        starVerts[off++] = col[2];
      }
    }

    const edgePos = new Float32Array(E*6);
    for(let i=0;i<E;i++){ const l=links[i], a=nodes[l.source], b=nodes[l.target]; edgePos.set([a.x,a.y,a.z,b.x,b.y,b.z], i*6); }

    // GL setup
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    const bufStars = mkBuf(gl, gl.ARRAY_BUFFER, starVerts);
    const bufEdges = mkBuf(gl, gl.ARRAY_BUFFER, edgePos);

    // Shaders: rotate (yaw,pitch), orthographic scale, pan/zoom
    const vsStars = `
      attribute vec3 aCenter;
      attribute vec2 aCornerPx; // pixel-size corner (already scaled by base size)
      attribute vec3 aColor;

      uniform vec2 uViewport;   // (w,h) pixels
      uniform float uYaw;       // radians
      uniform float uPitch;     // radians
      uniform float uScale;     // world->NDC scalar
      uniform float uZoom;      // additional zoom scalar
      uniform vec2  uPanNDC;    // NDC pan (x,y) added to position

      varying vec3 vCol;
      varying float vAlpha;

      mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
      mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

      void main(){
        // rotate world
        vec3 p = rotX(uPitch) * ( rotY(uYaw) * aCenter );
        // project to NDC with ortho-like scale
        vec2 ndc = vec2(p.x, p.y) * (uScale * uZoom);

        // convert pixel corner to NDC size
        float ndcPerPixel = 2.0 / uViewport.y; // use height for consistent sizing
        vec2 cornerNDC = aCornerPx * ndcPerPixel;

        // compose
        vec2 posNDC = ndc + cornerNDC + uPanNDC;
        gl_Position = vec4(posNDC, 0.0, 1.0);

        vCol = aColor;
        vAlpha = 1.0;
      }`;
    const fsStars = `
      precision mediump float;
      varying vec3 vCol;
      varying float vAlpha;
      void main(){
        gl_FragColor = vec4(vCol, vAlpha); // solid enough to see
      }`;

    const vsLines = `
      attribute vec3 aPos;
      uniform float uYaw, uPitch, uScale, uZoom;
      uniform vec2 uViewport, uPanNDC;
      mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
      mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
      void main(){
        vec3 p = rotX(uPitch) * ( rotY(uYaw) * aPos );
        vec2 ndc = vec2(p.x, p.y) * (uScale * uZoom);
        gl_Position = vec4(ndc + uPanNDC, 0.0, 1.0);
      }`;
    const fsLines = `precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor = uCol; }`;

    const progStars = link(gl, vsStars, fsStars);
    const progLines = link(gl, vsLines, fsLines);

    // attribute locations
    const locStars = {
      aCenter: gl.getAttribLocation(progStars,'aCenter'),
      aCornerPx: gl.getAttribLocation(progStars,'aCornerPx'),
      aColor: gl.getAttribLocation(progStars,'aColor'),
      uViewport: gl.getUniformLocation(progStars,'uViewport'),
      uYaw: gl.getUniformLocation(progStars,'uYaw'),
      uPitch: gl.getUniformLocation(progStars,'uPitch'),
      uScale: gl.getUniformLocation(progStars,'uScale'),
      uZoom: gl.getUniformLocation(progStars,'uZoom'),
      uPanNDC: gl.getUniformLocation(progStars,'uPanNDC')
    };
    const locLines = {
      aPos: gl.getAttribLocation(progLines,'aPos'),
      uYaw: gl.getUniformLocation(progLines,'uYaw'),
      uPitch: gl.getUniformLocation(progLines,'uPitch'),
      uScale: gl.getUniformLocation(progLines,'uScale'),
      uZoom: gl.getUniformLocation(progLines,'uZoom'),
      uViewport: gl.getUniformLocation(progLines,'uViewport'),
      uPanNDC: gl.getUniformLocation(progLines,'uPanNDC'),
      uCol: gl.getUniformLocation(progLines,'uCol')
    };

    // camera uniforms (simple)
    let yaw=0, pitch=0, zoom=1.0, panPxX=0, panPxY=0;
    const worldScale = 1.0 / (P.radius * 1.25); // fit sphere into NDC

    glCanvas.addEventListener('mousedown', (e)=>{ dragging=true; rotating=(e.button===0 && !e.ctrlKey); lastX=e.clientX; lastY=e.clientY; });
    window.addEventListener('mouseup', ()=> dragging=false);
    window.addEventListener('mousemove', (e)=>{ if(!dragging) return; const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
      if(rotating){ yaw += dx*0.005; pitch = Math.max(-1.2, Math.min(1.2, pitch + dy*0.005)); }
      else { panPxX += dx; panPxY += dy; }
    });
    glCanvas.addEventListener('wheel', (e)=>{ e.preventDefault(); zoom = Math.max(0.2, Math.min(4.0, zoom + e.deltaY * 0.001)); }, {passive:false});

    let dragging=false, rotating=false, lastX=0, lastY=0;

    function resize(){ resizeGL(glCanvas, gl); }
    window.addEventListener('resize', resize); resize();

    // draw loop
    (function draw(){
      resize();
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

      const vw = glCanvas.width, vh = glCanvas.height;
      const panNDC = [ (panPxX / vw) * 2.0, (-panPxY / vh) * 2.0 ];

      // edges
      gl.useProgram(progLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufEdges);
      gl.enableVertexAttribArray(locLines.aPos);
      gl.vertexAttribPointer(locLines.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(locLines.uYaw, yaw);
      gl.uniform1f(locLines.uPitch, pitch);
      gl.uniform1f(locLines.uScale, worldScale);
      gl.uniform1f(locLines.uZoom, zoom);
      gl.uniform2f(locLines.uViewport, vw, vh);
      gl.uniform2f(locLines.uPanNDC, panNDC[0], panNDC[1]);
      gl.uniform4f(locLines.uCol, 0.50, 0.60, 0.80, 0.45);
      gl.drawArrays(gl.LINES, 0, E*2);

      // stars
      gl.useProgram(progStars);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufStars);
      const stride = (3+2+3)*4; // bytes per vertex
      gl.enableVertexAttribArray(locStars.aCenter);
      gl.vertexAttribPointer(locStars.aCenter, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(locStars.aCornerPx);
      gl.vertexAttribPointer(locStars.aCornerPx, 2, gl.FLOAT, false, stride, 3*4);
      gl.enableVertexAttribArray(locStars.aColor);
      gl.vertexAttribPointer(locStars.aColor, 3, gl.FLOAT, false, stride, (3+2)*4);
      gl.uniform2f(locStars.uViewport, vw, vh);
      gl.uniform1f(locStars.uYaw, yaw);
      gl.uniform1f(locStars.uPitch, pitch);
      gl.uniform1f(locStars.uScale, worldScale);
      gl.uniform1f(locStars.uZoom, zoom);
      gl.uniform2f(locStars.uPanNDC, panNDC[0], panNDC[1]);

      gl.drawArrays(gl.TRIANGLES, 0, N * 6); // two triangles per star

      requestAnimationFrame(draw);
    })();

    // simple counters (so header shows action)
    let tick=0; (function bump(){
      tick++; const coins = Math.min(N, tick*5);
      coinsEl.textContent = coins.toLocaleString('en-US');
      raisedEl.textContent = fmt$(coins*50);
      setTimeout(bump, 400);
    })();

    setStatus('Galaxy running — rotate (drag), pan (right/Ctrl-drag), wheel to zoom.');
  }

  // ====================================================================================
  // 2D fallback (always visible)
  function run2D(){
    cv2d.style.display='block';
    const ctx=cv2d.getContext('2d');
    function resize2D(){ const dpr=window.devicePixelRatio||1; const w=cv2d.clientWidth,h=cv2d.clientHeight; cv2d.width=w*dpr; cv2d.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    window.addEventListener('resize',resize2D); resize2D();

    const stars=[...Array(600)].map(()=>({x:Math.random()*cv2d.clientWidth,y:Math.random()*cv2d.clientHeight,r:2+Math.random()*4,a:.6+Math.random()*.4,c:['#93c5fd','#22c55e','#ef4444','#e5e7eb'][Math.random()*4|0]}));
    let coins=0; setInterval(()=>{ coins+=2; coinsEl.textContent=coins.toLocaleString('en-US'); raisedEl.textContent=fmt$(coins*50); }, 400);

    (function draw(){
      const w=cv2d.width/(window.devicePixelRatio||1), h=cv2d.height/(window.devicePixelRatio||1);
      ctx.clearRect(0,0,w,h); ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h);
      for(const s of stars){ s.a+=(Math.random()-0.5)*0.05; if(s.a<0.2)s.a=0.2; if(s.a>1)s.a=1;
        ctx.globalAlpha=s.a; ctx.fillStyle=s.c; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); }
      ctx.globalAlpha=1; requestAnimationFrame(draw);
    })();

    setStatus('Canvas 2D running.');
  }

  // ---------- GL helpers ----------
  function resizeGL(canvas, gl){
    const dpr=window.devicePixelRatio||1;
    const w=canvas.clientWidth, h=canvas.clientHeight;
    canvas.width=Math.max(1,w*dpr); canvas.height=Math.max(1,h*dpr);
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  function sh(gl,type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function link(gl,vsSrc,fsSrc){ const p=gl.createProgram(); gl.attachShader(p,sh(gl,gl.VERTEX_SHADER,vsSrc)); gl.attachShader(p,sh(gl,gl.FRAGMENT_SHADER,fsSrc)); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
function mkBuf(gl, target, data) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  return b;
}

})();

