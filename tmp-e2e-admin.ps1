$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3100'
$script:pass = 0
$script:fail = 0

function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; Write-Output "PASS: $name" }
  else { $script:fail++; Write-Output "FAIL: $name  [$detail]" }
}

# 0) archivos para uploads
$png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
[IO.File]::WriteAllBytes("$PWD\tmp-test.png", $png)
Set-Content -Path "$PWD\tmp-test.txt" -Value 'no soy imagen'

# 1) anonimo no entra al panel
$anon = Invoke-WebRequest -Uri "$base/admin" -UseBasicParsing
Check 'anonimo -> login' ($anon.BaseResponse.ResponseUri.AbsolutePath -eq '/login') $anon.BaseResponse.ResponseUri.AbsolutePath

# 2) estudiante no entra (403)
$st = $null
Invoke-WebRequest -Uri "$base/login" -Method Post -Body @{ identity = 'Estudiante Prueba'; password = 'clave1234' } -SessionVariable st -UseBasicParsing | Out-Null
try {
  $r = Invoke-WebRequest -Uri "$base/admin" -WebSession $st -UseBasicParsing -ErrorAction Stop
  Check 'estudiante 403' ($r.StatusCode -eq 403) $r.StatusCode
} catch {
  Check 'estudiante 403' ([int]$_.Exception.Response.StatusCode -eq 403) ([int]$_.Exception.Response.StatusCode)
}

# 3) login admin (email -> admin). Credenciales leidas de .env (sin imprimirlas).
$envLines = Get-Content .env
$adminMail = ($envLines | Select-String '^ADMIN_EMAIL=').Line.Substring(12).Trim('"', "'")
$adminPass = ($envLines | Select-String '^ADMIN_PASSWORD=').Line.Substring(15).Trim('"', "'")
$ad = $null
$login = Invoke-WebRequest -Uri "$base/login" -Method Post -Body @{ identity = $adminMail; password = $adminPass } -SessionVariable ad -UseBasicParsing
Check 'login admin' ($login.Content -match 'class="dot"') $login.StatusCode

# 4) dashboard
$dash = Invoke-WebRequest -Uri "$base/admin" -WebSession $ad -UseBasicParsing
Check 'dashboard 200' ($dash.StatusCode -eq 200)
Check 'dashboard titulo' ($dash.Content -match '>Dashboard<')
Check 'stat cursos' ($dash.Content -match 'Cursos</span><b>')
Check 'stat estudiantes' ($dash.Content -match 'Estudiantes</span><b>')
Check 'ultimos intentos' ($dash.Content -match 'Ultimos intentos|ltimos intentos')

# 5) crear curso
$c1 = Invoke-WebRequest -Uri "$base/admin/courses" -Method Post -Body @{ title = 'Curso de prueba E2E' } -WebSession $ad -UseBasicParsing
$cpath = $c1.BaseResponse.ResponseUri.AbsolutePath
Check 'crear curso redirige' ($cpath -match '^/admin/courses/\d+$') $cpath
$courseId = $cpath.Split('/')[-1]

$ce = Invoke-WebRequest -Uri "$base$cpath" -WebSession $ad -UseBasicParsing
Check 'edicion curso 200' ($ce.Content -match 'Curso de prueba E2E')
Check 'slug auto' ($ce.Content -match 'value="curso-de-prueba-e2e"')

# 6) guardar metadata
$saveC = Invoke-WebRequest -Uri "$base$cpath" -Method Post -Body @{ title = 'Curso de prueba E2E'; slug = 'curso-de-prueba-e2e'; description = 'Descripcion E2E'; published = 'on' } -WebSession $ad -UseBasicParsing
$ce2 = Invoke-WebRequest -Uri "$base$cpath" -WebSession $ad -UseBasicParsing
Check 'metadata guardada' ($ce2.Content -match 'Descripcion E2E')
Check 'publicado' ($ce2.Content -match 'Publicado')

