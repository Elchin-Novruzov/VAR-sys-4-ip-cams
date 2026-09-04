# Padel VAR -- find the NVR when the quick scan (find-nvr.ps1) did not.
#
# Three passes, nothing is changed on any device:
#   1. ONVIF WS-Discovery: a multicast "who is there?" -- NVRs and cameras
#      answer with their address, web port and usually their model name.
#   2. Curated port check on every host in this PC's ARP table (the devices
#      that answered the ping sweep): ~40 ports NVRs and cameras commonly use.
#   3. Full sweep of ports 1-10000 on the hosts that showed nothing in pass 2
#      and have a real (non-randomised) hardware address.
# Then it fetches the web page title of every open web port so a device can be
# named (Dahua, Ruijie, Tenda, ...).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\padel-relay\find-nvr-deep.ps1
#
# Takes 2-8 minutes depending on how many hosts need the full sweep.
# Windows PowerShell 5.1 is enough.
param([string[]]$Hosts = @())

$ErrorActionPreference = "SilentlyContinue"

function Scan-Ports($ip, $ports, $waitMs) {
  # Fire up to 256 connection attempts at once, wait, keep the ones that connected.
  $open = @()
  for ($i = 0; $i -lt $ports.Count; $i += 256) {
    $end = [Math]::Min($i + 255, $ports.Count - 1)
    $pending = @()
    foreach ($p in $ports[$i..$end]) {
      $c = New-Object Net.Sockets.TcpClient
      try { $r = $c.BeginConnect($ip, [int]$p, $null, $null); $pending += ,@($c, $r, [int]$p) } catch { $c.Close() }
    }
    Start-Sleep -Milliseconds $waitMs
    foreach ($t in $pending) {
      try { if ($t[1].IsCompleted -and $t[0].Connected) { $open += $t[2] } } catch {}
      $t[0].Close()
    }
  }
  return $open
}

function Web-Title($ip, $port) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri "http://$ip`:$port/"
    $t = [regex]::Match($r.Content, "<title[^>]*>([^<]*)</title>", "IgnoreCase").Groups[1].Value.Trim()
    $srv = $r.Headers["Server"]
    if (-not $t -and $r.Content) { $t = ($r.Content -replace "<[^>]+>", " " -replace "\s+", " ").Trim() }
    if ($t.Length -gt 60) { $t = $t.Substring(0, 60) }
    return ("title='{0}' server='{1}'" -f $t, $srv)
  } catch {
    $m = $_.Exception.Message
    if ($m.Length -gt 60) { $m = $m.Substring(0, 60) }
    return "(no answer: $m)"
  }
}

# ---------------------------------------------------------------- pass 1: ONVIF
Write-Host "1) ONVIF discovery, listening 6 s ..."
$found = @{}
try {
  $udp = New-Object System.Net.Sockets.UdpClient
  $udp.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::Socket, [Net.Sockets.SocketOptionName]::ReuseAddress, $true)
  $udp.Client.Bind((New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)))
  $udp.Client.ReceiveTimeout = 1000
  $ep = New-Object Net.IPEndPoint([Net.IPAddress]::Parse("239.255.255.250"), 3702)
  foreach ($types in @("", "dn:NetworkVideoTransmitter")) {
    $id = [guid]::NewGuid().ToString()
    $typesXml = if ($types) { "<d:Types>$types</d:Types>" } else { "" }
    $probe = '<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:' + $id + '</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe>' + $typesXml + '</d:Probe></e:Body></e:Envelope>'
    $bytes = [Text.Encoding]::UTF8.GetBytes($probe)
    $udp.Send($bytes, $bytes.Length, $ep) | Out-Null
  }
  $deadline = (Get-Date).AddSeconds(6)
  while ((Get-Date) -lt $deadline) {
    try {
      $remote = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
      $data = $udp.Receive([ref]$remote)
      $xml = [Text.Encoding]::UTF8.GetString($data)
      $ip = $remote.Address.ToString()
      if (-not $found.ContainsKey($ip)) {
        $xaddrs = [regex]::Match($xml, "XAddrs>([^<]*)<").Groups[1].Value.Trim()
        $scopes = [regex]::Match($xml, "Scopes>([^<]*)<").Groups[1].Value
        $name = [uri]::UnescapeDataString([regex]::Match($scopes, "name/([^ ]*)").Groups[1].Value)
        $hw = [uri]::UnescapeDataString([regex]::Match($scopes, "hardware/([^ ]*)").Groups[1].Value)
        $found[$ip] = $xaddrs
        Write-Host ("  {0,-16} {1,-46} name={2} hardware={3}" -f $ip, $xaddrs, $name, $hw)
      }
    } catch {}
  }
  $udp.Close()
} catch { Write-Host "  (discovery failed: $($_.Exception.Message))" }
if ($found.Count -eq 0) { Write-Host "  nothing answered ONVIF discovery" }

