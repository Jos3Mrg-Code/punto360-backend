import { Controller, Get, Post, Delete, Body, Query, Param, ParseFloatPipe } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('purchases')
export class PurchasesController {
    constructor(private readonly purchasesService: PurchasesService) {}

    @Get()
    getPurchases(
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.getPurchases(startDate, endDate, user);
    }

    @Post()
    createPurchase(
        @Body() dto: CreatePurchaseDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.createPurchase(dto, user);
    }

    @Get('debts')
    getDebts(@ActiveUser() user: ActiveUserData) {
        return this.purchasesService.getSupplierDebts(user);
    }

    @Delete(':id')
    cancelPurchase(
        @Param('id') id: string,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.cancelPurchase(id, user);
    }

    @Post(':id/payments')
    addPayment(
        @Param('id') id: string,
        @Body('amount') amount: number,
        @Body('method') method: string,
        @Body('paymentSource') paymentSource: string,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.addPayment(id, amount, method, paymentSource, user);
    }
}
