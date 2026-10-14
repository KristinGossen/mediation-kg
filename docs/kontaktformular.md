# Kontaktformular aktivieren

Das Formular ist fertig vorbereitet, bleibt in der Produktion jedoch ausgeblendet,
bis `PUBLIC_CONTACT_FORM_ENABLED=true` im Cloudflare-Pages-Projekt gesetzt wird.
Lokal zeigt die Vorschau das Formular bereits. Die vorhandenen Kontaktdaten und
E-Mail-Links funktionieren weiterhin.

## Versand und Spamschutz

Die Website bleibt statisch. Nur `/api/contact` läuft als Pages Function.
Die Funktion prüft Eingaben, Ursprung der Anfrage und einen Cloudflare-Turnstile-Token.
Der Versand erfolgt über einen privaten Worker mit Cloudflares Email-Routing-Binding.
Der Worker hat keine öffentliche URL und wird ausschließlich über das Service Binding
`CONTACT_MAILER` von der Pages Function aufgerufen. Formularinhalte werden
nicht in einer zusätzlichen Datenbank gespeichert und nicht in Anwendungslogs ausgegeben.
Eine Erfolgsmeldung erscheint nur, wenn Cloudflare die Nachricht für den fest
konfigurierten Empfänger zum Versand angenommen hat.
Eine endgültige Zustellung wird zusätzlich durch einen Empfangstest geprüft.

1. Im Cloudflare-Konto die bereits bestätigte Zieladresse aus Email Routing verwenden.
   Diese Adresse wird nur als Secret gespeichert. Keine private Postfachadresse im
   Quelltext oder in öffentlichen Build-Variablen eintragen.
2. Kein kostenpflichtiges Upgrade für Email Sending abschließen. Im Dashboard ist
   dieser separate Versanddienst mit Workers Paid gesperrt. Für dieses Formular
   reicht das kostenlose Senden an die schon bestätigte Email-Routing-Zieladresse.
   Die bestehende Weiterleitung und DNS-Einträge erhalten.
   Den Worker aus `workers/contact-mailer/wrangler.jsonc` im vorhandenen Konto
   bereitstellen (`wrangler login`, dann `wrangler deploy --config
   workers/contact-mailer/wrangler.jsonc`). Die Kontonummer ggf. über
   `CLOUDFLARE_ACCOUNT_ID` im Prozess setzen. Der Worker heißt
   `mediation-kg-contact-mailer` und bindet `send_email` als `MAIL` ohne zusätzliche
   Empfängerfreigaben. Damit beschränkt Cloudflare den Versand auf bestätigte
   Zieladressen. `workers_dev` und `preview_urls` bleiben `false`; keine öffentlichen
   Routen hinzufügen. Der Worker nutzt die weiter unterstützte `EmailMessage`-API.
   Unter Pages → `mediation-kg` → Settings → Bindings → Add → Service binding:
   Variable name `CONTACT_MAILER`, Service `mediation-kg-contact-mailer`.
3. Unter Turnstile ein verwaltetes Widget für `mediation-kg.com` erstellen.
   Als weitere Domain ggf. `www.mediation-kg.com` hinzufügen.
4. Workers & Pages → `mediation-kg` → Settings → Variables and Secrets:

| Name | Art | Wert |
| --- | --- | --- |
| `CONTACT_RECIPIENT` | Secret | Bereits bestätigte Email-Routing-Zieladresse |
| `TURNSTILE_SITE_KEY` | Variable | Öffentlicher Widget-Schlüssel |
| `TURNSTILE_SECRET_KEY` | Secret | Geheimer Widget-Schlüssel |
| `PUBLIC_CONTACT_FORM_ENABLED` | Build-Variable | `true`, erst nach Versandkonfiguration |

Der Absender ist `info@mediation-kg.com`. Der private Worker akzeptiert ausschließlich
diesen Absender. Die Antwortadresse ist die im Formular eingegebene Besucheradresse.
`CF_ACCOUNT_ID` darf aus den vorigen Vorbereitungen in Pages stehen bleiben, ist bei
dieser Variante aber nicht nötig. Ein `CF_EMAIL_API_TOKEN` ist nicht erforderlich.
Die alte REST-Variante bleibt im Quelltext für bereits konfigurierte Konten erhalten;
bei vorhandenem `CONTACT_MAILER` wird sie auch bei Fehlern niemals als Ersatz genutzt.

5. Produktionsdeployment neu erstellen. Prüfen, dass `/api/contact` bei GET
   `available: true` und nur den öffentlichen Turnstile-Schlüssel zurückliefert.
6. Einen echten Empfangstest ausdrücklich mit der Betreiberin durchführen. Ohne
   bestätigten E-Mail-Eingang keine erfolgreiche Zustellung behaupten. Falls eine
   Vorschau veröffentlicht werden soll, dort eigene Testschlüssel verwenden und
   die Versand-Secrets nicht in öffentliche Git- oder Browserdaten übernehmen.

Die Verbindung kann direkt im Cloudflare-Dashboard oder über die von der Betreiberin
freigegebene Wrangler-Anmeldung eingerichtet werden. Für die automatische Zuordnung
der Turnstile-Schlüssel ist zusätzlich die Turnstile-Berechtigung erforderlich.
Zugangsdaten bleiben im Windows-Keyring beziehungsweise während API-Aufrufen im
Prozessspeicher. Token und Secret-Key nicht in Chat, Git oder Testprotokolle kopieren.
Der obere `Site key` gehört zur öffentlichen Widget-Einbindung, der untere
`Secret key` zur serverseitigen Prüfung. Die Funktion verweigert die Konfiguration,
wenn im öffentlichen Feld ein langer geheimer Schlüssel hinterlegt wurde.

## Prüfen

`npm test` prüft Eingabevalidierung, Spamprüfung, Empfängerschutz und Fehlerfälle
mit gemockten Diensten. Es verschickt keine echten E-Mails.
Den Astro-Build in `.astro/local-preview` durchführen.

## Dokumentation

- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/get-started/)
- [Cloudflare Email Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Email-Binding: bestätigte Empfänger](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Pages Service Bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)
- [Versand an bestätigte Empfänger und Preise](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Turnstile im Browser](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
- [Turnstile-Prüfung auf dem Server](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
