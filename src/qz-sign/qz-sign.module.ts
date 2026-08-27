import { Module } from '@nestjs/common';
import { QzSignController } from './qz-sign.controller';
import { QzSignService } from './qz-sign.service';

@Module({
  controllers: [QzSignController],
  providers: [QzSignService],
})
export class QzSignModule {}
