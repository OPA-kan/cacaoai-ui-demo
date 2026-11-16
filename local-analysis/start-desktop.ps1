# One-click start of the CacaoAI Desktop (called by Start-CacaoAI-Desktop.bat).
#   1. optionally runs the CacaoAI disease AI on the Drive Inbox (-RunAI);
#   2. starts the local server (dashboard pages + field analysis) unless it is already running;
#   3. opens the dashboard in the default browser.
# Closing the "CacaoAI local server" window stops the server.
param(
  [switch]$RunAI,
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$url = "http://127.0.0.1:$Port/valencia-desktop/"

function Test-Server {
  try {
    (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/health").StatusCode -eq 200
  } catch { $false }
}

if ($RunAI) {
  # The distribution folder name is not ASCII; find it by pattern so this file stays ASCII-only.
  $exe = Get-ChildItem -Path (Join-Path $workspaceRoot 'cacao_healty_check') -Filter 'CacaoAI.exe' -Recurse -Depth 1 -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -notmatch 'dist_|build_' } | Select-Object -First 1
  if ($exe) {
    Write-Host "Running the disease AI on the Drive Inbox: $($exe.FullName)"
    Start-Process -FilePath $exe.FullName -WorkingDirectory $exe.DirectoryName -Wait
  } else {
    Write-Warning 'CacaoAI.exe not found; skipping the disease AI.'
  }
}

if (-not (Test-Server)) {
  $python = Join-Path $workspaceRoot 'cacao_healty_check\.venv311\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $python)) { $python = 'python' }
  $env:CACOAI_WORKSPACE_ROOT = $workspaceRoot
  $server = Join-Path $PSScriptRoot 'server.py'
  Start-Process -FilePath $python -ArgumentList @("`"$server`"", '--host', '127.0.0.1', '--port', $Port) `
    -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
  for ($i = 0; $i -lt 60 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Server)) { throw "The local server did not start on port $Port." }
}

Start-Process $url
