const state = { csrf: '', user: null, overview: null, toastTimer: null };
if (localStorage.getItem('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const statusClass = (status) => `status-${String(status).toLowerCase()}`;

function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const button = $('.admin-theme-toggle');
  if (!button) return;
  button.textContent = dark ? '☀️' : '🌙';
  button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
  button.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
}

async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': state.csrf } : {}), ...options.headers };
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('visible'), 3300);
}

function showLogin(message = '') {
  state.user = null;
  $('#admin-dashboard').hidden = true;
  $('#admin-login').hidden = false;
  $('#admin-login-message').textContent = message;
}

function showDashboard() {
  $('#admin-login').hidden = true;
  $('#admin-dashboard').hidden = false;
  $('#admin-actions').innerHTML = `<a class="text-button" href="/">View site</a><button class="text-button admin-theme-toggle" type="button" data-action="theme" aria-label="${document.documentElement.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}" title="${document.documentElement.dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button><button class="button button-small button-dark" data-action="logout">Log out</button>`;
  syncThemeButton();
  $('#admin-profile').innerHTML = state.user ? `<span class="admin-avatar">${escapeHtml((state.user.fullName || 'A')[0].toUpperCase())}</span><div><strong>${escapeHtml(state.user.fullName)}</strong><small>${escapeHtml(state.user.email)} · Administrator</small></div>` : '';
}

function setStats(data) {
  $('#admin-stats').innerHTML = [
    ['Customers', data.users],
    ['Administrators', data.admins],
    ['Booking requests', data.bookings],
    ['Awaiting review', data.pending],
    ['Packages', `${data.activePackages}/${data.packagesCount}`],
    ['Destinations', data.destinations],
    ['Hotels', data.hotelsCount],
    ['Rooms', data.roomsCount],
    ['Hotel bookings', data.hotelBookings],
    ['Request value', money(data.revenueCents)],
    ['Hotel value', money(data.hotelRevenueCents)]
  ].map(([title, value]) => `<div class="stat-card"><small>${title}</small><strong>${value}</strong></div>`).join('');
  $('#policy-fee').value = (data.settings.cancellationFeeCents / 100).toFixed(2);
  $('#policy-hours').value = data.settings.freeCancellationHours;
}

function setBookings(bookings) {
  $('#admin-bookings').innerHTML = bookings.length ? bookings.map((booking) => `<div class="admin-row" data-admin-row="${escapeHtml(`${booking.booking_code} ${booking.customer_name} ${booking.customer_email}`.toLowerCase())}"><strong>${escapeHtml(booking.booking_code)}</strong><span>${escapeHtml(booking.customer_name)}</span><span>${escapeHtml(booking.destination_name || '—')}</span><span class="status-badge ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span><select aria-label="Update ${escapeHtml(booking.booking_code)} status" data-admin-status="${escapeHtml(booking.booking_code)}"><option ${booking.status === 'Pending' ? 'selected' : ''} disabled>${escapeHtml(booking.status)}</option>${['Confirmed', 'Processing', 'Completed', 'Cancelled'].filter((status) => status !== booking.status).map((status) => `<option>${status}</option>`).join('')}</select></div>`).join('') : '<div class="empty-state">No booking requests yet.</div>';
}

function setPackages(packages) {
  $('#admin-packages').innerHTML = packages.length ? packages.map((pkg) => `<div class="admin-package"><img src="${escapeHtml(pkg.image_url)}" alt=""><div class="admin-package-info"><strong>${escapeHtml(pkg.title)}</strong><small>${escapeHtml(pkg.destination_name)} · ${money(pkg.base_price_cents)} · ${pkg.active ? 'Active' : 'Hidden'}</small></div><button data-edit-package="${pkg.id}">Edit</button><button data-hide-package="${pkg.id}" data-active="${pkg.active}">${pkg.active ? 'Hide' : 'Restore'}</button></div>`).join('') : '<div class="empty-state">No travel packages yet.</div>';
}