# 7) dos modulos + reordenar
$m1 = Invoke-WebRequest -Uri "$base$cpath/modules" -Method Post -Body @{ title = 'Modulo A' } -WebSession $ad -UseBasicParsing
$m2 = Invoke-WebRequest -Uri "$base$cpath/modules" -Method Post -Body @{ title = 'Modulo B' } -WebSession $ad -UseBasicParsing
$tree1 = (Invoke-WebRequest -Uri "$base$cpath" -WebSession $ad -UseBasicParsing).Content
Check 'modulos creados' (($tree1 -match 'Modulo A') -and ($tree1 -match 'Modulo B'))
$ids = [regex]::Matches($tree1, '/admin/modules/(\d+)/reorder') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
Check 'ids modulos' ($ids.Count -eq 2) $ids.Count
# subir el segundo (B)
Invoke-WebRequest -Uri "$base/admin/modules/$($ids[1])/reorder" -Method Post -Body @{ dir = 'up' } -WebSession $ad -UseBasicParsing | Out-Null
$tree2 = (Invoke-WebRequest -Uri "$base$cpath" -WebSession $ad -UseBasicParsing).Content
$ia = $tree2.IndexOf('Modulo A'); $ib = $tree2.IndexOf('Modulo B')
Check 'reorder B antes de A' ($ib -ge 0 -and $ia -ge 0 -and $ib -lt $ia) "A=$ia B=$ib"

# 8) leccion dentro del modulo B (ids[0] tras mover? usar el modulo que quedo segundo)
# creamos la leccion en el segundo modulo de la lista (Modulo A, ids[0])
$lessonResp = Invoke-WebRequest -Uri "$base/admin/modules/$($ids[0])/lessons" -Method Post -Body @{ title = 'Leccion E2E' } -WebSession $ad -UseBasicParsing
$lpath = $lessonResp.BaseResponse.ResponseUri.AbsolutePath
Check 'crear leccion redirige' ($lpath -match '^/admin/lessons/\d+$') $lpath
$lessonId = $lpath.Split('/')[-1]

# 9) guardar leccion con markdown
$bodyLesson = 'title=Leccion+E2E&content=%23+Hola+E2E%0A%0AContenido+**fuerte**.'
Invoke-WebRequest -Uri "$base$lpath" -Method Post -Body $bodyLesson -ContentType 'application/x-www-form-urlencoded' -WebSession $ad -UseBasicParsing | Out-Null
$lgot = (Invoke-WebRequest -Uri "$base$lpath" -WebSession $ad -UseBasicParsing).Content
Check 'leccion guardada' ($lgot -match 'Hola E2E')
Check 'preview renderizado' ($lgot -match '<h1>Hola E2E</h1>')

# 10) endpoint preview JSON
$pv = Invoke-WebRequest -Uri "$base/admin/lessons/$lessonId/preview" -Method Post -Body @{ content = '## Subtitulo E2E' } -WebSession $ad -UseBasicParsing
Check 'preview json' ($pv.Content -match '<h2>Subtitulo E2E</h2>') $pv.Content

# 11) crear quiz del modulo (el modulo con la leccion es ids[0]? creamos en ambos hasta que aparezca)
$quizIds = @()
foreach ($mid in $ids) {
  $qresp = Invoke-WebRequest -Uri "$base$cpath/quizzes" -Method Post -Body @{ kind = 'quiz'; module_id = $mid } -WebSession $ad -UseBasicParsing
  $qid = $qresp.BaseResponse.ResponseUri.AbsolutePath.Split('/')[-1]
  $quizIds += $qid
}
Check 'quiz creado' ($quizIds.Count -eq 2)
$quizId = $quizIds[0]
$qe = Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId" -WebSession $ad -UseBasicParsing
Check 'editor quiz 200' ($qe.Content -match 'A.adir pregunta')
Check 'form add pregunta' ($qe.Content -match 'name="type"')

