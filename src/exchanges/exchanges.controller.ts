import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ExchangesService } from './exchanges.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

@Controller('exchanges')
@UseGuards(PermissionsGuard)
export class ExchangesController {
  constructor(private readonly exchangesService: ExchangesService) {}

  @Post()
  @Permissions('pos.access')
  createExchange(@Body() dto: CreateExchangeDto, @ActiveUser() user: ActiveUserData) {
    return this.exchangesService.createExchange(dto, user);
  }

  @Get()
  @Permissions('pos.access')
  getExchanges(@ActiveUser() user: ActiveUserData) {
    return this.exchangesService.getExchanges(user);
  }
}
