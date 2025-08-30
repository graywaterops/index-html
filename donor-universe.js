/* donor-universe.js — WebGL triangle → auto 3D galaxy (round, color-coded stars) + 2D fallback
   - Single guarded startup
   - Yellow triangle proves WebGL renders
   - Galaxy draws billboards (two triangles per star), circular mask, per-type color & size
   - Canvas 2D fallback if WebGL unavailable
*/

(() => {
  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const glCanvas = $('gl');
  const cv2d     = $('cv2d');
  const setStatus = (m) => { if (statusEl) statusEl.textContent = 'Status: ' + m; console.log('[DonorUniverse]', m); };
  const fmt$ = (n) => n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

  // ---------- helpers ----------
  function xmur3(str){for(var i=0,h=1779033703^str.length;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),3432918353),h=h<<13|h>>>19;return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return(h^(h>>>16))>>>0}}
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  const mkRNG = (seed) => { const s=xmur3(String(seed))(); return mulberry32(s); };
  function upperBound(arr,val){let lo=0,hi=arr.length; while(lo<hi){const mid=(lo+hi)>>1; if(arr[mid]<=val) lo=mid+1; else hi=mid;} return lo;}
  function mkBuf(gl, target, data){ const b=gl.createBuffer(); gl.bindBuffer(target,b); gl.bufferData(target,data,gl.STATIC_DRAW); return b; }
  function resizeGL(){ const dpr=window.devicePixelRatio||1; const w=glCanvas.clientWidth,h=glCanvas.clientHeight; glCanvas.width=Math.max(1,w*dpr); glCanvas.height=Math.max(1,h*dpr); if(gl) gl.viewport(0,0,glCanvas.width,glCanvas.height); }
  function sh(gl,type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function link(gl,vsSrc,fsSrc){ const p=gl.createProgram(); gl.attachShader(p,sh(gl,gl.VERTEX_SHADER,vsSrc)); gl.attachShader(p,sh(gl,gl.FRAGMENT_SHADER,fsSrc)); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }

  // ---------- ensure height ----------
  (function ensureVisibleSize(){ const wrap=glCanvas?.parentElement; if(wrap && wrap.clientHeight<200){ wrap.style.minHeight='80vh'; wrap.style.display='block'; }})();

  // ---------- DOM sanity ----------
  (function verifyDOM(){
    const miss=[]; if(!statusEl) miss.push('#status'); if(!coinsEl) miss.push('#coins'); if(!raisedEl) miss.push('#raised'); if(!glCanvas) miss.push('#gl'); if(!cv2d) miss.push('#cv2d');
    if(miss.length){ setStatus('Error: missing DOM ids: '+miss.join(', ')); }
  })();

  // ---------- try WebGL else fallback ----------
  let gl=null; try { gl=glCanvas.getContext('webgl',{antialias:true,alpha:false}); } catch {}
  if(!gl){ setStatus('WebGL not available — using Canvas 2D.'); run2D(); return; }

  // ---------- triangle test ----------
  try { runTriangle(gl); setStatus('WebGL triangle OK — loading galaxy…'); } catch(e){ setStatus('Triangle error: '+(e?.message||e)); run2D(); return; }
  if(!window.__DU_BOOTED__){ window.__DU_BOOTED__=true; setTimeout(()=> runGalaxy(gl), 250); }

  // ===== TRIANGLE =====
  function runTriangle(gl){
    resizeGL();
    const vs=`attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0); }`;
    const fs=`precision mediump float; void main(){ gl_FragColor=vec4(1.0,0.95,0.2,1.0); }`;
    const prog=link(gl,vs,fs);
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-0.9,-0.9, 0.9,-0.9, 0.0,0.8]),gl.STATIC_DRAW);
    const aPos=gl.getAttribLocation(prog,'aPos');
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  // ===== GALAXY =====
  function runGalaxy(gl){
    if(window.__DU_GALAXY_ACTIVE__){ setStatus('Galaxy already running'); return; }
    window.__DU_GALAXY_ACTIVE__=true;
    setStatus('Galaxy running — rotate (drag), pan (right/Ctrl-drag), wheel to zoom.');

    // ----- build model (roots + light + extras + small red chains) -----
    const P={ roots:250, radius:800, jitter:36, cap:14000, seed:'universe-v2' };
    const rand=mkRNG(P.seed), randJ=mkRNG(P.seed+'j');
    const nodes=[],links=[],roots=[]; let id=0;

    function add(type,parent=null){
      if(nodes.length>=P.cap) return null;
      const n={id:id++,type,parent,x:0,y:0,z:0,children:[]};
      nodes.push(n); if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);}
      return n;
    }
    function fib(n,r){const pts=[],phi=Math.PI*(3-Math.sqrt(5)); for(let i=0;i<n;i++){ const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i; pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r}); } return pts;}

    // roots on sphere
    for(let i=0;i<P.roots;i++){ const r=add('dark'); roots.push(r.id); }
    const rootPts=fib(roots.length,P.radius); roots.forEach((rid,i)=>{ const r=nodes[rid]; r.x=rootPts[i].x; r.y=rootPts[i].y; r.z=rootPts[i].z; });

    // each root: one light; 0–3 greens; each green 0–2 reds
    const j=()=> (rand()*2-1)*P.jitter;
    for(const rid of roots){
      if(nodes.length>=P.cap) break;
      const p=nodes[rid];
      const l=add('light',rid); if(!l) break; l.x=p.x+j(); l.y=p.y+j(); l.z=p.z+j();
      const greens=(rand()*4)|0;
      for(let gk=0;gk<greens && nodes.length<P.cap;gk++){
        const g=add('green',rid); if(!g) break; g.x=p.x+j(); g.y=p.y+j(); g.z=p.z+j();
        const reds=(rand()*3)|0;
        for(let rk=0;rk<reds && nodes.length<P.cap;rk++){
          const r=add('red',g.id); if(!r) break; r.x=g.x+j(); r.y=g.y+j(); r.z=g.z+j();
        }
      }
    }

    const N=nodes.length, E=links.length;
    // --- color & size per type (smaller to avoid “bubbles”) ---
    const COL = {
      dark : [0x1e/255,0x3a/255,0x8a/255],    // dark blue
      light: [0x93/255,0xc5/255,0xfd/255],    // light blue
      green: [0x22/255,0xc5/255,0x5e/255],    // green
      red  : [0xef/255,0x44/255,0x44/255]     // red
    };
    const SIZE = { dark: 6.5, light: 4.6, green: 5.2, red: 4.0 };

    // Interleaved billboard vertices: center(3) + corner(2) + sizePx(1) + color(3)
    const verts = new Float32Array(N * 6 * 9);
    const quad  = [-1,-1, 1,-1, 1,1,  -1,-1, 1,1, -1,1];
    let off=0;
    for(let i=0;i<N;i++){
      const n=nodes[i];
      const col = n.type==='dark'?COL.dark : n.type==='light'?COL.light : n.type==='green'?COL.green : COL.red;
      const s   = n.type==='dark'?SIZE.dark : n.type==='light'?SIZE.light : n.type==='green'?SIZE.green : SIZE.red;
      for(let t=0;t<6;t++){
        verts[off++]=n.x; verts[off++]=n.y; verts[off++]=n.z;        // center
        verts[off++]=quad[t*2]; verts[off++]=quad[t*2+1];            // unit corner
        verts[off++]=s;                                              // size in px
        verts[off++]=col[0]; verts[off++]=col[1]; verts[off++]=col[2]; // color
      }
    }
    const bufStars = mkBuf(gl, gl.ARRAY_BUFFER, verts);

    // Edges (optional faint structure)
    const epos = new Float32Array(E*6);
    for(let i=0;i<E;i++){ const l=links[i], a=nodes[l.source], b=nodes[l.target]; epos.set([a.x,a.y,a.z,b.x,b.y,b.z], i*6); }
    const bufEdges = mkBuf(gl, gl.ARRAY_BUFFER, epos);

    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    // Shader: simple yaw/pitch + orthographic scale/pan/zoom. Circular mask for stars.
    const vsStars=`
      attribute vec3 aCenter;
      attribute vec2 aCorner;    // unit -1..1
      attribute float aSizePx;
      attribute vec3 aColor;

      uniform vec2  uViewport;
      uniform float uYaw, uPitch;
      uniform float uScale, uZoom;
      uniform vec2  uPanNDC;

      varying vec3 vCol;
      varying vec2 vCorner; // pass through for circular mask

      mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
      mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

      void main(){
        vec3 p = rotX(uPitch) * (rotY(uYaw) * aCenter);
        vec2 ndc = vec2(p.x, p.y) * (uScale * uZoom);
        float ndcPerPixel = 2.0 / uViewport.y;    // size in NDC per 1 px
        vec2 cornerNDC = aCorner * aSizePx * ndcPerPixel;
        vec2 posNDC = ndc + cornerNDC + uPanNDC;
        gl_Position = vec4(posNDC, 0.0, 1.0);
        vCol = aColor;
        vCorner = aCorner;
      }`;
    const fsStars=`
      precision mediump float;
      varying vec3 vCol;
      varying vec2 vCorner;
      void main(){
        float r2 = dot(vCorner, vCorner);
        if (r2 > 1.0) discard;             // circular mask
        float edge = smoothstep(1.0, 0.7, 1.0 - r2);
        gl_FragColor = vec4(vCol, edge);   // soft edge alpha
      }`;

    const vsLines=`
      attribute vec3 aPos;
      uniform vec2  uViewport;
      uniform float uYaw, uPitch, uScale, uZoom;
      uniform vec2  uPanNDC;

      mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
      mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }

      void main(){
        vec3 p = rotX(uPitch) * (rotY(uYaw) * aPos);
        vec2 ndc = vec2(p.x, p.y) * (uScale * uZoom);
        gl_Position = vec4(ndc + uPanNDC, 0.0, 1.0);
      }`;
    const fsLines=`precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor=uCol; }`;

    const progStars=link(gl,vsStars,fsStars);
    const progLines=link(gl,vsLines,fsLines);

    const locStars={
      aCenter: gl.getAttribLocation(progStars,'aCenter'),
      aCorner: gl.getAttribLocation(progStars,'aCorner'),
      aSizePx: gl.getAttribLocation(progStars,'aSizePx'),
      aColor : gl.getAttribLocation(progStars,'aColor'),
      uViewport: gl.getUniformLocation(progStars,'uViewport'),
      uYaw: gl.getUniformLocation(progStars,'uYaw'),
      uPitch: gl.getUniformLocation(progStars,'uPitch'),
      uScale: gl.getUniformLocation(progStars,'uScale'),
      uZoom: gl.getUniformLocation(progStars,'uZoom'),
      uPanNDC: gl.getUniformLocation(progStars,'uPanNDC')
    };
    const locLines={
      aPos: gl.getAttribLocation(progLines,'aPos'),
      uViewport: gl.getUniformLocation(progLines,'uViewport'),
      uYaw: gl.getUniformLocation(progLines,'uYaw'),
      uPitch: gl.getUniformLocation(progLines,'uPitch'),
      uScale: gl.getUniformLocation(progLines,'uScale'),
      uZoom: gl.getUniformLocation(progLines,'uZoom'),
      uPanNDC: gl.getUniformLocation(progLines,'uPanNDC'),
      uCol: gl.getUniformLocation(progLines,'uCol')
    };

    // simple camera controls
    let yaw=0,pitch=0,zoom=1.0,panPxX=0,panPxY=0,drag=false,rot=false,lastX=0,lastY=0;
    const worldScale = 1.0 / (P.radius * 1.25); // fit sphere in view
    glCanvas.addEventListener('mousedown',e=>{drag=true;rot=(e.button===0&&!e.ctrlKey);lastX=e.clientX;lastY=e.clientY;});
    window.addEventListener('mouseup',()=>drag=false);
    window.addEventListener('mousemove',e=>{ if(!drag) return; const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; if(rot){ yaw+=dx*0.005; pitch=Math.max(-1.2,Math.min(1.2,pitch+dy*0.005)); } else { panPxX+=dx; panPxY+=dy; } });
    glCanvas.addEventListener('wheel',e=>{ e.preventDefault(); zoom=Math.max(0.25,Math.min(3.5, zoom + e.deltaY*0.001)); }, {passive:false});

    function resize(){ resizeGL(); }
    window.addEventListener('resize',resize); resize();

    // draw loop
    (function draw(){
      resize();
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

      const vw=glCanvas.width, vh=glCanvas.height;
      const panNDC=[ (panPxX/vw)*2.0, (-panPxY/vh)*2.0 ];

      // edges
      gl.useProgram(progLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufEdges);
      gl.enableVertexAttribArray(locLines.aPos); gl.vertexAttribPointer(locLines.aPos,3,gl.FLOAT,false,0,0);
      gl.uniform2f(locLines.uViewport, vw, vh);
      gl.uniform1f(locLines.uYaw, yaw);
      gl.uniform1f(locLines.uPitch, pitch);
      gl.uniform1f(locLines.uScale, worldScale);
      gl.uniform1f(locLines.uZoom, zoom);
      gl.uniform2f(locLines.uPanNDC, panNDC[0], panNDC[1]);
      gl.uniform4f(locLines.uCol, 0.36,0.42,0.58, 0.30);
      gl.drawArrays(gl.LINES,0,E*2);

      // stars (stride: 3+2+1+3 = 9 floats)
      gl.useProgram(progStars);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufStars);
      const stride = 9*4;
      gl.enableVertexAttribArray(locStars.aCenter); gl.vertexAttribPointer(locStars.aCenter,3,gl.FLOAT,false,stride,0);
      gl.enableVertexAttribArray(locStars.aCorner); gl.vertexAttribPointer(locStars.aCorner,2,gl.FLOAT,false,stride,3*4);
      gl.enableVertexAttribArray(locStars.aSizePx); gl.vertexAttribPointer(locStars.aSizePx,1,gl.FLOAT,false,stride,(3+2)*4);
      gl.enableVertexAttribArray(locStars.aColor ); gl.vertexAttribPointer(locStars.aColor ,3,gl.FLOAT,false,stride,(3+2+1)*4);
      gl.uniform2f(locStars.uViewport, vw, vh);
      gl.uniform1f(locStars.uYaw, yaw);
      gl.uniform1f(locStars.uPitch, pitch);
      gl.uniform1f(locStars.uScale, worldScale);
      gl.uniform1f(locStars.uZoom, zoom);
      gl.uniform2f(locStars.uPanNDC, panNDC[0], panNDC[1]);

      gl.drawArrays(gl.TRIANGLES, 0, N*6);

      requestAnimationFrame(draw);
    })();

    // simple counters to show life
    let tick=0;(function bump(){ tick++; const coins=Math.min(N, tick*4); coinsEl.textContent=coins.toLocaleString('en-US'); raisedEl.textContent=fmt$(coins*50); setTimeout(bump,400); })();
  }

  // ===== 2D FALLBACK =====
  function run2D(){
    cv2d.style.display='block';
    const ctx=cv2d.getContext('2d');
    function resize2D(){ const dpr=window.devicePixelRatio||1; const w=cv2d.clientWidth,h=cv2d.clientHeight; cv2d.width=w*dpr; cv2d.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    window.addEventListener('resize',resize2D); resize2D();

    const stars=[...Array(600)].map(()=>({x:Math.random()*cv2d.clientWidth,y:Math.random()*cv2d.clientHeight,r:2+Math.random()*4,c:['#1e3a8a','#93c5fd','#22c55e','#ef4444'][Math.random()*4|0]}));
    let coins=0; setInterval(()=>{ coins+=2; coinsEl.textContent=coins.toLocaleString('en-US'); raisedEl.textContent=fmt$(coins*50); },400);

    (function draw(){ const w=cv2d.width/(window.devicePixelRatio||1), h=cv2d.height/(window.devicePixelRatio||1);
      ctx.clearRect(0,0,w,h); ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h);
      for(const s of stars){ ctx.fillStyle=s.c; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); }
      requestAnimationFrame(draw);
    })();

    setStatus('Canvas 2D running.');
  }

  // get WebGL context up front
  let gl=null; try { gl=glCanvas.getContext('webgl',{antialias:true,alpha:false}); } catch {}
})();
