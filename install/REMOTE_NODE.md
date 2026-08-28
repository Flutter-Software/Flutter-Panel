# Attach a game node

Use this when the **panel is already running** (your own Ubuntu install, or a hosted panel such as `https://panel.flutter.software`) and you want **another Ubuntu machine** to run game servers.

Do **not** run `install/ubuntu-24.04.sh` on the game machine. That script is the panel.

```
Panel host          web + API + Mongo + Redis
                    https://panel.example.com

Game node           Docker + Flutter daemon only
                    game containers live here
```

The daemon **phones home** to the panel (heartbeat every 15s). The panel then calls the daemon on port **8080** to start/stop servers, stream console, and manage files. The panel must be able to open the URL you give as `--listen-url`.

## Pick a path

| This Ubuntu machine | Script |
| ------------------- | ------ |
| VPS / dedicated with a **public IPv4** | [Path A](#path-a-vps-with-a-public-ip) — `ubuntu-node.sh` |
| Home LAN, CGNAT, or **WSL** (no public IP) | [Path B](#path-b-home-pc-wsl-or-nat) — `connect-home-node.sh` |

Same first step for both: create the node in the panel UI.

## 1. Create the node in the panel

1. Sign in as admin.
2. **Admin → Locations** → create a location if you do not have one (for example `home` or `us-east`).
3. **Admin → Nodes → New node**.
   - **Name:** something like `node-02` or `dylans-pc`
   - **FQDN:** the machine’s hostname or public IP (for a home/WSL node any label is fine)
   - **Scheme:** `http` unless you put TLS in front of the daemon yourself
   - Set memory, disk, and CPU to match the machine
4. Save. Copy and keep:
   - the **node id** (24-character hex)
   - the full **`flt_…` token** (shown once — use the clipboard button, not a truncated preview)

You will add **Allocations** (the IP/ports players connect to) after the node is Online.

## Path A: VPS with a public IP

### What you need

- Fresh Ubuntu 24.04, root SSH
- Public IPv4
- Port **8080/tcp** reachable **from the panel host**
- Game ports you will allocate (for example **25565/tcp**) open to the internet

### Install

On the game machine:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/Flutter-Software/Flutter-Panel.git /usr/local/src/flutter-panel
cd /usr/local/src/flutter-panel

sudo bash install/ubuntu-node.sh --yes \
  --panel-url https://panel.example.com \
  --token flt_PASTE_THE_TOKEN \
  --node PASTE_THE_NODE_ID \
  --listen-url http://THIS_SERVER_PUBLIC_IP:8080
```

If you already have the repo (for example a copy from Windows), `cd` into it instead of cloning, then:

```bash
sed -i 's/\r$//' install/*.sh
sudo bash install/ubuntu-node.sh --yes --force \
  --panel-url https://panel.example.com \
  --token flt_PASTE_THE_TOKEN \
  --node PASTE_THE_NODE_ID \
  --listen-url http://THIS_SERVER_PUBLIC_IP:8080
```

`--force` is required on anything that is not Ubuntu 24.04 (including some WSL images).

Replace:

| Placeholder | Value |
| ----------- | ----- |
| `https://panel.example.com` | The URL you open in the browser (or `https://panel.flutter.software`) |
| `flt_PASTE_THE_TOKEN` | Token from step 1 |
| `PASTE_THE_NODE_ID` | Node id from step 1 |
| `THIS_SERVER_PUBLIC_IP` | Public IPv4 of **this** machine, not the panel |

`--listen-url` must be an address **the panel can open**. Never use `127.0.0.1` or `localhost` here.

The script installs Docker, Node.js 22, and the daemon under `/opt/flutter-node`. It does **not** install MongoDB, Redis, nginx, or the panel UI.

### Firewall

```bash
# daemon: panel → this node
sudo ufw allow from PANEL_PUBLIC_IP to any port 8080 proto tcp
# example Minecraft port (repeat per allocation)
sudo ufw allow 25565/tcp
sudo ufw enable
sudo ufw status
```

If UFW is off, open the same ports on the cloud security group.

Then skip to [Confirm it is online](#3-confirm-it-is-online).

### `ubuntu-node.sh` flags

| Flag | Meaning |
| ---- | ------- |
| `--panel-url URL` | Public panel URL |
| `--token TOKEN` | `flt_…` token from Admin → Nodes |
| `--node ID` | Node id from Admin → Nodes |
| `--listen-url URL` | URL the panel uses to reach this daemon |
| `--port PORT` | Daemon listen port (default `8080`) |
| `--host HOST` | Bind address (default `0.0.0.0`) |
| `--prefix DIR` | Install directory (default `/opt/flutter-node`) |
| `--data-dir DIR` | Game files (default `/var/lib/flutter`) |
| `--yes` | Do not prompt |
| `--force` | Allow distros other than Ubuntu 24.04 |
| `--skip-configure` | Install only; configure later with `flutter-node-configure` |

## Path B: Home PC, WSL, or NAT

Use this when the panel **cannot** open `http://YOUR_IP:8080` (residential NAT, CGNAT, or WSL with no public address). The script installs the same daemon, then publishes 8080 through a **Cloudflare quick tunnel**.

Heartbeat still goes **daemon → panel**. Start/stop/files/console go **panel → tunnel URL → daemon**.

### What you need

- Ubuntu with **systemd** (plain Ubuntu 24.04, or WSL with systemd enabled)
- **Docker running** (on WSL: Docker Desktop → Settings → Resources → WSL integration for this distro)
- Root (`sudo`)
- The Flutter Panel repo on that Ubuntu host
- Port **8080 free** on the Ubuntu side — stop Windows `npm run dev:daemon` if it is bound to the same port

Game ports (25565 and so on) still need to be reachable by players. The tunnel only exposes the **daemon API**, not Minecraft/Steam. For players on the internet you still need port forwards or a separate public host. For LAN play, allocate the LAN IP.

### WSL notes

1. Open Ubuntu as root or use `sudo`.
2. Enable Docker Desktop WSL integration, then `docker info` should work inside Ubuntu.
3. If the checkout lives on the Windows drive, `cd` into it and strip Windows line endings **every time you copy/edit the scripts from Windows**:

```bash
cd "/mnt/c/Users/YOU/path/to/Flutter Panel"
sed -i 's/\r$//' install/*.sh
```

4. Leave the Windows panel `npm run dev` / `npm run dev:daemon` **stopped** on this machine so they do not fight the Ubuntu daemon for port 8080.

### Install

```bash
cd /path/to/Flutter-Panel
sed -i 's/\r$//' install/*.sh

sudo bash install/connect-home-node.sh \
  --panel-url https://panel.example.com \
  --token flt_PASTE_THE_TOKEN \
  --node PASTE_THE_NODE_ID
```

`--panel-url` defaults to `https://panel.flutter.software` if you omit it.

The script will:

1. Run `ubuntu-node.sh` (daemon only, no panel)
2. Install `cloudflared` if needed
3. Start `flutter-node-tunnel.service`
4. Wait for a `https://….trycloudflare.com` URL
5. Write daemon config with that URL as `--listen-url`
6. Enable and start `flutter-daemon`

A successful run prints the node id, the tunnel URL, and `systemctl status flutter-daemon`.

### After a reboot

A Cloudflare **quick tunnel URL changes** when `flutter-node-tunnel` restarts. If the node goes Offline after a reboot, run the same `connect-home-node.sh` command again so the panel gets the new URL.

For a stable URL, use a named Cloudflare tunnel, Tailscale, or Path A with a public IP, and pass `--listen-url` / `--no-tunnel`.

### `connect-home-node.sh` flags

| Flag | Meaning |
| ---- | ------- |
| `--token TOKEN` | `flt_…` token (required) |
| `--node ID` | Node id (required) |
| `--panel-url URL` | Panel URL (default `https://panel.flutter.software`) |
| `--listen-url URL` | Skip Cloudflare; use this URL (public IP or Tailscale) |
| `--no-tunnel` | Do not start Cloudflare; you must pass `--listen-url` |
| `--port PORT` | Daemon port (default `8080`) |

## 3. Confirm it is online

On the game machine:

```bash
systemctl status flutter-daemon
journalctl -u flutter-daemon -f
```

You should see a successful heartbeat. In the panel, **Admin → Nodes** should show **Online** within about 15 seconds (Offline after 120s without a heartbeat).

Then:

1. **Admin → Nodes → [this node] → Allocations** — add the IP and ports **players** should use (the VPS public IP, or your LAN IP for local play).
2. **Admin → Servers → New server** — pick this node and one of those allocations.

## Rewrite config without reinstalling

```bash
sudo flutter-node-configure \
  --panel-url https://panel.example.com \
  --token flt_PASTE_THE_TOKEN \
  --node PASTE_THE_NODE_ID \
  --listen-url http://THIS_SERVER_PUBLIC_IP:8080
sudo systemctl restart flutter-daemon
```

On a home/WSL node it is usually easier to re-run `connect-home-node.sh` so the tunnel URL is refreshed.

## If something is offline

| Symptom | What to check |
| ------- | ------------- |
| Node stays Offline | `journalctl -u flutter-daemon -e` — token, node id, and `--panel-url` must match the panel |
| Heartbeat OK, start/console fail | Panel cannot reach `--listen-url`. From the **panel** host: `curl -sS http://NODE_IP:8080/health` (or the `trycloudflare.com` URL) |
| `flt_` token rejected | Copy the full token from the create screen or the Nodes clipboard button |
| `flutter-node-configure is missing` | Daemon install did not finish. Scroll up for the `ubuntu-node` error and re-run the same connect/install command |
| `rsync: mkdir .../packages/shared failed` | Use the current `install/ubuntu-node.sh` from this repo (it creates that directory) |
| Docker is not running | On WSL: Docker Desktop → WSL integration. Then `docker info` inside Ubuntu |
| Port 8080 in use | Stop Windows `npm run dev:daemon` / any other Flutter daemon on this machine |
| Wrong machine | You ran `ubuntu-24.04.sh` on the game host. Wipe it ([below](#wipe-a-test-install)); only `ubuntu-node.sh` or `connect-home-node.sh` belongs there |
| Scripts fail with `$'\r': command not found` | `sed -i 's/\r$//' install/*.sh` then retry |

## Wipe a test install

Does not uninstall Docker, Node.js, nginx, or cloudflared packages.

**Daemon only** (this Linux/WSL game node — leaves a panel on the same machine alone):

```bash
sudo bash install/wipe-local.sh --yes --daemon-only
```

**Everything on this machine** (panel + daemon + game data):

```bash
sudo bash install/wipe-local.sh --yes
```

| Flag | Meaning |
| ---- | ------- |
| `--yes` | Do not prompt (otherwise type `wipe`) |
| `--daemon-only` / `--node-only` | Remove the game-node daemon, tunnel, `/opt/flutter-node`, and game data |
| `--keep-data` | Leave `/var/lib/flutter` |
| `--keep-user` | Leave the `flutter` system user |
| `--wipe-certs` | Delete Let's Encrypt certs whose name contains `flutter` (full wipe only) |
| `--keep-src` | Leave `/usr/local/src/flutter-panel` |

Do **not** run a full wipe on a production panel unless you intend to destroy it.
