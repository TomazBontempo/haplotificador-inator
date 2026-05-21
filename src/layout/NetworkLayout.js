const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 1000;

const EDGELENGTH = 50;
const VERTRAD = 15;
const VERTWEIGHT = 1;
const MINVERTSIZE = 4.0 / 9.0;
const GOODENOUGH = 1e-4;
const SMALL = 1e-4;
const FAIRLYSMALL = 1e-6;
const VERYSMALL = 1e-8;
const MAXCOS = 0.5;
const CAP = Number.MAX_VALUE / 1000;
const RESTARTTHRESHOLD = 0.2;
const INITIAL_STEP_SIZE = 0.1;

function layoutError(message) {
  return new Error(`NetworkLayout error: ${message}`);
}

function assertGraphLike(graph) {
  if (!graph || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
    throw layoutError("Expected a Graph instance.");
  }
}

function normalizeOptions(graph, options) {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const iterations = options.iterations ?? (10 * graph.vertices.length);

  if (width <= 0 || height <= 0) {
    throw layoutError("Canvas width and height must be positive.");
  }
  if (iterations < 0) {
    throw layoutError("Iteration count cannot be negative.");
  }

  return { width, height, iterations };
}

function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vertexFrequency(vertex) {
  const rawFrequency = vertex.info?.frequency ?? vertex.info?.freq ?? vertex.frequency;
  const fallback = vertex.info?.inferred === true ? 0 : 1;
  const frequency = numericValue(rawFrequency, fallback);
  return frequency >= 0 ? frequency : fallback;
}

function vertexSize(vertex) {
  return Math.max(MINVERTSIZE, vertexFrequency(vertex) * VERTWEIGHT);
}

function vertexRadius(vertex) {
  return 0.5 * VERTRAD * Math.sqrt(vertexSize(vertex));
}

