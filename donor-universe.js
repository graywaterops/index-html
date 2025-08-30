/* donor-universe.js — WebGL triangle → auto 3D galaxy (round star points) + 2D fallback
   - Yellow triangle proves WebGL works
   - Galaxy stars drawn as circular billboards (no green squares)
   - mkBuf helper included
   - 2D fallback if WebGL unavailable
*/

(() => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const glCanvas = $('gl');
  const cv2d     = $('cv2d');
  const setStatus = (m) => { if (statusEl) statusEl.textContent = 'Status: ' + m; console.log('[DonorUniverse]', m); };
  const fmt$ = (n) => n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

  // mkBuf helper
  function mkBuf(gl, target, data) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  // ensure height
  (function ensureVisibleSize(){
    const wrap = glCanvas?.parentElement;
    if (wrap && wrap.clientHeight < 200) { wrap.style.minHeight='80vh'; wrap.style.display='block'; }
  })();

  // RNG
  function xmur3(str){for(var i=0,h=1779033703^str.length;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),3432918353),h=h<<13|h>>>19;return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);return(h^(h>>>16))>>>0}}
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  const mkRNG = (seed) => { const s=xmur3(String(seed))(); return mulberry32(s); };

  // check DOM
  (function verifyDOM(){
    const missing=[];
    if(!statusEl) missing.push('#status');
    if(!coinsEl)  missing.push('#coins');
    if(!raisedEl) missing.push('#raised');
    if(!glCanvas) missing.push('#gl');
    if(!cv2d)     missing.push('#cv2d');
    if(missing.length){ setStatus('Error: missing DOM ids: '+missing.join(', ')); return; }
  })();

  // webgl or 2D
  let gl=null;
  try { gl = glCanvas.getContext('webgl',{antialias:true,alpha:false}); } catch {}
  if(!gl){ setStatus('WebGL not available — switching to Canvas 2D'); run2D(); return; }

  try {
    runTriangle(gl);
    setStatus('WebGL triangle OK — loading galaxy…');
  } catch(e){
    setStatus('Triangle error: '+(e?.message||e));
    return run2D();
  }

  if(!window.__DU_BOOTED__){
    window.__DU_BOOTED__=true;
    setTimeout(()=> runGalaxy(gl), 300);
  }

  // Triangle test
  function runTriangle(gl){
    resizeGL();
    const vs=`attribute vec2 aPos; void main(){ gl_Position=vec4(aPos,0.0,1.0);} `;
    const fs=`precision mediump float; void main(){ gl_FragColor=vec4(1.,1.,0.,1.);} `;
    const prog=link(gl,vs,fs);
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-0.9,-0.9,0.9,-0.9,0.0,0.8]),gl.STATIC_DRAW);
    const aPos=gl.getAttribLocation(prog,'aPos');
    gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  // Galaxy
  function runGalaxy(gl){
    setStatus('Galaxy running — rotate (drag), pan (right/Ctrl-drag), wheel to zoom.');
    const rand=mkRNG('galaxy'), randJ=mkRNG('galaxy-j');
    const nodes=[],links=[],roots=[]; let id=0;
    function add(type,parent=null){const n={id:id++,type,parent,x:0,y:0,z:0,children:[]};nodes.push(n);if(parent!=null){links.push({source:parent,target:n.id});nodes[parent].children.push(n.id);}return n;}
    // fibonacci roots
    function fib(n,r){const pts=[],phi=Math.PI*(3-Math.sqrt(5));for(let i=0;i<n;i++){const y=1-(i/Math.max(1,n-1))*2;const rad=Math.sqrt(Math.max(0,1-y*y));const th=phi*i;pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r});}return pts;}
    for(let i=0;i<200;i++){const r=add('dark');roots.push(r.id);}
    const pts=fib(roots.length,800);roots.forEach((rid,i)=>{nodes[rid].x=pts[i].x;nodes[rid].y=pts[i].y;nodes[rid].z=pts[i].z;});
    for(const rid of roots){const p=nodes[rid],j=()=> (randJ()*2-1)*36;const l=add('light',rid);l.x=p.x+j();l.y=p.y+j();l.z=p.z+j();}
    const N=nodes.length,E=links.length;

    // Buffers
    const starVerts=new Float32Array(N*6*(3+2+3));
    const quad=[-1,-1,1,-1,1,1, -1,-1,1,1,-1,1];
    let off=0;
    for(let i=0;i<N;i++){
      const n=nodes[i];
      const col=n.type==='dark'?[0.12,0.23,0.54]:n.type==='light'?[0.58,0.77,0.99]:[0.13,0.77,0.37];
      for(let t=0;t<6;t++){
        starVerts[off++]=n.x; starVerts[off++]=n.y; starVerts[off++]=n.z;
        starVerts[off++]=quad[t*2]; starVerts[off++]=quad[t*2+1];
        starVerts[off++]=col[0]; starVerts[off++]=col[1]; starVerts[off++]=col[2];
      }
    }
    const bufStars=mkBuf(gl,gl.ARRAY_BUFFER,starVerts);

    // Shaders: with circular mask
    const vsStars=`
      attribute vec3 aCenter; attribute vec2 aCorner; attribute vec3 aColor;
      uniform vec2 uViewport; uniform float uYaw,uPitch,uScale,uZoom;
      uniform vec2 uPanNDC;
      varying vec3 vCol; varying vec2 vCorner;
      mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
      mat3 rotX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,-s,0.,s,c);}
      void main(){
        vec3 p=rotX(uPitch)*(rotY(uYaw)*aCenter);
        vec2 ndc=vec2(p.x,p.y)*(uScale*uZoom);
        float ndcPerPixel=2.0/uViewport.y;
        vec2 cornerNDC=aCorner*12.0*ndcPerPixel; // fixed size
        vec2 posNDC=ndc+cornerNDC+uPanNDC;
        gl_Position=vec4(posNDC,0.,1.);
        vCol=aColor; vCorner=aCorner;
      }`;
    const fsStars=`
      precision mediump float; varying vec3 vCol; varying vec2 vCorner;
      void main(){
        float r2=dot(vCorner,vCorner);
        if(r2>1.0) discard;
        float edge=smoothstep(1.0,0.7,1.0-r2);
        gl_FragColor=vec4(vCol,edge);
      }`;
    const progStars=link(gl,vsStars,fsStars);

    // camera
    let yaw=0,pitch=0,zoom=1.,panPxX=0,panPxY=0; const worldScale=1/1000;
    let dragging=false,rotating=false,lastX=0,lastY=0;
    glCanvas.addEventListener('mousedown',e=>{dragging=true;rotating=(e.button===0&&!e.ctrlKey);lastX=e.clientX;lastY=e.clientY;});
    window.addEventListener('mouseup',()=>dragging=false);
    window.addEventListener('mousemove',e=>{if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;if(rotating){yaw+=dx*0.005;pitch=Math.max(-1.2,Math.min(1.2,pitch+dy*0.005));}else{panPxX+=dx;panPxY+=dy;}});
    glCanvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(0.2,Math.min(4.,zoom+e.deltaY*0.001));},{passive:false});

    function resize(){resizeGL();}
    window.addEventListener('resize',resize); resize();

    (function draw(){
      resize();
      gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
      const vw=glCanvas.width,vh=glCanvas.height;
      const panNDC=[(panPxX/vw)*2.,(-panPxY/vh)*2.];
      gl.useProgram(progStars);
      gl.bindBuffer(gl.ARRAY_BUFFER,bufStars);
      const stride=(3+2+3)*4;
      const aCenter=gl.getAttribLocation(progStars,'aCenter');
      const aCorner=gl.getAttribLocation(progStars,'aCorner');
      const aColor=gl.getAttribLocation(progStars,'aColor');
      gl.enableVertexAttribArray(aCenter); gl.vertexAttribPointer(aCenter,3,gl.FLOAT,false,stride,0);
      gl.enableVertexAttribArray(aCorner); gl.vertexAttribPointer(aCorner,2,gl.FLOAT,false,stride,3*4);
      gl.enableVertexAttribArray(aColor);  gl.vertexAttribPointer(aColor,3,gl.FLOAT,false,stride,(3+2)*4);
      gl.uniform2f(gl.getUniformLocation(progStars,'uViewport'),vw,vh);
      gl.uniform1f(gl.getUniformLocation(progStars,'uYaw'),yaw);
      gl.uniform1f(gl.getUniformLocation(progStars,'uPitch'),pitch);
      gl.uniform1f(gl.getUniformLocation(progStars,'uScale'),worldScale);
      gl.uniform1f(gl.getUniformLocation(progStars,'uZoom'),zoom);
      gl.uniform2f(gl.getUniformLocation(progStars,'uPanNDC'),panNDC[0],panNDC[1]);
      gl.drawArrays(gl.TRIANGLES,0,N*6);
      requestAnimationFrame(draw);
    })();

    // counters
    let tick=0;(function bump(){tick++;const coins=Math.min(N,tick*5);coinsEl.textContent=coins.toLocaleString('en-US');raisedEl.textContent=fmt$(coins*50);setTimeout(bump,400);})();
  }

  // 2D fallback
  function run2D(){cv2d.style.display='block';const ctx=cv2d.getContext('2d');function resize2D(){const dpr=window.devicePixelRatio||1;const w=cv2d.clientWidth,h=cv2d.clientHeight;cv2d.width=w*dpr;cv2d.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}window.addEventListener('resize',resize2D);resize2D();const stars=[...Array(600)].map(()=>({x:Math.random()*cv2d.clientWidth,y:Math.random()*cv2d.clientHeight,r:2+Math.random()*4,c:['#93c5fd','#22c55e','#ef4444','#e5e7eb'][Math.random()*4|0]}));let coins=0;setInterval(()=>{coins+=2;coinsEl.textContent=coins.toLocaleString('en-US');raisedEl.textContent=fmt$(coins*50);},400);(function draw(){const w=cv2d.width/(window.devicePixelRatio||1),h=cv2d.height/(window.devicePixelRatio||1);ctx.clearRect(0,0,w,h);ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);for(const s of stars){ctx.fillStyle=s.c;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();}requestAnimationFrame(draw);})();setStatus('Canvas 2D running.');}

  function resizeGL(){const dpr=window.devicePixelRatio||1;const w=glCanvas.clientWidth,h=glCanvas.clientHeight;glCanvas.width=Math.max(1,w*dpr);glCanvas.height=Math.max(1,h*dpr);gl.viewport(0,0,glCanvas.width,glCanvas.height);}
  function sh(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));return s;}
  function link(gl,vsSrc,fsSrc){const p=gl.createProgram();gl.attachShader(p,sh(gl,gl.VERTEX_SHADER,vsSrc));gl.attachShader(p,sh(gl,gl.FRAGMENT_SHADER,fsSrc));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));return p;}
})();
