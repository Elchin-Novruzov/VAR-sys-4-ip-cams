# Camera onboarding

Goal: each court camera pushes its **main stream** to the VAR server on its
own. Nothing else at the club changes; the NVR keeps recording as before.

Stream names (must match `config/courts.json` and `infra/mediamtx.yml`):

| camera | publish URL |
|---|---|
| north end | `rtmp://YOUR_DOMAIN:1935/court1-north?user=cam&pass=PUBLISH_PASS` |
| south end | `rtmp://YOUR_DOMAIN:1935/court1-south?user=cam&pass=PUBLISH_PASS` |

`PUBLISH_PASS` is the value in the server's `.env`.

## 0. The club as it actually is (visit of 2026-09-04)

What the club said on 2026-09-03 — **no static IP**, **Dahua cameras + a Dahua
NVR**, AnyDesk to a PC on the LAN — decided the design: nothing inbound can
reach the club, so the stream leaves it outbound, from a relay on the club PC
(§2c, `infra/club-relay/`). That is what runs now, and it survives a cold
reboot of the PC with nobody logged in. The two AnyDesk sessions before the
visit had built a wrong picture of the network ("an NVR with its LAN port
unplugged and the cameras on its PoE ports"); the visit replaced it with the
facts below. **Nothing at the rack was changed.**

**Two networks, and one PC on both.**

| | |
|---|---|
| club PC | `DESKTOP-DK4FDF8`, Windows 11, user `ASUS`. **Ethernet** (Intel I219-V) 192.168.88.137 on the MikroTik network — gateway .1, Ruijie PoE switch .2, the FaceGate door terminals. This network **cannot** reach the NVR. **Wi‑Fi** (Realtek 8851BE) 192.168.66.134, gateway 192.168.66.1 — this one **can**, one hop: 192.168.66.1 → 192.168.77.100. |
| NVR | Dahua, **static 192.168.77.100/24**, gateway 192.168.77.1, DHCP off, MAC 40:7a:a4:24:90:80. Ports 554 / 80 / 37777 open from the PC's Wi‑Fi. Web UI `http://192.168.77.100`. |
| cameras | standalone IP cameras on 192.168.77.x, added to the NVR as *remote devices* — not on NVR PoE ports. The PC can open them directly (`http://192.168.77.205` is channel 2). Channel 8 sits at 192.168.1.166, a subnet only the NVR reaches. |
| the box behind 192.168.66.1 / 192.168.77.1 | a second router, physically not yet identified. |

So the relay rides on the PC's **Wi‑Fi association** with the 192.168.66.x
network. That is the weak link until the PC is cabled to that router (next
visit). Do **not** give the PC's Ethernet adapter a 192.168.77.x address: the
on-link route hijacks traffic away from the working Wi‑Fi path (tried on the
visit, reverted). `find-nvr.ps1` scans the wired 192.168.88.x subnet and could
never have seen the NVR.

**Channels** (NVR → Remote Device → Added Device):

| ch | IP | model | role |
|---|---|---|---|
| 1 | 192.168.77.206 | Hikvision DS-2CD1321G2-LIU | ONVIF; the NVR cannot read its encode settings |
| **2** | 192.168.77.205 | DH-IPC-HFW2449T-AS-IL | **court camera — north** (`court1-north`) |
| 3 | 192.168.77.202 | DH-IPC-HFW2449T-AS-IL | same model, not a court camera — verify next visit |
| 4–7 | 192.168.77.200 / .201 / .203 / .204 | DH-IPC-HDW1439V-A-IL | other rooms |
| **8** | 192.168.1.166 | DH-IPC-HFW2449T-AS-IL | **court camera — south** (`court1-south`) |
| 9 | — | — | not photographed |

D2 and D8 are the two ends of the same court looking at each other. **North =
channel 2** (its far end looks toward the outdoor / greenery side); **south =
channel 8** (its far end looks into the lounge). This is baked into
`relay.env` — `CAMERAS=court1-north:2,court1-south:8` — and must never be
swapped.

**Changed on the NVR** (web UI from the club PC, as admin): a `relay` user
(group *user*, live view on all channels, search on all, password never
expires); the admin password replaced (the old one is in the public repo's
history and is dead); **H.265 Auto Switch off** on the Add Device page —
otherwise the NVR flips the cameras back to H.265; main stream of channels 2
and 8: encoding strategy *General*, **H.264, 2560×1440, 25 fps, CBR
4096 kb/s, I‑frame interval 25** (1080p was offered but 1440 stuck on the
first save; the bit-rate reference range 2816–6144 accepts 4096); sub streams
untouched (H.264 D1 512 kb/s). The NVR's *Image → Exposure* tab shows only 3D
NR for these cameras, so the shutter is set on the camera's own page (§1):
**channel 2 done** — 1/500 via `http://192.168.77.205` → Setting → Camera →
Conditions; **channel 8 not done** — 192.168.1.166 is unreachable from the PC,
it needs the NVR's local monitor menu (CAMERA → Image → ch8). The NVR clock
was already right (UTC+4); NTP left off.

**The relay** — `infra/club-relay/README.md` has the PC steps exactly as they
finally worked: `relay.env` with `NVR_IP=192.168.77.100`, `NVR_USER=relay`,
`SERVER=72-62-236-90.sslip.io`, `CAMERAS=court1-north:2,court1-south:8`;
scheduled task `padel-relay` running as SYSTEM at startup; ffmpeg where SYSTEM
can find it; sleep off. One bug was found on the spot and is fixed in
`relay.ps1` (`${path}` — see the script).

## 1. Encoding first, on both cameras

In the camera's own web page (browser on the club LAN, camera IP, admin login).

| setting | value | why |
|---|---|---|
| main stream codec | **H.264** | browsers play it without transcoding; RTMP carries it |
| Smart codec / H.264+ / H.265+ | **off** | they smear fast small objects |
| resolution | 1920×1080 (or the sensor's native) | zoom has something to work with |
| frame rate | **the highest the model offers** (25/30, some do 50/60) | every frame is a replay step |
| bitrate | **CBR, 4096 kbps** (6 to 8 Mbps if the uplink allows) | constant quality, predictable upload |
| I-frame interval | **= frame rate** (one second) | fast seeking, short recorder parts |
| exposure / shutter | **manual, 1/500 s or faster** | a moving ball is a dot, not a streak; auto shutter at night goes to 1/25 |
| WDR / BLC / noise reduction | off or low if the ball blurs | temporal filters smear motion |
| rule / IVS overlay on the stream | off | boxes drawn into the video cannot be removed later |

Check the club's **upload** speed: two cameras at 4 Mbps need about 8 Mbps
sustained. If the line is weaker, drop the bitrate to 3 Mbps before dropping
resolution or frame rate.

## 2a. Dahua cameras (RTMP push built in)

Most Dahua IP cameras with firmware from 2020 onward:

1. Setting → Network → **RTMP** (on some firmware: Network → Platform Access → RTMP).
2. Enable. Stream type: **Main stream**. Address type: **Custom**.
3. Address: the full publish URL from the table above.
4. Save. The camera connects within seconds.

Check on the server: `docker compose logs mediamtx` shows
`is publishing to path 'court1-north'`, and the Courts page shows the camera as
streaming.

If the menu is not there, update the camera firmware from Dahua's site, or use
the relay below.

## 2b. Hikvision cameras

Some models and firmware have RTMP under Configuration → Network → Advanced
Settings. If present, same values as above. Many do not; use the relay.

## 2c. Relay, if the camera cannot push

A Raspberry Pi 5 or any small PC in the rack, on the same switch as the
cameras, running one ffmpeg per camera. It pulls RTSP on the LAN and pushes
to the server; the club's firewall needs no change because the connection is
outbound.

```bash
# Dahua RTSP main stream: /cam/realmonitor?channel=1&subtype=0
# Hikvision:              /Streaming/Channels/101
ffmpeg -rtsp_transport tcp -i "rtsp://USER:PASS@CAMERA_IP:554/cam/realmonitor?channel=1&subtype=0" \
  -c copy -f flv "rtmp://YOUR_DOMAIN:1935/court1-north?user=cam&pass=PUBLISH_PASS"
```

Wrap it in a systemd unit with `Restart=always`. Over a weak uplink, publish
with SRT instead of RTMP: `-f mpegts "srt://YOUR_DOMAIN:8890?streamid=publish:court1-north:cam:PUBLISH_PASS&pkt_size=1316"`.

**Windows PC instead of a Pi:** `infra/club-relay/` — `relay.ps1` +
`relay.env` + a scheduled task. Pulls from the **NVR** (one address, one
password, channel numbers) rather than from each camera, so no camera login
is needed. Its README is the step-by-step for the AnyDesk session.

## 2d. Server pulls from the NVR (no camera changes at all)

The reverse direction: instead of cameras pushing out, the VAR server pulls
RTSP from the club's NVR. MediaMTX supports it per path — in
`infra/mediamtx.yml`, replace `source: publisher` (the pathDefaults) with an
explicit source on each court path:

```yaml
paths:
  court1-north:
    source: rtsp://USER:PASS@CLUB_IP:554/cam/realmonitor?channel=1&subtype=0
  court1-south:
    source: rtsp://USER:PASS@CLUB_IP:554/cam/realmonitor?channel=2&subtype=0
```

(That URL shape is Dahua NVR; the channel numbers come from the NVR's camera
list. Recording, replay and clips are unchanged.)

What it needs from the club — and why push is still plan A:

1. A **static public IP** from the ISP (or DDNS), and the line must **not be
   behind CGNAT** — behind CGNAT, port forwarding is impossible and pull is
   dead on arrival. Ask the ISP this question first.
2. A **port forward** on the club router: an external port → NVR IP:554.
3. An **NVR viewer account** with a strong password, and the two channel
   numbers.
4. The router firewall restricted so **only the VAR server's IP** may reach
   the forwarded port. An openly exposed NVR port gets scanned and
   brute-forced within hours.

The encoding table in section 1 still applies — the NVR serves whatever the
cameras encode, so H.264 / frame rate / shutter must still be set on the
cameras (or via the NVR's per-channel encode page).

## 3. Facts to record while there

- camera brand, model, firmware
- resolution, frame rate, codec, bitrate as set
- the club's upload speed
- photos of both camera positions
