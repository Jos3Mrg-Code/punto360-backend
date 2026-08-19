import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ShopifySyncService } from './shopify-sync.service';

@Injectable()
export class ShopifySyncCron {
  private readonly logger = new Logger(ShopifySyncCron.name);

  /**
   * Evita que dos ejecuciones se solapen. Publicar un producto de 18 variantes
   * tarda ~10s por el límite de peticiones de Shopify, así que un lote puede
   * durar más que el intervalo del cron.
   */
  private procesandoCola = false;
  private sincronizandoStock = false;

  constructor(private sync: ShopifySyncService) {}

  /** Publica y retira lo que se haya encolado desde el inventario */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async procesarCola() {
    if (this.procesandoCola || !this.sync.config) return;
    this.procesandoCola = true;

    try {
      // Lotes pequeños: cada tarea puede costar decenas de peticiones a Shopify
      const jobs = await this.sync.takePending(5);
      if (!jobs.length) return;

      this.logger.log(`Procesando ${jobs.length} tarea(s) de Shopify`);
      for (const job of jobs) {
        await this.sync.processOne(job);
      }
    } catch (e: any) {
      this.logger.error(`Cola de Shopify: ${e?.message ?? e}`);
    } finally {
      this.procesandoCola = false;
    }
  }

  /**
   * Reconcilia el stock de lo ya publicado. Sin esto, una venta en el POS deja
   * a Shopify mostrando unidades que ya no existen y se vende lo que no hay.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sincronizarStock() {
    const cfg = this.sync.config;
    if (this.sincronizandoStock || !cfg) return;
    this.sincronizandoStock = true;

    try {
      const { checked, updated } = await this.sync.syncStock(cfg);
      if (updated) this.logger.log(`Stock sincronizado: ${updated} variantes de ${checked} productos`);
    } catch (e: any) {
      this.logger.error(`Sync de stock: ${e?.message ?? e}`);
    } finally {
      this.sincronizandoStock = false;
    }
  }
}
