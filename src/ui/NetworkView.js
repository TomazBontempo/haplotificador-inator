/**
 * @fileoverview
 * Main UI controller for Haplotificador-inator.
 * Connects parser, model, algorithms, layout, renderer, storage, and export
 * into a single browser application pipeline.
 */

import Graph from "../model/Graph.js";
import HapNet from "../model/HapNet.js";
import { applyUndefinedSiteMask } from "../model/SiteMask.js";
import { parseNexus } from "../parser/NexusParser.js";
import { renderEdgeItem } from "../renderer/EdgeItem.js";
import { renderNetwork } from "../renderer/NetworkRenderer.js";
import { schemeSet3, schemeTableau10 } from "d3-scale-chromatic";

// ─── State ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.2;
const DRAG_THRESHOLD = 5;
const AUTO_SAVE_INTERVAL = 300000;
const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_PANEL_WIDTH = 240;
const MIN_PANEL_WIDTH = 180;
const COLLAPSED_PANEL_RAIL_WIDTH = 28;

const defaultDependencies = {
  parseNexus,
  applyUndefinedSiteMask,
  HapNet,
  Graph,
  renderNetwork,
  exportSVG: async (...args) =>
    (await import("../export/Exporter.js")).exportSVG(...args),
  exportPNG: async (...args) =>
    (await import("../export/Exporter.js")).exportPNG(...args),
  exportPDF: async (...args) =>
    (await import("../export/Exporter.js")).exportPDF(...args),
  WorkerClass: typeof Worker === "undefined" ? null : Worker,
};

let dependencies = { ...defaultDependencies };
let storageModulePromise = null;
let algorithmWorker = null;
let layoutWorker = null;
let autoSaveTimer = null;
let spacePanMode = false;
let isPanning = false;
let isMiddleButtonPanning = false;
let isDraggingNodes = false;
let isRubberBanding = false;
let lastPointer = null;
let activePanPointerId = null;
let touchPanActive = false;
let touchPanChanged = false;
let lastTouchX = 0;
let lastTouchY = 0;
let rubberBandStart = null;
let rubberBandRect = null;
let svgContainerResizeObserver = null;
let pendingVertexGesture = null;
let dragOffset = {};
let movedVertexIndices = new Set();
let suppressNextSvgClick = false;
let isResizingData = false;
let panChanged = false;
let resizeStartX = 0;
let resizeStartWidth = DEFAULT_PANEL_WIDTH;
let dataPanelWidth = DEFAULT_PANEL_WIDTH;
let propsPanelWidth = DEFAULT_PANEL_WIDTH;
let isLegendDragging = false;
let legendDragOffset = null;
let legendDragPosition = null;
let isLabelDragging = false;
let labelDragVertexIndex = null;
let labelDragStartMouse = { x: 0, y: 0 };
let labelDragStartOffset = { x: 0, y: 0 };
let labelDragElement = null;
let progressDotsInterval = null;
let progressDotIndex = 0;
let panelAnimationTimers = new WeakMap();
let temporaryStatusTimer = null;

/**
 * Replaces runtime collaborators for focused UI tests.
 */
export function __setNetworkViewDependencies(overrides = {}) {
  dependencies = { ...dependencies, ...overrides };
}

/**
 * Restores production collaborators after a test override.
 */
export function __resetNetworkViewDependencies() {
  dependencies = { ...defaultDependencies };
}

/**
 * Creates the canonical empty application state.
 */
function createInitialState() {
  return {
    currentFile: null,
    parsedNexus: null,
    hapNet: null,
    graph: null,
    algorithm: "MJN",
    algorithmParams: { epsilon: 0, alpha: 0.5 },
    visualOptions: {
      width: 1000,
      height: 1000,
      background: { color: "#ffffff" },
      edges: {
        color: "#666666",
        width: 1.5,
        labelColor: "#333333",
        showLabels: true,
        displayMode: "labels",
      },
      vertices: {
        defaultColor: "#999999",
        inferredColor: "#333333",
        traitColors: [],
      },
      baseRadius: 10,
      fontSize: 12,
      zoom: 1,
      panX: 0,
      panY: 0,
      showLabels: true,
      showLegend: true,
      legendPosition: null,
      labelOffsets: {},
    },
    history: {
      undoStack: [],
      redoStack: [],
    },
    dataPanelCollapsed: false,
    propsPanelCollapsed: false,
    selectedElements: [],
    panModeActive: false,
    maskedSites: 0,
    maskedSiteIndices: [],
    saveHandle: null,
    lastSaved: null,
    saveStatus: null,
    hasUnsavedChanges: false,
  };
}

export const state = createInitialState();

/**
 * Resets mutable state and transient interaction flags for a fresh session.
 */
function resetState() {
  const next = createInitialState();
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, next);
  dataPanelWidth = DEFAULT_PANEL_WIDTH;
  propsPanelWidth = DEFAULT_PANEL_WIDTH;
  spacePanMode = false;
  isPanning = false;
  isMiddleButtonPanning = false;
  lastPointer = null;
  activePanPointerId = null;
  touchPanActive = false;
  touchPanChanged = false;
  lastTouchX = 0;
  lastTouchY = 0;
  panChanged = false;
  movedVertexIndices.clear();
  isLegendDragging = false;
  legendDragOffset = null;
  legendDragPosition = null;
  isLabelDragging = false;
  labelDragVertexIndex = null;
  labelDragStartMouse = { x: 0, y: 0 };
  labelDragStartOffset = { x: 0, y: 0 };
  labelDragElement = null;
  updateUndoRedoButtons();
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Builds the controls shown in the right-side visual settings panel.
 */
