import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SCOPES = 'read_products,read_inventory,write_inventory';
const REDIRECT_URI = 'https://punto360-backend-production.up.railway.app/shopify/callback';

@Public()
@Controller('shopify')
export class ShopifyOAuthController {

  // Paso 1: redirige al usuario a Shopify para autorizar
  @Get('install')
  install(@Query('shop') shop: string, @Res() res: Response) {
    const shopDomain = shop || '3zr1pw-8z.myshopify.com';
    const authUrl =
      `https://${shopDomain}/admin/oauth/authorize` +
      `?client_id=${SHOPIFY_CLIENT_ID}` +
      `&scope=${SCOPES}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

    res.redirect(authUrl);
  }

  // Paso 2: Shopify redirige aquí con el código
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('shop') shop: string,
    @Res() res: Response,
  ) {
    if (!code || !shop) {
      return res.status(400).send('Faltan parámetros code o shop');
    }

    // Intercambiar código por token
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(500).send(`Error obteniendo token: ${err}`);
    }

    const { access_token } = await tokenRes.json() as { access_token: string };

    // Obtener location ID automáticamente
    let locationId = 'No disponible';
    try {
      const locRes = await fetch(`https://${shop}/admin/api/2024-01/locations.json`, {
        headers: { 'X-Shopify-Access-Token': access_token },
      });
      const locData = await locRes.json() as { locations: { id: number; name: string }[] };
      if (locData.locations?.length) {
        locationId = String(locData.locations[0].id);
      }
    } catch (_) {}

    // Mostrar los datos al usuario
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>PUNTO360 × Shopify — Token obtenido</title>
        <style>
          body { font-family: sans-serif; max-width: 700px; margin: 60px auto; padding: 20px; }
          h1 { color: #2ecc71; }
          .box { background: #1a1a2e; color: #eee; padding: 20px; border-radius: 8px; margin: 16px 0; }
          .label { color: #aaa; font-size: 13px; margin-bottom: 4px; }
          .value { font-family: monospace; font-size: 14px; word-break: break-all; }
          .cmd { background: #0d0d1a; color: #0f0; padding: 16px; border-radius: 6px; font-family: monospace; font-size: 12px; white-space: pre-wrap; margin-top: 24px; }
          button { background: #2ecc71; border: none; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 8px; }
        </style>
      </head>
      <body>
        <h1>✅ Conexión exitosa con Shopify</h1>
        <p>Guarda estos datos — el token solo se muestra una vez.</p>

        <div class="box">
          <div class="label">SHOPIFY_TOKEN</div>
          <div class="value" id="token">${access_token}</div>
          <button onclick="navigator.clipboard.writeText('${access_token}')">Copiar</button>
        </div>

        <div class="box">
          <div class="label">SHOPIFY_LOCATION</div>
          <div class="value">${locationId}</div>
        </div>

        <p>Comando para sincronizar inventario:</p>
        <div class="cmd">PUNTO360_API_KEY="pk_Ea9FglfLDnLCViPi76epwv1ezuphGZBWwzfqHtgI" \\
SHOPIFY_STORE="${shop}" \\
SHOPIFY_TOKEN="${access_token}" \\
SHOPIFY_LOCATION="${locationId}" \\
node scripts/sync-shopify.js --dry-run</div>
      </body>
      </html>
    `);
  }
}
