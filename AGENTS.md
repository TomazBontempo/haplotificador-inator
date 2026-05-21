## Project

Web port of PopART (Population Analysis with Reticulate Trees) from C++/Qt to JavaScript.
Goal: replicate all core functionality in the browser with no server required.
This project is part of a TCC (Trabalho de Conclusão de Curso) — see `docs/` for the full document and references.

## Repository structure

- `original/` — C++ source of the original PopART. Read-only reference. Never modify.
- `src/` — New JavaScript implementation. All new code goes here.
- `test/fixtures/` — Sample .nex input files paired with PopART's expected outputs.
- `test/parser/` — Tests for Nexus file parsing.
- `test/model/` — Tests for data condensation and core structures.
- `test/algorithms/` — Tests for all inference algorithms.
- `docs/` — Reference documents. See Documentation section below.

## Documentation

- `docs/TCC.pdf` — Project context, architecture decisions, and biological background.
- `docs/Bandelt1999.pdf` — Original mathematical definition of MJN and MSN algorithms.
  Consult before implementing MJN or MSN.
- `docs/Leigh_et_al-2015.pdf` — PopART paper describing all four algorithms.
  Consult before implementing any algorithm.
- `docs/popart.pdf` — Official PopART user manual. Contains exact Nexus block syntax
  with real examples. Consult before implementing the parser.
- `docs/Tunkelang1999.txt` — Tunkelang (1999) PhD thesis. Describes the exact
  force-directed layout algorithm used by PopART. Consult before implementing
  NetworkLayout.js. Key sections: 5.2 (Force Laws), 6.3 (Barnes-Hut), 7.3 (Conjugate Gradient).
- Always prefer these local docs over assumed knowledge.
- For Web APIs and JavaScript, search the web on demand — do not assume.

## Development tools

### Running npm on Windows

- Always use `npm.cmd` instead of `npm` to avoid PowerShell execution policy blocks.
- Example: `npm.cmd test` instead of `npm test`
- Example: `npm.cmd install` instead of `npm install`
- Never attempt `npm` first and fall back — go straight to `npm.cmd`.

### Running the browser app

- Development: `npm.cmd run dev`
  Opens at `http://localhost:5173`
- Production build: `npm.cmd run build`
  Produces `dist/` folder for Vercel deployment
- Preview production build: `npm.cmd run preview`
- Never open `index.html` directly from disk (`file://` breaks ES modules)

### Reading PDF documentation

- `docs/` contains PDF reference files.
- To read a PDF use:
  `node -e "require('pdf-parse')(require('fs').readFileSync('docs/file.pdf')).then(d => console.log(d.text))"`
- `pdf-parse` is installed as a dev dependency for this purpose.
- Never install Python PDF tools (pymupdf, pdfminer, pdfjs or similar).
- Never commit extracted text files.
- Never add PDF extraction tools to production dependencies.

## Porting rules

- Before implementing any module, read the corresponding C++ source in `original/popart-current/`.
- Preserve functional equivalence, not literal translation of syntax.
- Keep the same separation of concerns: parser → model → algorithms → layout → renderer → storage.
- The only input/export format is Nexus (.nex). Phylip is not in scope.

## Key constraints

- No server-side processing. Everything runs in the browser.
- Heavy computation (algorithms, layout) currently runs on the main thread.
  Web Worker integration is planned for Milestone 12.
- Nexus (.nex) is the standard import/export format. Internal state is stored in IndexedDB.
- The rendering layer must treat the network as a logical model first, visual projection second.

## Testing

Two types of automated tests are used in this project:

**Regression tests** — ensure that new features or changes don't break existing functionality.

- Run the full test suite after every non-trivial change.
- A passing suite means nothing previously working has broken.

**Parity tests** — ensure that algorithm outputs match PopART's known results exactly.

- Located in `test/algorithms/`.
- Each test feeds a fixture `.nex` file through the JS algorithm and compares the result
  against the corresponding expected output file in `test/fixtures/expected/`.
