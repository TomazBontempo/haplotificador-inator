import Graph from "../model/Graph.js";

const BONUS = 20;
const SHORTCUT_PENALTY = 10;
const LONG_PENALTY = 5;
const INFINITY = Number.POSITIVE_INFINITY;

/**
 * Wraps TCS failures with a consistent algorithm-specific prefix.
 */
function algorithmError(message) {
  return new Error(`TCS algorithm error: ${message}`);
}

/**
 * Validates the minimal HapNet API required by TCS.
 */
function assertHapNetLike(hapNet) {
  // TCS reads sampled metadata and the condensed distance matrix, but never mutates HapNet.
  if (!hapNet || typeof hapNet.nseqs !== "number") {
    throw algorithmError("Expected a HapNet instance.");
  }

  for (const methodName of ["seqName", "seqSeq", "freq", "traits", "distance"]) {
    if (typeof hapNet[methodName] !== "function") {
      throw algorithmError(`HapNet is missing ${methodName}().`);
    }
  }
}

/**
 * Builds the metadata payload copied onto an output graph vertex.
 */
function sampledVertexInfo(hapNet, index) {
  return {
    index,
    name: hapNet.seqName(index),
    sequence: hapNet.seqSeq(index),
    frequency: hapNet.freq(index),
    traits: hapNet.traits(index),
    inferred: false,
    sampled: true,
    originalIndex: index,
  };
}

/**
 * Builds metadata for an inferred TCS intermediate vertex.
 */
function inferredVertexInfo(index) {
  return {
    index,
    name: String(index),
    sequence: null,
    frequency: 0,
    traits: [],
    inferred: true,
    sampled: false,
    originalIndex: null,
  };
}

/**
 * Builds all haplotype pairs sorted by distance for TCS processing.
 */
function buildSortedPairs(hapNet) {
  // Uses a sorted array instead of a priority queue, as required by the JS port.
  // See Architecture divergences in AGENTS.md.
  const pairs = [];

  // Match PopART TCS pair orientation: earlier haplotype first, later haplotype second.
  for (let to = 0; to < hapNet.nseqs; to += 1) {
    for (let from = 0; from < to; from += 1) {
      pairs.push({
        from,
        to,
        weight: hapNet.distance(to, from),
      });
    }
  }

  return pairs.sort((left, right) => (
    left.weight - right.weight ||
    left.to - right.to ||
    left.from - right.from
  ));
}

/**
 * Inserts a deferred same-distance bucket back into a sorted bucket array.
 */
function reinsertBucket(buckets, bucket) {
  const index = buckets.findIndex((candidate) => candidate.weight > bucket.weight);
  if (index < 0) {
    buckets.push(bucket);
  } else {
    buckets.splice(index, 0, bucket);
  }
}

/**
 * Groups a sorted pair list into the mutable distance buckets used by TCS.
 */
function buildBuckets(pairs) {
  const buckets = [];

  for (const pair of pairs) {
    const last = buckets[buckets.length - 1];
    if (last && last.weight === pair.weight) {
      last.pairs.push(pair);
    } else {
      buckets.push({
        weight: pair.weight,
        pairs: [pair],
      });
    }
  }

  return buckets;
}

/**
 * Returns a finite graph path length or Infinity when no path exists.
 */
function pathLength(graph, from, to) {
  const distance = graph.pathLength(from, to);
  return Number.isFinite(distance) ? distance : INFINITY;
}

/**
 * Scores a candidate intermediate path using PopART's TCS rules.
 */
