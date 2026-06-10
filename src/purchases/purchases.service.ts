import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
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

        return this.prisma.$transaction(async (tx) => {
            // 1. Crear cabecera de la compra con información de pago
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

            // 2. Si hubo un pago inicial, registrarlo en el historial de pagos
            if (paidAmount > 0) {
                await tx.purchase_payments.create({
                    data: {
                        purchase_id: purchase.id,
                        user_id: user.sub,
                        amount: paidAmount,
                        payment_method: dto.paymentMethod || 'CASH',
                        notes: 'Pago inicial en la creación de compra',
                    },
                });

                const purchaseRef = `Compra #${purchase.id.split('-')[0]}${supplierName ? ` [${supplierName}]` : ''}`;

                if (dto.paymentSource === 'CARTERA') {
                    await tx.cartera_movements.create({
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
                    });
                } else if (dto.paymentMethod === 'CASH') {
                    const activeSession = await tx.cash_registers.findFirst({
                        where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' }
                    });
                    if (activeSession) {
                        await tx.cash_movements.create({
                            data: {
                                cash_register_id: activeSession.id,
                                user_id: user.sub,
                                type: 'EXPENSE',
                                amount: paidAmount,
                                reason: `Pago ${purchaseRef}`,
                            }
                        });
                    }
                }
            }

            // 3. Registrar ítems y actualizar stock
            for (const item of dto.items) {
                await tx.purchase_items.create({
                    data: {
                        purchase_id: purchase.id,
                        product_id: item.productId,
                        quantity: item.quantity,
                        cost: item.cost,
                    },
                });

                // Aumentar stock (variante o normal)
                if (item.variantId) {
                    const existingVs = await tx.variant_stock.findUnique({
                        where: { variant_id_branch_id: { variant_id: item.variantId, branch_id: branchId } },
                    });
                    if (existingVs) {
                        await tx.variant_stock.update({
                            where: { id: existingVs.id },
                            data: { quantity: Number(existingVs.quantity) + Number(item.quantity), updated_at: new Date() },
                        });
                    } else {
                        await tx.variant_stock.create({
                            data: { variant_id: item.variantId, branch_id: branchId, quantity: item.quantity },
                        });
                    }
                } else {
                    const existing = await tx.stock.findFirst({
                        where: { product_id: item.productId, branch_id: branchId },
                    });
                    if (existing) {
                        await tx.stock.update({
                            where: { id: existing.id },
                            data: { quantity: Number(existing.quantity) + Number(item.quantity) },
                        });
                    } else {
                        await tx.stock.create({
                            data: { product_id: item.productId, branch_id: branchId, quantity: item.quantity },
                        });
                    }
                }

                // Actualizar costo y precio de venta del producto (solo si no es variante)
                if (!item.variantId && (item.cost > 0 || (item.salePrice !== undefined && item.salePrice > 0))) {
                    await tx.products.update({
                        where: { id: item.productId },
                        data: {
                            ...(item.cost > 0 && { cost_price: item.cost }),
                            ...(item.salePrice !== undefined && item.salePrice > 0 && { sale_price: item.salePrice }),
                        },
                    });
                }

                // Movimiento de inventario
                await tx.inventory_movements.create({
                    data: {
                        product_id: item.productId,
                        branch_id: branchId,
                        type: 'IN_PURCHASE',
                        quantity: item.quantity,
                        reason: 'Recepción de Compra',
                        reference_id: purchase.id,
                    },
                });
            }

            return purchase;
        }, { timeout: 30000 });
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
}