function visualsPanelMarkup() {
  return `
    <div id="visuals-panel-content">
      <div class="visuals-section">
        <h4>Font</h4>
        <div class="visuals-row">
          <label>Size</label>
          <div class="slider-with-value">
            <input type="range" id="visual-font-size"
              min="8" max="24" step="1" value="12">
            <span id="visual-font-size-value">12px</span>
          </div>
        </div>
      </div>

      <div class="visuals-section">
        <h4>Edges</h4>
        <div class="visuals-row">
          <label>Color</label>
          <input type="color" id="visual-edge-color" value="#666666">
        </div>
        <div class="visuals-row">
          <label>Width</label>
          <div class="slider-with-value">
            <input type="range" id="visual-edge-width"
              min="0.5" max="5" step="0.5" value="1.5">
            <span id="visual-edge-width-value">1.5px</span>
          </div>
        </div>
        <div class="visuals-row">
          <label>Mutations</label>
          <div class="radio-group-inline">
            <label>
              <input type="radio" name="edge-display"
                value="labels" checked> Numbers
            </label>
            <label>
              <input type="radio" name="edge-display"
                value="ticks"> Marks
            </label>
          </div>
        </div>
      </div>

      <div class="visuals-section">
        <h4>Inferred nodes</h4>
        <div class="visuals-row">
          <label>Color</label>
          <input type="color" id="visual-inferred-color" value="#333333">
        </div>
      </div>

      <div class="visuals-section">
        <h4>Traits</h4>
        <div id="visual-traits-list">
          <p class="visuals-placeholder">
            Run an algorithm to see trait colors.
          </p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Replaces the properties panel with the default visual controls.
 */
function renderVisualsPanel() {
  const propsContent = byId("props-content");
  if (propsContent) {
    propsContent.innerHTML = visualsPanelMarkup();
  }
}

/**
 * Builds the static application shell used by browser and DOM tests.
 */
function appShell() {
  return `
    <div id="app">
      <nav id="toolbar">
        <div class="menu-wrapper">
          <button id="file-menu-btn" type="button">File</button>
          <div id="file-menu" class="dropdown-menu hidden">
            <button id="open-file" type="button">Open</button>
            <hr>
            <button id="save" type="button">Save&nbsp;&nbsp;Ctrl+S</button>
            <button id="save-as" type="button">Save As&nbsp;&nbsp;Ctrl+Shift+S</button>
            <hr>
            <button id="help-file-menu">Help</button>
          </div>
        </div>
        <button id="algorithm-menu-btn" type="button">Algorithm</button>
        <button id="save-btn" type="button" title="Save (Ctrl+S)">💾</button>
        <button id="save-as-btn" type="button" title="Save As (Ctrl+Shift+S)">💾+</button>
        <button id="export-btn" type="button">Export</button>
        <button id="undo-btn" type="button" title="Undo (Ctrl+Z)" disabled>↩</button>
        <button id="redo-btn" type="button" title="Redo (Ctrl+Shift+Z)" disabled>↪</button>
        <div id="toolbar-right">
          <button id="pan-mode-btn" class="toolbar-right-btn" title="Pan mode (P)">✋</button>
          <button id="toggle-labels" class="toggle-btn active" title="Show/hide node labels">
            👁 Labels
          </button>
          <button id="toggle-legend" class="toggle-btn active" title="Show/hide legend">
            👁 Legend
          </button>
          <button id="help-btn" class="toolbar-right-btn" title="Help">?</button>
        </div>
        <input id="open-file-input" class="hidden" type="file" accept=".nex,.hapnet">
        <div id="algorithm-modal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="algorithm-title">
          <div class="modal-dialog">
            <h2 id="algorithm-title">Algorithm</h2>
            <fieldset id="algorithm-options">
              <legend>Select algorithm</legend>
              <label><input type="radio" name="algorithm" value="MSN"> MSN</label>
              <label><input type="radio" name="algorithm" value="MJN" checked> MJN</label>
              <label><input type="radio" name="algorithm" value="TCS"> TCS</label>
              <label><input type="radio" name="algorithm" value="IntNJ"> IntNJ</label>
            </fieldset>
            <div id="algorithm-params"></div>
            <div class="modal-actions">
              <button id="algorithm-ok" type="button">OK</button>
              <button id="algorithm-cancel" type="button">Cancel</button>
            </div>
          </div>
        </div>
        <div id="export-modal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div class="modal-dialog">
            <h2 id="export-title">Export</h2>
            <fieldset id="export-format-options">
              <legend>Format</legend>
              <label><input type="radio" name="export-format" value="PNG" checked> PNG</label>
              <label><input type="radio" name="export-format" value="SVG"> SVG</label>
              <label><input type="radio" name="export-format" value="PDF"> PDF</label>
            </fieldset>
            <label>Width <input id="export-width" type="number" min="1" value="2000"></label>
            <label>Height <input id="export-height" type="number" min="1" value="2000"></label>
            <label><input id="export-transparent" type="checkbox"> Transparent background</label>
            <div class="modal-actions">
              <button id="export-confirm" type="button">Export</button>
              <button id="export-cancel" type="button">Cancel</button>
            </div>
          </div>
        </div>
        <div id="restore-modal" class="hidden">
          <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="restore-title">
            <div class="modal-dialog">
              <h3 id="restore-title">Restore previous session?</h3>
              <p>A previous session was found. Would you like to continue where you left off?</p>
              <div class="modal-actions">
                <button id="restore-confirm" type="button">Restore</button>
                <button id="restore-cancel" type="button">Start fresh</button>
              </div>
            </div>
          </div>
        </div>
        <div id="sitemask-modal" class="hidden">
          <div class="modal-overlay">
            <div class="modal-dialog sitemask-dialog">
              <p>More than 5% of sites contain undefined states and will be masked.<br>Sequences with high undefined states will not be removed.</p>
              <div class="modal-actions">
                <button id="sitemask-ok">OK</button>
              </div>
            </div>
          </div>
        </div>
        <div id="unsaved-modal" class="hidden">
          <div class="modal-overlay">
            <div class="modal-dialog unsaved-dialog">
              <p id="unsaved-message"></p>
              <div class="modal-actions">
                <button id="unsaved-save">Save as</button>
                <button id="unsaved-discard">Discard</button>
                <button id="unsaved-cancel">Cancel</button>
              </div>
            </div>
          </div>
        </div>
        <div id="help-modal" class="hidden">
          <div class="modal-overlay">
            <div class="modal-dialog help-dialog">
              <div class="help-header">
                <h3>Haplotificador-inator — Help</h3>
                <button id="help-close">✕</button>
              </div>
              <div class="help-tabs">
                <button class="help-tab active" data-tab="quickstart">Quick Start</button>
                <button class="help-tab" data-tab="algorithms">Algorithms</button>
                <button class="help-tab" data-tab="editing">Editing</button>
                <button class="help-tab" data-tab="saving">Saving</button>
                <button class="help-tab" data-tab="exporting">Exporting</button>
                <button class="help-tab" data-tab="shortcuts">Shortcuts</button>
                <button class="help-tab" data-tab="citing">Citing</button>
              </div>
              <div class="help-content" id="help-content"></div>
            </div>
          </div>
        </div>
      </nav>
      <div id="main">
        <aside id="data-panel">
          <div id="collapse-data" class="panel-collapse-strip" role="button" tabindex="0">
            <span class="collapse-chevron">&lsaquo;</span>
          </div>
          <div id="data-content">
            <div id="data-tabs">
              <button id="tab-traits" class="tab-btn active" type="button">Traits</button>
              <button id="tab-alignment" class="tab-btn" type="button">Alignment</button>
            </div>
            <div id="tab-content-traits" class="tab-content">
              <p class="data-placeholder">Open a .nex file to see data</p>
            </div>
            <div id="tab-content-alignment" class="tab-content hidden"></div>
          </div>
          <div id="data-resize-handle" class="resize-handle"></div>
        </aside>
        <main id="viewport">
          <div id="svg-container">
            <div class="canvas-empty-state">
              Drop your file here, or use File &gt; Open
            </div>
          </div>
          <div id="zoom-controls">
            <button id="zoom-in" type="button">+</button>
            <button id="zoom-out" type="button">-</button>
            <button id="zoom-fit" type="button">⊡</button>
          </div>
        </main>
        <aside id="properties-panel">
          <div id="collapse-props" class="panel-collapse-strip" role="button" tabindex="0">
            <span class="collapse-chevron">&rsaquo;</span>
          </div>
          <div id="props-content">
            ${visualsPanelMarkup()}
          </div>
        </aside>
      </div>
      <footer id="status-bar">
        <span id="status-filename">No file loaded</span>
        <span id="status-algorithm">—</span>
        <span id="status-haplotypes">—</span>
        <span id="status-edges">—</span>
        <span id="status-save">—</span>
        <span id="status-mask" class="hidden warning">⚠ 0 sites masked</span>
      </footer>
      <div id="progress-overlay" class="hidden">
        <div class="progress-dialog">
          <p id="progress-stage-label">
            <span id="progress-stage-text"></span>
            <span id="progress-dots"></span>
          </p>
          <div id="progress-bar-container">
            <div id="progress-bar-fill"></div>
          </div>
          <button id="progress-cancel" type="button">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Installs the application shell once when the page is still empty.
 */
function ensureAppShell() {
  if (!document.getElementById("app")) {
    document.body.innerHTML = appShell();
  }
}

/**
 * Looks up a DOM element by id.
 */
function byId(id) {
  return document.getElementById(id);
}

/**
 * Provides tabbed help text for the in-app help dialog.
 */
function buildHelpContent() {
  const helpContent = {
    quickstart: `
      <h4>Opening a file</h4>
      <p>Click <strong>File → Open</strong> or drag a .nex or .hapnet
      file directly onto the canvas.</p>
      <h4>Running an algorithm</h4>
      <ol>
        <li>Open a .nex file</li>
        <li>Click <strong>Algorithm</strong> in the toolbar</li>
        <li>Select an algorithm and set parameters</li>
        <li>Click <strong>OK</strong></li>
      </ol>
      <h4>Editing</h4>
      <p>Drag nodes and labels to reposition them.
      Use the <strong>Visuals</strong> panel on the right to customize colors.</p>
      <h4>Exporting</h4>
      <p>Click <strong>Export</strong>, choose PNG/SVG/PDF,
      set dimensions, and save.</p>
    `,
    algorithms: `
      <table class="help-table">
        <tr><th>Algorithm</th><th>Best for</th><th>Parameters</th></tr>
        <tr><td><strong>MSN</strong></td><td>Simple datasets, quick overview</td><td>Epsilon (ε) default 0</td></tr>
        <tr><td><strong>MJN</strong></td><td>Most datasets, standard choice</td><td>Epsilon (ε) default 0</td></tr>
        <tr><td><strong>TCS</strong></td><td>Statistical parsimony required</td><td>None</td></tr>
        <tr><td><strong>IntNJ</strong></td><td>Reticulate evolution, complex datasets</td><td>Alpha (α) default 0.5</td></tr>
      </table>
      <p><strong>When in doubt, use MJN.</strong> It is the most widely used
      algorithm for haplotype network construction.</p>
      <h4>Epsilon (ε) — MSN and MJN</h4>
      <p>ε = 0: only minimum spanning connections (recommended).<br>
      ε > 0: includes connections within ε extra mutations of the minimum.</p>
      <h4>Alpha (α) — IntNJ</h4>
      <p>α = 0.5: default, balances tree-like and reticulate structure.<br>
      Higher α: more reticulations. Lower α: more tree-like.</p>
    `,
    editing: `
      <h4>Moving nodes</h4>
      <p>Click and drag any node. To move multiple nodes,
      select them first (Shift+click or rubber band), then drag.</p>
      <h4>Moving labels</h4>
      <p>Click and drag any haplotype label independently from its node.
      The label maintains its offset when the node moves.</p>
      <h4>Moving the legend</h4>
      <p>Click and drag the legend anywhere on the canvas.</p>
      <h4>Navigation</h4>
      <table class="help-table">
        <tr><td>Pan</td><td>Space + drag or middle mouse drag</td></tr>
        <tr><td>Zoom</td><td>Ctrl + scroll wheel</td></tr>
        <tr><td>Fit to screen</td><td>Ctrl+0 or ⊡ button</td></tr>
        <tr><td>Select multiple</td><td>Shift+click or rubber band drag</td></tr>
        <tr><td>Deselect</td><td>Click empty area or Escape</td></tr>
      </table>
      <h4>Touchpad Navigation on Windows</h4>
      <p>If two-finger horizontal swipe navigates back/forward in your browser
      instead of panning the network, use one of these solutions:</p>
      <p><strong>Option 1 — Use the pan mode button:</strong><br>
      Click the ✋ button in the toolbar (or press P) to activate pan mode.
      Click and drag anywhere on the canvas to pan.</p>
      <p><strong>Option 2 — Disable swipe navigation in your browser:</strong><br>
      Firefox: type about:config in the address bar, search for
      browser.gesture.swipe.left and reset it, then search for
      browser.gesture.swipe.right and reset it.<br>
      Microsoft Edge: go to Settings → Accessibility, find "Swipe between pages",
      and turn it Off.</p>
      <p><strong>Option 3 — Use Space + drag:</strong><br>
      Hold the Space bar and drag with the left mouse button to pan.</p>
      <h4>Undo / Redo</h4>
      <p>Ctrl+Z to undo. Ctrl+Shift+Z or Ctrl+Y to redo. 20 steps per session.</p>
    `,
    saving: `
      <h4>Auto-save</h4>
      <p>The app saves to browser storage automatically every 5 minutes.
      Your work is recovered on the next visit if the browser closes unexpectedly.</p>
      <h4>Manual save — Ctrl+S</h4>
      <p>Saves to browser storage (or to your .hapnet file if Save As was used).</p>
      <h4>Save As — Ctrl+Shift+S</h4>
      <p>Saves a .hapnet project file to your computer. The .hapnet file contains
      network topology, node positions, label positions, colors, and visual settings.</p>
      <h4>Sharing with colleagues</h4>
      <p>Send a .hapnet file to a colleague. They can open it and see the network
      exactly as you left it — same positions, colors, and layout.</p>
      <h4>Session restore</h4>
      <p>When you open the app and a previous session exists, a dialog offers
      to restore it or start fresh.</p>
    `,
    exporting: `
      <h4>Export formats</h4>
      <table class="help-table">
        <tr><td><strong>SVG</strong></td><td>Vector format, infinitely scalable. Best for Illustrator or Inkscape.</td></tr>
        <tr><td><strong>PNG</strong></td><td>Raster format. Best for presentations and documents.</td></tr>
        <tr><td><strong>PDF</strong></td><td>Best for direct inclusion in manuscripts.</td></tr>
      </table>
      <h4>Resolution</h4>
      <p>Minimum <strong>3000×3000</strong> recommended for publication figures.
      Higher resolution = sharper print quality.</p>
      <h4>Transparent background</h4>
      <p>Check "Transparent background" to export without a background,
      useful for placing the figure over colored backgrounds in documents.</p>
      <p>The full network is always exported regardless of current zoom or pan level.</p>
    `,
    shortcuts: `
      <table class="help-table">
        <tr><th>Shortcut</th><th>Action</th></tr>
        <tr><td>Ctrl+S</td><td>Save</td></tr>
        <tr><td>Ctrl+Shift+S</td><td>Save As</td></tr>
        <tr><td>Ctrl+Z</td><td>Undo</td></tr>
        <tr><td>Ctrl+Shift+Z / Ctrl+Y</td><td>Redo</td></tr>
        <tr><td>Ctrl+0</td><td>Fit network to screen</td></tr>
        <tr><td>Ctrl++</td><td>Zoom in</td></tr>
        <tr><td>Ctrl+-</td><td>Zoom out</td></tr>
        <tr><td>Space + drag</td><td>Pan canvas</td></tr>
        <tr><td>Escape</td><td>Deselect all / close menus</td></tr>
      </table>
    `,
    citing: `
      <h4>Please cite both this tool and PopART:</h4>
      <div class="help-citation">
        <strong>This tool:</strong><br>
        Bontempo, T. (2025). Haplotificador-inator: A browser-based web port of
        PopART for haplotype network construction. TCC, UVA, Rio de Janeiro, Brazil.
        <a href="https://haplotificador-inator.vercel.app" target="_blank">
          haplotificador-inator.vercel.app
        </a>
      </div>
      <div class="help-citation">
        <strong>PopART:</strong><br>
        Leigh JW, Bryant D (2015). PopART: Full-feature software for haplotype
        network construction. Methods Ecol Evol 6(9):1110–1116.
        <a href="https://doi.org/10.1111/2041-210X.12410" target="_blank">
          doi:10.1111/2041-210X.12410
        </a>
      </div>
      <h4>Algorithm-specific citations:</h4>
      <div class="help-citation">
        <strong>MSN / MJN:</strong><br>
        Bandelt H, Forster P, Röhl A (1999). Median-joining networks for
        inferring intraspecific phylogenies. Mol Biol Evol 16(1):37–48.
        <a href="https://doi.org/10.1093/oxfordjournals.molbev.a026036" target="_blank">
          doi:10.1093/oxfordjournals.molbev.a026036
        </a>
      </div>
      <div class="help-citation">
        <strong>TCS:</strong><br>
        Clement M, Snell Q, Walke P, Posada D, Crandall K (2002). TCS:
        estimating gene genealogies. Proc 16th Int Parallel Distrib Process
        Symp 2:184.
      </div>
      <div class="help-citation">
        <strong>IntNJ:</strong><br>
        Leigh JW, Bryant D (2015). PopART: Full-feature software for haplotype
        network construction. Methods Ecol Evol 6(9):1110–1116.
        <a href="https://doi.org/10.1111/2041-210X.12410" target="_blank">
          doi:10.1111/2041-210X.12410
        </a>
      </div>
    `,
  };

  return helpContent;
}

const helpContent = buildHelpContent();

/**
 * Removes focus from controls after mouse activation.
 */
function blurClickedControl(event) {
  event.currentTarget?.blur?.();
}

/**
 * Toggles the shared hidden class on optional elements.
 */
function setHidden(element, hidden) {
  element?.classList.toggle("hidden", hidden);
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Loads the storage module lazily so tests can inject a fake storage layer.
 */
function getStorageModule() {
  if (dependencies.storage) {
    return Promise.resolve(dependencies.storage);
  }
  if (!storageModulePromise) {
    storageModulePromise = import("../storage/ProjectStorage.js");
  }
  return storageModulePromise;
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Replaces the canvas with a simple status message.
 */
function showMessage(message) {
  const container = byId("svg-container");
  if (container) {
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    container.appendChild(paragraph);
  }
}

/**
 * Restores the initial canvas prompt when no network is loaded.
 */
function showEmptyCanvasMessage() {
  const container = byId("svg-container");
  if (!container) {
    return;
  }

  container.replaceChildren();
  const emptyState = document.createElement("div");
  emptyState.className = "canvas-empty-state";
  emptyState.textContent = "Drop your file here, or use File > Open";
  container.appendChild(emptyState);
}

/**
 * Stops the animated ellipsis used by long-running progress states.
 */
function clearProgressDotsInterval() {
  if (progressDotsInterval) {
    clearInterval(progressDotsInterval);
    progressDotsInterval = null;
  }
}

/**
 * Starts the animated ellipsis for the progress overlay.
 */
function startProgressDotsInterval() {
  const dotStates = [".", "..", "..."];
  clearProgressDotsInterval();
  progressDotsInterval = setInterval(() => {
    const dots = byId("progress-dots");
    if (dots) {
      dots.textContent = dotStates[progressDotIndex % 3];
    }
    progressDotIndex++;
  }, 400);
}

/**
 * Updates the active progress stage and bar fill.
 */
function setProgressStage(stageNumber, stageText) {
  const stageElement = byId("progress-stage-text");
  const dots = byId("progress-dots");
  const progressBarFill = byId("progress-bar-fill");

  progressDotIndex = 0;
  if (stageElement) {
    stageElement.textContent = stageText;
  }
  if (dots) {
    dots.textContent = "";
  }
  if (progressBarFill) {
    progressBarFill.style.width = `${(stageNumber / 5) * 100}%`;
  }
}

/**
 * Shows the cancellable progress overlay from a clean visual state.
 */
function showProgressOverlay() {
  const progressBarFill = byId("progress-bar-fill");
  const stageElement = byId("progress-stage-text");
  const dots = byId("progress-dots");

  setHidden(byId("progress-overlay"), false);
  if (progressBarFill) {
    progressBarFill.style.width = "0%";
    // Reading layout here lets the CSS transition start from a visible zero.
    progressBarFill.getBoundingClientRect();
  }
  if (stageElement) {
    stageElement.textContent = "";
  }
  if (dots) {
    dots.textContent = "";
  }
  progressDotIndex = 0;
  startProgressDotsInterval();
}

/**
 * Hides progress feedback and clears its timer state.
 */
function hideProgressOverlay() {
  const progressBarFill = byId("progress-bar-fill");

  setHidden(byId("progress-overlay"), true);
  clearProgressDotsInterval();
  progressDotIndex = 0;
  if (progressBarFill) {
    progressBarFill.style.width = "0%";
  }
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Reads a browser File object with a FileReader fallback for older test shims.
 */
function readFileText(file) {
  if (!file) {
    return Promise.reject(new Error("No file selected."));
  }
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

/**
 * Converts a Graph into plain JSON for storage.
 */
function serializeGraph(graph) {
  if (!graph) {
    return null;
  }

  return {
    vertices: graph.vertices.map((vertex) => ({
      index: vertex.index,
      label: vertex.label,
      info: vertex.info,
      colour: vertex.colour,
      marked: vertex.marked,
      x: vertex.x,
      y: vertex.y,
      radius: vertex.radius,
      incidentEdges: vertex.incidentEdges?.map((edge) => edge.index) ?? [],
    })),
    edges: graph.edges.map((edge) => ({
      index: edge.index,
      from: typeof edge.from === "number" ? edge.from : edge.from.index,
      to: typeof edge.to === "number" ? edge.to : edge.to.index,
      weight: edge.weight,
      info: edge.info,
      colour: edge.colour,
      marked: edge.marked,
    })),
  };
}

/**
 * Rehydrates a stored graph while preserving saved vertex and edge metadata.
 */
function reconstructGraph(graphJSON) {
  if (
    !graphJSON ||
    !Array.isArray(graphJSON.vertices) ||
    !Array.isArray(graphJSON.edges)
  ) {
    return null;
  }

  const graph = new dependencies.Graph();
  const vertices = [...graphJSON.vertices].sort(
    (left, right) => left.index - right.index,
  );

  // Saved vertices are sorted so Graph indices match the stored edge endpoints.
  for (const vertexJSON of vertices) {
    const vertex = graph.addVertex(
      vertexJSON.label ?? "",
      vertexJSON.info ?? null,
    );
    vertex.colour = vertexJSON.colour ?? vertex.colour;
    vertex.marked = Boolean(vertexJSON.marked);
    if (Number.isFinite(vertexJSON.x)) {
      vertex.x = vertexJSON.x;
    }
    if (Number.isFinite(vertexJSON.y)) {
      vertex.y = vertexJSON.y;
    }
    if (Number.isFinite(vertexJSON.radius)) {
      vertex.radius = vertexJSON.radius;
    }
  }

  const edges = [...graphJSON.edges].sort(
    (left, right) => left.index - right.index,
  );
  // Edges are added after all vertices exist because Graph stores references.
  for (const edgeJSON of edges) {
    const edge = graph.addEdge(
      graph.vertex(edgeJSON.from),
      graph.vertex(edgeJSON.to),
      edgeJSON.weight ?? 1,
      edgeJSON.info ?? null,
    );
    edge.colour = edgeJSON.colour ?? edge.colour;
    edge.marked = Boolean(edgeJSON.marked);
  }

  return graph;
}

/**
 * Returns a safe base filename for exports.
 */
function filenameBase() {
  const filename = state.currentFile?.name ?? "network";
  return filename.replace(/\.[^.]*$/, "") || "network";
}

/**
 * Converts a site mask into the zero-based indices hidden by PopART rules.
 */
function maskedSiteIndicesFromMask(mask) {
  if (!Array.isArray(mask)) {
    return [];
  }

  const indices = [];
  mask.forEach((keepSite, index) => {
    if (!keepSite) {
      indices.push(index);
    }
  });
  return indices;
}

/**
 * Keeps only valid persisted mask indices.
 */
function normalizeMaskedSiteIndices(indices) {
  if (!Array.isArray(indices)) {
    return [];
  }

  return indices.filter((index) => Number.isInteger(index) && index >= 0);
}

/**
 * Restores saved mask indices or derives them for older project files.
 */
function restoreMaskedSiteIndices(savedState) {
  const savedIndices = normalizeMaskedSiteIndices(savedState.maskedSiteIndices);
  if (savedIndices.length > 0 || Array.isArray(savedState.maskedSiteIndices)) {
    return savedIndices;
  }

  if (!savedState.parsedNexus) {
    return [];
  }

  try {
    // Older saves did not store explicit indices, so recomputing preserves UI warnings.
    const { mask } = dependencies.applyUndefinedSiteMask(savedState.parsedNexus);
    return maskedSiteIndicesFromMask(mask);
  } catch (error) {
    console.warn(error);
    return [];
  }
}

/**
 * Builds the complete serializable project state for auto-save and Save As.
 */
export function buildSaveState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    originalFilename: state.currentFile?.name ?? null,
    parsedNexus: state.parsedNexus
      ? JSON.parse(JSON.stringify(state.parsedNexus))
      : null,
    algorithm: state.algorithm,
    algorithmParams: { ...state.algorithmParams },
    graph: serializeGraph(state.graph),
    visual: JSON.parse(JSON.stringify(state.visualOptions)),
    visualOptions: JSON.parse(JSON.stringify(state.visualOptions)),
    maskedSites: state.maskedSites,
    maskedSiteIndices: [...state.maskedSiteIndices],
    hapNet: state.hapNet
      ? {
          nseqs: state.hapNet.nseqs,
          traitNames: [...(state.hapNet.traitNames ?? [])],
        }
      : null,
  };
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Closes all transient menus and dialogs.
 */
function closeMenusAndModals() {
  setHidden(byId("file-menu"), true);
  setHidden(byId("algorithm-modal"), true);
  setHidden(byId("export-modal"), true);
  setHidden(byId("restore-modal"), true);
  setHidden(byId("help-modal"), true);
}

/**
 * Closes the File dropdown.
 */
function closeFileMenu() {
  setHidden(byId("file-menu"), true);
}

/**
 * Toggles the File dropdown.
 */
function toggleFileMenu() {
  const fileMenu = byId("file-menu");
  if (fileMenu) {
    fileMenu.classList.toggle("hidden");
  }
}

/**
 * Switches the help dialog to a known tab.
 */
function setActiveHelpTab(tab) {
  const activeTab = helpContent[tab] ? tab : "quickstart";
  document.querySelectorAll(".help-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });

  const content = byId("help-content");
  if (content) {
    content.innerHTML = helpContent[activeTab];
  }
}

/**
 * Opens help on the default quick-start tab.
 */
function openHelpModal() {
  closeFileMenu();
  setActiveHelpTab("quickstart");
  setHidden(byId("help-modal"), false);
}

/**
 * Closes the help dialog.
 */
function closeHelpModal() {
  setHidden(byId("help-modal"), true);
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Saves the project to its file handle when available and always refreshes auto-save.
 */
export async function save() {
  const storage = await getStorageModule();
  const saveState = buildSaveState();

  if (state.saveHandle) {
    await storage.saveToHandle(state.saveHandle, saveState);
  }
  await storage.autoSave(saveState);

  markSaved();
  syncStatusBar();
}

/**
 * Prompts for a .hapnet destination and stores the handle for future saves.
 */
export async function saveAsProject() {
  const storage = await getStorageModule();
  const isFirefoxFallback = typeof window !== "undefined" && !window.showSaveFilePicker;
  const fileHandle = await storage.saveAs(buildSaveState());

  if (fileHandle) {
    state.saveHandle = fileHandle;
    await storage.autoSave(buildSaveState());
    markSaved();
    syncStatusBar();
  } else if (isFirefoxFallback) {
    showTemporaryStatus("Downloaded to your Downloads folder", 3000);
  }

  return fileHandle;
}

/**
 * Records that the current state has been persisted.
 */
function markSaved(status = "Saved") {
  state.lastSaved = new Date();
  state.saveStatus = status;
  state.hasUnsavedChanges = false;
}

/**
 * Temporarily overrides the save status text before returning to the true state.
 */
function showTemporaryStatus(message, duration = 3000) {
  const statusSave = byId("status-save");
  if (!statusSave) {
    return;
  }

  if (temporaryStatusTimer) {
    clearTimeout(temporaryStatusTimer);
  }

  statusSave.textContent = message;
  temporaryStatusTimer = setTimeout(() => {
    temporaryStatusTimer = null;
    syncStatusBar();
  }, duration);
}

// ─── Visuals ──────────────────────────────────────────────────────────────

/**
 * Restricts zoom to the supported canvas range.
 */
function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value)));
}

/**
 * Applies a new zoom level and records it as a visual change.
 */
function setZoom(value) {
  const point = viewportCenterPoint();
  setZoomAtViewportPoint(value, point.x, point.y);
}

/**
 * Reads a client pointer position in viewport coordinates.
 */
function viewportPointFromClient(clientX, clientY) {
  const rect = byId("svg-container")?.getBoundingClientRect();
  if (!rect) {
    return viewportCenterPoint();
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/**
 * Returns the center of the visible SVG viewport.
 */
function viewportCenterPoint() {
  const rect = byId("svg-container")?.getBoundingClientRect();
  return {
    x: rect ? rect.width / 2 : state.visualOptions.width / 2,
    y: rect ? rect.height / 2 : state.visualOptions.height / 2,
  };
}

/**
 * Applies a zoom level while keeping a viewport point visually fixed.
 */
function setZoomAtViewportPoint(value, cursorX, cursorY) {
  const currentZoom = state.visualOptions.zoom;
  const newZoom = clampZoom(value);
  const zoomRatio = newZoom / currentZoom;

  state.visualOptions.panX =
    cursorX - zoomRatio * (cursorX - state.visualOptions.panX);
  state.visualOptions.panY =
    cursorY - zoomRatio * (cursorY - state.visualOptions.panY);
  state.visualOptions.zoom = newZoom;
  applyViewportTransform();
  markVisualChange();
}

/**
 * Increases the viewport zoom by one step.
 */
function zoomIn() {
  setZoom(state.visualOptions.zoom + ZOOM_STEP);
}

/**
 * Decreases the viewport zoom by one step.
 */
function zoomOut() {
  setZoom(state.visualOptions.zoom - ZOOM_STEP);
}

/**
 * Computes the visible radius used when fitting the graph to the viewport.
 */
function vertexRadiusForFit(vertex) {
  const explicitRadius = Number(vertex.radius);
  if (Number.isFinite(explicitRadius) && explicitRadius > 0) {
    return explicitRadius;
  }

  const frequency = Number(vertex.info?.frequency ?? vertex.info?.freq ?? 1);
  const baseRadius = Number(state.visualOptions.baseRadius ?? 10);
  return (
    baseRadius *
    Math.sqrt(Math.max(0, Number.isFinite(frequency) ? frequency : 1))
  );
}

/**
 * Measures the graph extents including node radii.
 */
function graphVertexBounds() {
  const vertices = state.graph?.vertices ?? [];
  if (vertices.length === 0) {
    return null;
  }

  const first = vertices[0];
  const firstX = Number(first.x ?? 0);
  const firstY = Number(first.y ?? 0);
  const firstRadius = vertexRadiusForFit(first);
  const bounds = {
    minX: firstX - firstRadius,
    minY: firstY - firstRadius,
    maxX: firstX + firstRadius,
    maxY: firstY + firstRadius,
  };

  for (const vertex of vertices.slice(1)) {
    const x = Number(vertex.x ?? 0);
    const y = Number(vertex.y ?? 0);
    const radius = vertexRadiusForFit(vertex);
    bounds.minX = Math.min(bounds.minX, x - radius);
    bounds.minY = Math.min(bounds.minY, y - radius);
    bounds.maxX = Math.max(bounds.maxX, x + radius);
    bounds.maxY = Math.max(bounds.maxY, y + radius);
  }

  return {
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

/**
 * Centers and scales the current graph to fit inside the SVG viewport.
 */
function zoomFit() {
  const svg = currentSvg();
  const bounds = graphVertexBounds();
  if (!svg || !bounds) {
    return;
  }

  const viewBox = svg.viewBox?.baseVal;
  const width = viewBox?.width || state.visualOptions.width || 1000;
  const height = viewBox?.height || state.visualOptions.height || 1000;
  const paddingX = width * 0.05;
  const paddingY = height * 0.05;
  const innerWidth = Math.max(1, width - paddingX * 2);
  const innerHeight = Math.max(1, height - paddingY * 2);
  const scaleX =
    bounds.width > 0 ? innerWidth / bounds.width : Number.POSITIVE_INFINITY;
  const scaleY =
    bounds.height > 0 ? innerHeight / bounds.height : Number.POSITIVE_INFINITY;
  const scale = Number.isFinite(Math.min(scaleX, scaleY))
    ? Math.min(scaleX, scaleY)
    : 1;
  const zoom = clampZoom(scale);

  state.visualOptions.zoom = zoom;
  state.visualOptions.panX =
    (width - bounds.width * zoom) / 2 - bounds.minX * zoom;
  state.visualOptions.panY =
    (height - bounds.height * zoom) / 2 - bounds.minY * zoom;
  applyViewportTransform();
  markVisualChange();
}

/**
 * Applies persisted zoom and pan to the rendered viewport group.
 */
function applyViewportTransform() {
  const svg = byId("svg-container")?.querySelector("svg");
  if (!svg) {
    return;
  }

  const { zoom, panX, panY } = state.visualOptions;
  const viewportGroup = svg.querySelector("g.viewport");
  if (viewportGroup) {
    viewportGroup.setAttribute(
      "transform",
      `translate(${panX}, ${panY}) scale(${zoom})`,
    );
  }
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Mirrors collapsed panel state into CSS variables and button affordances.
 */
function syncPanelState() {
  const dataPanel = byId("data-panel");
  const propsPanel = byId("properties-panel");
  const collapseData = byId("collapse-data");
  const collapseProps = byId("collapse-props");
  const app = byId("app");
  const visibleDataWidth = state.dataPanelCollapsed
    ? COLLAPSED_PANEL_RAIL_WIDTH
    : dataPanelWidth;
  const visiblePropsWidth = state.propsPanelCollapsed
    ? COLLAPSED_PANEL_RAIL_WIDTH
    : propsPanelWidth;

  dataPanel?.classList.toggle("collapsed", state.dataPanelCollapsed);
  propsPanel?.classList.toggle("collapsed", state.propsPanelCollapsed);
  if (dataPanel) {
    dataPanel.style.setProperty("--data-panel-width", `${dataPanelWidth}px`);
  }
  if (propsPanel) {
    propsPanel.style.setProperty("--props-panel-width", `${propsPanelWidth}px`);
  }

  collapseData
    ?.querySelector(".collapse-chevron")
    ?.replaceChildren(state.dataPanelCollapsed ? "\u203a" : "\u2039");
  collapseProps
    ?.querySelector(".collapse-chevron")
    ?.replaceChildren(state.propsPanelCollapsed ? "\u2039" : "\u203a");
  if (app) {
    app.style.setProperty("--data-panel-width", `${visibleDataWidth}px`);
    app.style.setProperty("--props-panel-width", `${visiblePropsWidth}px`);
  }
}

/**
 * Updates the footer with file, graph, masking, and save status.
 */
function syncStatusBar() {
  const filename = state.currentFile?.name ?? "No file loaded";
  byId("status-filename").textContent = filename;
  byId("status-algorithm").textContent = state.graph ? state.algorithm : "—";
  byId("status-haplotypes").textContent = Number.isFinite(state.hapNet?.nseqs)
    ? `${state.hapNet.nseqs} haplotypes`
    : "—";
  byId("status-edges").textContent = Array.isArray(state.graph?.edges)
    ? `${state.graph.edges.length} edges`
    : "—";
  let saveStatusText = state.saveStatus ?? "—";
  if (state.hasUnsavedChanges) {
    saveStatusText = "Unsaved changes";
  } else if (state.lastSaved) {
    saveStatusText = `${state.saveStatus ?? "Saved"} ${state.lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  byId("status-save").textContent = saveStatusText;

  const statusMask = byId("status-mask");
  if (statusMask) {
    statusMask.textContent = `⚠ ${state.maskedSites} sites masked`;
    setHidden(statusMask, state.maskedSites === 0);
  }
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Shows the mandatory site-mask acknowledgement before the user proceeds.
 */
function showSiteMaskWarning() {
  return new Promise((resolve) => {
    const modal = byId("sitemask-modal");
    const okButton = byId("sitemask-ok");

    if (!modal || !okButton) {
      resolve();
      return;
    }

    const acknowledge = (event) => {
      okButton.removeEventListener("click", acknowledge);
      setHidden(modal, true);
      blurClickedControl(event);
      resolve();
    };

    okButton.addEventListener("click", acknowledge);
    setHidden(modal, false);
    okButton.focus();
  });
}

/**
 * Asks how to handle unsaved work before replacing the current project.
 */
function showUnsavedChangesWarning(filename) {
  return new Promise((resolve) => {
    const modal = byId("unsaved-modal");
    const message = byId("unsaved-message");
    const saveButton = byId("unsaved-save");
    const discardButton = byId("unsaved-discard");
    const cancelButton = byId("unsaved-cancel");

    if (!modal || !message || !saveButton || !discardButton || !cancelButton) {
      resolve("cancel");
      return;
    }

    let resolved = false;
    const cleanup = (event, result) => {
      if (resolved) {
        return;
      }
      resolved = true;
      saveButton.removeEventListener("click", save);
      discardButton.removeEventListener("click", discard);
      cancelButton.removeEventListener("click", cancel);
      setHidden(modal, true);
      blurClickedControl(event);
      resolve(result);
    };
    const save = (event) => cleanup(event, "save");
    const discard = (event) => cleanup(event, "discard");
    const cancel = (event) => cleanup(event, "cancel");

    message.textContent = `You have unsaved changes in ${filename}.\nWhat would you like to do?`;
    saveButton.addEventListener("click", save);
    discardButton.addEventListener("click", discard);
    cancelButton.addEventListener("click", cancel);
    setHidden(modal, false);
    saveButton.focus();
  });
}

/**
 * Saves, discards, or cancels before an operation that would replace state.
 */
async function checkUnsavedChanges() {
  if (!state.hasUnsavedChanges) {
    return "proceed";
  }

  const filename = state.currentFile?.name ?? "current project";
  const result = await showUnsavedChangesWarning(filename);
  if (result === "save") {
    const storage = await getStorageModule();
    if (state.saveHandle) {
      await storage.saveToHandle(state.saveHandle, buildSaveState());
      markSaved();
      syncStatusBar();
      return "proceed";
    }

    const isFirefoxFallback = typeof window !== "undefined" && !window.showSaveFilePicker;
    const handle = await storage.saveAs(buildSaveState());
    if (!handle) {
      if (isFirefoxFallback) {
        showTemporaryStatus("Downloaded to your Downloads folder", 3000);
        return "proceed";
      }
      return "cancel";
    }

    state.saveHandle = handle;
    await storage.autoSave(buildSaveState());
    markSaved();
    syncStatusBar();
    return "proceed";
  }
  if (result === "discard") {
    return "proceed";
  }

  return "cancel";
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Removes all children from an optional DOM element.
 */
function clearElement(element) {
  element?.replaceChildren();
}

/**
 * Builds an empty-state paragraph for the data panel.
 */
function dataPlaceholder(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "data-placeholder";
  paragraph.textContent = message;
  return paragraph;
}

/**
 * Reads a numeric trait cell with invalid values treated as zero.
 */
function numericTraitValue(values, index) {
  const value = Number(values?.[index] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Creates one data-panel grid cell.
 */
function createDataCell(className, text) {
  const cell = document.createElement("div");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

/**
 * Builds one expandable trait summary row and its sample child rows.
 */
function createTraitRow({ label, sequenceCount, sampleCount, children }) {
  const row = document.createElement("div");
  row.className = "trait-row";

  const toggle = document.createElement("button");
  toggle.className = "trait-toggle";
  toggle.type = "button";
  toggle.textContent = "+";
  toggle.setAttribute("aria-expanded", "false");
  toggle.disabled = children.length === 0;

  const name = createDataCell("trait-name", label);
  const sequence = createDataCell(
    "trait-count",
    `(${sequenceCount} sequences)`,
  );
  const sample = createDataCell("trait-count", `(${sampleCount} samples)`);

  row.append(toggle, name, sequence, sample);

  const childRows = children.map((child, index) => {
    const childRow = document.createElement("div");
    childRow.className = "trait-child-row hidden";
    if (index % 2 === 1) {
      childRow.classList.add("alternate");
    }
    childRow.append(
      createDataCell("trait-child-spacer", ""),
      createDataCell("trait-name", child.name),
      createDataCell("trait-count", ""),
      createDataCell("trait-count", String(child.count)),
    );
    return childRow;
  });

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.textContent = expanded ? "+" : "-";
    childRows.forEach((childRow) =>
      childRow.classList.toggle("hidden", expanded),
    );
  });

  return [row, ...childRows];
}

/**
 * Renders trait labels and per-taxon counts into the data panel.
 */
function buildTraitsTab(container, traits, taxa) {
  clearElement(container);

  if (!traits) {
    container.appendChild(dataPlaceholder("No trait data in this file."));
    return;
  }

  const labels = traits.labels?.length
    ? traits.labels
    : Array.from(
        { length: traits.ntraits ?? 0 },
        (_, index) => `Trait ${index + 1}`,
      );
  const matrix = traits.matrix ?? {};
  const names = taxa?.length ? taxa : Object.keys(matrix);

  if (labels.length === 0) {
    container.appendChild(dataPlaceholder("No trait data in this file."));
    return;
  }

  const tree = document.createElement("div");
  tree.className = "traits-tree";

  const header = document.createElement("div");
  header.className = "trait-header-row";
  header.append(
    createDataCell("trait-toggle-header", ""),
    createDataCell("trait-name", "Trait name"),
    createDataCell("trait-count", "Sequences"),
    createDataCell("trait-count", "Samples"),
  );
  tree.appendChild(header);

  labels.forEach((label, traitIndex) => {
    const children = [];
    let sampleCount = 0;

    for (const name of names) {
      const count = numericTraitValue(matrix[name], traitIndex);
      if (count > 0) {
        children.push({ name, count });
        sampleCount += count;
      }
    }

    tree.append(
      ...createTraitRow({
        label,
        sequenceCount: children.length,
        sampleCount,
        children,
      }),
    );
  });

  container.appendChild(tree);
}

/**
 * Maps an alignment character to the CSS class used for coloring bases.
 */
function getNucClass(base, positionIndex, maskedIndices) {
  if (maskedIndices && maskedIndices.includes(positionIndex)) {
    return "nuc-gap";
  }

  switch (String(base).toUpperCase()) {
    case "A":
      return "nuc-a";
    case "T":
    case "U":
      return "nuc-t";
    case "G":
      return "nuc-g";
    case "C":
      return "nuc-c";
    default:
      return "nuc-gap";
  }
}

/**
 * Renders the sequence alignment with masked sites visually distinguished.
 */
function buildAlignmentTab(container, characters, taxa, maskedSiteIndices = []) {
  clearElement(container);

  if (!characters?.matrix) {
    container.appendChild(dataPlaceholder("No sequence data in this file."));
    return;
  }

  const matrix = characters.matrix;
  const names = taxa?.length ? taxa : Object.keys(matrix);

  if (names.length === 0) {
    container.appendChild(dataPlaceholder("No sequence data in this file."));
    return;
  }

  const table = document.createElement("div");
  table.className = "alignment-table";

  for (const name of names) {
    if (!Object.hasOwn(matrix, name)) {
      continue;
    }

    const row = document.createElement("div");
    row.className = "alignment-row";

    const nameCell = document.createElement("span");
    nameCell.className = "alignment-name";
    nameCell.textContent = name;

    const sequenceCell = document.createElement("span");
    sequenceCell.className = "alignment-sequence";
    const sequence = String(matrix[name]).toUpperCase();
    for (let i = 0; i < sequence.length; i += 1) {
      const char = sequence[i];
      const span = document.createElement("span");
      span.className = getNucClass(char, i, maskedSiteIndices);
      span.textContent = char;
      sequenceCell.appendChild(span);
    }
    row.append(nameCell, sequenceCell);
    table.appendChild(row);
  }

  container.appendChild(table);
}

/**
 * Switches the data panel between traits and alignment.
 */
function activateDataTab(tabName) {
  const traitsButton = byId("tab-traits");
  const alignmentButton = byId("tab-alignment");
  const traitsContent = byId("tab-content-traits");
  const alignmentContent = byId("tab-content-alignment");
  const showTraits = tabName === "traits";

  traitsButton?.classList.toggle("active", showTraits);
  alignmentButton?.classList.toggle("active", !showTraits);
  setHidden(traitsContent, !showTraits);
  setHidden(alignmentContent, showTraits);
}

/**
 * Rebuilds the data panel from the currently parsed Nexus file.
 */
export function updateDataView() {
  const traitsContent = byId("tab-content-traits");
  const alignmentContent = byId("tab-content-alignment");
  if (!traitsContent || !alignmentContent) {
    return;
  }

  clearElement(traitsContent);
  clearElement(alignmentContent);

  if (!state.parsedNexus) {
    traitsContent.appendChild(dataPlaceholder("Open a .nex file to see data"));
    activateDataTab("traits");
    return;
  }

  buildTraitsTab(
    traitsContent,
    state.parsedNexus.traits,
    state.parsedNexus.taxa,
  );
  buildAlignmentTab(
    alignmentContent,
    state.parsedNexus.characters,
    state.parsedNexus.taxa,
    state.maskedSiteIndices,
  );
  activateDataTab("traits");
}

// ─── Pipeline ─────────────────────────────────────────────────────────────

/**
 * Creates a module worker using the injected Worker class.
 */
function createModuleWorker(relativePath) {
  if (!dependencies.WorkerClass) {
    throw new Error("Web Workers are not supported in this browser.");
  }
  return new dependencies.WorkerClass(new URL(relativePath, import.meta.url), {
    type: "module",
  });
}

/**
 * Reports whether tests supplied a custom Worker implementation.
 */
function hasInjectedWorkerClass() {
  return (
    dependencies.WorkerClass &&
    (typeof Worker === "undefined" || dependencies.WorkerClass !== Worker)
  );
}

/**
 * Terminates any active algorithm or layout worker.
 */
function terminateWorkers() {
  algorithmWorker?.terminate();
  layoutWorker?.terminate();
  algorithmWorker = null;
  layoutWorker = null;
}

/**
 * Stops active computation and returns the canvas to a user-visible state.
 */
function cancelComputation() {
  terminateWorkers();
  hideProgressOverlay();
  showMessage("Computation cancelled.");
}

/**
 * Sends a payload to a worker and resolves with its graph result.
 */
function workerResult(worker, payload) {
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data?.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data?.graph);
      }
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "Worker failed."));
    };
    worker.postMessage(payload);
  });
}

// ─── Visuals ──────────────────────────────────────────────────────────────

/**
 * Renders the current graph through the shared rerender path.
 */
function renderGraph() {
  return rerenderNetwork();
}

/**
 * Injects interaction styling that belongs to the UI layer, not the renderer.
 */
function applySvgVisualTheme(svg) {
  if (!svg) {
    return;
  }

  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = `
    .vertex.selected .selection-ring {
      stroke: #f5a623 !important;
      stroke-width: 3px;
      fill: none;
    }

    .edge.selected line {
      stroke: #f5a623 !important;
      stroke-width: 3px;
    }

    .rubber-band {
      fill: rgba(245, 166, 35, 0.1);
      stroke: #f5a623;
      stroke-width: 1px;
    }
  `;
  svg.prepend(style);
}

/**
 * Recreates the SVG network and reattaches all interaction handlers.
 */
function rerenderNetwork() {
  if (!state.graph) {
    return null;
  }

  const container = byId("svg-container");
  const renderOptions = {
    ...state.visualOptions,
    traitNames: state.hapNet?.traitNames ?? [],
  };
  const svg = dependencies.renderNetwork(state.graph, renderOptions);
  container?.replaceChildren(svg);
  applySvgVisualTheme(svg);
  applyVisualVisibilityState(svg);
  applyViewportTransform();
  wireLabelInteractions(svg);
  wireSvgInteractions(svg);
  wireLegendInteractions(svg);
  return svg;
}

/**
 * Synchronizes a toolbar toggle button with visual state.
 */
function syncToggleButton(button, active, disabled = false) {
  if (!button) {
    return;
  }

  button.classList.toggle("active", active);
  button.disabled = disabled;
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

/**
 * Applies the persistent pan mode state to the viewport and toolbar button.
 */
function syncPanModeState() {
  const active = state.panModeActive === true;
  byId("viewport")?.classList.toggle("pan-mode", active);
  syncToggleButton(byId("pan-mode-btn"), active);
}

/**
 * Toggles click-and-drag viewport panning without requiring Space.
 */
function togglePanMode() {
  state.panModeActive = !state.panModeActive;
  syncPanModeState();
}

/**
 * Applies label and legend visibility to the current SVG.
 */
function applyVisualVisibilityState(svg = currentSvg()) {
  const showLabels = state.visualOptions.showLabels !== false;
  const showLegend = state.visualOptions.showLegend !== false;
  const labelsButton = byId("toggle-labels");
  const legendButton = byId("toggle-legend");

  svg?.classList.toggle("labels-hidden", !showLabels);
  syncToggleButton(labelsButton, showLabels);

  const legend = svg?.querySelector("#network-legend") ?? null;
  if (!legend) {
    syncToggleButton(legendButton, showLegend, true);
    return;
  }

  if (showLegend) {
    legend.style.removeProperty("display");
  } else {
    legend.style.display = "none";
  }
  syncToggleButton(legendButton, showLegend);
}

/**
 * Toggles haplotype labels in the rendered network.
 */
function toggleLabels(event) {
  state.visualOptions.showLabels = !(state.visualOptions.showLabels !== false);
  applyVisualVisibilityState();
  blurClickedControl(event);
  markVisualChange();
}

/**
 * Toggles the trait legend when the current network has one.
 */
function toggleLegend(event) {
  const svg = currentSvg();
  const legend = svg?.querySelector("#network-legend") ?? null;
  if (!legend) {
    applyVisualVisibilityState(svg);
    blurClickedControl(event);
    return;
  }

  state.visualOptions.showLegend = !(state.visualOptions.showLegend !== false);
  applyVisualVisibilityState(svg);
  blurClickedControl(event);
  markVisualChange();
}

/**
 * Creates a lighter or darker variant when the categorical palettes run out.
 */
function varyHexLightness(hex, step) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    return hex;
  }

  const amount = Math.min(0.45, 0.16 + Math.floor((step - 1) / 2) * 0.08);
  const target = step % 2 === 0 ? 0 : 255;
  const channels = match.slice(1).map((channel) => {
    const value = Number.parseInt(channel, 16);
    return Math.round(value + (target - value) * amount)
      .toString(16)
      .padStart(2, "0");
  });

  return `#${channels.join("")}`;
}

/**
 * Chooses a stable categorical color for a trait index.
 */
function colorForTraitIndex(index, traitCount) {
  if (traitCount <= 10) {
    return schemeTableau10[index];
  }
  if (traitCount <= 12) {
    return schemeSet3[index];
  }
  if (index < 10) {
    return schemeTableau10[index];
  }
  if (index < 12) {
    return schemeSet3[index];
  }

  const base = schemeTableau10[index % schemeTableau10.length];
  const variationStep = Math.floor(index / schemeTableau10.length);
  return varyHexLightness(base, variationStep);
}

/**
 * Assigns default trait colors whenever the current dataset changes.
 */
function assignTraitColors(hapNet) {
  const traitCount = hapNet?.traitNames?.length ?? 0;
  const vertices = state.visualOptions.vertices ?? {};
  const existing = Array.isArray(vertices.traitColors)
    ? vertices.traitColors
    : [];

  if (existing.length === traitCount) {
    return;
  }

  state.visualOptions.vertices = {
    ...vertices,
    traitColors: Array.from({ length: traitCount }, (_, index) =>
      colorForTraitIndex(index, traitCount),
    ),
  };
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Persists the current project to IndexedDB without interrupting the user.
 */
async function autoSaveCurrentState(status = "Auto-saved") {
  if (!state.graph) {
    return;
  }

  try {
    const storage = await getStorageModule();
    await storage.autoSave(buildSaveState());
    state.lastSaved = new Date();
    state.saveStatus = status;
    state.hasUnsavedChanges = false;
    syncStatusBar();
  } catch (error) {
    console.warn(error);
  }
}

/**
 * Marks the project dirty and refreshes the status bar.
 */
function markUnsavedChanges() {
  state.hasUnsavedChanges = true;
  state.saveStatus = "Unsaved changes";
  syncStatusBar();
}

/**
 * Marks a visual edit dirty only after a graph exists.
 */
function markVisualChange() {
  if (state.graph) {
    markUnsavedChanges();
  }
}

// ─── Visuals ──────────────────────────────────────────────────────────────

/**
 * Captures graph positions and visual options for undo or redo.
 */
function createHistorySnapshot(type) {
  if (!state.graph) {
    return null;
  }

  return {
    type,
    vertexPositions: state.graph.vertices.map((vertex) => ({
      index: vertex.index,
      x: vertex.x,
      y: vertex.y,
    })),
    visualOptions: JSON.parse(JSON.stringify(state.visualOptions)),
  };
}

/**
 * Enforces the fixed-size undo history limit.
 */
function trimUndoStack() {
  if (state.history.undoStack.length > 20) {
    state.history.undoStack.shift();
  }
}

/**
 * Enables or disables undo and redo toolbar buttons.
 */
function updateUndoRedoButtons() {
  const undoButton = byId("undo-btn");
  const redoButton = byId("redo-btn");
  if (undoButton) {
    undoButton.disabled = state.history.undoStack.length === 0;
  }
  if (redoButton) {
    redoButton.disabled = state.history.redoStack.length === 0;
  }
}

/**
 * Clears all undo and redo snapshots for a new graph.
 */
function clearHistory() {
  state.history.undoStack = [];
  state.history.redoStack = [];
  updateUndoRedoButtons();
}

/**
 * Stores the current state before a user-editable change.
 */
function pushUndoSnapshot(type) {
  const snapshot = createHistorySnapshot(type);
  if (!snapshot) {
    return;
  }

  state.history.undoStack.push(snapshot);
  trimUndoStack();
  state.history.redoStack = [];
  updateUndoRedoButtons();
}

/**
 * Restores graph positions and visual options from a history snapshot.
 */
function restoreSnapshot(snapshot) {
  if (!snapshot || !state.graph) {
    return;
  }

  for (const entry of snapshot.vertexPositions) {
    const vertex = state.graph.vertices.find(
      (candidate) => candidate.index === entry.index,
    );
    if (vertex) {
      vertex.x = entry.x;
      vertex.y = entry.y;
    }
  }

  state.visualOptions = JSON.parse(JSON.stringify(snapshot.visualOptions));
}

/**
 * Reverts the most recent visual or node-position edit.
 */
function undo() {
  if (state.history.undoStack.length === 0) {
    return;
  }

  const snapshot = state.history.undoStack.pop();
  const current = createHistorySnapshot(snapshot.type);
  if (current) {
    state.history.redoStack.push(current);
  }
  restoreSnapshot(snapshot);
  rerenderNetwork();
  syncVisualsPanel();
  markVisualChange();
  updateUndoRedoButtons();
}

/**
 * Reapplies the most recently undone visual or node-position edit.
 */
function redo() {
  if (state.history.redoStack.length === 0) {
    return;
  }

  const snapshot = state.history.redoStack.pop();
  const current = createHistorySnapshot(snapshot.type);
  if (current) {
    state.history.undoStack.push(current);
    trimUndoStack();
  }
  restoreSnapshot(snapshot);
  rerenderNetwork();
  syncVisualsPanel();
  markVisualChange();
  updateUndoRedoButtons();
}

/**
 * Returns the active mutation display style for edges.
 */
function edgeDisplayMode() {
  return state.visualOptions.edges?.displayMode === "ticks"
    ? "ticks"
    : "labels";
}

/**
 * Rebuilds trait color inputs from the current HapNet metadata.
 */
function updateTraitColorPickers() {
  const list = byId("visual-traits-list");
  if (!list) {
    return;
  }

  list.replaceChildren();
  const traitNames = state.hapNet?.traitNames ?? [];
  const traitColors = state.visualOptions.vertices?.traitColors ?? [];

  if (traitNames.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "visuals-placeholder";
    placeholder.textContent = "Run an algorithm to see trait colors.";
    list.appendChild(placeholder);
    return;
  }

  traitNames.forEach((traitName, index) => {
    const row = document.createElement("div");
    row.className = "trait-color-row";

    const label = document.createElement("label");
    label.textContent = traitName;
    label.htmlFor = `visual-trait-color-${index}`;

    const input = document.createElement("input");
    input.type = "color";
    input.id = `visual-trait-color-${index}`;
    input.value =
      traitColors[index] ?? colorForTraitIndex(index, traitNames.length);
    if (!traitColors[index]) {
      state.visualOptions.vertices.traitColors[index] = input.value;
    }
    input.addEventListener("mousedown", () => {
      // Snapshot before the color picker opens so undo returns to the pre-edit color.
      pushUndoSnapshot("color");
    });
    input.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      state.visualOptions.vertices.traitColors[index] = target.value;
      rerenderNetwork();
      markVisualChange();
    });

    row.append(label, input);
    list.appendChild(row);
  });
}

/**
 * Copies visual state into form controls and toggle buttons.
 */
function syncVisualsPanel() {
  const visualOptions = state.visualOptions;
  visualOptions.labelOffsets = normalizeLabelOffsets(
    visualOptions.labelOffsets,
  );
  const edgeColor = byId("visual-edge-color");
  const edgeWidth = byId("visual-edge-width");
  const edgeWidthValue = byId("visual-edge-width-value");
  const inferredColor = byId("visual-inferred-color");
  const fontSize = byId("visual-font-size");
  const fontSizeValue = byId("visual-font-size-value");

  if (edgeColor instanceof HTMLInputElement) {
    edgeColor.value = visualOptions.edges?.color ?? "#666666";
  }
  if (edgeWidth instanceof HTMLInputElement) {
    edgeWidth.value = String(visualOptions.edges?.width ?? 1.5);
  }
  if (edgeWidthValue) {
    edgeWidthValue.textContent = `${visualOptions.edges?.width ?? 1.5}px`;
  }
  const displayMode = edgeDisplayMode();
  document.querySelectorAll('input[name="edge-display"]').forEach((input) => {
    if (input instanceof HTMLInputElement) {
      input.checked = input.value === displayMode;
    }
  });
  if (inferredColor instanceof HTMLInputElement) {
    inferredColor.value = visualOptions.vertices?.inferredColor ?? "#333333";
  }
  if (fontSize instanceof HTMLInputElement) {
    fontSize.value = String(visualOptions.fontSize ?? 12);
  }
  if (fontSizeValue) {
    fontSizeValue.textContent = `${visualOptions.fontSize ?? 12}px`;
  }

  updateTraitColorPickers();
  applyVisualVisibilityState();
}

/**
 * Wires all visual customization controls in the properties panel.
 */
function initVisualsPanel() {
  byId("visual-edge-color")?.addEventListener("mousedown", () => {
    // Snapshot on pointer-down catches the color before native pickers mutate it.
    pushUndoSnapshot("color");
  });
  byId("visual-edge-color")?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    state.visualOptions.edges.color = target.value;
    rerenderNetwork();
    markVisualChange();
  });

  byId("visual-edge-width")?.addEventListener("mousedown", () => {
    // Width sliders emit many input events, but one undo step should cover the drag.
    pushUndoSnapshot("width");
  });
  byId("visual-edge-width")?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    state.visualOptions.edges.width = Number.parseFloat(target.value);
    const value = byId("visual-edge-width-value");
    if (value) {
      value.textContent = `${state.visualOptions.edges.width}px`;
    }
    markVisualChange();
    rerenderNetwork();
  });
  byId("visual-edge-width")?.addEventListener("change", () => {
    rerenderNetwork();
    markVisualChange();
  });

  document.querySelectorAll('input[name="edge-display"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      pushUndoSnapshot("display");
      state.visualOptions.edges.displayMode = target.value;
      rerenderNetwork();
      markVisualChange();
    });
  });

  byId("visual-inferred-color")?.addEventListener("mousedown", () => {
    // Snapshot before the picker opens keeps undo independent from browser timing.
    pushUndoSnapshot("color");
  });
  byId("visual-inferred-color")?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    state.visualOptions.vertices.inferredColor = target.value;
    rerenderNetwork();
    markVisualChange();
  });

  byId("visual-font-size")?.addEventListener("mousedown", () => {
    // Font-size changes are previewed live, so the drag should remain one history item.
    pushUndoSnapshot("font");
  });
  byId("visual-font-size")?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    state.visualOptions.fontSize = Number.parseInt(target.value, 10);
    const value = byId("visual-font-size-value");
    if (value) {
      value.textContent = `${state.visualOptions.fontSize}px`;
    }
    markVisualChange();
    rerenderNetwork();
  });
  byId("visual-font-size")?.addEventListener("change", () => {
    rerenderNetwork();
    markVisualChange();
  });
}

