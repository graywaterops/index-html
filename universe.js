// ----- Colors -----
const COLOR = {
  ROOT: '#1f4aa8',     // dark blue
  PRIMARY: '#7cc3ff',  // light blue
  EXTRA: '#2ecc71',    // green
  DOWN: '#e74c3c',     // red
  HILITE: '#ffff00'    // yellow highlight
};

// ----- Generate graph data -----
function genUniverse({ roots = 60, maxPrimary = 1, extraMin = 0, extraMax = 3, depth = 3, redBranch = [1,2,3] } = {}) {
  const nodes = [];
  const links = [];
  let id = 0;

  const addNode = (type, parentId = null) => {
    const node = { id: id++, type, color: COLOR[type.toUpperCase()] || COLOR.DOWN };
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

// ----- Build graph -----
function initGraph(preset = 'dense') {
  const presets = {
    dense:  { roots: 85, extraMax: 4, depth: 3, redBranch: [2,3,4] },
    medium: { roots: 60, extraMax: 3, depth: 3, redBranch: [1,2,3] },
    sparse: { roots: 40, extraMax: 2, depth: 2, redBranch: [1,2] }
  };
  const data = genUniverse(presets[preset]);

  if (!Graph) {
    Graph = ForceGraph3D()(container)
      .backgroundColor('#000')
      .showNavInfo(false)

      // Custom node rendering
      .nodeThreeObject(node => {
        if (selectedNode && node.id === selectedNode.id) {
          return new THREE.Mesh(
            new THREE.SphereGeometry(8),
            new THREE.MeshBasicMaterial({ color: COLOR.HILITE, wireframe: true })
          );
        }
        return new THREE.Mesh(
          new THREE.SphereGeometry(6),
          new THREE.MeshBasicMaterial({ color: node.color })
        );
      })

      // Highlight links
      .linkColor(l => {
        if (!selectedNode) return 'rgba(180,200,255,0.35)';
        return (l.source.id === selectedNode.id || l.target.id === selectedNode.id)
          ? COLOR.HILITE
          : 'rgba(100,100,100,0.1)';
      })
      .linkWidth(l => {
        if (!selectedNode) return 0.2;
        return (l.source.id === selectedNode.id || l.target.id === selectedNode.id) ? 2 : 0.1;
      })

      // Node sizing
      .nodeVal(n => n.type === 'root' ? 8 : n.type === 'primary' ? 5 : n.type === 'extra' ? 4 : 3)

      // Click to select
      .onNodeClick(node => {
        selectedNode = node;
        Graph.refresh(); // re-render with highlight
      });
  }

  Graph.graphData(data);

  queueMicrotask(() => {
    const cam = Graph.camera();
    lastCam = { x: cam.position.x, y: cam.position.y, z: cam.position.z, lookAt: Graph.controls().target.clone() };
  });

  statusEl.textContent = `Status: ${data.nodes.length.toLocaleString()} nodes, ${data.links.length.toLocaleString()} links — click a node to highlight. H=help, Esc=clear`;
}

// ----- UI wiring -----
presetSel.addEventListener('change', e => initGraph(e.target.value));
btnReset.addEventListener('click', () => {
  if (!lastCam) return;
  Graph.cameraPosition({ x: lastCam.x, y: lastCam.y, z: lastCam.z }, lastCam.lookAt, 800);
  selectedNode = null;
  Graph.refresh();
});
btnHelp.addEventListener('click', () => helpEl.style.display = 'flex');
btnCloseHelp.addEventListener('click', () => helpEl.style.display = 'none');
window.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() === 'h') helpEl.style.display = (helpEl.style.display === 'flex' ? 'none' : 'flex');
  if (ev.key === 'Escape') { selectedNode = null; Graph.refresh(); }
});

// Resize
addEventListener('resize', () => Graph && Graph.width(innerWidth).height(innerHeight));

// Boot
initGraph('dense');
