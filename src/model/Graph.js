import Edge from "./Edge.js";
import Vertex from "./Vertex.js";

const INFINITY = Number.POSITIVE_INFINITY;

export class Graph {
  /**
   * Creates an undirected logical graph with cached shortest-path storage.
   */
  constructor() {
    this.vertices = [];
    this.edges = [];
    this.pathLengths = [];
    this.nextPath = [];
    this.floydWarshallUpdated = false;
  }

  /**
   * Creates and stores a new vertex with the next graph index.
   */
  newVertex(label = "", info = null) {
    const vertex = new Vertex(label, this.vertices.length, info);
    this.vertices.push(vertex);
    this.floydWarshallUpdated = false;
    return vertex;
  }

  /**
   * Alias for newVertex to match the public graph API.
   */
  addVertex(label = "", info = null) {
    return this.newVertex(label, info);
  }

  /**
   * Creates and stores an undirected weighted edge between two graph vertices.
   */
  newEdge(from, to, weight = 1, info = null) {
    this.assertVertexBelongsToGraph(from);
    this.assertVertexBelongsToGraph(to);

    const edge = new Edge(from, to, this.edges.length, weight, info);
    this.edges.push(edge);
    from.addIncidentEdge(edge);
    to.addIncidentEdge(edge);
    this.floydWarshallUpdated = false;
    return edge;
  }

  /**
   * Alias for newEdge to match the public graph API.
   */
  addEdge(from, to, weight = 1, info = null) {
    return this.newEdge(from, to, weight, info);
  }

  /**
   * Returns a vertex by index or throws when the index is invalid.
   */
  vertex(index) {
    const vertex = this.vertices[index];
    if (!vertex) {
      throw new Error("Vertex index out of bounds.");
    }
    return vertex;
  }

  /**
   * Returns an edge by index or throws when the index is invalid.
   */
  edge(index) {
    const edge = this.edges[index];
    if (!edge) {
      throw new Error("Edge index out of bounds.");
    }
    return edge;
  }

  /**
   * Returns the number of vertices in the graph.
   */
  vertexCount() {
    return this.vertices.length;
  }

  /**
   * Returns the number of edges in the graph.
   */
  edgeCount() {
    return this.edges.length;
  }

  /**
   * Returns the endpoint opposite a vertex on an incident edge.
   */
  opposite(vertex, edge) {
    if (edge.from === vertex) {
      return edge.to;
    }
    if (edge.to === vertex) {
      return edge.from;
    }
    throw new Error("Vertex is not adjacent to edge.");
  }

  /**
   * Reassigns an existing edge to different endpoints.
   */
  moveEdge(index, from, to) {
    const edge = this.edge(index);
    this.assertVertexBelongsToGraph(from);
    this.assertVertexBelongsToGraph(to);

    edge.from.removeIncidentEdge(edge);
    edge.to.removeIncidentEdge(edge);
    edge.setFrom(from);
    edge.setTo(to);
    from.addIncidentEdge(edge);
    to.addIncidentEdge(edge);
    this.floydWarshallUpdated = false;
  }

  /**
   * Removes an edge and refreshes remaining edge indices.
   */
  removeEdge(index) {
    const edge = this.edge(index);
    edge.from.removeIncidentEdge(edge);
    edge.to.removeIncidentEdge(edge);
    this.edges.splice(index, 1);
    this.reindexEdges();
    this.floydWarshallUpdated = false;
  }

  /**
   * Removes a vertex and all incident edges from the graph.
   */
  removeVertex(index) {
    const vertex = this.vertex(index);
    while (vertex.degree > 0) {
      this.removeEdge(vertex.incidentEdges[0].index);
    }
    this.vertices.splice(index, 1);
    this.reindexVertices();
    this.floydWarshallUpdated = false;
  }

  /**
   * Clears traversal marks from all edges.
   */
  unmarkEdges() {
    for (const edge of this.edges) {
      edge.unmark();
    }
  }

  /**
   * Clears traversal marks from all vertices.
   */
  unmarkVertices() {
    for (const vertex of this.vertices) {
      vertex.unmark();
    }
  }

