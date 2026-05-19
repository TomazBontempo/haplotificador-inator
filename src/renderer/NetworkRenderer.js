import { renderEdgeItem } from "./EdgeItem.js";
import { renderVertexItem } from "./VertexItem.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_OPTIONS = Object.freeze({
  width: 1000,
  height: 1000,
  background: {
    color: "#ffffff",
  },
  edges: {
    color: "#666666",
    width: 1.5,
    labelColor: "#333333",
    showLabels: true,
  },
  vertices: {
    defaultColor: "#999999",
    inferredColor: "#333333",
    traitColors: [],
    strokeColor: "#333333",
    labelColor: "#333333",
  },
  baseRadius: 10,
  zoom: 1,
  panX: 0,
  panY: 0,
});

function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

function assertGraphLike(graph) {
  if (!graph || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
    throw new Error("NetworkRenderer error: expected a Graph instance.");
  }
}

function normalizeOptions(options) {
  const edges = {
    ...DEFAULT_OPTIONS.edges,
    ...(options.edges ?? {}),
  };
  const vertices = {
    ...DEFAULT_OPTIONS.vertices,
    ...(options.vertices ?? {}),
  };

  if (Array.isArray(options.traitColors)) {
    vertices.traitColors = options.traitColors;
  }
  if (options.showEdgeLabels !== undefined) {
    edges.showLabels = options.showEdgeLabels;
  }

  return {
    ...DEFAULT_OPTIONS,
    ...options,
    background: {
      ...DEFAULT_OPTIONS.background,
      ...(options.background ?? {}),
    },
    edges,
    vertices,
  };
}

export function renderNetwork(graph, options = {}) {
  assertGraphLike(graph);

  const normalizedOptions = normalizeOptions(options);
  const svg = createSvgElement("svg");
  svg.setAttribute("xmlns", SVG_NS);
  const useResponsiveSize =
    normalizedOptions.width === DEFAULT_OPTIONS.width &&
    normalizedOptions.height === DEFAULT_OPTIONS.height;
  svg.setAttribute("width", useResponsiveSize ? "100%" : String(normalizedOptions.width));
  svg.setAttribute("height", useResponsiveSize ? "100%" : String(normalizedOptions.height));
  svg.setAttribute("viewBox", `0 0 ${normalizedOptions.width} ${normalizedOptions.height}`);

  const viewportGroup = createSvgElement("g");
  viewportGroup.setAttribute("class", "viewport");
  viewportGroup.setAttribute(
    "transform",
    `translate(${normalizedOptions.panX}, ${normalizedOptions.panY}) scale(${normalizedOptions.zoom})`,
  );
  svg.appendChild(viewportGroup);

  const edgesGroup = createSvgElement("g");
  edgesGroup.setAttribute("class", "edges");
  viewportGroup.appendChild(edgesGroup);

  for (const edge of graph.edges) {
    edgesGroup.appendChild(renderEdgeItem(edge, normalizedOptions));
  }

  const verticesGroup = createSvgElement("g");
  verticesGroup.setAttribute("class", "vertices");
  viewportGroup.appendChild(verticesGroup);

  for (const vertex of graph.vertices) {
    verticesGroup.appendChild(renderVertexItem(vertex, normalizedOptions));
  }

  return svg;
}

export default renderNetwork;
