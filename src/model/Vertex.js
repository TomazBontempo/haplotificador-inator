export const VERTEX_COLOURS = Object.freeze({
  BLACK: "black",
  RED: "red",
  GREEN: "green",
});

export class Vertex {
  /**
   * Creates a logical graph vertex with metadata and incident-edge storage.
   */
  constructor(label, index, info = null, colour = VERTEX_COLOURS.BLACK) {
    this.label = label;
    this.index = index;
    this.info = info;
    this.colour = colour;
    this.marked = false;
    this.incidentEdges = [];
  }

  /**
   * Returns the number of incident edges.
   */
  get degree() {
    return this.incidentEdges.length;
  }

  /**
   * Marks this vertex for graph traversals.
   */
  mark() {
    this.marked = true;
  }

  /**
   * Clears this vertex's traversal mark.
   */
  unmark() {
    this.marked = false;
  }

  /**
   * Replaces the metadata payload associated with this vertex.
   */
  setInfo(info) {
    this.info = info;
  }

  /**
   * Sets the logical colour marker used by algorithms or renderers.
   */
  setColour(colour) {
    this.colour = colour;
  }

  /**
   * Records an edge that is incident to this vertex.
   */
  addIncidentEdge(edge) {
    if (edge.from !== this && edge.to !== this) {
      throw new Error("Edge is not incident to this vertex.");
    }
    if (!this.incidentEdges.includes(edge)) {
      this.incidentEdges.push(edge);
    }
  }

  /**
   * Removes an incident edge reference from this vertex.
   */
  removeIncidentEdge(edge) {
    const index = this.incidentEdges.indexOf(edge);
    if (index === -1) {
      throw new Error("Edge not found in vertex incidences.");
    }
    this.incidentEdges.splice(index, 1);
  }

  /**
   * Returns a defensive copy of incident edges.
   */
  edges() {
    return [...this.incidentEdges];
  }

  /**
   * Reports whether another vertex shares an edge with this vertex.
   */
  isAdjacent(vertex) {
    return this.incidentEdges.some((edge) => edge.from === vertex || edge.to === vertex);
  }

  /**
   * Returns one edge shared with another vertex, when present.
   */
  sharedEdge(vertex) {
    return this.incidentEdges.find((edge) => edge.from === vertex || edge.to === vertex) ?? null;
  }

  /**
   * Serializes the vertex with incident edges represented by indices.
   */
  toJSON() {
    return {
      index: this.index,
      label: this.label,
      info: this.info,
      colour: this.colour,
      marked: this.marked,
      incidentEdges: this.incidentEdges.map((edge) => edge.index),
    };
  }
}

export default Vertex;
