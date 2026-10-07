# SF Bay Boating Trainer

A 3D browser game for practicing boat handling, docking, and the Rules of the Road on the central San Francisco Bay. You drive a **Protector 33 Targa RIB**: a New Zealand-built rigid inflatable with a navy collar and a targa hardtop. It's 10.3 m long and 3.25 m wide, weighs about 5.8 t loaded, and runs twin Mercury Verado 350s for about 50 kn flat out (about 55 kn trimmed). The setting is a busy October Saturday on the central bay.

The game opens already underway off Sausalito at golden hour, with the main menu floating over the water. You can drive right away: `Q`/`W` ahead, `←`/`→` steer, and `Esc` hides the menu.

## Run it

**Play online:** https://kevinniechen.github.io/sf-bay-boating-trainer/ (add `?mute` to start silent)

To run it locally:

```bash
python3 serve.py          # then open http://localhost:8765
```

It needs no build step and no internet connection, because Three.js is bundled in `vendor/`. Any static server works, but `serve.py` turns off caching so code edits show up on reload. Use Chrome or another browser with WebGL2.

## Modes

- **Featured runs** (one click from the main menu):

| Run | Setting |
|---|---|
| Sausalito Golden Hour | 18:20, light air, the sun sliding behind the Headlands (the default lobby) |
| Sunrise Under the Bay Bridge | 07:05, glassy water, dawn glow over the East Bay hills |
| Bluebird Day off Tiburon | 12:30, deep-blue sky, Raccoon Strait to Sam's |
| Fleet Week — Blue Angels | 15:00, the airshow over the Marina Green box, Navy ships, a packed spectator fleet |
| Karl the Fog at the Gate | 09:30, a marine layer about 95 m thick, foghorns |
| City Lights at Night | 20:30, the Bay Lights, the lit skyline, light reflections on the water |
| Max Ebb Smoker off Alcatraz | 15:30, a 22 kn westerly against a 3 kn ebb |
| Morning Calm in Ayala Cove | 08:45, glassy, boats picking up moorings |

- **The sun moves in every mode.** By default the sky clock runs at 6×, so you can watch a sunset in a few minutes. Free Ride has a selector for real time, 20× time-lapse, or a frozen sun.
- **Free Ride**: the traffic setting includes a Fleet Week option. You can start tied up at a dock with engines idling (your Pier 40 slip, the Sausalito guest dock, Sam's, Ayala Cove, Pier 39, Pier 1½, Horseshoe Cove, Schoonmaker or Clipper Cove), do a cold start with the full checklist, or pick an underway start point (your Pier 40 slip, Pier 1½, Pier 39, Sausalito, Sam's, Ayala Cove, Alcatraz, Clipper Cove, the Gate…), a time of day (morning calm through a small-craft-advisory afternoon, golden hour, night), a tide (real cycle, max flood, max ebb, slack), wind, traffic level and fog.
  - A Rules Advisor watches every vessel nearby. It tells you whether you're stand-on or give-way, cites the rule, flags a steady bearing (collision course), and suggests the right sound signal.
  - Coaching flags no-wake zones, ship lanes, shoaling, chop, current set, nearby hazards and docks.
  - A logbook records violations.
- **Scenario Mode (graded)**: 23 scripted situations. Each one starts with a rules question, then you drive it and get a scored debrief that explains what a good skipper would have done.

| Category | Scenarios |
|---|---|
| Rules of the Road | Head-on (Rule 14) · Crossing, boat on your starboard bow (15/16) · Stand-on when the other boat *doesn't* give way (17b/c + danger signal) · Stand-on when it does · Overtaking in Raccoon Strait (13) · Sailboat crossing from port (18) |
| Big Ships | Container ship under the Bay Bridge (Rule 9) · Crossing the lane at the Golden Gate on a max ebb · Ferry backing out at Sausalito (sound signals) · Fast ferry overtaking you · Tug with a long tow |
| Seamanship | Fog at the Gate (safe speed + fog signals) · Swimmers & kayaks at Aquatic Park · Wind against tide from Pier 39 to Sausalito · Through a racing fleet |
| Emergencies | Man overboard (MOB button, neutral near the person) · Single-engine docking at Pier 1½ |
| Docking | Sam's Anchor Cafe · Ayala Cove (current across the entrance) · Sausalito guest dock (gusts off the hills) · Back into your Pier 40 slip · Leave the slip in a crosswind |
| Night | Navigation-lights quiz (head-on, crossing, stern light, tug with tow, sailboat, ship range lights) |

