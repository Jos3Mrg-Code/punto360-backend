import { Type } from 'class-transformer';
import {
    IsString, IsOptional, IsNumber, IsArray,
    ValidateNested, Min, IsDateString,
} from 'class-validator';

export class PayableItemDto {
    @IsOptional()
    @IsString()
    productId?: string;

    @IsOptional()
    @IsString()
    variantId?: string;

    /** Texto libre cuando la línea no enlaza a un producto del catálogo. */
    @IsOptional()
    @IsString()
    description?: string;

    @IsNumber()
    @Min(0.001)
    quantity: number;

    @IsNumber()
    @Min(0)
    cost: number;
}

export class PayablePaymentDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    /** Método informativo: CASH | CARD | TRANSFER. No mueve caja. */
    @IsOptional()
    @IsString()
    method?: string;

    @IsOptional()
    @IsDateString()
    date?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

/**
 * Factura por pagar ya existente (mercancía ya ingresada por otro medio).
 * No afecta stock, ni precios, ni caja/cartera.
 */
export class CreatePayableDto {
    @IsString()
    supplierId: string;

    /** Monto total. Requerido si no se envían ítems. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    total?: number;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PayableItemDto)
    items?: PayableItemDto[];

    @IsOptional()
    @IsString()
    invoiceNumber?: string;

    @IsOptional()
    @IsDateString()
    invoiceDate?: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    /** Abonos que la factura ya trae (pagados por fuera del sistema). */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PayablePaymentDto)
    payments?: PayablePaymentDto[];
}

export class UpdatePayableDto {
    @IsOptional()
    @IsString()
    supplierId?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    total?: number;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PayableItemDto)
    items?: PayableItemDto[];

    @IsOptional()
    @IsString()
    invoiceNumber?: string;

    @IsOptional()
    @IsDateString()
    invoiceDate?: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}
