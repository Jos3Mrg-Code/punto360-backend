import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto, AddCustomerPaymentDto } from './dto/customer.dto';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('customers')
export class CustomersController {
    constructor(private readonly customersService: CustomersService) {}

    @Get()
    findAll(@ActiveUser() user: ActiveUserData) {
        return this.customersService.findAll(user);
    }

    @Get(':id')
    findOne(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.customersService.findOne(id, user);
    }

    @Get(':id/sales')
    getSales(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.customersService.getSales(id, user);
    }

    @Get('payments/all')
    getAllPayments(@ActiveUser() user: ActiveUserData) {
        return this.customersService.getAllPayments(user);
    }

    @Get(':id/payments')
    getPayments(@Param('id') id: string, @ActiveUser() user: ActiveUserData) {
        return this.customersService.getPayments(id, user);
    }

    @Post()
    create(@Body() dto: CreateCustomerDto, @ActiveUser() user: ActiveUserData) {
        return this.customersService.create(dto, user);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @ActiveUser() user: ActiveUserData) {
        return this.customersService.update(id, dto, user);
    }

    @Post(':id/payments')
    addPayment(@Param('id') id: string, @Body() dto: AddCustomerPaymentDto, @ActiveUser() user: ActiveUserData) {
        return this.customersService.addPayment(id, dto, user);
    }
}
