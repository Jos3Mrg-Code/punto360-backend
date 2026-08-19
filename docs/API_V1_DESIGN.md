# PUNTO 360 — API pública v1

Diseño de la API de integración de inventario para tiendas web (Shopify, WooCommerce, headless o cualquier framework).

**Estado:** propuesta para revisión · **Alcance acordado:** bidireccional (catálogo + órdenes) · **Deploy:** monorepo, 2 procesos

---

## 1. Arquitectura

Una sola API REST versionada, y encima conectores delgados por plataforma. No se construye una integración por plataforma: se construye **un contrato** y adaptadores.

```
                                  ┌─ Shopify        (app + webhooks)
  api.pos-punto360.com  ──────────┼─ WooCommerce    (plugin PHP)
  API key + HMAC + webhooks       ├─ Web nativa     (REST directo / SDK JS)
                                  └─ Cualquier otra (REST + webhooks)
```

### Despliegue: monorepo, dos procesos

Mismo repo `punto360-backend`, mismo `schema.prisma`, misma lógica de stock. Lo que se separa es el **proceso**, no el código.

```
pos-backend/
├── src/
│   ├── main.ts              → servicio "pos"  (Railway #1)  api actual
│   ├── main-api.ts          → servicio "api"  (Railway #2)  solo ApiV1Module
│   ├── api-v1/                            ← nuevo módulo
│   │   ├── api-v1.module.ts
│   │   ├── auth/            api-key.guard.ts · scopes.decorator.ts
│   │   ├── products/        controller · service
│   │   ├── inventory/       controller · service
│   │   ├── orders/          controller · service  → llama a SalesService
│   │   ├── webhooks/        dispatcher · signer
│   │   └── keys/            gestión por JWT (se monta en el proceso POS)
│   └── sales/               ← se refactoriza, ver §5
```

**Por qué no un repo aparte:** `POST /v1/orders` debe descontar stock exactamente igual que el POS (variantes, consignación, `inventory_movements`). Con repo separado habría que duplicar esa lógica o llamarla por HTTP, y mantener dos copias del `schema.prisma`. La separación de proceso da el aislamiento sin ese costo.

**Fase 1 arranca con un solo servicio.** `main-api.ts` se escribe desde ya para que activar el segundo sea configuración (`node dist/main-api.js` + dominio), no refactorización.

### Ruteo y compatibilidad

| Ruta | Estado |
|---|---|
| `api.pos-punto360.com/v1/*` | nueva, canónica |
| `/public-api/products` | **alias deprecado**, se mantiene 6 meses — el script `sync-shopify.js` lo usa hoy |

---

## 2. Cambios de base de datos

### 2.1 `api_keys` — seguridad y contexto

La tabla actual guarda la key en texto plano, no tiene sucursal ni scopes.

```sql
ALTER TABLE api_keys ADD COLUMN key_hash    TEXT;
ALTER TABLE api_keys ADD COLUMN key_prefix  TEXT;         -- "pk_live_a1b2c3" para mostrar en UI
ALTER TABLE api_keys ADD COLUMN branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE api_keys ADD COLUMN scopes      TEXT[] NOT NULL DEFAULT ARRAY['products:read','inventory:read'];
ALTER TABLE api_keys ADD COLUMN last_used_at TIMESTAMP(6);
ALTER TABLE api_keys ADD COLUMN revoked_at   TIMESTAMP(6);

CREATE UNIQUE INDEX api_keys_key_hash_idx ON api_keys(key_hash);
```

**Hash:** `sha256(key)`, no bcrypt. Es determinista, así que el lookup por hash sigue siendo un índice único. No necesita salt ni stretching porque la key tiene 256 bits de entropía real — no es una contraseña humana.

**Generación:** `crypto.randomBytes(32).toString('base64url')` con prefijo `pk_live_` / `pk_test_`. La key completa se muestra **una sola vez** al crearla; después solo el prefijo.

**Migración de las keys existentes:** rellenar `key_hash = sha256(key)` y `key_prefix = left(key, 14)` para las filas actuales, y recién entonces borrar la columna `key`. Dos migraciones separadas para no romper el script de Shopify en producción.

