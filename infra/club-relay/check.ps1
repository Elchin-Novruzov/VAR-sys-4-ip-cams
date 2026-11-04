# Padel VAR -- club relay status check.
#
# Run on the club PC (AnyDesk), in PowerShell, ONE line:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\padel-relay\check.ps1
#
# It looks at everything between the club's cameras and the VAR server and
# says what is wrong: the PC (up since, sleep), the padel-relay task and its
# ffmpeg processes, the networks, the NVR, the server, the internet, and the
# last lines of each camera's log. Passwords are never printed (masked), so
# the output can be pasted to whoever helps.
#
# Windows PowerShell 5.1, nothing to install. ASCII only on purpose: 5.1 reads
# a script without a byte-order mark in the local code page.

$ErrorActionPreference = "SilentlyContinue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = @{}
$envFile = Join-Path $here "relay.env"
if (Test-Path $envFile) {
  foreach ($raw in Get-Content $envFile) {
    $l = $raw.Trim()
    if ($l -eq "" -or $l.StartsWith("#")) { continue }
    $i = $l.IndexOf("=")
    if ($i -gt 0) { $cfg[$l.Substring(0, $i).Trim()] = $l.Substring($i + 1).Trim() }
  }
}

function Mask([string]$s) {
  foreach ($k in @("NVR_PASS", "PUBLISH_PASS")) {
    if ($cfg[$k]) { $s = $s.Replace($cfg[$k], "*****") }
  }
  $s = $s -replace "pass=[^&\s'`"]+", "pass=*****"
  return ($s -replace "://([^:/@\s]+):[^@\s]+@", '://$1:*****@')
}

function Port([string]$h, [int]$p, [int]$ms = 3000) {
  if (-not $h) { return $false }
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $a = $c.BeginConnect($h, $p, $null, $null)
    if ($a.AsyncWaitHandle.WaitOne($ms) -and $c.Connected) { return $true }
    return $false
  } catch { return $false } finally { $c.Close() }
}

function Yes($b) { if ($b) { "yes" } else { "NO" } }

$problems = New-Object System.Collections.ArrayList
Write-Host ""
Write-Host "=== Padel VAR relay check   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')   PC $env:COMPUTERNAME"

# --- the PC ------------------------------------------------------------------
$os = Get-CimInstance Win32_OperatingSystem
if ($os) {
  $up = (Get-Date) - $os.LastBootUpTime
  Write-Host ("PC: up since {0:yyyy-MM-dd HH:mm} ({1}d {2}h {3}m)" -f $os.LastBootUpTime, $up.Days, $up.Hours, $up.Minutes)
}
$q = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join " "
$hex = [regex]::Matches($q, "0x[0-9a-fA-F]{8}") | ForEach-Object { $_.Value }
if ($hex.Count -ge 2) {
  $ac = [Convert]::ToInt32($hex[$hex.Count - 2], 16)
  if ($ac -eq 0) { Write-Host "PC: sleep on mains power: never (good)" }
  else {
    Write-Host "PC: sleep on mains power: after $([int]($ac / 60)) min"
    [void]$problems.Add("the PC goes to sleep after $([int]($ac / 60)) min, and the relay stops with it: powercfg /change standby-timeout-ac 0")
  }
}

# --- relay.env ---------------------------------------------------------------
if (-not (Test-Path $envFile)) {
  [void]$problems.Add("no relay.env next to this script ($envFile): README step 4")
} else {
  $missing = @("NVR_IP", "NVR_USER", "NVR_PASS", "SERVER", "PUBLISH_PASS", "CAMERAS") | Where-Object { -not $cfg[$_] }
  Write-Host "relay.env: NVR $($cfg['NVR_IP']) as $($cfg['NVR_USER']), server $($cfg['SERVER']), cameras $($cfg['CAMERAS'])"
  if ($missing) { [void]$problems.Add("relay.env lacks $($missing -join ', ')") }
}
$cams = @()
if ($cfg["CAMERAS"]) {
  foreach ($pair in $cfg["CAMERAS"].Split(",")) { $cams += $pair.Trim().Split(":")[0].Trim() }
}

# --- the relay task and its ffmpeg ------------------------------------------
$task = Get-ScheduledTask -TaskName "padel-relay"
if (-not $task) {
  [void]$problems.Add("there is no scheduled task padel-relay (README step 7)")
} else {
  $info = Get-ScheduledTaskInfo -TaskName "padel-relay"
  Write-Host "task padel-relay: $($task.State), last started $($info.LastRunTime), last result $($info.LastTaskResult)"
  if ($task.State -ne "Running") {
    [void]$problems.Add("the padel-relay task is not running ($($task.State)): Start-ScheduledTask -TaskName padel-relay")
    if ($info.LastTaskResult -eq 1) { [void]$problems.Add("last result 1 = SYSTEM cannot find ffmpeg: README step 1, the Copy-Item line") }
  }
}
$ff = @(Get-Process ffmpeg)
Write-Host "ffmpeg processes: $($ff.Count) (one per camera expected: $($cams.Count))"
if ($task -and $task.State -eq "Running" -and $ff.Count -lt $cams.Count) {
  [void]$problems.Add("the task runs but only $($ff.Count) of $($cams.Count) camera ffmpeg are up: see the camera logs below")
}

