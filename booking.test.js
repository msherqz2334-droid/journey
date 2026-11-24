const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_DIR = path.join(os.tmpdir(), `atlas-test-sessions-${process.pid}`);
const { app, initialize, exec } = require('../server');

let server;
let baseUrl;

async function request(pathname, session, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(session.cookie ? { Cookie: session.cookie } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': session.csrf } : {}) };
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) session.cookie = setCookie.split(';')[0];
  const data = await response.json().catch(() => ({}));
  return { response, data, cookieHeader: setCookie };
}

async function anonymousSession() {
  const session = {};
  const result = await request('/api/csrf', session);
  session.csrf = result.data.csrfToken;
  return session;
}

async function register(session, { fullName, username, email, password = 'TravelSafe123!' }) {
  const result = await request('/api/auth/register', session, {
    method: 'POST',
    body: { fullName, username, email, phoneCountry: 'US', phoneNumber: '2025550123', country: 'United States', password, confirmPassword: password }
  });
  if (result.data.csrfToken) session.csrf = result.data.csrfToken;
  return result;
}

test.before(async () => {
  await initialize();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(process.env.SESSION_DIR, { recursive: true, force: true });
});

test('registration, username login, booking ownership, and cancellation', async () => {
  const owner = await anonymousSession();
  const weakPassword = await request('/api/auth/register', owner, {
    method: 'POST',
    body: { fullName: 'Avery Taylor', username: 'avery', email: 'avery@example.com', phoneCountry: 'US', phoneNumber: '2025550123', country: 'United States', password: 'weak', confirmPassword: 'weak' }
  });
  assert.equal(weakPassword.response.status, 400);

  const invalidName = await register(owner, { fullName: 'Avery Taylor2', username: 'avery', email: 'avery@example.com' });
  assert.equal(invalidName.response.status, 400);
  const invalidSymbolName = await register(owner, { fullName: 'Avery-Taylor', username: 'avery', email: 'avery@example.com' });
  assert.equal(invalidSymbolName.response.status, 400);
  const accentedName = await register(owner, { fullName: 'Élodie Martin', username: 'avery', email: 'avery@example.com' });
  assert.equal(accentedName.response.status, 400);
  const invalidEmail = await register(owner, { fullName: 'Avery Taylor', username: 'avery', email: 'avery!@example.com' });
  assert.equal(invalidEmail.response.status, 400);
  const invalidPhone = await request('/api/auth/register', owner, {
    method: 'POST',
    body: { fullName: 'Avery Taylor', username: 'avery', email: 'avery@example.com', phoneCountry: 'PK', phoneNumber: '03A00123456', country: 'Pakistan', password: 'Strong8!', confirmPassword: 'Strong8!' }
  });
  assert.equal(invalidPhone.response.status, 400);

  const created = await register(owner, { fullName: 'Avery Taylor', username: 'avery', email: 'avery@example.com', password: 'Strong8!' });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.user.username, 'avery');
  const stored = exec('SELECT password_hash FROM users WHERE email=?', ['avery@example.com'])[0];
  assert.notEqual(stored.password_hash, 'Strong8!');
  assert.match(stored.password_hash, /^\$2/);

  const logout = await request('/api/auth/logout', owner, { method: 'POST', body: {} });
  assert.equal(logout.response.status, 200);
  const loginSession = await anonymousSession();
  const login = await request('/api/auth/login', loginSession, { method: 'POST', body: { identifier: 'avery', password: 'Strong8!', remember: true } });
  assert.equal(login.response.status, 200);
  const sessionExpiry = Date.parse(login.cookieHeader.match(/Expires=([^;]+)/)[1]);
  assert.ok(sessionExpiry > Date.now() + 29 * 24 * 60 * 60 * 1000);
  loginSession.csrf = login.data.csrfToken;
  assert.equal(login.data.user.email, 'avery@example.com');

  const catalog = await request('/api/packages', {});
  assert.equal(catalog.response.status, 200);
  assert.ok(catalog.data.length >= 20);
  assert.ok(catalog.data.some((item) => item.destination_name === 'Paris'));
  assert.ok(catalog.data.some((item) => item.destination_name === 'New York'));
  const countryList = await request('/api/countries', {});
  assert.ok(countryList.data.length >= 190);
  assert.ok(countryList.data.includes('Nigeria'));
  const phoneCountryList = await request('/api/phone-countries', {});
  assert.ok(phoneCountryList.data.some((item) => item.code === 'PK' && item.callingCode === '92'));
  assert.ok(phoneCountryList.data.some((item) => item.code === 'IN' && item.callingCode === '91'));
  assert.ok(phoneCountryList.data.some((item) => item.code === 'AE' && item.callingCode === '971'));
  const pkg = catalog.data[0];
  const departureDate = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const returnDate = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10);
  const bookingResult = await request('/api/bookings', loginSession, {
    method: 'POST',
    body: { packageId: pkg.id, departureCountry: 'United States', departureDate, returnDate, adults: 1, children: 0, travelClass: 'Economy', contactEmail: 'avery@example.com', contactPhone: '+1 555 010 2020', passengers: ['Avery Taylor'] }
  });
  assert.equal(bookingResult.response.status, 201);
  assert.equal(bookingResult.data.status, 'Pending');
  assert.equal(bookingResult.data.payment_status, 'Unpaid');
  assert.equal(bookingResult.data.passengers[0].full_name, 'Avery Taylor');

  const stranger = await anonymousSession();
  await register(stranger, { fullName: 'Riley Chen', username: 'riley', email: 'riley@example.com' });
  const forbiddenAdmin = await request('/api/admin/overview', stranger);
  assert.equal(forbiddenAdmin.response.status, 403);
  const privateOrder = await request(`/api/bookings/${bookingResult.data.booking_code}`, stranger);
  assert.equal(privateOrder.response.status, 404);
  const stolenCancellation = await request(`/api/bookings/${bookingResult.data.booking_code}/cancel`, stranger, { method: 'POST', body: { reason: 'Not my booking' } });
  assert.equal(stolenCancellation.response.status, 404);

  const cancelled = await request(`/api/bookings/${bookingResult.data.booking_code}/cancel`, loginSession, { method: 'POST', body: { reason: 'Plans changed' } });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.status, 'Cancelled');
  assert.equal(cancelled.data.cancellation.reason, 'Plans changed');
  assert.equal(cancelled.data.cancellation.fee_cents, 0);
  const repeatedCancel = await request(`/api/bookings/${bookingResult.data.booking_code}/cancel`, loginSession, { method: 'POST', body: { reason: 'Again' } });
  assert.equal(repeatedCancel.response.status, 409);

  const ownerOrders = await request('/api/bookings', loginSession);
  const strangerOrders = await request('/api/bookings', stranger);
  assert.equal(ownerOrders.data.length, 1);
  assert.equal(strangerOrders.data.length, 0);

  await request('/api/auth/logout', stranger, { method: 'POST', body: {} });
  const lockoutSession = await anonymousSession();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedLogin = await request('/api/auth/login', lockoutSession, { method: 'POST', body: { identifier: 'riley', password: 'IncorrectPassword1!' } });
    assert.equal(failedLogin.response.status, 401);
  }
  const lockedLogin = await request('/api/auth/login', lockoutSession, { method: 'POST', body: { identifier: 'riley', password: 'TravelSafe123!' } });
  assert.equal(lockedLogin.response.status, 429);
});
