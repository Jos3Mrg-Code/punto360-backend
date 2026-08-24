import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyClient, shopifyConfigFromCompany, ShopifyConfig } from './shopify.client';

type QueueRow = {
  id: string;
  company_id: string;
  product_id: string;
  action: string;
  attempts: number;
};

@Injectable()
export class ShopifySyncService {
  private readonly logger = new Logger(ShopifySyncService.name);

  constructor(
    private prisma: PrismaService,
    private shopify: ShopifyClient,
  ) {}

  /** Carga la config Shopify de UNA empresa desde la DB */
  async getCompanyConfig(companyId: string): Promise<ShopifyConfig | null> {
    const c = await this.prisma.companies.findUnique({
      where: { id: companyId },
      select: { id: true, shopify_store: true, shopify_token: true, shopify_location_id: true },
    });
    return c ? shopifyConfigFromCompany(c) : null;
  }

  /** Devuelve las configs de todas las empresas con Shopify vinculado */
  async getAllConfigs(): Promise<ShopifyConfig[]> {
    const companies = await this.prisma.companies.findMany({
      where: {
        shopify_store: { not: null },
        shopify_token: { not: null },
        shopify_location_id: { not: null },
      },
      select: { id: true, shopify_store: true, shopify_token: true, shopify_location_id: true },
    });
    return companies
      .map((c) => shopifyConfigFromCompany(c))
      .filter((c): c is ShopifyConfig => c !== null);
  }

  /**
   * Encola la publicación o retirada de productos.
   * Se encola en vez de llamar a Shopify aquí porque un producto de 18
   * variantes son 19 peticiones: publicar 50 productos tardaría minutos y
   * el request del usuario moriría por timeout.
   */
  async enqueue(companyId: string, productIds: string[], action: 'PUBLISH' | 'UNPUBLISH') {
    if (!productIds.length) return;
    // Solo se encola si la empresa tiene Shopify vinculado; evita cola inútil
    const cfg = await this.getCompanyConfig(companyId);
    if (!cfg) return;

    // Una alta y una baja del mismo producto se anulan: gana la última encolada
    const opposite = action === 'PUBLISH' ? 'UNPUBLISH' : 'PUBLISH';
    await this.prisma.$executeRaw`
      DELETE FROM shopify_sync_queue
      WHERE product_id = ANY(${productIds}::uuid[])
        AND action = ${opposite}
        AND status = 'PENDING'
    `;

    for (const productId of productIds) {
      await this.prisma.$executeRaw`
        INSERT INTO shopify_sync_queue (company_id, product_id, action, status, next_retry_at)
        VALUES (${companyId}::uuid, ${productId}::uuid, ${action}, 'PENDING', CURRENT_TIMESTAMP)
        ON CONFLICT DO NOTHING
      `;
    }
  }

