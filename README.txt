This is a static no-build deployment package for Vercel.

Use this repo/package when npm install is failing on Vercel.
There is intentionally NO package.json here, so Vercel can serve the site as static files without a Node install step.

Recommended Vercel settings:
- Framework Preset: Other
- Build Command: leave blank
- Output Directory: .

If you already have a linked Vercel project, clear any old overrides for Install Command / Build Command.
