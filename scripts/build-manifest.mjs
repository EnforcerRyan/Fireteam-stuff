#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiKey = process.env.BUNGIE_KEY;
const origin = "https://www.bungie.net";
const outputPath = resolve(process.cwd(), "manifest-data.json");

if (!apiKey) {
  console.error("Missing BUNGIE_KEY environment variable.");
  process.exit(1);
}

async function getJson(url, label) {
  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: response was not valid JSON`);
  }
}

const manifestResponse = await getJson(
  `${origin}/Platform/Destiny2/Manifest/`,
  "Manifest request"
);

if (manifestResponse?.ErrorCode !== 1) {
  throw new Error(
    `Bungie API error: ${manifestResponse?.ErrorStatus ?? "unknown"}`
  );
}

const manifest = manifestResponse.Response;
const itemPath =
  manifest?.jsonWorldComponentContentPaths?.en
    ?.DestinyInventoryItemDefinition;

if (
  typeof itemPath !== "string" ||
  !itemPath.startsWith("/common/destiny2_content/json/") ||
  itemPath.includes("..") ||
  itemPath.includes("\\")
) {
  throw new Error("Manifest returned an unexpected item-definition path.");
}

console.log("Downloading Destiny item definitions...");
const items = await getJson(new URL(itemPath, origin), "Item definitions");

if (!items || typeof items !== "object" || Array.isArray(items)) {
  throw new Error("Item definitions were not returned as a hash map.");
}

const slotBuckets = {
  1498876634: "Kinetic",
  2465295065: "Energy",
  953998645: "Power",
};
const damageHashes = {
  3373582085: "Kinetic",
  1847026933: "Solar",
  2303181850: "Arc",
  3454344768: "Void",
  151347233: "Stasis",
  3949783978: "Strand",
};
const damageEnums = {
  1: "Kinetic",
  2: "Arc",
  3: "Solar",
  4: "Void",
  5: "Stasis",
  6: "Strand",
};
const classes = { 0: "Titan", 1: "Hunter", 2: "Warlock" };
const armorBuckets = {
  3448274439: "Helmet",
  3551918588: "Arms",
  14239492: "Chest",
  20886954: "Legs",
  1585787867: "Class Item",
};

const plugNames = Object.create(null);
for (const [hash, def] of Object.entries(items)) {
  const name = def?.displayProperties?.name?.trim();
  if (name && (def.itemType === 19 || def.plug)) {
    plugNames[hash] = name;
  }
}

const weapons = [];
const exoticArmor = [];
const hashMap = Object.create(null);
const seenWeapons = new Set();
const seenArmor = new Set();

for (const [hash, def] of Object.entries(items)) {
  const name = def?.displayProperties?.name?.trim();
  if (!name || def.redacted) continue;

  if (def.itemType === 3) {
    const rarity = def.inventory?.tierTypeName;
    if (rarity !== "Legendary" && rarity !== "Exotic") continue;

    const slot = slotBuckets[def.inventory?.bucketTypeHash];
    const damage =
      damageHashes[def.defaultDamageTypeHash] ||
      damageEnums[def.defaultDamageType];

    if (!slot || !damage) continue;

    const type = def.itemTypeDisplayName || "Weapon";
    let originTrait =
      rarity === "Exotic" ? "Exotic Intrinsic" : "Standard Frame";

    const originCategory = def.sockets?.socketCategories?.find(
      (category) => category.socketCategoryHash === 3993098925
    );

    for (const index of originCategory?.socketIndexes ?? []) {
      const socket = def.sockets?.socketEntries?.[index];
      const plugHash =
        socket?.singleInitialItemHash ||
        socket?.reusablePlugItems?.[0]?.plugItemHash;

      if (plugHash && plugNames[plugHash]) {
        originTrait = plugNames[plugHash];
        break;
      }
    }

    hashMap[hash] = {
      name,
      category: "Weapon",
      slot,
      type,
      damage,
      rarity,
      originTrait,
    };

    const key = `${name.toLowerCase()}|${slot}`;
    if (!seenWeapons.has(key)) {
      seenWeapons.add(key);
      weapons.push({ name, slot, type, damage, rarity, originTrait });
    }
  }

  if (def.itemType === 2 && def.inventory?.tierTypeName === "Exotic") {
    const classType = classes[def.classType];
    const slot = armorBuckets[def.inventory?.bucketTypeHash];
    if (!classType || !slot) continue;

    hashMap[hash] = {
      name,
      category: "Armor",
      classType,
      slot,
      rarity: "Exotic",
    };

    const key = name.toLowerCase();
    if (!seenArmor.has(key)) {
      seenArmor.add(key);
      exoticArmor.push({ name, classType, slot });
    }
  }
}

if (weapons.length <= 50 || exoticArmor.length <= 20) {
  throw new Error(
    `Only parsed ${weapons.length} weapons and ${exoticArmor.length} exotic armor items; not writing output.`
  );
}

const result = {
  generatedAt: new Date().toISOString(),
  manifestVersion: manifest.version ?? null,
  weapons,
  exoticArmor,
  hashMap,
};

await writeFile(outputPath, `${JSON.stringify(result)}\n`, "utf8");

console.log(
  `Wrote manifest-data.json: ${weapons.length} weapons, ` +
    `${exoticArmor.length} exotic armor items.`
);
