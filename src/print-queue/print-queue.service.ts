import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

export interface AddQueueItemDto {
    variant_id?: string;
    label: string;
    sku: string;
    quantity: number;
}

@Injectable()
export class PrintQueueService {
    constructor(private prisma: PrismaService) {}

    async addItems(items: AddQueueItemDto[], user: ActiveUserData) {
        const created = await this.prisma.$transaction(
            items.map(item =>
                this.prisma.print_queue.create({
                    data: {
                        company_id: user.companyId,
                        variant_id: item.variant_id ?? null,
                        label: item.label,
                        sku: item.sku,
                        quantity: item.quantity,
                    },
                })
            )
        );
        return { added: created.length };
    }

    async getQueue(user: ActiveUserData) {
        return this.prisma.print_queue.findMany({
            where: { company_id: user.companyId },
            orderBy: { created_at: 'asc' },
        });
    }

    async removeItem(id: string, user: ActiveUserData) {
        const item = await this.prisma.print_queue.findFirst({
            where: { id, company_id: user.companyId },
        });
        if (!item) throw new ForbiddenException();
        await this.prisma.print_queue.delete({ where: { id } });
        return { ok: true };
    }

    async clearQueue(user: ActiveUserData) {
        const { count } = await this.prisma.print_queue.deleteMany({
            where: { company_id: user.companyId },
        });
        return { cleared: count };
    }
}