/**
 * Switches edge mutations between numeric labels and tick marks.
 */
function setEdgeDisplayMode(displayMode) {
  if (
    !["labels", "ticks"].includes(displayMode) ||
    displayMode === edgeDisplayMode()
  ) {
    return;
  }

  state.visualOptions.edges = {
    ...state.visualOptions.edges,
    displayMode,
  };
  markVisualChange();
  if (state.graph) {
    rerenderNetwork();
  }
  syncVisualsPanel();
}

// ─── Pipeline ─────────────────────────────────────────────────────────────

/**
 * Runs parse, masking, HapNet construction, algorithm, layout, and render.
 */
export async function runCurrentPipeline() {
  if (!state.currentFile) {
    showMessage("Open a .nex file before running an algorithm.");
    return;
  }

  terminateWorkers();
  const isFirstAlgorithmRunForFile = !state.graph;
  try {
    showProgressOverlay();
    setProgressStage(1, "Parsing file");
    let parsed = state.parsedNexus;
    if (!parsed) {
      const text = await readFileText(state.currentFile);
      parsed = dependencies.parseNexus(text);
      state.parsedNexus = parsed;
    }

    const { mask, masked } = dependencies.applyUndefinedSiteMask(parsed);
    state.maskedSites = masked;
    state.maskedSiteIndices = maskedSiteIndicesFromMask(mask);
    syncStatusBar();

    setProgressStage(2, "Building model");
    const hapNet = new dependencies.HapNet(parsed, masked > 0 ? { mask } : {});
    state.hapNet = hapNet;

    algorithmWorker = hasInjectedWorkerClass()
      ? createModuleWorker("../workers/algorithmWorker.js")
      : new Worker(
          new URL("../workers/algorithmWorker.js", import.meta.url),
          { type: "module" },
        );
    // Workers are recreated on every run because terminated workers cannot restart.
    setProgressStage(3, "Running " + state.algorithm);
    const algorithmGraphJSON = await workerResult(algorithmWorker, {
      algorithm: state.algorithm,
      hapNetJSON: hapNet.toJSON(),
      params: state.algorithmParams,
    });
    algorithmWorker.terminate();
    algorithmWorker = null;

    setProgressStage(4, "Computing layout");
    layoutWorker = hasInjectedWorkerClass()
      ? createModuleWorker("../workers/layoutWorker.js")
      : new Worker(
          new URL("../workers/layoutWorker.js", import.meta.url),
          { type: "module" },
        );
    const layoutGraphJSON = await workerResult(layoutWorker, {
      graphJSON: algorithmGraphJSON,
      options: { width: 1000, height: 1000 },
    });
    layoutWorker.terminate();
    layoutWorker = null;

    state.graph = reconstructGraph(layoutGraphJSON);
    clearHistory();
    state.visualOptions.width = 1000;
    state.visualOptions.height = 1000;
    if (isFirstAlgorithmRunForFile) {
      // A new graph should use renderer default legend placement until the user moves it.
      state.visualOptions.legendPosition = null;
    }
    assignTraitColors(state.hapNet);
    updateTraitColorPickers();
    setProgressStage(5, "Rendering network");
    renderGraph();
    markUnsavedChanges();
    syncStatusBar();

    await new Promise((resolve) => setTimeout(resolve, 300));
    hideProgressOverlay();
  } catch (error) {
    terminateWorkers();
    hideProgressOverlay();
    showMessage(`Algorithm failed: ${error.message}`);
  }
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Loads a Nexus file as a new project and prepares it for algorithm selection.
 */
async function handleNexusFileSelected(file) {
  if (!file) {
    return;
  }

  try {
    const storage = await getStorageModule();
    if (await storage.hasAutoSave()) {
      // Opening a new Nexus project intentionally replaces the single auto-save slot.
      await storage.clearAutoSave();
    }
  } catch (error) {
    console.warn(error);
  }

  state.currentFile = file;
  state.parsedNexus = null;
  state.hapNet = null;
  state.graph = null;
  clearHistory();
  state.visualOptions.vertices.traitColors = [];
  state.visualOptions.legendPosition = null;
  state.visualOptions.labelOffsets = {};
  syncVisualsPanel();
  state.maskedSites = 0;
  state.maskedSiteIndices = [];
  state.saveHandle = null;
  state.lastSaved = null;
  state.saveStatus = "Unsaved changes";
  state.hasUnsavedChanges = true;
  try {
    const text = await readFileText(file);
    const parsed = dependencies.parseNexus(text);
    state.parsedNexus = parsed;
    const { mask, masked } = dependencies.applyUndefinedSiteMask(parsed);
    state.maskedSites = masked;
    state.maskedSiteIndices = maskedSiteIndicesFromMask(mask);
    syncStatusBar();
    if (masked > 0) {
      await showSiteMaskWarning();
    }
    updateDataView();
  } catch (error) {
    state.parsedNexus = null;
    clearElement(byId("tab-content-traits"));
    clearElement(byId("tab-content-alignment"));
    byId("tab-content-traits")?.appendChild(
      dataPlaceholder("Open a .nex file to see data"),
    );
    activateDataTab("traits");
    showMessage(`Failed to parse file: ${error.message}`);
    syncStatusBar();
    return;
  }
  showMessage("Select an algorithm and click OK to run the network");
  syncStatusBar();
}

/**
 * Loads a .hapnet project file and restores its saved graph directly.
 */
async function handleSavedProjectFileSelected(file) {
  if (!file) {
    return;
  }

  try {
    const savedState = JSON.parse(await readFileText(file));
    applySavedState(savedState, savedState.savedAt ? "Saved" : null);
  } catch (error) {
    showMessage(`Failed to load project: ${error.message}`);
  }
}

/**
 * Reports whether a dropped or selected file can be opened by this app.
 */
function isSupportedProjectFile(file) {
  const filename =
    typeof file?.name === "string" ? file.name.toLowerCase() : "";
  return filename.endsWith(".nex") || filename.endsWith(".hapnet");
}

/**
 * Dispatches supported project files to the correct loading path.
 */
async function handleOpenFileSelected(file) {
  if (!file) {
    return;
  }

  const filename = file.name.toLowerCase();
  if (filename.endsWith(".nex")) {
    await handleNexusFileSelected(file);
    return;
  }
  if (filename.endsWith(".hapnet")) {
    await handleSavedProjectFileSelected(file);
    return;
  }

  showMessage("Unsupported file format. Please open a .nex or .hapnet file.");
}

/**
 * Applies unsaved-change guards before opening a replacement project file.
 */
async function openFileWithGuards(file) {
  if (!file) {
    return;
  }

  if (!isSupportedProjectFile(file)) {
    await handleOpenFileSelected(file);
    return;
  }

  try {
    const check = await checkUnsavedChanges();
    if (check === "cancel") {
      return;
    }
  } catch (error) {
    showMessage(`Failed to save current project: ${error.message}`);
    syncStatusBar();
    return;
  }

  await handleOpenFileSelected(file);
}

/**
 * Counts sampled vertices in a saved graph when HapNet metadata is absent.
 */
function sampledVertexCount(graph) {
  return (
    graph?.vertices?.filter((vertex) => vertex.info?.sampled !== false)
      .length ?? 0
  );
}

/**
 * Reconstructs the small HapNet summary needed by UI labels and legends.
 */
function savedHapNetSummary(savedState) {
  const traitNames =
    savedState.hapNet?.traitNames ??
    savedState.parsedNexus?.traits?.labels ??
    [];
  if (savedState.hapNet) {
    return {
      ...savedState.hapNet,
      traitNames: [...traitNames],
    };
  }
  if (savedState.graph) {
    return {
      nseqs: sampledVertexCount(state.graph),
      traitNames: [...traitNames],
    };
  }
  return null;
}

/**
 * Normalizes persisted label offsets into finite graph-space coordinates.
 */
function normalizeLabelOffsets(labelOffsets = {}) {
  if (!labelOffsets || typeof labelOffsets !== "object") {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(labelOffsets)) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      normalized[String(key)] = { x, y };
    }
  }

  return normalized;
}

