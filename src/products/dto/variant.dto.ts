import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAttributeDto {
    @IsString()
    name: string;

    @IsArray()
    @IsString({ each: true })
    values: string[];
}

export class AddAttributeValueDto {
    @IsString()
    value: string;
}

export class CreateVariantDto {
    @IsString()
    sku: string;

    @IsString()
    @IsOptional()
    barcode?: string;

    @Type(() => Number)
    @IsNumber()
    sale_price: number;

    @Type(() => Number)
    @IsNumber()
    @IsOptional()
    cost_price?: number;

    @IsBoolean()
    @IsOptional()
    is_default?: boolean;

    @IsArray()
    @IsUUID('4', { each: true })
    attribute_value_ids: string[];

    @Type(() => Number)
    @IsNumber()
    @IsOptional()
    stock?: number;
}

export class UpdateVariantDto {
    @IsString()
    @IsOptional()
    sku?: string;

    @IsString()
    @IsOptional()
    barcode?: string;

    @Type(() => Number)
    @IsNumber()
    @IsOptional()
    sale_price?: number;

    @Type(() => Number)
    @IsNumber()
    @IsOptional()
    cost_price?: number;

    @IsBoolean()
    @IsOptional()
    is_active?: boolean;
}

export class UpdateVariantStockDto {
    @Type(() => Number)
    @IsNumber()
    quantity: number;
}
