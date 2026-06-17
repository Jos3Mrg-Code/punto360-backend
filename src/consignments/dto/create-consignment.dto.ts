import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, Min, ArrayMinSize } from 'class-validator';

export class ConsignmentItemDto {
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
  consignorPrice: number;
}

export class CreateConsignmentDto {
  @IsString()
  consignorName: string;

  @IsOptional()
  @IsString()
  consignorPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConsignmentItemDto)
  items: ConsignmentItemDto[];
}
