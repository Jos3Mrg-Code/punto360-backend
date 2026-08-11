# PUNTO 360 — Backend

API REST para el sistema de punto de venta PUNTO 360. Construida con NestJS y Prisma sobre PostgreSQL. Soporta múltiples empresas (multi-tenant), sucursales, roles granulares y gestión completa de operaciones comerciales.

## Stack tecnológico

| Herramienta | Versión | Uso |
|---|---|---|
| NestJS | 11 | Framework principal |
| TypeScript | 5.7 | Tipado estático |
| Prisma | 5.22 | ORM y migraciones |
| PostgreSQL | — | Base de datos (Supabase en producción) |
| JWT + Passport | — | Autenticación |
| Bcrypt | 6 | Hash de contraseñas |
| Resend | 6 | Envío de emails transaccionales |
| class-validator | — | Validación de DTOs |

## Módulos

### `auth`
- Login con JWT
- Registro de empresas nuevas con suscripción Trial
- Verificación de email antes de permitir acceso
- Recuperación y restablecimiento de contraseña por token
- Guards: `JwtGuard`, `SubscriptionGuard`, `PermissionsGuard`

### `products`
- CRUD de productos simples y con variantes
- Atributos personalizados por producto (ej: Color, Talla)
- Generación automática de SKU
- Búsqueda por código de barras
- Importación masiva
- Templates de atributos reutilizables

### `inventory`
- Movimientos de stock (entradas, salidas, ajustes)
- Stock por sucursal para productos y variantes
- Historial de movimientos

### `sales`
- Creación de ventas con múltiples métodos de pago
- Ventas pendientes (guardar y retomar)
- Cancelación de ventas
- Estadísticas por turno y por período

### `purchases`
- Recepción de mercancía por proveedor
- Actualización automática de stock y costo promedio
- Registro de pagos parciales y deudas

### `customers`
- Base de datos de clientes
- Ventas a crédito vinculadas a clientes

### `cartera`
- Gestión de saldos pendientes por cliente
- Registro de pagos y abonos
- Historial de movimientos de cartera

### `cash-registers`
- Apertura y cierre de turno
- Movimientos de caja (depósitos, retiros, gastos)
- Resumen de caja por turno

### `exchanges`
- Devoluciones de productos
- Intercambios por otra referencia

### `consignments`
- Gestión de productos en consignación
- Liquidación de consignaciones

### `reports`
- Ventas por período, usuario, sucursal
- Rentabilidad por producto
- Resumen de caja y gastos

### `roles`
- Roles por empresa con permisos granulares
- CRUD de roles y asignación de permisos

### `subscription`
- Gestión de planes: Trial, Mensual, Anual
- Verificación de email al registrarse
- Integración con Wompi (pagos colombianos)
- Bloqueo de acceso al expirar suscripción

### `superadmin`
- Listado de todas las empresas con estado de suscripción
- Creación manual de clientes con suscripción anual
- Renovación y suspensión de accesos

### `email`
- Envío de emails via Resend
- Templates para: verificación de cuenta, reseteo de contraseña, trial por vencer

### `print-queue`
- Cola de etiquetas pendientes de impresión

### `public-api`
- Endpoints con autenticación por API Key para integraciones externas

## Endpoints principales

### Autenticación
```
POST   /auth/login
POST   /auth/register
GET    /auth/verify-email?token=
POST   /auth/forgot-password
POST   /auth/reset-password
```

### Productos
```
GET    /products
POST   /products
PUT    /products/:id
GET    /products/scan/:barcode
POST   /products/import
GET    /products/:id/variants
POST   /products/:id/variants
POST   /products/:id/attributes/:attrId/values
```

### Ventas
```
POST   /sales
GET    /sales
GET    /sales/stats
POST   /sales/pending
POST   /sales/:id/complete
PUT    /sales/:id/cancel
```

### Compras
```
GET    /purchases
POST   /purchases
GET    /purchases/debts
POST   /purchases/:id/payments
DELETE /purchases/:id
```

### Caja
```
POST   /cash-registers/open
POST   /cash-registers/close
GET    /cash-registers/current
POST   /cash-registers/movements
```

### Super Admin
```
GET    /superadmin/clients
POST   /superadmin/clients
GET    /superadmin/clients/:id
POST   /superadmin/clients/:id/subscriptions
PATCH  /superadmin/subscriptions/:id/status
```

## Seguridad

Todas las rutas están protegidas por defecto. Se usa el decorador `@Public()` para exponer rutas sin autenticación.

| Guard | Función |
|---|---|
| `JwtGuard` | Valida el token JWT en cada request |
| `SubscriptionGuard` | Bloquea acceso si la suscripción expiró (HTTP 402) |
| `PermissionsGuard` | Verifica permisos granulares del rol del usuario |

Las empresas creadas antes del sistema de suscripciones (clientes legacy) no son bloqueadas por el `SubscriptionGuard`.

## Base de datos

El schema de Prisma define las siguientes entidades principales:

- `companies` / `branches` / `users` — Multi-tenant
- `products` / `product_variants` / `product_attributes` — Catálogo
- `stock` / `variant_stock` / `inventory_movements` — Inventario
- `sales` / `sale_items` — Ventas
- `purchases` / `purchase_items` / `purchase_payments` — Compras
- `cash_registers` / `cash_movements` — Caja
- `customers` / `customer_payments` / `cartera_movements` — Clientes y crédito
- `roles` / `permissions` / `role_permissions` — RBAC
- `subscriptions` / `password_resets` / `email_verifications` — Auth y suscripciones

## Instalación y desarrollo local

```bash
npm install
npx prisma generate
npm run start:dev
```

Requiere un archivo `.env`:

```env
DATABASE_URL=postgresql://...
JWT_SECRET=tu_secreto
RESEND_API_KEY=re_...
FRONTEND_URL=http://localhost:5173
```

## Producción

El backend se despliega en **Railway**. El redeploy se hace manualmente desde el dashboard de Railway o haciendo push a la rama `main` del repositorio.

```bash
# Build para producción
npm run build
npm run start:prod
```
