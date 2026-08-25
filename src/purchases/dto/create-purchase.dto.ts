import { Type } from 'class-transformer';
import {
    IsString, IsOptional, IsNumber, IsArray,
    ValidateNested, Min, ArrayMinSize, IsDateString, IsEnum
} from 'class-validator';

export class PurchaseItemDto {
    @IsString()
    productId: string;

    @IsOptional()
    @IsString()
    variantId?: string;

    @IsNumber()
    @Min(0.001)
    quantity: number;

    @IsNumber()
    @Min(0)
    cost: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    salePrice?: number;
}

export class CreatePurchaseDto {
    @IsOptional()
    @IsString()
    supplierId?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => PurchaseItemDto)
    items: PurchaseItemDto[];

    @IsNumber()
    @Min(0)
    total: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    paidAmount?: number;

    @IsOptional()
    @IsString()
    paymentMethod?: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string;

    @IsOptional()
    @IsString()
    paymentSource?: 'CASH' | 'CARTERA' | 'EXTERNAL';
}
