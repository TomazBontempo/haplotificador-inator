/**
 * @fileoverview
 * Computes PopART-style force-directed coordinates and radii for a Graph.
 * Reference: Tunkelang (1999); preserves PopART's active useBH=false path.
 */

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 1000;

const EDGELENGTH = 50; // preferred edge rest length (PopART NetworkItem::EDGELENGTH)
const VERTRAD = 15; // base vertex radius scale (PopART NetworkItem::VERTRAD)
const VERTWEIGHT = 1;
const MINVERTSIZE = 4.0 / 9.0; // minimum physical vertex size from PopART
const GOODENOUGH = 1e-4; // convergence threshold for gradient norm
const SMALL = 1e-4; // minimum useful descent-direction norm
const FAIRLYSMALL = 1e-6; // near-zero gradient cutoff for conjugate gradient
const VERYSMALL = 1e-8; // singularity guard for coincident vertices
const MAXCOS = 0.5; // line-search angle bound from Tunkelang Section 7.5
const CAP = Number.MAX_VALUE / 1000; // PopART overflow guard for force terms
const RESTARTTHRESHOLD = 0.2; // PopART conjugate-gradient restart cutoff
const INITIAL_STEP_SIZE = 0.1; // first adaptive line-search guess from PopART

/**
 * Wraps layout failures with a consistent module-specific prefix.
 */
function layoutError(message) {
  return new Error(`NetworkLayout error: ${message}`);
}

/**
 * Validates the minimal Graph shape required by layout.
 */
function assertGraphLike(graph) {
  if (!graph || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
    throw layoutError("Expected a Graph instance.");
  }
}

/**
 * Normalizes layout bounds and the PopART-like default iteration count.
 */
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

/**
 * Converts loose graph metadata to a finite numeric value.
 */
function numericValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Reads the frequency used to scale a vertex's physical size.
 */
function vertexFrequency(vertex) {
  const rawFrequency = vertex.info?.frequency ?? vertex.info?.freq ?? vertex.frequency;
  const fallback = vertex.info?.inferred === true ? 0 : 1;
  const frequency = numericValue(rawFrequency, fallback);
  return frequency >= 0 ? frequency : fallback;
}

/**
 * Computes PopART's physical vertex size with a minimum for inferred nodes.
 */
function vertexSize(vertex) {
  return Math.max(MINVERTSIZE, vertexFrequency(vertex) * VERTWEIGHT);
}

/**
 * Converts PopART vertex size to the radius stored for rendering.
 */
function vertexRadius(vertex) {
  return 0.5 * VERTRAD * Math.sqrt(vertexSize(vertex));
}

/**
 * Reads the edge distance multiplier used by the spring law.
 */
function edgeWeight(edge) {
  const weight = numericValue(edge.weight ?? edge.info?.weight, 1);
  return weight > 0 ? weight : 1;
}

/**
 * Creates the randomized starting coordinates used by PopART shuffleVertices().
 */
function randomPosition(options) {
  return {
    x: Math.random() * options.width,
    y: Math.random() * options.height,
  };
}

/**
 * Copies positions so line-search trials cannot mutate accepted coordinates.
 */
function clonePositions(positions) {
  return positions.map((position) => ({ x: position.x, y: position.y }));
}

/**
 * Advances positions along a candidate search direction.
 */
function addScaledPositions(positions, direction, stepSize) {
  return positions.map((position, index) => ({
    x: position.x + direction[index].x * stepSize,
    y: position.y + direction[index].y * stepSize,
  }));
}

/**
 * Allocates a zeroed vector for gradients or stopped directions.
 */
function zeroVector(count) {
  return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
}

/**
 * Computes the vector dot product used by conjugate-gradient math.
 */
function dot(left, right) {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result += left[index].x * right[index].x + left[index].y * right[index].y;
  }
  return result;
}

/**
 * Computes Euclidean norm for gradient and direction vectors.
 */
function l2Norm(vector) {
  return Math.sqrt(dot(vector, vector));
}

