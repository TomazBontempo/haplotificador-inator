const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_EDGE_COLOR = "#666666";
const DEFAULT_EDGE_WIDTH = 1.5;
const DEFAULT_LABEL_COLOR = "#333333";
const LABEL_OFFSET = 10;
const TICK_LENGTH = 5;
const TICK_SPACING = 6;

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
  const displayMode = edgeOptions.displayMode ?? "labels";
  const edgeColor = edgeOptions.color ?? DEFAULT_EDGE_COLOR;
  const edgeWidth = numericValue(edgeOptions.width, DEFAULT_EDGE_WIDTH);
  const labelColor = edgeOptions.labelColor ?? DEFAULT_LABEL_COLOR;
  const weight = numericValue(edge.weight ?? edge.info?.weight, 1);
  const fromX = numericValue(edge.from?.x, 0);
  const fromY = numericValue(edge.from?.y, 0);
  const toX = numericValue(edge.to?.x, 0);
  const toY = numericValue(edge.to?.y, 0);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  const perpX = length > 0 ? -dy / length : 0;
  const perpY = length > 0 ? dx / length : -1;

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

  if (displayMode === "ticks" && length > 0) {
    const tickCount = Math.max(0, Math.floor(weight));
    const totalWidth = (tickCount - 1) * TICK_SPACING;
    const startT = 0.5 - (totalWidth / 2) / length;
    const stepT = TICK_SPACING / length;
    for (let index = 0; index < tickCount; index += 1) {
      const t = Math.min(0.9, Math.max(0.1, startT + index * stepT));
      const tickX = fromX + t * dx;
      const tickY = fromY + t * dy;
      const tick = createSvgElement("line");
      tick.setAttribute("x1", String(tickX - perpX * TICK_LENGTH));
      tick.setAttribute("y1", String(tickY - perpY * TICK_LENGTH));
      tick.setAttribute("x2", String(tickX + perpX * TICK_LENGTH));
      tick.setAttribute("y2", String(tickY + perpY * TICK_LENGTH));
      tick.setAttribute("stroke", edgeColor);
      tick.setAttribute("stroke-width", "1.5");
      tick.setAttribute("pointer-events", "none");
      tick.setAttribute("class", "edge-tick");
      group.appendChild(tick);
    }
  }

  if (displayMode === "labels" && showEdgeLabels && weight > 1) {
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    const label = createSvgElement("text");
    label.textContent = String(weight);
    label.setAttribute("x", String(midX + perpX * LABEL_OFFSET));
    label.setAttribute("y", String(midY + perpY * LABEL_OFFSET));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", labelColor);
    label.setAttribute("pointer-events", "none");
    label.setAttribute("class", "edge-label");
    group.appendChild(label);
  }

  return group;
}

export default renderEdgeItem;
