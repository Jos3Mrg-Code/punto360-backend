import { Injectable, Logger } from '@nestjs/common';

/** Credenciales de la tienda; vienen de variables de entorno */
export interface ShopifyConfig {
  store: string;
  token: string;
  locationId: string;
  companyId: string;
}

export function loadShopifyConfig(): ShopifyConfig | null {
  const store = process.env.SHOPIFY_STORE;
  const token = process.env.SHOPIFY_TOKEN;
  const locationId = process.env.SHOPIFY_LOCATION;
  const companyId = process.env.SHOPIFY_COMPANY_ID;

  if (!store || !token || !locationId || !companyId) return null;
  return { store, token, locationId, companyId };
}

const API_VERSION = '2024-01';

@Injectable()
export class ShopifyClient {
  private readonly logger = new Logger(ShopifyClient.name);

  /**
   * Shopify admite ~2 peticiones por segundo. Espaciar las llamadas es más
   * simple y predecible que reaccionar a los 429, y evita que una publicación
   * masiva agote el cupo compartido de la tienda.
   */
  private lastCall = 0;
  private async throttle() {
    const MIN_GAP_MS = 550;
    const waited = Date.now() - this.lastCall;
    if (waited < MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, MIN_GAP_MS - waited));
    }
    this.lastCall = Date.now();
  }

  async request<T = any>(
    cfg: ShopifyConfig,
    path: string,
    init: { method?: string; body?: any } = {},
  ): Promise<T> {
    await this.throttle();

    const res = await fetch(`https://${cfg.store}/admin/api/${API_VERSION}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'X-Shopify-Access-Token': cfg.token,
        'Content-Type': 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (res.status === 429) {
      // Cupo agotado pese al espaciado: se respeta el Retry-After y se reintenta una vez
      const retryAfter = Number(res.headers.get('retry-after') ?? 2);
      this.logger.warn(`Shopify 429, esperando ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request<T>(cfg, path, init);
    }

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Shopify ${res.status} en ${path}: ${detail.slice(0, 300)}`);
    }

    return res.json() as Promise<T>;
  }

  /** Devuelve un Map sku -> { productId, inventoryItemId } de toda la tienda */
  async getVariantIndex(cfg: ShopifyConfig) {
    const index = new Map<string, { productId: number; inventoryItemId: number }>();
    let path: string | null = `products.json?limit=250&fields=id,variants`;

    while (path) {
      await this.throttle();
      const res = await fetch(`https://${cfg.store}/admin/api/${API_VERSION}/${path}`, {
        headers: { 'X-Shopify-Access-Token': cfg.token, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`Shopify ${res.status} listando productos`);

      const data: any = await res.json();
      for (const p of data.products ?? []) {
        for (const v of p.variants ?? []) {
          if (v.sku) index.set(v.sku, { productId: p.id, inventoryItemId: v.inventory_item_id });
        }
      }

      const link = res.headers.get('link') ?? '';
      const next = link.match(/<[^>]*\/admin\/api\/[^>]*\/([^>]+)>;\s*rel="next"/);
      path = next ? next[1] : null;
    }

    return index;
  }

  async setInventory(cfg: ShopifyConfig, inventoryItemId: number, quantity: number) {
    await this.request(cfg, 'inventory_levels/set.json', {
      method: 'POST',
      body: {
        location_id: Number(cfg.locationId),
        inventory_item_id: inventoryItemId,
        available: Math.max(0, Math.round(quantity)),
      },
    });
  }

  async setProductStatus(cfg: ShopifyConfig, productId: number, status: 'active' | 'draft') {
    await this.request(cfg, `products/${productId}.json`, {
      method: 'PUT',
      body: { product: { id: productId, status } },
    });
  }
}
