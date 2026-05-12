const KNOWN_BLOCKS = new Set([
  "taxa",
  "characters",
  "data",
  "traits",
  "geotags",
  "trees",
  "network",
]);

const BLOCK_KEYS = {
  taxa: "taxa",
  characters: "characters",
  data: "characters",
  traits: "traits",
  geotags: "geotags",
  trees: "trees",
  network: "network",
};

function createResult() {
  return {
    taxa: null,
    characters: null,
    traits: null,
    geotags: null,
    trees: null,
    network: null,
  };
}

function createCharacters() {
  return {
    nchar: 0,
    datatype: "",
    missing: "",
    gap: "",
    matrix: {},
  };
}

function createTraits() {
  return {
    ntraits: 0,
    labels: [],
    latitude: [],
    longitude: [],
    matrix: {},
  };
}

function createGeoTags() {
  return {
    nclusts: 0,
    clustLabels: [],
    clustLatitude: [],
    clustLongitude: [],
    matrix: [],
  };
}

function createNetwork() {
  return {
    vertices: [],
    edges: [],
    vlabels: [],
  };
}

function parseError(message) {
  return new Error(`Nexus parse error: ${message}`);
}

function removeComments(text) {
  let output = "";
  let inComment = false;
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inComment) {
      if (char === "]") {
        inComment = false;
      } else if (char === "\n" || char === "\r") {
        output += char;
      }
      continue;
    }

    if (quote) {
      output += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      output += char;
      continue;
    }

    if (char === "[") {
      inComment = true;
      continue;
    }

    output += char;
  }

  return output;
}

function splitStatements(text) {
  const statements = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

function normalizeEquals(value) {
  return value.replace(/\s*=\s*/g, "=");
}

function tokenize(value, separators = /\s+/) {
  const tokens = [];
  const splitOnComma = separators === ",";
  let token = "";
  let quote = null;

  const flush = () => {
    const clean = token.trim();
    if (clean) {
      tokens.push(stripQuotes(clean));
    }
    token = "";
  };

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (quote) {
      token += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      token += char;
      continue;
    }

    if (splitOnComma ? char === "," : /\s/.test(char)) {
      flush();
      continue;
    }

    token += char;
  }

  flush();
  return tokens;
}

function firstToken(statement) {
  const match = statement.match(/^\s*("[^"]+"|'[^']+'|\S+)/);
  if (!match) {
    return { token: "", rest: "" };
  }

  const token = stripTrailingPunctuation(match[1]);
  return {
    token,
    rest: statement.slice(match[0].length).trim(),
  };
}

function stripTrailingPunctuation(value) {
  return value.replace(/[;,]$/g, "");
}

function stripQuotes(value) {
  const clean = stripTrailingPunctuation(value.trim());
  if (
    (clean.startsWith("\"") && clean.endsWith("\"")) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    return clean.slice(1, -1).trim();
  }
  return clean;
}

function parseAssignments(statement) {
  const normalized = normalizeEquals(statement);
  const tokens = tokenize(normalized);
  const assignments = new Map();

  for (const token of tokens) {
    const eqIndex = token.indexOf("=");
    if (eqIndex === -1) {
      assignments.set(token.toLowerCase(), true);
      continue;
    }

    const key = token.slice(0, eqIndex).toLowerCase();
    const value = stripQuotes(token.slice(eqIndex + 1));
    assignments.set(key, value);
  }

  return assignments;
}

function parseNumberList(rest) {
  return tokenize(rest).map((token) => Number(token));
}

function ensureTaxa(result) {
  if (!result.taxa) {
    result.taxa = [];
  }
  return result.taxa;
}

function addTaxon(result, name) {
  const taxa = ensureTaxa(result);
  if (!taxa.includes(name)) {
    taxa.push(name);
  }
}

function parseTaxLabels(statement, result) {
  const { rest } = firstToken(statement);
  for (const name of tokenize(rest)) {
    addTaxon(result, name);
  }
}

function applyDimensions(block, statement, result) {
  const { rest } = firstToken(statement);
  const assignments = parseAssignments(rest);

  if ((block === "characters" || block === "data") && assignments.has("nchar")) {
    result.characters.nchar = Number(assignments.get("nchar"));
  }

  if (block === "taxa" && assignments.has("ntax")) {
    ensureTaxa(result);
  }

  if (block === "traits" && assignments.has("ntraits")) {
    result.traits.ntraits = Number(assignments.get("ntraits"));
  }

  if (block === "geotags" && assignments.has("nclusts")) {
    result.geotags.nclusts = Number(assignments.get("nclusts"));
  }
}

function applyFormat(block, statement, result, state) {
  const { rest } = firstToken(statement);
  const assignments = parseAssignments(rest);

  if (block === "characters" || block === "data") {
    if (assignments.has("datatype")) {
      result.characters.datatype = String(assignments.get("datatype")).toLowerCase();
    }
    if (assignments.has("missing")) {
      result.characters.missing = assignments.get("missing");
    }
    if (assignments.has("gap")) {
      result.characters.gap = assignments.get("gap");
    }
    if (assignments.has("matchchar")) {
      state.matchChar = assignments.get("matchchar");
    }
    if (assignments.has("match")) {
      state.matchChar = assignments.get("match");
    }
  }

  if (block === "traits") {
    if (assignments.has("labels")) {
      state.traitsLabels = String(assignments.get("labels")).toLowerCase() === "yes";
    }
    if (assignments.has("missing")) {
      state.traitMissing = assignments.get("missing");
    }
    if (assignments.has("separator")) {
      state.traitSeparator = parseSeparator(assignments.get("separator"));
    }
  }

  if (block === "geotags") {
    if (assignments.has("labels")) {
      state.geotagsLabels = String(assignments.get("labels")).toLowerCase() === "yes";
    }
    if (assignments.has("separator")) {
      state.geotagSeparator = parseSeparator(assignments.get("separator"));
    }
  }
}

function parseSeparator(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === "comma") {
    return ",";
  }
  if (normalized === "tab") {
    return "\t";
  }
  return " ";
}

