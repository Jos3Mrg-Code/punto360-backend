import { Injectable, OnModuleInit } from '@nestjs/common';
import { createSign } from 'crypto';

@Injectable()
export class QzSignService implements OnModuleInit {
  private privateKey: string;
  private certificate: string;

  onModuleInit() {
    // En producción se leen de variables de entorno; en local desde los archivos .pem
    this.privateKey = (process.env.QZ_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
    this.certificate = (process.env.QZ_CERTIFICATE ?? '').replace(/\\n/g, '\n');

    if (!this.privateKey || !this.certificate) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require('path');
        this.privateKey = fs.readFileSync(path.join(process.cwd(), 'qz-private.pem'), 'utf-8');
        this.certificate = fs.readFileSync(path.join(process.cwd(), 'qz-cert.pem'), 'utf-8');
      } catch {
        throw new Error('QZ_PRIVATE_KEY y QZ_CERTIFICATE no están configurados');
      }
    }
  }

  sign(message: string): string {
    const signer = createSign('SHA512');
    signer.update(message);
    return signer.sign(this.privateKey, 'base64');
  }

  getCertificate(): string {
    return this.certificate;
  }
}
