import { BadRequestException, Body, Controller, Delete, Get, Patch, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveUser } from '../auth/decorators/active-user.decorator';
import type { ActiveUserData } from '../auth/interfaces/active-user-data.interface';

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SCOPES = 'read_products,read_inventory,write_inventory';
const REDIRECT_URI = 'https://punto360-backend-production.up.railway.app/shopify/callback';

@Controller('shopify')
export class ShopifyOAuthController {
  constructor(private prisma: PrismaService) {}

  /** Guarda credenciales Shopify ingresadas manualmente (Custom App) */
  @Patch('credentials')
  async saveCredentials(
    @Body() body: { store: string; token: string; locationId: string },
    @ActiveUser() user: ActiveUserData,
  ) {
    const { store, token, locationId } = body;
    if (!store || !token || !locationId) {
      throw new BadRequestException('store, token y locationId son obligatorios.');
    }
    await this.prisma.companies.update({
      where: { id: user.companyId },
      data: { shopify_store: store.trim(), shopify_token: token.trim(), shopify_location_id: locationId.trim() },
    });
    return { message: 'Credenciales de Shopify guardadas correctamente.' };
  }

  /** Desvincula Shopify de la empresa */
  @Delete('credentials')
  async deleteCredentials(@ActiveUser() user: ActiveUserData) {
    await this.prisma.companies.update({
      where: { id: user.companyId },
      data: { shopify_store: null, shopify_token: null, shopify_location_id: null },
    });
    return { message: 'Shopify desvinculado.' };
  }

  /**
   * Devuelve la URL de autorización de Shopify — requiere JWT del admin.
   * El frontend llama esto via fetch (con Authorization header) y abre la URL en nueva pestaña.
   */
  @Get('connect-url')
  connectUrl(@Query('shop') shop: string, @ActiveUser() user: ActiveUserData) {
    if (!shop) throw new BadRequestException('Falta el parámetro ?shop= (dominio .myshopify.com).');
    const state = Buffer.from(user.companyId).toString('base64url');
    const url =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${SHOPIFY_CLIENT_ID}` +
      `&scope=${SCOPES}` +
      `&state=${state}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    return { url };
  }

  /** Shopify redirige aquí con el código — no lleva JWT, por eso @Public */
  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !shop || !state) {
      return res.status(400).send('Faltan parámetros code, shop o state.');
    }

    let companyId: string;
    try {
      companyId = Buffer.from(state, 'base64url').toString('utf8');
    } catch {
      return res.status(400).send('State inválido.');
    }

    // Intercambiar código por token permanente
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET, code }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(500).send(`Error obteniendo token: ${err}`);
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Tomar el primer location disponible
    let locationId = '';
    try {
      const locRes = await fetch(`https://${shop}/admin/api/2024-01/locations.json`, {
        headers: { 'X-Shopify-Access-Token': access_token },
      });
      const locData = (await locRes.json()) as { locations: { id: number; name: string }[] };
      if (locData.locations?.length) locationId = String(locData.locations[0].id);
    } catch (_) {}

    // Guardar credenciales en la empresa del usuario que inició el flujo
    await this.prisma.companies.update({
      where: { id: companyId },
      data: {
        shopify_store: shop,
        shopify_token: access_token,
        shopify_location_id: locationId,
      },
    });

    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>PUNTO360 × Shopify — Conectado</title>
<style>
  body{font-family:sans-serif;max-width:600px;margin:60px auto;padding:20px;}
  h1{color:#2ecc71;}
  p{color:#555;}
  .shop{font-weight:bold;font-family:monospace;}
</style></head><body>
<h1>✅ Shopify conectado correctamente</h1>
<p>La tienda <span class="shop">${shop}</span> ha quedado vinculada a tu empresa en PUNTO360.</p>
<p>El inventario se sincronizará automáticamente cada 10 minutos. Puedes cerrar esta ventana.</p>
</body></html>`);
  }
}
