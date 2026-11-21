#Requires -Version 5.1
<#
.SYNOPSIS
    CF-Server-Monitor Windows 探针 (PowerShell 安全加固版)
.DESCRIPTION
    无 Python 依赖，纯 PowerShell 实现，功能对齐 Linux install.sh
.PARAMETER Action
    install   - 安装并启动探针服务
    uninstall - 卸载探针服务
    run       - 运行探针（桌面环境使用托盘，无头/Session 0 自动降级后台循环）
    tray      - 托盘模式运行
    status    - 查看运行状态
    stop      - 停止探针
#>
param(
    [Parameter(Position=0)]
    [ValidateSet("install","uninstall","run","tray","status","stop")]
    [string]$Action = "run",

    [string]$Id = "",
    [string]$Secret = "",
    [string]$Url = "",
    [string]$CollectInterval = "",
    [string]$ReportInterval = "",
    [string]$ResetDay = "",
    [string]$AutoUpdate = "",
    [string]$RxCorrection = "",
    [string]$TxCorrection = "",
    [string]$CtNode = "",
    [string]$CuNode = "",
    [string]$CmNode = "",
    [string]$BdNode = "",
    [string]$Interface = "",

    [switch]$STA
)

$INVARIANT_CULTURE = [System.Globalization.CultureInfo]::InvariantCulture

function Get-ProtectedInstallDir {
    $programData = if (-not [string]::IsNullOrWhiteSpace($env:ProgramData)) {
        $env:ProgramData
    } else {
        "C:\ProgramData"
    }
    return (Join-Path $programData "CFProbe")
}

function Resolve-CurrentScriptPath {
    if (-not [string]::IsNullOrWhiteSpace($MyInvocation.ScriptName) -and (Test-Path -LiteralPath $MyInvocation.ScriptName)) {
        return $MyInvocation.ScriptName
    }
    if (-not [string]::IsNullOrWhiteSpace($PSCommandPath) -and (Test-Path -LiteralPath $PSCommandPath)) {
        return $PSCommandPath
    }
    if ($script:INITIAL_SCRIPT_PATH -and (Test-Path -LiteralPath $script:INITIAL_SCRIPT_PATH)) {
        return $script:INITIAL_SCRIPT_PATH
    }
    $protectedScript = Join-Path (Get-ProtectedInstallDir) "cf-server-monitor.ps1"
    if (Test-Path -LiteralPath $protectedScript) {
        return $protectedScript
    }
    $localCandidate = Join-Path (Get-Location).Path "cf-server-monitor.ps1"
    if (Test-Path -LiteralPath $localCandidate) {
        return $localCandidate
    }
    return $null
}

$script:INITIAL_SCRIPT_PATH = if ($MyInvocation.MyCommand.Path) {
    $MyInvocation.MyCommand.Path
} elseif ($PSCommandPath) {
    $PSCommandPath
} else {
    $null
}
$script:INITIAL_SCRIPT_CONTENT = if (-not $script:INITIAL_SCRIPT_PATH -and $MyInvocation.MyCommand.ScriptBlock) {
    $MyInvocation.MyCommand.ScriptBlock.ToString()
} else {
    $null
}

# 仅在桌面交互式托盘运行且脚本落盘存在时尝试切换 STA，避免 Server Core/内存执行失败
if ($Action -eq "tray" -and -not $STA -and $host.Runspace.ApartmentState -ne 'STA') {
    $staScriptPath = Resolve-CurrentScriptPath
    if ($staScriptPath -and [Environment]::UserInteractive) {
        $argList = "-NoProfile -ExecutionPolicy Bypass -STA -File `"$staScriptPath`" $Action -STA"
        if ($Id) { $argList += " -Id `"$Id`"" }
        if ($Url) { $argList += " -Url `"$Url`"" }
        if ($CollectInterval -ne "") { $argList += " -CollectInterval `"$CollectInterval`"" }
        if ($ReportInterval -ne "") { $argList += " -ReportInterval `"$ReportInterval`"" }
        if ($ResetDay -ne "") { $argList += " -ResetDay `"$ResetDay`"" }
        if ($AutoUpdate -ne "") { $argList += " -AutoUpdate `"$AutoUpdate`"" }
        if ($RxCorrection -ne "") { $argList += " -RxCorrection `"$RxCorrection`"" }
        if ($TxCorrection -ne "") { $argList += " -TxCorrection `"$TxCorrection`"" }
        if ($CtNode) { $argList += " -CtNode `"$CtNode`"" }
        if ($CuNode) { $argList += " -CuNode `"$CuNode`"" }
        if ($CmNode) { $argList += " -CmNode `"$CmNode`"" }
        if ($BdNode) { $argList += " -BdNode `"$BdNode`"" }
        if ($Interface) { $argList += " -Interface `"$Interface`"" }
        # secret 不进命令行：改由环境变量传递
        if ($Secret) { $env:CF_PROBE_SECRET = $Secret }
        Start-Process powershell.exe -ArgumentList $argList
        Remove-Item Env:\CF_PROBE_SECRET -ErrorAction SilentlyContinue
        exit 0
    }
}

# STA 重启/提权链路通过环境变量接收 secret（不进命令行），读取后立即清除
if (-not $Secret -and $env:CF_PROBE_SECRET) {
    $Secret = $env:CF_PROBE_SECRET
}
Remove-Item Env:\CF_PROBE_SECRET -ErrorAction SilentlyContinue

$DebugPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"

$APP_NAME = "CF-Server-Monitor"
$AGENT_VERSION = "1.3.8"
$TASK_NAME = "CFProbe"

$PROTECTED_INSTALL_DIR = Get-ProtectedInstallDir
$RESOLVED_SCRIPT_PATH = Resolve-CurrentScriptPath
if ($RESOLVED_SCRIPT_PATH) {
    $SCRIPT_PATH = $RESOLVED_SCRIPT_PATH
    $SCRIPT_DIR = Split-Path -Parent $SCRIPT_PATH
} else {
    $SCRIPT_DIR = $PROTECTED_INSTALL_DIR
    $SCRIPT_PATH = Join-Path $PROTECTED_INSTALL_DIR "cf-server-monitor.ps1"
}

# 优先使用受保护目录配置；兼容旧目录配置读取
if (Test-Path -LiteralPath (Join-Path $PROTECTED_INSTALL_DIR "cf_probe_config.json")) {
    $CONFIG_DIR = $PROTECTED_INSTALL_DIR
} elseif ($SCRIPT_DIR -and (Test-Path -LiteralPath (Join-Path $SCRIPT_DIR "cf_probe_config.json"))) {
    $CONFIG_DIR = $SCRIPT_DIR
} else {
    $CONFIG_DIR = $PROTECTED_INSTALL_DIR
}
$CONFIG_FILE = Join-Path $CONFIG_DIR "cf_probe_config.json"
$LOG_FILE = Join-Path $CONFIG_DIR "cf_probe.log"
$TRAFFIC_FILE = Join-Path $CONFIG_DIR "cf_probe_traffic.dat"

$MAX_TRAFFIC_CORRECTION_GB = 1000000
$MAX_LOG_SIZE = 1MB

# ============================================================
# 工具与权限加固函数
# ============================================================

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-ProtectedDirectoryAcl {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "拒绝操作重解析点或符号链接目录: $Path"
    }
    if (Test-Admin) {
        & icacls $Path /setowner "*S-1-5-32-544" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "icacls /setowner 执行失败 (ExitCode=$LASTEXITCODE): $Path"
        }
        & icacls $Path /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "icacls 目录权限加固失败 (ExitCode=$LASTEXITCODE): $Path"
        }
    }
}

function Set-ProtectedFileAcl {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "拒绝操作重解析点或符号链接文件: $Path"
    }
    if (Test-Admin) {
        & icacls $Path /setowner "*S-1-5-32-544" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "icacls /setowner 执行失败 (ExitCode=$LASTEXITCODE): $Path"
        }
        & icacls $Path /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "icacls 文件权限加固失败 (ExitCode=$LASTEXITCODE): $Path"
        }
    }
}

function Mask-SecretValue {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return "" }
    return "********"
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Message"
    try {
        $logParent = Split-Path -Parent $LOG_FILE
        if ($logParent -and -not (Test-Path -LiteralPath $logParent)) {
            New-Item -ItemType Directory -Path $logParent -Force | Out-Null
        }
        if (Test-Path -LiteralPath $LOG_FILE) {
            $size = (Get-Item -LiteralPath $LOG_FILE).Length
            if ($size -gt $MAX_LOG_SIZE) {
                $lines = [System.IO.File]::ReadAllLines($LOG_FILE, [System.Text.Encoding]::UTF8)
                if ($lines.Length -gt 0) {
                    $targetSize = 102400
                    $totalBytes = 0
                    $keepCount = 0
                    for ($i = $lines.Length - 1; $i -ge 0; $i--) {
                        $lineBytes = [System.Text.Encoding]::UTF8.GetByteCount($lines[$i] + "`r`n")
                        if ($totalBytes + $lineBytes -gt $targetSize) { break }
                        $totalBytes += $lineBytes
                        $keepCount++
                    }
                    if ($keepCount -eq 0) { $keepCount = 1 }
                    if ($keepCount -gt 0 -and $keepCount -lt $lines.Length) {
                        $startIdx = $lines.Length - $keepCount
                        $keepLines = New-Object string[] $keepCount
                        [Array]::Copy($lines, $startIdx, $keepLines, 0, $keepCount)
                        [System.IO.File]::WriteAllLines($LOG_FILE, $keepLines, [System.Text.Encoding]::UTF8)
                    }
                }
            }
        }
        [System.IO.File]::AppendAllText($LOG_FILE, $line + "`r`n", [System.Text.Encoding]::UTF8)
    } catch {
        # 日志写入失败，忽略
    }
    Write-Host $line
}

function Load-ConfigFromPath {
    param([string]$FilePath)
    if ([string]::IsNullOrWhiteSpace($FilePath) -or -not (Test-Path -LiteralPath $FilePath)) {
        return $null
    }
    try {
        $content = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
        $raw = $content | ConvertFrom-Json
        if ($raw.worker_url) {
            $raw.worker_url = $raw.worker_url.Trim().Trim("'").Trim('"')
        }
        if ($raw.secret) {
            $raw.secret = $raw.secret.Trim().Trim("'").Trim('"')
        }
        if ($raw.server_id) {
            $raw.server_id = $raw.server_id.Trim().Trim("'").Trim('"')
        }
        return $raw
    } catch {
        Write-Log "配置文件加载失败 ($FilePath): $_" "ERROR"
        return $null
    }
}

function Load-Config {
    Write-Log "尝试加载配置文件: $CONFIG_FILE" "DEBUG"
    $loaded = Load-ConfigFromPath -FilePath $CONFIG_FILE
    if ($null -ne $loaded) {
        Write-Log "配置文件加载成功" "INFO"
        return $loaded
    }
    Write-Log "配置文件不存在或无法读取: $CONFIG_FILE" "WARN"
    return $null
}

function Save-Config {
    param($Config)
    $tempFile = "$CONFIG_FILE.tmp"
    $backupFile = "$CONFIG_FILE.bak"
    try {
        if (-not (Test-Path -LiteralPath $CONFIG_DIR)) {
            Set-ProtectedDirectoryAcl -Path $CONFIG_DIR
        }
        $json = $Config | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($tempFile, $json, (New-Object System.Text.UTF8Encoding($false)))
        Set-ProtectedFileAcl -Path $tempFile
        if (Test-Path -LiteralPath $CONFIG_FILE) {
            Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
            [System.IO.File]::Replace($tempFile, $CONFIG_FILE, $backupFile)
            Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
        } else {
            Move-Item -LiteralPath $tempFile -Destination $CONFIG_FILE -Force
        }
        try {
            Set-ProtectedFileAcl -Path $CONFIG_FILE
        } catch {
            Write-Log "配置文件 ACL 收紧失败: $_" "WARN"
        }
        Write-Log "配置文件已保存: $CONFIG_FILE" "DEBUG"
        return $true
    } catch {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $CONFIG_FILE) -and (Test-Path -LiteralPath $backupFile)) {
            Move-Item -LiteralPath $backupFile -Destination $CONFIG_FILE -Force -ErrorAction SilentlyContinue
        } else {
            Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
        }
        Write-Log "保存配置文件失败: $_" "ERROR"
        return $false
    }
}

function Get-ConfigProperty {
    param($Config, [string]$Name, $Default = $null)
    if ($null -eq $Config) { return $Default }
    if ($Config -is [hashtable]) {
        if ($Config.ContainsKey($Name)) { return $Config[$Name] }
        return $Default
    }
    $prop = $Config.PSObject.Properties[$Name]
    if ($null -ne $prop) { return $prop.Value }
    return $Default
}

function Resolve-IntOptionValue {
    param(
        [string]$ExplicitValue,
        $ExistingConfig,
        [string]$PropertyName,
        [int]$DefaultValue
    )
    if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) {
        $parsedExplicit = 0
        if ([int]::TryParse($ExplicitValue.Trim(), [System.Globalization.NumberStyles]::Integer, $INVARIANT_CULTURE, [ref]$parsedExplicit)) {
            return $parsedExplicit
        }
    }
    if ($null -ne $ExistingConfig) {
        $existingRaw = Get-ConfigProperty -Config $ExistingConfig -Name $PropertyName -Default $null
        if ($null -ne $existingRaw -and -not [string]::IsNullOrWhiteSpace([string]$existingRaw)) {
            $parsedExisting = 0
            if ([int]::TryParse(([string]$existingRaw).Trim(), [System.Globalization.NumberStyles]::Integer, $INVARIANT_CULTURE, [ref]$parsedExisting)) {
                return $parsedExisting
            }
        }
    }
    return $DefaultValue
}

