// donor-universe.js — ultra-minimal, guaranteed-visible 2D sanity check
(() => {
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const coinsEl  = $('coins');
  const raisedEl = $('raised');
  const wrap = document.querySelector('.universe-wrap');
  const cv = document.getElementById('cv2d');
  const ctx = cv.getContext('2d');

  // Make sure the canvas area is actually visible and sized
  function ensureSize(){
    if (!wrap) return;
    if (wrap.clientHeight < 200) wrap.style.minHeight = '80vh';
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth  || window.innerWidth;
    const h = wrap.clientHeight || Math.round(window.innerHeight * 0.8);
    cv.width  = Math.max(1, w * dpr);
    cv.height = Math.max(1, h * dpr);
    cv.style.width  = w + 'px';
    cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ensureSize();
  window.addEventListener('resize', ensureSize);

  // Immediately confirm JS executed
  statusEl.textContent = 'Status: Canvas 2D sanity-check running';

  // Starfield params (big/bright so you can’t miss them)
  const STARS = [];
  const COLORS = ['#93c5fd', '#22c55e', '#ef4444', '#e5e7eb']; // light blue, green, red, white
  function resetStars(){
    STARS.length = 0;
    const w = cv.width / (window.devicePixelRatio||1);
    const h = cv.height / (window.devicePixelRatio||1);
    for (let i=0;i<600;i++){
      STARS.push({
        x: Math.random()*w,
        y: Math.random()*h,
        r: 2 + Math.random()*4,        // BIG
        a: 0.6 + Math.random()*0.4,
        c: COLORS[(Math.random()*COLORS.length)|0],
        tw: (Math.random()*0.6)+0.2
      });
    }
  }
  resetStars();

  // Simple counters (simulate growth so you see movement)
  let coins = 0;
  let gifts = 0; // donations
  function stepCounters(){
    // Add 1–3 coins per tick; $50 per coin, plus occasional gifts
    const add = 1 + (Math.random()*2|0);
    coins += add;
    // skewed donation bumps
    for (let i=0;i<add;i++){
      const u = Math.random();
      if (u < 0.60) gifts += 50;
      else if (u < 0.90) gifts += 100 + Math.random()*300;
      else gifts += 500 + Math.random()*2500;
    }
    coinsEl.textContent  = coins.toLocaleString('en-US');
    raisedEl.textContent = (coins*50 + Math.round(gifts)).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
  }

  // Draw loop
  function draw(){
    const w = cv.width / (window.devicePixelRatio||1);
    const h = cv.height / (window.devicePixelRatio||1);
    ctx.clearRect(0,0,w,h);
    // background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0,0,w,h);
    // faint grid to prove drawing
    ctx.strokeStyle = 'rgba(110,231,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x=0; x<w; x+=80) { ctx.moveTo(x,0); ctx.lineTo(x,h); }
    for (let y=0; y<h; y+=80) { ctx.moveTo(0,y); ctx.lineTo(w,y); }
    ctx.stroke();
    // stars
    for (const s of STARS){
      s.a += (Math.random()-0.5)*0.05; if (s.a<0.2) s.a=0.2; if (s.a>1) s.a=1;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  // Kick everything
  draw();
  setInterval(stepCounters, 400);
})();
