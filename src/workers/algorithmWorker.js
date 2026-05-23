/**
 * @fileoverview
 * Runs network algorithms inside a Web Worker.
 * Receives serialized HapNet JSON and posts back a serialized Graph.
 */

const DNA_AMBIGUOUS = new Set(["-", "?", "N", "Y", "R", "M", "S", "V", "W", "K", "D", "H", "B"]);
const BINARY_AMBIGUOUS = new Set(["-", "?"]);
const AA_AMBIGUOUS = new Set(["-", "X", "?"]);

/**
 * Mirrors HapNet ambiguity handling for worker-side distance checks.
 */
function isAmbiguousChar(char, datatype) {
  const value = String(char).toUpperCase();
  if (datatype === "binary") {
    return BINARY_AMBIGUOUS.has(value);
  }
  if (datatype === "aa") {
    return AA_AMBIGUOUS.has(value);
  }
  return DNA_AMBIGUOUS.has(value);
}

/**
 * Preserves HapNet's special-case DNA ambiguity compatibility.
 */
function isCompatibleDnaAmbiguity(left, right) {
  return (
    (left === "R" && (right === "A" || right === "G")) ||
    (right === "R" && (left === "A" || left === "G")) ||
    (left === "Y" && (right === "C" || right === "T" || right === "U")) ||
    (right === "Y" && (left === "C" || left === "T" || left === "U"))
  );
}

/**
 * Rebuilds the minimal HapNet API required by algorithms.
 */
function reconstructHapNet(hapNetJSON) {
  if (!hapNetJSON || !Array.isArray(hapNetJSON.haplotypes)) {
    throw new Error("Expected serialized HapNet data.");
  }

  const datatype = hapNetJSON.datatype ?? "dna";
  const haplotypes = hapNetJSON.haplotypes;
  const frequencies = hapNetJSON.frequencies ?? haplotypes.map((haplotype) => haplotype.frequency ?? 0);
  const traitsByHaplotype = hapNetJSON.traitsByHaplotype ?? haplotypes.map((haplotype) => haplotype.traits ?? []);
  const distances = hapNetJSON.distances ?? [];
  const siteWeights = hapNetJSON.siteWeights ?? [];

  // HapNet cannot cross the worker boundary as a live instance; structured
  // clone keeps only data, so algorithms receive this compatible read-only API.
  return {
    datatype,
    haplotypes,
    frequencies,
    traitsByHaplotype,
    distances,
    siteWeights,
    nseqs: haplotypes.length,
    seqName(index) {
      return haplotypes[index]?.name ?? null;
    },
    seqSeq(index) {
      return haplotypes[index]?.sequence ?? null;
    },
    freq(index) {
      return frequencies[index] ?? 0;
    },
    traits(index) {
      return traitsByHaplotype[index] ? [...traitsByHaplotype[index]] : [];
    },
    weight(index) {
      if (index < 0 || index >= siteWeights.length) {
        throw new Error("Invalid site index given for weight.");
      }
      return siteWeights[index];
    },
    distance(from, to) {
      if (from < 0 || from >= haplotypes.length || to < 0 || to >= haplotypes.length) {
        throw new Error("Invalid haplotype index for distance.");
      }
      return distances[from * haplotypes.length + to] ?? 0;
    },
    pairwiseDistance(leftSequence, rightSequence) {
      if (leftSequence.length !== rightSequence.length) {
        throw new Error("Sequences are not the same length.");
      }

      let distance = 0;
      for (let index = 0; index < leftSequence.length; index += 1) {
        const left = leftSequence[index];
        const right = rightSequence[index];

        if (left === right) {
          continue;
        }

        // Ambiguous sites are skipped to match HapNet distance semantics
        // after the automatic masking step.
        if (isAmbiguousChar(left, datatype) || isAmbiguousChar(right, datatype)) {
          if (datatype === "dna" && isCompatibleDnaAmbiguity(left, right)) {
            continue;
          }
          continue;
        }

        distance += siteWeights[index] ?? 1;
      }

      return distance;
    },
  };
}

/**
 * Converts the algorithm Graph into plain data for postMessage.
 */
function serializeGraph(graph) {
  return {
    vertices: graph.vertices.map((vertex) => ({
      index: vertex.index,
      label: vertex.label,
      info: vertex.info,
      colour: vertex.colour,
      marked: vertex.marked,
      x: vertex.x,
      y: vertex.y,
      radius: vertex.radius,
      // Edge identity is serialized by index so the UI can restore references
      // without sharing object instances across threads.
      incidentEdges: vertex.incidentEdges.map((edge) => edge.index),
    })),
    edges: graph.edges.map((edge) => ({
      index: edge.index,
      from: edge.from.index,
      to: edge.to.index,
      weight: edge.weight,
      info: edge.info,
      colour: edge.colour,
      marked: edge.marked,
    })),
  };
}

/**
 * Loads only the selected algorithm module for this worker request.
 */
async function loadAlgorithm(algorithm) {
  if (algorithm === "MSN") {
    const { computeMSN } = await import("../algorithms/MSN.js");
    return (hapNet, params) => computeMSN(hapNet, params?.epsilon ?? 0);
  }
  if (algorithm === "MJN") {
    const { computeMJN } = await import("../algorithms/MJN.js");
    return (hapNet, params) => computeMJN(hapNet, params?.epsilon ?? 0);
  }
  if (algorithm === "TCS") {
    const { computeTCS } = await import("../algorithms/TCS.js");
    return (hapNet) => computeTCS(hapNet);
  }
  if (algorithm === "IntNJ") {
    const { computeIntNJ } = await import("../algorithms/IntNJ.js");
    // IntNJ is async because its HiGHS WebAssembly solver initializes
    // asynchronously inside the algorithm module.
    return (hapNet, params) => computeIntNJ(hapNet, params?.alpha ?? 0.5);
  }
  throw new Error(`Unknown algorithm "${algorithm}".`);
}

/**
 * Handles one algorithm request and reports either a serialized graph or error.
 */
self.onmessage = async (event) => {
  const { algorithm, hapNetJSON, params } = event.data;
  try {
    const compute = await loadAlgorithm(algorithm);
    // Keep algorithm execution off the UI thread while preserving the
    // read-only HapNet input contract used by the algorithm layer.
    const hapNet = reconstructHapNet(hapNetJSON);
    const graph = await compute(hapNet, params ?? {});
    self.postMessage({ graph: serializeGraph(graph) });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
