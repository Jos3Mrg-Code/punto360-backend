import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto, HoldSaleDto, CompleteSaleDto } from './dto/create-sale.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';


@Injectable()
export class SalesService {
    constructor(private prisma: PrismaService) {}

    async createSale(dto: CreateSaleDto, user: ActiveUserData) {
        if (!user.branchIds || user.branchIds.length === 0) {
            throw new BadRequestException("El usuario no tiene una sucursal asignada.");
        }
        
        const branchId = user.branchIds[0];

        const isCredit = dto.paymentMethod === 'CREDIT';
        if (isCredit && !dto.customerId) {
            throw new BadRequestException('Una venta a crédito requiere un cliente asociado.');
        }

        // Pre-fetch all products outside transaction to reduce sequential queries
        const productIds = [...new Set(dto.items.map(i => i.productId))];
        const products = await this.prisma.products.findMany({
            where: { id: { in: productIds } },
            select: { id: true, is_consignment: true },
        });
        const productMap = new Map(products.map(p => [p.id, p]));

        return this.prisma.$transaction(async (tx) => {
            // 1. Crear el Ticket de Venta
            const sale = await tx.sales.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId,
                    user_id: user.sub,
                    customer_id: dto.customerId || null,
                    total: dto.total,
                    payment_method: dto.paymentMethod,
                    status: 'PAID',
                    is_credit: isCredit,
                    paid_at: new Date(),
                }
            });

            // 2. Procesar cada item, registrar en sale_items y descontar stock
            for (const item of dto.items) {
                const product = productMap.get(item.productId);

                await tx.sale_items.create({
                    data: {
                        sale_id: sale.id,
                        product_id: item.productId,
                        variant_id: item.variantId || null,
                        quantity: item.quantity,
                        price: item.price,
                        subtotal: item.quantity * item.price
                    }
                });

                if (product?.is_consignment) continue;

                if (item.variantId) {
                    const varStock = await tx.variant_stock.findUnique({
                        where: { variant_id_branch_id: { variant_id: item.variantId, branch_id: branchId } }
                    });
                    if (!varStock || varStock.quantity.toNumber() < item.quantity) {
                        throw new BadRequestException(`Inventario insuficiente para la variante seleccionada`);
                    }
                    await tx.variant_stock.update({
                        where: { id: varStock.id },
                        data: { quantity: varStock.quantity.toNumber() - item.quantity, updated_at: new Date() }
                    });
                } else {
                    const currentStock = await tx.stock.findFirst({
                        where: { product_id: item.productId, branch_id: branchId }
                    });
                    if (!currentStock || currentStock.quantity.toNumber() < item.quantity) {
                        throw new BadRequestException(`Inventario insuficiente para procesar la venta (Producto ID: ${item.productId})`);
                    }
                    await tx.stock.update({
                        where: { id: currentStock.id },
                        data: { quantity: currentStock.quantity.toNumber() - item.quantity }
                    });
                }

                await tx.inventory_movements.create({
                    data: {
                        product_id: item.productId,
                        branch_id: branchId,
                        type: 'OUT_SALE',
                        quantity: item.quantity,
                        reason: 'Venta Caja POS',
                        reference_id: sale.id
                    }
                });
            }

