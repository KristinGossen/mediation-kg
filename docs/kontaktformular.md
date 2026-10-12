# Kontaktformular aktivieren

Das Formular ist fertig vorbereitet, bleibt in der Produktion jedoch ausgeblendet,
bis `PUBLIC_CONTACT_FORM_ENABLED=true` im Cloudflare-Pages-Projekt gesetzt wird.
Lokal zeigt die Vorschau das Formular bereits. Die vorhandenen Kontaktdaten und
E-Mail-Links funktionieren weiterhin.

## Versand und Spamschutz

Die Website bleibt statisch. Nur `/api/contact` läuft als Pages Function.
Die Funktion prüft Eingaben, Ursprung der Anfrage und einen Cloudflare-Turnstile-Token.
Der Versand erfolgt über Cloudflares Email-Service-REST-API. Formularinhalte werden
nicht in einer zusätzlichen Datenbank gespeichert und nicht in Anwendungslogs ausgegeben.
Eine Erfolgsmeldung erscheint nur, wenn Cloudflare die Nachricht für den fest
konfigurierten Empfänger als zugestellt oder zur Zustellung eingereiht bestätigt.
Eine endgültige Zustellung wird zusätzlich durch einen Empfangstest geprüft.

1. Im Cloudflare-Konto die bereits bestätigte Zieladresse aus Email Routing verwenden.
   Diese Adresse wird nur als Secret gespeichert. Keine private Postfachadresse im
   Quelltext oder in öffentlichen Build-Variablen eintragen.
2. Den Email-Service-Versand für `mediation-kg.com` und einen API-Token mit der
   erforderlichen Email-Sending-Berechtigung vorbereiten. Ausschließlich an die
   bestätigte Zieladresse senden; kein kostenpflichtiges Upgrade für beliebige
   Empfänger abschließen. Die bestehende Weiterleitung und DNS-Einträge erhalten.
3. Unter Turnstile ein verwaltetes Widget für `mediation-kg.com` erstellen.
   Als weitere Domain ggf. `www.mediation-kg.com` hinzufügen.
4. Workers & Pages → `mediation-kg` → Settings → Variables and Secrets:

| Name | Art | Wert |
| --- | --- | --- |
| `CF_ACCOUNT_ID` | Variable | ID des bestehenden Cloudflare-Kontos |
| `CF_EMAIL_API_TOKEN` | Secret | Token ausschließlich für den E-Mail-Versand |
| `CONTACT_RECIPIENT` | Secret | Bereits bestätigte Email-Routing-Zieladresse |
| `TURNSTILE_SITE_KEY` | Variable | Öffentlicher Widget-Schlüssel |
| `TURNSTILE_SECRET_KEY` | Secret | Geheimer Widget-Schlüssel |
| `PUBLIC_CONTACT_FORM_ENABLED` | Build-Variable | `true`, erst nach Versandkonfiguration |

Der Absender ist `info@mediation-kg.com`. Falls ein anderer bestätigter Absender
benötigt wird, lässt er sich als `CONTACT_SENDER` konfigurieren.

5. Produktionsdeployment neu erstellen. Prüfen, dass `/api/contact` bei GET
   `available: true` und nur den öffentlichen Turnstile-Schlüssel zurückliefert.
6. Einen echten Empfangstest ausdrücklich mit der Betreiberin durchführen. Ohne
   bestätigten E-Mail-Eingang keine erfolgreiche Zustellung behaupten. Falls eine
   Vorschau veröffentlicht werden soll, dort eigene Testschlüssel verwenden und
   die Versand-Secrets nicht in öffentliche Git- oder Browserdaten übernehmen.

Die Betreiberin hat den Cloudflare-Zugang, der Agent aktuell keine Cloudflare-
Verwaltungsberechtigung. Token und Secret-Key direkt im Dashboard eintragen;
nicht in Chat, Git oder Testprotokolle kopieren.

## Prüfen

`npm test` prüft Eingabevalidierung, Spamprüfung, Empfängerschutz und Fehlerfälle
mit gemockten Diensten. Es verschickt keine echten E-Mails.
Den Astro-Build in `.astro/local-preview` durchführen.

## Dokumentation

- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/get-started/)
- [Cloudflare Email REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
- [Versand an bestätigte Empfänger und Preise](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Turnstile im Browser](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
- [Turnstile-Prüfung auf dem Server](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
