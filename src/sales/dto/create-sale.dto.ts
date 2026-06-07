import { IsArray, IsNumber, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SaleItemDto {
    @IsString()
    productId: string;

    @IsString()
    @IsOptional()
    variantId?: string;

    @IsNumber()
    quantity: number;

    @IsNumber()
    price: number;
}

export class CreateSaleDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SaleItemDto)
    items: SaleItemDto[];

    @IsString()
    paymentMethod: string;

    @IsNumber()
    total: number;

    @IsOptional()
    @IsString()
    customerId?: string;

    @IsOptional()
    @IsString()
    saleType?: string;
}

export class HoldSaleDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SaleItemDto)
    items: SaleItemDto[];

    @IsNumber()
    total: number;
}

export class CompleteSaleDto {
    @IsString()
    paymentMethod: string;

    @IsOptional()
    @IsString()
    customerId?: string;
}
