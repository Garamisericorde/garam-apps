# g-vector — a small vector editor

Illustrator's capability where it matters, Paint's directness everywhere else.
Pen and curvature tools, gradients you can grab, and smart guides that work.

Read the monorepo `CLAUDE.md` first; this file only records what is specific
here, and why.

## Current state

Phases P0–P3 are in. Everything below is built and working:

- document model, SVG renderer, viewport (pan/zoom/fit)
- select, move, resize (8 handles), rotate, marquee, undo/redo
- rectangle and ellipse tools
- **the snap engine and the smart-guide overlay**
- **pen, curvature and direct select**, with anchor and handle editing
- **placed bitmaps** (paste, drop, file dialog) and a **layers list**
- inspector (X/Y/W/H/angle/radius, fill, stroke, opacity, arrange)

Not yet: text, the on-canvas gradient editor, the eyedropper, boolean ops,
layer groups, file I/O, packaging. See "Known gaps" for the specific compromises
inside what IS built.

## Rendering: SVG DOM, not Konva

g-snap uses Konva because its document is a bitmap. This one's document is
SVG-shaped, so SVG is the representation and there is no second one:

- **Save and export are the same code path.** No translation layer to keep in
  step, no lossy round trip.
- **A gradient rotation is one number.** The document stores an ANGLE
  (`doc/types.ts`), the renderer derives endpoints from it
  (`render/paint.tsx`). Illustrator stores endpoints, which is why rotating a
  gradient there means finding a handle on a line you first have to reveal.
- **Hit-testing is exact and free.** `document.elementsFromPoint()` already
  knows about the hole in a donut and the gap between two letters
  (`tools/hit.ts`). Re-deriving that from bezier maths would be neither exact
  nor free.
- **The eyedropper, when it lands, copies appearance rather than pixels** —
  the element under the cursor carries its own fill, so the correct behaviour
  is the easy one.

## Drag latency — what made it feel a frame behind

The scene re-renders through React on every pointer move. Chromium already
coalesces pointer input to one event per frame, so the fix is never to throttle
harder — it is to keep the per-frame work under the frame budget. Four things
were costing real time, in rough order of how much:

- **A forced reflow per frame.** `localPoint()` called
  `getBoundingClientRect()` on the canvas from inside the move handler. The
  scene had just been rewritten, so that call flushed a full style-and-layout
  pass every single frame. The canvas's offset only moves when the window does,
  so it is now read on resize and once per gesture (`origin` in `Canvas.tsx`).
  **Never call getBoundingClientRect from a pointermove handler here.**
- **A blur filter inside the repainting layer.** The artboard's shadow was
  `filter: drop-shadow()` on the SVG rect. The scene repaints as a unit, so the
  whole page was re-blurred on every frame of every drag. It is now a
  `box-shadow` on the `.gv-paper` element behind the scene, which does not
  change during a drag and is cached by the compositor.
- **Two render passes per frame in the inspector.** `NumberField` kept its text
  in state and synced it from the prop with an effect. Effects run after paint,
  so every field whose value moved rendered and painted twice — and during a
  resize that is every field, every frame. The draft is now derived, not synced.
- **The whole inspector re-rendering for nothing.** Fill, stroke, opacity and
  arrange can only change through the panel itself, so they read the COMMITTED
  document and are memoised; only the transform numbers follow the drag.

`Scene` also renders each node through a memoised `Shape`, and the document
operations return the same object for untouched nodes — so a drag re-renders
the shape being dragged and nothing else, whatever the document's size.

Remember that `npm run dev` is React in development mode inside `StrictMode`,
which renders every component twice. A drag will always feel heavier there than
in `npm run start`, which runs the built bundle. Compare against that before
chasing a regression.

If it ever needs to go further, the next step is an imperative fast path —
mutate the dragged nodes' attributes directly during a drag and commit on
pointerup — and the store is already shaped for it (`preview` vs `doc`).

## Two coordinate spaces, and only two

- **Document space** — nodes, bounds, snap targets. The scene SVG's `viewBox`
  puts it on screen.
- **Screen space** — CSS pixels inside the canvas element. The overlay SVG sits
  on top at 1:1 and holds every piece of editor chrome.

