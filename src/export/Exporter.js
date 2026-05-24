import { renderNetwork } from "../renderer/NetworkRenderer.js";

/**
 * @fileoverview
 * Exports the full rendered network as SVG, PNG, or PDF.
 * Export output fits the whole graph rather than the current viewport.
 */

const SVG_MIME_TYPE = "image/svg+xml";
const PNG_MIME_TYPE = "image/png";
const DEFAULT_EXPORT_OPTIONS = Object.freeze({
  filename: "network",
  transparent: false,
  width: 2000,
  height: 2000,
  scale: "fit",
});

/**
 * Converts loose export metadata to a finite number with a fallback.
 */
function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Normalizes export dimensions to positive pixel values.
 */
function positiveDimension(value, fallback) {
  return Math.max(1, numericValue(value, fallback));
}

/**
 * Merges caller options with publication-oriented export defaults.
 */
function normalizeExportOptions(exportOptions = {}) {
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    ...exportOptions,
    filename: exportOptions.filename || DEFAULT_EXPORT_OPTIONS.filename,
    width: positiveDimension(exportOptions.width, DEFAULT_EXPORT_OPTIONS.width),
    height: positiveDimension(exportOptions.height, DEFAULT_EXPORT_OPTIONS.height),
  };
}

/**
 * Converts live visual options into export-time rendering options.
 */
function normalizeVisualOptions(visualOptions = {}, exportOptions) {
  // Export ignores current zoom and pan; researchers need the full network,
  // not the current viewport crop.
  return {
    ...visualOptions,
    width: exportOptions.width,
    height: exportOptions.height,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

/**
 * Reads a vertex position with numeric fallbacks for incomplete saved state.
 */
function vertexPosition(vertex) {
  return {
    x: numericValue(vertex.x, 0),
    y: numericValue(vertex.y, 0),
  };
}

/**
 * Computes graph bounds wide enough for nearby rendered annotations.
 */
function graphBoundsWithPadding(graph, visualOptions = {}) {
  const vertices = graph.vertices ?? [];
  if (vertices.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 1000,
      maxY: 1000,
      width: 1000,
      height: 1000,
    };
  }

  const fontSize = numericValue(visualOptions.fontSize, 12);
  const strokeWidth = numericValue(visualOptions.edges?.width, 1.5);
  const baseRadius = numericValue(visualOptions.baseRadius, 10);
  const labelPadding = fontSize * 4;
  const tickPadding = 10;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const vertex of vertices) {
    const position = vertexPosition(vertex);
    // Include visual element sizes in bounds; vertex centers alone
    // would clip nodes, labels, and tick marks near the network edges.
    const radius = numericValue(vertex.radius, baseRadius) + labelPadding;
    minX = Math.min(minX, position.x - radius);
    minY = Math.min(minY, position.y - radius);
    maxX = Math.max(maxX, position.x + radius);
    maxY = Math.max(maxY, position.y + radius);
  }

  const margin = Math.max(strokeWidth, tickPadding) * 2;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Computes the scale and padding needed to fit the full graph into the export.
 */
function fitScale(bounds, width, height) {
  const paddingX = width * 0.05;
  const paddingY = height * 0.05;
  const innerWidth = Math.max(1, width - paddingX * 2);
  const innerHeight = Math.max(1, height - paddingY * 2);
  const scaleX = bounds.width > 0 ? innerWidth / bounds.width : Number.POSITIVE_INFINITY;
  const scaleY = bounds.height > 0 ? innerHeight / bounds.height : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);

  return {
    paddingX,
    paddingY,
    innerWidth,
    innerHeight,
    scale: Number.isFinite(scale) ? scale : 1,
  };
}

/**
 * Projects one vertex into export coordinates without changing the graph.
 */
function scaledPosition(vertex, bounds, sizing, width, height) {
  const position = vertexPosition(vertex);
  const x =
    bounds.width > 0
      ? (position.x - bounds.minX) * sizing.scale +
        sizing.paddingX +
        (sizing.innerWidth - bounds.width * sizing.scale) / 2
      : width / 2;
  const y =
    bounds.height > 0
      ? (position.y - bounds.minY) * sizing.scale +
        sizing.paddingY +
        (sizing.innerHeight - bounds.height * sizing.scale) / 2
      : height / 2;

  return { x, y };
}

/**
 * Builds a temporary graph projection sized for the export canvas.
 */
function scaledGraph(graph, width, height) {
  const bounds = graphBoundsWithPadding(graph);
  const sizing = fitScale(bounds, width, height);
  const vertexMap = new Map();
  const vertices = graph.vertices.map((vertex) => {
    const position = scaledPosition(vertex, bounds, sizing, width, height);
    // Export uses cloned vertices so the live graph layout is never mutated.
    const clone = {
      ...vertex,
      x: position.x,
      y: position.y,
    };
    vertexMap.set(vertex, clone);
    return clone;
  });

  const edges = graph.edges.map((edge) => ({
    ...edge,
    from: vertexMap.get(edge.from),
    to: vertexMap.get(edge.to),
  }));

  return {
    ...graph,
    vertices,
    edges,
  };
}

