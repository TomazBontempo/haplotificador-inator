import { createRequire } from "node:module";
import Graph from "../model/Graph.js";

const INFINITY = Number.POSITIVE_INFINITY;
const require = createRequire(import.meta.url);
const loadHighs = require("highs");

/**
 * Wraps IntNJ failures with a consistent algorithm-specific prefix.
 */
function algorithmError(message) {
  return new Error(`IntNJ algorithm error: ${message}`);
}

/**
 * Validates the minimal HapNet API required by IntNJ.
 */
function assertHapNetLike(hapNet) {
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
 * Builds the metadata payload copied onto a sampled output vertex.
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
 * Builds metadata for an inferred IntNJ internal vertex.
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
 * Keeps inferred labels aligned with graph indices after topology changes.
 */
function refreshInferredVertexLabels(graph, sampleCount) {
  for (let index = sampleCount; index < graph.vertexCount(); index += 1) {
    const vertex = graph.vertex(index);
    vertex.label = String(index);
    vertex.info = {
      ...vertex.info,
      ...inferredVertexInfo(index),
    };
  }
}

/**
 * Clamps IntNJ's regularisation parameter to the range used by PopART.
 */
function normalizeAlpha(alpha) {
  if (!Number.isFinite(alpha)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, alpha));
}

/**
 * Reads one symmetric distance-matrix cell from flat storage.
 */
function distanceAt(distances, count, from, to) {
  return distances[from * count + to];
}

/**
 * Computes the initial Hamming-distance matrix over condensed haplotypes.
 */
function computeDistanceMatrix(hapNet) {
  const count = hapNet.nseqs;
  const distances = Array(count * count).fill(0);

  for (let from = 0; from < count; from += 1) {
    for (let to = 0; to < from; to += 1) {
      const distance = hapNet.distance(from, to);
      distances[from * count + to] = distance;
      distances[to * count + from] = distance;
    }
  }

  return distances;
}

/**
 * Computes one neighbour-joining branch length before matrix reduction.
 */
function newNJDistance(distances, count, from, to) {
  let distance = 0.5 * distanceAt(distances, count, from, to);
  let sum = 0;

  for (let index = 0; index < count; index += 1) {
    sum += distanceAt(distances, count, from, index);
    sum -= distanceAt(distances, count, to, index);
  }

  distance += sum / (2 * (count - 2));
  return Math.max(0, distance);
}

/**
 * Reduces the neighbour-joining distance matrix after merging a pair.
 */
function reduceNJMatrix(distances, count, first, second, firstLength, secondLength) {
  const nextCount = count - 1;
  const next = Array(nextCount * nextCount).fill(0);

  for (let row = 0; row < nextCount; row += 1) {
    for (let col = 0; col < row; col += 1) {
      let newDistance;

      if (row === second) {
        if (col >= first) {
          newDistance = 0.5 * (
            distanceAt(distances, count, first, col + 1) - firstLength +
            distanceAt(distances, count, second, col + 1) - secondLength
          );
        } else {
          newDistance = 0.5 * (
            distanceAt(distances, count, first, col) - firstLength +
            distanceAt(distances, count, second, col) - secondLength
          );
        }
      } else if (col === second) {
        if (row >= first) {
          newDistance = 0.5 * (
            distanceAt(distances, count, row + 1, first) - firstLength +
            distanceAt(distances, count, row + 1, second) - secondLength
          );
        } else {
          newDistance = 0.5 * (
            distanceAt(distances, count, row, first) - firstLength +
            distanceAt(distances, count, row, second) - secondLength
          );
        }
      } else if (row >= first) {
        newDistance = col >= first
          ? distanceAt(distances, count, row + 1, col + 1)
          : distanceAt(distances, count, row + 1, col);
      } else {
        if (col >= first) {
          throw algorithmError("Neighbour-joining matrix indices are inconsistent.");
        }
        newDistance = distanceAt(distances, count, row, col);
      }

      next[row * nextCount + col] = newDistance;
      next[col * nextCount + row] = newDistance;
    }
  }

  return next;
}

