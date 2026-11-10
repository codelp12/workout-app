# iPhone checklist

Playwright's WebKit is close to Safari but isn't iOS (SPEC §3.4), so each release gets a pass on the real phone. The agent can't touch the phone, so the owner runs this list and posts the results on the issue.

## Phase 0: offline write spike (#24)

This ran against the spike screen, which #28 replaced. Use the sync engine check below for later releases.

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

## Sync engine (#28)

**Before you start:** same as above, with the new build deployed (`git pull`, then `docker compose up -d --build` on the host).

1. **Open the installed app.** Sign in if asked. The chip at the top should say **Synced**.
2. **Go offline.** Airplane Mode on, Wi-Fi off.
3. **Kill and relaunch offline.** It should load and the chip should say **Offline**.
4. **Add a project.** Name `iphone sync 1`, grade `V3`, tap **Add project**. It shows as `iphone sync 1 V3 (pending)` and the chip says **Offline · 1 pending**.
5. **Kill and relaunch again, still offline.** The project should still be there and still pending.
6. **Reconnect** and bring the app to the foreground. Within a few seconds the chip should say **Synced** and "(pending)" should disappear. If it doesn't, tap the chip and write down that you had to.
7. **Check the laptop.** Open the app on the laptop and tap the chip. `iphone sync 1 V3` should be listed exactly once.
8. **Delete on the laptop.** Tap **Delete** next to it, then bring the phone app to the foreground. It should disappear from the phone too.

### Results to post on #28

```md
- iPhone model / iOS version:
- 3 Relaunch offline shows Offline: pass / fail
- 4 Add project offline (1 pending): pass / fail
- 5 Survives relaunch: pass / fail
- 6 Syncs on reconnect without tapping the chip: yes / needed a tap / fail
- 7 On laptop exactly once: pass / fail
- 8 Delete reaches the phone: pass / fail
- Anything odd:
```

## Unsynced-data export (#30)

**Before you start:** same as above, with the new build deployed.

1. **Go offline** in the installed app (Airplane Mode on, Wi-Fi off) and add a project named `iphone export 1`. Under the chip you should see **1 unsynced change** and an **Export unsynced data** button.
2. **Export.** Tap **Export unsynced data**. Write down what iOS does: a download prompt, a preview with a Share button, or nothing. Save the file to Files if it lets you.
3. **Check the file.** In the Files app, open the `workout-app-unsynced-….json` file. It should mention `iphone export 1`.
4. **Import on the laptop.** Get the file to the laptop (AirDrop or iCloud Drive), open the app there, choose it under **Import unsynced data**. Expect "Imported 1 change." and `iphone export 1` in the list.
5. **Reconnect the phone.** The warning should go away, and the laptop should list `iphone export 1` exactly once after tapping the chip.

### Results to post on #30

```md
- iPhone model / iOS version:
- 1 Warning shows offline: pass / fail
- 2 What Export did (prompt / preview + Share / nothing):
- 3 File saved to Files and readable: pass / fail
- 4 Import on laptop: pass / fail
- 5 Exactly once after reconnect: pass / fail
- Anything odd:
```

## Rest timer and wake lock (#53)

**Before you start:** same as above, with the new build deployed. Silent switch off and volume up. Auto-Lock on (Settings → Display & Brightness → Auto-Lock, 30 seconds makes this quick).

1. **Start a lift session** from Today in the installed app and log a set. A rest timer appears above the card, counting down from the exercise's rest.
2. **Wake lock.** Put the phone down without touching it for longer than your Auto-Lock time. The screen should stay on.
3. **Rest over in the foreground.** Leave the app open until the timer hits zero. You should hear two short beeps and the timer should turn orange and say **Rest over** with a `+0:0x` count.
4. **Rest timer after a screen lock.** Log another set, note the time left, then press the side button to lock the phone. Wait about a minute and unlock. The timer should be about a minute lower than when you locked it, not where it was.
5. **Rest over while locked.** Log a set, lock the phone, and wait until the rest is over. Unlock: it should show **Rest over** with the overtime, and not beep.
6. **Kill mid-rest.** Log a set, swipe the app away, and reopen it. It should resume on the same card with the timer still counting down from the same set.
7. **Wake lock after switching apps.** Switch to another app and back, then leave the phone untouched past the Auto-Lock time again. The screen should stay on.
8. **Leaving releases it.** Tap **Back** to Today and leave the phone untouched. The screen should lock as usual.

### Results to post on #53

```md
- iPhone model / iOS version:
- 2 Screen stays on during the session: pass / fail
- 3 Beeps and "Rest over" in the foreground: pass / fail (beeps: yes / no)
- 4 Timer right after a screen lock: pass / fail
- 5 "Rest over" after locking, no beep: pass / fail
- 6 Timer survives a kill: pass / fail
- 7 Screen stays on after switching apps: pass / fail
- 8 Screen locks after leaving the player: pass / fail
- Anything odd:
```

## Climb logging (#58)

**Before you start:** same as above, with the new build deployed.

1. **Tap.** Open a climb session from Today and tap a grade chip. It should log one send, start the session clock and add a bar to the pyramid. The page shouldn't scroll or zoom.
2. **Long press.** Hold a grade chip for about half a second. The "Log a climb" sheet should open with that grade selected. iOS shouldn't show its text-selection or copy menu, and letting go shouldn't log an extra send.
3. **Scroll over the chips.** Drag the page up and down starting on a chip. It should scroll without logging a climb or opening the sheet.
4. **Clock after a lock or kill.** Note the session time, lock the phone for a minute, then unlock it. Then swipe the app away and reopen the session. Each time the clock should have kept counting from when the session started.

### Results to post on #58

```md
- iPhone model / iOS version:
- 1 Tap logs a send: pass / fail
- 2 Long press opens the sheet, no iOS menu, no extra send: pass / fail
- 3 Scrolling over the chips logs nothing: pass / fail
- 4 Clock right after a lock and a kill: pass / fail
- Anything odd:
```
