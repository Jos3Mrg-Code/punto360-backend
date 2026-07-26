import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SubscriptionService } from '../../subscription/subscription.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private subscriptionService: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.companyId) return true;

    const active = await this.subscriptionService.hasActiveAccess(user.companyId);
    if (!active) {
      throw new HttpException(
        { statusCode: 402, message: 'Suscripción expirada. Renueva tu plan en /planes.' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}
