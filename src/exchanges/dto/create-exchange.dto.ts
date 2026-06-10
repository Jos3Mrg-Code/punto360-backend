export class CreateExchangeDto {
  returnedProductId: string;
  returnedVariantId?: string;
  returnedQuantity: number;
  returnedPrice: number;

  newProductId: string;
  newVariantId?: string;
  newQuantity: number;
  newPrice: number;

  paymentMethod?: string;
  notes?: string;
}
