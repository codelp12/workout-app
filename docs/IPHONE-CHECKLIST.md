# iPhone checklist

Playwright's WebKit is close to Safari but isn't iOS (SPEC §3.4), so each release gets a pass on the real phone. The agent can't touch the phone, so the owner runs this list and posts the results on the issue.

## Phase 0: offline write spike (#24)

**Before you start:** the app is deployed and reachable at `https://<host>.<tailnet>.ts.net` ([DEPLOY.md](DEPLOY.md)), Tailscale is connected on the iPhone and the laptop, and you're signed in on the laptop.

1. **Open in Safari.** On the iPhone, open `https://<host>.<tailnet>.ts.net` in Safari. You should see "Hello, world" with no certificate warning.
2. **Install.** Tap Share, then **Add to Home Screen**, then **Add**.
3. **Launch the installed app.** Open it from the home-screen icon. It should open full-screen, with no Safari address bar. Sign in: the installed app doesn't share cookies with Safari, so it asks again. Expect "Signed in".
4. **Let it cache.** Leave it open for about 5 seconds so the service worker finishes caching the app.
5. **Go offline.** Turn on Airplane Mode, then make sure Wi-Fi is off too (Airplane Mode can leave Wi-Fi on).
6. **Kill and relaunch offline.** Swipe the app away in the app switcher, then open it again from the icon. It should load and show "Offline", not an error page.
7. **Write a note.** Type `iphone offline 1` and tap **Save**. It should show under "On this device" as `iphone offline 1 (pending)`, with "1 pending".
8. **Kill and relaunch again, still offline.** The note should still be there and still pending.
9. **Reconnect.** Turn off Airplane Mode (Wi-Fi or cellular is fine) and bring the app to the foreground. Within a few seconds, "pending" should drop to 0 and the note should show under "On the server". If it doesn't, tap **Sync now** and write down that you had to.
10. **Check the laptop.** Reload `https://<host>.<tailnet>.ts.net` on the laptop. `iphone offline 1` should show under "On the server" exactly once.

### Results to post on #24

Copy this, fill it in and paste it as a comment:

```md
- iPhone model / iOS version:
- Host:
- 1 Open in Safari: pass / fail
- 2 Install: pass / fail
- 3 Launch installed app (full-screen, signed in): pass / fail
- 6 Relaunch offline: pass / fail
- 7 Write note offline: pass / fail
- 8 Note survives relaunch: pass / fail
- 9 Syncs on reconnect without tapping Sync now: yes / needed Sync now / fail
- 10 On laptop exactly once: pass / fail
- Anything odd (screenshots welcome):
```

Later phases add items to this list per SPEC §10: logging a set offline, killing the app mid-workout and resuming, the rest timer after a screen lock, and wake lock.