function Get-ProbeInitialValue {
    param([string]$Node)
    if ([string]::IsNullOrWhiteSpace($Node)) { return $false }
    return ""
}

function ConvertTo-BinaryFlag {
    param(
        [object]$Value,
        [string]$Default = "0",
        [switch]$Strict
    )

    if ($Default -ne "1") { $Default = "0" }
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return $Default
    }

    $text = ([string]$Value).Trim()
    if ($text -eq "0" -or $text -eq "1") {
        return $text
    }
    if ($Strict) {
        throw "AutoUpdate 参数非法，仅支持 0 或 1"
    }
    return $Default
}

function Normalize-NetworkInterfaceList {
    param(
        [string]$Value,
        [switch]$Strict
    )

    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    $raw = $Value.Trim()
    $invalid = $false
    if ($raw.Length -gt 255 -or $raw -match '[/@?#\\\[\]]') {
        $invalid = $true
    }

    $seen = @{}
    $items = New-Object System.Collections.Generic.List[string]
    if (-not $invalid) {
        foreach ($part in ($raw -split ',')) {
            $name = $part.Trim()
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            if ($name.Length -gt 64 -or $name -notmatch '^[A-Za-z0-9_.:-]+$') {
                $invalid = $true
                break
            }
            $key = $name.ToLowerInvariant()
            if (-not $seen.ContainsKey($key)) {
                $seen[$key] = $true
                [void]$items.Add($name)
            }
        }
    }

    if ($invalid) {
        if ($Strict) { throw "Interface 参数非法，请使用英文逗号分隔的网卡名" }
        return ""
    }

    $normalized = [string]::Join(',', [string[]]$items)
    if ($normalized.Length -gt 255) {
        if ($Strict) { throw "Interface 参数非法，请使用英文逗号分隔的网卡名" }
        return ""
    }
    return $normalized
}

function ConvertTo-PowerShellLiteral {
    param([string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-AgentInstallUrl {
    param([string]$WorkerUrl)

    try {
        $uri = [Uri]$WorkerUrl
        if ([string]::IsNullOrWhiteSpace($uri.Authority)) {
            return $null
        }
        $allowHttp = ($env:ALLOW_INSECURE_HTTP_UPDATE -eq "1")
        if ($uri.Scheme -eq "https") {
            return "https://$($uri.Authority)/cf-server-monitor.ps1"
        }
        if ($uri.Scheme -eq "http" -and $allowHttp) {
            return "http://$($uri.Authority)/cf-server-monitor.ps1"
        }
        return $null
    } catch {
        return $null
    }
}

function Get-AgentUpdateTempDir {
    # 严禁使用用户可写的 $env:TEMP / $env:TMP，仅管理员/SYSTEM 可使用受 ACL 保护的更新目录
    if (-not (Test-Admin)) {
        return $null
    }
    $installDir = Get-ProtectedInstallDir
    $protectedTmp = Join-Path $installDir "tmp"
    try {
        Set-ProtectedDirectoryAcl -Path $installDir
        Set-ProtectedDirectoryAcl -Path $protectedTmp
        if (-not (Test-Path -LiteralPath $protectedTmp -PathType Container)) {
            return $null
        }
        $probeFile = Join-Path $protectedTmp "cf-probe-write-test-$PID.tmp"
        [System.IO.File]::WriteAllText($probeFile, "1", [System.Text.Encoding]::ASCII)
        Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
        return $protectedTmp
    } catch {
        return $null
    }
}

function Schedule-AgentUpdate {
    param(
        [string]$WorkerUrl,
        [string]$AutoUpdate
    )

    if ((ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0") -ne "1") {
        Write-Log "Auto update ignored: local auto_update=$AutoUpdate" "DEBUG"
        return
    }

    $installDir = Get-ProtectedInstallDir
    $lockFile = Join-Path $installDir "auto_update.lock"
    $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    if (Test-Path -LiteralPath $lockFile) {
        try {
            $last = [long]((Get-Content -LiteralPath $lockFile -Raw -ErrorAction Stop).Trim())
        } catch {
            $last = 0
        }
        if (($now - $last) -lt 1800) {
            Write-Log "Auto update already scheduled recently: age=$($now - $last)s lock=$lockFile" "DEBUG"
            return
        }
    }

    $installUrl = Get-AgentInstallUrl -WorkerUrl $WorkerUrl
    if (-not $installUrl) {
        Write-Log "Auto update skipped: invalid or non-HTTPS worker_url=$WorkerUrl" "WARN"
        return
    }

    $updateTmpDir = Get-AgentUpdateTempDir
    if (-not $updateTmpDir) {
        Write-Log "Auto update skipped: protected temp dir unavailable ($installDir\tmp)" "WARN"
        return
    }

    $id = [Guid]::NewGuid().ToString("N")
    $downloadScript = Join-Path $updateTmpDir "cf-probe-auto-update-$id.ps1"
    $runnerScript = Join-Path $updateTmpDir "cf-probe-auto-update-runner-$id.ps1"
    $targetScript = Join-Path $installDir "cf-server-monitor.ps1"
    $installUrlLiteral = ConvertTo-PowerShellLiteral $installUrl
    $downloadScriptLiteral = ConvertTo-PowerShellLiteral $downloadScript
    $targetScriptLiteral = ConvertTo-PowerShellLiteral $targetScript

    $runnerContent = @"
`$ErrorActionPreference = 'Stop'
Start-Sleep -Seconds 60
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $installUrlLiteral -OutFile $downloadScriptLiteral -TimeoutSec 30
    if ((Test-Path -LiteralPath $downloadScriptLiteral) -and ((Get-Item -LiteralPath $downloadScriptLiteral).Length -gt 64)) {
        Copy-Item -LiteralPath $downloadScriptLiteral -Destination $targetScriptLiteral -Force
        Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$targetScriptLiteral,'install') -WindowStyle Hidden -Wait
    }
} catch {
} finally {
    Remove-Item -LiteralPath $downloadScriptLiteral -Force -ErrorAction SilentlyContinue
    if (`$PSCommandPath) {
        Remove-Item -LiteralPath `$PSCommandPath -Force -ErrorAction SilentlyContinue
    }
}
"@

    try {
        [System.IO.File]::WriteAllText($runnerScript, $runnerContent, (New-Object System.Text.UTF8Encoding($false)))
        Set-ProtectedFileAcl -Path $runnerScript
        Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $runnerScript) -WindowStyle Hidden
        [System.IO.File]::WriteAllText($lockFile, [string]$now, [System.Text.Encoding]::ASCII)
        Set-ProtectedFileAcl -Path $lockFile
        Write-Log "Auto update scheduled: url=$installUrl temp=$updateTmpDir" "INFO"
    } catch {
        Write-Log "Auto update schedule failed: $($_.Exception.Message)" "WARN"
    }
}

function ConvertFrom-AgentConfigResponse {
    param([string]$Body, [string]$ConfigMd5)

    $bodyText = if ($null -eq $Body) { "" } else { $Body.Trim() }
    if ([string]::IsNullOrEmpty($bodyText) -or [Text.Encoding]::UTF8.GetByteCount($bodyText) -gt 1024) {
        throw "动态配置响应长度无效"
    }
    if ($bodyText -notmatch '^[A-Za-z0-9_=&.,:\-]+$') { throw "动态配置包含非法字符" }

    $allowedKeys = @(
        'collect_interval', 'report_interval', 'reset_day', 'schema_version',
        'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd',
        'interface', 'rx_correction', 'tx_correction', 'update'
    )
    $values = @{}
    foreach ($part in $bodyText.Split('&')) {
        if ([string]::IsNullOrEmpty($part)) { continue }
        $eqIndex = $part.IndexOf('=')
        if ($eqIndex -lt 0) { throw "动态配置字段格式无效" }
        $key = $part.Substring(0, $eqIndex)
        $value = $part.Substring($eqIndex + 1)
        if ($allowedKeys -notcontains $key) { throw "动态配置包含未知字段: $key" }
        if ($values.ContainsKey($key)) { throw "动态配置包含重复字段: $key" }
        $values[$key] = $value
    }

    $updateValue = if ($values.ContainsKey('update')) { $values['update'] } else { "" }
    if ($updateValue -ne "" -and $updateValue -ne "0" -and $updateValue -ne "1") {
        throw "动态配置 update 无效"
    }

    $requiredKeys = @('collect_interval', 'report_interval', 'reset_day', 'schema_version', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'interface')
    $hasConfig = $false
    foreach ($key in $requiredKeys) {
        if ($values.ContainsKey($key)) {
            $hasConfig = $true
            break
        }
    }

    if (-not $hasConfig) {
        if ($updateValue -eq "1") {
            return @{
                has_config = $false
                update = "1"
            }
        }
        throw "动态配置缺少配置字段"
    }

    foreach ($key in $requiredKeys) {
        if (-not $values.ContainsKey($key)) { throw "动态配置缺少必要字段: $key" }
    }

    $ConfigMd5 = if ($null -eq $ConfigMd5) { "" } else { $ConfigMd5.Trim().ToLowerInvariant() }
    if ($ConfigMd5 -notmatch '^[a-f0-9]{32}$') { throw "动态配置 MD5 无效" }

    foreach ($key in @('collect_interval', 'report_interval', 'reset_day', 'schema_version')) {
        if ($values[$key] -notmatch '^(0|[1-9][0-9]*)$') { throw "动态配置数值无效" }
    }
    $collect = [int]::Parse($values['collect_interval'], $INVARIANT_CULTURE)
    $report = [int]::Parse($values['report_interval'], $INVARIANT_CULTURE)
    $reset = [int]::Parse($values['reset_day'], $INVARIANT_CULTURE)
    $schema = [int]::Parse($values['schema_version'], $INVARIANT_CULTURE)
    if (@(0, 1, 2, 5, 10) -notcontains $collect) { throw "collect_interval 无效" }
    if (@(30, 60, 120, 180) -notcontains $report -or $report -lt $collect) { throw "report_interval 无效" }
    if ($reset -lt 0 -or $reset -gt 31 -or $schema -ne 3) { throw "reset_day 或 schema_version 无效" }
    $networkInterface = Normalize-NetworkInterfaceList -Value $values['interface'] -Strict

    $result = @{
        has_config = $true
        collect_interval = $collect
        report_interval = $report
        reset_day = $reset
        config_md5 = $ConfigMd5
        ct_node = $values['custom_ct']
        cu_node = $values['custom_cu']
        cm_node = $values['custom_cm']
        bd_node = $values['custom_bd']
        interface = $networkInterface
    }

    if ($values.ContainsKey('rx_correction') -and $values['rx_correction'] -ne '') {
        $result.rx_correction = $values['rx_correction']
    }
    if ($values.ContainsKey('tx_correction') -and $values['tx_correction'] -ne '') {
        $result.tx_correction = $values['tx_correction']
    }
    if ($updateValue -ne '') {
        $result.update = $updateValue
    }

    return $result
}

function Invoke-AsAdmin {
    $scriptPath = Resolve-CurrentScriptPath
    if (-not $scriptPath) {
        Write-Host "错误: 当前通过内存无文件方式运行且非管理员会话。请以管理员身份打开 PowerShell 后重试。" -ForegroundColor Red
        return
    }
    $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $Action"
    if ($Id) { $argList += " -Id `"$Id`"" }
    if ($Url) { $argList += " -Url `"$Url`"" }
    if ($CollectInterval -ne "") { $argList += " -CollectInterval `"$CollectInterval`"" }
    if ($ReportInterval -ne "") { $argList += " -ReportInterval `"$ReportInterval`"" }
    if ($ResetDay -ne "") { $argList += " -ResetDay `"$ResetDay`"" }
    if ($AutoUpdate -ne "") { $argList += " -AutoUpdate `"$AutoUpdate`"" }
    if ($RxCorrection -ne "") { $argList += " -RxCorrection `"$RxCorrection`"" }
    if ($TxCorrection -ne "") { $argList += " -TxCorrection `"$TxCorrection`"" }
    if ($CtNode) { $argList += " -CtNode `"$CtNode`"" }
    if ($CuNode) { $argList += " -CuNode `"$CuNode`"" }
    if ($CmNode) { $argList += " -CmNode `"$CmNode`"" }
    if ($BdNode) { $argList += " -BdNode `"$BdNode`"" }
    if ($Interface) { $argList += " -Interface `"$Interface`"" }
    # secret 走环境变量传递，避免出现在提权进程的命令行中
    if ($Secret) { $env:CF_PROBE_SECRET = $Secret }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList -Wait
    Remove-Item Env:\CF_PROBE_SECRET -ErrorAction SilentlyContinue
}

# ============================================================
# 指标采集
# ============================================================

function Get-CpuUsage {
    try {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        if ($null -ne $cpu -and $null -ne $cpu.LoadPercentage) {
            return [math]::Round([double]$cpu.LoadPercentage, 2)
        }
    } catch {}
    try {
        $counter = New-Object System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total")
        $null = $counter.NextValue()
        Start-Sleep -Milliseconds 200
        return [math]::Round([double]$counter.NextValue(), 2)
    } catch {
        return 0.0
    }
}

function Get-CpuInfo {
    try {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        return ([string]$cpu.Name).Trim()
    } catch {
        return "Unknown CPU"
    }
}

function Get-CpuCores {
    try {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        if ($cpu.NumberOfLogicalProcessors) {
            return [int]$cpu.NumberOfLogicalProcessors
        }
        return [Environment]::ProcessorCount
    } catch {
        return [Environment]::ProcessorCount
    }
}

function Get-MemoryInfo {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $totalMB = [long][math]::Round($os.TotalVisibleMemorySize / 1024)
        $freeMB = [long][math]::Round($os.FreePhysicalMemory / 1024)
        $usedMB = [math]::Max($totalMB - $freeMB, 0)
        return @{ total = $totalMB; used = $usedMB }
    } catch {
        return @{ total = 0; used = 0 }
    }
}

function Get-SwapInfo {
    try {
        $pageFiles = Get-CimInstance Win32_PageFile -ErrorAction SilentlyContinue
        if ($pageFiles) {
            $totalMB = [long]0
            foreach ($pf in $pageFiles) {
                if ($pf.MaxSize) {
                    $totalMB += [long][math]::Round($pf.MaxSize / 1024)
                } elseif ($pf.Size) {
                    $totalMB += [long][math]::Round($pf.Size / 1024)
                }
            }
            $usage = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue
            $usedMB = [long]0
            if ($usage) {
                foreach ($u in $usage) {
                    $usedMB += [long][math]::Round($u.CurrentUsage / 1024)
                }
            }
            if ($totalMB -gt 0) {
                return @{ total = $totalMB; used = [math]::Min($usedMB, $totalMB) }
            }
        }
        return @{ total = 0; used = 0 }
    } catch {
        return @{ total = 0; used = 0 }
    }
}

function Get-DiskInfo {
    try {
        $disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue)
        if (-not $disks -or $disks.Count -eq 0) {
            $disks = @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object {
                $_.Root -match '^[A-Za-z]:\\$' -and $null -ne $_.Used -and $null -ne $_.Free
            } | ForEach-Object {
                [PSCustomObject]@{
                    Size = ([int64]$_.Used + [int64]$_.Free)
                    FreeSpace = [int64]$_.Free
                }
            })
        }

        $totalBytes = [int64]0
        $freeBytes = [int64]0
        foreach ($disk in $disks) {
            if ($null -eq $disk.Size -or $null -eq $disk.FreeSpace) { continue }
            $size = [int64]$disk.Size
            $free = [int64]$disk.FreeSpace
            if ($size -le 0 -or $free -lt 0) { continue }
            $totalBytes += $size
            $freeBytes += $free
        }

        if ($totalBytes -le 0) { return @{ total = 0; used = 0 } }
        $totalMB = [long][math]::Round($totalBytes / 1024 / 1024)
        $freeMB = [long][math]::Round($freeBytes / 1024 / 1024)
        $usedMB = [math]::Max($totalMB - $freeMB, 0)
        return @{ total = $totalMB; used = $usedMB }
    } catch {
        return @{ total = 0; used = 0 }
    }
}

function Test-VirtualOrExcludedAdapter {
    param(
        [string]$Name,
        [string]$Description = "",
        $AdapterMeta = $null
    )

    $n = if ($Name) { $Name.Trim() } else { "" }
    $d = if ($Description) { $Description.Trim() } else { "" }

    # 过滤 Hyper-V / WSL vEthernet、Docker、Loopback 与常见隧道/虚拟网卡
    if ($n -match '(?i)^(vEthernet|Loopback|Pseudo-Interface|isatap|teredo|6to4|docker|br-|veth|virbr|vmnet|vboxnet|tailscale|ZeroTier|WireGuard|utun|tun|tap|wg)') {
        return $true
    }
    if ($d -match '(?i)(Hyper-V Virtual|WSL|Docker|Software Loopback|Loopback|Tunnel|Teredo|ISATAP|6to4|TAP-Windows|Wintun|WireGuard|Tailscale|ZeroTier|VMware Virtual|VirtualBox Host-Only|Npcap Loopback)') {
        return $true
    }
    if ($null -ne $AdapterMeta) {
        # IF_TYPE_SOFTWARE_LOOPBACK = 24, IF_TYPE_TUNNEL = 131
        if ($AdapterMeta.InterfaceType -in @(24, 131)) {
            return $true
        }
        if ($AdapterMeta.Virtual -eq $true) {
            return $true
        }
    }
    return $false
}

function Get-NetworkStats {
    param([string]$Interface = "")
    try {
        $normalizedInterface = Normalize-NetworkInterfaceList -Value $Interface
        $wanted = @{}
        if (-not [string]::IsNullOrWhiteSpace($normalizedInterface)) {
            foreach ($name in ($normalizedInterface -split ',')) {
                if (-not [string]::IsNullOrWhiteSpace($name)) {
                    $wanted[$name.ToLowerInvariant()] = $true
                }
            }
        }

        $adapterMetaMap = @{}
        if ($wanted.Count -eq 0) {
            try {
                $netAdapters = Get-NetAdapter -ErrorAction SilentlyContinue
                foreach ($na in @($netAdapters)) {
                    if ($null -ne $na -and -not [string]::IsNullOrWhiteSpace($na.Name)) {
                        $adapterMetaMap[$na.Name.Trim().ToLowerInvariant()] = $na
                    }
                }
            } catch {}
        }

        $adapters = Get-NetAdapterStatistics -ErrorAction SilentlyContinue
        if ($adapters) {
            $totalRx = [long]0
            $totalTx = [long]0
            foreach ($adapter in $adapters) {
                try {
                    $rawName = [string]$adapter.Name
                    $adapterKey = $rawName.Trim().ToLowerInvariant()
                    if ($wanted.Count -gt 0) {
                        if (-not $wanted.ContainsKey($adapterKey)) { continue }
                    } else {
                        $meta = if ($adapterMetaMap.ContainsKey($adapterKey)) { $adapterMetaMap[$adapterKey] } else { $null }
                        $desc = if ($null -ne $meta) { [string]$meta.InterfaceDescription } elseif ($adapter.PSObject.Properties['InterfaceDescription']) { [string]$adapter.InterfaceDescription } else { "" }
                        if (Test-VirtualOrExcludedAdapter -Name $rawName -Description $desc -AdapterMeta $meta) {
                            continue
                        }
                    }
                    $totalRx += [long]$adapter.ReceivedBytes
                    $totalTx += [long]$adapter.SentBytes
                } catch {}
            }
            return @{ rx = $totalRx; tx = $totalTx }
        }
    } catch {}
    Write-Log "网络流量获取失败" "DEBUG"
    return @{ rx = 0; tx = 0 }
}

function Get-TcpUdpConnections {
    $tcp = 0; $udp = 0
    try {
        $conns = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue
        $tcp = ($conns | Measure-Object).Count
    } catch {}
    try {
        $conns = Get-NetUDPEndpoint -ErrorAction SilentlyContinue
        $udp = ($conns | Measure-Object).Count
    } catch {}
    return @{ tcp = $tcp; udp = $udp }
}

function Get-ProcessCount {
    try {
        return (Get-Process | Measure-Object).Count
    } catch {
        return 0
    }
}

function Get-BootTime {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $boot = $os.LastBootUpTime
        return [long]([DateTimeOffset]::new($boot).ToUnixTimeMilliseconds())
    } catch {
        return 0
    }
}

function ConvertTo-GpuUsage {
    param(
        [object]$Value,
        [object]$DefaultValue = $null
    )
    if ($null -eq $Value) { return $DefaultValue }
    $text = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return $DefaultValue }
    $parsed = 0.0
    if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Float, $INVARIANT_CULTURE, [ref]$parsed)) {
        return $parsed
    }
    return $DefaultValue
}

function Invoke-NvidiaSmiWithTimeout {
    param([int]$TimeoutMs = 5000)
    $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $cmd -or -not $cmd.Source) { return $null }
    $proc = $null
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $cmd.Source
        $psi.Arguments = "--query-gpu=index,name,utilization.gpu --format=csv,noheader,nounits"
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        if (-not $proc.Start()) { return $null }
        $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
        $null = $proc.StandardError.ReadToEndAsync()
        if (-not $proc.WaitForExit($TimeoutMs)) {
            try { $proc.Kill() } catch {}
            Write-Log "nvidia-smi 执行超时 (${TimeoutMs}ms)，已中止以避免阻塞采集循环" "WARN"
            return $null
        }
        $output = $stdoutTask.GetAwaiter().GetResult()
        if ([string]::IsNullOrWhiteSpace($output)) { return $null }
        return ($output -split "\r?\n")
    } catch {
        return $null
    } finally {
        if ($null -ne $proc) {
            $proc.Dispose()
        }
    }
}

function Get-GpuInfo {
    $gpuList = @()
    try {
        $nvidia = Invoke-NvidiaSmiWithTimeout -TimeoutMs 5000
        if ($nvidia) {
            foreach ($line in @($nvidia)) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $parts = ([string]$line) -split ','
                if ($parts.Count -lt 3) { continue }
                $gpuId = $parts[0].Trim()
                $gpuUsage = ConvertTo-GpuUsage -Value $parts[$parts.Count - 1]
                if ($parts.Count -gt 3) {
                    $gpuName = ($parts[1..($parts.Count - 2)] -join ',').Trim()
                } else {
                    $gpuName = $parts[1].Trim()
                }
                if (-not [string]::IsNullOrWhiteSpace($gpuName)) {
                    $gpuList += [pscustomobject]@{
                        name = $gpuName
                        info = $gpuUsage
                        id = $gpuId
                    }
                }
            }
        }
    } catch {}

    if ($gpuList.Count -eq 0) {
        try {
            $idx = 0
            $controllers = Get-CimInstance Win32_VideoController
            foreach ($controller in @($controllers)) {
                $gpuName = [string]$controller.Name
                if ([string]::IsNullOrWhiteSpace($gpuName)) { continue }
                $gpuList += [pscustomobject]@{
                    name = $gpuName.Trim()
                    info = 0
                    id = $idx.ToString($INVARIANT_CULTURE)
                }
                $idx++
            }
        } catch {}
    }

    if ($gpuList.Count -gt 0) { return $gpuList }
    return $null
}