# 12) metadata del quiz
Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId" -Method Post -Body @{ title = 'Quiz E2E'; time_limit_min = '15'; max_attempts = '2'; pass_score = '80'; shuffle = 'on' } -WebSession $ad -UseBasicParsing | Out-Null
$qe2 = (Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId" -WebSession $ad -UseBasicParsing).Content
Check 'quiz metadata' (($qe2 -match 'Quiz E2E') -and ($qe2 -match 'value="15"') -and ($qe2 -match 'value="80"'))

# 13) anadir los 6 tipos de pregunta
function Add-Q($type, $body) {
  $all = "type=$type&" + $body
  Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId/questions" -Method Post -Body $all -ContentType 'application/x-www-form-urlencoded' -WebSession $ad -UseBasicParsing | Out-Null
}
Add-Q 'single' 'prompt=Quien+popularizo&points=2&opt=Brook+Taylor&opt=Fourier&correct=0'
Add-Q 'multiple' 'prompt=Formas+de+representar&points=2&opt=Canonica&opt=Taylor&opt=Integral&correct=0&correct=1'
Add-Q 'truefalse' 'prompt=Siempre+converge&points=1&tf=false'
Add-Q 'short' 'prompt=Escribe+polinomio&points=1&accepted=polinomio+de+taylor'
Add-Q 'match' 'prompt=Relaciona&points=2&left=f%28a%29&left=f%27%28a%29&right=valor&right=pendiente'
Add-Q 'order' 'prompt=Ordena&points=2&items=constante&items=lineal&items=cuadratico'
$qe3 = (Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId" -WebSession $ad -UseBasicParsing).Content
Check '6 preguntas anadidas' ([regex]::Matches($qe3, 'Pregunta \d+ ').Count -eq 6) ([regex]::Matches($qe3, 'Pregunta \d+ ').Count)

# 14) error con payload invalido (single sin opciones)
$bad = Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId/questions" -Method Post -Body 'type=single&prompt=Pregunta+mala&points=1&opt=unica' -ContentType 'application/x-www-form-urlencoded' -WebSession $ad -UseBasicParsing
Check 'payload invalido -> error' ($bad.BaseResponse.ResponseUri.AbsolutePath -eq "/admin/quizzes/$quizId" -and $bad.Content -match 'defbox') $bad.BaseResponse.ResponseUri.AbsolutePath

# 15) editar pregunta (cambiar enunciado)
$qids = [regex]::Matches($qe3, '/admin/questions/(\d+)/delete') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
Check 'ids preguntas' ($qids.Count -eq 6) $qids.Count
Invoke-WebRequest -Uri "$base/admin/questions/$($qids[0])" -Method Post -Body 'prompt=Quien+popularizo+Taylor&points=3&opt=Brook+Taylor&opt=Fourier&correct=0' -ContentType 'application/x-www-form-urlencoded' -WebSession $ad -UseBasicParsing | Out-Null
$qe4 = (Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId" -WebSession $ad -UseBasicParsing).Content
Check 'pregunta editada' ($qe4 -match 'popularizo Taylor')

# 16) feedback anadir y quitar
Invoke-WebRequest -Uri "$base/admin/questions/$($qids[0])/feedback" -Method Post -Body @{ kind = 'text'; content = 'Brook Taylor 1715' } -WebSession $ad -UseBasicParsing | Out-Null
$qe5 = (Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId" -WebSession $ad -UseBasicParsing).Content
Check 'feedback anadido' ($qe5 -match 'Brook Taylor 1715')
$fbid = [regex]::Match($qe5, '/admin/feedback/(\d+)/delete').Groups[1].Value
Invoke-WebRequest -Uri "$base/admin/feedback/$fbid/delete" -Method Post -WebSession $ad -UseBasicParsing | Out-Null
$qe6 = (Invoke-WebRequest -Uri "$base/admin/quizzes/$quizId" -WebSession $ad -UseBasicParsing).Content
Check 'feedback quitado' (-not ($qe6 -match 'Brook Taylor 1715'))

# 17) uploads: imagen ok, texto rechazado
function Send-Upload($path, $mime) {
  $boundary = [guid]::NewGuid().ToString()
  $bytes = [IO.File]::ReadAllBytes($path)
  $name = Split-Path $path -Leaf
  $head = "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"$name`"`r`nContent-Type: $mime`r`n`r`n"
  $tail = "`r`n--$boundary--`r`n"
  $enc = [Text.Encoding]::UTF8
  $body = $enc.GetBytes($head) + $bytes + $enc.GetBytes($tail)
  try {
    $r = Invoke-WebRequest -Uri "$base/admin/uploads" -Method Post -Body $body `
      -ContentType "multipart/form-data; boundary=$boundary" -WebSession $ad -UseBasicParsing -ErrorAction Stop
    return @{ code = 200; content = $r.Content }
  } catch {
    return @{ code = [int]$_.Exception.Response.StatusCode; content = '' }
  }
}
$up = Send-Upload "$PWD\tmp-test.png" 'image/png'
Check 'upload imagen ok' (($up.code -eq 200) -and ($up.content -match 'supabase') -and ($up.content -match 'aula-media')) "$($up.code) $($up.content)"
$up2 = Send-Upload "$PWD\tmp-test.txt" 'text/plain'
Check 'upload texto 400' ($up2.code -eq 400) $up2.code

# 18) estudiantes: lista, crear, detalle
$sl = Invoke-WebRequest -Uri "$base/admin/students" -WebSession $ad -UseBasicParsing
Check 'lista estudiantes' ($sl.Content -match 'Estudiante Prueba')
$mk = Invoke-WebRequest -Uri "$base/admin/students" -Method Post -Body @{ name = 'Estudiante Nuevo E2E'; password = 'clave1234' } -WebSession $ad -UseBasicParsing
Check 'crear estudiante' ((Invoke-WebRequest -Uri "$base/admin/students" -WebSession $ad -UseBasicParsing).Content -match 'Estudiante Nuevo E2E')
$dup = Invoke-WebRequest -Uri "$base/admin/students" -Method Post -Body @{ name = 'Estudiante Nuevo E2E'; password = 'clave1234' } -WebSession $ad -UseBasicParsing
Check 'nombre duplicado con error' ($dup.Content -match 'ya est')
$idsS = [regex]::Matches($sl.Content, '/admin/students/(\d+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
Check 'ids estudiantes' ($idsS.Count -ge 1) $idsS.Count
# detalle del estudiante con intentos (el primero listado)
$sd = Invoke-WebRequest -Uri "$base/admin/students/$($idsS[0])" -WebSession $ad -UseBasicParsing
Check 'detalle estudiante' ($sd.Content -match 'Intentos')
$attm = [regex]::Match($sd.Content, '/admin/attempts/(\d+)')
Check 'enlace intento' ($attm.Success) 'no link'
if ($attm.Success) {
  $att = Invoke-WebRequest -Uri "$base/admin/attempts/$($attm.Groups[1].Value)" -WebSession $ad -UseBasicParsing
  Check 'detalle intento 200' ($att.Content -match 'Revisi.n de intento|Resultado')
  Check 'detalle muestra preguntas' ($att.Content -match 'Tu respuesta')
}

# 19) eliminar el curso de prueba
Invoke-WebRequest -Uri "$base/admin/courses/$courseId/delete" -Method Post -WebSession $ad -UseBasicParsing | Out-Null
$cl = (Invoke-WebRequest -Uri "$base/admin/courses" -WebSession $ad -UseBasicParsing).Content
Check 'curso eliminado' (-not ($cl -match 'Curso de prueba E2E'))

# 20) el estudiante sigue funcionando
$after = Invoke-WebRequest -Uri "$base/c/polinomio-de-taylor" -WebSession $st -UseBasicParsing
Check 'vista estudiante ok' ($after.StatusCode -eq 200)

Remove-Item "$PWD\tmp-test.png", "$PWD\tmp-test.txt" -ErrorAction SilentlyContinue
Write-Output "----"
Write-Output "PASS=$pass FAIL=$fail"
if ($fail -gt 0) { exit 1 }
