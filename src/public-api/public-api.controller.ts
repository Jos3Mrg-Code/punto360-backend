import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  NotFoundException,
  HttpCode,
} from '@nestjs/common';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './api-key.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Request } from 'express';

// Rutas públicas (protegidas con API Key, no JWT)
@Public()
@Controller('public-api')
export class PublicApiController {
  constructor(private readonly service: PublicApiService) {}

  @UseGuards(ApiKeyGuard)
  @Get('products')
  async getProducts(
    @Req() req: Request & { companyId: string },
    @Query('branch_id') branchId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '100',
  ) {
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit)));
    const products = await this.service.getProducts(req.companyId, branchId);
    const start = (pageNum - 1) * limitNum;
    const paginated = products.slice(start, start + limitNum);

    return {
      data: paginated,
      meta: {
        total: products.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(products.length / limitNum),
      },
    };
  }

  @UseGuards(ApiKeyGuard)
  @Get('products/:id')
  async getProduct(
    @Req() req: Request & { companyId: string },
    @Param('id') id: string,
    @Query('branch_id') branchId?: string,
  ) {
    const product = await this.service.getProduct(req.companyId, id, branchId);
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  // --- Gestión de API Keys (detrás de JWT normal) ---

  @Get('keys')
  async listKeys(@Req() req: any) {
    return this.service.listApiKeys(req.user.companyId);
  }

  @Post('keys')
  async createKey(@Req() req: any, @Body('name') name: string) {
    return this.service.createApiKey(req.user.companyId, name ?? 'Mi tienda');
  }

  @Patch('keys/:id/revoke')
  @HttpCode(200)
  async revokeKey(@Req() req: any, @Param('id') id: string) {
    await this.service.revokeApiKey(req.user.companyId, id);
    return { message: 'API key revocada' };
  }

  @Delete('keys/:id')
  @HttpCode(200)
  async deleteKey(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteApiKey(req.user.companyId, id);
    return { message: 'API key eliminada' };
  }
}
