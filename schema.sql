PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL,
  country TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  image_url TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  base_price_cents INTEGER NOT NULL CHECK (base_price_cents >= 0),
  category TEXT NOT NULL,
  image_url TEXT NOT NULL,
  description TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  package_title TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  departure_country TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  return_date TEXT NOT NULL,
  adults INTEGER NOT NULL CHECK (adults > 0),
  children INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  travel_class TEXT NOT NULL CHECK (travel_class IN ('Economy', 'Premium economy', 'Business', 'First')),
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Processing', 'Cancelled', 'Completed')),
  payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Paid', 'Refund pending', 'Refunded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS bookings_user_created ON bookings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_code ON bookings(booking_code);

CREATE TABLE IF NOT EXISTS passengers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_type TEXT NOT NULL CHECK (passenger_type IN ('Adult', 'Child')),
  full_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'none',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Paid', 'Failed', 'Refund pending', 'Refunded')),
  provider_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cancellation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  cancelled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  refund_cents INTEGER NOT NULL DEFAULT 0 CHECK (refund_cents >= 0)
);

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'Processing', 'Cancelled', 'Completed')),
  note TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  ip_address TEXT NOT NULL,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS login_attempt_lookup ON login_attempts(email, ip_address, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  address TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  amenities TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type TEXT NOT NULL,
  price_per_night_cents INTEGER NOT NULL CHECK (price_per_night_cents >= 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  amenities TEXT NOT NULL DEFAULT '[]',
  image_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hotel_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE RESTRICT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  check_in_date TEXT NOT NULL,
  check_out_date TEXT NOT NULL,
  guests INTEGER NOT NULL CHECK (guests > 0),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Processing', 'Cancelled', 'Completed')),
  payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Paid', 'Failed', 'Refund pending', 'Refunded')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS hotel_bookings_user_created ON hotel_bookings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hotel_bookings_code ON hotel_bookings(booking_code);
