# Self-hosting with Docker

Most people can simply use the [browser edition](https://reinder83.github.io/satisfactory-planner/). Run your own server when you want saves stored on a machine you control, shared between devices, or separate accounts for several people.

## Install

The image is **ghcr.io/reinder83/satisfactory-planner:latest**, available for AMD64 and ARM64. It is public, so pulling it needs no GitHub account. Clone this repository on your Docker host, enter the directory, then:

```sh
docker compose pull
docker compose up -d
```

Open **http://localhost:8080**. To update later, run both commands again.

Optionally copy [.env.example](../.env.example) to `.env`. For LAN access, set `BIND_ADDRESS=0.0.0.0`, then visit `http://HOST-IP:8080`. For public internet access use an HTTPS reverse proxy and set `COOKIE_SECURE=true`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BIND_ADDRESS` | `127.0.0.1` | Host address the port is published on; `0.0.0.0` serves other devices on your network |
| `PORT` | `8080` | Host port |
| `PUID` / `PGID` | `1000` / `1000` | User and group that own the data folder |
| `TZ` | `Etc/UTC` | Timezone for server-side dates |
| `APP_USER` / `APP_PASSWORD` | `pioneer` / empty | Optional host-wide Basic Auth gate; set a password before exposing the planner beyond your own machine |
| `COOKIE_SECURE` | `false` | Set `true` behind an HTTPS reverse proxy when using accounts |

To build the image yourself from this repository instead of pulling it:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

## Custom user IDs and data folder permissions

The image supports `PUID`, `PGID` (default 1000:1000), and `TZ`. Set them to the numeric user and group IDs that own the data folder on your host, for example:

```yaml
services:
  planner:
    image: ghcr.io/reinder83/satisfactory-planner:latest
    restart: unless-stopped
    ports:
      - '8888:8080'
    environment:
      PUID: '1028'
      PGID: '100'
      TZ: Europe/Amsterdam
    volumes:
      - ./data:/data
```

To update, pull the new image and recreate the container. Keep the same data mapping. Omit `user:` to let startup prepare ownership automatically. Startup briefly runs as root to prepare the dedicated data directory and known planner files, then clears supplementary groups and drops to PUID/PGID before opening the app. Unrelated files and subfolders are not changed. It does not delete or reset progress. Use a dedicated planner folder; symlinks and hard-linked data files are rejected.

Explicit Docker `user:` remains supported when the directory is already writable and PUID/PGID match (or are omitted). Root IDs and invalid numeric values are rejected. Read-only mounts, restrictive ACLs or filesystems that reject ownership changes still require host-side correction; the container reports the startup failure.

If you use `cap_drop: ALL`, use the startup capabilities from the included [compose.yaml](../compose.yaml): CHOWN, DAC_OVERRIDE, FOWNER, SETUID and SETGID. `no-new-privileges:true` is supported. Timezone controls server-side dates; the browser still formats displayed dates in its own timezone.

## User accounts

The single-user workspace works in **local mode**. Local mode shares the owner workspace with anyone who can reach the server; it is not user isolation. Enable accounts before sharing:

1. Open **Saves & profiles → Set up user accounts**.
2. Read the host-only setup token:

   ```sh
   docker compose exec planner cat /data/account-setup-token.txt
   ```

3. Enter the token and choose your owner username and password. Your existing saves become this account’s saves.
4. Optionally enable registration so other people can create accounts. Each new account starts without access to your saves or progress.

Passwords are scrypt-hashed. Login sessions use HttpOnly, SameSite cookies and persist across container restarts. API reads and writes enforce ownership. The host setup token is never served through the API. Do not share it. There is no email/password-reset service in this version; keep your password securely and retain host backups.

The `APP_USER` / `APP_PASSWORD` Basic Auth gate remains available as an additional host-wide gate. It is separate from individual accounts.

## Persistence and backups

The Docker `planner-data` volume stores `/data/workspace.json`: accounts, named saves, profiles, calculation snapshots and progress. Updates and container recreation preserve it. **Do not run `docker compose down -v` unless you intend to delete this data.**

- **Backup** exports the current profile’s progress. Restore only to its matching profile; other profiles are untouched.
- For a complete backup, stop the container and back up its data volume, including `workspace.json`. This contains password hashes and session records; keep the backup private.
- `workspace.json.bak` retains the previous successful workspace write. Writes are serialized and atomically replaced. Corrupted data causes startup to fail rather than silently reset progress.
- `progress.json` remains the pre-migration backup and is no longer the live store. Another copy of `workspace.json` in the volume, when present, is the workspace as it was before an update migrated it; the planner keeps it as a backup and never reads it. Do not run old and new planner versions simultaneously against one volume.

## Moving between Docker and the browser edition

To move an existing Docker plan, update the Docker image, open **Backup → Export all saves**, then import that file on the public site. The transfer includes calculated profiles and progress, but excludes accounts, passwords and sessions. Exports made by older releases import too, with their progress. The same full export can be imported into Docker. There is no automatic synchronization between installations.
