import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class ExchangesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS exchanges (
        id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id            UUID,
        branch_id             UUID,
        user_id               UUID,
        returned_product_id   UUID,
        returned_variant_id   UUID,
        returned_product_name TEXT,
        returned_quantity     DECIMAL(12,3) NOT NULL DEFAULT 1,
        returned_price        DECIMAL(12,2) NOT NULL DEFAULT 0,
        new_product_id        UUID,
        new_variant_id        UUID,
        new_quantity          DECIMAL(12,3) NOT NULL DEFAULT 1,
        new_price             DECIMAL(12,2) NOT NULL DEFAULT 0,
        difference            DECIMAL(12,2) NOT NULL DEFAULT 0,
        payment_method        TEXT,
        notes                 TEXT,
        created_at            TIMESTAMP DEFAULT now()
      )
    `);
    // Add column if table existed before this field was introduced
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS returned_product_name TEXT`
    );
  }

  async createExchange(dto: CreateExchangeDto, user: ActiveUserData) {
    const branchId = user.branchIds?.[0];
    if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

    return this.prisma.$transaction(async (tx) => {
      // ── Stock del producto devuelto (solo si existe en el sistema) ────────────
      if (!dto.isExternalReturn && dto.returnedProductId) {
        if (dto.returnedVariantId) {
          await tx.variant_stock.upsert({
            where: { variant_id_branch_id: { variant_id: dto.returnedVariantId, branch_id: branchId } },
            update: { quantity: { increment: dto.returnedQuantity } },
            create: { variant_id: dto.returnedVariantId, branch_id: branchId, quantity: dto.returnedQuantity },
          });
        } else {
          await tx.stock.upsert({
            where: { product_id_branch_id: { product_id: dto.returnedProductId, branch_id: branchId } },
            update: { quantity: { increment: dto.returnedQuantity } },
            create: { product_id: dto.returnedProductId, branch_id: branchId, quantity: dto.returnedQuantity },
          });
        }
      }

      // ── Stock del producto nuevo ──────────────────────────────────────────────
      if (dto.newVariantId) {
        const vs = await tx.variant_stock.findUnique({
          where: { variant_id_branch_id: { variant_id: dto.newVariantId, branch_id: branchId } },
        });
        if (!vs || Number(vs.quantity) < dto.newQuantity) {
          throw new BadRequestException('Stock insuficiente para el producto nuevo.');
        }
        await tx.variant_stock.update({
          where: { variant_id_branch_id: { variant_id: dto.newVariantId, branch_id: branchId } },
          data: { quantity: { decrement: dto.newQuantity } },
        });
      } else {
        const s = await tx.stock.findUnique({
          where: { product_id_branch_id: { product_id: dto.newProductId, branch_id: branchId } },
        });
        if (!s || Number(s.quantity) < dto.newQuantity) {
          throw new BadRequestException('Stock insuficiente para el producto nuevo.');
        }
        await tx.stock.update({
          where: { product_id_branch_id: { product_id: dto.newProductId, branch_id: branchId } },
          data: { quantity: { decrement: dto.newQuantity } },
        });
      }

      const difference = dto.newPrice - dto.returnedPrice;

      // ── Registrar movimiento en caja abierta ─────────────────────────────────
      if (difference !== 0) {
        const openCaja = await tx.cash_registers.findFirst({
          where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
          select: { id: true },
        });
        if (openCaja) {
          const retName = dto.isExternalReturn
            ? (dto.returnedProductName ?? 'Producto externo')
            : 'producto';
          await tx.cash_movements.create({
            data: {
              cash_register_id: openCaja.id,
              user_id: user.sub,
              type: difference > 0 ? 'INCOME' : 'EXPENSE',
              amount: Math.abs(difference),
              reason: difference > 0
                ? `Diferencia cambio - ${retName}`
                : `Devolución cambio - ${retName}`,
            },
          });
        }
      }

      // ── Crear registro de cambio ──────────────────────────────────────────────
      return tx.exchanges.create({
        data: {
          company_id: user.companyId,
          branch_id: branchId,
          user_id: user.sub,
          returned_product_id: dto.returnedProductId ?? null,
          returned_variant_id: dto.returnedVariantId ?? null,
          returned_product_name: dto.returnedProductName ?? null,
          returned_quantity: dto.returnedQuantity,
          returned_price: dto.returnedPrice,
          new_product_id: dto.newProductId,
          new_variant_id: dto.newVariantId ?? null,
          new_quantity: dto.newQuantity,
          new_price: dto.newPrice,
          difference,
          payment_method: dto.paymentMethod ?? null,
          notes: dto.notes ?? null,
        },
      });
    });
  }

  async getExchanges(user: ActiveUserData) {
    const branchId = user.branchIds?.[0];
    if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

    const exchanges = await this.prisma.exchanges.findMany({
      where: { company_id: user.companyId, branch_id: branchId },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    const productIds = [...new Set([
      ...exchanges.map(e => e.returned_product_id),
      ...exchanges.map(e => e.new_product_id),
    ].filter(Boolean) as string[])];

    const variantIds = [...new Set([
      ...exchanges.map(e => e.returned_variant_id),
      ...exchanges.map(e => e.new_variant_id),
    ].filter(Boolean) as string[])];

    const userIds = [...new Set(exchanges.map(e => e.user_id).filter(Boolean) as string[])];

    const [products, variants, users] = await Promise.all([
      productIds.length > 0
        ? this.prisma.products.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true } })
        : Promise.resolve([]),
      variantIds.length > 0
        ? this.prisma.product_variants.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, sku: true, values: { include: { attribute_value: { select: { value: true } } } } },
          })
        : Promise.resolve([]),
      userIds.length > 0
        ? this.prisma.users.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map(p => [p.id, p] as const));
    const variantMap = new Map(
      variants.map(v => [
        v.id,
        { id: v.id, sku: v.sku, label: v.values.map(vv => vv.attribute_value.value).join(' / ') },
      ] as const),
    );
    const userMap = new Map(users.map(u => [u.id, u] as const));

    return exchanges.map(e => ({
      ...e,
      returnedProduct: e.returned_product_id ? (productMap.get(e.returned_product_id) ?? null) : null,
      returnedProductName: e.returned_product_name ?? null,
      returnedVariant: e.returned_variant_id ? (variantMap.get(e.returned_variant_id) ?? null) : null,
      newProduct: e.new_product_id ? (productMap.get(e.new_product_id) ?? null) : null,
      newVariant: e.new_variant_id ? (variantMap.get(e.new_variant_id) ?? null) : null,
      cashier: e.user_id ? (userMap.get(e.user_id) ?? null) : null,
    }));
  }
}
