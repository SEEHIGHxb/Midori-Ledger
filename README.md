# Midori — Leafy Ledger 🍃

<p align="center">
  <img src="image/midori-animation.svg" alt="Midori — Leafy Ledger" width="680"/>
</p>

Midori (緑) is a premium, feature-rich personal finance ledger themed around modern, secure, and offline-first "Leafy Ledger" design principles. It runs entirely in the browser as a client-side Single Page Application (SPA), utilizing standard HTML5, CSS3, and JavaScript, with local data persistence via browser `localStorage`. 

Midori fully supports:
- **Multi-currency accounts**: USD, EUR, THB, CNY, and JPY with automatic real-time conversion maths.
- **Dynamic Chart.js Analytics**: Monthly savings rates, cash flow trends, and budget category donut graphs.
- **Auto-recurring Recurrences**: Set custom bill bills or paycheck deposits with automated date fast-forward processing.
- **Offline Capabilities**: Full Progressive Web App (PWA) support.

---

## 🚀 Live Hosting Deployment on GitHub Pages

Because Midori is a static SPA, you can host it **100% free** on **GitHub Pages** in under 2 minutes:

### Step 1: Create a GitHub Repository
1. Log into your account on [GitHub](https://github.com).
2. Click **New** to create a new repository.
3. Name it `midori-ledger` (or any name you prefer).
4. Set the repository to **Public** and do not add a README, `.gitignore`, or license. Click **Create repository**.

### Step 2: Push Your Code to GitHub
Open your terminal inside this project directory (`C:\Users\passa\.gemini\antigravity\scratch\finance-ledger-app`) and run the following commands:
```bash
# Initialize a local git repository
git init

# Add all project files
git add .

# Create the initial commit
git commit -m "feat: initial release of Midori ledger PWA"

# Branch rename to main
git branch -M main

# Link to your newly created GitHub repository
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/midori-ledger.git

# Push the code to the main branch
git push -u origin main
```
*(Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username).*

### Step 3: Enable GitHub Pages
1. Go to your repository on GitHub.com and click the **Settings** tab.
2. In the left sidebar under the "Code and automation" section, click **Pages**.
3. Under the **Build and deployment** section, select **Deploy from a branch** in the Source dropdown.
4. Under **Branch**, choose `main` and set the folder to `/ (root)`.
5. Click **Save**.

Within 1 minute, GitHub will generate a public URL for your ledger, typically:
`https://YOUR_GITHUB_USERNAME.github.io/midori-ledger/`

---

## 📱 How to Install Midori on Your Mobile Phone (PWA)

Once your site is live on GitHub Pages (or hosted locally):

### For iOS (iPhone / iPad)
1. Open **Safari** and navigate to your public hosted URL.
2. Tap the **Share** button (square icon with an upward arrow) in the bottom navigation bar.
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name "Midori" and tap **Add**.
5. Midori will install instantly on your home screen with its premium green leaf brand icon and launch in full-screen native standalone mode!

### For Android (Samsung, Pixel, etc.)
1. Open **Google Chrome** and navigate to your public hosted URL.
2. Tap the **three-dot menu icon** in the top-right corner.
3. Tap **Install app** (or **Add to Home screen**).
4. Follow the prompt to install. The application will be added to your home screen and app drawer as a standalone native app shell.

---

## 🛠️ Development

Midori ships as plain `<script>`-tag JavaScript with no build step or bundler — `index.html` must keep working when opened directly via `file://`, since the Android wrapper app loads it that way.

### Running the test suite

A small `node --test` suite covers the riskiest pure logic (currency conversion, input validators, orphaned-transaction cleanup, and recurring-schedule date advancement) by loading the real `js/state.js`/`js/scheduler.js` source files into a headless Node `vm` sandbox — no DOM, no new runtime dependency.

```bash
npm test
```

This only runs at dev time; it has no effect on the deployed static app.

### ⚠️ Android wrapper asset sync — required before every native build

The Android wrapper app (`android-app/`) bundles its own **copy** of the web assets under `android-app/app/src/main/assets`. That copy is **not** automatically kept in sync with the project root — if you edit `index.html`, anything in `js/`, `css/`, or `image/`, or `sw.js`/`manifest.json`, you must re-sync before building/installing the Android app, or it will run stale code:

```bash
npm run sync-android
```

(equivalent to running `sync_android_assets.ps1` directly in PowerShell). Treat this as a mandatory pre-build step, the same way you'd treat a `pip install`/`npm install` before running a project — there is currently no CI/Gradle hook that runs it for you automatically.
