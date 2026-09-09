# Onyx — tower renders needed for a working 360° turntable

Hand this page to whoever produces the project's 3D visuals. It is a shooting
brief: follow it and the tower rotates in the showcase with every floor still
clickable, with no further design work.

## What exists today

One full-tower render: `tower.webp`, 1600 × 960, a three-quarter aerial. The
showcase already overlays 35 clickable floor bands on it, fitted to the real
slab lines in that image (max error ≈ 3.4 px).

Two other images exist — a ground-level arrival shot and a close aerial of the
amenity deck — but neither shows the whole tower, so neither can rotate and
neither can carry floor hotspots. They are shown in the interface as "more
views of the project", clearly labelled as such.

The rotation mechanism is already built and waiting. It is switched off, on
purpose, because one image cannot rotate. Supply the set below and it switches
itself on.

## What to deliver

**Number of angles.** 16 angles at 22.5° steps is the recommendation — that
reads as smooth rotation on a drag. 8 angles at 45° is the minimum that still
reads as a turntable rather than a slideshow. 36 at 10° is film-quality if the
budget is there.

**The camera must not change between shots.** This is the whole trick, and the
most common way a turntable set fails:

- fixed elevation (camera height / pitch angle above the horizon)
- fixed distance from the building's centre
- fixed focal length — no zoom changes, no lens swaps
- fixed target: the camera orbits the same point on the tower's vertical axis
- the tower must stay in the same place and at the same size in every frame

In practice: place the camera on a circle, aim it at the tower's axis, and step
the azimuth. Do not hand-frame each shot.

**Lighting.** Identical sun position, sky, exposure and colour grade in every
frame. A sun that moves between angles makes the building appear to flicker.

**Output.** Identical resolution for every frame. Match `tower.webp` at
1600 × 960 as a floor; **2400 × 1440 is better** — it gives room to zoom into a
floor without the façade going soft. Deliver a lossless master (PNG 16-bit or
TIFF) plus, if convenient, the render's depth/object passes; we convert to
optimised WebP ourselves.

**Naming.** Azimuth in degrees, zero-padded to three digits, where 000 is the
existing `tower.webp` angle and the numbers increase clockwise seen from above:

```
tower-000.png   tower-022.png   tower-045.png   tower-067.png
tower-090.png   tower-112.png   ...             tower-337.png
```

Re-render angle 000 as part of the set even though we have it — it must match
the others' camera and lighting exactly.

**Dusk (optional, high value).** A second complete set shot at dusk, same
camera positions, named `tower-dusk-000.png` and so on, enables a day/dusk
toggle. A dusk toggle cannot be faked from a daytime render — a warm wash reads
as a photo filter, not a time of day — so it needs real frames or nothing.

## What we do when the files land

Per angle, mechanically:

1. Convert the master to WebP at the delivered resolution and drop it in
   `public/showcase/onyx/`.
2. Run the derive script against that image:

   ```
   node scripts/derive-onyx-tower-map.mjs public/showcase/onyx/tower-045.webp \
     --strip 700,860,60,790 --check /tmp/a45.png
   ```

   `--strip x0,x1,y0,y1` is the column of façade to measure in that image's own
   pixels; the script guesses it by scaling the angle-0 strip, and you correct
   it once by looking at the render. It detects the slab lines, fits the floor
   pitch, and prints a ready-to-paste calibration block plus the residual.
3. Open the `--check` PNG. The bands must sit on the painted slab lines, floor
   35 immediately under the crown, floor 1 on the podium. If the bands float off
   the façade, re-run with `--leftX0 --leftSlope --rightX0 --rightSlope
   --vanishX --vanishY` until they hug it. This is the only judgement call, and
   it takes a few minutes per angle.
4. Paste the printed block as a new entry in `ONYX_TOWER_VIEW_INPUTS` in
   `src/lib/showcase/onyx-tower-views.ts`, with its `azimuthDeg`, image size and
   label.

Once more than one entry exists, the drag-to-rotate, the left/right arrow keys
and the angle scrubber all appear on their own, and each angle's floor hotspots
come from its own calibration. Adjacent angles are preloaded and decoded before
they are shown, so rotation does not flash.

## What we will not do

We will not manufacture the missing angles by mirroring, warping or generating
them. This building is being sold from these images; an invented elevation
would misrepresent it. The framework is finished — the renders are the only
thing missing.
