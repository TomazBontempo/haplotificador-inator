import { renderEdgeItem } from "./EdgeItem.js";
import { renderVertexItem } from "./VertexItem.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const DEFAULT_OPTIONS = Object.freeze({
  width: 1000,
  height: 1000,
  traitColors: [],
  showEdgeLabels: true,
  baseRadius: 10,
});

function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

function assertGraphLike(graph) {
  if (!graph || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
    throw new Error("NetworkRenderer error: expected a Graph instance.");
  }
}

export function renderNetwork(graph, options = {}) {
  assertGraphLike(graph);

  const normalizedOptions = { ...DEFAULT_OPTIONS, ...options };
  const svg = createSvgElement("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(normalizedOptions.width));
  svg.setAttribute("height", String(normalizedOptions.height));
  svg.setAttribute("viewBox", `0 0 ${normalizedOptions.width} ${normalizedOptions.height}`);

  const edgesGroup = createSvgElement("g");
  edgesGroup.setAttribute("class", "edges");
  svg.appendChild(edgesGroup);

  for (const edge of graph.edges) {
    edgesGroup.appendChild(renderEdgeItem(edge, normalizedOptions));
  }

  const verticesGroup = createSvgElement("g");
  verticesGroup.setAttribute("class", "vertices");
  svg.appendChild(verticesGroup);

  for (const vertex of graph.vertices) {
    verticesGroup.appendChild(
      renderVertexItem(vertex, normalizedOptions.traitColors, normalizedOptions),
    );
  }

  return svg;
}

export default renderNetwork;
