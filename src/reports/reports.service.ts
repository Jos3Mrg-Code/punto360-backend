import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private parseDates(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('Formato de fecha inválido.');
    }

    // Colombia UTC-5: local midnight = 05:00 UTC, local 23:59:59 = next day 04:59:59 UTC
    start.setUTCHours(5, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCHours(4, 59, 59, 999);
    
    return { start, end };
  }

  /** Calcula Ingresos, Costos y Utilidad Bruta en un rango */
  async getFinancialSummary(startDate: string, endDate: string, user: ActiveUserData) {
    if (!user.branchIds || user.branchIds.length === 0) throw new BadRequestException('Sin sucursales asignadas.');

    const { start, end } = this.parseDates(startDate, endDate);

    const sales = await this.prisma.sales.findMany({
      where: {
        company_id: user.companyId,
        branch_id: { in: user.branchIds },
        created_at: { gte: start, lte: end },
        status: 'PAID',
      },
      include: {
        sale_items: {
          include: {
            products: { select: { cost_price: true } },
          },
        },
      },
    });

    let totalRevenue = 0;
    let totalCost = 0;

    for (const sale of sales) {
      totalRevenue += Number(sale.total);
      for (const item of sale.sale_items) {
        const cost = Number(item.products?.cost_price || 0);
        totalCost += cost * Number(item.quantity || 0);
      }
    }

    return {
      totalRevenue,
      totalCost,
      grossProfit: totalRevenue - totalCost,
      profitMargin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
      transactionCount: sales.length,
      averageTicket: sales.length > 0 ? totalRevenue / sales.length : 0,
    };
  }

  /** Obtiene la tendencia de ventas diaria */
  async getSalesTrend(startDate: string, endDate: string, user: ActiveUserData) {
    if (!user.branchIds || user.branchIds.length === 0) throw new BadRequestException('Sin sucursales asignadas.');

    const { start, end } = this.parseDates(startDate, endDate);

    const sales = await this.prisma.sales.findMany({
      where: {
        company_id: user.companyId,
        branch_id: { in: user.branchIds },
        created_at: { gte: start, lte: end },
        status: 'PAID',
      },
      select: { created_at: true, total: true },
      orderBy: { created_at: 'asc' },
    });

    const trendMap = new Map<string, { date: string; revenue: number; transactions: number }>();

    sales.forEach(s => {
      // Usar fecha local para el agrupamiento en el gráfico
      const d = s.created_at!;
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const existing = trendMap.get(dateKey) || { date: dateKey, revenue: 0, transactions: 0 };
      existing.revenue += Number(s.total);
      existing.transactions += 1;
      trendMap.set(dateKey, existing);
    });

    return Array.from(trendMap.values());
  }

  /** Productos más vendidos */
  async getTopProducts(startDate: string, endDate: string, user: ActiveUserData, limit = 10) {
    if (!user.branchIds || user.branchIds.length === 0) throw new BadRequestException('Sin sucursales asignadas.');

    const { start, end } = this.parseDates(startDate, endDate);

    const items = await this.prisma.sale_items.findMany({
      where: {
        sales: {
          company_id: user.companyId,
          branch_id: { in: user.branchIds },
          created_at: { gte: start, lte: end },
          status: 'PAID',
        },
      },
      include: {
        products: { select: { name: true, sku: true, cost_price: true } },
        variants: { select: { cost_price: true } },
      },
    });

    const productMap = new Map<string, { name: string; sku: string; quantity: number; revenue: number; cost: number }>();

    items.forEach(item => {
      const id = item.product_id!;
      if (!item.products) return;

      const qty = Number(item.quantity || 0);
      const costPrice = Number(item.variants?.cost_price ?? item.products.cost_price ?? 0);

      const existing = productMap.get(id) || { name: item.products.name, sku: item.products.sku, quantity: 0, revenue: 0, cost: 0 };
      existing.quantity += qty;
      existing.revenue += Number(item.subtotal || 0);
      existing.cost += costPrice * qty;
      productMap.set(id, existing);
    });

    return Array.from(productMap.values())
      .map(p => ({
        ...p,
        profit: p.revenue - p.cost,
        margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  /** Desglose por método de pago */
  async getPaymentMethods(startDate: string, endDate: string, user: ActiveUserData) {
    if (!user.branchIds?.length) throw new BadRequestException('Sin sucursales asignadas.');
    const { start, end } = this.parseDates(startDate, endDate);
    const sales = await this.prisma.sales.findMany({
      where: { company_id: user.companyId, branch_id: { in: user.branchIds }, created_at: { gte: start, lte: end }, status: 'PAID' },
      select: { payment_method: true, total: true },
    });
    const map = new Map<string, { method: string; total: number; count: number }>();
    const labels: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', CREDIT: 'Crédito' };
    sales.forEach(s => {
      const m = s.payment_method || 'CASH';
      const e = map.get(m) || { method: labels[m] || m, total: 0, count: 0 };
      e.total += Number(s.total); e.count += 1;
      map.set(m, e);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  /** Ventas por hora del día */
  async getSalesByHour(startDate: string, endDate: string, user: ActiveUserData) {
    if (!user.branchIds?.length) throw new BadRequestException('Sin sucursales asignadas.');
    const { start, end } = this.parseDates(startDate, endDate);
    const sales = await this.prisma.sales.findMany({
      where: { company_id: user.companyId, branch_id: { in: user.branchIds }, created_at: { gte: start, lte: end }, status: 'PAID' },
      select: { created_at: true, total: true },
    });
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${String(h).padStart(2,'0')}h`, revenue: 0, count: 0 }));
    sales.forEach(s => {
      const h = ((s.created_at!.getUTCHours() - 5) + 24) % 24; // UTC-5 Colombia
      hours[h].revenue += Number(s.total); hours[h].count += 1;
    });
    return hours;
  }

  /** Ventas por día de la semana */
  async getSalesByWeekday(startDate: string, endDate: string, user: ActiveUserData) {
    if (!user.branchIds?.length) throw new BadRequestException('Sin sucursales asignadas.');
    const { start, end } = this.parseDates(startDate, endDate);
    const sales = await this.prisma.sales.findMany({
      where: { company_id: user.companyId, branch_id: { in: user.branchIds }, created_at: { gte: start, lte: end }, status: 'PAID' },
      select: { created_at: true, total: true },
    });
    const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((label, i) => ({ day: label, index: i, revenue: 0, count: 0 }));
    sales.forEach(s => {
      const localMs = s.created_at!.getTime() - 5 * 60 * 60 * 1000; // UTC-5 Colombia
      const d = new Date(localMs).getUTCDay();
      days[d].revenue += Number(s.total); days[d].count += 1;
    });
    return days;
  }

  /** Top clientes por compras */
  async getTopCustomers(startDate: string, endDate: string, user: ActiveUserData, limit = 10) {
    if (!user.branchIds?.length) throw new BadRequestException('Sin sucursales asignadas.');
    const { start, end } = this.parseDates(startDate, endDate);
    const sales = await this.prisma.sales.findMany({
      where: { company_id: user.companyId, branch_id: { in: user.branchIds }, created_at: { gte: start, lte: end }, status: 'PAID', customer_id: { not: null } },
      select: { customer_id: true, total: true, customers: { select: { name: true } } },
    });
    const map = new Map<string, { name: string; total: number; tickets: number }>();
    sales.forEach(s => {
      const id = s.customer_id!;
      const e = map.get(id) || { name: s.customers?.name || 'Desconocido', total: 0, tickets: 0 };
      e.total += Number(s.total); e.tickets += 1;
      map.set(id, e);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, limit);
  }

  /** KPIs de inventario */
  async getInventoryKpis(user: ActiveUserData) {
    if (!user.branchIds?.length) throw new BadRequestException('Sin sucursales asignadas.');

    const [simpleStock, variantStock, totalProducts] = await Promise.all([
      this.prisma.stock.findMany({
        where: { branches: { company_id: user.companyId } },
        include: { products: { select: { cost_price: true, has_variants: true, is_active: true, is_consignment: true } } },
      }),
      this.prisma.variant_stock.findMany({
        where: { branches: { company_id: user.companyId } },
        include: { variants: { select: { cost_price: true } } },
      }),
      this.prisma.products.count({ where: { company_id: user.companyId, is_active: true } }),
    ]);

    let totalValue = 0; let lowStock = 0; let outOfStock = 0;

    simpleStock.forEach(s => {
      const p = s.products;
      if (!p || p.has_variants || !p.is_active || p.is_consignment) return;
      const qty = Number(s.quantity);
      totalValue += qty * Number(p.cost_price);
      if (qty === 0) outOfStock++; else if (qty <= 3) lowStock++;
    });

    variantStock.forEach(s => {
      totalValue += Number(s.quantity) * Number(s.variants.cost_price);
    });

    return { totalValue, lowStock, outOfStock, totalProducts };
  }

  /** Ventas por categoría */
  async getCategoryStats(startDate: string, endDate: string, user: ActiveUserData) {
    if (!user.branchIds || user.branchIds.length === 0) throw new BadRequestException('Sin sucursales asignadas.');

    const { start, end } = this.parseDates(startDate, endDate);

    const items = await this.prisma.sale_items.findMany({
      where: {
        sales: {
          company_id: user.companyId,
          branch_id: { in: user.branchIds },
          created_at: { gte: start, lte: end },
          status: 'PAID',
        },
      },
      include: {
        products: {
            include: { categories: { select: { name: true } } }
        },
      },
    });

    const categoryMap = new Map<string, { category: string; revenue: number; quantity: number }>();

    items.forEach(item => {
      const catName = item.products?.categories?.name || 'Varios';
      const existing = categoryMap.get(catName) || { category: catName, revenue: 0, quantity: 0 };
      existing.revenue += Number(item.subtotal || 0);
      existing.quantity += Number(item.quantity || 0);
      categoryMap.set(catName, existing);
    });

    return Array.from(categoryMap.values());
  }
}
