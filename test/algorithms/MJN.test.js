import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import { computeMJN } from "../../src/algorithms/MJN.js";
import HapNet from "../../src/model/HapNet.js";
import { applyUndefinedSiteMask } from "../../src/model/SiteMask.js";
import { parseNexus } from "../../src/parser/NexusParser.js";

function edgeList(graph) {
  // Match PopART's exported MJN edge-list fixture format.
  return graph.edges.map((edge) => `${edge.from.label}\t${edge.weight}\t${edge.to.label}`);
}

describe("computeMJN", () => {
  test("returns an independent graph with inferred median metadata", () => {
    const hapNet = new HapNet({
      taxa: ["a", "b", "c"],
      characters: {
        datatype: "dna",
        matrix: {
          a: "AACC",
          b: "ACAC",
          c: "ACCA",
        },
      },
    });

    const before = hapNet.toJSON();
    const graph = computeMJN(hapNet, 0);

    // The algorithm returns a new Graph and leaves HapNet untouched.
    expect(graph).not.toBe(hapNet);
    expect(hapNet.toJSON()).toEqual(before);

    // Median vectors are represented as inferred graph vertices.
    expect(graph.vertices.some((vertex) => vertex.info?.inferred === true)).toBe(true);
  });

  test("matches the PopART MJN edge list for the simple tapir fixture", () => {
    const fixturePath = join(process.cwd(), "test", "fixtures", "01_Simple_Tapir_Julia.nex");
    const expectedPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "expected",
      "01_Simple_Tapir_Julia_MJN.txt",
    );

    // Parse Nexus, condense haplotypes, and infer the MJN through the normal pipeline.
    const parsed = parseNexus(readFileSync(fixturePath, "utf8"));
    const hapNet = new HapNet(parsed);
    const graph = computeMJN(hapNet, 0);

    // Compare exactly with PopART's tab-separated nodeA/weight/nodeB export.
    const expected = readFileSync(expectedPath, "utf8").trimEnd().split(/\r?\n/);
    expect(edgeList(graph)).toEqual(expected);
  });

  test("matches the PopART MJN edge list for the complex dolphins fixture", () => {
    const fixturePath = join(process.cwd(), "test", "fixtures", "02_Complex_Mariana.nex");
    const expectedPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "expected",
      "02_Complex_Mariana_MJN.txt",
    );

    // Apply PopART-compatible undefined-site masking before HapNet construction.
    const parsed = parseNexus(readFileSync(fixturePath, "utf8"));
    const { mask, masked } = applyUndefinedSiteMask(parsed);
    const hapNet = new HapNet(parsed, masked > 0 ? { mask } : {});
    const graph = computeMJN(hapNet, 0);

    // Compare exactly with PopART's tab-separated nodeA/weight/nodeB export.
    const expected = readFileSync(expectedPath, "utf8").trimEnd().split(/\r?\n/);
    expect(edgeList(graph)).toEqual(expected);
  });
});
