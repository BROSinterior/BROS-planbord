# Mac mini: vanzelf terug na een stroomonderbreking (1.73)

De verwerker (renders, vergaderverslagen, presentaties, Plan2CAD) draait als dienst `be.bros.verwerker` onder jouw gebruiker. Na een stroomonderbreking werkt alles vanzelf verder als aan drie dingen voldaan is:

1. de Mac mini start zelf op;
2. hij logt zelf in;
3. hij valt niet in slaap.

Controleer wat er nu ingesteld staat (dit verandert niets):

```
bash verwerker/herstart-controle.sh
```

## 1. Zelf opstarten na een stroomonderbreking

- Ga naar Systeeminstellingen › Energie (of Energiestand) › zet **Start automatisch op na stroomonderbreking** aan.
- Of in Terminal: `sudo pmset -a autorestart 1`

## 2. Zelf inloggen

De dienst start pas als je gebruiker ingelogd is.

- Ga naar Systeeminstellingen › Gebruikers en groepen › **Log automatisch in als** › kies je gebruiker.
- **Let op:** automatisch inloggen kan enkel als FileVault uit staat. Of dat aanvaardbaar is, beslis jij:
  - **FileVault aan:** veiliger als de Mac gestolen wordt, maar na een stroomonderbreking moet iemand het wachtwoord typen.
  - **FileVault uit + automatisch inloggen:** de verwerker loopt vanzelf door. Zet de Mac mini dan wel op een plek waar niet iedereen bij kan.
- Zonder automatisch inloggen meldt het Planbord na een panne dat de verwerkingscomputer offline is. Je hoeft dan enkel in te loggen; de dienst start zelf.

## 3. Niet in slaap vallen

- Ga naar Systeeminstellingen › Energie › **Voorkom dat de Mac automatisch sluimert wanneer het scherm uit is** (aan) en **Wek voor netwerktoegang** (aan).
- Of in Terminal: `sudo pmset -a sleep 0 disksleep 0 womp 1`

## Testen

Kies Apple-menu › Herstart, en raak niets aan. Na enkele minuten mag het Planbord niet meer melden dat de verwerkingscomputer offline is. Op de Mac mini zelf toont `bash verwerker/herstart-controle.sh` dan overal ✓.

Wil je ook een echte stroomonderbreking testen? Trek de stekker uit, wacht 10 seconden en steek hem weer in.

De maandelijkse controle die je al ingepland hebt, blijft nuttig. Ze vangt vooral volle schijven en verlopen sleutels op.
