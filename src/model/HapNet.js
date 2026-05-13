import Graph from "./Graph.js";

const DNA_AMBIGUOUS = new Set(["-", "?", "N", "Y", "R", "M", "S", "V", "W", "K", "D", "H", "B"]);
const BINARY_AMBIGUOUS = new Set(["-", "?"]);
const AA_AMBIGUOUS = new Set(["-", "X", "?"]);

function modelError(message) {
  return new Error(`HapNet model error: ${message}`);
}

function normalizeDatatype(datatype) {
  const value = String(datatype || "dna").toLowerCase();
  if (value === "standard" || value === "binary") {
    return "binary";
  }
  if (value === "protein" || value === "aa" || value === "aminoacid") {
    return "aa";
  }
  return "dna";
}

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

function isCompatibleDnaAmbiguity(left, right) {
  return (
    (left === "R" && (right === "A" || right === "G")) ||
    (right === "R" && (left === "A" || left === "G")) ||
    (left === "Y" && (right === "C" || right === "T" || right === "U")) ||
    (right === "Y" && (left === "C" || left === "T" || left === "U"))
  );
}

function sequencesFromParsed(parsed) {
  if (!parsed?.characters?.matrix) {
    throw modelError("Expected parsed Nexus data with a characters matrix.");
  }

  const matrix = parsed.characters.matrix;
  const names = parsed.taxa?.length ? parsed.taxa : Object.keys(matrix);

  return names.map((name) => {
    if (!Object.hasOwn(matrix, name)) {
      throw modelError(`Taxon "${name}" has no character sequence.`);
    }
    return {
      name,
      sequence: String(matrix[name]).toUpperCase(),
    };
  });
}

export class HapNet extends Graph {
  constructor(parsed, options = {}) {
    super();

    this.datatype = normalizeDatatype(parsed?.characters?.datatype);
    if (this.datatype === "aa") {
      throw modelError("Haplotype networks should not be inferred from protein data.");
    }

    this.originalSequences = sequencesFromParsed(parsed);
    this.originalSiteCount = this.originalSequences[0]?.sequence.length ?? 0;
    this.mask = options.mask ?? null;
    this.haplotypes = [];
    this.originalToCondensed = [];
    this.condensedToOriginal = [];
    this.frequencies = [];
    this.originalSiteToCondensedSite = [];
    this.siteWeights = [];
    this.distances = [];
    this.traitNames = parsed?.traits?.labels ? [...parsed.traits.labels] : [];
    this.traitsByHaplotype = [];

    this.validateSequences();
    this.applyMask();
    this.condenseSeqs();
    this.condenseSitePats();
    this.computeDistances();
    this.associateTraits(parsed?.traits ?? null);
  }

  static fromParsed(parsed, options = {}) {
    return new HapNet(parsed, options);
  }

  get nseqs() {
    return this.haplotypes.length;
  }

  get nsites() {
    return this.siteWeights.length;
  }

  seqName(index, original = false) {
    if (original) {
      return this.originalSequences[index]?.name ?? null;
    }
    return this.haplotypes[index]?.name ?? null;
  }

  seqSeq(index, original = false) {
    if (original) {
      return this.originalSequences[index]?.sequence ?? null;
    }
    return this.haplotypes[index]?.sequence ?? null;
  }

  freq(index) {
    return this.frequencies[index] ?? 0;
  }

  traits(index) {
    return this.traitsByHaplotype[index] ? [...this.traitsByHaplotype[index]] : [];
  }

  identicalTaxa(index) {
    return (this.condensedToOriginal[index] ?? []).map((originalIndex) => (
      this.originalSequences[originalIndex].name
    ));
  }

  weight(index) {
    if (index < 0 || index >= this.siteWeights.length) {
      throw modelError("Invalid site index given for weight.");
    }
    return this.siteWeights[index];
  }

  distance(from, to) {
    if (from < 0 || from >= this.nseqs || to < 0 || to >= this.nseqs) {
      throw modelError("Invalid haplotype index for distance.");
    }
    return this.distances[from * this.nseqs + to];
  }

