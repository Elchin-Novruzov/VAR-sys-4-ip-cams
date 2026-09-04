# Club visit checklist — get the two court cameras streaming to the VAR server

Date: 2026-09-04. Budget: about one hour at the club, most of it at the NVR
and the club PC. Everything here was prepared in the two AnyDesk sessions of
2026-09-03; what is left needs hands at the rack.

**The one-line version, as written before the visit:** the Dahua NVR that
records the cameras is not connected to the club network; plug its LAN port
into the switch, give it an address, then start the relay on the club PC. *That
premise was wrong — see the Outcome section right below; the steps under §3a
and §3b were never needed.*

---

## Outcome — what actually happened (written after the visit)

**Done.** Both court cameras stream to the VAR server and come back by
themselves after a cold reboot of the club PC with nobody logged in. The
current truth about the network, the channel map and the NVR settings is in
`CAMERA_SETUP.md` §0; the PC steps as they finally worked are in
`../infra/club-relay/README.md`. Where this checklist was wrong:

- **§3a/§3b were built on a wrong premise.** The NVR was never unplugged and
  has no PoE ports in play. It is a static 192.168.77.100 on a second network
  that the PC reaches over **Wi‑Fi** (192.168.66.x), not over its wired
  192.168.88.x port. Nothing at the rack was touched; no DHCP change.
- **The clock was right.** The "three weeks behind" came from an old photo.
- **The relay files were not on the PC** — only the scanners had been copied.
  They were fetched from the repo on the spot.
- **`relay.ps1` had a bug**: `$path?user` is one empty variable in PowerShell,
  so the publish URL had no path. Fixed on the PC and in the repo (`${path}`).
- **The scheduled task runs as SYSTEM**, created with PowerShell rather than
  the GUI, and SYSTEM cannot see WinGet's user-scoped PATH — ffmpeg was
  copied to `C:\Windows`.
- **Shutter:** channel 2 (north) set to 1/500 on the camera's own page;
  channel 8 (south) could not be reached from the PC and is still automatic.
- North = channel 2, south = channel 8. Fixed forever.

Server-side findings from the visit — the replay page showing "HTTP 502" for
a camera with no recording yet, the ⟲ buttons re-downloading a window on
every press, the compose command in the docs missing its base file — were
fixed in the repo the same evening (COMMIT_LOG).

---

## 0. What is already true (so you know what NOT to redo)

