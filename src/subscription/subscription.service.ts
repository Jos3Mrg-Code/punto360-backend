import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as crypto from 'crypto';
import axios from 'axios';

export const PLANS = {
  MONTHLY:   { label: 'Mensual',     price: 170000, days: 30  },
  QUARTERLY: { label: 'Trimestral',  price: 450000, days: 90  },
  ANNUAL:    { label: 'Anual',       price: 1500000, days: 365 },
};

@Injectable()
export class SubscriptionService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  /** Enviar correo de verificación al registrarse */
  async sendVerificationEmail(emailAddr: string, name: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.email_verifications.create({
      data: { email: emailAddr, token, expires_at: expiresAt },
    });

    await this.email.sendVerificationEmail(emailAddr, name, token);
    return { ok: true };
  }

  /** Confirmar token de verificación y activar empresa + trial */
  async confirmEmail(token: string) {
    const record = await this.prisma.email_verifications.findUnique({ where: { token } });
    if (!record) throw new BadRequestException('Token inválido.');
    if (record.verified_at) throw new BadRequestException('Token ya usado.');
    if (new Date() > record.expires_at) throw new BadRequestException('Token expirado.');

    await this.prisma.email_verifications.update({
      where: { token },
      data: { verified_at: new Date() },
    });

    // Marcar empresa como verificada
    await this.prisma.companies.updateMany({
      where: { email: record.email },
      data: { email_verified: true },
    });

    return { ok: true, email: record.email };
  }

  /** Estado de suscripción de una empresa */
  async getStatus(companyId: string) {
    const company = await this.prisma.companies.findUnique({
      where: { id: companyId },
      select: { email_verified: true, trial_used: true },
    });

    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: companyId },
      orderBy: { created_at: 'desc' },
    });

    const now = new Date();
    if (!sub) return { status: 'NO_SUBSCRIPTION', active: false, plan: null, daysLeft: 0 };

    const daysLeft = Math.max(0, Math.ceil((sub.end_date.getTime() - now.getTime()) / 86400000));
    const active = sub.status !== 'EXPIRED' && now < sub.end_date;

    return {
      status: sub.status,
      plan: sub.plan,
      active,
      daysLeft,
      endDate: sub.end_date,
      emailVerified: company?.email_verified ?? false,
    };
  }

  /** Crear link de pago en Wompi */
  async createCheckout(companyId: string, plan: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL') {
    const planData = PLANS[plan];
    if (!planData) throw new BadRequestException('Plan inválido.');

    const reference = `P360-${companyId.split('-')[0]}-${plan}-${Date.now()}`;
    const amountInCents = planData.price * 100;

    const wompiBase = process.env.WOMPI_BASE_URL || 'https://sandbox.wompi.co/v1';
    const { data } = await axios.post(
      `${wompiBase}/payment_links`,
      {
        name: `Punto 360 — Plan ${planData.label}`,
        description: `Suscripción ${planData.label} a Punto 360 POS`,
        single_use: true,
        collect_shipping: false,
        currency: 'COP',
        amount_in_cents: amountInCents,
        redirect_url: `${process.env.FRONTEND_URL}/pago-exitoso`,
        reference,
      },
      { headers: { Authorization: `Bearer ${process.env.WOMPI_PRV_KEY}` } },
    ).catch(e => { throw new BadRequestException('Error creando link de pago: ' + e.message); });

    return {
      checkoutUrl: `https://checkout.wompi.co/l/${data.data.id}`,
      reference,
      plan,
      amount: planData.price,
    };
  }

  /** Webhook de Wompi — activa la suscripción al confirmar pago */
  async handleWompiWebhook(body: any, signature: string) {
    // Validar firma
    const eventKey = process.env.WOMPI_EVENTS_KEY || '';
    const { event, data, sent_at, timestamp } = body;
    const checksum = crypto
      .createHash('sha256')
      .update(`${data?.transaction?.id}${timestamp}${eventKey}`)
      .digest('hex');

    if (checksum !== signature) throw new UnauthorizedException('Firma inválida');
    if (event !== 'transaction.updated') return { ok: true };

    const tx = data?.transaction;
    if (tx?.status !== 'APPROVED') return { ok: true };

    const reference: string = tx.reference || '';
    const parts = reference.split('-');
    if (!parts[1]) return { ok: true };

    const planKey = parts[2] as 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
    const planData = PLANS[planKey];
    if (!planData) return { ok: true };

    // Buscar empresa por el prefijo del ID en la referencia
    const companies = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM companies WHERE id::text LIKE ${parts[1] + '%'} LIMIT 1
    `;
    if (!companies.length) return { ok: true };
    const companyId = companies[0].id;

    const now = new Date();
    const endDate = new Date(now.getTime() + planData.days * 86400000);

    await this.prisma.subscriptions.create({
      data: {
        company_id: companyId,
        plan: planKey,
        start_date: now,
        end_date: endDate,
        amount: planData.price,
        status: 'ACTIVE',
        wompi_transaction_id: tx.id,
        wompi_reference: reference,
      },
    });

    return { ok: true };
  }

  /** Verificar si una empresa tiene acceso activo (para el guard) */
  async hasActiveAccess(companyId: string): Promise<boolean> {
    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: companyId },
      orderBy: { created_at: 'desc' },
    });
    // Sin registro = cliente legacy anterior al sistema de suscripciones → acceso permitido
    if (!sub) return true;
    if (sub.status === 'EXPIRED') return false;
    return new Date() < sub.end_date;
  }
}
