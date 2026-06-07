import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { PrintQueueService, AddQueueItemDto } from './print-queue.service';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('print-queue')
export class PrintQueueController {
    constructor(private readonly service: PrintQueueService) {}

    @Get()
    getQueue(@ActiveUser() user: ActiveUserData) {
        return this.service.getQueue(user);
    }

    @Post()
    addItems(@Body('items') items: AddQueueItemDto[], @ActiveUser() user: ActiveUserData) {
        return this.service.addItems(items, user);
    }

    @Delete('all')
    clearQueue(@ActiveUser() user: ActiveUserData) {
        return this.service.clearQueue(user);
    }

    @Delete(':id')
    removeItem(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.service.removeItem(id, user);
    }
}
