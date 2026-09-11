/** @jest-environment jsdom */

import { describe, expect, test } from "@jest/globals";
import Graph from "../../src/model/Graph.js";
import { renderNetwork } from "../../src/renderer/NetworkRenderer.js";

const SVG_NS = "http://www.w3.org/2000/svg";

describe("NetworkRenderer", () => {
  test("renders an SVG with edge and vertex layers", () => {
    const graph = new Graph();
    const a = graph.addVertex("A", { frequency: 2, traits: [1, 1] });
    const b = graph.addVertex("B", { frequency: 1, traits: [1, 0] });
    const inferred = graph.addVertex("Median", { inferred: true });

    a.x = 100;
    a.y = 120;
    a.radius = 14;
    b.x = 220;
    b.y = 120;
    b.radius = 10;
    inferred.x = 160;
    inferred.y = 200;
    inferred.radius = 10;

    graph.addEdge(a, inferred, 2);
    graph.addEdge(inferred, b, 1);

    const svg = renderNetwork(graph, {
      width: 300,
      height: 250,
      traitColors: ["#ff0000", "#0000ff"],
      showEdgeLabels: true,
      baseRadius: 10,
    });

    expect(svg).toBeInstanceOf(SVGElement);
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.getAttribute("width")).toBe("300");
    expect(svg.getAttribute("height")).toBe("250");

    const edgesGroup = svg.querySelector("g.edges");
    const verticesGroup = svg.querySelector("g.vertices");

    expect(edgesGroup).not.toBeNull();
    expect(verticesGroup).not.toBeNull();
    expect(edgesGroup.querySelectorAll("g.edge")).toHaveLength(2);
    expect(verticesGroup.querySelectorAll("g.vertex")).toHaveLength(3);

    const vertexItems = [...verticesGroup.querySelectorAll("g.vertex")];
    const sampledVertices = vertexItems.filter(
      (vertexGroup) => vertexGroup.getAttribute("data-index") !== String(inferred.index),
    );
    const inferredVertex = vertexItems.find(
      (vertexGroup) => vertexGroup.getAttribute("data-index") === String(inferred.index),
    );

    expect(inferredVertex.querySelector(".vertex-label")).toBeNull();
    expect(sampledVertices.every((vertexGroup) => vertexGroup.querySelector(".vertex-label")))
      .toBe(true);
  });

  test("renders single-trait vertices as a plain circle without a radius stroke", () => {
    const graph = new Graph();
    const single = graph.addVertex("H33", { frequency: 3, traits: [0, 3] });
    const mixed = graph.addVertex("H34", { frequency: 2, traits: [1, 1] });
    single.x = 50;
    single.y = 50;
    mixed.x = 150;
    mixed.y = 50;

    const svg = renderNetwork(graph, {
      width: 200,
      height: 100,
      traitColors: ["#ff0000", "#0000ff"],
      baseRadius: 10,
    });

    const singleGroup = svg.querySelector(`g.vertex[data-index="${single.index}"]`);
    const mixedGroup = svg.querySelector(`g.vertex[data-index="${mixed.index}"]`);

    expect(singleGroup.querySelectorAll("path")).toHaveLength(0);
    const fillCircle = singleGroup.querySelector("circle:not(.selection-ring)");
    expect(fillCircle).not.toBeNull();
    expect(fillCircle.getAttribute("fill")).toBe("#0000ff");

    expect(mixedGroup.querySelectorAll("path")).toHaveLength(2);
  });
});