# --- networks ----------------------------------------------------------------
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" }
foreach ($ip in $ips) { Write-Host "network: $($ip.InterfaceAlias) $($ip.IPAddress)/$($ip.PrefixLength)" }
$wl = netsh wlan show interfaces
$ssid = ($wl | Select-String "^\s*SSID\s*:" | Select-Object -First 1)
$wstate = ($wl | Select-String "^\s*State\s*:" | Select-Object -First 1)
if ($wstate) { Write-Host "Wi-Fi: $(($wstate -split ':', 2)[1].Trim()) $(if ($ssid) { 'to ' + ($ssid -split ':', 2)[1].Trim() })" }
if (-not ($ips | Where-Object { $_.IPAddress -like "192.168.66.*" })) {
  [void]$problems.Add("this PC has no 192.168.66.x address: the NVR is reached only through that Wi-Fi (README step 3) -- is the Wi-Fi connected?")
}

# --- the NVR, the server, the internet --------------------------------------
$nvr554 = Port $cfg["NVR_IP"] 554
$nvr37777 = Port $cfg["NVR_IP"] 37777
Write-Host "NVR $($cfg['NVR_IP']): video port 554 $(Yes $nvr554), service port 37777 $(Yes $nvr37777)"
if (-not $nvr554) { [void]$problems.Add("the NVR does not answer at $($cfg['NVR_IP']):554 -- NVR off, its address changed, or this PC is off its network") }
$dns = $null
if ($cfg["SERVER"]) { $dns = [System.Net.Dns]::GetHostAddresses($cfg["SERVER"]) | Select-Object -First 1 }
$srv = Port $cfg["SERVER"] 1935
Write-Host "server $($cfg['SERVER']) -> $(if ($dns) { $dns.IPAddressToString } else { 'NAME NOT FOUND' }): camera port 1935 $(Yes $srv)"
$web = Port "1.1.1.1" 443
Write-Host "internet: $(Yes $web)"
if (-not $web) { [void]$problems.Add("no internet from this PC") }
elseif (-not $dns) { [void]$problems.Add("the server's name $($cfg['SERVER']) does not resolve (DNS)") }
elseif (-not $srv) { [void]$problems.Add("the server's camera port 1935 is not reachable from here (club firewall, or the server is down)") }

# --- each camera's log --------------------------------------------------------
foreach ($c in $cams) {
  $log = Join-Path $here "logs\$c.log"
  Write-Host ""
  if (-not (Test-Path $log)) { Write-Host "--- ${c}: no log yet ($log)"; continue }
  $lw = (Get-Item $log).LastWriteTime
  $lines = Get-Content $log -Tail 400
  $hour = (Get-Date).AddHours(-1)
  $starts = @($lines | Where-Object { $_ -match "^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\] starting ffmpeg" -and [datetime]$Matches[1] -gt $hour }).Count
  Write-Host "--- ${c}: log last written $($lw.ToString('yyyy-MM-dd HH:mm:ss')), ffmpeg (re)started $starts time(s) in the last hour"
  foreach ($l in ($lines | Select-Object -Last 8)) { Write-Host ("    " + (Mask $l)) }
  $tail = ($lines | Select-Object -Last 30) -join "`n"
  if ($starts -ge 10) {
    if ($tail -match "401|Unauthorized") { [void]$problems.Add("$c : the NVR refuses the login (NVR_USER / NVR_PASS)") }
    elseif ($tail -match "554|rtsp|Connection timed out|No route") { [void]$problems.Add("$c : ffmpeg cannot read the NVR (address, channel, or network)") }
    elseif ($tail -match "1935|rtmp|flv|Broken pipe|I/O error|Connection refused") { [void]$problems.Add("$c : the server drops the stream (PUBLISH_PASS, SERVER, or port 1935)") }
    else { [void]$problems.Add("$c : ffmpeg keeps restarting ($starts times in an hour): the log lines above say why") }
  }
}

# --- verdict -----------------------------------------------------------------
Write-Host ""
if ($problems.Count -eq 0) {
  Write-Host "VERDICT: nothing wrong on this PC. If the site still shows no stream, the server refuses it: its 'docker compose logs mediamtx' says why."
} else {
  Write-Host "VERDICT: $($problems.Count) problem(s):"
  foreach ($p in $problems) { Write-Host "  - $p" }
}
Write-Host ""