/**
 * Infers PopART's neighbour-joining backbone tree with real-valued edges.
 */
function integerNJTree(hapNet) {
  const graph = new Graph();
  const active = [];

  for (let index = 0; index < hapNet.nseqs; index += 1) {
    active.push(graph.addVertex(hapNet.seqName(index), sampledVertexInfo(hapNet, index)));
  }

  if (hapNet.nseqs <= 1) {
    return graph;
  }

  let count = hapNet.nseqs;
  let distances = computeDistanceMatrix(hapNet);

  while (count > 2) {
    let minValue = INFINITY;
    let first = -1;
    let second = -1;

    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < row; col += 1) {
        let qValue = (count - 2) * distanceAt(distances, count, row, col);

        for (let other = 0; other < count; other += 1) {
          qValue -= distanceAt(distances, count, row, other);
          qValue -= distanceAt(distances, count, col, other);
        }

        if (qValue < minValue) {
          minValue = qValue;
          first = row;
          second = col;
        }
      }
    }

    if (first < 0 || second < 0 || second >= first) {
      throw algorithmError("Unable to choose a neighbour-joining pair.");
    }

    const firstLength = newNJDistance(distances, count, first, second);
    const secondLength = newNJDistance(distances, count, second, first);
    const ancestorIndex = graph.vertexCount();
    const ancestor = graph.addVertex(String(ancestorIndex), inferredVertexInfo(ancestorIndex));
    const firstVertex = graph.vertex(active[first].index);
    const secondVertex = graph.vertex(active[second].index);

    graph.addEdge(ancestor, secondVertex, secondLength, { weight: secondLength });
    graph.addEdge(ancestor, firstVertex, firstLength, { weight: firstLength });

    distances = reduceNJMatrix(distances, count, first, second, firstLength, secondLength);
    active[second] = ancestor;
    active.splice(first, 1);
    count -= 1;
  }

  graph.addEdge(
    graph.vertex(active[0].index),
    graph.vertex(active[1].index),
    distanceAt(distances, count, 1, 0),
    { weight: distanceAt(distances, count, 1, 0) },
  );

  return graph;
}

/**
 * Returns the edge sequence along the current shortest path between two vertices.
 */
function pathEdges(graph, from, to) {
  const path = graph.path(from, to);
  const edges = [];

  for (let index = 1; index < path.length; index += 1) {
    const edge = path[index - 1].sharedEdge(path[index]);
    if (!edge) {
      throw algorithmError("Shortest path contains non-adjacent vertices.");
    }
    edges.push(edge);
  }

  return edges;
}

/**
 * Formats a numeric LP coefficient without losing small tie-break values.
 */
function lpNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toPrecision(12);
}

/**
 * Formats one LP objective or constraint expression.
 */
function lpExpression(terms) {
  if (terms.length === 0) {
    return "0";
  }

  return terms.map(({ coefficient, variable }, index) => {
    const sign = coefficient < 0 ? "-" : "+";
    const magnitude = Math.abs(coefficient);
    const body = magnitude === 1 ? variable : `${lpNumber(magnitude)} ${variable}`;

    return index === 0
      ? (coefficient < 0 ? `- ${body}` : body)
      : `${sign} ${body}`;
  }).join(" ");
}

/**
 * Solves PopART's integer linear program for backbone edge weights.
 */
