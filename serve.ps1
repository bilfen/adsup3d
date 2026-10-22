# AD'S UP yerel sunucu (Bun gerekmez)
# powershell -ExecutionPolicy Bypass -File serve.ps1
# Anahtar yalnizca .env icindedir. Bu betik anahtari ekrana yazmaz. .env istekleri 404 doner.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootFull = [IO.Path]::GetFullPath($root)
if (-not $rootFull.EndsWith("\")) { $rootPrefix = $rootFull + "\" } else { $rootPrefix = $rootFull }

$envPath = Join-Path $rootFull ".env"
if (Test-Path -LiteralPath $envPath) {
  foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#") -or -not $t.Contains("=")) { continue }
    $i = $t.IndexOf("=")
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) { $v = $v.Substring(1, $v.Length - 2) }
    if (-not [Environment]::GetEnvironmentVariable($k, "Process")) {
      [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
  }
}

$extTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".png"  = "image/png"
  ".webp" = "image/webp"
  ".glb"  = "model/gltf-binary"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

$models = @("gemini-3.1-flash-lite-image", "gemini-2.5-flash-image", "gemini-nano-banana-2.1")
$prompt = "Bu bir ogrencinin kendi cizimi veya fotografi. Ayni konuyu, ayni sekilleri ve kompozisyonu koru. Renkleri daha canli, doygun ve temiz yap. Arka plani sade, acik ve duz bir renk yap ki nesne ayrilsin. Yeni nesne, yeni yazi veya logo ekleme. Tek bir net gorsel dondur."

function Hide-Key([string]$msg) {
  $key = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "Process")
  if ($key) { $msg = $msg.Replace($key, "[anahtar]") }
  if ($msg.Length -gt 280) { return $msg.Substring(0, 280) }
  return $msg
}

function Find-Image($node, $depth) {
  if ($null -eq $node -or $depth -gt 12) { return $null }
  if ($node -is [string]) { return $null }
  if ($node -is [System.Array]) {
    foreach ($item in $node) {
      $hit = Find-Image $item ($depth + 1)
      if ($hit) { return $hit }
    }
    return $null
  }
  $props = $node.PSObject.Properties
  if (-not $props) { return $null }
  $inline = $node.inlineData
  if (-not $inline) { $inline = $node.inline_data }
  if ($inline -and $inline.data -and $inline.data.Length -gt 80) {
    $mime = $inline.mimeType
    if (-not $mime) { $mime = $inline.mime_type }
    if (-not $mime) { $mime = "image/png" }
    if ([string]$mime -like "image/*") { return @{ mime = [string]$mime; data = [string]$inline.data } }
  }
  foreach ($p in $props) {
    if ($p.Value -is [string]) { continue }
    $hit = Find-Image $p.Value ($depth + 1)
    if ($hit) { return $hit }
  }
  return $null
}

function Invoke-Gemini([byte[]]$bytes, [string]$mime) {
  $b64 = [Convert]::ToBase64String($bytes)
  $key = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "Process")
  $headers = @{ "x-goog-api-key" = $key }
  $last = "Gemini gorsel dondurmedi"
  foreach ($model in $models) {
    $payload = @{
      contents = @(@{
        role = "user"
        parts = @(
          @{ text = $prompt },
          @{ inline_data = @{ mime_type = $mime; data = $b64 } }
        )
      })
      generationConfig = @{ responseModalities = @("TEXT", "IMAGE") }
    } | ConvertTo-Json -Depth 8 -Compress
    try {
      $resp = Invoke-WebRequest -Uri ("https://generativelanguage.googleapis.com/v1beta/models/" + $model + ":generateContent") -Method Post -Headers $headers -ContentType "application/json" -Body $payload -UseBasicParsing
      $json = $resp.Content | ConvertFrom-Json
      $img = Find-Image $json 0
      if ($img) { return $img }
      $last = "Model yanit verdi ama gorsel yok"
    } catch {
      $code = 0
      if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
      $detail = $_.ErrorDetails.Message
      if (-not $detail) { $detail = $_.Exception.Message }
      $last = Hide-Key ([string]$detail)
      if ($code -eq 401 -or $code -eq 403 -or $code -eq 429) { throw $last }
    }
  }
  throw (Hide-Key $last)
}

