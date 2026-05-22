import { renderEdgeItem } from "./EdgeItem.js";
import { renderVertexItem, vertexRadius } from "./VertexItem.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LEGEND_PADDING = 14;
const LEGEND_GAP = 12;
const LEGEND_TRAIT_RADIUS = 8;
const LEGEND_ROW_HEIGHT = 22;
const LEGEND_TITLE_HEIGHT = 12;
const LEGEND_TITLE_CONTENT_GAP = 14;
const LEGEND_TEXT_WIDTH = 7;

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
    displayMode: "labels",
  },
  vertices: {
    defaultColor: "#999999",
    inferredColor: "#333333",
    traitColors: [],
    strokeColor: "#333333",
    labelColor: "#333333",
  },
  baseRadius: 10,
  fontSize: 12,
  zoom: 1,
  panX: 0,
  panY: 0,
  legendPosition: null,
  labelOffsets: {},
  traitNames: [],
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
    labelOffsets: options.labelOffsets ?? DEFAULT_OPTIONS.labelOffsets,
    traitNames: Array.isArray(options.traitNames) ? options.traitNames : DEFAULT_OPTIONS.traitNames,
    legendPosition: options.legendPosition ?? DEFAULT_OPTIONS.legendPosition,
  };
}

function appendText(group, textContent, x, y, attributes = {}) {
  const text = createSvgElement("text");
  text.textContent = textContent;
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));

  for (const [name, value] of Object.entries(attributes)) {
    text.setAttribute(name, String(value));
  }

  group.appendChild(text);
  return text;
}

function approximateTextWidth(text, fontSize = 12) {
  return String(text).length * (fontSize * 0.58 || LEGEND_TEXT_WIDTH);
}

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sampledVertexFrequency(vertex) {
  return Math.max(0, numericValue(vertex.info?.frequency ?? vertex.info?.freq ?? vertex.frequency, 1));
}

function legendUnitRadius(graph, fallbackRadius) {
  for (const vertex of graph.vertices) {
    if (vertex.info?.inferred === true || vertex.info?.sampled === false) {
      continue;
    }

    const radius = Number(vertex.radius);
    const frequency = sampledVertexFrequency(vertex);
    if (Number.isFinite(radius) && radius > 0 && frequency > 0) {
      return radius / Math.sqrt(frequency);
    }
  }

  return fallbackRadius;
}

function legendDimensions(traitNames, baseRadius) {
  const largeRadius = baseRadius * Math.sqrt(10);
  const traitLabelWidth = traitNames.reduce(
    (maxWidth, traitName) => Math.max(maxWidth, approximateTextWidth(traitName, 12)),
    0,
  );
  const sizeWidth = largeRadius * 2;
  const traitsWidth = LEGEND_TRAIT_RADIUS * 2 + LEGEND_GAP + traitLabelWidth;
  const width = Math.ceil(LEGEND_PADDING * 2 + Math.max(sizeWidth, traitsWidth));
  const titleY = LEGEND_PADDING + LEGEND_TITLE_HEIGHT / 2;
  const largeLabelY = LEGEND_PADDING + LEGEND_TITLE_HEIGHT + LEGEND_TITLE_CONTENT_GAP;
  const largeCenterY = largeLabelY + 8 + largeRadius;
  const smallLabelY = largeCenterY + largeRadius + 16;
  const smallCenterY = smallLabelY + 8 + baseRadius;
  const traitsTitleY = smallCenterY + baseRadius + LEGEND_GAP + LEGEND_TITLE_HEIGHT;
  const height = Math.ceil(
    traitsTitleY + LEGEND_TITLE_CONTENT_GAP + traitNames.length * LEGEND_ROW_HEIGHT + LEGEND_PADDING,
  );

  return {
    width,
    height,
    largeRadius,
    smallRadius: baseRadius,
    titleY,
    largeLabelY,
    largeCenterY,
    smallLabelY,
    smallCenterY,
    traitsTitleY,
  };
}

function graphLegendPosition(graph, dimensions, baseRadius) {
  if (graph.vertices.length === 0) {
    return { x: 40, y: 40 };
  }

  const bounds = graph.vertices.reduce(
    (accumulator, vertex) => {
      const radius = vertexRadius(vertex, baseRadius);
      const x = Number(vertex.x ?? 0);
      const y = Number(vertex.y ?? 0);
      return {
        maxX: Math.max(accumulator.maxX, x + radius),
        maxY: Math.max(accumulator.maxY, y + radius),
      };
    },
    { maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
  );

  return {
    x: bounds.maxX + 40,
    y: bounds.maxY - dimensions.height,
  };
}

function normalizeLegendPosition(position) {
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) {
    return null;
  }

  return {
    x: Number(position.x),
    y: Number(position.y),
  };
}