| thing | state |
|---|---|
| VAR server | live at https://72-62-236-90.sslip.io (your seeded login). MediaMTX listens on port 1935; the camera path was proved with the simulator. |
| club PC | Windows, wired at **192.168.88.137**. ffmpeg installed. Relay files in `C:\padel-relay\` (`relay.ps1`, `relay.env.example`, `README.md`, `find-nvr.ps1`, `find-nvr-deep.ps1`). AnyDesk works on it. |
| club network | router 192.168.88.1 (MikroTik), PoE switch 192.168.88.2 (Ruijie), access points .11–.13. Ten `28-36-13` devices are **face-recognition door terminals, not cameras**. |
| NVR | Dahua, nine channels on its screen (D1–D9). **The court cameras are D8 and D2** (one from each end). The NVR's own LAN port is not on the club network: nothing on the LAN answers on 554 / 37777 / ONVIF. Its clock is three weeks behind (shows 2026-08-13). |
| passwords | the NVR admin password is the one the club gave you. It is in the public repo's history, so it gets changed today (§3). The server's publish password is in `/root/padel-var/.env` on the VPS. |

---

## 1. Bring

- [ ] An **Ethernet cable** (NVR LAN port → a free port on the Ruijie switch). 2–3 m is enough if the switch is in the same rack; check the distance on arrival.
- [ ] A **USB mouse** for the NVR (one may already be attached — the green frame on channel D3 in your photo says so).
- [ ] Your **phone** (photos, and the two values below).
- [ ] Your **Mac** (optional — SSH to the server and Safari on the club Wi-Fi; it needs no Ethernet port).
- [ ] Optional for the in/out project: the **OV9281 camera + tripod** if you want the back-wall photos to become a short test recording (§8).

## 2. Before leaving the house (2 minutes)

- [ ] Copy the server's publish password to your phone:

  ```
  ssh root@72.62.236.90 "grep PUBLISH_PASS /root/padel-var/.env"
  ```

- [ ] Check the server is up (it dropped off for 40 minutes last night):

  ```
  ssh root@72.62.236.90 "docker ps --format '{{.Names}} {{.Status}}'"
  ```

  Both `mediamtx` and `web` must say `Up`. If not: `ssh root@72.62.236.90 "systemctl restart docker"`, wait a minute, check again, and open https://72-62-236-90.sslip.io in a browser.

---

## 3. At the rack — the NVR (15 minutes)

The NVR is the Dahua box whose monitor shows the 3×3 camera grid. It is **not** the AnyDesk PC.

### 3a. Cable

- [ ] Look at the back of the NVR. There is a row of PoE ports (the cameras plug in there) and, separate from them, **one LAN port** (sometimes two, labelled LAN1/LAN2 or "Network"). Use LAN1.
- [ ] Run the cable from that port to **any free port on the Ruijie switch** (192.168.88.2). If the switch is full, the router's spare LAN port is fine too.
- [ ] The port's link light on the NVR should come on. Photo of the back of the box.

### 3b. Address

- [ ] On the NVR screen: **right-click → Main Menu**. Log in as `admin` with the club's password.
- [ ] **NETWORK → TCP/IP**: tick **DHCP**, click **Apply**. After a few seconds the fields fill in with an address like `192.168.88.xxx`. **Write it down and photograph the screen.**
  - If DHCP gets nothing after a minute: set it by hand — IP `192.168.88.250`, subnet `255.255.255.0`, gateway `192.168.88.1`, DNS `192.168.88.1` — Apply. (Nothing on the LAN uses .250.)
- [ ] **NETWORK → Port** (or "Connection"): note the three numbers, normally TCP `37777`, HTTP `80`, RTSP `554`. Do not change them.

### 3c. Clock

- [ ] **NETWORK → NTP**: enable, server `pool.ntp.org`, Apply. Or **SYSTEM → General → Date & Time**: set today's date and time. The overlay on every recording carries this, so do it while you are in the menu.

### 3d. Passwords and a relay user

- [ ] **ACCOUNT → User**: **Modify** `admin` → new strong password. Type it into your phone's notes first, then into the NVR; there is no recovery except the reset button.
- [ ] **Add User**: name `relay`, a different strong password, group **user** (viewer), with live view and playback allowed on all channels. This is what goes into `relay.env`; the admin password never leaves the rack.

### 3e. Channels and cameras

- [ ] **CAMERA → Camera List**: photograph it. It shows, per channel, the camera's model, IP (the NVR's private PoE network, e.g. 10.1.1.x) and status. Confirm **D8 and D2 are the two court cameras** and decide which end is *north* — say it out loud once and keep it.

### 3f. Encoding of the two court channels

- [ ] **CAMERA → Encode**, select channel **8**, then **2**, *Main Stream*:
  - Compression **H.264** (not H.265, not "H.264+ / smart codec" — turn smart codec **off**)
  - Resolution: the camera's native (1920×1080 or whatever is offered highest)
  - Frame rate: **the highest offered** (25 or 30)
  - Bit rate type **CBR**, bit rate **4096 kb/s**
  - I-frame interval **= frame rate** (one keyframe per second)
  - Apply, then check the live view still looks fine.
- [ ] **CAMERA → Image / Exposure** for the same two channels: exposure mode **manual** (or "shutter priority"), shutter **1/500 s or faster**, gain auto. This is what makes the ball a dot instead of a streak. If the picture goes too dark, 1/250 is the compromise.
- [ ] Photo of each Encode screen as left.

---

## 4. On the club PC — the relay (20 minutes)

Sit at the PC, or AnyDesk into it from the Mac on the club Wi-Fi.

### 4a. The PC can now see the NVR

- [ ] PowerShell:

  ```
  powershell -ExecutionPolicy Bypass -File C:\padel-relay\find-nvr.ps1
  ```

  The NVR's address from §3b must appear with **554, 80 and 37777** open. If it does not, go back to §3a/§3b — nothing below works until this does.
- [ ] Also open `http://<NVR IP>` in the PC's browser (Edge/Chrome). The Dahua login page proves the address; log in as `relay` to prove the user.

