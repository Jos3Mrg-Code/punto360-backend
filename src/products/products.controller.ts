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
import { AddAttributeValueDto, CreateAttributeDto, CreateVariantDto, UpdateAttributeValueDto, UpdateVariantDto, UpdateVariantStockDto } from './dto/variant.dto';
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

    @Get('variant-map')
    getVariantMap(@ActiveUser() user: ActiveUserData) {
        return this.productsService.getVariantMap(user);
    }

    @Get('attribute-templates')
    getAttributeTemplates(@ActiveUser() user: ActiveUserData) {
        return this.productsService.getAttributeTemplates(user);
    }

    @Post('attribute-templates')
    createAttributeTemplate(
        @Body('name') name: string,
        @Body('values') values: string[],
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.productsService.createAttributeTemplate(name, values, user);
    }

    @Delete('attribute-templates/:id')
    deleteAttributeTemplate(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.deleteAttributeTemplate(id, user);
    }

    @Post(':id/apply-templates')
    applyAttributeTemplates(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.productsService.applyAttributeTemplates(id, user);
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

    @Patch('publish-bulk')
    setPublishedBulk(
        @Body() body: { ids: string[]; is_published: boolean },
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.productsService.setPublishedBulk(body.ids, body.is_published, user);
    }

    @Patch(':id/publish')
    setPublished(
        @Param('id') id: string,
        @Body() body: { is_published: boolean },
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.productsService.setPublished(id, body.is_published, user);
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

    @Patch('attribute-values/:valueId')
    updateAttributeValue(
        @Param('valueId') valueId: string,
        @Body() dto: UpdateAttributeValueDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.productsService.updateAttributeValue(valueId, dto.value, user);
    }

    @Post(':id/attributes/:attrId/values')
    addAttributeValue(
        @Param('id') id: string,
        @Param('attrId') attrId: string,
        @Body() dto: AddAttributeValueDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.productsService.addAttributeValue(id, attrId, dto.value, user);
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
