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
"inputIcons": { "HDMI_3": { "file": "box.png", "bg": "#ffffff", "name": "My TV box" } }
```

`name` is optional: it replaces the name the TV gives the input on its tile.

## Plex On Deck

Themes that show it (Lift) put a row of **On Deck** cards above the dock: what you are in the middle of on your own Plex server,
with a progress bar. **Customise → Plex** signs in: it shows a short code, which you enter at **plex.tv/link** on a phone or
computer; no password is typed on the TV. The TV keeps the token in `config.json` and never passes it to the page; the cards
and their pictures come from your server on the local network. OK on a card opens Plex and
starts that episode or film where you left off: Plex on the TV does not follow launch links, so the TV's service asks your server
to play it on the TV's Plex app, as Plex's own cast button does, as soon as that app is open (after Plex's profile picker, if it
shows one; it waits up to two minutes). **Customise → Plex → Sign out**
forgets the token.

## The hero layout: live input, rain, scenes

Themes with `home.layout` set to `hero` (Hero) show the first input in the dock large, with an information panel beside it.

- **Live picture.** The input plays in the big tile; its sound plays only while the tile has the focus. OK opens the input full
  screen. The picture is released whenever Home is not in front, so it never competes with an app's video. Without a signal,
  or when the TV refuses the picture, the tile shows the input's logo instead.
- **Rain.** The forecast for the next six hours from [Open-Meteo](https://open-meteo.com) (free, no account): temperature, rain in mm
  or the chance of rain, and a line that says when rain starts or stops. The place is the one typed under *Place for the weather*
  on the phone setup page (manager app > Voice > Set up from your phone), or else the location set in your Home Assistant.
- **Scenes.** Up to seven scenes from Home Assistant, with **All off** (every light off). OK turns a scene on; the scene used
  last is marked while lights are on, and the heading counts the lights that are on. It uses the Home Assistant address and
  access token from the same phone setup page; the token stays in the service and the page only gets names and states. Only
  `scene.*` entities can be turned on. **Customise → Scenes** lists every scene: OK shows or hides one (at most seven, in the order
  you pick them; kept in `config.json` under `home.scenes`). With none picked, the first seven by name show.
- **Now playing.** While Spotify plays on the TV, a panel takes the weather's place: the cover, title, artist, a progress bar
  and previous, play/pause and next (OK). It reads Home Assistant's [Spotify integration](https://www.home-assistant.io/integrations/spotify/)
  (a `media_player.spotify_*` entity) over the same connection as the scenes, so the TV stores no Spotify sign-in. It only
  shows when the player's source is the TV itself (a Spotify Connect name with `[LG]` or `webOS` in it); set `home.spotifySource`
  to the exact name if yours differs, and `home.spotify` to the entity id if Home Assistant has more than one Spotify player.
- **Opening.** OK on a tile makes it grow until it fills the screen, then the app or input opens (the theme's
  `effects.speed` sets how fast; 0 opens it at once).
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
| `home` | `spotify`, `spotifySource`: the Spotify player entity and the source name that means "this TV" (both optional). `scenes`: the Home Assistant scene entity ids the Hero panel shows, in order (empty: the first seven by name). |

See [`config.example.json`](https://github.com/lasharor/cleanyourtv-WebOS/blob/main/config.example.json). Change settings in
the launcher; the file is read and written by the service.