function edgeWeight(edge) {
  const weight = numericValue(edge.weight ?? edge.info?.weight, 1);
  return weight > 0 ? weight : 1;
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

function separateCoincidentPositions(positions) {
  const seen = new Map();
  const jitter = Math.sqrt(VERYSMALL);

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

function buildLayoutState(graph, options) {
  const vertices = graph.vertices;
  const positions = vertices.map(() => randomPosition(options));
  const sizes = vertices.map(vertexSize);
  const radii = vertices.map((vertex) => vertexRadius(vertex));
  const edges = graph.edges
    .filter((edge) => edge?.from && edge?.to && edge.from !== edge.to)
    .map((edge) => ({
      from: edge.from.index,
      to: edge.to.index,
      weight: edgeWeight(edge),
    }));

  separateCoincidentPositions(positions);

  return {
    graph,
    vertices,
    edges,
    sizes,
    radii,
    positions,
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

function radiusSum(state, left, right) {
  return 0.5 * VERTRAD * (
    Math.sqrt(state.sizes[left]) + Math.sqrt(state.sizes[right])
  );
}

function applySprings(state, positions, forces) {
  for (const edge of state.edges) {
    const from = positions[edge.from];
    const to = positions[edge.to];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < VERYSMALL) {
      continue;
    }

    const radsum = radiusSum(state, edge.from, edge.to);
    const prefLength = Math.max(EDGELENGTH * edge.weight, radsum);
    const attraction = Math.min((length - radsum) / prefLength, CAP / length);
    const forceX = (attraction * dx) / length;
    const forceY = (attraction * dy) / length;

    addForce(forces, edge.from, forceX, forceY);
    addForce(forces, edge.to, -forceX, -forceY);
  }
}

function nudgeCoincidentPair(positions, index) {
  const direction = randomUnitVector();
  const jitter = Math.sqrt(VERYSMALL);
  positions[index].x += direction.x * jitter;
  positions[index].y += direction.y * jitter;
}

function applyCharges(state, positions, forces) {
  for (let left = 0; left < positions.length; left += 1) {
    const from = positions[left];

    for (let right = left + 1; right < positions.length; right += 1) {
      const to = positions[right];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist2 = dx * dx + dy * dy;

      if (dist2 < VERYSMALL) {
        nudgeCoincidentPair(positions, right);
        continue;
      }

      const distance = Math.sqrt(dist2);
      const radsum = radiusSum(state, left, right);
      const preferredDistance = EDGELENGTH + radsum;
      const preferredDistance2 = preferredDistance * preferredDistance;
      const repulsion = Math.min(
        dist2 < preferredDistance2
          ? preferredDistance2 / dist2
          : (preferredDistance2 * preferredDistance) / (dist2 * distance),
        CAP,
      );
      const forceX = (repulsion * dx) / distance;
      const forceY = (repulsion * dy) / distance;

      addForce(forces, right, forceX, forceY);
      addForce(forces, left, -forceX, -forceY);
    }
  }
}

function computeNegativeGradient(state, inputPositions) {
  const positions = clonePositions(inputPositions);
  separateCoincidentPositions(positions);

  const gradient = zeroVector(positions.length);
  applySprings(state, positions, gradient);
  applyCharges(state, positions, gradient);

  return { positions, gradient };
}

function computeDirection(gradient, previousDirection, previousGradMag2) {
  const gradMag2 = dot(gradient, gradient);

  if (!previousDirection || previousGradMag2 <= 0) {
    return {
      direction: gradient.map((force) => ({ x: force.x, y: force.y })),
      gradMag2,
    };
  }

  if (gradMag2 < FAIRLYSMALL) {
    return {
      direction: zeroVector(gradient.length),
      gradMag2,
    };
  }

  const ratio = gradMag2 / previousGradMag2;
  const direction = gradient.map((force, index) => ({
    x: force.x + ratio * previousDirection[index].x,
    y: force.y + ratio * previousDirection[index].y,
  }));
  const directionMag2 = dot(direction, direction);
  const cosine = dot(direction, gradient) / Math.sqrt(Math.max(gradMag2 * directionMag2, VERYSMALL));

  if (cosine < RESTARTTHRESHOLD) {
    return {
      direction: gradient.map((force) => ({ x: force.x, y: force.y })),
      gradMag2,
    };
  }

  return { direction, gradMag2 };
}

function lineSearch(state, positions, direction, stepGuess) {
  const directionMagnitude = l2Norm(direction);
  let lo = 0;
  let hi = Number.POSITIVE_INFINITY;
  let stepSize = Math.max(stepGuess, VERYSMALL);
  let trial = computeNegativeGradient(state, addScaledPositions(positions, direction, stepSize));
  let trialGradientMagnitude = l2Norm(trial.gradient);
  let cosine = dot(trial.gradient, direction)
    / Math.max(directionMagnitude * trialGradientMagnitude, VERYSMALL);

  while (((cosine < 0) || (cosine > MAXCOS)) && ((hi - lo) > VERYSMALL)) {
    if (!Number.isFinite(cosine) || cosine < 0) {
      hi = stepSize;
      stepSize = (lo + hi) / 2;
    } else if (Number.isFinite(hi)) {
      lo = stepSize;
      stepSize = (lo + hi) / 2;
    } else {
      lo = stepSize;
      stepSize *= 2;
    }

    trial = computeNegativeGradient(state, addScaledPositions(positions, direction, stepSize));
    trialGradientMagnitude = l2Norm(trial.gradient);
    cosine = dot(trial.gradient, direction)
      / Math.max(directionMagnitude * trialGradientMagnitude, VERYSMALL);
  }

  return {
    positions: trial.positions,
    gradient: trial.gradient,
    stepSize,
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
 * Computes a PopART-compatible force-directed layout in place.
 */
export function computeLayout(graph, options = {}) {
  assertGraphLike(graph);

  const normalizedOptions = normalizeOptions(graph, options);
  const state = buildLayoutState(graph, normalizedOptions);

  if (state.vertices.length === 0) {
    return graph;
  }

  const initialPositions = clonePositions(state.positions);
  centerPositions(initialPositions, normalizedOptions);

  let { positions: currentPositions, gradient } = computeNegativeGradient(state, initialPositions);
  let previousDirection = null;
  let previousGradMag2 = 0;
  let stepSize = INITIAL_STEP_SIZE;

  for (let iteration = 0; iteration < normalizedOptions.iterations; iteration += 1) {
    const gradientMagnitude = l2Norm(gradient);
    if (gradientMagnitude <= GOODENOUGH) {
      break;
    }

    const directionResult = computeDirection(gradient, previousDirection, previousGradMag2);
    const direction = directionResult.direction;

    if (l2Norm(direction) < SMALL) {
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
