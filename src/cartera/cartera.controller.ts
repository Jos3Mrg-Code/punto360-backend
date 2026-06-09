import { Controller, Get, Post, Body } from '@nestjs/common';
import { CarteraService } from './cartera.service';
import { AddCarteraExpenseDto, AddCarteraIncomeDto, ConvertTransferDto } from './dto/cartera.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('cartera')
export class CarteraController {
    constructor(private readonly carteraService: CarteraService) {}

    @Get()
    getSummary(@ActiveUser() user: ActiveUserData) {
        return this.carteraService.getSummary(user);
    }

    @Post('expenses')
    addExpense(
        @Body() dto: AddCarteraExpenseDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.carteraService.addExpense(dto, user);
    }

    @Post('income')
    addIncome(
        @Body() dto: AddCarteraIncomeDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.carteraService.addIncome(dto, user);
    }

    @Post('convert')
    convertTransferToCash(
        @Body() dto: ConvertTransferDto,
        @ActiveUser() user: ActiveUserData,
    ) {
        return this.carteraService.convertTransferToCash(dto, user);
    }
}