function computeScore(hapNet, graph, componentIds, u, v, compU, compV, pathDistance, clusterDistance) {
  let score = 0;

  // PopART evaluates a proposed bridge between two components against every
  // sampled haplotype pair spanning those components. Exact agreement with the
  // observed mutational distance gets a strong bonus. A path that is too long
  // gets a small penalty. A path shorter than the current cluster distance is
  // rejected because it would create an invalid shortcut; otherwise, shorter
  // but not cluster-breaking paths get a shortcut penalty.
  for (let i = 0; i < hapNet.nseqs; i += 1) {
    if (componentIds[i] !== compU) {
      continue;
    }

    for (let j = 0; j < hapNet.nseqs; j += 1) {
      if (componentIds[j] !== compV) {
        continue;
      }

      const totalPath = (
        pathDistance +
        pathLength(graph, u, graph.vertex(i)) +
        pathLength(graph, v, graph.vertex(j))
      );
      const observedDistance = hapNet.distance(i, j);

      if (totalPath === observedDistance) {
        score += BONUS;
      } else if (totalPath > observedDistance) {
        score -= LONG_PENALTY;
      } else if (totalPath < clusterDistance) {
        return Number.NEGATIVE_INFINITY;
      } else {
        score -= SHORTCUT_PENALTY;
      }
    }
  }

  return score;
}

/**
 * Finds the best existing endpoints for a new TCS composite path.
 */
function findIntermediates(hapNet, graph, componentIds, u, v, distance) {
  const compU = componentIds[u.index];
  const compV = componentIds[v.index];

  if (compU === compV) {
    throw algorithmError("Attempting to find intermediates within a component.");
  }

  let maxScore = Number.NEGATIVE_INFINITY;
  let minPathLength = distance;
  let bestStart = graph.vertex(u.index);
  let bestEnd = graph.vertex(v.index);

  for (let i = 0; i < componentIds.length; i += 1) {
    if (componentIds[i] !== compU && componentIds[i] >= 0) {
      continue;
    }

    const candidateStart = graph.vertex(i);
    const pathUI = pathLength(graph, u, candidateStart);
    if (!Number.isFinite(pathUI) || pathUI >= distance) {
      continue;
    }

    for (let j = 0; j < componentIds.length; j += 1) {
      if (componentIds[j] !== compV && componentIds[j] >= 0) {
        continue;
      }

      const candidateEnd = graph.vertex(j);
      const pathVJ = pathLength(graph, v, candidateEnd);
      if (!Number.isFinite(pathVJ) || pathVJ + pathUI >= distance) {
        continue;
      }

      const newPathLength = distance - pathVJ - pathUI;
      const score = computeScore(
        hapNet,
        graph,
        componentIds,
        candidateStart,
        candidateEnd,
        compU,
        compV,
        newPathLength,
        distance,
      );

      if (
        score > maxScore ||
        (score === maxScore && newPathLength < minPathLength)
      ) {
        maxScore = score;
        minPathLength = newPathLength;
        bestStart = candidateStart;
        bestEnd = candidateEnd;
      }
    }
  }

  return {
    start: bestStart,
    end: bestEnd,
    length: minPathLength,
  };
}

/**
 * Creates a unit-edge path between two existing vertices.
 */
function newCompositePath(graph, componentIds, start, end, distance) {
  let current = start;

  for (let step = 1; step < distance; step += 1) {
    const index = graph.vertexCount();
    const next = graph.addVertex(String(index), inferredVertexInfo(index));
    componentIds.push(-1);
    graph.addEdge(current, next, 1, { weight: 1 });
    current = next;
  }

  graph.addEdge(current, end, 1, { weight: 1 });
}

/**
 * Collapses inferred degree-2 vertices, preserving total mutational distance.
 */
function removeRedundantIntermediates(graph, sampleCount) {
  let vertexIndex = sampleCount;

  while (vertexIndex < graph.vertexCount()) {
    const vertex = graph.vertex(vertexIndex);

    if (vertex.degree > 2) {
      vertexIndex += 1;
      continue;
    }

    if (vertex.degree !== 2) {
      throw algorithmError("Intermediate vertex has degree less than 2.");
    }

    const oldEdges = vertex.edges();
    if (oldEdges.length !== 2) {
      throw algorithmError("Vertex with degree 2 does not have 2 neighbours.");
    }

    const left = graph.opposite(vertex, oldEdges[0]);
    const right = graph.opposite(vertex, oldEdges[1]);
    if (left === right || vertex === left || vertex === right) {
      throw algorithmError("Unexpected multiple edges or self edge.");
    }

    const weight = oldEdges[0].weight + oldEdges[1].weight;
    graph.removeVertex(vertex.index);
    graph.addEdge(left, right, weight, { weight });
  }

  refreshInferredVertexLabels(graph, sampleCount);
}

