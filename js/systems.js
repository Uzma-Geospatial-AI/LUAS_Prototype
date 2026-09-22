/* ============================================================
   systems.js — The systems LUAS already has

   This portal is one thing among several, and most of the data it works
   with is somebody else's. A prototype that does not say so invites being
   read as a replacement for systems that are already in service.

   So this page names them: who owns each, what it does, and what this
   portal holds of it. Several belong to partners, which means ownership
   and data access are things to agree rather than assume.

       WHAT IS WRITTEN DOWN AND WHAT IS NOT

   Every `confirm` line is a question still open — taken from the review of
   what LUAS has, not from a signed record. They are kept on the page
   rather than tidied away, because a gap in what we know is worth as much
   to a reader as a fact.

   Only SESAMS has an address here. The others are internal or reached
   through a portal whose URL is not ours to publish, and guessing one
   would be worse than leaving it out.
   ============================================================ */

export const SYSTEMS = [
  {
    id: 'river',
    label: 'The river',
    note: 'flow, levels and water quality',
    colour: '#0aa3d9',
    items: [
      {
        name: 'Integrated Water Resources Information Management System',
        abbr: 'IWRMS',
        owner: 'LUAS',
        since: 'In phases since 2012',
        what: 'Records dam levels, rainfall, river levels, abstraction and telemetry water quality. '
          + 'Shares station data with agencies by FTP or API under a memorandum of understanding.',
        confirm: 'Which stations and how much history it holds for the Sungai Langat basin.',
        here: 'This portal reads the published DOE and JPS records instead, and the monthly station '
          + 'series it ships is sample data.',
      },
      {
        name: 'LUAS Intelligent Support System',
        abbr: 'LiSS',
        owner: 'LUAS',
        what: 'Hydrological modelling on Met Malaysia and JPS data, forecasting flow 120 hours ahead '
          + 'to optimise dam releases on Sungai Selangor and Sungai Langat.',
        confirm: 'Whether its flow record is long enough to define a low-flow design condition.',
        here: 'That is the number every TMDL here hangs on. Until it comes from a record, the design '
          + 'flow is an estimate scaled from Dengkil and flagged as one.',
      },
      {
        name: 'River Monitoring Stations',
        abbr: 'RMS',
        owner: 'Air Selangor · readable by LUAS',
        since: '15 stations',
        what: 'Continuous sensors on the main rivers for early pollution detection, protecting the '
          + 'intakes of the treatment plants downstream.',
        confirm: 'Which of the 15 sit in the Langat basin, what each measures, and whether the '
          + 'history is reachable.',
        here: 'Nothing continuous is shown here. The assessment works on monthly sampling, which is '
          + 'what the WQI is defined on.',
      },
      {
        name: 'Telemetry network and planned expansion',
        owner: 'LUAS',
        what: 'The existing telemetry stations are under maintenance procurement, and LUAS is '
          + 'studying AI-assisted sampling along with new water quantity and quality stations.',
        confirm: 'What stage the study has reached, and whether it will bring a display system of '
          + 'its own.',
        here: 'A location can be added here by hand and given readings, which is a way to try a '
          + 'proposed station before there is anything to install.',
      },
    ],
  },
  {
    id: 'discharge',
    label: 'The dischargers',
    note: 'licences, volumes and effluent quality',
    colour: '#4a3aa7',
    items: [
      {
        name: 'Effluent Discharge Licensing System',
        abbr: 'LEDS',
        owner: 'LUAS · online through the eLesen portal',
        since: 'Since 2018',
        what: 'Applications and renewals for return water and pollutant discharge licences, covering '
          + '13 scheduled activities — poultry farming, industry and sewage treatment among them.',
        confirm: 'Whether the quarterly returns and the laboratory certificates are held here too.',
        here: 'The licence register on the TMDL page is a working model of this: terms, renewals, '
          + 'permitted load and the charge each would attract. Its rows are estimates, not records.',
      },
      {
        name: 'Water Resources Management System',
        abbr: 'SPASA',
        owner: 'LUAS',
        what: 'Licensees report their monthly water intake and discharge volumes.',
        confirm: 'How SPASA and LEDS relate to one another, and whether the volumes can be exported.',
        here: 'The volume charge computed here uses the permitted flow on the licence. A reported '
          + 'monthly volume from SPASA is the figure it should use instead.',
      },
      {
        name: 'LUAS laboratory',
        owner: 'LUAS',
        what: 'Receives licensee effluent samples, taken at the final discharge point named in each '
          + 'licence, while the premises is operating.',
        confirm: 'Whether the results are captured as data or only as certificates.',
        here: 'The load charge here is worked from the permitted concentrations. A measured result is '
          + 'what would actually be charged on.',
      },
    ],
  },
  {
    id: 'land',
    label: 'The land',
    note: 'activity around water bodies',
    colour: '#157f3a',
    items: [
      {
        name: 'Selangor Earth Surface Activity Monitoring System',
        abbr: 'SESAMS',
        owner: 'Agensi Angkasa Malaysia (MYSA), for LUAS',
        since: 'Memorandum of understanding August 2024 · launched June 2026',
        what: 'Satellite monitoring of land use and land clearing around water bodies, and in areas '
          + 'that may contribute to water source pollution.',
        confirm: 'What an officer does after a detection, and what SESAMS connects to.',
        url: 'https://sesams.mysa.gov.my/',
        here: 'This portal holds the ground SESAMS watches — the mapped water bodies, the point '
          + 'sources around them and the quarterly Sentinel-2 products — but none of its detections.',
      },
    ],
  },
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderSystems() {
  const box = document.getElementById('sysList');
  if (!box) return;
  const n = SYSTEMS.reduce((t, g) => t + g.items.length, 0);
  const open = SYSTEMS.reduce((t, g) => t + g.items.filter((s) => s.confirm).length, 0);

  const sub = document.getElementById('sysSub');
  if (sub) {
    sub.textContent = `${n} systems, ${open} with something still to confirm. `
      + 'Several belong to partners, so ownership and data access are to be agreed rather than assumed.';
  }

  box.innerHTML = SYSTEMS.map((g) => `
    <div class="sys-group">
      <h3 class="sys-head"><i style="background:${g.colour}"></i>${esc(g.label)}
        <span>${esc(g.note)}</span></h3>
      <div class="sys-grid">
        ${g.items.map((s) => `
          <div class="card sys" style="--sc:${g.colour}">
            <div class="sys-name">${esc(s.name)}${s.abbr
              ? ` <span class="badge soft">${esc(s.abbr)}</span>` : ''}</div>
            <div class="sys-own">${esc(s.owner)}${s.since ? ` · ${esc(s.since)}` : ''}</div>
            <p>${esc(s.what)}</p>
            ${s.confirm ? `<div class="sys-confirm"><b>To confirm</b> ${esc(s.confirm)}</div>` : ''}
            ${s.here ? `<div class="sys-here"><b>In this portal</b> ${esc(s.here)}</div>` : ''}
            ${s.url ? `<div class="btn-row">
              <a class="btn btn-primary" href="${esc(s.url)}" target="_blank" rel="noopener">
                Open ${esc(s.abbr ?? s.name)}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" class="away-arrow"><path d="M7 17 17 7M9 7h8v8"/></svg></a>
              <span class="hint">${esc(new URL(s.url).host)} · opens in a new tab</span>
            </div>` : ''}
          </div>`).join('')}
      </div>
    </div>`).join('');
}
