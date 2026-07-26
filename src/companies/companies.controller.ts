import { Controller, Post, Get, Patch, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { Public } from '../auth/decorators/public.decorator';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('companies')
export class CompaniesController {
    constructor(private readonly companiesService: CompaniesService) {}

    @Public()
    @Post('onboard')
    @HttpCode(HttpStatus.CREATED)
    async onboardTenant(@Body() createTenantDto: CreateTenantDto) {
        return this.companiesService.registerTenant(createTenantDto);
    }

    @Get('me')
    getMe(@ActiveUser() user: ActiveUserData) {
        return this.companiesService.getMyCompany(user.companyId);
    }

    @Patch('me')
    updateMe(@ActiveUser() user: ActiveUserData, @Body() dto: any) {
        return this.companiesService.updateMyCompany(user.companyId, dto);
    }
}
