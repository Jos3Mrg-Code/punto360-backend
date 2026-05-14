import { Module } from '@nestjs/common';
import { ShopifyOAuthController } from './shopify-oauth.controller';

@Module({
  controllers: [ShopifyOAuthController],
})
export class ShopifyOAuthModule {}