function Send-Bytes($res, [byte[]]$bytes, [string]$ctype, [int]$status) {
  $res.StatusCode = $status
  $res.ContentType = $ctype
  $res.Headers["Cache-Control"] = "no-store"
  $res.ContentLength64 = $bytes.LongLength
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.OutputStream.Close()
}

function Send-Text($res, [string]$text, [string]$ctype, [int]$status) {
  Send-Bytes $res ([Text.Encoding]::UTF8.GetBytes($text)) $ctype $status
}

function Resolve-Safe([string]$urlPath) {
  $rel = [Uri]::UnescapeDataString($urlPath)
  if ([string]::IsNullOrEmpty($rel) -or $rel -eq "/") { $rel = "/index.html" }
  $rel = $rel.TrimStart("/") -replace "/", "\"
  if ($rel.Contains("..")) { return $null }
  foreach ($part in $rel.Split("\")) {
    if ($part.StartsWith(".")) { return $null }
  }
  $full = [IO.Path]::GetFullPath((Join-Path $rootFull $rel))
  if ($full -eq $rootFull -or $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { return $full }
  return $null
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8080/")
$listener.Start()
$hasKey = [bool][Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "Process")
Write-Host "AD'S UP yerel sunucu: http://localhost:8080/"
if ($hasKey) { Write-Host "Gemini renk canlandirma: acik (anahtar .env icinde)" } else { Write-Host "Gemini renk canlandirma: kapali (video yine calisir)" }
Write-Host "Durdurmak icin bu pencerede Ctrl+C"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $path = $req.Url.AbsolutePath
      if ($path -eq "/api/health") {
        $flag = "false"
        if ($hasKey) { $flag = "true" }
        Send-Text $res ("{""gemini"":" + $flag + ",""engine"":""i2v""}") "application/json; charset=utf-8" 200
        continue
      }
      if ($path -eq "/api/enhance" -and $req.HttpMethod -eq "POST") {
        if (-not $hasKey) { Send-Text $res "Gemini anahtari yok" "text/plain; charset=utf-8" 503; continue }
        $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
        $raw = $reader.ReadToEnd()
        $reader.Close()
        $body = $raw | ConvertFrom-Json
        if (-not $body.data) { Send-Text $res "Gorsel yok" "text/plain; charset=utf-8" 400; continue }
        $bytes = [Convert]::FromBase64String([string]$body.data)
        if ($bytes.Length -gt 8MB) { Send-Text $res "Gorsel 8 MB sinirini asiyor" "text/plain; charset=utf-8" 413; continue }
        $mime = "image/jpeg"
        if ($body.mime -and ([string]$body.mime).StartsWith("image/")) { $mime = [string]$body.mime }
        try {
          $out = Invoke-Gemini $bytes $mime
          $outBytes = [Convert]::FromBase64String($out.data)
          Send-Bytes $res $outBytes $out.mime 200
        } catch {
          Send-Text $res (Hide-Key $_.Exception.Message) "text/plain; charset=utf-8" 502
        }
        continue
      }
      $file = Resolve-Safe $path
      if (-not $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
        Send-Text $res "404" "text/plain; charset=utf-8" 404
        continue
      }
      $ctype = $extTypes[[IO.Path]::GetExtension($file).ToLowerInvariant()]
      if (-not $ctype) { $ctype = "application/octet-stream" }
      $data = [IO.File]::ReadAllBytes($file)
      Send-Bytes $res $data $ctype 200
    } catch {
      try { Send-Text $res "Sunucu hatasi" "text/plain; charset=utf-8" 500 } catch {}
    }
  }
} finally {
  $listener.Stop()
}
