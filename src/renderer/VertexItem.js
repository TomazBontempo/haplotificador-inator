const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_FILL = "#999999";
const INFERRED_FILL = "#333333";
const DEFAULT_STROKE = "#333333";
const DEFAULT_LABEL_FILL = "#333333";
const DEFAULT_BASE_RADIUS = 10;

function createSvgElement(name) {
  return document.createElementNS(SVG_NS, name);
}

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function vertexFrequency(vertex) {
  return Math.max(0, numericValue(vertex.info?.frequency ?? vertex.info?.freq, 1));
}

export function vertexRadius(vertex, baseRadius) {
  const radius = numericValue(vertex.radius, Number.NaN);
  if (Number.isFinite(radius) && radius > 0) {
    return radius;
  }

  return baseRadius * Math.sqrt(vertexFrequency(vertex));
}

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

function appendSelectionRing(group, radius) {
  const circle = createSvgElement("circle");
  circle.setAttribute("class", "selection-ring");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "none");
  group.appendChild(circle);
}

function appendPieSections(group, radius, traits, traitColors, defaultFill, stroke) {
  const total = traits.reduce((sum, entry) => sum + entry.value, 0);
  let startAngle = -Math.PI / 2;

  for (const entry of traits) {
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

function pointOnCircle(radius, angle) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function sectorPath(radius, startAngle, endAngle) {
  const start = pointOnCircle(radius, startAngle);
  const end = pointOnCircle(radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  if (Math.abs(endAngle - startAngle) >= Math.PI * 2 - 1e-9) {
    return [
      `M 0 0`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 1 1 ${-start.x} ${-start.y}`,
      `A ${radius} ${radius} 0 1 1 ${start.x} ${start.y}`,
      "Z",
    ].join(" ");
  }

  return [
    "M 0 0",
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function appendLabel(group, vertex, radius, fill, fontSize) {
  const label = vertex.label ?? vertex.name ?? "";
  if (!label) {
    return;
  }

  const text = createSvgElement("text");
  text.textContent = label;
  text.setAttribute("x", "0");
  text.setAttribute("y", String(radius + fontSize + 4));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", `${fontSize}px`);
  text.setAttribute("fill", fill);
  text.setAttribute("class", "vertex-label");
  group.appendChild(text);
}

export function renderVertexItem(vertex, options = {}) {
  const baseRadius = numericValue(options.baseRadius, DEFAULT_BASE_RADIUS);
  const vertexOptions = options.vertices ?? {};
  const defaultFill = vertexOptions.defaultColor ?? DEFAULT_FILL;
  const inferredFill = vertexOptions.inferredColor ?? INFERRED_FILL;
  const traitColors = vertexOptions.traitColors ?? [];
  const stroke = vertexOptions.strokeColor ?? DEFAULT_STROKE;
  const labelFill = vertexOptions.labelColor ?? DEFAULT_LABEL_FILL;
  const fontSize = numericValue(options.fontSize, 12);
  const group = createSvgElement("g");
  const x = numericValue(vertex.x, 0);
  const y = numericValue(vertex.y, 0);

  group.setAttribute("class", "vertex");
  group.setAttribute("data-index", String(vertex.index ?? ""));
  group.setAttribute("transform", `translate(${x}, ${y})`);

  if (vertex.info?.inferred === true) {
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
    appendPieSections(group, radius, traits, traitColors, defaultFill, stroke);
  } else {
    appendSampledCircle(group, radius, defaultFill, stroke);
  }

  appendLabel(group, vertex, radius, labelFill, fontSize);

  return group;
}

export default renderVertexItem;
