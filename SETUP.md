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

## Getting Claude to run these commands for you

If you are reading this in the web version of Claude, it is running in a
datacentre — a different computer from yours. It cannot see `C:\Users\...`,
cannot reach a database on your machine, and cannot type into your PowerShell.
That is why it keeps handing you commands to paste.

**Install Claude Code on this PC and that stops.** It then runs the commands
itself, reads the errors itself, and fixes them without the copy-paste loop.

You already have Node.js, so:

```
npm install -g @anthropic-ai/claude-code
```

Then, in the project folder:

```
cd C:\Users\anild\AP-Govt-Employees
claude
```

Sign in when it asks. From then on you can simply say *"finish the setup"* or
*"the calculator is broken, fix it"*, and it will do the work on this machine.

There is also a desktop app if you prefer clicking to typing — see
https://code.claude.com/docs for both options.

> Everything already done still applies. It is the same project, the same
> files, the same Git history — only who types the commands changes.

---

## Running Claude Code on your own PC (moving off the web version)

This project was built with Claude Code running in a browser sandbox. On your
own PC two things are different, and both are good news:

**1. Nothing needs merging.** This branch is the repository's default branch,
so a plain clone brings everything.

### First, the two programs the project runs on (one-time)

The project needs **Node.js** (the engine) and **pnpm** (the installer). In
PowerShell, check what you have:

```
node -v
```

If that prints an error, install Node.js first — either of these works:

- In PowerShell: `winget install OpenJS.NodeJS.LTS`
- Or go to https://nodejs.org and run the green **LTS** installer with all the
  default choices.

**Then close PowerShell and open a new one** — Windows only notices newly
installed programs in a fresh window. Now:

```
node -v
```

It should print v22 or higher. Then allow PowerShell to run the installers'
helper scripts — Windows blocks them by default, and without this both `npm`
and `pnpm` fail with a red "running scripts is disabled" message. This changes
the setting for your user account only, which is the safe, standard choice:

