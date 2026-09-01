import { Controller, Get, Post, Put, Delete, Body, Query, Param } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { CreatePayableDto, UpdatePayableDto } from './dto/create-payable.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
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

    @Post('payable')
    @Permissions('purchases.manage')
    createPayable(
        @Body() dto: CreatePayableDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.createPayable(dto, user);
    }

    @Put(':id/payable')
    @Permissions('purchases.edit')
    updatePayable(
        @Param('id') id: string,
        @Body() dto: UpdatePayableDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.updatePayable(id, dto, user);
    }

    @Put(':id')
    @Permissions('purchases.edit')
    updatePurchase(
        @Param('id') id: string,
        @Body() dto: UpdatePurchaseDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.updatePurchase(id, dto, user);
    }

    @Delete(':id')
    @Permissions('purchases.edit')
    cancelPurchase(
        @Param('id') id: string,
        @Body('refund') refund: 'AUTO' | 'CREDIT' | undefined,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.purchasesService.cancelPurchase(id, user, refund === 'CREDIT' ? 'CREDIT' : 'AUTO');
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
