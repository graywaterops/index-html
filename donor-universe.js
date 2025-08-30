/* donor-universe.js — WebGL triangle → auto 3D galaxy (per-quad billboards) with 2D fallback
   - Single guarded startup (no double-inits)
   - Bright yellow triangle proves WebGL draws
   - Galaxy is “lite” and always visible (no bloom gating)
   - 2D fallback if WebGL unavailable
*/

(() => {
  // ---------- DOM handles ----------
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const glCanvas = $('gl');   // WebGL canvas (from index.html)
  const cv2d     = $('cv2d'); // 2D fallback canvas (from index.html)

  // ---------- helpers ----------
  const setStatus = (m) => { if (statusEl) statusEl.textContent = 'Status: ' + m; console.log('[DonorUniverse]', m); };
  const fmt$ = (n) => n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

  function ensureVisibleSize() {
    const wrap = glCanvas?.parentElement;
    if (wrap && wrap.clientHeight < 200) { wrap.style.minHeight = '80vh'; wrap.style.display = 'block'; }
  }
  ensureVisibleSize();

  // ---------- tiny RNGs ----------
  function xmur3(str){for(var i=0,h=1779033703^str.length;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),3432918353),h=h<<13|h>>>19;return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return(h^(h>>>16))>>>0}}
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  const mkRNG = (seed) => { const s=xmur3(String(seed))(); return mulberry32(s); };
  const upperBound = (arr,val)=>{let lo=0,hi=arr.length; while(lo<hi){const mid=(lo+hi)>>1; if(arr[mid]<=val) lo=mid+1; else hi=mid;} return lo;};

  // ---------- Verify required DOM ----------
  (function verifyDOM(){
    const missing=[];
    if(!statusEl) missing.push('#status');
    if(!coinsEl)  missing.push('#coins');
    if(!raisedEl) missing.push('#raised');
    if(!glCanvas) missing.push('#gl');
    if(!cv2d)     missing.push('#cv2d');
    if(missing.length){ setStatus('Error: missing DOM ids: '+missing.join(', ')); return; }
  })();

  // ---------- Try WebGL ----------
  let gl=null;
  try { gl = glCanvas.getContext('webgl', {antialias:true, alpha:false}); } catch {}
  if (!gl) { setStatus('WebGL not available — switching to Canvas 2D.'); run2D(); return; }

  // ---------- WebGL TRIANGLE (diagnostic) ----------
  try {
    runWebGLTriangle(gl);
    setStatus('WebGL triangle OK — loading galaxy…');
  } catch(e){
    setStatus('WebGL TRIANGLE ERROR: '+(e?.message||e));
    console.error(e);
    setStatus('Falling back to Canvas 2D…');
    run2D();
    return;
  }

  // ---------- Guarded auto-start of galaxy ----------
  if (!window.__DONOR_GALAXY_BOOTED__) {
    window.__DONOR_GALAXY_BOOTED__ = true;
    setTimeout(()=>{ runWebGLGalaxy(gl); }, 300);
  }

  // ====================================================================================
  // WebGL TRIANGLE
  function runWebGLTriangle(gl){
    resizeGL();
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
  // WebGL GALAXY (lite, always-visible)
  function runWebGLGalaxy(gl){
    if (window.__DONOR_GALAXY_ACTIVE__) { setStatus('Galaxy already running'); return; }
    window.__DONOR_GALAXY_ACTIVE__ = true;

    setStatus('Starting galaxy…');
    resizeGL();
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST); // stars never hide each other for max visibility

    // --- simple model: lots of visible stars (no bloom gating) ---
    const P={ roots:250, radius:800, jitter:36, cap:12000, seed:'galaxy-lite' };
    const rand = mkRNG(P.seed), randJ = mkRNG(P.seed+'j');
    const nodes=[], links=[], roots=[];
    let id=0;
    function add(type,parent=null){
      if(nodes.length>=P.cap) return null;
      const n={id:id++,type,parent,x:0,y:0,z:0,children:[]}; nodes.push(n);
      if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);}
      return n;
    }
    // make roots on a sphere
    function fib(n,r){const pts=[],phi=Math.PI*(3-Math.sqrt(5));
      for(let i=0;i<n;i++){ const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i;
        pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r}); } return pts; }
    for(let i=0;i<P.roots;i++){const r=add('dark',null); roots.push(r.id);}
    const pts=fib(roots.length,P.radius); roots.forEach((rid,i)=>{nodes[rid].x=pts[i].x; nodes[rid].y=pts[i].y; nodes[rid].z=pts[i].z;});

    // around each root, add one light & several greens for a dense, obvious universe
    for(const rid of roots){
      if(nodes.length>=P.cap) break;
      const p=nodes[rid];
      const j=()=> (rand()*2-1)*P.jitter;
      const l=add('light',rid); if(!l) break; l.x=p.x+j(); l.y=p.y+j(); l.z=p.z+j();
      const greens=2 + ((rand()*3)|0); // 2–4 greens
      for(let k=0;k<greens && nodes.length<P.cap;k++){ const g=add('green',rid); if(!g) break; g.x=p.x+j(); g.y=p.y+j(); g.z=p.z+j(); }
    }

    const N=nodes.length, E=links.length;
    if(!N){ setStatus('Galaxy: empty model'); return; }

    // build GL buffers (billboards per star)
    const C_D=[0x1e/255,0x3a/255,0x8a/255], C_L=[0x93/255,0xc5/255,0xfd/255],
          C_G=[0x22/255,0xc5/255,0x5e/255], C_R=[0xef/255,0x44/255,0x44/255];
    const baseSize = (t)=> t==='dark'? 12.0 : t==='light'? 11.5 : t==='green'? 11.8 : 11.2; // large for visibility
    const centers=new Float32Array(N*4*3), corners=new Float32Array(N*4*2),
          sizes=new Float32Array(N*4), colors=new Float32Array(N*4*3);
    const quad=[-1,-1, 1,-1, 1,1, -1,1];
    for(let i=0;i<N;i++){
      const n=nodes[i]; const col = n.type==='dark'?C_D : n.type==='light'?C_L : n.type==='green'?C_G : C_R; const s=baseSize(n.type);
      for(let v=0; v<4; v++){
        const vi=i*4+v;
        centers.set([n.x,n.y,n.z], vi*3);
        corners.set([quad[v*2], quad[v*2+1]], vi*2);
        sizes[vi]=s; colors.set(col, vi*3);
      }
    }
    const epos = new Float32Array(E*6);
    for(let i=0;i<E;i++){ const l=links[i], a=nodes[l.source], b=nodes[l.target]; epos.set([a.x,a.y,a.z,b.x,b.y,b.z], i*6); }

    function mkBuf(target,data){ const b=gl.createBuffer(); gl.bindBuffer(target,b); gl.bufferData(target,data,gl.STATIC_DRAW); return b; }
    const bufCenter=mkBuf(gl.ARRAY_BUFFER,centers), bufCorner=mkBuf(gl.ARRAY_BUFFER,corners),
          bufSize  =mkBuf(gl.ARRAY_BUFFER,sizes),   bufColor =mkBuf(gl.ARRAY_BUFFER,colors),
          bufEdges =mkBuf(gl.ARRAY_BUFFER,epos);

    // shaders (billboard quads + lines)
    const vs=`
      attribute vec3 aCenter; attribute vec2 aCorner; attribute float aSizePx; attribute vec3 aColor;
      uniform mat4 uMVP; uniform vec2 uViewport;
      varying vec3 vCol; varying vec2 vUV;
      void main(){
        vec4 clip = uMVP * vec4(aCenter,1.0);
        vCol = aColor; vUV = aCorner;
        float ndc = (aSizePx / uViewport.y) * 2.0;
        clip.xy += aCorner * ndc * clip.w;
        gl_Position = clip;
      }`;
    const fs=`
      precision mediump float; varying vec3 vCol; varying vec2 vUV;
      void main(){
        vec2 uv=vUV; float r2=dot(uv,uv); if(r2>1.0) discard;
        float edge = smoothstep(1.0,0.6,1.0-r2);
        gl_FragColor = vec4(vCol, edge);
      }`;
    const vsL=`attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position=uMVP*vec4(aPos,1.0); }`;
    const fsL=`precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor=uCol; }`;

    const progStars = link(gl, vs, fs);
    const progLines = link(gl, vsL, fsL);

    const locStars = {
      aCenter: gl.getAttribLocation(progStars,'aCenter'),
      aCorner: gl.getAttribLocation(progStars,'aCorner'),
      aSizePx: gl.getAttribLocation(progStars,'aSizePx'),
      aColor : gl.getAttribLocation(progStars,'aColor'),
      uMVP: gl.getUniformLocation(progStars,'uMVP'),
      uViewport: gl.getUniformLocation(progStars,'uViewport')
    };
    const locLines = {
      aPos: gl.getAttribLocation(progLines,'aPos'),
      uMVP: gl.getUniformLocation(progLines,'uMVP'),
      uCol: gl.getUniformLocation(progLines,'uCol')
    };

    // camera & matrices
    let yaw=0, pitch=0, dist=1400, panX=0, panY=0, dragging=false, rotating=false, lx=0, ly=0;
    glCanvas.addEventListener('mousedown',e=>{dragging=true; rotating=(e.button===0 && !e.ctrlKey); lx=e.clientX; ly=e.clientY;});
    window.addEventListener('mouseup',()=>dragging=false);
    window.addEventListener('mousemove',e=>{
      if(!dragging) return;
      const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY;
      if(rotating){ yaw+=dx*0.005; pitch=Math.max(-1.2,Math.min(1.2,pitch+dy*0.005)); }
      else { panX+=dx; panY+=dy; }
    });
    glCanvas.addEventListener('wheel',e=>{e.preventDefault(); dist=Math.max(200,Math.min(5000,dist+e.deltaY));},{passive:false});
    function autoFit(){ const margin=1.3; dist = (P.radius+P.jitter*3)*margin / Math.sin(Math.PI/6); panX=0; panY=0; yaw=0; pitch=0; }
    autoFit();
    document.querySelector('.toolbar')?.appendChild((()=>{const b=document.createElement('button'); b.className='btn'; b.textContent='Auto-Fit'; b.onclick=autoFit; return b;})());

    function m4pers(out,fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);
      out[0]=f/aspect;out[1]=0;out[2]=0;out[3]=0; out[4]=0;out[5]=f;out[6]=0;out[7]=0;
      out[8]=0;out[9]=0;out[10]=(far+near)*nf;out[11]=-1; out[12]=0;out[13]=0;out[14]=2*far*near*nf;out[15]=0; return out;}
    function m4look(out,eye,ctr,up){const [ex,ey,ez]=eye,[cx,cy,cz]=ctr,[ux,uy,uz]=up;
      let zx=ex-cx,zy=ey-cy,zz=ez-cz; let zl=1/Math.hypot(zx,zy,zz); zx*=zl; zy*=zl; zz*=zl;
      let xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx; let xl=1/Math.hypot(xx,xy,xz); xx*=xl; xy*=xl; xz*=xl;
      let yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
      out[0]=xx;out[1]=yx;out[2]=zx;out[3]=0; out[4]=xy;out[5]=yy;out[6]=zy;out[7]=0; out[8]=xz;out[9]=yz;out[10]=zz;out[11]=0;
      out[12]=-(xx*ex+xy*ey+xz*ez); out[13]=-(yx*ex+yy*ey+yz*ez); out[14]=-(zx*ex+zy*ey+zz*ez); out[15]=1; return out;}
    function m4mul(out,a,b){const o=new Float32Array(16); for(let r=0;r<4;r++)for(let c=0;c<4;c++){o[r*4+c]=a[r*4+0]*b[0*4+c]+a[r*4+1]*b[1*4+c]+a[r*4+2]*b[2*4+c]+a[r*4+3]*b[3*4+c];} out.set(o); return out;}

    // draw loop
    (function render(){
      resizeGL();
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

      const dpr=window.devicePixelRatio||1, w=glCanvas.width/dpr, h=glCanvas.height/dpr;
      const proj=new Float32Array(16), view=new Float32Array(16), mvp=new Float32Array(16);
      m4pers(proj, Math.PI/3, w/h, 0.1, 5000);
      const cx=Math.sin(yaw)*dist*Math.cos(pitch), cy=Math.sin(pitch)*dist, cz=Math.cos(yaw)*dist*Math.cos(pitch);
      const panScale=dist/900;
      m4look(view, [cx - panX*panScale, cy + panY*panScale, cz], [ -panX*panScale, 0+panY*panScale, 0 ], [0,1,0]);
      m4mul(mvp, proj, view);

      // edges (bright)
      gl.useProgram(progLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufEdges);
      gl.enableVertexAttribArray(locLines.aPos); gl.vertexAttribPointer(locLines.aPos,3,gl.FLOAT,false,0,0);
      gl.uniformMatrix4fv(locLines.uMVP,false,mvp);
      gl.uniform4f(locLines.uCol, 0.36,0.42,0.58, 0.45);
      gl.drawArrays(gl.LINES,0,E*2);

      // stars (per-quad)
      gl.useProgram(progStars);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufCenter); gl.enableVertexAttribArray(locStars.aCenter); gl.vertexAttribPointer(locStars.aCenter,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufCorner); gl.enableVertexAttribArray(locStars.aCorner); gl.vertexAttribPointer(locStars.aCorner,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufSize);   gl.enableVertexAttribArray(locStars.aSizePx); gl.vertexAttribPointer(locStars.aSizePx,1,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufColor);  gl.enableVertexAttribArray(locStars.aColor); gl.vertexAttribPointer(locStars.aColor,3,gl.FLOAT,false,0,0);
      gl.uniformMatrix4fv(locStars.uMVP,false,mvp);
      gl.uniform2f(gl.getUniformLocation(progStars,'uViewport'), glCanvas.width, glCanvas.height);
      for(let i=0;i<N;i++) gl.drawArrays(gl.TRIANGLE_FAN, i*4, 4);

      requestAnimationFrame(render);
    })();

    // simple counters (increase so header shows life)
    let tick=0;
    (function bump(){
      tick++; const coins = Math.min(N, tick*5); // fake counter tied to frames
      const raised = coins*50;
      coinsEl.textContent = coins.toLocaleString('en-US');
      raisedEl.textContent = fmt$(raised);
      setTimeout(bump, 400);
    })();

    setStatus('Galaxy (lite) running — stars should be visible now.');
  }

  // ====================================================================================
  // 2D fallback (simple starfield)
  function run2D(){
    if(!cv2d){ setStatus('Error: no #cv2d for 2D fallback'); return; }
    cv2d.style.display='block';
    const ctx=cv2d.getContext('2d');
    function resize2D(){ const dpr=window.devicePixelRatio||1; const w=cv2d.clientWidth,h=cv2d.clientHeight; cv2d.width=w*dpr; cv2d.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    window.addEventListener('resize',resize2D); resize2D();
    const stars=[...Array(600)].map(()=>({x:Math.random()*cv2d.clientWidth,y:Math.random()*cv2d.clientHeight,r:2+Math.random()*4,a:.6+Math.random()*.4,c:['#93c5fd','#22c55e','#ef4444','#e5e7eb'][Math.random()*4|0]}));
    let coins=0; function bump(){ coins+=2; coinsEl.textContent=coins.toLocaleString('en-US'); raisedEl.textContent=fmt$(coins*50); }
    setInterval(bump, 400);
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
  function resizeGL(){
    if(!glCanvas || !gl) return;
    const dpr=window.devicePixelRatio||1;
    const w=glCanvas.clientWidth, h=glCanvas.clientHeight;
    glCanvas.width=Math.max(1,w*dpr); glCanvas.height=Math.max(1,h*dpr);
    gl.viewport(0,0,glCanvas.width,glCanvas.height);
  }
  function sh(gl,type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function link(gl,vsSrc,fsSrc){ const p=gl.createProgram(); gl.attachShader(p,sh(gl,gl.VERTEX_SHADER,vsSrc)); gl.attachShader(p,sh(gl,gl.FRAGMENT_SHADER,fsSrc)); gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
})();
