import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { AuthModule } from 'src/auth/auth.module';
import { PurchasesModule } from '../purchases/purchases.module';

@Module({
    imports: [AuthModule, PurchasesModule],
    controllers: [SuppliersController],
    providers: [SuppliersService],
})
export class SuppliersModule {}
