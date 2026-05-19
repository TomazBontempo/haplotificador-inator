import Graph from "../model/Graph.js";
import HapNet from "../model/HapNet.js";
import { applyUndefinedSiteMask } from "../model/SiteMask.js";
import { parseNexus } from "../parser/NexusParser.js";
import { renderNetwork } from "../renderer/NetworkRenderer.js";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.2;
const DRAG_THRESHOLD = 5;
const AUTO_SAVE_INTERVAL = 300000;
const SVG_NS = "http://www.w3.org/2000/svg";

const defaultDependencies = {
  parseNexus,
  applyUndefinedSiteMask,
  HapNet,
  Graph,
  renderNetwork,
  exportSVG: async (...args) => (await import("../export/Exporter.js")).exportSVG(...args),
  exportPNG: async (...args) => (await import("../export/Exporter.js")).exportPNG(...args),
  exportPDF: async (...args) => (await import("../export/Exporter.js")).exportPDF(...args),
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
let suppressNextSvgClick = false;

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
      edges: { color: "#666666", width: 1.5, labelColor: "#333333", showLabels: true },
      vertices: { defaultColor: "#999999", inferredColor: "#333333", traitColors: [] },
      baseRadius: 10,
      zoom: 1,
      panX: 0,
      panY: 0,
    },
    dataPanelCollapsed: false,
    propsPanelCollapsed: false,
    selectedElements: [],
    maskedSites: 0,
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
}

