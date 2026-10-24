# This fork

A fork of [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) for local changes to the launcher and
the root service. Upstream's `AGENTS.md` still applies to the code: the service must run on **Node.js 8.12** (webOS 5/6),
pages must stay **ES5 / Chromium 68**, and nothing under `/usr`, `/etc` or the firmware may be written to.

## Why there is a fork at all

The TV decides **which repo it follows** from a one-line file, `/media/developer/cleanyourtv/source`:

* absent (today) → `lasharor/cleanyourtv-WebOS`
* `your-name/cleanyourtv-webos` → your fork, for the manager app's Update, self-update and the theme list

`helper/helper.js`, `helper/manager.js` and `helper/selfupdate.js` all read it and validate it against
`^[\w.-]+/[\w.-]+$`; anything else falls back to upstream. `install.sh` takes the same value as `CYTV_REPO`.

## Build and check

```sh
sh tools/node8-check.sh     # the service under Node 8.12.0, as webOS 5/6 run it
python3 ipk/build.py        # dist/: .ipk + frontend .tgz, each with a .sha256
```

`ipk/build.py` needs nothing but Python 3 — no pip packages, no node build step. It writes:

| File | Used by |
|---|---|
| `com.cleanyourtv.manager_<version>_all.ipk` (+ `.sha256`) | `install.sh`, the manager's Update |
| `frontend-<launcher version>.tgz` (+ `.sha256`) | the launcher update alone |

Those names are a contract: `install.sh` picks the `.ipk` out of the latest release by regex, and
`helper/manager.js` picks up both. Renaming them breaks updates.

## Releasing

`.github/workflows/release.yml` runs on a `v*` tag (added by this fork; upstream only had `docs.yml` and `test-build.yml`):

```sh
git tag v1.5.17
git push origin v1.5.17
```

It runs `tools/node8-check.sh`, builds, warns if the tag does not match `VERSION` in `helper/helper.js`, and publishes
`dist/*` as a release. Bump the version in **both** places before tagging:

* `helper/helper.js` → `const VERSION = '…'`
* `app/version.json` → `{"version": "…"}` (and the `VERSION='…'` string in `app/index.html` must match; the build fails otherwise)

Branch pushes still publish `test-<branch>` pre-releases, as upstream does.

## Pointing the TV at the fork

Already installed (what this TV has):

```sh
echo 'your-name/cleanyourtv-webos' > /media/developer/cleanyourtv/source
```

Then Update in the manager app follows this repo. To go back to upstream, delete that file.

A fresh install from the fork:

```sh
CYTV_REPO=your-name/cleanyourtv-webos curl -fsSL \
  https://raw.githubusercontent.com/your-name/cleanyourtv-webos/main/install.sh | sh
```

## Keeping up with upstream

```sh
git remote add upstream https://github.com/lasharor/cleanyourtv-WebOS.git
git fetch upstream
git merge upstream/main        # or: git rebase upstream/main
```

The two files this fork adds (`release.yml`, this note) do not touch upstream files, so merges should stay clean.

## Testing on the TV without a release

```sh
python3 ipk/build.py
scp dist/com.cleanyourtv.manager_*_all.ipk root@192.168.0.232:/tmp/
ssh root@192.168.0.232 'luna-send -n 1 -w 30000 -f luna://com.webos.appInstallService/dev/install \
  "{\"id\":\"com.cleanyourtv.manager\",\"ipkUrl\":\"/tmp/com.cleanyourtv.manager_1.5.16_all.ipk\",\"subscribe\":false}" </dev/null'
```

For a launcher-only change, `app/index.html` is served from `/media/developer/cleanyourtv/app/index.html`; copy it there and
run `sh /media/developer/cleanyourtv/reload-home.sh`.
