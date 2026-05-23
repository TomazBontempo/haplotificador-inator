/**
 * @fileoverview
 * Runs force-directed layout inside a Web Worker.
 * Receives serialized Graph JSON and posts back the graph with updated positions.
 */

import Graph from "../model/Graph.js";
import { computeLayout } from "../layout/NetworkLayout.js";

/**
 * Rebuilds a Graph instance from the plain data sent across the worker boundary.
 */
function reconstructGraph(graphJSON) {
  if (!graphJSON || !Array.isArray(graphJSON.vertices) || !Array.isArray(graphJSON.edges)) {
    throw new Error("Expected serialized Graph data.");
  }

  const graph = new Graph();
  // Preserve original vertex indexes before rebuilding edges that refer to them.
  const vertices = [...graphJSON.vertices].sort((left, right) => left.index - right.index);

  for (const vertexJSON of vertices) {
    const vertex = graph.addVertex(vertexJSON.label ?? "", vertexJSON.info ?? null);
    vertex.colour = vertexJSON.colour ?? vertex.colour;
    vertex.marked = Boolean(vertexJSON.marked);
    if (Number.isFinite(vertexJSON.x)) {
      vertex.x = vertexJSON.x;
    }
    if (Number.isFinite(vertexJSON.y)) {
      vertex.y = vertexJSON.y;
    }
    if (Number.isFinite(vertexJSON.radius)) {
      vertex.radius = vertexJSON.radius;
    }
  }

  // Edge order is restored for stable serialized output after layout finishes.
  const edges = [...graphJSON.edges].sort((left, right) => left.index - right.index);
  for (const edgeJSON of edges) {
    const edge = graph.addEdge(
      graph.vertex(edgeJSON.from),
      graph.vertex(edgeJSON.to),
      edgeJSON.weight ?? 1,
      edgeJSON.info ?? null,
    );
    edge.colour = edgeJSON.colour ?? edge.colour;
    edge.marked = Boolean(edgeJSON.marked);
  }

  return graph;
}

/**
 * Converts the laid-out Graph into plain data for postMessage.
 */
function serializeGraph(graph) {
  return {
    vertices: graph.vertices.map((vertex) => ({
      index: vertex.index,
      label: vertex.label,
      info: vertex.info,
      colour: vertex.colour,
      marked: vertex.marked,
      x: vertex.x,
      y: vertex.y,
      radius: vertex.radius,
      // Edge references are serialized by index because object identity cannot
      // be shared with the main thread.
      incidentEdges: vertex.incidentEdges.map((edge) => edge.index),
    })),
    edges: graph.edges.map((edge) => ({
      index: edge.index,
      from: edge.from.index,
      to: edge.to.index,
      weight: edge.weight,
      info: edge.info,
      colour: edge.colour,
      marked: edge.marked,
    })),
  };
}

/**
 * Handles one layout request and reports either a serialized graph or error.
 */
self.onmessage = (event) => {
  const { graphJSON, options } = event.data;
  try {
    // Layout mutates vertex positions in place; reconstructing from JSON keeps
    // the main thread's live graph untouched until the result is posted back.
    const graph = reconstructGraph(graphJSON);
    const layoutGraph = computeLayout(graph, options ?? {});
    self.postMessage({ graph: serializeGraph(layoutGraph) });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
