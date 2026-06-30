# Speed Edit

Edit with the keyboard and the mouse wheel — no clicking, no dragging.

Hold a key and roll the wheel over the image to move that slider. It's the fast
path for high-volume editing: one hand on the keyboard, one on the wheel, and you
never reach for a slider handle. Capture One ships this natively; Speed Edit
brings it to Safelight.

## How to use it

1. Open a photo in **Develop**.
2. **Hold** a bound key — for example `A` for Exposure.
3. **Roll the wheel** up to increase, down to decrease. A readout appears over the
   image showing the slider and its live value.
4. **Release** the key. The whole scrub lands as a single undo step.

Hold **Shift** while scrolling for fine steps. It works anywhere over the Develop
view while the key is held, not just on the image — you don't have to aim.

## Default bindings

| Key | Slider      | Key | Slider      |
|-----|-------------|-----|-------------|
| `A` | Exposure    | `T` | Temperature |
| `Z` | Contrast    | `Y` | Tint        |
| `H` | Highlights  | `V` | Vibrance    |
| `S` | Shadows     | `C` | Saturation  |
| `W` | Whites      | `Q` | Clarity     |
| `B` | Blacks      | `E` | Dehaze      |
| `R` | Texture     |     |             |

These avoid the keys Develop already uses (`G`, `D`, `F`, `J`, `O`, `[`, `]`,
`Tab`). Sharpening is also available to map.

## Configure it

**Preferences ▸ Speed Edit:**

- **Enable Speed Edit** — master on/off.
- **Show value readout on the image** — the on-canvas HUD while you scrub.
- **Invert wheel direction** — flip up/down.
- **Fine-step multiplier (Shift)** — how small a fine step is (default `0.2`).
- **Key bindings** — remap any key to any slider and set its step-per-notch.
  Click a key cell and press the key you want; pick the slider; tweak the step.
  Duplicate keys and keys already used by Develop are flagged.

The slider list also includes scrubbable sliders contributed by **other installed
extensions** (any float/int control with a declared range), when your Safelight
build exposes them. A binding to an extension that's since been removed simply
goes inert and is marked *unavailable* until it returns.

## How it behaves

- Each notch calls the **same** Develop control the built-in sliders use, so the
  panels and histogram update live as you scroll.
- It's **view-and-value only**: it never touches the render path, thumbnails or
  export. What you scrub is exactly what you could have moved by hand.
- Bare keys only — `Ctrl`/`Cmd`/`Alt` combinations are left alone, so your other
  shortcuts (Undo, etc.) keep working while editing.

## Requirements

Safelight with the extension settings + `develop-canvas-overlay` slot APIs
(`minAppVersion` 2.4.3).

## License

MIT — see [LICENSE](LICENSE).
