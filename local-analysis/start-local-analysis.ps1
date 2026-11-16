$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$python = Join-Path $workspaceRoot 'cacao_healty_check\.venv311\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  $python = 'python'
}
$env:CACOAI_WORKSPACE_ROOT = $workspaceRoot
& $python (Join-Path $PSScriptRoot 'server.py') --host 127.0.0.1 --port 8787
