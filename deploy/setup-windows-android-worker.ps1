[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

if ($env:OS -ne 'Windows_NT') { throw 'setup-windows-android-worker.ps1 requires Windows.' }

function Require-Command([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { throw "$Name is required." }
    return $command.Source
}

function Import-DfarmingEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { throw "Invalid environment line in $Path" }
        $name = $line.Substring(0, $separator).Trim()
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Invalid environment key $name" }
        $value = $line.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

function Require-Configured([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value) -or $value -match 'replace-|CHANGE_ME') {
        throw "$Name must be configured with a real value in .env"
    }
}

function Wait-Http([string]$Name, [string]$Url, [hashtable]$Headers = @{}) {
    foreach ($attempt in 1..40) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $Headers -TimeoutSec 2 | Out-Null
            return
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$Name did not become ready at $Url"
}

$Node = Require-Command 'node.exe'
Require-Command 'npm.cmd' | Out-Null
Require-Command 'adb.exe' | Out-Null
Require-Command 'java.exe' | Out-Null
Require-Command 'schtasks.exe' | Out-Null

$nodeMajor = [int]((& $Node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 22) { throw 'Node.js >=22 is required.' }

$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Copy-Item (Join-Path $Root '.env.windows-android-worker.example') $EnvFile
    Write-Error 'Created .env. Configure MiniPC URLs/tokens/database and Android SDK, then rerun.'
}
Import-DfarmingEnv $EnvFile
Import-DfarmingEnv (Join-Path $Root '.env.devices')

if ($env:PHONE_FARM_ROLE -ne 'device-worker') { throw 'PHONE_FARM_ROLE=device-worker is required.' }
Require-Configured 'PHONE_FARM_DEVICE_WORKER_TOKEN'
Require-Configured 'PHONE_FARM_INTERNAL_TOKEN'
Require-Configured 'PHONE_FARM_CONTROL_PLANE_URL'
Require-Configured 'DATABASE_URL'

$AndroidRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath (Join-Path $AndroidRoot 'platform-tools\adb.exe'))) {
    throw "Android SDK platform-tools are missing under $AndroidRoot. Set ANDROID_HOME/ANDROID_SDK_ROOT to a complete SDK."
}
$BuildToolsRoot = Join-Path $AndroidRoot 'build-tools'
$BuildTools = Get-ChildItem -LiteralPath $BuildToolsRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $BuildTools -or -not (Test-Path (Join-Path $BuildTools.FullName 'aapt2.exe')) -or -not (Test-Path (Join-Path $BuildTools.FullName 'apksigner.bat'))) {
    throw "Android SDK build-tools with aapt2/apksigner are required under $BuildToolsRoot."
}
$env:ANDROID_HOME = $AndroidRoot
$env:ANDROID_SDK_ROOT = $AndroidRoot

& npm.cmd ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
& npm.cmd rebuild node-native-ocr esbuild sharp --foreground-scripts
if ($LASTEXITCODE -ne 0) { throw 'native dependency rebuild failed' }
if (-not (Test-Path (Join-Path $Root '.appium-runtime\node_modules\appium-uiautomator2-driver'))) {
    & npm.cmd run appium:runtime:install-android
    if ($LASTEXITCODE -ne 0) { throw 'UiAutomator2 driver install failed' }
}
& npm.cmd run doctor:device-worker
if ($LASTEXITCODE -ne 0) { throw 'device-worker doctor failed' }

$RuntimeDir = Join-Path $Root '.runtime\windows'
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$Runner = Join-Path $RuntimeDir 'run-component.ps1'
$runnerTemplate = @'
param([Parameter(Mandatory=$true)][ValidateSet('appium','worker','gateway')][string]$Component)
$ErrorActionPreference = 'Stop'
$Root = '__ROOT__'
Set-Location $Root
function Import-DfarmingEnv([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim(); if (-not $line -or $line.StartsWith('#')) { continue }
        $separator = $line.IndexOf('='); if ($separator -lt 1) { throw "Invalid environment line in $Path" }
        $name = $line.Substring(0,$separator).Trim(); if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Invalid environment key $name" }
        $value = $line.Substring($separator+1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { $value=$value.Substring(1,$value.Length-2) }
        [Environment]::SetEnvironmentVariable($name,$value,'Process')
    }
}
Import-DfarmingEnv (Join-Path $Root '.env')
Import-DfarmingEnv (Join-Path $Root '.env.devices')
$androidRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_HOME = $androidRoot
$env:ANDROID_SDK_ROOT = $androidRoot
$Node = (Get-Command node.exe).Source
switch ($Component) {
    'appium' {
        $env:APPIUM_HOME = Join-Path $Root '.appium-runtime'
        $port = if ($env:APPIUM_RUNTIME_PORT) { $env:APPIUM_RUNTIME_PORT } else { '4726' }
        & $Node (Join-Path $Root 'node_modules\appium-runtime\index.js') --address 127.0.0.1 --base-path / --port $port --log-level info
    }
    'worker' { & $Node --import tsx (Join-Path $Root 'src\scheduler\worker.ts') }
    'gateway' { & $Node --import tsx (Join-Path $Root 'src\device-worker-server.ts') }
}
exit $LASTEXITCODE
'@
$runnerTemplate.Replace('__ROOT__', $Root.Replace("'", "''")) | Set-Content -LiteralPath $Runner -Encoding UTF8

$PowerShell = (Get-Command powershell.exe).Source
$Tasks = @{
    'dFarming-AppiumRuntime' = 'appium'
    'dFarming-SchedulerWorker' = 'worker'
    'dFarming-DeviceGateway' = 'gateway'
}
foreach ($entry in $Tasks.GetEnumerator()) {
    $action = New-ScheduledTaskAction -Execute $PowerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -Component $($entry.Value)"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $entry.Key -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force | Out-Null
}

Start-ScheduledTask -TaskName 'dFarming-AppiumRuntime'
$AppiumPort = if ($env:APPIUM_RUNTIME_PORT) { [int]$env:APPIUM_RUNTIME_PORT } else { 4726 }
Wait-Http 'Appium runtime' "http://127.0.0.1:$AppiumPort/status"
Start-ScheduledTask -TaskName 'dFarming-SchedulerWorker'
Start-ScheduledTask -TaskName 'dFarming-DeviceGateway'
$GatewayPort = if ($env:DEVICE_WORKER_PORT) { [int]$env:DEVICE_WORKER_PORT } else { 3010 }
Wait-Http 'Device worker' "http://127.0.0.1:$GatewayPort/health" @{ Authorization = "Bearer $($env:PHONE_FARM_DEVICE_WORKER_TOKEN)" }

Write-Host 'Windows Android worker is installed and locally healthy.'
Write-Host "MiniPC worker entry: $($env:PHONE_FARM_WORKER_ID)=http://<this-windows-private-address>:$GatewayPort"
