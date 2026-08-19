"use strict";

/**
 * Importación inicial de productos PUNTO360 → Shopify
 * Crea productos que no existen en Shopify (comparando por SKU).
 * Después de la importación, usa sync-shopify.js para mantener el stock al día.
 *
 * Uso:
 *   node scripts/import-shopify.js             (importa todo)
 *   node scripts/import-shopify.js --dry-run   (muestra qué importaría sin hacer nada)
 */

const fs = require("fs");
const path = require("path");
const envFile = path.join(__dirname, "../.env.shopify");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8").split("\n").forEach((line) => {
    const [key, ...val] = line.split("=");
    if (key && val.length) process.env[key.trim()] = val.join("=").trim();
  });
}

const DRY_RUN = process.argv.includes("--dry-run");

const CFG = {
  punto360Url: process.env.PUNTO360_API_URL || "https://punto360-backend-production.up.railway.app",
  punto360Key: process.env.PUNTO360_API_KEY,
  shopifyStore: process.env.SHOPIFY_STORE,
  shopifyToken: process.env.SHOPIFY_TOKEN,
  shopifyLocation: process.env.SHOPIFY_LOCATION,
};

function validate() {
  const missing = ["punto360Key", "shopifyStore", "shopifyToken", "shopifyLocation"]
    .filter((k) => !CFG[k]);
  if (missing.length) {
    console.error("❌ Variables faltantes:", missing.join(", "));
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shopifyHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": CFG.shopifyToken,
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${url}\n${text}`);
  }
  return res.json();
}

// ─── PUNTO360 ─────────────────────────────────────────────────────────────────

async function getPunto360Products() {
  let page = 1;
  const all = [];
  while (true) {
    const data = await fetchJson(
      `${CFG.punto360Url}/public-api/products?api_key=${CFG.punto360Key}&limit=500&page=${page}&include_unpublished=true`
    );
    all.push(...data.data);
    if (page >= data.meta.pages) break;
    page++;
  }
  console.log(`📦 PUNTO360: ${all.length} productos obtenidos`);
  return all;
}

// ─── Shopify: obtener SKUs existentes ─────────────────────────────────────────

/** Devuelve un Map sku -> id de producto en Shopify (el id hace falta para ocultarlo) */
async function getExistingSkus() {
  const skuToProductId = new Map();
  let url = `https://${CFG.shopifyStore}/admin/api/2024-01/products.json?limit=250&fields=id,variants`;

  while (url) {
    const res = await fetch(url, { headers: shopifyHeaders() });
    const linkHeader = res.headers.get("link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
    const data = await res.json();
    for (const p of data.products) {
      for (const v of p.variants) {
        if (v.sku) skuToProductId.set(v.sku, p.id);
      }
    }
    if (url) await sleep(500);
  }

  console.log(`🛍️  Shopify: ${skuToProductId.size} SKUs existentes`);
  return skuToProductId;
}

// ─── Shopify: crear producto ───────────────────────────────────────────────────

async function createShopifyProduct(p) {
  let payload;

  if (!p.has_variants || p.variants.length === 0) {
    // Producto simple
    payload = {
      product: {
        title: p.name,
        tags: p.category ?? "",
        variants: [{
          sku: p.sku,
          price: String(p.price),
          inventory_management: "shopify",
          inventory_policy: "deny",
          barcode: p.barcode ?? "",
        }],
      },
    };
  } else {
    // Producto con variantes — detectar los nombres de atributos
    const attrNames = [];
    for (const v of p.variants) {
      for (const key of Object.keys(v.attributes)) {
        if (!attrNames.includes(key)) attrNames.push(key);
      }
    }

    const variants = p.variants.map((v, i) => {
      const attrValues = attrNames.map((attr) => v.attributes[attr] ?? "");
      return {
        sku: v.sku,
        price: String(v.price),
        inventory_management: "shopify",
        inventory_policy: "deny",
        barcode: v.barcode ?? "",
        ...(attrValues[0] !== undefined && { option1: attrValues[0] }),
        ...(attrValues[1] !== undefined && { option2: attrValues[1] }),
        ...(attrValues[2] !== undefined && { option3: attrValues[2] }),
      };
    });

    payload = {
      product: {
        title: p.name,
        tags: p.category ?? "",
        options: attrNames.slice(0, 3).map((name) => ({ name })),
        variants,
      },
    };
  }

  const data = await fetchJson(
    `https://${CFG.shopifyStore}/admin/api/2024-01/products.json`,
    {
      method: "POST",
      headers: shopifyHeaders(),
      body: JSON.stringify(payload),
    }
  );

  return data.product;
}

// ─── Shopify: establecer stock ────────────────────────────────────────────────

async function setStock(inventoryItemId, quantity) {
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


// ─── Shopify: ocultar producto despublicado ───────────────────────────────────

/**
 * Pone el producto en borrador en vez de borrarlo: deja de venderse pero se
 * conservan fotos, descripciones, SEO e historial de pedidos.
 */
async function draftShopifyProduct(productId) {
  await fetchJson(
    `https://${CFG.shopifyStore}/admin/api/2024-01/products/${productId}.json`,
    {
      method: "PUT",
      headers: shopifyHeaders(),
      body: JSON.stringify({ product: { id: productId, status: "draft" } }),
    }
  );
}

// ─── Importación principal ────────────────────────────────────────────────────

async function importProducts() {
  validate();
  console.log(`\n🚀 Importando productos PUNTO360 → Shopify${DRY_RUN ? " (DRY RUN)" : ""}...\n`);

  const [products, existingSkus] = await Promise.all([
    getPunto360Products(),
    getExistingSkus(),
  ]);

  // La API marca published:false en los que el comercio retiro de la web
  const unpublished = products.filter((p) => p.published === false);
  const publicados = products.filter((p) => p.published !== false);

  // Un producto retirado que ya esta en Shopify debe ocultarse: si solo se deja
  // de enviar, sigue visible y comprable sin stock real detras
  const toHide = unpublished.filter((p) => existingSkus.has(p.sku));
  if (toHide.length) {
    console.log(`
🚫 ${toHide.length} producto(s) retirados de la web — pasando a borrador`);
    for (const p of toHide) {
      const shopifyId = existingSkus.get(p.sku);
      if (DRY_RUN) { console.log(`  ⏸️  ${p.sku}`); continue; }
      try {
        await draftShopifyProduct(shopifyId);
        console.log(`  ⏸️  ${p.sku} ocultado`);
      } catch (e) {
        console.error(`  ❌ ${p.sku}: ${e.message}`);
      }
    }
  }

  // Filtrar los que ya existen (por SKU del producto base o cualquier variante)
  const toImport = publicados.filter((p) => {
    if (p.has_variants) {
      return p.variants.some((v) => !existingSkus.has(v.sku));
    }
    return !existingSkus.has(p.sku);
  });

  console.log(`\n📋 ${toImport.length} productos nuevos para importar (${products.length - toImport.length} ya existen)\n`);

  let created = 0;
  let errors = 0;

  for (const p of toImport) {
    try {
      if (DRY_RUN) {
        const variantInfo = p.has_variants ? ` (${p.variants.length} variantes)` : "";
        console.log(`  📝 ${p.name} [${p.sku}]${variantInfo} — Stock: ${p.stock}`);
        created++;
        continue;
      }

      const shopifyProduct = await createShopifyProduct(p);
      await sleep(500);

      // Establecer stock por variante
      for (const shopifyVariant of shopifyProduct.variants) {
        let stock = 0;

        if (p.has_variants) {
          const match = p.variants.find((v) => v.sku === shopifyVariant.sku);
          stock = match ? match.stock : 0;
        } else {
          stock = p.stock;
        }

        await setStock(shopifyVariant.inventory_item_id, stock);
        await sleep(300);
      }

      const variantInfo = p.has_variants ? ` (${p.variants.length} variantes)` : "";
      console.log(`  ✅ ${p.name}${variantInfo} — Stock: ${p.stock}`);
      created++;

    } catch (err) {
      console.error(`  ❌ ${p.name} [${p.sku}]: ${err.message.split('\n')[0]}`);
      errors++;
      await sleep(1000);
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Resumen de importación
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Importados  : ${created}
  ❌ Errores     : ${errors}
  ⏭️  Ya existían : ${products.length - toImport.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

importProducts().catch((err) => {
  console.error("Error fatal:", err.message);
  process.exit(1);
});
