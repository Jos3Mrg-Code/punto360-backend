import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { QzSignService } from './qz-sign.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('qz')
export class QzSignController {
  constructor(private readonly qzSignService: QzSignService) {}

  @Public()
  @Post('sign')
  @HttpCode(200)
  sign(@Body('request') request: string): { signature: string } {
    return { signature: this.qzSignService.sign(request) };
  }

  @Public()
  @Post('certificate')
  @HttpCode(200)
  certificate(): { certificate: string } {
    return { certificate: this.qzSignService.getCertificate() };
  }
}
