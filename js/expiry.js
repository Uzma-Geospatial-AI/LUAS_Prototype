/* ============================================================
   expiry.js — When a discharge licence runs out

   An effluent discharge licence is granted for a term and renewed. The
   register therefore has to say not only what a premises may discharge but
   until when, and the page has to say so before the date rather than after:
   a licence that lapsed last week is a premises discharging without one.

   So every entry carries an issue date and an expiry date, and each is read
   back three ways:

     expired   the date has passed
     soon      within the warning window — a month, unless changed
     valid     beyond it

   The window is the operator's choice, not a constant: a month is enough
   notice to start a renewal, three months is enough to plan an inspection
   round. It is kept with the other design conditions.

       WHAT IS NOT ASSERTED

   No LUAS licence register is published as open data, so the dates on the
   estimated entries are invented like their figures. Every one of them is
   set in the FUTURE on purpose. Inventing a lapsed licence against a named
   real business would be a claim that it is discharging unlawfully, and a
   badge on the row does not undo that. A date approaching is ordinary
   administration and asserts nothing; a date passed is an allegation.
   ============================================================ */
import { store } from './store.js';

export const WARN_WINDOWS = [30, 60, 90];

/* 'YYYY-MM-DD' read as a local date. Date's own parser takes a bare date as
   UTC midnight, which lands on the day before east of Greenwich. */
export function parseDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* Whole days from today to that date: 0 is today, negative is past */
export function daysUntil(iso) {
  const then = parseDay(iso);
  if (!then) return null;
  return Math.round((then - startOfToday()) / 86400000);
}

/* A countdown a person would say out loud. Days close in, months further
   out, because "in 419 days" is a number nobody holds in their head. */
export function countdown(days) {
  if (days == null) return '—';
  const n = Math.abs(days);
  const said = n === 0 ? 'today'
    : n === 1 ? '1 day'
      : n < 45 ? `${n} days`
        : n < 400 ? `${Math.round(n / 30.44)} months`
          : `${(n / 365.25).toFixed(1)} years`;
  if (days === 0) return 'expires today';
  return days > 0 ? `in ${said}` : `${said} ago`;
}

export const warnDays = () => store.conditions().warnDays ?? 30;

/* Where one licence stands. `has` is false when no date is on record, which
   is not the same as expired and must not be coloured as if it were. */
export function expiryOf(l, within = warnDays()) {
  const iso = l?.expires ?? null;
  const days = daysUntil(iso);
  if (days == null) {
    return { has: false, iso: null, days: null, state: 'none', label: 'No date on record',
      colour: '#8b93a8', pill: 'st-off' };
  }
  if (days < 0) {
    return { has: true, iso, days, state: 'expired', label: `Expired ${countdown(days)}`,
      colour: '#d92d20', pill: 'st-fail' };
  }
  if (days <= within) {
    return { has: true, iso, days, state: 'soon', label: `Expires ${countdown(days)}`,
      colour: '#ef7d1a', pill: 'st-warn' };
  }
  return { has: true, iso, days, state: 'valid', label: `Valid, expires ${countdown(days)}`,
    colour: '#17a04a', pill: 'st-pass' };
}

/* The register sorted into the four states, each soonest first. Suspended
   entries are counted apart: a licence already withdrawn is not a renewal
   anyone is chasing. */
export function expirySummary(licences, within = warnDays()) {
  const out = { within, expired: [], soon: [], valid: [], none: [], inactive: [] };
  for (const l of licences ?? []) {
    if (l.active === false) { out.inactive.push(l); continue; }
    const e = expiryOf(l, within);
    out[e.state].push({ ...l, expiry: e });
  }
  const bySoonest = (a, b) => a.expiry.days - b.expiry.days;
  out.expired.sort(bySoonest);
  out.soon.sort(bySoonest);
  out.valid.sort(bySoonest);
  /* What wants attention: gone already, then going next */
  out.attention = [...out.expired, ...out.soon];
  return out;
}

/* Is the expiry after the issue date, where both are given? A term that ends
   before it starts is a typo, not a record. */
export function termProblem(issued, expires) {
  const a = parseDay(issued), b = parseDay(expires);
  if (a && b && b <= a) return 'The expiry has to come after the issue date.';
  return '';
}