They meet in `view/viewport.ts` and nowhere else. This is what makes a handle
8 px and a guide 1 px at any zoom, with no `/ zoom` scattered through the
drawing code. Put chrome in the scene and you will be dividing by the zoom for
the rest of the file's life.

The one exception is the grid, which is chrome the artwork has to cover, so it
renders inside the scene through `Scene`'s children slot.

## The snap engine

`snap/` is the point of the app. Three rules run it (`snap/engine.ts`):

1. **The threshold is in SCREEN pixels**, divided by zoom before use. A
   threshold in document units grabs from half a screen away at 10% zoom and
   stops working entirely at 800%. There is a test for exactly this.
2. **One snap per axis.** Two competing latches on the same axis cannot both
   be satisfied, and choosing silently is how an editor starts to feel haunted.
   Ties break towards the more deliberate alignment: anchor > centre > edge >
   grid.
3. **Alignment beats spacing.** If an edge already lined up, the gap hint stays
   quiet rather than pulling the object a pixel off that edge.

Two more things that matter more than they look:

- **Targets are collected once per drag, not per move** (`snap/targets.ts`,
  called from `Canvas`'s `buildContext`). The set cannot change mid-drag, and
  rebuilding it 120 times a second is the difference between guides that feel
  instant and guides that arrive a frame late.
- **Every candidate the settled position sits on gets a guide, not just the
  winner.** Three objects sharing a centre line show one line touching all
  three. Drawing only the winner shows a line to one of them and leaves the
  user guessing about the rest.

**The guides run while a point is being AIMED, not only once it is placed.**
Snapping silently on the click and showing nothing beforehand is the same as
having no guides at all: by the time you can see where the point went, you have
already put it there. `aimDrawPoint` is what both the hover preview and the
click go through, which is the only way the ghost can be trusted — anything the
click decides on its own is something the preview did not show.

**Shift fixes the direction, so the snap chooses the distance** (`snap/ray.ts`).
An ordinary two-axis snap under an angle constraint pulls the point off the ray,
which is the one thing the constraint was asked to guarantee — so the first
version simply switched snapping off while Shift was held, and holding Shift
felt like losing the guides. `snapAlongRay` slides along the ray instead, until
it crosses a line something else is already on. "Hold Shift, run out at 45
degrees, stop level with the left edge" is then one gesture rather than a guess.

Three things can move a point being placed, and exactly one wins: Shift's angle
constraint (with the ray snap picking the distance), the ordinary snap, then
**equal length to the previous segment**.
That last one is the thing no alignment guide can offer — "make this one the
same" — and evenly spaced points are what the eye is worst at judging. A
measurement that latched shows in the accent colour rather than the plain
badge, so the difference is visible without reading the number.

**Ctrl suspends snapping** while it is held. Every editor needs that escape
hatch and most bury it in a preferences pane.

`tests/` pins all of the above — `snap`, `ray`, `paths`, `curvature`, `layers`.
Run them before touching `snap/` or `doc/`:

```bash
npm run test -w g-vector
```

## Path editing

Three tools share one surface (`tools/paths.ts`): the direct select, the pen and
the curvature tool. The view model and the hit-test are built from the SAME
structure, because when they are derived separately an anchor ends up drawn a
pixel or two from where it can be grabbed and neither half explains it.

- **Handles are stored RELATIVE to their anchor** (`doc/path.ts`). Dragging a
  point then moves its handles for free, which is the operation a path editor
  performs more than any other; absolute handles have to be fixed up on every
  move and drift the moment one fix-up is missed.
- **Anchors live in the node's LOCAL space.** Every world-space gesture goes
  through `worldToLocalDelta` first. Skipping it makes a rotated path move
  sideways when you drag an anchor down.
- **Inserting a point must not move the curve.** `insertAnchor` is a De
  Casteljau split, so the two new segments trace exactly what the one segment
  traced. There is a test that samples both and compares. An insert that
  reshapes the outline is the fastest way to make the tool untrustworthy.
- **Handles are shown for the selected anchors AND their neighbours.** Showing
  only the selected point's own handles hides the two that shape the segments
  either side of it.
- **A corner is a square, a smooth point is a circle.** The shape carries what
  the colour cannot: whether the next drag bends the curve or breaks it.

### The curvature tool

`doc/curvature.ts` is a Catmull-Rom spline converted to cubic beziers: interior
points take the tangent `(P(i+1) - P(i-1)) / 2`, and the whole subpath is
refitted after every edit.

**The open ends are where this goes wrong, and the obvious answer is the wrong
one.** Reflecting the neighbour through the endpoint gives that end a tangent
parallel to its own chord, so the last segment arrives dead straight, the whole
turn piles up at its start, and the control polygon doubles back — a visible
kink just past the point you placed. The ends use the natural cubic condition
instead (`T = (3·chord - T_neighbour) / 2`, second derivative zero), which shares
the curvature across the segment and turns three points on a symmetric arc into
a symmetric arc. `tests/curvature.test.ts` pins both properties, including on
the exact geometry that first showed the kink.

A corner contributes NO tangent, not a small one. Without that, an end segment
next to a corner inherits a tangent from a point that was deliberately made
sharp and balloons to half its chord.

`Anchor.corner` exists only because of the refit: at the moment it runs, a
corner and a point that has not been fitted yet are the same thing (two zero
handles), so the flag is the only thing that survives.

### The preview has to be the answer

A curvature click refits EVERY segment, so a preview of just the new one shows a
curve the click will not produce. `drawGhost` previews the whole subpath for the
curvature tool and tells the overlay to drop that subpath's committed outline
while it does — otherwise two different curves are on screen and neither is the
one you are about to get. The pen previews only the new segment, because that
really is all its click changes.

Shift constrains the next point to 45° from the LAST ONE PLACED, and the ghost
shows the constrained point, not the raw cursor. Shift also suppresses the
point snap: a snap that pulled the point off the angle would take back the only
thing Shift was asked for.

### Drawing tools stay usable after the drawing

Both the pen and the curvature tool edit as well as add — drag a point, pull a
handle, Alt-click to remove one — so finishing a path does not mean changing
tools to touch it. The exceptions are the two points of the path currently being
drawn: its first point closes the path, and its last one retracts its outgoing
handle (pen) or toggles sharp (curvature).

A drawn path is **stroked and not filled** (`createDrawnPath`). An open path
with a fill paints the region between its ends, so the shape default turned a
three-point curve into a swelling blob.

### Live shapes

A rectangle keeps its corner-radius field until a path tool actually EDITS it.
`buildPathViews` shows its anchors from a throwaway `toPathNode`, and the real
`ensurePath` conversion is deferred to the first movement past the drag
threshold (`convert` in the canvas's interaction state). Converting on selection
instead would take the radius away from anyone who only wanted a closer look.
The conversion is deterministic, so the anchor shown is the anchor that moves —
`tests/paths.test.ts` pins that the two agree.

## Bitmaps and layers

**An image is stored as a data URL, not a path.** A document that referenced a
file would break the moment the file moved, and an SVG export would carry a link
that only resolves on the machine it was made on. The main process reads the
chosen file and hands back the data URL (`CHANNELS.IMAGE_PICK`); paste and drop
never leave the renderer. Images arrive unlocked and selected — the first thing
anyone does with a reference is put it where they want it; locking it is the
second thing, and that is what the layers list is for.

`SceneNode` is now a union with a member the path tools cannot touch, so
`isVectorNode` guards every one of them. `toPathNode` takes a `VectorNode` for
the same reason: the compiler refuses rather than the tool silently producing an
empty path.

### Layers

A layer holds many shapes, not the other way round. **Layers hold nothing
themselves**: `doc.nodes` stays one flat list and each node names its layer.
Nesting the nodes inside the layers would rewrite every piece of geometry,
hit-testing and snapping code to walk a tree for no gain — all a layer actually
does is group the paint order, carry a group opacity, and switch a set of
objects on or off together.

The consequences of that, and they matter:

- **`doc.nodes` order is z WITHIN a layer only.** The layer list decides the
  rest. Read `paintOrder(doc)` when the whole stack matters, and never assume
  the last entry is on top — it is only on top of its own layer. The bounds
  fallback in `hitNode` walks that, not the array.
- **Z-order changes stay inside a layer.** "Bring to front" means the front of
  the layer the object is on; reaching past the layer above would make the
  stack a suggestion. Moving between layers is a separate, deliberate gesture,
  and it sends the object to the TOP of its new layer, where it can be seen.
- **A layer's opacity is a GROUP opacity**, so `Scene` emits one `<g>` per
  layer. Two overlapping shapes at 50% each show through one another; the pair
  in a 50% group does not — which is the whole reason a reference at 30% reads
  as one faded picture rather than a pile of translucent parts.
- **A locked layer locks its nodes**, so `node.locked` on its own is never the
  right question. `isEditable` and `isShown` are; every edit, hit-test, snap
  target and renderer goes through them.

**There is always at least one layer, and it is always active.** `removeLayer`
refuses the last one, and `keepLayer` in the store puts the active layer back on
its feet after an undo takes it away. A document with nowhere to put the next
thing drawn is a state nothing else copes with, and every branch written to
handle it would be one that is never exercised until the day it breaks.

**The list is the reverse of both arrays** — `doc.layers` and `doc.nodes` run
bottom to top. That conversion happens on the way in and nowhere else; spreading
it around is the classic layers bug, where the list looks right and every drag
goes the wrong way. Drop targets come from `document.elementsFromPoint` rather
than arithmetic on row heights, which is shorter, survives a row changing
height, and makes "drop an object on a layer row to move it there" the same code
path as reordering among siblings.

**Visibility, lock and name bypass the locked guard** (`setNodeFlags`,
`setLayerFlags`). Every other edit respects it — that is the point of a lock —
but a locked thing that cannot be unlocked is not locked, it is lost.

Dropping a file also has to `preventDefault` at the window: Chromium's default
for an unhandled file drop is to navigate to it, replacing the whole editor with
a bare image and no way back short of restarting.

## Transforms: rigid matrix, geometry resize

A node's `transform` only ever holds rotation and translation. **Resizing edits
the node's local geometry instead of scaling the matrix**, because a matrix
scale takes the stroke with it — a 2 pt outline becomes 4 pt the moment the
shape is dragged twice as wide.

That choice has one consequence worth knowing (`doc/ops.ts`, `scaleNodes`):
scale and rotation only commute when the scale is uniform. A rotated node in a
multi-selection therefore takes a **uniform** scale, by whichever axis the drag
pushed harder. The alternative is a skew the model has nowhere to store. A
single rotated node has no such problem — it is resized in its own space
(`setLocalBox`), which is exact at any angle.

## Known gaps

Deliberate, and each one is commented at the site:

- **No flipping on resize.** A negative box has to mirror the geometry, and a
  path mirrored by a sign in the width is a squash, not a reflection. Handles
  clamp at 1 unit instead.
- **A rotated shape gets no guides while resizing.** Snapping is world-space,
  so it would be measuring the axis-aligned box around the shape rather than
  the box being dragged — worse than no guides.
- **The rotation field applies a turn, not an angle, on a multi-selection.**
  There is no shared starting angle to correct from.
- **No dimension matching** ("same width as that one"). The candidate model is
  per-axis coordinates; sizes would need a second pass.
- **The pen cannot resume an existing open path.** Clicking its end point starts
  a new path rather than continuing the old one.
- **The direct tool cannot drag a whole path by its fill.** Clicking the
  interior selects the node; use the select tool to move it.
- **A pen point costs two undo steps** when it is dragged into a curve: one for
  the anchor, one for the handles. A click that places a corner costs one.

## House rules that bite here

- **Document colour is data, not chrome.** The hex values in `doc/defaults.ts`
  are saved into the file and exported, so they cannot be CSS variables — a
  theme change must not repaint the user's artwork. Everything the EDITOR
  paints with still comes from `@garam/theme`, via the `--gv-*` aliases at the
  top of `styles/index.css`.
- **The theme sheets are imported from `main.tsx`, not `@import`ed from
  `styles/index.css`.** That file loads last; an `@import` inside it would
  re-declare the base tokens after `accent-violet.css` overrode them and put
  the crimson accent back on an app that had chosen violet.
- `NodePatch` in `doc/ops.ts` is an intersection of partials, NOT
  `Partial<Omit<SceneNode, ...>>`. `Omit` over a union keeps only the keys every
  member shares, so that version silently rejects `radius` and `width`.
