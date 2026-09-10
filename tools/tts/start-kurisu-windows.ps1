param(
  [switch]$Install,
  [ValidateSet('CU126','CU128','CPU')][string]$Device = 'CU126',
  [ValidateSet('HF','HF-Mirror','ModelScope')][string]$Source = 'HF',
  [string]$Python = 'python',
  [string]$Workspace = '',
  [int]$Port = 9881
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ([string]::IsNullOrWhiteSpace($Workspace)) { $Workspace = Join-Path $Root '.workspace\tts' }
$Gsv = Join-Path $Workspace 'GPT-SoVITS'
$Model = Join-Path $Workspace 'TTS-KurisuMakise'
New-Item -ItemType Directory -Force -Path $Workspace, $Model | Out-Null

function Invoke-Python([string[]]$Args) {
  & $Python @Args
  if ($LASTEXITCODE -ne 0) { throw "Python command failed: $Python $($Args -join ' ')" }
}

# Accept either a Git clone or a browser-downloaded/extracted GPT-SoVITS tree.
$Installer = Join-Path $Gsv 'install.ps1'
if (-not (Test-Path $Installer)) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "GPT-SoVITS is missing and git is unavailable. Download the GPT-SoVITS main ZIP in a browser and extract it so this file exists: $Installer"
  }
  git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git $Gsv
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to clone GPT-SoVITS. Download the GPT-SoVITS main ZIP in a browser, extract it into '$Gsv', then run this script again."
  }
}
if (-not (Test-Path $Installer)) { throw "GPT-SoVITS tree is incomplete: install.ps1 not found at $Installer" }

function Repair-GptSoVitsCondaInstaller {
  param([string]$Path)
  $text = Get-Content $Path -Raw
  $needle = '$output = & conda install -y -q -c conda-forge @Args 2>&1'
  if ($text.Contains($needle)) {
    # In an activated Conda PowerShell session, `conda` can be a shell function.
    # GPT-SoVITS also defines Invoke-Conda in install.ps1; on older Conda/Windows
    # PowerShell combinations this name collision can recurse until the PowerShell
    # call-depth limit is hit. Invoke the real CONDA_EXE instead of the shell wrapper.
    $replacement = '$CondaExe = if ($env:CONDA_EXE -and (Test-Path $env:CONDA_EXE)) { $env:CONDA_EXE } else { (Get-Command conda.exe -ErrorAction Stop).Source }' + "`r`n    " + '$output = & $CondaExe install -y -q -c conda-forge @Args 2>&1'
    $text = $text.Replace($needle, $replacement)
    Set-Content -Path $Path -Value $text -Encoding UTF8
    Write-Host 'Patched GPT-SoVITS install.ps1 to invoke CONDA_EXE directly (prevents PowerShell recursion).'
  }
}

if ($Install) {
  Repair-GptSoVitsCondaInstaller -Path $Installer
  Push-Location $Gsv
  try {
    & .\install.ps1 -Device $Device -Source $Source
    if ($LASTEXITCODE -ne 0) { throw 'GPT-SoVITS install.ps1 failed' }
  } finally { Pop-Location }
}

try { & $Python -c 'import huggingface_hub' | Out-Null }
catch { Invoke-Python @('-m','pip','install','-U','huggingface_hub') }
if ($LASTEXITCODE -ne 0) { Invoke-Python @('-m','pip','install','-U','huggingface_hub') }

$DownloadScript = @"
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='bysq/TTS-KurisuMakise',
    local_dir=r'''$Model''',
    allow_patterns=['*.ckpt', '*.pth', '害羞示范.wav', '无奈.wav'],
)
"@
$DownloadScript | & $Python -
if ($LASTEXITCODE -ne 0) { throw 'Kurisu model download failed' }

$GptWeight = Get-ChildItem $Model -Filter *.ckpt | Select-Object -First 1
$SovitsWeight = Get-ChildItem $Model -Filter *.pth | Select-Object -First 1
$Ref = if ($env:KURISU_REF_AUDIO) { $env:KURISU_REF_AUDIO } else { Join-Path $Model '无奈.wav' }
$RefShy = if ($env:KURISU_REF_SHY) { $env:KURISU_REF_SHY } else { Join-Path $Model '害羞示范.wav' }
if (-not $GptWeight -or -not $SovitsWeight -or -not (Test-Path $Ref)) { throw 'Kurisu GPT/SoVITS weight or reference WAV is missing' }

$Pretrained = Join-Path $Gsv 'GPT_SoVITS\pretrained_models'
$Bert = Join-Path $Pretrained 'chinese-roberta-wwm-ext-large'
$Hubert = Join-Path $Pretrained 'chinese-hubert-base'
if (-not (Test-Path $Bert) -or -not (Test-Path $Hubert)) {
  throw "GPT-SoVITS pretrained assets are missing. Run once inside the intended Python/Conda environment: .\tools\tts\start-kurisu-windows.ps1 -Install -Device $Device"
}

$Config = Join-Path $Workspace 'tts_infer_kurisu.yaml'
@"
custom:
  bert_base_path: $($Bert -replace '\\','/')
  cnhuhbert_base_path: $($Hubert -replace '\\','/')
  device: $(if ($Device -eq 'CPU') {'cpu'} else {'cuda'})
  is_half: $(if ($Device -eq 'CPU') {'false'} else {'true'})
  t2s_weights_path: $($GptWeight.FullName -replace '\\','/')
  version: v2Pro
  vits_weights_path: $($SovitsWeight.FullName -replace '\\','/')
"@ | Set-Content -Encoding UTF8 $Config

& $Python -c "import torch; print('torch cuda available:', torch.cuda.is_available()); print('gpu:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
if ($LASTEXITCODE -ne 0) { throw 'PyTorch environment check failed' }

$ApiArgs = @('api_v2.py','-a','127.0.0.1','-p','9880','-c',$Config)
$Upstream = Start-Process -FilePath $Python -ArgumentList $ApiArgs -WorkingDirectory $Gsv -PassThru -NoNewWindow
try {
  Write-Host 'Waiting for GPT-SoVITS on 127.0.0.1:9880 ...'
  $Ready = $false
  for ($i=0; $i -lt 120; $i++) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $iar = $tcp.BeginConnect('127.0.0.1', 9880, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(500) -and $tcp.Connected) { $Ready = $true; $tcp.Close(); break }
      $tcp.Close()
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $Ready) { throw 'GPT-SoVITS did not become ready within 120 seconds' }

  $env:GPT_SOVITS_UPSTREAM = 'http://127.0.0.1:9880'
  $env:KURISU_REF_AUDIO = $Ref
  $env:KURISU_REF_SHY = $RefShy
  $env:KURISU_PROMPT_LANG = 'ja'
  $env:AMA_TTS_PORT = [string]$Port
  $env:AMA_TTS_ENGINE = 'GPT-SoVITS-v2Pro/TTS-KurisuMakise'

  Write-Host "AMA-DEUS Kurisu TTS is starting on http://0.0.0.0:$Port"
  Write-Host 'Language contract: Chinese input/subtitle -> Japanese generated speech'
  Push-Location $Root
  try { & $Python tools\tts\ama_tts_proxy.py }
  finally { Pop-Location }
} finally {
  if ($Upstream -and -not $Upstream.HasExited) { Stop-Process -Id $Upstream.Id -Force -ErrorAction SilentlyContinue }
}