function Get-LoadAvg {
    param([double]$CpuPercent)
    $v1 = [math]::Min([math]::Max($CpuPercent / 100.0, 0.0), 999.0)
    $v2 = [math]::Max($v1 * 0.8, 0.0)
    $v3 = [math]::Max($v1 * 0.6, 0.0)
    return [string]::Format($INVARIANT_CULTURE, "{0:F2} {1:F2} {2:F2}", $v1, $v2, $v3)
}

# ============================================================
# 网络探测与目标安全校验
# ============================================================

function Test-ForbiddenProbeHost {
    param([string]$HostName, [bool]$AllowPrivate = $false)
    if ([string]::IsNullOrWhiteSpace($HostName)) { return $true }
    $h = $HostName.Trim().Trim('[', ']')
    if ([string]::IsNullOrWhiteSpace($h) -or $h.StartsWith('-')) { return $true }
    if ($h -notmatch '^[A-Za-z0-9._:-]+$') { return $true }
    if ($AllowPrivate) { return $false }

    if ($h -match '(?i)^(localhost|.*\.localhost|ip6-localhost|ip6-loopback)$') { return $true }
    if ($h -match '^(127\.|169\.254\.|0\.)' -or $h -eq '0.0.0.0') { return $true }
    if ($h -match '(?i)^(::1|::|0*:0*:0*:0*:0*:0*:0*:0*1|fe80:)') { return $true }

    $ipObj = $null
    if ([System.Net.IPAddress]::TryParse($h, [ref]$ipObj)) {
        if ([System.Net.IPAddress]::IsLoopback($ipObj)) { return $true }
        $bytes = $ipObj.GetAddressBytes()
        if ($ipObj.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $bytes.Length -eq 4) {
            if ($bytes[0] -eq 127 -or $bytes[0] -eq 0 -or ($bytes[0] -eq 169 -and $bytes[1] -eq 254)) {
                return $true
            }
        }
        if ($ipObj.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6 -and $ipObj.IsIPv6LinkLocal) {
            return $true
        }
    }
    return $false
}

function Resolve-ProbeTarget {
    param([string]$TargetHost, [int]$DefaultPort = 443)
    $target = if ($TargetHost) { $TargetHost.Trim() } else { "" }
    if (-not $target) { return @{ host = ""; port = $DefaultPort } }
    $allowPrivate = ($env:ALLOW_PRIVATE_PROBE -eq "1")
    $hostPart = $target
    $port = $DefaultPort
    if ($target.Contains(':')) {
        if ($target -notmatch '^([^:]+):([0-9]{1,5})$') { return $null }
        $hostPart = $Matches[1]
        $port = [int]::Parse($Matches[2], $INVARIANT_CULTURE)
        if ($port -lt 1 -or $port -gt 65535) { return $null }
    }
    if (Test-ForbiddenProbeHost -HostName $hostPart -AllowPrivate $allowPrivate) {
        return $null
    }
    return @{ host = $hostPart; port = $port }
}

function Get-TcpPing {
    param([string]$TargetHost, [int]$Port = 443)
    if (-not $TargetHost) { return "" }
    $tcp = $null
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $tcp = New-Object System.Net.Sockets.TcpClient
        $task = $tcp.ConnectAsync($TargetHost, $Port)
        if ($task.Wait(5000) -and $tcp.Connected) {
            $sw.Stop()
            $ms = [int]$sw.ElapsedMilliseconds
            if ($ms -gt 0) { return $ms.ToString($INVARIANT_CULTURE) } else { return "1" }
        } else {
            return ""
        }
    } catch {
        return ""
    } finally {
        if ($null -ne $tcp) {
            $tcp.Close()
            $tcp.Dispose()
        }
    }
}

function Get-Probe {
    param([string]$TargetHost, [int]$Count = 4)
    if ([string]::IsNullOrWhiteSpace($TargetHost)) { return @{ rtt = $false; loss = $false } }
    $target = Resolve-ProbeTarget -TargetHost $TargetHost -DefaultPort 443
    if (-not $target) { return @{ rtt = "null"; loss = "100" } }
    $TargetHost = $target.host
    $port = [int]$target.port
    if (-not $TargetHost) { return @{ rtt = "null"; loss = "100" } }
    $ok = 0; $totalRtt = 0
    for ($i = 0; $i -lt $Count; $i++) {
        $r = Get-TcpPing -TargetHost $TargetHost -Port $port
        if ($r -match '^\d+$') { $ok++; $totalRtt += [int]::Parse($r, $INVARIANT_CULTURE) }
    }
    $rtt = if ($ok -gt 0) { ([long][math]::Floor($totalRtt / $ok)).ToString($INVARIANT_CULTURE) } else { "null" }
    $loss = ([long][math]::Floor(($Count - $ok) / $Count * 100)).ToString($INVARIANT_CULTURE)
    return @{ rtt = $rtt; loss = $loss }
}

