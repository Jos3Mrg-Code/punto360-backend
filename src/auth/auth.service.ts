import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';


@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
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
}
