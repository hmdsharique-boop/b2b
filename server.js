'use strict';

require('dotenv').config();

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const nodemailer = require('nodemailer');
const pool = require('./config/database');
const { requireAuth, requireRole } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createAdminRouter } = require('./routes/admin');
const { createSubmissionRouter } = require('./routes/submissions');

const app = express();
const root = __dirname;
const publicDirectory = path.join(root, 'public');
const dashboardPath = path.join(root, 'views', 'dashboard.html');
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
const publicOrigin = process.env.PUBLIC_ORIGIN;

if (['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].some((field) => !process.env[field])) {
  throw new Error('DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME must be configured.');
}
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
}
let parsedPublicOrigin;
try {
  parsedPublicOrigin = new URL(publicOrigin);
} catch {
  throw new Error('PUBLIC_ORIGIN must be set to the application origin, such as http://localhost:3000.');
}
if (!['http:', 'https:'].includes(parsedPublicOrigin.protocol)
  || parsedPublicOrigin.username || parsedPublicOrigin.password
  || parsedPublicOrigin.pathname !== '/' || parsedPublicOrigin.search || parsedPublicOrigin.hash
  || (production && parsedPublicOrigin.protocol !== 'https:')) {
  throw new Error('PUBLIC_ORIGIN must be set to the application origin, such as http://localhost:3000.');
}

const smtpFields = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
const smtpConfiguredCount = smtpFields.filter((field) => Boolean(process.env[field])).length;
if (smtpConfiguredCount > 0 && smtpConfiguredCount !== smtpFields.length) {
  throw new Error('Configure all SMTP_* environment values or leave them all blank.');
}
const smtpPort = Number(process.env.SMTP_PORT);
if (smtpConfiguredCount === smtpFields.length && (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)) {
  throw new Error('SMTP_PORT must be a valid TCP port.');
}

let mailer = null;
if (smtpConfiguredCount === smtpFields.length) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
}

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 14 * 24 * 60 * 60 * 1000,
  createDatabaseTable: true,
  schema: { tableName: 'sessions' }
});

if (production) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/login.html' || req.path === '/reset-password'
    || /^\/(admin|staff|volunteer)\/dashboard$/.test(req.path)) {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '));
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.json({ limit: '10kb', strict: true }));
app.use(session({
  name: 'b2b.sid',
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: production,
    sameSite: 'strict',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/'
  }
}));

app.use('/api/auth', createAuthRouter(pool, mailer, publicOrigin));
app.use('/api/admin', createAdminRouter(pool));
app.use('/api/submissions', createSubmissionRouter(pool));
app.use(express.static(publicDirectory, { index: false, dotfiles: 'deny', fallthrough: true }));

app.get('/', (req, res) => res.sendFile(path.join(root, 'build2better_foundation.html')));
app.get('/login', (req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));
app.get('/login.html', (req, res) => res.redirect(302, '/login'));
app.get('/reset-password', (req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));

app.get('/admin/dashboard', requireAuth(pool), requireRole('admin'), (req, res) => {
  res.sendFile(path.join(root, 'views', 'admin.html'));
});
app.get('/staff/dashboard', requireAuth(pool), requireRole('staff'), (req, res) => res.sendFile(dashboardPath));
app.get('/volunteer/dashboard', requireAuth(pool), requireRole('volunteer'), (req, res) => res.sendFile(dashboardPath));

const publicSiteAssets = new Map([
  ['/build2better_foundation.html', 'build2better_foundation.html'],
  ['/styles.css', 'styles.css'],
  ['/B2B_LOGO.png', 'B2B_LOGO.png'],
  ['/B2B_BG.jpg', 'B2B_BG.jpg'],
  ['/B2B_BG.jpeg', 'B2B_BG.jpg'],
  ['/B2B_QR.jpeg', 'B2B_QR.jpeg']
]);
app.get([...publicSiteAssets.keys()], (req, res, next) => {
  const filename = publicSiteAssets.get(req.path);
  if (!filename) return next();
  return res.sendFile(path.join(root, filename));
});

app.use((req, res) => res.status(404).json({ error: 'The requested page was not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status >= 500) console.error('Request failed:', error.code || error.name || 'UnexpectedError');
  return res.status(status).json({
    error: status === 500 ? 'A server error occurred. Please try again later.' : 'The request could not be processed.'
  });
});

async function start() {
  await pool.query('SELECT 1');
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Build2Better portal listening on ${port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Unable to start portal:', error.code || error.name || 'StartupError');
    process.exitCode = 1;
  });
}

module.exports = { app, pool };
