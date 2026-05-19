/**
 * @jest-environment jsdom
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  __resetNetworkViewDependencies,
  __setNetworkViewDependencies,
  initNetworkView,
  save,
  state,
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

function installPipelineMocks() {
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
    }

    toJSON() {
      return { haplotypes: [] };
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

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
