# Padel VAR -- find the NVR and cameras on the club LAN.
#
# Scans this PC's own /24 network for devices answering on 554 (RTSP: every
# camera and NVR), and tags the ones that also answer on 80 (web page) and
# 37777 (Dahua's own protocol -- a Dahua camera or NVR). Nothing is changed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\padel-relay\find-nvr.ps1
#
# Takes about a minute. Windows PowerShell 5.1 is enough.

$ErrorActionPreference = "SilentlyContinue"

function Test-Port($ip, $port, $ms) {
  $c = New-Object Net.Sockets.TcpClient
  try {
    $r = $c.BeginConnect($ip, $port, $null, $null)
    $ok = $r.AsyncWaitHandle.WaitOne($ms) -and $c.Connected
  } catch { $ok = $false }
  $c.Close()
  return $ok
}

# This PC's own IPv4 on the wired/wireless adapter (not link-local, not loopback).
$own = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $own) { Write-Host "Could not read this PC's IPv4 address. Run ipconfig and check the network cable."; exit 1 }
$net = ($own -split "\.")[0..2] -join "."
Write-Host "This PC is $own -- scanning $net.1 to $net.254 for RTSP (port 554) ..."
Write-Host ""

$found = @()
foreach ($i in 1..254) {
  $ip = "$net.$i"
  if (Test-Port $ip 554 300) {
    $web = Test-Port $ip 80 300
    $dahua = Test-Port $ip 37777 300
    $found += [pscustomobject]@{ IP = $ip; RTSP = "yes"; Web = $(if ($web) { "http://$ip" } else { "-" }); Dahua = $(if ($dahua) { "yes" } else { "-" }) }
    Write-Host ("  {0,-16} rtsp  web:{1,-22} dahua:{2}" -f $ip, $(if ($web) { "http://$ip" } else { "-" }), $(if ($dahua) { "yes" } else { "-" }))
  }
}

Write-Host ""
if ($found.Count -eq 0) {
  Write-Host "Nothing answered on port 554. Either the cameras/NVR are on a different network than this PC, or a firewall blocks them. Send this whole output."
} else {
  Write-Host "$($found.Count) device(s) speak RTSP. Open each 'web' address in Chrome and log in as admin:"
  Write-Host "the one that shows a CHANNEL LIST (several cameras) is the NVR; the others are the cameras themselves."
  Write-Host "Write down: the NVR's IP, and for each channel its number, camera model and IP (Camera -> Camera List)."
}
