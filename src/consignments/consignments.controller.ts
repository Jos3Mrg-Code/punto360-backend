import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { ConsignmentsService } from './consignments.service';
import { CreateConsignmentDto } from './dto/create-consignment.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('consignments')
export class ConsignmentsController {
  constructor(private readonly service: ConsignmentsService) {}

  @Get()
  getConsignments(@ActiveUser() user: ActiveUserData) {
    return this.service.getConsignments(user);
  }

  @Get('consignors')
  getConsignors(@ActiveUser() user: ActiveUserData) {
    return this.service.getConsignors(user);
  }

  @Post()
  createConsignment(@Body() dto: CreateConsignmentDto, @ActiveUser() user: ActiveUserData) {
    return this.service.createConsignment(dto, user);
  }

  @Delete(':id')
  cancelConsignment(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
    return this.service.cancelConsignment(id, user);
  }
}
