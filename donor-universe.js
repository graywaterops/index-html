/* Donor Universe — WebGL with 2D fallback (no external libs) */
(() => {
  const $ = (id) => document.getElementById(id);
  const elGL = $('gl');
  const el2D = $('cv2d');
  const coinsEl = $('coins');
  const raisedEl = $('raised');
  const statusEl = $('status');
  const fillEl = $('fill');
  const btnPlay = $('btnPlay');
  const btnAll = $('btnAll');
  const btnDebug = $('btnDebug');

  const setStatus = (m) => (statusEl.textContent = 'Status: ' + m);
  const fmt$ = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /* ---------- RNG & helpers ---------- */
  function xmur3(str){for(var i=0,h=1779033703^str.length;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),3432918353),h=h<<13|h>>>19;return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return(h^(h>>>16))>>>0}}
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  function makeRNG(s){if(!s) return Math.random; const seed=xmur3(String(s))(); return mulberry32(seed)}
  function roundTo(v,step){return Math.round(v/step)*step}
  function poisson(lambda,rand){if(lambda<=0)return 0; const L=Math.exp(-lambda); let k=0,p=1; do{k++;p*=rand()}while(p>L); return k-1}
  function gift(rand){
    const u=rand();
    if(u<0.60) return 50;
    if(u<0.78) return roundTo(50+rand()*100, 5);
    if(u<0.90) return roundTo(150+rand()*350, 10);
    if(u<0.98) return roundTo(500+rand()*1500, 25);
    return roundTo(2000+rand()*3000, 50);
  }
  function easeOutCubic(t){ t=Math.max(0,Math.min(1,t)); return 1 - Math.pow(1-t,3); }
  function upperBound(arr,val){let lo=0,hi=arr.length; while(lo<hi){const mid=(lo+hi)>>1; if(arr[mid]<=val) lo=mid+1; else hi=mid;} return lo;}

  /* ---------- Parameters ---------- */
  const P = {
    roots: 250,
    lightDepth: 10, lightProb: .85, lightFan: 1.5, lightDecay: .90,
    extraDepth: 9,  extraProb: .85, extraFan: 1.8, extraDecay: .88,
    radius: 800, jitter: 36, cap: 20000, seed: 'universe-gh-pages'
  };

  /* ---------- Build model (one light child per parent) ---------- */
  function buildModel() {
    const rand=makeRNG(P.seed), randJ=makeRNG(P.seed+'j'), randG=makeRNG(P.seed+'g');
    const DT0=140, DT_L=560, DT_G=420, DT_R=300;
    const nodes=[], links=[], roots=[]; let id=0;
    function add(type,parent=null,branch='light',depth=0,birth=0){
      if(nodes.length>=P.cap) return null;
      const n={id:id++,type,parent,branch,depth,birth,gift:gift(randG),x:0,y:0,z:0,children:[]};
      nodes.push(n); if(parent!=null){links.push({source:parent,target:n.id}); nodes[parent].children.push(n.id);}
      return n;
    }
    for(let i=0;i<P.roots;i++){const b=i*DT0+rand()*80; const r=add('dark',null,'light',0,b); roots.push(r.id);}
    const q=roots.map(x=>x);
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
    // layout
    function fib(n,r=P.radius){const pts=[],phi=Math.PI*(3-Math.sqrt(5));
      for(let i=0;i<n;i++){const y=1-(i/Math.max(1,n-1))*2; const rad=Math.sqrt(Math.max(0,1-y*y)); const th=phi*i; pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r});}
      return pts;
    }
    const rootsObjs=nodes.filter(n=>n.type==='dark'); const pts=fib(rootsObjs.length,P.radius);
    rootsObjs.forEach((n,i)=>{n.x=pts[i].x;n.y=pts[i].y;n.z=pts[i].z;});
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
    return {nodes,links,roots,byBirth,births,giftPrefix,maxBirth};
  }

  /* ---------- Sizing & layout guards ---------- */
  function ensureVisibleSize() {
    // If the host theme shoves the canvas into a zero-height section, force height.
    const wrap = elGL.parentElement;
    const cs = getComputedStyle(wrap);
    if (wrap.clientHeight < 200 || cs.display === 'none') {
      wrap.style.minHeight = '80vh';
      wrap.style.display = 'block';
    }
  }
  ensureVisibleSize();

  /* ---------- Try WebGL, else fallback to 2D ---------- */
  let gl = null;
  try { gl = elGL.getContext('webgl', {antialias:true, alpha:false}); } catch {}
  if (!gl) {
    setStatus('WebGL not available in this container — using 2D fallback.');
    run2D();
    return;
  }

  runWebGL(gl);

  /* ======================= WebGL (billboard stars) ======================= */
  function runWebGL(gl) {
    setStatus('WebGL starting…');

    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);

    function resize(){ const dpr=window.devicePixelRatio||1;
      const w=elGL.clientWidth, h=elGL.clientHeight;
      elGL.width=Math.max(1,w*dpr); elGL.height=Math.max(1,h*dpr);
      gl.viewport(0,0,elGL.width,elGL.height);
    }
    window.addEventListener('resize', resize); resize();

    const model = buildModel();
    const N = model.nodes.length, E = model.links.length;

    // Colors
    const C_D=[0x1e/255,0x3a/255,0x8a/255], C_L=[0x93/255,0xc5/255,0xfd/255],
          C_G=[0x22/255,0xc5/255,0x5e/255], C_R=[0xef/255,0x44/255,0x44/255];

    // Billboard shader (see: vertex shifts clip.xy by corner * ndc * clip.w)
    const vs=`
    attribute vec3 aCenter; attribute vec2 aCorner; attribute float aSizePx;
    attribute float aBirth; attribute vec3 aColor;
    uniform mat4 uMVP; uniform vec2 uViewport; uniform float uTime; uniform float uRamp; uniform float uShowAll;
    varying vec3 vCol; varying float vA; varying vec2 vUV;
    void main(){
      vec4 clip = uMVP * vec4(aCenter,1.0);
      float born = (uShowAll>0.5)? 1.0 : clamp((uTime - aBirth)/uRamp, 0.0, 1.0);
      vA = born; vCol = aColor; vUV = aCorner;
      float ndc = (aSizePx / uViewport.y) * 2.0;
      clip.xy += aCorner * ndc * clip.w;
      gl_Position = clip;
    }`;
    const fs=`
    precision mediump float;
    varying vec3 vCol; varying float vA; varying vec2 vUV;
    uniform float uYellow;
    void main(){
      if(uYellow>0.5){ gl_FragColor=vec4(1.0,1.0,0.0,1.0); return; }
      vec2 uv=vUV; float r2=dot(uv,uv); if(r2>1.0) discard;
      float edge = smoothstep(1.0,0.6,1.0-r2);
      gl_FragColor = vec4(vCol, max(0.0,vA) * edge);
    }`;
    const vsL=`attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position=uMVP*vec4(aPos,1.0); }`;
    const fsL=`precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor=uCol; }`;

    function sh(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function prog(vsSrc,fsSrc){ const p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,vsSrc)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fsSrc)); gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }

    let pStars, pLines;
    try { pStars = prog(vs,fs); pLines = prog(vsL,fsL); }
    catch (e) { setStatus('Shader compile/link failed. Falling back to 2D. ' + e.message); run2D(); return; }

    // Build buffers for quads (4 verts/star)
    function baseSize(t){ return t==='dark'?7.0 : t==='light'?6.5 : t==='green'?6.8 : 6.2; } // visible
    const corners=[-1,-1, 1,-1, 1,1, -1,1];

    const starCenter=new Float32Array(N*4*3);
    const starCorner=new Float32Array(N*4*2);
    const starSize  =new Float32Array(N*4);
    const starBirth =new Float32Array(N*4);
    const starColor =new Float32Array(N*4*3);

    for(let i=0;i<N;i++){
      const n=model.nodes[i];
      const c = n.type==='dark'?C_D : n.type==='light'?C_L : n.type==='green'?C_G : C_R;
      const s = baseSize(n.type);
      for(let v=0; v<4; v++){
        const vi=i*4+v;
        starCenter.set([n.x,n.y,n.z], vi*3);
        starCorner.set([corners[v*2],corners[v*2+1]], vi*2);
        starSize[vi]  = s;
        starBirth[vi] = n.birth;
        starColor.set(c, vi*3);
      }
    }

    const edgePos=new Float32Array(E*6);
    for(let i=0;i<E;i++){ const l=model.links[i], a=model.nodes[l.source], b=model.nodes[l.target];
      edgePos.set([a.x,a.y,a.z,b.x,b.y,b.z], i*6);
    }

    function mkBuf(target,data){ const b=gl.createBuffer(); gl.bindBuffer(target,b); gl.bufferData(target,data,gl.STATIC_DRAW); return b; }
    const bufCenter=mkBuf(gl.ARRAY_BUFFER, starCenter);
    const bufCorner=mkBuf(gl.ARRAY_BUFFER, starCorner);
    const bufSize  =mkBuf(gl.ARRAY_BUFFER, starSize);
    const bufBirth =mkBuf(gl.ARRAY_BUFFER, starBirth);
    const bufColor =mkBuf(gl.ARRAY_BUFFER, starColor);
    const bufEdges =mkBuf(gl.ARRAY_BUFFER, edgePos);

    // Simple camera
    let yaw=0, pitch=0, dist=1400, panX=0, panY=0, dragging=false, rotating=false, lx=0,ly=0;
    elGL.addEventListener('mousedown',e=>{dragging=true; rotating=(e.button===0&&!e.ctrlKey); lx=e.clientX; ly=e.clientY;});
    window.addEventListener('mouseup',()=>dragging=false);
    window.addEventListener('mousemove',e=>{
      if(!dragging) return;
      const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY;
      if(rotating){ yaw+=dx*0.005; pitch=Math.max(-1.2,Math.min(1.2,pitch+dy*0.005)); } else { panX+=dx; panY+=dy; }
    });
    elGL.addEventListener('wheel',e=>{e.preventDefault(); dist=Math.max(200,Math.min(4000,dist+e.deltaY));},{passive:false});

    // Matrices
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

    // Bloom + controls
    const BLOOM={playing:true,t:0,duration:model.maxBirth+2000,start:performance.now(), showAll:false, yellow:false};

    btnPlay.onclick = ()=>{ BLOOM.playing=!BLOOM.playing; if(BLOOM.playing) BLOOM.start=performance.now()-BLOOM.t; setStatus(BLOOM.playing?'playing':'paused'); };
    btnAll.onclick  = ()=>{ BLOOM.showAll=!BLOOM.showAll; btnAll.textContent = BLOOM.showAll?'Show Only Born':'Show All'; };
    btnDebug.onclick= ()=>{ BLOOM.yellow=!BLOOM.yellow; btnDebug.textContent = BLOOM.yellow?'Normal Dots':'Yellow Dots'; };

    function updateCounters(){
      const idx = BLOOM.showAll ? model.nodes.length : upperBound(model.births, BLOOM.t);
      const coins=idx, gifts = idx? model.giftPrefix[idx-1] : 0;
      coinsEl.textContent = coins.toLocaleString('en-US');
      raisedEl.textContent = fmt$(Math.round(coins*50 + gifts));
      fillEl.style.width = `${Math.min(100,(BLOOM.t/BLOOM.duration)*100)}%`;
    }

    function render(){
      if(BLOOM.playing){
        BLOOM.t = Math.min(BLOOM.duration, performance.now()-BLOOM.start);
        if(BLOOM.t>=BLOOM.duration){ BLOOM.playing=false; setStatus('finished — click Play to replay'); }
      }
      updateCounters();

      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const dpr=window.devicePixelRatio||1, w=elGL.width/dpr, h=elGL.height/dpr;
      const proj=new Float32Array(16), view=new Float32Array(16), mvp=new Float32Array(16);
      m4pers(proj, Math.PI/3, w/h, 0.1, 5000);
      const cx=Math.sin(yaw)*dist*Math.cos(pitch), cy=Math.sin(pitch)*dist, cz=Math.cos(yaw)*dist*Math.cos(pitch);
      const panScale=dist/900;
      m4look(view, [cx - panX*panScale, cy + panY*panScale, cz], [ -panX*panScale, 0+panY*panScale, 0 ], [0,1,0]);
      m4mul(mvp, proj, view);

      // edges (brighter so you SEE them)
      gl.useProgram(pLines);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufEdges);
      let loc=gl.getAttribLocation(pLines,'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);
      gl.uniformMatrix4fv(gl.getUniformLocation(pLines,'uMVP'),false,mvp);
      gl.uniform4f(gl.getUniformLocation(pLines,'uCol'), 0.36,0.42,0.58, BLOOM.showAll?0.6:0.3);
      gl.drawArrays(gl.LINES,0,E*2);

      // stars
      gl.useProgram(pStars);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufCenter); loc=gl.getAttribLocation(pStars,'aCenter'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufCorner); loc=gl.getAttribLocation(pStars,'aCorner'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufSize);   loc=gl.getAttribLocation(pStars,'aSizePx'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,1,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufBirth);  loc=gl.getAttribLocation(pStars,'aBirth'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,1,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufColor);  loc=gl.getAttribLocation(pStars,'aColor'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);

      gl.uniformMatrix4fv(gl.getUniformLocation(pStars,'uMVP'),false,mvp);
      gl.uniform2f(gl.getUniformLocation(pStars,'uViewport'), elGL.width, elGL.height);
      gl.uniform1f(gl.getUniformLocation(pStars,'uTime'), BLOOM.showAll?1e12:BLOOM.t);
      gl.uniform1f(gl.getUniformLocation(pStars,'uRamp'), 420.0);
      gl.uniform1f(gl.getUniformLocation(pStars,'uShowAll'), BLOOM.showAll?1.0:0.0);
      gl.uniform1f(gl.getUniformLocation(pStars,'uYellow'), BLOOM.yellow?1.0:0.0);

      // TRIANGLE_FAN per star (4 verts each) → draw all in one go by relying on the attribute streams
      gl.drawArrays(gl.TRIANGLE_FAN, 0, N*4);

      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
    setStatus('WebGL running');
  }

  /* ======================= Canvas 2D fallback ======================= */
  function run2D() {
    el2D.style.display = 'block';
    const cv = el2D, ctx = cv.getContext('2d');
    function resize2D(){ const dpr=window.devicePixelRatio||1; const w=cv.clientWidth, h=cv.clientHeight; cv.width=w*dpr; cv.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    window.addEventListener('resize', resize2D); resize2D();

    const model = buildModel();
    const BLOOM={playing:true,t:0,duration:model.maxBirth+2000,start:performance.now(), showAll:false, yellow:false};

    btnPlay.onclick = ()=>{ BLOOM.playing=!BLOOM.playing; if(BLOOM.playing) BLOOM.start=performance.now()-BLOOM.t; };
    btnAll.onclick  = ()=>{ BLOOM.showAll=!BLOOM.showAll; btnAll.textContent = BLOOM.showAll?'Show Only Born':'Show All'; };
    btnDebug.onclick= ()=>{ BLOOM.yellow=!BLOOM.yellow; btnDebug.textContent = BLOOM.yellow?'Normal Dots':'Yellow Dots'; };

    function updateCounters(){
      const idx = BLOOM.showAll ? model.nodes.length : upperBound(model.births, BLOOM.t);
      const coins=idx, gifts=idx? model.giftPrefix[idx-1] : 0;
      coinsEl.textContent = coins.toLocaleString('en-US');
      raisedEl.textContent = fmt$(Math.round(coins*50 + gifts));
      fillEl.style.width = `${Math.min(100,(BLOOM.t/BLOOM.duration)*100)}%`;
    }

    // simple orbit-ish projection
    let yaw=0,pitch=0,dist=1100,tx=0,ty=0,drag=false,rot=false,lx=0,ly=0,dpr=1;
    el2D.addEventListener('mousedown',e=>{drag=true; rot=(e.button===2||e.ctrlKey)?true:false; lx=e.clientX; ly=e.clientY;});
    window.addEventListener('mouseup',()=>drag=false);
    window.addEventListener('mousemove',e=>{ if(!drag) return; const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY; if(rot){yaw+=dx*0.005; pitch=Math.max(-1.2,Math.min(1.2,pitch+dy*0.005));} else {tx+=dx; ty+=dy;}});
    el2D.addEventListener('wheel',e=>{e.preventDefault(); dist=Math.max(200,Math.min(3000,dist + e.deltaY));},{passive:false});

    function project(v){
      const cosy=Math.cos(yaw), siny=Math.sin(yaw), cosx=Math.cos(pitch), sinx=Math.sin(pitch);
      let x=v.x*cosy - v.z*siny, z=v.x*siny + v.z*cosy, y=v.y*cosx - z*sinx; z = v.y*sinx + z*cosx;
      const f=dist, s=f/(f+z+1e-3);
      return {x:x*s + cv.width/(dpr*2) + tx, y:y*s + cv.height/(dpr*2) + ty, s};
    }

    function draw(){
      if(BLOOM.playing){
        BLOOM.t=Math.min(BLOOM.duration, performance.now()-BLOOM.start);
        if(BLOOM.t>=BLOOM.duration){ BLOOM.playing=false; }
      }
      updateCounters();

      ctx.clearRect(0,0,cv.width,cv.height);
      const screenPos=new Array(model.nodes.length);

      // edges faint
      ctx.strokeStyle='rgba(91,107,149,0.30)'; ctx.lineWidth=1; ctx.beginPath();
      for(const l of model.links){ const a=project(model.nodes[l.source]), b=project(model.nodes[l.target]); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
      ctx.stroke();

      // born edges cyan
      ctx.strokeStyle='rgba(110,231,255,1.0)'; ctx.beginPath();
      for(const l of model.links){ if(!BLOOM.showAll && model.nodes[l.target].birth>BLOOM.t) continue; const a=project(model.nodes[l.source]), b=project(model.nodes[l.target]); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
      ctx.stroke();

      // nodes
      for(const n of model.nodes){
        if(!BLOOM.showAll && BLOOM.t < n.birth) continue;
        const p=project(n);
        const base = n.type==='dark'?7.0 : n.type==='light'?6.5 : n.type==='green'?6.8 : 6.2;
        const r = base * (0.6 + 0.6*p.s);
        ctx.fillStyle = BLOOM.yellow ? '#ffff00' :
          (n.type==='dark')?'#1e3a8a' : (n.type==='light')?'#93c5fd' : (n.type==='green')?'#22c55e' : '#ef4444';
        ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(2,r),0,Math.PI*2); ctx.fill();
      }

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    setStatus('Canvas 2D running');
  }
})();
