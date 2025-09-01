// ----- Colors (match legend) -----
const COLOR = {
  ROOT: '#1f4aa8',       // dark blue
  PRIMARY: '#7cc3ff',    // light blue
  EXTRA: '#2ecc71',      // green
  DOWN: '#e74c3c',       // red (downstream of any green)
  HILITE: '#ffffff'      // bright white for emphasis
};

// Tune these if you want bolder links overall
const BASE_LINK_OPACITY = 0.45; // was ~0.28
const BASE_LINK_WIDTH   = 0.7;  // was ~0.2

// Dim non-neighbor nodes/links when highlighting
const DIM_NODE_OPACITY  = 0.15;
const DIM_LINK_OPACITY  = 0.08;

// ----- Generate data resembling your screenshot -----
function genUniverse({ roots = 60, maxPrimary = 1, extraMin = 0, extraMax = 3, depth = 3, redBranch = [1,2,3] } = {}) {
  const nodes = [];
  const links = [];
  let id = 0;

  const addNode = (type, parentId = null) => {
    const node = {
      id: id++,
      type,
      color:
        type === 'root' ? COLOR.ROOT :
        type === 'primary' ? COLOR.PRIMARY :
        type === 'extra' ? COLOR.EXTRA :
        COLOR.DOWN,
      label: `${type.toUpperCase()} #${id}`
    };
    nodes.push(node);
    if (parentId !== null) links.push({ source: parentId, target: node.id });
    return node.id;
  };

  const greenStarts = [];
  for (let r = 0; r < roots; r++) {
    const rootId = addNode('root');

    // primary (max 1 per parent)
    for (let k = 0; k < maxPrimary; k++) addNode('primary', rootId);

    // extras (0..N)
    const extras = extraMin + Math.floor(Math.random() * (extraMax - extraMin + 1));
    for (let e = 0; e < extras; e++) greenStarts.push(addNode('extra', rootId));
  }

  // Grow small red subtrees from each green
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
const statusEl  = document.getElementById('status');
const helpEl    = document.getElementById('help');
const presetSel = document.getElementById('preset');
const btnReset  = document.getElementById('btnReset');
const btnHelp   = document.getElementById('btnHelp');
const btnCloseHelp = document.getElementById('btnCloseHelp');

let Graph;           // FG instance
let lastCam;         // camera reset snapshot
let linkBoost = 1.0; // for L toggle

// Highlight state
let highlightedNode = null;
const highlightNodes = new Set();
const highlightLinks = new Set();
const nodeNeighbors  = new Map(); // id -> Set(neighbor ids)

// Precompute adjacency for fast highlighting
function buildAdjacency(data) {
  nodeNeighbors.clear();
  data.nodes.forEach(n => nodeNeighbors.set(n.id, new Set()));
  data.links.forEach(l => {
    const a = typeof l.source === 'object' ? l.source.id : l.source;
    const b = typeof l.target === 'object' ? l.target.id : l.target;
    nodeNeighbors.get(a).add(b);
    nodeNeighbors.get(b).add(a);
  });
}

function initGraph(preset = 'dense') {
  const presets = {
    dense:  { roots: 85,  extraMax: 4, depth: 3, redBranch: [2,3,4] },
    medium: { roots: 60,  extraMax: 3, depth: 3, redBranch: [1,2,3] },
    sparse: { roots: 40,  extraMax: 2, depth: 2, redBranch: [1,2] }
  };
  const data = genUniverse(presets[preset]);
  buildAdjacency(data);
  clearHighlight(); // reset

  if (!Graph) {
    Graph = ForceGraph3D()(container)
      .backgroundColor('#000000')
      .showNavInfo(false)
      .nodeLabel(n => `${n.label}\nType: ${n.type}`)
      .nodeColor(n => {
        // brighten the clicked node and its neighbors
        if (!highlightedNode) return n.color;
        return highlightNodes.has(n) ? COLOR.HILITE : n.color;
      })
      .nodeOpacity(n => {
        if (!highlightedNode) return 0.95;
        return highlightNodes.has(n) ? 1.0 : DIM_NODE_OPACITY;
      })
      .nodeVal(n => n.type === 'root' ? 8 : n.type === 'primary' ? 4 : n.type === 'extra' ? 3.5 : 2.8)
      .linkColor(l => {
        if (!highlightedNode) return `rgba(200,220,255,${BASE_LINK_OPACITY * linkBoost})`;
        return highlightLinks.has(l) ? COLOR.HILITE : `rgba(160,180,230,${DIM_LINK_OPACITY * linkBoost})`;
      })
      .linkOpacity(() => {
        // base opacity; when highlighted we control via color above
        return BASE_LINK_OPACITY * linkBoost;
      })
      .linkWidth(l => {
        if (!highlightedNode) return BASE_LINK_WIDTH * linkBoost;
        return highlightLinks.has(l) ? 2.0 * linkBoost : 0.4 * linkBoost;
      })
      .linkDirectionalParticles(l => (highlightedNode && highlightLinks.has(l) ? 4 : 0))
      .linkDirectionalParticleWidth(2.2)
      .linkDirectionalParticleSpeed(0.006)
      .warmupTicks(60)
      .cooldownTicks(120)
      .onNodeClick(node => {
        focusNode(node);
        setHighlight(node);
      });
  }

  Graph.graphData(data);

  // Snapshot camera for "Reset view"
  queueMicrotask(() => {
    const cam = Graph.camera();
    lastCam = {
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z,
      lookAt: Graph.controls().target.clone()
    };
  });

  statusEl.textContent = `Status: ${data.nodes.length.toLocaleString()} nodes, ${data.links.length.toLocaleString()} links — click a node to highlight its connections. H=help, Esc=clear, L=links`;
}

function focusNode(node) {
  const distance = 140;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
  const newPos = { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio };
  Graph.cameraPosition(newPos, node, 900);
}

function clearHighlight() {
  highlightedNode = null;
  highlightNodes.clear();
  highlightLinks.clear();
  Graph && Graph.refresh(); // re-run accessors
}

function setHighlight(node) {
  highlightedNode = node;
  highlightNodes.clear();
  highlightLinks.clear();

  // add the node itself
  highlightNodes.add(node);

  // add neighbors
  const nbrIds = nodeNeighbors.get(node.id) || new Set();
  Graph.graphData().nodes.forEach(n => {
    if (n.id === node.id || nbrIds.has(n.id)) highlightNodes.add(n);
  });

  // mark links connecting node <-> neighbors
  Graph.graphData().links.forEach(l => {
    const a = typeof l.source === 'object' ? l.source.id : l.source;
    const b = typeof l.target === 'object' ? l.target.id : l.target;
    if ((a === node.id && nbrIds.has(b)) || (b === node.id && nbrIds.has(a))) {
      highlightLinks.add(l);
    }
  });

  Graph.refresh(); // re-evaluate styles
}

// ----- UI wiring -----
presetSel.addEventListener('change', e => initGraph(e.target.value));
btnReset.addEventListener('click', () => {
  if (!lastCam) return;
  Graph.cameraPosition({ x: lastCam.x, y: lastCam.y, z: lastCam.z }, lastCam.lookAt, 800);
  clearHighlight();
});
btnHelp.addEventListener('click', () => helpEl.style.display = 'flex');
btnCloseHelp.addEventListener('click', () => helpEl.style.display = 'none');

window.addEventListener('keydown', (ev) => {
  const k = ev.key.toLowerCase();
  if (k === 'h') {
    helpEl.style.display = (helpEl.style.display === 'flex' ? 'none' : 'flex');
  } else if (k === 'escape') {
    clearHighlight();
  } else if (k === 'l') {
    // toggle link brightness quickly
    linkBoost = (linkBoost === 1.0 ? 1.6 : 1.0);
    Graph.refresh();
  }
});

// Handle resizing
addEventListener('resize', () => {
  Graph && Graph.width(innerWidth).height(innerHeight);
});

// Boot
initGraph('dense');
