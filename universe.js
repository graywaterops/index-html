<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Smart Coin® Donor Universe</title>
  <script src="https://unpkg.com/3d-force-graph"></script>
  <style>
    body { margin:0; background:#000; color:#fff; font-family:Arial, sans-serif; }
    #graph { width:100%; height:100vh; }
    .hud {
      position: fixed; z-index: 10; pointer-events:none; user-select:none;
      font-size:14px; line-height:1.35;
    }
    .legend {
      top:12px; right:12px; background:rgba(0,0,0,.7);
      padding:10px; border-radius:6px; pointer-events:auto;
    }
    .legend .dot { display:inline-block; width:12px; height:12px; border-radius:50%; margin-right:6px; }
    #status {
      bottom:12px; left:12px; background:rgba(0,0,0,.7);
      padding:8px 10px; border-radius:6px;
    }
  </style>
</head>
<body>
  <div id="graph"></div>
  <div id="status">Loading…</div>
  <div class="hud legend">
    <div><span class="dot" style="background:#1f4aa8"></span>Root (no referrals)</div>
    <div><span class="dot" style="background:#7cc3ff"></span>Primary</div>
    <div><span class="dot" style="background:#2ecc71"></span>Extra</div>
    <div><span class="dot" style="background:#e74c3c"></span>Downline</div>
    <div><span class="dot" style="background:#00ff88"></span>Forward path</div>
    <div><span class="dot" style="background:#ffdd33"></span>Backtrace</div>
    <div><span class="dot" style="background:#ffffff"></span>Selected</div>
  </div>

  <script>
    // --- Settings ---
    const SEED_DONORS = 250;
    const TOTAL_DONORS = 1000;
    const DONATION_AMOUNTS = [50, 100, 250, 500, 1000, 5000];
    const DONATION_PROBS = [0.7, 0.2, 0.05, 0.04, 0.006, 0.004]; // must sum ~1

    let Graph, nodes=[], links=[], selectedNode=null;

    // Pick random donation based on probabilities
    function randomDonation() {
      let r=Math.random(), cum=0;
      for (let i=0; i<DONATION_AMOUNTS.length; i++) {
        cum+=DONATION_PROBS[i];
        if (r<=cum) return DONATION_AMOUNTS[i];
      }
      return 50;
    }

    // Generate donors
    function generateUniverse() {
      let id=0;
      function addNode(type,parentId=null) {
        const node={ id:id++, type, donation:randomDonation(), highlight:null };
        nodes.push(node);
        if (parentId!==null) links.push({source:parentId, target:node.id, highlight:null});
        return node.id;
      }

      for (let s=0;s<SEED_DONORS;s++) {
        const root=addNode("root");
        const primary=addNode("primary",root);

        // Example: ~30% stop at primary, ~70% spawn extras
        if (Math.random()<0.7) {
          const extras=1+Math.floor(Math.random()*3);
          for (let e=0;e<extras;e++) {
            const extra=addNode("extra",primary);
            if (Math.random()<0.5) addNode("down",extra);
          }
        }
      }
    }

    // --- Highlight logic ---
    function clearHighlights() {
      nodes.forEach(n=>n.highlight=null);
      links.forEach(l=>l.highlight=null);
    }

    function highlightPath(node) {
      clearHighlights();
      node.highlight="selected";

      let forwardTotal=node.donation, forwardDonors=1;

      // forward
      function dfsDown(id) {
        links.forEach(l=>{
          if (l.source.id===id) {
            const child=nodes.find(nn=>nn.id===l.target.id);
            if(child && child.highlight!=="forward"){
              child.highlight="forward";
              l.highlight="forward";
              forwardTotal+=child.donation;
              forwardDonors++;
              dfsDown(child.id);
            }
          }
        });
      }
      dfsDown(node.id);

      // back
      function dfsUp(id) {
        links.forEach(l=>{
          if (l.target.id===id) {
            l.highlight="back";
            const parent=nodes.find(nn=>nn.id===l.source.id);
            if (parent && parent.highlight!=="back") {
              parent.highlight="back";
              dfsUp(parent.id);
            }
          }
        });
      }
      dfsUp(node.id);

      // show status with totals
      document.getElementById("status").textContent=
        `Selected donor #${node.id} → Chain donors: ${forwardDonors}, Total $ raised: $${forwardTotal.toLocaleString()}`;

      Graph.graphData({nodes,links});
    }

    // --- Build graph ---
    generateUniverse();

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
        return "#666";
      })
      .nodeVal(n=>n.type==="root"?10:n.type==="primary"?8:n.type==="extra"?6:5)
      .linkColor(l=>{
        if(l.highlight==="forward") return "#00ff88";
        if(l.highlight==="back") return "#ffdd33";
        return "rgba(255,255,255,0.1)";
      })
      .linkWidth(l=>(l.highlight?2:0.3))
      .onNodeClick(node=>{
        selectedNode=node;
        highlightPath(node);
      });

    // ESC to clear
    window.addEventListener("keydown",ev=>{
      if(ev.key==="Escape"){
        clearHighlights();
        document.getElementById("status").textContent=
          `Ready — ${nodes.length} donors, ${links.length} referrals.`;
        Graph.graphData({nodes,links});
        selectedNode=null;
      }
    });

    // Set ready message
    document.getElementById("status").textContent=
      `Ready — ${nodes.length} donors, ${links.length} referrals.`;
  </script>
</body>
</html>