/**
 * Expands export bounds to keep the generated legend inside the viewBox.
 */
function boundsIncludingLegend(bounds, svg) {
  const legendEl = svg.querySelector("#network-legend");
  if (!legendEl) {
    return bounds;
  }

  const transform = legendEl.getAttribute("transform") ?? "";
  const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
  if (!match) {
    return bounds;
  }

  const legendX = Number.parseFloat(match[1]);
  const legendY = Number.parseFloat(match[2]);
  if (!Number.isFinite(legendX) || !Number.isFinite(legendY)) {
    return bounds;
  }

  const minX = Math.min(bounds.minX, legendX - 10);
  const minY = Math.min(bounds.minY, legendY - 10);
  const maxX = Math.max(bounds.maxX, legendX + 200);
  const maxY = Math.max(bounds.maxY, legendY + 300);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Reads export viewBox coordinates for background painting.
 */
function svgViewBoxBounds(svg) {
  const values = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));

  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

/**
 * Reads the configured background color used by non-transparent exports.
 */
function backgroundColor(visualOptions) {
  return visualOptions.background?.color ?? "#ffffff";
}

/**
 * Inserts or updates an SVG background rectangle for opaque SVG exports.
 */
function addSvgBackground(svg, fill) {
  const viewBox = svgViewBoxBounds(svg);
  const existing = svg.firstElementChild?.classList?.contains("svg-background")
    ? svg.firstElementChild
    : null;
  if (existing) {
    if (viewBox) {
      existing.setAttribute("x", String(viewBox.x));
      existing.setAttribute("y", String(viewBox.y));
      existing.setAttribute("width", String(viewBox.width));
      existing.setAttribute("height", String(viewBox.height));
    }
    existing.setAttribute("fill", fill);
    return;
  }

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("class", "svg-background");
  if (viewBox) {
    rect.setAttribute("x", String(viewBox.x));
    rect.setAttribute("y", String(viewBox.y));
    rect.setAttribute("width", String(viewBox.width));
    rect.setAttribute("height", String(viewBox.height));
  } else {
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
  }
  rect.setAttribute("fill", fill);
  svg.insertBefore(rect, svg.firstChild);
}

/**
 * Removes the synthetic SVG background for transparent exports.
 */
function removeSvgBackground(svg) {
  if (svg.firstElementChild?.classList?.contains("svg-background")) {
    svg.firstElementChild.remove();
  }
}

/**
 * Serializes the SVG element into downloadable text.
 */
function serializeSvg(svg) {
  return new XMLSerializer().serializeToString(svg);
}

/**
 * Encodes SVG text as an image source for canvas rasterization.
 */
function svgDataUrl(svgText) {
  return `data:${SVG_MIME_TYPE};charset=utf-8,${encodeURIComponent(svgText)}`;
}

/**
 * Renders the full network into an export-sized SVG element.
 */
function renderExportSvg(graph, visualOptions, exportOptions) {
  const normalizedExportOptions = normalizeExportOptions(exportOptions);
  let normalizedVisualOptions = normalizeVisualOptions(visualOptions, normalizedExportOptions);
  let bounds = graphBoundsWithPadding(graph, normalizedVisualOptions);
  normalizedVisualOptions = {
    ...normalizedVisualOptions,
    width: bounds.width,
    height: bounds.height,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  const svg = renderNetwork(graph, normalizedVisualOptions);
  bounds = boundsIncludingLegend(bounds, svg);
  normalizedVisualOptions = {
    ...normalizedVisualOptions,
    width: bounds.width,
    height: bounds.height,
  };

  // viewBox maps natural graph coordinates to export dimensions;
  // SVG scales all content uniformly so nodes, fonts, and tick marks
  // stay proportional at any export size without manual scaling.
  svg.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);
  svg.setAttribute("width", String(normalizedExportOptions.width));
  svg.setAttribute("height", String(normalizedExportOptions.height));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (normalizedExportOptions.transparent) {
    removeSvgBackground(svg);
  }

  return { svg, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions };
}

/**
 * Loads an SVG data URL as an image for canvas drawing.
 */
function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Exporter error: failed to load SVG image."));
    image.src = dataUrl;
  });
}

/**
 * Converts a canvas into a Blob while preserving asynchronous browser errors.
 */
function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Exporter error: failed to create image blob."));
      }
    }, type);
  });
}

/**
 * Rasterizes the export SVG into a canvas for PNG and PDF output.
 */
async function renderExportCanvas(graph, visualOptions, exportOptions) {
  const { svg, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions } =
    renderExportSvg(graph, visualOptions, exportOptions);
  const canvas = document.createElement("canvas");
  canvas.width = normalizedExportOptions.width;
  canvas.height = normalizedExportOptions.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Exporter error: 2D canvas context is unavailable.");
  }

  // Canvas starts transparent; opaque exports need an explicit fill behind
  // the rendered SVG image.
  if (!normalizedExportOptions.transparent) {
    context.fillStyle = backgroundColor(normalizedVisualOptions);
    context.fillRect(0, 0, normalizedExportOptions.width, normalizedExportOptions.height);
  }

  const image = await imageFromDataUrl(svgDataUrl(serializeSvg(svg)));
  context.drawImage(image, 0, 0, normalizedExportOptions.width, normalizedExportOptions.height);

  return { canvas, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions };
}

