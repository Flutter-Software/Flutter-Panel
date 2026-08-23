# Flutter

Self-hosted game-server control panel. **Flutter is the product name** — this is not Google Flutter / Dart, and it is not a fork of Pterodactyl or Pelican.

Stack: Next.js 15 dashboard, Hono API, MongoDB (Mongoose + Prisma), Redis, TypeScript daemon talking to the Docker Engine API.

## Install on Ubuntu 24.04

Use a **fresh Ubuntu 24.04** server with a public IPv4 address. The installer needs **root**. A hostname pointed at the server is required for HTTPS (Let's Encrypt will not issue a certificate for a raw IP).

Recommended: 2+ vCPU, 4+ GB RAM for the panel itself, plus whatever RAM and disk your game servers will use. Game containers share this host’s Docker Engine.

### 1. Point DNS (HTTPS)

Create an **A record** for your panel hostname (for example `panel.example.com`) to the server’s public IP, and wait until it resolves before requesting a certificate.

Open these ports if a firewall is already enabled: **22** (SSH), **80** and **443** (panel). Game allocations (for example **25565**) are not opened automatically — add them as you create servers.

### 2. Run the installer

```bash
apt-get update && apt-get install -y git
git clone https://github.com/Flutter-Software/Flutter-Panel.git /usr/local/src/flutter-panel
sudo bash /usr/local/src/flutter-panel/install/ubuntu-24.04.sh
```

The script asks for the public panel URL, whether to issue a Let's Encrypt certificate, and whether to install the game-node daemon on this machine. It then installs Docker, Node.js 22, MongoDB, Redis, nginx, and systemd units under `/opt/flutter`.

Non-interactive HTTPS example:

```bash
sudo FLUTTER_URL=https://panel.example.com FLUTTER_EMAIL=you@example.com \
  FLUTTER_LETSENCRYPT=1 bash /usr/local/src/flutter-panel/install/ubuntu-24.04.sh --yes
```

| Flag / env            | Meaning                                               |
| --------------------- | ----------------------------------------------------- |
| `--yes`               | Do not prompt; use flags and `FLUTTER_*` env vars     |
| `--url URL` / `FLUTTER_URL` | Public panel URL (`http://IP` or `https://hostname`) |
| `--letsencrypt` / `FLUTTER_LETSENCRYPT=1` | Issue a Let's Encrypt certificate (hostname required) |
| `--email EMAIL` / `FLUTTER_EMAIL` | Contact email for Let's Encrypt                  |
| `--no-nginx` / `FLUTTER_NO_NGINX=1` | Skip nginx; panel listens on port 3010         |
| `--no-daemon` / `FLUTTER_NO_DAEMON=1` | Panel only (attach a node later)             |
| `--prefix DIR` / `FLUTTER_PREFIX` | Install directory (default `/opt/flutter`)      |
| `--force`             | Allow distros other than Ubuntu 24.04                 |

Re-running the installer keeps an existing `/opt/flutter/.env` (secrets are not rotated) and refreshes `APP_URL` / `COOKIE_SECURE`.

### 3. What gets installed

| Path / unit                         | Role                                      |
| ----------------------------------- | ----------------------------------------- |
| `/opt/flutter`                      | Application (user `flutter`)              |
| `/opt/flutter/.env`                 | Secrets and URLs (mode `640`)             |
| `/var/lib/flutter`                  | Daemon data and game server files         |
| `flutter-api`                       | API on `127.0.0.1:4000`                   |
| `flutter-web`                       | Panel on `127.0.0.1:3010`                 |
| `flutter-daemon`                    | Node agent on `0.0.0.0:8080`              |
| nginx `sites-enabled/flutter`       | Public HTTP(S) → web + `/api/`            |
| Docker Compose (`mongo`, `redis`)   | Bound to localhost only                   |

Open the URL the installer prints and create the **first account** — that user is the admin.

```bash
systemctl status flutter-api flutter-web flutter-daemon
journalctl -u flutter-api -u flutter-web -u flutter-daemon -f
cd /opt/flutter && docker compose ps
```

### 4. Attach a game node

A node is **Online** only while the daemon is running and sending heartbeats (every 15s; offline after 120s). `daemon:configure` **only writes** `config.json` — it does not start the process.

**Same machine as the panel** (default installer choice): the script already creates a **Local** node, writes `/opt/flutter/apps/daemon/data/config.json`, and starts `flutter-daemon`. Create a location/allocations in Admin if you need extra ports, then create servers.

If the node is still **Offline**:

```bash
sudo systemctl enable --now flutter-daemon
sudo journalctl -u flutter-daemon -f
```

You should see heartbeat success. Then refresh Admin → Nodes.

**New node on this host** (or after `--no-daemon`): Admin → Locations → create a location, Admin → Nodes → create a node. Copy the full `flt_` token from the create screen or the Nodes clipboard button — do not paste the docs placeholder. Then:

```bash
cd /opt/flutter
sudo -u flutter npm run daemon:configure -- \
  --panel-url http://127.0.0.1:4000 \
  --token <flt_token> \
  --node <nodeId>
sudo systemctl enable --now flutter-daemon
# already running:
sudo systemctl restart flutter-daemon
```

`--panel-url http://127.0.0.1:4000` is correct **only when the daemon runs on the same host as the API**. systemd already points at `/opt/flutter/apps/daemon/data/config.json` and `/var/lib/flutter`.

**Remote node** (another Ubuntu 24.04 host with a public IP). Do **not** run the panel installer there. Create the node in Admin, copy the `flt_` token, then:

```bash
curl -fsSL https://raw.githubusercontent.com/Flutter-Software/Flutter-Panel/main/install/ubuntu-node.sh \
  | sudo bash -s -- \
    --panel-url https://panel.example.com \
    --token <flt_token> \
    --node <nodeId> \
    --listen-url http://<this-server-public-ip>:8080
```

That installs Docker, Node.js, and the daemon under `/opt/flutter-node` (data in `/var/lib/flutter`) and starts `flutter-daemon`. It does not install MongoDB, Redis, nginx, or the web UI.

`--listen-url` must be reachable from the **panel API host**, not `127.0.0.1`. Allow **8080/tcp** from the panel, plus each game allocation port on the node.

```bash
sudo systemctl status flutter-daemon
sudo journalctl -u flutter-daemon -f
```

To rewrite config later: `sudo flutter-node-configure --panel-url https://panel.example.com --token … --node … --listen-url http://<ip>:8080`

### 5. Updates and maintenance

In production, use **Admin → Settings → Updates** (or `sudo /usr/local/sbin/flutter-update`). That pulls the latest git, runs `npm ci`, rebuilds the panel, and restarts services. `.env` and daemon data are preserved.

Useful commands:

```bash
sudo /usr/local/sbin/flutter-restart
cd /opt/flutter && docker compose ps
```

After a deploy, hard-refresh the browser if the login page fails to load JS chunks.

### 6. Firewall and game ports

If UFW was already active, the installer opens SSH, 80/443 (or 3010 without nginx), and 8080 when the local daemon is installed. Publish game ports as you add allocations:

```bash
sudo ufw allow 25565/tcp
sudo ufw status
```

## Development

```bash
docker compose up -d          # Mongo replica set + Redis
npm install
npm run setup                 # writes .env secrets
npm run db:push               # Prisma schema → Mongo
npm run dev                   # API :4000 and panel :3010
```

Open [http://localhost:3010](http://localhost:3010). The first account is the admin.

### Attach a game node (local daemon)

1. Admin → Locations → create a location
2. Admin → Nodes → create a node (copy the `flt_` token, shown once)
3. Add allocations (`0.0.0.0` + `25565` is fine for local testing)
4. Configure and start the daemon:

```bash
npm run daemon:configure -- --panel-url http://127.0.0.1:4000 --token <flt_token> --node <nodeId>
npm run dev:daemon
```

The node turns **Online** after a heartbeat (every 15s; offline after 120s). Admin → Servers can then create a server (seeded **Generic / Sleep** egg uses `busybox:1.36`). Start/Stop on the dashboard talks to Docker via the daemon — never from the browser.

| Route            | What                                                       |
| ---------------- | ---------------------------------------------------------- |
| `/login`         | Sign in / first-admin setup                                |
| `/`              | Client dashboard (live servers)                            |
| `/admin`         | Locations, nodes, allocations, nests, eggs, servers, users |
| `/api/v1/health` | API health (Mongo + Prisma required; Redis reported)       |

Mongoose is the runtime ODM. Prisma owns `apps/api/prisma/schema.prisma` (types, `db push`, Studio). Both talk to the same MongoDB.

The daemon uses **dockerode** (Docker Engine API), not the Docker CLI. On Linux, mount `/var/run/docker.sock` into the daemon image (`apps/daemon/Dockerfile`).

Docker Desktop must be running for Compose and for local game containers.

## License

MIT. See `LICENSE`.
