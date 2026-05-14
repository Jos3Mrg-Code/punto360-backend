import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey =
      request.headers['x-api-key'] ?? request.query['api_key'];

    if (!apiKey) {
      throw new UnauthorizedException('API key requerida');
    }

    const record = await this.prisma.api_keys.findUnique({
      where: { key: apiKey },
      select: { company_id: true, is_active: true },
    });

    if (!record || !record.is_active) {
      throw new UnauthorizedException('API key inválida o inactiva');
    }

    request.companyId = record.company_id;
    return true;
  }
}