# ------------------------------------------------ hosts: from ARP unless given
if ($Hosts.Count -eq 0) {
  $own = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
  $entries = @()
  foreach ($line in (arp -a)) {
    $m = [regex]::Match($line, "^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})\s")
    if (-not $m.Success) { continue }
    $ip = $m.Groups[1].Value; $mac = $m.Groups[2].Value.ToLower()
    if ($ip -eq $own -or $ip -like "*.255" -or $ip -like "224.*" -or $ip -like "239.*" -or $ip -eq "255.255.255.255" -or $mac -eq "ff-ff-ff-ff-ff-ff") { continue }
    $entries += [pscustomobject]@{ IP = $ip; MAC = $mac; Random = ($mac.Substring(1, 1) -match "[26ae]") }
  }
  $Hosts = $entries | ForEach-Object { $_.IP }
} else {
  $entries = $Hosts | ForEach-Object { [pscustomobject]@{ IP = $_; MAC = "?"; Random = $false } }
}

# ------------------------------------------------------- pass 2: curated ports
$curated = @(21, 22, 23, 80, 81, 82, 85, 88, 443, 554, 555, 1024, 1554, 2000, 3000, 3702, 5000, 5544, 6036, 7001, 7777, 8000, 8080, 8081, 8088, 8090, 8443, 8554, 8888, 9000, 9001, 9527, 9530, 34567, 34568, 37777, 37778, 37779, 40000, 50000)
Write-Host ""
Write-Host "2) common NVR/camera ports on $(@($entries).Count) host(s) ..."
$result = @{}
foreach ($e in $entries) {
  $open = Scan-Ports $e.IP $curated 400
  $result[$e.IP] = $open
  $tag = if ($e.Random) { "(phone/laptop?)" } else { "" }
  Write-Host ("  {0,-16} {1,-19} open: {2} {3}" -f $e.IP, $e.MAC, ($(if ($open) { ($open | Sort-Object) -join "," } else { "-" })), $tag)
}

# ------------------------------------------------------ pass 3: full 1-10000
$deep = @($entries | Where-Object { -not $_.Random -and @($result[$_.IP]).Count -eq 0 })
if ($deep) {
  Write-Host ""
  Write-Host "3) full sweep 1-10000 on $(@($deep).Count) silent host(s) with real hardware addresses (~20 s each) ..."
  foreach ($e in $deep) {
    $open = Scan-Ports $e.IP (1..10000) 500
    $result[$e.IP] = $open
    Write-Host ("  {0,-16} open: {1}" -f $e.IP, ($(if ($open) { ($open | Sort-Object) -join "," } else { "- (nothing at all)" })))
  }
}

# ------------------------------------------------------------ name the web ports
Write-Host ""
Write-Host "4) what the open web ports say about themselves:"
$webPorts = @(80, 81, 82, 85, 88, 8000, 8080, 8081, 8088, 8090, 8888, 9000, 7001)
foreach ($e in $entries) {
  foreach ($p in ($result[$e.IP] | Where-Object { $webPorts -contains $_ })) {
    Write-Host ("  http://{0}:{1,-6} {2}" -f $e.IP, $p, (Web-Title $e.IP $p))
  }
}

Write-Host ""
Write-Host "How to read this: the NVR is the host that answered ONVIF discovery with a name like NVR/DHI-NVR/XVR, or the"
Write-Host "host with port 37777 (Dahua) / 554 or a moved RTSP port (1554, 5544, 8554) / a web title mentioning Dahua or NVR."
Write-Host "Send this whole output."
