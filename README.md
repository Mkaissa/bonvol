# BonVol : vols pas chers Europe ↔ Afrique & Maghreb

Un agent relève les prix plusieurs fois par jour, détecte les vraies baisses, publie
une alerte Telegram et regénère le site (une page optimisée Google par trajet).
Coût : le nom de domaine. Tout le reste est gratuit.

## Tester sur ton ordinateur (Node.js 18 ou plus)

    MOCK=1 SITE_URL="." node agent.js

Puis ouvre `demo/index.html`. Les prix de démo sont fictifs et signalés comme tels.
La démo écrit dans `demo/` et `data/history.mock.json`, jamais dans `docs/` ni
`data/history.json` : ses faux prix ne peuvent pas fausser les alertes réelles.
Ces deux emplacements sont exclus de git (`.gitignore`).

## Mise en ligne, étape par étape

0. **Statut** : toucher des commissions est une activité rémunérée. Il faut un
   statut (micro-entreprise) et son numéro SIREN pour les mentions légales.
1. **Travelpayouts** : crée un compte gratuit sur travelpayouts.com, rejoins le
   programme Aviasales, puis récupère dans ton profil ton **token API** et ton
   **marker** (l'« ID » affiché en bas à gauche du tableau de bord). Note aussi le
   numéro de ton projet : c'est le nombre après `source=` dans l'adresse du tableau
   de bord. Les liens passent par la redirection Travelpayouts (`tp.media/r`), qui
   compte les clics et les rattache à ce projet.
2. **Telegram** : crée un bot avec @BotFather (tu obtiens le token), crée un
   canal public, ajoute le bot comme administrateur. L'identifiant du canal est
   `@nom_du_canal`.
3. **GitHub** : crée un dépôt **public** et envoie-y ce dossier. Avec un compte
   GitHub gratuit, GitHub Pages ne fonctionne qu'avec un dépôt public. Les
   secrets restent privés, mais le code et l'historique des prix seront visibles.
   - Settings → Secrets and variables → Actions → **Secrets** :
     `TP_TOKEN`, `TP_MARKER`, `TG_BOT_TOKEN`, `TG_CHAT_ID`
   - Même écran, onglet **Variables** :
     `SITE_URL` (ex. https://bonvol.com), `SITE_NAME`, `TG_PUBLIC_LINK` (ex. https://t.me/bonvol),
     `TP_TRS` (numéro du projet Travelpayouts)
   - Toujours dans **Variables**, les mentions légales (page `mentions-legales.html`) :
     `LEGAL_EDITOR` (ex. « Prénom Nom EI »), `LEGAL_ADDRESS` (une adresse de
     domiciliation est possible), `LEGAL_SIREN`, `LEGAL_PHONE`, `LEGAL_EMAIL`.
     Tant qu'il en manque, la page affiche « [à compléter] » et l'agent le signale dans ses logs.
     L'hébergeur (GitHub) est déjà renseigné. GitHub ne publie pas de numéro de
     téléphone : la page affiche son formulaire de contact à la place.
   - Settings → Pages → Deploy from branch → `main`, dossier `/docs`.
   - Actions → Agent prix → **Run workflow** pour le premier lancement.
4. **Domaine** : achète-le (≈ 10–15 €/an) et relie-le dans Settings → Pages → Custom domain.
5. **Google** : ajoute le site dans Google Search Console et soumets `sitemap.xml`.

## Organisation des fichiers

- `agent.js` : relève les prix, garde l'historique, envoie les alertes Telegram.
- `pages.js` : fabrique le site (accueil, une page par trajet, une page par destination, mentions légales).
- `static/` : feuille de style, code du navigateur et photos des villes (copiés dans `docs/assets/`).
- `villes.json` : villes proposées dans le module de recherche (nom, pays, code, coordonnées).

## Ajouter des trajets

Ajoute une ligne dans `routes.json` (codes IATA de ville ou d'aéroport).
Chaque trajet = une nouvelle page référencée, et chaque nouvelle destination
a sa propre page. Commence par 10–30 trajets, puis augmente : l'API a des
limites de requêtes.

Pour la photo d'une nouvelle destination : ajoute `static/img/CODE.webp`
(photo libre de droits) et ses crédits dans `static/img/credits.json`.
Sans photo, la carte de la ville garde une illustration colorée.

## Règles qui protègent ton site

- Un prix n'est affiché comme actuel que s'il a été vu dans les 6 dernières heures.
- Les anciens prix apparaissent uniquement dans l'historique, datés.
- La mention des liens affiliés est en pied de page : elle est obligatoire en France.
- Les données Aviasales sont des prix trouvés lors de recherches récentes, gardés
  en cache de 2 à 7 jours : un prix peut avoir changé. Les alertes et les pages
  disent « trouvé lors de recherches récentes », jamais « en direct », et le
  prix final est toujours confirmé au clic.
- Pas d'alerte pendant les 7 premiers jours : l'agent construit d'abord
  l'historique qui sert à calculer le prix habituel.

## Prochaines étapes pour gagner plus

- Ajouter sur chaque page les hôtels de la destination (Booking ou Hotellook via Travelpayouts),
  l'assurance voyage et les eSIM : ce sont les commissions les plus élevées.
- Traduire les pages (anglais, arabe, portugais) pour multiplier le trafic.
- Ajouter les trajets retour (Dakar → Paris, Alger → Lyon…) : la diaspora cherche dans les deux sens.
