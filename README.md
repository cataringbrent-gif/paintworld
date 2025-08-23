# Multiplayer Paint (Static + Supabase)

A static front-end that renders a world grid and saves paints to Supabase. No backend server required.

## Tech
- MapLibre GL for map rendering
- Supabase (Postgres + Auth) for persistence
- Pure static hosting (Vercel)

## Prerequisites
- Supabase project with:
  - Anonymous Auth provider enabled (Authentication > Providers > Anonymous)
  - A `paints` table with RLS enabled and policies:
    - Read: anyone can select
    - Write: only row owner can insert/update/delete
- Project URL and anon public key

## Configure Supabase
This project is currently hardcoded in `index.html` head:

```html
<script>
  window.SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
  window.SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';
</script>
```

You can change those values directly.

## Run locally
Open `index.html` in your browser. It will:
- Create a Supabase client using the hardcoded URL/key
- Sign in anonymously
- Load paints
- Poll every ~2s for updates

## Deploy to Vercel (recommended via GitHub)
1) Push this folder to a GitHub repo
2) In Vercel: New Project -> Import your repo
3) Settings:
   - Framework preset: Other
   - Build Command: None
   - Output Directory: .
   - Root Directory: /
4) Deploy

Vercel will treat this as a static site and serve `index.html`. See `vercel.json` for routing.

## Deploy via Drag-and-Drop (quick demo)
Go to https://vercel.com/new and drop the folder. Use the same settings (Other, no build, output `.`).

## Notes
- The previous `server/` directory is deprecated and not needed. You can remove it.
- Security: the anon key is safe for clients. Ensure RLS is correctly configured.

## License
MIT
