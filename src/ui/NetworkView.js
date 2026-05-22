import Graph from "../model/Graph.js";
import HapNet from "../model/HapNet.js";
import { applyUndefinedSiteMask } from "../model/SiteMask.js";
import { parseNexus } from "../parser/NexusParser.js";
import { renderEdgeItem } from "../renderer/EdgeItem.js";
import { renderNetwork } from "../renderer/NetworkRenderer.js";
import { schemeSet3, schemeTableau10 } from "d3-scale-chromatic";

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

export function __setNetworkViewDependencies(overrides = {}) {
  dependencies = { ...dependencies, ...overrides };
}

export function __resetNetworkViewDependencies() {
  dependencies = { ...defaultDependencies };
}

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
    maskedSites: 0,
    maskedSiteIndices: [],
    saveHandle: null,
    lastSaved: null,
    saveStatus: null,
    hasUnsavedChanges: false,
  };
}

export const state = createInitialState();

function resetState() {
  const next = createInitialState();
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, next);
  dataPanelWidth = DEFAULT_PANEL_WIDTH;
  propsPanelWidth = DEFAULT_PANEL_WIDTH;
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

function renderVisualsPanel() {
  const propsContent = byId("props-content");
  if (propsContent) {
    propsContent.innerHTML = visualsPanelMarkup();
  }
}

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
          </div>
        </div>
        <button id="algorithm-menu-btn" type="button">Algorithm</button>
        <button id="save-btn" type="button" title="Save (Ctrl+S)">💾</button>
        <button id="save-as-btn" type="button" title="Save As (Ctrl+Shift+S)">💾+</button>
        <button id="export-btn" type="button">Export</button>
        <button id="undo-btn" type="button" title="Undo (Ctrl+Z)" disabled>↩</button>
        <button id="redo-btn" type="button" title="Redo (Ctrl+Shift+Z)" disabled>↪</button>
        <div id="toolbar-right">
          <button id="toggle-labels" class="toggle-btn active" title="Show/hide node labels">
            👁 Labels
          </button>
          <button id="toggle-legend" class="toggle-btn active" title="Show/hide legend">
            👁 Legend
          </button>
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
            <p>Open a .nex file and run an algorithm to see the network</p>
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

function ensureAppShell() {
  if (!document.getElementById("app")) {
    document.body.innerHTML = appShell();
  }
}

function byId(id) {
  return document.getElementById(id);
}

function blurClickedControl(event) {
  event.currentTarget?.blur?.();
}

function setHidden(element, hidden) {
  element?.classList.toggle("hidden", hidden);
}

function getStorageModule() {
  if (dependencies.storage) {
    return Promise.resolve(dependencies.storage);
  }
  if (!storageModulePromise) {
    storageModulePromise = import("../storage/ProjectStorage.js");
  }
  return storageModulePromise;
}

function showMessage(message) {
  const container = byId("svg-container");
  if (container) {
    container.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    container.appendChild(paragraph);
  }
}

function clearProgressDotsInterval() {
  if (progressDotsInterval) {
    clearInterval(progressDotsInterval);
    progressDotsInterval = null;
  }
}

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