/**
 * Accumulates one force contribution into the negative gradient vector.
 */
function addForce(forces, index, x, y) {
  forces[index].x += x;
  forces[index].y += y;
}

/**
 * Chooses a random direction for separating coincident vertices.
 */
function randomUnitVector() {
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * Breaks exact coordinate ties that would make repulsion singular.
 * Tunkelang Section 5.2.2 / 8.1.1.
 */
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

/**
 * Builds the layout work state from the graph without changing topology.
 * Mirrors PopART mapEdges() and shuffleVertices().
 */
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

/**
 * Recenters the drawing after random initialization and after optimization.
 * Mirrors PopART centreVertices().
 */
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

/**
 * Computes the center-to-center rest offset contributed by endpoint radii.
 * Tunkelang Section 9.2.
 */
function radiusSum(state, left, right) {
  return 0.5 * VERTRAD * (
    Math.sqrt(state.sizes[left]) + Math.sqrt(state.sizes[right])
  );
}

/**
 * Adds edge-spring forces to the negative gradient.
 * Tunkelang Section 5.2.1 with Section 9.2 radius-aware rest lengths.
 */
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
    // Tunkelang Section 9.2: spring rest length is the vertex boundary gap,
    // so overlapping endpoints repel and separated endpoints attract.
    const attraction = Math.min((length - radsum) / prefLength, CAP / length);
    const forceX = (attraction * dx) / length;
    const forceY = (attraction * dy) / length;

    addForce(forces, edge.from, forceX, forceY);
    addForce(forces, edge.to, -forceX, -forceY);
  }
}

/**
 * Perturbs one vertex in a coincident pair before evaluating repulsion.
 * Tunkelang Section 5.2.2.
 */
function nudgeCoincidentPair(positions, index) {
  const direction = randomUnitVector();
  const jitter = Math.sqrt(VERYSMALL);
  positions[index].x += direction.x * jitter;
  positions[index].y += direction.y * jitter;
}

/**
 * Adds exact pairwise vertex repulsion to the negative gradient.
 * Tunkelang Section 5.2.2; O(n^2) matches PopART's active useBH=false path.
 */
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
      // Tunkelang Section 5.2.2: split repulsion; inverse for short range,
      // inverse-square for long range.
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

/**
 * Evaluates the current negative gradient from spring and charge forces.
 * Tunkelang Section 5.2.
 */
function computeNegativeGradient(state, inputPositions) {
  const positions = clonePositions(inputPositions);
  separateCoincidentPositions(positions);

  const gradient = zeroVector(positions.length);
  applySprings(state, positions, gradient);
  applyCharges(state, positions, gradient);

  return { positions, gradient };
}

/**
 * Computes the next conjugate-gradient search direction.
 * Tunkelang Sections 7.3 and 7.4.
 */
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

  // Tunkelang Section 7.4: restart when conjugacy no longer gives a useful
  // descent direction.
  if (cosine < RESTARTTHRESHOLD) {
    return {
      direction: gradient.map((force) => ({ x: force.x, y: force.y })),
      gradMag2,
    };
  }

  return { direction, gradMag2 };
}

/**
 * Finds an admissible step size along the current search direction.
 * Tunkelang Section 7.5.
 */
function lineSearch(state, positions, direction, stepGuess) {
  const directionMagnitude = l2Norm(direction);
  let lo = 0;
  let hi = Number.POSITIVE_INFINITY;
  let stepSize = Math.max(stepGuess, VERYSMALL);
  let trial = computeNegativeGradient(state, addScaledPositions(positions, direction, stepSize));
  let trialGradientMagnitude = l2Norm(trial.gradient);
  let cosine = dot(trial.gradient, direction)
    / Math.max(directionMagnitude * trialGradientMagnitude, VERYSMALL);

  // Tunkelang Section 7.5: negative cosine means the step passed the line
  // minimum; a cosine above MAXCOS means the step is too small.
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

/**
 * Writes optimized coordinates and display radii back to the graph model.
 */
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
    // PopART stops once the force system is close enough to a local minimum.
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
