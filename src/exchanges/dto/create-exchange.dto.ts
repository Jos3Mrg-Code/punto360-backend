export class CreateExchangeDto {
  // Returned product — either from system or free text
  isExternalReturn?: boolean;        // true = product not in system
  returnedProductId?: string;        // required if !isExternalReturn
  returnedVariantId?: string;
  returnedProductName?: string;      // required if isExternalReturn
  returnedQuantity: number;
  returnedPrice: number;

  // New product (always from system)
  newProductId: string;
  newVariantId?: string;
  newQuantity: number;
  newPrice: number;

  paymentMethod?: string;
  notes?: string;
}