/**
 * Merges saved visual settings with current defaults for forward compatibility.
 */
function mergeVisualOptions(savedVisualOptions = {}) {
  return {
    ...state.visualOptions,
    ...savedVisualOptions,
    background: {
      ...state.visualOptions.background,
      ...(savedVisualOptions.background ?? {}),
    },
    edges: {
      ...state.visualOptions.edges,
      ...(savedVisualOptions.edges ?? {}),
    },
    vertices: {
      ...state.visualOptions.vertices,
      ...(savedVisualOptions.vertices ?? {}),
    },
    labelOffsets: normalizeLabelOffsets(
      savedVisualOptions.labelOffsets ?? state.visualOptions.labelOffsets,
    ),
  };
}

/**
 * Applies a saved project state directly to UI, graph, and status models.
 */
function applySavedState(savedState, status = "Saved") {
  state.currentFile = savedState.originalFilename
    ? { name: savedState.originalFilename }
    : { name: "Loaded project" };
  state.algorithm = savedState.algorithm ?? state.algorithm;
  state.algorithmParams = {
    ...state.algorithmParams,
    ...(savedState.algorithmParams ?? {}),
  };
  state.visualOptions = mergeVisualOptions(
    savedState.visualOptions ?? savedState.visual ?? {},
  );
  state.maskedSites = savedState.maskedSites ?? 0;
  state.maskedSiteIndices = restoreMaskedSiteIndices(savedState);
  state.parsedNexus = savedState.parsedNexus ?? null;
  state.graph = reconstructGraph(savedState.graph);
  clearHistory();
  state.hapNet = savedHapNetSummary(savedState);
  state.lastSaved = savedState.savedAt ? new Date(savedState.savedAt) : null;
  state.saveStatus = status;
  state.hasUnsavedChanges = false;
  syncVisualsPanel();
  renderGraph();
  updateDataView();
  syncStatusBar();
}

