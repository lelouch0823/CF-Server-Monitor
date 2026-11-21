#Requires -Version 5.1
<#
.SYNOPSIS
    卸载 CF-Server-Monitor Windows PowerShell 探针。
.EXAMPLE
    .\uninstall.ps1
.EXAMPLE
    .\uninstall.ps1 -Force
.EXAMPLE
    irm https://example.com/uninstall.ps1 | iex
#>
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$TaskName = 'CFProbe'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Info([string]$Message) { Write-Host "[+] $Message" -ForegroundColor Green }
function Write-WarningText([string]$Message) { Write-Host "[!] $Message" -ForegroundColor Yellow }

function Get-ProtectedInstallDir {
    $programData = if (-not [string]::IsNullOrWhiteSpace($env:ProgramData)) {
        $env:ProgramData
    } else {
        'C:\ProgramData'
    }
    return (Join-Path $programData 'CFProbe')
}

function Get-CallerScriptPath {
    if (-not [string]::IsNullOrWhiteSpace($PSCommandPath) -and (Test-Path -LiteralPath $PSCommandPath)) {
        return $PSCommandPath
    }
    if (-not [string]::IsNullOrWhiteSpace($MyInvocation.ScriptName) -and (Test-Path -LiteralPath $MyInvocation.ScriptName)) {
        return $MyInvocation.ScriptName
    }
    return $null
}

function Get-AgentScriptFromTask {
    param($ScheduledTask)

    if ($null -eq $ScheduledTask) { return $null }
    foreach ($action in @($ScheduledTask.Actions)) {
        $arguments = [string]$action.Arguments
        if ($arguments -match '(?i)-File\s+(?:"([^"]+)"|''([^'']+)''|(\S*cf-server-monitor\.ps1))') {
            foreach ($match in $Matches[1..3]) {
                if (-not [string]::IsNullOrWhiteSpace($match) -and
                    (Split-Path -Leaf $match) -ieq 'cf-server-monitor.ps1') {
                    return $match
                }
            }
        }
    }
    return $null
}

$callerScriptPath = Get-CallerScriptPath

if (-not (Test-Administrator)) {
    if ($callerScriptPath) {
        Write-WarningText 'Administrator rights are required; requesting elevation...'
        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$callerScriptPath`""
        if ($Force) { $arguments += ' -Force' }
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait
        exit 0
    } elseif ($MyInvocation.MyCommand.ScriptBlock) {
        Write-WarningText 'Administrator rights are required; requesting elevation for in-memory script...'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("& { $($MyInvocation.MyCommand.ScriptBlock.ToString()) } -Force:`$$([bool]$Force)"))
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -Wait
        exit 0
    } else {
        throw 'Administrator rights are required. Please open an elevated PowerShell session and re-run the uninstaller.'
    }
}

if (-not $Force) {
    $answer = Read-Host 'Remove the CFProbe scheduled task and stop probe processes? [y/N]'
    if ($answer -notmatch '(?i)^(y|yes)$') {
        Write-Info 'Cancelled.'
        exit 0
    }
}

$ProtectedDir = Get-ProtectedInstallDir
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$TaskAgentScript = if ($task) { Get-AgentScriptFromTask -ScheduledTask $task } else { $null }

$CandidateDirs = New-Object System.Collections.Generic.List[string]
if (-not [string]::IsNullOrWhiteSpace($ProtectedDir)) {
    [void]$CandidateDirs.Add($ProtectedDir)
}
if (-not [string]::IsNullOrWhiteSpace($TaskAgentScript)) {
    $taskDir = Split-Path -Parent $TaskAgentScript
    if (-not [string]::IsNullOrWhiteSpace($taskDir)) {
        [void]$CandidateDirs.Add($taskDir)
    }
}
if (-not [string]::IsNullOrWhiteSpace($callerScriptPath)) {
    $callerDir = Split-Path -Parent $callerScriptPath
    if (-not [string]::IsNullOrWhiteSpace($callerDir)) {
        [void]$CandidateDirs.Add($callerDir)
    }
}

$UniqueCandidateDirs = @($CandidateDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)

if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Info "Removed scheduled task: $TaskName"
} else {
    Write-Info "Scheduled task not found: $TaskName"
}

# Stop probe and pending auto-update runner/installer processes before removing files.
$stopped = 0
try {
    $processes = Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object {
            $_.ProcessId -ne $PID -and
            $_.Name -in @('powershell.exe', 'pwsh.exe') -and
            (
                ($_.CommandLine -match '(?i)cf-server-monitor\.ps1' -and
                 $_.CommandLine -match '(?i)(\srun\b|\stray\b|\sinstall\b)') -or
                $_.CommandLine -match '(?i)cf-probe-auto-update(-runner)?-[a-f0-9]+\.ps1'
            )
        }
    foreach ($process in @($processes)) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped++
    }
} catch {
    Write-WarningText "Unable to enumerate probe processes: $($_.Exception.Message)"
}
Write-Info "Stopped probe processes: $stopped"

$ProbeFileNames = @(
    'cf-server-monitor.ps1',
    'cf_probe_config.json',
    'cf_probe_config.json.tmp',
    'cf_probe_config.json.bak',
    'cf_probe_traffic.dat',
    'cf_probe_traffic.dat.tmp',
    'cf_probe.log',
    'auto_update.lock',
    'cf_probe_ping_results.json'
)

foreach ($dir in $UniqueCandidateDirs) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($fileName in $ProbeFileNames) {
        $filePath = Join-Path $dir $fileName
        if (Test-Path -LiteralPath $filePath) {
            Remove-Item -LiteralPath $filePath -Force -ErrorAction SilentlyContinue
            Write-Info "Removed: $filePath"
        }
    }
    $protectedTmp = Join-Path $dir 'tmp'
    if (Test-Path -LiteralPath $protectedTmp) {
        Remove-Item -LiteralPath $protectedTmp -Recurse -Force -ErrorAction SilentlyContinue
        Write-Info "Removed: $protectedTmp"
    }
}

if (-not [string]::IsNullOrWhiteSpace($TaskAgentScript) -and (Test-Path -LiteralPath $TaskAgentScript)) {
    Remove-Item -LiteralPath $TaskAgentScript -Force -ErrorAction SilentlyContinue
    Write-Info "Removed: $TaskAgentScript"
}

if (-not [string]::IsNullOrWhiteSpace($ProtectedDir) -and (Test-Path -LiteralPath $ProtectedDir)) {
    Remove-Item -LiteralPath $ProtectedDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Info "Removed directory: $ProtectedDir"
}

# Clean up any legacy temp files and interrupted auto-update scripts.
$TempCleanupDirs = @([System.IO.Path]::GetTempPath(), $env:TEMP, $env:TMP) + $UniqueCandidateDirs |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique

foreach ($directory in $TempCleanupDirs) {
    if (Test-Path -LiteralPath $directory) {
        $legacyPingFile = Join-Path $directory 'cf_probe_ping_results.json'
        if (Test-Path -LiteralPath $legacyPingFile) {
            Remove-Item -LiteralPath $legacyPingFile -Force -ErrorAction SilentlyContinue
            Write-Info "Removed: $legacyPingFile"
        }
        Get-ChildItem -LiteralPath $directory -Filter 'cf-probe-auto-update-*.ps1' -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $directory -Filter 'cf-probe-auto-update-runner-*.ps1' -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'CF-Server-Monitor Windows probe has been completely removed.' -ForegroundColor Green
