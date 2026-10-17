$ErrorActionPreference = 'Stop'
$previewUrl = 'http://127.0.0.1:4173/website.html'
$previewReady = $false
try {
    $previewResponse = Invoke-WebRequest -Uri $previewUrl -TimeoutSec 2
    $previewReady = $previewResponse.StatusCode -eq 200 -and $previewResponse.Content.Contains('CommonTime')
} catch { }
if (-not $previewReady) {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    $previewScript = Join-Path $PSScriptRoot 'serve.cjs'
    Start-Process -FilePath $nodeExecutable -ArgumentList @('"' + $previewScript + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $previewResponse = Invoke-WebRequest -Uri $previewUrl -TimeoutSec 2
            if ($previewResponse.StatusCode -eq 200 -and $previewResponse.Content.Contains('CommonTime')) { $previewReady = $true; break }
        } catch { }
    }
}
if (-not $previewReady) { throw 'Could not start CommonTime. Check that Node.js is installed and port 4173 is available.' }
Start-Process $previewUrl
