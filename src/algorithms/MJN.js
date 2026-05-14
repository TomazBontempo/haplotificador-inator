import Graph from "../model/Graph.js";
import { computeMSN } from "./MSN.js";

/**
 * Wraps MJN failures with a consistent algorithm-specific prefix.
 */
function algorithmError(message) {
  // Keep algorithm failures distinct from parser/model errors in test output.
  return new Error(`MJN algorithm error: ${message}`);
}

/**
 * Validates the minimal HapNet API required by MJN.
 */
function assertHapNetLike(hapNet) {
  // MJN reads sampled metadata plus sequence distances, but never mutates HapNet.
  if (!hapNet || typeof hapNet.nseqs !== "number") {
    throw algorithmError("Expected a HapNet instance.");
  }

  // Median vectors are compared with HapNet's existing weighted distance rules.
  for (const methodName of ["seqName", "seqSeq", "freq", "traits", "pairwiseDistance"]) {
    if (typeof hapNet[methodName] !== "function") {
      throw algorithmError(`HapNet is missing ${methodName}().`);
    }
  }
}

class UnionFind {
  /**
   * Creates one disjoint-set component for each sequence type.
   */
  constructor(size) {
    // Sequence types start disconnected before each MSN-style pass.
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
    this.componentCount = size;
  }

