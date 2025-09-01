// ----- Colors (match legend) -----
const COLOR = {
  ROOT: '#1f4aa8',       // dark blue
  PRIMARY: '#7cc3ff',    // light blue
  EXTRA: '#2ecc71',      // green
  DOWN: '#e74c3c'        // red (downstream of any green)
};

// ----- Generate data resembling your screenshot -----
function genUniverse({ roots = 60, maxPrimary = 1, extraMin = 0, extraMax = 3, depth = 3, redBranch = [1,2,3] } = {}) {
  // nodes: {id, type, color, label}
  // links: {source, target}
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

  // Build roots with their first generation (primary + green extras)
  const greenStarts = []; // store ids of "extra" nodes; downstream of these become red
  const rootsArr = [];

  for (let r = 0; r < roots; r++) {
    const rootId = addNode('root');
    rootsArr.push(rootId);

    // primary (max 1 per parent)
    for (let k = 0; k < maxPrimary; k++) {
      addNode('primary', rootId);
    }

    // extras from same parent (0..N)
    const extras = extraMin + Math.floor(Math.random() * (extraMax - extraMin + 1));
    for (let e = 0; e < extras; e++) {
      const extraId = addNode('extra', rootId);
      greenStarts.push(extraId);
    }
  }

  // For each green start, grow a small red subtree to simulate the bloom
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

// ----- Build/refresh graph -----
const container = document.getElementById('graph');
const statusEl = document.getElementById('status');
const helpEl = document.getElementById('help');
const presetSel = document.getElementById('preset');
const btnReset = document.getElementById('btnReset');
const btnHelp = document.getElementById('btnHelp');
const btnCloseHelp = document.getElementById('btnCloseHelp');

let Graph; // instance
let lastCam; // store initial camera pos

function initGraph(preset = 'dense') {
  // pick a preset
  const presets = {
    dense:  { roots: 85,  extraMax: 4, depth: 3, redBranch: [2,3,4] },
    medium: { roots: 60,  extraMax: 3, depth: 3, redBranch: [1,2,3] },
    sparse: { roots: 40,  extraMax: 2, depth: 2, redBranch: [1,2] }
  };
  const data = genUniverse(presets[preset]);

  // Create/replace instance
  if (!Graph) {
    Graph = ForceGraph3D()(container)
      .backgroundColor('#000000')
      .showNavInfo(false)
      .nodeColor(n => n.color)
      .nodeVal(n => n.type === 'root' ? 8 : n.type === 'primary' ? 4 : n.type === 'extra' ? 3.5 : 2.5)
      .nodeOpacity(0.95)
      .linkColor(() => 'rgba(180, 200, 255, 0.35)')
      .linkOpacity(0.28)
      .linkWidth(0.2)
      .warmupTicks(60)
      .cooldownTicks(120)
      .onNodeClick(node => focusNode(node));
  }

  Graph.graphData(data);

  // Capture the initial camera transform for "Reset view"
  queueMicrotask(() => {
    const cam = Graph.camera();
    lastCam = {
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z,
      lookAt: Graph.controls().target.clone()
    };
  });

  statusEl.textContent = `Status: ${data.nodes.length.toLocaleString()} nodes, ${data.links.length.toLocaleString()} links — click a node to explore. H=help`;
}

function focusNode(node) {
  const distance = 140;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
  const newPos = { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio };
  Graph.cameraPosition(newPos, node, 1000);
}

// ----- UI wiring -----
presetSel.addEventListener('change', e => initGraph(e.target.value));
btnReset.addEventListener('click', () => {
  if (!lastCam) return;
  Graph.cameraPosition({ x: lastCam.x, y: lastCam.y, z: lastCam.z }, lastCam.lookAt, 800);
});
btnHelp.addEventListener('click', () => helpEl.style.display = 'flex');
btnCloseHelp.addEventListener('click', () => helpEl.style.display = 'none');
window.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() === 'h') helpEl.style.display = (helpEl.style.display === 'flex' ? 'none' : 'flex');
});

// Handle resizing
addEventListener('resize', () => {
  Graph && Graph.width(innerWidth).height(innerHeight);
});

// Boot
initGraph('dense');
