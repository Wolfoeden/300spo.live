# 300 Wallet Web-Integration

`/wallet/` ist die öffentliche Produktseite. Der eigentliche Expo-Webexport wird getrennt unter `/wallet-app/` veröffentlicht und erst nach erfolgreicher Prüfung in die Seite eingebettet.

## Build-Vertrag

Der Hotwallet-Build muss diese Bedingungen erfüllen:

- Build-Basis ist exakt `/wallet-app` (`EXPO_PUBLIC_WEB_BASE_PATH=/wallet-app`).
- Der Export enthält am Wurzelpunkt eine `index.html`.
- Skripte, Styles, Fonts, WASM-Dateien und Bilder liegen im Export; ausführbarer Code wird nicht von fremden Hosts geladen.
- Root-relative Referenzen beginnen mit `/wallet-app/`. Relative Referenzen sind ebenfalls zulässig.
- Der Export enthält keine Entwicklungs-Hosts, `.env`-Dateien, privaten Schlüssel oder Signaturdateien.
- Ein Service Worker darf, falls vorhanden, nur den Scope `/wallet-app/` kontrollieren.
- Der Webauftritt ist eine öffentliche Vorschau. Native iOS-/Android-Releases und die Chrome-Erweiterung bleiben eigene, signierte Release-Artefakte.
- Die Android-Schaltfläche lädt die Preprod-APK von `/downloads/300-wallet-android-preprod.apk`. Die Datei muss vor der Veröffentlichung dort abgelegt werden.
- `/wallet/manifest.webmanifest` installiert die kostenlose iPhone-Web-App im Standalone-Modus. Dafür ist kein Offline-Service-Worker nötig.

## Lokaler Ablauf

Im Hotwallet-Repository (PowerShell):

```powershell
$env:EXPO_PUBLIC_WEB_BASE_PATH = "/wallet-app"
pnpm export:web
Remove-Item Env:\EXPO_PUBLIC_WEB_BASE_PATH
```

Im Verzeichnis dieser Website:

```powershell
pnpm wallet:web:integrate -- "C:\Pfad\zum\hotwallet\dist"
pnpm build
```

Das Integrationsskript prüft zuerst den Export, kopiert ihn in ein Staging-Verzeichnis und ersetzt anschließend ausschließlich das generierte Ziel `public/wallet-app`. Es erzeugt außerdem `public/wallet-app/build-manifest.json`. Dieses Manifest ist das Signal, mit dem `/wallet/` den iFrame freischaltet.

## Veröffentlichung

Für einen manuellen Netlify-Upload wird nach erfolgreicher Prüfung weiterhin der gesamte Ordner `public/` veröffentlicht. Ohne integrierten Export bleibt `/wallet/` funktionsfähig und zeigt einen neutralen Platzhalter.

Die APK und der Webexport sind Preprod-Testbuilds; Mainnet-Signierung bleibt deaktiviert. Sie sind keine native App-Store- oder Play-Store-Freigabe.

Die Workflow-Datei `.github/workflows/static-site-check.yml` ist absichtlich nur eine Prüf- und Artefakt-Pipeline. Sie führt kein Deployment durch und benötigt keine Produktionszugänge. Der optionale Wallet-Job kann manuell gestartet werden, exportiert `Wolfderoeden/hotwallet`, integriert das Ergebnis und stellt das geprüfte `public/`-Verzeichnis als CI-Artefakt bereit.

Falls das Hotwallet-Repository privat wird, muss der Checkout über einen separaten, nur lesenden Repository-Token erfolgen. Ein Netlify-, App-Store- oder Wallet-Schlüssel gehört weder in den Export noch in dieses Repository.
