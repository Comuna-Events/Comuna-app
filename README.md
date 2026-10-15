# Comuna (installable on iPhone/Android)

## 1. Get it on GitHub (using VS Code)

1. In VS Code, open this folder (`site/`) or drag these files into a new repo folder.
2. Open the built-in Source Control panel → **Publish to GitHub** (or run `git init`, `git add .`, `git commit -m "initial commit"`, then push to a new repo from github.com).
3. Make sure `index.html`, `manifest.json`, `service-worker.js`, and the `icons/` folder all end up in the **root** of the repo (not nested in a subfolder), GitHub Pages serves from the root by default.

## 2. Turn on GitHub Pages

1. On github.com, open the repo → **Settings → Pages**.
2. Under "Build and deployment", set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Save. GitHub gives you a URL like:
   `https://yourusername.github.io/your-repo-name/`
   It can take a minute or two to go live the first time.

## 3. Open it on your phone

- **iPhone (Safari):** open the URL above → tap the **Share** icon → **Add to Home Screen**. It now opens full-screen with its own icon, no browser bar.
- **Android (Chrome):** open the URL → tap the **⋮** menu → **Install app** (or Chrome may prompt you automatically). Same result: a real home-screen icon.

Once installed, the dev harness (title, jump bar, restart button) is hidden automatically so it feels like the real app. Tap the small 🛠 icon in the top-right corner any time to bring the dev tools back, useful when you're testing with the team, not needed for outside testers.

## Notes

- This is still a front-end-only build: nothing you do in it is saved to a server, and closing/reopening resets anything not saved to Supabase (events, accounts, RSVPs, check-ins). See the "productizing" conversation for what it takes to wire up a real backend.
- If you want a shareable link in the next five minutes without touching GitHub Pages settings, you can also drag this whole folder onto https://app.netlify.com/drop for an instant temporary URL, useful for a quick same-day test before wiring up the permanent GitHub Pages link.
