<div align="center">

<img src="public/shapeup_logo.png" width="96" alt="ShapeUp logo">

# ShapeUp

**Try a haircut on your own head in 3D before you sit in the chair.**

[![Site](https://img.shields.io/badge/site-tryshapeup.cc-b5533c.svg)](https://tryshapeup.cc)
[![Tests](https://img.shields.io/badge/tests-313%20passing-green.svg)](#quality-checks)
[![Stack](https://img.shields.io/badge/stack-Next.js%20%C2%B7%20Convex%20%C2%B7%20three.js-black.svg)](#how-it-works)
[![Security](https://img.shields.io/badge/security-policy-lightgrey.svg)](SECURITY.md)

[https://tryshapeup.cc](https://tryshapeup.cc)

</div>

<p align="center">
  <img src="docs/media/tryon-turntable.gif" width="400" alt="One 3D head turning once around while it tries on 24 hairstyles in six colours">
</p>

## Overview

Current hairstyle experimentation consists of AI image generation, filters, or scrolling reference images online. This has one fundamental issue:

**Your head is not 2D** 

Any filter or image, no matter how accurate or inaccurate, is still one angle of our heads. From the perspective of barbers - if you were to design a gingerbread house, would you design it more precisely given one angle of the house, or the interactive 3D blueprint? Moreover, multiple generated snapshots require triple the cost of ShapeUp's pipeline and run the risk of drift across views.

So, we took a stab at both of these problems. ShapeUp takes one selfie, reconstructs the person's head as a 3D Gaussian splat, generates candidate hairstyles onto it, and lets them turn the result around in the browser. Barbers get the same scan translated into a deterministic cutting ticket rather than an incomplete reference or "a vibe".

## How it works

```
┌──────────────────────────────────────────────┐
│  CAPTURE        selfie upload or live scan   │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  BALDIFY        image edit removes the hair  │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  RECONSTRUCT    Gaussian-splat head on a GPU │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  STYLE          hairstyles generated onto it │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  VIEW AND SAVE  3D viewer, projects, tokens  │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  BARBER OUTPUT  measured, deterministic cut  │
└──────────────────────────────────────────────┘
```

Reconstruction takes about 15 to 20 seconds on a GPU worker behind [src/lib/facelift.ts](src/lib/facelift.ts). Due to compute limitations, we run on-demand inference, so your first generation will also be ~20 seconds slower. The barber ticket comes from a feasibility pass that classifies every order before any model call; see [NOTES.md](NOTES.md).

Our pipeline leverages Weijie Lyu's Facelift for 3D reconstruction, with a heavily prompt-engineered Nano Banana 2 generation between edits to prepare valid blueprints equipped with necessary constraints for hair type and style. On our deployed website (https://tryshapeup.cc), we require a Biometric Agreement so we can legally process a selfie and render it. We collect scans, but only for debugging purposes - these scans are automatically deleted if you were to revoke the Biometric Agreement. Lastly, for user convenience, we handle all inference free-of-charge, at the courtesy of AWS/Modal. 

We have uploaded this repository to share the process for anyone who isn't comfortable with data being collected but would love to experiment. Enjoy!

## Installation

```sh
npm install
touch .env.local             # Clerk, Convex, S3, Stripe, Gemini keys and FACELIFT_URL
```

Convex functions live in `convex/`; read `convex/_generated/ai/guidelines.md` before editing them.

## Quick start

```sh
npm run dev                  # http://localhost:3000
npm run facelift             # show or switch the reconstruction upstream (auto | oscar | modal)
```

## Quality checks

```sh
npm run typecheck && npm run lint && npm test   # definition of done
npm run test:e2e                                # Playwright flows
```

Current state on `main`: typecheck clean, 39 Vitest files with 313 tests passing, 4 Playwright specs.

## Limitations

- If cloned, reconstruction requires an external GPU worker and its shared secret; without them the studio cannot create scans.
- Splat quality follows the input photo. Hats, heavy occlusion, and low light degrade the head model.
- Generated hairstyles are previews, not measurements. The barber ticket is derived from measured zones and falls back to deterministic text wherever the model output contradicts them.
- Biometric data handling is described in [COMPLIANCE_NOTES.md](COMPLIANCE_NOTES.md); report issues per [SECURITY.md](SECURITY.md).

## Repository

| Path | Contents |
|---|---|
| `src/app/` | App Router pages: studio, dashboard, barber flow, pricing, admin, API routes |
| `src/components/` | Viewer, capture, booking, dialogs, with colocated tests |
| `convex/` | Backend functions, accounts, tokens, refunds |
| `server/` | GPU workers: reconstruction deployments, baldifier, PLY editing |
| `scripts/` | Upstream switcher, S3 CORS, preview baking |
| `e2e/`, `test/` | Playwright specs and shared fixtures |

## Acknowledgements

Single-image head reconstruction builds on [FaceLift](https://github.com/weijielyu/FaceLift). Rendering uses [three.js](https://threejs.org) and [react-three-fiber](https://github.com/pmndrs/react-three-fiber); the stack is [Next.js](https://nextjs.org), [Convex](https://convex.dev), [Clerk](https://clerk.com), and [Stripe](https://stripe.com). ShapeUp was first built at HackPrinceton as `shapeup-hackprinceton`.
