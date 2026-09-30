# Third-party licenses

This file lists the third-party resources bundled with the delivered app that are **not** part of the
challenge assets. Runtime and build dependencies (React, PixiJS, TanStack Query, Axios, Zod, Zustand,
MSW, Sentry, Vite, Tailwind CSS...) are listed with their licenses in `pnpm-lock.yaml` and in each
package's own `LICENSE` file inside `node_modules`.

## Fonts

Both families are self-hosted (no request to a font CDN) through the `@fontsource` packages and are
licensed under the **SIL Open Font License 1.1** (https://openfontlicense.org). Only the Latin subsets
of the weights below are bundled. The OFL allows bundling, embedding and redistributing the fonts with
software; they are not sold by themselves and are not modified.

| Font        | Use                              | Weights used  | Package                   | Copyright                                      |
| ----------- | -------------------------------- | ------------- | ------------------------- | ---------------------------------------------- |
| Fredoka     | Headings, buttons, HUD numbers   | 600           | `@fontsource/fredoka`     | Copyright 2016 The Fredoka Project Authors     |
| Nunito Sans | Body text, tables, form controls | 400, 600, 700 | `@fontsource/nunito-sans` | Copyright 2016 The Nunito Sans Project Authors |

The full license text ships with each package: `node_modules/@fontsource/fredoka/LICENSE` and
`node_modules/@fontsource/nunito-sans/LICENSE`. Project pages:

- Fredoka: https://github.com/hafontia/Fredoka-One
- Nunito Sans: https://github.com/Fonthausen/NunitoSans

## Game and UI assets

The sprites, tiles, sounds and reference images in `assets/` (including the UI atlases used by the
menus and HUD) are provided by the challenge. Their licensing terms are those of the challenge
provider; they are not covered by this file.

## Inline icons

The speaker glyph of the sound toggle (`src/ui/game/SoundToggle.tsx`) is an original inline SVG drawn
for this project, because the provided UI sheet has no sound icon.
