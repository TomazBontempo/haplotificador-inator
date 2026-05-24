/**
 * @fileoverview
 * Renders one graph edge as an SVG group.
 * Receives edge data plus visual options and returns SVG edge markup.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_EDGE_COLOR = "#666666";
const DEFAULT_EDGE_WIDTH = 1.5;
const DEFAULT_LABEL_COLOR = "#333333";

/**
 * Creates SVG elements in the correct namespace for browser rendering.
 */
function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

/**
 * Converts loose edge metadata to a finite number with a fallback.
 */
function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Renders an edge line plus optional PopART-style mutation marks.
 */
export function renderEdgeItem(edge, options = {}) {
  const edgeOptions = options.edges ?? {};
  const showEdgeLabels = edgeOptions.showLabels ?? options.showEdgeLabels ?? true;
  const displayMode = edgeOptions.displayMode ?? "labels";
  const edgeColor = edgeOptions.color ?? DEFAULT_EDGE_COLOR;
  const edgeWidth = numericValue(edgeOptions.width, DEFAULT_EDGE_WIDTH);
  const labelColor = edgeOptions.labelColor ?? DEFAULT_LABEL_COLOR;
  const fontSize = Math.max(8, numericValue(options.fontSize, 12) - 2);
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

  // A group keeps the edge line and its mutation annotation selectable or
  // hideable as one logical renderer item.
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
    // Distribute ticks by edge length like PopART; fixed spacing
    // looks wrong when edges vary greatly in length or export size changes.
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const spacing = length / (weight + 1);
    const tickHalf = 5;
    for (let index = 1; index <= weight; index += 1) {
      const tickX = fromX + ux * spacing * index;
      const tickY = fromY + uy * spacing * index;
      const tick = createSvgElement("line");
      tick.setAttribute("x1", String(tickX - px * tickHalf));
      tick.setAttribute("y1", String(tickY - py * tickHalf));
      tick.setAttribute("x2", String(tickX + px * tickHalf));
      tick.setAttribute("y2", String(tickY + py * tickHalf));
      tick.setAttribute("stroke", edgeColor);
      tick.setAttribute("stroke-width", String(edgeWidth));
      // Let drag/selection gestures reach the underlying edge or vertex group.
      tick.setAttribute("pointer-events", "none");
      tick.setAttribute("class", "edge-tick");
      group.appendChild(tick);
    }
  }

  if (displayMode === "labels" && showEdgeLabels && weight > 1) {
    // Single-step edges stay unlabelled so the common case remains uncluttered.
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    const offsetFontSize = options.fontSize ?? 12;
    const offsetDistance = offsetFontSize / 2 + 4;
    const label = createSvgElement("text");
    label.textContent = String(weight);
    label.setAttribute("x", String(midX + perpX * offsetDistance));
    label.setAttribute("y", String(midY + perpY * offsetDistance));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("font-size", String(fontSize));
    label.setAttribute("fill", labelColor);
    // Labels are visual annotations, not separate graph interaction targets.
    label.setAttribute("pointer-events", "none");
    label.setAttribute("class", "edge-label");
    group.appendChild(label);
  }

  return group;
}

export default renderEdgeItem;
