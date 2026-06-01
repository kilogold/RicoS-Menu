/**
 * Minimal on-disk menu.json validation for RicoS-Menu CI.
 * Mirrors @ricos/shared menu-catalog-file rules (release fields + document shape).
 */

function isLocalizedText(x) {
  return (
    !!x &&
    typeof x === "object" &&
    typeof x.en === "string" &&
    typeof x.es === "string"
  );
}

function parseModifierOption(raw, ctx) {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid menu: ${ctx} option`);
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`Invalid menu: ${ctx} option id`);
  if (!isLocalizedText(raw.label)) throw new Error(`Invalid menu: ${ctx} option label`);
  const out = { id: raw.id, label: raw.label };
  if (raw.priceDeltaCents !== undefined) {
    if (typeof raw.priceDeltaCents !== "number" || !Number.isFinite(raw.priceDeltaCents)) {
      throw new Error(`Invalid menu: ${ctx} option priceDeltaCents`);
    }
    out.priceDeltaCents = raw.priceDeltaCents;
  }
  return out;
}

function parseModifierGroup(raw, ctx) {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid menu: ${ctx} group`);
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`Invalid menu: ${ctx} group id`);
  if (!isLocalizedText(raw.title)) throw new Error(`Invalid menu: ${ctx} group title`);
  if (raw.selectionType !== "single" && raw.selectionType !== "multiple") {
    throw new Error(`Invalid menu: ${ctx} group selectionType`);
  }
  if (typeof raw.required !== "boolean") throw new Error(`Invalid menu: ${ctx} group required`);
  if (typeof raw.minSelections !== "number" || !Number.isInteger(raw.minSelections)) {
    throw new Error(`Invalid menu: ${ctx} group minSelections`);
  }
  if (typeof raw.maxSelections !== "number" || !Number.isInteger(raw.maxSelections)) {
    throw new Error(`Invalid menu: ${ctx} group maxSelections`);
  }
  if (!Array.isArray(raw.options)) throw new Error(`Invalid menu: ${ctx} group options`);
  return {
    id: raw.id,
    title: raw.title,
    selectionType: raw.selectionType,
    required: raw.required,
    minSelections: raw.minSelections,
    maxSelections: raw.maxSelections,
    options: raw.options.map((opt, i) => parseModifierOption(opt, `${ctx}[${i}]`)),
  };
}

function parsePrintStation(raw, ctx) {
  if (raw !== "A" && raw !== "B" && raw !== "default") {
    throw new Error(`Invalid menu: ${ctx} station must be "A", "B", or "default"`);
  }
  return raw;
}

function parseDecimalFeeRate(rawRate, rateFieldName) {
  if (typeof rawRate !== "number" || !Number.isFinite(rawRate) || rawRate < 0 || rawRate >= 1) {
    throw new Error(`Invalid menu: ${rateFieldName} must be a number in [0, 1)`);
  }
  return rawRate;
}

function parseMenuItem(raw, ctx) {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid menu: ${ctx} item`);
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`Invalid menu: ${ctx} item id`);
  if (!isLocalizedText(raw.name)) throw new Error(`Invalid menu: ${ctx} item name`);
  if (!isLocalizedText(raw.description)) throw new Error(`Invalid menu: ${ctx} item description`);
  if (typeof raw.priceCents !== "number" || !Number.isInteger(raw.priceCents)) {
    throw new Error(`Invalid menu: ${ctx} item priceCents`);
  }
  if (raw.station === undefined) {
    throw new Error(`Invalid menu: ${ctx} item station is required`);
  }
  const item = {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    priceCents: raw.priceCents,
    station: parsePrintStation(raw.station, `${ctx}.station`),
    salesTaxRate: parseDecimalFeeRate(raw.salesTaxRate, `${ctx}.salesTaxRate`),
    municipalTaxRate: parseDecimalFeeRate(raw.municipalTaxRate, `${ctx}.municipalTaxRate`),
  };
  if (raw.modifierGroups !== undefined) {
    if (!Array.isArray(raw.modifierGroups)) {
      throw new Error(`Invalid menu: ${ctx} item modifierGroups`);
    }
    item.modifierGroups = raw.modifierGroups.map((mg, i) =>
      parseModifierGroup(mg, `${ctx}.modifierGroups[${i}]`),
    );
  }
  return item;
}

function parseMenuCategory(raw, ctx) {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid menu: ${ctx} category`);
  if (typeof raw.id !== "string" || !raw.id) throw new Error(`Invalid menu: ${ctx} category id`);
  if (!isLocalizedText(raw.title)) throw new Error(`Invalid menu: ${ctx} category title`);
  if (!Array.isArray(raw.notes)) throw new Error(`Invalid menu: ${ctx} category notes`);
  for (let i = 0; i < raw.notes.length; i++) {
    if (!isLocalizedText(raw.notes[i])) throw new Error(`Invalid menu: ${ctx} notes[${i}]`);
  }
  if (!Array.isArray(raw.items)) throw new Error(`Invalid menu: ${ctx} category items`);
  return {
    id: raw.id,
    title: raw.title,
    notes: raw.notes,
    items: raw.items.map((it, i) => parseMenuItem(it, `${ctx}.items[${i}]`)),
  };
}

function parseOrderFees(rawOrderFees) {
  if (!rawOrderFees || typeof rawOrderFees !== "object" || Array.isArray(rawOrderFees)) {
    throw new Error("Invalid menu: orderFees");
  }
  return {
    serviceFeeRate: parseDecimalFeeRate(
      rawOrderFees.serviceFeeRate,
      "orderFees.serviceFeeRate",
    ),
  };
}

function parseMenuDocumentFromRoot(raw) {
  if (!isLocalizedText(raw.restaurant)) throw new Error("Invalid menu: restaurant");
  if (!isLocalizedText(raw.menuName)) throw new Error("Invalid menu: menuName");
  if (!Array.isArray(raw.categories)) throw new Error("Invalid menu: categories");
  return {
    restaurant: raw.restaurant,
    menuName: raw.menuName,
    categories: raw.categories.map((cat, i) => parseMenuCategory(cat, `categories[${i}]`)),
    orderFees: parseOrderFees(raw.orderFees),
  };
}

export function parseMenuCatalogFile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid menu catalog: expected object");
  }
  const cv = raw.catalogVersion;
  if (typeof cv !== "number" || !Number.isInteger(cv) || cv < 1) {
    throw new Error("Invalid menu catalog: catalogVersion must be a positive integer");
  }
  const publishedAtRaw = raw.publishedAt;
  if (typeof publishedAtRaw !== "string" || !publishedAtRaw.trim()) {
    throw new Error("Invalid menu catalog: publishedAt");
  }
  const publishedAtMs = Date.parse(publishedAtRaw);
  if (!Number.isFinite(publishedAtMs)) {
    throw new Error("Invalid menu catalog: publishedAt is not a valid date");
  }
  const publishedAtIso = new Date(publishedAtMs).toISOString();
  parseMenuDocumentFromRoot(raw);
  return { catalogVersion: cv, publishedAtIso };
}