  /**
   * Tests whether two vertices are connected by any path.
   */
  areConnected(start, end) {
    this.assertVertexBelongsToGraph(start);
    this.assertVertexBelongsToGraph(end);

    if (start === end) {
      return true;
    }

    this.unmarkVertices();
    const queue = [start];

    while (queue.length > 0) {
      const vertex = queue.shift();
      if (vertex.marked) {
        continue;
      }

      vertex.mark();
      for (const edge of vertex.incidentEdges) {
        const next = this.opposite(vertex, edge);
        if (next === end) {
          return true;
        }
        if (!next.marked) {
          queue.push(next);
        }
      }
    }

    return false;
  }

  /**
   * Returns the shortest weighted path length between two vertices.
   */
  pathLength(from, to) {
    this.assertVertexBelongsToGraph(from);
    this.assertVertexBelongsToGraph(to);

    if (!this.floydWarshallUpdated) {
      this.updateFloydWarshall();
    }

    return this.pathLengths[from.index * this.vertexCount() + to.index];
  }

  /**
   * Reconstructs one shortest path between two vertices.
   */
  path(from, to) {
    this.assertVertexBelongsToGraph(from);
    this.assertVertexBelongsToGraph(to);

    if (this.pathLength(from, to) === INFINITY) {
      return [];
    }

    const intermediates = [];
    this.reconstructPath(from.index, to.index, intermediates);
    return [from, ...intermediates.map((index) => this.vertex(index)), to];
  }

  /**
   * Serializes the graph topology without renderer state.
   */
  toJSON() {
    return {
      vertices: this.vertices.map((vertex) => vertex.toJSON()),
      edges: this.edges.map((edge) => edge.toJSON()),
    };
  }

  /**
   * Ensures a vertex reference is owned by this graph instance.
   */
  assertVertexBelongsToGraph(vertex) {
    if (!vertex || this.vertices[vertex.index] !== vertex) {
      throw new Error("Vertex does not belong to this graph.");
    }
  }

  /**
   * Refreshes edge indices after deletion.
   */
  reindexEdges() {
    this.edges.forEach((edge, index) => {
      edge.index = index;
    });
  }

  /**
   * Refreshes vertex indices after deletion.
   */
  reindexVertices() {
    this.vertices.forEach((vertex, index) => {
      vertex.index = index;
    });
  }

  /**
   * Rebuilds all-pairs shortest-path caches for the logical graph.
   */
  updateFloydWarshall() {
    const count = this.vertexCount();
    this.pathLengths = Array(count * count).fill(INFINITY);
    this.nextPath = Array(count * count).fill(-1);

    for (let i = 0; i < count; i += 1) {
      this.pathLengths[i * count + i] = 0;
    }

    // Store path lengths in a flat array so graph data is simple to serialize
    // across Web Workers. See Architecture divergences in AGENTS.md.
    for (const edge of this.edges) {
      const from = edge.from.index;
      const to = edge.to.index;
      this.pathLengths[from * count + to] = Math.min(
        this.pathLengths[from * count + to],
        edge.weight,
      );
      this.pathLengths[to * count + from] = Math.min(
        this.pathLengths[to * count + from],
        edge.weight,
      );
    }

    for (let k = 0; k < count; k += 1) {
      for (let i = 0; i < count; i += 1) {
        for (let j = 0; j < count; j += 1) {
          const throughK = this.pathLengths[i * count + k] + this.pathLengths[k * count + j];
          if (throughK < this.pathLengths[i * count + j]) {
            this.pathLengths[i * count + j] = throughK;
            this.nextPath[i * count + j] = k;
          }
        }
      }
    }

    this.floydWarshallUpdated = true;
  }

  /**
   * Recursively appends cached intermediate vertices for a shortest path.
   */
  reconstructPath(fromIndex, toIndex, output) {
    const count = this.vertexCount();
    const next = this.nextPath[fromIndex * count + toIndex];
    if (next < 0) {
      return;
    }

    this.reconstructPath(fromIndex, next, output);
    output.push(next);
    this.reconstructPath(next, toIndex, output);
  }
}

export default Graph;
