// ----- Colors -----
const COLOR = {
  ROOT: '#1f4aa8',
  PRIMARY: '#7cc3ff',
  EXTRA: '#2ecc71',
  DOWN: '#e74c3c',
  HILITE: '#ffff00'
};

// ----- Globals -----
const container = document.getElementById('graph');
let Graph;

// Published CSV URL for your Outputs tab
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT0a-Sj6bK2mE4dljf4xHEoD789frMSUsEWINmW-PhuXvm71e6wlq7hjgm892QE-EWqgmTWix-SNmJf/pub?gid=665678863&single=true&output=csv";

// ----- Load data from Google Sheet -----
Papa.parse(SHEET_URL, {
  download: true,
  complete: results => {
    const rows = results.data.filter(row => row.some(cell => cell !== ''));

    // Hard-code Column C (zero-indexed, so [2])
    const values = rows.map(row => parseFloat(row[2])).filter(v => !isNaN(v));

    if (!values.length) {
      console.error("No numeric values found in column C");
      console.log("First few rows:", rows.slice(0,5));
      return;
    }

    // Build nodes & links
    const nodes = values.map((val, i) => ({
      id: i,
      val: Math.sqrt(val) * 2,
      label: `Gen ${i}: ${val.toFixed(2)} donors`
    }));

    const links = values.slice(1).map((val, i) => ({
      source: i,
      target: i + 1
    }));

    // Render ForceGraph3D
    Graph = ForceGraph3D()(container)
      .backgroundColor('#000')
      .graphData({ nodes, links })
      .nodeLabel('label')
      .nodeAutoColorBy('id')
      .nodeVal(n => n.val)
      .linkWidth(1.2)
      .linkOpacity(0.6);
  }
});
