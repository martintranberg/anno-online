# Anno Online

Et isometrisk ø-byggespil inspireret af Anno Online. Alt – bygninger, landskab, skibe, lyd og musik – tegnes og
genereres i koden; der er ingen billed- eller lydfiler.

## Spil

- **Lokalt:** åbn `index.html` i en browser (dobbeltklik virker).
- **Online:** når GitHub Pages er slået til, kan spillet spilles på `https://martintranberg.github.io/anno-online/`.

Tryk **F1** i spillet for hjælp til alle systemer og taster. Spillet gemmer automatisk i browseren.

## Udvikling

Koden ligger i `js/` som almindelige scripts (ikke moduler), så spillet også kører direkte fra disken.
Rækkefølgen i `index.html` er vigtig: filerne deler ét globalt scope.

Testene kræver Node 20+ og ingen pakker:

```
npm test           # alle tests inkl. simulationer
npm run test:quick # hurtige tests
npm run sim        # balancerapport, hvor en bot spiller flere kort
```

Se [tests/README.md](tests/README.md).

## GitHub Pages

1. Repoet skal være offentligt (eller kontoen have GitHub Pro).
2. *Settings → Pages → Build and deployment → Source: Deploy from a branch*, vælg `main` og `/ (root)`.
3. Efter et minut ligger spillet på adressen ovenfor. Filen `.nojekyll` gør, at GitHub serverer filerne uændret.
