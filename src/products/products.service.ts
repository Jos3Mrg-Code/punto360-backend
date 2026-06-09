import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ImportProductsDto } from './dto/import-products.dto';
import { CreateAttributeDto, CreateVariantDto, UpdateVariantDto, UpdateVariantStockDto } from './dto/variant.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class ProductsService {
    constructor(private prisma: PrismaService) { }

    async create(dto: CreateProductDto, user: ActiveUserData) {
        return this.prisma.$transaction(async (tx) => {

            // 1️⃣ Crear producto
            const product = await tx.products.create({
                data: {
                    name: dto.name,
                    sku: dto.sku,
                    category_id: dto.category_id,
                    cost_price: dto.cost_price,
                    sale_price: dto.sale_price,
                    unit_type: dto.unit_type || 'UNIT',
                    is_active: dto.is_active,
                    is_consignment: dto.is_consignment ?? false,
                    has_variants: dto.has_variants ?? false,
                    company_id: user.companyId,
                    barcode: dto.barcode || null,
                },
            });

            // 2️⃣ Crear stock inicial en la sucursal del usuario
            await tx.stock.create({
                data: {
                    product_id: product.id,
                    branch_id: user.branchIds[0],
                    quantity: dto.stock,
                },
            });

            return product;
        });
    }


    async getNextSku(user: ActiveUserData) {
        const branch = await this.prisma.branches.findUnique({
            where: { id: user.branchIds[0] },
        });

        if (!branch) {
            throw new Error('Sucursal no encontrada');
        }
        console.log(branch)
        const branchCode = branch.code || 'MAIN';

        const productsWithSku = await this.prisma.products.findMany({
            where: {
                company_id: user.companyId,
                sku: { startsWith: branchCode },
            },
            select: { sku: true },
        });

        let nextNumber = 1;

        if (productsWithSku.length > 0) {
            const numbers = productsWithSku
                .map(p => parseInt(p.sku.split('-').at(-1) ?? '0', 10))
                .filter(n => !isNaN(n));
            if (numbers.length > 0) {
                nextNumber = Math.max(...numbers) + 1;
            }
        }

        const formattedNumber = nextNumber.toString().padStart(4, '0');

        return {
            sku: `${branchCode}-${formattedNumber}`,
        };
    }

    async findAll(user: ActiveUserData) {
        return this.prisma.products.findMany({
            where: {
                company_id: user.companyId,
            },
            include: {
                categories: true,
                stock: {
                    where: { branch_id: { in: user.branchIds } }
                },
                product_variants: {
                    where: { is_active: { not: false } },
                    include: {
                        stock: {
                            where: { branch_id: { in: user.branchIds } }
                        }
                    }
                }
            },
            orderBy: {
                created_at: 'desc'
            }
        });
    }

    async toggleStatus(id: string, user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: {
                id,
                company_id: user.companyId
            }
        });

        if (!product) {
            throw new Error('Producto no encontrado o no pertenece a tu negocio');
        }

        return this.prisma.products.update({
            where: { id },
            data: { is_active: !product.is_active }
        });
    }

    async importProducts(dto: ImportProductsDto, user: ActiveUserData) {
        const branchId = user.branchIds?.[0];
        const created: string[] = [];
        const skipped: string[] = [];
        const errors: { ref: string; reason: string }[] = [];

        const categoryCache = new Map<string, string>();

        for (const item of dto.productos) {
            let sku = item.reference?.trim() || '';
            try {
                if (!sku) {
                    const next = await this.getNextSku(user);
                    sku = next.sku;
                }

                const catName = (item.categoria ?? 'General').trim();
                let categoryId = categoryCache.get(catName);

                if (!categoryId) {
                    let cat = await this.prisma.categories.findFirst({
                        where: { company_id: user.companyId, name: { equals: catName, mode: 'insensitive' } },
                    });
                    if (!cat) {
                        cat = await this.prisma.categories.create({
                            data: { company_id: user.companyId, name: catName },
                        });
                    }
                    categoryId = cat.id;
                    categoryCache.set(catName, cat.id);
                }

                const existing = await this.prisma.products.findUnique({
                    where: { company_id_sku: { company_id: user.companyId, sku } },
                });
                if (existing) {
                    skipped.push(sku);
                    continue;
                }

                const unitType = item.tipo_venta === 2 ? 'WEIGHT' : 'UNIT';

                const product = await this.prisma.products.create({
                    data: {
                        company_id: user.companyId,
                        category_id: categoryId,
                        name: item.nombre,
                        sku,
                        cost_price: item.precio_compra,
                        sale_price: item.precio_venta,
                        unit_type: unitType,
                        is_active: true,
                        is_consignment: false,
                    },
                });

                await this.prisma.stock.create({
                    data: { product_id: product.id, branch_id: branchId, quantity: item.stock },
                });

                created.push(sku);
            } catch (e: any) {
                errors.push({ ref: sku || item.nombre, reason: e?.message ?? 'Error desconocido' });
            }
        }

        return { created: created.length, skipped: skipped.length, errors, createdRefs: created, skippedRefs: skipped };
    }

    // ── Variantes ──────────────────────────────────────────────────────────────

    async getVariants(productId: string, user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: { id: productId, company_id: user.companyId },
        });
        if (!product) throw new NotFoundException('Producto no encontrado');

        return this.prisma.product_variants.findMany({
            where: { product_id: productId },
            include: {
                values: {
                    include: {
                        attribute_value: {
                            include: { attribute: true },
                        },
                    },
                },
                stock: {
                    where: { branch_id: { in: user.branchIds } },
                },
            },
            orderBy: { created_at: 'asc' },
        });
    }

    async addAttribute(productId: string, dto: CreateAttributeDto, user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: { id: productId, company_id: user.companyId },
        });
        if (!product) throw new NotFoundException('Producto no encontrado');

        const attr = await this.prisma.product_attributes.create({
            data: {
                product_id: productId,
                name: dto.name,
                values: {
                    create: dto.values.map((v, i) => ({ value: v, position: i })),
                },
            },
            include: { values: true },
        });

        if (!product.has_variants) {
            await this.prisma.products.update({
                where: { id: productId },
                data: { has_variants: true },
            });
        }

        return attr;
    }

    async addAttributeValue(productId: string, attrId: string, value: string, user: ActiveUserData) {
        const attr = await this.prisma.product_attributes.findFirst({
            where: { id: attrId, product_id: productId, products: { company_id: user.companyId } },
            include: { values: { orderBy: { position: 'asc' } } },
        });
        if (!attr) throw new NotFoundException('Atributo no encontrado');

        const nextPosition = attr.values.length;
        return this.prisma.attribute_values.create({
            data: { attribute_id: attrId, value, position: nextPosition },
        });
    }

    async getAttributes(productId: string, user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: { id: productId, company_id: user.companyId },
        });
        if (!product) throw new NotFoundException('Producto no encontrado');

        return this.prisma.product_attributes.findMany({
            where: { product_id: productId },
            include: { values: { orderBy: { position: 'asc' } } },
            orderBy: { position: 'asc' },
        });
    }

    async deleteAttribute(attributeId: string, user: ActiveUserData) {
        const attr = await this.prisma.product_attributes.findFirst({
            where: { id: attributeId, products: { company_id: user.companyId } },
            include: { products: { select: { id: true } } },
        });
        if (!attr) throw new NotFoundException('Atributo no encontrado');

        await this.prisma.product_attributes.delete({ where: { id: attributeId } });

        const remaining = await this.prisma.product_attributes.count({
            where: { product_id: attr.products.id },
        });
        if (remaining === 0) {
            await this.prisma.products.update({
                where: { id: attr.products.id },
                data: { has_variants: false },
            });
        }
        return { ok: true };
    }

    async createVariant(productId: string, dto: CreateVariantDto, user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: { id: productId, company_id: user.companyId },
        });
        if (!product) throw new NotFoundException('Producto no encontrado');

        const existing = await this.prisma.product_variants.findFirst({
            where: { products: { company_id: user.companyId }, sku: dto.sku },
        });
        if (existing) throw new BadRequestException(`El SKU "${dto.sku}" ya existe en otro producto de la tienda`);

        const branchId = user.branchIds[0];

        return this.prisma.product_variants.create({
            data: {
                product_id: productId,
                sku: dto.sku,
                barcode: dto.barcode || null,
                sale_price: dto.sale_price,
                cost_price: dto.cost_price ?? 0,
                is_default: dto.is_default ?? false,
                values: {
                    create: dto.attribute_value_ids.map(id => ({ attribute_value_id: id })),
                },
                stock: {
                    create: { branch_id: branchId, quantity: dto.stock ?? 0 },
                },
            },
            include: {
                values: { include: { attribute_value: { include: { attribute: true } } } },
                stock: true,
            },
        });
    }

    async createVariantsBatch(productId: string, dtos: CreateVariantDto[], user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: { id: productId, company_id: user.companyId },
        });
        if (!product) throw new NotFoundException('Producto no encontrado');

        const branchId = user.branchIds[0];

        // 1a. Detectar duplicados dentro del propio batch
        const batchSkuCount = dtos.reduce((acc, d) => { acc[d.sku] = (acc[d.sku] || 0) + 1; return acc; }, {} as Record<string, number>);
        const inBatchDups = Object.keys(batchSkuCount).filter(sku => batchSkuCount[sku] > 1);
        if (inBatchDups.length > 0) {
            return { created: 0, errors: inBatchDups.length, duplicateSkus: inBatchDups, variants: [] };
        }

        // 1b. Detectar SKUs que ya existen en cualquier producto de la empresa
        const existing = await this.prisma.product_variants.findMany({
            where: {
                products: { company_id: user.companyId },
                sku: { in: dtos.map(d => d.sku) },
            },
            select: { sku: true },
        });
        const existingSkus = new Set(existing.map(v => v.sku));
        const newDtos      = dtos.filter(d => !existingSkus.has(d.sku));
        const duplicateSkus = dtos.filter(d => existingSkus.has(d.sku)).map(d => d.sku);

        if (newDtos.length === 0) {
            return { created: 0, errors: duplicateSkus.length, duplicateSkus, variants: [] };
        }

        // 2. Bulk insert solo las variantes nuevas
        await this.prisma.product_variants.createMany({
            data: newDtos.map(dto => ({
                product_id: productId,
                sku: dto.sku,
                barcode: dto.barcode || null,
                sale_price: dto.sale_price,
                cost_price: dto.cost_price ?? 0,
                is_default: dto.is_default ?? false,
            })),
        });

        // 3. Obtener IDs de las variantes recién creadas
        const created = await this.prisma.product_variants.findMany({
            where: { product_id: productId, sku: { in: newDtos.map(d => d.sku) } },
        });
        const skuToId = Object.fromEntries(created.map(v => [v.sku, v.id]));

        // 4. Bulk insert stock + valores de atributos en paralelo
        await Promise.all([
            this.prisma.variant_stock.createMany({
                data: newDtos.map(dto => ({
                    variant_id: skuToId[dto.sku],
                    branch_id: branchId,
                    quantity: dto.stock ?? 0,
                })),
            }),
            this.prisma.variant_attribute_values.createMany({
                data: newDtos.flatMap(dto =>
                    dto.attribute_value_ids.map(avId => ({
                        variant_id: skuToId[dto.sku],
                        attribute_value_id: avId,
                    }))
                ),
            }),
        ]);

        return { created: created.length, errors: duplicateSkus.length, duplicateSkus, variants: created };
    }

    async updateVariant(variantId: string, dto: UpdateVariantDto, user: ActiveUserData) {
        const variant = await this.prisma.product_variants.findFirst({
            where: { id: variantId, products: { company_id: user.companyId } },
        });
        if (!variant) throw new NotFoundException('Variante no encontrada');

        return this.prisma.product_variants.update({
            where: { id: variantId },
            data: {
                ...(dto.sku !== undefined && { sku: dto.sku }),
                ...(dto.barcode !== undefined && { barcode: dto.barcode || null }),
                ...(dto.sale_price !== undefined && { sale_price: dto.sale_price }),
                ...(dto.cost_price !== undefined && { cost_price: dto.cost_price }),
                ...(dto.is_active !== undefined && { is_active: dto.is_active }),
            },
        });
    }

    async updateVariantStock(variantId: string, dto: UpdateVariantStockDto, user: ActiveUserData) {
        const variant = await this.prisma.product_variants.findFirst({
            where: { id: variantId, products: { company_id: user.companyId } },
        });
        if (!variant) throw new NotFoundException('Variante no encontrada');

        const branchId = user.branchIds[0];

        return this.prisma.variant_stock.upsert({
            where: { variant_id_branch_id: { variant_id: variantId, branch_id: branchId } },
            create: { variant_id: variantId, branch_id: branchId, quantity: dto.quantity },
            update: { quantity: dto.quantity, updated_at: new Date() },
        });
    }

    async deleteVariant(variantId: string, user: ActiveUserData) {
        const variant = await this.prisma.product_variants.findFirst({
            where: { id: variantId, products: { company_id: user.companyId } },
        });
        if (!variant) throw new NotFoundException('Variante no encontrada');

        await this.prisma.product_variants.delete({ where: { id: variantId } });
        return { ok: true };
    }

    async getAttributeTemplates(user: ActiveUserData) {
        return this.prisma.attribute_templates.findMany({
            where: { company_id: user.companyId },
            orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        });
    }

    async createAttributeTemplate(name: string, values: string[], user: ActiveUserData) {
        return this.prisma.attribute_templates.create({
            data: { company_id: user.companyId, name, values },
        });
    }

    async deleteAttributeTemplate(id: string, user: ActiveUserData) {
        await this.prisma.attribute_templates.deleteMany({
            where: { id, company_id: user.companyId },
        });
        return { ok: true };
    }

    async applyAttributeTemplates(productId: string, user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: { id: productId, company_id: user.companyId },
        });
        if (!product) throw new NotFoundException('Producto no encontrado');

        const templates = await this.prisma.attribute_templates.findMany({
            where: { company_id: user.companyId },
            orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        });

        const results = await Promise.allSettled(
            templates.map(t => this.prisma.product_attributes.create({
                data: {
                    product_id: productId,
                    name: t.name,
                    values: { create: t.values.map((v, i) => ({ value: v, position: i })) },
                },
                include: { values: true },
            }))
        );

        return results
            .filter(r => r.status === 'fulfilled')
            .map(r => (r as PromiseFulfilledResult<any>).value);
    }

    async getVariantMap(user: ActiveUserData) {
        const variants = await this.prisma.product_variants.findMany({
            where: {
                is_active: true,
                products: { company_id: user.companyId, is_active: true },
            },
            select: {
                id: true,
                sku: true,
                barcode: true,
                sale_price: true,
                product_id: true,
                products: { select: { name: true, unit_type: true } },
                stock: {
                    where: { branch_id: { in: user.branchIds } },
                    select: { quantity: true },
                },
                values: {
                    select: {
                        attribute_value: {
                            select: { value: true },
                        },
                    },
                },
            },
        });

        const map: Record<string, object> = {};
        for (const v of variants) {
            const entry = {
                id:          v.id,
                sku:         v.sku,
                sale_price:  Number(v.sale_price),
                product_id:  v.product_id,
                unit_type:   v.products.unit_type,
                stock:       Number(v.stock[0]?.quantity ?? 0),
                label:       v.values.map(x => x.attribute_value.value).join(" / "),
            };
            if (v.sku)     map[v.sku]     = entry;
            if (v.barcode) map[v.barcode] = entry;
        }
        return map;
    }

    async scanByBarcode(code: string, user: ActiveUserData) {
        // Busca producto y variante en paralelo; acepta tanto barcode como SKU
        const [product, variant] = await Promise.all([
            this.prisma.products.findFirst({
                where: {
                    company_id: user.companyId,
                    is_active: true,
                    OR: [{ barcode: code }, { sku: code }],
                },
                include: { stock: { where: { branch_id: { in: user.branchIds } } } },
            }),
            this.prisma.product_variants.findFirst({
                where: {
                    is_active: true,
                    OR: [{ barcode: code }, { sku: code }],
                    products: { company_id: user.companyId, is_active: true },
                },
                include: {
                    products: { select: { id: true, name: true, unit_type: true } },
                    values: { include: { attribute_value: { include: { attribute: true } } } },
                    stock: { where: { branch_id: { in: user.branchIds } } },
                },
            }),
        ]);

        if (variant) return { type: 'variant' as const, data: variant };
        if (product) return { type: 'product' as const, data: product };
        throw new NotFoundException('Código no encontrado');
    }

    async findVariantBySku(sku: string, user: ActiveUserData) {
        const variant = await this.prisma.product_variants.findFirst({
            where: {
                sku,
                products: { company_id: user.companyId, is_active: true },
                is_active: true,
            },
            include: {
                products: { select: { id: true, name: true, unit_type: true } },
                values: {
                    include: { attribute_value: { include: { attribute: true } } },
                },
                stock: { where: { branch_id: { in: user.branchIds } } },
            },
        });
        if (!variant) throw new NotFoundException('Variante no encontrada');
        return variant;
    }

    // Migra los SKU/barcode de variantes al formato corto imprimible
    async migrateVariantSkus(productId: string, user: ActiveUserData) {
        const stripAccents = (s: string) =>
            s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const shortCode = (baseSku: string, variantSku: string): string => {
            if (!variantSku.startsWith(baseSku + '-')) {
                return stripAccents(variantSku).replace(/[^A-Z0-9]/gi, '').slice(0, 11).toUpperCase();
            }
            const suffix = stripAccents(variantSku.slice(baseSku.length + 1));
            const baseparts = baseSku.split('-');
            const prefix = baseparts[0].slice(0, 3);
            const seq = parseInt(baseparts[baseparts.length - 1], 10) || 1;
            const suffixParts = suffix.split('-').filter(Boolean);
            const colorAbbr = (suffixParts[0] || '').slice(0, 4).toUpperCase();
            const size = (suffixParts[suffixParts.length - 1] || '').slice(0, 3).toUpperCase();
            return `${prefix}${seq}${colorAbbr}${size}`;
        };

        const products = await this.prisma.products.findMany({
            where: { id: productId, company_id: user.companyId, has_variants: true },
            include: { product_variants: { where: { is_active: { not: false } } } },
        });

        if (!products.length) throw new NotFoundException('Producto no encontrado o no tiene variantes');

        const updated: string[] = [];
        const skipped: string[] = [];

        for (const product of products) {
            const usedCodes = new Set<string>();
            for (const variant of product.product_variants) {
                // Solo migrar variantes cuyo SKU sigue el patrón largo "{productSku}-..."
                // Las que ya tienen formato corto o SKU personalizado se ignoran
                if (!variant.sku.startsWith(product.sku + '-')) {
                    skipped.push(`${variant.sku} (no sigue patrón largo, se omite)`);
                    continue;
                }

                let code = shortCode(product.sku, variant.sku);
                // Evitar duplicados dentro del mismo producto
                let attempt = 0;
                let finalCode = code;
                while (usedCodes.has(finalCode)) {
                    attempt++;
                    finalCode = `${code.slice(0, 10)}${attempt}`;
                }
                usedCodes.add(finalCode);

                try {
                    await this.prisma.product_variants.update({
                        where: { id: variant.id },
                        data: { sku: finalCode, barcode: finalCode },
                    });
                    updated.push(`${variant.sku} → ${finalCode}`);
                } catch {
                    skipped.push(`${variant.sku} (error al actualizar)`);
                }
            }
        }

        return { updated: updated.length, skipped: skipped.length, details: updated };
    }

    async update(id: string, dto: CreateProductDto, user: ActiveUserData) {
        const product = await this.prisma.products.findFirst({
            where: {
                id,
                company_id: user.companyId
            }
        });

        if (!product) {
            throw new Error('Producto no encontrado o no autorizado');
        }

        return this.prisma.products.update({
            where: { id },
            data: {
                name: dto.name,
                category_id: dto.category_id,
                cost_price: dto.cost_price,
                sale_price: dto.sale_price,
                unit_type: dto.unit_type || 'UNIT',
                is_active: dto.is_active,
                is_consignment: dto.is_consignment ?? false,
                has_variants: dto.has_variants ?? false,
                barcode: dto.barcode ?? null,
            }
        });
    }
}
