# Atlas Journeys

A responsive international travel booking demonstration built with Express, server-side sessions, and SQLite. It includes account registration/sign-in, a seeded destination and package catalog, server-priced booking requests, customer order tracking, cancellation, and role-checked administration.

The trip search suggests countries worldwide for both origin and destination and filters a growing set of sample trips across the Americas, Africa, Europe, Asia, and Oceania. A country without a sample itinerary remains searchable but is not presented as bookable inventory.

**Demo boundary:** The sample itineraries, prices, reviews, and promotions are illustrative. Booking requests are not reservations. No airline, hotel, tour provider, ticketing system, email service, or payment processor is connected. Orders remain unpaid, provider confirmations are never fabricated, and cancellation refund amounts are estimates only.

## Requirements

- Node.js 20 or later and npm
- Windows, macOS, or Linux
- No separate database server or native build tools are required. SQLite is persisted locally using the portable `sql.js` WebAssembly runtime.

## Install and run on Windows PowerShell

From the project folder:

```powershell
npm install
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Copy the generated value into `.env` as `SESSION_SECRET`. Do not commit `.env` or share the secret. The example file is configuration guidance only.

Then start the app:

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). On the first start, the app creates `data/travel.sqlite`, applies `schema.sql`, and seeds sample destinations and packages. The local database and session files are ignored by git.

To use a different port or data location, edit `.env`. `DB_FILE` and `SESSION_DIR` can point to persistent writable paths.

## Create an administrator

With the server stopped and `.env` configured, run:

```powershell
node admin.js admin@example.com atlasadmin
```

Enter a strong password at the masked terminal prompt. The command hashes it with bcrypt and creates or promotes that account to the `admin` role. Sign in with the email or username; the Admin link appears for administrator accounts.

## Tests

```powershell
npm test
```

The HTTP workflow test covers password validation and hashing, registration, username login, booking creation, unpaid payment status, cross-account order privacy, cancellation eligibility, and duplicate-cancellation rejection.

## Production configuration

Set `NODE_ENV=production`, use a newly generated `SESSION_SECRET`, configure `DB_FILE` and `SESSION_DIR` on durable private storage, and terminate HTTPS at the application or a trusted reverse proxy. Production cookies are marked `Secure`; serve the app only over HTTPS. Back up the SQLite database and session directory, apply least-privilege filesystem permissions, and monitor failed-login traffic. The sample file-backed session store is suitable for a single-instance demonstration deployment; use a shared production session store for multiple app instances.

Do not expose the database, session files, or `.env` publicly. Configure a real payment provider and travel supplier API before describing any order as paid or any travel service as reserved. Provider webhooks must be authenticated and should be the only source of payment or supplier-confirmation status.

## Project structure

```text
server.js             Express API, auth, session, validation, and booking rules
admin.js              Secure administrator bootstrap command
schema.sql            Relational SQLite schema and constraints
public/index.html     Responsive travel site and account/admin dialogs
public/styles.css     Responsive visual system and layouts
public/app.js         UI behavior and API integration
tests/booking.test.js HTTP workflow and ownership checks
.env.example          Local configuration template
```
