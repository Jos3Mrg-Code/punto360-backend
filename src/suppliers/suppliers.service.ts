import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class SuppliersService {
    constructor(private prisma: PrismaService) {}

    async findAll(user: ActiveUserData) {
        const suppliers = await this.prisma.suppliers.findMany({
            where: { company_id: user.companyId },
            orderBy: { name: 'asc' },
            include: {
                purchases: {
                    select: {
                        total: true,
                        paid_amount: true,
                        status: true,
                        created_at: true,
                    },
                },
                supplier_credits: {
                    select: { type: true, amount: true },
                },
            },
        });

        return suppliers.map(s => {
            // Las compras anuladas no cuentan en facturado ni en saldo
            const active = s.purchases.filter(p => p.status !== 'CANCELLED');
            const totalInvoiced = active.reduce((sum, p) => sum + Number(p.total), 0);
            const totalPaid = active.reduce((sum, p) => sum + Number(p.paid_amount), 0);
            const debt = totalInvoiced - totalPaid;

            const ledgerCredit = s.supplier_credits.reduce(
                (sum, c) => sum + (c.type === 'CREDIT' ? Number(c.amount) : -Number(c.amount)),
                0,
            );
            // Saldo a favor = ledger + sobrepago en compras activas
            const creditBalance = Math.max(0, ledgerCredit) + Math.max(0, -debt);

            const sorted = [...s.purchases].sort((a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0));
            return {
                id: s.id,
                name: s.name,
                phone: s.phone,
                email: s.email,
                purchaseCount: active.length,
                totalInvoiced,
                totalPaid,
                balance: Math.max(0, debt),
                creditBalance,
                lastPurchase: sorted[0]?.created_at ?? null,
            };
        });
    }

    async findOnePurchases(id: string, user: ActiveUserData) {
        return this.prisma.purchases.findMany({
            where: {
                supplier_id: id,
                branches: { company_id: user.companyId },
            },
            include: {
                purchase_items: {
                    include: {
                        products: {
                            select: {
                                id: true, name: true, sku: true, unit_type: true,
                                has_variants: true, sale_price: true, cost_price: true,
                            },
                        },
                        variants: { select: { id: true, sku: true, sale_price: true, cost_price: true } },
                    },
                },
                purchase_payments: {
                    include: {
                        users: { select: { name: true } },
                    },
                    orderBy: { created_at: 'asc' },
                },
            },
            orderBy: { created_at: 'desc' },
        });
    }

    create(dto: CreateSupplierDto, user: ActiveUserData) {
        return this.prisma.suppliers.create({
            data: {
                company_id: user.companyId,
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
            },
        });
    }

    update(id: string, dto: UpdateSupplierDto, user: ActiveUserData) {
        return this.prisma.suppliers.update({
            where: { id },
            data: {
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
            },
        });
    }
}
