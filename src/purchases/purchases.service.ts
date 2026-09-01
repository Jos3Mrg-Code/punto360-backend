import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { CreatePayableDto, UpdatePayableDto } from './dto/create-payable.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

const purchaseStatus = (total: number, paid: number): string => {
    if (paid <= 0) return 'PENDING';
    if (paid >= total) return 'PAID';
    return 'PARTIAL';
};

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

        // Pago con saldo a favor del proveedor
        if (dto.paymentSource === 'CREDIT') {
            if (!dto.supplierId) throw new BadRequestException('Para pagar con saldo a favor debes seleccionar un proveedor.');
            if (paidAmount <= 0) throw new BadRequestException('El monto a aplicar del saldo a favor debe ser mayor a 0.');
            const available = await this.getCreditBalance(dto.supplierId);
            if (paidAmount > available + 0.001) {
                throw new BadRequestException(`El saldo a favor disponible es ${available.toFixed(0)}.`);
            }
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
            (paidAmount > 0 && dto.paymentMethod === 'CASH' && dto.paymentSource !== 'CARTERA' && dto.paymentSource !== 'EXTERNAL' && dto.paymentSource !== 'CREDIT')
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
                const paymentNotes =
                    dto.paymentSource === 'EXTERNAL' ? 'Pago externo (factura ya cancelada)'
                    : dto.paymentSource === 'CREDIT' ? 'Pago con saldo a favor del proveedor'
                    : 'Pago inicial en la creación de compra';

                const paymentOps: Promise<any>[] = [
                    tx.purchase_payments.create({
                        data: {
                            purchase_id: purchase.id,
                            user_id: user.sub,
                            amount: paidAmount,
                            payment_method: dto.paymentSource === 'CREDIT' ? 'CREDIT' : (dto.paymentMethod || 'CASH'),
                            notes: paymentNotes,
                        },
                    }),
                ];

                if (dto.paymentSource === 'CREDIT') {
                    paymentOps.push(tx.supplier_credits.create({
                        data: {
                            company_id: user.companyId,
                            supplier_id: dto.supplierId!,
                            branch_id: branchId,
                            user_id: user.sub,
                            type: 'DEBIT',
                            amount: paidAmount,
                            reason: `Saldo a favor aplicado a ${purchaseRef}`,
                            reference_id: purchase.id,
                            reference_type: 'PURCHASE_APPLY',
                        },
                    }));
                } else if (dto.paymentSource === 'CARTERA') {
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
                    variant_id: item.variantId || null,
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

    /**
     * Editar una compra existente (solo ADMIN / permiso purchases.edit).
     * Recalcula el stock por diferencia, actualiza el catálogo (nombre, costo, precio)
     * y recalcula total/estado. El pago existente no se toca: si el nuevo total queda
     * por debajo de lo pagado, el excedente queda como saldo a favor del proveedor.
     */
    async updatePurchase(purchaseId: string, dto: UpdatePurchaseDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const purchase = await this.prisma.purchases.findUnique({
            where: { id: purchaseId },
            include: {
                purchase_items: true,
                branches: { select: { company_id: true } },
            },
        });

        if (!purchase) throw new NotFoundException('Compra no encontrada.');
        if (purchase.branch_id !== branchId || purchase.branches?.company_id !== user.companyId) {
            throw new ForbiddenException('Sin acceso a esta compra.');
        }
        if (purchase.status === 'CANCELLED') {
            throw new BadRequestException('No se puede editar una compra anulada.');
        }
        if (!purchase.affects_inventory) {
            throw new BadRequestException('Esta es una factura por pagar; edítala con el endpoint de facturas por pagar.');
        }

        // Validar que productos y variantes pertenezcan a la empresa
        const productIds = [...new Set(dto.items.map(i => i.productId))];
        const products = await this.prisma.products.findMany({
            where: { id: { in: productIds }, company_id: user.companyId },
            select: { id: true, name: true },
        });
        if (products.length !== productIds.length) {
            throw new BadRequestException('Uno o más productos no existen.');
        }

        const variantIds = [...new Set(dto.items.filter(i => i.variantId).map(i => i.variantId!))];
        if (variantIds.length > 0) {
            const variants = await this.prisma.product_variants.findMany({
                where: { id: { in: variantIds }, products: { company_id: user.companyId } },
                select: { id: true, product_id: true },
            });
            if (variants.length !== variantIds.length) {
                throw new BadRequestException('Una o más variantes no existen.');
            }
            const vmap = new Map(variants.map(v => [v.id, v.product_id]));
            for (const it of dto.items) {
                if (it.variantId && vmap.get(it.variantId) !== it.productId) {
                    throw new BadRequestException('Una variante no corresponde a su producto.');
                }
            }
        }

        // Diferencia neta de stock por clave (variante o producto)
        type Delta = { productId: string; variantId: string | null; qty: number };
        const delta = new Map<string, Delta>();
        const keyOf = (pid: string, vid: string | null) => (vid ? `v:${vid}` : `p:${pid}`);
        const bump = (pid: string, vid: string | null, q: number) => {
            const k = keyOf(pid, vid);
            const cur = delta.get(k) ?? { productId: pid, variantId: vid, qty: 0 };
            cur.qty += q;
            delta.set(k, cur);
        };
        for (const old of purchase.purchase_items) {
            if (!old.product_id) continue;
            bump(old.product_id, old.variant_id ?? null, -Number(old.quantity ?? 0));
        }
        for (const it of dto.items) {
            bump(it.productId, it.variantId ?? null, Number(it.quantity));
        }

        const newTotal = dto.items.reduce((s, i) => s + Number(i.quantity) * Number(i.cost), 0);
        const paidAmount = Number(purchase.paid_amount ?? 0);
        let status: string;
        if (paidAmount <= 0) status = 'PENDING';
        else if (paidAmount >= newTotal) status = 'PAID';
        else status = 'PARTIAL';

        const ref = `Edición compra #${purchaseId.split('-')[0]}`;
        const productNameById = new Map(products.map(p => [p.id, p.name]));

        return this.prisma.$transaction(async (tx) => {
            // 1. Ajustar stock por diferencia
            for (const d of delta.values()) {
                if (d.qty === 0) continue;

                if (d.variantId) {
                    const vs = await tx.variant_stock.findFirst({
                        where: { variant_id: d.variantId, branch_id: branchId },
                    });
                    if (vs) {
                        await tx.variant_stock.update({
                            where: { id: vs.id },
                            data: { quantity: { increment: d.qty }, updated_at: new Date() },
                        });
                    } else {
                        await tx.variant_stock.create({
                            data: { variant_id: d.variantId, branch_id: branchId, quantity: d.qty },
                        });
                    }
                } else {
                    const s = await tx.stock.findFirst({
                        where: { product_id: d.productId, branch_id: branchId },
                    });
                    if (s) {
                        await tx.stock.update({
                            where: { id: s.id },
                            data: { quantity: { increment: d.qty } },
                        });
                    } else {
                        await tx.stock.create({
                            data: { product_id: d.productId, branch_id: branchId, quantity: d.qty },
                        });
                    }
                }

                await tx.inventory_movements.create({
                    data: {
                        product_id: d.productId,
                        branch_id: branchId,
                        type: d.qty > 0 ? 'IN_PURCHASE' : 'OUT_ADJUSTMENT',
                        quantity: Math.abs(d.qty),
                        reason: ref,
                        reference_id: purchaseId,
                    },
                });
            }

            // 2. Reemplazar líneas
            await tx.purchase_items.deleteMany({ where: { purchase_id: purchaseId } });
            await tx.purchase_items.createMany({
                data: dto.items.map(i => ({
                    purchase_id: purchaseId,
                    product_id: i.productId,
                    variant_id: i.variantId || null,
                    quantity: i.quantity,
                    cost: i.cost,
                })),
            });

            // 3. Actualizar catálogo: nombre del producto, costo y precio de venta
            const renamed = new Set<string>();
            for (const i of dto.items) {
                if (i.productName?.trim() && !renamed.has(i.productId)) {
                    renamed.add(i.productId);
                    if (i.productName.trim() !== productNameById.get(i.productId)) {
                        await tx.products.update({
                            where: { id: i.productId },
                            data: { name: i.productName.trim() },
                        });
                    }
                }

                const priceData: { cost_price?: number; sale_price?: number } = {};
                if (i.cost > 0) priceData.cost_price = i.cost;
                if (i.salePrice !== undefined && i.salePrice > 0) priceData.sale_price = i.salePrice;
                if (Object.keys(priceData).length > 0) {
                    if (i.variantId) {
                        await tx.product_variants.update({ where: { id: i.variantId }, data: priceData });
                    } else {
                        await tx.products.update({ where: { id: i.productId }, data: priceData });
                    }
                }
            }

            // 4. Actualizar cabecera
            return tx.purchases.update({
                where: { id: purchaseId },
                data: {
                    total: newTotal,
                    status,
                    supplier_id: dto.supplierId !== undefined ? (dto.supplierId || null) : purchase.supplier_id,
                    due_date: dto.dueDate !== undefined
                        ? (dto.dueDate ? new Date(dto.dueDate) : null)
                        : purchase.due_date,
                },
            });
        }, { timeout: 60000 });
    }

    // ── Facturas por pagar (no afectan inventario) ────────────────────────

    /** Validar ítems y devolver el total calculado de una factura por pagar. */
    private async resolvePayableItems(
        items: { productId?: string; variantId?: string; description?: string; quantity: number; cost: number }[] | undefined,
        fallbackTotal: number | undefined,
        companyId: string,
    ): Promise<{ total: number; rows: any[] }> {
        if (!items || items.length === 0) {
            if (!fallbackTotal || fallbackTotal <= 0) {
                throw new BadRequestException('Indica el monto total o al menos una línea.');
            }
            return { total: fallbackTotal, rows: [] };
        }

        const productIds = [...new Set(items.filter(i => i.productId).map(i => i.productId!))];
        if (productIds.length > 0) {
            const found = await this.prisma.products.count({
                where: { id: { in: productIds }, company_id: companyId },
            });
            if (found !== productIds.length) throw new BadRequestException('Uno o más productos no existen.');
        }
        const variantIds = [...new Set(items.filter(i => i.variantId).map(i => i.variantId!))];
        if (variantIds.length > 0) {
            const found = await this.prisma.product_variants.count({
                where: { id: { in: variantIds }, products: { company_id: companyId } },
            });
            if (found !== variantIds.length) throw new BadRequestException('Una o más variantes no existen.');
        }

        const total = items.reduce((s, i) => s + Number(i.quantity) * Number(i.cost), 0);
        const rows = items.map(i => ({
            product_id: i.productId || null,
            variant_id: i.variantId || null,
            description: i.description?.trim() || null,
            quantity: i.quantity,
            cost: i.cost,
        }));
        return { total, rows };
    }

    /**
     * Registrar una factura por pagar ya existente. NO toca stock, precios ni caja.
     * Los abonos recibidos se guardan como históricos (pagados por fuera del sistema).
     */
    async createPayable(dto: CreatePayableDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const supplier = await this.prisma.suppliers.findFirst({
            where: { id: dto.supplierId, company_id: user.companyId },
            select: { id: true },
        });
        if (!supplier) throw new NotFoundException('Proveedor no encontrado.');

        const { total, rows } = await this.resolvePayableItems(dto.items, dto.total, user.companyId);

        const payments = dto.payments ?? [];
        const paidAmount = payments.reduce((s, p) => s + Number(p.amount), 0);
        if (paidAmount > total + 0.001) {
            throw new BadRequestException('Los abonos superan el total de la factura.');
        }
        const status = purchaseStatus(total, paidAmount);

        return this.prisma.$transaction(async (tx) => {
            const purchase = await tx.purchases.create({
                data: {
                    supplier_id: dto.supplierId,
                    branch_id: branchId,
                    total,
                    paid_amount: paidAmount,
                    status,
                    affects_inventory: false,
                    invoice_number: dto.invoiceNumber?.trim() || null,
                    invoice_date: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
                    notes: dto.notes?.trim() || null,
                    due_date: dto.dueDate ? new Date(dto.dueDate) : null,
                },
            });

            if (rows.length > 0) {
                await tx.purchase_items.createMany({
                    data: rows.map(r => ({ ...r, purchase_id: purchase.id })),
                });
            }

            if (payments.length > 0) {
                await tx.purchase_payments.createMany({
                    data: payments.map(p => ({
                        purchase_id: purchase.id,
                        user_id: user.sub,
                        amount: p.amount,
                        payment_method: p.method || 'CASH',
                        notes: p.notes?.trim() || 'Abono histórico (antes del sistema)',
                        is_historical: true,
                        ...(p.date ? { created_at: new Date(p.date) } : {}),
                    })),
                });
            }

            return purchase;
        }, { timeout: 30000 });
    }

    /** Editar una factura por pagar (solo cabecera + líneas descriptivas; nunca toca stock). */
    async updatePayable(purchaseId: string, dto: UpdatePayableDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const purchase = await this.prisma.purchases.findUnique({
            where: { id: purchaseId },
            include: { branches: { select: { company_id: true } } },
        });
        if (!purchase) throw new NotFoundException('Factura no encontrada.');
        if (purchase.branch_id !== branchId || purchase.branches?.company_id !== user.companyId) {
            throw new ForbiddenException('Sin acceso a esta factura.');
        }
        if (purchase.status === 'CANCELLED') throw new BadRequestException('La factura está anulada.');
        if (purchase.affects_inventory) {
            throw new BadRequestException('Esta es una compra con inventario; edítala desde el módulo de compras.');
        }

        if (dto.supplierId) {
            const supplier = await this.prisma.suppliers.findFirst({
                where: { id: dto.supplierId, company_id: user.companyId },
                select: { id: true },
            });
            if (!supplier) throw new NotFoundException('Proveedor no encontrado.');
        }

        const hasItems = dto.items !== undefined;
        const { total, rows } = hasItems
            ? await this.resolvePayableItems(dto.items, dto.total, user.companyId)
            : { total: dto.total ?? Number(purchase.total ?? 0), rows: null as any[] | null };

        const paidAmount = Number(purchase.paid_amount ?? 0);
        if (paidAmount > total + 0.001) {
            throw new BadRequestException('El total no puede quedar por debajo de lo ya abonado.');
        }
        const status = purchaseStatus(total, paidAmount);

        return this.prisma.$transaction(async (tx) => {
            if (rows !== null) {
                await tx.purchase_items.deleteMany({ where: { purchase_id: purchaseId } });
                if (rows.length > 0) {
                    await tx.purchase_items.createMany({
                        data: rows.map(r => ({ ...r, purchase_id: purchaseId })),
                    });
                }
            }

            return tx.purchases.update({
                where: { id: purchaseId },
                data: {
                    total,
                    status,
                    supplier_id: dto.supplierId ?? purchase.supplier_id,
                    invoice_number: dto.invoiceNumber !== undefined ? (dto.invoiceNumber.trim() || null) : purchase.invoice_number,
                    invoice_date: dto.invoiceDate !== undefined ? (dto.invoiceDate ? new Date(dto.invoiceDate) : null) : purchase.invoice_date,
                    notes: dto.notes !== undefined ? (dto.notes.trim() || null) : purchase.notes,
                    due_date: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : purchase.due_date,
                },
            });
        }, { timeout: 30000 });
    }

    /**
     * Anular una compra: revierte stock y, según `refund`, revierte los pagos
     * a caja/cartera ('AUTO') o los deja como saldo a favor del proveedor ('CREDIT').
     */
    async cancelPurchase(purchaseId: string, user: ActiveUserData, refund: 'AUTO' | 'CREDIT' = 'AUTO') {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const purchase = await this.prisma.purchases.findUnique({
            where: { id: purchaseId },
            include: { purchase_items: true, purchase_payments: true },
        });

        if (!purchase) throw new NotFoundException('Compra no encontrada.');
        if (purchase.status === 'CANCELLED') throw new BadRequestException('La compra ya está anulada.');
        if (purchase.branch_id !== branchId) throw new ForbiddenException('Sin acceso a esta compra.');

        const asCredit = refund === 'CREDIT' && Number(purchase.paid_amount) > 0;
        if (asCredit && !purchase.supplier_id) {
            throw new BadRequestException('La compra no tiene proveedor; no se puede dejar como saldo a favor.');
        }

        // Calcular cuánto fue pagado por cartera vs caja.
        // Los abonos históricos (pagados por fuera del sistema) no se revierten a caja.
        const carteraMovements = await this.prisma.cartera_movements.findMany({
            where: { reference_id: purchaseId, reference_type: 'PURCHASE', type: 'EXPENSE' },
        });
        const totalCartera = carteraMovements.reduce((sum, m) => sum + Number(m.amount), 0);
        const totalPaid = Number(purchase.paid_amount);
        const historicalPaid = purchase.purchase_payments
            .filter(p => p.is_historical)
            .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
        const trackedPaid = Math.max(0, totalPaid - historicalPaid);
        const cashPaid = Math.max(0, trackedPaid - totalCartera);

        const purchaseRef = `Anulación compra #${purchaseId.split('-')[0]}`;

        return this.prisma.$transaction(async (tx) => {
            // 1. Marcar como anulada
            await tx.purchases.update({ where: { id: purchaseId }, data: { status: 'CANCELLED' } });

            // 2. Revertir stock de cada ítem (producto o variante).
            //    Las facturas por pagar históricas no tocaron inventario → nada que revertir.
            for (const item of (purchase.affects_inventory ? purchase.purchase_items : [])) {
                const qty = Number(item.quantity);
                if (!qty) continue;

                if (item.variant_id) {
                    const existing = await tx.variant_stock.findFirst({
                        where: { variant_id: item.variant_id, branch_id: branchId },
                    });
                    if (existing) {
                        await tx.variant_stock.update({
                            where: { id: existing.id },
                            data: { quantity: { decrement: qty }, updated_at: new Date() },
                        });
                    }
                } else if (item.product_id) {
                    const existing = await tx.stock.findFirst({
                        where: { product_id: item.product_id, branch_id: branchId },
                    });
                    if (existing) {
                        await tx.stock.update({
                            where: { id: existing.id },
                            data: { quantity: { decrement: qty } },
                        });
                    }
                }

                if (item.product_id) {
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
            }

            if (asCredit) {
                // 3b. Dejar lo pagado como saldo a favor del proveedor
                await tx.supplier_credits.create({
                    data: {
                        company_id: user.companyId,
                        supplier_id: purchase.supplier_id!,
                        branch_id: branchId,
                        user_id: user.sub,
                        type: 'CREDIT',
                        amount: totalPaid,
                        reason: purchaseRef,
                        reference_id: purchaseId,
                        reference_type: 'PURCHASE_CANCEL',
                    },
                });
            } else {
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
            }

            return { success: true };
        }, { timeout: 30000 });
    }

    // ── Saldo a favor por proveedor ────────────────────────────────────────

    /** Balance de saldo a favor de un proveedor (Σ CREDIT − Σ DEBIT). */
    async getCreditBalance(supplierId: string): Promise<number> {
        const rows = await this.prisma.supplier_credits.findMany({
            where: { supplier_id: supplierId },
            select: { type: true, amount: true },
        });
        return rows.reduce((sum, r) => sum + (r.type === 'CREDIT' ? Number(r.amount) : -Number(r.amount)), 0);
    }

    /** Detalle del saldo a favor: balance + movimientos. */
    async getSupplierCredit(supplierId: string, user: ActiveUserData) {
        const supplier = await this.prisma.suppliers.findFirst({
            where: { id: supplierId, company_id: user.companyId },
            select: { id: true, name: true },
        });
        if (!supplier) throw new NotFoundException('Proveedor no encontrado.');

        const movements = await this.prisma.supplier_credits.findMany({
            where: { supplier_id: supplierId },
            orderBy: { created_at: 'desc' },
        });
        const balance = movements.reduce(
            (sum, r) => sum + (r.type === 'CREDIT' ? Number(r.amount) : -Number(r.amount)),
            0,
        );
        return { supplierId, balance, movements };
    }

    /** Transferir saldo a favor del proveedor a la cartera de la empresa. */
    async transferCreditToCartera(supplierId: string, amount: number, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const supplier = await this.prisma.suppliers.findFirst({
            where: { id: supplierId, company_id: user.companyId },
            select: { id: true, name: true },
        });
        if (!supplier) throw new NotFoundException('Proveedor no encontrado.');

        const amt = Number(amount);
        if (!amt || amt <= 0) throw new BadRequestException('El monto debe ser mayor a 0.');

        const balance = await this.getCreditBalance(supplierId);
        if (amt > balance + 0.001) {
            throw new BadRequestException(`El saldo a favor disponible es ${balance.toFixed(0)}.`);
        }

        const reason = `Saldo a favor [${supplier.name}] → cartera`;

        return this.prisma.$transaction(async (tx) => {
            await tx.supplier_credits.create({
                data: {
                    company_id: user.companyId,
                    supplier_id: supplierId,
                    branch_id: branchId,
                    user_id: user.sub,
                    type: 'DEBIT',
                    amount: amt,
                    reason,
                    reference_type: 'CARTERA_TRANSFER',
                },
            });
            await tx.cartera_movements.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId,
                    user_id: user.sub,
                    type: 'INCOME',
                    amount: amt,
                    reason,
                    reference_id: supplierId,
                    reference_type: 'SUPPLIER_CREDIT',
                },
            });
            return { success: true, transferred: amt, remaining: balance - amt };
        }, { timeout: 30000 });
    }
}
