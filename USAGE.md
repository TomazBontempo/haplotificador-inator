# Haplotificador-inator — Usage Guide

## Quick Start

### 1. Open a file
- Click **File → Open** in the toolbar
- Or drag a `.nex` or `.hapnet` file directly onto the canvas
- Supported formats:
  - `.nex` — Nexus file with biological sequence and trait data
  - `.hapnet` — saved Haplotificador project file

### 2. Run an algorithm
- Click **Algorithm** in the toolbar
- Select one of the four algorithms (see [Choosing an Algorithm](#choosing-an-algorithm))
- Set parameters if needed
- Click **OK** — the network renders automatically

### 3. Edit the network
- Drag nodes to reposition them
- Drag labels to move them independently from their node
- Use the **Visuals** panel on the right to customize colors and appearance

### 4. Export your figure
- Click **Export** in the toolbar
- Choose PNG, SVG, or PDF
- Set dimensions (3000×3000 or larger recommended for publications)
- Click Export — a file save dialog will open

---

## Choosing an Algorithm

| Algorithm | Best for | Parameters |
|-----------|----------|------------|
| **MSN** — Minimum Spanning Network | Simple datasets, quick overview | Epsilon (ε) — default 0 |
| **MJN** — Median-Joining Network | Most datasets, standard choice for publications | Epsilon (ε) — default 0 |
| **TCS** — Statistical Parsimony | Datasets where statistical parsimony is required | None |
| **IntNJ** — Integer Neighbour-Joining | Reticulate evolution, complex datasets | Alpha (α) — default 0.5 |

**When in doubt, use MJN.** It is the most widely used algorithm for haplotype
network construction and the default choice in PopART.

### Epsilon (ε) parameter — MSN and MJN
Controls the tolerance for including slightly suboptimal connections.
- `ε = 0` — only minimum spanning connections (recommended for most analyses)
- `ε > 0` — includes connections within ε extra mutations of the minimum

### Alpha (α) parameter — IntNJ
Controls the reticulation tolerance.
- `α = 0.5` — default, balances tree-like and reticulate structure
- Higher α — more reticulations added
- Lower α — fewer reticulations, more tree-like result

---

## Site Masking

When you open a `.nex` file, the app automatically checks for sites
(alignment columns) where more than 5% of sequences have undefined states.
These sites are masked before analysis.

If masking occurs, a warning dialog appears. Click **OK** to acknowledge
and proceed. The masked columns are shown in gray in the **Alignment** tab.

Sequences with high undefined states are **not removed** — this matches
PopART's default behavior.

---

## The Interface

### Toolbar
```
File | Algorithm | 💾 | 💾+ | Export | ↩ | ↪        👁 Labels | 👁 Legend | ?
```

| Button | Action |
|--------|--------|
| **File** | Open, Save, Save As |
| **Algorithm** | Select and run a network algorithm |
| **💾** | Save (Ctrl+S) |
| **💾+** | Save As (Ctrl+Shift+S) |
| **Export** | Export network as PNG, SVG, or PDF |
| **↩ ↪** | Undo / Redo |
| **👁 Labels** | Show or hide haplotype labels |
| **👁 Legend** | Show or hide the network legend |
| **?** | Open this help guide |

### Data Panel (left)
Shows biological data from the loaded `.nex` file.

**Traits tab:**
- Lists all traits (geographic regions, populations, etc.)
- Shows sequence count and sample count per trait
- Click **+** to expand a trait and see individual haplotypes

**Alignment tab:**
- Shows the raw DNA sequence alignment
- Haplotype names on the left (fixed, always visible)
- Sequences scroll horizontally
- Color coding: A=blue, T=yellow, G=red, C=green, masked=gray

### Network Viewport (center)
The main working area where the network is displayed.

### Visuals Panel (right)
Controls the visual appearance of the network.

| Section | Controls |
|---------|----------|
| **Font** | Label size slider (8–24px) |
| **Edges** | Color, width, mutation display (Numbers or Marks) |
| **Inferred nodes** | Color for median vectors and intermediate nodes |
| **Traits** | Individual color picker per trait |

---

## Navigating the Network

| Action | How |
|--------|-----|
| Pan | Space + drag, or middle mouse button drag |
| Zoom in/out | Ctrl + scroll wheel |
| Zoom in/out | Ctrl+Plus / Ctrl+Minus |
| Fit to screen | Ctrl+0, or click the ⊡ button |
| Select node | Click |
| Select edge | Click |
| Add to selection | Shift + click |
| Select multiple | Click and drag on empty area (rubber band) |
| Deselect all | Click on empty area, or press Escape |

---

## Editing the Network

### Moving nodes
- Click and drag any node to reposition it
- To move multiple nodes: select them first, then drag any selected node
- All selected nodes move together maintaining their relative positions

### Moving labels
- Click and drag any haplotype label independently from its node
- The label maintains its offset when the node is moved
- Labels can be placed anywhere around the node

### Moving the legend
- Click and drag the legend to reposition it anywhere on the canvas

### Undo and Redo
- **Ctrl+Z** — undo last action
- **Ctrl+Shift+Z** or **Ctrl+Y** — redo
- 20 steps of history per session
- History is cleared when the page is refreshed

### What can be undone
- Node drag
- Label drag
- Color changes
- Font size changes
- Edge display mode changes

---

## Customizing Colors

### Trait colors
Trait colors are auto-assigned when the network first renders, using
maximally distinct colors. To change a trait color:

1. Open the **Visuals** panel on the right
2. Scroll to the **Traits** section
3. Click the color swatch next to the trait name
4. Pick a new color — the network updates immediately

### Edge color and width
In the **Visuals** panel, **Edges** section:
- Click the color swatch to change edge color
- Drag the **Width** slider to change edge thickness

### Mutation display
In the **Visuals** panel, **Edges** section, **Mutations**:
- **Numbers** — shows the mutation count as a number above the edge
- **Marks** — shows tick marks on the edge, one per mutation

### Inferred node color
Inferred nodes (median vectors in MJN, intermediate nodes in TCS) are
displayed as small circles. Change their color in the **Visuals** panel,
**Inferred nodes** section.

---

## Saving Your Work

### Auto-save
The app automatically saves to browser storage (IndexedDB) every 5 minutes.
If the browser closes unexpectedly, your work is recovered on the next visit.

### Manual save (Ctrl+S)
- Before Save As: saves to browser storage only
- After Save As: saves to both browser storage and the `.hapnet` file on disk

### Save As (Ctrl+Shift+S)
Opens a file picker to save a `.hapnet` project file to your computer.
Once saved, future Ctrl+S updates that file automatically.

The `.hapnet` file contains:
- Full network topology and edge weights
- Node positions (including manual repositioning)
- Label positions
- Trait colors and visual settings
- Zoom and pan state

### Sharing with colleagues
Save As a `.hapnet` file and send it to a colleague. They can open it
in Haplotificador-inator and see the network exactly as you left it —
same positions, same colors, same layout.

### Session restore
When you open the app and a previous session exists in browser storage,
a dialog asks if you want to restore it or start fresh.

---

## Exporting Figures

1. Click **Export** in the toolbar
2. Choose format:
   - **SVG** — vector format, infinitely scalable, best for editing in Illustrator or Inkscape
   - **PNG** — raster format, best for presentations and documents
   - **PDF** — best for direct inclusion in manuscripts
3. Set width and height in pixels
   - Minimum **3000×3000** recommended for publication figures
   - Higher resolution = sharper print quality
4. Check **Transparent background** if you want to place the figure
   over a colored background in your document
5. Click Export — a save dialog opens

The full network is always exported regardless of current zoom or pan level.

---

## Opening a Saved Project

### From browser storage (session restore)
Automatically offered on startup if a previous session exists.

### From a .hapnet file
- Click **File → Open**
- Select the `.hapnet` file
- The network restores exactly as saved

If you have unsaved changes when opening a new file, a dialog asks
whether to save, discard, or cancel.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+Y | Redo (Windows) |
| Ctrl+0 | Fit network to screen |
| Ctrl++ | Zoom in |
| Ctrl+- | Zoom out |
| Space + drag | Pan canvas |
| Escape | Deselect all / close menus |

---

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome | ✅ Full support — recommended |
| Edge | ✅ Full support |
| Firefox | ⚠️ Save As downloads to Downloads folder |
| Safari | ⚠️ Not tested |

---

## Touchpad Navigation on Windows

If two-finger horizontal swipe navigates back/forward in your browser
instead of panning the network, use one of these solutions:

**Option 1 — Use the pan mode button:**
Click the ✋ button in the toolbar (or press P) to activate pan mode.
Click and drag anywhere on the canvas to pan.

**Option 2 — Disable swipe navigation in your browser:**

Firefox:
1. Type `about:config` in the address bar
2. Search for `browser.gesture.swipe.left` and reset it
3. Search for `browser.gesture.swipe.right` and reset it

Microsoft Edge:
1. Go to Settings → Accessibility
2. Find "Swipe between pages" and turn it Off

**Option 3 — Use Space + drag:**
Hold the Space bar and drag with the left mouse button to pan.

---

## Citing This Tool

If you use Haplotificador-inator in a publication, please cite both:

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
