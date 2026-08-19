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

    const rows = await this.prisma.$queryRaw<
      { company_id: string; publish_mode: string }[]
    >`
      SELECT company_id, publish_mode FROM api_keys
      WHERE key = ${apiKey} AND is_active = true
      LIMIT 1
    `;

    if (!rows.length) {
      throw new UnauthorizedException('API key inválida o inactiva');
    }

    request.companyId = rows[0].company_id;
    // ALL = expone todo el catálogo (integraciones antiguas)
    // SELECTED = solo los productos marcados para publicar
    request.publishMode = rows[0].publish_mode ?? 'ALL';
    return true;
  }
}