  toJSON() {
    return {
      datatype: this.datatype,
      originalSequences: this.originalSequences.map((sequence) => ({ ...sequence })),
      haplotypes: this.haplotypes.map((haplotype) => ({
        ...haplotype,
        originalIndices: [...haplotype.originalIndices],
      })),
      originalToCondensed: [...this.originalToCondensed],
      condensedToOriginal: this.condensedToOriginal.map((indices) => [...indices]),
      frequencies: [...this.frequencies],
      originalSiteCount: this.originalSiteCount,
      condensedSiteCount: this.nsites,
      originalSiteToCondensedSite: [...this.originalSiteToCondensedSite],
      siteWeights: [...this.siteWeights],
      distances: [...this.distances],
      traitNames: [...this.traitNames],
      traitsByHaplotype: this.traitsByHaplotype.map((traits) => [...traits]),
      graph: super.toJSON(),
    };
  }

  validateSequences() {
    for (const { name, sequence } of this.originalSequences) {
      if (sequence.length !== this.originalSiteCount) {
        throw modelError(`Sequence "${name}" has length ${sequence.length}; expected ${this.originalSiteCount}.`);
      }
    }
  }

  applyMask() {
    if (!this.mask) {
      return;
    }

    if (this.mask.length !== this.originalSiteCount) {
      throw modelError("Mask length does not match sequence length.");
    }

    this.originalSequences = this.originalSequences.map(({ name, sequence }) => ({
      name,
      sequence: Array.from(sequence).filter((_, index) => this.mask[index]).join(""),
    }));
    this.originalSiteCount = this.originalSequences[0]?.sequence.length ?? 0;
  }

  condenseSeqs() {
    const sequenceToIndex = new Map();

    this.originalSequences.forEach((sequence, originalIndex) => {
      const existingIndex = sequenceToIndex.get(sequence.sequence);
      if (existingIndex === undefined) {
        const index = this.haplotypes.length;
        sequenceToIndex.set(sequence.sequence, index);
        this.originalToCondensed[originalIndex] = index;
        this.condensedToOriginal[index] = [originalIndex];
        this.haplotypes.push({
          index,
          name: sequence.name,
          sequence: sequence.sequence,
          originalSequence: sequence.sequence,
          originalIndices: this.condensedToOriginal[index],
          frequency: 1,
          traits: [],
        });
      } else {
        this.originalToCondensed[originalIndex] = existingIndex;
        this.condensedToOriginal[existingIndex].push(originalIndex);
        this.haplotypes[existingIndex].frequency += 1;
      }
    });

    this.frequencies = this.haplotypes.map((haplotype) => haplotype.frequency);
  }

  condenseSitePats() {
    const nsites = this.originalSiteCount;
    const samePosAs = Array.from({ length: nsites }, (_, index) => index);
    const uniqueSequences = this.haplotypes.map((haplotype) => haplotype.originalSequence);

    for (let i = 0; i < nsites; i += 1) {
      const allAmbiguous = uniqueSequences.every((sequence) => (
        isAmbiguousChar(sequence[i], this.datatype)
      ));

      if (allAmbiguous) {
        samePosAs[i] = nsites;
      }

      for (let j = i + 1; j < nsites; j += 1) {
        if (this.sameSitePattern(uniqueSequences, i, j)) {
          samePosAs[j] = samePosAs[i];
          break;
        }
      }
    }

    const buffers = Array.from({ length: this.nseqs }, () => []);
    this.originalSiteToCondensedSite = Array(nsites).fill(nsites);
    let nextSite = 0;

    for (let i = 0; i < nsites; i += 1) {
      if (samePosAs[i] === nsites) {
        this.originalSiteToCondensedSite[i] = nsites;
      } else if (samePosAs[i] < i) {
        this.originalSiteToCondensedSite[i] = this.originalSiteToCondensedSite[samePosAs[i]];
      } else {
        if (samePosAs[i] > i) {
          throw modelError("Serious error condensing site patterns.");
        }
        this.originalSiteToCondensedSite[i] = nextSite;
        for (let haplotypeIndex = 0; haplotypeIndex < this.nseqs; haplotypeIndex += 1) {
          buffers[haplotypeIndex].push(uniqueSequences[haplotypeIndex][i]);
        }
        nextSite += 1;
      }
    }

    this.siteWeights = Array(nextSite).fill(0);
    for (let i = 0; i < nsites; i += 1) {
      const condensedIndex = this.originalSiteToCondensedSite[i];
      if (condensedIndex < nsites) {
        this.siteWeights[condensedIndex] += 1;
      }
    }

    this.haplotypes.forEach((haplotype, index) => {
      haplotype.sequence = buffers[index].join("");
    });
  }