function appShell() {
  return `
    <div id="app">
      <nav id="toolbar">
        <div class="menu-wrapper">
          <button id="file-menu-btn" type="button">File</button>
          <div id="file-menu" class="dropdown-menu hidden">
            <button id="open-nex" type="button">Open .nex file</button>
            <button id="open-hapnet" type="button">Open .hapnet file</button>
            <hr>
            <button id="save" type="button">Save&nbsp;&nbsp;Ctrl+S</button>
            <button id="save-as" type="button">Save As&nbsp;&nbsp;Ctrl+Shift+S</button>
          </div>
        </div>
        <button id="algorithm-menu-btn" type="button">Algorithm</button>
        <button id="save-btn" type="button" title="Save (Ctrl+S)">💾</button>
        <button id="save-as-btn" type="button" title="Save As (Ctrl+Shift+S)">💾+</button>
        <button id="export-btn" type="button">Export</button>
        <input id="nex-file-input" class="hidden" type="file" accept=".nex,.nexus">
        <input id="hapnet-file-input" class="hidden" type="file" accept=".hapnet">
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
            <p id="export-warning" class="hidden warning">For publication quality, use at least 3000×3000</p>
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
      </nav>
      <div id="main">
        <aside id="data-panel">
          <button id="collapse-data" type="button">◀</button>
          <div id="data-content">
            <h2>Data View</h2>
          </div>
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
          <button id="collapse-props" type="button">▶</button>
          <div id="props-content">
            <p>Select a node or edge to see properties</p>
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
          <p id="progress-stage">Parsing file...</p>
          <progress id="progress-bar" value="0" max="100"></progress>
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

function setProgress(stage, value = null, indeterminate = false) {
  const overlay = byId("progress-overlay");
  const stageElement = byId("progress-stage");
  const progressBar = byId("progress-bar");

  setHidden(overlay, false);
  if (stageElement) {
    stageElement.textContent = stage;
  }
  if (progressBar) {
    progressBar.classList.toggle("indeterminate", indeterminate);
    if (value === null) {
      progressBar.removeAttribute("value");
    } else {
      progressBar.value = value;
    }
  }
}

function hideProgress() {
  const progressBar = byId("progress-bar");
  progressBar?.classList.remove("indeterminate");
  if (progressBar) {
    progressBar.value = 0;
  }
  setHidden(byId("progress-overlay"), true);
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
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
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
  if (!graphJSON || !Array.isArray(graphJSON.vertices) || !Array.isArray(graphJSON.edges)) {
    return null;
  }

  const graph = new dependencies.Graph();
  const vertices = [...graphJSON.vertices].sort((left, right) => left.index - right.index);

  for (const vertexJSON of vertices) {
    const vertex = graph.addVertex(vertexJSON.label ?? "", vertexJSON.info ?? null);
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

  const edges = [...graphJSON.edges].sort((left, right) => left.index - right.index);
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

export function buildSaveState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    originalFilename: state.currentFile?.name ?? null,
    algorithm: state.algorithm,
    algorithmParams: { ...state.algorithmParams },
    graph: serializeGraph(state.graph),
    visual: JSON.parse(JSON.stringify(state.visualOptions)),
    visualOptions: JSON.parse(JSON.stringify(state.visualOptions)),
    maskedSites: state.maskedSites,
    hapNet: state.hapNet ? { nseqs: state.hapNet.nseqs } : null,
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
  } else {
    await storage.autoSave(saveState);
  }

  state.lastSaved = new Date();
  state.saveStatus = "Saved";
  state.hasUnsavedChanges = false;
  syncStatusBar();
}

export async function saveAsProject() {
  const storage = await getStorageModule();
  const fileHandle = await storage.saveAs(buildSaveState());

  if (fileHandle) {
    state.saveHandle = fileHandle;
    state.lastSaved = new Date();
    state.saveStatus = "Saved";
    state.hasUnsavedChanges = false;
    syncStatusBar();
  }

  return fileHandle;
}

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function setZoom(value) {
  state.visualOptions.zoom = clampZoom(value);
  applyViewportTransform();
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
  return baseRadius * Math.sqrt(Math.max(0, Number.isFinite(frequency) ? frequency : 1));
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
  const scaleX = bounds.width > 0 ? innerWidth / bounds.width : Number.POSITIVE_INFINITY;
  const scaleY = bounds.height > 0 ? innerHeight / bounds.height : Number.POSITIVE_INFINITY;
  const scale = Number.isFinite(Math.min(scaleX, scaleY)) ? Math.min(scaleX, scaleY) : 1;
  const zoom = clampZoom(scale);

  state.visualOptions.zoom = zoom;
  state.visualOptions.panX = (width - bounds.width * zoom) / 2 - bounds.minX * zoom;
  state.visualOptions.panY = (height - bounds.height * zoom) / 2 - bounds.minY * zoom;
  applyViewportTransform();
}

function applyViewportTransform() {
  const svg = byId("svg-container")?.querySelector("svg");
  if (!svg) {
    return;
  }

  const { zoom, panX, panY } = state.visualOptions;
  const viewportGroup = svg.querySelector("g.viewport");
  if (viewportGroup) {
    viewportGroup.setAttribute("transform", `translate(${panX}, ${panY}) scale(${zoom})`);
  }
}

function syncPanelState() {
  const dataPanel = byId("data-panel");
  const propsPanel = byId("properties-panel");
  const collapseData = byId("collapse-data");
  const collapseProps = byId("collapse-props");
  const app = byId("app");

  dataPanel?.classList.toggle("collapsed", state.dataPanelCollapsed);
  propsPanel?.classList.toggle("collapsed", state.propsPanelCollapsed);

  if (collapseData) {
    collapseData.textContent = state.dataPanelCollapsed ? "▶" : "◀";
  }
  if (collapseProps) {
    collapseProps.textContent = state.propsPanelCollapsed ? "◀" : "▶";
  }
  if (app) {
    app.style.setProperty("--data-panel-width", state.dataPanelCollapsed ? "0px" : "240px");
    app.style.setProperty("--props-panel-width", state.propsPanelCollapsed ? "0px" : "240px");
  }
}

function syncStatusBar() {
  const filename = state.currentFile?.name ?? "No file loaded";
  byId("status-filename").textContent = filename;
  byId("status-algorithm").textContent = state.graph ? state.algorithm : "—";
  byId("status-haplotypes").textContent = Number.isFinite(state.hapNet?.nseqs) ? String(state.hapNet.nseqs) : "—";
  byId("status-edges").textContent = Array.isArray(state.graph?.edges) ? String(state.graph.edges.length) : "—";
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

function createModuleWorker(relativePath) {
  if (!dependencies.WorkerClass) {
    throw new Error("Web Workers are not supported in this browser.");
  }
  return new dependencies.WorkerClass(new URL(relativePath, import.meta.url), { type: "module" });
}

function terminateWorkers() {
  algorithmWorker?.terminate();
  layoutWorker?.terminate();
  algorithmWorker = null;
  layoutWorker = null;
}

function cancelComputation() {
  terminateWorkers();
  hideProgress();
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
  if (!state.graph) {
    return null;
  }

  const container = byId("svg-container");
  const svg = dependencies.renderNetwork(state.graph, state.visualOptions);
  container?.replaceChildren(svg);
  applyViewportTransform();
  wireSvgInteractions(svg);
  return svg;
}

async function autoSaveCurrentState(status = "Auto-saved") {
  if (!state.graph || !state.hasUnsavedChanges) {
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

export async function runCurrentPipeline() {
  if (!state.currentFile) {
    showMessage("Open a .nex file before running an algorithm.");
    return;
  }

  terminateWorkers();
  try {
    setProgress("Parsing file...", 20);
    const text = await readFileText(state.currentFile);
    const parsed = dependencies.parseNexus(text);
    state.parsedNexus = parsed;

    const { mask, masked } = dependencies.applyUndefinedSiteMask(parsed);
    state.maskedSites = masked;
    syncStatusBar();

    setProgress("Building model...", 40);
    const hapNet = new dependencies.HapNet(parsed, masked > 0 ? { mask } : {});
    state.hapNet = hapNet;

    algorithmWorker = createModuleWorker("../workers/algorithmWorker.js");
    setProgress(`Running ${state.algorithm}...`, null, true);
    const algorithmGraphJSON = await workerResult(algorithmWorker, {
      algorithm: state.algorithm,
      hapNetJSON: hapNet.toJSON(),
      params: state.algorithmParams,
    });
    algorithmWorker.terminate();
    algorithmWorker = null;

    setProgress("Computing layout...", 70);
    setProgress("Computing layout...", null, true);
    layoutWorker = createModuleWorker("../workers/layoutWorker.js");
    const layoutGraphJSON = await workerResult(layoutWorker, {
      graphJSON: algorithmGraphJSON,
      options: { width: 1000, height: 1000 },
    });
    layoutWorker.terminate();
    layoutWorker = null;

    state.graph = reconstructGraph(layoutGraphJSON);
    state.visualOptions.width = 1000;
    state.visualOptions.height = 1000;
    setProgress("Rendering network...", 90);
    renderGraph();
    setProgress("Rendering network...", 100);
    markUnsavedChanges();
    syncStatusBar();

    await new Promise((resolve) => setTimeout(resolve, 300));
    hideProgress();
  } catch (error) {
    terminateWorkers();
    hideProgress();
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
      const confirmed = window.confirm("Starting a new project will clear your current saves. Continue?");
      if (!confirmed) {
        return;
      }
      await storage.clearAutoSave();
    }
  } catch (error) {
    console.warn(error);
  }

  state.currentFile = file;
  state.parsedNexus = null;
  state.hapNet = null;
  state.graph = null;
  state.maskedSites = 0;
  state.saveHandle = null;
  state.lastSaved = null;
  state.saveStatus = "Unsaved changes";
  state.hasUnsavedChanges = true;
  showMessage("Select an algorithm and click OK to run the network");
  syncStatusBar();
}

function sampledVertexCount(graph) {
  return graph?.vertices?.filter((vertex) => vertex.info?.sampled !== false).length ?? 0;
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
  state.visualOptions = {
    ...state.visualOptions,
    ...(savedState.visualOptions ?? savedState.visual ?? {}),
  };
  state.maskedSites = savedState.maskedSites ?? 0;
  state.graph = reconstructGraph(savedState.graph);
  state.hapNet = savedState.hapNet ?? (state.graph ? { nseqs: sampledVertexCount(state.graph) } : null);
  state.lastSaved = savedState.savedAt ? new Date(savedState.savedAt) : null;
  state.saveStatus = status;
  state.hasUnsavedChanges = false;
  renderGraph();
  syncStatusBar();
}

async function loadSavedProject() {
  try {
    if (state.graph) {
      const saveFirst = window.confirm("You have unsaved changes. Save before continuing?");
      if (saveFirst) {
        await save();
      } else if (!window.confirm("Discard current state and continue?")) {
        return;
      }
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
    x: ((event.clientX - rect.left) / scale.x - state.visualOptions.panX) / state.visualOptions.zoom,
    y: ((event.clientY - rect.top) / scale.y - state.visualOptions.panY) / state.visualOptions.zoom,
  };
}

function clearSelection() {
  currentSvg()?.querySelectorAll(".selected").forEach((element) => {
    element.classList.remove("selected");
  });
  state.selectedElements = [];
  const propsContent = byId("props-content");
  if (propsContent) {
    propsContent.innerHTML = "<p>Select a node or edge to see properties</p>";
  }
}

function selectedVertexElements() {
  return state.selectedElements.filter((element) => element.classList?.contains("vertex"));
}

function updatePropertiesPanel(element) {
  const propsContent = byId("props-content");
  if (!propsContent) {
    return;
  }

  if (element.classList.contains("vertex")) {
    const vertex = state.graph?.vertices[Number(element.dataset.index)];
    const info = vertex?.info ?? {};
    const traits = Array.isArray(info.traits) ? info.traits : [];
    propsContent.innerHTML = `
      <h2>${info.name ?? vertex?.label ?? "Vertex"}</h2>
      <p>Frequency: ${info.frequency ?? 0}</p>
      <p>Traits: ${traits.length ? traits.join(", ") : "—"}</p>
    `;
  } else if (element.classList.contains("edge")) {
    const edge = state.graph?.edges[Number(element.dataset.index)];
    propsContent.innerHTML = `
      <h2>Edge</h2>
      <p>Weight: ${edge?.weight ?? edge?.info?.weight ?? "—"}</p>
    `;
  }
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
  const edgeElement = currentSvg()?.querySelector(`.edge[data-index="${edge.index}"]`);
  const line = edgeElement?.querySelector("line");
  if (!line) {
    return;
  }
  line.setAttribute("x1", String(edge.from.x ?? 0));
  line.setAttribute("y1", String(edge.from.y ?? 0));
  line.setAttribute("x2", String(edge.to.x ?? 0));
  line.setAttribute("y2", String(edge.to.y ?? 0));

  const label = edgeElement.querySelector(".edge-label");
  if (label) {
    label.setAttribute("x", String(((edge.from.x ?? 0) + (edge.to.x ?? 0)) / 2));
    label.setAttribute("y", String(((edge.from.y ?? 0) + (edge.to.y ?? 0)) / 2));
  }
}

function moveSelectedVertices(dx, dy) {
  const movedEdges = new Set();
  for (const element of selectedVertexElements()) {
    const vertex = state.graph?.vertices[Number(element.dataset.index)];
    if (!vertex) {
      continue;
    }

    vertex.x = (vertex.x ?? 0) + dx;
    vertex.y = (vertex.y ?? 0) + dy;
    element.setAttribute("transform", `translate(${vertex.x}, ${vertex.y})`);
    for (const edge of vertex.incidentEdges ?? []) {
      movedEdges.add(edge);
    }
  }

  for (const edge of movedEdges) {
    updateEdgeElement(edge);
  }
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
  rubberBandRect.setAttribute("width", String(Math.abs(point.x - rubberBandStart.x)));
  rubberBandRect.setAttribute("height", String(Math.abs(point.y - rubberBandStart.y)));
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
      const element = currentSvg()?.querySelector(`.vertex[data-index="${vertex.index}"]`);
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

    const vertexElement = event.target.closest?.(".vertex");
    const edgeElement = event.target.closest?.(".edge");
    lastPointer = { x: event.clientX, y: event.clientY };

    if (vertexElement) {
      pendingVertexGesture = {
        element: vertexElement,
        shiftKey: event.shiftKey,
        startX: event.clientX,
        startY: event.clientY,
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
  const input = document.querySelector(`input[name="algorithm"][value="${state.algorithm}"]`);
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
    state.algorithmParams.epsilon = Number(byId("algorithm-epsilon")?.value ?? 0);
  } else if (algorithm === "IntNJ") {
    state.algorithmParams.alpha = Number(byId("algorithm-alpha")?.value ?? 0.5);
  }

  setHidden(byId("algorithm-modal"), true);
  if (state.currentFile?.name?.toLowerCase().endsWith(".nex") || state.currentFile?.name?.toLowerCase().endsWith(".nexus")) {
    runCurrentPipeline();
  }
}

function updateExportWarning() {
  const width = Number(byId("export-width")?.value ?? 2000);
  const height = Number(byId("export-height")?.value ?? 2000);
  setHidden(byId("export-warning"), width >= 3000 && height >= 3000);
}

function openExportModal() {
  updateExportWarning();
  setHidden(byId("export-modal"), false);
}

async function exportCurrentNetwork() {
  if (!state.graph) {
    setHidden(byId("export-modal"), true);
    return;
  }

  const format = document.querySelector('input[name="export-format"]:checked')?.value ?? "PNG";
  const exportOptions = {
    filename: filenameBase(),
    width: Number(byId("export-width")?.value ?? 2000),
    height: Number(byId("export-height")?.value ?? 2000),
    transparent: Boolean(byId("export-transparent")?.checked),
  };

  if (format === "SVG") {
    await dependencies.exportSVG(state.graph, state.visualOptions, exportOptions);
  } else if (format === "PDF") {
    await dependencies.exportPDF(state.graph, state.visualOptions, exportOptions);
  } else {
    await dependencies.exportPNG(state.graph, state.visualOptions, exportOptions);
  }

  setHidden(byId("export-modal"), true);
}

function wireFileInputs() {
  const nexInput = byId("nex-file-input");
  const hapnetInput = byId("hapnet-file-input");

  byId("open-nex")?.addEventListener("click", () => {
    closeFileMenu();
    nexInput?.click();
  });
  byId("open-hapnet")?.addEventListener("click", () => {
    closeFileMenu();
    loadSavedProject();
  });

  nexInput?.addEventListener("change", () => {
    handleNexusFileSelected(nexInput.files?.[0] ?? null);
  });
  hapnetInput?.addEventListener("change", () => {});
}

function wireToolbar() {
  const fileMenu = byId("file-menu");
  const fileMenuButton = byId("file-menu-btn");

  fileMenuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFileMenu();
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

  byId("algorithm-menu-btn")?.addEventListener("click", openAlgorithmModal);
  byId("save")?.addEventListener("click", () => {
    closeFileMenu();
    save();
  });
  byId("save-btn")?.addEventListener("click", save);
  byId("save-as")?.addEventListener("click", () => {
    closeFileMenu();
    saveAsProject();
  });
  byId("save-as-btn")?.addEventListener("click", saveAsProject);
  byId("export-btn")?.addEventListener("click", openExportModal);
}

function wirePanels() {
  byId("collapse-data")?.addEventListener("click", () => {
    state.dataPanelCollapsed = !state.dataPanelCollapsed;
    syncPanelState();
  });

  byId("collapse-props")?.addEventListener("click", () => {
    state.propsPanelCollapsed = !state.propsPanelCollapsed;
    syncPanelState();
  });
}

function wireModals() {
  document.querySelectorAll('input[name="algorithm"]').forEach((input) => {
    input.addEventListener("change", renderAlgorithmParams);
  });

  byId("algorithm-ok")?.addEventListener("click", storeAlgorithmSelection);
  byId("algorithm-cancel")?.addEventListener("click", () => {
    setHidden(byId("algorithm-modal"), true);
  });

  byId("export-width")?.addEventListener("input", updateExportWarning);
  byId("export-height")?.addEventListener("input", updateExportWarning);
  byId("export-confirm")?.addEventListener("click", exportCurrentNetwork);
  byId("export-cancel")?.addEventListener("click", () => {
    setHidden(byId("export-modal"), true);
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
    const restore = () => {
      cleanup();
      resolve(true);
    };
    const startFresh = () => {
      cleanup();
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
  byId("zoom-in")?.addEventListener("click", zoomIn);
  byId("zoom-out")?.addEventListener("click", zoomOut);
  byId("zoom-fit")?.addEventListener("click", zoomFit);
}

function wireResizeObserver() {
  const container = byId("svg-container");
  if (!container || typeof ResizeObserver === "undefined" || svgContainerResizeObserver) {
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
  lastPointer = { x: event.clientX, y: event.clientY };
  byId("viewport")?.classList.add("panning");
}

function endPan() {
  isPanning = false;
  isMiddleButtonPanning = false;
  byId("viewport")?.classList.toggle("panning", spacePanMode);
}

function wireViewportInteractions() {
  const viewport = byId("viewport");
  if (!viewport) {
    return;
  }

  viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    setZoom(state.visualOptions.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }, { passive: false });

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
        isDraggingNodes = true;
        if (!pendingVertexGesture.element.classList.contains("selected")) {
          selectGraphElement(pendingVertexGesture.element, pendingVertexGesture.shiftKey);
        }
      }

      if (!isDraggingNodes) {
        return;
      }

      const delta = screenDeltaToGraphDelta(dx, dy);
      moveSelectedVertices(delta.x, delta.y);
    } else if (isPanning) {
      const delta = screenDeltaToViewportDelta(dx, dy);
      state.visualOptions.panX += delta.x;
      state.visualOptions.panY += delta.y;
      applyViewportTransform();
    } else if (isRubberBanding) {
      event.preventDefault();
      updateRubberBand(event);
    }
  });

  document.addEventListener("mouseup", () => {
    if (pendingVertexGesture) {
      if (isDraggingNodes) {
        markUnsavedChanges();
        suppressUpcomingSvgClick();
      } else {
        selectGraphElement(pendingVertexGesture.element, pendingVertexGesture.shiftKey);
        suppressUpcomingSvgClick();
      }

      pendingVertexGesture = null;
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
      endPan();
    }
  });
}

function startAutoSaveTimer() {
  if (autoSaveTimer || typeof window === "undefined" || isTestEnvironment()) {
    return;
  }

  autoSaveTimer = window.setInterval(() => {
    if (state.graph && state.hasUnsavedChanges) {
      autoSaveCurrentState("Auto-saved");
    }
  }, AUTO_SAVE_INTERVAL);
}

function wireKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.repeat) {
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
    if (key === "s") {
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
  renderAlgorithmParams();

  if (app?.dataset.networkViewInitialized === "true") {
    return state;
  }

  wireFileInputs();
  wireToolbar();
  wirePanels();
  wireModals();
  wireZoomControls();
  wireResizeObserver();
  wireViewportInteractions();
  wireKeyboardShortcuts();
  byId("progress-cancel")?.addEventListener("click", cancelComputation);
  startAutoSaveTimer();
  maybeOfferSessionRestore();
  if (app) {
    app.dataset.networkViewInitialized = "true";
  }
  return state;
}

initNetworkView();
