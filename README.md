# 🤖 Haplotificador-inator™

> Web port of [PopART](http://popart.otago.ac.nz) — Population Analysis with Reticulate Trees.  
> Because no mad scientist should lose time waiting for a desktop app to load.

**Live app:** [haplotificador-inator.vercel.app](https://haplotificador-inator.vercel.app)

---

## About

Haplotificador-inator is a browser-based port of PopART, a desktop application for
haplotype network construction and population genetics analysis. It runs entirely
client-side — no server, no installation, no data upload.

This project was developed as a TCC (Trabalho de Conclusão de Curso) in Computer
Science at UVA (Universidade Veiga de Almeida), with the goal of making haplotype
network analysis accessible through any modern web browser.

---

## Features

- **Four network algorithms:** MSN, MJN, TCS, and IntNJ
- **Interactive network editing:** drag nodes, reposition labels, pan and zoom
- **Trait color customization:** auto-assigned distinct colors, fully editable
- **Visual controls:** font size, edge color and width, mutation display (numbers or marks)
- **Legend:** node size scale and trait color reference, draggable within the viewport
- **Export:** PNG, SVG, and PDF with optional transparent background
- **Project save/restore:** IndexedDB auto-save + `.hapnet` file export for sharing
- **Data viewer:** traits table and sequence alignment with masked site indicators
- **Drag and drop:** drag `.nex` or `.hapnet` files directly onto the canvas
- **Undo/redo:** 20-step history for node drag and visual changes
- **Dark theme:** designed for long research sessions

---

## Supported File Formats

| Format | Description |
|--------|-------------|
| `.nex` | Nexus file — biological input (sequences, traits, geotags) |
| `.hapnet` | Haplotificador project file — saved network state, shareable between researchers |

---

## Algorithms

| Algorithm | Description | Reference |
|-----------|-------------|-----------|
| **MSN** | Minimum Spanning Network | Excoffier & Smouse (1994) |
| **MJN** | Median-Joining Network | Bandelt, Forster & Röhl (1999) |
| **TCS** | Statistical Parsimony Network | Clement, Posada & Crandall (2000) |
| **IntNJ** | Integer Neighbour-Joining | Leigh & Bryant (2015) |

All four algorithms produce exact parity with PopART's output on tested datasets,
with one known exception: IntNJ on complex datasets may produce a different but
equally mathematically valid network due to LP solver degeneracy between HiGHS
(used here) and lp_solve (used by PopART). See [Known Issues](#known-issues).

---

## How to Use

### Opening a file
- Click **File → Open** or drag a `.nex` or `.hapnet` file onto the canvas
- Supported formats: `.nex` (Nexus biological data) and `.hapnet` (saved project)

### Running an algorithm
1. Open a `.nex` file
2. Click **Algorithm** in the toolbar
3. Select an algorithm and set parameters if needed
4. Click **OK** — the network renders automatically

### Editing the network
- **Drag nodes** to reposition them
- **Drag labels** to move them independently from their node
- **Drag the legend** to reposition it on the canvas
- **Ctrl+Z / Ctrl+Shift+Z** — undo and redo
- **Space + drag** or **middle mouse drag** — pan the canvas
- **Ctrl + scroll** — zoom in/out

### Saving your work
- **Ctrl+S** — save to browser storage (IndexedDB)
- **Ctrl+Shift+S** — save as `.hapnet` file to your computer
- Auto-save runs every 5 minutes in the background
- On next visit, the app offers to restore the previous session

### Exporting
1. Click **Export** in the toolbar
2. Choose format: PNG, SVG, or PDF
3. Set dimensions (minimum 3000×3000 recommended for publication figures)
4. Choose transparent background if needed
5. The full network is always exported regardless of current zoom level

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome | ✅ Full support |
| Edge | ✅ Full support |
| Firefox | ⚠️ Save As downloads to Downloads folder (no persistent file handle) |
| Safari | ⚠️ Not tested |

Auto-save to IndexedDB works in all browsers. Persistent Save As requires
Chrome or Edge.

---

## Development

### Requirements
- Node.js 18+
- npm

### Setup
```bash
git clone https://github.com/TomazBontempo/haplotificador-inator
cd haplotificador-inator
npm install
```

### Running locally
```bash
npm run dev
```
Open `http://localhost:5173` in Chrome.

> ⚠️ Do not open `index.html` directly from disk — ES modules require a server.

### Running tests
```bash
npm test
```

### Production build
```bash
npm run build
```
Output goes to `dist/` — ready for Vercel or any static host.

### Tech stack
- Vanilla JavaScript (no framework)
- Vite (bundler)
- HiGHS WebAssembly (LP solver for IntNJ)
- D3 Scale Chromatic (trait color palettes)
- jsPDF (PDF export)
- Jest (testing)

---

## Known Issues

**IntNJ complex dataset parity:**
On large datasets, IntNJ may produce a network that differs from PopART's output.
Both results are mathematically valid — the difference arises from LP solver
degeneracy (multiple equally optimal solutions exist, and HiGHS and lp_solve
choose different ones). Biological equivalence is pending validation.

**Firefox Save As:**
The File System Access API is not supported in Firefox. Save As downloads the
file to the Downloads folder without a persistent file handle. Future Ctrl+S
saves to IndexedDB only.

---

## Credits and Attribution

This project is a web port of **PopART (Population Analysis with Reticulate Trees)**,
developed by Jessica Leigh and colleagues at the University of Otago, New Zealand,
as part of the Allan Wilson Centre Imaging Evolution Initiative.

**Please cite PopART when using this tool in publications:**

> Leigh, J.W. & Bryant, D. (2015). PopART: Full-feature software for haplotype
> network construction. *Methods in Ecology and Evolution*, 6(9), 1110–1116.
> https://doi.org/10.1111/2041-210X.12410

**PopART source code:** https://github.com/jessicawleigh/popart-current  
**PopART license:** Lesser GNU Public License (LGPL)

**Additional algorithm references:**
- Bandelt, H.J., Forster, P. & Röhl, A. (1999). Median-joining networks for
  inferring intraspecific phylogenies. *Molecular Biology and Evolution*, 16(1), 37–48.
- Clement, M., Posada, D. & Crandall, K.A. (2000). TCS: a computer program to
  estimate gene genealogies. *Molecular Ecology*, 9(10), 1657–1659.
- Tunkelang, D. (1999). A Numerical Optimization Approach to General Graph Drawing.
  PhD thesis, Carnegie Mellon University.

---

## License

This project is released for academic use.  
Developed as a TCC at UVA — Universidade Veiga de Almeida.  
PopART components are subject to the Lesser GNU Public License (LGPL).

---

## Author

Developed by **Tomaz Bontempo**  
[BontempoWeb](https://bontempoweb.com)

*"Ah, Perry o Ornitorrinco! Vejo que você quer analisar redes de haplótipos...  
MAS AGORA VOCÊ CAIU NA ARMADILHA DO MEU HAPLOTIFICADOR-INATOR!"*