function optimiseEdges(highs, graph, hapNet) {
  const edgeCount = graph.edgeCount();
  if (edgeCount === 0) {
    return;
  }

  const objectiveTerms = graph.edges.map((edge) => ({
    coefficient: 1000000 + edge.index,
    variable: `e_${edge.index}`,
  }));
  const lines = [
    "Minimize",
    ` obj: ${lpExpression(objectiveTerms)}`,
    "Subject To",
  ];

  for (let from = 0; from < hapNet.nseqs; from += 1) {
    for (let to = from + 1; to < hapNet.nseqs; to += 1) {
      const terms = pathEdges(graph, graph.vertex(from), graph.vertex(to)).map((edge) => ({
        coefficient: 1,
        variable: `e_${edge.index}`,
      }));
      lines.push(` p_${from}_${to}: ${lpExpression(terms)} >= ${hapNet.distance(from, to)}`);
    }
  }

  lines.push("Bounds");
  for (const edge of graph.edges) {
    lines.push(` 0 <= e_${edge.index}`);
  }

  lines.push("General");
  for (const edge of graph.edges) {
    lines.push(` e_${edge.index}`);
  }
  lines.push("End");

  const solution = highs.solve(lines.join("\n"), {
    mip_rel_gap: 0,
    mip_abs_gap: 0,
  });

  if (solution.Status !== "Optimal") {
    throw algorithmError(`Integer edge optimisation failed with status "${solution.Status}".`);
  }

  for (const edge of graph.edges) {
    const value = solution.Columns[`e_${edge.index}`]?.Primal ?? 0;
    const weight = Math.max(0, Math.round(value));
    edge.setWeight(weight);
    edge.setInfo({ ...(edge.info ?? {}), weight });
  }
}

/**
 * Removes zero-length internal edges by merging the non-leaf endpoint.
 */
function collapseZeroInternalEdges(graph, sampleCount) {
  for (let edgeIndex = graph.edgeCount(); edgeIndex > 0; edgeIndex -= 1) {
    const edge = graph.edge(edgeIndex - 1);
    if (edge.weight !== 0) {
      continue;
    }

    let keep = graph.vertex(edge.from.index);
    let remove = graph.vertex(edge.to.index);

    if (keep.index < sampleCount && remove.index < sampleCount) {
      continue;
    }

    if (keep.index > remove.index) {
      [keep, remove] = [remove, keep];
    }

    const incidentEdges = remove.edges();
    for (let index = incidentEdges.length; index > 0; index -= 1) {
      const incident = incidentEdges[index - 1];
      if (incident === edge) {
        continue;
      }

      const opposite = graph.opposite(remove, incident);
      graph.moveEdge(incident.index, keep, opposite);
    }

    graph.removeVertex(remove.index);
  }

  refreshInferredVertexLabels(graph, sampleCount);
}

/**
 * Builds an explicit shortest-path cache for reticulation scans.
 */
function createReticulationCache(graph, hapNet) {
  graph.updateFloydWarshall();
  const cache = {
    vertexCount: graph.vertexCount(),
    sampleCount: hapNet.nseqs,
    distances: [...graph.pathLengths],
    totalExcess: 0,
  };

  refreshCachedTotalExcess(cache, hapNet);
  return cache;
}

/**
 * Reads one all-vertex distance from the reticulation cache.
 */
function cachedDistance(cache, from, to) {
  return cache.distances[from * cache.vertexCount + to];
}

/**
 * Writes one symmetric all-vertex distance in the reticulation cache.
 */
function setCachedDistance(cache, from, to, value) {
  cache.distances[from * cache.vertexCount + to] = value;
  cache.distances[to * cache.vertexCount + from] = value;
}

/**
 * Recomputes total sampled-pair excess from cached path lengths.
 */
function refreshCachedTotalExcess(cache, hapNet) {
  let excess = 0;

  for (let from = 0; from < hapNet.nseqs; from += 1) {
    for (let to = 0; to < from; to += 1) {
      const value = cachedDistance(cache, from, to) - hapNet.distance(from, to);
      if (value < 0) {
        throw algorithmError("Path length is shorter than allowed.");
      }
      excess += value;
    }
  }

  cache.totalExcess = excess;
}

/**
 * Clones a reticulation cache before evaluating a tentative graph edit.
 */
function cloneReticulationCache(cache) {
  return {
    vertexCount: cache.vertexCount,
    sampleCount: cache.sampleCount,
    distances: [...cache.distances],
    totalExcess: cache.totalExcess,
  };
}

/**
 * Adds a split vertex to the distance cache without changing old distances.
 */
