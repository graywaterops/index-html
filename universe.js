// ----- Colors -----
const COLOR = {
  ROOT: '#1f4aa8',
  PRIMARY: '#7cc3ff',
  EXTRA: '#2ecc71',
  DOWN: '#e74c3c',
  HILITE: '#ffffff'
};

// Stronger links by default
const BASE_LINK_OPACITY = 0.55;
const BASE_LINK_WIDTH   = 1.2;

// Dim others when highlighting
const DIM_NODE_OPACITY  = 0.25;
const DIM_LINK_OPACITY  = 0.12;

// ------- Data generator (same as before) -------
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
    for (let k = 0; k < maxPrimary; k++) addNode('primary', rootId);

    const extras = extraMin + Math.floor(Math.random() * (extraMax - extraMin + 1));
    for (let e = 0; e < extras; e++) greenStarts.push(addNode('extra', rootId));
  }

  function growRed(parentId, lvl) {
    if (lvl <= 0) return;
    const children = redBranch[Math.floor(Math.random() * redBranch.length)];
    for (let i = 0; i < children; i++) {
      const id = addNode('down', parentId);
      growRed(id, lvl - 1);
    }
  }
  greenStarts.forEach(gid => growRed(gid, depth));

  return { nodes, links };
}

// ------- Graph setup -------
const container    = document.getElementById('graph');
const statusEl     = document.getElementById('status');
const helpEl       = document.getElementById('help');
const presetSel    = document.getElementById('preset');
const btnReset     = document.getElementById('btnReset');
const btnHelp      = document.getElementById('btnHelp');
const btnCloseHelp = document.getElementById('btnCloseHelp');

let Graph, lastCam, linkBoost = 1.0;

// highlight state
let highlightedNode = null;
const highlightNodes = new Set();
const highlightLinks = new Set();
const nodeNeighbors  = new Map();

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
  clearHighlight();

  if (!Graph) {
    Graph = ForceGraph3D()(container)
      .backgroundColor('#000')               // black canvas
      .showNavInfo(false)

      // ✅ BIG, OPAQUE NODES
      .nodeRelSize(6)                         // make nodes larger
      .nodeOpacity(() => 1)                   // fully opaque
      .nodeResolution(24)                     // smoother spheres

      // color + dim logic
      .nodeColor(n => {
        if (!highlightedNode) return n.color;
        return highlightNodes.has(n) ? COLOR.HILITE : n.color;
      })

      // keep values proportional even when big
      .nodeVal(n => n.type === 'root' ? 10 : n.type === 'primary' ? 6 : n.type === 'extra' ? 5 : 4)

      // links: brighter & thicker; super bright when selected
      .linkColor(l => {
        if (!highlightedNode) return `rgba(210,230,255,${BASE_LINK_OPACITY * linkBoost})`;
        return highlightLinks.has(l) ? COLOR.HILITE : `rgba(170,190,240,${DIM_LINK_OPACITY * linkBoost})`;
      })
      .linkOpacity(() => BASE_LINK_OPACITY * linkBoost)
      .linkWidth(l => (highlightedNode && highlightLinks.has(l) ? 2.4 : BASE_LINK_WIDTH) * linkBoost)
      .linkDirectionalParticles(l => (highlightedNode && highlightLinks.has(l) ? 4 : 0))
      .linkDirectionalParticleWidth(2.2)
      .linkDirectionalParticleSpeed(0.006)

      .warmupTicks(60)
      .cooldownTicks(120)

      .onNodeClick(node => { focusNode(node); setHighlight(node); });
  }

  Graph.graphData(data);

  queueMicrotask(() => {
    const cam = Graph.camera();
    lastCam = {
      x: cam.position.x, y: cam.position.y, z: cam.position.z,
      lookAt: Graph.controls().target.clone()
    };
  });

  statusEl.textContent =
    `Status: ${data.nodes.length.toLocaleString()} nodes, ${data.links.length.toLocaleString()} links — ` +
    `click a node to highlight its connections. H=help, Esc=clear, L=links`;
}

function focusNode(node) {
  const distance = 140;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
  Graph.cameraPosition(
    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
    node,
    900
  );
}

function clearHighlight() {
  highlightedNode = null;
  highlightNodes.clear();
  highlightLinks.clear();
  Graph && Graph.refresh();
}

function setHighlight(node) {
  highlightedNode = node;
  highlightNodes.clear();
  highlightLinks.clear();
  highlightNodes.add(node);

  const nbrIds = nodeNeighbors.get(node.id) || new Set();

  Graph.graphData().nodes.forEach(n => {
    if (n.id === node.id || nbrIds.has(n.id)) highlightNodes.add(n);
  });

  Graph.graphData().links.forEach(l => {
    const a = typeof l.source === 'object' ? l.source.id : l.source;
    const b = typeof l.target === 'object' ? l.target.id : l.target;
    if ((a === node.id && nbrIds.has(b)) || (b === node.id && nbrIds.has(a))) {
      highlightLinks.add(l);
    }
  });

  Graph.refresh();
}

// ----- UI -----
presetSel.addEventListener('change', e => initGraph(e.target.value));
btnReset.addEventListener('click', () => {
  if (lastCam) Graph.cameraPosition({ x: lastCam.x, y: lastCam.y, z: lastCam.z }, lastCam.lookAt, 800);
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
    linkBoost = (linkBoost === 1.0 ? 1.8 : 1.0);
    Graph.refresh();
  }
});

// resize
addEventListener('resize', () => Graph && Graph.width(innerWidth).height(innerHeight));

// boot
initGraph('dense');
