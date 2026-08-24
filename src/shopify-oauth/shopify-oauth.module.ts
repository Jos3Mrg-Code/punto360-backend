import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyOAuthController } from './shopify-oauth.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ShopifyOAuthController],
})
export class ShopifyOAuthModule {}
