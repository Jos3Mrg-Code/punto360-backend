import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { BranchesModule } from './branches/branches.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { ExpensesModule } from './expenses/expenses.module';
import { CashModule } from './cash/cash.module';
import { ReportsModule } from './reports/reports.module';
import { PrismaModule } from './prisma/prisma.module'
import { APP_GUARD } from '@nestjs/core';
import { JwtGuard } from './auth/guards/jwt.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { ConfigModule } from '@nestjs/config';
import { PermissionsGuard } from './auth/guards/permissions.guard'
import { CategoriesModule } from './categories/categories.module';
import { CashRegistersModule } from './cash-registers/cash-registers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { RolesModule } from './roles/roles.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SuperAdminModule } from './superadmin/superadmin.module';
import { CustomersModule } from './customers/customers.module';
import { CarteraModule } from './cartera/cartera.module';
import { PublicApiModule } from './public-api/public-api.module';
import { ShopifyOAuthModule } from './shopify-oauth/shopify-oauth.module';
import { PrintQueueModule } from './print-queue/print-queue.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, CompaniesModule, BranchesModule, ProductsModule, InventoryModule, SalesModule, ExpensesModule, CashModule, ReportsModule,
    ConfigModule.forRoot({ isGlobal: true }),
    CategoriesModule,
    CashRegistersModule,
    SuppliersModule,
    PurchasesModule,
    RolesModule,
    NotificationsModule,
    SuperAdminModule,
    CustomersModule,
    CarteraModule,
    PublicApiModule,
    ShopifyOAuthModule,
    PrintQueueModule,
  ],
  controllers: [AppController],
  providers: [AppService,
    {
      provide: APP_GUARD,
      useClass: JwtGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    }],
})
export class AppModule { }