function parseCharactersMatrix(statement, result, state) {
  const { rest } = firstToken(statement);
  const rows = rest.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const sequenceOrder = [];
  let previousTaxon = null;

  for (const row of rows) {
    const parsed = parseLabeledRow(row);
    let name = parsed.name;
    let sequence = parsed.rest.replace(/\s+/g, "");

    if (!name) {
      continue;
    }

    if (!sequence && previousTaxon) {
      name = previousTaxon;
      sequence = row.replace(/\s+/g, "");
    }

    if (!sequence) {
      throw parseError(`No sequence found for taxon "${name}".`);
    }

    addTaxon(result, name);
    if (!Object.hasOwn(result.characters.matrix, name)) {
      sequenceOrder.push(name);
      result.characters.matrix[name] = "";
    }
    result.characters.matrix[name] += sequence;
    previousTaxon = name;
  }

  const topTaxon = sequenceOrder[0];
  const topSequence = topTaxon ? result.characters.matrix[topTaxon] : "";
  if (state.matchChar && topSequence) {
    for (const name of sequenceOrder.slice(1)) {
      result.characters.matrix[name] = replaceMatchChars(
        result.characters.matrix[name],
        topSequence,
        state.matchChar,
      );
    }
  }
}

function replaceMatchChars(sequence, topSequence, matchChar) {
  return Array.from(sequence, (char, index) => (
    char === matchChar ? topSequence[index] ?? char : char
  )).join("");
}

function parseLabeledRow(row) {
  const trimmed = row.replace(/,$/, "").trim();
  if (!trimmed) {
    return { name: "", rest: "" };
  }

  if (trimmed.startsWith("\"") || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const end = trimmed.indexOf(quote, 1);
    if (end === -1) {
      throw parseError("Quoted taxon name has no closing quote.");
    }
    return {
      name: trimmed.slice(1, end).trim(),
      rest: trimmed.slice(end + 1).trim(),
    };
  }

  const split = trimmed.match(/^(\S+)\s*(.*)$/);
  return {
    name: split?.[1] ?? "",
    rest: split?.[2]?.trim() ?? "",
  };
}

function parseTraitLabels(statement, result) {
  const { rest } = firstToken(statement);
  result.traits.labels = tokenize(rest);
  if (!result.traits.ntraits) {
    result.traits.ntraits = result.traits.labels.length;
  }
}

