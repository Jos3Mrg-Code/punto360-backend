import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto, AddCustomerPaymentDto } from './dto/customer.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class CustomersService {
    constructor(private prisma: PrismaService) {}

    async findAll(user: ActiveUserData) {
        const customers = await this.prisma.customers.findMany({
            where: { company_id: user.companyId, is_active: true },
            include: {
                sales: {
                    where: { is_credit: true },
                    select: { total: true, status: true, created_at: true },
                },
                customer_payments: {
                    select: { amount: true, created_at: true },
                },
            },
            orderBy: { name: 'asc' },
        });

        return customers.map(c => {
            const totalCredit = c.sales.reduce((sum, s) => sum + Number(s.total), 0);
            const totalPaid = c.customer_payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const sorted = [...c.sales].sort((a, b) =>
                (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0)
            );
            return {
                id: c.id,
                name: c.name,
                phone: c.phone,
                email: c.email,
                credit_limit: c.credit_limit ? Number(c.credit_limit) : null,
                notes: c.notes,
                created_at: c.created_at,
                totalCredit,
                totalPaid,
                balance: totalCredit - totalPaid,
                invoiceCount: c.sales.length,
                lastActivity: sorted[0]?.created_at ?? null,
            };
        });
    }

    async findOne(id: string, user: ActiveUserData) {
        const customer = await this.prisma.customers.findFirst({
            where: { id, company_id: user.companyId },
        });
        if (!customer) throw new NotFoundException('Cliente no encontrado');
        return customer;
    }

    async getSales(customerId: string, user: ActiveUserData) {
        return this.prisma.sales.findMany({
            where: {
                customer_id: customerId,
                company_id: user.companyId,
                is_credit: true,
            },
            include: {
                sale_items: {
                    include: {
                        products: { select: { name: true, sku: true, unit_type: true } },
                    },
                },
                branches: { select: { name: true } },
                users: { select: { name: true } },
            },
            orderBy: { created_at: 'desc' },
        });
    }

    async getPayments(customerId: string, user: ActiveUserData) {
        const customer = await this.prisma.customers.findFirst({
            where: { id: customerId, company_id: user.companyId },
        });
        if (!customer) throw new NotFoundException('Cliente no encontrado');

        return this.prisma.customer_payments.findMany({
            where: { customer_id: customerId },
            include: { users: { select: { name: true } } },
            orderBy: { created_at: 'desc' },
        });
    }

    async getAllPayments(user: ActiveUserData) {
        return this.prisma.customer_payments.findMany({
            where: { customers: { company_id: user.companyId } },
            include: {
                customers: { select: { id: true, name: true } },
                users: { select: { name: true } },
            },
            orderBy: { created_at: 'desc' },
            take: 500,
        });
    }

    async create(dto: CreateCustomerDto, user: ActiveUserData) {
        return this.prisma.customers.create({
            data: {
                company_id: user.companyId,
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
                credit_limit: dto.credit_limit ?? null,
                notes: dto.notes,
            },
        });
    }

    async update(id: string, dto: UpdateCustomerDto, user: ActiveUserData) {
        const existing = await this.prisma.customers.findFirst({
            where: { id, company_id: user.companyId },
        });
        if (!existing) throw new NotFoundException('Cliente no encontrado');

        return this.prisma.customers.update({
            where: { id },
            data: {
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
                credit_limit: dto.credit_limit !== undefined ? dto.credit_limit : undefined,
                notes: dto.notes,
            },
        });
    }

    async addPayment(customerId: string, dto: AddCustomerPaymentDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];

        const customer = await this.prisma.customers.findFirst({
            where: { id: customerId, company_id: user.companyId },
            include: {
                sales: {
                    where: { is_credit: true },
                    select: { total: true },
                },
                customer_payments: { select: { amount: true } },
            },
        });
        if (!customer) throw new NotFoundException('Cliente no encontrado');

        const totalCredit = customer.sales.reduce((s, v) => s + Number(v.total), 0);
        const totalPaid = customer.customer_payments.reduce((s, p) => s + Number(p.amount), 0);
        const balance = totalCredit - totalPaid;

        if (Number(dto.amount) > balance) {
            throw new BadRequestException(`El abono supera el saldo pendiente (${balance.toFixed(0)})`);
        }

        return this.prisma.$transaction(async (tx) => {
            const payment = await tx.customer_payments.create({
                data: {
                    customer_id: customerId,
                    user_id: user.sub,
                    amount: dto.amount,
                    payment_method: dto.method || 'CASH',
                    notes: dto.notes,
                },
            });

            const methodLabel = dto.method === 'TRANSFER' ? 'Transferencia' : 'Efectivo';

            // Registrar en caja si hay sesión abierta (para trazabilidad del efectivo físico)
            if (branchId && (dto.method === 'CASH' || dto.method === 'TRANSFER')) {
                const session = await tx.cash_registers.findFirst({
                    where: { branch_id: branchId, company_id: user.companyId, status: 'OPEN' },
                });
                if (session) {
                    await tx.cash_movements.create({
                        data: {
                            cash_register_id: session.id,
                            user_id: user.sub,
                            type: 'INCOME',
                            amount: dto.amount,
                            reason: `Abono cliente [${customer.name}] - ${methodLabel}`,
                        },
                    });
                }
            }

            return payment;
        });
    }
}
