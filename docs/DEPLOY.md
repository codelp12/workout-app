# Deploy

How to run workout-app on a home server and reach it from the iPhone and laptop over HTTPS (SPEC §3.3, §8). The app runs in one Docker container that listens on `127.0.0.1:3000` only. [Tailscale Serve](https://tailscale.com/kb/1312/serve) puts it at `https://<host>.<tailnet>.ts.net`, with a real certificate, for devices on your tailnet and nobody else.

The iPhone needs HTTPS: without it there's no service worker, so no offline mode.

## 1. Pick the host

Any always-on Linux box that runs Docker works. The image builds for `amd64` and `arm64`.

- **Mini PC (x86, Debian or Ubuntu Server).** The homelab plan's first host. Recommended.
- **Raspberry Pi 4/5 with a 64-bit OS.** Works (`arm64`). 32-bit Raspberry Pi OS does not. Keep the data on an SSD, not the SD card, if you can.
- **A Windows PC, as a stopgap.** Works with Docker Desktop; see [Windows host](#windows-host-interim). A forced Windows Update restart takes the app down until someone signs in. The phone keeps logging offline and syncs once it's back.

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

## Windows host (interim)

The same app, run with Docker Desktop on a Windows 10 or 11 PC that stays on. Run the commands in PowerShell.

1. **Install the tools:** [Git for Windows](https://git-scm.com/download/win), [Docker Desktop](https://www.docker.com/products/docker-desktop/) (keep the default WSL 2 backend; it may install WSL and ask for a reboot) and [Tailscale for Windows](https://tailscale.com/download/windows). Sign in to Tailscale with the same account as the phone.
2. **Keep it awake and starting on its own:**
   - Settings → System → Power: set sleep to **Never** when plugged in.
   - Docker Desktop → Settings → General: turn on **Start Docker Desktop when you sign in**.
   - Tailscale tray icon → Preferences: turn on **Run unattended**, so it stays connected while nobody is signed in.
   - Settings → Windows Update → Advanced options → **Active hours**: cover the hours you train, so forced restarts happen overnight.
3. **Run the app:**

   ```powershell
   git clone --config core.autocrlf=false https://github.com/codelp12/workout-app.git $HOME\workout-app
   cd $HOME\workout-app
   docker compose up -d --build
   docker compose ps                                   # wait for (healthy)
   curl.exe -s http://127.0.0.1:3000/healthz           # {"ok":true,...}
   docker compose exec app node dist/set-password.js   # pick the sign-in password
   ```

   `core.autocrlf=false` keeps the repo's LF line endings, so the image builds the same as on Linux.

4. **Name the machine and serve the app.** On the admin console's [Machines](https://login.tailscale.com/admin/machines) page, rename the PC to a name that isn't tied to the hardware, like `workout`, and disable key expiry (as in step 5). Then:

   ```powershell
   tailscale serve --bg 3000
   tailscale serve status       # shows https://workout.<tailnet>.ts.net
   ```

   If it says access is denied, run it again in an Administrator PowerShell.

5. **Move the phone over.** The URL is new, so on the old host run `tailscale serve reset` and `docker compose down`. On the iPhone, delete the old home-screen icon, open the new URL in Safari and add it to the Home Screen again. Run steps 4–10 of [IPHONE-CHECKLIST.md](IPHONE-CHECKLIST.md) once as a check.

**What a restart does.** A Windows Update restart, a crash or a power cut stops the app. It doesn't delete anything. The database lives in the `data` Docker volume, and SQLite keeps every write the server confirmed. A write cut off mid-request was never confirmed, so it's still in the phone's outbox and gets sent again. Compose restarts the container (`restart: unless-stopped`) as soon as Docker Desktop is running, but Docker Desktop only starts after someone signs in to Windows. Until then the phone keeps logging offline. Data is only deleted by `docker compose down -v`, removing the `data` volume, or Docker Desktop's purge/uninstall.

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

On Windows, run these in PowerShell from `$HOME\\workout-app` and leave out `sudo`. Windows PowerShell 5.1 has no `&&`, so run the update commands one at a time.

Updating runs any new database migrations on start, and it backs up the database to `/data/backups/` first. When a new build ships, the open app shows "Update available" instead of reloading mid-workout. Tap Reload when you're done.

### Backups (manual, until nightly backups land)

Nightly backups with retention are planned (SPEC §8) but don't exist yet. Until then, take a consistent copy while the app runs and copy it off the container:

```sh
docker compose exec app node -e "require('fs').mkdirSync('/data/backups',{recursive:true});const f='/data/backups/manual-'+Date.now()+'.db';require('better-sqlite3')('/data/app.db').exec('VACUUM INTO \''+f+'\'');console.log(f)"
docker compose cp app:/data/backups $HOME/workout-backups
```

Both lines work in bash and PowerShell. Copy the `workout-backups` folder in your home directory to another disk or machine for it to count as a backup.

To restore, stop the app, put the backup in place as `/data/app.db` (removing the old WAL files, or SQLite replays them onto the restored file), and start it again:

```sh
docker compose stop
docker compose run --rm --no-deps -v "$HOME/workout-backups:/restore:ro" app \
  sh -c 'cp /restore/<file>.db /data/app.db && rm -f /data/app.db-wal /data/app.db-shm'
docker compose start
```

### Moving to a new host

The server's data is one SQLite file, and the phone's installed app is tied to its URL. To move without losing either:

1. Sync the phone and laptop until nothing is pending.
2. On the old host, take a backup (above) and copy the `workout-backups` folder to the new host.
3. Set up the new host (steps 2–3, or [Windows host](#windows-host-interim) steps 1–3), then restore the backup there before using it. The password comes with the database.
4. In the Tailscale admin console, remove the old machine, rename the new one to the old name (e.g. `workout`) and run `tailscale serve --bg 3000` on it. The URL stays the same, so the phone keeps its installed app and local data.
5. Open the app on the phone and check that your history is there.

With a different name instead, reinstall the app on the phone from the new URL. It downloads everything from the server, but anything the old install hadn't synced is lost.

### Troubleshooting

- **`https://<host>…` doesn't load:** check that Tailscale is connected on that device (`tailscale status` on the laptop, the toggle in the iPhone app), that `tailscale serve status` lists the URL, and that `curl -s http://127.0.0.1:3000/healthz` works on the host.
- **Certificate error on the first visit:** wait a few seconds and reload while the certificate is fetched. Check that HTTPS Certificates is enabled (step 4).
- **Sign-in says "Too many attempts":** five wrong passwords lock login for 15 minutes. `docker compose restart` clears the lock.
