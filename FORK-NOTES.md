# Fork notes — `geebelen-dries/lg-home-app`

A fork of [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) maintained for **one TV**, so that
the launcher and the service can be changed freely. Upstream's `AGENTS.md` still governs the code (Node 8.12, ES5,
nothing written under `/usr` or `/etc`); the one rule that is different here is rule 7 — in this repository you are the
maintainer, so tagging and releasing is expected.

Written 2026-10-24, the day the TV was rooted and set up.

## The TV

| | |
|---|---|
| Model | LG **OLED55G56LS.DEUQLJP** (G5 OLED, 2025, 55") |
| IP | `192.168.0.232` (DHCP — reserve it in the router; the service and installers pin this address) |
| MAC | `30:34:DB:B5:0A:EE` |
| Firmware | **`43.21.77`** |
| webOS | **11.2.0** — the "queue" branch, marketed as webOS 26. Not webOS 25 (that is the 10.x branch) |
| Region | `DEU`, DVB tuner; the HDMI 3 source reports SPD `Horizon4` / `LGI BV` |
| Root | **SlopBro** (`jsserver` exploit), Homebrew Channel **0.7.3**, `uid=0` confirmed |
| Installed | manager **1.5.16**, launcher **1.4.15**, Home takeover active |

The firmware is **not** in `compat.json`, so a setup needs `--force` (or "Set up anyway"). Upstream has a reported
working TV on this same firmware (`OLED65C54LA`, 43.21.77 / SDK 11.2.0).

## Reaching the TV

```sh
ssh root@192.168.0.232          # port 22. Password `alpine` until a key is in /home/root/.ssh/authorized_keys
```

* **SSH is off by default.** Homebrew Channel → Settings → SSH Server. Everything below assumes it is on.
* **telnet `192.168.0.232:23`** is HBC's unauthenticated root shell (`telnetd -l /bin/sh`). It is how the TV was first
  set up, but it is a root shell open to the whole LAN — turn it off once SSH works.
* **Port 9922** is the Developer Mode app's `sshd` (`PermitRootLogin=no`). Its presence means the Developer Mode app is
  installed, which conflicts with a rooted TV. Remove the app; do not reinstall it.
* `luna-send` needs stdin redirected: `luna-send -n 1 -w 5000 -f <uri> '<json>' </dev/null`.

## Where things are on the TV

| Path | What |
|---|---|
| `/media/developer/cleanyourtv/` | the payload the service runs from: `app/index.html` (launcher), `helper.js`, `config.json`, `backup/`, `undo-home.sh`, `reload-home.sh` |
| `/media/developer/cleanyourtv/source` | **which repo the TV follows**, one line `owner/name`. Absent = upstream |
| `/media/developer/apps/usr/palm/{applications,services}/com.cleanyourtv.*` | the installed package (manager, picker, notify, service) |
| `/var/lib/webosbrew/init.d/` | boot scripts `10-cleanyourtv-home`, `15-cleanyourtv-debloat` (symlinks into `cleanyourtv/`) |
| `/media/developer/cytv-setup.log` | setup log, kept across the restart |
| `/tmp/cleanyourtv-helper.log` | service log |

`config.json` is **never overwritten** by setup or update (`bootstrap.sh`: `[ -f $D/config.json ] || cp …example…`), so
the user's layout survives updates. The launcher and service are replaced.

## Publish a release from this fork

`.github/workflows/release.yml` (added by this fork; upstream has no release workflow) runs on a `v*` tag.

1. Bump the version in **all three** places, or the build fails:
   * `helper/helper.js` → `const VERSION = '…'`
   * `app/version.json` → `{"version": "…"}`
   * `app/index.html` → the `VERSION='…'` string
2. `sh tools/node8-check.sh` — the service under Node 8.12.0. The workflow runs it too and will not publish a red build.
3. `python3 ipk/build.py` — writes `dist/` in ~2 s, stdlib only.
4. `git tag vX.Y.Z && git push origin main --tags`
5. Check the release has **four** assets, with these exact names (they are a contract):
   `com.cleanyourtv.manager_<v>_all.ipk` + `.sha256`, `frontend-<launcher v>.tgz` + `.sha256`

Branch pushes still publish `test-<branch>` pre-releases, as upstream does.

## Publish to the TV

**A. Fresh install from this fork** (needs a release):

```sh
CYTV_REPO=geebelen-dries/lg-home-app curl -fsSL \
  https://raw.githubusercontent.com/geebelen-dries/lg-home-app/main/install.sh | sh
```

**B. Make an existing install follow this fork** — the manager's Update, self-update and theme list then use this repo:

```sh
echo 'geebelen-dries/lg-home-app' > /media/developer/cleanyourtv/source
```

Do this **only after the first release exists**, or Update 404s. `rm` the file to go back to upstream. *Not done yet —
the TV currently follows upstream.*

**C. Fast loop without a release** — build, copy, install:

```sh
python3 ipk/build.py
scp dist/com.cleanyourtv.manager_*_all.ipk root@192.168.0.232:/tmp/pkg.ipk
ssh root@192.168.0.232 'luna-send -n 1 -w 30000 -f luna://com.webos.appInstallService/dev/install \
  "{\"id\":\"com.cleanyourtv.manager\",\"ipkUrl\":\"/tmp/pkg.ipk\",\"subscribe\":false}" </dev/null'
```

**D. Launcher-only change** — copy `app/index.html` to `/media/developer/cleanyourtv/app/index.html`, then
`sh /media/developer/cleanyourtv/reload-home.sh`. Caveat: `ipk/build.py` injects `shared/flexgap.js` into every
`index.html` at build time, so a raw copy of the source file drops the flex-gap polyfill. Harmless on webOS 11 (native
`gap`), a regression on webOS 5/6 — prefer (C) unless you are iterating on this TV only.

**Undo the Home takeover:** manager app → "CleanYourTV as Home" off, or `sh /media/developer/cleanyourtv/undo-home.sh`.
A reboot without the boot scripts also brings LG's Home back.

## Known issues on this hardware

* **`Denied method call 'exec' for category '/'`** — HBC 0.7.3 grants its API to the `public` group, which webOS 11 no
  longer puts apps in. Upstream fix is PR #233, unreleased. Applied by hand on this TV:
  `/var/luna-service2-dev/api-permissions.d/org.webosbrew.hbchannel.service.api.lunabus.query.json` containing
  `{"lunabus.query":["org.webosbrew.hbchannel.service/*"]}`, plus an entry in
  `/var/luna-service2-dev/manifests.d/org.webosbrew.hbchannel.json`'s `apiPermissionFiles`. **Reinstalling or updating
  HBC may overwrite this**; HBC 0.7.4+ creates the file itself, so remove the hand-made one then.
* **`/etc/hosts` is read-only** — `debloat-stop.sh` cannot add hostnames, so the DNS-level ad block is skipped; the
  debloat still stops LG's ad/telemetry services. Block LG's domains in the router/NextDNS instead.
* **Unlisted firmware** — `bootstrap.sh` has `TESTED_SDK="10."`; on 11.2.0 it needs `--force`.
* **Home key opens LG's Home** — set *Settings → General → Home Settings → Home Style* to **Basic**.
* **The dock only holds apps.** `dockIds()` filters ids through the helper's `/api/apps`, which has no HDMI inputs, so
  an input cannot be a dock tile. "TelenetTV Box" therefore sits in the top bar as
  `{"label":"TelenetTV Box","icon":"hdmi","app":"com.webos.app.hdmi3"}`. Making it a tile means changing
  `dockIds()`/`rebuild()` in `app/index.html` to accept an input entry.

## Still true from upstream

Node 8.12 for the service, ES5 / Chromium 68 for pages, no writes under `/usr` or `/etc`, a test in
`tools/node8-check.js` for anything testable without the TV, and documentation in `docs/` updated when behaviour changes.