  sameSitePattern(sequences, leftIndex, rightIndex) {
    const leftToRight = new Map();
    const rightToLeft = new Map();

    for (const sequence of sequences) {
      const left = sequence[leftIndex];
      const right = sequence[rightIndex];

      if ((isAmbiguousChar(left, this.datatype) || isAmbiguousChar(right, this.datatype)) && left !== right) {
        return false;
      }

      if (!leftToRight.has(left)) {
        leftToRight.set(left, right);
        if (!rightToLeft.has(right)) {
          rightToLeft.set(right, left);
        } else if (rightToLeft.get(right) !== left) {
          return false;
        }
      } else if (leftToRight.get(left) !== right) {
        return false;
      }
    }

    return true;
  }

  computeDistances() {
    const count = this.nseqs;
    this.distances = Array(count * count).fill(0);

    for (let i = 0; i < count; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const distance = this.pairwiseDistance(this.haplotypes[i].sequence, this.haplotypes[j].sequence);
        this.distances[i * count + j] = distance;
        this.distances[j * count + i] = distance;
      }
    }
  }

  pairwiseDistance(leftSequence, rightSequence) {
    if (leftSequence.length !== rightSequence.length) {
      throw modelError("Sequences are not the same length.");
    }

    let distance = 0;
    for (let i = 0; i < leftSequence.length; i += 1) {
      const left = leftSequence[i];
      const right = rightSequence[i];

      if (left === right) {
        continue;
      }
      if (isAmbiguousChar(left, this.datatype) || isAmbiguousChar(right, this.datatype)) {
        if (this.datatype === "dna" && isCompatibleDnaAmbiguity(left, right)) {
          continue;
        }
        continue;
      }

      distance += this.weight(i);
    }

    return distance;
  }

  associateTraits(traits) {
    const traitMatrix = traits?.matrix;
    if (!traitMatrix) {
      this.traitsByHaplotype = this.haplotypes.map(() => []);
      return;
    }

    const traitCount = traits.labels?.length || traits.ntraits || 0;
    this.traitNames = traits.labels?.length
      ? [...traits.labels]
      : Array.from({ length: traitCount }, (_, index) => `Trait ${index + 1}`);

    this.traitsByHaplotype = Array.from(
      { length: this.nseqs },
      () => Array(this.traitNames.length).fill(0),
    );
    this.frequencies = Array(this.nseqs).fill(0);

    this.originalSequences.forEach(({ name }, originalIndex) => {
      const values = traitMatrix[name];
      if (!values) {
        return;
      }

      const haplotypeIndex = this.originalToCondensed[originalIndex];
      values.forEach((value, traitIndex) => {
        if (traitIndex < this.traitsByHaplotype[haplotypeIndex].length) {
          this.traitsByHaplotype[haplotypeIndex][traitIndex] += value;
          this.frequencies[haplotypeIndex] += value;
        }
      });
    });

    this.haplotypes.forEach((haplotype, index) => {
      haplotype.traits = [...this.traitsByHaplotype[index]];
      haplotype.frequency = this.frequencies[index];
    });
  }
}

export { isAmbiguousChar };
export default HapNet;