## Controls

**Engine levers** (one per engine, like a real twin binnacle):

| | Port lever | Starboard lever |
|---|---|---|
| Push forward (hold) | `Q` | `W` |
| Pull back (hold) | `Z` | `X` |

- You can also grab a lever knob on the control panel and drag it with the mouse. Hold `Shift` with `Q`/`Z` or `W`/`X` to move both levers together.
- A little travel from **N** clicks the engine into gear at idle, and further travel opens the throttle.
- **N** is a detent in the middle; the green N light comes on when you're there. The lever stops at N, so release and press again (or drag past the notch) to go into the other gear.

**Helm:** hydraulic steering, 4.4 turns lock to lock, with no self-centering.
- `←`/`→` spin the wheel (hold `Shift` to spin it fast), or drag the wheel rim with the mouse.
- The panel shows how many turns you're off center and the actual outboard angle. The engines follow the wheel at the speed of the hydraulic cylinder.
- After you center the wheel the boat keeps rotating for a moment, so you have to meet the turn with opposite helm.

**Trim:** `↑`/`↓`, the UP/DN rocker on the port grip. Around 25–30% trim lifts the bow and adds speed. Trim in (down) for chop and tight turns. Too much trim at speed makes the boat porpoise, and above about 45% the props ventilate.

**Bow thruster:** `B` turns the power on or off (needs the battery). Hold `,` to push the bow to port and `.` to push it to starboard. It only works below about 2 kn and trips a thermal cutout after about 45 s of continuous use.

**Getting underway:** Free Ride from your slip shows a checklist: `1` cover, `2` battery, `3` kill-switch lanyard, `4` trim engines down, `5`/`6` start port/starboard (the lever must be in N).

**Dock lines:** these are real ropes (bow, stern, and fore/aft springs) that pull only when taut. You can spring against them.
- `L` makes lines fast when you're alongside and stopped, or casts them all off.
- The LINES panel lets you cast off one line at a time.
- `F` puts out fenders. Hitting the dock or another boat makes a fiberglass crunch; scraping along without fenders makes a gelcoat scrape and causes damage.

