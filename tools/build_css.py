"""Genere css/style.css a partir du CSS extrait du site d'origine.

Le CSS d'origine est une cascade de couches appendues (chaque bloc annule le
precedent). On preserve l'ordre exact des regles pour garantir un rendu
identique au pixel pres, en reecrivant seulement :
  - les chemins d'images -> variables CSS --asset-* (voir bloc final),
  - les chemins de polices -> ../assets/fonts/...,
  - les commentaires d'origine -> en-tetes de section documentes.

Verification : le script compare le corps CSS genere (normalise) au CSS source
(normalise) et sort en echec si une declaration a disparu ou a change.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source" / "pretty.css"
DST = ROOT / "css" / "style.css"

# --- Correspondances asset -> variable CSS -------------------------------
ASSET_VARS = {
    "garden.png": "--asset-garden",
    "paper-grain.svg": "--asset-paper-grain",
    "envelope-realistic.png": "--asset-envelope",
    "floral-corner.png": "--asset-floral",
}
FONT_FILES = {
    "beau-rivage.woff": "../assets/fonts/beau-rivage.woff",
    "imperial-script.woff": "../assets/fonts/imperial-script.woff",
    "ovo.woff2": "../assets/fonts/ovo.woff2",
}

HEADER = """/* ==========================================================================
   Invitation de mariage - feuille de style principale
   --------------------------------------------------------------------------
   Reconstruction locale de https://invitation-jerome-melissa.vercel.app/
   (page unique hebergee sur Vercel, CSS inline de 23 Ko).

   Ce fichier reproduit la cascade CSS d'origine a l'identique, dans l'ordre
   exact des couches d'origine : chaque bloc suivant surcharge le precedent.
   Les chemins d'images passent par des variables --asset-* (bloc 8) afin que
   config.json puisse redefinir les visuels sans toucher au CSS.

   Sommaire
     1. Design system, variables, typographie, sections generiques
     2. Recalages mobile iPhone 14 (390x844)
     3. Scene alignee : video d'ouverture -> carte
     4. Recalages iPhone 14 / iPhone 15
     5. Direction artistique finale (ivoire, or, papier vegetal)
     6. Lecteur video interieur persistant
     7. Couverture viewport + crossfade composite iOS
     8. Variables d'assets
   ========================================================================== */

"""

SECTION_HEADERS = {
    "iPhone 14 portrait: 390 x 844 CSS px; native-safe viewport.": (
        "2. Recalages mobile iPhone 14 (390x844)"
    ),
    "One aligned scene from video through card handoff.": (
        "3. Scene alignee : video d'ouverture -> carte"
    ),
    "iPhone 14: 390 x 844; iPhone 15: 393 x 852.": (
        "4. Recalages iPhone 14 / iPhone 15"
    ),
    "Reference styling: warm ivory, fine gold type, botanical paper panels.": (
        "5. Direction artistique finale (ivoire, or, papier vegetal)"
    ),
    "One persistent interior player, revealed directly underneath the opening.": (
        "6. Lecteur video interieur persistant"
    ),
    "Full viewport cover and a single composited crossfade on iOS.": (
        "7. Couverture viewport + crossfade composite iOS"
    ),
}

ASSET_BLOCK = """
/* ==========================================================================
   8. Variables d'assets
   --------------------------------------------------------------------------
   app.js redifie ces variables depuis config.json (section "assets") afin que
   le template reste reconfigurable sans toucher au CSS. Les valeurs ci-dessous
   correspondent aux fichiers livres dans assets/.
   ========================================================================== */

:root {
  --asset-garden: url("../assets/garden.png");
  --asset-paper-grain: url("../assets/paper-grain.svg");
  --asset-envelope: url("../assets/envelope-realistic.png");
  --asset-floral: url("../assets/floral-corner.png");
}
"""


def normalize(css: str) -> str:
    """Normalise un CSS pour comparaison structurelle (ordre des regles conserve)."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", "", css)
    return css


def rewrite(css: str) -> str:
    """Applique les chemins d'assets -> variables et les polices -> ../assets/fonts."""
    for filename, var in ASSET_VARS.items():
        css = css.replace(f'url("{filename}")', f"var({var})")
        css = css.replace(f"url('{filename}')", f"var({var})")
    for filename, target in FONT_FILES.items():
        css = css.replace(f'url("{filename}")', f'url("{target}")')
        css = css.replace(f"url('{filename}')", f"url('{target}')")
    return css


def split_sections(css: str):
    """Decoupe le CSS sur les commentaires d'origine (frontieres de couches)."""
    chunks = []
    pos = 0
    for comment in re.finditer(r"/\*.*?\*/", css, flags=re.S):
        chunks.append(css[pos : comment.start()])
        chunks.append(("COMMENT", comment.group(0)))
        pos = comment.end()
    chunks.append(css[pos:])
    return chunks


def build_core(src: str) -> str:
    """Corps du CSS : source reecrite + en-tetes de section, ordre preserve."""
    out = [
        "\n/* ==========================================================================\n"
        "   1. Design system, variables, typographie, sections generiques\n"
        "   ========================================================================== */\n"
    ]
    for chunk in split_sections(src):
        if isinstance(chunk, tuple):
            body = chunk[1].strip()[2:-2].strip()
            title = SECTION_HEADERS.get(body)
            if title is None:
                out.append(f"\n/* {body} */\n")
            else:
                out.append(
                    "\n/* ==========================================================================\n"
                    f"   {title}\n"
                    "   ========================================================================== */\n"
                )
            continue
        body = chunk.strip("\n")
        if body:
            out.append("\n" + body + "\n")
    return rewrite("".join(out))


def main() -> int:
    src = SRC.read_text(encoding="utf-8")

    core = build_core(src)
    css = HEADER + core.lstrip("\n") + ASSET_BLOCK

    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(css, encoding="utf-8")

    # --- verification: le corps genere doit etre equivalent a la source ---
    expected = rewrite(src)
    if normalize(expected) != normalize(core):
        a, b = normalize(expected), normalize(core)
        idx = next(
            (i for i, (x, y) in enumerate(zip(a, b)) if x != y),
            min(len(a), len(b)),
        )
        print("DIVERGENCE a l'offset", idx)
        print("SOURCE :", a[max(0, idx - 120) : idx + 120])
        print("GENERE :", b[max(0, idx - 120) : idx + 120])
        return 1
    print("OK : corps CSS genere equivalent a la source (meme ordre de regles)")

    print(f"Ecrit : {DST} ({len(css)} octets, {css.count(chr(10))} lignes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