```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Answer **Y** if it asks. Now install pnpm and confirm it answers:

```
npm install -g pnpm
pnpm -v
```

(Skip `corepack enable` even if a guide elsewhere suggests it — on Windows it
tries to write into `C:\Program Files`, which needs an administrator window,
and the two commands above achieve the same thing without one. The project
pins its own pnpm version, and pnpm switches to it automatically.)

> Tip: paste commands exactly as written and nothing more. A note like
> "← one time only" after a command is for your eyes, not for PowerShell —
> pasting it along makes the command fail.

### Then the project itself

```
git clone https://github.com/anildca1-ui/AP-Govt-Employees.git
cd AP-Govt-Employees
pnpm install
```

(You have already cloned? Just `cd AP-Govt-Employees` and run `git pull` to
pick up the latest, then `pnpm install`.)

### A Windows note about the checking scripts

`pnpm test`, `pnpm build` and `pnpm lint` work in PowerShell directly. The two
all-in-one wrappers — `pnpm gate` and `pnpm verify:all` — are shell scripts,
and Windows runs those through **Git Bash**, which was installed on your PC
along with Git. Open the Start menu, type "Git Bash", and run them there:

```
cd ~/AP-Govt-Employees
pnpm gate
pnpm verify:all
```

Everything else in this guide works the same in PowerShell.

**2. The internet is open now.** The sandbox could not reach any AP government
website, which is why the GO library is still empty. Your PC can. Once `.env`
has your database values (Steps 1–3) and `SCRAPER_CONTACT_EMAIL` is a real
address you monitor, these commands — which were impossible before — will work:

```
pnpm --filter @ap-emp-ai/ingest fetch:seeds     # download the 15 known GO PDFs
pnpm --filter @ap-emp-ai/ingest scrape:goir 30  # crawl goir.ap.gov.in politely
pnpm --filter @ap-emp-ai/ingest index:documents # make approved GOs searchable
```

Every downloaded GO lands in the review queue for you to approve — nothing
publishes itself.

One-time setup on a new machine, so the verification suite can drive a
browser:

```
pnpm exec playwright install chromium
```

Then two commands tell you the project is healthy, exactly as they did in the
sandbox:

```
pnpm gate          # lint, types, all 633 tests, build
pnpm verify:all    # starts the site and checks it in a real browser
```

Everything else in this file is unchanged — the steps below work the same on a
PC as they did on the web.

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

## Two ways to get a database — pick one

The portal needs a database. There are two routes, and you can switch later.

| | **A — On your own PC** | **B — Supabase cloud** |
|---|---|---|
| Account needed | **None** | Free Supabase account |
| Cost | Free forever | Free tier |
| Command | `pnpm setup:local` | `pnpm setup:env` |
| Also needs | Docker Desktop installed | nothing |
| Can the public reach it? | **No** — only this PC | **Yes** |
| Good for | Building and checking everything | Actually launching |

**Option A is the honest answer to "is there a free local alternative?"** — it
is Supabase's own software running on your machine, in Docker, with the same
Postgres, the same API and the same auth. It costs nothing, needs no account,
and is already configured in this project. Everything works: the GO library,
the admin review queue, sign-in, the chat. The one thing it cannot do is serve
other people, because it lives on your computer and stops when you shut down.

If you want to see the whole site working today with no signups, do Option A.
When you are ready for AP employees to use it, do Option B — nothing you build
is lost, it is one command to point at the cloud instead.

### Option A — the database on your PC

1. Install **Docker Desktop** from https://www.docker.com/products/docker-desktop
   and open it. Wait until it says it is running.
2. Then:

   ```
   pnpm setup:local
   ```

That starts the database, applies every table, writes your settings file and
prints an admin password. No values to copy. First run takes a few minutes
while it downloads.

Then skip to **Step 4** — Steps 1 to 3 are the cloud route, and this has
already done all three.

Later, `pnpm db:stop` shuts it down; `pnpm setup:local` starts it again.

> Other databases people suggest — Neon, Railway, plain Postgres — give you
> only the storage part. This portal also uses Supabase's API layer, its
> row-level security and its phone sign-in, so those would each need code
> rewritten. Supabase-on-your-PC is the free alternative that needs no changes
> at all.

---

## Step 1 — Create the database in the cloud (Option B)

1. Go to **https://supabase.com** and create an account.
2. Click **New project**. Give it any name. Choose the region closest to Andhra
   Pradesh — **Mumbai (ap-south-1)** — so pages load quickly for your visitors.
3. Set a database password when asked, and save it somewhere safe.
4. Wait for the project to finish setting up. This takes a couple of minutes.

Then open **Project Settings → API** and leave that page open. Three values on
it are what the next step asks for:

- **Project URL**
- **anon public** key
- **service_role** key

> The `service_role` key bypasses every security rule. It belongs only in your
> settings file and in your hosting provider's settings. Never put it in a
> message, a screenshot, or the website itself.

---

## Step 2 — Let the setup command write your settings

Back in PowerShell:

```
pnpm setup:env
```

It asks for those three values one at a time — by the same names they have on
the Supabase page — writes the settings file for you, and invents a strong
admin password so you do not have to think one up.

**Copy that password somewhere safe when it appears.** It is what protects the
page where Government Orders get approved, and it is not shown again.

> The settings file is called `.env`. It holds your keys and is never uploaded
> to GitHub — that exclusion is deliberate. To edit it by hand later,
> `notepad .env` opens it.

---

## Step 3 — Create the tables

The database is empty. It needs the tables the portal expects. This is one
copy and one paste.

1. Open the file **`supabase/all-migrations.sql`** in this project. In
   PowerShell, this opens it in Notepad:

   ```
   notepad supabase\all-migrations.sql
   ```

2. Select all of it (`Ctrl+A`) and copy (`Ctrl+C`).
3. In Supabase, open **SQL Editor** in the left sidebar, paste (`Ctrl+V`), and
   press **Run**.
4. Wait for **Success**.

That single file contains every table, index and security rule, already in the
right order — you do not have to manage the order yourself.

> Run it once. If you run it a second time you will see red errors saying
> things *"already exist"*. That is not damage: it means the database is
> already built, and the second run simply stops.

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

`pnpm dev` compiles the shared calculation code before it starts the site, so
the first run takes a few seconds longer than later ones. You should see
`✓ workspace packages built: calc, rag, ingest` scroll past. If that line is
missing and a calculator page later says *Module not found*, run the compile
on its own to see why:

```
pnpm packages:build
```

Wait for **Ready**, then open the address it prints next to **Local:** —
usually **http://localhost:3000**. If an older copy of the site is still
running, it will say something like *"Port 3000 is in use ... using available
port 3001 instead"* and print `http://localhost:3001`. Use the address it
actually prints; the old port is still serving the older code.

The first page you click also compiles on demand — that one can take up to a
minute; every visit after is instant.

Leave that window open: it *is* the website. Closing it, or pressing `Ctrl+C`
in it, switches the site off.

You should see the portal in Telugu, with a language toggle in the corner.

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
