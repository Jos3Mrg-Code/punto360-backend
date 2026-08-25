import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class PurchasesService {
    constructor(private prisma: PrismaService) {}

    /** Registrar una nueva compra — transacción atómica e integración con caja */
    async createPurchase(dto: CreatePurchaseDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const total = Number(dto.total);
        const paidAmount = Number(dto.paidAmount || 0);

        // Determinar estado de la compra
        let status = 'PAID';
        if (paidAmount === 0) status = 'PENDING';
        else if (paidAmount < total) status = 'PARTIAL';

        // Pre-fetch supplier name fuera de la transacción para evitar timeout
        let supplierName = "";
        if (dto.supplierId && paidAmount > 0) {
            const supplier = await this.prisma.suppliers.findUnique({ where: { id: dto.supplierId }, select: { name: true } });
            if (supplier) supplierName = supplier.name;
        }

        // Pre-fetch stock existente FUERA de la transacción para reducir queries dentro
        const productIds   = dto.items.filter(i => !i.variantId).map(i => i.productId);
        const variantIds   = dto.items.filter(i => i.variantId).map(i => i.variantId!);

        const [existingStocks, existingVariantStocks, activeSession] = await Promise.all([
            productIds.length > 0
                ? this.prisma.stock.findMany({ where: { product_id: { in: productIds }, branch_id: branchId } })
                : Promise.resolve([]),
            variantIds.length > 0
                ? this.prisma.variant_stock.findMany({ where: { variant_id: { in: variantIds }, branch_id: branchId } })
                : Promise.resolve([]),
            (paidAmount > 0 && dto.paymentMethod === 'CASH' && dto.paymentSource !== 'CARTERA' && dto.paymentSource !== 'EXTERNAL')
                ? this.prisma.cash_registers.findFirst({ where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' } })
                : Promise.resolve(null),
        ]);

        const stockMap        = new Map(existingStocks.map(s => [s.product_id, s] as const));
        const variantStockMap = new Map(existingVariantStocks.map(s => [s.variant_id, s] as const));

        return this.prisma.$transaction(async (tx) => {
            // 1. Crear cabecera
            const purchase = await tx.purchases.create({
                data: {
                    supplier_id: dto.supplierId || null,
                    branch_id: branchId,
                    total: total,
                    paid_amount: paidAmount,
                    status: status,
                    due_date: dto.dueDate ? new Date(dto.dueDate) : null,
                },
            });

            const purchaseRef = `Compra #${purchase.id.split('-')[0]}${supplierName ? ` [${supplierName}]` : ''}`;

            // 2. Pago inicial — todo en paralelo
            if (paidAmount > 0) {
                const paymentOps: Promise<any>[] = [
                    tx.purchase_payments.create({
                        data: {
                            purchase_id: purchase.id,
                            user_id: user.sub,
                            amount: paidAmount,
                            payment_method: dto.paymentMethod || 'CASH',
                            notes: dto.paymentSource === 'EXTERNAL' ? 'Pago externo (factura ya cancelada)' : 'Pago inicial en la creación de compra',
                        },
                    }),
                ];

                if (dto.paymentSource === 'CARTERA') {
                    paymentOps.push(tx.cartera_movements.create({
                        data: {
                            company_id: user.companyId,
                            branch_id: branchId,
                            user_id: user.sub,
                            type: 'EXPENSE',
                            amount: paidAmount,
                            reason: `Pago ${purchaseRef}`,
                            reference_id: purchase.id,
                            reference_type: 'PURCHASE',
                        },
                    }));
                } else if (dto.paymentMethod === 'CASH' && activeSession) {
                    paymentOps.push(tx.cash_movements.create({
                        data: {
                            cash_register_id: activeSession.id,
                            user_id: user.sub,
                            type: 'EXPENSE',
                            amount: paidAmount,
                            reason: `Pago ${purchaseRef}`,
                        },
                    }));
                }

                await Promise.all(paymentOps);
            }

            // 3. Ítems bulk insert
            await tx.purchase_items.createMany({
                data: dto.items.map(item => ({
                    purchase_id: purchase.id,
                    product_id: item.productId,
                    quantity: item.quantity,
                    cost: item.cost,
                })),
            });

            // 4. Movimientos de inventario bulk insert
            await tx.inventory_movements.createMany({
                data: dto.items.map(item => ({
                    product_id: item.productId,
                    branch_id: branchId,
                    type: 'IN_PURCHASE',
                    quantity: item.quantity,
                    reason: 'Recepción de Compra',
                    reference_id: purchase.id,
                })),
            });

            // 5. Actualizar stock — todo en paralelo usando upsert
            await Promise.all(dto.items.map(item => {
                if (item.variantId) {
                    const vs = variantStockMap.get(item.variantId);
                    return tx.variant_stock.upsert({
                        where: { variant_id_branch_id: { variant_id: item.variantId, branch_id: branchId } },
                        create: { variant_id: item.variantId, branch_id: branchId, quantity: item.quantity },
                        update: { quantity: Number((vs as any)?.quantity ?? 0) + Number(item.quantity), updated_at: new Date() },
                    });
                } else {
                    const s = stockMap.get(item.productId);
                    return tx.stock.upsert({
                        where: { product_id_branch_id: { product_id: item.productId, branch_id: branchId } },
                        create: { product_id: item.productId, branch_id: branchId, quantity: item.quantity },
                        update: { quantity: Number((s as any)?.quantity ?? 0) + Number(item.quantity) },
                    });
                }
            }));

            // 6. Actualizar costo/precio de productos (solo los que aplican) — en paralelo
            const productUpdates = dto.items
                .filter(i => !i.variantId && (i.cost > 0 || (i.salePrice !== undefined && i.salePrice > 0)))
                .map(i => tx.products.update({
                    where: { id: i.productId },
                    data: {
                        ...(i.cost > 0 && { cost_price: i.cost }),
                        ...(i.salePrice !== undefined && i.salePrice > 0 && { sale_price: i.salePrice }),
                    },
                }));

            if (productUpdates.length > 0) await Promise.all(productUpdates);

            return purchase;
        }, { timeout: 60000 });
    }

    /** Historial de compras con filtros */
    async getPurchases(startDate: string, endDate: string, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const whereClause: any = { branch_id: branchId };
        if (startDate && endDate) {
            const s = new Date(startDate);
            s.setUTCHours(5, 0, 0, 0);
            const e = new Date(endDate);
            e.setUTCDate(e.getUTCDate() + 1);
            e.setUTCHours(4, 59, 59, 999);
            whereClause.created_at = { gte: s, lte: e };
        }

        return this.prisma.purchases.findMany({
            where: whereClause,
            include: {
                suppliers: { select: { name: true } },
                purchase_items: {
                    include: {
                        products: { select: { name: true, sku: true, unit_type: true } },
                    },
                },
                purchase_payments: true,
            },
            orderBy: { created_at: 'desc' },
        });
    }

    /** Obtener deudas a proveedores */
    async getSupplierDebts(user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        return this.prisma.purchases.findMany({
            where: {
                branch_id: branchId,
                status: { in: ['PENDING', 'PARTIAL'] }
            },
            include: {
                suppliers: { select: { name: true, phone: true } },
                purchase_items: {
                    include: {
                        products: { select: { name: true, sku: true, unit_type: true } },
                    },
                },
                purchase_payments: true
            },
            orderBy: { due_date: 'asc' }
        });
    }

    /** Registrar un abono a una compra */
    async addPayment(purchaseId: string, amount: number, method: string, paymentSource: string, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        const purchase = await this.prisma.purchases.findUnique({
            where: { id: purchaseId },
            include: {
                purchase_payments: true,
                suppliers: { select: { name: true } }
            }
        });

        if (!purchase) throw new NotFoundException('Compra no encontrada');

        const total = Number(purchase.total);
        const currentPaid = Number(purchase.paid_amount || 0);
        const newPaid = currentPaid + Number(amount);

        if (newPaid > total) throw new BadRequestException('El abono supera el saldo pendiente');

        let status = 'PARTIAL';
        if (newPaid === total) status = 'PAID';

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchases.update({
                where: { id: purchaseId },
                data: { paid_amount: newPaid, status: status }
            });

            await tx.purchase_payments.create({
                data: {
                    purchase_id: purchaseId,
                    user_id: user.sub,
                    amount: amount,
                    payment_method: method,
                    notes: 'Abono manual a deuda'
                }
            });

            const purchaseRef = `Abono a deuda Compra #${purchaseId.split('-')[0]}${purchase.suppliers?.name ? ` [${purchase.suppliers.name}]` : ''}`;

            if (paymentSource === 'CARTERA') {
                await tx.cartera_movements.create({
                    data: {
                        company_id: user.companyId,
                        branch_id: branchId,
                        user_id: user.sub,
                        type: 'EXPENSE',
                        amount: amount,
                        reason: purchaseRef,
                        reference_id: purchaseId,
                        reference_type: 'PURCHASE',
                    },
                });
            } else if (method === 'CASH') {
                const activeSession = await tx.cash_registers.findFirst({
                    where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' }
                });

                if (activeSession) {
                    await tx.cash_movements.create({
                        data: {
                            cash_register_id: activeSession.id,
                            user_id: user.sub,
                            type: 'EXPENSE',
                            amount: amount,
                            reason: purchaseRef,
                        }
                    });
                }
            }

            return updated;
        }, { timeout: 30000 });
    }

    /** Anular una compra: revierte stock, pagos en caja y cartera */
    async cancelPurchase(purchaseId: string, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const purchase = await this.prisma.purchases.findUnique({
            where: { id: purchaseId },
            include: { purchase_items: true },
        });

        if (!purchase) throw new NotFoundException('Compra no encontrada.');
        if (purchase.status === 'CANCELLED') throw new BadRequestException('La compra ya está anulada.');
        if (purchase.branch_id !== branchId) throw new ForbiddenException('Sin acceso a esta compra.');

        // Calcular cuánto fue pagado por cartera vs caja
        const carteraMovements = await this.prisma.cartera_movements.findMany({
            where: { reference_id: purchaseId, reference_type: 'PURCHASE', type: 'EXPENSE' },
        });
        const totalCartera = carteraMovements.reduce((sum, m) => sum + Number(m.amount), 0);
        const totalPaid = Number(purchase.paid_amount);
        const cashPaid = Math.max(0, totalPaid - totalCartera);

        const purchaseRef = `Anulación compra #${purchaseId.split('-')[0]}`;

        return this.prisma.$transaction(async (tx) => {
            // 1. Marcar como anulada
            await tx.purchases.update({ where: { id: purchaseId }, data: { status: 'CANCELLED' } });

            // 2. Revertir stock de cada ítem
            for (const item of purchase.purchase_items) {
                if (!item.product_id) continue;
                const qty = Number(item.quantity);

                const existing = await tx.stock.findFirst({
                    where: { product_id: item.product_id, branch_id: branchId },
                });
                if (existing) {
                    await tx.stock.update({
                        where: { id: existing.id },
                        data: { quantity: { decrement: qty } },
                    });
                }

                await tx.inventory_movements.create({
                    data: {
                        product_id: item.product_id,
                        branch_id: branchId,
                        type: 'OUT_ADJUSTMENT',
                        quantity: qty,
                        reason: purchaseRef,
                        reference_id: purchaseId,
                    },
                });
            }

            // 3. Revertir pagos de cartera
            if (totalCartera > 0) {
                await tx.cartera_movements.create({
                    data: {
                        company_id: user.companyId,
                        branch_id: branchId,
                        user_id: user.sub,
                        type: 'INCOME',
                        amount: totalCartera,
                        reason: purchaseRef,
                        reference_id: purchaseId,
                        reference_type: 'PURCHASE',
                    },
                });
            }

            // 4. Revertir pagos de caja
            if (cashPaid > 0) {
                const openCaja = await tx.cash_registers.findFirst({
                    where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
                });
                if (openCaja) {
                    await tx.cash_movements.create({
                        data: {
                            cash_register_id: openCaja.id,
                            user_id: user.sub,
                            type: 'INCOME',
                            amount: cashPaid,
                            reason: purchaseRef,
                        },
                    });
                }
            }

            return { success: true };
        }, { timeout: 30000 });
    }
}
