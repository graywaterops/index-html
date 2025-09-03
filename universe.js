(() => {
  const CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/pub?gid=317266263&single=true&output=csv";

  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");

  let Graph, nodes = [], links = [], adj = new Map();

  const getId = v => (typeof v === "object" ? v.id : v);

  // --- Parse CSV lines ---
  function parseCsvLine(line) {
    const out = []; let cur = "", inQuotes = false;
    for (let i=0;i<line.length;i++) {
      const ch=line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i+1] === '"') {cur+='"';i++;} else inQuotes=false;
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

    // referral probabilities
    const referralRows = rows.filter(r => /^[0-5]$/.test(r[0]));
    let totalProb=0;
    const referralProbs = referralRows.map(([k,p])=>{
      const val=parseFloat(p)/100; totalProb+=val; return {k:+k,p:val};
    });
    if (Math.abs(totalProb-1)>0.01) referralProbs.forEach(r=>r.p/=totalProb);

    // gift probabilities
    const giftRows = rows.filter(r => /^\$?[0-9,]+/.test(r[0]));
    let giftTotal=0;
    const giftProbs = giftRows.map(([amt,p])=>{
      const amount=parseFloat(String(amt).replace(/[^0-9.]/g,""));
      const prob=parseFloat(p)/100; giftTotal+=prob;
      return {amount,p:prob};
    });
    if (Math.abs(giftTotal-1)>0.01) giftProbs.forEach(g=>g.p/=giftTotal);

    return { referralProbs, giftProbs, seeds:250, generations:6, totalDonors:1000 };
  }

  // --- Universe generator ---
  function genUniverse({ referralProbs, giftProbs, seeds, generations, totalDonors }) {
    nodes=[]; links=[]; adj.clear(); let id=0;

    const addNode=(type,parentId=null)=>{
      const gift=sampleGift(giftProbs);
      const node={id:id++,type,gift,highlight:null,cumulative:0};
      nodes.push(node);
      if(parentId!==null){
        links.push({source:parentId,target:node.id,highlight:null});
        if(!adj.has(parentId)) adj.set(parentId,[]);
        adj.get(parentId).push(node.id);
      }
      return node.id;
    };

    function sampleK(){
      const r=Math.random(); let sum=0;
      for(let {k,p} of referralProbs){sum+=p;if(r<=sum)return k;}
      return 0;
    }

    function sampleGift(giftProbs){
      const r=Math.random(); let sum=0;
      for(let {amount,p} of giftProbs){sum+=p;if(r<=sum)return Math.max(amount,50);}
      return 50;
    }

    function grow(parentId,depth){
      if(depth>=generations || nodes.length>=totalDonors) return;
      const k=sampleK(); if(k<=0)return;
      for(let i=0;i<k;i++){
        const type=(i===0)?"primary":"down"; // ✅ ensure downline shows as "down"
        const child=addNode(type,parentId);
        grow(child,depth+1);
      }
    }

    for(let i=0;i<seeds;i++){const root=addNode("root"); grow(root,0);}
    computeCumulative();
    return {nodes,links};
  }

  // --- Compute cumulative downstream donations ---
  function computeCumulative(){
    function dfs(id){
      const n=nodes.find(nn=>nn.id===id);
      let total=n.gift;
      (adj.get(id)||[]).forEach(childId=>{
        total+=dfs(childId);
      });
      n.cumulative=total;
      return total;
    }
    nodes.filter(n=>n.type==="root").forEach(r=>dfs(r.id));
  }

  // --- Highlight paths ---
  function clearHighlights(){
    nodes.forEach(n=>n.highlight=null);
    links.forEach(l=>l.highlight=null);
  }

  function highlightPath(node){
    clearHighlights();

    function visitDown(id){
      const n=nodes.find(nn=>nn.id===id); if(!n) return;
      if(n.highlight==="forward"||n.highlight==="selected") return;
      n.highlight="forward";
      links.forEach(l=>{
        if(getId(l.source)===id){
          l.highlight="forward";
          visitDown(getId(l.target));
        }
      });
    }

    function visitUp(id){
      links.forEach(l=>{
        if(getId(l.target)===id){
          l.highlight="back";
          const parent=nodes.find(nn=>nn.id===getId(l.source));
          if(parent && parent.highlight!=="back"){
            parent.highlight="back";
            visitUp(parent.id);
          }
        }
      });
    }

    node.highlight="selected";
    visitDown(node.id);
    visitUp(node.id);

    Graph.graphData({nodes,links});
  }

  // --- Draw 3D graph ---
  function draw({nodes,links}){
    Graph=ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData({nodes,links})
      .nodeLabel(n=>`
        <strong>${n.type}</strong> #${n.id}<br/>
        Gift: $${n.gift}<br/>
        Cumulative downstream: $${n.cumulative}
      `)
      .nodeColor(n=>{
        if(n.highlight==="selected") return "#ffffff";
        if(n.highlight==="forward") return "#00ff88";
        if(n.highlight==="back") return "#ffdd33";
        if(n.type==="root") return "#1f4aa8";
        if(n.type==="primary") return "#7cc3ff";
        if(n.type==="extra") return "#2ecc71";
        if(n.type==="down") return "#e74c3c"; // ✅ red is back
        return "#999999";
      })
      .nodeVal(n=>Math.log(n.cumulative+50))
      .linkColor(l=>{
        if(l.highlight==="forward") return "#00ff88";
        if(l.highlight==="back") return "#ffdd33";
        return "rgba(180,180,180,0.15)";
      })
      .linkWidth(l=>(l.highlight?2:0.3))
      .onNodeClick(node=>highlightPath(node))
      .d3Force("charge", d3.forceManyBody().strength(-80))
      .d3Force("link", d3.forceLink().distance(40).strength(0.4))
      .d3Force("center", d3.forceCenter())
      .d3VelocityDecay(0.9);

    if(statusEl) statusEl.textContent=`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  // --- Run ---
  (async()=>{
    if(statusEl) statusEl.textContent="Loading sheet data...";
    const inputs=await loadInputs();
    const data=genUniverse(inputs);
    draw(data);
  })();
})();