/**
 * Opens a saved project through the storage module's file picker.
 */
async function loadSavedProject() {
  try {
    const check = await checkUnsavedChanges();
    if (check === "cancel") {
      return;
    }

    const storage = await getStorageModule();
    const savedState = await storage.loadFromFile();
    if (!savedState) {
      return;
    }

    applySavedState(savedState, savedState.savedAt ? "Saved" : null);
  } catch (error) {
    showMessage(`Failed to load project: ${error.message}`);
  }
}

// ─── Canvas interaction ───────────────────────────────────────────────────

/**
 * Returns the currently rendered network SVG.
 */
function currentSvg() {
  return byId("svg-container")?.querySelector("svg") ?? null;
}

/**
 * Converts a pointer event into graph coordinates inside the viewport group.
 */
function getViewportPoint(event) {
  const svg = document.querySelector("#svg-container svg");
  if (!svg) return { x: 0, y: 0 };
  const viewportGroup = svg.querySelector("g.viewport");
  if (!viewportGroup) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const transformed = pt.matrixTransform(
    viewportGroup.getScreenCTM().inverse(),
  );
  return { x: transformed.x, y: transformed.y };
}

/**
 * Reads the SVG's screen transform scale with safe defaults for DOM tests.
 */
function svgScreenScale() {
  const svg = currentSvg();
  const matrix = svg?.getScreenCTM?.();
  return {
    x: matrix?.a ? Math.abs(matrix.a) : 1,
    y: matrix?.d ? Math.abs(matrix.d) : 1,
  };
}

