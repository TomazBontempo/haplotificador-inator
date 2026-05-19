const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_EDGE_COLOR = "#666666";
const DEFAULT_EDGE_WIDTH = 1.5;
const DEFAULT_LABEL_COLOR = "#333333";

function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function renderEdgeItem(edge, options = {}) {
  const edgeOptions = options.edges ?? {};
  const showEdgeLabels = edgeOptions.showLabels ?? options.showEdgeLabels ?? true;
  const edgeColor = edgeOptions.color ?? DEFAULT_EDGE_COLOR;
  const edgeWidth = numericValue(edgeOptions.width, DEFAULT_EDGE_WIDTH);
  const labelColor = edgeOptions.labelColor ?? DEFAULT_LABEL_COLOR;
  const weight = numericValue(edge.weight ?? edge.info?.weight, 1);
  const fromX = numericValue(edge.from?.x, 0);
  const fromY = numericValue(edge.from?.y, 0);
  const toX = numericValue(edge.to?.x, 0);
  const toY = numericValue(edge.to?.y, 0);

  const group = createSvgElement("g");
  group.setAttribute("class", "edge");
  group.setAttribute("data-index", String(edge.index ?? ""));

  const line = createSvgElement("line");
  line.setAttribute("x1", String(fromX));
  line.setAttribute("y1", String(fromY));
  line.setAttribute("x2", String(toX));
  line.setAttribute("y2", String(toY));
  line.setAttribute("stroke", edgeColor);
  line.setAttribute("stroke-width", String(edgeWidth));
  group.appendChild(line);

  if (showEdgeLabels && weight > 1) {
    const label = createSvgElement("text");
    label.textContent = String(weight);
    label.setAttribute("x", String((fromX + toX) / 2));
    label.setAttribute("y", String((fromY + toY) / 2));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("font-size", "10px");
    label.setAttribute("fill", labelColor);
    label.setAttribute("class", "edge-label");
    group.appendChild(label);
  }

  return group;
}

export default renderEdgeItem;
