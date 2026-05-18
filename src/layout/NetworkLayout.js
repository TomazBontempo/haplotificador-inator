const DEFAULT_OPTIONS = Object.freeze({
  width: 1000,
  height: 1000,
  iterations: 500,
  threshold: 0.01,
  theta: 0.5,
  baseRadius: 10,
});

const VERTEX_EDGE_REPULSION = 0.1;
const EPSILON = 1e-9;
const VERY_SMALL = 1e-8;
const RESTART_THRESHOLD = 0.2;
const MAX_COS = 0.5;
const MAX_LINE_SEARCH_STEPS = 30;
const MAX_QUADTREE_DEPTH = 32;

function layoutError(message) {
  return new Error(`NetworkLayout error: ${message}`);
}

function normalizeOptions(options) {
  const merged = { ...DEFAULT_OPTIONS, ...options };

  if (merged.width <= 0 || merged.height <= 0) {
    throw layoutError("Canvas width and height must be positive.");
  }
  if (merged.iterations < 0) {
    throw layoutError("Iteration count cannot be negative.");
  }
  if (merged.threshold < 0) {
    throw layoutError("Convergence threshold cannot be negative.");
  }
  if (merged.theta <= 0) {
    throw layoutError("Barnes-Hut theta must be positive.");
  }
  if (merged.baseRadius < 0) {
    throw layoutError("Base radius cannot be negative.");
  }

  return merged;
}

function assertGraphLike(graph) {
  if (!graph || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
    throw layoutError("Expected a Graph instance.");
  }
}

function vertexFrequency(vertex) {
  const rawFrequency = vertex.info?.frequency ?? vertex.info?.freq ?? vertex.frequency ?? 1;
  const frequency = Number(rawFrequency);
  return Number.isFinite(frequency) && frequency >= 0 ? frequency : 1;
}

function edgeWeight(edge) {
  const rawWeight = edge.weight ?? edge.info?.weight ?? 1;
  const weight = Number(rawWeight);
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function randomPosition(options) {
  return {
    x: Math.random() * options.width,
    y: Math.random() * options.height,
  };
}

function clonePositions(positions) {
  return positions.map((position) => ({ x: position.x, y: position.y }));
}

function addScaledPositions(positions, direction, stepSize) {
  return positions.map((position, index) => ({
    x: position.x + direction[index].x * stepSize,
    y: position.y + direction[index].y * stepSize,
  }));
}

function zeroVector(count) {
  return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
}

function dot(left, right) {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result += left[index].x * right[index].x + left[index].y * right[index].y;
  }
  return result;
}

function l2Norm(vector) {
  return Math.sqrt(dot(vector, vector));
}

function addForce(forces, index, x, y) {
  forces[index].x += x;
  forces[index].y += y;
}

