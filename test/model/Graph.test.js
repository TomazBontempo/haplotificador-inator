import { describe, expect, test } from "@jest/globals";
import Graph from "../../src/model/Graph.js";

describe("Graph", () => {
  test("adds vertices and weighted undirected edges", () => {
    const graph = new Graph();
    const a = graph.addVertex("A");
    const b = graph.addVertex("B");
    const c = graph.addVertex("C");

    const ab = graph.addEdge(a, b, 2);
    graph.addEdge(b, c, 3);

    expect(graph.vertexCount()).toBe(3);
    expect(graph.edgeCount()).toBe(2);
    expect(a.degree).toBe(1);
    expect(b.degree).toBe(2);
    expect(graph.opposite(a, ab)).toBe(b);
    expect(graph.areConnected(a, c)).toBe(true);
    expect(graph.pathLength(a, c)).toBe(5);
  });

  test("removes edges and vertices while keeping indexes stable", () => {
    const graph = new Graph();
    const a = graph.addVertex("A");
    const b = graph.addVertex("B");
    const c = graph.addVertex("C");
    graph.addEdge(a, b, 1);
    graph.addEdge(b, c, 1);

    graph.removeVertex(1);

    expect(graph.vertexCount()).toBe(2);
    expect(graph.edgeCount()).toBe(0);
    expect(graph.vertex(0).label).toBe("A");
    expect(graph.vertex(1).label).toBe("C");
    expect(graph.areConnected(graph.vertex(0), graph.vertex(1))).toBe(false);
  });
});
