// ----- Colors -----
const COLOR = {
  ROOT: '#1f4aa8',
  PRIMARY: '#7cc3ff',
  EXTRA: '#2ecc71',
  DOWN: '#e74c3c',
  HILITE: '#ffff00'
};

// ----- Generate graph data -----
function genUniverse({ roots = 40, maxPrimary = 1, extraMin = 0, extraMax = 2, depth = 2, redBranch = [1,2] } = {}) {
  const nodes = [], links = [];
  let id = 0;

  const addNode = (type, parentId = null) => {
    // Generate a random 4-digit Coin ID (1000–9999)
    const coinId = (1000 + Math.floor(Math.random() * 9000)).toString();
    const node = { id: id++, type, coinId };
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

// ----- Globals -----
const container = document.getElementById('graph');
const statusEl = document.getElementById('status');
const helpEl = document.getElementById('help');
const presetSel = document.getElementById('preset');
const btnReset = document.getElementById('btnReset');
const btnHelp = document.getElementById('btnHelp');
const btnCloseHelp = document.getElementById('btnCloseHelp');

let Graph, lastCam;
let selectedNode = null;
let adjacency = new Map();
let highlightNodes = new Set();
let highlightLinks = new Set();

const getId = v => (typeof v === 'object' ? v.id : v);

// Build adjacency
function buildAdjacency(data) {
  adjacency.clear();
  data.nodes.forEach(n => adjacency.set(n.id, []));
  data.links.forEach(l => {
    const s = getId(l.source), t = getId(l.target);
    adjacency.get(s).push(t);
  });
}

// Count downstream donors
function getDownlineCount(nodeId) {
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    (adjacency.get(id) || []).forEach(visit);
  }
  visit(nodeId);
  return visited.size - 1;
}

// Highlight a node and its downline
function setHighlight(node) {
  highlightNodes.clear();
  highlightLinks.clear();
  if (!node) return;

  const visit = id => {
    if (highlightNodes.has(id)) return;
    highlightNodes.add(id);
    (adjacency.get(id) || []).forEach(child => {
      highlightLinks.add(`${id}-${child}`);
      visit(child);
    });
  };

  visit(node.id);
  selectedNode = node;
  Graph.refresh();
}

// ----- Build graph -----
function initGraph(preset = 'dense') {
  const presets = {
    dense:  { roots: 80, extraMax: 3, depth: 3, redBranch: [2,3] },
    medium: { roots: 40, extraMax: 2, depth: 2, redBranch: [1,2] },
    sparse: { roots: 20, extraMax: 1, depth: 1, redBranch: [1] }
  };
  const data = genUniverse(presets[preset]);
  buildAdjacency(data);

  if (!Graph) {
    Graph = ForceGraph3D()(container)
      .backgroundColor('#000')
      .showNavInfo(false)

      // Tooltip on hover
      .nodeLabel(n => {
        const downline = getDownlineCount(n.id);
        return `
          <div>
            <strong>${n.type.toUpperCase()}</strong> (ID ${n.id})<br/>
            Coin ID: ${n.coinId}<br/>
            Downline donors: ${downline}<br/>
            Contact: (not linked)
          </div>`;
      })

      // Node rendering
      .nodeColor(n => {
        if (selectedNode && n.id === selectedNode.id) return COLOR.HILITE;
        if (highlightNodes.size && !highlightNodes.has(n.id)) return '#444';
        return COLOR[n.type.toUpperCase()] || COLOR.DOWN;
      })
      .nodeVal(n => n.type === 'root' ? 10 : n.type === 'primary' ? 7 : n.type === 'extra' ? 6 : 5)

      // Links
      .linkColor(l => {
        if (!selectedNode) return 'rgba(180,200,255,0.35)';
        const s = getId(l.source), t = getId(l.target);
        return highlightLinks.has(`${s}-${t}`) ? COLOR.HILITE : 'rgba(80,80,80,0.1)';
      })
      .linkWidth(l => {
        if (!selectedNode) return 0.3;
        const s = getId(l.source), t = getId(l.target);
        return highlightLinks.has(`${s}-${t}`) ? 2 : 0.1;
      })

      .warmupTicks(200)
      .cooldownTicks(200)

      // Click to highlight
      .onNodeClick(node => setHighlight(node));
  }

  Graph.graphData(data);

  queueMicrotask(() => {
    const cam = Graph.camera();
    lastCam = { x: cam.position.x, y: cam.position.y, z: cam.position.z, lookAt: Graph.controls().target.clone() };
  });

  statusEl.textContent = `Status: ${data.nodes.length} nodes, ${data.links.length} links — hover to see Coin ID and downline. Click to highlight. Esc=clear`;
}

// ----- UI wiring -----
presetSel.addEventListener('change', e => initGraph(e.target.value));
btnReset.addEventListener('click', () => {
  if (!lastCam) return;
  Graph.cameraPosition({ x: lastCam.x, y: lastCam.y, z: lastCam.z }, lastCam.lookAt, 800);
  selectedNode = null;
  highlightNodes.clear();
  highlightLinks.clear();
  Graph.refresh();
});
btnHelp.addEventListener('click', () => helpEl.style.display = 'flex');
btnCloseHelp.addEventListener('click', () => helpEl.style.display = 'none');
window.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    selectedNode = null;
    highlightNodes.clear();
    highlightLinks.clear();
    Graph.refresh();
  }
});

addEventListener('resize', () => Graph && Graph.width(innerWidth).height(innerHeight));
initGraph('dense');
