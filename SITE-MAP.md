# Atlas Journeys Site Map

The customer-facing site is a single-page application served at `/`. Items marked as views or dialogs change the page state without adding a separate URL path.

The administrator console is a separate page at `/admin`, served from `public/admin.html` with its own scripts and sign-in form. It is linked from the header for signed-in administrator accounts.

```text
/  Atlas Journeys
├── Home view
│   ├── #home — hero and primary call to action
│   ├── #book — trip search
│   │   ├── Departure country
│   │   ├── Destination country or city
│   │   ├── Departure and return dates
│   │   ├── Travellers
│   │   └── Travel class
│   ├── #destinations — featured destinations
│   ├── #packages — searchable sample trips and category filters
│   ├── Experiences — flight, stay, and tour sample sections
│   ├── #offers — demonstration offer
│   ├── Reviews — illustrative customer feedback
│   └── Newsletter — demo-only form
├── Sign up dialog
│   └── Create account
├── Log in dialog
│   └── Forgot password notice (email reset is not configured)
├── Booking dialog (authenticated customers)
│   └── Review and create a demo booking request
├── My Orders view (authenticated customers; own bookings only)
│   ├── Search and status filters
│   └── Order details dialog
│       ├── Booking status tracker
│       ├── Print confirmation
│       └── Eligible cancellation
└── Admin view (administrator role only)
    ├── Booking overview and status management
    ├── Customer accounts
    ├── Travel packages — add, edit, hide, restore
    ├── Destinations — add and edit
    └── Cancellation policy
```

## API Route Tree

```text
/api
├── /csrf
├── /auth
│   ├── GET  /me
│   ├── POST /register
│   ├── POST /login
│   └── POST /logout
├── GET /countries
├── GET /phone-countries
├── GET /destinations
├── GET /packages
├── GET /cancellation-policy
├── /bookings (authenticated, owner-scoped)
│   ├── GET  /
│   ├── POST /
│   ├── GET  /:code
│   └── POST /:code/cancel
└── /admin (authenticated, administrator-only)
    ├── GET    /overview
    ├── GET    /users
    ├── POST   /destinations
    ├── PATCH  /destinations/:id
    ├── PATCH  /bookings/:code
    ├── POST   /packages
    ├── PATCH  /packages/:id
    ├── DELETE /packages/:id
    └── PUT    /policy
```

All trips are demonstration data. The site does not connect to live travel suppliers, payment processing, or password-reset email.