/**
 * Converts screen movement into graph-space movement using current zoom.
 */
function screenDeltaToGraphDelta(dx, dy) {
  return {
    x: dx / state.visualOptions.zoom,
    y: dy / state.visualOptions.zoom,
  };
}

/**
 * Converts screen movement into SVG viewport movement.
 */
function screenDeltaToViewportDelta(dx, dy) {
  const scale = svgScreenScale();
  return {
    x: dx / scale.x,
    y: dy / scale.y,
  };
}

/**
 * Converts a pointer event to graph coordinates with a test-friendly fallback.
 */
function svgPoint(event) {
  const svg = currentSvg();
  if (!svg) {
    return { x: 0, y: 0 };
  }

  const viewportGroup = svg.querySelector("g.viewport");
  const matrix = viewportGroup?.getScreenCTM?.();
  if (matrix && typeof svg.createSVGPoint === "function") {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return {
      x: transformed.x,
      y: transformed.y,
    };
  }

  const rect = svg.getBoundingClientRect();
  const scale = svgScreenScale();
  // jsdom lacks SVG matrices, so tests fall back to bounding-box math.
  return {
    x:
      ((event.clientX - rect.left) / scale.x - state.visualOptions.panX) /
      state.visualOptions.zoom,
    y:
      ((event.clientY - rect.top) / scale.y - state.visualOptions.panY) /
      state.visualOptions.zoom,
  };
}

/**
 * Clears selected SVG elements and synchronizes the properties panel.
 */
function clearSelection() {
  currentSvg()
    ?.querySelectorAll(".selected")
    .forEach((element) => {
      element.classList.remove("selected");
    });
  state.selectedElements = [];
  syncVisualsPanel();
}

/**
 * Returns selected SVG elements that represent vertices.
 */
function selectedVertexElements() {
  return state.selectedElements.filter((element) =>
    element.classList?.contains("vertex"),
  );
}

/**
 * Refreshes the properties panel after a selection change.
 */
function updatePropertiesPanel() {
  syncVisualsPanel();
}

/**
 * Selects one rendered graph element, optionally preserving prior selection.
 */
function selectGraphElement(element, additive = false) {
  if (!additive) {
    clearSelection();
  }
  if (!state.selectedElements.includes(element)) {
    state.selectedElements.push(element);
  }
  element.classList.add("selected");
  updatePropertiesPanel(element);
}

/**
 * Suppresses the synthetic click that follows a completed drag gesture.
 */
function suppressUpcomingSvgClick() {
  suppressNextSvgClick = true;
  window.setTimeout(() => {
    suppressNextSvgClick = false;
  }, 0);
}

/**
 * Re-renders a single edge after one of its vertices moves.
 */
function updateEdgeElement(edge) {
  const edgeElement = currentSvg()?.querySelector(
    `.edge[data-index="${edge.index}"]`,
  );
  if (!edgeElement) {
    return;
  }

  const replacement = renderEdgeItem(edge, state.visualOptions);
  if (edgeElement.classList.contains("selected")) {
    replacement.classList.add("selected");
  }
  state.selectedElements = state.selectedElements.map((selectedElement) =>
    selectedElement === edgeElement ? replacement : selectedElement,
  );
  edgeElement.replaceWith(replacement);
}

/**
 * Finds the model vertex for a rendered vertex index.
 */
function vertexByIndex(index) {
  return (
    state.graph?.vertices?.find((vertex) => vertex.index === index) ?? null
  );
}

/**
 * Reads an SVG translate transform as numeric coordinates.
 */
function svgTranslateCoordinates(element) {
  const transform = element.getAttribute("transform") ?? "";
  const match = transform.match(
    /translate\(\s*([-+.\deE]+)(?:[\s,]+([-+.\deE]+))?\s*\)/,
  );
  if (!match) {
    return null;
  }

  const x = Number(match[1]);
  const y = Number(match[2] ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

/**
 * Finds a vertex label element from an event target.
 */
function labelElementFromEvent(event) {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest?.(".vertex-label") ?? null;
}

/**
 * Converts a label offset attribute to a finite number.
 */
function numericLabelOffset(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Reads the current rendered offset for a vertex label.
 */
function labelOffsetFromElement(labelElement) {
  return {
    x: numericLabelOffset(labelElement.getAttribute("x"), 0),
    y: numericLabelOffset(labelElement.getAttribute("y"), 0),
  };
}

/**
 * Applies a graph-space offset to a rendered vertex label.
 */
function setLabelElementOffset(labelElement, offset) {
  labelElement?.setAttribute("x", String(offset.x));
  labelElement?.setAttribute("y", String(offset.y));
}

/**
 * Starts dragging a label independently from its vertex.
 */
function beginLabelDrag(event, labelElement) {
  const vertexIndex = labelElement.dataset.vertexIndex;
  if (vertexIndex === undefined) {
    return;
  }

  isLabelDragging = true;
  labelDragVertexIndex = String(vertexIndex);
  labelDragStartMouse = svgPoint(event);
  labelDragStartOffset = labelOffsetFromElement(labelElement);
  labelDragElement = labelElement;
  // Snapshot is taken before drag starts so undo restores the original offset.
  pushUndoSnapshot("labelDrag");
  event.stopPropagation();
  event.preventDefault();
}

/**
 * Updates the rendered label offset while a label drag is active.
 */
function updateLabelDrag(event) {
  if (!isLabelDragging || !labelDragElement) {
    return;
  }

  const pointer = svgPoint(event);
  const nextOffset = {
    x: labelDragStartOffset.x + pointer.x - labelDragStartMouse.x,
    y: labelDragStartOffset.y + pointer.y - labelDragStartMouse.y,
  };
  setLabelElementOffset(labelDragElement, nextOffset);
  event.preventDefault();
}

/**
 * Commits a completed label drag into visual options.
 */
function finishLabelDrag() {
  if (!isLabelDragging || labelDragVertexIndex === null || !labelDragElement) {
    isLabelDragging = false;
    labelDragVertexIndex = null;
    labelDragElement = null;
    return;
  }

  const finalOffset = labelOffsetFromElement(labelDragElement);
  state.visualOptions.labelOffsets = {
    ...(state.visualOptions.labelOffsets ?? {}),
    [labelDragVertexIndex]: finalOffset,
  };
  isLabelDragging = false;
  labelDragVertexIndex = null;
  labelDragStartMouse = { x: 0, y: 0 };
  labelDragStartOffset = { x: 0, y: 0 };
  labelDragElement = null;
  suppressUpcomingSvgClick();
  markVisualChange();
}

/**
 * Routes a left-button label press into the label-drag gesture.
 */
function handleLabelMousedown(event) {
  if (event.button !== 0) {
    return;
  }
  if (state.panModeActive) {
    return;
  }

  const labelElement = labelElementFromEvent(event);
  if (labelElement) {
    beginLabelDrag(event, labelElement);
  }
}

/**
 * Applies a saved or live position to the legend group.
 */
function setLegendTransform(position) {
  const legend = currentSvg()?.querySelector("#network-legend");
  if (!legend || !position) {
    return;
  }

  legend.setAttribute("transform", `translate(${position.x}, ${position.y})`);
}

/**
 * Starts dragging the legend from its current transform.
 */
function beginLegendDrag(event) {
  const legend = event.currentTarget;
  const currentPosition = svgTranslateCoordinates(legend) ?? { x: 0, y: 0 };
  const pointer = svgPoint(event);

  isLegendDragging = true;
  legendDragPosition = { ...currentPosition };
  legendDragOffset = {
    x: pointer.x - currentPosition.x,
    y: pointer.y - currentPosition.y,
  };
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Updates the rendered legend transform during a drag.
 */
function updateLegendDrag(event) {
  if (!isLegendDragging || !legendDragOffset) {
    return;
  }

  const pointer = svgPoint(event);
  legendDragPosition = {
    x: pointer.x - legendDragOffset.x,
    y: pointer.y - legendDragOffset.y,
  };
  setLegendTransform(legendDragPosition);
  event.preventDefault();
}

/**
 * Stores the final legend position after a drag.
 */
function finishLegendDrag() {
  if (!isLegendDragging) {
    return;
  }

  isLegendDragging = false;
  const finalPosition = legendDragPosition;
  legendDragOffset = null;
  legendDragPosition = null;

  if (!finalPosition) {
    return;
  }

  const previousPosition = state.visualOptions.legendPosition;
  const changed =
    !previousPosition ||
    previousPosition.x !== finalPosition.x ||
    previousPosition.y !== finalPosition.y;

  if (!changed) {
    return;
  }

  // Snapshot is delayed until the position actually changes to avoid empty undo steps.
  pushUndoSnapshot("legend");
  state.visualOptions.legendPosition = finalPosition;
  suppressUpcomingSvgClick();
  markVisualChange();
}

/**
 * Copies dragged SVG vertex positions back into the graph model.
 */
function commitMovedVertexPositions() {
  for (const index of movedVertexIndices) {
    const element = currentSvg()?.querySelector(
      `.vertex[data-index="${index}"]`,
    );
    const vertex = vertexByIndex(index);
    const coordinates = element ? svgTranslateCoordinates(element) : null;
    if (!vertex || !coordinates) {
      continue;
    }

    vertex.x = coordinates.x;
    vertex.y = coordinates.y;
  }

  movedVertexIndices.clear();
}

/**
 * Moves all selected vertices and refreshes affected edges.
 */
function moveSelectedVertices(dx, dy) {
  const movedEdges = new Set();
  for (const element of selectedVertexElements()) {
    const index = Number(element.dataset.index);
    const vertex = vertexByIndex(index);
    if (!vertex) {
      continue;
    }

    vertex.x = (vertex.x ?? 0) + dx;
    vertex.y = (vertex.y ?? 0) + dy;
    element.setAttribute("transform", `translate(${vertex.x}, ${vertex.y})`);
    movedVertexIndices.add(index);
    for (const edge of vertex.incidentEdges ?? []) {
      movedEdges.add(edge);
    }
  }

  for (const edge of movedEdges) {
    updateEdgeElement(edge);
  }
}

/**
 * Moves selected vertices relative to the primary dragged vertex.
 */
function moveDraggedVertices(event) {
  const primaryIndex = pendingVertexGesture?.primaryIndex;
  const vertex = vertexByIndex(primaryIndex);
  const offset = dragOffset[primaryIndex];
  if (!vertex || !offset) {
    return;
  }

  const pointer = getViewportPoint(event);
  const oldPrimaryX = vertex.x ?? 0;
  const oldPrimaryY = vertex.y ?? 0;
  const newPrimaryX = pointer.x - offset.x;
  const newPrimaryY = pointer.y - offset.y;
  const delta = {
    x: newPrimaryX - oldPrimaryX,
    y: newPrimaryY - oldPrimaryY,
  };

  moveSelectedVertices(delta.x, delta.y);
}

/**
 * Starts drawing a rubber-band selection rectangle.
 */
function beginRubberBand(event) {
  const svg = currentSvg();
  if (!svg) {
    return;
  }
  rubberBandStart = svgPoint(event);
  rubberBandRect = document.createElementNS(SVG_NS, "rect");
  rubberBandRect.setAttribute("class", "rubber-band");
  rubberBandRect.setAttribute("x", String(rubberBandStart.x));
  rubberBandRect.setAttribute("y", String(rubberBandStart.y));
  rubberBandRect.setAttribute("width", "0");
  rubberBandRect.setAttribute("height", "0");
  (svg.querySelector("g.viewport") ?? svg).appendChild(rubberBandRect);
  isRubberBanding = true;
}

/**
 * Resizes the rubber-band rectangle to the current pointer.
 */
function updateRubberBand(event) {
  if (!isRubberBanding || !rubberBandRect || !rubberBandStart) {
    return;
  }
  const point = svgPoint(event);
  const x = Math.min(rubberBandStart.x, point.x);
  const y = Math.min(rubberBandStart.y, point.y);
  rubberBandRect.setAttribute("x", String(x));
  rubberBandRect.setAttribute("y", String(y));
  rubberBandRect.setAttribute(
    "width",
    String(Math.abs(point.x - rubberBandStart.x)),
  );
  rubberBandRect.setAttribute(
    "height",
    String(Math.abs(point.y - rubberBandStart.y)),
  );
}

/**
 * Selects vertices inside the completed rubber-band rectangle.
 */
function finishRubberBand() {
  if (!isRubberBanding || !rubberBandRect) {
    return;
  }

  const x = Number(rubberBandRect.getAttribute("x"));
  const y = Number(rubberBandRect.getAttribute("y"));
  const width = Number(rubberBandRect.getAttribute("width"));
  const height = Number(rubberBandRect.getAttribute("height"));
  const wasRubberBandDrag = width > 0 || height > 0;
  clearSelection();

  for (const vertex of state.graph?.vertices ?? []) {
    const vx = vertex.x ?? 0;
    const vy = vertex.y ?? 0;
    if (vx >= x && vx <= x + width && vy >= y && vy <= y + height) {
      const element = currentSvg()?.querySelector(
        `.vertex[data-index="${vertex.index}"]`,
      );
      if (element) {
        selectGraphElement(element, true);
      }
    }
  }

  rubberBandRect.remove();
  rubberBandRect = null;
  rubberBandStart = null;
  isRubberBanding = false;
  if (wasRubberBandDrag) {
    // The following click would otherwise clear the selection just created.
    suppressUpcomingSvgClick();
  }
}

/**
 * Wires click, vertex drag, edge selection, and rubber-band behavior on an SVG.
 */
function wireSvgInteractions(svg) {
  svg.addEventListener("click", (event) => {
    if (suppressNextSvgClick) {
      suppressNextSvgClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const graphElement = event.target.closest?.(".vertex, .edge");
    if (graphElement) {
      selectGraphElement(graphElement, event.shiftKey);
    } else {
      clearSelection();
    }
  });

  svg.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }

    if (spacePanMode || state.panModeActive) {
      return;
    }

    if (labelElementFromEvent(event)) {
      handleLabelMousedown(event);
      return;
    }

    const vertexElement = event.target.closest?.(".vertex");
    const edgeElement = event.target.closest?.(".edge");
    lastPointer = { x: event.clientX, y: event.clientY };

    if (vertexElement) {
      const primaryIndex = Number(vertexElement.dataset.index);
      const vertex = vertexByIndex(primaryIndex);
      const pointer = getViewportPoint(event);
      dragOffset = {};
      if (vertex) {
        dragOffset[primaryIndex] = {
          x: pointer.x - (vertex.x ?? 0),
          y: pointer.y - (vertex.y ?? 0),
        };
      }
      pendingVertexGesture = {
        element: vertexElement,
        shiftKey: event.shiftKey,
        startX: event.clientX,
        startY: event.clientY,
        primaryIndex,
      };
      isDraggingNodes = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!edgeElement && !spacePanMode && !state.panModeActive) {
      event.preventDefault();
      beginRubberBand(event);
    }
  });
}

/**
 * Wires direct label mouse handlers after a rerender.
 */
function wireLabelInteractions(svg) {
  svg.querySelectorAll(".vertex-label").forEach((label) => {
    label.addEventListener("mousedown", handleLabelMousedown);
  });
}

/**
 * Wires legend dragging after a rerender.
 */
function wireLegendInteractions(svg) {
  const legend = svg.querySelector("#network-legend");
  if (!legend) {
    return;
  }

  legend.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      if (state.panModeActive) {
        return;
      }
      beginLegendDrag(event);
    }
  });
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Returns the currently selected algorithm radio input.
 */