export function renderLegend(graph, visualOptions) {
  const traitNames = Array.isArray(visualOptions.traitNames) ? visualOptions.traitNames : [];
  if (traitNames.length === 0) {
    return null;
  }

  const baseRadius = Number(visualOptions.baseRadius ?? DEFAULT_OPTIONS.baseRadius);
  const visualBaseRadius = Number.isFinite(baseRadius) && baseRadius > 0
    ? baseRadius
    : DEFAULT_OPTIONS.baseRadius;
  const unitRadius = legendUnitRadius(graph, visualBaseRadius);
  const dimensions = legendDimensions(traitNames, unitRadius);
  const savedPosition = normalizeLegendPosition(visualOptions.legendPosition);
  const position = savedPosition ?? graphLegendPosition(graph, dimensions, visualBaseRadius);
  const traitColors = visualOptions.vertices?.traitColors ?? [];
  const defaultColor = visualOptions.vertices?.defaultColor ?? DEFAULT_OPTIONS.vertices.defaultColor;

  const group = createSvgElement("g");
  group.setAttribute("id", "network-legend");
  group.setAttribute("transform", `translate(${position.x}, ${position.y})`);

  const background = createSvgElement("rect");
  background.setAttribute("class", "legend-bg");
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", String(dimensions.width));
  background.setAttribute("height", String(dimensions.height));
  background.setAttribute("fill", "white");
  background.setAttribute("fill-opacity", "0.85");
  background.setAttribute("stroke", "#cccccc");
  background.setAttribute("stroke-width", "1");
  background.setAttribute("rx", "4");
  group.appendChild(background);

  const centerX = dimensions.width / 2;
  appendText(group, "NODE SIZE", LEGEND_PADDING, dimensions.titleY, {
    class: "legend-title",
    "font-size": "10px",
    "font-weight": "600",
    fill: "#666666",
    "dominant-baseline": "middle",
  });

  appendText(group, "10 samples", centerX, dimensions.largeLabelY, {
    "font-size": "11px",
    fill: "#444444",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });

  const largeCircle = createSvgElement("circle");
  largeCircle.setAttribute("class", "legend-size-circle");
  largeCircle.setAttribute("cx", String(centerX));
  largeCircle.setAttribute("cy", String(dimensions.largeCenterY));
  largeCircle.setAttribute("r", String(dimensions.largeRadius));
  largeCircle.setAttribute("fill", "#e0e0e0");
  largeCircle.setAttribute("stroke", "#999999");
  largeCircle.setAttribute("stroke-width", "1");
  largeCircle.setAttribute("style", "fill: #e0e0e0; stroke: #999999; stroke-width: 1;");
  group.appendChild(largeCircle);

  appendText(group, "1 sample", centerX, dimensions.smallLabelY, {
    "font-size": "11px",
    fill: "#444444",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });

  const smallCircle = createSvgElement("circle");
  smallCircle.setAttribute("class", "legend-size-circle");
  smallCircle.setAttribute("cx", String(centerX));
  smallCircle.setAttribute("cy", String(dimensions.smallCenterY));
  smallCircle.setAttribute("r", String(dimensions.smallRadius));
  smallCircle.setAttribute("fill", "#e0e0e0");
  smallCircle.setAttribute("stroke", "#999999");
  smallCircle.setAttribute("stroke-width", "1");
  smallCircle.setAttribute("style", "fill: #e0e0e0; stroke: #999999; stroke-width: 1;");
  group.appendChild(smallCircle);

  appendText(group, "Traits", LEGEND_PADDING, dimensions.traitsTitleY, {
    class: "legend-title",
    "font-size": "10px",
    "font-weight": "600",
    fill: "#666666",
  });

  const traitX = LEGEND_PADDING + LEGEND_TRAIT_RADIUS;
  const traitLabelX = LEGEND_PADDING + LEGEND_TRAIT_RADIUS * 2 + LEGEND_GAP;
  let rowY = dimensions.traitsTitleY + LEGEND_TITLE_CONTENT_GAP + LEGEND_TRAIT_RADIUS;
  traitNames.forEach((traitName, index) => {
    const circle = createSvgElement("circle");
    circle.setAttribute("cx", String(traitX));
    circle.setAttribute("cy", String(rowY));
    circle.setAttribute("r", String(LEGEND_TRAIT_RADIUS));
    circle.setAttribute("fill", traitColors[index] ?? defaultColor);
    circle.setAttribute("stroke", "#666666");
    circle.setAttribute("stroke-width", "1");
    group.appendChild(circle);
    appendText(group, traitName, traitLabelX, rowY + 4, {
      "font-size": "12px",
      fill: "#444444",
    });
    rowY += LEGEND_ROW_HEIGHT;
  });

  return group;
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

  const legend = renderLegend(graph, normalizedOptions);
  if (legend) {
    viewportGroup.appendChild(legend);
  }

  return svg;
}

export default renderNetwork;
