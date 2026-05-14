import Graph from "../model/Graph.js";

function algorithmError(message) {
  // Keep algorithm failures distinct from parser/model errors in test output.
  return new Error(`MSN algorithm error: ${message}`);
}

function assertHapNetLike(hapNet) {
  // The algorithm only reads the public HapNet API needed for MSN inference.
  if (!hapNet || typeof hapNet.nseqs !== "number") {
    throw algorithmError("Expected a HapNet instance.");
  }

  // Pair distances and haplotype metadata must be exposed by the model layer.
  for (const methodName of ["seqName", "freq", "traits", "distance"]) {
    if (typeof hapNet[methodName] !== "function") {
      throw algorithmError(`HapNet is missing ${methodName}().`);
    }
  }
}

function createVertexInfo(hapNet, index) {
  // Copy HapNet metadata so the returned Graph is independent of the input.
  return {
    index,
    name: hapNet.seqName(index),
    frequency: hapNet.freq(index),
    traits: hapNet.traits(index),
  };
}

function buildSortedPairs(hapNet) {
  // PopART builds every pair before processing; this port sorts the array once.
  const pairs = [];

  // Match PopART's pair orientation: later haplotype first, earlier haplotype second.
  for (let from = 0; from < hapNet.nseqs; from += 1) {
    for (let to = 0; to < from; to += 1) {
      pairs.push({
        from,
        to,
        weight: hapNet.distance(from, to),
      });
    }
  }

  // Preserve deterministic PopART-style ordering inside equal-distance groups.
  return pairs.sort((left, right) => (
    left.weight - right.weight ||
    left.from - right.from ||
    left.to - right.to
  ));
}

class UnionFind {
  constructor(size) {
    // Each haplotype starts as its own connected component.
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
    this.componentCount = size;
  }

  find(index) {
    // Path compression keeps repeated component checks cheap.
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  connected(left, right) {
    // Components are compared by representative root.
    return this.find(left) === this.find(right);
  }

  union(left, right) {
    // Union by rank merges two components without depending on vertex order.
    let leftRoot = this.find(left);
    let rightRoot = this.find(right);

    if (leftRoot === rightRoot) {
      return false;
    }

    if (this.rank[leftRoot] < this.rank[rightRoot]) {
      const tmp = leftRoot;
      leftRoot = rightRoot;
      rightRoot = tmp;
    }

    this.parent[rightRoot] = leftRoot;
    if (this.rank[leftRoot] === this.rank[rightRoot]) {
      this.rank[leftRoot] += 1;
    }

    this.componentCount -= 1;
    return true;
  }
}

export function computeMSN(hapNet) {
  assertHapNetLike(hapNet);

  // The result is a fresh Graph; the HapNet input is never modified.
  const graph = new Graph();
  const vertices = [];

  // Add one graph vertex for each condensed haplotype.
  for (let index = 0; index < hapNet.nseqs; index += 1) {
    vertices.push(graph.addVertex(hapNet.seqName(index), createVertexInfo(hapNet, index)));
  }

  // Zero or one haplotype is already connected.
  if (hapNet.nseqs <= 1) {
    return graph;
  }

  const pairs = buildSortedPairs(hapNet);
  const unionFind = new UnionFind(hapNet.nseqs);

  // Process equal-distance pairs as a batch, mirroring PopART's AbstractMSN.
  for (let cursor = 0; cursor < pairs.length && unionFind.componentCount > 1;) {
    const threshold = pairs[cursor].weight;
    const connectablePairs = [];

    // Select all pairs that connect different pre-threshold components.
    while (cursor < pairs.length && pairs[cursor].weight === threshold) {
      const pair = pairs[cursor];
      if (!unionFind.connected(pair.from, pair.to)) {
        connectablePairs.push(pair);
      }
      cursor += 1;
    }

    // Add every equally minimal edge before merging the components.
    for (const pair of connectablePairs) {
      graph.addEdge(vertices[pair.from], vertices[pair.to], pair.weight, {
        weight: pair.weight,
      });
    }

    // Merge components only after the whole threshold group has been emitted.
    for (const pair of connectablePairs) {
      unionFind.union(pair.from, pair.to);
    }
  }

  // A complete distance matrix should always make the graph connected.
  if (unionFind.componentCount > 1) {
    throw algorithmError("Pair list ended before all haplotypes were connected.");
  }

  return graph;
}

export default computeMSN;
