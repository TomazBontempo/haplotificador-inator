/**
 * @fileoverview
 * Renders one graph vertex as an SVG group.
 * Receives vertex data plus visual options and returns SVG node markup.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_FILL = "#999999";
const INFERRED_FILL = "#333333";
const DEFAULT_STROKE = "#333333";
const DEFAULT_LABEL_FILL = "#333333";
const DEFAULT_BASE_RADIUS = 10;

/**
 * Creates SVG elements in the correct namespace for browser rendering.
 */
function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

/**
 * Converts loose vertex metadata to a finite number with a fallback.
 */
function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Reads the sampled frequency that controls PopART-style vertex area.
 */
export function vertexFrequency(vertex) {
  return Math.max(0, numericValue(vertex.info?.frequency ?? vertex.info?.freq, 1));
}

/**
 * Returns the rendered radius, preferring layout's persisted radius when present.
 */
export function vertexRadius(vertex, baseRadius) {
  const radius = numericValue(vertex.radius, Number.NaN);
  if (Number.isFinite(radius) && radius > 0) {
    return radius;
  }

  return baseRadius * Math.sqrt(vertexFrequency(vertex));
}

/**
 * Normalizes trait counts into positive pie-slice entries.
 */
function traitEntries(traits) {
  if (!traits) {
    return [];
  }

  const values = Array.isArray(traits) ? traits : Object.values(traits);
  return values
    .map((value, index) => ({
      index,
      value: Math.max(0, numericValue(value, 0)),
    }))
    .filter((entry) => entry.value > 0);
}

/**
 * Appends a plain sampled vertex circle.
 */
function appendSampledCircle(group, radius, fill, stroke) {
  const circle = createSvgElement("circle");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", fill);
  circle.setAttribute("stroke", stroke);
  circle.setAttribute("stroke-width", "1");
  group.appendChild(circle);
}

/**
 * Adds the invisible selection target used by UI interaction styling.
 */
function appendSelectionRing(group, radius) {
  // PopART expands selected vertex bounds with a halo; this ring gives the SVG
  // UI a stable hook for equivalent selection feedback.
  const circle = createSvgElement("circle");
  circle.setAttribute("class", "selection-ring");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "none");
  group.appendChild(circle);
}

/**
 * Appends trait pie slices for sampled vertices with trait counts.
 */
function appendPieSections(group, radius, traits, traitColors, defaultFill, stroke) {
  if (traits.length === 1) {
    // A single trait fills the whole vertex. Drawing it as a sector would
    // stroke the radius from the center to the arc start, so use a plain circle.
    appendSampledCircle(group, radius, traitColors[traits[0].index] ?? defaultFill, stroke);
    return;
  }

  const total = traits.reduce((sum, entry) => sum + entry.value, 0);
  let startAngle = -Math.PI / 2;

  for (const entry of traits) {
    // Trait slice areas are proportional to counts, matching PopART's pie
    // sections for vertices with associated trait data.
    const angle = total > 0 ? (entry.value / total) * Math.PI * 2 : 0;
    const endAngle = startAngle + angle;
    const path = createSvgElement("path");
    path.setAttribute("d", sectorPath(radius, startAngle, endAngle));
    path.setAttribute("fill", traitColors[entry.index] ?? defaultFill);
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", "1");
    group.appendChild(path);
    startAngle = endAngle;
  }
}

/**
 * Computes the point where a pie-slice arc meets the vertex circle.
 */
function pointOnCircle(radius, angle) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

/**
 * Builds the SVG path for one trait pie sector.
 */
function sectorPath(radius, startAngle, endAngle) {
  const start = pointOnCircle(radius, startAngle);
  const end = pointOnCircle(radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    "M 0 0",
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

/**
 * Appends the vertex label at its saved offset or below the node by default.
 */
function appendLabel(group, vertex, radius, fill, visualOptions) {
  const label = vertex.label ?? vertex.name ?? "";
  if (!label) {
    return;
  }
  // Respect user's label visibility preference in export.
  if (visualOptions.showLabels === false) {
    return;
  }

  const fontSize = numericValue(visualOptions.fontSize, 12);
  const offset = visualOptions.labelOffsets?.[vertex.index] ?? {
    x: 0,
    y: radius + fontSize + 4,
  };
  // Labels carry the vertex index so the UI can drag labels independently
  // while keeping the logical graph unchanged.
  const text = createSvgElement("text");
  text.textContent = label;
  text.setAttribute("x", String(offset.x));
  text.setAttribute("y", String(offset.y));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("font-size", `${fontSize}px`);
  text.setAttribute("fill", fill);
  text.setAttribute("class", "vertex-label");
  text.setAttribute("data-vertex-index", String(vertex.index));
  group.appendChild(text);
}

/**
 * Renders a sampled or inferred vertex as an SVG group.
 */
export function renderVertexItem(vertex, options = {}) {
  const baseRadius = numericValue(options.baseRadius, DEFAULT_BASE_RADIUS);
  const vertexOptions = options.vertices ?? {};
  const defaultFill = vertexOptions.defaultColor ?? DEFAULT_FILL;
  const inferredFill = vertexOptions.inferredColor ?? INFERRED_FILL;
  const traitColors = vertexOptions.traitColors ?? [];
  const stroke = vertexOptions.strokeColor ?? DEFAULT_STROKE;
  const labelFill = vertexOptions.labelColor ?? DEFAULT_LABEL_FILL;
  const group = createSvgElement("g");
  const x = numericValue(vertex.x, 0);
  const y = numericValue(vertex.y, 0);

  group.setAttribute("class", "vertex");
  group.setAttribute("data-index", String(vertex.index ?? ""));
  group.setAttribute("transform", `translate(${x}, ${y})`);

  if (vertex.info?.inferred === true) {
    // Inferred vertices have no sample frequency, so they use a fixed small
    // radius like PopART's intermediate/median-vector nodes.
    const radius = baseRadius * 0.4;
    appendSelectionRing(group, radius);

    const circle = createSvgElement("circle");
    circle.setAttribute("cx", "0");
    circle.setAttribute("cy", "0");
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", inferredFill);
    circle.setAttribute("class", "vertex-inferred");
    group.appendChild(circle);
    return group;
  }

  const radius = vertexRadius(vertex, baseRadius);
  const traits = traitEntries(vertex.info?.traits);
  appendSelectionRing(group, radius);

  if (traits.length > 0) {
    // Trait pies preserve the biological grouping on the rendered node instead
    // of changing the graph topology.
    appendPieSections(group, radius, traits, traitColors, defaultFill, stroke);
  } else {
    appendSampledCircle(group, radius, defaultFill, stroke);
  }

  appendLabel(group, vertex, radius, labelFill, options);

  return group;
}

export default renderVertexItem;
