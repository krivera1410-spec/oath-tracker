# OATH Violation Tracker — Deployment Guide
## Deploy to your own domain in ~45 minutes, no coding required

---

## WHAT YOU'LL SET UP
1. **Supabase** — free database that stores all your data permanently
2. **Clerk** — handles team logins (free up to 10 users)
3. **Vercel** — hosts the app and gives you a URL (free, or $20/mo for custom domain)
4. **GitHub** — holds the code so Vercel can deploy it (free)

---

## STEP 1 — Create a GitHub account and upload the code (10 min)

1. Go to **github.com** and create a free account
2. Click **"New repository"** (the green button)
3. Name it: `oath-tracker`
4. Set to **Private**, click **Create repository**
5. On the next screen, click **"uploading an existing file"**
6. Upload ALL the files from this folder, maintaining the folder structure
7. Click **"Commit changes"**

---

## STEP 2 — Set up Supabase database (10 min)

1. Go to **supabase.com** → Sign up with Google or email
2. Click **"New project"**
   - Organization: create one with your company name
   - Project name: `oath-tracker`
   - Database password: create a strong password and **save it**
   - Region: **US East (N. Virginia)**
   - Click **Create new project** (takes ~2 min to spin up)

3. Once ready, click **SQL Editor** in the left sidebar
4. Click **"New query"**
5. Open the file `supabase-schema.sql` from this folder
6. Copy the entire contents and paste into the SQL editor
7. Click **Run** — you should see "Success. No rows returned"

8. Go to **Settings → API** in the left sidebar
9. Copy and save these two values — you'll need them in Step 4:
   - **Project URL** (looks like: `https://abcdefgh.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

---

## STEP 3 — Set up Clerk logins (10 min)

1. Go to **clerk.com** → Sign up
2. Click **"Add application"**
   - Name: `OATH Tracker`
   - Sign-in options: check **Email address** and **Password**
   - Click **Create application**

3. You'll land on the API Keys page. Copy and save:
   - **Publishable key** (starts with `pk_live_...`)
   - **Secret key** (starts with `sk_live_...`)

4. In the left sidebar, go to **Users**
5. Click **"Invite"** or **"Create user"** for each team member:
   - Office admin
   - Fleet/safety manager
   - Any additional staff
   - They'll receive email invites to create their password

---

## STEP 4 — Deploy on Vercel (10 min)

1. Go to **vercel.com** → Sign up **with your GitHub account**
2. Click **"Add New Project"**
3. Find your `oath-tracker` repository and click **Import**
4. Under **Framework Preset**, select **Next.js**
5. Expand **"Environment Variables"** — add each of these:

   | Variable Name | Value |
   |---|---|
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Your Clerk publishable key |
   | `CLERK_SECRET_KEY` | Your Clerk secret key |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
   | `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | `/` |
   | `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | `/` |
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |

6. Click **Deploy**
7. Wait ~2 minutes for the build to complete
8. Vercel will give you a URL like `oath-tracker-yourname.vercel.app`

**That's your live app.** Share that URL with your team.

---

## STEP 5 — Add a custom domain (optional, $20/mo)

If you want `violations.yourcompany.com` instead of the Vercel URL:

1. In Vercel, go to your project → **Settings → Domains**
2. Enter your desired subdomain (e.g., `violations.yourcompany.com`)
3. Vercel will show you a DNS record to add
4. Log into wherever your domain is managed (GoDaddy, Cloudflare, etc.)
5. Add the CNAME record Vercel shows you
6. Wait 5-10 minutes — your custom domain is live

Upgrade to Vercel Pro ($20/mo) for the custom domain feature.

---

## MONTHLY COSTS SUMMARY

| Service | Cost | Notes |
|---|---|---|
| Supabase | Free | Up to 50,000 rows (~5+ years of data) |
| Clerk | Free | Up to 10 monthly active users |
| Vercel | Free | `yourapp.vercel.app` URL |
| Vercel Pro | $20/mo | Only if you want custom domain |
| **Total** | **$0–$20/mo** | |

---

## TROUBLESHOOTING

**Build fails on Vercel:**
- Check that all 8 environment variables are entered correctly
- Make sure there are no spaces before/after the values

**"Not authorized" error when opening the app:**
- Check your Clerk publishable key is correct
- Make sure the sign-in URL variables are set to `/sign-in` and `/sign-up`

**Data not saving:**
- Check your Supabase URL and anon key are correct
- Make sure you ran the SQL schema script in Step 2

**Adding a new team member:**
- Go to clerk.com → your app → Users → Invite user
- They get an email to set their password
- No code changes needed

**Adding a new vehicle to the fleet:**
- Open `src/lib/config.ts` in GitHub
- Find the `KNOWN_VEHICLES` section
- Add a new line following the same pattern
- Commit the change — Vercel redeploys automatically in ~2 min

---

## YOUR DATA IS SAFE

- All data is stored in Supabase — it persists forever regardless of Vercel/Clerk
- Supabase automatically backs up your database daily
- If you ever want to export everything: Supabase → Table Editor → select table → Export CSV
