import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import { computeTCS } from "../../src/algorithms/TCS.js";
import HapNet from "../../src/model/HapNet.js";
import { applyUndefinedSiteMask } from "../../src/model/SiteMask.js";
import { parseNexus } from "../../src/parser/NexusParser.js";

function edgeList(graph) {
  // Match PopART's exported TCS edge-list fixture format.
  return graph.edges.map((edge) => `${edge.from.label}\t${edge.weight}\t${edge.to.label}`);
}

function hapNetFromFixture(fixtureName) {
  const fixturePath = join(process.cwd(), "test", "fixtures", fixtureName);
  const parsed = parseNexus(readFileSync(fixturePath, "utf8"));
  const { mask, masked } = applyUndefinedSiteMask(parsed);

  return new HapNet(parsed, masked > 0 ? { mask } : {});
}

describe("computeTCS", () => {
  test("returns an independent graph with inferred intermediate metadata", () => {
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
    const graph = computeTCS(hapNet);

    // The algorithm returns a new Graph and leaves HapNet untouched.
    expect(graph).not.toBe(hapNet);
    expect(hapNet.toJSON()).toEqual(before);

    // TCS intermediate vertices are represented as inferred graph vertices.
    expect(graph.vertices.some((vertex) => vertex.info?.inferred === true)).toBe(true);
  });

  test("matches the PopART TCS edge list for the simple tapir fixture", () => {
    const expectedPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "expected",
      "01_Simple_Tapir_Julia_TCS.txt",
    );

    // Apply PopART-compatible undefined-site masking before HapNet construction.
    const hapNet = hapNetFromFixture("01_Simple_Tapir_Julia.nex");
    const graph = computeTCS(hapNet);

    // Compare exactly with PopART's tab-separated nodeA/weight/nodeB export.
    const expected = readFileSync(expectedPath, "utf8").trimEnd().split(/\r?\n/);
    expect(edgeList(graph)).toEqual(expected);
  });

  test("matches the PopART TCS edge list for the complex dolphins fixture", () => {
    const expectedPath = join(
      process.cwd(),
      "test",
      "fixtures",
      "expected",
      "02_Complex_Mariana_TCS.txt",
    );

    // Apply PopART-compatible undefined-site masking before HapNet construction.
    const hapNet = hapNetFromFixture("02_Complex_Mariana.nex");
    const graph = computeTCS(hapNet);

    // Compare exactly with PopART's tab-separated nodeA/weight/nodeB export.
    const expected = readFileSync(expectedPath, "utf8").trimEnd().split(/\r?\n/);
    expect(edgeList(graph)).toEqual(expected);
  });
});
