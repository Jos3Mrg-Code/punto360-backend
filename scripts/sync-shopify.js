"use strict";

/**
 * Sincronización de inventario PUNTO360 → Shopify
 *
 * Variables de entorno requeridas:
 *   PUNTO360_API_URL   → https://punto360-backend-production.up.railway.app
 *   PUNTO360_API_KEY   → pk_...
 *   SHOPIFY_STORE      → mi-tienda.myshopify.com
 *   SHOPIFY_TOKEN      → shpat_...  (Admin API access token)
 *   SHOPIFY_LOCATION   → ID numérico de la ubicación en Shopify
 *
 * Uso:
 *   node scripts/sync-shopify.js
 *   node scripts/sync-shopify.js --dry-run   (muestra cambios sin aplicarlos)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const CFG = {
  punto360Url: process.env.PUNTO360_API_URL || "https://punto360-backend-production.up.railway.app",
  punto360Key: process.env.PUNTO360_API_KEY,
  shopifyStore: process.env.SHOPIFY_STORE,
  shopifyToken: process.env.SHOPIFY_TOKEN,
  shopifyLocation: process.env.SHOPIFY_LOCATION,
};

// ─── Validación ──────────────────────────────────────────────────────────────

function validate() {
  const missing = ["punto360Key", "shopifyStore", "shopifyToken", "shopifyLocation"]
    .filter((k) => !CFG[k]);
  if (missing.length) {
    console.error("❌ Variables de entorno faltantes:", missing.map(k => ({
      punto360Key: "PUNTO360_API_KEY",
      shopifyStore: "SHOPIFY_STORE",
      shopifyToken: "SHOPIFY_TOKEN",
      shopifyLocation: "SHOPIFY_LOCATION",
    })[k]).join(", "));
    process.exit(1);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${url}\n${text}`);
  }
  return res.json();
}

function shopifyHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": CFG.shopifyToken,
  };
}

// Respeta el rate limit de Shopify (2 req/s en REST)
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── PUNTO360: obtener todos los productos ────────────────────────────────────

async function getPunto360Products() {
  let page = 1;
  const all = [];

  while (true) {
    const data = await fetchJson(
      `${CFG.punto360Url}/public-api/products?api_key=${CFG.punto360Key}&limit=500&page=${page}`
    );
    all.push(...data.data);
    if (page >= data.meta.pages) break;
    page++;
  }

  console.log(`📦 PUNTO360: ${all.length} productos obtenidos`);
  return all;
}

// ─── PUNTO360 → mapa SKU → stock ─────────────────────────────────────────────

function buildStockMap(products) {
  const map = new Map(); // SKU → cantidad

  for (const p of products) {
    if (p.has_variants) {
      for (const v of p.variants) {
        map.set(v.sku, v.stock);
      }
    } else {
      map.set(p.sku, p.stock);
    }
  }

  return map;
}

// ─── Shopify: obtener todos los productos y variantes ─────────────────────────

async function getShopifyVariants() {
  const variants = new Map(); // SKU → { inventory_item_id, variant_id, current_stock }
  let url = `https://${CFG.shopifyStore}/admin/api/2024-01/products.json?limit=250&fields=id,variants`;

  while (url) {
    const res = await fetch(url, { headers: shopifyHeaders() });

    // Shopify devuelve el link de siguiente página en el header Link
    const linkHeader = res.headers.get("link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;

    const data = await res.json();

    for (const product of data.products) {
      for (const variant of product.variants) {
        if (variant.sku) {
          variants.set(variant.sku, {
            inventory_item_id: variant.inventory_item_id,
            variant_id: variant.id,
          });
        }
      }
    }

    if (url) await sleep(500);
  }

  console.log(`🛍️  Shopify: ${variants.size} variantes con SKU encontradas`);
  return variants;
}

// ─── Shopify: obtener stock actual de un inventory_item ───────────────────────

async function getShopifyStock(inventoryItemId) {
  const data = await fetchJson(
    `https://${CFG.shopifyStore}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${inventoryItemId}&location_ids=${CFG.shopifyLocation}`,
    { headers: shopifyHeaders() }
  );
  const level = data.inventory_levels?.[0];
  return level ? level.available : null;
}

// ─── Shopify: actualizar stock ────────────────────────────────────────────────

async function setShopifyStock(inventoryItemId, quantity) {
  if (DRY_RUN) return;

  await fetchJson(
    `https://${CFG.shopifyStore}/admin/api/2024-01/inventory_levels/set.json`,
    {
      method: "POST",
      headers: shopifyHeaders(),
      body: JSON.stringify({
        location_id: CFG.shopifyLocation,
        inventory_item_id: inventoryItemId,
        available: Math.max(0, Math.round(quantity)),
      }),
    }
  );
}

// ─── Sincronización principal ─────────────────────────────────────────────────

async function sync() {
  validate();

  console.log(`\n🔄 Iniciando sincronización${DRY_RUN ? " (DRY RUN)" : ""}...\n`);

  const [punto360Products, shopifyVariants] = await Promise.all([
    getPunto360Products(),
    getShopifyVariants(),
  ]);

  const stockMap = buildStockMap(punto360Products);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  let errors = 0;

  const skus = [...stockMap.keys()];

  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    const newStock = stockMap.get(sku);
    const shopifyVariant = shopifyVariants.get(sku);

    if (!shopifyVariant) {
      notFound++;
      continue;
    }

    try {
      const currentStock = await getShopifyStock(shopifyVariant.inventory_item_id);
      await sleep(500); // rate limit

      if (currentStock === newStock) {
        skipped++;
        continue;
      }

      await setShopifyStock(shopifyVariant.inventory_item_id, newStock);
      await sleep(500);

      console.log(`  ✅ ${sku}: ${currentStock} → ${newStock}${DRY_RUN ? " (simulado)" : ""}`);
      updated++;
    } catch (err) {
      console.error(`  ❌ ${sku}: ${err.message}`);
      errors++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Resumen de sincronización
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Actualizados : ${updated}
  ⏭️  Sin cambios  : ${skipped}
  🔍 No en Shopify: ${notFound}
  ❌ Errores      : ${errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

sync().catch((err) => {
  console.error("Error fatal:", err.message);
  process.exit(1);
});
