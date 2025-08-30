// donor-universe.js — diagnostic-first build (WebGL triangle -> 3D galaxy, 2D fallback)
// Shows clear status at every step and prints any error to the status bar.

(() => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const glCanvas = $('gl');
  const cv2d     = $('cv2d');

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = 'Status: ' + msg;
    // Also log to console for Network/Console debugging
    console.log('[DonorUniverse]', msg);
  }

  // 0) Sanity: do we have the elements the JS expects?
  (function verifyDOM(){
    const missing = [];
    if (!statusEl) missing.push('#status');
    if (!coinsEl)  missing.push('#coins');
    if (!raisedEl) missing.push('#raised');
    if (!glCanvas) missing.push('#gl');
    if (!cv2d)     missing.push('#cv2d');
    if (missing.length) {
      setStatus('Error: missing DOM ids: ' + missing.join(', ') +
        ' — Make sure index.html has <canvas id="gl"> and <canvas id="cv2d"> plus #status/#coins/#raised.');
      return;
    }
  })();

  // helpers
  function fmt$(n){ return n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}); }
  function ensureAreaVisible() {
    const wrap = glCanvas.parentElement;
    if (wrap && wrap.clientHeight < 200) {
      wrap.style.minHeight = '80vh';
      wrap.style.display = 'block';
    }
  }
  ensureAreaVisible();

  // 1) Try WebGL context
  let gl = null;
  try { gl = glCanvas.getContext('webgl', {antialias:true, alpha:false}); } catch {}
  if (!gl) {
    setStatus('WebGL not available in this container — switching to Canvas 2D.');
    run2D();
    return;
  }

  // 2) Draw a giant WebGL TRIANGLE so you can’t miss it
  try {
    runWebGLTriangle(gl);
    setStatus('WebGL triangle OK — click "Enable Galaxy" to switch to the 3D donor map.');
  } catch (e) {
    setStatus('WebGL TRIANGLE ERROR: ' + (e && e.message ? e.message : e));
    console.error(e);
    setStatus('Falling back to Canvas 2D…');
    run2D();
    return;
  }

  // Add a button to enable the full galaxy after we’ve proven WebGL draws
  ensureToolbarButtons();
  const enableBtn = document.createElement('button');
  enableBtn.className = 'btn';
  enableBtn.textContent = 'Enable Galaxy';
  document.querySelector('.toolbar').appendChild(enableBtn);
  enableBtn.addEventListener('click', () => {
    try {
      runWebGLGalaxy(gl);
      enableBtn.remove();
    } catch (e) {
      setStatus('Galaxy init error: ' + (e && e.message ? e.message : e));
      console.error(e);
      setStatus('Falling back to Canvas 2D…');
      run2D();
    }
  });

  // ===== WebGL TRIANGLE (diagnostic) =====
  function runWebGLTriangle(gl) {
    resizeGL();
    const vs = `
      attribute vec2 aPos;
      void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
    `;
    const fs = `
      precision mediump float;
      void main(){ gl_FragColor = vec4(1.0, 0.9, 0.1, 1.0); } // bright yellow
    `;
    const prog = link(gl, vs, fs);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // Big triangle covering the screen
    const verts = new Float32Array([
      -0.9, -0.9,
       0.9, -0.9,
       0.0,  0.8
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');

    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ===== WebGL GALAXY (billboard stars, per-quad draw) =====
  function runWebGLGalaxy(gl) {
    setStatus('Starting galaxy…');
    // Re-init viewport each time
    resizeGL();
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST); // don’t let stars hide each other

    // Model
    const P = {
      roots:250,
      lightDepth:10, lightProb:.85, lightFan:1.5, lightDecay:.90,
      extraDepth:9,  extraProb:.85, extraFan:1.8, extraDecay:.88,
      radius:800, jitter:36, cap:20000, seed:'universe-gh-galaxy'
    };
    const rand = mkRNG(P.seed), randJ = mkRNG(P.seed+'j'), randG = mkRNG(P.seed+'g');
    function mkRNG(seed){ return (function(s){const seedFn=xmur3(String(s))(); return mulberry32(seedFn);})(seed); }
    function gift(){ const u=randG(); if(u<0.6) return 50; if(u<0.78) return 50+~~(randG()*100); if(u<0.90) return 150+~~(randG()*350); if(u<0.98) return 500+~~(randG()*1500); return 2000+~~(randG()*3000); }
    const DT0=140, DT_L=560, DT_G=420, DT_R=300;

    const nodes=[], links=[], roots=[];
    let id=0;
    function add(type,parent=null,branch='light',depth=0,birth=0){
      if(nodes.length>=P.cap) return null;
      const n={id:id++,type,parent,branch,depth,birth,gift:gift(),x:0,y:0,z:0,children:[]};
      nodes.push(n); if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);}
      return n;
    }
    for(let i=0;i<P.roots;i++){const b=i*DT0+rand()*80; const r=add('dark',null,'light',0,b); roots.push(r.id);}
    const q=roots.slice();
    while(q.length && nodes.length<P.cap){
      const pid=q.shift(), p=nodes[pid];
      if(p.branch==='light' && p.depth<P.lightDepth){
        const sc=Math.pow(P.lightDecay, Math.max(0,p.depth));
        if(rand()<P.lightProb*sc){
          let k=poisson(Math.max(0,P.lightFan*sc), rand);
          if(k>0){
            const lb=p.birth+DT_L*(0.8+0.4*rand());
            const c=add('light',pid,'light',p.depth+1,lb); q.push(c.id);
            for(let i=1;i<k;i++){ const gb=p.birth+DT_G*(0.65+0.5*rand()); const g=add('green',pid,'extra',1,gb); q.push(g.id); }
          }
        }
      } else if(p.branch==='extra' && p.depth<P.extraDepth){
        const sc=Math.pow(P.extraDecay, Math.max(0,p.depth-1));
        if(rand()<P.extraProb*sc){
          let k=poisson(Math.max(0,P.extraFan*sc), rand);
          for(let i=0;i<k;i++){ const rb=p.birth+DT_R*(0.6+0.5*rand()); const r=add('red',pid,'extra',p.depth+1,rb); q.push(r.id); }
        }
      }
    }
    // layout: fibonacci sphere for roots, jitter for children
    function fib(n,r=P.radius){const pts=[],phi=Math.PI*(3-Math.sqrt(5));
      for(let i=0;i<n;i++){ const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i;
        pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r}); } return pts; }
    const rootsObjs=nodes.filter(n=>n.type==='dark'), pts=fib(rootsObjs.length,P.radius);
    rootsObjs.forEach((n,i)=>{n.x=pts[i].x; n.y=pts[i].y; n.z=pts[i].z;});
    nodes.forEach(n=>{
      if(n.type!=='dark'){
        const p=nodes[n.parent];
        const sp=P.jitter*(1+0.04*Math.max(0,n.depth-1));
        const j=()=> (randJ()*2-1)*sp; n.x=p.x+j(); n.y=p.y+j(); n.z=p.z+j();
      }
    });
    const byBirth=nodes.slice().sort((a,b)=>a.birth-b.birth);
    const births=byBirth.map(n=>n.birth);
    let acc=0; const giftPrefix=byBirth.map(n=>{acc+=n.gift; return acc;});
    const maxBirth=nodes.reduce((m,n)=>Math.max(m,n.birth),0);

    // Counters (simple Bloom)
    const BLOOM={playing:true,t:0,duration:maxBirth+2000,start:performance.now(), showAll:true, yellow:true};
    const toolbar = ensureToolbarButtons();
    document.getElementById('btnPlay').onclick = ()=>{ BLOOM.playing=!BLOOM.playing; if(BLOOM.playing) BLOOM.start=performance.now()-BLOOM.t; };
    document.getElementById('btnAll').onclick  = ()=>{ BLOOM.showAll=!BLOOM.showAll; document.getElementById('btnAll').textContent=BLOOM.showAll?'Show Only Born':'Show All'; };
    document.getElementById('btnDebug').onclick= ()=>{ BLOOM.yellow=!BLOOM.yellow; document.getElementById('btnDebug').textContent=BLOOM.yellow?'Normal Dots':'Yellow Dots'; };

    function updateCounters(){
      const idx = BLOOM.showAll ? nodes.length : upperBound(births, BLOOM.t);
      const coins=idx, gifts = idx? giftPrefix[idx-1] : 0;
      coinsEl.textContent = coins.toLocaleString('en-US');
      raisedEl.textContent = fmt$(Math.round(coins*50 + gifts));
      if (fillEl) fillEl.style.width = `${Math.min(100,(BLOOM.t/BLOOM.duration)*100)}%`;
    }

    // Build billboard buffers (4 verts per star)
    const C_D=[0x1e/255,0x3a/255,0x8a/255], C_L=[0x93/255,0xc5/255,0xfd/255], C_G=[0x22/255,0xc5/255,0x5e/255], C_R=[0xef/255,0x44/255,0x44/255];
    const baseSize = (t)=> t==='dark'?10.0 : t==='light'?9.5 : t==='green'?9.8 : 9.2;
    const centers=new Float32Array(nodes.length*4*3),
          corners=new Float32Array(nodes.length*4*2),
          sizes  =new Float32Array(nodes.length*4),
          nbirths=new Float32Array(nodes.length*4),
          colors =new Float32Array(nodes.length*4*3);
    const quad=[-1,-1, 1,-1, 1,1, -1,1];
    for (let i=0;i<nodes.length;i++){
      const n=nodes[i]; const c = n.type==='dark'?C_D: n.type==='light'?C_L: n.type==='green'?C_G: C_R; const s=baseSize(n.type);
      for(let v=0;v<4;v++){
        const vi=i*4+v;
        centers.set([n.x,n.y,n.z], vi*3);
        corners.set([quad[v*2], quad[v*2+1]], vi*2);
        sizes[vi]=s; nbirths[vi]=n.birth; colors.set(c, vi*3);
      }
    }
    const epos=new Float32Array(links.length*6);
    for(let i=0;i<links.length;i++){ const l=links[i], a=nodes[l.source], b=nodes[l.target]; epos.set([a.x,a.y,a.z,b.x,b.y,b.z], i*6); }

    function mkBuf(target,data){ const b=gl.createBuffer(); gl.bindBuffer(target,b); gl.bufferData(target,data,gl.STATIC_DRAW); return b; }
    const bufCenter=mkBuf(gl.ARRAY_BUFFER,centers), bufCorner=mkBuf(gl.ARRAY_BUFFER,corners),
          bufSize  =mkBuf(gl.ARRAY_BUFFER,sizes),   bufBirth =mkBuf(gl.ARRAY_BUFFER,nbirths),
          bufColor =mkBuf(gl.ARRAY_BUFFER,colors),  bufEdges =mkBuf(gl.ARRAY_BUFFER,epos);

    // Shaders
    const vs=`
      attribute vec3 aCenter; attribute vec2 aCorner; attribute float aSizePx; attribute float aBirth; attribute vec3 aColor;
      uniform mat4 uMVP; uniform vec2 uViewport; uniform float uTime; uniform float uRamp; uniform float uShowAll;
      varying vec3 vCol; varying float vA; varying vec2 vUV;
      void main(){
        vec4 clip = uMVP * vec4(aCenter,1.0);
        float born = (uShowAll>0.5)? 1.0 : clamp((uTime - aBirth)/uRamp, 0.0, 1.0);
        vA = born; vCol = aColor; vUV = aCorner;
        float ndc = (aSizePx / uViewport.y) * 2.0;
        clip.xy += aCorner * ndc * clip.w; gl_Position = clip;
      }`;
    const fs=`
      precision mediump float; varying vec3 vCol; varying float vA; varying vec2 vUV; uniform float uYellow;
      void main(){
        if(uYellow>0.5){ gl_FragColor=vec4(1.0,1.0,0.0,1.0); return; }
        vec2 uv=vUV; float r2=dot(uv,uv); if(r2>1.0) discard;
        float edge = smoothstep(1.0,0.6,1.0-r2);
        gl_FragColor=vec4(vCol, max(0.0,vA)*edge);
      }`;
    const vsL=`attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position=uMVP*vec4(aPos,1.0); }`;
    const fsL=`precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor=uCol; }`;
    const progStars=link(gl,vs,fs), progLines=link(gl,vsL,fsL);

    const locStars={
      aCenter: gl.getAttribLocation(progStars,'aCenter'),
      aCorner: gl.getAttribLocation(progStars,'aCorner'),
      aSizePx: gl.getAttribLocation(progStars,'aSizePx'),
      aBirth:  gl.getAttribLocation(progStars,'aBirth'),
      aColor:  gl.getAttribLocation(progStars,'aColor'),
      uMVP: gl.getUniformLocation(progStars,'uMVP'),
      uViewport: gl.getUniformLocation(progStars,'uViewport'),
      uTime: gl.getUniformLocation(progStars,'uTime'),
      uRamp: gl.getUniformLocation(progStars,'uRamp'),
      uShowAll: gl.getUniformLocation(progStars,'uShowAll'),
      uYellow: gl.getUniformLocation(progStars,'uYellow')
    };
    const locLines={ aPos: gl.getAttribLocation(progLines,'aPos'), uMVP: gl.getUniformLocation(progLines,'uMVP'), uCol: gl.getUniformLocation(progLines,'uCol') };

    // Camera math
    let yaw=0, pitch=0, dist=1400, panX=0, panY=0, drag=false, rot=false, lx=0,ly=0;
    glCanvas.addEventListener('mousedown',e=>{drag=true; rot=(e.button===0&&!e.ctrlKey); lx=e.clientX; ly=e.clientY;});
    window.addEventListener('mouseup',()=>drag=false);
    window.addEventListener('mousemove',e=>{
      if(!drag) return; const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY;
      if(rot){ yaw+=dx*0.005; pitch=Math.max(-1.2,Math.min(1.2,pitch+dy*0.005)); } else { panX+=dx; panY+=dy; }
    });
    glCanvas.addEventListener('wheel',e=>{e.preventDefault(); dist=Math.max(200,Math.min(5000,dist+e.deltaY));},{passive:false});
    function autoFit(){ const margin=1.3; dist = (P.radius+P.jitter*3)*margin / Math.sin(Math.PI/6); panX=0; panY=0; yaw=0; pitch=0; }
    autoFit(); btnFit.onclick=autoFit;

    function m4pers(out,fovy,aspect,near,far){const f=1/Math.tan(fovy/2),nf=1/(near-far);
      out[0]=f/aspect;out[1]=0;out[2]=0;out[3]=0; out[4]=0;out[5]=f;out[6]=0;out[7]=0; out[8]=0;out[9]=0;out[10]=(far+near)*nf;out[11]=-1; out[12]=0;out[13]=0;out[14]=2*far*near*nf;out[15]=0; return out;}
    function m4look(out,eye,ctr,up){const [ex,ey,ez]=eye,[cx,cy,cz]=ctr,[ux,uy,uz]=up;
      let zx=ex-cx,zy=ey-cy,zz=ez-cz; let zl=1/Math.hypot(zx,zy,zz); zx*=zl; zy*=zl; zz*=zl;
      let xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx; let xl=1/Math.hypot(xx,xy,xz); xx*=xl; xy*=xl; xz*=xl;
      let yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
      out[0]=xx;out[1]=yx;out[2]=zx;out[3]=0; out[4]=xy;out[5]=yy;out[6]=zy;out[7]=0; out[8]=xz;out[9]=yz;out[10]=zz;out[11]=0;
      const panScale=dist/900;
      out[12]=-(xx*(Math.sin(yaw)*dist*Math.cos(pitch)-panX*panScale)+xy*(Math.sin(pitch)*dist+panY*panScale)+xz*(Math.cos(yaw)*dist*Math.cos(pitch)));
      out[13]=-(yx*(Math.sin(yaw)*dist*Math.cos(pitch)-panX*panScale)+yy*(Math.sin(pitch)*dist+panY*panScale)+yz*(Math.cos(yaw)*dist*Math.cos(pitch)));
      out[14]=-(zx*(Math.sin(yaw)*dist*Math.cos(pitch)-panX*panScale)+zy*(Math.sin(pitch)*dist+panY*panScale)+zz*(Math.cos(yaw)*dist*Math.cos(pitch)));
      out[15]=1; return out;}

    function render(){
      if(BLOOM.playing){ BLOOM.t=Math.min(BLOOM.duration, performance.now()-BLOOM.start); }
      updateCounters();

      // viewport & clear
      resizeGL();
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

      const dpr=window.devicePixelRatio||1, w=glCanvas.width/dpr, h=glCanvas.height/dpr;
      const proj=new Float32Array(16), view=new Float32Array(16), mvp=new Float32Array(16);
      m4pers(proj, Math.PI/3, w/h, 0.1, 5000);
      const cx=Math.sin(yaw)*dist*Math.cos(pitch), cy=Math.sin(pitch)*dist, cz=Math.cos(yaw)*dist*Math.cos(pitch);
      const panScale=dist/900;
      m4look(view, [cx - panX*panScale, cy + panY*panScale, cz], [ -panX*panScale, 0+panY*panScale, 0 ], [0,1,0]);
      // mvp = proj*view
      for(let r=0;r<4;r++) for(let c=0;c<4;c++){
        mvp[r*4+c]=proj[r*4+0]*view[0*4+c]+proj[r*4+1]*view[1*4+c]+proj[r*4+2]*view[2*4+c]+proj[r*4+3]*view[3*4+c];
      }

      // Edges
      gl.useProgram(progLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufEdges);
      gl.enableVertexAttribArray(locLines.aPos);
      gl.vertexAttribPointer(locLines.aPos,3,gl.FLOAT,false,0,0);
      gl.uniformMatrix4fv(locLines.uMVP,false,mvp);
      gl.uniform4f(locLines.uCol, 0.36,0.42,0.58, BLOOM.showAll?0.6:0.35);
      gl.drawArrays(gl.LINES,0,links.length*2);

      // Stars (per-quad)
      gl.useProgram(progStars);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufCenter); gl.enableVertexAttribArray(locStars.aCenter); gl.vertexAttribPointer(locStars.aCenter,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufCorner); gl.enableVertexAttribArray(locStars.aCorner); gl.vertexAttribPointer(locStars.aCorner,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufSize);   gl.enableVertexAttribArray(locStars.aSizePx); gl.vertexAttribPointer(locStars.aSizePx,1,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufBirth);  gl.enableVertexAttribArray(locStars.aBirth); gl.vertexAttribPointer(locStars.aBirth,1,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufColor);  gl.enableVertexAttribArray(locStars.aColor); gl.vertexAttribPointer(locStars.aColor,3,gl.FLOAT,false,0,0);

      gl.uniformMatrix4fv(locStars.uMVP,false,mvp);
      gl.uniform2f(locStars.uViewport, glCanvas.width, glCanvas.height);
      gl.uniform1f(locStars.uTime, BLOOM.showAll?1e12:BLOOM.t);
      gl.uniform1f(locStars.uRamp, 420.0);
      gl.uniform1f(locStars.uShowAll, BLOOM.showAll?1.0:0.0);
      gl.uniform1f(locStars.uYellow, BLOOM.yellow?1.0:0.0);

      for(let i=0;i<nodes.length;i++) gl.drawArrays(gl.TRIANGLE_FAN, i*4, 4);

      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
    setStatus('WebGL running — stars drawn per-quad. Use buttons to toggle.');
  }

  // ====== 2D fallback ======
  function run2D(){
    if (!cv2d) { setStatus('Error: no #cv2d canvas for 2D fallback'); return; }
    cv2d.style.display='block';
    const ctx=cv2d.getContext('2d');
    function resize2D(){ const dpr=window.devicePixelRatio||1; const w=cv2d.clientWidth,h=cv2d.clientHeight; cv2d.width=w*dpr; cv2d.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    window.addEventListener('resize',resize2D); resize2D();
    // simple visible stars
    const stars=[...Array(600)].map(()=>({x:Math.random()*cv2d.clientWidth,y:Math.random()*cv2d.clientHeight,r:2+Math.random()*4,a:.6+Math.random()*.4,c:['#93c5fd','#22c55e','#ef4444','#e5e7eb'][Math.random()*4|0]}));
    let coins=0,gifts=0;
    function step(){ coins += 1+(Math.random()*2|0); gifts += 50 + Math.random()*200; coinsEl.textContent=coins.toLocaleString('en-US'); raisedEl.textContent=fmt$(Math.round(coins*50+gifts)); }
    setInterval(step, 400);
    function draw(){ const w=cv2d.width/(window.devicePixelRatio||1), h=cv2d.height/(window.devicePixelRatio||1);
      ctx.clearRect(0,0,w,h); ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h);
      for(const s of stars){ s.a+= (Math.random()-0.5)*0.05; if(s.a<0.2)s.a=0.2; if(s.a>1)s.a=1;
        ctx.globalAlpha=s.a; ctx.fillStyle=s.c; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); }
      ctx.globalAlpha=1; requestAnimationFrame(draw);
    } draw();
    setStatus('Canvas 2D running.');
  }

  // GL helpers
  function sh(gl,type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ throw new Error(gl.getShaderInfoLog(s)); } return s; }
  function link(gl,vsSrc,fsSrc){ const p=gl.createProgram(); gl.attachShader(p,sh(gl,gl.VERTEX_SHADER,vsSrc)); gl.attachShader(p,sh(gl,gl.FRAGMENT_SHADER,fsSrc)); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ throw new Error(gl.getProgramInfoLog(p)); } return p; }
  function resizeGL(){ const dpr=window.devicePixelRatio||1; const w=glCanvas.clientWidth,h=glCanvas.clientHeight; glCanvas.width=Math.max(1,w*dpr); glCanvas.height=Math.max(1,h*dpr); if (gl) gl.viewport(0,0,glCanvas.width,glCanvas.height); }
})();