            return sale;
        }, { timeout: 30000 });
    }

    async getSalesStats(user: ActiveUserData) {
        if (!user.branchIds || user.branchIds.length === 0) {
            throw new BadRequestException("El usuario no tiene una sucursal asignada.");
        }

        const now = new Date();
        // Colombia = UTC-5: midnight Colombia = 05:00 UTC
        const bogotaMs = now.getTime() - 5 * 60 * 60 * 1000;
        const bogota = new Date(bogotaMs);
        const todayStart = new Date(Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate(), 5, 0, 0, 0));
        const monthStart = new Date(Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), 1, 5, 0, 0, 0));

        const baseWhere = {
            company_id: user.companyId,
            branch_id: { in: user.branchIds },
            status: 'PAID'
        };

        const [todaySales, monthSales, recentSales, lowStock, totalProducts] = await Promise.all([
            this.prisma.sales.findMany({
                where: { ...baseWhere, created_at: { gte: todayStart } },
                select: { total: true, payment_method: true }
            }),
            this.prisma.sales.findMany({
                where: { ...baseWhere, created_at: { gte: monthStart } },
                select: { total: true }
            }),
            this.prisma.sales.findMany({
                where: {
                    company_id: user.companyId,
                    branch_id: { in: user.branchIds }
                },
                include: {
                    sale_items: {
                        include: { products: { select: { name: true } } }
                    },
                    branches: { select: { name: true } }
                },
                orderBy: { created_at: 'desc' },
                take: 8
            }),
            this.prisma.stock.count({
                where: { branch_id: { in: user.branchIds }, quantity: { lt: 5 } }
            }),
            this.prisma.products.count({
                where: { company_id: user.companyId, is_active: true }
            }),
        ]);

        const totalHoy = todaySales.reduce((sum, s) => sum + Number(s.total), 0);
        const efectivoHoy = todaySales
            .filter(s => s.payment_method === 'CASH')
            .reduce((sum, s) => sum + Number(s.total), 0);
        const totalMes = monthSales.reduce((sum, s) => sum + Number(s.total), 0);

        return {
            totalHoy,
            efectivoHoy,
            ticketsHoy: todaySales.length,
            totalMes,
            lowStock,
            totalProducts,
            recentSales,
        };
    }

    async getSalesHistory(startDate: string, endDate: string, user: ActiveUserData) {
        if (!user.branchIds || user.branchIds.length === 0) {
            throw new BadRequestException("El usuario no tiene sucursales asignadas.");
        }

        const whereClause: any = {
            company_id: user.companyId,
            branch_id: { in: user.branchIds },
        };

        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            whereClause.created_at = { gte: start, lte: end };
        } else {
            const start = new Date();
            start.setDate(start.getDate() - 7);
            start.setHours(0, 0, 0, 0);
            whereClause.created_at = { gte: start };
        }

        return this.prisma.sales.findMany({
            where: whereClause,
            include: {
                branches: { select: { name: true } },
                users: { select: { name: true } },
                sale_items: {
                    include: {
                        products: {
                            select: { name: true, sku: true, unit_type: true }
                        }
                    }
                }
            },
            orderBy: { created_at: 'desc' }
        });
    }

    async holdSale(dto: HoldSaleDto, user: ActiveUserData) {
        if (!user.branchIds || user.branchIds.length === 0) {
            throw new BadRequestException("El usuario no tiene una sucursal asignada.");
        }
        const branchId = user.branchIds[0];

        return this.prisma.$transaction(async (tx) => {
            const sale = await tx.sales.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId,
                    user_id: user.sub,
                    total: dto.total,
                    payment_method: 'PENDING',
                    status: 'PENDING',
                    is_credit: false,
                }
            });

            await tx.sale_items.createMany({
                data: dto.items.map(item => ({
                    sale_id: sale.id,
                    product_id: item.productId,
                    quantity: item.quantity,
                    price: item.price,
                    subtotal: item.quantity * item.price,
                }))
            });

            return sale;
        });
    }

    async getPendingSales(user: ActiveUserData) {
        if (!user.branchIds || user.branchIds.length === 0) return [];

        return this.prisma.sales.findMany({
            where: {
                company_id: user.companyId,
                branch_id: { in: user.branchIds },
                status: 'PENDING',
            },
            include: {
                sale_items: {
                    include: { products: { select: { name: true, sku: true } } }
                }
            },
            orderBy: { created_at: 'desc' }
        });
    }

    async completePendingSale(saleId: string, dto: CompleteSaleDto, user: ActiveUserData) {
        if (!user.branchIds || user.branchIds.length === 0) {
            throw new BadRequestException("El usuario no tiene una sucursal asignada.");
        }
        const branchId = user.branchIds[0];

        const isCredit = dto.paymentMethod === 'CREDIT';
        if (isCredit && !dto.customerId) {
            throw new BadRequestException('Una venta a crédito requiere un cliente asociado.');
        }

        return this.prisma.$transaction(async (tx) => {
            const sale = await tx.sales.findFirst({
                where: { id: saleId, company_id: user.companyId, status: 'PENDING' },
                include: { sale_items: true }
            });

            if (!sale) throw new NotFoundException('Factura pendiente no encontrada.');

            for (const item of sale.sale_items) {
                const currentStock = await tx.stock.findFirst({
                    where: { product_id: item.product_id, branch_id: branchId }
                });

                if (!currentStock || currentStock.quantity.toNumber() < Number(item.quantity)) {
                    throw new BadRequestException(`Inventario insuficiente para completar la venta.`);
                }

                await tx.stock.update({
                    where: { id: currentStock.id },
                    data: { quantity: currentStock.quantity.toNumber() - Number(item.quantity) }
                });

                await tx.inventory_movements.create({
                    data: {
                        product_id: item.product_id,
                        branch_id: branchId,
                        type: 'OUT_SALE',
                        quantity: item.quantity,
                        reason: 'Venta Caja POS',
                        reference_id: sale.id
                    }
                });
            }

            return tx.sales.update({
                where: { id: saleId },
                data: {
                    status: 'PAID',
                    payment_method: dto.paymentMethod,
                    customer_id: dto.customerId || null,
                    is_credit: isCredit,
                    paid_at: new Date(),
                }
            });
        });
    }

    async discardPendingSale(saleId: string, user: ActiveUserData) {
        const sale = await this.prisma.sales.findFirst({
            where: { id: saleId, company_id: user.companyId, status: 'PENDING' }
        });
        if (!sale) throw new NotFoundException('Factura pendiente no encontrada.');
        await this.prisma.sales.delete({ where: { id: saleId } });
        return { message: 'Factura descartada.' };
    }

    async cancelSale(saleId: string, user: ActiveUserData) {
        if (!user.branchIds || user.branchIds.length === 0) {
            throw new BadRequestException("El usuario no tiene una sucursal asignada.");
        }
        const branchId = user.branchIds[0];

        return this.prisma.$transaction(async (tx) => {
            const sale = await tx.sales.findFirst({
                where: { id: saleId, company_id: user.companyId, branch_id: branchId },
                include: { sale_items: true }
            });

            if (!sale) {
                throw new BadRequestException("Venta no encontrada.");
            }

            if (sale.status === 'CANCELLED') {
                throw new BadRequestException("La venta ya se encuentra anulada.");
            }

            // 1. Marcar como CANCELLED
            await tx.sales.update({
                where: { id: saleId },
                data: { status: 'CANCELLED' }
            });

            // 2. Devolver items al Stock
            for (const item of sale.sale_items) {
                const currentStock = await tx.stock.findFirst({
                    where: { product_id: item.product_id, branch_id: branchId }
                });

                if (currentStock) {
                    await tx.stock.update({
                        where: { id: currentStock.id },
                        data: { quantity: currentStock.quantity.toNumber() + (item.quantity ? item.quantity.toNumber() : 0) }
                    });
                }

                // Registrar devolución
                await tx.inventory_movements.create({
                    data: {
                        product_id: item.product_id,
                        branch_id: branchId,
                        type: 'IN_CANCEL',
                        quantity: item.quantity,
                        reason: 'Anulación de Venta',
                        reference_id: sale.id
                    }
                });
            }

            return { message: "Venta anulada correctamente" };
        });
    }
}