**`branch_id` es obligatorio en la práctica:** sin usuario no hay `user.branchIds`, así que cada key define de qué sucursal lee stock y contra cuál descuenta. Si es `NULL`, se usa la sucursal principal de la empresa.

### 2.2 `products.updated_at` — requisito para sync incremental

`products` hoy solo tiene `created_at`. Sin `updated_at` no hay `?updated_since=`, y toda sincronización es un full scan.

```sql
ALTER TABLE products         ADD COLUMN updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE product_variants ADD COLUMN updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_touch BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER product_variants_touch BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

Trigger en vez de hacerlo en el código: garantiza que se actualice venga el cambio de donde venga (POS, script de importación, SQL manual).

### 2.3 Publicación selectiva — qué productos ve la web

Requisito del cliente: publicar solo una parte del inventario, no el catálogo completo.

```sql
ALTER TABLE products         ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products         ADD COLUMN published_at TIMESTAMP(6);
ALTER TABLE product_variants ADD COLUMN is_published BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE api_keys ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'ALL';  -- ALL | SELECTED
```

**Flag, no canales de venta.** Shopify modela esto con una tabla de canales y una relación N-a-N con productos. Es lo correcto cuando un cliente vende en varios sitios con catálogos distintos; para una pyme con una tienda web es una tabla, una UI y un JOIN de más. Migrar de flag a canales después es directo si aparece el caso.

**`DEFAULT false` es deliberado:** publicar el catálogo entero debe ser un acto explícito.

**`publish_mode` protege a los clientes actuales.** El cliente de Shopify ya sincroniza con `sync-shopify.js`; si el filtro se aplicara sin más, su tienda se vaciaría en el siguiente sync. Las keys existentes quedan en `ALL` y no cambia nada; las nuevas nacen en `SELECTED`. El cambio a `SELECTED` lo hace el cliente desde la UI cuando ya curó su catálogo.

**Variantes:** el flag vive en el producto. `product_variants.is_published` existe con default `true` para excluir variantes puntuales (un color descontinuado) sin despublicar el producto entero, pero la UI de fase 1 solo expone el flag de producto.

#### Despublicar ≠ no devolver

El punto crítico de esta funcionalidad. Si `GET /v1/products?updated_since=X` filtra por `is_published = true`, un producto despublicado simplemente no aparece — pero tampoco aparecen los cientos que no cambiaron. El conector **no puede distinguir "lo quitaron" de "no cambió"**, así que el producto queda visible y comprable en la tienda web sin stock real detrás. Es una venta imposible de cumplir.

Por eso, cuando se usa `updated_since`, la respuesta incluye los despublicados recientemente con un marcador:

```json
{
  "data": [
    { "id": "uuid", "sku": "CAM-001", "published": true,  "name": "Camiseta", "stock": 24 },
    { "id": "uuid", "sku": "PAN-020", "published": false }
  ]
}
```

El conector hace *upsert* cuando `published: true` y oculta cuando es `false`. El trigger de `updated_at` (§2.2) garantiza que despublicar cuente como cambio y entre en la ventana incremental.

Sin `updated_since` (sync completo), solo se devuelven los publicados. La forma reducida `{ id, sku, published: false }` evita filtrar datos de productos que el cliente decidió no exponer.

**Webhooks relacionados:** `product.unpublished` se suma a los eventos de §6, para que la web reaccione sin esperar al siguiente ciclo de sync.

### 2.4 Índices de lectura

```sql
CREATE INDEX products_company_updated_idx ON products(company_id, updated_at DESC, id);
CREATE INDEX products_company_active_idx  ON products(company_id, is_active);
CREATE INDEX products_published_idx       ON products(company_id, is_published, updated_at DESC);
CREATE INDEX stock_branch_idx             ON stock(branch_id, product_id);
CREATE INDEX variant_stock_branch_idx     ON variant_stock(branch_id, variant_id);
```

### 2.5 `sales` — canal e idempotencia

Crítico: si Shopify reintenta un webhook, **no se puede descontar stock dos veces**.

```sql
ALTER TABLE sales ADD COLUMN channel         TEXT DEFAULT 'POS';   -- POS | API
ALTER TABLE sales ADD COLUMN external_source TEXT;                 -- shopify | woocommerce | custom
ALTER TABLE sales ADD COLUMN external_id     TEXT;                 -- id de la orden en el origen
ALTER TABLE sales ADD COLUMN api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX sales_external_uniq
  ON sales(company_id, external_source, external_id)
  WHERE external_id IS NOT NULL;
