# Anno Online

Et isometrisk ø-byggespil i browseren, inspireret af Anno Online. Du starter med et lager på en ø og bygger et
handelsimperium op: fra pionerernes fiskerhytter til adelige i villaer, med varekæder, skibe og handel mellem øerne.

Alt i spillet – bygninger, landskab, skibe, vejrlig, lyd og musik – tegnes og genereres i koden. Der er ingen
billed- eller lydfiler.

**Spil det her:** <https://martintranberg.github.io/anno-online/> – eller åbn `index.html` direkte i en browser.

## Spillet

**Start.** Vælg kortstørrelse, antal øer og sværhedsgrad, og placér dit første lager på hjemøen. Fisker, boliger,
skovhugger og savværk er det første, du får brug for – opgaverne øverst til venstre fører dig videre.

**Varekæder.** Træ bliver til planker, uld til tøj, korn og humle til øl, ler til mursten, jernmalm og kul til
værktøj, vindruer til vin og guld til smykker. Hjemøen kan kun dyrke korn, så resten skal hentes på andre øer.

**Fire befolkningsniveauer.** Pionerer, Borgere, Købmænd og Adelige. Hvert niveau vil have flere varer og offentlige
bygninger (marked, kapel, kro, teater), men betaler mere i skat. Husene opgraderer af sig selv, når behovene er dækket.

**Øer og skibe.** Kortet er dækket af tåge, indtil dine skibe har udforsket det. Grundlæg kolonier på øer med den
rigtige frugtbarhed eller malm, tegn handelsruter i vandet og vælg, hvad skibene sejler med begge veje.

**Økonomi.** Hver ø har sit eget lager med begrænset plads. Bygninger skal have vej til lageret og arbejdere nok.
Skov gror langsomt igen; sten, malm og guld slipper op. Går du i minus med mønterne, er du fallit, og det meste
af produktionen står stille.

**Tilfredshed og skat.** Du vælger skatten pr. ø. Høj skat giver flere mønter, men sure beboere, der flytter.
Pynt som parker, springvand og statuer, fester og offentlige bygninger gør dem gladere.

**Handel.** En handelsmand kommer forbi og køber dit overskud eller sælger dig det, du mangler. Kontrakter beder om
varer inden en frist og betaler i mønter eller varer.

**Modstandere.** Et rivaliserende handelshus bosætter sig på frie øer og konkurrerer med dig om dem. Du kan handle
med dem, sende gaver, købe deres kolonier – eller blive uvenner med dem. Pirater jager dine lastede skibe; forsvar
dig med fregatter og vagttårne, eller ødelæg deres fort.

**Mål.** Byg monumentet, som kræver 50 Adelige og store mængder mursten, værktøj og smykker. Du får point for alt,
du bygger op, og din bedste score gemmes – så du kan spille videre efter sejren og slå din rekord.

## Styring

| | |
| --- | --- |
| Træk med musen, WASD, piletaster | Flyt kortet |
| Scroll, + og − | Zoom |
| Klik på en bygning, et skib eller lageret | Info og indstillinger |
| 1 – 8 | Byggemenuens faner |
| Q | Byg en magen til bygningen under musen |
| M | Minikort |
| Mellemrum | Pause |
| Ctrl+Z | Fortryd nedrivning |
| F1 eller ? | Hjælp til alle systemer |

Spillet gemmer automatisk i browseren. Under ☰ kan du gemme i pladser, eksportere til en fil og starte et nyt spil.

## Udvikling

Spillet er skrevet i almindelig JavaScript med canvas og har ingen afhængigheder. Koden ligger i `js/` som
almindelige scripts (ikke moduler), så spillet også kører direkte fra disken; rækkefølgen i `index.html` er vigtig.

Testene kræver Node 20 eller nyere og ingen pakker:

```
npm test           # alle tests, inkl. simulationer hvor en bot spiller hele spil
npm run test:quick # de hurtige tests
npm run sim        # balancerapport: botten spiller flere kort og viser udviklingen
```

Se [tests/README.md](tests/README.md) for detaljer.
