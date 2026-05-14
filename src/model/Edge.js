export const EDGE_COLOURS = Object.freeze({
  BLACK: "black",
  RED: "red",
  GREEN: "green",
});

export class Edge {
  /**
   * Creates a logical undirected edge between two endpoint vertices.
   */
  constructor(from, to, index, weight = 1, info = null, colour = EDGE_COLOURS.BLACK) {
    if (!from || !to) {
      throw new Error("Edge requires both endpoint vertices.");
    }

    this.from = from;
    this.to = to;
    this.index = index;
    this.weight = weight;
    this.info = info;
    this.colour = colour;
    this.marked = false;
  }

  /**
   * Marks this edge for graph traversals or algorithm bookkeeping.
   */
  mark() {
    this.marked = true;
  }

  /**
   * Clears this edge's traversal mark.
   */
  unmark() {
    this.marked = false;
  }

  /**
   * Replaces the first endpoint reference.
   */
  setFrom(vertex) {
    this.from = vertex;
  }

  /**
   * Replaces the second endpoint reference.
   */
  setTo(vertex) {
    this.to = vertex;
  }

  /**
   * Sets the edge weight used by graph algorithms.
   */
  setWeight(weight) {
    this.weight = weight;
  }

  /**
   * Replaces the metadata payload associated with this edge.
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
   * Serializes the edge with endpoint vertices represented by indices.
   */
  toJSON() {
    return {
      index: this.index,
      from: this.from.index,
      to: this.to.index,
      weight: this.weight,
      info: this.info,
      colour: this.colour,
      marked: this.marked,
    };
  }
}

export default Edge;
