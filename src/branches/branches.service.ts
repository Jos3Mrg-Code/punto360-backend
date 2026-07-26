import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async findAll(user: ActiveUserData) {
    return this.prisma.branches.findMany({
      where: {
        company_id: user.companyId,
        is_active: true
      },
      orderBy: {
        name: 'asc'
      }
    });
  }

  async create(user: ActiveUserData, dto: { name: string; address?: string; phone?: string }) {
    return this.prisma.branches.create({
      data: { company_id: user.companyId, name: dto.name, address: dto.address || '', phone: dto.phone },
    });
  }

  async update(id: string, companyId: string, dto: { name?: string; address?: string; phone?: string }) {
    return this.prisma.branches.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, companyId: string) {
    // No borrar la sucursal principal
    const branch = await this.prisma.branches.findUnique({ where: { id } });
    if (branch?.is_main) throw new Error('No puedes eliminar la sucursal principal.');
    return this.prisma.branches.update({ where: { id }, data: { is_active: false } });
  }
}
