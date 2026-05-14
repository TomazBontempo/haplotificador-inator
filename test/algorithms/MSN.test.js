import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import { computeMSN } from "../../src/algorithms/MSN.js";
import HapNet from "../../src/model/HapNet.js";
import { applyUndefinedSiteMask } from "../../src/model/SiteMask.js";
import { parseNexus } from "../../src/parser/NexusParser.js";

function edgeList(graph) {
  // Match PopART's exported MSN edge-list fixture format.
  return graph.edges.map((edge) => `${edge.from.label}\t${edge.weight}\t${edge.to.label}`);
}

describe("computeMSN", () => {
  test("returns an independent graph with haplotype metadata", () => {
    const hapNet = new HapNet({
      taxa: ["a", "b", "c"],
      characters: {
        datatype: "dna",
        matrix: {
          a: "AAAA",
          b: "AAAT",
          c: "AATT",
        },
      },
      traits: {
        ntraits: 2,
        labels: ["North", "South"],
        matrix: {
          a: [2, 0],
          b: [0, 3],
          c: [1, 1],
        },
      },
    });

    const before = hapNet.toJSON();
    const graph = computeMSN(hapNet);

    // The algorithm returns a new Graph and leaves HapNet untouched.
    expect(graph).not.toBe(hapNet);
    expect(hapNet.toJSON()).toEqual(before);

    // Each condensed haplotype is represented by one graph vertex.
    expect(graph.vertexCount()).toBe(hapNet.nseqs);
    expect(graph.vertex(0).info).toEqual({
      index: 0,
      name: "a",
      frequency: 2,
      traits: [2, 0],
    });
  });

  test("matches the PopART MSN edge list for the simple tapir fixture", () => {
    const fixturePath = join(process.cwd(), "test", "fixtures", "01_Simple_Tapir_Julia.nex");
    const expectedPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "expected",
      "01_Simple_Tapir_Julia_MSN.txt",
    );

    // Parse Nexus, condense haplotypes, and infer the MSN through the normal pipeline.
    const parsed = parseNexus(readFileSync(fixturePath, "utf8"));
    const hapNet = new HapNet(parsed);
    const graph = computeMSN(hapNet);

    // Compare exactly with PopART's tab-separated nodeA/weight/nodeB export.
    const expected = readFileSync(expectedPath, "utf8").trimEnd().split(/\r?\n/);
    expect(edgeList(graph)).toEqual(expected);
  });

  test("matches the PopART MSN edge list for the complex dolphins fixture", () => {
    const fixturePath = join(process.cwd(), "test", "fixtures", "02_Complex_Mariana.nex");
    const expectedPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "expected",
      "02_Complex_Mariana_MSN.txt",
    );

    // Parse Nexus, condense haplotypes, and infer the MSN through the normal pipeline.
    const parsed = parseNexus(readFileSync(fixturePath, "utf8"));
    const { mask, masked } = applyUndefinedSiteMask(parsed);
    const hapNet = new HapNet(parsed, masked > 0 ? { mask } : {});
    const graph = computeMSN(hapNet);

    // Compare exactly with PopART's tab-separated nodeA/weight/nodeB export.
    const expected = readFileSync(expectedPath, "utf8").trimEnd().split(/\r?\n/);
    expect(edgeList(graph)).toEqual(expected);
  });
});
