#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/strowger ]; then
  echo 'Préparation du logiciel local…'
  sh scripts/preparer-pilote.sh
fi
printf '\nSTROWGER — Banc local, jusqu’à 6 téléphones Android\n\n'
printf '1  Vérifier logiciel et connexions USB (lecture seule)\n'
printf '2  Enregistrer les Android USB autorisés (sans action sur écran)\n'
printf '3  Ouvrir la console et démarrer le broker local\n'
printf '4  Tester jusqu’à 2 appareils : HOME, capture et libération\n'
printf '5  Tester jusqu’à 6 appareils : HOME, capture et libération\n'
printf '6  Préparer le bureau Linux (Docker requis)\n'
printf '\nChoix : '
read -r pilot_choice
case "$pilot_choice" in
  1) .venv/bin/strowger doctor ;;
  2) .venv/bin/strowger enroll --owner alice --limit 6 ;;
  3) exec .venv/bin/strowger serve --capacity 6 --port 8876 --open ;;
  4) .venv/bin/strowger smoke --url http://127.0.0.1:8876 --limit 2 ;;
  5) .venv/bin/strowger smoke --url http://127.0.0.1:8876 --limit 6 ;;
  6) .venv/bin/strowger desktop ;;
  *) echo 'Aucune action effectuée.' ;;
esac
printf '\nAppuyer sur Entrée pour fermer.'
read -r pilot_done
