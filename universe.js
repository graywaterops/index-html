<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Smart Coin® Donor Universe</title>
  <script src="https://unpkg.com/3d-force-graph"></script>
  <style>
    body { margin:0; background:#000; color:#fff; font-family:Arial,sans-serif; }
    #graph { width:100%; height:100vh; }
    #status {
      position:fixed; bottom:12px; left:12px;
      background:rgba(0,0,0,.7); padding:8px 10px;
      border-radius:6px; font-size:14px;
    }
    .legend {
      position:fixed; top:12px; right:12px;
      background:rgba(0,0,0,.7); padding:10px;
      border-radius:6px; font-size:14px;
    }
    .legend .dot { display:inline-block; width:12px; height:12px; border-radius:50%; margin-right:6px; }
    .sliderBox {
      position:fixed; bottom:12px; left:250px;
      background:rgba(0,0,0,.7); padding:6px 10px;
      border-radius:6px; font-size:14px;
    }
  </style>
</head>
<body>
  <div id="graph"></div>
  <div id="status">Loading…</div>
  <div class="legend">
    <div><span class="dot" style="background:#1f4aa8"></span>Root (no referrals)</div>
    <div><span class="dot" style="background:#7cc3ff"></span>Primary</div>
    <div><span class="dot" style="background:#2ecc71"></span>Extra</div>
    <div><span class="dot" style="background:#e74c3c"></span>Downline</div>
    <div><span class="dot" style="background:#00ff88"></span>Forward path</div>
    <div><span class="dot" style="background:#ffdd33"></span>Backtrace</div>
    <div><span class="dot" style="background:#ffffff"></span>Selected</div>
  </div>
  <div class="sliderBox">
    Node Size: <input id="sizeSlider" type="range" min="2" max="20" value="6" step="1">
  </div>

  <script>
    const SEED_DONORS = 250;
    const TOTAL_DONORS = 1000;
    const DONATION_AMOUNTS = [50,100,250,500,1000,5000];
    const DONATION_PROBS = [0.7,0.2,0.05,0.04,0.006,0.004];

    let Graph, nodes=[], links=[];
    let selectedNode=null, nodeScale=6;

    function randomDonation(){
      let r=Math.random(), sum=0;
      for(let i=0;i<DONATION_AMOUNTS.length;i++){
        sum+=DONATION_PROBS[i];
        if(r<=sum) return DONATION_AMOUNTS[i];
      }
      return 50;
    }

    function genUniverse(){
      let id=0;
      function addNode(type,parent=null){
        const n={id:id++,type,donation:randomDonation(),highlight:null};
        nodes.push(n);
        if(parent!==null) links.push({source:parent,target:n.id,highlight:null});
        return n.id;
      }
      for(let s=0;s<SEED_DONORS;s++){
        const root=addNode("root");
        const primary=addNode("primary",root);
        if(Math.random()<0.7){
          const extras=1+Math.floor(Math.random()*3);
          for(let e=0;e<extras;e++){
            const extra=addNode("extra",primary);
            if(Math.random()<0.5) addNode("down",extra);
          }
        }
      }
    }

    function clearHighlights(){
      nodes.forEach(n=>n.highlight=null);
      links.forEach(l=>l.highlight=null);
    }

    function highlightChain(node){
      clearHighlights();
      node.highlight="selected";
      let total=node.donation, count=1;

      function dfsDown(id){
        links.forEach(l=>{
          if(l.source.id===id){
            const child=nodes.find(n=>n.id===l.target.id);
            if(child && !child.highlight){
              child.highlight="forward"; l.highlight="forward";
              total+=child.donation; count++;
              dfsDown(child.id);
            }
          }
        });
      }
      function dfsUp(id){
        links.forEach(l=>{
          if(l.target.id===id){
            l.highlight="back";
            const parent=nodes.find(n=>n.id===l.source.id);
            if(parent && !parent.highlight){
              parent.highlight="back"; dfsUp(parent.id);
            }
          }
        });
      }
      dfsDown(node.id); dfsUp(node.id);

      document.getElementById("status").textContent=
        `Donor #${node.id} → Chain donors: ${count}, Total raised: $${total.toLocaleString()}`;

      Graph.graphData({nodes,links});
    }

    genUniverse();

    Graph=ForceGraph3D()(document.getElementById("graph"))
      .graphData({nodes,links})
      .backgroundColor("#000")
      .nodeLabel(n=>`${n.type} #${n.id}<br/>Donation: $${n.donation}`)
      .nodeColor(n=>{
        if(n.highlight==="selected") return "#ffffff";
        if(n.highlight==="forward") return "#00ff88";
        if(n.highlight==="back") return "#ffdd33";
        if(n.type==="root") return "#1f4aa8";
        if(n.type==="primary") return "#7cc3ff";
        if(n.type==="extra") return "#2ecc71";
        if(n.type==="down") return "#e74c3c";
        return "#555";
      })
      .nodeVal(n=>{
        if(n.highlight==="selected") return nodeScale*2;
        return nodeScale;
      })
      .linkColor(l=>{
        if(l.highlight==="forward") return "#00ff88";
        if(l.highlight==="back") return "#ffdd33";
        return "rgba(255,255,255,0.15)";
      })
      .linkWidth(l=>(l.highlight?2:0.3))
      .onNodeClick(n=>{selectedNode=n; highlightChain(n);});

    // ESC clears selection
    window.addEventListener("keydown",ev=>{
      if(ev.key==="Escape"){
        clearHighlights();
        document.getElementById("status").textContent=
          `Ready — ${nodes.length} donors, ${links.length} referrals.`;
        Graph.graphData({nodes,links});
        selectedNode=null;
      }
    });

    // Slider control
    document.getElementById("sizeSlider").addEventListener("input",ev=>{
      nodeScale=+ev.target.value;
      Graph.nodeVal(n=>{
        if(n.highlight==="selected") return nodeScale*2;
        return nodeScale;
      });
      Graph.refresh();
    });

    document.getElementById("status").textContent=
      `Ready — ${nodes.length} donors, ${links.length} referrals.`;
  </script>
</body>
</html>
