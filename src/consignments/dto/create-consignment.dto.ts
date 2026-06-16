export class CreateConsignmentDto {
  consignorName: string;
  consignorPhone?: string;
  notes?: string;
  items: {
    productId: string;
    variantId?: string;
    quantity: number;
    consignorPrice: number; // precio a pagarle al consignador por unidad vendida
  }[];
}