function selectedAlgorithmInput() {
  return document.querySelector('input[name="algorithm"]:checked');
}

/**
 * Renders parameter controls for the selected algorithm.
 */
function renderAlgorithmParams() {
  const selected = selectedAlgorithmInput()?.value ?? state.algorithm;
  const params = byId("algorithm-params");
  if (!params) {
    return;
  }

  if (selected === "MSN" || selected === "MJN") {
    params.innerHTML = `
      <label>Epsilon (ε)
        <input id="algorithm-epsilon" type="number" step="1" value="${state.algorithmParams.epsilon}">
      </label>
    `;
  } else if (selected === "IntNJ") {
    params.innerHTML = `
      <label>Alpha (α)
        <input id="algorithm-alpha" type="number" step="0.1" min="0" max="1" value="${state.algorithmParams.alpha}">
      </label>
    `;
  } else {
    params.textContent = "No parameters";
  }
}

/**
 * Opens the algorithm dialog with controls synchronized to state.
 */
function openAlgorithmModal() {
  const input = document.querySelector(
    `input[name="algorithm"][value="${state.algorithm}"]`,
  );
  if (input) {
    input.checked = true;
  }
  renderAlgorithmParams();
  setHidden(byId("algorithm-modal"), false);
}

/**
 * Stores the algorithm dialog selection and reruns the pipeline for Nexus files.
 */
function storeAlgorithmSelection() {
  const algorithm = selectedAlgorithmInput()?.value ?? state.algorithm;
  state.algorithm = algorithm;

  if (algorithm === "MSN" || algorithm === "MJN") {
    state.algorithmParams.epsilon = Number(
      byId("algorithm-epsilon")?.value ?? 0,
    );
  } else if (algorithm === "IntNJ") {
    state.algorithmParams.alpha = Number(byId("algorithm-alpha")?.value ?? 0.5);
  }

  setHidden(byId("algorithm-modal"), true);
  if (
    state.currentFile?.name?.toLowerCase().endsWith(".nex") ||
    state.currentFile?.name?.toLowerCase().endsWith(".nexus")
  ) {
    runCurrentPipeline();
  }
}

/**
 * Opens the export dialog.
 */
function openExportModal() {
  setHidden(byId("export-modal"), false);
}

/**
 * Exports the current graph in the format selected by the user.
 */
async function exportCurrentNetwork() {
  if (!state.graph) {
    setHidden(byId("export-modal"), true);
    return;
  }

  const format =
    document.querySelector('input[name="export-format"]:checked')?.value ??
    "PNG";
  const exportOptions = {
    filename: filenameBase(),
    width: Number(byId("export-width")?.value ?? 2000),
    height: Number(byId("export-height")?.value ?? 2000),
    transparent: Boolean(byId("export-transparent")?.checked),
  };
  const visualOptions = {
    ...state.visualOptions,
    traitNames: state.hapNet?.traitNames ?? [],
  };

  if (format === "SVG") {
    await dependencies.exportSVG(state.graph, visualOptions, exportOptions);
  } else if (format === "PDF") {
    await dependencies.exportPDF(state.graph, visualOptions, exportOptions);
  } else {
    await dependencies.exportPNG(state.graph, visualOptions, exportOptions);
  }

  setHidden(byId("export-modal"), true);
}

/**
 * Wires the hidden file input and File > Open command.
 */
function wireFileInputs() {
  const openInput = byId("open-file-input");

  byId("open-file")?.addEventListener("click", (event) => {
    closeFileMenu();
    blurClickedControl(event);

    if (openInput) {
      openInput.value = "";
    }
    openInput?.click();
  });

  openInput?.addEventListener("change", async () => {
    await openFileWithGuards(openInput.files?.[0] ?? null);
  });
}

/**
 * Wires top-level toolbar buttons and the File dropdown.
 */
function wireToolbar() {
  const fileMenu = byId("file-menu");
  const fileMenuButton = byId("file-menu-btn");

  fileMenuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFileMenu();
    blurClickedControl(event);
  });

  fileMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".menu-wrapper")) {
      closeFileMenu();
    }
  });

  byId("algorithm-menu-btn")?.addEventListener("click", (event) => {
    openAlgorithmModal();
    blurClickedControl(event);
  });
  byId("save")?.addEventListener("click", (event) => {
    closeFileMenu();
    save();
    blurClickedControl(event);
  });
  byId("save-btn")?.addEventListener("click", (event) => {
    save();
    blurClickedControl(event);
  });
  byId("save-as")?.addEventListener("click", (event) => {
    closeFileMenu();
    saveAsProject();
    blurClickedControl(event);
  });
  byId("save-as-btn")?.addEventListener("click", (event) => {
    saveAsProject();
    blurClickedControl(event);
  });
  byId("export-btn")?.addEventListener("click", (event) => {
    openExportModal();
    blurClickedControl(event);
  });
  byId("help-btn")?.addEventListener("click", (event) => {
    openHelpModal();
    blurClickedControl(event);
  });
  byId("help-file-menu")?.addEventListener("click", (event) => {
    openHelpModal();
    blurClickedControl(event);
  });
  byId("undo-btn")?.addEventListener("click", (event) => {
    undo();
    blurClickedControl(event);
  });
  byId("redo-btn")?.addEventListener("click", (event) => {
    redo();
    blurClickedControl(event);
  });
  byId("pan-mode-btn")?.addEventListener("click", (event) => {
    togglePanMode();
    blurClickedControl(event);
  });
  byId("toggle-labels")?.addEventListener("click", toggleLabels);
  byId("toggle-legend")?.addEventListener("click", toggleLegend);
}

/**
 * Applies a short collapse animation class to a side panel.
 */
function startPanelAnimation(panel, collapsed) {
  if (!panel) {
    return;
  }

  const existingTimer = panelAnimationTimers.get(panel);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  panel.classList.add("animating");
  panel.classList.toggle("collapsed", collapsed);
  const timer = setTimeout(() => {
    panel.classList.remove("animating");
    panelAnimationTimers.delete(panel);
  }, 220);
  panelAnimationTimers.set(panel, timer);
}

/**
 * Wires side-panel collapse controls.
 */
function wirePanels() {
  byId("collapse-data")?.addEventListener("click", (event) => {
    const collapsed = !state.dataPanelCollapsed;
    startPanelAnimation(byId("data-panel"), collapsed);
    state.dataPanelCollapsed = collapsed;
    syncPanelState();
    blurClickedControl(event);
  });

  byId("collapse-props")?.addEventListener("click", (event) => {
    const collapsed = !state.propsPanelCollapsed;
    startPanelAnimation(byId("properties-panel"), collapsed);
    state.propsPanelCollapsed = collapsed;
    syncPanelState();
    blurClickedControl(event);
  });
}

/**
 * Sets the data panel width while respecting the minimum usable size.
 */
function setDataPanelWidth(width) {
  dataPanelWidth = Math.max(MIN_PANEL_WIDTH, width);
  const dataPanel = byId("data-panel");
  if (dataPanel) {
    dataPanel.style.setProperty("--data-panel-width", `${dataPanelWidth}px`);
    if (!state.dataPanelCollapsed) {
      dataPanel.style.width = `${dataPanelWidth}px`;
    }
  }
  byId("app")?.style.setProperty(
    "--data-panel-width",
    state.dataPanelCollapsed
      ? `${COLLAPSED_PANEL_RAIL_WIDTH}px`
      : `${dataPanelWidth}px`,
  );
}

/**
 * Sets the properties panel width while respecting the minimum usable size.
 */
function setPropsPanelWidth(width) {
  propsPanelWidth = Math.max(MIN_PANEL_WIDTH, width);
  const propsPanel = byId("properties-panel");
  if (propsPanel) {
    propsPanel.style.setProperty("--props-panel-width", `${propsPanelWidth}px`);
  }
  byId("app")?.style.setProperty(
    "--props-panel-width",
    state.propsPanelCollapsed
      ? `${COLLAPSED_PANEL_RAIL_WIDTH}px`
      : `${propsPanelWidth}px`,
  );
}

/**
 * Ends active panel resizing and restores normal selection behavior.
 */
function finishPanelResize() {
  if (!isResizingData) {
    return;
  }
  const dataPanel = byId("data-panel");
  if (dataPanel) {
    dataPanel.style.transition = "";
    dataPanel.style.removeProperty("width");
  }
  isResizingData = false;
  document.body.style.userSelect = "";
}

/**
 * Wires drag resizing for the data side panel.
 */
function wirePanelResize() {
  byId("data-resize-handle")?.addEventListener("mousedown", (event) => {
    const dataPanel = byId("data-panel");
    if (!dataPanel || state.dataPanelCollapsed) {
      return;
    }

    isResizingData = true;
    dataPanel.style.transition = "none";
    resizeStartX = event.clientX;
    resizeStartWidth = dataPanel.offsetWidth;
    document.body.style.userSelect = "none";
    blurClickedControl(event);
    event.preventDefault();
    event.stopPropagation();
  });

  document.addEventListener("mousemove", (event) => {
    if (isResizingData) {
      const delta = event.clientX - resizeStartX;
      setDataPanelWidth(resizeStartWidth + delta);
      event.preventDefault();
    }
  });

  document.addEventListener("mouseup", finishPanelResize);
}

