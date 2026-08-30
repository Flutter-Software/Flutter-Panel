# Flutter installers

Run these as **root** on Ubuntu. Pick one script — do not stack the panel installer and the node installer on the same machine unless you know you want a combined panel+daemon host.

| Script | Run this on | What it installs |
| ------ | ----------- | ---------------- |
| [`ubuntu-24.04.sh`](ubuntu-24.04.sh) | The panel server (public IP + DNS) | Web, API, MongoDB, Redis, nginx, optional local daemon |
| [`ubuntu-node.sh`](ubuntu-node.sh) | A second machine **with a public IP** | Docker + daemon only (`/opt/flutter-node`) |
| [`connect-home-node.sh`](connect-home-node.sh) | A home PC, WSL, or anything **without** a public IP | Same daemon, plus a Cloudflare quick tunnel so the panel can reach port 8080 |
| [`wipe-local.sh`](wipe-local.sh) | A test box you want to reset | Full wipe, or `--daemon-only` to remove the game node on this Linux host |
| [`wipe-pterodactyl.sh`](wipe-pterodactyl.sh) | A host that still has Pterodactyl or Pelican | Force-remove Wings, panel, Docker game containers, and port bindings (8080 / 2022) |

**Panel walkthrough** (DNS, Let's Encrypt, first admin): [../README.md](../README.md).

**Game node walkthrough** (create the node in the UI, then attach a VPS or a home machine): [REMOTE_NODE.md](REMOTE_NODE.md).

## Which node script?

```
Does this Ubuntu host have a public IPv4 the panel can open on port 8080?
  yes →  ubuntu-node.sh      --listen-url http://THIS_IP:8080
  no  →  connect-home-node.sh   (Cloudflare tunnel; no listen-url needed)
```

Never run `ubuntu-24.04.sh` on a game-only machine. That installer is the panel.

## Run from this repo

These scripts are in `install/` of the Flutter Panel checkout. Copy or clone the repo onto the Ubuntu host, then:

```bash
cd /path/to/Flutter-Panel
# If you copied the files from Windows, strip CR so bash does not choke:
sed -i 's/\r$//' install/*.sh
sudo bash install/ubuntu-node.sh --help
sudo bash install/connect-home-node.sh --help
```

## Hosted panel

If the panel is already at `https://panel.flutter.software`, create a node in **Admin → Nodes**, then on the Ubuntu machine:

```bash
sudo bash install/connect-home-node.sh \
  --panel-url https://panel.flutter.software \
  --token flt_PASTE_THE_TOKEN \
  --node PASTE_THE_NODE_ID
```

Use `ubuntu-node.sh` instead when that Ubuntu machine has a public IP (see [REMOTE_NODE.md](REMOTE_NODE.md)).

To remove the daemon from this Linux host and start over:

```bash
sudo bash install/wipe-local.sh --yes --daemon-only
```

## Coming from Pterodactyl

Wings owns **8080** (same port as the Flutter daemon) and Docker game-port bindings. Wipe it before installing Flutter:

```bash
sudo bash install/wipe-pterodactyl.sh --yes
```

That stops Wings and `pteroq`, force-deletes Pterodactyl/Pelican containers and the `pterodactyl_nw` network, removes nginx panel sites, and deletes `/var/www/pterodactyl` and `/etc/pterodactyl`. Docker Engine and nginx stay installed.

| Flag | Meaning |
| ---- | ------- |
| `--wings-only` | Remove Wings + game containers; leave the PHP panel files |
| `--keep-data` | Leave `/var/lib/pterodactyl` (server files) |
| `--drop-db` | Drop the panel MySQL/MariaDB database and user |
| `--purge-php` | `apt-get purge` PHP and composer |
| `--wipe-certs` | Delete Let's Encrypt certs whose name contains ptero/pelican |
