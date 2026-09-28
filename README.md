# Company Hub (production version, phase 1 + 2)

Works on Android, iPhone and desktop from one codebase. Built with React (Vite), Supabase (database, login, files, live chat) and an installable web app (PWA). An Android APK is built automatically by GitHub.

**Included now:** secure login, four roles (admin, HR, accountant, employee), people management, announcements, admin/HR-created groups, private 1-to-1 messages, file attachments in chat.
**Already secured in the database, screens coming next:** attendance (server time), leave requests and approval, ledger, invoices, audit log, department document folders (General, Finance, HR, Legal).

## 1. Create the database (about 10 minutes)
1. Sign up at supabase.com, create a project, and save the database password.
2. Open **SQL Editor > New query**, paste all of `supabase/schema.sql`, click **Run**. It must finish without errors.
3. **Authentication > Providers > Email:** turn OFF "Allow new users to sign up" so only people you add can log in.
4. **Authentication > Users > Add user:** add yourself first (tick auto-confirm). **The first user becomes admin.** Then add the other employees the same way.
5. **Project Settings > API:** copy the Project URL and the `anon public` key.

## 2. Put the code on GitHub and deploy
1. Create a private GitHub repository and upload this whole folder.
2. At vercel.com click **Add New > Project**, import the repo. Framework: Vite.
3. Add two environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with your values. Deploy.
4. In Supabase **Authentication > URL Configuration**, set Site URL to your Vercel address.

## 3. Install on phones
- **iPhone:** open the Vercel address in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the menu, then **Install app**.

## 4. Get the Android APK
1. In GitHub: **Settings > Secrets and variables > Actions**, add the same two values as secrets (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
2. Open the **Actions** tab, choose **Build Android APK**, click **Run workflow**.
3. When it finishes (about 5 to 10 minutes), download `company-hub-apk` from the run page and unzip it. Send `app-debug.apk` to staff; they allow "install unknown apps" once.
4. This is a debug-signed APK, fine for internal use. Google Play needs a signed release build later.

## 5. iPhone app in the App Store (optional)
A native iOS build needs a Mac with Xcode and a paid Apple Developer account. The home-screen install above works without either.

## Notes
- Change the company time zone in `today_local()` inside `schema.sql` if you are not in India.
- Admins cannot read other people's DMs or groups. That is deliberate.
- The `anon` key is safe to expose; the row-level security rules in `schema.sql` protect the data. Never put the `service_role` key in this app.
- Back up: Supabase Pro plan includes daily backups. Check current pricing.
