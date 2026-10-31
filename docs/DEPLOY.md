# Deploy

How to run workout-app on a home server and reach it from the iPhone and laptop over HTTPS (SPEC §3.3, §8). The app runs in one Docker container that listens on `127.0.0.1:3000` only. [Tailscale Serve](https://tailscale.com/kb/1312/serve) puts it at `https://<host>.<tailnet>.ts.net`, with a real certificate, for devices on your tailnet and nobody else.

The iPhone needs HTTPS: without it there's no service worker, so no offline mode.

## 1. Pick the host

Any always-on Linux box that runs Docker works. The image builds for `amd64` and `arm64`.

- **Mini PC (x86, Debian or Ubuntu Server).** The homelab plan's first host. Recommended.
- **Raspberry Pi 4/5 with a 64-bit OS.** Works (`arm64`). 32-bit Raspberry Pi OS does not. Keep the data on an SSD, not the SD card, if you can.
- **Not the Windows desktops.** Forced reboots take the app down. The phone keeps logging offline, but it can't sync until the box is back up.

Log the choice in `docs/DECISIONS.md` (SPEC §12 Q1).

The commands below assume Debian, Ubuntu or Raspberry Pi OS, run as a normal user with `sudo`.

## 2. Install Docker and Git

```sh
sudo apt update && sudo apt install -y git curl
curl -fsSL https://get.docker.com | sudo sh     # Docker Engine + Compose v2
sudo usermod -aG docker "$USER"                 # then log out and back in
docker compose version                          # check it works without sudo
```

Docker starts on boot by default (`sudo systemctl is-enabled docker` prints `enabled`).

## 3. Run the app

```sh
git clone https://github.com/codelp12/workout-app.git ~/workout-app
cd ~/workout-app
docker compose up -d --build
docker compose ps                                # wait for (healthy)
curl -s http://127.0.0.1:3000/healthz            # {"ok":true,...}
docker compose exec app node dist/set-password.js   # pick the sign-in password
```

The first build takes a few minutes, longer on a Pi. `restart: unless-stopped` brings the container back after a reboot. Data lives in the `data` Docker volume (`/data/app.db` inside the container) and survives `docker compose down` and rebuilds. Only `docker compose down -v` deletes it.

## 4. Turn on HTTPS for the tailnet (once, in the browser)

In the [Tailscale admin console](https://login.tailscale.com/admin/dns), go to **DNS**:

1. Turn on **MagicDNS** if it's off.
2. Under **HTTPS Certificates**, click **Enable HTTPS**.

Your tailnet's DNS name (`<tailnet>.ts.net`) is shown at the top of that page. Machine names end up in public Certificate Transparency logs once they have a certificate, so don't put anything private in the hostname.

## 5. Install Tailscale on the host and serve the app

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                  # open the printed URL and sign in
```

Then, in the admin console's [Machines](https://login.tailscale.com/admin/machines) page, open the new machine's **⋯** menu:

- **Edit machine name**: this becomes `<host>` in the URL. Pick something short like `workout` or the box's name.
- **Disable key expiry**: otherwise the server drops off the tailnet when its key expires (180 days by default) until you sign in on it again.

Publish the app:

```sh
sudo tailscale serve --bg 3000     # HTTPS :443 -> http://127.0.0.1:3000
tailscale serve status             # shows https://<host>.<tailnet>.ts.net
```

`--bg` keeps the setting across reboots. The first HTTPS request fetches the certificate, so it can take a few seconds. Tailscale renews it after that.

## 6. Connect the phone and laptop

Install the Tailscale app on the iPhone (App Store) and the laptop, and sign in to the same tailnet. Open `https://<host>.<tailnet>.ts.net` on both and sign in with the password from step 3.

Next, run the iPhone checklist in [IPHONE-CHECKLIST.md](IPHONE-CHECKLIST.md).

## Day to day

| Task         | Command (in `~/workout-app` on the host)                            |
| ------------ | ------------------------------------------------------------------- |
| Update       | `git pull && docker compose up -d --build && docker image prune -f` |
| Status       | `docker compose ps` and `tailscale serve status`                    |
| Logs         | `docker compose logs -f --tail=100`                                 |
| Restart      | `docker compose restart`                                            |
| Stop         | `docker compose down` (keeps data)                                  |
| New password | `docker compose exec app node dist/set-password.js` (signs out all) |
| Stop serving | `sudo tailscale serve reset`                                        |

Updating runs any new database migrations on start, and it backs up the database to `/data/backups/` first. When a new build ships, the open app shows "Update available" instead of reloading mid-workout. Tap Reload when you're done.

### Backups (manual, until nightly backups land)

Nightly backups with retention are planned (SPEC §8) but don't exist yet. Until then, take a consistent copy while the app runs and copy it off the container:

```sh
docker compose exec app node -e "require('fs').mkdirSync('/data/backups',{recursive:true}); require('better-sqlite3')('/data/app.db').exec(\"VACUUM INTO '/data/backups/manual-$(date +%Y%m%d-%H%M%S).db'\")"
docker compose cp app:/data/backups ~/workout-backups
```

Copy `~/workout-backups` to another disk or machine for it to count as a backup.

To restore, stop the app, put the backup in place as `/data/app.db` (removing the old WAL files, or SQLite replays them onto the restored file), and start it again:

```sh
docker compose stop
docker compose run --rm --no-deps -v "$HOME/workout-backups:/restore:ro" app \
  sh -c 'cp /restore/<file>.db /data/app.db && rm -f /data/app.db-wal /data/app.db-shm'
docker compose start
```

### Troubleshooting

- **`https://<host>…` doesn't load:** check that Tailscale is connected on that device (`tailscale status` on the laptop, the toggle in the iPhone app), that `tailscale serve status` lists the URL, and that `curl -s http://127.0.0.1:3000/healthz` works on the host.
- **Certificate error on the first visit:** wait a few seconds and reload while the certificate is fetched. Check that HTTPS Certificates is enabled (step 4).
- **Sign-in says "Too many attempts":** five wrong passwords lock login for 15 minutes. `docker compose restart` clears the lock.
