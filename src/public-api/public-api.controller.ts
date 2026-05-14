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

// Endpoints de catálogo — públicos, autenticados por API Key
@Public()
@UseGuards(ApiKeyGuard)
@Controller('public-api')
export class PublicApiController {
  constructor(private readonly service: PublicApiService) {}

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
}

// Gestión de API Keys — protegido por JWT normal
@Controller('public-api/keys')
export class ApiKeysController {
  constructor(private readonly service: PublicApiService) {}

  @Get()
  async listKeys(@Req() req: any) {
    try {
      return await this.service.listApiKeys(req.user.companyId);
    } catch (e: any) {
      return { debug_error: e.message, meta: e.meta };
    }
  }

  @Post()
  async createKey(@Req() req: any, @Body('name') name: string) {
    return this.service.createApiKey(req.user.companyId, name ?? 'Mi tienda');
  }

  @Patch(':id/revoke')
  @HttpCode(200)
  async revokeKey(@Req() req: any, @Param('id') id: string) {
    await this.service.revokeApiKey(req.user.companyId, id);
    return { message: 'API key revocada' };
  }

  @Delete(':id')
  @HttpCode(200)
  async deleteKey(@Req() req: any, @Param('id') id: string) {
    await this.service.deleteApiKey(req.user.companyId, id);
    return { message: 'API key eliminada' };
  }
}