# ============================================================
# 异步 Ping 检测（后台执行，结果写入受保护目录文件）
# ============================================================

function Start-PingBackgroundJob {
    param(
        [string]$CtNode,
        [string]$CuNode,
        [string]$CmNode,
        [string]$BdNode,
        [string]$TempFile
    )

    $allowPrivate = ($env:ALLOW_PRIVATE_PROBE -eq "1")

    $jobScript = {
        param($ct, $cu, $cm, $bd, $tempFile, $allowPriv)
        $inv = [System.Globalization.CultureInfo]::InvariantCulture

        function Test-ForbiddenProbeHost {
            param([string]$HostName, [bool]$AllowPrivate = $false)
            if ([string]::IsNullOrWhiteSpace($HostName)) { return $true }
            $h = $HostName.Trim().Trim('[', ']')
            if ([string]::IsNullOrWhiteSpace($h) -or $h.StartsWith('-')) { return $true }
            if ($h -notmatch '^[A-Za-z0-9._:-]+$') { return $true }
            if ($AllowPrivate) { return $false }

            if ($h -match '(?i)^(localhost|.*\.localhost|ip6-localhost|ip6-loopback)$') { return $true }
            if ($h -match '^(127\.|169\.254\.|0\.)' -or $h -eq '0.0.0.0') { return $true }
            if ($h -match '(?i)^(::1|::|0*:0*:0*:0*:0*:0*:0*:0*1|fe80:)') { return $true }

            $ipObj = $null
            if ([System.Net.IPAddress]::TryParse($h, [ref]$ipObj)) {
                if ([System.Net.IPAddress]::IsLoopback($ipObj)) { return $true }
                $bytes = $ipObj.GetAddressBytes()
                if ($ipObj.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $bytes.Length -eq 4) {
                    if ($bytes[0] -eq 127 -or $bytes[0] -eq 0 -or ($bytes[0] -eq 169 -and $bytes[1] -eq 254)) {
                        return $true
                    }
                }
                if ($ipObj.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6 -and $ipObj.IsIPv6LinkLocal) {
                    return $true
                }
            }
            return $false
        }

        function Resolve-ProbeTarget {
            param([string]$TargetHost, [int]$DefaultPort = 443)
            $target = if ($TargetHost) { $TargetHost.Trim() } else { "" }
            if (-not $target) { return @{ host = ""; port = $DefaultPort } }
            $hostPart = $target
            $port = $DefaultPort
            if ($target.Contains(':')) {
                if ($target -notmatch '^([^:]+):([0-9]{1,5})$') { return $null }
                $hostPart = $Matches[1]
                $port = [int]::Parse($Matches[2], $inv)
                if ($port -lt 1 -or $port -gt 65535) { return $null }
            }
            if (Test-ForbiddenProbeHost -HostName $hostPart -AllowPrivate $allowPriv) {
                return $null
            }
            return @{ host = $hostPart; port = $port }
        }

        function Get-TcpPing {
            param([string]$TargetHost, [int]$Port = 443)
            if (-not $TargetHost) { return "" }
            $tcp = $null
            try {
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $tcp = New-Object System.Net.Sockets.TcpClient
                $task = $tcp.ConnectAsync($TargetHost, $Port)
                if ($task.Wait(5000) -and $tcp.Connected) {
                    $sw.Stop()
                    $ms = [int]$sw.ElapsedMilliseconds
                    if ($ms -gt 0) { return $ms.ToString($inv) } else { return "1" }
                } else {
                    return ""
                }
            } catch {
                return ""
            } finally {
                if ($null -ne $tcp) {
                    $tcp.Close()
                    $tcp.Dispose()
                }
            }
        }

        function Get-Probe {
            param([string]$TargetHost, [int]$Count = 4)
            if ([string]::IsNullOrWhiteSpace($TargetHost)) { return @{ rtt = $false; loss = $false } }
            $target = Resolve-ProbeTarget -TargetHost $TargetHost -DefaultPort 443
            if (-not $target) { return @{ rtt = "null"; loss = "100" } }
            $TargetHost = $target.host
            $port = [int]$target.port
            if (-not $TargetHost) { return @{ rtt = $false; loss = $false } }
            $ok = 0; $totalRtt = 0
            for ($i = 0; $i -lt $Count; $i++) {
                $r = Get-TcpPing -TargetHost $TargetHost -Port $port
                if ($r -match '^\d+$') { $ok++; $totalRtt += [int]::Parse($r, $inv) }
            }
            $rtt = if ($ok -gt 0) { ([long][math]::Floor($totalRtt / $ok)).ToString($inv) } else { "null" }
            $loss = ([long][math]::Floor(($Count - $ok) / $Count * 100)).ToString($inv)
            return @{ rtt = $rtt; loss = $loss }
        }

        $ctProbe = Get-Probe -TargetHost $ct
        $cuProbe = Get-Probe -TargetHost $cu
        $cmProbe = Get-Probe -TargetHost $cm
        $bdProbe = Get-Probe -TargetHost $bd

        $result = @{
            ct_ping = $ctProbe.rtt; ct_loss = $ctProbe.loss
            cu_ping = $cuProbe.rtt; cu_loss = $cuProbe.loss
            cm_ping = $cmProbe.rtt; cm_loss = $cmProbe.loss
            bd_ping = $bdProbe.rtt; bd_loss = $bdProbe.loss
            timestamp = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        }

        $json = $result | ConvertTo-Json -Compress
        $tmpWrite = "$tempFile.tmp.$PID"
        [System.IO.File]::WriteAllText($tmpWrite, $json, [System.Text.Encoding]::UTF8)
        Move-Item -LiteralPath $tmpWrite -Destination $tempFile -Force
    }

    Start-Job -ScriptBlock $jobScript -ArgumentList $CtNode, $CuNode, $CmNode, $BdNode, $TempFile, $allowPrivate -Name "CFProbePingJob" | Out-Null
}

function Read-PingResults {
    param([string]$TempFile)
    if ($TempFile -and (Test-Path -LiteralPath $TempFile)) {
        try {
            $json = [System.IO.File]::ReadAllText($TempFile, [System.Text.Encoding]::UTF8)
            $result = $json | ConvertFrom-Json
            return $result
        } catch {}
    }
    return $null
}

function Remove-PingBackgroundJob {
    $job = Get-Job -Name "CFProbePingJob" -ErrorAction SilentlyContinue
    if ($job) {
        Remove-Job -Name "CFProbePingJob" -Force -ErrorAction SilentlyContinue
    }
}

# ============================================================
# IP 检测（严格校验合法字符集，拦截认证门户 HTML）
# ============================================================

function Test-ValidPublicIPv4 {
    param([string]$Ip)
    if ([string]::IsNullOrWhiteSpace($Ip)) { return $false }
    $trimmed = $Ip.Trim()
    if ($trimmed.Length -gt 15 -or $trimmed -notmatch '^[0-9]{1,3}(\.[0-9]{1,3}){3}$') {
        return $false
    }
    $parsed = $null
    return ([System.Net.IPAddress]::TryParse($trimmed, [ref]$parsed) -and
            $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork)
}

function Test-ValidPublicIPv6 {
    param([string]$Ip)
    if ([string]::IsNullOrWhiteSpace($Ip)) { return $false }
    $trimmed = $Ip.Trim()
    if ($trimmed.Length -gt 45 -or -not $trimmed.Contains(':') -or $trimmed -notmatch '^[0-9a-fA-F:.]+$') {
        return $false
    }
    $parsed = $null
    return ([System.Net.IPAddress]::TryParse($trimmed, [ref]$parsed) -and
            $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6)
}

function Get-PublicIPv4 {
    foreach ($endpoint in @("https://ipv4.icanhazip.com", "https://api.ipify.org")) {
        try {
            $ip = ([string](Invoke-RestMethod -Uri $endpoint -TimeoutSec 3 -ErrorAction Stop)).Trim()
            if (Test-ValidPublicIPv4 -Ip $ip) { return $ip }
        } catch {}
    }
    return "0"
}

function Get-PublicIPv6 {
    foreach ($endpoint in @("https://ipv6.icanhazip.com", "https://api64.ipify.org")) {
        try {
            $ip = ([string](Invoke-RestMethod -Uri $endpoint -TimeoutSec 3 -ErrorAction Stop)).Trim()
            if (Test-ValidPublicIPv6 -Ip $ip) { return $ip }
        } catch {}
    }
    return "0"
}

# ============================================================
# 流量统计
# ============================================================

function Get-TrafficData {
    if (Test-Path -LiteralPath $TRAFFIC_FILE) {
        $raw = Get-Content -LiteralPath $TRAFFIC_FILE -Raw -Encoding UTF8
        $data = @{}
        $raw -split "`n" | ForEach-Object {
            $line = $_.Trim()
            if ($line -match '^(\w+)=(.*)$') {
                $data[$Matches[1]] = $Matches[2]
            }
        }
        return $data
    }
    return @{}
}

function Save-TrafficData {
    param($Data)
    if (-not (Test-Path -LiteralPath $CONFIG_DIR)) {
        Set-ProtectedDirectoryAcl -Path $CONFIG_DIR
    }
    $lines = @()
    foreach ($key in $Data.Keys) {
        $lines += "$key=$($Data[$key])"
    }
    $tmpFile = "$TRAFFIC_FILE.tmp"
    [System.IO.File]::WriteAllText($tmpFile, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Set-ProtectedFileAcl -Path $tmpFile
    Move-Item -LiteralPath $tmpFile -Destination $TRAFFIC_FILE -Force -ErrorAction SilentlyContinue
}

function Normalize-CorrectionValue {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return "0" }
    return $Value.Trim()
}

function Test-CorrectionValue {
    param([string]$Value)
    $normalized = Normalize-CorrectionValue $Value
    if ($normalized -notmatch '^[0-9]+(\.[0-9]+)?$') { return $false }
    $number = 0.0
    if (-not [double]::TryParse($normalized, [System.Globalization.NumberStyles]::Float, $INVARIANT_CULTURE, [ref]$number)) {
        return $false
    }
    return $number -ge 0 -and $number -le $MAX_TRAFFIC_CORRECTION_GB
}

function Apply-TrafficCorrection {
    param([string]$RxCorrection, [string]$TxCorrection, [string]$Interface = "")
    $rxNorm = Normalize-CorrectionValue $RxCorrection
    $txNorm = Normalize-CorrectionValue $TxCorrection
    if (-not (Test-CorrectionValue $rxNorm) -or -not (Test-CorrectionValue $txNorm)) { return $false }

    $rxBytes = [long]([double]::Parse($rxNorm, $INVARIANT_CULTURE) * 1GB)
    $txBytes = [long]([double]::Parse($txNorm, $INVARIANT_CULTURE) * 1GB)

    $saved = @{
        RX_PREV = "0"; TX_PREV = "0"
        RX_PERIOD = "0"; TX_PERIOD = "0"
        LAST_CHECK = "0"; PERIOD_START = "0"
    }
    if (Test-Path -LiteralPath $TRAFFIC_FILE) {
        Get-Content -LiteralPath $TRAFFIC_FILE | ForEach-Object {
            $parts = $_.Split('=', 2)
            if ($parts.Count -eq 2) { $saved[$parts[0].Trim()] = $parts[1].Trim() }
        }
    }

    $normalizedInterface = Normalize-NetworkInterfaceList -Value $Interface
    $currentNet = Get-NetworkStats -Interface $normalizedInterface
    $saved.RX_PREV = ([long]$currentNet.rx).ToString($INVARIANT_CULTURE)
    $saved.TX_PREV = ([long]$currentNet.tx).ToString($INVARIANT_CULTURE)
    $saved.INTERFACE = $normalizedInterface
    $saved.RX_PERIOD = $rxBytes.ToString($INVARIANT_CULTURE)
    $saved.TX_PERIOD = $txBytes.ToString($INVARIANT_CULTURE)
    Write-Log "流量校正已应用: RX=${rxNorm}GB (${rxBytes} bytes) TX=${txNorm}GB (${txBytes} bytes)" "INFO"

    $nowTs = [long]([DateTimeOffset]::Now.ToUnixTimeSeconds())
    $saved.LAST_CHECK = $nowTs.ToString($INVARIANT_CULTURE)
    Save-TrafficData -Data $saved
    return $true
}

