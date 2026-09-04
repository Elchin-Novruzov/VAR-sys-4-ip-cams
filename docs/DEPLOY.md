# Deploy on a VPS

One small server runs everything: the media server, the site, HTTPS.

## Size

- Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk. Four hours of two cameras at
  4 Mbps is about 14 GB; saved clips are small.
- A domain name with an A record pointing at the server (`var.yourclub.com`).
- Open inbound: 80, 443, 1935/tcp, 8890/udp. Nothing else.

## Steps

```bash
# on the server
curl -fsSL https://get.docker.com | sh
git clone <this repo> padel && cd padel/var-replay      # or copy the folder
cp infra/env.example .env && nano .env                  # DOMAIN, PUBLISH_PASS, MONGODB_URI (same server as the labeling site, database var-replay), AUTH_SECRET, AUTH_URL
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env logs -f
```

Random secrets: `openssl rand -hex 32`.

Create the first login from any machine that has `MONGODB_URI` in
`.env.local`:

```bash
pnpm seed-user you@club.com "Your Name" a-strong-password admin
```

Then open `https://DOMAIN`, sign in, and follow `docs/CAMERA_SETUP.md`.

## Existing reverse proxy on the host

If the VPS already runs Caddy (or nginx) on ports 80/443 for other sites, do
not start the bundled `caddy` service. Start only the media server and the
site, with the site on the host loopback:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.hostproxy.yml --env-file .env up -d --build mediamtx web
```

Then give the host Caddy one site block (`/etc/caddy/Caddyfile`), and make
sure its global options do not say `auto_https off` — that disables
certificate management for every site; `auto_https disable_redirects` keeps
certificates and only drops the HTTP→HTTPS redirect, which is what an
HTTP-only site on the same box usually wanted:

```
https://DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
```

`caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`.
Ports 80 and 443 must reach the host for the certificate to be issued.

No domain yet? `A-B-C-D.sslip.io` resolves to the IP `A.B.C.D` and gets a
normal certificate — e.g. `72-62-236-90.sslip.io`. Put that in `DOMAIN` and
`AUTH_URL` and move to a real name later by changing those two values and
the Caddy block.

## Prove the internet path before the club visit

From the office, point the simulator at the server:

```bash
SIM_RTMP_HOST=var.yourclub.com PUBLISH_PASS=<from .env> pnpm sim
```

The Courts page should show both fake cameras streaming within seconds and
replay should work a few seconds later.

## Operations

- Retention is `recordDeleteAfter` in `infra/mediamtx.yml`; keep
  `retentionHours` in `config/courts.json` equal to it.
- Every compose command on the host-proxy VPS needs **both** files — the
  hostproxy file is an overlay and alone it fails with "service web has
  neither an image nor a build context":

  ```bash
  cd /root/padel-var
  docker compose -f infra/docker-compose.yml -f infra/docker-compose.hostproxy.yml --env-file .env ps
  docker compose -f infra/docker-compose.yml -f infra/docker-compose.hostproxy.yml --env-file .env logs --tail 50 mediamtx
  git pull && docker compose -f infra/docker-compose.yml -f infra/docker-compose.hostproxy.yml --env-file .env up -d --build mediamtx web   # deploy a new version
  ```

- Add a court or camera: edit `config/courts.json` and add the paths under
  `paths:` in `infra/mediamtx.yml`, then the `up -d --build` line above.
- Logs: the `logs` line above shows publishers connecting and
  disconnecting (`is publishing to path 'court1-north'`).
- Backups: saved clips live in the `clips` volume; the recordings volume is
  a rolling buffer and needs none.
- Never expose ports 8888, 9996 or 9997; the site proxies them with
  authentication.