  /** Toma tareas pendientes cuyo reintento ya venció */
  async takePending(limit: number): Promise<QueueRow[]> {
    return this.prisma.$queryRaw<QueueRow[]>`
      SELECT id, company_id, product_id, action, attempts
      FROM shopify_sync_queue
      WHERE status = 'PENDING'
        AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
  }

  async processOne(job: QueueRow) {
    const cfg = await this.getCompanyConfig(job.company_id);
    if (!cfg) return;

    try {
      if (job.action === 'PUBLISH') {
        await this.publishProduct(cfg, job.product_id);
      } else {
        await this.unpublishProduct(cfg, job.product_id);
      }

      await this.prisma.$executeRaw`
        UPDATE shopify_sync_queue
        SET status = 'DONE', updated_at = CURRENT_TIMESTAMP
        WHERE id = ${job.id}::uuid
      `;
    } catch (e: any) {
      const attempts = job.attempts + 1;
      // Espera creciente: 1, 4, 9, 16 y 25 minutos. Tras 5 intentos se marca fallido
      const delayMin = attempts * attempts;
      const status = attempts >= 5 ? 'FAILED' : 'PENDING';
      // Los errores de Prisma vienen multilínea y dejaban el log vacío
      const detail = String(e?.message ?? e).replace(/\s+/g, ' ').trim().slice(0, 500);

      await this.prisma.$executeRaw`
        UPDATE shopify_sync_queue
        SET attempts = ${attempts},
            status = ${status},
            last_error = ${detail},
            next_retry_at = CURRENT_TIMESTAMP + (${delayMin} * INTERVAL '1 minute'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${job.id}::uuid
      `;
      this.logger.error(`Sync ${job.action} producto ${job.product_id}: ${detail}`);
    }
  }

  /** Crea el producto en Shopify con sus variantes y el stock de cada una */
  private async publishProduct(cfg: ShopifyConfig, productId: string) {
    const p = await this.loadProduct(productId);
    if (!p) return;

    const index = await this.shopify.getVariantIndex(cfg);

    // Si alguna variante ya existe, el producto está en Shopify: basta reactivarlo
    const skus = p.has_variants ? p.variants.map((v) => v.sku) : [p.sku];
    const known = skus.find((s) => index.has(s));
    if (known) {
      await this.shopify.setProductStatus(cfg, index.get(known)!.productId, 'active');
      await this.syncStockOf(cfg, p, index);
      return;
    }

    const created: any = await this.shopify.request(cfg, 'products.json', {
      method: 'POST',
      body: this.buildPayload(p),
    });

    // El stock va variante por variante: es lo único que Shopify no acepta al crear
    for (const sv of created.product?.variants ?? []) {
      if (!sv.inventory_item_id) continue;
      const match = p.has_variants
        ? p.variants.find((v) => v.sku === sv.sku)
        : { stock: p.stock };
      await this.shopify.setInventory(cfg, sv.inventory_item_id, match?.stock ?? 0);
    }
  }

  /** Pasa el producto a borrador: conserva fotos, SEO e historial de pedidos */
  private async unpublishProduct(cfg: ShopifyConfig, productId: string) {
    const p = await this.loadProduct(productId, true);
    if (!p) return;

    const index = await this.shopify.getVariantIndex(cfg);
    const skus = p.has_variants ? p.variants.map((v) => v.sku) : [p.sku];
    const found = skus.find((s) => index.has(s));
    if (!found) return;

    await this.shopify.setProductStatus(cfg, index.get(found)!.productId, 'draft');
  }

  /** Actualiza en Shopify el stock de cada variante publicada */
  async syncStock(cfg: ShopifyConfig) {
    const products = await this.prisma.products.findMany({
      where: { company_id: cfg.companyId, is_active: true, is_published: true },
      select: { id: true },
    });
    if (!products.length) return { checked: 0, updated: 0 };

    const index = await this.shopify.getVariantIndex(cfg);
    let updated = 0;

    for (const { id } of products) {
      const p = await this.loadProduct(id);
      if (p) updated += await this.syncStockOf(cfg, p, index);
    }

    return { checked: products.length, updated };
  }

  private async syncStockOf(cfg: ShopifyConfig, p: any, index: Map<string, any>) {
    let n = 0;
    const rows = p.has_variants
      ? p.variants.map((v: any) => ({ sku: v.sku, stock: v.stock }))
      : [{ sku: p.sku, stock: p.stock }];

    for (const r of rows) {
      const entry = index.get(r.sku);
      if (!entry) continue;
      await this.shopify.setInventory(cfg, entry.inventoryItemId, r.stock);
      n++;
    }
    return n;
  }

  /** Producto con el stock resuelto por variante (talla y color) */
  private async loadProduct(productId: string, allowUnpublished = false) {
    const p = await this.prisma.products.findFirst({
      where: {
        id: productId,
        is_active: true,
        ...(allowUnpublished ? {} : { is_published: true }),
      },
      include: {
        categories: { select: { name: true } },
        stock: true,
        product_variants: {
          where: { is_active: true },
          include: {
            stock: true,
            values: {
              include: {
                attribute_value: { include: { attribute: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!p) return null;

    const sum = (arr: any[]) => arr.reduce((s, x) => s + Number(x.quantity), 0);

    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      price: Number(p.sale_price),
      category: p.categories?.name ?? '',
      has_variants: p.has_variants,
      stock: sum(p.stock),
      variants: p.product_variants.map((v) => {
        const attributes: Record<string, string> = {};
        for (const val of v.values) {
          attributes[val.attribute_value.attribute.name] = val.attribute_value.value;
        }
        return {
          sku: v.sku,
          barcode: v.barcode,
          price: Number(v.sale_price),
          stock: sum(v.stock),
          attributes,
        };
      }),
    };
  }

  private buildPayload(p: any) {
    if (!p.has_variants) {
      return {
        product: {
          title: p.name,
          tags: p.category,
          variants: [
            {
              sku: p.sku,
              price: String(p.price),
              barcode: p.barcode ?? '',
              inventory_management: 'shopify',
              inventory_policy: 'deny',
            },
          ],
        },
      };
    }

    // Los nombres de atributo salen de las variantes: COLOR y TALLA se vuelven
    // opciones de Shopify, que admite un máximo de tres
    const attrNames: string[] = [];
    for (const v of p.variants) {
      for (const key of Object.keys(v.attributes)) {
        if (!attrNames.includes(key)) attrNames.push(key);
      }
    }

    return {
      product: {
        title: p.name,
        tags: p.category,
        options: attrNames.slice(0, 3).map((name) => ({ name })),
        variants: p.variants.map((v: any) => {
          const vals = attrNames.map((a) => v.attributes[a] ?? '');
          return {
            sku: v.sku,
            price: String(v.price),
            barcode: v.barcode ?? '',
            inventory_management: 'shopify',
            inventory_policy: 'deny',
            ...(vals[0] !== undefined && { option1: vals[0] }),
            ...(vals[1] !== undefined && { option2: vals[1] }),
            ...(vals[2] !== undefined && { option3: vals[2] }),
          };
        }),
      },
    };
  }
}
