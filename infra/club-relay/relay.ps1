# Padel VAR -- club-side relay.
#
# Runs on any Windows PC on the club LAN (the one reachable over AnyDesk).
# For each camera it pulls the main stream from the NVR over RTSP and pushes it
# to the VAR server over RTMP. The connection is OUTBOUND, so it works behind
# CGNAT with no static IP and no router change. One ffmpeg per camera,
# restarted for ever; nothing on the cameras or the NVR is modified.
#
# Configuration is read from relay.env next to this file (copy
# relay.env.example). Logs go to .\logs\<path>.log.
#
# Run by hand:      powershell -NoProfile -ExecutionPolicy Bypass -File relay.ps1
# Run at logon:     see README.md (Task Scheduler)
# Windows PowerShell 5.1 is enough; no modules needed.

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here "relay.env"

if (-not (Test-Path $envFile)) {
  Write-Host "relay.env not found next to relay.ps1 -- copy relay.env.example to relay.env and fill it in."
  exit 1
}

# --- read relay.env (KEY=VALUE lines, # comments) -----------------------------
$cfg = @{}
foreach ($raw in Get-Content $envFile) {
  $line = $raw.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { continue }
  $i = $line.IndexOf("=")
  if ($i -lt 1) { continue }
  $cfg[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
}
foreach ($k in @("NVR_IP", "NVR_USER", "NVR_PASS", "SERVER", "PUBLISH_PASS", "CAMERAS")) {
  if (-not $cfg[$k]) { Write-Host "relay.env: $k is missing"; exit 1 }
}

# --- ffmpeg ------------------------------------------------------------------
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  Write-Host "ffmpeg is not on PATH. Install it with:  winget install Gyan.FFmpeg"
  Write-Host "then open a NEW PowerShell window and run this script again."
  exit 1
}

$logDir = Join-Path $here "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# --- one background job per camera ------------------------------------------
# CAMERAS = court1-north:1,court1-south:2   (server path : NVR channel number)
$jobs = @()
foreach ($pair in $cfg["CAMERAS"].Split(",")) {
  $parts = $pair.Trim().Split(":")
  if ($parts.Count -ne 2) { Write-Host "CAMERAS entry '$pair' must look like court1-north:1"; exit 1 }
  $path = $parts[0].Trim()
  $ch = $parts[1].Trim()
  # Dahua NVR main stream for channel N. subtype=0 is the main stream; the
  # sub stream (subtype=1) is low resolution and useless for replay.
  $src = "rtsp://$($cfg['NVR_USER']):$($cfg['NVR_PASS'])@$($cfg['NVR_IP']):554/cam/realmonitor?channel=${ch}&subtype=0"
  # ${path} with braces: in PowerShell `?` is a legal variable-name character,
  # so "$path?user" is read as one (empty) variable and the URL comes out as
  # "rtmp://server:1935/=cam&pass=..." -- ffmpeg then exits -5 for ever. Found
  # at the club on 2026-09-04.
  $dst = "rtmp://$($cfg['SERVER']):1935/${path}?user=cam&pass=$($cfg['PUBLISH_PASS'])"
  $log = Join-Path $logDir "$path.log"

  $jobs += Start-Job -Name $path -ArgumentList $src, $dst, $log, $path -ScriptBlock {
    param($src, $dst, $log, $path)
    while ($true) {
      $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
      Add-Content -Path $log -Value "[$t] starting ffmpeg for $path"
      $err = "$log.run"
      # -c copy: no re-encoding, the camera's own H.264 goes through untouched.
      # -rtsp_transport tcp: no UDP packet loss on the LAN.
      $p = Start-Process -FilePath "ffmpeg" -NoNewWindow -Wait -PassThru `
        -RedirectStandardError $err `
        -ArgumentList @("-hide_banner", "-loglevel", "warning", "-nostdin",
                        "-rtsp_transport", "tcp", "-i", $src,
                        "-c", "copy", "-f", "flv", $dst)
      if (Test-Path $err) { Get-Content $err | Add-Content -Path $log; Remove-Item $err -Force }
      $t = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
      Add-Content -Path $log -Value "[$t] ffmpeg exited with code $($p.ExitCode); restarting in 3 s"
      Start-Sleep -Seconds 3
    }
  }
  Write-Host "[$path] NVR $($cfg['NVR_IP']) channel $ch  ->  rtmp://$($cfg['SERVER']):1935/$path   (log: $log)"
}

Write-Host ""
Write-Host "Relay running with $($jobs.Count) camera(s). Leave this window open, or install the scheduled task (README.md)."
Write-Host "Check on the server: the Courts page shows the cameras as streaming; 'docker compose logs mediamtx' shows 'is publishing to path'."
Write-Host "Press Ctrl+C to stop."

try {
  while ($true) {
    Receive-Job -Job $jobs | Out-Null
    Start-Sleep -Seconds 5
  }
} finally {
  $jobs | Stop-Job -ErrorAction SilentlyContinue
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  Get-Process ffmpeg -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
