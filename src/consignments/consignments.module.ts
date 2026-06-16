import { Module } from '@nestjs/common';
import { ConsignmentsService } from './consignments.service';
import { ConsignmentsController } from './consignments.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ConsignmentsController],
  providers: [ConsignmentsService],
})
export class ConsignmentsModule {}