function parseTraitCoordinates(statement, result, target) {
  const { rest } = firstToken(statement);
  result.traits[target] = parseNumberList(rest);
}

function parseTraitsMatrix(statement, result, state) {
  const { rest } = firstToken(statement);
  const rows = rest.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  let taxonIndex = 0;

  if (!state.traitsLabels && !result.taxa) {
    return;
  }

  for (const row of rows) {
    let name;
    let valuesText;

    if (state.traitsLabels) {
      const parsed = parseLabeledRow(row);
      name = parsed.name;
      valuesText = parsed.rest;
    } else {
      name = result.taxa?.[taxonIndex];
      valuesText = row;
      taxonIndex += 1;
    }

    if (!name) {
      throw parseError("Trait matrix row is missing a taxon name.");
    }
    if (result.taxa && !result.taxa.includes(name)) {
      throw parseError(`Taxon "${name}" in Traits block is not defined.`);
    }

    result.traits.matrix[name] = splitMatrixValues(valuesText, state.traitSeparator)
      .map((value) => value === state.traitMissing ? 0 : Number(value));
  }
}

function splitMatrixValues(value, separator) {
  if (separator === ",") {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  if (separator === "\t") {
    return value.split("\t").map((part) => part.trim()).filter(Boolean);
  }
  return tokenize(value);
}

function parseClustLabels(statement, result) {
  const { rest } = firstToken(statement);
  result.geotags.clustLabels = tokenize(rest);
}

function parseClustCoordinates(statement, result, target) {
  const { rest } = firstToken(statement);
  result.geotags[target] = parseNumberList(rest);
}

function parseGeoTagsMatrix(statement, result, state) {
  const { rest } = firstToken(statement);
  const rows = rest.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  let taxonIndex = 0;

  if (!state.geotagsLabels && !result.taxa) {
    return;
  }

  for (const row of rows) {
    let name;
    let valuesText;

    if (state.geotagsLabels) {
      const parsed = parseLabeledRow(row);
      name = parsed.name;
      valuesText = parsed.rest;
    } else {
      name = result.taxa?.[taxonIndex];
      valuesText = row;
      taxonIndex += 1;
    }

    if (!name) {
      throw parseError("GeoTags matrix row is missing a taxon name.");
    }
    if (result.taxa && !result.taxa.includes(name)) {
      throw parseError(`Taxon "${name}" in GeoTags block is not defined.`);
    }

    const values = splitMatrixValues(valuesText, state.geotagSeparator);
    if (values.length < 2) {
      throw parseError(`GeoTags row for "${name}" is missing coordinates.`);
    }

    result.geotags.matrix.push({
      name,
      lat: parseCoordinate(values[0], "latitude"),
      lng: parseCoordinate(values[1], "longitude"),
      samples: values[2] === undefined ? 1 : Number(values[2]),
    });
  }
}

function parseCoordinate(value, kind) {
  const normalized = String(value).trim();
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([NSEWnsew])?$/);
  if (!match) {
    throw parseError(`Invalid ${kind} coordinate "${value}".`);
  }

  let coordinate = Number(match[1]);
  const hemisphere = match[2]?.toLowerCase();
  if (hemisphere === "s" || hemisphere === "w") {
    coordinate = -Math.abs(coordinate);
  }
  return coordinate;
}

function parseTree(statement, result) {
  const eqIndex = statement.indexOf("=");
  if (eqIndex === -1) {
    return;
  }
  result.trees.push(statement.slice(eqIndex + 1).trim());
}

function parseNetworkList(statement, parser) {
  const { rest } = firstToken(statement);
  return rest.split(/\r?\n/)
    .map((row) => row.replace(/,$/, "").trim())
    .filter(Boolean)
    .map(parser);
}

function parseVertex(row) {
  const [id, x, y] = tokenize(row).map(Number);
  if (![id, x, y].every(Number.isFinite)) {
    throw parseError(`Invalid vertex descriptor "${row}".`);
  }
  return { id, x, y };
}

