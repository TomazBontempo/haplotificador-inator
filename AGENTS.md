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
- Always prefer these local docs over assumed knowledge.
- For Web APIs and JavaScript, search the web on demand — do not assume.
- `docs/Tunkelang - A Numerical Optimization Approach to General Graph Drawing.txt` — Tunkelang (1999) PhD thesis. Describes the exact
  force-directed layout algorithm used by PopART. Consult before implementing
  NetworkLayout.js. Key sections: 5.2 (Force Laws), 6.3 (Barnes-Hut), 7.3 (Conjugate Gradient).

## Porting rules

- Before implementing any module, read the corresponding C++ source in `original/popart-current/`.
- Preserve functional equivalence, not literal translation of syntax.
- Keep the same separation of concerns: parser → model → algorithms → layout → renderer → storage.
- The only input/export format is Nexus (.nex). Phylip is not in scope.

## Key constraints

- No server-side processing. Everything runs in the browser.
- Heavy computation (algorithms, layout) must run in Web Workers to keep the UI responsive.
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

- Renderer, layout, and UI — these are validated visually by the developer.

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
File input → parser → model → algorithms (workers) → layout (workers) → renderer → ui
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
  - [ ] Research and select a JavaScript linear programming solver.
  - [ ] Implement the IntNJ algorithm in IntNJ.js.
  - [ ] Add parity tests validating output against PopART's results.

- [ ] 08 - Layout
  - [ ] Implement force-directed spring layout in NetworkLayout.js.
  - [ ] Offload layout computation to a Web Worker via layoutWorker.js.

- [ ] 09 - Renderer
  - [ ] Implement NetworkRenderer.js for SVG/Canvas rendering.
  - [ ] Implement VertexItem.js with proportional sizing and pie chart traits.
  - [ ] Implement EdgeItem.js with mutation distance representation.

- [ ] 10 - Storage
  - [ ] Implement ProjectStorage.js using IndexedDB.
  - [ ] Ensure network topology, node positions, and visual state are persisted separately from the Nexus file.

- [ ] 11 - Export
  - [ ] Implement PNG export in Exporter.js.
  - [ ] Implement SVG export in Exporter.js.
  - [ ] Implement PDF export in Exporter.js.

- [ ] 12 - UI
  - [ ] Implement NetworkView.js connecting all modules.
  - [ ] Implement controls for node manipulation, colors, fonts, and zoom.
  - [ ] Validate the full pipeline end-to-end with a real .nex file.
