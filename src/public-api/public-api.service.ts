import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PublicApiService {
  constructor(private prisma: PrismaService) {}

  async getProducts(companyId: string, branchId?: string) {
    const products = await this.prisma.products.findMany({
      where: { company_id: companyId, is_active: true },
      include: {
        categories: { select: { name: true } },
        stock: branchId
          ? { where: { branch_id: branchId } }
          : true,
        product_variants: {
          where: { is_active: true },
          include: {
            values: {
              include: {
                attribute_value: {
                  include: { attribute: { select: { name: true } } },
                },
              },
            },
            stock: branchId
              ? { where: { branch_id: branchId } }
              : true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return products.map((p) => this.formatProduct(p));
  }

  async getProduct(companyId: string, productId: string, branchId?: string) {
    const product = await this.prisma.products.findFirst({
      where: { id: productId, company_id: companyId, is_active: true },
      include: {
        categories: { select: { name: true } },
        stock: branchId
          ? { where: { branch_id: branchId } }
          : true,
        product_variants: {
          where: { is_active: true },
          include: {
            values: {
              include: {
                attribute_value: {
                  include: { attribute: { select: { name: true } } },
                },
              },
            },
            stock: branchId
              ? { where: { branch_id: branchId } }
              : true,
          },
        },
      },
    });

    if (!product) return null;
    return this.formatProduct(product);
  }

  private formatProduct(p: any) {
    const totalStock = p.stock.reduce(
      (sum: number, s: any) => sum + Number(s.quantity),
      0,
    );

    const variants = p.product_variants.map((v: any) => {
      const variantStock = v.stock.reduce(
        (sum: number, s: any) => sum + Number(s.quantity),
        0,
      );

      const attributes: Record<string, string> = {};
      for (const val of v.values) {
        attributes[val.attribute_value.attribute.name] =
          val.attribute_value.value;
      }

      return {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode ?? null,
        price: Number(v.sale_price),
        attributes,
        stock: variantStock,
        is_default: v.is_default,
      };
    });

    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? null,
      price: Number(p.sale_price),
      category: p.categories?.name ?? null,
      has_variants: p.has_variants,
      stock: totalStock,
      variants: p.has_variants ? variants : [],
    };
  }

  // --- Gestión de API Keys (requiere JWT) ---

  async createApiKey(companyId: string, name: string) {
    const key = this.generateKey();
    return this.prisma.api_keys.create({
      data: { company_id: companyId, key, name },
      select: { id: true, key: true, name: true, created_at: true },
    });
  }

  async listApiKeys(companyId: string) {
    return this.prisma.api_keys.findMany({
      where: { company_id: companyId },
      select: {
        id: true,
        name: true,
        is_active: true,
        created_at: true,
        key: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async revokeApiKey(companyId: string, keyId: string) {
    return this.prisma.api_keys.updateMany({
      where: { id: keyId, company_id: companyId },
      data: { is_active: false },
    });
  }

  async deleteApiKey(companyId: string, keyId: string) {
    return this.prisma.api_keys.deleteMany({
      where: { id: keyId, company_id: companyId },
    });
  }

  private generateKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'pk_';
    for (let i = 0; i < 40; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
