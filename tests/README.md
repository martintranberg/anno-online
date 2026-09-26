# Tests

Testene kører de rigtige spilfiler (`js/*.js`, i den rækkefølge `index.html` loader dem) i Node med en lille falsk
DOM, så der ikke skal installeres noget. Kræver Node 20 eller nyere.

```
npm test             # alle tests, inkl. lange simulationer (ca. 40 s)
npm run test:quick   # alt undtagen simulationerne (ca. 10 s)
npm run sim          # balancerapport: botten spiller flere kort og viser udviklingen
npm run sim -- --minutes 90 --seeds 6 --difficulty hard --size large
```

| Fil | Dækker |
| --- | --- |
| `smoke.test.js` | Indlæsning, kortgenerering for alle størrelser, at alle bygninger, kortet og alle paneler kan tegnes |
| `rules.test.js` | Placeringsregler, veje, tåge, kanaler og broer, nedrivning, flytning, pipette |
| `economy.test.js` | Produktion, beboere og behov, husniveau 1-4, opgradering af produktion, udtømning og skovfoged, skat og tilfredshed, fallit, brand, opgaver |
| `ships.test.js` | Sejlruter, kolonier, handelsruter, handelsmanden, udforskning, pirater, fregatter, vagttårne, piratfortet, rivalen |
| `save.test.js` | Gem og indlæs, migrering af version 3-gem, gemmepladser, ødelagte filer, nyt spil |
| `sim.test.js` | Botten spiller hele spil: økonomien må ikke gå i stå, crashe eller give umulige tal |

Hjælpefiler: `harness.js` (loader spillet i Node), `helpers.js` (placering og vejbygning som en spiller),
`bot.js` (den scriptede spiller), `sim-report.js` (balancerapporten).

I en test giver `game.api` adgang til alt i spillet, fx `G.GAME`, `G.tick()` og `G.placeBuilding(x, y, 'house')`.
Tilfældighed er seedet, så samme seed altid giver samme kort og forløb.