/**
 * Converts CSS-style hex colors into jsPDF RGB values.
 */
function hexToRgb(hexColor) {
  const value = String(hexColor).trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);

  if (!match) {
    return [255, 255, 255];
  }

  const hex = match[1].length === 3 ? match[1].replace(/./g, (char) => char + char) : match[1];
  const number = Number.parseInt(hex, 16);

  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

/**
 * Ensures downloaded files have the requested extension exactly once.
 */
function filenameWithExtension(filename, extension) {
  return `${filename.replace(new RegExp(`\\.${extension}$`, "i"), "")}.${extension}`;
}

/**
 * Starts a browser download when native file handles are unavailable.
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Identifies user-cancelled native save picker operations.
 */
function isAbortError(error) {
  return error?.name === "AbortError";
}

/**
 * Reads window lazily so export helpers remain testable outside a browser.
 */
function getWindow() {
  return globalThis.window ?? null;
}

/**
 * Writes an export Blob through Save As, or downloads it as a fallback.
 */
async function writeBlobToPickedFile(blob, filename, typeOptions) {
  const currentWindow = getWindow();
  if (typeof currentWindow?.showSaveFilePicker !== "function") {
    // Browsers without File System Access still need one-click export.
    triggerDownload(blob, filename);
    return;
  }

  try {
    const fileHandle = await currentWindow.showSaveFilePicker({
      suggestedName: filename,
      types: [typeOptions],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    throw error;
  }
}

/**
 * Loads jsPDF only when PDF export is requested.
 */
async function loadJsPDF() {
  const { jsPDF } = await import("jspdf");

  if (!jsPDF) {
    throw new Error("jsPDF failed to load.");
  }

  return jsPDF;
}

/**
 * Exports the full network as an SVG file.
 */
export async function exportSVG(graph, visualOptions, exportOptions) {
  const { svg, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions } =
    renderExportSvg(graph, visualOptions, exportOptions);

  if (!normalizedExportOptions.transparent) {
    // SVG output needs its own background element because it has no canvas fill.
    addSvgBackground(svg, backgroundColor(normalizedVisualOptions));
  }

  const blob = new Blob([serializeSvg(svg)], { type: SVG_MIME_TYPE });
  await writeBlobToPickedFile(
    blob,
    filenameWithExtension(normalizedExportOptions.filename, "svg"),
    {
      description: "SVG Image",
      accept: { [SVG_MIME_TYPE]: [".svg"] },
    },
  );
}

/**
 * Exports the full network as a PNG image.
 */
export async function exportPNG(graph, visualOptions, exportOptions) {
  const { canvas, exportOptions: normalizedExportOptions } = await renderExportCanvas(
    graph,
    visualOptions,
    exportOptions,
  );
  const blob = await canvasToBlob(canvas, PNG_MIME_TYPE);
  await writeBlobToPickedFile(
    blob,
    filenameWithExtension(normalizedExportOptions.filename, "png"),
    {
      description: "PNG Image",
      accept: { [PNG_MIME_TYPE]: [".png"] },
    },
  );
}

/**
 * Exports the full network as a PDF document.
 */
export async function exportPDF(graph, visualOptions, exportOptions) {
  try {
    const { canvas, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions } =
      await renderExportCanvas(graph, visualOptions, exportOptions);
    const jsPDF = await loadJsPDF();
    const pdf = new jsPDF({
      // Match page orientation to the requested export dimensions.
      orientation:
        normalizedExportOptions.width > normalizedExportOptions.height ? "landscape" : "portrait",
      unit: "px",
      format: [normalizedExportOptions.width, normalizedExportOptions.height],
    });

    if (!normalizedExportOptions.transparent) {
      // PDF pages are opaque by default in many viewers; fill explicitly so the
      // configured background matches PNG/SVG exports.
      pdf.setFillColor(...hexToRgb(backgroundColor(normalizedVisualOptions)));
      pdf.rect(0, 0, normalizedExportOptions.width, normalizedExportOptions.height, "F");
    }

    pdf.addImage(
      canvas.toDataURL(PNG_MIME_TYPE),
      "PNG",
      0,
      0,
      normalizedExportOptions.width,
      normalizedExportOptions.height,
    );

    const filename = filenameWithExtension(normalizedExportOptions.filename, "pdf");
    const blob = pdf.output("blob");
    if (typeof getWindow()?.showSaveFilePicker !== "function" && typeof pdf.save === "function") {
      // jsPDF's save path is a useful fallback in browsers without native file handles.
      pdf.save(filename);
    }
    await writeBlobToPickedFile(
      blob,
      filename,
      {
        description: "PDF Document",
        accept: { "application/pdf": [".pdf"] },
      },
    );
  } catch (err) {
    console.error("PDF export failed:", err);
    if (typeof alert === "function") {
      alert(`PDF export failed: ${err.message}`);
    }
  }
}