  /**
   * Returns the representative component for an index.
   */
  find(index) {
    // Path compression keeps feasible-link component checks cheap.
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  /**
   * Reports whether two indices currently share a component.
   */
  connected(left, right) {
    // Components are compared by representative root.
    return this.find(left) === this.find(right);
  }

  /**
   * Merges two components and reports whether a merge occurred.
   */
  union(left, right) {
    // Union by rank avoids making component merges depend on vertex order.
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

/**
 * Copies one sampled haplotype into MJN's internal sequence-type list.
 */
function sampledType(hapNet, index) {
  // Metadata is copied so the output Graph stays independent from HapNet.
  return {
    sampled: true,
    sequence: hapNet.seqSeq(index),
    label: hapNet.seqName(index),
    originalIndex: index,
    frequency: hapNet.freq(index),
    traits: hapNet.traits(index),
  };
}

/**
 * Creates an inferred sequence type for a newly generated median vector.
 */
function inferredType(sequence) {
  // PopART exports inferred medians as unlabeled graph-index vertices.
  return {
    sampled: false,
    sequence,
    label: "",
    originalIndex: null,
    frequency: 0,
    traits: [],
  };
}

/**
 * Returns the PopART-compatible graph label for a sequence type.
 */
function vertexLabel(type, index) {
  // Sampled vertices keep haplotype names; inferred vertices use zero-based indices.
  return type.sampled ? type.label : String(index);
}

/**
 * Builds the metadata payload copied onto an output graph vertex.
 */
function vertexInfo(type, index) {
  // Mark inferred vertices explicitly so renderers can style median vectors later.
  return {
    index,
    name: vertexLabel(type, index),
    sequence: type.sequence,
    frequency: type.frequency,
    traits: [...type.traits],
    inferred: !type.sampled,
    sampled: type.sampled,
    originalIndex: type.originalIndex,
  };
}

/**
 * Materializes a Graph from the current sequence-type and feasible-edge lists.
 */
function buildGraph(types, edges) {
  // Each pass returns a fresh Graph; transient MJN state stays in plain arrays.
  const graph = new Graph();
  const vertices = types.map((type, index) => (
    graph.addVertex(vertexLabel(type, index), vertexInfo(type, index))
  ));

  // Edge weights are the weighted Hamming distances between sequence types.
  for (const edge of edges) {
    graph.addEdge(vertices[edge.from], vertices[edge.to], edge.weight, {
      weight: edge.weight,
      feasible: true,
    });
  }

  return graph;
}

/**
 * Reads one symmetric distance-matrix cell from flat storage.
 */
function distanceAt(distances, count, from, to) {
  return distances[from * count + to];
}

/**
 * Computes the current weighted distance matrix for sampled and inferred types.
 */
function computeDistances(hapNet, types) {
  // Use HapNet's distance semantics so masking, site weights, and ambiguity agree.
  const count = types.length;
  const distances = Array(count * count).fill(0);

  for (let from = 0; from < count; from += 1) {
    for (let to = 0; to < from; to += 1) {
      const distance = hapNet.pairwiseDistance(types[from].sequence, types[to].sequence);
      distances[from * count + to] = distance;
      distances[to * count + from] = distance;
    }
  }

  return distances;
}

/**
 * Builds all sequence-type pairs sorted by distance for MSN-style processing.
 */
function buildSortedPairs(distances, count) {
  // Uses a sorted array instead of a priority queue, as required by the JS port.
  // See Architecture divergences in AGENTS.md.
  const pairs = [];

  // Match PopART's pair orientation: later sequence type first, earlier second.
  for (let from = 0; from < count; from += 1) {
    for (let to = 0; to < from; to += 1) {
      pairs.push({
        from,
        to,
        weight: distanceAt(distances, count, from, to),
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

/**
 * Computes PopART's feasible-link network for the current sequence types.
 */
function computeFeasibleNetwork(types, distances, epsilon) {
  const count = types.length;
  if (count <= 1) {
    return buildGraph(types, []);
  }

  const pairs = buildSortedPairs(distances, count);
  const msnComponents = new UnionFind(count);
  const thresholdComponents = new UnionFind(count);
  const feasibleEdges = [];
  let cursor = 0;
  let thresholdCursor = 0;
  let maxValue = Number.POSITIVE_INFINITY;

  // Process distance thresholds in ascending order, like PopART's VertContainer queue.
  while (cursor < pairs.length) {
    const threshold = pairs[cursor].weight;
    if (threshold > maxValue) {
      break;
    }

    // The threshold graph contains links strictly shorter than threshold - epsilon.
    while (
      thresholdCursor < pairs.length &&
      pairs[thresholdCursor].weight < threshold - epsilon
    ) {
      thresholdComponents.union(pairs[thresholdCursor].from, pairs[thresholdCursor].to);
      thresholdCursor += 1;
    }

    const thresholdPairs = [];
    // Feasible links are pairs not already connected in the threshold graph.
    while (cursor < pairs.length && pairs[cursor].weight === threshold) {
      const pair = pairs[cursor];
      thresholdPairs.push(pair);
      if (!thresholdComponents.connected(pair.from, pair.to)) {
        feasibleEdges.push(pair);
      }
      cursor += 1;
    }

    // The relaxed MSN pass continues through threshold + epsilon after connection.
    for (const pair of thresholdPairs) {
      msnComponents.union(pair.from, pair.to);
      if (msnComponents.componentCount === 1 && maxValue === Number.POSITIVE_INFINITY) {
        maxValue = threshold + epsilon;
      }
    }
  }

  if (msnComponents.componentCount > 1) {
    throw algorithmError("Pair list ended before all sequence types were connected.");
  }

  // Only feasible links survive; non-feasible links are discarded immediately.
  return buildGraph(types, feasibleEdges);
}

/**
 * Removes inferred sequence types that cannot contribute to the MJN topology.
 */
function removeObsoleteTypes(types, graph, sampleCount) {
  let removedAny = false;
  let changed = true;

  // Removing one inferred leaf can make another inferred vertex obsolete.
  while (changed) {
    changed = false;

    // Sampled haplotypes are never obsolete, even when peripheral.
    for (let index = sampleCount; index < graph.vertexCount(); index += 1) {
      if (graph.vertex(index).degree < 2) {
        graph.removeVertex(index);
        types.splice(index, 1);
        removedAny = true;
        changed = true;
        index -= 1;
      }
    }
  }

  return removedAny;
}

/**
 * Extracts graph edges as stable index triples for feasible-triplet scanning.
 */
function graphEdges(graph) {
  return graph.edges.map((edge) => ({
    from: edge.from.index,
    to: edge.to.index,
    weight: edge.weight,
  }));
}

/**
 * Finds triplets that have at least two feasible links among their pairs.
 */
function feasibleTriplets(edges) {
  const triplets = [];

  // PopART scans each feasible link against earlier feasible links only.
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];

    for (let previousIndex = 0; previousIndex < edgeIndex; previousIndex += 1) {
      const previous = edges[previousIndex];
      let third = null;

      if (previous.from === edge.from || previous.from === edge.to) {
        third = previous.to;
      } else if (previous.to === edge.from || previous.to === edge.to) {
        third = previous.from;
      }

      if (third !== null) {
        triplets.push([edge.from, edge.to, third]);
      }
    }
  }

  return triplets;
}

/**
 * Computes all quasi-median sequences for one feasible triplet.
 */
function computeQuasiMedianSeqs(seqA, seqB, seqC) {
  const template = Array.from(seqA);
  let hasStar = false;

  // Majority sites are fixed; three-state sites become branching star positions.
  for (let index = 0; index < template.length; index += 1) {
    if (seqA[index] === seqB[index] || seqA[index] === seqC[index]) {
      continue;
    }
    if (seqB[index] === seqC[index]) {
      template[index] = seqB[index];
    } else {
      template[index] = "*";
      hasStar = true;
    }
  }

  if (!hasStar) {
    return [template.join("")];
  }

  const medians = new Set();
  const stack = [template.join("")];

  // Expand every star position into the three distinguished median vectors.
  while (stack.length > 0) {
    const sequence = stack.pop();
    const starIndex = sequence.indexOf("*");
    const nextStarIndex = sequence.indexOf("*", starIndex + 1);
    const first = Array.from(sequence);
    const second = Array.from(sequence);
    const third = Array.from(sequence);

    first[starIndex] = seqA[starIndex];
    second[starIndex] = seqB[starIndex];
    third[starIndex] = seqC[starIndex];

    if (nextStarIndex < 0) {
      medians.add(first.join(""));
      medians.add(second.join(""));
      medians.add(third.join(""));
    } else {
      stack.push(first.join(""));
      stack.push(second.join(""));
      stack.push(third.join(""));
    }
  }

  return [...medians].sort();
}

/**
 * Computes the total triplet connection cost through one median vector.
 */
function connectionCost(hapNet, seqU, seqV, seqW, median) {
  return (
    hapNet.pairwiseDistance(seqU, median) +
    hapNet.pairwiseDistance(seqV, median) +
    hapNet.pairwiseDistance(seqW, median)
  );
}

/**
 * Generates every new median vector within the minimum-cost epsilon window.
 */
function addMedianVectors(hapNet, types, graph, epsilon) {
  const edges = graphEdges(graph);
  const triplets = feasibleTriplets(edges);
  const sequenceSet = new Set(types.map((type) => type.sequence));
  const candidates = [];
  let minCost = Number.POSITIVE_INFINITY;

  // First pass finds the global minimum cost among all feasible triplet medians.
  for (const [u, v, w] of triplets) {
    const seqU = types[u].sequence;
    const seqV = types[v].sequence;
    const seqW = types[w].sequence;
    const medians = computeQuasiMedianSeqs(seqU, seqV, seqW);

    for (const median of medians) {
      if (sequenceSet.has(median)) {
        continue;
      }

      const cost = connectionCost(hapNet, seqU, seqV, seqW, median);
      candidates.push({ median, cost });
      if (cost < minCost) {
        minCost = cost;
      }
    }
  }

  let changed = false;
  // Second pass adds all still-new medians whose costs are within epsilon.
  for (const candidate of candidates) {
    if (!sequenceSet.has(candidate.median) && candidate.cost <= minCost + epsilon) {
      types.push(inferredType(candidate.median));
      sequenceSet.add(candidate.median);
      changed = true;
    }
  }

  return changed;
}

/**
 * Computes a Median-Joining Network as a fresh Graph without mutating HapNet.
 */
export function computeMJN(hapNet, epsilon = 0) {
  assertHapNetLike(hapNet);

  // MJN starts from the sampled MSN, but then needs feasible-link MSN passes
  // over the expanded sampled-plus-median sequence set.
  computeMSN(hapNet);

  const sampleCount = hapNet.nseqs;
  const types = Array.from({ length: sampleCount }, (_, index) => sampledType(hapNet, index));
  let changed = false;

  // Phase I: repeatedly add useful median vectors and prune obsolete medians.
  do {
    const distances = computeDistances(hapNet, types);
    const graph = computeFeasibleNetwork(types, distances, epsilon);
    const removedObsolete = removeObsoleteTypes(types, graph, sampleCount);
    const addedMedians = addMedianVectors(hapNet, types, graph, epsilon);
    changed = removedObsolete || addedMedians;
  } while (changed);

  let finalGraph = null;
  // Phase II: build the final epsilon-zero MSN and remove obsolete medians.
  do {
    const distances = computeDistances(hapNet, types);
    finalGraph = computeFeasibleNetwork(types, distances, 0);
    changed = removeObsoleteTypes(types, finalGraph, sampleCount);
  } while (changed);

  return finalGraph;
}

export default computeMJN;
