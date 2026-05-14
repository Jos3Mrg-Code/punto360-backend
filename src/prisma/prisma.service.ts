import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {

  async onModuleInit() {
    await this.$connect()
    await this.$executeRawUnsafe(`ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(6)`)
    await this.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id         UUID         NOT NULL DEFAULT uuid_generate_v4(),
        company_id UUID         NOT NULL,
        key        TEXT         NOT NULL,
        name       TEXT         NOT NULL,
        is_active  BOOLEAN      NOT NULL DEFAULT true,
        created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT api_keys_pkey PRIMARY KEY (id)
      )
    `)
    await this.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_key ON api_keys(key)`)
    await this.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_company_id_fkey') THEN
          ALTER TABLE api_keys ADD CONSTRAINT api_keys_company_id_fkey
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
        END IF;
      END $$
    `)
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
