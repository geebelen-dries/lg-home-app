# The launcher

The launcher replaces LG's Home. It is a web page of the project that the TV's browser runs, so it starts fast and works the
same on every supported webOS version.

![Home screen](screenshots/home.jpg)

## The screen

- **Dock.** Up to four apps, large, on the first row.
- **Top shelf.** The name of the focused app and an ambient glow taken from its icon.
- **Grid.** All other apps, sorted by how often you use each one (or A to Z).
- **Top buttons.** Inputs, Live TV, Settings and Customise, and a clock. The buttons you see are yours to change.

## Keys

| Action | How |
|---|---|
| Open an app | OK |
| App options (dock, hide) | Hold OK on an app |
| Remove a top button | Hold OK on it |
| Customise | The **Customise** button |
| Live TV | The **Live TV** button or tile |
| Switch input | The **Inputs** button |

The Magic Remote pointer works too: pointing and clicking, and holding the button on an app for its options.

![App options](screenshots/options.jpg)

## Customise

![Customise menu](screenshots/customise.jpg)

**Customise** holds:

- the **top buttons** (add Inputs, Settings, Live TV or any app, or remove one),
- **hidden apps** (show them again),
- the **app order** (most used first, or A to Z),
- the **clock** format (automatic, 12 or 24 hour),
- **an input in the dock** (Customise → Dock → **An input...**),
- **Reset customisation**.

The dock holds up to four apps. Hold OK on an app and choose **Add to dock**, **Move left**, **Move right** or **Remove from dock**.

An HDMI input can sit in the dock too. **Customise → Dock → An input...** pins one: the tile shows the HDMI glyph and the
name the TV gives that input, and OK opens it. It moves and is removed like an app tile (hold OK). If the TV stops listing
the input, the tile goes away by itself.

To show a logo instead of the HDMI glyph (the logo of a set-top box, say), put a `.png`, `.jpg` or `.webp` in
`/media/developer/cleanyourtv/icons/` and name it in `config.json` with the input's id and a background colour:

```json
"inputIcons": { "HDMI_3": { "file": "box.png", "bg": "#ffffff" } }
```

## Plex On Deck

Themes that show it (Lift) put a row of **On Deck** cards above the dock: what you are in the middle of on your own Plex server,
with a progress bar. **Customise → Plex** signs in: it shows a short code, which you enter at **plex.tv/link** on a phone or
computer; no password is typed on the TV. The TV keeps the token in `config.json` and never passes it to the page; the cards
and their pictures come from your server on the local network. OK on a card opens Plex. **Customise → Plex → Sign out**
forgets the token.

## The hero layout: live input, rain, lights

Themes with `home.layout` set to `hero` (Hero) show the first input in the dock large, with an information panel beside it.

- **Live picture.** The input plays in the big tile; its sound plays only while the tile has the focus. OK opens the input full
  screen. The picture is released whenever Home is not in front, so it never competes with an app's video. Without a signal,
  or when the TV refuses the picture, the tile shows the input's logo instead.
- **Rain.** The forecast for the next six hours from [Open-Meteo](https://open-meteo.com) (free, no account): temperature, rain in mm
  or the chance of rain, and a line that says when rain starts or stops. The place is the one typed under *Place for the weather*
  on the phone setup page (manager app > Voice > Set up from your phone), or else the location set in your Home Assistant.
- **Lights.** Up to seven lights from Home Assistant, with **All off**. OK switches a light. It uses the Home Assistant address and
  access token from the same phone setup page; the token stays in the service and the page only gets names and states. Only
  `light.*` entities can be switched. To pick which lights are shown, list their entity ids in `config.json` under
  `home.lights`.
- **Apps and Continue watching.** The other apps of the dock and the Plex On Deck cards share the row under the big tile; it scrolls
  sideways when the cards do not fit.

## Inputs

The **Inputs** button lists HDMI inputs by the names LG shows, with what is connected and a marker on the active one. OK
switches to the input.

![Inputs menu](screenshots/inputs.jpg)

## Icons

Each tile uses the app's own icon. The tile colour is taken from the icon's edge colour, so an icon that reaches its edges blends
into the tile, and the ambient glow comes from the icon's most vivid colour. Colours are worked out once per app and remembered.

!!! note "Icons with a transparent margin"
    An icon that is an opaque square with a transparent margin around it (many LG icons) can look boxed in on its tile. A fix
    that fills the tile is available as a test build; see [Test builds](managing.md#test-builds).

## Language

Menus follow the TV's language: English, Dutch, German, French and Spanish.

## Themes

The look of the home screen (colours, tile and text size, columns, clock, glow, animation speed, wallpaper) is a [theme](themes.md),
chosen in the manager app.

## Settings file

Settings are stored on the TV in `/media/developer/cleanyourtv/config.json`:

| Key | Meaning |
|---|---|
| `dock` | App ids in the dock, and `input:<id>` for an external input (`input:HDMI_3`), up to four. |
| `topbar` | The buttons at the top. |
| `hidden` | App ids you hid. |
| `sort` | `usage` or `alpha`. |
| `clock` | `auto`, `12` or `24`. |
| `weather` | `place`: the town for the rain forecast (set on the phone setup page); the service adds where it found it. |
| `home` | `lights`: the Home Assistant light entity ids the Hero panel shows, in order (empty: the first seven by name). |

See [`config.example.json`](https://github.com/lasharor/cleanyourtv-WebOS/blob/main/config.example.json). Change settings in
the launcher; the file is read and written by the service.
