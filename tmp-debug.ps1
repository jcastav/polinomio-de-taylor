$base = 'http://localhost:3100'
$envLines = Get-Content .env
$adminMail = ($envLines | Select-String '^ADMIN_EMAIL=').Line.Substring(12).Trim('"', "'")
$adminPass = ($envLines | Select-String '^ADMIN_PASSWORD=').Line.Substring(15).Trim('"', "'")
$ad = $null
Invoke-WebRequest -Uri "$base/login" -Method Post -Body @{ identity = $adminMail; password = $adminPass } -SessionVariable ad -UseBasicParsing | Out-Null

# curso + quiz de desecho
$cc = Invoke-WebRequest -Uri "$base/admin/courses" -Method Post -Body @{ title = 'Curso desecho debug' } -WebSession $ad -UseBasicParsing
$cpath = $cc.BaseResponse.ResponseUri.AbsolutePath
$m = Invoke-WebRequest -Uri "$base$cpath/modules" -Method Post -Body @{ title = 'Mod desecho' } -WebSession $ad -UseBasicParsing
$mid = [regex]::Match((Invoke-WebRequest -Uri "$base$cpath" -WebSession $ad -UseBasicParsing).Content, '/admin/modules/(\d+)/reorder').Groups[1].Value
$qq = Invoke-WebRequest -Uri "$base$cpath/quizzes" -Method Post -Body @{ kind = 'quiz'; module_id = $mid } -WebSession $ad -UseBasicParsing
$qid = $qq.BaseResponse.ResponseUri.AbsolutePath.Split('/')[-1]
Write-Output "quiz desecho=$qid"
$cases = @(
  @{ n = 'single'; b = 'type=single&prompt=Quien+popularizo&points=2&opt=Brook+Taylor&opt=Fourier&correct=0' },
  @{ n = 'multiple'; b = 'type=multiple&prompt=Formas&points=2&opt=Canonica&opt=Taylor&opt=Integral&correct=0&correct=1' },
  @{ n = 'truefalse'; b = 'type=truefalse&prompt=Siempre&points=1&tf=false' },
  @{ n = 'short'; b = 'type=short&prompt=Escribe&points=1&accepted=polinomio' },
  @{ n = 'match'; b = 'type=match&prompt=Relaciona&points=2&left=a&left=b&right=x&right=y' },
  @{ n = 'order'; b = 'type=order&prompt=Ordena&points=2&items=uno&items=dos' }
)
foreach ($c in $cases) {
  try {
    $r = Invoke-WebRequest -Uri "$base/admin/quizzes/$qid/questions" -Method Post -Body $c.b `
      -ContentType 'application/x-www-form-urlencoded' -WebSession $ad -UseBasicParsing -MaximumRedirection 5 -ErrorAction Stop
    $u = $r.BaseResponse.ResponseUri.AbsoluteUri
    if ($u -match 'error=') { Write-Output "$($c.n): ERROR -> $u" } else { Write-Output "$($c.n): OK" }
  } catch {
    Write-Output "$($c.n): EXC $($_.Exception.Message)"
  }
}

# estado actual de preguntas del quiz 1
$qs = (Invoke-WebRequest -Uri "$base/admin/quizzes/$qid" -WebSession $ad -UseBasicParsing).Content
$heads = [regex]::Matches($qs, 'Pregunta (\d+) · ([^·]+)·') | ForEach-Object { $_.Groups[1].Value + ':' + $_.Groups[2].Value.Trim() }
Write-Output ('HEADS: ' + ($heads -join ' | '))

# debug upload con IWR byte body
$png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
$boundary = [guid]::NewGuid().ToString()
$head = "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"t.png`"`r`nContent-Type: image/png`r`n`r`n"
$tail = "`r`n--$boundary--`r`n"
$enc = [Text.Encoding]::UTF8
$body = $enc.GetBytes($head) + $png + $enc.GetBytes($tail)
try {
  $up = Invoke-WebRequest -Uri "$base/admin/uploads" -Method Post -Body $body `
    -ContentType "multipart/form-data; boundary=$boundary" -WebSession $ad -UseBasicParsing -ErrorAction Stop
  Write-Output ('UPLOAD OK: ' + $up.Content)
} catch {
  $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
  $txt = $sr.ReadToEnd()
  Write-Output ('UPLOAD FAIL: ' + [int]$_.Exception.Response.StatusCode + ' body=' + $txt)
}

# limpieza: eliminar el curso desecho (borra quiz y preguntas en cascada)
Invoke-WebRequest -Uri "$base/admin/courses/$($cpath.Split('/')[-1])/delete" -Method Post -WebSession $ad -UseBasicParsing | Out-Null
Write-Output 'curso desecho eliminado'
