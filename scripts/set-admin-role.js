"use strict";

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

// Carga .env.production si existe
const envFile = path.join(__dirname, "../.env.production");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8").split("\n").forEach((line) => {
    const [key, ...val] = line.split("=");
    if (key && key.trim()) process.env[key.trim()] = val.join("=").trim();
  });
}

const EMAIL = process.argv[2];
if (!EMAIL) {
  console.error("Uso: node scripts/set-admin-role.js <email>");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: process.env.PROD_DATABASE_URL || process.env.DATABASE_URL });
  await client.connect();

  // Buscar usuario
  const { rows: users } = await client.query(
    "SELECT id, name, email, company_id FROM users WHERE email = $1",
    [EMAIL.toLowerCase().trim()]
  );
  if (!users.length) {
    console.error(`Usuario no encontrado: ${EMAIL}`);
    await client.end();
    process.exit(1);
  }
  const user = users[0];
  console.log(`Usuario: ${user.name} (${user.email})`);

  // Buscar rol admin de la misma empresa (o global)
  const { rows: roles } = await client.query(
    `SELECT id, name, company_id FROM roles
     WHERE name = 'admin'
       AND (company_id = $1 OR company_id IS NULL)
     ORDER BY company_id NULLS LAST
     LIMIT 1`,
    [user.company_id]
  );
  if (!roles.length) {
    console.error("No se encontró el rol 'admin' en la base de datos.");
    await client.end();
    process.exit(1);
  }
  const role = roles[0];
  console.log(`Rol: ${role.name} (id: ${role.id})`);

  // Verificar si ya tiene el rol
  const { rows: existing } = await client.query(
    "SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2",
    [user.id, role.id]
  );
  if (existing.length) {
    console.log("El usuario ya tiene rol admin. No se hicieron cambios.");
    await client.end();
    return;
  }

  // Asignar rol
  await client.query(
    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
    [user.id, role.id]
  );
  console.log(`Rol admin asignado a ${user.name} correctamente.`);
  await client.end();
}

main().catch((err) => {
  console.error("Error completo:", err);
  process.exit(1);
});
