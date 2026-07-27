import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend: Resend | null = null;
  private readonly from = process.env.RESEND_FROM || 'noreply@punto360.co';
  private readonly logger = new Logger(EmailService.name);

  private getResend(): Resend {
    if (!this.resend) {
      const key = process.env.RESEND_API_KEY;
      if (!key) { this.logger.warn('RESEND_API_KEY no configurada — emails desactivados'); return null as any; }
      this.resend = new Resend(key);
    }
    return this.resend;
  }

  async sendVerificationEmail(email: string, name: string, token: string) {
    const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    await this.getResend()?.emails.send({
      from: this.from,
      to: email,
      subject: 'Verifica tu correo — Punto 360',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
          <h2 style="color:#e91e8c">¡Bienvenido a Punto 360, ${name}!</h2>
          <p>Para activar tu cuenta y comenzar tu prueba gratuita de <strong>7 días</strong>, verifica tu correo electrónico:</p>
          <a href="${url}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
            Verificar correo
          </a>
          <p style="color:#666;font-size:13px">Este enlace expira en 24 horas. Si no creaste una cuenta, ignora este correo.</p>
        </div>
      `,
    }).catch(e => this.logger.error('Error sending verification email', e));
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const url = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await this.getResend()?.emails.send({
      from: this.from,
      to: email,
      subject: 'Restablecer contraseña — Punto 360',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
          <h2 style="color:#e91e8c">Restablecer contraseña</h2>
          <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Punto 360.</p>
          <a href="${url}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
            Crear nueva contraseña
          </a>
          <p style="color:#666;font-size:13px">Este enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.</p>
        </div>
      `,
    }).catch(e => this.logger.error('Error sending password reset email', e));
  }

  async sendTrialExpiringEmail(email: string, name: string, daysLeft: number) {
    const url = `${process.env.FRONTEND_URL}/planes`;
    await this.getResend()?.emails.send({
      from: this.from,
      to: email,
      subject: `Tu prueba de Punto 360 vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
          <h2 style="color:#e91e8c">Tu prueba vence pronto</h2>
          <p>Hola ${name}, tu prueba gratuita de Punto 360 vence en <strong>${daysLeft} día${daysLeft !== 1 ? 's' : ''}</strong>.</p>
          <p>Para seguir usando el sistema sin interrupciones, elige tu plan:</p>
          <a href="${url}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#e91e8c;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
            Ver planes
          </a>
        </div>
      `,
    }).catch(e => this.logger.error('Error sending trial expiring email', e));
  }
}
