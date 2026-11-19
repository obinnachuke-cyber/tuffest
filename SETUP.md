# Tuffest setup: make it follow your login

Do these in order. About 20 minutes, all free to start.

## 1. Create the backend (Supabase)
1. Go to **supabase.com** → sign up → **New project**. Name it `tuffest`, pick a region near you, set a database password (save it somewhere).
2. Open **SQL Editor → New query**, paste everything from `app/supabase-setup.sql`, press **Run**. It should say "Success".
3. Open **Authentication → Providers → Email** and switch **off** "Confirm email" (simplest for the two of you; leave it on if you'd rather confirm by email).
4. Open **Project Settings → API**. Copy:
   - **Project URL** (looks like `https://abcd.supabase.co`)
   - the **anon public** key

## 2. Put the two values in the app
Open `app/config.js` and paste them in:

```js
supabaseUrl: 'https://abcd.supabase.co',
supabaseAnonKey: 'eyJ...',
```

(`mapsKey` can go in the same file later, so no phone needs it pasted by hand.)

## 3. Host it
Go to **app.netlify.com/drop** and drag the whole `app` folder onto the page. Open the link on your phone.

## 4. First login
- **You:** tap "New here? Create an account", use your email + a password, leave the space code empty.
- Open **settings** in the app: your **space code** is there.
- **Your partner:** creates her account on her phone and types your space code. Same vibes, both phones.
- Anything already on your phone is uploaded the first time you sign in.

## Good to know
- Each phone keeps a copy, so it opens instantly and works offline. It syncs when it's back online.
- Signing out removes the local copy from that phone (it stays in the cloud).
- Don't share the `service_role` key anywhere. Only the `anon` key goes in `config.js`.

## Share a vibe by link (optional, one more step)
This lets you send a link to one vibe over Messages; anyone can open it without an account, and under the vibe there's an **Add vibe** button that asks them to sign up.

1. In Supabase, open **SQL Editor → New query**, paste everything from `app/supabase-share.sql`, press **Run**.
2. Push the repo to GitHub (it now includes `netlify.toml` and `netlify/functions/share.js`). Netlify picks both up by itself; no settings to change.
3. In Tuffest, tap **share** on a vibe, then **Share as a link**. **Stop sharing** turns the link off again.

The preview shown in Messages (title, caption, first photo) comes from the small function in `netlify/functions/share.js`.
