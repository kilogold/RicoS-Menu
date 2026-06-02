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

function parseModifierVisibilityRule(raw, ctx) {
  if (!raw || typeof raw !== "object") throw new Error(`Invalid menu: ${ctx} visibleWhen`);
  if (typeof raw.groupId !== "string" || !raw.groupId) {
    throw new Error(`Invalid menu: ${ctx} visibleWhen groupId`);
  }
  if (!Array.isArray(raw.optionIds) || raw.optionIds.length === 0) {
    throw new Error(`Invalid menu: ${ctx} visibleWhen optionIds`);
  }
  const optionIds = [];
  for (let i = 0; i < raw.optionIds.length; i++) {
    const optionId = raw.optionIds[i];
    if (typeof optionId !== "string" || !optionId) {
      throw new Error(`Invalid menu: ${ctx} visibleWhen optionIds[${i}]`);
    }
    optionIds.push(optionId);
  }
  return { groupId: raw.groupId, optionIds };
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
  const group = {
    id: raw.id,
    title: raw.title,
    selectionType: raw.selectionType,
    required: raw.required,
    minSelections: raw.minSelections,
    maxSelections: raw.maxSelections,
    options: raw.options.map((opt, i) => parseModifierOption(opt, `${ctx}[${i}]`)),
  };
  if (raw.visibleWhen !== undefined) {
    group.visibleWhen = parseModifierVisibilityRule(raw.visibleWhen, `${ctx}.visibleWhen`);
  }
  return group;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseModifierGroupRefs(rawRefs, ctx) {
  if (rawRefs === undefined) return undefined;
  if (!Array.isArray(rawRefs)) {
    throw new Error(`Invalid menu: ${ctx} modifierGroupRefs`);
  }
  const refs = [];
  const seen = new Set();
  for (let i = 0; i < rawRefs.length; i++) {
    const ref = rawRefs[i];
    if (typeof ref !== "string" || !ref) {
      throw new Error(`Invalid menu: ${ctx} modifierGroupRefs[${i}]`);
    }
    if (seen.has(ref)) {
      throw new Error(`Invalid menu: ${ctx} modifierGroupRefs duplicate id "${ref}"`);
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

/**
 * Mirror of RicoS/packages/shared/src/menu-catalog-compact.ts (resolveMenuCatalogRaw).
 * Keep in sync: inline item.modifierGroups are not accepted; all modifiers must use refs.
 */
function resolveMenuCatalogRaw(raw) {
  const out = deepClone(raw);
  const rawRegistry = out.modifierGroups;
  const registry = new Map();
  if (rawRegistry !== undefined) {
    if (!rawRegistry || typeof rawRegistry !== "object" || Array.isArray(rawRegistry)) {
      throw new Error("Invalid menu: modifierGroups");
    }
    for (const [groupId, entry] of Object.entries(rawRegistry)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Invalid menu: modifierGroups["${groupId}"]`);
      }
      const nextEntry = deepClone(entry);
      if (nextEntry.id === undefined) nextEntry.id = groupId;
      if (nextEntry.id !== groupId) {
        throw new Error(`Invalid menu: modifierGroups["${groupId}"] id mismatch`);
      }
      registry.set(groupId, nextEntry);
    }
  }

  if (Array.isArray(out.categories)) {
    for (let categoryIndex = 0; categoryIndex < out.categories.length; categoryIndex++) {
      const category = out.categories[categoryIndex];
      if (!category || typeof category !== "object" || Array.isArray(category)) continue;
      const categoryCtx = `categories[${categoryIndex}]`;
      const categoryRefs = parseModifierGroupRefs(category.modifierGroupRefs, categoryCtx);
      delete category.modifierGroupRefs;

      if (!Array.isArray(category.items)) continue;
      for (let itemIndex = 0; itemIndex < category.items.length; itemIndex++) {
        const item = category.items[itemIndex];
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const itemCtx = `${categoryCtx}.items[${itemIndex}]`;
        const itemRefs = parseModifierGroupRefs(item.modifierGroupRefs, itemCtx);
        if (item.modifierGroups !== undefined) {
          throw new Error(`Invalid menu: ${itemCtx} inline modifierGroups are not allowed; use modifierGroupRefs`);
        }
        const refs = itemRefs ?? categoryRefs;
        delete item.modifierGroupRefs;
        if (!refs) continue;
        item.modifierGroups = refs.map((groupId) => {
          const group = registry.get(groupId);
          if (!group) throw new Error(`Invalid menu: ${itemCtx} unknown modifier group "${groupId}"`);
          return deepClone(group);
        });
      }
    }
  }

  delete out.modifierGroups;
  return out;
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

function parseThemes(raw, categoryIds) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid menu: themes");
  }
  if (categoryIds.size === 0) {
    if (Object.keys(raw).length > 0) {
      throw new Error("Invalid menu: themes must be empty when there are no categories");
    }
    return {};
  }
  const themes = {};
  const assigned = new Set();

  for (const [theme, value] of Object.entries(raw)) {
    if (!theme) throw new Error("Invalid menu: themes empty theme key");
    if (!Array.isArray(value)) throw new Error(`Invalid menu: themes["${theme}"]`);
    const categoryIdList = [];
    for (let i = 0; i < value.length; i++) {
      const categoryId = value[i];
      if (typeof categoryId !== "string" || !categoryId) {
        throw new Error(`Invalid menu: themes["${theme}"][${i}]`);
      }
      if (!categoryIds.has(categoryId)) {
        throw new Error(`Invalid menu: themes["${theme}"] unknown category "${categoryId}"`);
      }
      if (assigned.has(categoryId)) {
        throw new Error(`Invalid menu: themes duplicate category "${categoryId}"`);
      }
      assigned.add(categoryId);
      categoryIdList.push(categoryId);
    }
    themes[theme] = categoryIdList;
  }

  if (Object.keys(themes).length === 0) throw new Error("Invalid menu: themes");

  for (const categoryId of categoryIds) {
    if (!assigned.has(categoryId)) {
      throw new Error(`Invalid menu: themes missing category "${categoryId}"`);
    }
  }

  return themes;
}

function parseMenuDocumentFromRoot(raw) {
  if (!isLocalizedText(raw.restaurant)) throw new Error("Invalid menu: restaurant");
  if (!isLocalizedText(raw.menuName)) throw new Error("Invalid menu: menuName");
  if (!Array.isArray(raw.categories)) throw new Error("Invalid menu: categories");
  const categories = raw.categories.map((cat, i) => parseMenuCategory(cat, `categories[${i}]`));
  const categoryIds = new Set(categories.map((category) => category.id));
  const themes = parseThemes(raw.themes, categoryIds);
  return {
    restaurant: raw.restaurant,
    menuName: raw.menuName,
    themes,
    categories,
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
  parseMenuDocumentFromRoot(resolveMenuCatalogRaw(raw));
  return { catalogVersion: cv, publishedAtIso };
}
