import { Module } from '@nestjs/common';
import { PrintQueueController } from './print-queue.controller';
import { PrintQueueService } from './print-queue.service';

@Module({
    controllers: [PrintQueueController],
    providers: [PrintQueueService],
})
export class PrintQueueModule {}
