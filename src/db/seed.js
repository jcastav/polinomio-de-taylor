// Seed: admin inicial + curso demo + bucket de Storage.
// Uso: npm run seed   (requiere .env con SUPABASE_URL y SERVICE_ROLE_KEY)
require('dotenv').config();

const { sb, unwrap } = require('./client');
const { hashPassword } = require('../lib/auth');

const PLACEHOLDER = '# Lección de ejemplo\n\n_Contenido pendiente — reemplazar._\n';

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Admin';

  if (!email || !password) {
    throw new Error('Faltan ADMIN_EMAIL y/o ADMIN_PASSWORD en .env');
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD debe tener mínimo 8 caracteres');
  }

  const existing = unwrap(
    await sb().from('users').select('id, email').eq('email', email).maybeSingle()
  );
  if (existing) {
    console.log(`· Admin ya existe (${email}). No se imprime la password.`);
    return existing;
  }

  const created = unwrap(
    await sb().from('users').insert({
      name,
      email,
      password_hash: await hashPassword(password),
      role: 'admin',
    }).select('id, email').single()
  );

  console.log('· Admin inicial creado:');
  console.log(`    email:  ${created.email}`);
  console.log(`    password: ${password}`);
  console.log('  (se imprime solo en esta ejecución)');
  return created;
}

async function ensureDemoCourse() {
  const existing = unwrap(
    await sb().from('courses').select('id').eq('slug', 'polinomio-de-taylor').maybeSingle()
  );
  if (existing) {
    console.log('· Curso demo ya existe (polinomio-de-taylor).');
    return existing;
  }

  const course = unwrap(
    await sb().from('courses').insert({
      title: 'Polinomio de Taylor',
      slug: 'polinomio-de-taylor',
      description: 'Curso de ejemplo — reemplazar con el contenido real.',
      published: true,
    }).select('id').single()
  );

  const m1 = unwrap(
    await sb().from('modules').insert({ course_id: course.id, title: '1. Introducción', position: 1 })
      .select('id').single()
  );
  const m2 = unwrap(
    await sb().from('modules').insert({ course_id: course.id, title: '2. Desarrollo', position: 2 })
      .select('id').single()
  );

  await sb().from('lessons').insert([
    { module_id: m1.id, title: '1.1 Lección de ejemplo', content: PLACEHOLDER, position: 1 },
    { module_id: m2.id, title: '2.1 Lección de ejemplo', content: PLACEHOLDER, position: 1 },
  ]);

  console.log('· Curso demo creado: Polinomio de Taylor (2 módulos, 2 lecciones placeholder).');
  return course;
}

async function ensureBucket() {
  const storage = sb().storage;
  try {
    await storage.getBucket('aula-media');
    console.log('· Bucket "aula-media" ya existe.');
  } catch (err) {
    if (err && /not found|No such bucket/i.test(err.message)) {
      await storage.createBucket('aula-media', { public: true });
      console.log('· Bucket "aula-media" creado (público para lectura).');
    } else {
      console.log(`· No se pudo verificar el bucket: ${err.message}`);
      console.log('  Créalo a mano en Supabase → Storage → New bucket → "aula-media" (public).');
    }
  }
}

(async () => {
  try {
    await ensureAdmin();
    await ensureDemoCourse();
    await ensureBucket();
    console.log('Seed completado.');
    process.exit(0);
  } catch (err) {
    console.error('Seed falló:', err.message);
    process.exit(1);
  }
})();
