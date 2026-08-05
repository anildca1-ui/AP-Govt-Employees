# Putting the portal online

This is written for someone who is not a programmer. Every step is either
clicking around a website or copying a value into a file. Nothing here requires
you to understand the code.

At any point, run this to see where you are:

```
pnpm setup:check
```

It prints what already works, what does not yet, and what each missing piece
would unlock.

---

## What you are building

The portal has parts that switch on independently. You do **not** need all of
them to launch.

| Part | Needs | Worth launching without? |
|---|---|---|
| 13 calculators | nothing | They already work |
| GO library, news, admin review | a database | This is the real first step |
| AI chat | a Google AI key | Yes — add it after launch |
| Automatic GO collection | an email address you monitor | Yes — you can add GOs by hand first |
| Telegram / WhatsApp bots | accounts with those services | Entirely optional |

**A sensible first launch is the calculators plus the GO library.** Those two
alone beat every site this is meant to replace.

---

## Step 1 — Make a copy of the settings file

In the project folder:

```
cp .env.example .env
```

`.env` is where every setting goes. It is never uploaded to GitHub — it holds
your passwords and keys, and it is deliberately excluded.

Open it in any text editor. You will paste values into it as you go.

---

## Step 2 — Create the database (free)

1. Go to **https://supabase.com** and create an account.
2. Click **New project**. Give it any name. Choose the region closest to Andhra
   Pradesh — **Mumbai (ap-south-1)** — so pages load quickly for your visitors.
3. Set a database password when asked, and save it somewhere safe.
4. Wait for the project to finish setting up. This takes a couple of minutes.

Now collect three values. In your Supabase project, go to
**Project Settings → API**:

| On that page | Paste into `.env` as |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |

> The `service_role` key bypasses every security rule. It belongs only in
> `.env` and in your hosting provider's settings. Never put it in a message, a
> screenshot, or the website itself.

While you are in `.env`, invent a password for the admin page and put it in
`ADMIN_TOKEN`. This is what you will type to reach `/admin`, where Government
Orders wait for your approval. Make it long; anyone with it can approve
documents.

---

## Step 3 — Create the tables

The database is empty. It needs the tables the portal expects.

1. In Supabase, open **SQL Editor** in the left sidebar.
2. Open the folder `supabase/migrations/` in this project. It contains six
   files whose names begin with numbers.
3. **In number order**, open each file, copy all of it, paste it into the SQL
   Editor, and press **Run**. Wait for "Success" before the next one.

Order matters — each builds on the one before.

Check it worked:

```
pnpm setup:check
```

Under **Database** it should say *connected, and the tables are in place*.

---

## Step 4 — See it running on your own machine

```
pnpm install
pnpm dev
```

Open **http://localhost:3000**. You should see the portal in Telugu, with a
language toggle in the corner.

Try a calculator — DA arrears, say. It will work immediately, because
calculators do their arithmetic in the browser and need no database.

The GO library will be empty. That is correct: no Government Orders have been
added yet.

> **The rates carry a warning, and it is not decoration.** Every pay and DA rate
> was taken from public summaries, not from the GO PDFs themselves. Each one
> shows an orange "not yet checked against the GO" notice. Before you tell
> anyone about this site, check those figures against the real GOs and remove
> the flags. A wrong DA percentage becomes a wrong rupee figure on somebody's
> phone, and that is the one mistake this project cannot recover from.

---

## Step 5 — Put it on the internet

1. Go to **https://vercel.com** and sign in with GitHub.
2. **Add New → Project**, and pick this repository.
3. Before deploying, open **Environment Variables** and add every line from
   your `.env` file. Copy the names exactly.
4. Set `NEXT_PUBLIC_SITE_URL` to the address Vercel gives you.
5. Click **Deploy**.

A few minutes later you have a public address. Everything that worked locally
works there.

---

## Step 6 — Fill the library with Government Orders

Two ways in, and you can use both.

**By hand, immediately.** Go to `/admin` on your site, enter your
`ADMIN_TOKEN`, and upload a GO PDF. It is queued, you approve it, and it
appears in the library. Nothing is published without your approval — that rule
is enforced by the database, not by the code.

**From the starter list.** A list of Government Order PDFs is already prepared
in `config/go-sources.json` — DA orders, the 2022 pay revision, pension
revisions. Put a real email address you read into `SCRAPER_CONTACT_EMAIL`, then:

```
pnpm --filter @ap-emp-ai/ingest fetch:seeds
```

It downloads each one into your review queue. Everything shown in the library
still comes from the PDF itself and still needs your approval — the notes in
that file are only hints about what each document should turn out to be.

**From the GO website.** Put the same email in place, then:

```
pnpm --filter @ap-emp-ai/ingest verify:selectors
```

This visits goir.ap.gov.in once and reports whether the collector understands
the page layout. It downloads nothing.

- If it reports rows, run `pnpm --filter @ap-emp-ai/ingest scrape:goir` to
  collect the last 30 days into your review queue.
- If it reports a problem, **send the output to your developer.** It prints
  everything needed to fix it in one go.

> The email address is not a formality. It is sent to every government site the
> collector touches, and it is how an administrator contacts you instead of
> blocking your server. The collector refuses to run without one.

### Making them searchable

Approving a GO puts it in the library. One more step makes the AI chat able to
find and quote it:

```
pnpm --filter @ap-emp-ai/ingest index:documents
```

Run it after a batch of approvals. It is safe to run any time — it skips
everything already done, so a run that stops halfway costs nothing.

You will not normally run this yourself. The nightly job does it automatically
after each crawl. It is here because the first batch you approve by hand will
otherwise sit in the library unsearchable until the next night, and that looks
like the chat is broken when it is not.

> **Why it is a separate step.** Turning a GO into something searchable costs a
> fraction of a rupee per document and takes a few seconds. Doing it inside the
> approve button would make every approval slow, and a batch of three hundred
> unbearable.

---

## Step 7 — Switch on the AI chat

1. Go to **https://aistudio.google.com/apikey** and create a key.
2. Paste it into `.env` as `GEMINI_API_KEY`, and into Vercel's environment
   variables.
3. The chat also needs an "embedding" key, which is what lets it find the right
   GO for a question. Either an OpenAI key (`OPENAI_API_KEY`) or a DeepInfra
   key (`DEEPINFRA_API_KEY`) works.

The chat only answers from Government Orders that you have approved. If it
cannot find one, it says so rather than guessing. That is deliberate and should
not be changed.

---

## If something is wrong

| What you see | What it means |
|---|---|
| Pages load but the GO library errors | The database settings are wrong, or the Supabase project is paused. Free projects pause after inactivity — open Supabase and resume it. |
| `/admin` will not let you in | `ADMIN_TOKEN` differs between your `.env` and Vercel. |
| Chat says it cannot find anything | Normal when no GOs are approved yet. Approve some first. |
| The collector refuses to start | `SCRAPER_CONTACT_EMAIL` is missing or is not a real address. |

`pnpm setup:check` is the fastest way to see which of these applies.

---

## Before you tell people about it

- [ ] Check every rate against its GO and clear the "not yet checked" flags
- [ ] Approve enough GOs that the library is useful — a few hundred, not a few
- [ ] Ask the chat ten hard questions in Telugu and read the answers yourself
- [ ] Confirm `/privacy` and `/disclaimer` read correctly in both languages
- [ ] Confirm every page footer says this is not an official government website

The last one is already built and tested. The first is the one that matters
most, and only a person who knows AP service rules can do it.