function setDestinations(destinations) {
  $('#admin-destinations').innerHTML = destinations.length ? destinations.map((destination) => `<div class="admin-package"><img src="${escapeHtml(destination.image_url)}" alt=""><div class="admin-package-info"><strong>${escapeHtml(destination.name)}</strong><small>${escapeHtml(destination.country)} · ${escapeHtml(destination.region)}</small></div><button data-edit-destination="${destination.id}">Edit</button></div>`).join('') : '<div class="empty-state">No destinations yet.</div>';
  $('#package-form').elements.destinationId.innerHTML = destinations.map((destination) => `<option value="${destination.id}">${escapeHtml(destination.name)}, ${escapeHtml(destination.country)}</option>`).join('');
}

function setUsers(users) {
  $('#admin-users').innerHTML = users.length ? users.map((user) => `<div class="admin-user-row"><strong>${escapeHtml(user.full_name)}</strong><span>@${escapeHtml(user.username || '—')}</span><span>${escapeHtml(user.email)}</span><span>${escapeHtml(user.phone || 'No phone')}</span><span>${escapeHtml(user.country)}</span><small>${escapeHtml(user.role)} · ${escapeHtml((user.created_at || '').slice(0, 10) || 'Unknown date')}</small></div>`).join('') : '<div class="empty-state">No accounts yet.</div>';
}

async function loadAdmin() {
  $('#admin-stats').innerHTML = '<div class="loading-note">Loading overview…</div>';
  try {
    const [overview, users] = await Promise.all([api('/api/admin/overview'), api('/api/admin/users')]);
    state.overview = overview;
    setStats(overview);
    setBookings(overview.bookingsList);
    setPackages(overview.packages);
    setDestinations(overview.destinationsList);
    setUsers(users);
  } catch (error) {
    if (/access|sign|administrator/i.test(error.message)) return showLogin(error.message);
    $('#admin-stats').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function openPackageForm(pkg = null) {
  const form = $('#package-form');
  form.reset();
  $('#package-message').textContent = '';
  $('#package-dialog-title').innerHTML = pkg ? 'Edit a <em>package.</em>' : 'Add a <em>package.</em>';
  form.elements.id.value = pkg?.id || '';
  form.elements.title.value = pkg?.title || '';
  form.elements.destinationId.value = pkg?.destination_id || state.overview?.destinationsList[0]?.id || '';
  form.elements.durationDays.value = pkg?.duration_days || 5;
  form.elements.price.value = pkg ? (pkg.base_price_cents / 100).toFixed(2) : '';
  form.elements.category.value = pkg?.category || 'Culture';
  form.elements.imageUrl.value = pkg?.image_url || '';
  form.elements.description.value = pkg?.description || '';
  $('#package-dialog').showModal();
}

function openDestinationForm(destination = null) {
  const form = $('#destination-form');
  form.reset();
  $('#destination-message').textContent = '';
  $('#destination-dialog-title').innerHTML = destination ? 'Edit a <em>destination.</em>' : 'Add a <em>destination.</em>';
  form.elements.id.value = destination?.id || '';
  form.elements.name.value = destination?.name || '';
  form.elements.country.value = destination?.country || '';
  form.elements.region.value = destination?.region || '';
  form.elements.imageUrl.value = destination?.image_url || '';
  form.elements.description.value = destination?.description || '';
  $('#destination-dialog').showModal();
}

async function initialize() {
  try {
    const csrf = await api('/api/csrf');
    state.csrf = csrf.csrfToken;
    const session = await api('/api/auth/me');
    state.user = session.user;
    if (session.user?.role === 'admin') {
      showDashboard();
      await loadAdmin();
    } else {
      showLogin(session.user ? 'You are signed in as a customer. Sign in with an administrator account to continue.' : '');
    }
  } catch (error) {
    showLogin(error.message);
  }
}

$$('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

$('#admin-actions').addEventListener('click', async (event) => {
  const themeButton = event.target.closest('[data-action="theme"]');
  if (themeButton) {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === 'dark' ? '' : 'dark';
    localStorage.setItem('theme', html.dataset.theme);
    syncThemeButton();
    return;
  }
  if (!event.target.closest('[data-action="logout"]')) return;
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    state.user = null;
    window.location.reload();
  } catch (error) { toast(error.message); }
});

$('#admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $('#admin-login-message');
  const button = $('button[type="submit"]', form);
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Signing in…';
  message.textContent = '';
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    state.csrf = result.csrfToken;
    if (result.user.role !== 'admin') {
      message.textContent = 'That account does not have administrator access.';
      return;
    }
    state.user = result.user;
    form.reset();
    showDashboard();
    await loadAdmin();
    toast(`Welcome back, ${result.user.fullName.split(' ')[0]}.`);
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = original; }
});

