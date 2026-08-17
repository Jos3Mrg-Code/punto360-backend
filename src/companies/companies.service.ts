import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class CompaniesService {
    constructor(private prisma: PrismaService) {}

    async registerTenant(dto: CreateTenantDto) {
        // 1. Verificar si el correo ya existe
        const existingUser = await this.prisma.users.findUnique({
            where: { email: dto.userEmail },
        });

        if (existingUser) {
            throw new BadRequestException('El correo electrónico ya está registrado en el sistema.');
        }

        // 2. Ejecutar todo en una sola transacción interactiva
        return this.prisma.$transaction(async (tx) => {
            // A. Crear Empresa
            const company = await tx.companies.create({
                data: {
                    name: dto.companyName,
                    document_number: dto.documentNumber,
                    phone: dto.companyPhone,
                    email: dto.companyEmail,
                    address: dto.companyAddress,
                },
            });

            // B. Crear Sucursal Principal de esa Empresa
            const branch = await tx.branches.create({
                data: {
                    company_id: company.id,
                    name: dto.branchName,
                    address: dto.branchAddress,
                    is_main: true,
                    code: 'MAIN', // Valor por convención para generar SKUs correctamente
                },
            });

            // C. Crear el Rol de Super Administrador para la Empresa
            const role = await tx.roles.create({
                data: {
                    name: 'Super Administrador',
                    company_id: company.id,
                },
            });

            // D. Crear al Usuario Administrador y encriptar contraseña
            const hashedPassword = await bcrypt.hash(dto.userPassword, 10);
            const user = await tx.users.create({
                data: {
                    company_id: company.id,
                    name: dto.userName,
                    email: dto.userEmail,
                    password_hash: hashedPassword,
                },
            });

            // E. Relacionar Usuario con Sucursal
            await tx.user_branches.create({
                data: {
                    user_id: user.id,
                    branch_id: branch.id,
                },
            });

            // F. Relacionar Usuario con Rol
            await tx.user_roles.create({
                data: {
                    user_id: user.id,
                    role_id: role.id,
                },
            });

            // Devolver resumen
            return {
                company: { id: company.id, name: company.name },
                branch: { id: branch.id, name: branch.name },
                user: { id: user.id, email: user.email },
                message: 'Onboarding completado exitosamente',
            };
        });
    }

    async getMyCompany(companyId: string) {
        return this.prisma.companies.findUnique({
            where: { id: companyId },
            select: { id: true, name: true, document_number: true, phone: true, email: true, address: true },
        });
    }

    /** Datos de encabezado para la impresión de facturas (empresa + sucursal activa) */
    async getReceiptInfo(companyId: string, branchId?: string) {
        const [company, branch] = await Promise.all([
            this.prisma.companies.findUnique({
                where: { id: companyId },
                select: { name: true, document_number: true, address: true, phone: true },
            }),
            branchId
                ? this.prisma.branches.findFirst({
                    where: { id: branchId, company_id: companyId },
                    select: { name: true, address: true, phone: true },
                })
                : null,
        ]);

        return {
            company_name: company?.name ?? null,
            document_number: company?.document_number ?? null,
            branch_name: branch?.name ?? null,
            // La dirección de la sucursal identifica el punto de venta;
            // si no está registrada se usa la de la empresa
            address: branch?.address ?? company?.address ?? null,
            phone: branch?.phone ?? company?.phone ?? null,
        };
    }

    async updateMyCompany(companyId: string, dto: { name?: string; document_number?: string; phone?: string; address?: string }) {
        return this.prisma.companies.update({
            where: { id: companyId },
            data: dto,
            select: { id: true, name: true, document_number: true, phone: true, email: true, address: true },
        });
    }
}