**Other:**
- Horn: `H` (tap for a short blast, hold for a prolonged one).
- Camera: `C` cycles views. Drag to orbit, scroll to zoom, hold `E` for binoculars.
- Chart and overlays: `M` chart, `G` open guest spots, `V` currents.
- `O` MOB button · `T` time ×2/×4 · `` ` `` performance stats · `Esc` pause.

### Route Tours (watch and learn)

An autopilot drives a whole route, including every docking, while narrating headings, speeds, hazards and landmarks:

> Pier 40 → Ayala Cove (Angel Island) → Sam's (Tiburon) → Sausalito + Richardson Bay channel → Golden Gate → home slip

- It fast-forwards (about 90×) through open water and slows to near real time at the crucial spots and every docking.
- The full ~2-hour route plays in about 6 minutes.
- `Space` pauses, `-`/`=` change speed, and `N` skips to the next docking. Use the camera freely.
- At the end you get the full list of notes and a **Drive it yourself** button. That button starts you in the slip with the route drawn on the water and each stop set as your destination.

## Real-world data

The world is built from public-domain survey data. It ships in `data/` and loads at startup.

- **Elevation and bathymetry:** AWS Terrain Tiles, which combine USGS 3DEP elevation on land with NOAA coastal bathymetry offshore.
  - The coastline, every pier and seawall, the hills and the water depths (e.g. about 110 m in the Golden Gate channel) all come from this data.
  - Anything placed by hand that turns out to sit on land is removed automatically at load.
- **Aerial imagery:** USGS National Map orthoimagery, from NAIP aerial photography.
  - It is draped over the land in the play area (about 3.7 m/pixel) and over the surrounding region (East Bay hills, Mt. Tam, the Peninsula).
- **Dock layouts:** measured from 0.6 m NAIP photos for Pier 40/South Beach Harbor, Pier 1½ and the ferry gates, Pier 39, Sam's/Tiburon ferry/Corinthian YC, Ayala Cove, Sausalito's ferry landing and guest dock, and Horseshoe Cove. You can check them yourself with `python3 tools/crop.py <lat> <lon> <size_m> out.jpg`.
- **Buildings:** OpenStreetMap footprints and heights (© OpenStreetMap contributors, ODbL) for the SF waterfront, Sausalito, Tiburon/Belvedere, Treasure Island, Alcatraz and Angel Island. They are extruded into a few merged meshes with a procedural window shader, and the windows light up at night.
- **Regenerate the data:** `python3 tools/fetch_data.py` (takes about 15 s). Run `python3 tools/fetch_buildings.py` for buildings; it takes a few minutes, and raw tiles are cached in `.cache/osm`.

## Visuals

- **Sky:** physically based atmospheric scattering (Preetham). The sun comes from the real solar position for Oct 3 at 37.8°N, including the low marine-layer haze at the horizon.
- **Lighting:** the sky is turned into image-based lighting for the boats and docks, and the sun casts soft shadows in a box that follows your boat.
- **Water:**
  - Reflections of the actual hills, city, bridges and sky, from a cube map refreshed about once a second.
  - Fresnel reflection and a GGX sun-glitter path that widens with the wind.
  - Bay water that is turbid green-gray in the channels and browner over the mudflats.
  - Light scattering through wave crests, tiling ripple normals, and wind catspaws.
  - Choppy-water reflections are blurred by mip bias, and wave backs seen at grazing angles fade to the horizon color, so chop doesn't break up into hard facets.
- **Atmosphere:** height-based aerial perspective and sun-side scattering are applied to every material through one shared shader chunk. Distant hills go blue-gray, and the haze glows warm toward the sun.
- **Sky:** a twilight glow and the pink Belt of Venus at sunrise and sunset, a deep-blue polarized look on clear days, and a navy night sky with twinkling stars.
- **Fog:** a layered marine fog that is dense at sea level and thins above, with patchy banks drifting on the wind.
- **Post-processing:** an HDR scene goes through quarter-resolution bloom, ACES tone mapping, a filmic split-tone grade (cool shadows, warm October highlights), an analytic sun glow with lens ghosts, and a vignette. It costs about one extra full-screen pass, and the Battery preset turns it off.
- **Fog:** Karl the Fog sits outside the Gate and spills over the Marin Headlands as the afternoon goes on.

## UI

The UI is styled after simulators such as Arma 3 and Euro Truck Simulator 2: flat smoked-glass panels, hairline frames, condensed type (Barlow Condensed, with a system fallback when offline) and one amber accent. Every control on the helm panel shows its key, and the key lights up while it is held.

## What's modeled

- **Geography:** the shoreline, islands, piers 1–45 and 14–40, Fort Mason, Aquatic Park, both bridges (with collidable towers), downtown landmarks, and the hills around the bay.
- **Docks:** Pier 40 / South Beach Harbor, Pier 1½, the Ferry Building gates, Pier 39 (with sea lions), Aquatic Park, the SF Marina, Horseshoe Cove, the Sausalito ferry landing and guest dock, Sausalito Yacht Harbor, Schoonmaker, Clipper, the Waldo Point houseboats, Sam's, Guaymas, the Tiburon ferry, Corinthian YC, SFYC with the Belvedere Cove moorings, Ayala Cove docks and moorings, the Alcatraz dock, and Clipper Cove / Treasure Isle Marina.
- **Dock Guide:** every location has an info card in the chart (`M`, then click a name) covering layout, approach, how busy it gets on a Saturday, wind and current, and hazards.
- **Bathymetry:** the Golden Gate is deep. Richardson Bay is mudflat outside the marked Sausalito channel (reds to starboard heading in). Rocks include Anita Rock, Point Blunt, Little Alcatraz and others, and the tide changes depth. You can strike a prop or run aground.
- **Tidal currents:**
  - The ebb and flood streams run through the Gate, the Slot, Raccoon Strait, the city front and under the Bay Bridge.
  - There is a back eddy along the city front.
  - The water is still inside the coves and marinas.
  - Currents are visible on the water as drifting flecks and on the chart.
- **Wind:** follows the October pattern, building from a calm morning to a 15–21 kn afternoon westerly. It is strongest in the Slot, with gusty williwaws in the lee of Sausalito and Belvedere and sheltered water in Ayala and Clipper coves.
- **Chop:** depends on wind, fetch and wind-against-current, so the ebb at the Gate gets steep. Speed in chop causes slamming.
- **Boat physics:** a 3-DOF maneuvering model in the style of Fossen, structured like Thor Fossen's open-source *PythonVehicleSimulator* (`otter.py` / `gnc.py`).
  - Rigid-body plus added mass (`Xu̇ = -0.1m`, `Nṙ = -1.2Iz`, sway from strip theory for a planing hull). The Coriolis/centripetal terms produce the Munk moment.
  - Hoerner cross-flow drag integrated over 16 hull strips.
  - Both outboard lower units are modeled as steerable lifting foils, with stall and post-stall drag.
  - Hull lateral lift aft, plus a deep-V RIB resistance curve with a planing hump. Prop thrust falls off with speed. Measured performance: 0–40 kn in about 14 s, about 50 kn flat out, about 55 kn trimmed, and about 5 kn idling in gear.
  - The inflatable collar acts as a fender all the way round, so bumps and scrapes do far less damage than on a hard hull.
  - Astern thrust is about 0.58 × ahead. Prop walk on a counter-rotating pair, and first-order engine/propeller lag.
  - Wind uses a center of effort that shifts with apparent-wind angle. The current sets the boat.
  - Dock lines are tension-only ropes. A bow thruster is included.
- **Traffic (~200+ vessels):**
  - Container ships, tankers and car carriers use the deep-draft lanes. Ships announce themselves on VTS ch 14 and sound 5 short blasts at you.
  - Golden Gate, SF Bay Ferry, Blue & Gold and Alcatraz ferries run real-ish routes. They dwell at terminals and sound a prolonged blast when they leave.
  - Red & White, Blue & Gold and Hornblower tour loops.
  - Two sailboat race fleets with marks, plus cruising sailboats that tack within their no-go zone.
  - Powerboats, some of which ignore the rules.
  - Fishing boats drifting on their spots, a tug with a 250 m tow, and law enforcement patrols.
  - Kayaks and SUPs, Aquatic Park swimmers with tow-buoys, Crissy Field kiteboarders (when the wind is up) and jet skis.
  - Anchored ships in Anchorage 7, and a cruise ship at Pier 27.
- **Night:** correct navigation light sectors (masthead, sidelights, stern, towing and anchor lights).
  - The city's windows light up and the Bay Lights LED sculpture ripples across the west span's cables.
  - Both bridges' deck lamps are on, and the towers' red aviation beacons blink.
  - Every light, including the boats' nav lights, throws a shimmering streak across the water.
- **Fleet Week:**
  - **Aircraft:** six Blue Angels F/A-18E/F Super Hornets plus Fat Albert, their C-130J. They fly the Delta pass, Diamond 360, sneak pass, opposing knife-edge, Diamond loop, Delta breakout, and a Fat Albert low pass.
  - **Air show detail:** aircraft bank and pitch to follow their flight paths, and smoke trails drift downwind. Jet noise arrives with the speed-of-sound delay, Doppler shift and distance muffling.
  - **The water:** a USCG safety zone is marked with yellow buoys and patrolled. An amphibious assault ship, a destroyer and a national security cutter lie at anchor, and about 240 spectator boats pack the front row.

## Accuracy disclaimer

This is a training aid built from approximations. Coastline, dock layouts, depths, currents, routes and facility details are simplified reconstructions. **Never navigate by it.** Use NOAA charts 18649 and 18653, the current tables, the USCG Navigation Rules, and confirm dock rules, fees and availability with each facility.

## Code map

`src/geo.js` (projection, coastline, signed-distance field, bathymetry) · `env.js` (tide, currents, wind, chop, sun) · `docks.js` (marinas, guest spots, Dock Guide text, collision index) · `world.js` (water shader, terrain, city, bridges, particles) · `boat.js` (player physics) · `traffic.js` (AI and nav lights) · `nav.js` (AI path-finding graph) · `rules.js` (COLREGS/Inland classification) · `scenarios.js` (scenarios and grading) · `hud.js` (instruments, radar, chart) · `audio.js` · `radio.js` · `main.js`.