- An algorithm is only considered complete when its parity tests pass against both
  the simple tapir fixture and the complex dolphins fixture.

**What is NOT automatically tested:**

- Renderer, layout, UI, and storage — these are validated visually or manually by the developer.

**Rule for the agent:**
After implementing or modifying any module that has tests, always run the test suite
and confirm it passes before considering the task done.

## Validation

- Each fixture consists of a `.nex` input file and one or more expected output files
  in `test/fixtures/expected/` named `<dataset>_<algorithm>.txt`.
- These were exported directly from PopART and represent the ground truth.
- An algorithm is only considered complete when its parity tests pass against both
  the simple tapir fixture and the complex dolphins fixture.

## Algorithm parameters used for expected outputs

These parameters were used when generating the expected output files in
`test/fixtures/expected/`. The JS implementation must use these exact values
to pass parity tests. See `test/fixtures/notes.txt` for the original record.

- MSN: Epsilon (ε) = 0
- MJN: Epsilon (ε) = 0
- TCS: no parameters
- IntNJ: reticulation tolerance (α) = 0.5
- Complex fixtures: sites with >5% undefined states were masked by PopART automatically
- Complex fixtures: sequences with high undefined states were NOT removed

## Algorithms to implement (in order of priority)

1. MSN (Minimum Spanning Network) — simplest; also used as base for MJN
2. MJN (Median-Joining Network) — most important algorithm
3. TCS
4. IntNJ (requires linear programming solver — tackle last)

## Pipeline

The system follows a strict pipeline, mirroring the original PopART:
File input → parser → model → algorithms → layout → renderer → ui
↕
storage
↕
export

## Architecture divergences from C++

