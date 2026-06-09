import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddCarteraExpenseDto, AddCarteraIncomeDto, ConvertTransferDto } from './dto/cartera.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class CarteraService {
    constructor(private prisma: PrismaService) {}

    async getSummary(user: ActiveUserData) {
        const movements = await this.prisma.cartera_movements.findMany({
            where: { company_id: user.companyId },
            include: { users: { select: { name: true } } },
            orderBy: { created_at: 'desc' },
        });

        const totalIncomes = movements
            .filter(m => m.type === 'INCOME')
            .reduce((sum, m) => sum + Number(m.amount), 0);

        const totalExpenses = movements
            .filter(m => m.type === 'EXPENSE')
            .reduce((sum, m) => sum + Number(m.amount), 0);

        return {
            balance: totalIncomes - totalExpenses,
            totalIncomes,
            totalExpenses,
            movements,
        };
    }

    async addExpense(dto: AddCarteraExpenseDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];

        // Validar que hay saldo suficiente
        const movements = await this.prisma.cartera_movements.findMany({
            where: { company_id: user.companyId },
            select: { type: true, amount: true },
        });

        const balance = movements.reduce((sum, m) => {
            return m.type === 'INCOME'
                ? sum + Number(m.amount)
                : sum - Number(m.amount);
        }, 0);

        if (dto.amount > balance) {
            throw new BadRequestException(
                `Saldo insuficiente en cartera. Disponible: $${balance.toFixed(0)}`
            );
        }

        return this.prisma.cartera_movements.create({
            data: {
                company_id: user.companyId,
                branch_id: branchId ?? null,
                user_id: user.sub,
                type: 'EXPENSE',
                amount: dto.amount,
                reason: dto.reason,
                reference_type: 'MANUAL_EXPENSE',
            },
        });
    }

    async addIncome(dto: AddCarteraIncomeDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        return this.prisma.cartera_movements.create({
            data: {
                company_id: user.companyId,
                branch_id: branchId ?? null,
                user_id: user.sub,
                type: 'INCOME',
                amount: dto.amount,
                reason: dto.reason,
                reference_type: 'MANUAL_INCOME',
            },
        });
    }

    async convertTransferToCash(dto: ConvertTransferDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];

        // Validar que hay saldo suficiente en transferencias
        const movements = await this.prisma.cartera_movements.findMany({
            where: { company_id: user.companyId },
            select: { type: true, amount: true, reason: true },
        });

        const transferBalance = movements.reduce((sum, m) => {
            if (m.reason.includes('Transferencia')) {
                return m.type === 'INCOME' ? sum + Number(m.amount) : sum - Number(m.amount);
            }
            return sum;
        }, 0);

        if (dto.amount > transferBalance) {
            throw new BadRequestException(
                `Saldo insuficiente en transferencias. Disponible: $${transferBalance.toFixed(0)}`
            );
        }

        const fecha = new Date().toLocaleDateString('es-CO');

        await this.prisma.$transaction([
            this.prisma.cartera_movements.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId ?? null,
                    user_id: user.sub,
                    type: 'EXPENSE',
                    amount: dto.amount,
                    reason: `Conversión a Efectivo - Transferencia (${fecha})`,
                    reference_type: 'CONVERSION',
                },
            }),
            this.prisma.cartera_movements.create({
                data: {
                    company_id: user.companyId,
                    branch_id: branchId ?? null,
                    user_id: user.sub,
                    type: 'INCOME',
                    amount: dto.amount,
                    reason: `Conversión a Efectivo - Efectivo (${fecha})`,
                    reference_type: 'CONVERSION',
                },
            }),
        ]);

        return { message: 'Conversión registrada correctamente' };
    }
}