$('#admin-search').addEventListener('input', (event) => {
  const search = event.target.value.trim().toLowerCase();
  $$('[data-admin-row]').forEach((row) => { row.hidden = !row.dataset.adminRow.includes(search); });
});

$('#policy-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/admin/policy', { method: 'PUT', body: JSON.stringify({ cancellationFeeCents: Math.round(Number($('#policy-fee').value) * 100), freeCancellationHours: Number($('#policy-hours').value) }) });
    toast('Cancellation policy saved.');
  } catch (error) { toast(error.message); }
});

$('#package-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  const id = values.id;
  const body = { destinationId: Number(values.destinationId), title: values.title, durationDays: Number(values.durationDays), basePriceCents: Math.round(Number(values.price) * 100), category: values.category, imageUrl: values.imageUrl, description: values.description, active: true };
  try {
    if (id) {
      const current = state.overview?.packages.find((item) => Number(item.id) === Number(id));
      await api(`/api/admin/packages/${id}`, { method: 'PATCH', body: JSON.stringify({ ...body, active: Boolean(current?.active ?? true) }) });
    } else await api('/api/admin/packages', { method: 'POST', body: JSON.stringify(body) });
    $('#package-dialog').close();
    await loadAdmin();
    toast('Travel package saved.');
  } catch (error) { $('#package-message').textContent = error.message; }
});

$('#destination-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  const id = values.id;
  const body = { name: values.name, country: values.country, region: values.region, imageUrl: values.imageUrl, description: values.description };
  try {
    await api(id ? `/api/admin/destinations/${id}` : '/api/admin/destinations', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    $('#destination-dialog').close();
    await loadAdmin();
    toast('Destination saved.');
  } catch (error) { $('#destination-message').textContent = error.message; }
});

document.addEventListener('click', async (event) => {
  if (event.target.closest('#add-package')) return openPackageForm();
  if (event.target.closest('#add-destination')) return openDestinationForm();
  const editDestination = event.target.closest('[data-edit-destination]');
  if (editDestination) return openDestinationForm(state.overview?.destinationsList.find((destination) => Number(destination.id) === Number(editDestination.dataset.editDestination)));
  const editPackage = event.target.closest('[data-edit-package]');
  if (editPackage) return openPackageForm(state.overview?.packages.find((pkg) => Number(pkg.id) === Number(editPackage.dataset.editPackage)));
  const hideButton = event.target.closest('[data-hide-package]');
  if (hideButton) {
    try {
      if (hideButton.dataset.active === '1') await api(`/api/admin/packages/${hideButton.dataset.hidePackage}`, { method: 'DELETE' });
      else {
        const pkg = state.overview?.packages.find((item) => Number(item.id) === Number(hideButton.dataset.hidePackage));
        if (pkg) await api(`/api/admin/packages/${pkg.id}`, { method: 'PATCH', body: JSON.stringify({ destinationId: pkg.destination_id, title: pkg.title, durationDays: pkg.duration_days, basePriceCents: pkg.base_price_cents, category: pkg.category, imageUrl: pkg.image_url, description: pkg.description, active: true }) });
      }
      await loadAdmin();
      toast('Package visibility updated.');
    } catch (error) { toast(error.message); }
  }
});

document.addEventListener('change', async (event) => {
  const statusSelect = event.target.closest('[data-admin-status]');
  if (!statusSelect || !statusSelect.value || statusSelect.selectedOptions[0].disabled) return;
  if (!window.confirm(`Update booking ${statusSelect.dataset.adminStatus} to ${statusSelect.value}?`)) return loadAdmin();
  try {
    await api(`/api/admin/bookings/${encodeURIComponent(statusSelect.dataset.adminStatus)}`, { method: 'PATCH', body: JSON.stringify({ status: statusSelect.value }) });
    await loadAdmin();
    toast('Booking status updated.');
  } catch (error) { toast(error.message); }
});

syncThemeButton();
initialize();