function parseEdge(row) {
  const [id, from, to, weight = 1] = tokenize(row).map(Number);
  if (![id, from, to, weight].every(Number.isFinite)) {
    throw parseError(`Invalid edge descriptor "${row}".`);
  }
  return { id, from, to, weight };
}

function processStatement(statement, result, state) {
  const normalized = normalizeEquals(statement);
  const { token } = firstToken(normalized);
  const keyword = token.toLowerCase();

  if (keyword === "#nexus") {
    return;
  }

  if (keyword === "begin") {
    const blockName = stripTrailingPunctuation(tokenize(normalized)[1] ?? "").toLowerCase();
    state.block = KNOWN_BLOCKS.has(blockName) ? blockName : "other";

    const key = BLOCK_KEYS[state.block];
    if (key === "characters" && !result.characters) {
      result.characters = createCharacters();
    } else if (key === "traits" && !result.traits) {
      result.traits = createTraits();
    } else if (key === "geotags" && !result.geotags) {
      result.geotags = createGeoTags();
    } else if (key === "trees" && !result.trees) {
      result.trees = [];
    } else if (key === "network" && !result.network) {
      result.network = createNetwork();
    } else if (key === "taxa") {
      ensureTaxa(result);
    }
    return;
  }

  if (keyword === "end" || keyword === "endblock") {
    state.block = null;
    return;
  }

  if (!state.block || state.block === "other") {
    return;
  }

  if (keyword === "dimensions") {
    applyDimensions(state.block, normalized, result);
    return;
  }

  if (keyword === "format") {
    applyFormat(state.block, normalized, result, state);
    return;
  }

  if (keyword === "taxlabels") {
    parseTaxLabels(normalized, result);
    return;
  }

  if ((state.block === "characters" || state.block === "data") && keyword === "matrix") {
    parseCharactersMatrix(statement, result, state);
    return;
  }

  if (state.block === "traits") {
    if (keyword === "traitlabels") {
      parseTraitLabels(statement, result);
    } else if (keyword === "traitlatitude") {
      parseTraitCoordinates(statement, result, "latitude");
    } else if (keyword === "traitlongitude") {
      parseTraitCoordinates(statement, result, "longitude");
    } else if (keyword === "matrix") {
      parseTraitsMatrix(statement, result, state);
    }
    return;
  }

  if (state.block === "geotags") {
    if (keyword === "clustlabels") {
      parseClustLabels(statement, result);
    } else if (keyword === "clustlatitude") {
      parseClustCoordinates(statement, result, "clustLatitude");
    } else if (keyword === "clustlongitude") {
      parseClustCoordinates(statement, result, "clustLongitude");
    } else if (keyword === "matrix") {
      parseGeoTagsMatrix(statement, result, state);
    }
    return;
  }

  if (state.block === "trees" && keyword === "tree") {
    parseTree(statement, result);
    return;
  }

  if (state.block === "network") {
    if (keyword === "vertices") {
      result.network.vertices = parseNetworkList(statement, parseVertex);
    } else if (keyword === "edges") {
      result.network.edges = parseNetworkList(statement, parseEdge);
    } else if (keyword === "vlabels") {
      result.network.vlabels = parseNetworkList(statement, parseVertex);
    }
  }
}

export function parseNexus(text) {
  if (typeof text !== "string") {
    throw parseError("Expected Nexus input as a plain text string.");
  }

  const uncommented = removeComments(text);
  if (!/^\s*#nexus\b/i.test(uncommented)) {
    throw parseError("No Nexus header found.");
  }

  const result = createResult();
  const state = {
    block: null,
    matchChar: ".",
    traitsLabels: false,
    geotagsLabels: false,
    traitMissing: "?",
    traitSeparator: " ",
    geotagSeparator: " ",
  };

  const body = uncommented.replace(/^\s*#nexus\b[^\r\n]*(?:\r?\n)?/i, "");

  for (const statement of splitStatements(body)) {
    processStatement(statement, result, state);
  }

  if (!result.taxa && !result.characters) {
    throw parseError("Nexus file must include TAXA and/or CHARACTERS/DATA blocks.");
  }

  if (!result.characters) {
    throw parseError("Nexus file must include a CHARACTERS or DATA block.");
  }

  return result;
}
