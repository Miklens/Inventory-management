# Deploy email (Cloud Functions) without running anything on your computer

Your **website** is already online (e.g. Netlify). The **email function** is deployed to **Firebase** when you **push code to GitHub**. GitHub Actions runs the deploy in the cloud – you don’t need Node.js or Firebase CLI on your PC.

---

## One-time setup – choose one method

**Method A: Service Account key (recommended – no URL, no terminal)**  
**Method B: Firebase CI token (needs a browser or your PC once)**

---

## Method A: Service Account key (easiest – no URL)

All steps in the **browser**; no Cloud Shell, no `firebase login:ci`, no URL.

### Step 1: Download the service account key

1. Open **Firebase Console**: https://console.firebase.google.com  
2. Select your project (same as in `firebase-config.js`).  
3. Click the **gear icon** (Project settings) → **Service accounts**.  
4. Click **Generate new private key** → **Generate key**.  
5. A JSON file will download. Open it in Notepad (or any editor).  
6. **Copy the entire file** (all content from `{` to `}`). You’ll paste it into GitHub in the next step.

### Step 2: Add GitHub secrets

1. Open your **GitHub repo** → **Settings** → **Secrets and variables** → **Actions**.  
2. **New repository secret**  
   - Name: `FIREBASE_SERVICE_ACCOUNT`  
   - Value: paste the **entire** JSON (the whole file you copied).  
   Save.  
3. **New repository secret** again  
   - Name: `FIREBASE_PROJECT_ID`  
   - Value: your Firebase project ID (e.g. `inventory-management-d2ace`, from Firebase Console or `firebase-config.js`).  
   Save.

### Step 3: Deploy the email function

You need to **run the deploy** once (and whenever you change the email function later). Choose one:

**Option 1 – Run from GitHub (no push needed)**  
1. Open your repo on GitHub.  
2. Click the **Actions** tab.  
3. In the left sidebar, click **Deploy Firebase Functions**.  
4. On the right, click **Run workflow** → **Run workflow**.  
5. Wait until the run turns green (about 1–2 minutes). The email function is then deployed to Firebase.

**Option 2 – Push a change**  
1. Change any file in the **`functions`** folder (e.g. add a space in `functions/package.json` and save), or change **`firebase.json`**.  
2. Commit and **push** to the **main** branch (e.g. from Cursor, or by uploading the file on GitHub).  
3. Go to **Actions** and open the new run. Wait until it finishes. The email function is then deployed.

After Step 3, you do **not** need `FIREBASE_TOKEN` or Cloud Shell. Later, any push that changes `functions/` or `firebase.json` will deploy again automatically.

---

## Method B: Firebase CI token (if you prefer)

You only need a **Firebase CI token** and **GitHub secrets**. Getting the token can be done in Cloud Shell (sometimes no URL appears) or on your PC once.

### Step 1: Get a Firebase CI token (in the browser)

1. Open **Google Cloud Shell** (free, in-browser):  
   https://shell.cloud.google.com  
   Sign in with the same Google account you use for Firebase.

2. **Use the terminal only** – do not put these in a file or run them as a script.  
   At the bottom of Cloud Shell you’ll see a **terminal** with a prompt like `user@cloudshell:~$`.  
   Click inside that terminal and run **one command at a time**:

   **First command** (install Firebase CLI):
   ```bash
   
   ```npm install -g firebase-tools
   Press **Enter**. Wait until it finishes (no errors).

   **Second command** (get the token):
   ```bash
   firebase login:ci
   ```
   Press **Enter**.

3. A **URL** will appear in the terminal (e.g. `https://accounts.google.com/...`).  
   **Open that URL in a new browser tab**, sign in with your Firebase/Google account if asked, then you’ll see a page that shows a long **token** (starts with something like `1//...`).

4. **Copy the whole token** from that page and keep it somewhere safe (e.g. Notepad). You’ll paste it into GitHub in the next step.

**If no URL appears in Cloud Shell:** use **Method A** (Service Account key) above instead – no URL needed.

**Or get the token on your PC (one time):** install Node from https://nodejs.org, open Command Prompt or PowerShell, run `npm install -g firebase-tools` then `firebase login:ci`. A browser will open; after you sign in, the token appears in the terminal. Copy it and add it as `FIREBASE_TOKEN` in GitHub (Step 2 below).

### Step 2: Add the token to your GitHub repo

1. Open your **GitHub repo** (e.g. `Miklens/Inventory-management`).
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Name: `FIREBASE_TOKEN`  
   Value: paste the token you copied.  
   Save.

### Step 3: Set Firebase project (recommended)

So the workflow deploys to the **same** project as your app (the one in `firebase-config.js`):

1. In GitHub go to **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `FIREBASE_PROJECT_ID`  
   Value: your Firebase project ID (e.g. `inventory-management-d2ace`).  
   You see it in Firebase Console (project settings) or in `firebase-config.js` as `projectId`.

If you don’t add this secret, the workflow uses the default project for the account you used in `firebase login:ci` (fine if you have only one project).

---

## From now on: just push

1. **Edit your code** (e.g. in Cursor or on GitHub).
2. **Push to the `main` branch** (or merge a PR into `main`).
3. If you changed anything under **`functions/`** or **`firebase.json`**, GitHub Actions will run and deploy the email function to Firebase.  
   You can watch it: **Actions** tab → **Deploy Firebase Functions** → open the latest run.

No need to run `npm install` or `firebase deploy` on your computer.

---

## Set Gmail (so emails actually send)

The function needs your Gmail address and an **App Password** (not your normal password). Set them once in Firebase:

1. **Create an App Password**  
   Google Account → Security → 2-Step Verification → App passwords → generate one for “Mail”.

2. **Put it in Firebase**  
   In **Firebase Console** → your project → **Functions** → **Configuration** (or **Environment variables**):  
   - `EMAIL_USER` = your Gmail (e.g. `you@gmail.com`)  
   - `EMAIL_APP_PASSWORD` = the 16-character App Password  
   - `APP_URL` = your app URL (e.g. `https://miklensinventory.netlify.app`) – optional, for the “Open Application” link in emails.

If your Firebase project doesn’t show env vars for functions, use the Firebase CLI **once** (e.g. in Cloud Shell):

```bash
firebase functions:config:set email.user="you@gmail.com" email.app_password="xxxx xxxx xxxx xxxx" app.url="https://miklensinventory.netlify.app"
```

Then redeploy the function once (push a small change under `functions/` so the workflow runs again, or run the workflow manually from the Actions tab).

---

## Summary

| Step | Where | What you do |
|------|--------|-------------|
| One-time | **Method A:** Firebase Console → Project settings → Service accounts | Generate new private key, copy full JSON |
| One-time | **Method A:** GitHub → Settings → Secrets | Add `FIREBASE_SERVICE_ACCOUNT` (paste JSON) and `FIREBASE_PROJECT_ID` |
| One-time | **Method B:** Cloud Shell or your PC | Get `FIREBASE_TOKEN` with `firebase login:ci`; add as GitHub secret |
| One-time | Firebase Console → Functions → Configuration | Set Gmail: `EMAIL_USER`, `EMAIL_APP_PASSWORD`, `APP_URL` |
| Every time | Just push to GitHub | GitHub Actions deploys the email function; you don’t run anything on your computer |
