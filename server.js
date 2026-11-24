require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const { rateLimit } = require('express-rate-limit');
const { getCountries, getCountryCallingCode, parsePhoneNumberFromString } = require('libphonenumber-js/max');
const countries = require('./public/countries.json');

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = path.resolve(process.env.DB_FILE || './data/travel.sqlite');
const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './data/sessions');
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const LOCKOUT_MINUTES = Math.max(1, Number(process.env.LOCKOUT_MINUTES || 15));
const MAX_LOGIN_ATTEMPTS = Math.max(1, Number(process.env.MAX_LOGIN_ATTEMPTS || 5));
const CANCELLATION_FEE_CENTS = Math.max(0, Number(process.env.CANCELLATION_FEE_CENTS || 2500));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'allam-2-7b';
const isTest = process.env.NODE_ENV === 'test';

if (!isTest && SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters. Copy .env.example to .env and set it before starting.');
}

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const sessionStore = process.env.SESSION_STORE === 'memory' ? undefined : new FileStore({ path: SESSION_DIR, retries: 0, ttl: 60 * 60 * 24 * 30 });
let db;
let persistTimer;

function persist() {
  if (!db || isTest) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  }, 40);
}

function exec(sql, params = []) {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}

function one(sql, params = []) {
  return exec(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  persist();
  return Number(db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 0);
}

function seed() {
  const items = [
    ['Kyoto', 'Japan', 'Asia', 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=85', 'Temple lanes, quiet gardens, and the old streets of Gion.'],
    ['Amalfi Coast', 'Italy', 'Europe', 'https://images.unsplash.com/photo-1533587851505-d119e13fa0d7?auto=format&fit=crop&w=1200&q=85', 'Cliffside villages and long, sunlit Mediterranean lunches.'],
    ['Marrakech', 'Morocco', 'Africa', 'https://images.unsplash.com/photo-1539020140153-e479b8c22e70?auto=format&fit=crop&w=1200&q=85', 'Market colors, courtyard riads, and Atlas Mountain air.'],
    ['Banff', 'Canada', 'North America', 'https://images.unsplash.com/photo-1503614472-8c93d56cd7b7?auto=format&fit=crop&w=1200&q=85', 'Alpine lakes, pine forests, and open mountain trails.'],
    ['Bali', 'Indonesia', 'Asia', 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1200&q=85', 'Rice terraces, island temples, and a slower pace.'],
    ['Lisbon', 'Portugal', 'Europe', 'https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1200&q=85', 'Tile-lined streets, Atlantic light, and late-night fado.'],
    ['New York', 'United States', 'North America', 'https://images.unsplash.com/photo-1534430480872-3498386e7856?auto=format&fit=crop&w=1200&q=85', 'Neighborhood walks, skyline views, and late-night kitchens.'],
    ['Mexico City', 'Mexico', 'North America', 'https://images.unsplash.com/photo-1518105779142-d975f22f1b0a?auto=format&fit=crop&w=1200&q=85', 'A vibrant capital of art, markets, and extraordinary food.'],
    ['Rio de Janeiro', 'Brazil', 'South America', 'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?auto=format&fit=crop&w=1200&q=85', 'Oceanfront mornings, hillside views, and the rhythm of Rio.'],
    ['Cape Town', 'South Africa', 'Africa', 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?auto=format&fit=crop&w=1200&q=85', 'Mountain trails, ocean air, and a lively waterfront.'],
    ['Cairo', 'Egypt', 'Africa', 'https://images.unsplash.com/photo-1539768942893-daf53e448371?auto=format&fit=crop&w=1200&q=85', 'Historic neighborhoods and remarkable ancient landmarks.'],
    ['Paris', 'France', 'Europe', 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=85', 'Museum afternoons, neighborhood cafés, and the Seine at dusk.'],
    ['Barcelona', 'Spain', 'Europe', 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=1200&q=85', 'Modernist architecture, long lunches, and Mediterranean evenings.'],
    ['Reykjavik', 'Iceland', 'Europe', 'https://images.unsplash.com/photo-1476610182048-b716b8518aae?auto=format&fit=crop&w=1200&q=85', 'A small-city base for geothermal pools and open landscapes.'],
    ['Istanbul', 'Turkey', 'Europe & Asia', 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=1200&q=85', 'A city of layered history, waterfront ferries, and bazaars.'],
    ['Seoul', 'South Korea', 'Asia', 'https://images.unsplash.com/photo-1538485399081-7191377e8241?auto=format&fit=crop&w=1200&q=85', 'Design-forward streets, palace courtyards, and night markets.'],
    ['Hanoi', 'Vietnam', 'Asia', 'https://images.unsplash.com/photo-1509030450996-dd1a26dda07a?auto=format&fit=crop&w=1200&q=85', 'Old-quarter lanes, lakeside walks, and northern Vietnamese flavors.'],
    ['Sydney', 'Australia', 'Oceania', 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?auto=format&fit=crop&w=1200&q=85', 'Harbour walks, coastal swims, and sunny neighborhood cafés.'],
    ['Queenstown', 'New Zealand', 'Oceania', 'https://images.unsplash.com/photo-1507699622108-4be3abd695ad?auto=format&fit=crop&w=1200&q=85', 'Lakeside calm and mountain scenery in every direction.'],
    ['Dubai', 'United Arab Emirates', 'Middle East', 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1200&q=85', 'Modern architecture, desert horizons, and Gulf-side evenings.'],
    ['Nairobi', 'Kenya', 'Africa', 'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=1200&q=85', 'A lively city gateway to Kenya’s landscapes and wildlife.']
  ];
  const destinationIds = items.map((item) => {
    const existing = one('SELECT id FROM destinations WHERE name=? AND country=?', [item[0], item[1]]);
    return existing?.id || run('INSERT INTO destinations (name,country,region,image_url,description) VALUES (?,?,?,?,?)', item);
  });
  const packages = [
    [destinationIds[0], 'Kyoto, quietly', 6, 124900, 'Culture', items[0][3], 'A thoughtful six-night stay with guided temple walks and room to wander.'],
    [destinationIds[1], 'The Amalfi pause', 7, 169500, 'Coast', items[1][3], 'Seven days between coastal villages, boat days, and a family-run stay.'],
    [destinationIds[2], 'Marrakech & the Atlas', 5, 98500, 'Culture', items[2][3], 'Five nights of medina discovery, a riad stay, and mountain scenery.'],
    [destinationIds[3], 'Banff by the lake', 5, 142000, 'Nature', items[3][3], 'A five-night mountain escape with time for trails and turquoise water.'],
    [destinationIds[4], 'Bali, island rhythm', 8, 156000, 'Island', items[4][3], 'Eight days of rice terraces, coastal calm, and culture-led experiences.'],
    [destinationIds[5], 'Lisbon in layers', 4, 79500, 'City', items[5][3], 'Four nights to explore old neighborhoods, viewpoints, and local kitchens.'],
    [destinationIds[6], 'New York, block by block', 5, 118000, 'City', items[6][3], 'Five days for neighborhood discoveries, museums, and skyline views.'],
    [destinationIds[7], 'Mexico City at the table', 5, 92500, 'Culture', items[7][3], 'Five days of markets, architecture, museums, and local cooking.'],
    [destinationIds[8], 'Rio, mountain to sea', 6, 132000, 'Coast', items[8][3], 'Six days between iconic beaches, hillside views, and city life.'],
    [destinationIds[9], 'Cape Town in the open air', 6, 147500, 'Nature', items[9][3], 'Six days of coastal drives, mountain paths, and city markets.'],
    [destinationIds[10], 'Cairo through the ages', 5, 110000, 'Culture', items[10][3], 'Five days exploring historic quarters and ancient sites with a local guide.'],
    [destinationIds[11], 'Paris, slowly', 5, 126000, 'City', items[11][3], 'Five nights for galleries, café tables, and unhurried river walks.'],
    [destinationIds[12], 'Barcelona after hours', 5, 114000, 'Culture', items[12][3], 'Five days of architecture, neighborhood food, and Mediterranean light.'],
    [destinationIds[13], 'Iceland from Reykjavik', 6, 184000, 'Nature', items[13][3], 'Six nights with a city base and sample day trips into Icelandic scenery.'],
    [destinationIds[14], 'Istanbul, between shores', 5, 108000, 'Culture', items[14][3], 'Five days of ferries, historic streets, and the city’s many kitchens.'],
    [destinationIds[15], 'Seoul city stories', 6, 139000, 'City', items[15][3], 'Six days connecting palace history with modern neighborhoods.'],
    [destinationIds[16], 'Hanoi and the old quarter', 5, 89000, 'Culture', items[16][3], 'Five days of lakeside mornings, local food, and historic lanes.'],
    [destinationIds[17], 'Sydney by the water', 6, 158000, 'Coast', items[17][3], 'Six days of harbour views, coastal paths, and city neighborhoods.'],
    [destinationIds[18], 'Queenstown outdoors', 6, 176000, 'Nature', items[18][3], 'Six days near alpine lakes and mountain trails in New Zealand.'],
    [destinationIds[19], 'Dubai, city and desert', 5, 121000, 'City', items[19][3], 'Five days across contemporary architecture, old souks, and desert scenery.'],
    [destinationIds[20], 'Nairobi and beyond', 5, 143000, 'Nature', items[20][3], 'Five days in Nairobi with sample guided experiences outside the city.']
  ];
  packages.forEach((item) => {
    if (!one('SELECT id FROM packages WHERE title=?', [item[1]])) run('INSERT INTO packages (destination_id,title,duration_days,base_price_cents,category,image_url,description) VALUES (?,?,?,?,?,?,?)', item);
  });
  run("INSERT OR IGNORE INTO app_settings (key,value) VALUES ('cancellation_fee_cents',?)", [String(CANCELLATION_FEE_CENTS)]);
  run("INSERT OR IGNORE INTO app_settings (key,value) VALUES ('free_cancellation_hours','48')");

  const hotels = [
    ['The Grand Kyoto', 'Kyoto, Japan', '1 Gionmachi Minamigawa, Higashiyama-ku, Kyoto', 'A heritage ryokan-style retreat with tatami rooms, garden views, and kaiseki dining.', 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=85', 4.8, '["Free Wi-Fi","Spa","Garden View","Tea Ceremony"]'],
    ['Hotel Amalfi Vista', 'Positano, Italy', 'Via Cristoforo Colombo, Positano', 'Cliffside boutique hotel with infinity pool, sea-view terraces, and Mediterranean cuisine.', 'https://images.unsplash.com/photo-1577246144184-752b4f91257c?auto=format&fit=crop&w=1200&q=85', 4.9, '["Free Wi-Fi","Rooftop Pool","Sea View","Airport Shuttle"]'],
    ['Riad Atlas Marrakech', 'Marrakech, Morocco', 'Derb Sidi Bouloukat, Medina, Marrakech', 'Traditional riad with courtyard pool, rooftop terrace, and hammam spa in the heart of the medina.', 'https://images.unsplash.com/photo-1585284043749-3d3d881d9b57?auto=format&fit=crop&w=1200&q=85', 4.7, '["Free Wi-Fi","Courtyard Pool","Hammam","Rooftop Terrace"]'],
    ['Fairmont Banff Lodge', 'Banff, Canada', '405 Spray Ave, Banff, Alberta', 'Mountain lodge with floor-to-ceiling window views, pine-scented suites, and trail access.', 'https://images.unsplash.com/photo-1552317662-83b6e8e4f142?auto=format&fit=crop&w=1200&q=85', 4.6, '["Free Wi-Fi","Fireplace","Mountain View","Ski Storage"]'],
    ['Bali Hanging Gardens', 'Ubud, Indonesia', 'Jl. Raya Banjar Sari, Ubud', 'Jungle canopy resort with tiered infinity pools, bamboo architecture, and river views.', 'https://images.unsplash.com/photo-1547906303-920b09e0789e?auto=format&fit=crop&w=1200&q=85', 4.9, '["Free Wi-Fi","Infinity Pool","Jungle View","Yoga Pavilion"]'],
    ['Lisbon Alfama Inn', 'Lisbon, Portugal', 'Rua dos Remédios 134, Alfama, Lisbon', 'Historic townhouse converted into a boutique hotel with fado evenings and tile-lined halls.', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=85', 4.5, '["Free Wi-Fi","Library","Terrace","Local Tours"]'],
    ['The Standard New York', 'New York, USA', '848 Washington St, New York', 'Iconic meatpacking district hotel with industrial-chic rooms and skyline views.', 'https://images.unsplash.com/photo-1549436641-77904e4a4c7f?auto=format&fit=crop&w=1200&q=85', 4.4, '["Free Wi-Fi","Rooftop Bar","Fitness Center","City View"]'],
    ['Casa Mexico City', 'Mexico City, Mexico', 'Colonia Roma, Mexico City', 'Design-forward hotel in Roma Norte with courtyard, art installations, and local kitchen.', 'https://images.unsplash.com/photo-1539792921158-4094c82783d2?auto=format&fit=crop&w=1200&q=85', 4.7, '["Free Wi-Fi","Courtyard","Bike Rental","Art Gallery"]'],
  ];
  const hotelIds = hotels.map((item) => {
    const existing = one('SELECT id FROM hotels WHERE name=? AND location=?', [item[0], item[1]]);
    return existing?.id || run('INSERT INTO hotels (name,location,address,description,image_url,rating,amenities) VALUES (?,?,?,?,?,?,?)', item);
  });
  const rooms = [
    [hotelIds[0], 'Deluxe Tatami Room', 22000, 2, '["Air Conditioning","Mini Bar","Garden View","Tea Set"]', 'https://images.unsplash.com/photo-1577246144184-752b4f91257c?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[0], 'Garden Suite', 35000, 4, '["Air Conditioning","Mini Bar","Garden View","Separate Living Room","Tea Set"]', 'https://images.unsplash.com/photo-1552317662-83b6e8e4f142?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[1], 'Sea View Room', 28000, 2, '["Air Conditioning","Mini Bar","Sea View","Balcony"]', 'https://images.unsplash.com/photo-1577246144184-752b4f91257c?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[1], 'Cliffside Suite', 42000, 4, '["Air Conditioning","Mini Bar","Sea View","Private Plunge Pool","Balcony"]', 'https://images.unsplash.com/photo-1577246144184-752b4f91257c?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[2], 'Medina Room', 16000, 2, '["Air Conditioning","Courtyard View","Traditional Decor"]', 'https://images.unsplash.com/photo-1585284043749-3d3d881d9b57?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[2], 'Riads Suite', 24000, 4, '["Air Conditioning","Courtyard View","Rooftop Access","Traditional Decor"]', 'https://images.unsplash.com/photo-1585284043749-3d3d881d9b57?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[3], 'Mountain View Room', 20000, 2, '["Air Conditioning","Fireplace","Mountain View","Ski Storage"]', 'https://images.unsplash.com/photo-1552317662-83b6e8e4f142?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[3], 'Alpine Suite', 32000, 4, '["Air Conditioning","Fireplace","Mountain View","Separate Living Room","Ski Storage"]', 'https://images.unsplash.com/photo-1552317662-83b6e8e4f142?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[4], 'Jungle Room', 26000, 2, '["Air Conditioning","Jungle View","Bamboo Decor","Yoga Mat"]', 'https://images.unsplash.com/photo-1547906303-920b09e0789e?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[4], 'Canopy Villa', 38000, 4, '["Air Conditioning","Jungle View","Private Pool","Bamboo Decor","Yoga Mat"]', 'https://images.unsplash.com/photo-1547906303-920b09e0789e?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[5], 'Alfama Room', 15000, 2, '["Air Conditioning","Tile-lined Walls","City View"]', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[5], 'Fado Suite', 22000, 4, '["Air Conditioning","Tile-lined Walls","City View","Living Room"]', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[6], 'Industrial Room', 18000, 2, '["Air Conditioning","City View","Mini Bar"]', 'https://images.unsplash.com/photo-1549436641-77904e4a4c7f?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[6], 'Loft Suite', 29000, 4, '["Air Conditioning","City View","Mini Bar","Living Room","Rooftop Access"]', 'https://images.unsplash.com/photo-1549436641-77904e4a4c7f?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[7], 'Roma Room', 14000, 2, '["Air Conditioning","City View","Bike Rental"]', 'https://images.unsplash.com/photo-1539792921158-4094c82783d2?auto=format&fit=crop&w=800&q=85'],
    [hotelIds[7], 'Design Suite', 21000, 4, '["Air Conditioning","City View","Bike Rental","Living Room"]', 'https://images.unsplash.com/photo-1539792921158-4094c82783d2?auto=format&fit=crop&w=800&q=85'],
  ];
  rooms.forEach((item) => {
    const existing = one('SELECT id FROM rooms WHERE hotel_id=? AND room_type=?', [item[0], item[1]]);
    if (!existing) run('INSERT INTO rooms (hotel_id,room_type,price_per_night_cents,capacity,amenities,image_url) VALUES (?,?,?,?,?,?)', item);
  });
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
}

function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = req.get('x-csrf-token');
  const expected = req.session.csrfToken || '';
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(String(expected));
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Security token expired. Refresh the page and try again.' });
  next();
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts from this address. Try again shortly.' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many account creation attempts. Try again later.' } });

function validateEmail(email) { return /^[A-Za-z0-9]+@[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\.[A-Za-z]{2,}$/.test(email); }
function passwordStrong(password) { return typeof password === 'string' && password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password); }
function internationalPhone(phoneCountry, phoneNumber) {
  if (!getCountries().includes(phoneCountry) || !/^\d{6,15}$/.test(phoneNumber)) return null;
  const callingCode = getCountryCallingCode(phoneCountry);
  const parsed = parsePhoneNumberFromString(`+${callingCode}${phoneNumber}`);
  return parsed?.isValid() ? parsed.number : null;
}
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function safeBooking(booking) {
  const passengers = exec('SELECT passenger_type,full_name FROM passengers WHERE booking_id=? ORDER BY id', [booking.id]);
  const history = exec('SELECT status,note,created_at FROM status_history WHERE booking_id=? ORDER BY id', [booking.id]);
  const cancellation = one('SELECT cancelled_at,reason,fee_cents,refund_cents FROM cancellation_records WHERE booking_id=?', [booking.id]);
  return { ...booking, passengers, history, cancellation };
}

app.disable('x-powered-by');
app.use(helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'https://images.unsplash.com', 'https://*.googleusercontent.com', 'https://graph.facebook.com', 'data:'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], scriptSrc: ["'self'", 'https://accounts.google.com', 'https://apis.google.com'], connectSrc: ["'self'", 'https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://www.googleapis.com', 'https://graph.facebook.com', 'https://generativelanguage.googleapis.com', 'https://aiplatform.googleapis.com'], frameSrc: ["'self'", 'https://accounts.google.com', 'https://connect.facebook.net'] } } }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'atlas.sid',
  ...(sessionStore ? { store: sessionStore } : {}),
  secret: SESSION_SECRET || 'test-session-secret-not-for-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(csrf);
app.get(['/admin', '/admin/'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/csrf', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.json({ csrfToken: req.session.csrfToken });
});

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  const { fullName, username, email, phoneCountry, phoneNumber, country, password, confirmPassword } = req.body || {};
  if (![fullName, username, email, phoneCountry, phoneNumber, country, password, confirmPassword].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ error: 'Complete every required field.' });
  if (fullName.trim().length > 100 || country.trim().length > 80) return res.status(400).json({ error: 'One or more fields are too long.' });
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(fullName.trim())) return res.status(400).json({ error: 'Name can contain A–Z letters and spaces only.' });
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username.trim())) return res.status(400).json({ error: 'Username must be 3–32 letters, numbers, or underscores.' });
  if (!validateEmail(email.trim())) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!internationalPhone(phoneCountry, phoneNumber)) return res.status(400).json({ error: 'Enter a valid phone number using the selected country code.' });
  if (!passwordStrong(password)) return res.status(400).json({ error: 'Use at least 8 characters with uppercase, lowercase, a number, and a symbol.' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  if (one('SELECT id FROM users WHERE email=?', [email.trim()])) return res.status(409).json({ error: 'An account with this email already exists.' });
  if (one('SELECT id FROM users WHERE username=?', [username.trim()])) return res.status(409).json({ error: 'That username is already taken.' });
  const hash = await bcrypt.hash(password, 12);
  const phone = internationalPhone(phoneCountry, phoneNumber);
  const userId = run('INSERT INTO users (full_name,username,email,phone,country,password_hash) VALUES (?,?,?,?,?,?)', [fullName.trim(), username.trim(), email.trim().toLowerCase(), phone, country.trim(), hash]);
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not start a secure session.' });
    req.session.userId = userId;
    req.session.role = 'customer';
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.save(() => res.status(201).json({ user: { id: userId, fullName: fullName.trim(), username: username.trim(), email: email.trim().toLowerCase(), role: 'customer' }, csrfToken: req.session.csrfToken }));
  });
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { identifier, password } = req.body || {};
  if (typeof identifier !== 'string' || !identifier.trim() || typeof password !== 'string' || !password) return res.status(400).json({ error: 'Enter your email and password.' });
  const account = identifier.trim().toLowerCase();
  const user = one('SELECT * FROM users WHERE email=? OR username=?', [account, account]);
  const email = user?.email || account;
  const ip = req.ip || 'unknown';
  const recent = one("SELECT COUNT(*) AS attempts FROM login_attempts WHERE email=? AND succeeded=0 AND created_at >= datetime('now', ?)", [email, `-${LOCKOUT_MINUTES} minutes`]);
  if ((recent?.attempts || 0) >= MAX_LOGIN_ATTEMPTS || (user?.locked_until && Date.parse(user.locked_until) > Date.now())) return res.status(429).json({ error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.` });
  const valid = user && await bcrypt.compare(password, user.password_hash);
  run('INSERT INTO login_attempts (email,ip_address,succeeded) VALUES (?,?,?)', [email, ip, valid ? 1 : 0]);
  if (!valid) {
    if (user) {
      const count = (user.failed_login_attempts || 0) + 1;
      const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString() : null;
      run('UPDATE users SET failed_login_attempts=?,locked_until=? WHERE id=?', [count, lockedUntil, user.id]);
    }
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  run('UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE id=?', [user.id]);
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not start a secure session.' });
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.cookie.maxAge = req.body.remember === true || req.body.remember === 'on' ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.save(() => res.json({ user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role }, csrfToken: req.session.csrfToken }));
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => req.session.destroy(() => res.clearCookie('atlas.sid').json({ ok: true })));
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = one('SELECT id,full_name,email,role FROM users WHERE id=?', [req.session.userId]);
  res.json({ user: user ? { id: user.id, fullName: user.full_name, email: user.email, role: user.role } : null });
});

app.get('/api/destinations', (_req, res) => res.json(exec('SELECT * FROM destinations ORDER BY id')));
app.get('/api/countries', (_req, res) => res.json(countries));
app.get('/api/phone-countries', (_req, res) => {
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  res.json(getCountries().map((code) => ({ code, name: displayNames.of(code) || code, callingCode: getCountryCallingCode(code) })).sort((a, b) => a.name.localeCompare(b.name)));
});
app.get('/api/packages', (_req, res) => res.json(exec('SELECT p.*,d.name AS destination_name,d.country AS destination_country FROM packages p JOIN destinations d ON d.id=p.destination_id WHERE p.active=1 ORDER BY p.id')));
app.get('/api/cancellation-policy', (_req, res) => {
  res.json({ feeCents: Number(one("SELECT value FROM app_settings WHERE key='cancellation_fee_cents'")?.value || CANCELLATION_FEE_CENTS), freeHours: Number(one("SELECT value FROM app_settings WHERE key='free_cancellation_hours'")?.value || 48) });
});

app.post('/api/bookings', requireAuth, (req, res) => {
  const body = req.body || {};
  const packageId = Number(body.packageId);
  const pkg = one('SELECT p.*,d.name AS destination_name,d.country AS destination_country FROM packages p JOIN destinations d ON d.id=p.destination_id WHERE p.id=? AND p.active=1', [packageId]);
  const adults = Number(body.adults);
  const children = Number(body.children || 0);
  const names = Array.isArray(body.passengers) ? body.passengers : [];
  if (!pkg || !['Economy', 'Premium economy', 'Business', 'First'].includes(body.travelClass)) return res.status(400).json({ error: 'Choose an available package and travel class.' });
  if (typeof body.departureCountry !== 'string' || body.departureCountry.trim().length < 2 || body.departureCountry.trim().length > 80) return res.status(400).json({ error: 'Enter a valid departure country.' });
  if (!dateOnly(body.departureDate) || !dateOnly(body.returnDate) || body.returnDate <= body.departureDate || body.departureDate < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Choose valid future departure and return dates.' });
  if (!Number.isInteger(adults) || adults < 1 || adults > 9 || !Number.isInteger(children) || children < 0 || children > 8 || adults + children > 9) return res.status(400).json({ error: 'Enter between 1 and 9 total passengers.' });
  if (names.length !== adults + children || names.some((name) => typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100)) return res.status(400).json({ error: 'Enter a full name for every passenger.' });
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase() : '';
  const contactPhone = typeof body.contactPhone === 'string' ? body.contactPhone.trim() : '';
  if (!validateEmail(contactEmail) || contactPhone.length < 5 || contactPhone.length > 32) return res.status(400).json({ error: 'Enter valid contact details.' });
  const multipliers = { 'Economy': 1, 'Premium economy': 1.35, 'Business': 2.2, 'First': 3.1 };
  const subtotal = Math.round(pkg.base_price_cents * (adults + children * 0.75) * multipliers[body.travelClass]);
  const tax = Math.round(subtotal * 0.12);
  const code = `AT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const bookingId = run(`INSERT INTO bookings (booking_code,user_id,package_id,package_title,destination_name,destination_country,departure_country,departure_date,return_date,adults,children,travel_class,contact_email,contact_phone,subtotal_cents,tax_cents,total_cents)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [code, req.session.userId, pkg.id, pkg.title, pkg.destination_name, pkg.destination_country, body.departureCountry.trim(), body.departureDate, body.returnDate, adults, children, body.travelClass, contactEmail, contactPhone, subtotal, tax, subtotal + tax]);
  run('INSERT INTO payments (booking_id,amount_cents,currency,status) VALUES (?,?,?,?)', [bookingId, subtotal + tax, 'USD', 'Unpaid']);
  names.forEach((name, index) => run('INSERT INTO passengers (booking_id,passenger_type,full_name) VALUES (?,?,?)', [bookingId, index < adults ? 'Adult' : 'Child', name.trim()]));
  run('INSERT INTO status_history (booking_id,status,note,changed_by) VALUES (?,?,?,?)', [bookingId, 'Pending', 'Demo booking request received. No travel services have been reserved.', req.session.userId]);
  res.status(201).json(safeBooking(one('SELECT * FROM bookings WHERE id=? AND user_id=?', [bookingId, req.session.userId])));
});

app.get('/api/bookings', requireAuth, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
  const clauses = ['user_id=?'];
  const params = [req.session.userId];
  if (['Pending', 'Confirmed', 'Processing', 'Cancelled', 'Completed'].includes(status)) { clauses.push('status=?'); params.push(status); }
  if (search) { clauses.push('(booking_code LIKE ? OR destination_name LIKE ? OR package_title LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const bookings = exec(`SELECT * FROM bookings WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`, params);
  res.json(bookings.map(safeBooking));
});

app.get('/api/bookings/:code', requireAuth, (req, res) => {
  const booking = one('SELECT * FROM bookings WHERE booking_code=? AND user_id=?', [req.params.code, req.session.userId]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json(safeBooking(booking));
});

app.post('/api/bookings/:code/cancel', requireAuth, (req, res) => {
  const booking = one('SELECT * FROM bookings WHERE booking_code=? AND user_id=?', [req.params.code, req.session.userId]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'Cancelled') return res.status(409).json({ error: 'This booking has already been cancelled.' });
  if (['Completed', 'Processing'].includes(booking.status) || booking.departure_date <= new Date().toISOString().slice(0, 10)) return res.status(409).json({ error: 'This booking is no longer eligible for cancellation under the demo policy.' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
  if (!reason) return res.status(400).json({ error: 'Please provide a cancellation reason.' });
  const feeSetting = one("SELECT value FROM app_settings WHERE key='cancellation_fee_cents'");
  const freeHours = Number(one("SELECT value FROM app_settings WHERE key='free_cancellation_hours'")?.value || 48);
  const hoursUntilDeparture = (Date.parse(`${booking.departure_date}T00:00:00Z`) - Date.now()) / 3600000;
  const fee = hoursUntilDeparture > freeHours ? 0 : Math.min(Number(feeSetting?.value ?? CANCELLATION_FEE_CENTS), booking.total_cents);
  const estimatedRefund = booking.payment_status === 'Paid' ? Math.max(0, booking.total_cents - fee) : 0;
  run('UPDATE bookings SET status=? WHERE id=? AND user_id=?', ['Cancelled', booking.id, req.session.userId]);
  run('INSERT INTO cancellation_records (booking_id,reason,fee_cents,refund_cents) VALUES (?,?,?,?)', [booking.id, reason, fee, estimatedRefund]);
  run('INSERT INTO status_history (booking_id,status,note,changed_by) VALUES (?,?,?,?)', [booking.id, 'Cancelled', 'Cancellation recorded. Any refund is an estimate only and has not been processed.', req.session.userId]);
  res.json(safeBooking(one('SELECT * FROM bookings WHERE id=? AND user_id=?', [booking.id, req.session.userId])));
});

app.get('/api/admin/overview', requireAuth, requireAdmin, (_req, res) => {
  res.json({
    users: one('SELECT COUNT(*) AS count FROM users WHERE role="customer"').count,
    admins: one('SELECT COUNT(*) AS count FROM users WHERE role="admin"').count,
    bookings: one('SELECT COUNT(*) AS count FROM bookings').count,
    pending: one("SELECT COUNT(*) AS count FROM bookings WHERE status='Pending'").count,
    destinations: exec('SELECT * FROM destinations ORDER BY name').length,
    packagesCount: one('SELECT COUNT(*) AS count FROM packages').count,
    activePackages: one('SELECT COUNT(*) AS count FROM packages WHERE active=1').count,
    hotelsCount: one('SELECT COUNT(*) AS count FROM hotels').count,
    roomsCount: one('SELECT COUNT(*) AS count FROM rooms').count,
    hotelBookings: one('SELECT COUNT(*) AS count FROM hotel_bookings').count,
    pendingHotelBookings: one("SELECT COUNT(*) AS count FROM hotel_bookings WHERE status='Pending'").count,
    revenueCents: one("SELECT COALESCE(SUM(total_cents),0) AS total FROM bookings WHERE status!='Cancelled'").total,
    hotelRevenueCents: one("SELECT COALESCE(SUM(total_cents),0) AS total FROM hotel_bookings WHERE status!='Cancelled'").total,
    bookingsList: exec('SELECT b.*,u.full_name AS customer_name,u.email AS customer_email FROM bookings b JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC LIMIT 100'),
    packages: exec('SELECT p.*,d.name AS destination_name FROM packages p JOIN destinations d ON d.id=p.destination_id ORDER BY p.id'),
    destinationsList: exec('SELECT * FROM destinations ORDER BY name'),
    hotels: exec('SELECT * FROM hotels ORDER BY rating DESC, id'),
    rooms: exec('SELECT r.*,h.name AS hotel_name FROM rooms r JOIN hotels h ON h.id=r.hotel_id ORDER BY h.rating DESC, r.id'),
    settings: { cancellationFeeCents: Number(one("SELECT value FROM app_settings WHERE key='cancellation_fee_cents'")?.value || 0), freeCancellationHours: Number(one("SELECT value FROM app_settings WHERE key='free_cancellation_hours'")?.value || 48) }
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => res.json(exec('SELECT id,full_name,username,email,phone,country,role,created_at FROM users ORDER BY created_at DESC')));
app.post('/api/admin/destinations', requireAuth, requireAdmin, (req, res) => {
  const { name, country, region, imageUrl, description } = req.body || {};
  if (![name, country, region, imageUrl, description].every((value) => typeof value === 'string' && value.trim()) || name.length > 100 || country.length > 80 || region.length > 80 || imageUrl.length > 500 || description.length > 500 || !/^https:\/\//.test(imageUrl)) return res.status(400).json({ error: 'Complete all destination fields with valid values.' });
  const id = run('INSERT INTO destinations (name,country,region,image_url,description) VALUES (?,?,?,?,?)', [name.trim(), country.trim(), region.trim(), imageUrl.trim(), description.trim()]);
  res.status(201).json(one('SELECT * FROM destinations WHERE id=?', [id]));
});
app.patch('/api/admin/destinations/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, country, region, imageUrl, description } = req.body || {};
  if (![name, country, region, imageUrl, description].every((value) => typeof value === 'string' && value.trim()) || name.length > 100 || country.length > 80 || region.length > 80 || imageUrl.length > 500 || description.length > 500 || !/^https:\/\//.test(imageUrl)) return res.status(400).json({ error: 'Complete all destination fields with valid values.' });
  const destinationId = Number(req.params.id);
  if (!one('SELECT id FROM destinations WHERE id=?', [destinationId])) return res.status(404).json({ error: 'Destination not found.' });
  run('UPDATE destinations SET name=?,country=?,region=?,image_url=?,description=? WHERE id=?', [name.trim(), country.trim(), region.trim(), imageUrl.trim(), description.trim(), destinationId]);
  res.json(one('SELECT * FROM destinations WHERE id=?', [destinationId]));
});
app.patch('/api/admin/bookings/:code', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['Confirmed', 'Processing', 'Completed', 'Cancelled'].includes(status)) return res.status(400).json({ error: 'Choose a valid booking status.' });
  const booking = one('SELECT * FROM bookings WHERE booking_code=?', [req.params.code]);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'Cancelled' && status !== 'Cancelled') return res.status(409).json({ error: 'Cancelled bookings cannot be reopened.' });
  run('UPDATE bookings SET status=? WHERE id=?', [status, booking.id]);
  if (status === 'Cancelled' && !one('SELECT id FROM cancellation_records WHERE booking_id=?', [booking.id])) run('INSERT INTO cancellation_records (booking_id,reason,fee_cents,refund_cents) VALUES (?,?,0,0)', [booking.id, 'Cancelled by administrator. No refund was processed.']);
  run('INSERT INTO status_history (booking_id,status,note,changed_by) VALUES (?,?,?,?)', [booking.id, status, `Status updated by administrator to ${status}.`, req.session.userId]);
  res.json(safeBooking(one('SELECT * FROM bookings WHERE id=?', [booking.id])));
});
app.post('/api/admin/packages', requireAuth, requireAdmin, (req, res) => {
  const { destinationId, title, durationDays, basePriceCents, category, imageUrl, description } = req.body || {};
  if (!one('SELECT id FROM destinations WHERE id=?', [Number(destinationId)]) || typeof title !== 'string' || title.trim().length < 3 || !Number.isInteger(Number(durationDays)) || Number(durationDays) < 1 || !Number.isInteger(Number(basePriceCents)) || Number(basePriceCents) < 0 || typeof category !== 'string' || typeof imageUrl !== 'string' || typeof description !== 'string') return res.status(400).json({ error: 'Complete all package fields with valid values.' });
  const id = run('INSERT INTO packages (destination_id,title,duration_days,base_price_cents,category,image_url,description) VALUES (?,?,?,?,?,?,?)', [Number(destinationId), title.trim().slice(0, 120), Number(durationDays), Number(basePriceCents), category.trim().slice(0, 40), imageUrl.trim().slice(0, 500), description.trim().slice(0, 500)]);
  res.status(201).json(one('SELECT * FROM packages WHERE id=?', [id]));
});
app.patch('/api/admin/packages/:id', requireAuth, requireAdmin, (req, res) => {
  const { destinationId, title, durationDays, basePriceCents, category, imageUrl, description, active } = req.body || {};
  if (!one('SELECT id FROM destinations WHERE id=?', [Number(destinationId)]) || typeof title !== 'string' || !title.trim() || !Number.isInteger(Number(durationDays)) || Number(durationDays) < 1 || !Number.isInteger(Number(basePriceCents)) || Number(basePriceCents) < 0 || typeof category !== 'string' || typeof imageUrl !== 'string' || typeof description !== 'string' || typeof active !== 'boolean') return res.status(400).json({ error: 'Complete all editable package fields.' });
  const packageId = Number(req.params.id);
  if (!one('SELECT id FROM packages WHERE id=?', [packageId])) return res.status(404).json({ error: 'Package not found.' });
  run('UPDATE packages SET destination_id=?,title=?,duration_days=?,base_price_cents=?,category=?,image_url=?,description=?,active=? WHERE id=?', [Number(destinationId), title.trim().slice(0, 120), Number(durationDays), Number(basePriceCents), category.trim().slice(0, 40), imageUrl.trim().slice(0, 500), description.trim().slice(0, 500), active ? 1 : 0, packageId]);
  res.json(one('SELECT * FROM packages WHERE id=?', [packageId]));
});
app.delete('/api/admin/packages/:id', requireAuth, requireAdmin, (req, res) => {
  const packageId = Number(req.params.id);
  if (!one('SELECT id FROM packages WHERE id=?', [packageId])) return res.status(404).json({ error: 'Package not found.' });
  run('UPDATE packages SET active=0 WHERE id=?', [packageId]);
  res.json({ ok: true });
});
app.put('/api/admin/policy', requireAuth, requireAdmin, (req, res) => {
  const fee = Number(req.body?.cancellationFeeCents);
  const hours = Number(req.body?.freeCancellationHours);
  if (!Number.isInteger(fee) || fee < 0 || fee > 1000000 || !Number.isInteger(hours) || hours < 0 || hours > 720) return res.status(400).json({ error: 'Enter a valid fee and cancellation window.' });
  run("INSERT INTO app_settings (key,value) VALUES ('cancellation_fee_cents',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(fee)]);
  run("INSERT INTO app_settings (key,value) VALUES ('free_cancellation_hours',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(hours)]);
  res.json({ cancellationFeeCents: fee, freeCancellationHours: hours });
});

app.get('/api/hotels', (_req, res) => res.json(exec('SELECT * FROM hotels ORDER BY rating DESC, id')));
app.get('/api/hotels/:id', (req, res) => {
  const hotel = one('SELECT * FROM hotels WHERE id=?', [req.params.id]);
  if (!hotel) return res.status(404).json({ error: 'Hotel not found.' });
  hotel.rooms = exec('SELECT * FROM rooms WHERE hotel_id=? AND active=1 ORDER BY price_per_night_cents', [hotel.id]);
  hotel.amenities = JSON.parse(hotel.amenities || '[]');
  res.json(hotel);
});
app.get('/api/rooms', (req, res) => {
  const hotelId = typeof req.query.hotelId === 'string' ? Number(req.query.hotelId) : null;
  if (hotelId) {
    res.json(exec('SELECT * FROM rooms WHERE hotel_id=? AND active=1 ORDER BY price_per_night_cents', [hotelId]));
  } else {
    res.json(exec('SELECT r.*, h.name AS hotel_name, h.location AS hotel_location FROM rooms r JOIN hotels h ON h.id=r.hotel_id WHERE r.active=1 ORDER BY h.rating DESC, r.id'));
  }
});

function safeHotelBooking(booking) {
  const room = one('SELECT * FROM rooms WHERE id=?', [booking.room_id]);
  const hotel = one('SELECT * FROM hotels WHERE id=?', [booking.hotel_id]);
  return { ...booking, room, hotel };
}

app.post('/api/hotel-bookings', requireAuth, (req, res) => {
  const body = req.body || {};
  const hotelId = Number(body.hotelId);
  const roomId = Number(body.roomId);
  const hotel = one('SELECT * FROM hotels WHERE id=?', [hotelId]);
  const room = one('SELECT * FROM rooms WHERE id=? AND hotel_id=? AND active=1', [roomId, hotelId]);
  const checkIn = body.checkInDate;
  const checkOut = body.checkOutDate;
  const guests = Number(body.guests);
  if (!hotel || !room) return res.status(400).json({ error: 'Choose a valid hotel and room.' });
  if (!dateOnly(checkIn) || !dateOnly(checkOut) || checkOut <= checkIn || checkIn < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: 'Choose valid future check-in and check-out dates.' });
  if (!Number.isInteger(guests) || guests < 1 || guests > room.capacity) return res.status(400).json({ error: `Enter between 1 and ${room.capacity} guests.` });
  const nights = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000;
  const subtotal = Math.round(room.price_per_night_cents * nights);
  const tax = Math.round(subtotal * 0.12);
  const code = `HT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const bookingId = run(`INSERT INTO hotel_bookings (booking_code,user_id,hotel_id,room_id,check_in_date,check_out_date,guests,subtotal_cents,tax_cents,total_cents)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [code, req.session.userId, hotelId, roomId, checkIn, checkOut, guests, subtotal, tax, subtotal + tax]);
  run('INSERT INTO payments (booking_id,amount_cents,currency,status) VALUES (?,?,?,?)', [bookingId, subtotal + tax, 'USD', 'Unpaid']);
  res.status(201).json(safeHotelBooking(one('SELECT * FROM hotel_bookings WHERE id=? AND user_id=?', [bookingId, req.session.userId])));
});

app.get('/api/hotel-bookings', requireAuth, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
  const clauses = ['user_id=?'];
  const params = [req.session.userId];
  if (['Pending', 'Confirmed', 'Processing', 'Cancelled', 'Completed'].includes(status)) { clauses.push('status=?'); params.push(status); }
  if (search) { clauses.push('(booking_code LIKE ?)'); params.push(`%${search}%`); }
  const bookings = exec(`SELECT * FROM hotel_bookings WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`, params);
  res.json(bookings.map(safeHotelBooking));
});

app.get('/api/hotel-bookings/:code', requireAuth, (req, res) => {
  const booking = one('SELECT * FROM hotel_bookings WHERE booking_code=? AND user_id=?', [req.params.code, req.session.userId]);
  if (!booking) return res.status(404).json({ error: 'Hotel booking not found.' });
  res.json(safeHotelBooking(booking));
});

app.post('/api/hotel-bookings/:code/cancel', requireAuth, (req, res) => {
  const booking = one('SELECT * FROM hotel_bookings WHERE booking_code=? AND user_id=?', [req.params.code, req.session.userId]);
  if (!booking) return res.status(404).json({ error: 'Hotel booking not found.' });
  if (booking.status === 'Cancelled') return res.status(409).json({ error: 'This booking has already been cancelled.' });
  if (['Completed', 'Processing'].includes(booking.status) || booking.check_in_date <= new Date().toISOString().slice(0, 10)) return res.status(409).json({ error: 'This booking is no longer eligible for cancellation under the demo policy.' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
  if (!reason) return res.status(400).json({ error: 'Please provide a cancellation reason.' });
  const hoursUntilCheckIn = (Date.parse(`${booking.check_in_date}T00:00:00Z`) - Date.now()) / 3600000;
  const freeHours = Number(one("SELECT value FROM app_settings WHERE key='free_cancellation_hours'")?.value || 48);
  const fee = hoursUntilCheckIn > freeHours ? 0 : Math.min(CANCELLATION_FEE_CENTS, booking.total_cents);
  const estimatedRefund = booking.payment_status === 'Paid' ? Math.max(0, booking.total_cents - fee) : 0;
  run('UPDATE hotel_bookings SET status=? WHERE id=? AND user_id=?', ['Cancelled', booking.id, req.session.userId]);
  run('INSERT INTO cancellation_records (booking_id,reason,fee_cents,refund_cents) VALUES (?,?,?,?)', [booking.id, reason, fee, estimatedRefund]);
  res.json(safeHotelBooking(one('SELECT * FROM hotel_bookings WHERE id=? AND user_id=?', [booking.id, req.session.userId])));
});

app.post('/api/admin/hotels', requireAuth, requireAdmin, (req, res) => {
  const { name, location, address, description, imageUrl, rating, amenities } = req.body || {};
  if (![name, location, address, description, imageUrl].every((value) => typeof value === 'string' && value.trim()) || name.length > 100 || location.length > 100 || address.length > 200 || description.length > 1000 || imageUrl.length > 500 || !/^https:\/\//.test(imageUrl)) return res.status(400).json({ error: 'Complete all hotel fields with valid values.' });
  const ratingNum = Number(rating);
  if (!Number.isFinite(ratingNum) || ratingNum < 0 || ratingNum > 5) return res.status(400).json({ error: 'Rating must be between 0 and 5.' });
  const amenitiesArray = Array.isArray(amenities) ? amenities : [];
  const id = run('INSERT INTO hotels (name,location,address,description,image_url,rating,amenities) VALUES (?,?,?,?,?,?,?)', [name.trim(), location.trim(), address.trim(), description.trim(), imageUrl.trim(), ratingNum, JSON.stringify(amenitiesArray)]);
  res.status(201).json(one('SELECT * FROM hotels WHERE id=?', [id]));
});

app.patch('/api/admin/hotels/:id', requireAuth, requireAdmin, (req, res) => {
  const { name, location, address, description, imageUrl, rating, amenities } = req.body || {};
  if (![name, location, address, description, imageUrl].every((value) => typeof value === 'string' && value.trim()) || name.length > 100 || location.length > 100 || address.length > 200 || description.length > 1000 || imageUrl.length > 500 || !/^https:\/\//.test(imageUrl)) return res.status(400).json({ error: 'Complete all hotel fields with valid values.' });
  const hotelId = Number(req.params.id);
  if (!one('SELECT id FROM hotels WHERE id=?', [hotelId])) return res.status(404).json({ error: 'Hotel not found.' });
  const ratingNum = Number(rating);
  if (!Number.isFinite(ratingNum) || ratingNum < 0 || ratingNum > 5) return res.status(400).json({ error: 'Rating must be between 0 and 5.' });
  const amenitiesArray = Array.isArray(amenities) ? amenities : [];
  run('UPDATE hotels SET name=?,location=?,address=?,description=?,image_url=?,rating=?,amenities=? WHERE id=?', [name.trim(), location.trim(), address.trim(), description.trim(), imageUrl.trim(), ratingNum, JSON.stringify(amenitiesArray), hotelId]);
  res.json(one('SELECT * FROM hotels WHERE id=?', [hotelId]));
});

app.delete('/api/admin/hotels/:id', requireAuth, requireAdmin, (req, res) => {
  const hotelId = Number(req.params.id);
  if (!one('SELECT id FROM hotels WHERE id=?', [hotelId])) return res.status(404).json({ error: 'Hotel not found.' });
  run('DELETE FROM hotels WHERE id=?', [hotelId]);
  res.json({ ok: true });
});

app.post('/api/admin/rooms', requireAuth, requireAdmin, (req, res) => {
  const { hotelId, roomType, pricePerNightCents, capacity, amenities, imageUrl } = req.body || {};
  if (!one('SELECT id FROM hotels WHERE id=?', [Number(hotelId)]) || typeof roomType !== 'string' || !roomType.trim() || !Number.isInteger(Number(pricePerNightCents)) || Number(pricePerNightCents) < 0 || !Number.isInteger(Number(capacity)) || Number(capacity) < 1 || typeof imageUrl !== 'string' || !/^https:\/\//.test(imageUrl)) return res.status(400).json({ error: 'Complete all room fields with valid values.' });
  const amenitiesArray = Array.isArray(amenities) ? amenities : [];
  const id = run('INSERT INTO rooms (hotel_id,room_type,price_per_night_cents,capacity,amenities,image_url) VALUES (?,?,?,?,?,?)', [Number(hotelId), roomType.trim().slice(0, 80), Number(pricePerNightCents), Number(capacity), JSON.stringify(amenitiesArray), imageUrl.trim().slice(0, 500)]);
  res.status(201).json(one('SELECT * FROM rooms WHERE id=?', [id]));
});

app.patch('/api/admin/rooms/:id', requireAuth, requireAdmin, (req, res) => {
  const { hotelId, roomType, pricePerNightCents, capacity, amenities, imageUrl, active } = req.body || {};
  if (!one('SELECT id FROM hotels WHERE id=?', [Number(hotelId)]) || typeof roomType !== 'string' || !roomType.trim() || !Number.isInteger(Number(pricePerNightCents)) || Number(pricePerNightCents) < 0 || !Number.isInteger(Number(capacity)) || Number(capacity) < 1 || typeof imageUrl !== 'string' || !/^https:\/\//.test(imageUrl) || typeof active !== 'boolean') return res.status(400).json({ error: 'Complete all editable room fields.' });
  const roomId = Number(req.params.id);
  if (!one('SELECT id FROM rooms WHERE id=?', [roomId])) return res.status(404).json({ error: 'Room not found.' });
  const amenitiesArray = Array.isArray(amenities) ? amenities : [];
  run('UPDATE rooms SET hotel_id=?,room_type=?,price_per_night_cents=?,capacity=?,amenities=?,image_url=?,active=? WHERE id=?', [Number(hotelId), roomType.trim().slice(0, 80), Number(pricePerNightCents), Number(capacity), JSON.stringify(amenitiesArray), imageUrl.trim().slice(0, 500), active ? 1 : 0, roomId]);
  res.json(one('SELECT * FROM rooms WHERE id=?', [roomId]));
});

app.delete('/api/admin/rooms/:id', requireAuth, requireAdmin, (req, res) => {
  const roomId = Number(req.params.id);
  if (!one('SELECT id FROM rooms WHERE id=?', [roomId])) return res.status(404).json({ error: 'Room not found.' });
  run('DELETE FROM rooms WHERE id=?', [roomId]);
  res.json({ ok: true });
});

app.get('/api/admin/hotel-bookings', requireAuth, requireAdmin, (_req, res) => {
  const bookings = exec('SELECT hb.*,u.full_name AS customer_name,u.email AS customer_email,h.name AS hotel_name,r.room_type FROM hotel_bookings hb JOIN users u ON u.id=hb.user_id JOIN hotels h ON h.id=hb.hotel_id JOIN rooms r ON r.id=hb.room_id ORDER BY hb.created_at DESC LIMIT 100');
  res.json(bookings.map(safeHotelBooking));
});

app.patch('/api/admin/hotel-bookings/:code', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['Confirmed', 'Processing', 'Completed', 'Cancelled'].includes(status)) return res.status(400).json({ error: 'Choose a valid booking status.' });
  const booking = one('SELECT * FROM hotel_bookings WHERE booking_code=?', [req.params.code]);
  if (!booking) return res.status(404).json({ error: 'Hotel booking not found.' });
  if (booking.status === 'Cancelled' && status !== 'Cancelled') return res.status(409).json({ error: 'Cancelled bookings cannot be reopened.' });
  run('UPDATE hotel_bookings SET status=? WHERE id=?', [status, booking.id]);
  res.json(safeHotelBooking(one('SELECT * FROM hotel_bookings WHERE id=?', [booking.id])));
});

app.get('/api/auth/social-config', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '', facebookAppId: process.env.FACEBOOK_APP_ID || '' });
});

async function createOrGetSocialUser(profile, provider) {
  const email = String(profile.email || '').trim().toLowerCase();
  const fullName = String(profile.name || email.split('@')[0] || 'Atlas Traveler').trim().slice(0, 100);
  if (!validateEmail(email)) return null;
  let user = one('SELECT * FROM users WHERE email=?', [email]);
  if (user) return user;
  const base = fullName.replace(/[^A-Za-z0-9]/g, '').slice(0, 24).toLowerCase() || 'traveler';
  let username = base;
  let suffix = 1;
  while (one('SELECT id FROM users WHERE username=?', [username])) username = `${base}${suffix++}`;
  const passwordHash = await bcrypt.hash(`${provider}:${crypto.randomBytes(32).toString('hex')}`, 12);
  const userId = run('INSERT INTO users (full_name,username,email,phone,country,password_hash) VALUES (?,?,?,?,?,?)', [fullName, username, email, '', '', passwordHash]);
  return one('SELECT * FROM users WHERE id=?', [userId]);
}

function establishSocialSession(req, res, user) {
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Could not start a secure session.' });
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.save(() => res.json({ user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role }, csrfToken: req.session.csrfToken }));
  });
}

app.post('/api/auth/social/google', loginLimiter, async (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
  if (!googleClientId) return res.status(503).json({ error: 'Google sign-in is not configured. Ask the site administrator to set GOOGLE_CLIENT_ID.' });
  if (!credential) return res.status(400).json({ error: 'Google sign-in credential is missing.' });
  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const profile = await response.json();
    if (!response.ok || profile.aud !== googleClientId || !(profile.email_verified === true || profile.email_verified === 'true')) return res.status(401).json({ error: 'Google account verification failed.' });
    const user = await createOrGetSocialUser({ name: profile.name, email: profile.email }, 'google');
    if (!user) return res.status(400).json({ error: 'The Google account did not provide a valid email address.' });
    establishSocialSession(req, res, user);
  } catch (_error) {
    res.status(502).json({ error: 'Could not verify the Google account. Try again.' });
  }
});

app.post('/api/auth/social/facebook', loginLimiter, async (req, res) => {
  const appId = process.env.FACEBOOK_APP_ID || '';
  const appSecret = process.env.FACEBOOK_APP_SECRET || '';
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken : '';
  if (!appId || !appSecret) return res.status(503).json({ error: 'Facebook sign-in is not configured. Ask the site administrator to set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.' });
  if (!accessToken) return res.status(400).json({ error: 'Facebook access token is missing.' });
  try {
    const appToken = encodeURIComponent(`${appId}|${appSecret}`);
    const debugResponse = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${appToken}`);
    const debug = await debugResponse.json();
    const checked = debug.data;
    if (!debugResponse.ok || !checked?.is_valid || checked.app_id !== appId) return res.status(401).json({ error: 'Facebook account verification failed.' });
    const profileResponse = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`);
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email) return res.status(401).json({ error: 'Facebook did not provide an email address. Use your email and password or choose an account with email access.' });
    const user = await createOrGetSocialUser({ name: profile.name, email: profile.email }, 'facebook');
    if (!user) return res.status(400).json({ error: 'The Facebook account did not provide a valid email address.' });
    establishSocialSession(req, res, user);
  } catch (_error) {
    res.status(502).json({ error: 'Could not verify the Facebook account. Try again.' });
  }
});

app.use('/api', (error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.post('/api/ai/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1200) : '';
  if (!message) return res.status(400).json({ error: 'Enter a travel question first.' });
  if (!GROQ_API_KEY && !GEMINI_API_KEY) return res.status(503).json({ error: 'AI is not configured on the server.' });
  const systemPrompt = 'You are the Atlas Journeys travel assistant. Be concise, helpful, and practical. Recommend destinations from the Atlas collection when relevant. Clearly state that bookings, prices, and availability are demonstrations and do not make reservations.';

  try {
    if (GROQ_API_KEY) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
          temperature: 0.7,
          max_completion_tokens: 700
        })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text) return res.json({ text });
        return res.status(502).json({ error: 'The AI provider returned an empty response.' });
      }
      if (!GEMINI_API_KEY) return res.status(502).json({ error: data?.error?.message || 'The AI provider returned an error.' });
    }

    const body = JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [{ role: 'user', parts: [{ text: message }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 700 } });
    const attempts = [
      { url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, headers: { 'Content-Type': 'application/json' } },
      { url: 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY } }
    ];
    let response;
    let data;
    for (const attempt of attempts) {
      response = await fetch(attempt.url, { method: 'POST', headers: attempt.headers, body });
      data = await response.json().catch(() => ({}));
      if (response.ok) break;
    }
    if (!response?.ok) return res.status(502).json({ error: data?.error?.message || 'The AI provider returned an error.' });
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) return res.status(502).json({ error: 'The AI provider returned an empty response.' });
    res.json({ text });
  } catch (_error) {
    res.status(502).json({ error: 'Could not reach the AI travel assistant. Try again shortly.' });
  }
});


async function initialize() {
  const SQL = await initSqlJs();
  if (!isTest && fs.existsSync(DB_FILE)) db = new SQL.Database(fs.readFileSync(DB_FILE));
  else db = new SQL.Database();
  db.run(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  seed();
}

if (require.main === module) initialize().then(() => app.listen(PORT, () => console.log(`Atlas demo is ready at http://localhost:${PORT}`))).catch((error) => { console.error(error); process.exit(1); });

module.exports = { app, initialize, get db() { return db; }, run, one, exec };
