# Flutter

Self-hosted game-server control panel. **Flutter is the product name** — this is not Google Flutter / Dart, and it is not a fork of Pterodactyl or Pelican.

Stack: Next.js 15 dashboard, Hono API, MongoDB (Mongoose + Prisma), Redis, TypeScript daemon talking to the Docker Engine API.

## Quick start

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
npm run daemon:configure -- --panel-url http://127.0.0.1:4000 --token flt_… --node <nodeId>
npm run dev:daemon
```

The node turns **Online** after a heartbeat (every 15s; offline after 120s). Admin → Servers can then create a server (seeded **Generic / Sleep** egg uses `busybox:1.36`). Start/Stop on the dashboard talks to Docker via the daemon — never from the browser.

| Route | What |
| --- | --- |
| `/login` | Sign in / first-admin setup |
| `/` | Client dashboard (live servers) |
| `/admin` | Locations, nodes, allocations, nests, eggs, servers, users |
| `/api/v1/health` | API health (Mongo + Prisma required; Redis reported) |

Mongoose is the runtime ODM. Prisma owns `apps/api/prisma/schema.prisma` (types, `db push`, Studio). Both talk to the same MongoDB.

The daemon uses **dockerode** (Docker Engine API), not the Docker CLI. On Linux, mount `/var/run/docker.sock` into the daemon image (`apps/daemon/Dockerfile`).

Docker Desktop must be running for Compose and for local game containers.

## License

MIT. See `LICENSE`.