/**
 * Keeps inferred labels aligned with current graph indices after simplification.
 */
function refreshInferredVertexLabels(graph, sampleCount) {
  for (let index = sampleCount; index < graph.vertexCount(); index += 1) {
    const vertex = graph.vertex(index);
    vertex.label = String(index);
    vertex.info = {
      ...vertex.info,
      index,
      name: String(index),
      inferred: true,
      sampled: false,
    };
  }
}

/**
 * Computes a PopART-compatible TCS network as a fresh Graph.
 */
export function computeTCS(hapNet) {
  assertHapNetLike(hapNet);

  const graph = new Graph();
  const componentIds = [];

  for (let index = 0; index < hapNet.nseqs; index += 1) {
    graph.addVertex(hapNet.seqName(index), sampledVertexInfo(hapNet, index));
    componentIds.push(index);
  }

  if (hapNet.nseqs <= 1) {
    return graph;
  }

  const buckets = buildBuckets(buildSortedPairs(hapNet));

  while (buckets.length > 0) {
    const bucket = buckets.shift();
    const distance = bucket.weight;
    const deferredPairs = [];
    let compA = -1;
    let compB = -1;

    for (const originalPair of bucket.pairs) {
      let u = graph.vertex(originalPair.from);
      let v = graph.vertex(originalPair.to);
      let compU = componentIds[u.index];
      let compV = componentIds[v.index];

      if (compU === compV) {
        continue;
      }

      if (compU > compV) {
        [compU, compV] = [compV, compU];
        [u, v] = [v, u];
      }

      if (compA < 0) {
        compA = compU;
        compB = compV;
      }

      if (compU === compA && compV === compB) {
        if (distance === 1) {
          graph.addEdge(u, v, 1, { weight: 1 });
        } else {
          const intermediates = findIntermediates(
            hapNet,
            graph,
            componentIds,
            u,
            v,
            distance,
          );
          const existingPath = pathLength(graph, intermediates.start, intermediates.end);

          if (Number.isFinite(existingPath) && existingPath < intermediates.length) {
            throw algorithmError("Shorter path already exists between these vertices.");
          }

          if (!Number.isFinite(existingPath) || existingPath > intermediates.length) {
            newCompositePath(
              graph,
              componentIds,
              intermediates.start,
              intermediates.end,
              intermediates.length,
            );
          }
        }
      } else {
        deferredPairs.push({
          from: u.index,
          to: v.index,
          weight: distance,
        });
      }
    }

    if (compA >= 0) {
      let compBSize = 0;

      for (let index = 0; index < componentIds.length; index += 1) {
        if (index < hapNet.nseqs && componentIds[index] === compB) {
          compBSize += 1;
        }

        if (componentIds[index] < 0 || componentIds[index] === compB) {
          componentIds[index] = compA;
        } else if (componentIds[index] > compB) {
          componentIds[index] -= 1;
        }
      }

      if (compBSize === 0) {
        throw algorithmError("Component merge did not include sampled haplotypes.");
      }
    }

    if (deferredPairs.length > 0) {
      reinsertBucket(buckets, {
        weight: distance,
        pairs: deferredPairs,
      });
    }
  }

  const sampledComponent = componentIds[0];
  for (let index = 1; index < hapNet.nseqs; index += 1) {
    if (componentIds[index] !== sampledComponent) {
      throw algorithmError("Pair list ended before all haplotypes were connected.");
    }
  }

  removeRedundantIntermediates(graph, hapNet.nseqs);
  return graph;
}

export default computeTCS;
