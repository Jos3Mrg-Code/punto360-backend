import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyClient } from './shopify.client';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifySyncCron } from './shopify-sync.cron';

@Module({
  imports: [PrismaModule],
  providers: [ShopifyClient, ShopifySyncService, ShopifySyncCron],
  // ProductsModule lo usa para encolar al publicar desde el inventario
  exports: [ShopifySyncService],
})
export class ShopifySyncModule {}