```

El índice único parcial es el que hace la idempotencia real: un reintento choca contra la restricción y se resuelve devolviendo la venta ya creada, en vez de duplicarla.

### 2.6 Webhooks salientes

```sql
CREATE TABLE webhook_endpoints (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,              -- para firmar HMAC
  events      TEXT[] NOT NULL,            -- ['inventory.changed','product.updated']
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_deliveries (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint_id  UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | DELIVERED | FAILED
  attempts     INT  NOT NULL DEFAULT 0,
  last_error   TEXT,
  next_retry_at TIMESTAMP(6),
  created_at   TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX webhook_deliveries_pending_idx
  ON webhook_deliveries(status, next_retry_at) WHERE status = 'PENDING';
```

---

## 3. Autenticación

```http
GET /v1/products
Authorization: Bearer pk_live_xxxxxxxxxxxx
```

Se acepta también `X-API-Key` por compatibilidad con el guard actual. Se **elimina** `?api_key=` en query string: queda en logs de Railway, en el historial del navegador y en el `Referer`.

### Scopes

| Scope | Permite |
|---|---|
| `products:read` | `GET /v1/products`, `/v1/categories` |
| `inventory:read` | `GET /v1/inventory` |
| `inventory:write` | `POST /v1/inventory/adjust` |
| `orders:write` | `POST /v1/orders` |
| `orders:read` | `GET /v1/orders/:id` |

### Reglas de seguridad

1. **La key es server-side.** Con `CORS: '*'` actual, una key en JavaScript de navegador expone el inventario completo de la empresa a cualquiera. Para web nativa se ofrecerá en fase 4 un token público de solo-lectura restringido por dominio.
2. **La suscripción se valida.** Hoy `@Public()` salta también el `SubscriptionGuard`, así que una empresa con plan vencido sigue sirviendo su catálogo. El `ApiKeyGuard` debe llamar a `hasActiveAccess(companyId)` y responder `402` si expiró. Los clientes legacy pasan igual que en el POS.
3. **Rate limiting** con `@nestjs/throttler`: 120 req/min por key, `429` con `Retry-After`.
4. `last_used_at` se actualiza de forma asíncrona (no bloquea la respuesta).

---

## 4. Endpoints de lectura

### `GET /v1/products`

| Query param | Descripción |
|---|---|
| `updated_since` | ISO 8601 — sync incremental |
| `sku` / `barcode` | búsqueda exacta, también dentro de variantes |
| `category_id` | filtro |
| `branch_id` | sobrescribe la sucursal de la key |
| `include_inactive` | `false` por defecto |
| `cursor` / `limit` | paginación por cursor, `limit` máx. 200 |

El filtro de publicación **no es un query param**: lo determina `api_keys.publish_mode` (§2.3). Si fuera un parámetro, cualquiera con la key podría pedir el catálogo completo y saltarse la curaduría del cliente.

**Paginación por cursor, no por offset.** El `.slice()` en memoria actual carga todos los productos de la empresa con variantes y stock en cada request; con catálogos grandes eso agota la RAM del contenedor. El cursor es `base64(updated_at|id)` con orden estable `updated_at ASC, id ASC`.

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Camiseta básica",
      "sku": "CAM-001",
      "barcode": "7701234567890",
      "price": 45000,
      "category": { "id": "uuid", "name": "Camisetas" },
      "unit_type": "UNIT",
      "has_variants": true,
      "stock": 24,
      "stock_by_branch": [
        { "branch_id": "uuid", "branch_name": "Principal", "quantity": 24 }
      ],
      "variants": [
        {
          "id": "uuid",
          "sku": "CAM-001-RJ-M",
          "barcode": "7701234567891",
          "price": 45000,
          "attributes": { "COLOR": "Rojo", "TALLA": "M" },
          "stock": 8,
          "is_default": false
        }
      ],
      "updated_at": "2026-08-16T14:22:10Z"
    }
  ],
  "meta": { "has_more": true, "next_cursor": "MjAyNi0wOC0xNi..." }
}
```

`price` en **pesos enteros**, no centavos — coherente con `Decimal(12,2)` de la BD. Se documenta explícitamente para que nadie divida por 100.

### `GET /v1/inventory`

Endpoint ligero para sync frecuente de stock. Sin nombres, sin categorías, sin atributos: solo lo que cambia seguido.

```json
{
  "data": [
    { "sku": "CAM-001-RJ-M", "product_id": "uuid", "variant_id": "uuid", "quantity": 8 },
    { "sku": "PAN-020",      "product_id": "uuid", "variant_id": null,   "quantity": 15 }
  ],
  "meta": { "branch_id": "uuid", "as_of": "2026-08-16T14:30:00Z", "has_more": false }
}
```

Un sync de stock de Shopify solo necesita esto. Pesa ~10x menos que `/v1/products`.

### `GET /v1/products/:id` · `GET /v1/categories` · `GET /v1/branches`

Directos. `:id` acepta también `sku:CAM-001` como identificador, útil porque las tiendas web suelen indexar por SKU y no guardan el UUID.

---

## 5. `POST /v1/orders` — el corazón de la integración

Sin esto la integración es un catálogo: se vende online y el stock del POS nunca baja.

### Refactorización previa de `SalesService`

`createSale` hoy depende de `ActiveUserData` (`user.sub`, `user.companyId`, `user.branchIds[0]`). La API no tiene usuario. Se extrae el núcleo:

```ts
// sales.service.ts
type SaleContext = {
  companyId: string;
  branchId: string;
  userId: string | null;        // null cuando viene de la API
  channel: 'POS' | 'API';
  externalSource?: string;
  externalId?: string;
  apiKeyId?: string;
};

async createSaleCore(dto: CreateSaleDto, ctx: SaleContext) { /* lógica actual */ }

// El método existente queda como envoltorio — el POS no cambia de comportamiento
async createSale(dto: CreateSaleDto, user: ActiveUserData) {
  return this.createSaleCore(dto, {
    companyId: user.companyId,
    branchId: user.branchIds[0],
    userId: user.sub,
    channel: 'POS',
  });
}
```

`sales.user_id` ya es nullable, así que una orden de la web queda con `user_id = null` y `channel = 'API'`. Los reportes deben filtrar o agrupar por `channel` para no mezclar ventas de mostrador con ventas web.

### Contrato

```http
POST /v1/orders
Authorization: Bearer pk_live_...
Idempotency-Key: shopify-order-4482910
```

```json
{
  "external_source": "shopify",
  "external_id": "4482910",
  "branch_id": "uuid",
  "payment_method": "CARD",
  "items": [
    { "sku": "CAM-001-RJ-M", "quantity": 2, "price": 45000 },
    { "product_id": "uuid", "variant_id": "uuid", "quantity": 1, "price": 30000 }
  ],
  "customer": { "name": "Ana Pérez", "email": "ana@ejemplo.com", "phone": "3001234567" },
  "total": 120000
}
```

Los items se identifican por `sku` **o** por `product_id`/`variant_id`. Por SKU es lo práctico: es lo único que Shopify y WooCommerce guardan de forma natural.

**Respuesta `201`:**

```json
{
  "id": "uuid",
  "external_id": "4482910",
  "status": "PAID",
  "channel": "API",
  "total": 120000,
  "stock_applied": true,
  "created_at": "2026-08-16T14:35:00Z"
}
```

### Decisiones de comportamiento

| Situación | Respuesta |
|---|---|
| Reintento con mismo `external_id` | `200` con la venta original. **No** duplica ni descuenta de nuevo |
| Stock insuficiente | `409` con detalle por SKU. La orden **no** se crea |
| SKU inexistente | `422` con la lista de SKUs no encontrados |
| `total` no cuadra con los items | `422` — evita descuadres silenciosos en caja |
| Producto en consignación | Se registra la venta, **no** descuenta stock (igual que el POS hoy) |
| Suscripción vencida | `402` |

**Sobre stock insuficiente:** rechazar es lo correcto para un POS. La alternativa (permitir negativo) descuadra el arqueo y el cliente termina vendiendo algo que no tiene. Si más adelante se quiere sobreventa controlada, se agrega `allow_backorder: true` por key.

### `POST /v1/orders/:id/cancel`

Reversa la venta y devuelve el stock, reutilizando `cancelSale`. Necesario para cuando se cancela o reembolsa en la tienda web.

### `POST /v1/inventory/adjust`

Ajuste puntual, para cuando el conteo físico se hace desde otro lado. Registra `inventory_movements` con `type: 'ADJUST_API'` y motivo, para que el ajuste quede auditable.

---

## 6. Webhooks salientes

Sin webhooks, la tienda web hace polling cada N minutos y el stock siempre está desactualizado en la ventana intermedia.

| Evento | Se dispara cuando |
|---|---|
| `inventory.changed` | cambia stock por venta, compra, ajuste o anulación |
| `product.updated` | cambia precio, nombre, estado o variantes |
| `product.deleted` | producto desactivado |

**Firma:** HMAC SHA256 sobre el body crudo, en header `X-Punto360-Signature`, con timestamp en `X-Punto360-Timestamp` para evitar replay. Es el mismo patrón que ya se usa para validar Wompi, así que el código de verificación es conocido.

```
X-Punto360-Signature: sha256=a1b2c3...
X-Punto360-Timestamp: 1755353400
X-Punto360-Event: inventory.changed
```

**Entrega:** cola en `webhook_deliveries` con reintentos exponenciales (1m, 5m, 30m, 2h, 6h) y desactivación automática del endpoint tras 20 fallos consecutivos. Un cron cada minuto procesa los pendientes.

**Batching:** `inventory.changed` se agrupa en ventanas de 5 segundos. Una venta de 20 items debe generar 1 webhook, no 20.

---

## 7. UI de API keys (frontend)

Hoy no existe: hay que crear las keys a mano contra el backend. Nueva pestaña **Integraciones** en `/cuenta`.

- Listado con nombre, prefijo (`pk_live_a1b2c3…`), sucursal, scopes, último uso, estado
- Crear key → modal con nombre, sucursal y scopes → **muestra la key completa una sola vez**, con botón de copiar y aviso claro
- Revocar y eliminar, con confirmación
- Sección de webhooks: URL, eventos, secret, y las últimas entregas con su estado
- Enlace a la documentación pública
- Selector de `publish_mode` por key (`ALL` / `SELECTED`), con aviso de cuántos productos publicados hay antes de cambiar a `SELECTED`

Permiso nuevo: `integrations.manage`, solo `admin` por defecto.

### Publicación de productos en `/inventario`

Sigue el patrón de `handleToggleStatus` que ya existe en [`InventoryTable.tsx`](../../pos-frontend/src/components/Inventory/InventoryTable.tsx):

- **Icono de globo por fila**, junto al de activar/desactivar → publica o despublica
- **Casillas de selección + barra de acciones masivas** — marcar decenas de productos uno por uno no es viable. Es el único componente realmente nuevo
- **Filtro** en `InventoryFilters`: `todos / publicados / no publicados`
- **Contador** en `InventoryStats`: "48 de 812 publicados en web"

Publicar requiere el permiso `inventory.manage` existente.

---

## 8. Correcciones de seguridad pendientes

Independientes del diseño, aplican al código actual:

1. **API key real hardcodeada** en [`shopify-oauth.controller.ts:101`](../src/shopify-oauth/shopify-oauth.controller.ts) — se muestra en el HTML del callback a cualquiera que pase por ahí. Debe salir del código y esa key debe rotarse.
2. **Sin validación HMAC en el callback de Shopify** — Shopify firma el parámetro `hmac`; hoy no se verifica, así que el endpoint acepta callbacks falsificados. Falta también el parámetro `state` contra CSRF.
3. **`debug_error` en `listKeys`** ([`public-api.controller.ts:78`](../src/public-api/public-api.controller.ts)) — filtra mensajes internos de Prisma al cliente.
4. **`Math.random()` para generar keys** — reemplazar por `crypto.randomBytes`.
5. **`REDIRECT_URI` hardcodeado** al dominio de Railway — debe salir de env var.

---

## 9. Plan por fases

| Fase | Contenido | Resultado |
|---|---|---|
| **1. Fundaciones** | Migraciones (§2.1–2.4), `ApiV1Module`, `main-api.ts`, guard con scopes + suscripción + rate limit, `GET /v1/products`, `/v1/inventory`, `/v1/categories`, `/v1/branches`, UI de keys, **publicación selectiva en `/inventario`** | Catálogo curado, consultable de forma segura y escalable |
| **2. Órdenes** | Refactor `createSaleCore`, migración §2.5, `POST /v1/orders`, `/cancel`, `/inventory/adjust` | **Integración bidireccional real** |
| **3. Webhooks** | Migración §2.6, dispatcher con firma y reintentos, cron, UI de endpoints | Stock en tiempo real sin polling |
| **4. Conectores** | App Shopify con sync automático, plugin WooCommerce, docs públicas + SDK JS, token público por dominio | Instalable sin escribir código |
| **5. Aislamiento** | Segundo servicio Railway + `api.pos-punto360.com` | Tráfico web no afecta al POS |

Las fases 1 y 2 son las que entregan valor de verdad; la 3 en adelante es refinamiento.

---

## 10. Puntos que requieren tu decisión

1. **Sucursal por key** — se asume una sucursal fija por key. Si un cliente vende online desde varias sucursales (stock consolidado), el modelo cambia.
2. **Precio online distinto al del POS** — hoy la API devuelve `sale_price`. Con `sale_type_enabled` existe precio mayorista/detal; hay que definir cuál expone la API.
3. **`payment_method` de órdenes web** — el POS usa `CASH`/`CARD`/`CREDIT`. Conviene agregar `ONLINE` para no ensuciar los arqueos de caja con ventas que nunca pasaron por el cajón.
4. **Consignación** — se propone replicar el comportamiento del POS (vende sin descontar). Confirmar que es lo esperado en la web.
5. **¿Una tienda web por cliente, o varias?** El flag de §2.3 asume una. Con dos webs de catálogos distintos hay que migrar a canales de venta.
6. **¿Precio web distinto?** Publicar solo una parte del catálogo suele venir acompañado de precio online propio. Requeriría `products.web_price` opcional (cae a `sale_price` si es `NULL`).
7. **¿Buffer de stock?** Publicar 10 de las 50 unidades existentes evita sobreventa cuando el mostrador y la web compiten por el mismo inventario. Sería `products.web_stock_buffer`, restado del stock que expone la API.

---

## Anexo — Publicación selectiva: estado de implementación

Implementado el 2026-08-18 sobre el endpoint `/public-api/products` existente, sin esperar a `/v1`.

| Pieza | Dónde |
|---|---|
| `products.is_published`, `published_at`, `product_variants.is_published`, `api_keys.publish_mode` | `scripts/apply-schema.js` (se aplica solo al arrancar en producción) |
| Filtro por publicación y forma reducida de los despublicados | `src/public-api/public-api.service.ts` |
| `publish_mode` leído de la key | `src/public-api/api-key.guard.ts` |
| `PATCH /products/:id/publish` y `PATCH /products/publish-bulk` | `src/products/products.controller.ts` |
| Toggle, selección múltiple, filtro y contador | `pos-frontend` — `InventoryTable`, `InventoryFilters`, `InventoryStats` |
| Paso a borrador en Shopify de lo retirado | `scripts/import-shopify.js` |

**Contrato del endpoint:**

- `GET /public-api/products` → con `publish_mode = SELECTED`, solo los publicados. Con `ALL`, todo el catálogo (comportamiento anterior).
- `GET /public-api/products?include_unpublished=true` → añade los retirados como `{ id, sku, published: false }` para que el conector pueda ocultarlos.

**Diferencias con el diseño original:**

- El filtro no es un query param de publicación: lo decide `publish_mode` de la key, para que nadie con la key pueda saltarse la curaduría.
- Los despublicados se detectan comparando el catálogo completo, no con `updated_since`, que sigue pendiente junto con la paginación por cursor (§4).
- `product_variants.is_published` existe en base de datos pero la UI todavía no lo expone: solo se publica a nivel de producto.
