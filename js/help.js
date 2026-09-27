'use strict';

// ===== HELP =====
// A short guide to every system, opened with F1, "?" or the menu. One tab per topic.
const HELP_TOPICS = [
  { id: 'start', name: 'Kom i gang', html: `
    <p>Du starter med et lager på hjemøen, lidt planker og fisk og ${'mønter'}. Opgaverne øverst til venstre fører dig igennem spillet.</p>
    <ol>
      <li><b>Mad:</b> byg en fisker ved kysten og forbind den med vej til lageret.</li>
      <li><b>Boliger:</b> byg huse tæt på lageret (eller en markedsplads) og giv dem vej. De første 4 beboere klarer sig uden mad.</li>
      <li><b>Træ:</b> skovhugger ved skoven, savværk til planker. Byg en skovfoged, ellers forsvinder skoven.</li>
      <li><b>Sten:</b> stenhugger ved klipperne – stenen kommer aldrig igen.</li>
      <li><b>Kød:</b> kornfarm og svinefarm. Borgere skal have kød og tøj.</li>
      <li><b>Skibe:</b> skibsbygger, en jolle og så ud at udforske (🧭 på skibet).</li>
    </ol>
    <p>Røde ikoner over bygninger betyder, at de mangler vej. Knappen i topbjælken viser alt, der kræver din opmærksomhed.</p>` },
  { id: 'keys', name: 'Taster', html: `
    <table class="prod">
      <tr><td><b>Træk / højre- eller midterklik-træk</b></td><td>Flyt kortet</td></tr>
      <tr><td><b>Scroll, + og −</b></td><td>Zoom</td></tr>
      <tr><td><b>WASD / piletaster</b></td><td>Flyt kortet</td></tr>
      <tr><td><b>H</b></td><td>Tilbage til hjemøens lager</td></tr>
      <tr><td><b>1 – 8</b></td><td>Åbn byggemenuens faner</td></tr>
      <tr><td><b>Q</b></td><td>Pipette: byg en magen til bygningen under musen</td></tr>
      <tr><td><b>M</b></td><td>Vis/skjul minikortet</td></tr>
      <tr><td><b>Mellemrum</b></td><td>Pause / fortsæt</td></tr>
      <tr><td><b>Esc</b></td><td>Afbryd værktøj, luk paneler</td></tr>
      <tr><td><b>Ctrl+Z</b></td><td>Fortryd nedrivning (inden for 15 s)</td></tr>
      <tr><td><b>Ctrl+S</b></td><td>Gem</td></tr>
      <tr><td><b>F1 eller ?</b></td><td>Denne hjælp</td></tr>
      <tr><td><b>Højreklik / Backspace</b></td><td>Fortryd sidste punkt, når du tegner en rute</td></tr>
    </table>` },
  { id: 'economy', name: 'Økonomi', html: `
    <p><b>Lager:</b> hver ø har ét fælles lager. Hvert lagerhus giver plads til ${WAREHOUSE_CAP} af hver vare. Fulde lagre spilder produktionen.</p>
    <p><b>Veje:</b> produktionsbygninger og boliger skal have vej til et lager. Veje gennem skov fælder træerne; over en kanal bliver de til broer.</p>
    <p><b>Arbejdere:</b> bygninger skal have ledige beboere. Madproduktion får arbejdere først.</p>
    <p><b>Mønter:</b> beboerne betaler skat, bygninger og skibe koster drift. Under 0 mønter er du fallit: kun mad og markeder kører.</p>
    <p><b>Opgradering:</b> produktionsbygninger kan opgraderes til niveau 2 og 3 (mere produktion, flere arbejdere). Bygninger kan flyttes gratis (↔ Flyt).</p>
    <p><b>Ressourcer:</b> træ gror langsomt igen, sten, jernmalm og guld slipper op. Økonomi → Produktion og ressourcer viser, hvad der er tilbage.</p>
    <p><b>Mønter til overs?</b> Hold fest, byg pynt, send gaver til rivalen, eller tag kontrakter.</p>` },
  { id: 'people', name: 'Beboere', html: `
    <table class="prod">
      <tr><th>Niveau</th><th>Pladser</th><th>Varer</th><th>Offentligt</th></tr>
      ${HOUSE_LEVELS.slice(1).map(l => `<tr><td>${l.name}</td><td>${l.cap}</td><td>${l.needs.map(n => NEED_INFO[n].icon).join(' ')}</td><td>${l.services.map(s => SERVICES[s].icon).join(' ')}</td></tr>`).join('')}
    </table>
    <p>Huse opgraderer af sig selv, når øens huse er næsten fulde, beboerne er tilfredse (mindst 50 %), næste niveaus varer er på lager, og huset er inden for rækkevidde af de offentlige bygninger. Du kan låse et hus eller slå opgradering fra for hele øen på lageret.</p>
    <p><b>Tilfredshed</b> (på lageret) afhænger af skat, mad, manglende varer, offentlige bygninger, pynt og fester. Under 30 % flytter beboerne; over 70 % betaler de mere i skat.</p>
    <p><b>Skat</b> vælges pr. ø: lav skat giver gladere beboere, høj skat flere mønter.</p>` },
  { id: 'sea', name: 'Skibe og handel', html: `
    <p><b>Udforskning:</b> kun startøen er kendt. Send skibe ud (🧭 Udforsk automatisk eller 📍 Sejl til) for at finde øer med får, humle, vindruer, malm og guld.</p>
    <p><b>Kolonier:</b> det første lager på en ny ø kræver et skib og bringer planker og fisk med. Øens fire første beboere klarer sig uden mad.</p>
    <p><b>Handelsruter:</b> 🗺️ Ruter → tegn en rute fra et lager, med punkter i vandet, til et lager på en anden ø. Vælg varer ud og retur og hvor meget, der skal blive tilbage. Større skibe har længere rækkevidde og mere last.</p>
    <p><b>Handelsmanden</b> kommer forbi de lagre, hvor du har sat "sælg over" / "køb op til".</p>
    <p><b>Kontrakter:</b> handelsmanden (og en venlig rival) beder om varer til en god pris. Accepter og lever fra en havn inden fristen.</p>` },
  { id: 'threats', name: 'Pirater og rival', html: `
    <p><b>Pirater</b> har et fort på en lille ø og jager dine lastede skibe. Fregatter på en rute beskytter skibe inden for ${WARSHIP_GUARD} felter og skyder piratskibet i sænk; vagttårne ved kysten gør det samme. Send to fregatter mod fortet for at ødelægge det (+${FORT_REWARD} 🪙).</p>
    <p><b>${RIVAL_NAME}</b> bosætter sig på frie øer. Øer, du kender, varsler de på forhånd – grundlæg selv først. Du kan handle med dem (tegn en rute til deres lager) eller købe en koloni ud.</p>
    <p><b>Forholdet</b> til rivalen: handel, leverede kontrakter og gaver hjælper; opkøb og svigtede kontrakter skader. Under 25 handler de ikke og betaler pirater mod dig. Over 75 får du bedre priser.</p>
    <p><b>Begivenheder:</b> brande (byg brandstationer) og storme (skibe sejler langsommere). De kan slås fra i menuen.</p>` },
  { id: 'goal', name: 'Mål og point', html: `
    <p>Spillets mål er monumentet, som kræver ${MONUMENT_POP} Adelige og store mængder mursten, værktøj og smykker.</p>
    <p>Point (☰ → 🏆) tæller beboere, højere niveauer, øer, bygninger, skibe, opgaver, kontrakter og mønter. Din bedste score gemmes for hver kortstørrelse og sværhedsgrad. Efter monumentet kan du spille videre og hæve rekorden.</p>` }
];

function renderHelp(title, body, sel) {
  title.textContent = '❓ Hjælp';
  const cur = HELP_TOPICS.find(t => t.id === sel.topic) || HELP_TOPICS[0];
  body.innerHTML = `<div class="help-tabs">${HELP_TOPICS.map(t => `<button data-topic="${t.id}" class="${t === cur ? 'current' : ''}">${t.name}</button>`).join('')}</div>
    <div class="help">${cur.html}</div>`;
  body.querySelectorAll('[data-topic]').forEach(el => el.addEventListener('click', () => { sel.topic = el.dataset.topic; renderInfo(); }));
}