function appendSplitVertexToCache(cache, edge, offset) {
  const oldCount = cache.vertexCount;
  const nextCount = oldCount + 1;
  const nextDistances = Array(nextCount * nextCount).fill(INFINITY);
  const newIndex = oldCount;

  for (let row = 0; row < oldCount; row += 1) {
    for (let col = 0; col < oldCount; col += 1) {
      nextDistances[row * nextCount + col] = cachedDistance(cache, row, col);
    }
  }

  nextDistances[newIndex * nextCount + newIndex] = 0;
  for (let vertex = 0; vertex < oldCount; vertex += 1) {
    const distance = Math.min(
      cachedDistance(cache, vertex, edge.from.index) + offset,
      cachedDistance(cache, vertex, edge.to.index) + edge.weight - offset,
    );
    nextDistances[vertex * nextCount + newIndex] = distance;
    nextDistances[newIndex * nextCount + vertex] = distance;
  }

  cache.vertexCount = nextCount;
  cache.distances = nextDistances;
  return newIndex;
}

/**
 * Resolves the cache vertex index for a reticulation endpoint.
 */
function candidateEndpointIndex(cache, edge, offset) {
  if (offset === 0) {
    return edge.from.index;
  }
  if (offset === edge.weight) {
    return edge.to.index;
  }
  return appendSplitVertexToCache(cache, edge, offset);
}

/**
 * Applies a new reticulation edge to the cache in O(V^2).
 */
function applyCachedShortcut(cache, hapNet, from, to, weight) {
  const count = cache.vertexCount;
  const oldDistances = cache.distances;
  const nextDistances = [...oldDistances];

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      const current = oldDistances[row * count + col];
      const throughForward = (
        oldDistances[row * count + from] +
        weight +
        oldDistances[to * count + col]
      );
      const throughReverse = (
        oldDistances[row * count + to] +
        weight +
        oldDistances[from * count + col]
      );
      nextDistances[row * count + col] = Math.min(current, throughForward, throughReverse);
    }
  }

  cache.distances = nextDistances;
  refreshCachedTotalExcess(cache, hapNet);
}

/**
 * Builds the cache that would result from accepting one reticulation candidate.
 */
function cacheWithCandidate(cache, hapNet, candidate) {
  const nextCache = cloneReticulationCache(cache);
  const first = candidateEndpointIndex(nextCache, candidate.edges[0], candidate.offsets[0]);
  const second = candidateEndpointIndex(nextCache, candidate.edges[1], candidate.offsets[1]);

  applyCachedShortcut(nextCache, hapNet, first, second, candidate.length);
  return nextCache;
}

/**
 * Copies a prospective cache into the active cache after accepting an edit.
 */
function replaceReticulationCache(cache, nextCache) {
  cache.vertexCount = nextCache.vertexCount;
  cache.sampleCount = nextCache.sampleCount;
  cache.distances = nextCache.distances;
  cache.totalExcess = nextCache.totalExcess;
}

/**
 * Builds haplotype pairs sorted by descending current excess.
 */
function buildExcessPairs(cache, hapNet) {
  const pairs = [];

  for (let from = 0; from < hapNet.nseqs; from += 1) {
    for (let to = 0; to < from; to += 1) {
      const excess = cachedDistance(cache, from, to) - hapNet.distance(from, to);
      if (excess > 0) {
        pairs.push({ from, to, excess });
      }
    }
  }

  return pairs.sort((left, right) => (
    left.excess - right.excess ||
    left.from - right.from ||
    left.to - right.to
  ));
}

/**
 * Computes the shortest distance from a sampled leaf to a point on an edge.
 */
function distanceToEdgePoint(cache, graph, leaf, vertex, edge, offset) {
  const opposite = graph.opposite(vertex, edge);
  return Math.min(
    cachedDistance(cache, leaf.index, vertex.index) + offset,
    cachedDistance(cache, leaf.index, opposite.index) + edge.weight - offset,
  );
}

/**
 * Checks whether adding a new edge between two edge points would preserve N1.
 */
