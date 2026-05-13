export const VERTEX_COLOURS = Object.freeze({
  BLACK: "black",
  RED: "red",
  GREEN: "green",
});

export class Vertex {
  constructor(label, index, info = null, colour = VERTEX_COLOURS.BLACK) {
    this.label = label;
    this.index = index;
    this.info = info;
    this.colour = colour;
    this.marked = false;
    this.incidentEdges = [];
  }

  get degree() {
    return this.incidentEdges.length;
  }

  mark() {
    this.marked = true;
  }

  unmark() {
    this.marked = false;
  }

  setInfo(info) {
    this.info = info;
  }

  setColour(colour) {
    this.colour = colour;
  }

  addIncidentEdge(edge) {
    if (edge.from !== this && edge.to !== this) {
      throw new Error("Edge is not incident to this vertex.");
    }
    if (!this.incidentEdges.includes(edge)) {
      this.incidentEdges.push(edge);
    }
  }

  removeIncidentEdge(edge) {
    const index = this.incidentEdges.indexOf(edge);
    if (index === -1) {
      throw new Error("Edge not found in vertex incidences.");
    }
    this.incidentEdges.splice(index, 1);
  }

  edges() {
    return [...this.incidentEdges];
  }

  isAdjacent(vertex) {
    return this.incidentEdges.some((edge) => edge.from === vertex || edge.to === vertex);
  }

  sharedEdge(vertex) {
    return this.incidentEdges.find((edge) => edge.from === vertex || edge.to === vertex) ?? null;
  }

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
