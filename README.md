# 🎞️ Excalidraw Timelapse

> Turn the history of your Excalidraw diagram into a presentation that **morphs** from one version to the next. ✨

📦 **One single file** · 🔌 **No internet needed** · 🖥️ **No server** · 👆 **Double-click and present**

---

## 🤔 What is this?

You keep improving the same diagram and save a new version every now and then:
`2026-09-24.excalidraw`, `2026-09-25.excalidraw`, `2026-09-27.excalidraw` …

This tool packs all of them into **one `diagram.html`**. Open it, press **Space**, and your diagram smoothly
transforms into the next version: boxes glide to their new place 🟦➡️🟦, colors blend 🎨, new things fade in 🌱,
removed things fade out 🍂. You decide when to move on, so you can talk through every step. 🗣️

It looks exactly like Excalidraw, because it uses the real Excalidraw drawing engine under the hood. ✏️

---

## 🚀 Quick start

```text
📁 your snapshots  →  📝 manifest.json  →  🏗️ build  →  🎬 diagram.html
```

### 1️⃣ 📁 Collect your snapshots

Put all your `.excalidraw` files into one folder.

> 💡 **Tip:** make each new version by opening the previous file, changing it, and using **Save as**.
> Excalidraw then remembers which shape is which, so the tool knows "this is the *same* box as yesterday"
> and can **move** it instead of just fading it out and back in. 🎯

### 2️⃣ 📝 Say in which order they belong

Create a file called `manifest.json` in the same folder and list your snapshots **in the order you want to show them**:

```json
{
  "frames": [
    "2026-09-24.excalidraw",
    { "file": "2026-09-25.excalidraw", "label": "Added a cache" },
    "2026-09-27.excalidraw"
  ]
}
```

- 🔢 The order is **exactly** the order of this list. Nothing is sorted or guessed.
- 🏷️ `label` is optional. It is the text shown in the timeline (otherwise the file name is used).

### 3️⃣ 🏗️ Build your `diagram.html`

Pick whichever you prefer. Both give the same result. 👇

#### 🐳 Option A: with Docker (nothing else to install)

(Optional: Build the tool yourself:)

```bash
docker build -t excalidraw-timelapse .
```

Then, whenever you want a presentation, point it at your folder:

```bash
docker run --rm -v "/path/to/my-snapshots:/data" dubhar/excalidraw-timelapse
```

✅ A fresh `diagram.html` appears in your folder. The container does its job and disappears.

<details>
<summary>🪟 Windows, 🐧 Linux and extra options</summary>

- **Windows (PowerShell):** `docker run --rm -v "${PWD}\my-snapshots:/data" excalidraw-timelapse`
- **Linux:** the new file is owned by `root`. Add `--user "$(id -u):$(id -g)"` to `docker run` to own it yourself.
- **Options:** just add them at the end, for example
  `docker run --rm -v "..." excalidraw-timelapse --title "Sprint 12" --transition-ms 2000`

</details>

#### 🐍 Option B: with Python

You only need Python 3.10 or newer. There is nothing to install. 🎉

```bash
python pack.py my-snapshots/manifest.json
```

✅ `diagram.html` is created next to where you ran the command. Use `-o somewhere/talk.html` to choose a different name or place.

🧪 **Want to try it first?** The folder [`examples/`](examples) contains four little snapshots:

```bash
python pack.py examples/manifest.json
```

### 4️⃣ 🎬 Present!

Open `diagram.html` in your browser (double-click is enough) and use:

| ⌨️ Key | 🎯 What happens |
| --- | --- |
| **Space** or **→** | ▶️ morph to the **next** version |
| **←** | ◀️ morph back to the **previous** version |
| **Home** / **End** | ⏮️ ⏭️ jump to the first / last version |
| **F** | 🔍 fit the whole diagram on screen again |

🖱️ You can also click the buttons ‹ › or the dots in the timeline at the bottom, and use the mouse wheel to zoom or drag to move around.

Nothing ever moves on its own: **you** are in control. 😎

---

## 🪄 What exactly gets animated?

| In your drawing | In the timelapse |
| --- | --- |
| 🟦 A shape that moved, grew, turned or changed color | ➡️ glides and blends smoothly |
| ↗️ An arrow or line that got a new bend | ➰ bends smoothly |
| ✍️ A freehand scribble that changed | 🌊 flows into the new shape |
| 🌱 A brand new element | fades **in** |
| 🍂 A deleted element | fades **out** |
| 🔤 Text that was edited, or a shape that changed type or line style | 🔀 crossfades from old to new |

The camera stays put for the whole presentation and shows everything that ever appears, so nothing jumps around. 📷

---

## 🔒 Works completely offline

Copy `diagram.html` to any computer, even one that has **never** seen the internet, and it just works. ✈️🏝️

- 🧳 Everything is inside the one file: drawing engine, fonts (including Asian languages 🌏), your diagrams and images.
- 🛡️ The file also tells the browser to refuse any network connection, so it cannot "phone home". 📵
- 📏 The price: the file is about **26 MB**, mostly fonts. Perfectly fine for a USB stick. 💾

---

## 🙋 Something went wrong?

The tool checks everything **before** it creates your file, and tells you in plain words what to fix. 🩺

| 💬 Message | 🛠️ What to do |
| --- | --- |
| `manifest not found` | 📝 Create `manifest.json` in your snapshot folder (step 2). With Docker, check that the folder is mounted as `/data`. |
| `file not found` / `listed more than once` | 🔎 Check the spelling of the file names in `manifest.json`. |
| `not valid JSON` / `not an Excalidraw file` | 💥 That file is damaged or isn't an `.excalidraw` file. Re-save it from Excalidraw. |
| `references fileId … missing` | 🖼️ An image in that file is incomplete. Open and save it again in Excalidraw. |
| `is in the folder but NOT in the manifest` | ⚠️ Just a hint: that snapshot is not included. Add it to the manifest if you want it. |
| `no element ids in common` | ⚠️ Those two versions look unrelated (for example created via copy & paste instead of *Save as*). They will simply crossfade. |
| `embeddable … placeholders` | 🌐 Web embeds (YouTube etc.) can't work offline, so they show as empty boxes. |

> 😕 Still stuck? Run the build again and read the lines marked `✗`. They point at the exact file.

---

<details>
<summary>🧰 For the curious: updating Excalidraw or changing the player</summary>

The ready-made player lives in the folder `vendor/`, so building a diagram needs only Python (or Docker). 🐍

Its source is in `player/`. It uses the official `@excalidraw/excalidraw` package from npm, exactly as published, plus
React. To update Excalidraw or tweak the player you need [Node.js](https://nodejs.org) 20+:

1. ✏️ Change the version in `player/package.json` (or edit the files in `player/src/`).
2. 🔨 Run `python pack.py --rebuild-player examples/manifest.json -o /tmp/test.html`.
3. 👀 Open the result and click through it.
4. 🐳 Rebuild the Docker image so it contains the new player.

🔤 Fonts: Excalidraw asks the internet for its fonts. The player intercepts that request (`player/src/offline.ts`) and
serves the fonts stored in the page instead, so no Excalidraw code had to be modified.

</details>