function isLegalReticulation(cache, graph, hapNet, firstVertex, firstEdge, firstOffset, secondVertex, secondEdge, secondOffset, length) {
  for (let from = 0; from < hapNet.nseqs; from += 1) {
    const fromVertex = graph.vertex(from);
    const fromFirst = distanceToEdgePoint(cache, graph, fromVertex, firstVertex, firstEdge, firstOffset);
    const fromSecond = distanceToEdgePoint(cache, graph, fromVertex, secondVertex, secondEdge, secondOffset);

    for (let to = 0; to < from; to += 1) {
      const toVertex = graph.vertex(to);
      const toFirst = distanceToEdgePoint(cache, graph, toVertex, firstVertex, firstEdge, firstOffset);
      const toSecond = distanceToEdgePoint(cache, graph, toVertex, secondVertex, secondEdge, secondOffset);

      if (fromFirst + length + toSecond < hapNet.distance(from, to)) {
        return false;
      }
      if (fromSecond + length + toFirst < hapNet.distance(from, to)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Reconstructs one shortest path from cached distances and adjacency.
 */
function cachedShortestPath(graph, cache, source, target) {
  const path = [source];
  let current = source;
  let guard = graph.vertexCount() + graph.edgeCount() + 1;

  while (current !== target) {
    const remaining = cachedDistance(cache, current.index, target.index);
    const edge = current.edges().find((candidate) => {
      const next = graph.opposite(current, candidate);
      return candidate.weight + cachedDistance(cache, next.index, target.index) === remaining;
    });

    if (!edge || guard <= 0) {
      throw algorithmError("Unable to reconstruct cached shortest path.");
    }

    current = graph.opposite(current, edge);
    path.push(current);
    guard -= 1;
  }

  return path;
}

/**
 * Finds the shortest legal reticulation path that removes one pair's excess.
 */
function findBestReticulation(graph, cache, hapNet, from, to) {
  const source = graph.vertex(from);
  const target = graph.vertex(to);
  const path = cachedShortestPath(graph, cache, source, target);
  let best = null;

  for (let leftIndex = 0; leftIndex < path.length - 2; leftIndex += 1) {
    const leftVertex = path[leftIndex];
    const leftEdge = leftVertex.sharedEdge(path[leftIndex + 1]);
    const sourceToLeft = cachedDistance(cache, source.index, leftVertex.index);

    for (let rightIndex = path.length - 1; rightIndex > leftIndex + 1; rightIndex -= 1) {
      const rightVertex = path[rightIndex];
      const rightEdge = rightVertex.sharedEdge(path[rightIndex - 1]);
      const targetToRight = cachedDistance(cache, target.index, rightVertex.index);

      for (let leftOffset = 0; leftOffset < leftEdge.weight; leftOffset += 1) {
        for (let rightOffset = 0; rightOffset < rightEdge.weight; rightOffset += 1) {
          const length = (
            hapNet.distance(from, to) -
            sourceToLeft -
            leftOffset -
            targetToRight -
            rightOffset
          );

          if (length < 1 || (best && length >= best.length)) {
            continue;
          }

          if (
            isLegalReticulation(
              cache,
              graph,
              hapNet,
              leftVertex,
              leftEdge,
              leftOffset,
              rightVertex,
              rightEdge,
              rightOffset,
              length,
            )
          ) {
            best = {
              length,
              edges: [leftEdge, rightEdge],
              offsets: [
                leftVertex === leftEdge.from ? leftOffset : leftEdge.weight - leftOffset,
                rightVertex === rightEdge.from ? rightOffset : rightEdge.weight - rightOffset,
              ],
            };
          }
        }
      }
    }
  }

  return best;
}

/**
 * Inserts, or reuses, a vertex at a particular offset along an edge.
 */
function splitEdgeAtOffset(graph, edge, offset, addedEdges, addedVertices, deletedEdges) {
  if (offset === 0) {
    return graph.vertex(edge.from.index);
  }
  if (offset === edge.weight) {
    return graph.vertex(edge.to.index);
  }

  const index = graph.vertexCount();
  const vertex = graph.addVertex(String(index), inferredVertexInfo(index));
  addedVertices.push(vertex);

  const from = graph.vertex(edge.from.index);
  const to = graph.vertex(edge.to.index);
  const right = graph.addEdge(vertex, to, edge.weight - offset, { weight: edge.weight - offset });
  const left = graph.addEdge(from, vertex, offset, { weight: offset });
  addedEdges.push(right, left);

  deletedEdges.push({
    from: edge.from.index,
    to: edge.to.index,
    weight: edge.weight,
    info: edge.info ? { ...edge.info } : null,
  });
  graph.removeEdge(edge.index);

  return vertex;
}

/**
 * Restores the graph after evaluating a rejected reticulation candidate.
 */
function rollbackReticulation(graph, addedEdges, addedVertices, deletedEdges) {
  for (let index = addedEdges.length; index > 0; index -= 1) {
    const edge = addedEdges[index - 1];
    if (graph.edges[edge.index] === edge) {
      graph.removeEdge(edge.index);
    }
  }

  for (let index = addedVertices.length; index > 0; index -= 1) {
    const vertex = addedVertices[index - 1];
    if (graph.vertices[vertex.index] === vertex) {
      graph.removeVertex(vertex.index);
    }
  }

  for (const edge of deletedEdges) {
    graph.addEdge(graph.vertex(edge.from), graph.vertex(edge.to), edge.weight, edge.info);
  }
}

/**
 * Adds one candidate reticulation and rolls it back unless alpha accepts it.
 */
function tryAddReticulation(graph, cache, hapNet, alpha, candidate) {
  const oldExcess = cache.totalExcess;
  const nextCache = cacheWithCandidate(cache, hapNet, candidate);
  const addedEdges = [];
  const addedVertices = [];
  const deletedEdges = [];

  const first = splitEdgeAtOffset(
    graph,
    candidate.edges[0],
    candidate.offsets[0],
    addedEdges,
    addedVertices,
    deletedEdges,
  );
  const second = splitEdgeAtOffset(
    graph,
    candidate.edges[1],
    candidate.offsets[1],
    addedEdges,
    addedVertices,
    deletedEdges,
  );

  const reticulation = graph.addEdge(first, second, candidate.length, { weight: candidate.length });
  addedEdges.push(reticulation);

  const newExcess = nextCache.totalExcess;
  const excessReduction = oldExcess - newExcess;
  const accepted = alpha * excessReduction >= (1 - alpha) * candidate.length;

  if (!accepted) {
    rollbackReticulation(graph, addedEdges, addedVertices, deletedEdges);
  } else {
    replaceReticulationCache(cache, nextCache);
  }

  return accepted;
}

/**
 * Iteratively adds reticulations that reduce the weighted IntNJ objective.
 */
function addReticulations(graph, hapNet, alpha) {
  if (alpha <= 0 || hapNet.nseqs <= 1) {
    return;
  }

  const cache = createReticulationCache(graph, hapNet);
  const pairs = buildExcessPairs(cache, hapNet);

  for (const pair of pairs) {
    const actualExcess = cachedDistance(cache, pair.from, pair.to) - hapNet.distance(pair.from, pair.to);

    if (actualExcess < 0) {
      throw algorithmError("Path length is shorter than allowed.");
    }
    if (actualExcess === 0) {
      continue;
    }

    const candidate = findBestReticulation(graph, cache, hapNet, pair.from, pair.to);
    if (candidate) {
      tryAddReticulation(graph, cache, hapNet, alpha, candidate);
    }
  }
}

/**
 * Computes an Integer Neighbour-Joining network as a fresh Graph.
 */
export async function computeIntNJ(hapNet, alpha = 0.5) {
  assertHapNetLike(hapNet);

  const normalizedAlpha = normalizeAlpha(alpha);
  const highs = await loadHighs();
  const graph = integerNJTree(hapNet);

  optimiseEdges(highs, graph, hapNet);
  collapseZeroInternalEdges(graph, hapNet.nseqs);
  addReticulations(graph, hapNet, normalizedAlpha);
  refreshInferredVertexLabels(graph, hapNet.nseqs);

  return graph;
}

export default computeIntNJ;
