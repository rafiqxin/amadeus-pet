# Launch the AMA-DEUS Kurisu TTS server (port 9881).
#
#   .\voice-server\run.ps1            # local only, for the desktop app
#   .\voice-server\run.ps1 -Lan       # bind 0.0.0.0 so Android can reach it
#   .\voice-server\run.ps1 -Port 9882
#
# The conda environment is activated rather than merely invoked, because
# GPT-SoVITS needs the environment's DLL directories (Library\bin) on PATH for
# ffmpeg and the native audio libraries.

[CmdletBinding()]
param(
    [switch]$Lan,
    [int]$Port = 9881,
    [string]$EnvName = "GPTSoVits",
    [string]$CondaRoot = "F:\Miniconda\Miniconda_Launch"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envDir = Join-Path (Join-Path $CondaRoot "envs") $EnvName
$python = Join-Path $envDir "python.exe"

if (-not (Test-Path $python)) {
    throw "Python not found at $python. Pass -CondaRoot / -EnvName to point at your environment."
}

# Environment for GPT-SoVITS: PATH first (native DLLs), UTF-8 so Windows
# consoles do not mangle Japanese phonemes or the Chinese checkpoint names.
$env:Path = "$envDir;$envDir\Library\bin;$envDir\Scripts;$env:Path"
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'

$arguments = @()
if ($Lan) { $arguments += '--lan' }
$arguments += @('--port', "$Port")

Write-Host "repo   : $repoRoot"
Write-Host "python : $python"
Write-Host "mode   : $(if ($Lan) { 'LAN (0.0.0.0)' } else { 'local (127.0.0.1)' })"
Write-Host ""

Set-Location $repoRoot
& $python "voice-server\kurisu_tts_server.py" @arguments
exit $LASTEXITCODE
