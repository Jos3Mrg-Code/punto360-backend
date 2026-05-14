import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {

  async onModuleInit() {
    await this.$connect()
    await this.$executeRawUnsafe(`ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(6)`)
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
