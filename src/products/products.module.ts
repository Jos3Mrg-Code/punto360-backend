import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ShopifySyncModule } from '../shopify-sync/shopify-sync.module';

@Module({
  imports: [ShopifySyncModule],
  controllers: [ProductsController],
  providers: [ProductsService]
})
export class ProductsModule {}