### 4b. Configure

- [ ] In PowerShell:

  ```
  copy C:\padel-relay\relay.env.example C:\padel-relay\relay.env
  notepad C:\padel-relay\relay.env
  ```

- [ ] Fill in (no quotes, no spaces around `=`):

  ```
  NVR_IP=<the address from 3b>
  NVR_USER=relay
  NVR_PASS=<the relay user's password from 3d>
  SERVER=72-62-236-90.sslip.io
  PUBLISH_PASS=<the value from §2>
  CAMERAS=court1-north:8
  ```

  (Use `:2` instead if the end you called north is D2.) Save.

### 4c. One camera

- [ ] Run:

  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\padel-relay\relay.ps1
  ```

- [ ] Within about ten seconds https://72-62-236-90.sslip.io → Courts shows that camera **streaming**. Leave the PowerShell window open.
- [ ] If it does not: `notepad C:\padel-relay\logs\court1-north.log` and read the last lines — see §6.

### 4d. Both cameras

- [ ] Ctrl+C in the PowerShell window, edit `relay.env`:

  ```
  CAMERAS=court1-north:8,court1-south:2
  ```

  Run `relay.ps1` again. Both courts streaming on the site. Watch a rally on the site to make sure the picture is smooth; open a replay clip if a booking is running.

### 4e. Make it survive a reboot

- [ ] Task Scheduler → **Create Task** (not "Basic"):
  - General: name `padel-relay`; **Run whether user is logged on or not**; **Run with highest privileges**.
  - Triggers: **At startup**, delay **1 minute**.
  - Actions: program `powershell.exe`, arguments
    `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\padel-relay\relay.ps1`
  - Settings: **If the task fails, restart every 1 minute**, attempts 999; **untick** "Stop the task if it runs longer than".
  - OK, enter the Windows password of the PC's account.
- [ ] Close your PowerShell window (that kills your test copy), right-click the task → **Run**. Site shows both cameras again.
- [ ] **Restart the PC once.** After it is back, one to two minutes, the site shows both cameras without anyone logging in. That is the real test.
- [ ] Power settings: Control Panel → Power → **Never sleep**, never turn off hard disks. A PC that sleeps at night takes the cameras with it.

---

## 5. Record the facts (5 minutes)

- [ ] Camera models and firmware (from Camera List), the NVR model (sticker on the box), and the encode settings as left.
- [ ] The club's upload speed: on the PC, open speedtest.net. Two cameras at 4 Mbps need about 8–10 Mbps of upload with headroom. Below that, drop the bit rate to 3072 in §3f.
- [ ] Photos: both court cameras' positions on the court (where they hang, what they see), the NVR's front and back, the switch.
- [ ] Which physical end is *north* in `relay.env`.

---

## 6. If something fails

| symptom | cause | fix |
|---|---|---|
| `find-nvr.ps1` shows no NVR | cable in a PoE port instead of the LAN port; DHCP not applied; second LAN port used | §3a/§3b again; try LAN2 → LAN1; try the fixed address .250 |
| NVR web page opens but the relay log says **401 / authentication** | wrong `NVR_USER`/`NVR_PASS`, or the relay user lacks live-view rights | log in on the web page as `relay`; fix the account in §3d |
| log says **404 / stream not found** | wrong channel number | Camera List: channels are numbered 1–9 as on the grid (D8 → `8`) |
| log connects to the NVR but **server refused / timeout on 1935** | wrong `PUBLISH_PASS` or `SERVER`, or the club's firewall blocks outbound 1935 | re-copy the password from `/root/padel-var/.env`; on the server `cd /root/padel-var && docker compose -f infra/docker-compose.yml -f infra/docker-compose.hostproxy.yml --env-file .env logs --tail 50 mediamtx` shows the rejection (both compose files are needed: the hostproxy file is an overlay and alone it says "service web has neither an image nor a build context"); if the club's firewall blocks outbound 1935 (test from the PC: `Test-NetConnection 72-62-236-90.sslip.io -Port 1935`), tell me — moving the publish to port 443 is a server-side change (MediaMTX RTMPS or SRT), nothing to do at the club |
| streams start, then stutter or drop every few seconds | upload too small, or H.265 / smart codec still on | §3f; lower bit rate; speedtest |
| site shows "streaming" but the picture is a smear on fast balls | shutter still automatic | §3f exposure, 1/500 |
| PC reboots and nothing streams | task not set to run when logged off, or PC asleep | §4e |

Manual test of a channel from the PC, if you want to see the raw stream (fill in user, password, IP, channel):

```
ffplay -rtsp_transport tcp "rtsp://relay:PASSWORD@NVR_IP:554/cam/realmonitor?channel=8&subtype=0"
```

---

## 7. Before you leave the club

- [ ] Both courts show **streaming** on the site after a PC reboot (§4e).
- [ ] The NVR's clock is right (§3c).
- [ ] The admin password is changed and written down safely (§3d).
- [ ] You have the photos from §3 and §5 and the upload speed.
- [ ] Tell me the NVR address and the channel mapping (which end is north) so the docs match reality. Nothing else needs to leave the club.

---

## 8. In/out project — five minutes on the way out (optional but valuable)

The back-wall camera's ten remaining misses that no software reaches are all
the ball being barely visible near the floor at the far right of the frame.
That is a lighting question, and the club is the only place to answer it.

- [ ] From where the OV9281 stood (back wall, low), photos of: what is behind the glass (lights, windows, white walls), the ceiling lights above the court, the floor along the back wall in the far-right third of the frame.
- [ ] Note which lights were on and whether anything reflects in the glass at ball height.
- [ ] If you brought the OV9281: 10 minutes of play from the same spot with the lights as they are during evening bookings, and a phone video from the side line at the same time. That is the gate-2 test from `BACKWALL_CEILING.md`, and it needs nothing else.

---

## Next visit

Bring: the Ethernet cable and a **USB‑to‑Ethernet adapter** for the club PC,
your phone, the relay user's password (for the NVR menu you only need admin).

1. **Channel 8 shutter, at the rack monitor.** Right-click → Main Menu →
   CAMERA → Image → channel 8 → exposure *manual* or *shutter priority*,
   shutter **1/500** (same as channel 2). Then on the site, watch a fast ball
   on the south end: a dot, not a streak.
2. **Find the second router** (192.168.66.1 / 192.168.77.1). Follow the cable
   out of the Wi‑Fi access point the PC uses, or the NVR's LAN cable, to the
   box. Photograph it and its ports. Ask the club for **one free port** on it.
3. **Cable the PC to it** with the USB adapter, keeping the existing Ethernet
   on the MikroTik network. The adapter should get a 192.168.66.x or
   192.168.77.x address by DHCP. Then `Test-NetConnection 192.168.77.100 -Port 37777`
   over the new adapter (disconnect Wi‑Fi to be sure), and reboot once: both
   ends green with Wi‑Fi off. The relay no longer depends on a Wi‑Fi
   association.
4. **Upload speed** on the club PC: speedtest.net, note the number and the
   time of day. Two cameras at 4 Mbps need ~10 Mbps of upload with headroom.
5. **Channel 3**: on the NVR grid, what does it look at? If it is a third
   court camera, note it — it is the same model as 2 and 8.
6. **Health check** after a week of running: `Get-ScheduledTaskInfo -TaskName padel-relay`
   (LastTaskResult 0), `Get-Process ffmpeg` (two), and the size of
   `C:\padel-relay\logs\` — ffmpeg appends warnings for ever.
7. **Photos**: both court cameras where they hang and what they see, the
   rack, the NVR back panel, the second router.
8. **Replay test from the PC's Chrome**: the ⟲ 10/30/60 s buttons and frame
   stepping on both ends — separates the phone/cellular experience from the
   server.
9. **In/out, five minutes**: from where the back-wall camera stood, photos of
   what is behind the glass, the ceiling lights, and the floor along the back
   wall in the far-right third of the frame, with the evening-booking lights
   on (section 8 above).