function Send-CorrectionConfirm {
    param([string]$ServerId, [string]$Secret, [string]$WorkerUrl, [string]$RxCorrection, [string]$TxCorrection)
    $rxValue = Normalize-CorrectionValue $RxCorrection
    $txValue = Normalize-CorrectionValue $TxCorrection
    if (-not (Test-CorrectionValue $rxValue) -or -not (Test-CorrectionValue $txValue)) { return $false }
    $payload = @{
        id = $ServerId
        secret = $Secret
        rx_correction = [double]::Parse($rxValue, $INVARIANT_CULTURE)
        tx_correction = [double]::Parse($txValue, $INVARIANT_CULTURE)
    } | ConvertTo-Json -Compress

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $WorkerUrl -Method Post -Body $payload `
            -ContentType "application/json; charset=utf-8" -TimeoutSec 4 -ErrorAction Stop
        if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) {
            Write-Log "流量校正确认已发送: RX=${rxValue}GB TX=${txValue}GB" "INFO"
            return $true
        }
    } catch {
        Write-Log "流量校正确认发送失败: $_" "DEBUG"
    }
    return $false
}

function Invoke-TrafficCorrection {
    param([string]$ServerId, [string]$Secret, [string]$WorkerUrl, [string]$RxCorrection, [string]$TxCorrection, [string]$Interface = "")
    $rxValue = Normalize-CorrectionValue $RxCorrection
    $txValue = Normalize-CorrectionValue $TxCorrection

    if (Apply-TrafficCorrection -RxCorrection $rxValue -TxCorrection $txValue -Interface $Interface) {
        [void](Send-CorrectionConfirm -ServerId $ServerId -Secret $Secret -WorkerUrl $WorkerUrl -RxCorrection $rxValue -TxCorrection $txValue)
    }
}

function Get-PeriodStartTimestamp {
    param([int]$ResetDay, [long]$NowTs)
    if ($ResetDay -eq 0) { return 0 }
    $dt = [DateTimeOffset]::FromUnixTimeSeconds($NowTs).UtcDateTime
    $year = $dt.Year; $month = $dt.Month; $day = $dt.Day
    $targetDay = $ResetDay
    $daysInMonth = [DateTime]::DaysInMonth($year, $month)
    if ($targetDay -gt $daysInMonth) { $targetDay = $daysInMonth }
    if ($day -ge $targetDay) {
        $start = [DateTime]::SpecifyKind([DateTime]::new($year, $month, $targetDay), [DateTimeKind]::Utc)
    } else {
        $prevMonth = $month - 1
        if ($prevMonth -eq 0) { $prevMonth = 12; $year-- }
        $daysInPrev = [DateTime]::DaysInMonth($year, $prevMonth)
        $td = [math]::Min($ResetDay, $daysInPrev)
        $start = [DateTime]::SpecifyKind([DateTime]::new($year, $prevMonth, $td), [DateTimeKind]::Utc)
    }
    return [long]([DateTimeOffset]::new($start).ToUnixTimeSeconds())
}

function Convert-ToLongOrDefault {
    param($Value, [long]$Default = 0)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $Default }
    $parsed = [long]0
    if ([long]::TryParse(([string]$Value).Trim(), [System.Globalization.NumberStyles]::Integer, $INVARIANT_CULTURE, [ref]$parsed)) {
        return $parsed
    }
    return $Default
}

function Update-MonthlyTraffic {
    param([long]$CurrentRx, [long]$CurrentTx, [int]$ResetDay, [string]$Interface = "")
    $nowTs = [long]([DateTimeOffset]::Now.ToUnixTimeSeconds())
    $normalizedInterface = Normalize-NetworkInterfaceList -Value $Interface
    $saved = Get-TrafficData
    $savedRxPrev = Convert-ToLongOrDefault $saved["RX_PREV"]
    $savedTxPrev = Convert-ToLongOrDefault $saved["TX_PREV"]
    $savedRxPeriod = Convert-ToLongOrDefault $saved["RX_PERIOD"]
    $savedTxPeriod = Convert-ToLongOrDefault $saved["TX_PERIOD"]
    $savedLastCheck = Convert-ToLongOrDefault $saved["LAST_CHECK"]
    $savedPeriodStart = Convert-ToLongOrDefault $saved["PERIOD_START"]
    $savedInterface = if ($saved.ContainsKey("INTERFACE")) { [string]$saved["INTERFACE"] } else { "" }
    if ($savedInterface -ne $normalizedInterface) {
        $savedRxPrev = 0
        $savedTxPrev = 0
        $savedRxPeriod = 0
        $savedTxPeriod = 0
        $savedLastCheck = 0
        $savedPeriodStart = 0
    }

    $periodStart = Get-PeriodStartTimestamp -ResetDay $ResetDay -NowTs $nowTs
    $rxDelta = [long]0; $txDelta = [long]0

    if ($savedLastCheck -ne 0) {
        if ($CurrentRx -lt $savedRxPrev -or $CurrentTx -lt $savedTxPrev) {
            $rxDelta = 0; $txDelta = 0
        } else {
            $rxDelta = $CurrentRx - $savedRxPrev
            $txDelta = $CurrentTx - $savedTxPrev
        }
        if ($periodStart -ne 0 -and $periodStart -ne $savedPeriodStart -and $savedPeriodStart -ne 0) {
            $savedRxPeriod = $rxDelta
            $savedTxPeriod = $txDelta
        } else {
            $savedRxPeriod += $rxDelta
            $savedTxPeriod += $txDelta
        }
    }

    $newData = @{
        RX_PREV = $CurrentRx.ToString($INVARIANT_CULTURE)
        TX_PREV = $CurrentTx.ToString($INVARIANT_CULTURE)
        RX_PERIOD = $savedRxPeriod.ToString($INVARIANT_CULTURE)
        TX_PERIOD = $savedTxPeriod.ToString($INVARIANT_CULTURE)
        LAST_CHECK = $nowTs.ToString($INVARIANT_CULTURE)
        PERIOD_START = $periodStart.ToString($INVARIANT_CULTURE)
        INTERFACE = $normalizedInterface
    }
    Save-TrafficData -Data $newData
    return @{ rx = $savedRxPeriod; tx = $savedTxPeriod }
}

# ============================================================
# 主采集循环（统一支持桌面托盘模式与 Session 0/Server Core 无头模式）
# ============================================================

function Initialize-CollectRuntimeState {
    $config = Load-Config
    if (-not $config) {
        Write-Log "配置文件不存在，使用命令行参数..." "WARN"
        if (-not $Id -or -not $Secret -or -not $Url) {
            Write-Log "错误: 缺少必要参数" "ERROR"
            Write-Host "请使用: .\cf-server-monitor.ps1 run -Id 'ID' -Secret '密钥' -Url '地址'" -ForegroundColor Yellow
            return $false
        }
        try {
            $newAutoUpdate = if ($AutoUpdate -ne "") {
                ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0" -Strict
            } else {
                "0"
            }
            $newInterface = Normalize-NetworkInterfaceList -Value $Interface -Strict
        } catch {
            Write-Log "错误: $($_.Exception.Message)" "ERROR"
            return $false
        }
        $initCollect = Resolve-IntOptionValue -ExplicitValue $CollectInterval -ExistingConfig $null -PropertyName 'collect_interval' -DefaultValue 0
        $initReport = Resolve-IntOptionValue -ExplicitValue $ReportInterval -ExistingConfig $null -PropertyName 'report_interval' -DefaultValue 60
        $initReset = Resolve-IntOptionValue -ExplicitValue $ResetDay -ExistingConfig $null -PropertyName 'reset_day' -DefaultValue 1
        $config = @{
            server_id = $Id
            secret = $Secret
            worker_url = $Url
            collect_interval = $initCollect
            report_interval = $initReport
            reset_day = $initReset
            auto_update = $newAutoUpdate
            config_md5 = "none"
            ct_node = if ($CtNode) { $CtNode } else { "" }
            cu_node = if ($CuNode) { $CuNode } else { "" }
            cm_node = if ($CmNode) { $CmNode } else { "" }
            bd_node = if ($BdNode) { $BdNode } else { "" }
            interface = $newInterface
        }
        Save-Config -Config $config | Out-Null
        Write-Log "已保存配置到: $CONFIG_FILE" "INFO"
    }

    $serverId = if ($Id) { $Id } else { [string]$config.server_id }
    $secretVal = if ($Secret) { $Secret } else { [string]$config.secret }
    $workerUrl = if ($Url) { $Url.Trim().Trim("'").Trim('"') } else { ([string]$config.worker_url).Trim().Trim("'").Trim('"') }

    $reportInterval = Resolve-IntOptionValue -ExplicitValue $ReportInterval -ExistingConfig $config -PropertyName 'report_interval' -DefaultValue 60
    $resetDay = Resolve-IntOptionValue -ExplicitValue $ResetDay -ExistingConfig $config -PropertyName 'reset_day' -DefaultValue 1

    $configMd5 = if ($config.config_md5) { $config.config_md5.ToString().Trim().ToLowerInvariant() } else { "none" }
    $ctNode = if ($CtNode) { $CtNode } else { [string](Get-ConfigProperty $config 'ct_node' "") }
    $cuNode = if ($CuNode) { $CuNode } else { [string](Get-ConfigProperty $config 'cu_node' "") }
    $cmNode = if ($CmNode) { $CmNode } else { [string](Get-ConfigProperty $config 'cm_node' "") }
    $bdNode = if ($BdNode) { $BdNode } else { [string](Get-ConfigProperty $config 'bd_node' "") }
    try {
        $networkInterface = if ($Interface) {
            Normalize-NetworkInterfaceList -Value $Interface -Strict
        } else {
            Normalize-NetworkInterfaceList -Value ([string](Get-ConfigProperty $config 'interface' ""))
        }
    } catch {
        Write-Log "错误: $($_.Exception.Message)" "ERROR"
        return $false
    }
    try {
        $autoUpdate = if ($AutoUpdate -ne "") {
            ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0" -Strict
        } else {
            ConvertTo-BinaryFlag -Value $config.auto_update -Default "0"
        }
    } catch {
        Write-Log "错误: $($_.Exception.Message)" "ERROR"
        return $false
    }

    $ctNode = $ctNode.Trim()
    $cuNode = $cuNode.Trim()
    $cmNode = $cmNode.Trim()
    $bdNode = $bdNode.Trim()
    $networkInterface = $networkInterface.Trim()

    if ($workerUrl -notmatch '^https?://[^\s''"]+$') {
        Write-Log "错误: worker_url 无效: '$workerUrl'" "ERROR"
        return $false
    }
    if (-not $serverId -or -not $secretVal -or -not $workerUrl) {
        Write-Log "配置不完整，请填写 server_id, secret, worker_url" "ERROR"
        return $false
    }
    if (@(30, 60, 120, 180) -notcontains $reportInterval) { $reportInterval = 60 }
    if ($resetDay -lt 0 -or $resetDay -gt 31) { $resetDay = 1 }
    $effectiveReportInterval = [math]::Max($reportInterval, 60)

    $pingDir = Get-AgentUpdateTempDir
    if (-not $pingDir) {
        $pingDir = $CONFIG_DIR
        if (-not (Test-Path -LiteralPath $pingDir)) {
            New-Item -ItemType Directory -Path $pingDir -Force | Out-Null
        }
    }

    $script:cs_configObj = $config
    $script:cs_serverId = $serverId
    $script:cs_secret = $secretVal
    $script:cs_workerUrl = $workerUrl
    $script:cs_pingTempFile = Join-Path $pingDir "cf_probe_ping_results.json"

    $script:cs_prevNet = @{ rx = [long]0; tx = [long]0; time = [long]0 }
    $script:cs_lastIpCheck = [long]0
    $script:cs_lastPingCheck = [long]0
    $script:cs_ipV4 = "0"
    $script:cs_ipV6 = "0"
    $script:cs_pingCt = Get-ProbeInitialValue $ctNode
    $script:cs_pingCu = Get-ProbeInitialValue $cuNode
    $script:cs_pingCm = Get-ProbeInitialValue $cmNode
    $script:cs_pingBd = Get-ProbeInitialValue $bdNode
    $script:cs_lossCt = Get-ProbeInitialValue $ctNode
    $script:cs_lossCu = Get-ProbeInitialValue $cuNode
    $script:cs_lossCm = Get-ProbeInitialValue $cmNode
    $script:cs_lossBd = Get-ProbeInitialValue $bdNode
    $script:cs_lastReportTime = [long]0
    $script:cs_reportInterval = $effectiveReportInterval
    $script:cs_resetDay = $resetDay
    $script:cs_configMd5 = $configMd5
    $script:cs_ctNode = $ctNode
    $script:cs_cuNode = $cuNode
    $script:cs_cmNode = $cmNode
    $script:cs_bdNode = $bdNode
    $script:cs_interface = $networkInterface
    $script:cs_autoUpdate = $autoUpdate

    $script:cs_diskCheckInterval = 120
    $script:cs_lastDiskCheck = [long]0
    $script:cs_diskTotal = [long]0
    $script:cs_diskUsed = [long]0

    $script:cs_statusCheckInterval = 60
    $script:cs_lastStatusCheck = [long]0

    $script:cs_cpuInfo = ""
    $script:cs_cpuCores = 1
    $script:cs_bootTime = [long]0
    $script:cs_osName = ""
    $script:cs_arch = ""
    $script:cs_kernelVersion = ""
    $script:cs_gpuInfoValue = $null
    $script:cs_loadAvg = "0.00 0.00 0.00"
    $script:cs_processCount = 0
    $script:cs_tcpConn = 0
    $script:cs_udpConn = 0
    $script:cs_rxMonthly = [long]0
    $script:cs_txMonthly = [long]0

    try {
        $counter = New-Object System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total")
        $null = $counter.NextValue()
        Start-Sleep -Milliseconds 300
    } catch {}

    $interfaceLogValue = if ($networkInterface) { $networkInterface } else { "auto" }
    Write-Log "探针已启动。 ServerID=$serverId Url='$workerUrl' ReportInterval=${reportInterval}s EffectiveReportInterval=${effectiveReportInterval}s CollectInterval=ignored Interface=$interfaceLogValue AutoUpdate=$autoUpdate"
    return $true
}

function Invoke-SingleCollectCycle {
    param($Timer = $null)

    try {
        $srvId = $script:cs_serverId
        $sec = $script:cs_secret
        $wUrl = $script:cs_workerUrl
        $ctN = [string]$script:cs_ctNode
        $cuN = [string]$script:cs_cuNode
        $cmN = [string]$script:cs_cmNode
        $bdN = [string]$script:cs_bdNode
        $nicNames = [string]$script:cs_interface
        $rDay = [int]$script:cs_resetDay
        $rInterval = [int]$script:cs_reportInterval
        $pFile = $script:cs_pingTempFile

        $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()

        # IP 检测（每 10 分钟）
        if ($now - $script:cs_lastIpCheck -ge 600 -or $script:cs_lastIpCheck -eq 0) {
            $script:cs_ipV4 = Get-PublicIPv4
            $script:cs_ipV6 = Get-PublicIPv6
            $script:cs_lastIpCheck = $now
        }

        # Ping 跟随上报间隔并限制在 30-60 秒
        $probeInterval = [int]$script:cs_reportInterval
        if ($probeInterval -lt 30) { $probeInterval = 30 }
        if ($probeInterval -gt 60) { $probeInterval = 60 }
        if ($now - $script:cs_lastPingCheck -ge $probeInterval -or $script:cs_lastPingCheck -eq 0) {
            $script:cs_lastPingCheck = $now
            $existingJob = Get-Job -Name "CFProbePingJob" -ErrorAction SilentlyContinue
            if (-not $existingJob -or $existingJob.State -in @("Completed", "Failed", "Stopped")) {
                Remove-PingBackgroundJob
                Start-PingBackgroundJob -CtNode $ctN -CuNode $cuN -CmNode $cmN -BdNode $bdN -TempFile $pFile
            }
        }

        $pingResults = Read-PingResults -TempFile $pFile
        if ($pingResults) {
            $props = $pingResults.PSObject.Properties
            if ($props['ct_ping']) { $script:cs_pingCt = $pingResults.ct_ping }
            if ($props['cu_ping']) { $script:cs_pingCu = $pingResults.cu_ping }
            if ($props['cm_ping']) { $script:cs_pingCm = $pingResults.cm_ping }
            if ($props['bd_ping']) { $script:cs_pingBd = $pingResults.bd_ping }
            if ($props['ct_loss']) { $script:cs_lossCt = $pingResults.ct_loss }
            if ($props['cu_loss']) { $script:cs_lossCu = $pingResults.cu_loss }
            if ($props['cm_loss']) { $script:cs_lossCm = $pingResults.cm_loss }
            if ($props['bd_loss']) { $script:cs_lossBd = $pingResults.bd_loss }
        }

        if ([string]::IsNullOrWhiteSpace($ctN)) { $script:cs_pingCt = $false; $script:cs_lossCt = $false }
        if ([string]::IsNullOrWhiteSpace($cuN)) { $script:cs_pingCu = $false; $script:cs_lossCu = $false }
        if ([string]::IsNullOrWhiteSpace($cmN)) { $script:cs_pingCm = $false; $script:cs_lossCm = $false }
        if ([string]::IsNullOrWhiteSpace($bdN)) { $script:cs_pingBd = $false; $script:cs_lossBd = $false }

        $cpuPercent = [double](Get-CpuUsage)
        $mem = Get-MemoryInfo
        $swap = Get-SwapInfo

        $netStat = Get-NetworkStats -Interface $nicNames
        $rxNow = [long]$netStat.rx
        $txNow = [long]$netStat.tx

        $rxPrev = if ($script:cs_prevNet.time -gt 0) { [long]$script:cs_prevNet.rx } else { $rxNow }
        $txPrev = if ($script:cs_prevNet.time -gt 0) { [long]$script:cs_prevNet.tx } else { $txNow }
        $deltaTime = if ($script:cs_prevNet.time -gt 0) { [math]::Max($now - [long]$script:cs_prevNet.time, 1) } else { 1 }
        $rxSpeed = [math]::Max(($rxNow - $rxPrev) / $deltaTime, 0)
        $txSpeed = [math]::Max(($txNow - $txPrev) / $deltaTime, 0)
        $script:cs_prevNet = @{ rx = $rxNow; tx = $txNow; time = $now }

        if ($now - $script:cs_lastDiskCheck -ge $script:cs_diskCheckInterval -or $script:cs_lastDiskCheck -eq 0) {
            $disk = Get-DiskInfo
            $script:cs_diskTotal = [long]$disk.total
            $script:cs_diskUsed = [long]$disk.used
            $script:cs_lastDiskCheck = $now
        }

        if ($script:cs_lastStatusCheck -eq 0) {
            $script:cs_cpuInfo = Get-CpuInfo
            $script:cs_cpuCores = [int](Get-CpuCores)
            $script:cs_bootTime = [long](Get-BootTime)
            $script:cs_arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "x86" }
            try {
                $os = Get-CimInstance Win32_OperatingSystem
                $script:cs_osName = [string]$os.Caption
                $script:cs_kernelVersion = [string]$os.Version
            } catch {
                $script:cs_osName = ""
                $script:cs_kernelVersion = ""
            }
        }

        if ($now - $script:cs_lastStatusCheck -ge $script:cs_statusCheckInterval -or $script:cs_lastStatusCheck -eq 0) {
            $script:cs_loadAvg = Get-LoadAvg -CpuPercent $cpuPercent
            $script:cs_processCount = [int](Get-ProcessCount)
            $conn = Get-TcpUdpConnections
            $script:cs_tcpConn = [int]$conn.tcp
            $script:cs_udpConn = [int]$conn.udp
            $gpuInfo = @(Get-GpuInfo)
            $script:cs_gpuInfoValue = $null
            if ($gpuInfo.Count -gt 0) {
                $script:cs_gpuInfoValue = New-Object System.Collections.ArrayList
                foreach ($gpu in $gpuInfo) { [void]$script:cs_gpuInfoValue.Add($gpu) }
            }

            $netTraffic = Update-MonthlyTraffic -CurrentRx $rxNow -CurrentTx $txNow -ResetDay $rDay -Interface $nicNames
            $script:cs_rxMonthly = [long]$netTraffic.rx
            $script:cs_txMonthly = [long]$netTraffic.tx

            $script:cs_lastStatusCheck = $now
        }

        $metrics = @{
            cpu = $cpuPercent.ToString("F2", $INVARIANT_CULTURE)
            ram_total = ([long]$mem.total).ToString($INVARIANT_CULTURE)
            ram_used = ([long]$mem.used).ToString($INVARIANT_CULTURE)
            swap_total = ([long]$swap.total).ToString($INVARIANT_CULTURE)
            swap_used = ([long]$swap.used).ToString($INVARIANT_CULTURE)
            disk_total = ([long]$script:cs_diskTotal).ToString($INVARIANT_CULTURE)
            disk_used = ([long]$script:cs_diskUsed).ToString($INVARIANT_CULTURE)
            load_avg = $script:cs_loadAvg
            boot_time = ([long]$script:cs_bootTime).ToString($INVARIANT_CULTURE)
            net_rx = $rxNow.ToString($INVARIANT_CULTURE)
            net_tx = $txNow.ToString($INVARIANT_CULTURE)
            net_rx_monthly = ([long]$script:cs_rxMonthly).ToString($INVARIANT_CULTURE)
            net_tx_monthly = ([long]$script:cs_txMonthly).ToString($INVARIANT_CULTURE)
            net_in_speed = ([long][math]::Floor($rxSpeed)).ToString($INVARIANT_CULTURE)
            net_out_speed = ([long][math]::Floor($txSpeed)).ToString($INVARIANT_CULTURE)
            os = $script:cs_osName
            arch = $script:cs_arch
            kernel_version = $script:cs_kernelVersion
            cpu_info = $script:cs_cpuInfo
            cpu_cores = ([int]$script:cs_cpuCores).ToString($INVARIANT_CULTURE)
            gpu_info = $script:cs_gpuInfoValue
            processes = ([int]$script:cs_processCount).ToString($INVARIANT_CULTURE)
            tcp_conn = ([int]$script:cs_tcpConn).ToString($INVARIANT_CULTURE)
            udp_conn = ([int]$script:cs_udpConn).ToString($INVARIANT_CULTURE)
            ip_v4 = $script:cs_ipV4
            ip_v6 = $script:cs_ipV6
            ping_ct = $script:cs_pingCt
            ping_cu = $script:cs_pingCu
            ping_cm = $script:cs_pingCm
            ping_bd = $script:cs_pingBd
            loss_ct = $script:cs_lossCt
            loss_cu = $script:cs_lossCu
            loss_cm = $script:cs_lossCm
            loss_bd = $script:cs_lossBd
        }

        $shouldReport = ($script:cs_lastReportTime -eq 0) -or ($now - $script:cs_lastReportTime -ge $rInterval)
        if ($shouldReport) {
            $payload = @{
                id = $srvId
                secret = $sec
                metrics = $metrics
                collect_interval = 0
                report_interval = $rInterval
            }
            $json = $payload | ConvertTo-Json -Depth 10 -Compress
            try {
                $requestHeaders = @{
                    'X-Agent-Config-Schema' = '3'
                    'X-Agent-Version' = $AGENT_VERSION
                    'X-Agent-Config-Md5' = if ($script:cs_configMd5) { $script:cs_configMd5 } else { 'none' }
                }
                $response = Invoke-WebRequest -UseBasicParsing -Uri $wUrl -Method Post -Body $json `
                    -ContentType "application/json; charset=utf-8" -Headers $requestHeaders -TimeoutSec 8 -ErrorAction Stop
                if ([int]$response.StatusCode -eq 200) {
                    $responseBody = if ($response.Content -is [byte[]]) {
                        [Text.Encoding]::UTF8.GetString([byte[]]$response.Content)
                    } else {
                        [string]$response.Content
                    }
                    $responseBody = if ($null -eq $responseBody) { "" } else { $responseBody.Trim() }
                    if (-not [string]::IsNullOrWhiteSpace($responseBody) -and $responseBody -ne "OK") {
                        $remoteConfig = ConvertFrom-AgentConfigResponse `
                            -Body $responseBody `
                            -ConfigMd5 ([string]$response.Headers['X-Agent-Config-Md5'])

                        $hasRemoteConfig = (-not $remoteConfig.ContainsKey('has_config')) -or [bool]$remoteConfig['has_config']
                        $configApplied = $true
                        if ($hasRemoteConfig) {
                            $configChanged = $remoteConfig.config_md5 -ne $script:cs_configMd5
                            if ($configChanged) {
                                foreach ($entry in $remoteConfig.GetEnumerator()) {
                                    if (@('has_config', 'update', 'rx_correction', 'tx_correction') -contains $entry.Key) {
                                        continue
                                    }
                                    if ($script:cs_configObj -is [hashtable]) {
                                        $script:cs_configObj[$entry.Key] = $entry.Value
                                    } else {
                                        $script:cs_configObj | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
                                    }
                                }
                                $configApplied = Save-Config -Config $script:cs_configObj
                                if ($configApplied) {
                                    $effectiveRemoteReportInterval = [math]::Max($remoteConfig.report_interval, 60)
                                    $script:cs_reportInterval = $effectiveRemoteReportInterval
                                    $script:cs_resetDay = $remoteConfig.reset_day
                                    $script:cs_configMd5 = $remoteConfig.config_md5
                                    if ($remoteConfig.ContainsKey('ct_node')) { $script:cs_ctNode = $remoteConfig.ct_node }
                                    if ($remoteConfig.ContainsKey('cu_node')) { $script:cs_cuNode = $remoteConfig.cu_node }
                                    if ($remoteConfig.ContainsKey('cm_node')) { $script:cs_cmNode = $remoteConfig.cm_node }
                                    if ($remoteConfig.ContainsKey('bd_node')) { $script:cs_bdNode = $remoteConfig.bd_node }
                                    if ($remoteConfig.ContainsKey('interface')) { $script:cs_interface = $remoteConfig.interface }
                                    $currentRemoteNet = Get-NetworkStats -Interface ([string]$script:cs_interface)
                                    $script:cs_prevNet = @{
                                        rx = [long]$currentRemoteNet.rx
                                        tx = [long]$currentRemoteNet.tx
                                        time = [DateTimeOffset]::Now.ToUnixTimeSeconds()
                                    }
                                    if ($null -ne $Timer) {
                                        $Timer.Stop()
                                        $Timer.Interval = $effectiveRemoteReportInterval * 1000
                                        $Timer.Start()
                                    }
                                    $remoteInterfaceLog = if ($script:cs_interface) { $script:cs_interface } else { "auto" }
                                    Write-Log "动态配置已应用: md5=$($remoteConfig.config_md5) report_interval=$($remoteConfig.report_interval)s interface=$remoteInterfaceLog ct=$($remoteConfig.ct_node) cu=$($remoteConfig.cu_node) cm=$($remoteConfig.cm_node) bd=$($remoteConfig.bd_node)" "INFO"

                                    $script:cs_lastPingCheck = 0
                                    $script:cs_pingCt = Get-ProbeInitialValue $script:cs_ctNode
                                    $script:cs_pingCu = Get-ProbeInitialValue $script:cs_cuNode
                                    $script:cs_pingCm = Get-ProbeInitialValue $script:cs_cmNode
                                    $script:cs_pingBd = Get-ProbeInitialValue $script:cs_bdNode
                                    $script:cs_lossCt = Get-ProbeInitialValue $script:cs_ctNode
                                    $script:cs_lossCu = Get-ProbeInitialValue $script:cs_cuNode
                                    $script:cs_lossCm = Get-ProbeInitialValue $script:cs_cmNode
                                    $script:cs_lossBd = Get-ProbeInitialValue $script:cs_bdNode
                                    Remove-Item -LiteralPath $pFile -Force -ErrorAction SilentlyContinue

                                    $existingPingJob = Get-Job -Name "CFProbePingJob" -ErrorAction SilentlyContinue
                                    if ($existingPingJob) {
                                        $existingPingJob | Stop-Job -ErrorAction SilentlyContinue | Out-Null
                                        $existingPingJob | Remove-Job -Force -ErrorAction SilentlyContinue | Out-Null
                                    }
                                    Start-PingBackgroundJob -CtNode $script:cs_ctNode -CuNode $script:cs_cuNode -CmNode $script:cs_cmNode -BdNode $script:cs_bdNode -TempFile $pFile
                                }
                            }
                        }

                        if ($hasRemoteConfig -and $configApplied -and ($remoteConfig.ContainsKey('rx_correction') -or $remoteConfig.ContainsKey('tx_correction'))) {
                            $rxCorr = if ($remoteConfig.ContainsKey('rx_correction')) { $remoteConfig.rx_correction } else { "" }
                            $txCorr = if ($remoteConfig.ContainsKey('tx_correction')) { $remoteConfig.tx_correction } else { "" }
                            Invoke-TrafficCorrection -ServerId $srvId -Secret $sec -WorkerUrl $wUrl -RxCorrection $rxCorr -TxCorrection $txCorr -Interface ([string]$script:cs_interface)
                        }

                        if ($remoteConfig.ContainsKey('update') -and $remoteConfig.update -eq "1") {
                            Write-Log "收到自动更新指令" "DEBUG"
                            Schedule-AgentUpdate -WorkerUrl $wUrl -AutoUpdate $script:cs_autoUpdate
                        }
                    }
                }
            } catch {
                Write-Log "上报失败: $_" "WARN"
            }
            $script:cs_lastReportTime = $now
        }
    } catch {
        Write-Log "采集异常: $_" "ERROR"
    }
}

