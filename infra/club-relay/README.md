# Club-side relay (Windows PC on the club LAN)

What it is: one small script that pulls each court camera's main stream from
the club's Dahua NVR and pushes it to the VAR server. It is the "relay" option
in [docs/CAMERA_SETUP.md](../../docs/CAMERA_SETUP.md) §2c, packaged for a
Windows PC because that is what the club can give us access to (AnyDesk).

Why this and not the others, given what the club said on 2026-09-03:

- **No static IP** → the server cannot pull from the NVR (§2d is dead behind
  CGNAT). The connection has to be **outbound from the club**, which is what
  this does.
- **Dahua cameras** → the cameras *may* push RTMP themselves (§2a), but that
  depends on each camera's firmware having the menu, and means logging in to
  every camera. The relay needs only the NVR's address and password, which
  we have, and touches nothing on the cameras or the NVR.
- Cost: one PC that stays on and on the LAN, and ~8 Mbps of the club's
  upload for two cameras.

## Before the club session

The server side must exist first, or there is nothing to push to:
[docs/DEPLOY.md](../../docs/DEPLOY.md) — a VPS with MediaMTX running, a
domain, and port 1935 open. You need two values from its `.env`: `DOMAIN` and
`PUBLISH_PASS`. Prove the internet path from the office with `pnpm sim`
pointed at the server before touching the club.

## On the club PC, in order (as it actually worked on 2026-09-04)

Sit at the PC or AnyDesk into it. **Paste one line at a time** — multi-line
pastes into that PC's PowerShell console ran in reverse order, twice.

1. **ffmpeg.** Administrator PowerShell: `winget install Gyan.FFmpeg`, then a
   NEW window and `ffmpeg -version`. WinGet puts it on the *user's* PATH
   only, and the scheduled task below runs as SYSTEM, which cannot see that.
   So also, in the admin window:
   `Copy-Item (Get-Command ffmpeg).Source C:\Windows\ffmpeg.exe`
2. **Get the files** — they are not on the PC by themselves. `mkdir C:\padel-relay`, then one line per file:
   `Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/Elchin-Novruzov/VAR-sys-4-ip-cams/main/infra/club-relay/relay.ps1 -OutFile C:\padel-relay\relay.ps1`
   and the same for `relay.env.example` and `README.md`.
3. **Reach the NVR.** It is at `192.168.77.100`, reachable only through the
   PC's **Wi‑Fi** (192.168.66.x); the wired 192.168.88.x network does not
   route there, and `find-nvr.ps1` (which scans the wired subnet) will not
   find it. Check: `Test-NetConnection 192.168.77.100 -Port 37777` must say
   `TcpTestSucceeded : True`. Do **not** add a 192.168.77.x address to the
   Ethernet adapter — it steals the route from the working Wi‑Fi path.
4. **`relay.env`**: `copy C:\padel-relay\relay.env.example C:\padel-relay\relay.env`, `notepad C:\padel-relay\relay.env`, and fill in:

   ```
   NVR_IP=192.168.77.100
   NVR_USER=relay
   NVR_PASS=<the relay user's password>
   SERVER=72-62-236-90.sslip.io
   PUBLISH_PASS=<PUBLISH_PASS from /root/padel-var/.env on the server>
   CAMERAS=court1-north:2
   ```

5. **One camera:** `powershell -NoProfile -ExecutionPolicy Bypass -File C:\padel-relay\relay.ps1`.
   Within seconds the Courts page at https://72-62-236-90.sslip.io shows the
   north end streaming. If not: `notepad C:\padel-relay\logs\court1-north.log`
   — the last lines say whether the NVR refused (address, user, channel) or
   the server did (`SERVER`, `PUBLISH_PASS`, port 1935). A URL printed as
   `rtmp://…:1935/=cam&pass=…` (no path name) is the `$path?user` bug, fixed
   in this repo on 2026-09-04 — re-download `relay.ps1`.
6. **Both:** Ctrl+C, set `CAMERAS=court1-north:2,court1-south:8`, run again.
7. **Scheduled task, as SYSTEM** (the GUI route works too, but these are the
   lines that were used; one per paste, in an admin PowerShell):

   ```
   $a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\padel-relay\relay.ps1"
   $t = New-ScheduledTaskTrigger -AtStartup
   $t.Delay = "PT1M"
   $s = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   $p = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
   Register-ScheduledTask -TaskName "padel-relay" -Action $a -Trigger $t -Settings $s -Principal $p
   Start-ScheduledTask -TaskName "padel-relay"
   Get-ScheduledTaskInfo -TaskName "padel-relay"
   Get-Process ffmpeg
   ```

   `LastTaskResult` must be 0 and `Get-Process ffmpeg` must list one process
   per camera (session 0). `LastTaskResult 1` right after start means SYSTEM
   could not find ffmpeg — step 1's copy fixes it.
8. **Never sleep:** `powercfg /change standby-timeout-ac 0`, then
   `powercfg /change hibernate-timeout-ac 0`, then `powercfg /change disk-timeout-ac 0`.
9. **Reboot the PC** and do not log in. Within two minutes both ends are
   green on the Courts page. That is the test that counts.
10. **Record the facts** (camera doc §0 and §3): NVR address and channel map,
    encode settings as left, the club's upload speed, photos.

## Passwords

Default-style NVR passwords (admin/12345 and the like) get found by scanners in hours if the NVR is
ever exposed. It is not exposed by this design (nothing inbound), but still:
create a *viewer* account on the NVR for the relay and give `admin` a strong
password while you are there. `relay.env` is the only place the password
lives and it is gitignored.

## Stopping / changing

Stop: end the scheduled task, or `Get-Process ffmpeg | Stop-Process`. Change
a camera: edit `relay.env`, restart the task. Logs: `C:\padel-relay\logs\`.
