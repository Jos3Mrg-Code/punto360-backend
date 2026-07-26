import { Injectable, BadRequestException, ForbiddenException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import * as bcrypt from 'bcrypt';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** Listar usuarios de la empresa actual con sus roles y sucursales */
  async findAll(user: ActiveUserData) {
    return this.prisma.users.findMany({
      where: { company_id: user.companyId },
      include: {
        user_roles: { include: { roles: true } },
        user_branches: { include: { branches: true } }
      },
      orderBy: { created_at: 'desc' }
    });
  }

  /** Crear un nuevo usuario (colaborador) */
  async create(dto: CreateUserDto, creator: ActiveUserData) {
    const { password, roleIds, branchIds, ...userData } = dto;
    const password_hash = await bcrypt.hash(password, 10);
    const email = userData.email.toLowerCase().trim();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.users.create({
          data: {
            ...userData,
            email,
            password_hash,
            company_id: creator.companyId,
            is_active: true
          }
        });

        if (roleIds && roleIds.length > 0) {
          await tx.user_roles.createMany({
            data: roleIds.map(rid => ({ user_id: newUser.id, role_id: rid }))
          });
        }

        if (branchIds && branchIds.length > 0) {
          await tx.user_branches.createMany({
            data: branchIds.map(bid => ({ user_id: newUser.id, branch_id: bid }))
          });
        }

        return newUser;
      });
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new BadRequestException('Ya existe un usuario con ese correo electrónico.');
      }
      throw new InternalServerErrorException(e.message ?? 'Error al crear el usuario.');
    }
  }

  /** Actualizar un usuario */
  async update(id: string, dto: UpdateUserDto, actor: ActiveUserData) {
    const { password, roleIds, branchIds, ...userData } = dto;
    
    // Verificamos existencia
    const userToUpdate = await this.prisma.users.findUnique({ where: { id } });
    if (!userToUpdate || userToUpdate.company_id !== actor.companyId) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const data: any = { ...userData };
    if (userData.email) {
      data.email = userData.email.toLowerCase().trim();
    }
    if (password) {
      data.password_hash = await bcrypt.hash(password, 10);
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.users.update({
        where: { id },
        data
      });

      // Actualizar Roles si se proveen
      if (roleIds) {
        await tx.user_roles.deleteMany({ where: { user_id: id } });
        if (roleIds.length > 0) {
          await tx.user_roles.createMany({
            data: roleIds.map(rid => ({ user_id: id, role_id: rid }))
          });
        }
      }

      // Actualizar Sucursales si se proveen
      if (branchIds) {
        await tx.user_branches.deleteMany({ where: { user_id: id } });
        if (branchIds.length > 0) {
          await tx.user_branches.createMany({
            data: branchIds.map(bid => ({ user_id: id, branch_id: bid }))
          });
        }
      }

      return updatedUser;
    });
  }

  /**
   * Eliminar/Desactivar Usuario
   * RESTRICCIÓN: No puede borrarse a sí mismo.
   */
  async remove(id: string, actor: ActiveUserData) {
    if (id === actor.sub) {
      throw new ForbiddenException('No puedes eliminar tu propio usuario administrador.');
    }

    const userToDelete = await this.prisma.users.findUnique({ where: { id } });
    if (!userToDelete || userToDelete.company_id !== actor.companyId) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Por seguridad e integridad de datos (ventas/registros),
    // desactivamos en lugar de borrar físicamente si hay registros asociados,
    // pero aquí permitiremos el delete si el negocio lo requiere.
    return this.prisma.users.delete({ where: { id } });
  }

  async getMe(userId: string) {
    return this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
  }

  async updateMe(userId: string, dto: { name?: string }) {
    return this.prisma.users.update({
      where: { id: userId },
      data: dto,
      select: { id: true, name: true, email: true },
    });
  }

  async changePassword(userId: string, dto: { currentPassword: string; newPassword: string }) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    const valid = await bcrypt.compare(dto.currentPassword, user.password_hash);
    if (!valid) throw new BadRequestException('Contraseña actual incorrecta.');
    const hash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.users.update({ where: { id: userId }, data: { password_hash: hash } });
    return { ok: true };
  }
}
