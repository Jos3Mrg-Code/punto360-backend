import { IsArray, IsNumber, IsString, IsOptional, ValidateNested, ArrayMinSize } from 'class-validator';
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

export class SalePaymentDto {
    @IsString()
    method: string;

    @IsNumber()
    amount: number;
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
    @IsArray()
    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => SalePaymentDto)
    payments?: SalePaymentDto[];

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
    @IsArray()
    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => SalePaymentDto)
    payments?: SalePaymentDto[];

    @IsOptional()
    @IsString()
    customerId?: string;
}
