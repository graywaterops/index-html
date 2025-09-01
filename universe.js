// ----- Colors -----
const COLOR = {
  ROOT: '#1f4aa8',
  PRIMARY: '#7cc3ff',
  EXTRA: '#2ecc71',
  DOWN: '#e74c3c',
  HILITE: '#ffffff'
};

// ----- Generate data -----
function genUniverse({ roots = 60, maxPrimary = 1, extraMin = 0, extraMax = 3, depth = 3, redBranch = [1,2,3] } = {}) {
  const nodes = [];
  const links = [];
  let id = 0;

  const addNode = (type, parentId = null) => {
    const node = { id: id++, type, color: COLOR[type.toUpperCase()] || COLOR.DOWN, label: `${type.toUpperCase()} #${id}` };
    nodes.push(node);
    if (parentId !== null) links.push({ source: parentId, target: node.id });
    return node.id;
  };

  const greenStarts = [];
  for (let r = 0; r < roots; r++) {
    const rootId = addNode('root');
    for (let k = 0; k < maxPrimary; k++) addNode('primary', rootId);
    const extras = extraMin + Math.floor(Math.random() * (extraMax - extraMin + 1));
    for (let e = 0; e < extras; e++) greenStarts.push(addNode('extra', rootId));
  }

  function growRed(parentId, lvl) {
    if (lvl <= 0) return;
    const children = redBranch[Math.floor(Math.random() * redBranch.length)];
    for (let i = 0; i < children; i++) {
      const childId = addNode('down', parentId);
      growRed(childId, lvl - 1);
    }
  }
  greenStarts.forEach(gid => growRed(gid, depth));
  return { nodes, links };
}

// ----- Build graph -----
const container = document.getElementById('graph');
let Graph, lastCam;
let highlightNodes = new Set();
let highlightLinks = new Set();
let adjacency = new Map();

function buildAdjacency(data) {
  adjacency.clear();
  data.nodes.forEach(n => adjacency.set(n.id, []));
  data.links.forEach(l => {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    adjacency.get(src).push(tgt);
  });
}

function setHighlight(node) {
  highlightNodes.clear();
  highlightLinks.clear();
  const visit = (id) => {
    if (highlightNodes.has(id)) return;
    highlightNodes.add(id);
    (adjacency.get(id) || []).forEach(child => {
      highlightLinks.add(`${id}-${child}`);
      visit(child);
    });
  };
  visit(node.id);
  Graph.refresh();
}

function initGraph(preset = 'dense') {
  const presets = {
    dense:  { roots: 85,  extraMax: 4, depth: 3, redBranch: [2,3,4] },
    medium: { roots: 60,  extraMax: 3, depth: 3, redBranch: [1,2,3] },
    sparse: { roots: 40,  extraMax: 2, depth: 2, redBranch: [1,2] }
  };
  const data = genUniverse(presets[preset]);
  buildAdjacency(data);

  if (!Graph) {
    Graph = ForceGraph3D()(container)
      .backgroundColor('#000')
      .showNavInfo(false)
      .nodeColor(n => highlightNodes.size === 0 ? n.color : (highlightNodes.has(n.id) ? COLOR.HILITE : n.color))
      .nodeVal(n => n.type === 'root' ? 8 : n.type === 'primary' ? 4 : n.type === 'extra' ? 3.5 : 2.5)
      .linkColor(l => {
        const key = `${l.source.id || l.source}-${l.target.id || l.target}`;
        return highlightLinks.size === 0 ? 'rgba(180,200,255,0.35)' : (highlightLinks.has(key) ? '#ffffff' : 'rgba(100,100,100,0.1)');
      })
      .linkWidth(l => {
        const key = `${l.source.id || l.source}-${l.target.id || l.target}`;
        return highlightLinks.has(key) ? 1.5 : 0.2;
      })
      .onNodeClick(node => {
        focusNode(node);
        setHighlight(node);
      });
  }

  Graph.graphData(data);
  queueMicrotask(() => {
    const cam = Graph.camera();
    lastCam = { x: cam.position.x, y: cam.position.y, z: cam.position.z, lookAt: Graph.controls().target.clone() };
  });
}

function focusNode(node) {
  const distance = 140;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
  const newPos = { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio };
  Graph.cameraPosition(newPos, node, 1000);
}

// Boot
initGraph('dense');
