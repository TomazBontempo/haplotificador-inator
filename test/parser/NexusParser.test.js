import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";
import { parseNexus } from "../../src/parser/NexusParser.js";

const fixturePath = join(process.cwd(), "test", "fixtures", "popart_manual_example.nex");
const fixtureText = readFileSync(fixturePath, "utf8");

describe("parseNexus", () => {
  test("parses the PopART manual Nexus example blocks", () => {
    const parsed = parseNexus(fixtureText);

    expect(parsed.taxa).toEqual([
      "seq_1",
      "seq_2",
      "seq_3",
      "seq_4",
      "seq_5",
      "seq_6",
      "seq_7",
    ]);

    expect(parsed.characters).toMatchObject({
      nchar: 56,
      datatype: "dna",
      missing: "?",
      gap: "-",
    });
    expect(parsed.characters.matrix.seq_1)
      .toBe("ATATACGGGGTTA---TTAGA----AAAATGTGTGTGTGTTTTTTTTTTCATGTGG");
    expect(parsed.characters.matrix.seq_2)
      .toBe("ATATAC--GGATA---TTACA----AGAATCTATGTCTGCTTTCTTTTTCATGTGG");

    expect(parsed.traits).toEqual({
      ntraits: 5,
      labels: ["Europe", "Asia", "Africa", "Australia", "America"],
      latitude: [53, 43.6811, 5.4, -25.61, -0],
      longitude: [16.75, 87.3311, 26.5, 134.355, -76],
      matrix: {
        seq_2: [10, 5, 0, 6, 0],
        seq_7: [0, 0, 5, 0, 0],
        seq_5: [4, 0, 10, 0, 0],
        seq_4: [0, 0, 0, 4, 2],
        seq_3: [0, 0, 0, 3, 5],
        seq_1: [0, 0, 0, 3, 3],
        seq_6: [0, 0, 0, 7, 3],
      },
    });

    expect(parsed.geotags.nclusts).toBe(5);
    expect(parsed.geotags.clustLabels).toEqual(["Europe", "Asia", "Africa", "Australia", "America"]);
    expect(parsed.geotags.clustLatitude).toEqual([53, 43.6811, 5.4, -25.61, -0]);
    expect(parsed.geotags.clustLongitude).toEqual([16.75, 87.3311, 26.5, 134.355, -76]);
    expect(parsed.geotags.matrix).toHaveLength(14);
    expect(parsed.geotags.matrix[0]).toEqual({
      name: "seq_5",
      lat: 48.3621687364,
      lng: -10.6803478956,
      samples: 4,
    });

    expect(parsed.trees).toHaveLength(14);
    expect(parsed.trees[0]).toBe("(1,((2,3),((4,6,7),5)))");

    expect(parsed.network).toEqual({
      vertices: [
        { id: 1, x: 10.5, y: 20.25 },
        { id: 2, x: 30.75, y: 40.125 },
      ],
      edges: [
        { id: 1, from: 1, to: 2, weight: 3 },
      ],
      vlabels: [
        { id: 1, x: 11.5, y: 21.25 },
        { id: 2, x: 31.75, y: 41.125 },
      ],
    });
  });

  test("returns null for optional blocks that are absent", () => {
    const parsed = parseNexus(`#NEXUS
      Begin Data;
      Dimensions ntax=2 nchar=4;
      Format datatype=dna missing=? gap=-;
      Matrix
      a ACGT
      b ACGA
      ;
      End;
    `);

    expect(parsed.taxa).toEqual(["a", "b"]);
    expect(parsed.characters.matrix).toEqual({ a: "ACGT", b: "ACGA" });
    expect(parsed.traits).toBeNull();
    expect(parsed.geotags).toBeNull();
    expect(parsed.trees).toBeNull();
    expect(parsed.network).toBeNull();
  });

  test("is case-insensitive for block and keyword parsing", () => {
    const parsed = parseNexus(`#nexus
      begin taxa;
      dimensions ntax=1;
      taxlabels Seq_A;
      end;
      begin characters;
      dimensions nchar=3;
      format datatype=DNA missing=? gap=-;
      matrix
      Seq_A ACT
      ;
      end;
    `);

    expect(parsed.taxa).toEqual(["Seq_A"]);
    expect(parsed.characters.datatype).toBe("dna");
    expect(parsed.characters.matrix.Seq_A).toBe("ACT");
  });

  test("throws a clear error when TAXA and CHARACTERS/DATA are absent", () => {
    expect(() => parseNexus(`#NEXUS
      Begin Traits;
      Dimensions ntraits=1;
      TraitLabels Europe;
      Matrix
      seq_1 1
      ;
      End;
    `)).toThrow(/TAXA and\/or CHARACTERS\/DATA/);
  });
});