function showProgressOverlay() {
  const progressBarFill = byId("progress-bar-fill");
  const stageElement = byId("progress-stage-text");
  const dots = byId("progress-dots");

  setHidden(byId("progress-overlay"), false);
  if (progressBarFill) {
    progressBarFill.style.width = "0%";
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

function hideProgressOverlay() {
  const progressBarFill = byId("progress-bar-fill");

  setHidden(byId("progress-overlay"), true);
  clearProgressDotsInterval();
  progressDotIndex = 0;
  if (progressBarFill) {
    progressBarFill.style.width = "0%";
  }
}

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

function filenameBase() {
  const filename = state.currentFile?.name ?? "network";
  return filename.replace(/\.[^.]*$/, "") || "network";
}

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

function normalizeMaskedSiteIndices(indices) {
  if (!Array.isArray(indices)) {
    return [];
  }

  return indices.filter((index) => Number.isInteger(index) && index >= 0);
}

function restoreMaskedSiteIndices(savedState) {
  const savedIndices = normalizeMaskedSiteIndices(savedState.maskedSiteIndices);
  if (savedIndices.length > 0 || Array.isArray(savedState.maskedSiteIndices)) {
    return savedIndices;
  }

  if (!savedState.parsedNexus) {
    return [];
  }

  try {
    const { mask } = dependencies.applyUndefinedSiteMask(savedState.parsedNexus);
    return maskedSiteIndicesFromMask(mask);
  } catch (error) {
    console.warn(error);
    return [];
  }
}

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

function closeMenusAndModals() {
  setHidden(byId("file-menu"), true);
  setHidden(byId("algorithm-modal"), true);
  setHidden(byId("export-modal"), true);
  setHidden(byId("restore-modal"), true);
}

function closeFileMenu() {
  setHidden(byId("file-menu"), true);
}

function toggleFileMenu() {
  const fileMenu = byId("file-menu");
  if (fileMenu) {
    fileMenu.classList.toggle("hidden");
  }
}

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

export async function saveAsProject() {
  const storage = await getStorageModule();
  const fileHandle = await storage.saveAs(buildSaveState());

  if (fileHandle) {
    state.saveHandle = fileHandle;
    await storage.autoSave(buildSaveState());
    markSaved();
    syncStatusBar();
  }

  return fileHandle;
}

function markSaved(status = "Saved") {
  state.lastSaved = new Date();
  state.saveStatus = status;
  state.hasUnsavedChanges = false;
}

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function setZoom(value) {
  state.visualOptions.zoom = clampZoom(value);
  applyViewportTransform();
  markVisualChange();
}

function zoomIn() {
  setZoom(state.visualOptions.zoom + ZOOM_STEP);
}

function zoomOut() {
  setZoom(state.visualOptions.zoom - ZOOM_STEP);
}

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

function syncStatusBar() {
  const filename = state.currentFile?.name ?? "No file loaded";
  byId("status-filename").textContent = filename;
  byId("status-algorithm").textContent = state.graph ? state.algorithm : "—";
  byId("status-haplotypes").textContent = Number.isFinite(state.hapNet?.nseqs)
    ? String(state.hapNet.nseqs)
    : "—";
  byId("status-edges").textContent = Array.isArray(state.graph?.edges)
    ? String(state.graph.edges.length)
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

    const handle = await storage.saveAs(buildSaveState());
    if (!handle) {
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

function clearElement(element) {
  element?.replaceChildren();
}

function dataPlaceholder(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "data-placeholder";
  paragraph.textContent = message;
  return paragraph;
}

function numericTraitValue(values, index) {
  const value = Number(values?.[index] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function createDataCell(className, text) {
  const cell = document.createElement("div");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

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

  const view = document.createElement("div");
  view.className = "alignment-view";

  const namesColumn = document.createElement("div");
  namesColumn.className = "alignment-names";

  const sequenceWrapper = document.createElement("div");
  sequenceWrapper.className = "alignment-sequence-wrapper";
  const sequencesColumn = document.createElement("div");
  sequencesColumn.className = "alignment-sequences";

  for (const name of names) {
    if (!Object.hasOwn(matrix, name)) {
      continue;
    }

    const nameCell = document.createElement("div");
    nameCell.className = "alignment-name-cell";
    nameCell.textContent = name;
    namesColumn.appendChild(nameCell);

    const sequenceCell = document.createElement("div");
    sequenceCell.className = "alignment-sequence-cell";
    const sequence = String(matrix[name]).toUpperCase();
    for (let i = 0; i < sequence.length; i += 1) {
      const char = sequence[i];
      const span = document.createElement("span");
      span.className = getNucClass(char, i, maskedSiteIndices);
      span.textContent = char;
      sequenceCell.appendChild(span);
    }
    sequencesColumn.appendChild(sequenceCell);
  }

  sequenceWrapper.appendChild(sequencesColumn);
  view.append(namesColumn, sequenceWrapper);
  container.appendChild(view);
}

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

function createModuleWorker(relativePath) {
  if (!dependencies.WorkerClass) {
    throw new Error("Web Workers are not supported in this browser.");
  }
  return new dependencies.WorkerClass(new URL(relativePath, import.meta.url), {
    type: "module",
  });
}

function terminateWorkers() {
  algorithmWorker?.terminate();
  layoutWorker?.terminate();
  algorithmWorker = null;
  layoutWorker = null;
}

function cancelComputation() {
  terminateWorkers();
  hideProgressOverlay();
  showMessage("Computation cancelled.");
}

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

function renderGraph() {
  return rerenderNetwork();
}

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

function syncToggleButton(button, active, disabled = false) {
  if (!button) {
    return;
  }

  button.classList.toggle("active", active);
  button.disabled = disabled;
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

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

function toggleLabels(event) {
  state.visualOptions.showLabels = !(state.visualOptions.showLabels !== false);
  applyVisualVisibilityState();
  blurClickedControl(event);
  markVisualChange();
}

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

function markUnsavedChanges() {
  state.hasUnsavedChanges = true;
  state.saveStatus = "Unsaved changes";
  syncStatusBar();
}

function markVisualChange() {
  if (state.graph) {
    markUnsavedChanges();
  }
}

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

function trimUndoStack() {
  if (state.history.undoStack.length > 20) {
    state.history.undoStack.shift();
  }
}

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

function clearHistory() {
  state.history.undoStack = [];
  state.history.redoStack = [];
  updateUndoRedoButtons();
}

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

function edgeDisplayMode() {
  return state.visualOptions.edges?.displayMode === "ticks"
    ? "ticks"
    : "labels";
}

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

function initVisualsPanel() {
  byId("visual-edge-color")?.addEventListener("mousedown", () => {
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

    algorithmWorker = createModuleWorker("../workers/algorithmWorker.js");
    setProgressStage(3, "Running " + state.algorithm);
    const algorithmGraphJSON = await workerResult(algorithmWorker, {
      algorithm: state.algorithm,
      hapNetJSON: hapNet.toJSON(),
      params: state.algorithmParams,
    });
    algorithmWorker.terminate();
    algorithmWorker = null;

    setProgressStage(4, "Computing layout");
    layoutWorker = createModuleWorker("../workers/layoutWorker.js");
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

async function handleNexusFileSelected(file) {
  if (!file) {
    return;
  }

  try {
    const storage = await getStorageModule();
    if (await storage.hasAutoSave()) {
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

function handleOpenFileSelected(file) {
  if (!file) {
    return;
  }

  const filename = file.name.toLowerCase();
  if (filename.endsWith(".nex")) {
    handleNexusFileSelected(file);
    return;
  }
  if (filename.endsWith(".hapnet")) {
    handleSavedProjectFileSelected(file);
    return;
  }

  showMessage("Unsupported file format. Please open a .nex or .hapnet file.");
}

function sampledVertexCount(graph) {
  return (
    graph?.vertices?.filter((vertex) => vertex.info?.sampled !== false)
      .length ?? 0
  );
}

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

function currentSvg() {
  return byId("svg-container")?.querySelector("svg") ?? null;
}

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

function svgScreenScale() {
  const svg = currentSvg();
  const matrix = svg?.getScreenCTM?.();
  return {
    x: matrix?.a ? Math.abs(matrix.a) : 1,
    y: matrix?.d ? Math.abs(matrix.d) : 1,
  };
}

function screenDeltaToGraphDelta(dx, dy) {
  return {
    x: dx / state.visualOptions.zoom,
    y: dy / state.visualOptions.zoom,
  };
}

function screenDeltaToViewportDelta(dx, dy) {
  const scale = svgScreenScale();
  return {
    x: dx / scale.x,
    y: dy / scale.y,
  };
}

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
  return {
    x:
      ((event.clientX - rect.left) / scale.x - state.visualOptions.panX) /
      state.visualOptions.zoom,
    y:
      ((event.clientY - rect.top) / scale.y - state.visualOptions.panY) /
      state.visualOptions.zoom,
  };
}

function clearSelection() {
  currentSvg()
    ?.querySelectorAll(".selected")
    .forEach((element) => {
      element.classList.remove("selected");
    });
  state.selectedElements = [];
  syncVisualsPanel();
}

function selectedVertexElements() {
  return state.selectedElements.filter((element) =>
    element.classList?.contains("vertex"),
  );
}

function updatePropertiesPanel() {
  syncVisualsPanel();
}

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

function suppressUpcomingSvgClick() {
  suppressNextSvgClick = true;
  window.setTimeout(() => {
    suppressNextSvgClick = false;
  }, 0);
}

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

function vertexByIndex(index) {
  return (
    state.graph?.vertices?.find((vertex) => vertex.index === index) ?? null
  );
}

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

function labelElementFromEvent(event) {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest?.(".vertex-label") ?? null;
}

function numericLabelOffset(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function labelOffsetFromElement(labelElement) {
  return {
    x: numericLabelOffset(labelElement.getAttribute("x"), 0),
    y: numericLabelOffset(labelElement.getAttribute("y"), 0),
  };
}

function setLabelElementOffset(labelElement, offset) {
  labelElement?.setAttribute("x", String(offset.x));
  labelElement?.setAttribute("y", String(offset.y));
}

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
  pushUndoSnapshot("labelDrag");
  event.stopPropagation();
  event.preventDefault();
}

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

function handleLabelMousedown(event) {
  if (event.button !== 0) {
    return;
  }

  const labelElement = labelElementFromEvent(event);
  if (labelElement) {
    beginLabelDrag(event, labelElement);
  }
}

function setLegendTransform(position) {
  const legend = currentSvg()?.querySelector("#network-legend");
  if (!legend || !position) {
    return;
  }

  legend.setAttribute("transform", `translate(${position.x}, ${position.y})`);
}

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

  pushUndoSnapshot("legend");
  state.visualOptions.legendPosition = finalPosition;
  suppressUpcomingSvgClick();
  markVisualChange();
}

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
    suppressUpcomingSvgClick();
  }
}

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

    if (!edgeElement && !spacePanMode) {
      event.preventDefault();
      beginRubberBand(event);
    }
  });
}

function wireLabelInteractions(svg) {
  svg.querySelectorAll(".vertex-label").forEach((label) => {
    label.addEventListener("mousedown", handleLabelMousedown);
  });
}

function wireLegendInteractions(svg) {
  const legend = svg.querySelector("#network-legend");
  if (!legend) {
    return;
  }

  legend.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      beginLegendDrag(event);
    }
  });
}

function selectedAlgorithmInput() {
  return document.querySelector('input[name="algorithm"]:checked');
}

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

function openExportModal() {
  setHidden(byId("export-modal"), false);
}

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

function wireFileInputs() {
  const openInput = byId("open-file-input");

  byId("open-file")?.addEventListener("click", async (event) => {
    closeFileMenu();
    blurClickedControl(event);

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

    if (openInput) {
      openInput.value = "";
    }
    openInput?.click();
  });

  openInput?.addEventListener("change", () => {
    handleOpenFileSelected(openInput.files?.[0] ?? null);
  });
}

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
  byId("undo-btn")?.addEventListener("click", (event) => {
    undo();
    blurClickedControl(event);
  });
  byId("redo-btn")?.addEventListener("click", (event) => {
    redo();
    blurClickedControl(event);
  });
  byId("toggle-labels")?.addEventListener("click", toggleLabels);
  byId("toggle-legend")?.addEventListener("click", toggleLegend);
}

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
}

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

function isTestEnvironment() {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "test";
}

async function maybeOfferSessionRestore() {
  if (isTestEnvironment()) {
    return;
  }

  try {
    const storage = await getStorageModule();
    if (!(await storage.hasAutoSave())) {
      return;
    }

    if (await restoreDialogChoice()) {
      const savedState = await storage.loadAutoSave();
      if (savedState) {
        applySavedState(savedState, "Restored from auto-save");
      }
    } else {
      await storage.clearAutoSave();
      showMessage("Open a .nex file and run an algorithm to see the network");
      syncStatusBar();
    }
  } catch (error) {
    console.warn(error);
  }
}

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

function beginPan(event, middleButton = false) {
  isPanning = true;
  isMiddleButtonPanning = middleButton;
  panChanged = false;
  lastPointer = { x: event.clientX, y: event.clientY };
  byId("viewport")?.classList.add("panning");
}

function endPan() {
  isPanning = false;
  isMiddleButtonPanning = false;
  panChanged = false;
  byId("viewport")?.classList.toggle("panning", spacePanMode);
}

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
      setZoom(
        state.visualOptions.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP),
      );
    },
    { passive: false },
  );

  viewport.addEventListener("mousedown", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      beginPan(event, true);
    } else if (spacePanMode && event.button === 0) {
      event.preventDefault();
      beginPan(event);
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

    if (!lastPointer) {
      return;
    }
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };

    if (pendingVertexGesture) {
      event.preventDefault();
      const totalDx = event.clientX - pendingVertexGesture.startX;
      const totalDy = event.clientY - pendingVertexGesture.startY;
      const movedDistance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

      if (!isDraggingNodes && movedDistance > DRAG_THRESHOLD) {
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
      const delta = screenDeltaToViewportDelta(dx, dy);
      state.visualOptions.panX += delta.x;
      state.visualOptions.panY += delta.y;
      if (delta.x !== 0 || delta.y !== 0) {
        panChanged = true;
      }
      applyViewportTransform();
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
    lastPointer = null;
    if (isPanning || isMiddleButtonPanning) {
      if (panChanged) {
        markVisualChange();
      }
      endPan();
    }
  });
}

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

function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.repeat) {
      if (
        ["BUTTON", "INPUT", "SELECT"].includes(document.activeElement?.tagName)
      ) {
        return;
      }
      spacePanMode = true;
      byId("viewport")?.classList.add("pan-ready");
      return;
    }

    if (event.key === "Escape") {
      closeMenusAndModals();
      clearSelection();
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

export function initNetworkView() {
  ensureAppShell();
  const app = byId("app");
  resetState();
  syncPanelState();
  syncStatusBar();

  if (app?.dataset.networkViewInitialized === "true") {
    syncVisualsPanel();
    renderAlgorithmParams();
    return state;
  }

  renderVisualsPanel();
  syncVisualsPanel();
  renderAlgorithmParams();

  wireFileInputs();
  wireToolbar();
  wirePanels();
  initVisualsPanel();
  wirePanelResize();
  wireDataTabs();
  wireModals();
  wireZoomControls();
  wireResizeObserver();
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
