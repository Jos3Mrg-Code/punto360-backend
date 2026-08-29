const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de staging...');

  // 1. Empresa
  const company = await prisma.companies.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Punto 360 Staging',
      email: 'staging@punto360.com',
    },
  });
  console.log('✅ Empresa creada:', company.name);

  // 2. Sucursal principal
  const branch = await prisma.branches.upsert({
    where: { code: 'STAGING-MAIN' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      company_id: company.id,
      name: 'Sede Principal',
      code: 'STAGING-MAIN',
      is_main: true,
      is_active: true,
    },
  });
  console.log('✅ Sucursal creada:', branch.name);

  // 3. Permisos
  const perms = [
    { key: 'dashboard.view',    name: 'Ver Dashboard' },
    { key: 'pos.access',        name: 'Acceso a Terminal de Ventas' },
    { key: 'cash.manage',       name: 'Gestionar Arqueos de Caja' },
    { key: 'inventory.manage',  name: 'Gestionar Inventario y Productos' },
    { key: 'purchases.manage',  name: 'Registrar Compras / Recepciones' },
    { key: 'purchases.edit',    name: 'Editar / Anular Compras' },
    { key: 'history.view',      name: 'Ver Historial de Ventas' },
    { key: 'sales.cancel',      name: 'Anular Ventas' },
    { key: 'users.manage',      name: 'Administrar Usuarios y Roles' },
    { key: 'reports.view',      name: 'Ver Reportes y Analíticas' },
  ];
  for (const p of perms) {
    await prisma.permissions.upsert({
      where: { key: p.key },
      update: { name: p.name },
      create: p,
    });
  }
  console.log('✅ Permisos sincronizados');

  // 4. Rol ADMIN
  const role = await prisma.roles.upsert({
    where: { id: '00000000-0000-0000-0000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'ADMIN',
      company_id: company.id,
    },
  });
  const allPerms = await prisma.permissions.findMany();
  for (const p of allPerms) {
    await prisma.role_permissions.upsert({
      where: { role_id_permission_id: { role_id: role.id, permission_id: p.id } },
      update: {},
      create: { role_id: role.id, permission_id: p.id },
    });
  }
  console.log('✅ Rol ADMIN con todos los permisos');

  // 5. Usuario admin
  const password_hash = await bcrypt.hash('admin123', 10);
  const user = await prisma.users.upsert({
    where: { email: 'admin@staging.com' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000004',
      company_id: company.id,
      name: 'Admin Staging',
      user_name: 'Admin',
      email: 'admin@staging.com',
      password_hash,
      is_active: true,
    },
  });

  // Asignar rol y sucursal al usuario
  await prisma.user_roles.upsert({
    where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
    update: {},
    create: { user_id: user.id, role_id: role.id },
  });
  await prisma.user_branches.upsert({
    where: { user_id_branch_id: { user_id: user.id, branch_id: branch.id } },
    update: {},
    create: { user_id: user.id, branch_id: branch.id },
  });

  console.log('✅ Usuario admin creado');
  console.log('');
  console.log('─────────────────────────────────');
  console.log('  CREDENCIALES STAGING');
  console.log('  Email:    admin@staging.com');
  console.log('  Password: admin123');
  console.log('─────────────────────────────────');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
