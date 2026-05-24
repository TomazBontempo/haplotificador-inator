/** @jest-environment jsdom */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import Graph from "../../src/model/Graph.js";

let mockPdf;
const jsPDF = jest.fn(() => mockPdf);

jest.unstable_mockModule("jspdf", () => ({ jsPDF }));

const { exportPDF, exportPNG, exportSVG } = await import("../../src/export/Exporter.js");

const visualOptions = {
  width: 1000,
  height: 1000,
  background: {
    color: "#123456",
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
  },
  baseRadius: 10,
};

let createdBlobs;
let downloads;
let mockContext;

function buildGraph() {
  const graph = new Graph();
  const a = graph.addVertex("A", { frequency: 1 });
  const b = graph.addVertex("B", { frequency: 1 });

  a.x = 0;
  a.y = 0;
  b.x = 100;
  b.y = 100;
  graph.addEdge(a, b, 2);

  return graph;
}

function exportOptions(overrides = {}) {
  return {
    filename: "network",
    transparent: false,
    width: 1000,
    height: 1000,
    scale: "fit",
    ...overrides,
  };
}

function exportedSvgText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function exportedSvgDocument(blob) {
  const text = await exportedSvgText(blob);
  return new DOMParser().parseFromString(text, "text/html");
}

function vertexTransforms(svgDocument) {
  return [...svgDocument.querySelectorAll("g.vertex")].map((group) => {
    const match = /translate\(([^,\s]+),\s*([^)]+)\)/.exec(group.getAttribute("transform"));
    return {
      x: Number(match[1]),
      y: Number(match[2]),
    };
  });
}

function mockCanvasAndImage() {
  mockContext = {
    drawImage: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: "",
  };

  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(mockContext);
  jest.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["png"], { type: "image/png" }));
  });
  jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/png;base64,AAAA");

  global.Image = class MockImage {
    set src(value) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }

    get src() {
      return this._src;
    }
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  createdBlobs = [];
  downloads = [];
  mockPdf = {
    addImage: jest.fn(),
    output: jest.fn(() => new Blob(["pdf"], { type: "application/pdf" })),
    rect: jest.fn(),
    save: jest.fn(),
    setFillColor: jest.fn(),
  };
  jsPDF.mockClear();
  jsPDF.mockImplementation(() => mockPdf);

  URL.createObjectURL = () => "";
  URL.revokeObjectURL = () => {};
  jest.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    createdBlobs.push(blob);
    return `blob:export-${createdBlobs.length}`;
  });
  jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
    downloads.push({
      filename: this.download,
      href: this.href,
    });
  });
});

describe("Exporter", () => {
  test("exportSVG produces an SVG string with background rect when transparent is false", async () => {
    await exportSVG(buildGraph(), visualOptions, exportOptions({ transparent: false }));

    const svgDocument = await exportedSvgDocument(createdBlobs[0]);
    const background = svgDocument.querySelector("svg > rect");

    expect(background).not.toBeNull();
    expect(background.getAttribute("fill")).toBe(visualOptions.background.color);
    expect(downloads[0].filename).toBe("network.svg");
  });

  test("exportSVG produces an SVG string without background rect when transparent is true", async () => {
    await exportSVG(buildGraph(), visualOptions, exportOptions({ transparent: true }));

    const svgDocument = await exportedSvgDocument(createdBlobs[0]);

    expect(
      [...svgDocument.documentElement.children].find(
        (child) => child.tagName.toLowerCase() === "rect",
      ),
    ).toBeUndefined();
  });

  test("exportSVG scales network to fit export dimensions", async () => {
    await exportSVG(buildGraph(), visualOptions, exportOptions({ width: 3000, height: 3000 }));

    const svgDocument = await exportedSvgDocument(createdBlobs[0]);
    const svg = svgDocument.querySelector("svg");
    const positions = vertexTransforms(svgDocument);

    // Verify SVG dimensions are set to export size.
    expect(svg.getAttribute("width")).toBe("3000");
    expect(svg.getAttribute("height")).toBe("3000");

    // viewBox carries the fit math so rendered content scales as one scene.
    const viewBox = svg.getAttribute("viewBox");
    expect(viewBox).not.toBeNull();
    const [, , vbW, vbH] = viewBox.split(" ").map(Number);
    expect(vbW).toBeGreaterThan(0);
    expect(vbH).toBeGreaterThan(0);
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(Math.min(...positions.map((position) => position.x))).toBeGreaterThanOrEqual(0);
  });

  test("exportPNG calls canvas.toBlob and triggers download", async () => {
    mockCanvasAndImage();

    await exportPNG(buildGraph(), visualOptions, exportOptions());

    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    expect(downloads[0].filename).toBe("network.png");
  });

  test("exportPDF calls jsPDF and triggers download", async () => {
    mockCanvasAndImage();

    await exportPDF(buildGraph(), visualOptions, exportOptions());

    expect(jsPDF).toHaveBeenCalled();
    expect(mockPdf.save).toHaveBeenCalledWith("network.pdf");
    expect(downloads[0].filename).toBe("network.pdf");
  });

  test("transparent export does not add background to PDF", async () => {
    mockCanvasAndImage();

    await exportPDF(buildGraph(), visualOptions, exportOptions({ transparent: true }));

    expect(mockPdf.setFillColor).not.toHaveBeenCalled();
  });

  test("export always uses full network ignoring zoom and pan", async () => {
    await exportSVG(
      buildGraph(),
      {
        ...visualOptions,
        zoom: 3,
        panX: 500,
        panY: 500,
      },
      exportOptions({ transparent: true }),
    );

    const svgDocument = await exportedSvgDocument(createdBlobs[0]);
    const svg = svgDocument.querySelector("svg");
    const positions = vertexTransforms(svgDocument);
    const viewportTransform = svgDocument.documentElement
      .querySelector("g.viewport")
      .getAttribute("transform");

    expect(viewportTransform).toBe("translate(0, 0) scale(1)");
    expect(positions).toHaveLength(2);
    const xCoords = positions.map((position) => position.x).sort((a, b) => a - b);
    expect(xCoords[0]).toBe(0);
    expect(xCoords[1]).toBe(100);

    const viewBox = svg.getAttribute("viewBox");
    expect(viewBox).not.toBeNull();
    const [, , vbW, vbH] = viewBox.split(" ").map(Number);
    expect(vbW).toBeGreaterThan(100);
    expect(vbH).toBeGreaterThan(100);
  });
});
