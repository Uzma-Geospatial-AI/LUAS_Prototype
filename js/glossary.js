/* ============================================================
   glossary.js — Every term the portal uses, in one place

   Opened from the book icon in the app bar. Each entry says what the term
   is and what it does here, in a sentence or two, grouped the way the
   portal is: the index, the map, the load budget, the licences, the
   satellite products, the data behind it all. The figures quoted are the
   ones the code actually uses, so this cannot drift from the system.
   ============================================================ */

const STD = 'EQ (Industrial Effluent) Regulations 2009';

export const GLOSSARY = [
  {
    group: 'Water Quality Index',
    terms: [
      ['WQI', 'Water Quality Index: a 0–100 score from six parameters, each converted to a sub-index and weighted (DOE method).',
        'The headline number for every station. Sets the class, the colour on the map, and whether the target is met.'],
      ['Sub-index (SI)', 'Each parameter rescaled to 0–100 before weighting, so different units can be combined.',
        'Shown per parameter in Phase 1 so the one dragging the score down can be picked out.'],
      ['DO', 'Dissolved oxygen, mg/L. Oxygen held in the water; falls as organic matter decomposes. Weight 22%.',
        'The most direct sign of stress: low DO means something is consuming oxygen faster than the river can replace it.'],
      ['BOD₅', 'Biochemical oxygen demand over five days, mg/L. Oxygen microbes use to break down organic matter. Weight 19%.',
        'Signals sewage and food waste. One of the four pollutants the load budget accounts for.'],
      ['COD', 'Chemical oxygen demand, mg/L. All oxidisable matter, synthetic compounds included. Weight 16%.',
        'Signals industrial effluent. Budgeted in Phase 3.'],
      ['SS', 'Suspended solids, mg/L. Sediment and particles carried in the water. Weight 16%.',
        'Turbidity from erosion, construction and run-off. Budgeted in Phase 3, and the parameter satellites see best.'],
      ['NH₃-N', 'Ammoniacal nitrogen, mg/L. Nitrogen from sewage, livestock and fertiliser. Weight 15%.',
        'Toxic to fish and the fuel for algae. Budgeted in Phase 3; often the binding pollutant on this reach.'],
      ['pH', 'Acidity or alkalinity on a 0–14 scale; about 6.5–9 is normal for a river. Weight 12%.',
        'Outside that band the water stresses aquatic life whatever else is in it.'],
      ['Class I – V', 'INWQS classes from the WQI: I ≥ 92.7 · II 76.5–92.7 · III 51.9–76.5 · IV 31–51.9 · V below 31.',
        'I: supply without treatment. II: conventional treatment, recreation. III: extensive treatment. IV: irrigation only. V: no use.'],
      ['INWQS', 'National Water Quality Standards for Malaysia: the class limits for each parameter.',
        'The yardstick behind every class label in the portal.'],
      ['Target class', 'The class a reach is managed to hold; Class II by default.',
        '"Met %" in the app bar is the share of months in the record that reached it.'],
      ['12-month median', 'The middle value of the last twelve monthly readings at the selected station.',
        'What the load budget uses as the river’s current concentration: steadier than any single sample.'],
    ],
  },
  {
    group: 'Map',
    terms: [
      ['Monitoring station', 'A river sampling point with a monthly six-parameter record.',
        'Coloured by the class of its latest WQI. The station picker in the app bar sets which one every phase is written for.'],
      ['River water level (JPS)', 'InfoBanjir gauges with a stage reading and a status: Normal, Waspada (alert), Amaran (warning), Bahaya (danger), or no reading.',
        'Shows where the river is high right now, which is when run-off and turbidity peak.'],
      ['Point source', 'A premises that can put a load into the river: industry, sewage and water treatment, landfill/quarry/waste, construction, farms and aquaculture.',
        'Drawn one shape per category. Green fill: holds a discharge licence. Red fill: none.'],
      ['Screening risk (0–5)', 'A score from how close a premises sits to water and how heavy its category is.',
        'A triage order, not a measurement: nothing here is metered. Larger symbol, higher score.'],
      ['Riparian zone', 'The 1.5 km band either side of any mapped water.',
        'Only premises inside it are shown; further out, where their discharge goes is not something the data can say.'],
      ['Nearest water', 'The closest river reach or water body to a premises, on the layers currently switched on.',
        'Named in each popup; the pin button flashes it on the map.'],
      ['Water body', 'An outline of open water from the Digital Earth national file, clipped to the catchment.',
        'Typed as treatment & oxidation basins, lakes & reservoirs, ponds (mostly ex-mining and detention), channel surface, or other.'],
      ['Water body flow', 'How water moves through a body, read off the mapped rivers: a river passes through it, it drains out to one, or nothing touches it.',
        'Said in the body’s tooltip. Only the rivers carry the flow animation.'],
      ['Flow direction', 'The downstream direction of every river reach, from the way OpenStreetMap draws it.',
        'The moving dashes on the channels. Nothing is inferred; the line already runs downstream.'],
      ['Langat catchment', 'The 2,140 km² basin that drains to Sungai Langat (HydroBASINS level 8).',
        'The clip for everything: a source outside it drains somewhere else.'],
      ['Licence register pin', 'A pin at a coordinate for a licence entered at a new location, with no premises symbol of its own.',
        'A licensed premises already on the map shows its licence as the green fill of its symbol, and in its popup.'],
    ],
  },
  {
    group: 'Load accounting (TMDL)',
    terms: [
      ['TMDL', 'Total Maximum Daily Load: the mass of a pollutant a reach can receive per day and still hold its class. TMDL = ΣWLA + ΣLA + MOS.',
        'Written for one location as a record: the three terms are inputs, in kg/day for each pollutant, and their sum has to fit the loading capacity.'],
      ['TMDL on record', 'One written TMDL for one location: a reference, a target class, a design flow, and ΣWLA, ΣLA and MOS for each pollutant.',
        'Pick the location in the app bar; its records are listed on the page, one loads, and New TMDL writes another.'],
      ['Loading capacity', 'Standard concentration × design flow × 86.4, in kg/day.',
        'What the TMDL has to fit inside at the target class and design flow.'],
      ['WLA', 'Wasteload allocation: the part of the TMDL given to licensed point sources.',
        'Written into the record. The register shows how much of it the licences have taken, and what is left to licence.'],
      ['LA', 'Load allocation: the share for diffuse and background sources with no permit — run-off, drains, land use.',
        'Written into the record; the diffuse load the river carries now is checked against it.'],
      ['MOS', 'Margin of safety, held back before anything is allocated.',
        'Written into the record. Write to capacity sets it as a share of the capacity, 10% unless changed.'],
      ['Write to capacity', 'The starting point a new TMDL is offered: MOS as a share of the capacity, the register honoured in the ΣWLA, the background given what the river carries beyond it, and any spare added to the ΣWLA. Over capacity, the ΣLA takes what is left.',
        'A suggestion to edit, not a decision.'],
      ['Current load', '12-month median concentration × design flow × 86.4, in kg/day.',
        'What the river carries now at the selected station.'],
      ['Left to licence', 'ΣWLA minus the licensed load, in kg/day.',
        'Positive: room for more licences. Negative: the licences already exceed the wasteload allocation.'],
      ['Diffuse load', 'Current load minus the licensed load.',
        'Background, run-off and unlicensed discharge that no permit accounts for.'],
      ['Design flow', 'The low-flow condition a TMDL is written for (MAM7 / 7Q10), not the mean. Part of the record; 4.5 m³/s at Dengkil as an estimate.',
        'The river has least capacity to dilute a load when flow is lowest, so that is the case to plan for.'],
      ['Wasteload', 'The mass a licence permits per day: concentration × permitted flow ÷ 1000, in kg/day.',
        'Each register row shows it for BOD, COD, SS and NH₃-N.'],
      ['Left to licence, as a volume', 'What is left of the ΣWLA divided by the standard concentration, in m³/day.',
        'How much new effluent at the chosen standard would still fit.'],
    ],
  },
  {
    group: 'Licences',
    terms: [
      ['SESAMS', 'Selangor Earth Surface Activity Monitoring System: the application MYSA (Agensi Angkasa Malaysia) built for LUAS to monitor land-use activity, above all on and around water bodies and where it could pollute the state’s water.',
        'The Earth surface activity page: every land-use site by its distance to water, its zone and licence, the waters under most pressure, and the satellite check.'],
      ['Earth surface change scan', 'Two quarters of a satellite product compared over every water body of 0.5 ha or more: the mean inside the water, and the share of bare ground on a 250 m ring of land around it.',
        'The SESAMS function proper. Bare ground up 10+ points: ground newly exposed. The water up 8+ points: the activity reaching it. The map button shows the later quarter there.'],
      ['River reserve (screen)', 'Within 50 m of mapped water. The Selangor Waters Management Enactment 1999 sets reserves by river width; 50 m is used here for every reach.',
        'The red zone on the SESAMS page: activity close enough to need a look.'],
      ['Riparian zone (250 m)', 'Within 250 m of mapped water.',
        'Run-off reaches the water in one rain event; the orange zone.'],
      ['Licence register', 'The list of premises permitted to discharge, with their reference, flow and permitted concentrations.',
        'The source of the WLA, and of the green symbols on the map. Kept in this browser unless exported.'],
      ['Licence', 'A permit to discharge effluent: reference, premises, category, standard, permitted flow and four permitted concentrations.',
        'Add one from a premises on the map or a new location; its wasteload is previewed against the remaining capacity.'],
      ['Standard A', `${STD}, Standard A: BOD 20 · COD 80 · SS 50 · NH₃-N 10 mg/L.`,
        'Applies upstream of a water intake — the tighter of the two.'],
      ['Standard B', `${STD}, Standard B: BOD 50 · COD 200 · SS 100 · NH₃-N 20 mg/L.`,
        'Applies downstream of any intake.'],
      ['Permitted concentration', 'The effluent concentration a licence allows for each pollutant, mg/L.',
        'Compared with the standard: within it or exceeding it.'],
      ['Permitted flow', 'The effluent volume a licence allows, m³/day.',
        'Multiplied by concentration to give the wasteload.'],
      ['Within / Exceeds', 'Whether every permitted concentration sits under the chosen standard.',
        'The status pill on each register row.'],
      ['Active / Suspended', 'Whether a licence currently counts.',
        'A suspended licence drops out of the WLA and its premises turns red on the map.'],
      ['Worked example', 'One of five curated licences on real premises with invented figures.',
        'Gives the budget something to account for on a first visit. Not a real licence.'],
      ['Estimated', 'A licence assumed from the premises category, on a real premises, with invented figures.',
        'No LUAS register is published, so the estimate is what colours the map. Not a real licence.'],
      ['Located', 'A licence with coordinates.',
        'Drawn on the map; clicking its register row goes there.'],
    ],
  },
  {
    group: 'Satellite',
    terms: [
      ['Sentinel-2', 'ESA’s optical satellite pair: 10–20 m pixels, a pass every five days, thirteen bands including a red edge.',
        'The source of every water-quality product and the Cloudless basemap.'],
      ['NDTI', 'Turbidity index: (Red − Green) ÷ (Red + Green), Sentinel-2 B4 and B3. Clear water at or below zero; rising with suspended sediment.',
        'Shows muddy water: plumes after rain, construction and dredging run-off, bank erosion. A proxy for the SS row.'],
      ['NDCI', 'Chlorophyll index: (Red-Edge − Red) ÷ (Red-Edge + Red), B5 and B4. Algae absorb red and reflect the red edge.',
        'Shows algal biomass building in reservoirs, ponds and slow reaches: an early warning for blooms and a trace of the nutrient load.'],
      ['SS (satellite)', 'Suspended solids in mg/L from a Red ÷ Green ratio fitted to field samples. The fit here is a placeholder, not made on these rivers.',
        'Relative pattern only until refitted against station readings; marked uncalibrated in the legend.'],
      ['NDWI', 'Water index: (Green − NIR) ÷ (Green + NIR). Water positive, land negative.',
        'Delineates open water and how it changes between dry season and monsoon.'],
      ['LST', 'Land surface temperature from thermal bands.',
        'Warm water holds less oxygen, so thermal discharge and the urban heat island feed back into DO.'],
      ['Quarter', 'A three-month composite: Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep 2026.',
        'One quarter shows at a time; switch between them to see a plume or bloom change.'],
      ['Water only', 'Clips the satellite product to the mapped rivers and water bodies.',
        'The scene is painted edge to edge with land at the low end of the ramp; untick to see it whole, where bare soil lights up too.'],
      ['Basemap', 'The imagery under everything: Esri World Imagery, Google, Sentinel-2 Cloudless, or daily VIIRS from NASA GIBS.',
        'Daily layers take an acquisition date, for looking at a particular event.'],
    ],
  },
  {
    group: 'Data',
    terms: [
      ['Sample readings', 'The station parameter values in this prototype are simulated. Station positions are real.',
        'No open API publishes the readings; the shape of the record is realistic so the system can be demonstrated.'],
      ['data.gov.my', 'Malaysia’s open data portal.',
        'Source of the national river-basin pollution figures.'],
      ['OpenStreetMap', 'The open world map, read through the Overpass API.',
        'Source of the rivers and the point-source premises.'],
      ['Digital Earth', 'Digital Earth Malaysia’s open datasets.',
        'Source of the water-body outlines and the satellite water-quality products.'],
      ['HydroSHEDS', 'Global hydrography from elevation data.',
        'Source of the catchment boundary (HydroBASINS level 8).'],
      ['JPS InfoBanjir', 'The Department of Irrigation and Drainage flood portal.',
        'Source of the river water-level gauges and their statuses.'],
      ['Firebase', 'The Realtime Database the deployed site reads its datasets from.',
        'Falls back to the bundled files if the database cannot answer; the app bar says which one served.'],
    ],
  },
];

const BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
  + 'stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>'
  + '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Put the book in the app bar and the glossary behind it */
export function buildGlossary() {
  const btn = document.createElement('button');
  btn.className = 'ab-icon';
  btn.id = 'glossaryBtn';
  btn.title = 'Glossary — every term used here';
  btn.setAttribute('aria-label', 'Glossary');
  btn.innerHTML = BOOK;
  document.querySelector('.ab-meta').appendChild(btn);

  const wrap = document.createElement('div');
  wrap.className = 'glossary';
  wrap.id = 'glossary';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="gl-back" data-close></div>
    <div class="gl-panel" role="dialog" aria-modal="true" aria-labelledby="glTitle">
      <div class="gl-head">
        <div>
          <h2 id="glTitle">${BOOK} Glossary</h2>
          <div class="gl-sub">Every term the portal uses — what it is, and what it does here.</div>
        </div>
        <label class="reg-search gl-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="glSearch" placeholder="Find a term…" aria-label="Find a term" autocomplete="off">
        </label>
        <button class="gl-close" data-close aria-label="Close">×</button>
      </div>
      <nav class="gl-nav">${GLOSSARY.map((g, i) => `<a href="#gl-${i}">${esc(g.group)}</a>`).join('')}</nav>
      <div class="gl-body">
        ${GLOSSARY.map((g, i) => `
          <section class="gl-group" id="gl-${i}">
            <h3>${esc(g.group)} <span>${g.terms.length}</span></h3>
            <table class="gl-table">
              <thead><tr><th>Term</th><th>What it is</th><th>What it does here</th></tr></thead>
              <tbody>${g.terms.map(([t, d, f]) => `
                <tr data-text="${esc(`${t} ${d} ${f}`.toLowerCase())}">
                  <td class="gl-t">${esc(t)}</td><td>${esc(d)}</td><td>${esc(f)}</td>
                </tr>`).join('')}</tbody>
            </table>
          </section>`).join('')}
        <div class="gl-empty" hidden>No term matches that.</div>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const open = () => {
    wrap.hidden = false;
    document.body.classList.add('gl-open');
    $('glSearch').value = '';
    filter('');
    setTimeout(() => $('glSearch').focus(), 50);
  };
  const close = () => {
    wrap.hidden = true;
    document.body.classList.remove('gl-open');
    btn.focus();
  };
  btn.onclick = open;
  wrap.querySelectorAll('[data-close]').forEach((el) => { el.onclick = close; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !wrap.hidden) close();
  });

  /* The nav scrolls within the panel, not the page */
  wrap.querySelectorAll('.gl-nav a').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      wrap.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  const filter = (q) => {
    q = q.trim().toLowerCase();
    let any = false;
    wrap.querySelectorAll('.gl-group').forEach((sec) => {
      let n = 0;
      sec.querySelectorAll('tbody tr').forEach((tr) => {
        const on = !q || tr.dataset.text.includes(q);
        tr.hidden = !on;
        if (on) n += 1;
      });
      sec.hidden = n === 0;
      sec.querySelector('h3 span').textContent = n;
      if (n) any = true;
    });
    wrap.querySelector('.gl-empty').hidden = any;
  };
  $('glSearch').addEventListener('input', (e) => filter(e.target.value));
}

const $ = (id) => document.getElementById(id);
