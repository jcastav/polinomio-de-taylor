# Smoke test manual — Aula (Polinomio de Taylor)

Checklist de humo para verificar una instancia nueva (local o Render)
en ~15 minutos. Marca cada casilla cuando el resultado esperado se
cumpla. Los tests automatizados (`tmp-check-*.ps1`) cubren la lógica;
esto valida la experiencia completa en navegador.

## 0. Preparación

1. `.env` completo (ver README) y `npm install`.
2. `supabase/schema.sql` ejecutado en el SQL Editor de Supabase.
3. `npm run seed` — en consola aparece "Admin inicial creado" con
   email y password (o "Admin ya existe" si ya existía).
4. `npm start` — consola: "Aula escuchando en http://localhost:3000".

## S1 — Estudiante nuevo (autoregistro)

1. Abre `http://localhost:3000/register` en ventana anónima.
2. Registra nombre `smoke-alum`, contraseña de 8+ caracteres.
3. Tras registrarte caes en `/c/polinomio-de-taylor`.

- [ ] El registro crea la sesión y muestra el curso publicado.
- [ ] El sidebar muestra los módulos/lecciones del curso demo.
- [ ] Salir (`Salir` en el topbar) vuelve a `/login`.

## S2 — Estudiante recurrente

1. En ventana anónima, entra a `/login`.
2. Escribe como identidad el **nombre** `smoke-alum` (no el email).
3. Abre una lección y márcala como completada.
4. Cierra sesión, vuelve a entrar.

- [ ] El login con nombre de estudiante funciona.
- [ ] El progreso de la lección completada sigue marcado (✓).

## S3 — Admin

1. Entra con el **email** del admin y su password (distingue email vs
   nombre: el email es de admin).
2. Debes caer en `/admin` con el panel.

- [ ] `/admin` muestra cursos y estudiantes.
- [ ] Crea un curso `smoke-curso` con 2 módulos y 3 lecciones.
- [ ] En la lección, pega markdown y guarda; el preview lo renderiza.
- [ ] Crea un quiz en el módulo 1 (1 pregunta de opción simple) y un
      **examen final** con 1 pregunta.
- [ ] Publica el curso (botón Publicar) — pasa a "publicado".
- [ ] Crea el estudiante `smoke-alum2` desde el panel (contraseña
      temporal visible una sola vez).
- [ ] En el detalle de `smoke-alum2`, usa "Cambiar contraseña" —
      muestra la nueva clave una vez y no en el siguiente GET.
- [ ] En una lección, sube un archivo (imagen ≤50MB) en el bloque de
      material — queda con URL pública de `aula-media`.

## S4 — Estudiante del admin

1. Entra como `smoke-alum2` (o con la contraseña nueva).
2. Abre `smoke-curso` (publicado).

- [ ] Ve las lecciones, marca progreso, el sidebar refleja el estado.
- [ ] Responde el quiz del módulo 1 (tras completar sus lecciones).
- [ ] Ve nota, desglose por pregunta y, si falló, el feedback inline
      y el modal "Ver material" (cierra con Escape, backdrop y
      botón Cerrar).
- [ ] Reintenta el quiz (hasta el máximo configurado) y las notas
      quedan en el historial `/c/smoke-curso/results`.

## S5 — Examen final

1. Con `smoke-alum2` (con quizzes del módulo aún sin aprobar):
2. Intenta abrir el examen desde el sidebar o la URL directa
   `/c/smoke-curso/exam` / `/c/smoke-curso/quiz/<id-examen>`.

- [ ] Aparece la vista "Examen bloqueado" con la lista de quizzes
      faltantes y enlace a cada uno.
- [ ] Aprueba todos los quizzes del módulo.
- [ ] El examen se desbloquea y muestra el formulario.
- [ ] Si el examen tiene tiempo (ej. 1 min): el topbar muestra el
      temporizador mm:ss; al llegar a 0 se envía solo y los
      resultados muestran "Se acabó el tiempo".
- [ ] Al aprobarlo, el sidebar lo marca "Examen completado" (✓).
- [ ] Los resultados del examen tienen "Ver ranking del curso" y la
      nota "El examen puntúa ×2".

## S6 — Móvil (375px)

1. Con las dev tools del navegador en 375px de ancho:

- [ ] El topbar muestra el botón hamburguesa; el sidebar abre/cierra.
- [ ] No hay scroll horizontal en ninguna vista (curso, lección,
      quiz, resultados, ranking, panel admin, login).
- [ ] Los botones y enlaces son cómodos de tocar.

## S7 — Errores y estados

- [ ] `/c/no-existe` → 404 con layout ("Curso no encontrado").
- [ ] Ruta protegida en ventana anónima → `/login?expired=1` con
      aviso "Tu sesión expiró"; tras login vuelve a la ruta original.
- [ ] Quiz sin preguntas (en preparación) → estado "En preparación",
      sin formulario ni 0/0 "Suspendido".
- [ ] Quiz con intentos agotados → mensaje claro, sin formulario.

## S8 — Apariencia

- [ ] Colores, tipografía y densidad coinciden con
      `design/reference.html` (beige oscuro, acentos dorado/verde/rojo
      semánticos, layout de 3 columnas).
- [ ] El examen en el ranking puntúa ×2 (ver página de ranking).
