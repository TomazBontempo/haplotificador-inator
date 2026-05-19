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

const FILE_SYSTEM_ACCESS_ERROR = "Save As is not supported in this browser. Use Chrome or Edge.";

// Known limitation: the File System Access picker workflow is not available in
// Firefox, so callers should surface an export/open fallback in the UI layer.
function fileSystemAccessError() {
  return new Error(FILE_SYSTEM_ACCESS_ERROR);
}

function getIndexedDB() {
  return globalThis.indexedDB ?? globalThis.window?.indexedDB ?? null;
}

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

const databasePromise = openDatabase();

function runTransaction(mode, operation) {
  return databasePromise.then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);
    let result;

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

function isAbortError(error) {
  return error?.name === "AbortError";
}

function getWindow() {
  return globalThis.window ?? null;
}

function assertSavePickerSupport() {
  if (typeof getWindow()?.showSaveFilePicker !== "function") {
    throw fileSystemAccessError();
  }
}

function assertOpenPickerSupport() {
  if (typeof getWindow()?.showOpenFilePicker !== "function") {
    throw fileSystemAccessError();
  }
}

function suggestedNameFor(state) {
  const originalFilename = String(state?.originalFilename || "project").trim();
  const safeFilename = originalFilename.split(/[\\/]/).pop() || "project";
  const basename = safeFilename.replace(/\.[^.]*$/, "") || "project";
  return `${basename}.hapnet`;
}

function filePickerOptions(state = null) {
  return {
    types: FILE_TYPES,
    excludeAcceptAllOption: true,
    ...(state ? { suggestedName: suggestedNameFor(state) } : {}),
  };
}

function serializeState(state) {
  return JSON.stringify(state, null, 2);
}

/**
 * Saves the current project state to the single IndexedDB auto-save slot.
 */
export async function autoSave(state) {
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
  assertSavePickerSupport();

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
