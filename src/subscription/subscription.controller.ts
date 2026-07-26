import { Controller, Post, Get, Body, Headers, UseGuards } from '@nestjs/common';
import { SubscriptionService, PLANS } from './subscription.service';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @Get('plans')
  getPlans() {
    return Object.entries(PLANS).map(([key, val]) => ({ key, ...val }));
  }

  @Get('status')
  @UseGuards(JwtGuard)
  getStatus(@ActiveUser() user: ActiveUserData) {
    return this.service.getStatus(user.companyId);
  }

  @Post('checkout')
  @UseGuards(JwtGuard)
  createCheckout(
    @ActiveUser() user: ActiveUserData,
    @Body('plan') plan: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL',
  ) {
    return this.service.createCheckout(user.companyId, plan);
  }

  @Post('webhook/wompi')
  handleWebhook(
    @Body() body: any,
    @Headers('x-event-checksum') signature: string,
  ) {
    return this.service.handleWompiWebhook(body, signature);
  }
}
