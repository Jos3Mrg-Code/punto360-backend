import { Injectable, BadRequestException, OnModuleInit, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConsignmentDto } from './dto/create-consignment.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class ConsignmentsService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS consignments (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id       UUID,
        branch_id        UUID,
        user_id          UUID,
        consignor_name   TEXT NOT NULL,
        consignor_phone  TEXT,
        notes            TEXT,
        status           TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at       TIMESTAMP DEFAULT now()
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS consignment_items (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        consignment_id   UUID NOT NULL,
        product_id       UUID,
        variant_id       UUID,
        quantity         DECIMAL(12,3) NOT NULL DEFAULT 0,
        consignor_price  DECIMAL(12,2) NOT NULL DEFAULT 0
      )
    `);
  }

  async getConsignors(user: ActiveUserData) {
    const branchId = user.branchIds?.[0];
    if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

    return this.prisma.$queryRawUnsafe<{ name: string; phone: string | null }[]>(
      `SELECT DISTINCT ON (consignor_name) consignor_name AS name, consignor_phone AS phone
       FROM consignments
       WHERE company_id = $1 AND branch_id = $2
       ORDER BY consignor_name, created_at DESC`,
      user.companyId, branchId,
    );
  }

  async createConsignment(dto: CreateConsignmentDto, user: ActiveUserData) {
    const branchId = user.branchIds?.[0];
    if (!branchId) throw new BadRequestException('Sin sucursal asignada.');
    if (!dto.items?.length) throw new BadRequestException('Agrega al menos un producto.');

    return this.prisma.$transaction(async (tx) => {
      const consignment = await tx.$executeRawUnsafe(
        `INSERT INTO consignments (company_id, branch_id, user_id, consignor_name, consignor_phone, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        user.companyId, branchId, user.sub,
        dto.consignorName, dto.consignorPhone ?? null, dto.notes ?? null,
      );

      // Obtener el id recién creado
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM consignments WHERE company_id = $1 AND branch_id = $2 AND user_id = $3
         ORDER BY created_at DESC LIMIT 1`,
        user.companyId, branchId, user.sub,
      );
      const consignmentId = rows[0].id;

      for (const item of dto.items) {
        await tx.$executeRawUnsafe(
          `INSERT INTO consignment_items (consignment_id, product_id, variant_id, quantity, consignor_price)
           VALUES ($1, $2, $3, $4, $5)`,
          consignmentId, item.productId, item.variantId ?? null,
          item.quantity, item.consignorPrice,
        );

        // Actualizar stock
        if (item.variantId) {
          await tx.variant_stock.upsert({
            where: { variant_id_branch_id: { variant_id: item.variantId, branch_id: branchId } },
            update: { quantity: { increment: item.quantity } },
            create: { variant_id: item.variantId, branch_id: branchId, quantity: item.quantity },
          });
        } else {
          await tx.stock.upsert({
            where: { product_id_branch_id: { product_id: item.productId, branch_id: branchId } },
            update: { quantity: { increment: item.quantity } },
            create: { product_id: item.productId, branch_id: branchId, quantity: item.quantity },
          });
        }

        await tx.inventory_movements.create({
          data: {
            product_id: item.productId,
            branch_id: branchId,
            type: 'IN_CONSIGNMENT',
            quantity: item.quantity,
            reason: `Consignación de ${dto.consignorName}`,
            reference_id: consignmentId,
          },
        });
      }

      return { id: consignmentId };
    }, { timeout: 30000 });
  }

  async getConsignments(user: ActiveUserData) {
    const branchId = user.branchIds?.[0];
    if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

    const consignments = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, json_agg(
         json_build_object(
           'id', ci.id,
           'product_id', ci.product_id,
           'variant_id', ci.variant_id,
           'quantity', ci.quantity,
           'consignor_price', ci.consignor_price
         ) ORDER BY ci.consignor_price
       ) AS items
       FROM consignments c
       LEFT JOIN consignment_items ci ON ci.consignment_id = c.id
       WHERE c.company_id = $1 AND c.branch_id = $2
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT 100`,
      user.companyId, branchId,
    );

    const productIds = [...new Set(
      consignments.flatMap(c => c.items?.map((i: any) => i.product_id).filter(Boolean) ?? [])
    )] as string[];

    const variantIds = [...new Set(
      consignments.flatMap(c => c.items?.map((i: any) => i.variant_id).filter(Boolean) ?? [])
    )] as string[];

    const [products, stockRows, variantStockRows] = await Promise.all([
      productIds.length > 0
        ? this.prisma.products.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, sku: true, unit_type: true },
          })
        : Promise.resolve([]),
      productIds.length > 0
        ? this.prisma.stock.findMany({
            where: { product_id: { in: productIds }, branch_id: branchId },
            select: { product_id: true, quantity: true },
          })
        : Promise.resolve([]),
      variantIds.length > 0
        ? this.prisma.variant_stock.findMany({
            where: { variant_id: { in: variantIds }, branch_id: branchId },
            select: { variant_id: true, quantity: true },
          })
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map(p => [p.id, p] as const));
    const stockMap = new Map(stockRows.map(s => [s.product_id, Number(s.quantity)] as const));
    const variantStockMap = new Map(variantStockRows.map(s => [s.variant_id, Number(s.quantity)] as const));

    return consignments.map(c => ({
      ...c,
      items: (c.items ?? []).map((item: any) => {
        const consignedQty = Number(item.quantity);
        const currentStock: number = item.variant_id
          ? (variantStockMap.get(item.variant_id) ?? 0)
          : (stockMap.get(item.product_id) ?? 0);
        const soldQty = Math.max(0, consignedQty - currentStock);
        return {
          ...item,
          quantity: consignedQty,
          consignor_price: Number(item.consignor_price),
          current_stock: currentStock,
          sold_quantity: soldQty,
          amount_owed: soldQty * Number(item.consignor_price),
          product: item.product_id ? (productMap.get(item.product_id) ?? null) : null,
        };
      }),
    }));
  }

  async cancelConsignment(id: string, user: ActiveUserData) {
    const branchId = user.branchIds?.[0];
    if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, json_agg(json_build_object('product_id', ci.product_id, 'variant_id', ci.variant_id, 'quantity', ci.quantity)) AS items
       FROM consignments c LEFT JOIN consignment_items ci ON ci.consignment_id = c.id
       WHERE c.id = $1 GROUP BY c.id`, id,
    );

    if (!rows.length) throw new NotFoundException('Consignación no encontrada.');
    const consignment = rows[0];
    if (consignment.status === 'CANCELLED') throw new BadRequestException('La consignación ya está anulada.');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE consignments SET status = 'CANCELLED' WHERE id = $1`, id);

      for (const item of consignment.items ?? []) {
        if (!item.product_id) continue;
        const qty = Number(item.quantity);

        if (item.variant_id) {
          await tx.variant_stock.updateMany({
            where: { variant_id: item.variant_id, branch_id: branchId },
            data: { quantity: { decrement: qty } },
          });
        } else {
          await tx.stock.updateMany({
            where: { product_id: item.product_id, branch_id: branchId },
            data: { quantity: { decrement: qty } },
          });
        }

        await tx.inventory_movements.create({
          data: {
            product_id: item.product_id,
            branch_id: branchId,
            type: 'OUT_ADJUSTMENT',
            quantity: qty,
            reason: `Anulación consignación #${id.split('-')[0]}`,
            reference_id: id,
          },
        });
      }

      return { success: true };
    }, { timeout: 15000 });
  }
}
