# Build2Better Foundation Website and Login Portal

An Express and MySQL application for the Build2Better Foundation public website and secure sign-in flow. The foundation website is served at `/`; its volunteer and contact forms submit to the backend and save records in MySQL. Sign-in is available at `/login`, authenticates database accounts as `admin`, `staff`, or `volunteer`, and redirects each role to a protected landing page. The administrator dashboard provides an overview of portal activity and lets administrators review website submissions and update their statuses. Staff and volunteer accounts continue to use the protected account landing page.

The original public foundation website is also available at `/build2better_foundation.html`. The legacy `/login.html` URL redirects to `/login`.

The public website's volunteer and contact forms submit to the Express backend and save submissions in MySQL. Successful submissions are confirmed only after the database write completes. The forms use the session CSRF token and have separate rate limits. File uploads are not accepted; do not submit identity documents or photos through the application form.

## Prerequisites

- Node.js 18.18 or newer and npm
- MySQL 8.0 or newer
- A supported SMTP account if users need email-based password resets

## Install

From the project directory:

```sh
npm install
```

Create a local environment file from the example:

```sh
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`. Generate a random session secret of at least 32 characters and set it in `.env`; for example, use `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and copy the output into the file. Never commit `.env`.

## MySQL setup

Create a MySQL user with access to the portal database and permission to create the MySQL-backed session table on first startup. Apply the schema:

```sh
mysql -u YOUR_MYSQL_USER -p < database/schema.sql
```

Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` in `.env`. Do not use a MySQL root account for the application.

The schema creates the `volunteer_applications` and `contact_enquiries` tables. For an existing database, apply the updated `database/schema.sql` again so these tables are created:

```sh
mysql -u YOUR_MYSQL_USER -p < database/schema.sql
```

Submitted volunteer applications and contact enquiries are stored in those tables with a `new` status and submission timestamp. Restrict database access to trusted administrators and apply retention practices suitable for the personal information collected.

## Initial administrator

There is no default account or password. After configuring `.env` and the database, create the first administrator from an interactive terminal:

```sh
npm run create-admin
```

The command prompts for the name, username, email, and password. Password input is not echoed. Passwords must contain at least 12 characters and fit bcrypt's 72-byte limit. Do not expose public registration or accept a role from the login page.

Use `npm run create-user` to securely provision a staff or volunteer account from an interactive terminal. This command does not allow creating additional administrator accounts; it is a trusted local setup utility, not a public registration flow.

## Start

```sh
npm start
```

Open `http://localhost:3000/` for the foundation website or `http://localhost:3000/login` for the sign-in portal. Set `PUBLIC_ORIGIN` to the exact public origin used to open the site. For local use it is `http://localhost:3000`; for production it must be the HTTPS origin.

## Email password resets

Without SMTP configuration, the forgot-password endpoint explicitly reports that email delivery is unavailable; it does not claim to have sent a reset. Configure all five `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` values in `.env` to enable delivery. Port 465 uses implicit TLS; other ports use Nodemailer STARTTLS behavior. Use provider-issued credentials and never commit them.

When configured, reset tokens are generated using cryptographic randomness, stored only as SHA-256 hashes, expire after 60 minutes, are single-use, and are invalidated after a successful reset. The response does not disclose whether an account exists.

## Authentication and security

- Passwords are hashed using bcrypt with 12 rounds.
- User lookup uses parameterized MySQL queries; role and account status are loaded from MySQL and never accepted from the browser.
- Sessions are stored in MySQL, rotated at login, and use HttpOnly, SameSite=Strict cookies. Cookies use `Secure` in production.
- Sessions expire after two hours unless Remember me is selected, in which case the session lifetime is 14 days.
- CSRF tokens are held in the server-side session and sent in a request header; unsafe requests also validate the Origin when present.
- Authentication endpoints use rate limits, Helmet security headers, bounded JSON request bodies, and generic credential/reset responses.
- Changing or resetting a password invalidates existing sessions and outstanding reset links; changing a password requires signing in again.
- Each role route checks the current active account and its database role on the server. Altering a URL cannot grant access to another role.

Production deployments must use HTTPS end-to-end. Set `NODE_ENV=production`, set `PUBLIC_ORIGIN` to the HTTPS site origin, use a high-entropy private `SESSION_SECRET`, protect database and SMTP credentials, and configure the reverse proxy to forward HTTPS correctly. The server trusts one reverse proxy in production; adapt that setting only to match the deployment topology. Apply database backups, least-privilege access, monitoring, and operational log retention suitable for the organization. Do not serve this application over plain HTTP in production.

## Test

Run the automated validation tests:

```sh
npm test
```

The automated tests cover password and role mapping policies plus volunteer/contact form validation. With a configured MySQL instance, exercise the following integration checks before deployment:

1. Create one active account for each role and verify login redirects respectively to `/admin/dashboard`, `/staff/dashboard`, and `/volunteer/dashboard`.
2. Verify wrong passwords, nonexistent users, inactive users, and suspended users return the same generic credential error; also submit missing and malformed fields.
3. Verify unauthenticated access to each role route is rejected and each signed-in role receives a forbidden response for the other roles' routes.
4. Verify logout clears the session; expire a session in MySQL and verify protected routes reject it.
5. Verify reset tokens expire, cannot be reused, are not stored in plaintext, and invalidate prior sessions; verify reset requests return a generic response for existing and nonexistent emails.
6. Exceed login, reset-request, and password-reset rate limits and verify HTTP 429 responses.
7. Try SQL metacharacters in identity/password inputs and verify they do not authenticate or change query behavior.
8. In production configuration, verify `b2b.sid` is HttpOnly, Secure, SameSite=Strict, and has the selected session expiry.
9. Verify missing SMTP settings produce a clear delivery-unavailable message instead of a fake sent message.
10. Submit valid volunteer and contact forms and verify each is saved once with a `new` status; verify malformed fields are rejected and repeated submissions hit their rate limits.
11. Sign in as an administrator and verify the overview counts, volunteer and enquiry lists, status filters, pagination, and status updates; verify staff and volunteer accounts cannot access `/api/admin` or update records.

Database-backed integration checks require a configured MySQL server and must be run in a configured Node/MySQL environment.
