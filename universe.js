(() => {
  const container = document.getElementById("graph");
  const statusEl = document.getElementById("status");
  const slider = document.getElementById("nodeSize");

  let Graph, nodes = [], links = [], adj = new Map();
  let baseNodeSize = parseInt(slider.value);

  slider.addEventListener("input", () => {
    baseNodeSize = parseInt(slider.value);
    Graph.nodeVal(n => nodeSize(n));
    Graph.refresh();
  });

  function nodeSize(n) {
    return baseNodeSize * (n.type === "root" ? 1.8 :
           n.type === "primary" ? 1.4 :
           n.type === "extra" ? 1.2 :
           n.type === "down" ? 1.0 : 1);
  }

  // --- Generate universe from your percentages ---
  function genUniverse(total=1000) {
    nodes=[]; links=[]; adj.clear();
    let id=0;

    const addNode=(type,parentId=null)=>{
      const node={id:id++,type,highlight:null};
      nodes.push(node);
      if(parentId!==null){
        links.push({source:parentId,target:node.id,highlight:null});
        if(!adj.has(parentId)) adj.set(parentId,[]);
        adj.get(parentId).push(node.id);
      }
      return node.id;
    };

    // distribution targets
    const dist = [
      { pct:0.30, build:root=>{} }, // root only
      { pct:0.36, build:root=>{
          addNode("primary",root);
        }},
      { pct:0.22, build:root=>{
          const p=addNode("primary",root);
          addNode("extra",p);
        }},
      { pct:0.09, build:root=>{
          const p=addNode("primary",root);
          for(let i=0;i<2;i++) addNode("down",p);
        }},
      { pct:0.026, build:root=>{
          const p=addNode("primary",root);
          for(let i=0;i<3;i++) addNode("down",p);
        }},
      { pct:0.004, build:root=>{
          const p=addNode("primary",root);
          for(let i=0;i<4;i++) addNode("down",p);
        }},
    ];

    // expand total donors based on percentages
    dist.forEach(d=>{
      const count=Math.round(total*d.pct);
      for(let i=0;i<count;i++){
        const root=addNode("root");
        d.build(root);
      }
    });

    return {nodes,links};
  }

  // --- Highlight logic ---
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
        if(l.source.id===id || l.source===id){
          l.highlight="forward";
          visitDown(l.target.id ?? l.target);
        }
      });
    }

    function visitUp(id){
      links.forEach(l=>{
        if(l.target.id===id || l.target===id){
          l.highlight="back";
          const parent=nodes.find(nn=>nn.id===(l.source.id ?? l.source));
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

  // --- Draw graph ---
  function draw(data){
    Graph=ForceGraph3D()(container)
      .backgroundColor("#000")
      .graphData(data)
      .nodeVal(n=>nodeSize(n))
      .nodeColor(n=>{
        if(n.highlight==="selected") return "#fff";
        if(n.highlight==="forward") return "#00ff88";
        if(n.highlight==="back") return "#ffdd33";
        if(n.type==="root") return "#1f4aa8";
        if(n.type==="primary") return "#7cc3ff";
        if(n.type==="extra") return "#2ecc71";
        if(n.type==="down") return "#e74c3c";
        return "#888";
      })
      .linkColor(l=>{
        if(l.highlight==="forward") return "#00ff88";
        if(l.highlight==="back") return "#ffdd33";
        return "rgba(180,180,180,0.2)";
      })
      .linkWidth(l=>(l.highlight?2:0.5))
      .onNodeClick(node=>highlightPath(node))
      .d3Force("charge", d3.forceManyBody().strength(-40))
      .d3Force("link", d3.forceLink().distance(50).strength(0.5))
      .d3Force("center", d3.forceCenter());

    statusEl.textContent=`Ready — ${nodes.length} donors, ${links.length} referrals. Click a node.`;
  }

  // --- Run ---
  const data=genUniverse(1000);
  draw(data);
})();
