import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateExchangeDto {
  @IsOptional()
  @IsBoolean()
  isExternalReturn?: boolean;

  @IsOptional()
  @IsUUID()
  returnedProductId?: string;

  @IsOptional()
  @IsUUID()
  returnedVariantId?: string;

  @IsOptional()
  @IsString()
  returnedProductName?: string;

  @IsNumber()
  returnedQuantity: number;

  @IsNumber()
  returnedPrice: number;

  @IsOptional()
  @IsUUID()
  newProductId?: string;

  @IsOptional()
  @IsUUID()
  newVariantId?: string;

  @IsOptional()
  @IsNumber()
  newQuantity?: number;

  @IsOptional()
  @IsNumber()
  newPrice?: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
