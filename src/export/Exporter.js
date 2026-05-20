import { renderNetwork } from "../renderer/NetworkRenderer.js";

const SVG_MIME_TYPE = "image/svg+xml";
const PNG_MIME_TYPE = "image/png";
const JSPDF_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const DEFAULT_EXPORT_OPTIONS = Object.freeze({
  filename: "network",
  transparent: false,
  width: 2000,
  height: 2000,
  scale: "fit",
});

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveDimension(value, fallback) {
  return Math.max(1, numericValue(value, fallback));
}

function normalizeExportOptions(exportOptions = {}) {
  return {
    ...DEFAULT_EXPORT_OPTIONS,
    ...exportOptions,
    filename: exportOptions.filename || DEFAULT_EXPORT_OPTIONS.filename,
    width: positiveDimension(exportOptions.width, DEFAULT_EXPORT_OPTIONS.width),
    height: positiveDimension(exportOptions.height, DEFAULT_EXPORT_OPTIONS.height),
  };
}

function normalizeVisualOptions(visualOptions = {}, exportOptions) {
  return {
    ...visualOptions,
    width: exportOptions.width,
    height: exportOptions.height,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

function vertexPosition(vertex) {
  return {
    x: numericValue(vertex.x, 0),
    y: numericValue(vertex.y, 0),
  };
}

function graphBounds(vertices) {
  if (vertices.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
  }

  const first = vertexPosition(vertices[0]);
  const bounds = {
    minX: first.x,
    minY: first.y,
    maxX: first.x,
    maxY: first.y,
  };

  for (const vertex of vertices.slice(1)) {
    const position = vertexPosition(vertex);
    bounds.minX = Math.min(bounds.minX, position.x);
    bounds.minY = Math.min(bounds.minY, position.y);
    bounds.maxX = Math.max(bounds.maxX, position.x);
    bounds.maxY = Math.max(bounds.maxY, position.y);
  }

  return {
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

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

function scaledGraph(graph, width, height) {
  const bounds = graphBounds(graph.vertices);
  const sizing = fitScale(bounds, width, height);
  const vertexMap = new Map();
  const vertices = graph.vertices.map((vertex) => {
    const position = scaledPosition(vertex, bounds, sizing, width, height);
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

function backgroundColor(visualOptions) {
  return visualOptions.background?.color ?? "#ffffff";
}

function addSvgBackground(svg, fill) {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", "100%");
  rect.setAttribute("height", "100%");
  rect.setAttribute("fill", fill);
  svg.insertBefore(rect, svg.firstChild);
}

function serializeSvg(svg) {
  return new XMLSerializer().serializeToString(svg);
}

function svgDataUrl(svgText) {
  return `data:${SVG_MIME_TYPE};charset=utf-8,${encodeURIComponent(svgText)}`;
}

function renderExportSvg(graph, visualOptions, exportOptions) {
  const normalizedExportOptions = normalizeExportOptions(exportOptions);
  const normalizedVisualOptions = normalizeVisualOptions(visualOptions, normalizedExportOptions);
  const graphForExport = scaledGraph(
    graph,
    normalizedExportOptions.width,
    normalizedExportOptions.height,
  );
  const svg = renderNetwork(graphForExport, normalizedVisualOptions);

  svg.setAttribute("width", String(normalizedExportOptions.width));
  svg.setAttribute("height", String(normalizedExportOptions.height));

  return { svg, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions };
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Exporter error: failed to load SVG image."));
    image.src = dataUrl;
  });
}

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

  if (!normalizedExportOptions.transparent) {
    context.fillStyle = backgroundColor(normalizedVisualOptions);
    context.fillRect(0, 0, normalizedExportOptions.width, normalizedExportOptions.height);
  }

  const image = await imageFromDataUrl(svgDataUrl(serializeSvg(svg)));
  context.drawImage(image, 0, 0, normalizedExportOptions.width, normalizedExportOptions.height);

  return { canvas, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions };
}

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

function filenameWithExtension(filename, extension) {
  return `${filename.replace(new RegExp(`\\.${extension}$`, "i"), "")}.${extension}`;
}

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

function isAbortError(error) {
  return error?.name === "AbortError";
}

function getWindow() {
  return globalThis.window ?? null;
}

async function writeBlobToPickedFile(blob, filename, typeOptions) {
  const currentWindow = getWindow();
  if (typeof currentWindow?.showSaveFilePicker !== "function") {
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

async function loadJsPDF() {
  const module =
    globalThis.process?.env?.NODE_ENV === "test"
      ? await import("jspdf")
      : await import(JSPDF_CDN_URL);
  const jsPDF = module.jsPDF || module.default?.jsPDF || globalThis.jspdf?.jsPDF;

  if (!jsPDF) {
    throw new Error("jsPDF failed to load from CDN.");
  }

  return jsPDF;
}

export async function exportSVG(graph, visualOptions, exportOptions) {
  const { svg, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions } =
    renderExportSvg(graph, visualOptions, exportOptions);

  if (!normalizedExportOptions.transparent) {
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

export async function exportPDF(graph, visualOptions, exportOptions) {
  try {
    const { canvas, visualOptions: normalizedVisualOptions, exportOptions: normalizedExportOptions } =
      await renderExportCanvas(graph, visualOptions, exportOptions);
    const jsPDF = await loadJsPDF();
    const pdf = new jsPDF({
      orientation:
        normalizedExportOptions.width > normalizedExportOptions.height ? "landscape" : "portrait",
      unit: "px",
      format: [normalizedExportOptions.width, normalizedExportOptions.height],
    });

    if (!normalizedExportOptions.transparent) {
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
