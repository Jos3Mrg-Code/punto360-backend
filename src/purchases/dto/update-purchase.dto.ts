import { Type } from 'class-transformer';
import {
    IsString, IsOptional, IsNumber, IsArray,
    ValidateNested, Min, ArrayMinSize, IsDateString,
} from 'class-validator';

export class UpdatePurchaseItemDto {
    @IsString()
    productId: string;

    @IsOptional()
    @IsString()
    variantId?: string;

    /** Nombre nuevo para el producto maestro (opcional). Renombra products.name. */
    @IsOptional()
    @IsString()
    productName?: string;

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

export class UpdatePurchaseDto {
    @IsOptional()
    @IsString()
    supplierId?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => UpdatePurchaseItemDto)
    items: UpdatePurchaseItemDto[];

    @IsOptional()
    @IsDateString()
    dueDate?: string;
}
