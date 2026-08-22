import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SubscriptionService } from '../subscription/subscription.service';
import { EmailService } from '../email/email.service';


@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private subscriptionService: SubscriptionService,
    private emailService: EmailService,
  ) { }

  async login(dto: LoginDto) {
    const { email, password } = dto;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.users.findUnique({
      where: { email: normalizedEmail },
      include: {
        companies: true,
        user_branches: true,
        user_roles: {
          include: {
            roles: {
              include: {
                role_permissions: {
                  include: {
                    permissions: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Solo bloquear si la empresa tiene suscripción TRIAL (registradas con el nuevo flujo)
    // Las empresas legacy no tienen suscripción y pasan libremente
    const hasTrial = user.company_id ? await this.prisma.subscriptions.findFirst({
      where: { company_id: user.company_id, status: 'TRIAL' },
    }) : null;
    if (hasTrial && !(user.companies as any)?.email_verified) {
      throw new UnauthorizedException('Debes verificar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.');
    }

    const roles = user.user_roles.map(ur => ur.roles.name);

    const permissions = user.user_roles
      .flatMap(ur =>
        ur.roles.role_permissions.map(rp => rp.permissions.key),
      );

    const branchIds = user.user_branches.map(ub => ub.branch_id);

    const payload = {
      sub: user.id,
      email: user.email,
      userName: user.name,
      role: user.user_roles.length > 0 ? user.user_roles[0].roles.name : null,
      companyId: user.company_id,
      companyName: user.companies?.name || null,
      branchIds,
      permissions,
      saleTypeEnabled: (user.companies as any)?.sale_type_enabled ?? false,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const existing = await this.prisma.users.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new BadRequestException('Ya existe una cuenta con ese correo.');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const company = await this.prisma.companies.create({
      data: {
        name: dto.companyName,
        email: normalizedEmail,
        email_verified: false,
        trial_used: true,
      },
    });

    const branch = await this.prisma.branches.create({
      data: {
        company_id: company.id,
        name: dto.branchName?.trim() || 'Principal',
        address: '',
      },
    });

    const adminRole = await this.prisma.roles.findFirst({ where: { name: 'admin' } });

    const user = await this.prisma.users.create({
      data: {
        company_id: company.id,
        name: dto.name,
        email: normalizedEmail,
        password_hash: passwordHash,
        ...(adminRole ? {
          user_roles: { create: { role_id: adminRole.id } },
          user_branches: { create: { branch_id: branch.id } },
        } : {}),
      },
    });

    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.subscriptions.create({
      data: {
        company_id: company.id,
        plan: 'TRIAL',
        start_date: new Date(),
        end_date: trialEnd,
        amount: 0,
        status: 'TRIAL',
      },
    });

    await this.subscriptionService.sendVerificationEmail(normalizedEmail, dto.name);

    return { ok: true, message: 'Revisa tu correo para verificar tu cuenta.' };
  }

  async verifyEmail(token: string) {
    return this.subscriptionService.confirmEmail(token);
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.prisma.users.findUnique({ where: { email: normalizedEmail } });
    // Respuesta genérica para no revelar si el email existe
    if (!user) return { ok: true };

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await this.prisma.password_resets.create({
      data: { email: normalizedEmail, token, expires_at: expiresAt },
    });

    await this.emailService.sendPasswordResetEmail(normalizedEmail, token);
    return { ok: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.password_resets.findUnique({ where: { token } });
    if (!record) throw new BadRequestException('El enlace es inválido.');
    if (record.used_at) throw new BadRequestException('Este enlace ya fue usado.');
    if (new Date() > record.expires_at) throw new BadRequestException('El enlace expiró. Solicita uno nuevo.');

    const user = await this.prisma.users.findFirst({
      where: { email: { equals: record.email, mode: 'insensitive' } },
    });
    if (!user) throw new BadRequestException('No se encontró el usuario asociado.');

    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.users.update({
      where: { id: user.id },
      data: { password_hash: hash },
    });

    await this.prisma.password_resets.update({
      where: { token },
      data: { used_at: new Date() },
    });

    return { ok: true };
  }
}
