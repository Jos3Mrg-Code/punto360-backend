import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenCashDto, CloseCashDto, AddExpenseDto } from './dto/cash-register.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class CashRegistersService {
    constructor(private prisma: PrismaService) {}

    /** Obtener sesión activa de la sucursal (o null si está cerrada) */
    async getCurrentSession(user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        return this.prisma.cash_registers.findFirst({
            where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
            include: {
                cash_movements: { orderBy: { created_at: 'desc' } },
                users: { select: { name: true, user_name: true } },
            },
        });
    }

    /** Abrir caja */
    async openSession(dto: OpenCashDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        // Verificar si ya hay una sesión abierta
        const existing = await this.prisma.cash_registers.findFirst({
            where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
        });
        if (existing) {
            throw new BadRequestException('Ya existe una sesión de caja abierta para esta sucursal.');
        }

        return this.prisma.cash_registers.create({
            data: {
                branch_id: branchId,
                company_id: user.companyId,
                user_id: user.sub,
                name: dto.name || 'Caja Principal',
                status: 'OPEN',
                opening_amount: dto.opening_amount,
                opened_at: new Date(),
            },
        });
    }

    /** Cerrar caja y generar resumen del arqueo */
    async closeSession(sessionId: string, dto: CloseCashDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const session = await this.prisma.cash_registers.findFirst({
            where: { id: sessionId, branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
        });
        if (!session) throw new NotFoundException('Sesión de caja no encontrada o ya cerrada.');

        // Calcular ventas del periodo de esta sesión
        const salesInSession = await this.prisma.sales.findMany({
            where: {
                branch_id: branchId,
                company_id: user.companyId,
                status: 'PAID',
                created_at: { gte: session.opened_at!, lte: new Date() },
            },
            include: {
                sale_items: {
                    include: { products: { select: { name: true, is_consignment: true } } }
                }
            },
        });

        // Desglose por producto de consignación
        const consignmentMap = new Map<string, number>();
        for (const sale of salesInSession) {
            for (const item of sale.sale_items) {
                if (!item.products?.is_consignment) continue;
                const name = item.products.name;
                consignmentMap.set(name, (consignmentMap.get(name) ?? 0) + Number(item.subtotal ?? 0));
            }
        }
        const consignmentItems = Array.from(consignmentMap.entries()).map(([name, total]) => ({ name, total }));

        const cashSales = salesInSession
            .filter(s => s.payment_method === 'CASH')
            .reduce((sum, s) => sum + Number(s.total), 0);

        const cardSales = salesInSession
            .filter(s => s.payment_method === 'CARD')
            .reduce((sum, s) => sum + Number(s.total), 0);

        const transferSales = salesInSession
            .filter(s => s.payment_method === 'TRANSFER')
            .reduce((sum, s) => sum + Number(s.total), 0);

        // Movimientos manuales de caja (gastos e ingresos)
        const allMovements = await this.prisma.cash_movements.findMany({
            where: { cash_register_id: sessionId },
        });
        const totalExpenses = allMovements
            .filter(m => m.type === 'EXPENSE')
            .reduce((sum, m) => sum + Number(m.amount), 0);
        const totalIncomes = allMovements
            .filter(m => m.type === 'INCOME')
            .reduce((sum, m) => sum + Number(m.amount), 0);

        const openingAmount = Number(session.opening_amount ?? 0);
        const expectedCash = openingAmount + cashSales + totalIncomes - totalExpenses;
        const difference = dto.closing_amount - expectedCash;

        const closed = await this.prisma.cash_registers.update({
            where: { id: sessionId },
            data: {
                status: 'CLOSED',
                closing_amount: dto.closing_amount,
                closed_at: new Date(),
                notes: dto.notes,
            },
        });

        // Pasar ingresos del turno a cartera (separados por método)
        const closedAt = new Date();
        const turnoLabel = `Turno ${session.opened_at ? new Date(session.opened_at).toLocaleDateString('es-CO') : ''}`;

        if (dto.closing_amount > 0) {
            await this.prisma.cartera_movements.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId,
                    user_id: user.sub,
                    type: 'INCOME',
                    amount: dto.closing_amount,
                    reason: `Cierre de caja - Efectivo (${turnoLabel})`,
                    reference_id: closed.id,
                    reference_type: 'CASH_CLOSING',
                },
            });
        }

        if (transferSales > 0) {
            await this.prisma.cartera_movements.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId,
                    user_id: user.sub,
                    type: 'INCOME',
                    amount: transferSales,
                    reason: `Cierre de caja - Transferencias (${turnoLabel})`,
                    reference_id: closed.id,
                    reference_type: 'CASH_CLOSING',
                },
            });
        }

        return {
            session: closed,
            summary: {
                openingAmount,
                cashSales,
                cardSales,
                transferSales,
                consignmentItems,
                totalSales: cashSales + cardSales + transferSales,
                totalExpenses,
                totalIncomes,
                expectedCash,
                closingAmount: dto.closing_amount,
                difference,
                ticketsCount: salesInSession.length,
            },
        };
    }

    /** Stats en vivo de la sesión abierta (ventas por método de pago) */
    async getSessionLiveStats(user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const session = await this.prisma.cash_registers.findFirst({
            where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
            select: { id: true, opened_at: true },
        });
        if (!session) return null;

        const salesInSession = await this.prisma.sales.findMany({
            where: {
                branch_id: branchId,
                company_id: user.companyId,
                status: 'PAID',
                created_at: { gte: session.opened_at! },
            },
            select: {
                total: true,
                payment_method: true,
                sale_items: {
                    select: { subtotal: true, products: { select: { is_consignment: true } } }
                },
            },
        });

        const consignmentByLiveSale = (sale: typeof salesInSession[0]) =>
            sale.sale_items
                .filter(i => i.products?.is_consignment)
                .reduce((s, i) => s + Number(i.subtotal ?? 0), 0);

        const cashSales = salesInSession.filter(s => s.payment_method === 'CASH').reduce((sum, s) => sum + Number(s.total) - consignmentByLiveSale(s), 0);
        const cardSales = salesInSession.filter(s => s.payment_method === 'CARD').reduce((sum, s) => sum + Number(s.total) - consignmentByLiveSale(s), 0);
        const transferSales = salesInSession.filter(s => s.payment_method === 'TRANSFER').reduce((sum, s) => sum + Number(s.total) - consignmentByLiveSale(s), 0);

        return {
            cashSales,
            cardSales,
            transferSales,
            totalSales: cashSales + cardSales + transferSales,
            ticketsCount: salesInSession.length,
        };
    }

    /** Registrar un gasto — desde caja o desde cartera */
    async addExpense(sessionId: string, dto: AddExpenseDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const session = await this.prisma.cash_registers.findFirst({
            where: { id: sessionId, branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
        });
        if (!session) throw new NotFoundException('Sesión de caja no encontrada o ya cerrada.');

        if (dto.source === 'CARTERA') {
            // Validar saldo de cartera
            const movements = await this.prisma.cartera_movements.findMany({
                where: { company_id: user.companyId },
                select: { type: true, amount: true },
            });
            const balance = movements.reduce((sum, m) =>
                m.type === 'INCOME' ? sum + Number(m.amount) : sum - Number(m.amount), 0);

            if (dto.amount > balance) {
                throw new BadRequestException(
                    `Saldo insuficiente en cartera. Disponible: $${balance.toFixed(0)}`
                );
            }

            return this.prisma.cartera_movements.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId,
                    user_id: user.sub,
                    type: 'EXPENSE',
                    amount: dto.amount,
                    reason: dto.reason,
                    reference_type: 'MANUAL_EXPENSE',
                },
            });
        }

        return this.prisma.cash_movements.create({
            data: {
                cash_register_id: sessionId,
                user_id: user.sub,
                type: 'EXPENSE',
                amount: dto.amount,
                reason: dto.reason,
            },
        });
    }

    /** Historial de arqueos con desglose completo */
    async getHistory(user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        if (!branchId) throw new BadRequestException('Sin sucursal asignada.');

        const sessions = await this.prisma.cash_registers.findMany({
            where: { branch_id: branchId, company_id: user.companyId },
            include: {
                users: { select: { name: true, user_name: true } },
                cash_movements: { orderBy: { created_at: 'asc' } },
            },
            orderBy: { opened_at: 'desc' },
            take: 30,
        });

        const enriched = await Promise.all(sessions.map(async session => {
            const closedAt = session.closed_at ?? new Date();
            const salesInSession = await this.prisma.sales.findMany({
                where: {
                    branch_id: branchId,
                    company_id: user.companyId,
                    status: 'PAID',
                    created_at: { gte: session.opened_at!, lte: closedAt },
                },
                include: {
                    sale_items: {
                        include: { products: { select: { name: true, is_consignment: true } } }
                    }
                },
            });

            // Desglose por producto de consignación (solo informativo)
            const consignmentMap = new Map<string, number>();
            for (const sale of salesInSession) {
                for (const item of sale.sale_items) {
                    if (!item.products?.is_consignment) continue;
                    const name = item.products.name;
                    consignmentMap.set(name, (consignmentMap.get(name) ?? 0) + Number(item.subtotal ?? 0));
                }
            }
            const consignmentItems = Array.from(consignmentMap.entries()).map(([name, total]) => ({ name, total }));

            const cashSales = salesInSession.filter(s => s.payment_method === 'CASH').reduce((sum, s) => sum + Number(s.total), 0);
            const cardSales = salesInSession.filter(s => s.payment_method === 'CARD').reduce((sum, s) => sum + Number(s.total), 0);
            const transferSales = salesInSession.filter(s => s.payment_method === 'TRANSFER').reduce((sum, s) => sum + Number(s.total), 0);
            const totalExpenses = session.cash_movements.filter(m => m.type === 'EXPENSE').reduce((sum, m) => sum + Number(m.amount), 0);
            const totalIncomes = session.cash_movements.filter(m => m.type === 'INCOME').reduce((sum, m) => sum + Number(m.amount), 0);
            const openingAmount = Number(session.opening_amount ?? 0);
            const closingAmount = Number(session.closing_amount ?? 0);
            const expectedCash = openingAmount + cashSales + totalIncomes - totalExpenses;

            return {
                id: session.id,
                name: session.name,
                status: session.status,
                opened_at: session.opened_at,
                closed_at: session.closed_at,
                notes: session.notes,
                cashier: session.users,
                cash_movements: session.cash_movements,
                summary: {
                    openingAmount,
                    cashSales,
                    cardSales,
                    transferSales,
                    consignmentItems,
                    totalSales: cashSales + cardSales + transferSales,
                    totalExpenses,
                    expectedCash,
                    closingAmount,
                    difference: closingAmount - expectedCash,
                    ticketsCount: salesInSession.length,
                },
            };
        }));

        return enriched;
    }
}
