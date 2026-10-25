# Third-party components

CleanYourTV for LG webOS is MIT licensed (see `LICENSE`). The package also contains the following unmodified
third-party files. They are separate programs that our service starts; none of our code is linked with them.

## inputhook (Input key)

The files in `third-party/inputhook/` (installed to `/media/developer/cleanyourtv/inputhook/` on the TV) are taken
unchanged from the release `org.webosbrew.inputhook` 1.5.1 of
[Simon34545/lginputhook](https://github.com/Simon34545/lginputhook) (package SHA-256
`604d556a932ec60cee1f041b144aa03d3b49043212568d4cc5bd5854c7ac88ec`). They inject a small hook into LG's input
process so a remote button can run a command; we use it for the Input button.

| File | What it is | License | Source |
|---|---|---|---|
| `ezinject` | process injector | Zlib (`LICENSE-ezinject-Zlib.txt`) | [smx-smx/ezinject](https://github.com/smx-smx/ezinject) |
| `libinputhookpp.so` | the hook library (it statically contains frida-gum) | GPL-3.0 (`LICENSE-inputhookpp-GPL-3.0.txt`) | [sundermann/inputhookpp](https://github.com/sundermann/inputhookpp) |
| lginputhook (the app is not shipped; its key ids and config format are used) | button remapper | BSD-3-Clause (`LICENSE-lginputhook-BSD-3-Clause.txt`) | [Simon34545/lginputhook](https://github.com/Simon34545/lginputhook) |

File hashes are in `third-party/inputhook/SHA256SUMS`.

**GPL-3.0 notice for `libinputhookpp.so`.** The file is distributed here unmodified, in the form it has in the
inputhook 1.5.1 release. Its corresponding source code is the `inputhookpp` project linked above (with frida-gum, whose
license is in the frida-gum project). Anyone who received this package can ask for that source from this repository's
issue tracker, and we will provide it. The GPL-3.0 text is in `LICENSE-inputhookpp-GPL-3.0.txt`. This applies to
that library only, not to the rest of this project.

## Voice (optional download)

Nothing below is shipped in the package; the manager app downloads it on request (see the Voice page of the documentation) and
`voice/cytv-asr` (MIT, source in `voice/asr.c`) is built against the Moonshine C header.

| Component | License | Source |
|---|---|---|
| Moonshine speech engine and models (`moonshine-voice` 0.1.5) | MIT | [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) |
| ONNX Runtime (inside the `moonshine-voice` package) | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| 64-bit GNU C library, libstdc++, libgcc (from `ubuntu-base` 22.04.5) | LGPL-2.1 / GPL-3.0 with runtime library exception | Ubuntu source packages `glibc` and `gcc-12` |

## qrcode-generator (QR code for sharing the log)

`third-party/qrcode-generator/qrcode.js` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 by
Kazuhiko Arase, unmodified (npm package `qrcode-generator@1.4.4`, SHA-256 of the file
`18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780`), licensed under the MIT license (the notice is in
the file header). The manager app loads it to draw the QR code.

## Inter (typeface of the Lift theme)

`app/inter-400.woff2`, `app/inter-500.woff2` and `app/inter-600.woff2` are the Latin subsets of the
[Inter](https://github.com/rsms/inter) typeface by The Inter Project Authors, unmodified, from the npm package
`@fontsource/inter@5.3.0` (`files/inter-latin-<weight>-normal.woff2`). Inter is licensed under the SIL Open Font
License 1.1; the licence text is in `third-party/inter/LICENSE-Inter-OFL-1.1.txt`. The launcher loads them only when a
theme sets `type.font` to `inter`. SHA-256:

| File | SHA-256 |
|---|---|
| `inter-400.woff2` | `8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc` |
| `inter-500.woff2` | `f3779f1efccc4bdcdf9c0a02ab95bf6bd092ed09c48c08cedc725889edd1d19f` |
| `inter-600.woff2` | `f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a` |

## Backdrop photos (Wikimedia Commons)

Themes with `effects.backdrop` set to `nature` (Lift) show a photo behind the home screen. No photo is shipped: the service downloads one
of the [featured pictures](https://commons.wikimedia.org/wiki/Commons:Featured_pictures) of mountains, lakes, forests, waterfalls and coasts
from Wikimedia Commons (`helper/backdrop.js`), and the launcher shows the photographer and the licence (mostly CC BY-SA) with it, as
those licences ask. The screenshot `themes/lift/preview.jpg` contains
[Lindenstumpf, Panorama, 2](https://commons.wikimedia.org/wiki/File:Lindenstumpf,_Panorama,_2.jpg) by Rainer Lippert, released into the
public domain.

## Weather (Open-Meteo)

The Hero theme's rain forecast comes from the [Open-Meteo](https://open-meteo.com) API (`helper/home.js`), whose data is licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the panel names Open-Meteo beside the place. Places typed on the phone setup
page are looked up with Open-Meteo's geocoding API. Nothing from Open-Meteo is shipped. The screenshot `themes/hero/preview.jpg` shows
made-up weather, lights and apps over the same public-domain photo as Lift's.

## Design

The home-screen design follows the Android TV project [CleanYourTV](https://github.com/Gathin23/cleanyourtv) (MIT).
No code from it is used.
