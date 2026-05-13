import Edge from "./Edge.js";
import Vertex from "./Vertex.js";

const INFINITY = Number.POSITIVE_INFINITY;

export class Graph {
  constructor() {
    this.vertices = [];
    this.edges = [];
    this.pathLengths = [];
    this.nextPath = [];
    this.floydWarshallUpdated = false;
  }

  newVertex(label = "", info = null) {
    const vertex = new Vertex(label, this.vertices.length, info);
    this.vertices.push(vertex);
    this.floydWarshallUpdated = false;
    return vertex;
  }

  addVertex(label = "", info = null) {
    return this.newVertex(label, info);
  }

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

  addEdge(from, to, weight = 1, info = null) {
    return this.newEdge(from, to, weight, info);
  }

  vertex(index) {
    const vertex = this.vertices[index];
    if (!vertex) {
      throw new Error("Vertex index out of bounds.");
    }
    return vertex;
  }

  edge(index) {
    const edge = this.edges[index];
    if (!edge) {
      throw new Error("Edge index out of bounds.");
    }
    return edge;
  }

  vertexCount() {
    return this.vertices.length;
  }

  edgeCount() {
    return this.edges.length;
  }

  opposite(vertex, edge) {
    if (edge.from === vertex) {
      return edge.to;
    }
    if (edge.to === vertex) {
      return edge.from;
    }
    throw new Error("Vertex is not adjacent to edge.");
  }

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

  removeEdge(index) {
    const edge = this.edge(index);
    edge.from.removeIncidentEdge(edge);
    edge.to.removeIncidentEdge(edge);
    this.edges.splice(index, 1);
    this.reindexEdges();
    this.floydWarshallUpdated = false;
  }

  removeVertex(index) {
    const vertex = this.vertex(index);
    while (vertex.degree > 0) {
      this.removeEdge(vertex.incidentEdges[0].index);
    }
    this.vertices.splice(index, 1);
    this.reindexVertices();
    this.floydWarshallUpdated = false;
  }

  unmarkEdges() {
    for (const edge of this.edges) {
      edge.unmark();
    }
  }

  unmarkVertices() {
    for (const vertex of this.vertices) {
      vertex.unmark();
    }
  }

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

  pathLength(from, to) {
    this.assertVertexBelongsToGraph(from);
    this.assertVertexBelongsToGraph(to);

    if (!this.floydWarshallUpdated) {
      this.updateFloydWarshall();
    }

    return this.pathLengths[from.index * this.vertexCount() + to.index];
  }

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

  toJSON() {
    return {
      vertices: this.vertices.map((vertex) => vertex.toJSON()),
      edges: this.edges.map((edge) => edge.toJSON()),
    };
  }

  assertVertexBelongsToGraph(vertex) {
    if (!vertex || this.vertices[vertex.index] !== vertex) {
      throw new Error("Vertex does not belong to this graph.");
    }
  }

  reindexEdges() {
    this.edges.forEach((edge, index) => {
      edge.index = index;
    });
  }

  reindexVertices() {
    this.vertices.forEach((vertex, index) => {
      vertex.index = index;
    });
  }

  updateFloydWarshall() {
    const count = this.vertexCount();
    this.pathLengths = Array(count * count).fill(INFINITY);
    this.nextPath = Array(count * count).fill(-1);

    for (let i = 0; i < count; i += 1) {
      this.pathLengths[i * count + i] = 0;
    }

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
