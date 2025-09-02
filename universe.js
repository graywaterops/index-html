(() => {
  const CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/pub?gid=317266263&single=true&output=csv";

  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");

  let Graph;
  let selectedNode = null;
  const forwardNodes = new Set(), backNodes = new Set();
  const forwardLinks = new Set(), backLinks = new Set();
  const adjacency = new Map();

  const getId = v => (typeof v === "object" ? v.id : v);

  // ---- CSV parser ----
  function parseCsvLine(line) {
    const out = []; let cur = "", inQuotes = false;
    for (let i=0;i<line.length;i++) {
      const ch=line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i+1] === '"') {cur+='"';i++;}
          else inQuotes=false;
        } else cur+=ch;
      } else {
        if (ch === '"') inQuotes=true;
        else if (ch === ",") {out.push(cur);cur="";}
        else cur+=ch;
      }
    }
    out.push(cur);
    return out;
  }

  async function loadInputs() {
    const res = await fetch(CSV_URL, { cache:"no-store" });
    const text = await res.text();
    const rows = text.split(/\r?\n/).filter(l=>l.trim()).map(parseCsvLine);

    // Referral distribution
    const referralRows = rows.filter(r => /^[0-5]$/.test(r[0]));
    let totalProb=0;
    const referralProbs = referralRows.map(([k,p])=>{
      const val=parseFloat(p)/100; totalProb+=val; return {k:+k,p:val};
    });
    if (Math.abs(totalProb-1)>0.01) referralProbs.forEach(r=>r.p/=totalProb);

    // Gift distribution
    const giftRows = rows.filter(r => /^\$?[0-9,]+/.test(r[0]));
    let giftTotal = 0;
    const giftProbs = giftRows.map(([amt,p])=>{
      const amount=parseFloat(String(amt).replace(/[^0-9.]/g,""));
      const prob=parseFloat(p)/100; giftTotal+=prob;
      return {amount,p:prob};
    });
    if (Math.abs(giftTotal-1)>0.01) giftProbs.forEach(g=>g.p/=giftTotal);

    const seeds = parseInt((rows.find(r=>r[0]?.toLowerCase().includes("seed coins"))||[])[1])||100;
    const generations = parseInt((rows.find(r=>r[0]?.toLowerCase().includes("hand-off generations"))||[])[1])||6;

    return { referralProbs, giftProbs, seeds, generations };
  }

  // ---- Simulation ----
  function genUniverse({ referralProbs, giftProbs, seeds, generations }) {
    const nodes=[], links=[]; let id=0;

    const addNode=(type,parentId=null)=>{
      const gift=sampleGift(giftProbs);
      const node={id:id++,type,gift};
      nodes.push(node);
      if(parentId!==null) links.push({source:parentId,target:node.id});
      return node.id;
    };

    function sampleK(){
      const r=Math.random(); let sum=0;
      for(let {k,p} of referralProbs){sum+=p;if(r<=sum)return k;}
      return 0;
    }

    function sampleGift(giftProbs){
      const total=giftProbs.reduce((s,g)=>s+g.p,0);
      const r=Math.random()*total; let sum=0;
      for(let {amount,p} of giftProbs){
        sum+=p;
        if(r<=sum) return Math.max(amount,50); // enforce $50 minimum
      }
      return 50;
    }

    function grow(parentId,depth,parentType="root"){
      if(depth>=generations)return;
      const k=sampleK(); if(k<=0)return;
      const firstType=(parentType==="extra"||parentType==="down")?"down":"primary";
      const first=addNode(firstType,parentId);
      grow(first,depth+1,firstType);
      for(let i=1;i<k;i++){
        const type=(parentType==="extra"||parentType==="down")?"down":"extra";
        const child=addNode(type,parentId);
        grow(child,depth+1,type);
      }
    }

    for(let i=0;i<seeds;i++){const root=addNode("root"); grow(root,0,"root");}
    return {nodes,links};
  }

  function buildAdjacency(nodes,links){
    adjacency.clear();
    nodes.forEach(n=>adjacency.set(n.id,[]));
    links.forEach(l=>adjacency.get(getId(l.source)).push(getId(l.target)));
  }

  function highlightPath(node){
    forwardNodes.clear(); backNodes.clear();
    forwardLinks.clear(); backLinks.clear();
    if(!node)return;

    // Forward
    function visitDown(id){
      if(forwardNodes.has(id))return;
      forwardNodes.add(id);
      (adjacency.get(id)||[]).forEach(child=>{
        forwardLinks.add(`${id}-${child}`);
        visitDown(child);
      });
    }

    // Backtrace
    function visitUp(id){
      Graph.graphData().links.forEach(l=>{
        const s=getId(l.source), t=getId(l.target);
        if(t===id && !backNodes.has(s)){
          backNodes.add(s);
          backLinks.add(`${s}-${t}`);
          visitUp(s);
        }
      });
    }

    visitDown(node.id);
    visitUp(node.id);
  }

  // ---- Draw ----
  function draw({nodes,links}){
    buildAdjacency(nodes,links);

    Graph=ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({nodes,links})
      .nodeLabel(n=>`<strong>${n.type}</strong> #${n.id}<br/>Gift: $${n.gift}`)
      .nodeColor(n=>{
        if(selectedNode){
          if(forwardNodes.has(n.id)) return "#00ff88";   // forward highlight
          if(backNodes.has(n.id)) return "#ffdd33";      // backtrace highlight
          return "#333";
        }
        return n.type==="root"?"#1f4aa8":
               n.type==="primary"?"#7cc3ff":
               n.type==="extra"?"#2ecc71":"#e74c3c";
      })
      .nodeVal(n=>n.type==="root"?12:n.type==="primary"?8:n.type==="extra"?6:4)
      .linkColor(l=>{
        const key=`${getId(l.source)}-${getId(l.target)}`;
        if(forwardLinks.has(key)) return "#00ff88";
        if(backLinks.has(key)) return "#ffdd33";
        return "rgba(180,180,180,0.15)";
      })
      .linkWidth(l=>{
        const key=`${getId(l.source)}-${getId(l.target)}`;
        return (forwardLinks.has(key)||backLinks.has(key))?2:0.4;
      })
      .onNodeClick(node=>{
        selectedNode=node;
        highlightPath(node);
        Graph.refresh();
      })
      .d3Force("charge", d3.forceManyBody().strength(-120))
      .d3Force("link", d3.forceLink().distance(40).strength(0.5))
      .d3VelocityDecay(0.6)
      .cooldownTicks(150)
      .cooldownTime(8000);

    if(statusEl) {
      statusEl.textContent=`Status: ${nodes.length} donors, ${links.length} referrals — click a node to see forward (green) vs backtrace (yellow). Esc=clear`;
    }

    // Freeze layout after cooldown
    setTimeout(()=>{
      Graph.d3Force("charge",null);
      Graph.d3Force("link",null);
      Graph.d3Force("center",null);
    }, 8500);

    window.addEventListener("keydown",e=>{
      if(e.key==="Escape"){selectedNode=null;forwardNodes.clear();backNodes.clear();forwardLinks.clear();backLinks.clear();Graph.refresh();}
    });
  }

  // ---- Run ----
  (async()=>{
    if(statusEl) statusEl.textContent="Status: loading sheet data...";
    const {referralProbs,giftProbs,seeds,generations}=await loadInputs();
    const data=genUniverse({referralProbs,giftProbs,seeds,generations});
    draw(data);
  })();
})();