function Start-HeadlessCollectLoop {
    if (-not (Initialize-CollectRuntimeState)) {
        return
    }
    Write-Log "探针进入纯后台无头采集模式（Headless Mode）" "INFO"
    while ($true) {
        $cycleStart = [DateTimeOffset]::Now.ToUnixTimeSeconds()
        Invoke-SingleCollectCycle -Timer $null
        $elapsed = [math]::Max([DateTimeOffset]::Now.ToUnixTimeSeconds() - $cycleStart, 0)
        $sleepSeconds = [math]::Max([int]$script:cs_reportInterval - [int]$elapsed, 1)
        Start-Sleep -Seconds $sleepSeconds
    }
}

function Test-CanUseInteractiveTray {
    try {
        if (-not [Environment]::UserInteractive) { return $false }
        $currentProcess = Get-Process -Id $PID -ErrorAction Stop
        if ($currentProcess.SessionId -le 0) { return $false }
        if ($host.Runspace.ApartmentState -ne 'STA') { return $false }
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Start-TimerCollectLoop {
    param($TrayIcon = $null)

    if (-not (Initialize-CollectRuntimeState)) {
        if ($null -ne $TrayIcon) {
            $TrayIcon.Visible = $false
            $TrayIcon.Dispose()
        }
        return
    }

    # 立即执行首轮采集上报，避免启动后空等一个周期
    Invoke-SingleCollectCycle -Timer $null

    $script:cs_uiTimer = New-Object System.Windows.Forms.Timer
    $script:cs_uiTimer.Interval = [int]$script:cs_reportInterval * 1000
    $script:cs_uiTimer.Add_Tick({
        Invoke-SingleCollectCycle -Timer $script:cs_uiTimer
    })
    $script:cs_uiTimer.Start()
    [System.Windows.Forms.Application]::Run()
}

function Invoke-TrayCollectLoop {
    param([switch]$AllowHeadlessFallback)

    if (-not (Test-CanUseInteractiveTray)) {
        if ($AllowHeadlessFallback -or $Action -eq "run") {
            Write-Log "检测到无交互桌面会话或无法加载 WinForms，自动降级为后台无头采集循环" "INFO"
            Start-HeadlessCollectLoop
            return
        }
        throw "当前会话不支持系统托盘界面（Session 0 / Server Core / 非 STA 会话）"
    }

    $trayIcon = $null
    try {
        $trayIcon = New-Object System.Windows.Forms.NotifyIcon
        $psExe = (Get-Command powershell -ErrorAction SilentlyContinue).Source
        if ($psExe -and (Test-Path -LiteralPath $psExe)) {
            $trayIcon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($psExe)
        }
        $trayIcon.Visible = $true
        $trayIcon.Text = "CF-Server-Monitor"

        $menu = New-Object System.Windows.Forms.ContextMenuStrip
        $statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
        $statusItem.Text = "查看状态"
        $statusItem.Add_Click({
            $config = Load-Config
            $effectiveStatusReportInterval = [math]::Max([int]$config.report_interval, 60)
            $statusAutoUpdate = ConvertTo-BinaryFlag -Value $config.auto_update -Default "0"
            $msg = "CF-Server-Monitor 状态`n"
            $msg += "Server ID: $($config.server_id)`n"
            $msg += "Worker URL: $($config.worker_url)`n"
            $msg += "上报间隔: $($config.report_interval)秒`n"
            $msg += "实际上报间隔: $effectiveStatusReportInterval秒`n"
            $msg += "自动更新: $statusAutoUpdate`n"
            $msg += "日志文件: $LOG_FILE"
            [System.Windows.Forms.MessageBox]::Show($msg, "CF-Server-Monitor", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
        })

        $stopItem = New-Object System.Windows.Forms.ToolStripMenuItem
        $stopItem.Text = "停止探针"
        $stopItem.Add_Click({
            Write-Log "用户从托盘菜单停止探针" "INFO"
            $trayIcon.Visible = $false
            $trayIcon.Dispose()
            [System.Windows.Forms.Application]::Exit()
            exit 0
        })

        $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
        $exitItem.Text = "退出"
        $exitItem.Add_Click({
            Write-Log "用户从托盘菜单退出" "INFO"
            $trayIcon.Visible = $false
            $trayIcon.Dispose()
            [System.Windows.Forms.Application]::Exit()
            exit 0
        })

        $menu.Items.Add($statusItem) | Out-Null
        $menu.Items.Add($stopItem) | Out-Null
        $menu.Items.Add($exitItem) | Out-Null
        $trayIcon.ContextMenuStrip = $menu

        Write-Log "探针已启动（托盘模式）" "INFO"
        Start-TimerCollectLoop -TrayIcon $trayIcon
    } catch {
        if ($null -ne $trayIcon) {
            try { $trayIcon.Visible = $false; $trayIcon.Dispose() } catch {}
        }
        if ($AllowHeadlessFallback -or $Action -eq "run") {
            Write-Log "托盘初始化失败 ($($_.Exception.Message))，自动降级为后台无头采集循环" "WARN"
            Start-HeadlessCollectLoop
            return
        }
        throw
    }
}

# ============================================================
# 服务管理
# ============================================================

function Stop-ProbeProcesses {
    $stoppedIds = @()
    try {
        $processes = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $_.ProcessId -ne $PID -and
            $_.Name -in @('powershell.exe', 'pwsh.exe') -and
            (
                ($_.CommandLine -match '(?i)cf-server-monitor\.ps1' -and $_.CommandLine -match '(?i)(\srun\b|\stray\b)') -or
                $_.CommandLine -match '(?i)cf-probe-auto-update(-runner)?-[a-f0-9]+\.ps1'
            )
        }
        foreach ($proc in @($processes)) {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            $stoppedIds += $proc.ProcessId
        }
    } catch {
        $fallbackProcs = Get-Process powershell, pwsh -ErrorAction SilentlyContinue | Where-Object {
            $_.Id -ne $PID -and $_.CommandLine -like "*cf-server-monitor*run*"
        }
        foreach ($fp in @($fallbackProcs)) {
            Stop-Process -Id $fp.Id -Force -ErrorAction SilentlyContinue
            $stoppedIds += $fp.Id
        }
    }
    return $stoppedIds
}

function Install-Service {
    $InstallDir = Get-ProtectedInstallDir
    $TargetScriptPath = Join-Path $InstallDir "cf-server-monitor.ps1"

    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "开始安装 CF-Server-Monitor" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "调试信息:" -ForegroundColor Cyan
    Write-Host "  Id: '$Id'" -ForegroundColor Cyan
    Write-Host "  Secret: '********'" -ForegroundColor Cyan
    Write-Host "  Url: '$Url'" -ForegroundColor Cyan
    Write-Host "  Interface: '$Interface'" -ForegroundColor Cyan
    Write-Host "  AutoUpdate: '$AutoUpdate'" -ForegroundColor Cyan
    Write-Host "  安装目录: $InstallDir" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""

    if ($AutoUpdate -ne "") {
        try {
            $null = ConvertTo-BinaryFlag -Value $AutoUpdate -Default "0" -Strict
        } catch {
            Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Red
            return
        }
    }

    if (-not (Test-Admin)) {
        Write-Host "需要管理员权限，正在提升..." -ForegroundColor Yellow
        Invoke-AsAdmin
        return
    }

    # 提取已有计划任务脚本目录，防止从下载目录或远程管道升级时丢失旧安装目录中的配置与当月流量
    $existingTask = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    $existingTaskScript = Get-AgentScriptFromScheduledTask -ScheduledTask $existingTask
    $existingTaskDir = if (-not [string]::IsNullOrWhiteSpace($existingTaskScript)) {
        Split-Path -Parent $existingTaskScript
    } else {
        $null
    }

    # 先停止运行中的旧探针，释放文件句柄后再更新受保护目录
    $stoppedBeforeInstall = Stop-ProbeProcesses
    if ($stoppedBeforeInstall.Count -gt 0) {
        Write-Host "已停止旧探针进程 (PID: $($stoppedBeforeInstall -join ', '))" -ForegroundColor Yellow
        Start-Sleep -Seconds 1
    }

    # 创建受保护安装目录与专用更新临时目录，移除继承权限，仅允许 SYSTEM 与 Administrators 完全控制
    Set-ProtectedDirectoryAcl -Path $InstallDir
    Set-ProtectedDirectoryAcl -Path (Join-Path $InstallDir "tmp")

    # 构建旧目录回退查找列表（依次检查当前脚本所在目录与旧计划任务所在目录）
    $legacyCandidateDirs = New-Object System.Collections.Generic.List[string]
    foreach ($candidateDir in @($SCRIPT_DIR, $existingTaskDir)) {
        if (-not [string]::IsNullOrWhiteSpace($candidateDir) -and
            (-not $candidateDir.Equals($InstallDir, [System.StringComparison]::OrdinalIgnoreCase))) {
            $alreadyAdded = $false
            foreach ($existingDir in $legacyCandidateDirs) {
                if ($existingDir.Equals($candidateDir, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $alreadyAdded = $true
                    break
                }
            }
            if (-not $alreadyAdded) {
                $legacyCandidateDirs.Add($candidateDir)
            }
        }
    }

    # 读取已有配置（优先 $InstallDir，兼容迁移旧 $SCRIPT_DIR 或旧计划任务目录下的配置与流量文件）
    $protectedConfigFile = Join-Path $InstallDir "cf_probe_config.json"
    $existingConfig = Load-ConfigFromPath -FilePath $protectedConfigFile
    if ($null -eq $existingConfig) {
        foreach ($legacyDir in $legacyCandidateDirs) {
            $legacyConfigFile = Join-Path $legacyDir "cf_probe_config.json"
            $existingConfig = Load-ConfigFromPath -FilePath $legacyConfigFile
            if ($null -ne $existingConfig) {
                break
            }
        }
    }

    $protectedTrafficFile = Join-Path $InstallDir "cf_probe_traffic.dat"
    if (-not (Test-Path -LiteralPath $protectedTrafficFile)) {
        foreach ($legacyDir in $legacyCandidateDirs) {
            $legacyTrafficFile = Join-Path $legacyDir "cf_probe_traffic.dat"
            if (Test-Path -LiteralPath $legacyTrafficFile) {
                $trafficItem = Get-Item -LiteralPath $legacyTrafficFile -Force -ErrorAction SilentlyContinue
                if ($null -ne $trafficItem -and -not ($trafficItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                    Copy-Item -LiteralPath $legacyTrafficFile -Destination $protectedTrafficFile -Force
                    Set-ProtectedFileAcl -Path $protectedTrafficFile
                    break
                }
            }
        }
    }

    # 将脚本安装复制到受保护固定目录 $env:ProgramData\CFProbe\cf-server-monitor.ps1
    $sourceScriptPath = $script:INITIAL_SCRIPT_PATH
    if ($sourceScriptPath -and (Test-Path -LiteralPath $sourceScriptPath)) {
        $fullSource = [System.IO.Path]::GetFullPath($sourceScriptPath)
        $fullTarget = [System.IO.Path]::GetFullPath($TargetScriptPath)
        if (-not $fullSource.Equals($fullTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
            Copy-Item -LiteralPath $fullSource -Destination $TargetScriptPath -Force
        }
    } elseif (-not [string]::IsNullOrWhiteSpace($script:INITIAL_SCRIPT_CONTENT)) {
        [System.IO.File]::WriteAllText($TargetScriptPath, $script:INITIAL_SCRIPT_CONTENT, (New-Object System.Text.UTF8Encoding($false)))
    }
    Set-ProtectedFileAcl -Path $TargetScriptPath

    # 统一将配置与数据路径切换到受保护目录 $InstallDir
    $script:SCRIPT_PATH = $TargetScriptPath
    $script:SCRIPT_DIR = $InstallDir
    $script:CONFIG_DIR = $InstallDir
    $script:CONFIG_FILE = $protectedConfigFile
    $script:LOG_FILE = Join-Path $InstallDir "cf_probe.log"
    $script:TRAFFIC_FILE = $protectedTrafficFile

    # 清理输入参数
    $cleanId = if ($Id) { $Id.Trim().Trim("'").Trim('"') } else { "" }
    $cleanSecret = if ($Secret) { $Secret.Trim().Trim("'").Trim('"') } else { "" }
    $cleanUrl = if ($Url) { $Url.Trim().Trim("'").Trim('"') } else { "" }
    try {
        $existingInterface = if ($existingConfig) {
            Normalize-NetworkInterfaceList -Value ([string](Get-ConfigProperty $existingConfig 'interface' ""))
        } else {
            ""
        }
        $interfaceValue = if ($Interface) {
            Normalize-NetworkInterfaceList -Value $Interface -Strict
        } else {
            $existingInterface
        }
        $existingAutoUpdate = if ($existingConfig -and $null -ne (Get-ConfigProperty $existingConfig 'auto_update' $null)) {
            ConvertTo-BinaryFlag -Value $existingConfig.auto_update -Default "0"
        } else {
            "0"
        }
        $autoUpdateValue = if ($AutoUpdate -ne "") {
            ConvertTo-BinaryFlag -Value $AutoUpdate -Default $existingAutoUpdate -Strict
        } else {
            $existingAutoUpdate
        }
    } catch {
        Write-Host "错误: $($_.Exception.Message)" -ForegroundColor Red
        return
    }

    # 命令行未显式传入时优先保留 $existingConfig，仅全新安装回退默认值 0 / 60 / 1
    $resolvedCollectInterval = Resolve-IntOptionValue -ExplicitValue $CollectInterval -ExistingConfig $existingConfig -PropertyName 'collect_interval' -DefaultValue 0
    $resolvedReportInterval = Resolve-IntOptionValue -ExplicitValue $ReportInterval -ExistingConfig $existingConfig -PropertyName 'report_interval' -DefaultValue 60
    $resolvedResetDay = Resolve-IntOptionValue -ExplicitValue $ResetDay -ExistingConfig $existingConfig -PropertyName 'reset_day' -DefaultValue 1

    $config = @{
        server_id = if ($cleanId) { $cleanId } elseif ($existingConfig) { [string]$existingConfig.server_id } else { "" }
        secret = if ($cleanSecret) { $cleanSecret } elseif ($existingConfig) { [string]$existingConfig.secret } else { "" }
        worker_url = if ($cleanUrl) { $cleanUrl } elseif ($existingConfig) { [string]$existingConfig.worker_url } else { "" }
        collect_interval = $resolvedCollectInterval
        report_interval = $resolvedReportInterval
        reset_day = $resolvedResetDay
        auto_update = $autoUpdateValue
        config_md5 = "none"
        ct_node = if ($CtNode) { $CtNode } else { [string](Get-ConfigProperty $existingConfig 'ct_node' "") }
        cu_node = if ($CuNode) { $CuNode } else { [string](Get-ConfigProperty $existingConfig 'cu_node' "") }
        cm_node = if ($CmNode) { $CmNode } else { [string](Get-ConfigProperty $existingConfig 'cm_node' "") }
        bd_node = if ($BdNode) { $BdNode } else { [string](Get-ConfigProperty $existingConfig 'bd_node' "") }
        interface = $interfaceValue
    }

    if (-not $config.server_id -or -not $config.secret -or -not $config.worker_url) {
        $maskedSec = Mask-SecretValue -Value ([string]$config.secret)
        Write-Host "错误: 缺少必要参数 -Id, -Secret, -Url" -ForegroundColor Red
        Write-Host "当前值:" -ForegroundColor Yellow
        Write-Host "  server_id: '$($config.server_id)'" -ForegroundColor Yellow
        Write-Host "  secret: '$maskedSec'" -ForegroundColor Yellow
        Write-Host "  worker_url: '$($config.worker_url)'" -ForegroundColor Yellow
        return
    }
    if ($config.worker_url -notmatch '^https?://[^\s''"]+$') {
        Write-Host "错误: -Url 必须以 https:// 或 http:// 开头且不含空白或引号" -ForegroundColor Red
        return
    }

    Write-Host "正在保存配置..." -ForegroundColor Cyan
    Write-Host "配置文件路径: $CONFIG_FILE" -ForegroundColor Cyan
    $saveResult = Save-Config -Config $config
    if (-not $saveResult) {
        Write-Host "配置保存失败！请检查目录权限: $CONFIG_DIR" -ForegroundColor Red
        return
    }
    Write-Host "配置保存成功: $CONFIG_FILE" -ForegroundColor Green

    # 流量校正
    $hasRxCorr = $RxCorrection -ne ""
    $hasTxCorr = $TxCorrection -ne ""
    if ($hasRxCorr -or $hasTxCorr) {
        if (($hasRxCorr -and -not (Test-CorrectionValue $RxCorrection)) -or ($hasTxCorr -and -not (Test-CorrectionValue $TxCorrection))) {
            Write-Host "错误: 流量校正参数非法" -ForegroundColor Red
            return
        }
        Write-Host "应用流量校正..." -ForegroundColor Cyan
        $netStat = Get-NetworkStats -Interface ([string]$config.interface)
        $currentRx = [long]$netStat.rx
        $currentTx = [long]$netStat.tx
        $nowTs = [long]([DateTimeOffset]::Now.ToUnixTimeSeconds())
        $rxBytes = if ($hasRxCorr) { [long]([double]::Parse($RxCorrection.Trim(), $INVARIANT_CULTURE) * 1GB) } else { [long]0 }
        $txBytes = if ($hasTxCorr) { [long]([double]::Parse($TxCorrection.Trim(), $INVARIANT_CULTURE) * 1GB) } else { [long]0 }
        $trafficData = @{
            RX_PREV = $currentRx.ToString($INVARIANT_CULTURE)
            TX_PREV = $currentTx.ToString($INVARIANT_CULTURE)
            RX_PERIOD = $rxBytes.ToString($INVARIANT_CULTURE)
            TX_PERIOD = $txBytes.ToString($INVARIANT_CULTURE)
            LAST_CHECK = $nowTs.ToString($INVARIANT_CULTURE)
            PERIOD_START = "0"
            INTERFACE = [string]$config.interface
        }
        Save-TrafficData -Data $trafficData
        if ($hasRxCorr) { Write-Host "  下行校正: ${RxCorrection}GB" -ForegroundColor Cyan }
        if ($hasTxCorr) { Write-Host "  上行校正: ${TxCorrection}GB" -ForegroundColor Cyan }
    }

    # 注册计划任务指向受 ACL 保护的 $InstallDir\cf-server-monitor.ps1
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$TargetScriptPath`" run -STA"
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    $existingTask = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($existingTask) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
    }

    Register-ScheduledTask -TaskName $TASK_NAME -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null

    $effectiveInstallReportInterval = [math]::Max([int]$config.report_interval, 60)

    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "       CF-Server-Monitor $AGENT_VERSION 安装成功" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  Server ID  : $($config.server_id)"
    Write-Host "  Secret     : ********"
    Write-Host "  Worker URL : $($config.worker_url)"
    Write-Host "  上报间隔   : $($config.report_interval)秒"
    Write-Host "  实际间隔   : $effectiveInstallReportInterval秒"
    Write-Host "  采样间隔   : Windows PowerShell 版不启用 samples 缓存"
    Write-Host "  统计网卡   : $(if ($config.interface) { $config.interface } else { '自动汇总(过滤虚拟网卡)' })"
    Write-Host "  流量重置日 : $(if ([int]$config.reset_day -eq 0) { '不重置' } else { "$($config.reset_day)号" })"
    Write-Host "  自动更新   : $($config.auto_update)"
    Write-Host "  安装目录   : $InstallDir"
    Write-Host "  配置文件   : $CONFIG_FILE"
    Write-Host "  日志文件   : $LOG_FILE"
    Write-Host "  自动启动   : 已注册计划任务 $TASK_NAME"
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""

    Write-Host "正在启动探针..." -ForegroundColor Yellow
    $runArgs = "-NoProfile -ExecutionPolicy Bypass -STA -File `"$TargetScriptPath`" run -STA"
    Start-Process powershell.exe -ArgumentList $runArgs -WindowStyle Hidden
    Start-Sleep -Seconds 2

    $running = $false
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
        foreach ($p in $procs) {
            if ($p.CommandLine -like "*cf-server-monitor*run*") {
                $running = $true
                break
            }
        }
    } catch {}
    if ($running) {
        Write-Host "探针已启动" -ForegroundColor Green
    } else {
        Write-Host "警告: 探针可能未启动，请检查日志: $LOG_FILE" -ForegroundColor Yellow
    }

    Write-Host "查看日志: $LOG_FILE" -ForegroundColor Green
}

function Get-AgentScriptFromScheduledTask {
    param($ScheduledTask)
    if ($null -eq $ScheduledTask) { return $null }
    foreach ($act in @($ScheduledTask.Actions)) {
        $arguments = [string]$act.Arguments
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

function Uninstall-Service {
    if (-not (Test-Admin)) {
        Write-Host "需要管理员权限，正在提升..." -ForegroundColor Yellow
        Invoke-AsAdmin
        return
    }

    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    $taskScript = Get-AgentScriptFromScheduledTask -ScheduledTask $task
    if ($task) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
        Write-Host "已删除计划任务: $TASK_NAME" -ForegroundColor Green
    }

    $stoppedIds = Stop-ProbeProcesses
    if ($stoppedIds.Count -gt 0) {
        Write-Host "已终止探针及自动更新子进程 (PID: $($stoppedIds -join ', '))" -ForegroundColor Green
    }

    $protectedDir = Get-ProtectedInstallDir
    $candidateDirs = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($protectedDir)) {
        [void]$candidateDirs.Add($protectedDir)
    }
    if (-not [string]::IsNullOrWhiteSpace($taskScript)) {
        $taskDir = Split-Path -Parent $taskScript
        if (-not [string]::IsNullOrWhiteSpace($taskDir)) { [void]$candidateDirs.Add($taskDir) }
    }
    if (-not [string]::IsNullOrWhiteSpace($script:INITIAL_SCRIPT_PATH)) {
        $callerDir = Split-Path -Parent $script:INITIAL_SCRIPT_PATH
        if (-not [string]::IsNullOrWhiteSpace($callerDir)) { [void]$candidateDirs.Add($callerDir) }
    }

    foreach ($dir in ($candidateDirs | Select-Object -Unique)) {
        foreach ($fileName in @(
            'cf_probe_config.json',
            'cf_probe_config.json.tmp',
            'cf_probe_config.json.bak',
            'cf_probe_traffic.dat',
            'cf_probe_traffic.dat.tmp',
            'cf_probe.log',
            'auto_update.lock',
            'cf_probe_ping_results.json'
        )) {
            $fp = Join-Path $dir $fileName
            if (Test-Path -LiteralPath $fp) {
                Remove-Item -LiteralPath $fp -Force -ErrorAction SilentlyContinue
            }
        }
        $subTmp = Join-Path $dir 'tmp'
        if (Test-Path -LiteralPath $subTmp) {
            Remove-Item -LiteralPath $subTmp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    if ($taskScript -and (Test-Path -LiteralPath $taskScript)) {
        Remove-Item -LiteralPath $taskScript -Force -ErrorAction SilentlyContinue
    }

    if ($protectedDir -and (Test-Path -LiteralPath $protectedDir)) {
        Remove-Item -LiteralPath $protectedDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    foreach ($tmpDir in @([System.IO.Path]::GetTempPath(), $env:TEMP, $env:TMP) + @($candidateDirs) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique) {
        if (Test-Path -LiteralPath $tmpDir) {
            $legacyPing = Join-Path $tmpDir 'cf_probe_ping_results.json'
            if (Test-Path -LiteralPath $legacyPing) {
                Remove-Item -LiteralPath $legacyPing -Force -ErrorAction SilentlyContinue
            }
            Get-ChildItem -LiteralPath $tmpDir -Filter 'cf-probe-auto-update*.ps1' -File -ErrorAction SilentlyContinue |
                Remove-Item -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "卸载完成。" -ForegroundColor Green
}

function Get-ServiceStatus {
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "计划任务: $($task.State)" -ForegroundColor Green
    } else {
        Write-Host "计划任务: 未注册" -ForegroundColor Yellow
    }
    $running = @()
    try {
        $processes = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $_.Name -in @('powershell.exe', 'pwsh.exe') -and $_.CommandLine -like "*cf-server-monitor*run*"
        }
        foreach ($proc in $processes) {
            $running += Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
        }
    } catch {
        $running = Get-Process powershell, pwsh -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*cf-server-monitor*run*"
        }
    }
    if ($running) {
        Write-Host "探针进程: 运行中 (PID: $($running.Id -join ', '))" -ForegroundColor Green
    } else {
        Write-Host "探针进程: 未运行" -ForegroundColor Yellow
    }
    $config = Load-Config
    if ($config) {
        $effectiveStatusReportInterval = [math]::Max([int]$config.report_interval, 60)
        $statusAutoUpdate = ConvertTo-BinaryFlag -Value $config.auto_update -Default "0"
        Write-Host "配置文件: $CONFIG_FILE" -ForegroundColor Cyan
        Write-Host "  Server ID  : $($config.server_id)"
        Write-Host "  Worker URL : $($config.worker_url)"
        Write-Host "  上报间隔   : $($config.report_interval)秒"
        Write-Host "  实际间隔   : $effectiveStatusReportInterval秒"
        Write-Host "  自动更新   : $statusAutoUpdate"
    }
}

function Stop-Service {
    $stopped = Stop-ProbeProcesses
    if ($stopped.Count -gt 0) {
        Write-Host "探针已停止 (PID: $($stopped -join ', '))。" -ForegroundColor Green
    } else {
        Write-Host "探针未运行。" -ForegroundColor Yellow
    }
}

# ============================================================
# 入口
# ============================================================

try {
    switch ($Action) {
        "install"   { Install-Service }
        "uninstall" { Uninstall-Service }
        "run"       { Invoke-TrayCollectLoop -AllowHeadlessFallback }
        "tray"      { Invoke-TrayCollectLoop }
        "status"    { Get-ServiceStatus }
        "stop"      { Stop-Service }
    }
} catch {
    Write-Host "=============================================" -ForegroundColor Red
    Write-Host "错误: $_" -ForegroundColor Red
    Write-Host "错误详情: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "错误行: $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor Red
    Write-Host "=============================================" -ForegroundColor Red
}
