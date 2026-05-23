/**
 * @fileoverview
 * Persists project state for autosave and manual .hapnet files.
 * Uses IndexedDB for autosave and the File System Access API for Save As.
 */

const DB_NAME = "haplotificador";
const STORE_NAME = "project";
const DB_VERSION = 1;
const AUTOSAVE_KEY = "autosave";

const FILE_TYPES = Object.freeze([
  {
    description: "Haplotificador Project",
    accept: {
      "application/json": [".hapnet"],
    },
  },
]);

const FILE_SYSTEM_ACCESS_ERROR = "File System Access is not supported in this browser. Use Chrome or Edge.";

/**
 * Creates the shared error used when browser file-pickers are unavailable.
 */
function fileSystemAccessError() {
  return new Error(FILE_SYSTEM_ACCESS_ERROR);
}

/**
 * Finds IndexedDB across browser and test environments.
 */
function getIndexedDB() {
  return globalThis.indexedDB ?? globalThis.window?.indexedDB ?? null;
}

/**
 * Opens the project database and creates the single project store if needed.
 */
function openDatabase() {
  const indexedDB = getIndexedDB();

  if (!indexedDB) {
    return Promise.reject(new Error("IndexedDB is not supported in this browser."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

// The database is initialized once so all callers share the same connection
// instead of reopening IndexedDB for every save/load operation.
const databasePromise = openDatabase();

/**
 * Runs one operation against the autosave object store.
 */
function runTransaction(mode, operation) {
  return databasePromise.then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);
    let result;

    // Resolve on transaction completion so writes are durably committed before
    // callers continue.
    transaction.oncomplete = () => {
      resolve(result);
    };

    transaction.onerror = () => {
      reject(transaction.error);
    };

    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    };

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };

      request.onerror = () => {
        reject(request.error);
      };
    }
  }));
}

/**
 * Identifies user-cancelled native picker operations.
 */
function isAbortError(error) {
  return error?.name === "AbortError";
}

/**
 * Reads window lazily so storage can be tested outside a browser.
 */
function getWindow() {
  return globalThis.window ?? null;
}

/**
 * Fails early when Save As cannot use the File System Access API.
 */
function assertSavePickerSupport() {
  if (typeof getWindow()?.showSaveFilePicker !== "function") {
    throw fileSystemAccessError();
  }
}

/**
 * Fails early when opening .hapnet files cannot use the native picker.
 */
function assertOpenPickerSupport() {
  if (typeof getWindow()?.showOpenFilePicker !== "function") {
    throw fileSystemAccessError();
  }
}

/**
 * Derives a safe .hapnet filename from the original Nexus filename.
 */
function suggestedNameFor(state) {
  const originalFilename = String(state?.originalFilename || "network").trim();
  const safeFilename = originalFilename.split(/[\\/]/).pop() || "network";
  const basename = safeFilename.replace(/\.[^.]*$/, "") || "network";
  return `${basename}.hapnet`;
}

/**
 * Builds picker options shared by Save As and project loading.
 */
function filePickerOptions(state = null) {
  return {
    types: FILE_TYPES,
    excludeAcceptAllOption: true,
    ...(state ? { suggestedName: suggestedNameFor(state) } : {}),
  };
}

/**
 * Serializes project state as readable JSON for .hapnet files.
 */
function serializeState(state) {
  return JSON.stringify(state, null, 2);
}

/**
 * Downloads a .hapnet file when native file handles are unavailable.
 */
function downloadState(state) {
  const currentWindow = getWindow();
  const currentDocument = currentWindow?.document ?? globalThis.document;
  const currentURL = currentWindow?.URL ?? globalThis.URL;

  if (!currentDocument || !currentURL) {
    throw fileSystemAccessError();
  }

  // Firefox does not support showSaveFilePicker; this keeps Save As usable
  // without changing the IndexedDB autosave path.
  const blob = new Blob([serializeState(state)], { type: "application/json" });
  const anchor = currentDocument.createElement("a");
  anchor.href = currentURL.createObjectURL(blob);
  anchor.download = suggestedNameFor(state);
  anchor.click();
  currentURL.revokeObjectURL(anchor.href);
}

/**
 * Saves the current project state to the single IndexedDB auto-save slot.
 */
export async function autoSave(state) {
  // Autosave is intentionally a single slot that overwrites previous state.
  await runTransaction("readwrite", (store) => store.put(state, AUTOSAVE_KEY));
}

/**
 * Loads the IndexedDB auto-save state, or null when no auto-save exists.
 */
export async function loadAutoSave() {
  const state = await runTransaction("readonly", (store) => store.get(AUTOSAVE_KEY));
  return state === undefined ? null : state;
}

/**
 * Removes the IndexedDB auto-save slot.
 */
export async function clearAutoSave() {
  await runTransaction("readwrite", (store) => store.delete(AUTOSAVE_KEY));
}

/**
 * Reports whether an IndexedDB auto-save state exists.
 */
export async function hasAutoSave() {
  return (await loadAutoSave()) !== null;
}

/**
 * Prompts the user for a .hapnet destination and writes the state as JSON.
 */
export async function saveAs(state) {
  if (typeof getWindow()?.showSaveFilePicker !== "function") {
    downloadState(state);
    return null;
  }

  try {
    const fileHandle = await getWindow().showSaveFilePicker(filePickerOptions(state));
    await saveToHandle(fileHandle, state);
    return fileHandle;
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Writes project state to a previously selected File System Access handle.
 */
export async function saveToHandle(fileHandle, state) {
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(serializeState(state));
    await writable.close();
  } catch (error) {
    // Abort partial writes so a failed save does not leave a corrupted .hapnet.
    if (typeof writable.abort === "function") {
      await writable.abort();
    }
    throw error;
  }
}

/**
 * Prompts the user for a .hapnet file and returns the parsed project state.
 */
export async function loadFromFile() {
  assertOpenPickerSupport();

  try {
    const [fileHandle] = await getWindow().showOpenFilePicker(filePickerOptions());
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch (error) {
    if (isAbortError(error)) {
      return null;
    }
    throw error;
  }
}
