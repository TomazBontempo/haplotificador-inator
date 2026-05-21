/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  __resetNetworkViewDependencies,
  __setNetworkViewDependencies,
  buildSaveState,
  initNetworkView,
  save,
  state,
  updateDataView,
} from "../../src/ui/NetworkView.js";

describe("NetworkView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    __resetNetworkViewDependencies();
    initNetworkView();
  });

  test("initializes without errors", () => {
    expect(document.getElementById("app")).not.toBeNull();
  });

  test("toolbar renders all expected elements", () => {
    expect(document.getElementById("file-menu-btn")).not.toBeNull();
    expect(document.getElementById("algorithm-menu-btn")).not.toBeNull();
    expect(document.getElementById("save-btn")).not.toBeNull();
    expect(document.getElementById("save-as-btn")).not.toBeNull();
    expect(document.getElementById("export-btn")).not.toBeNull();
  });

  test("status bar shows default state", () => {
    expect(document.getElementById("status-filename").textContent).toBe("No file loaded");
    expect(document.getElementById("status-algorithm").textContent).toBe("—");
  });

  test("data panel toggles on collapse button click", () => {
    const panel = document.getElementById("data-panel");
    const button = document.getElementById("collapse-data");

    button.click();
    expect(panel.classList.contains("collapsed")).toBe(true);

    button.click();
    expect(panel.classList.contains("collapsed")).toBe(false);
  });

  test("data view renders trait tree and alignment from parsed Nexus state", () => {
    state.parsedNexus = sampleParsedNexus();

    updateDataView();

    const traitsContent = document.getElementById("tab-content-traits");
    expect(traitsContent.textContent).toContain("Amazonia");
    expect(traitsContent.textContent).toContain("(2 sequences)");
    expect(traitsContent.textContent).toContain("(4 samples)");

    const toggle = traitsContent.querySelector(".trait-toggle");
    const childRow = traitsContent.querySelector(".trait-child-row");
    expect(childRow.classList.contains("hidden")).toBe(true);
    toggle.click();
    expect(childRow.classList.contains("hidden")).toBe(false);
    expect(traitsContent.textContent).toContain("H1");
    expect(traitsContent.textContent).toContain("3");

    document.getElementById("tab-alignment").click();
    const alignmentContent = document.getElementById("tab-content-alignment");
    expect(alignmentContent.classList.contains("hidden")).toBe(false);
    expect(alignmentContent.querySelector(".nuc-a").textContent).toBe("A");
    expect(alignmentContent.querySelector(".nuc-t").textContent).toBe("T");
    expect(alignmentContent.querySelector(".nuc-g").textContent).toBe("G");
    expect(alignmentContent.querySelector(".nuc-c").textContent).toBe("C");
  });

  test("save state includes parsed Nexus data for project restore", () => {
    state.currentFile = { name: "tapir.nex" };
    state.parsedNexus = sampleParsedNexus();

    expect(buildSaveState().parsedNexus.traits.labels).toEqual(["Amazonia", "Cerrado"]);
  });

  test("properties panel toggles on collapse button click", () => {
    const panel = document.getElementById("properties-panel");
    const button = document.getElementById("collapse-props");

    button.click();
    expect(panel.classList.contains("collapsed")).toBe(true);

    button.click();
    expect(panel.classList.contains("collapsed")).toBe(false);
  });

  test("progress overlay shows on pipeline start and hides on completion", async () => {
    jest.useFakeTimers();
    installPipelineMocks();
    state.currentFile = {
      name: "tapir.nex",
      text: jest.fn().mockResolvedValue("#NEXUS"),
    };

    document.getElementById("algorithm-ok").click();
    expect(document.getElementById("progress-overlay").classList.contains("hidden")).toBe(false);

    await flushPromises();
    await jest.advanceTimersByTimeAsync(300);

    expect(document.getElementById("progress-overlay").classList.contains("hidden")).toBe(true);
    jest.useRealTimers();
  });

  test("status bar updates after pipeline completes", async () => {
    jest.useFakeTimers();
    installPipelineMocks();
    state.currentFile = {
      name: "tapir.nex",
      text: jest.fn().mockResolvedValue("#NEXUS"),
    };

    document.getElementById("algorithm-ok").click();
    await flushPromises();
    await jest.advanceTimersByTimeAsync(300);

    expect(document.getElementById("status-filename").textContent).toBe("tapir.nex");
    expect(document.getElementById("status-algorithm").textContent).toBe("MJN");
    expect(document.getElementById("status-haplotypes").textContent).toBe("2");
    jest.useRealTimers();
  });

  test("assigns trait colors after first network render", async () => {
    jest.useFakeTimers();
    installPipelineMocks(["Amazonia", "Cerrado", "Chaco", "MataAtlantica", "Pantanal"]);
    state.currentFile = {
      name: "tapir.nex",
      text: jest.fn().mockResolvedValue("#NEXUS"),
    };

    document.getElementById("algorithm-ok").click();
    await flushPromises();
    await jest.advanceTimersByTimeAsync(300);

    expect(state.visualOptions.vertices.traitColors).toEqual([
      "#4e79a7",
      "#f28e2c",
      "#e15759",
      "#76b7b2",
      "#59a14f",
    ]);
    jest.useRealTimers();
  });

  test("preserves existing trait colors when trait count is unchanged", async () => {
    jest.useFakeTimers();
    installPipelineMocks(["Amazonia", "Cerrado"]);
    state.visualOptions.vertices.traitColors = ["#111111", "#222222"];
    state.currentFile = {
      name: "tapir.nex",
      text: jest.fn().mockResolvedValue("#NEXUS"),
    };

    document.getElementById("algorithm-ok").click();
    await flushPromises();
    await jest.advanceTimersByTimeAsync(300);

    expect(state.visualOptions.vertices.traitColors).toEqual(["#111111", "#222222"]);
    jest.useRealTimers();
  });

  test("save updates lastSaved state", async () => {
    const autoSave = jest.fn().mockResolvedValue(undefined);
    __setNetworkViewDependencies({
      storage: {
        autoSave,
      },
    });

    await save();

    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(state.lastSaved).toBeInstanceOf(Date);
  });
});