function randomUnitVector() {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function separateCoincidentPositions(positions, k) {
  const seen = new Map();
  const jitter = Math.max(k * 1e-4, 1e-4);

  for (const position of positions) {
    const key = `${position.x.toFixed(9)},${position.y.toFixed(9)}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);

    if (count > 0) {
      const direction = randomUnitVector();
      position.x += direction.x * jitter * count;
      position.y += direction.y * jitter * count;
    }
  }
}

function unitDelta(from, to, k) {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < EPSILON) {
    const direction = randomUnitVector();
    dx = direction.x * Math.max(k * 1e-4, 1e-4);
    dy = direction.y * Math.max(k * 1e-4, 1e-4);
    distance = Math.sqrt(dx * dx + dy * dy);
  }

  return { dx, dy, distance };
}

function buildLayoutState(graph, options) {
  const vertices = graph.vertices;
  const count = vertices.length;
  const area = options.width * options.height;
  const k = count > 0 ? Math.sqrt(area / count) : 0;
  const positions = vertices.map(() => randomPosition(options));
  const radii = vertices.map((vertex) => options.baseRadius * Math.sqrt(vertexFrequency(vertex)));
  const edges = graph.edges
    .filter((edge) => edge?.from && edge?.to && edge.from !== edge.to)
    .map((edge) => ({
      from: edge.from.index,
      to: edge.to.index,
      weight: edgeWeight(edge),
    }));

  separateCoincidentPositions(positions, k);

  return {
    graph,
    vertices,
    edges,
    radii,
    positions,
    k,
    options,
  };
}

function centerPositions(positions, options) {
  if (positions.length === 0) {
    return;
  }

  let minX = positions[0].x;
  let maxX = positions[0].x;
  let minY = positions[0].y;
  let maxY = positions[0].y;

  for (const position of positions) {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  const dx = options.width / 2 - (minX + maxX) / 2;
  const dy = options.height / 2 - (minY + maxY) / 2;

  for (const position of positions) {
    position.x += dx;
    position.y += dy;
  }
}

function applySprings(state, positions, forces) {
  for (const edge of state.edges) {
    const from = positions[edge.from];
    const to = positions[edge.to];
    const { dx, dy, distance } = unitDelta(from, to, state.k);
    const radiusSum = state.radii[edge.from] + state.radii[edge.to];
    const boundaryRestLength = state.k * edge.weight;
    const centerRestLength = boundaryRestLength + radiusSum;
    const displacement = distance - radiusSum;
    const magnitude = (displacement * Math.abs(displacement)) / Math.max(centerRestLength, EPSILON);
    const fx = (magnitude * dx) / distance;
    const fy = (magnitude * dy) / distance;

    addForce(forces, edge.from, fx, fy);
    addForce(forces, edge.to, -fx, -fy);
  }
}

function repulsionMagnitude(distance, preferredDistance) {
  if (distance < preferredDistance) {
    return (preferredDistance * preferredDistance) / Math.max(distance, EPSILON);
  }
  return (preferredDistance * preferredDistance * preferredDistance)
    / Math.max(distance * distance, EPSILON);
}

class QuadTreeNode {
  constructor(minX, minY, maxX, maxY, depth = 0) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
    this.depth = depth;
    this.count = 0;
    this.centroidX = 0;
    this.centroidY = 0;
    this.meanRadius = 0;
    this.vertexIndex = -1;
    this.children = null;
  }

  get isLeaf() {
    return this.children === null;
  }

  get width() {
    return this.maxX - this.minX;
  }

  get height() {
    return this.maxY - this.minY;
  }

  insert(index, positions, radii) {
    const position = positions[index];
    this.centroidX = (this.centroidX * this.count + position.x) / (this.count + 1);
    this.centroidY = (this.centroidY * this.count + position.y) / (this.count + 1);
    this.meanRadius = (this.meanRadius * this.count + radii[index]) / (this.count + 1);
    this.count += 1;

    if (this.isLeaf && this.vertexIndex === -1) {
      this.vertexIndex = index;
      return;
    }

    if (this.isLeaf) {
      if (this.depth >= MAX_QUADTREE_DEPTH) {
        return;
      }

      const existingIndex = this.vertexIndex;
      this.vertexIndex = -1;
      this.split();
      this.childFor(positions[existingIndex]).insert(existingIndex, positions, radii);
    }

    this.childFor(position).insert(index, positions, radii);
  }

  split() {
    const midX = (this.minX + this.maxX) / 2;
    const midY = (this.minY + this.maxY) / 2;
    this.children = [
      new QuadTreeNode(this.minX, this.minY, midX, midY, this.depth + 1),
      new QuadTreeNode(midX, this.minY, this.maxX, midY, this.depth + 1),
      new QuadTreeNode(this.minX, midY, midX, this.maxY, this.depth + 1),
      new QuadTreeNode(midX, midY, this.maxX, this.maxY, this.depth + 1),
    ];
  }

  childFor(position) {
    const midX = (this.minX + this.maxX) / 2;
    const midY = (this.minY + this.maxY) / 2;
    const east = position.x >= midX ? 1 : 0;
    const south = position.y >= midY ? 2 : 0;
    return this.children[east + south];
  }
}

function buildQuadTree(positions, radii, k) {
  let minX = positions[0].x;
  let maxX = positions[0].x;
  let minY = positions[0].y;
  let maxY = positions[0].y;

  for (const position of positions) {
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  const padding = Math.max(maxX - minX, maxY - minY, k, 1) * 0.01;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;

  const side = Math.max(maxX - minX, maxY - minY, 1);
  const root = new QuadTreeNode(minX, minY, minX + side, minY + side);

  for (let index = 0; index < positions.length; index += 1) {
    root.insert(index, positions, radii);
  }

  return root;
}

function nodeContainsPosition(node, position) {
  return position.x >= node.minX
    && position.x <= node.maxX
    && position.y >= node.minY
    && position.y <= node.maxY;
}

function applyRepulsionFromNode(state, positions, forces, vertexIndex, node) {
  if (node.count === 0) {
    return;
  }

  if (node.isLeaf && node.vertexIndex === vertexIndex) {
    return;
  }

  const position = positions[vertexIndex];
  let dx = position.x - node.centroidX;
  let dy = position.y - node.centroidY;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < EPSILON) {
    const direction = randomUnitVector();
    dx = direction.x * Math.max(state.k * 1e-4, 1e-4);
    dy = direction.y * Math.max(state.k * 1e-4, 1e-4);
    distance = Math.sqrt(dx * dx + dy * dy);
  }

  const cellSize = Math.max(node.width, node.height);
  const containsVertex = nodeContainsPosition(node, position);
  const wellSeparated = node.isLeaf || (!containsVertex && cellSize / distance < state.options.theta);

  if (!wellSeparated) {
    for (const child of node.children) {
      applyRepulsionFromNode(state, positions, forces, vertexIndex, child);
    }
    return;
  }

  const preferredDistance = state.k + state.radii[vertexIndex] + node.meanRadius;
  const magnitude = repulsionMagnitude(distance, preferredDistance) * node.count;
  addForce(
    forces,
    vertexIndex,
    (magnitude * dx) / distance,
    (magnitude * dy) / distance,
  );
}

function applyVertexRepulsion(state, positions, forces) {
  if (positions.length < 2) {
    return;
  }

  const tree = buildQuadTree(positions, state.radii, state.k);
  for (let index = 0; index < positions.length; index += 1) {
    applyRepulsionFromNode(state, positions, forces, index, tree);
  }
}

function applyVertexEdgePair(state, positions, forces, vertexIndex, edge) {
  if (vertexIndex === edge.from || vertexIndex === edge.to) {
    return;
  }

  const vertex = positions[vertexIndex];
  const from = positions[edge.from];
  const to = positions[edge.to];
  const edgeDx = to.x - from.x;
  const edgeDy = to.y - from.y;
  const edgeLength2 = edgeDx * edgeDx + edgeDy * edgeDy;

  if (edgeLength2 < EPSILON) {
    return;
  }

  let alpha = ((vertex.x - from.x) * edgeDx + (vertex.y - from.y) * edgeDy) / edgeLength2;
  alpha = Math.max(0, Math.min(1, alpha));

  const endpointIndex = alpha === 0 ? edge.from : alpha === 1 ? edge.to : -1;
  const closest = endpointIndex >= 0
    ? positions[endpointIndex]
    : { x: from.x + alpha * edgeDx, y: from.y + alpha * edgeDy };

  let dx = vertex.x - closest.x;
  let dy = vertex.y - closest.y;
  let distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < EPSILON) {
    const direction = randomUnitVector();
    dx = direction.x * Math.max(state.k * 1e-4, 1e-4);
    dy = direction.y * Math.max(state.k * 1e-4, 1e-4);
    distance = Math.sqrt(dx * dx + dy * dy);
  }

  const preferredDistance = endpointIndex >= 0
    ? state.k + state.radii[vertexIndex] + state.radii[endpointIndex]
    : state.k + state.radii[vertexIndex];

  if (distance >= preferredDistance) {
    return;
  }

  const magnitude = VERTEX_EDGE_REPULSION
    * (((preferredDistance * preferredDistance) / distance) - preferredDistance);
  const fx = (magnitude * dx) / distance;
  const fy = (magnitude * dy) / distance;

  addForce(forces, vertexIndex, fx, fy);

  if (endpointIndex >= 0) {
    addForce(forces, endpointIndex, -fx, -fy);
    return;
  }

  addForce(forces, edge.from, -(1 - alpha) * fx, -(1 - alpha) * fy);
  addForce(forces, edge.to, -alpha * fx, -alpha * fy);
}

function applyVertexEdgeRepulsion(state, positions, forces) {
  for (const edge of state.edges) {
    for (let vertexIndex = 0; vertexIndex < positions.length; vertexIndex += 1) {
      applyVertexEdgePair(state, positions, forces, vertexIndex, edge);
    }
  }
}

function computeNegativeGradient(state, inputPositions) {
  const positions = clonePositions(inputPositions);
  separateCoincidentPositions(positions, state.k);

  const forces = zeroVector(positions.length);
  applySprings(state, positions, forces);
  applyVertexRepulsion(state, positions, forces);
  applyVertexEdgeRepulsion(state, positions, forces);

  return { positions, gradient: forces };
}

function springEnergy(state, positions) {
  let energy = 0;

  for (const edge of state.edges) {
    const from = positions[edge.from];
    const to = positions[edge.to];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), EPSILON);
    const radiusSum = state.radii[edge.from] + state.radii[edge.to];
    const boundaryRestLength = state.k * edge.weight;
    const centerRestLength = boundaryRestLength + radiusSum;
    const displacement = distance - radiusSum;

    energy += Math.abs(displacement * displacement * displacement)
      / (3 * Math.max(centerRestLength, EPSILON));
  }

  return energy;
}

function pairRepulsionEnergy(distance, preferredDistance) {
  const safeDistance = Math.max(distance, EPSILON);

  if (safeDistance < preferredDistance) {
    return -(preferredDistance * preferredDistance) * Math.log(safeDistance);
  }

  return (preferredDistance * preferredDistance * preferredDistance) / safeDistance;
}

function vertexRepulsionEnergy(state, positions) {
  let energy = 0;

  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const dx = positions[left].x - positions[right].x;
      const dy = positions[left].y - positions[right].y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const preferredDistance = state.k + state.radii[left] + state.radii[right];
      energy += pairRepulsionEnergy(distance, preferredDistance);
    }
  }

  return energy;
}

function vertexEdgeEnergy(state, positions) {
  let energy = 0;

  for (const edge of state.edges) {
    for (let vertexIndex = 0; vertexIndex < positions.length; vertexIndex += 1) {
      if (vertexIndex === edge.from || vertexIndex === edge.to) {
        continue;
      }

      const vertex = positions[vertexIndex];
      const from = positions[edge.from];
      const to = positions[edge.to];
      const edgeDx = to.x - from.x;
      const edgeDy = to.y - from.y;
      const edgeLength2 = edgeDx * edgeDx + edgeDy * edgeDy;

      if (edgeLength2 < EPSILON) {
        continue;
      }

      let alpha = ((vertex.x - from.x) * edgeDx + (vertex.y - from.y) * edgeDy) / edgeLength2;
      alpha = Math.max(0, Math.min(1, alpha));

      const endpointIndex = alpha === 0 ? edge.from : alpha === 1 ? edge.to : -1;
      const closest = endpointIndex >= 0
        ? positions[endpointIndex]
        : { x: from.x + alpha * edgeDx, y: from.y + alpha * edgeDy };
      const dx = vertex.x - closest.x;
      const dy = vertex.y - closest.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), EPSILON);
      const preferredDistance = endpointIndex >= 0
        ? state.k + state.radii[vertexIndex] + state.radii[endpointIndex]
        : state.k + state.radii[vertexIndex];

      if (distance < preferredDistance) {
        energy += VERTEX_EDGE_REPULSION
          * (-(preferredDistance * preferredDistance) * Math.log(distance)
            + preferredDistance * distance);
      }
    }
  }

  return energy;
}

function totalEnergy(state, positions) {
  return springEnergy(state, positions)
    + vertexRepulsionEnergy(state, positions)
    + vertexEdgeEnergy(state, positions);
}

function computeDirection(gradient, previousDirection, previousGradMag2, iteration) {
  const gradMag2 = dot(gradient, gradient);

  if (!previousDirection || previousGradMag2 <= 0 || iteration % (2 * gradient.length) === 0) {
    return {
      direction: gradient.map((force) => ({ x: force.x, y: force.y })),
      gradMag2,
    };
  }

  const beta = gradMag2 / previousGradMag2;
  const direction = gradient.map((force, index) => ({
    x: force.x + beta * previousDirection[index].x,
    y: force.y + beta * previousDirection[index].y,
  }));
  const directionMag2 = dot(direction, direction);
  const cosine = dot(direction, gradient) / Math.sqrt(Math.max(gradMag2 * directionMag2, EPSILON));

  if (cosine < RESTART_THRESHOLD) {
    return {
      direction: gradient.map((force) => ({ x: force.x, y: force.y })),
      gradMag2,
    };
  }

  return { direction, gradMag2 };
}

function lineSearch(state, positions, direction, stepGuess) {
  const directionMagnitude = l2Norm(direction);
  const currentEnergy = totalEnergy(state, positions);
  let lo = 0;
  let hi = Number.POSITIVE_INFINITY;
  let stepSize = Math.max(stepGuess, VERY_SMALL);
  let best = null;

  for (let attempt = 0; attempt < MAX_LINE_SEARCH_STEPS; attempt += 1) {
    const trialPositions = addScaledPositions(positions, direction, stepSize);
    const trial = computeNegativeGradient(state, trialPositions);
    const trialGradientMagnitude = l2Norm(trial.gradient);
    const trialEnergy = totalEnergy(state, trial.positions);
    const cosine = dot(trial.gradient, direction)
      / Math.max(directionMagnitude * trialGradientMagnitude, EPSILON);

    if (Number.isFinite(trialEnergy) && trialEnergy < currentEnergy) {
      if (!best || trialEnergy < best.energy) {
        best = {
          positions: trial.positions,
          gradient: trial.gradient,
          stepSize,
          energy: trialEnergy,
        };
      }
    }

    if (trialEnergy < currentEnergy && cosine >= 0 && cosine <= MAX_COS) {
      return {
        positions: trial.positions,
        gradient: trial.gradient,
        stepSize,
      };
    }

    if (trialEnergy >= currentEnergy || cosine < 0 || !Number.isFinite(trialEnergy)) {
      hi = stepSize;
      stepSize = (lo + hi) / 2;
    } else if (Number.isFinite(hi)) {
      lo = stepSize;
      stepSize = (lo + hi) / 2;
    } else {
      lo = stepSize;
      stepSize *= 2;
    }

    if (stepSize <= VERY_SMALL || (Number.isFinite(hi) && hi - lo <= VERY_SMALL)) {
      break;
    }
  }

  if (best) {
    return best;
  }

  const fallbackStep = Math.max(stepGuess * 0.1, VERY_SMALL);
  const fallbackPositions = addScaledPositions(positions, direction, fallbackStep);
  const fallback = computeNegativeGradient(state, fallbackPositions);
  return {
    positions: fallback.positions,
    gradient: fallback.gradient,
    stepSize: fallbackStep,
  };
}

function writePositionsToGraph(state, positions) {
  for (let index = 0; index < state.vertices.length; index += 1) {
    state.vertices[index].x = positions[index].x;
    state.vertices[index].y = positions[index].y;
    state.vertices[index].radius = state.radii[index];
  }
}

/**
 * Computes a Tunkelang-style force-directed layout in place.
 */
export function computeLayout(graph, options = {}) {
  assertGraphLike(graph);

  const normalizedOptions = normalizeOptions(options);
  const state = buildLayoutState(graph, normalizedOptions);

  if (state.vertices.length === 0) {
    return graph;
  }

  const positions = clonePositions(state.positions);
  separateCoincidentPositions(positions, state.k);
  centerPositions(positions, normalizedOptions);

  let { positions: currentPositions, gradient } = computeNegativeGradient(state, positions);
  let previousDirection = null;
  let previousGradMag2 = 0;
  let stepSize = 0.1;

  for (let iteration = 0; iteration < normalizedOptions.iterations; iteration += 1) {
    const gradientMagnitude = l2Norm(gradient);
    if (gradientMagnitude < normalizedOptions.threshold) {
      break;
    }

    const directionResult = computeDirection(
      gradient,
      previousDirection,
      previousGradMag2,
      iteration,
    );
    const direction = directionResult.direction;

    if (l2Norm(direction) < VERY_SMALL) {
      break;
    }

    const search = lineSearch(state, currentPositions, direction, stepSize);
    currentPositions = search.positions;
    gradient = search.gradient;
    stepSize = search.stepSize;
    previousDirection = direction;
    previousGradMag2 = directionResult.gradMag2;
  }

  centerPositions(currentPositions, normalizedOptions);
  writePositionsToGraph(state, currentPositions);
  return graph;
}

export default computeLayout;
