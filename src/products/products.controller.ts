"use strict";
import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Put,
    Delete,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ImportProductsDto } from './dto/import-products.dto';
import { CreateAttributeDto, CreateVariantDto, UpdateVariantDto, UpdateVariantStockDto } from './dto/variant.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('products')
export class ProductsController {
    constructor(private readonly productsService: ProductsService) { }

    @Get('next-sku')
    getNextSku(@ActiveUser() user: ActiveUserData) {
        return this.productsService.getNextSku(user);
    }

    @Post(':id/migrate-variant-skus')
    migrateVariantSkus(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.migrateVariantSkus(id, user);
    }

    @Get('variant-by-sku/:sku')
    findVariantBySku(@Param('sku') sku: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.findVariantBySku(sku, user);
    }

    @Get('scan/:barcode')
    scanByBarcode(@Param('barcode') barcode: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.scanByBarcode(barcode, user);
    }

    @Post('import')
    importProducts(@Body() dto: ImportProductsDto, @ActiveUser() user: ActiveUserData) {
        return this.productsService.importProducts(dto, user);
    }

    @Get()
    findAll(@ActiveUser() user: ActiveUserData) {
        return this.productsService.findAll(user);
    }

    @Post()
    create(@Body() dto: CreateProductDto, @ActiveUser() user: ActiveUserData) {
        return this.productsService.create(dto, user);
    }

    @Patch(':id/toggle')
    toggleStatus(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.toggleStatus(id, user);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: CreateProductDto, @ActiveUser() user: ActiveUserData) {
        return this.productsService.update(id, dto, user);
    }

    // ── Atributos ──────────────────────────────────────────────────────────────

    @Get(':id/attributes')
    getAttributes(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.getAttributes(id, user);
    }

    @Post(':id/attributes')
    addAttribute(@Param('id') id: string, @Body() dto: CreateAttributeDto, @ActiveUser() user: ActiveUserData) {
        return this.productsService.addAttribute(id, dto, user);
    }

    @Delete(':id/attributes/:attrId')
    deleteAttribute(@Param('attrId') attrId: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.deleteAttribute(attrId, user);
    }

    // ── Variantes ──────────────────────────────────────────────────────────────

    @Get(':id/variants')
    getVariants(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.getVariants(id, user);
    }

    @Post(':id/variants/batch')
    createVariantsBatch(@Param('id') id: string, @Body('variants') variants: CreateVariantDto[], @ActiveUser() user: ActiveUserData) {
        return this.productsService.createVariantsBatch(id, variants, user);
    }

    @Post(':id/variants')
    createVariant(@Param('id') id: string, @Body() dto: CreateVariantDto, @ActiveUser() user: ActiveUserData) {
        return this.productsService.createVariant(id, dto, user);
    }

    @Put(':id/variants/:variantId')
    updateVariant(@Param('variantId') variantId: string, @Body() dto: UpdateVariantDto, @ActiveUser() user: ActiveUserData) {
        return this.productsService.updateVariant(variantId, dto, user);
    }

    @Patch(':id/variants/:variantId/stock')
    updateVariantStock(@Param('variantId') variantId: string, @Body() dto: UpdateVariantStockDto, @ActiveUser() user: ActiveUserData) {
        return this.productsService.updateVariantStock(variantId, dto, user);
    }

    @Delete(':id/variants/:variantId')
    deleteVariant(@Param('variantId') variantId: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.deleteVariant(variantId, user);
    }
}
