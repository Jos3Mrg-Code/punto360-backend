import { Module } from '@nestjs/common';
import { PublicApiController, ApiKeysController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PublicApiController, ApiKeysController],
  providers: [PublicApiService, ApiKeyGuard],
})
export class PublicApiModule {}
