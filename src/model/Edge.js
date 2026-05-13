export const EDGE_COLOURS = Object.freeze({
  BLACK: "black",
  RED: "red",
  GREEN: "green",
});

export class Edge {
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

  mark() {
    this.marked = true;
  }

  unmark() {
    this.marked = false;
  }

  setFrom(vertex) {
    this.from = vertex;
  }

  setTo(vertex) {
    this.to = vertex;
  }

  setWeight(weight) {
    this.weight = weight;
  }

  setInfo(info) {
    this.info = info;
  }

  setColour(colour) {
    this.colour = colour;
  }

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
