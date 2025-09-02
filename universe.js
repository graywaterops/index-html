const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/pub?gid=665678863&single=true&output=csv";

let Graph;
let selectedNode = null;
let highlightNodes = new Set();
let highlightLinks = new Set();

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    selectedNode = null;
    highlightNodes.clear();
    highlightLinks.clear();
    Graph && Graph.refresh();
  }
});

Papa.parse(SHEET_URL, {
  download: true,
  complete: results => {
    const rows = results.data.filter(r => r.some(c => c !== ''));
    // Column C = index 2
    const values = rows.map(r => parseFloat(r[2])).filter(v => !isNaN(v));

    if (!values.length) {
      console.error("No numeric values found in column C");
      console.log("First few rows:", rows.slice(0, 5));
      return;
    }

    const nodes = values.map((val, i) => ({
      id: i,
      val: Math.sqrt(val) * 2,
      label: `Gen ${i}: ${val.toFixed(2)} donors`
    }));

    const links = values.slice(1).map((_, i) => ({
      source: i,
      target: i + 1
    }));

    Graph = ForceGraph3D()(document.getElementById('graph'))
      .backgroundColor('#000')
      .graphData({ nodes, links })
      .nodeLabel('label')
      .nodeAutoColorBy('id')
      .nodeVal(n => n.val)
      .linkWidth(l => highlightLinks.has(`${l.source}-${l.target}`) ? 3 : 1.2)
      .linkColor(l => highlightLinks.has(`${l.source}-${l.target}`) ? '#ffff00' : 'rgba(180,180,180,0.5)')
      .nodeOpacity(n => selectedNode ? (highlightNodes.has(n.id) ? 1 : 0.2) : 1)
      .onNodeClick(node => {
        selectedNode = node;
        highlightNodes.clear();
        highlightLinks.clear();
        highlightNodes.add(node.id);
        let cur = node.id;
        while (true) {
          const link = Graph.graphData().links.find(l => l.source === cur);
          if (!link) break;
          highlightLinks.add(`${link.source}-${link.target}`);
          highlightNodes.add(link.target);
          cur = link.target;
        }
        Graph.refresh();
      });
  }
});
