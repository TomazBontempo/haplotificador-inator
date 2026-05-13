import { describe, expect, test } from "@jest/globals";
import HapNet from "../../src/model/HapNet.js";

describe("HapNet", () => {
  test("condenses identical sequences and aggregates traits by haplotype", () => {
    const hapNet = new HapNet({
      taxa: ["a", "b", "c"],
      characters: {
        datatype: "dna",
        matrix: {
          a: "ACGT",
          b: "ACGT",
          c: "ATGT",
        },
      },
      traits: {
        ntraits: 2,
        labels: ["North", "South"],
        matrix: {
          a: [1, 0],
          b: [2, 1],
          c: [0, 4],
        },
      },
    });

    expect(hapNet.nseqs).toBe(2);
    expect(hapNet.identicalTaxa(0)).toEqual(["a", "b"]);
    expect(hapNet.originalToCondensed).toEqual([0, 0, 1]);
    expect(hapNet.traitNames).toEqual(["North", "South"]);
    expect(hapNet.traits(0)).toEqual([3, 1]);
    expect(hapNet.traits(1)).toEqual([0, 4]);
    expect(hapNet.freq(0)).toBe(4);
    expect(hapNet.freq(1)).toBe(4);
  });

  test("condenses redundant site patterns and uses site weights in distances", () => {
    const hapNet = new HapNet({
      taxa: ["a", "b"],
      characters: {
        datatype: "dna",
        matrix: {
          a: "AAAA",
          b: "CCCC",
        },
      },
    });

    expect(hapNet.nsites).toBe(1);
    expect(hapNet.siteWeights).toEqual([4]);
    expect(hapNet.seqSeq(0)).toBe("A");
    expect(hapNet.seqSeq(1)).toBe("C");
    expect(hapNet.distance(0, 1)).toBe(4);
  });

  test("ignores all-ambiguous columns when computing distances", () => {
    const hapNet = new HapNet({
      taxa: ["a", "b", "c"],
      characters: {
        datatype: "dna",
        matrix: {
          a: "A-R",
          b: "G-Y",
          c: "G-Y",
        },
      },
    });

    expect(hapNet.nseqs).toBe(2);
    expect(hapNet.nsites).toBe(1);
    expect(hapNet.siteWeights).toEqual([1]);
    expect(hapNet.distance(0, 1)).toBe(1);
  });

  test("produces a serializable model snapshot", () => {
    const hapNet = new HapNet({
      taxa: ["a"],
      characters: {
        datatype: "dna",
        matrix: { a: "ACGT" },
      },
    });

    const json = hapNet.toJSON();

    expect(json.haplotypes[0]).toMatchObject({
      index: 0,
      name: "a",
      originalSequence: "ACGT",
    });
    expect(json.graph).toEqual({ vertices: [], edges: [] });
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});