function installPipelineMocks(traitNames = []) {
  const graphJSON = {
    vertices: [
      {
        index: 0,
        label: "A",
        x: 100,
        y: 100,
        info: { name: "A", frequency: 1, traits: [] },
      },
      {
        index: 1,
        label: "B",
        x: 200,
        y: 200,
        info: { name: "B", frequency: 1, traits: [] },
      },
    ],
    edges: [
      {
        index: 0,
        from: 0,
        to: 1,
        weight: 1,
        info: { weight: 1 },
      },
    ],
  };

  class MockHapNet {
    constructor() {
      this.nseqs = 2;
      this.traitNames = traitNames;
    }

    toJSON() {
      return { haplotypes: [], traitNames };
    }
  }

  class MockWorker {
    constructor() {
      this.onmessage = null;
    }

    postMessage() {
      Promise.resolve().then(() => {
        this.onmessage?.({ data: { graph: graphJSON } });
      });
    }

    terminate() {}
  }

  const renderNetwork = jest.fn(() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
    viewport.setAttribute("class", "viewport");
    svg.appendChild(viewport);
    return svg;
  });

  __setNetworkViewDependencies({
    parseNexus: jest.fn(() => ({ characters: { matrix: {} } })),
    applyUndefinedSiteMask: jest.fn(() => ({ mask: [true], masked: 0 })),
    HapNet: MockHapNet,
    WorkerClass: MockWorker,
    renderNetwork,
    storage: {
      autoSave: jest.fn().mockResolvedValue(undefined),
    },
  });
}

function sampleParsedNexus() {
  return {
    taxa: ["H1", "H2"],
    characters: {
      matrix: {
        H1: "ATGC-",
        H2: "ACGTN",
      },
    },
    traits: {
      labels: ["Amazonia", "Cerrado"],
      matrix: {
        H1: [3, 0],
        H2: [1, 2],
      },
    },
  };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