- In C++, MSN/MJN/TCS modify HapNet in place by adding vertices and edges directly.
- In this JS port, each algorithm receives HapNet as read-only input and returns an independent Graph object.
- HapNet is never modified by algorithms — it is pure data.
- The renderer receives the Graph object directly, not through HapNet.
- In C++, priority queues use std::priority_queue. In this JS port, use a sorted array instead — sort all pairs upfront by distance before processing.
- Site masking is handled by `src/model/SiteMask.js` via `applyUndefinedSiteMask(parsed)`.
- Sites with more than 5% undefined states are masked automatically before HapNet construction.
- This mirrors PopART's mandatory Window 1 behavior.
- Sequence removal (PopART's Window 2) is not implemented.
- The masked count must be returned so the UI can warn the user in Milestone 12.
- All algorithm parity tests using real fixture data must apply `applyUndefinedSiteMask`.
- The SiteMask check must be applied before constructing HapNet in all parity tests
  using real fixture data. Tapir tests that pass without masking must remain unmasked.
- Web Workers are not yet implemented. Algorithms and layout run on the main thread.
  Worker integration will be added in Milestone 12.

## Project file loading flows

These flows must be implemented in Milestone 12 (UI). They are documented here
so the agent understands the intended behavior before implementing.

### Opening a .nex file (new project):

1. Check if auto-save exists via `hasAutoSave()`
2. If yes → show warning: "Starting a new project will clear your current saves. Continue?"
   - If confirmed → call `clearAutoSave()` → load and parse .nex file
   - If cancelled → stay on current project
3. If no → load and parse .nex file directly, no dialog

### Opening a .hapnet file (load saved project):

1. If current project has unsaved changes → show warning:
   "You have unsaved changes. Save before continuing?"
   - Save → open Save/Save As dialog → then load .hapnet file
   - Don't Save → discard current state → load .hapnet file
   - Cancel → stay on current project
2. Load .hapnet file via `loadFromFile()`
3. Reconstruct Graph from saved state
4. Pass directly to renderer — skip parser, HapNet, and algorithm

### Save (Ctrl+S):

- If Save As has never been used → save to IndexedDB via `autoSave()`
- If Save As has been used → save to fileHandle via `saveToHandle()`

### Save As (Ctrl+Shift+S):

- Open file picker via `saveAs()`
- Store returned fileHandle for future Ctrl+S saves
- From this point, Ctrl+S saves to that file

## Storage behavior

- Auto-save: single IndexedDB slot, overwrites on every save
- Auto-save interval: default 5 minutes, configurable by user in Milestone 12
- Manual save: handled by Save As → writes `.hapnet` file to user-chosen location
- No multiple save slots — simplicity is preferred over complexity
- Firefox does not support the File System Access API — Save As is unavailable.
  Auto-save via IndexedDB still works in Firefox.

## Milestones

- [x] 01 - Project Setup
  - [x] Initialize project structure.
  - [x] Configure Jest as the test runner.
  - [x] Ensure the test suite runs successfully on an empty project.

- [x] 02 - Parser
  - [x] Implement NexusParser.js to read and interpret all Nexus blocks (Taxa, Characters, Data, Traits, GeoTags, Network).
  - [x] Add parser tests.
  - [x] Validate parser output against fixture files.

- [x] 03 - Model
  - [x] Implement HapNet.js including sequence condensation.
  - [x] Implement Graph.js, Vertex.js, and Edge.js.
  - [x] Add model tests.

- [x] 04 - MSN
  - [x] Implement the MSN algorithm in MSN.js.
  - [x] Add parity tests validating output against PopART's results.

- [x] 05 - MJN
  - [x] Implement the MJN algorithm in MJN.js building on MSN.
  - [x] Add parity tests validating output against PopART's results.

- [x] 06 - TCS
  - [x] Implement the TCS algorithm in TCS.js.
  - [x] Add parity tests validating output against PopART's results.

- [ ] 07 - IntNJ
  - [x] Research and select a JavaScript linear programming solver.
  - [x] Implement the IntNJ algorithm in IntNJ.js.
  - [x] Add parity tests validating output against PopART's results.
  - [ ] Resolve complex dolphins parity failure due to LP solver degeneracy.
        Awaiting biological validation from researchers (Julia and Mariana, MAQUA/UERJ).
        See open GitHub issue in Milestone 07.

- [x] 08 - Layout
  - [x] Implement force-directed spring layout in NetworkLayout.js.

- [x] 09 - Renderer
  - [x] Implement NetworkRenderer.js for SVG rendering.
  - [x] Implement VertexItem.js with proportional sizing and pie chart traits.
  - [x] Implement EdgeItem.js with mutation distance representation.

- [x] 10 - Storage
  - [x] Implement ProjectStorage.js using IndexedDB.
  - [x] Implement Save As using File System Access API.
  - [x] Ensure network topology, node positions, and visual state are persisted separately from the Nexus file.

- [x] 11 - Export
  - [x] Implement PNG export in Exporter.js.
  - [x] Implement SVG export in Exporter.js.
  - [x] Implement PDF export in Exporter.js.

- [ ] 12 - UI
  - [x] 12a - Core UI Scaffold
    - [x] Implement NetworkView.js connecting all modules.
    - [x] Implement Web Workers for algorithms and layout.
    - [x] Validate the full pipeline end-to-end with a real .nex file.

  - [x] 12b - File Management
    - [x] Implement project file loading flows (.nex and .hapnet) with correct warnings.
    - [x] Implement SiteMask warning when sites are masked on file load.
    - [x] Implement auto-save timer and configurable interval.
    - [x] Implement Save and Save As — keyboard shortcuts (Ctrl+S / Ctrl+Shift+S),
          toolbar icon, and File menu dropdown options.

  - [ ] 12c - Visual Controls
    - [ ] Implement controls for node manipulation, colors, fonts, and zoom.
    - [ ] Implement color customization for edges, vertices, and background with color picker.
    - [ ] Implement edge label / tick mark toggle.
    - [ ] Add export size recommendation warning for print quality
          (minimum 3000x3000 for publications).
    - [ ] Implement undo/redo history for node manipulation and visual changes
