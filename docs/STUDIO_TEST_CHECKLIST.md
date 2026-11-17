# The Studio test checklist

A walk-through of everything built since the last time anyone looked at it.
Nothing here has been seen by a human yet — every check so far has been
structural (byte order, counts, the test suite). **You are the first eyes on
it.** Bring a notebook, not a phone: this is where you find the things that
are wrong rather than merely unfinished.

Roughly 15–20 minutes if you go briskly.

---

## Before you start

Work on a copy, so you can break things freely:

```bash
cd ~/path/to/timewright
cp -r examples/napoleon ~/tw-test
./start-studio.sh ~/tw-test
```

The browser should open on its own. If it does not, the address is on the
screen: `http://127.0.0.1:5175/`.

Stop the Studio with **Ctrl-C** in the terminal.

> If the Studio does not come up at all, stop here and send me the terminal
> output — that is the one failure I cannot see from here.

---

## A. The Studio opens (Phase 1)

- [ ] The Studio loads with a map and a sidebar — **not a blank page**.
- [ ] A place that opens a sub-map shows a small **`↘`** badge, and **one
      click** on it opens the sub-map.
- [ ] The **Preview** button shows a working viewer, not a blank page.

## B. The Studio keeps a clock (Phases 3–4)

- [ ] There is a bar under the canvas with a date box and **Go**.
- [ ] Typing a date and pressing Go redraws the world at that day.
- [ ] **‹ Prev / Next ›** step through the events.
- [ ] Dragging the **playhead** moves the date.
- [ ] **At Date** vs **All Time**:
  - [ ] In *At Date*, a place that did not exist yet is **dimmed**.
  - [ ] A ship (a mobile place) is drawn where it actually was that day, and
        is not on the map at all on a day it was nowhere.
  - [ ] In *All Time*, everything is shown at once.
- [ ] **Saving an event moves the clock** to that event's date.

## C. The tabs and the forms (Phase 5)

- [ ] The tabs read **Maps → People → Locations → Events → World**, each with
      a count.
- [ ] Clicking the map opens a **New Location** form with the map and the
      coordinates already filled in, and the name field focused.
- [ ] The unsaved place shows as a **hollow pin** on the map.
- [ ] **Escape** cancels the draft, and the hollow pin goes away.
- [ ] A location's **"+ Event Here"** opens a **New Event** form with the day
      already filled in.
- [ ] An event's characters are **pills** you can click; a name cannot be
      misspelled. **"+ Add"** lets you add a new character mid-scene.
- [ ] The **Maps** tab says a map is still a placeholder and offers to take a
      real image.
- [ ] Uploading a real map image works, and the map shows it.

## D. Badges and lists (Phases 2 & 4)

- [ ] A place with events carries a **number badge** on its pin.
- [ ] The place's form lists **"Events at this Location"**, and clicking one
      opens that event.
- [ ] The badge count matches the number of events in the list. (If they
      disagree, that is a real bug — tell me.)

## E. A rename carries its references (Phase 6 — the newest thing)

This is the one that used to lose data, so it is worth doing carefully.

- [ ] Pick a place that has events on it (in Napoleon: **Waterloo**).
- [ ] Rename it: **Waterloo → Waterloo Field**.
- [ ] The status line says something like *"saved … — N references followed"*
      with **N greater than zero**.
- [ ] The place still shows its **event badge** — the events did not fall
      off.
- [ ] Open the event: it still names the place, and it still says *where* it
      happened.
- [ ] In the YAML on disk, the event's `where:` now reads `Waterloo Field`.
- [ ] Rename a **map** — the places that sit on it are still on it.
- [ ] Rename a **person** — the events that list them still list them.
- [ ] Run this in a second terminal — it must be clean:

  ```bash
  node dist/cli/index.js validate --world ~/tw-test
  ```

  No "unknown reference", and nothing else broken.

- [ ] Now break it on purpose: rename a place to a name **another place
      already has**. The references should be left alone rather than
      silently pointed at the wrong place, and `validate` should say the two
      names collide.

## F. Build the site (the whole way through)

- [ ] **Build site** produces a `.zip`; unzip it and open `index.html` — the
      site works.
- [ ] **Single file** produces one `.html`; open it — the site works.
- [ ] In the viewer:
  - [ ] A place pin carries the **count of its events**.
  - [ ] Opening a place shows an **"Events here"** section, oldest first.
  - [ ] Clicking an entry there opens that event **and moves to where and
        when it happened**.
  - [ ] An event placed on raw coordinates has its marker at **exactly** that
        spot.

## G. On a phone, if you have one

- [ ] The map fills the screen; the card slides up from the bottom.
- [ ] The step bar and the timeline strip are reachable with a thumb.
- [ ] Dragging the map does not scroll the page.

## H. Your call — the part only you can answer

- [ ] Anything that looks **wrong, ugly, confusing or slow**.
- [ ] Anything you expected to be there and it is not.
- [ ] Anything where the wording is unclear.

Note each one as you hit it, with the place it happened (which tab, which
record). A list of ten small annoyances is worth more than one big
complaint.

---

## If something breaks

Send me:

1. What you did (which tab, which record).
2. What you saw instead.
3. The browser's console (F12 → Console) — the red lines.
4. The terminal output from the Studio, if it said anything.

And for a world that will not validate, the output of:

```bash
node dist/cli/index.js validate --world ~/tw-test --json
```
