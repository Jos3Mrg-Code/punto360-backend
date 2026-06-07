import { Controller, Post, Body, Get, Query, Put, Param, Delete } from '@nestjs/common';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import { SalesService } from './sales.service';
import { CreateSaleDto, HoldSaleDto, CompleteSaleDto } from './dto/create-sale.dto';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  createSale(
    @Body() dto: CreateSaleDto,
    @ActiveUser() user: ActiveUserData,
  ) {
    return this.salesService.createSale(dto, user);
  }

  @Get('stats')
  getSalesStats(@ActiveUser() user: ActiveUserData) {
    return this.salesService.getSalesStats(user);
  }

  @Get()
  getSalesHistory(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('saleType') saleType: string,
    @ActiveUser() user: ActiveUserData,
  ) {
    return this.salesService.getSalesHistory(startDate, endDate, user, saleType);
  }

  @Put(':id/cancel')
  cancelSale(
      @Param('id') id: string,
      @ActiveUser() user: ActiveUserData,
  ) {
      return this.salesService.cancelSale(id, user);
  }

  @Post('pending')
  holdSale(@Body() dto: HoldSaleDto, @ActiveUser() user: ActiveUserData) {
      return this.salesService.holdSale(dto, user);
  }

  @Get('pending')
  getPendingSales(@ActiveUser() user: ActiveUserData) {
      return this.salesService.getPendingSales(user);
  }

  @Post(':id/complete')
  completePendingSale(
      @Param('id') id: string,
      @Body() dto: CompleteSaleDto,
      @ActiveUser() user: ActiveUserData,
  ) {
      return this.salesService.completePendingSale(id, dto, user);
  }

  @Delete(':id/discard')
  discardPendingSale(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
      return this.salesService.discardPendingSale(id, user);
  }
}
