import { describe, expect, test } from "@jest/globals";
import Graph from "../../src/model/Graph.js";
import { computeLayout } from "../../src/layout/NetworkLayout.js";

describe("NetworkLayout", () => {
  test("assigns coordinates and radii to a small graph", () => {
    const graph = new Graph();
    const a = graph.addVertex("A", { frequency: 1 });
    const b = graph.addVertex("B", { frequency: 2 });
    const c = graph.addVertex("C", { frequency: 3 });
    const d = graph.addVertex("D", { frequency: 4 });
    const e = graph.addVertex("E", { frequency: 5 });

    graph.addEdge(a, b, 1);
    graph.addEdge(b, c, 2);
    graph.addEdge(c, d, 1);
    graph.addEdge(d, e, 3);
    graph.addEdge(e, a, 1);

    const result = computeLayout(graph, { iterations: 25 });

    expect(result).toBe(graph);

    for (const vertex of graph.vertices) {
      expect(Number.isFinite(vertex.x)).toBe(true);
      expect(Number.isFinite(vertex.y)).toBe(true);
      expect(Number.isFinite(vertex.radius)).toBe(true);
      expect(vertex.radius).toBeGreaterThan(0);
    }

    const coordinates = new Set(
      graph.vertices.map((vertex) => `${vertex.x.toFixed(9)},${vertex.y.toFixed(9)}`),
    );
    expect(coordinates.size).toBe(graph.vertexCount());
  });
});