/**
 * Wires the data panel tab buttons.
 */
function wireDataTabs() {
  byId("tab-traits")?.addEventListener("click", (event) => {
    activateDataTab("traits");
    blurClickedControl(event);
  });
  byId("tab-alignment")?.addEventListener("click", (event) => {
    activateDataTab("alignment");
    blurClickedControl(event);
  });
}

/**
 * Wires modal buttons, tabs, and overlay dismissal behavior.
 */
function wireModals() {
  document.querySelectorAll('input[name="algorithm"]').forEach((input) => {
    input.addEventListener("change", renderAlgorithmParams);
  });

  byId("algorithm-ok")?.addEventListener("click", (event) => {
    storeAlgorithmSelection();
    blurClickedControl(event);
  });
  byId("algorithm-cancel")?.addEventListener("click", (event) => {
    setHidden(byId("algorithm-modal"), true);
    blurClickedControl(event);
  });

  byId("export-confirm")?.addEventListener("click", async (event) => {
    try {
      await exportCurrentNetwork();
    } finally {
      blurClickedControl(event);
    }
  });
  byId("export-cancel")?.addEventListener("click", (event) => {
    setHidden(byId("export-modal"), true);
    blurClickedControl(event);
  });

  byId("help-close")?.addEventListener("click", (event) => {
    closeHelpModal();
    blurClickedControl(event);
  });

  byId("help-modal")
    ?.querySelector(".modal-overlay")
    ?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        closeHelpModal();
      }
    });

  document.querySelectorAll(".help-tab").forEach((button) => {
    button.addEventListener("click", (event) => {
      const tab = event.currentTarget?.dataset?.tab ?? "quickstart";
      setActiveHelpTab(tab);
      blurClickedControl(event);
    });
  });
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Resolves the user's choice in the auto-save restore dialog.
 */
function restoreDialogChoice() {
  return new Promise((resolve) => {
    const modal = byId("restore-modal");
    const restoreButton = byId("restore-confirm");
    const startFreshButton = byId("restore-cancel");

    if (!modal || !restoreButton || !startFreshButton) {
      resolve(false);
      return;
    }

    const cleanup = () => {
      restoreButton.removeEventListener("click", restore);
      startFreshButton.removeEventListener("click", startFresh);
      setHidden(modal, true);
    };
    const restore = (event) => {
      cleanup();
      blurClickedControl(event);
      resolve(true);
    };
    const startFresh = (event) => {
      cleanup();
      blurClickedControl(event);
      resolve(false);
    };

    restoreButton.addEventListener("click", restore);
    startFreshButton.addEventListener("click", startFresh);
    setHidden(modal, false);
  });
}

/**
 * Reports whether the app is running under the automated test suite.
 */
function isTestEnvironment() {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "test";
}

/**
 * Offers to restore the single auto-save slot on startup.
 */
async function maybeOfferSessionRestore() {
  if (isTestEnvironment()) {
    return;
  }

  try {
    const storage = await getStorageModule();
    if (!(await storage.hasAutoSave())) {
      showEmptyCanvasMessage();
      return;
    }

    if (await restoreDialogChoice()) {
      const savedState = await storage.loadAutoSave();
      if (savedState) {
        applySavedState(savedState, "Restored from auto-save");
      }
    } else {
      await storage.clearAutoSave();
      showEmptyCanvasMessage();
      syncStatusBar();
    }
  } catch (error) {
    console.warn(error);
    showEmptyCanvasMessage();
  }
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Wires the visible zoom controls.
 */
function wireZoomControls() {
  byId("zoom-in")?.addEventListener("click", (event) => {
    zoomIn();
    blurClickedControl(event);
  });
  byId("zoom-out")?.addEventListener("click", (event) => {
    zoomOut();
    blurClickedControl(event);
  });
  byId("zoom-fit")?.addEventListener("click", (event) => {
    zoomFit();
    blurClickedControl(event);
  });
}

/**
 * Reapplies viewport transforms when the canvas container changes size.
 */
function wireResizeObserver() {
  const container = byId("svg-container");
  if (
    !container ||
    typeof ResizeObserver === "undefined" ||
    svgContainerResizeObserver
  ) {
    return;
  }

  svgContainerResizeObserver = new ResizeObserver(() => {
    applyViewportTransform();
  });
  svgContainerResizeObserver.observe(container);
}

// ─── Canvas interaction ───────────────────────────────────────────────────

/**
 * Starts panning from the current pointer position.
 */
function beginPan(event, middleButton = false) {
  isPanning = true;
  isMiddleButtonPanning = middleButton;
  panChanged = false;
  lastPointer = { x: event.clientX, y: event.clientY };
  byId("viewport")?.classList.add("panning");
}

/**
 * Ends panning and restores the viewport cursor state.
 */
function endPan() {
  isPanning = false;
  isMiddleButtonPanning = false;
  panChanged = false;
  byId("viewport")?.classList.toggle("panning", spacePanMode);
}

/**
 * Moves the viewport by the screen delta since the previous pan event.
 */
function updatePanDrag(event) {
  if (!lastPointer) {
    return;
  }

  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  lastPointer = { x: event.clientX, y: event.clientY };

  const delta = screenDeltaToViewportDelta(dx, dy);
  state.visualOptions.panX += delta.x;
  state.visualOptions.panY += delta.y;
  if (delta.x !== 0 || delta.y !== 0) {
    panChanged = true;
  }
  applyViewportTransform();
}

/**
 * Ends an active pan gesture and persists the visual change if needed.
 */
function finishPanGesture() {
  lastPointer = null;
  activePanPointerId = null;
  if (isPanning || isMiddleButtonPanning) {
    if (panChanged) {
      markVisualChange();
    }
    endPan();
  }
}

/**
 * Reports whether a drag event contains files.
 */
function isFileDragEvent(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Clears the visual drop target state from the viewport.
 */
function clearFileDropActive() {
  byId("viewport")?.classList.remove("file-drop-active");
}

/**
 * Wires drag-and-drop project loading on the viewport.
 */
function wireViewportFileDrop() {
  const viewport = byId("viewport");
  if (!viewport) {
    return;
  }

  let dragDepth = 0;

  viewport.addEventListener("dragenter", (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
    viewport.classList.add("file-drop-active");
  });

  viewport.addEventListener("dragover", (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });

  viewport.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      clearFileDropActive();
    }
  });

  viewport.addEventListener("drop", async (event) => {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepth = 0;
    clearFileDropActive();

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 1) {
      showMessage("Please drop one .nex or .hapnet file at a time.");
      return;
    }

    await openFileWithGuards(files[0] ?? null);
  });
}

/**
 * Wires viewport panning, zooming, selection, and drag gestures.
 */
function wireViewportInteractions() {
  const viewport = byId("viewport");
  if (!viewport) {
    return;
  }

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      // Normalize delta across different devices and browsers.
      // Mouse wheel produces large deltaY (~100), touchpad produces small (~3-5).
      // Using a logarithmic scale keeps zoom feeling consistent on both.
      const delta = event.deltaY;
      const normalized = delta * (event.deltaMode === 1 ? 20 : 1);
      const zoomFactor = Math.pow(0.996, normalized);
      const point = viewportPointFromClient(event.clientX, event.clientY);
      setZoomAtViewportPoint(
        state.visualOptions.zoom * zoomFactor,
        point.x,
        point.y,
      );
    },
    { passive: false },
  );

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) {
        return;
      }

      const isHorizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const isVerticalIntent = Math.abs(event.deltaY) > Math.abs(event.deltaX);

      if (isHorizontalIntent || isVerticalIntent) {
        event.preventDefault();
        state.visualOptions.panX -= event.deltaX;
        state.visualOptions.panY -= event.deltaY;
        applyViewportTransform();
      }
    },
    { passive: false },
  );

  viewport.addEventListener("mousedown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      beginPan(event, true);
    } else if (
      (spacePanMode || state.panModeActive) &&
      event.button === 0 &&
      typeof window.PointerEvent === "undefined"
    ) {
      event.preventDefault();
      beginPan(event);
    }
  });

  viewport.addEventListener("pointerdown", (event) => {
    if (!spacePanMode && !state.panModeActive) {
      return;
    }
    if (event.pointerType === "touch") {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    activePanPointerId = event.pointerId;
    beginPan(event);
    viewport.setPointerCapture?.(event.pointerId);
  });

  viewport.addEventListener("pointermove", (event) => {
    if (activePanPointerId !== event.pointerId) {
      return;
    }
    if (!isPanning) {
      return;
    }

    event.preventDefault();
    updatePanDrag(event);
  });

  const handlePanPointerEnd = (event) => {
    if (activePanPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    viewport.releasePointerCapture?.(event.pointerId);
    finishPanGesture();
  };

  viewport.addEventListener("pointerup", handlePanPointerEnd);
  viewport.addEventListener("pointercancel", handlePanPointerEnd);

  viewport.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        touchPanActive = true;
        touchPanChanged = false;
        lastTouchX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        lastTouchY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        event.preventDefault();
      }
    },
    { passive: false },
  );

  viewport.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
      if (!touchPanActive || event.touches.length !== 2) {
        return;
      }

      const currentX =
        (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const currentY =
        (event.touches[0].clientY + event.touches[1].clientY) / 2;
      const deltaX = currentX - lastTouchX;
      const deltaY = currentY - lastTouchY;
      state.visualOptions.panX += deltaX;
      state.visualOptions.panY += deltaY;
      if (deltaX !== 0 || deltaY !== 0) {
        touchPanChanged = true;
      }
      lastTouchX = currentX;
      lastTouchY = currentY;
      applyViewportTransform();
    },
    { passive: false },
  );

  viewport.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) {
      if (touchPanActive && touchPanChanged) {
        markVisualChange();
      }
      touchPanActive = false;
      touchPanChanged = false;
    }
  });

  document.addEventListener("mousemove", (event) => {
    if (isLabelDragging) {
      updateLabelDrag(event);
      return;
    }

    if (isLegendDragging) {
      updateLegendDrag(event);
      return;
    }

    if (isPanning && activePanPointerId !== null) {
      return;
    }

    if (!lastPointer) {
      return;
    }

    if (pendingVertexGesture) {
      event.preventDefault();
      const totalDx = event.clientX - pendingVertexGesture.startX;
      const totalDy = event.clientY - pendingVertexGesture.startY;
      const movedDistance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

      if (!isDraggingNodes && movedDistance > DRAG_THRESHOLD) {
        // Snapshot after the drag threshold prevents ordinary clicks from polluting history.
        pushUndoSnapshot("drag");
        isDraggingNodes = true;
        if (!pendingVertexGesture.element.classList.contains("selected")) {
          selectGraphElement(
            pendingVertexGesture.element,
            pendingVertexGesture.shiftKey,
          );
        }
      }

      if (!isDraggingNodes) {
        return;
      }

      moveDraggedVertices(event);
    } else if (isPanning) {
      updatePanDrag(event);
    } else if (isRubberBanding) {
      event.preventDefault();
      updateRubberBand(event);
    }
  });

  document.addEventListener("mouseup", () => {
    if (isLabelDragging) {
      finishLabelDrag();
      return;
    }

    if (isLegendDragging) {
      finishLegendDrag();
      return;
    }

    if (pendingVertexGesture) {
      if (isDraggingNodes) {
        commitMovedVertexPositions();
        markUnsavedChanges();
        suppressUpcomingSvgClick();
      } else {
        movedVertexIndices.clear();
        selectGraphElement(
          pendingVertexGesture.element,
          pendingVertexGesture.shiftKey,
        );
        suppressUpcomingSvgClick();
      }

      pendingVertexGesture = null;
      dragOffset = {};
      isDraggingNodes = false;
      lastPointer = null;
      return;
    }

    if (isRubberBanding) {
      finishRubberBand();
    }
    isDraggingNodes = false;
    if (isPanning && activePanPointerId !== null) {
      return;
    }
    finishPanGesture();
  });
}

// ─── Save / Load ──────────────────────────────────────────────────────────

/**
 * Starts periodic auto-save outside the test environment.
 */
function startAutoSaveTimer() {
  if (autoSaveTimer || typeof window === "undefined" || isTestEnvironment()) {
    return;
  }

  autoSaveTimer = window.setInterval(() => {
    if (state.graph) {
      autoSaveCurrentState("Auto-saved");
    }
  }, AUTO_SAVE_INTERVAL);
}

// ─── Toolbar and UI wiring ────────────────────────────────────────────────

/**
 * Wires global keyboard shortcuts for save, undo, zoom, pan, and dismissal.
 */
function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.repeat) {
      if (event.target?.matches?.("input, textarea, button, select")) {
        return;
      }
      event.preventDefault();
      spacePanMode = true;
      byId("viewport")?.classList.add("pan-ready");
      return;
    }

    if (event.key === "Escape") {
      closeMenusAndModals();
      clearSelection();
      return;
    }

    if (event.key === "p" || event.key === "P") {
      if (document.activeElement?.tagName === "INPUT") {
        return;
      }
      event.preventDefault();
      togglePanMode();
      return;
    }

    if (!event.ctrlKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      redo();
    } else if (key === "s") {
      event.preventDefault();
      if (event.shiftKey) {
        saveAsProject();
      } else {
        save();
      }
    } else if (event.key === "0") {
      event.preventDefault();
      zoomFit();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomIn();
    } else if (event.key === "-") {
      event.preventDefault();
      zoomOut();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spacePanMode = false;
      byId("viewport")?.classList.remove("pan-ready");
      if (!isMiddleButtonPanning) {
        endPan();
      }
    }
  });
}

/**
 * Initializes the UI controller and returns the shared application state.
 */
export function initNetworkView() {
  ensureAppShell();
  const app = byId("app");
  resetState();
  syncPanelState();
  syncStatusBar();

  if (app?.dataset.networkViewInitialized === "true") {
    syncVisualsPanel();
    renderAlgorithmParams();
    syncPanModeState();
    return state;
  }

  renderVisualsPanel();
  syncVisualsPanel();
  renderAlgorithmParams();
  syncPanModeState();

  wireFileInputs();
  wireToolbar();
  wirePanels();
  initVisualsPanel();
  wirePanelResize();
  wireDataTabs();
  wireModals();
  wireZoomControls();
  wireResizeObserver();
  wireViewportFileDrop();
  wireViewportInteractions();
  wireKeyboardShortcuts();
  byId("progress-cancel")?.addEventListener("click", (event) => {
    cancelComputation();
    blurClickedControl(event);
  });
  startAutoSaveTimer();
  maybeOfferSessionRestore();
  if (app) {
    app.dataset.networkViewInitialized = "true";
  }
  return state;
}

initNetworkView();
