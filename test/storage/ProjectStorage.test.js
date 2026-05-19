/** @jest-environment jsdom */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createRequest(run, transaction = null) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  };

  setTimeout(() => {
    try {
      request.result = run();
      request.onsuccess?.({ target: request });
      transaction?.oncomplete?.({ target: transaction });
    } catch (error) {
      request.error = error;
      if (transaction) {
        transaction.error = error;
      }
      request.onerror?.({ target: request });
      transaction?.onerror?.({ target: transaction });
    }
  }, 0);

  return request;
}

function createFakeIndexedDB() {
  const databases = new Map();

  return {
    open(name) {
      const request = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };

      setTimeout(() => {
        let stores = databases.get(name);
        const isNewDatabase = !stores;

        if (!stores) {
          stores = new Map();
          databases.set(name, stores);
        }

        const database = {
          objectStoreNames: {
            contains: (storeName) => stores.has(storeName),
          },
          createObjectStore: (storeName) => {
            const store = new Map();
            stores.set(storeName, store);
            return store;
          },
          transaction: (storeName) => {
            const store = stores.get(storeName);
            const transaction = {
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore: () => ({
                put: (value, key) => createRequest(() => {
                  store.set(key, clone(value));
                  return key;
                }, transaction),
                get: (key) => createRequest(() => clone(store.get(key)), transaction),
                delete: (key) => createRequest(() => {
                  store.delete(key);
                  return undefined;
                }, transaction),
              }),
            };
            return transaction;
          },
        };

        request.result = database;
        if (isNewDatabase) {
          request.onupgradeneeded?.({ target: request });
        }
        request.onsuccess?.({ target: request });
      }, 0);

      return request;
    },
  };
}

function installFakeIndexedDB() {
  const fakeIndexedDB = createFakeIndexedDB();
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: fakeIndexedDB,
  });
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: fakeIndexedDB,
  });
}

async function loadStorageModule() {
  jest.resetModules();
  installFakeIndexedDB();
  return import("../../src/storage/ProjectStorage.js");
}

function sampleState(overrides = {}) {
  return {
    version: 1,
    savedAt: "2026-05-19T12:00:00.000Z",
    originalFilename: "tapir.nex",
    algorithm: "MJN",
    graph: {
      vertices: [
        {
          index: 0,
          label: "A",
          x: 100,
          y: 120,
          radius: 14,
          info: { frequency: 2 },
        },
      ],
      edges: [
        {
          from: 0,
          to: 0,
          weight: 1,
        },
      ],
    },
    visual: {
      traitColors: ["#ff0000", "#0000ff"],
      zoom: 1.25,
      panX: 10,
      panY: -5,
    },
    ...overrides,
  };
}

const expectedSavePickerOptions = {
  types: [
    {
      description: "Haplotificador Project",
      accept: {
        "application/json": [".hapnet"],
      },
    },
  ],
  excludeAcceptAllOption: true,
  suggestedName: "tapir.hapnet",
};

describe("ProjectStorage", () => {
  beforeEach(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
    delete globalThis.indexedDB;
  });

  test("autoSave and loadAutoSave roundtrip", async () => {
    const { autoSave, loadAutoSave } = await loadStorageModule();
    const state = sampleState();

    await autoSave(state);

    expect(await loadAutoSave()).toEqual(state);
  });

  test("hasAutoSave returns false when no save exists", async () => {
    const { hasAutoSave } = await loadStorageModule();

    expect(await hasAutoSave()).toBe(false);
  });

  test("hasAutoSave returns true after autoSave", async () => {
    const { autoSave, hasAutoSave } = await loadStorageModule();

    await autoSave(sampleState());

    expect(await hasAutoSave()).toBe(true);
  });

  test("clearAutoSave removes the save", async () => {
    const { autoSave, clearAutoSave, hasAutoSave } = await loadStorageModule();

    await autoSave(sampleState());
    await clearAutoSave();

    expect(await hasAutoSave()).toBe(false);
  });

  test("autoSave overwrites previous save", async () => {
    const { autoSave, loadAutoSave } = await loadStorageModule();
    const stateA = sampleState({ algorithm: "MSN" });
    const stateB = sampleState({
      savedAt: "2026-05-19T12:05:00.000Z",
      algorithm: "TCS",
      visual: {
        traitColors: ["#00ff00"],
        zoom: 2,
        panX: 20,
        panY: 30,
      },
    });

    await autoSave(stateA);
    await autoSave(stateB);

    expect(await loadAutoSave()).toEqual(stateB);
  });

  test("saveAs calls showSaveFilePicker and writes the file", async () => {
    const { saveAs } = await loadStorageModule();
    const state = sampleState();
    const writable = {
      write: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const fileHandle = {
      createWritable: jest.fn().mockResolvedValue(writable),
    };
    window.showSaveFilePicker = jest.fn().mockResolvedValue(fileHandle);

    const result = await saveAs(state);

    expect(result).toBe(fileHandle);
    expect(window.showSaveFilePicker).toHaveBeenCalledWith(expectedSavePickerOptions);
    expect(fileHandle.createWritable).toHaveBeenCalledTimes(1);
    expect(writable.write).toHaveBeenCalledWith(JSON.stringify(state, null, 2));
    expect(writable.close).toHaveBeenCalledTimes(1);
  });

  test("loadFromFile reads and parses a .hapnet file", async () => {
    const { loadFromFile } = await loadStorageModule();
    const state = sampleState();
    const file = {
      text: jest.fn().mockResolvedValue(JSON.stringify(state)),
    };
    const fileHandle = {
      getFile: jest.fn().mockResolvedValue(file),
    };
    window.showOpenFilePicker = jest.fn().mockResolvedValue([fileHandle]);

    const result = await loadFromFile();

    expect(window.showOpenFilePicker).toHaveBeenCalledWith({
      types: expectedSavePickerOptions.types,
      excludeAcceptAllOption: true,
    });
    expect(fileHandle.getFile).toHaveBeenCalledTimes(1);
    expect(file.text).toHaveBeenCalledTimes(1);
    expect(result).toEqual(state);
  });

  test("saveAs returns null when user cancels", async () => {
    const { saveAs } = await loadStorageModule();
    window.showSaveFilePicker = jest.fn().mockRejectedValue(
      new DOMException("The user aborted a request.", "AbortError"),
    );

    await expect(saveAs(sampleState())).resolves.toBeNull();
  });
});
