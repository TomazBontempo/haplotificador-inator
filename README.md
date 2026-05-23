# 🤖 Haplotificador-inator™

> Browser-based port of [PopART](http://popart.otago.ac.nz) — Population Analysis with Reticulate Trees.  
> Because no mad scientist should lose time waiting for a desktop app to load.

**Live app:** [haplotificador-inator.vercel.app](https://haplotificador-inator.vercel.app)

---

## About

Haplotificador-inator is a browser-based port of PopART's core functionality,
implementing the four main haplotype network algorithms with interactive
visualization and export capabilities. It runs entirely client-side — no server,
no installation, no data upload.

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

See [USAGE.md](USAGE.md) for the full usage guide.

### Quick Start
1. Open a `.nex` file via **File → Open** or drag it onto the canvas
2. Click **Algorithm**, select an algorithm and parameters, click **OK**
3. Edit the network by dragging nodes and labels
4. Export via the **Export** button

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome | ✅ Full support — recommended |
| Edge | ✅ Full support |
| Firefox | ⚠️ Save As downloads to Downloads folder (no persistent file handle) |
| Safari | ⚠️ Not tested |

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

This project is a browser-based port of **PopART (Population Analysis with Reticulate Trees)**,
developed by Jessica Leigh and colleagues at the University of Otago, New Zealand,
as part of the Allan Wilson Centre Imaging Evolution Initiative.

**Please cite both this tool and the original PopART software:**

**This tool:**
> Bontempo, T. (2025). Haplotificador-inator: A browser-based web port of
> PopART for haplotype network construction. Trabalho de Conclusão de Curso,
> Universidade Veiga de Almeida (UVA), Rio de Janeiro, Brazil.
> https://haplotificador-inator.vercel.app

**The original PopART software:**
> Leigh JW, Bryant D (2015). PopART: Full-feature software for haplotype
> network construction. Methods Ecol Evol 6(9):1110–1116.
> https://doi.org/10.1111/2041-210X.12410

**Algorithm-specific citations:**

If you used MSN or MJN:
> Bandelt H, Forster P, Röhl A (1999). Median-joining networks for
> inferring intraspecific phylogenies. Mol Biol Evol 16(1):37–48.
> https://doi.org/10.1093/oxfordjournals.molbev.a026036

If you used TCS:
> Clement M, Snell Q, Walke P, Posada D, Crandall K (2002). TCS:
> estimating gene genealogies. Proc 16th Int Parallel Distrib Process
> Symp 2:184.

If you used IntNJ:
> Leigh JW, Bryant D (2015). PopART: Full-feature software for haplotype
> network construction. Methods Ecol Evol 6(9):1110–1116.
> https://doi.org/10.1111/2041-210X.12410

**PopART source code:** https://github.com/jessicawleigh/popart-current  
**PopART license:** Lesser GNU Public License (LGPL)

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
