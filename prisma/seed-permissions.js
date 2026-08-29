const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const corePermissions = [
  { key: 'dashboard.view', name: 'Ver Dashboard' },
  { key: 'pos.access', name: 'Acceso a Terminal de Ventas' },
  { key: 'cash.manage', name: 'Gestionar Arqueos de Caja' },
  { key: 'inventory.manage', name: 'Gestionar Inventario y Productos' },
  { key: 'purchases.manage', name: 'Registrar Compras / Recepciones' },
  { key: 'purchases.edit', name: 'Editar / Anular Compras' },
  { key: 'history.view', name: 'Ver Historial de Ventas' },
  { key: 'sales.cancel', name: 'Anular Ventas' },
  { key: 'users.manage', name: 'Administrar Usuarios y Roles' },
  { key: 'reports.view', name: 'Ver Reportes y Analíticas' },
];

async function seed() {
  console.log('🌱 Iniciando seeding de permisos...');
  for (const p of corePermissions) {
    await prisma.permissions.upsert({
      where: { key: p.key },
      update: { name: p.name },
      create: p,
    });
  }
  console.log('✅ Permisos sincronizados.');
  process.exit(0);
}

seed().catch(e => {
  console.error('❌ Error en seeding:', e);
  process.exit(1);
});
