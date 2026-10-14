$base = 'http://localhost:3100'
$envLines = Get-Content .env
$adminMail = ($envLines | Select-String '^ADMIN_EMAIL=').Line.Substring(12).Trim('"', "'")
$adminPass = ($envLines | Select-String '^ADMIN_PASSWORD=').Line.Substring(15).Trim('"', "'")
$ad = $null
Invoke-WebRequest -Uri "$base/login" -Method Post -Body @{ identity = $adminMail; password = $adminPass } -SessionVariable ad -UseBasicParsing | Out-Null

# exportar cookies de sesion para curl
$cookies = ($ad.Cookies.GetCookies([Uri]$base) | ForEach-Object { $_.Name + '=' + $_.Value }) -join '; '
Write-Output ("cookies: " + ($cookies -replace '=.*', '=...'))

$png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
[IO.File]::WriteAllBytes("$PWD\tmp-dbg.png", $png)
Set-Content "$PWD\tmp-dbg.txt" -Value 'hola'

Write-Output '--- curl png ---'
curl.exe -s -w "`nHTTP=%{http_code}" -X POST "$base/admin/uploads" -H "Cookie: $cookies" -F "file=@tmp-dbg.png;type=image/png"
Write-Output '--- curl txt ---'
curl.exe -s -w "`nHTTP=%{http_code}" -X POST "$base/admin/uploads" -H "Cookie: $cookies" -F "file=@tmp-dbg.txt;type=text/plain"
Write-Output '--- IWR byte body (respuesta) ---'
$boundary = [guid]::NewGuid().ToString()
$head = "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"t.png`"`r`nContent-Type: image/png`r`n`r`n"
$tail = "`r`n--$boundary--`r`n"
$enc = [Text.Encoding]::UTF8
$body = $enc.GetBytes($head) + $png + $enc.GetBytes($tail)
try {
  $up = Invoke-WebRequest -Uri "$base/admin/uploads" -Method Post -Body $body `
    -ContentType "multipart/form-data; boundary=$boundary" -WebSession $ad -UseBasicParsing -ErrorAction Stop
  Write-Output ('IWR OK: ' + $up.Content)
} catch {
  Write-Output ('IWR status: ' + [int]$_.Exception.Response.StatusCode)
  try {
    $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Output ('IWR body: ' + $sr.ReadToEnd())
  } catch { Write-Output 'IWR body: (no legible)' }
}
Remove-Item tmp-dbg.png, tmp-dbg.txt -ErrorAction SilentlyContinue
