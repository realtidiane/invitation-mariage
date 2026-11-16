"""Genere js/config-inline.js a partir de config.json.

Pourquoi : quand la page est ouverte directement en file:// (double-clic sur
index.html), le navigateur bloque fetch('config.json') pour raisons de CORS.
On genere donc une copie JS de la configuration, chargee par une balise
<script> classique, qui sert de repli.

Le fichier config.json reste la source unique de verite :
  - en mode serveur HTTP, app.js lit config.json en direct (jamais de copie) ;
  - en mode file://, app.js lit la copie inlinee, a regenerer apres chaque
    modification de config.json.

Usage :  python tools/inline_config.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "config.json"
TARGET = ROOT / "js" / "config-inline.js"

HEADER = """/* ==========================================================================
   Configuration inlinee de l'invitation.
   --------------------------------------------------------------------------
   Fichier GENERE automatiquement par tools/inline_config.py a partir de
   config.json. Ne pas editer a la main : toute modification doit etre faite
   dans config.json, puis ce script doit etre relance.

   But : permettre l'ouverture de index.html en file:// (double-clic), ou le
   navigateur interdit fetch() sur un fichier local. En mode serveur HTTP,
   app.js lit config.json directement et cette copie n'est pas utilisee.
   ========================================================================== */

window.__INVITATION_CONFIG__ = """


def main() -> int:
    if not SOURCE.exists():
        print("ERREUR : config.json introuvable :", SOURCE)
        return 1

    config = json.loads(SOURCE.read_text(encoding="utf-8"))
    payload = json.dumps(config, ensure_ascii=False, indent=2)

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(HEADER + payload + ";\n", encoding="utf-8")

    print(f"Ecrit : {TARGET} ({TARGET.stat().st_size} octets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
