const UNDEFINED_STATES = new Set(["-", "?", "N", "Y", "R", "M", "S", "V", "W", "K", "D", "H", "B"]);

function siteMaskError(message) {
  // Keep preprocessing errors distinct from parser and HapNet model errors.
  return new Error(`Site mask error: ${message}`);
}

function sequenceNames(parsed) {
  // Prefer the explicit TAXA order, falling back to matrix insertion order.
  if (parsed?.taxa?.length) {
    return parsed.taxa;
  }
  if (parsed?.characters?.matrix) {
    return Object.keys(parsed.characters.matrix);
  }
  return [];
}

function assertParsedCharacters(parsed, names) {
  // The mask is defined over the parsed Nexus character matrix.
  if (!parsed?.characters?.matrix) {
    throw siteMaskError("Expected parsed Nexus data with a characters matrix.");
  }
  if (names.length === 0) {
    throw siteMaskError("Expected at least one sequence.");
  }
}

function isUndefinedState(value) {
  // Match PopART's undefined DNA states for the mandatory site-mask warning.
  return UNDEFINED_STATES.has(String(value).toUpperCase());
}

export function applyUndefinedSiteMask(parsed) {
  const names = sequenceNames(parsed);
  assertParsedCharacters(parsed, names);

  const matrix = parsed.characters.matrix;
  const siteCount = String(matrix[names[0]] ?? "").length;

  if (siteCount === 0) {
    return { mask: [], masked: 0 };
  }

  const undefinedPercentages = Array(siteCount).fill(0);
  const hasUndefinedState = Array(siteCount).fill(false);

  // Calculate the undefined-state percentage for each alignment column.
  for (let siteIndex = 0; siteIndex < siteCount; siteIndex += 1) {
    let undefinedCount = 0;

    for (const name of names) {
      const sequence = String(matrix[name] ?? "");
      if (sequence.length !== siteCount) {
        throw siteMaskError(`Sequence "${name}" length does not match the first sequence.`);
      }
      if (isUndefinedState(sequence[siteIndex])) {
        undefinedCount += 1;
      }
    }

    undefinedPercentages[siteIndex] = (undefinedCount * 100) / names.length;
    hasUndefinedState[siteIndex] = undefinedCount > 0;
  }

  // PopART Window 1 triggers when more than 5% of sites contain undefined states.
  const problematicSites = hasUndefinedState.filter(Boolean).length;
  if ((problematicSites * 100) / siteCount <= 5) {
    return { mask: Array(siteCount).fill(true), masked: 0 };
  }

  // Once the warning triggers, PopART masks every column that contains undefined data.
  const mask = hasUndefinedState.map((undefinedAtSite) => !undefinedAtSite);
  return {
    mask,
    masked: mask.filter((keepSite) => !keepSite).length,
  };
}

export default applyUndefinedSiteMask;
