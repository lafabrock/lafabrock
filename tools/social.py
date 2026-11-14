#!/usr/bin/env python3
"""Posts Instagram et Facebook pour les nouveaux épisodes de La fabrock.

Deux temps, pour garder une relecture humaine entre les deux :

  python3 tools/social.py prepare            # nouveaux épisodes depuis le dernier commit
  python3 tools/social.py prepare s14e06     # un épisode précis (re-génère le brouillon)
      -> social/<slug>/ : 01-cover.jpg, 02-affiche.jpg, 03-ou-ecouter.jpg, instagram.txt, facebook.txt

  python3 tools/social.py publish            # tous les brouillons pas encore publiés
  python3 tools/social.py publish s14e06     # un épisode précis
      -> carrousel Instagram + post Facebook, puis social/<slug>/published.json

Les textes instagram.txt et facebook.txt peuvent être corrigés à la main (dans GitHub)
avant la publication : c'est leur contenu qui part, tel quel.

Variables d'environnement pour publish : META_PAGE_TOKEN, FB_PAGE_ID, IG_USER_ID
(secrets GitHub), et facultativement GRAPH_VERSION (défaut v27.0).
"""
import io
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
SHOWS = ROOT / "data" / "shows.json"
SOCIAL = ROOT / "social"
SITE = "https://lafabrock.github.io/lafabrock"
EPISODE_SLUG = re.compile(r"^s(\d+)e(\d+)$")

SIZE = 1080
BG = (0x23, 0x1F, 0x20)
TURQUOISE = (0x05, 0xAD, 0xAA)
WHITE = (255, 255, 255)
GREY = (0xB5, 0xB0, 0xB1)
MAX_CAROUSEL = 10  # limite de l'API Instagram
MAX_HASHTAGS = 12


# ---------------------------------------------------------------- données

def load_shows(text=None):
    data = json.loads(text) if text is not None else json.loads(SHOWS.read_text("utf-8"))
    return {s["slug"]: s for s in data["shows"] if s.get("slug")}


def new_episode_slugs():
    """Épisodes de saison présents dans shows.json mais pas dans la version committée."""
    try:
        old = subprocess.run(["git", "show", "HEAD:data/shows.json"], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout
        before = set(load_shows(old))
    except subprocess.CalledProcessError:
        before = set()
    now = load_shows()
    return [slug for slug in now if slug not in before and EPISODE_SLUG.match(slug)]


def episode_code(slug):
    m = EPISODE_SLUG.match(slug)
    return (m.group(1), m.group(2).zfill(2)) if m else ("", "")


# ---------------------------------------------------------------- textes

def clean_description(desc):
    """Retire les lignes de liens (inutiles sur Instagram : rien n'y est cliquable)."""
    lines = [l.rstrip() for l in (desc or "").splitlines()]
    lines = [l for l in lines if not re.search(r"https?://", l)]
    return "\n".join(lines).strip()


def hashtag(tag):
    words = re.findall(r"[0-9A-Za-zÀ-ÖØ-öø-ÿ]+", tag)
    return "#" + "".join(w[:1].upper() + w[1:] for w in words) if words else ""


def captions(show):
    season, ep = episode_code(show["slug"])
    head = f"La fabrock · saison {int(season)}, épisode {int(ep)}" if season else "La fabrock"
    desc = clean_description(show.get("description"))
    tags = ["#LaFabrock", "#Radio666", "#Radio"]
    for t in show.get("tags", []):
        h = hashtag(t)
        if h and h.lower() not in {x.lower() for x in tags}:
            tags.append(h)
    tags = tags[:MAX_HASHTAGS]
    page = f"{SITE}/show/{show['slug']}/"

    insta = "\n\n".join(p for p in [
        head,
        desc,
        "🎧 L'émission complète, la tracklist et la playlist : lien en bio.",
        "Chaque jeudi de 23 h à minuit sur Radio 666.",
        " ".join(tags),
    ] if p)[:2200]

    fb = "\n\n".join(p for p in [
        head,
        (show.get("description") or "").strip(),
        f"🎧 Écouter et voir la tracklist : {page}",
    ] if p)
    return insta, fb, page


# ---------------------------------------------------------------- images

def font(weight, size):
    from PIL import ImageFont
    names = {
        "bold": ["Inter-Bold.otf", "Inter-Bold.ttf", "DejaVuSans-Bold.ttf"],
        "regular": ["Inter-Regular.otf", "Inter-Regular.ttf", "DejaVuSans.ttf"],
    }[weight]
    dirs = ["/usr/share/fonts/opentype/inter", "/usr/share/fonts/truetype/inter",
            "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts"]
    for n in names:
        for d in dirs:
            p = Path(d) / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size)


def fit(draw, text, f, width):
    if draw.textlength(text, font=f) <= width:
        return text
    while text and draw.textlength(text + "…", font=f) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def save_jpeg(img, path):
    img.convert("RGB").save(path, "JPEG", quality=90, optimize=True)


def make_cover(show, path):
    from PIL import Image
    url = show.get("cover") or ""
    url = re.sub(r"/unsafe/\d+x\d+/", f"/unsafe/{SIZE}x{SIZE}/", url)
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content))
    if img.size != (SIZE, SIZE):
        img = img.resize((SIZE, SIZE), Image.LANCZOS)
    save_jpeg(img, path)


def draw_frame(draw, slug, page_label):
    """Logo en bas à gauche, numéro d'épisode en bas à droite (charte saison 14)."""
    season, ep = episode_code(slug)
    big = font("bold", 46)
    x, y = 70, SIZE - 70 - 3 * 46
    draw.text((x, y), "LA", font=big, fill=WHITE)
    draw.text((x, y + 46), "FAB", font=big, fill=WHITE)
    draw.text((x, y + 92), "ROCK", font=big, fill=TURQUOISE)
    if season:
        code = font("bold", 64)
        w2 = draw.textlength(season + ep, font=code)
        w1 = draw.textlength(season, font=code)
        bx = SIZE - 70 - w2
        by = SIZE - 70 - 64
        draw.text((bx, by), season, font=code, fill=WHITE)
        draw.text((bx + w1, by), ep, font=code, fill=TURQUOISE)
    small = font("regular", 30)
    draw.text((SIZE - 70 - draw.textlength(page_label, font=small), 70), page_label,
              font=small, fill=GREY)


SEPARATORS = re.compile(r"\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x|et)\s+", re.I)


def lineup(show):
    """Artistes de l'épisode : ceux du titre d'abord (têtes d'affiche), puis les autres."""
    seen, artists = set(), []
    for t in show.get("tracks", []):
        if not t or t[0] != "track":
            continue
        for a in SEPARATORS.split(t[1] or ""):
            a = a.strip(" ,;")
            if a and a.lower() not in seen:
                seen.add(a.lower())
                artists.append(a)
    title = (show.get("name") or "").split("|")[-1].lower()
    heads = sorted((a for a in artists if a.lower() in title), key=lambda a: title.find(a.lower()))
    return heads, [a for a in artists if a not in heads]


def layout_lines(draw, words, f, width, sep):
    lines, cur = [], []
    for w in words:
        trial = sep.join(cur + [w])
        if cur and draw.textlength(trial, font=f) > width:
            lines.append(cur)
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(cur)
    return lines


def draw_centered_line(d, y, words, f, colors, sep):
    total = d.textlength(sep.join(words), font=f)
    x = (SIZE - total) / 2
    for i, w in enumerate(words):
        if i:
            d.text((x, y), sep, font=f, fill=TURQUOISE)
            x += d.textlength(sep, font=f)
        d.text((x, y), w, font=f, fill=colors[i % len(colors)])
        x += d.textlength(w, font=f)


def make_poster(show, path):
    """Affiche façon festival : têtes d'affiche en grand, puis tous les autres artistes."""
    from PIL import Image, ImageDraw
    heads, others = lineup(show)
    if not heads and others:
        heads, others = others[:3], others[3:]
    width, top, bottom = SIZE - 140, 180, SIZE - 230
    sep = "  ·  "
    for scale in [x / 100 for x in range(100, 30, -5)]:
        img = Image.new("RGB", (SIZE, SIZE), BG)
        d = ImageDraw.Draw(img)
        hf, of = font("bold", int(64 * scale)), font("bold", int(38 * scale))
        hl = layout_lines(d, [h.upper() for h in heads], hf, width, sep)
        ol = layout_lines(d, others, of, width, sep)
        hgap, ogap = int(64 * scale * 1.25), int(38 * scale * 1.35)
        height = len(hl) * hgap + (30 if ol else 0) + len(ol) * ogap
        if height <= bottom - top:
            break
    d.text((70, 60), "Au programme", font=font("bold", 60), fill=WHITE)
    draw_frame(d, show["slug"], "")
    y = top + (bottom - top - height) // 2
    for line in hl:
        draw_centered_line(d, y, line, hf, [WHITE], sep)
        y += hgap
    y += 30
    for line in ol:
        draw_centered_line(d, y, line, of, [(0xD9, 0xD4, 0xD5), GREY], sep)
        y += ogap
    save_jpeg(img, path)


def make_listen(show, path):
    """Dernière slide : où écouter l'émission."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (SIZE, SIZE), BG)
    d = ImageDraw.Draw(img)
    d.text((70, 60), "Où écouter", font=font("bold", 60), fill=WHITE)
    draw_frame(d, show["slug"], "")
    sites = {l.get("site") for l in show.get("links", [])} | {"Mixcloud"}
    rows = [("Mixcloud", "l'émission complète, avec la voix")]
    if "YouTube" in sites:
        rows.append(("YouTube", "la version mix, sans la voix"))
    if "open.spotify.com" in (show.get("description") or ""):
        rows.append(("Spautifaille", "la playlist Spotify de l'épisode"))
    rows.append(("Les archives", "toutes les tracklists depuis 2012"))
    y = 200
    for name, what in rows:
        d.text((70, y), name, font=font("bold", 50), fill=TURQUOISE)
        d.text((70, y + 60), what, font=font("regular", 34), fill=GREY)
        y += 130
    d.text((70, y + 20), "Liens en bio", font=font("bold", 40), fill=WHITE)
    d.text((70, y + 75), "Chaque jeudi, 23 h – minuit, sur Radio 666", font=font("regular", 34),
           fill=WHITE)
    save_jpeg(img, path)


def prepare(slug, shows):
    show = shows.get(slug)
    if not show:
        sys.exit(f"Épisode inconnu : {slug}")
    folder = SOCIAL / slug
    if (folder / "published.json").exists():
        print(f"{slug} : déjà publié, brouillon laissé tel quel")
        return
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.jpg"):
        old.unlink()
    have_cover = True
    try:
        make_cover(show, folder / "01-cover.jpg")
    except Exception as e:  # la pochette n'est pas indispensable
        have_cover = False
        print(f"  ! pochette non récupérée ({e})")
    n = 2 if have_cover else 1
    make_poster(show, folder / f"{n:02d}-affiche.jpg")
    make_listen(show, folder / f"{n + 1:02d}-ou-ecouter.jpg")
    insta, fb, _ = captions(show)
    (folder / "instagram.txt").write_text(insta + "\n", "utf-8")
    (folder / "facebook.txt").write_text(fb + "\n", "utf-8")
    print(f"{slug} : brouillon prêt dans social/{slug}/ "
          f"({len(list(folder.glob('*.jpg')))} images)")


# ---------------------------------------------------------------- publication

class Meta:
    def __init__(self):
        missing = [k for k in ("META_PAGE_TOKEN", "FB_PAGE_ID", "IG_USER_ID") if not os.environ.get(k)]
        if missing:
            sys.exit("Secrets manquants : " + ", ".join(missing))
        self.token = os.environ["META_PAGE_TOKEN"]
        self.page = os.environ["FB_PAGE_ID"]
        self.ig = os.environ["IG_USER_ID"]
        self.base = f"https://graph.facebook.com/{os.environ.get('GRAPH_VERSION', 'v27.0')}"

    def call(self, method, path, **params):
        params["access_token"] = self.token
        r = requests.request(method, f"{self.base}/{path}",
                             params=params if method == "GET" else None,
                             data=params if method == "POST" else None, timeout=60)
        body = r.json() if r.content else {}
        if r.status_code >= 400 or "error" in body:
            err = body.get("error", {})
            raise RuntimeError(f"Meta {path} : {err.get('message', r.text)}")
        return body

    def wait_ready(self, container):
        for _ in range(30):
            status = self.call("GET", container, fields="status_code").get("status_code")
            if status == "FINISHED":
                return
            if status in ("ERROR", "EXPIRED"):
                raise RuntimeError(f"Instagram a refusé le média ({status})")
            time.sleep(5)
        raise RuntimeError("Instagram n'a pas fini de traiter les images à temps")

    def instagram(self, image_urls, caption):
        if len(image_urls) == 1:
            container = self.call("POST", f"{self.ig}/media", image_url=image_urls[0],
                                  caption=caption)["id"]
        else:
            children = []
            for u in image_urls:
                cid = self.call("POST", f"{self.ig}/media", image_url=u,
                                is_carousel_item="true")["id"]
                self.wait_ready(cid)
                children.append(cid)
            container = self.call("POST", f"{self.ig}/media", media_type="CAROUSEL",
                                  children=",".join(children), caption=caption)["id"]
        self.wait_ready(container)
        media = self.call("POST", f"{self.ig}/media_publish", creation_id=container)["id"]
        link = self.call("GET", media, fields="permalink").get("permalink")
        return {"id": media, "url": link}

    def facebook(self, message, link):
        post = self.call("POST", f"{self.page}/feed", message=message, link=link)["id"]
        return {"id": post, "url": f"https://www.facebook.com/{post}"}


def check_online(urls):
    for u in urls:
        r = requests.head(u, timeout=30, allow_redirects=True)
        if r.status_code != 200:
            sys.exit(f"Image pas encore en ligne ({r.status_code}) : {u}\n"
                     "GitHub Pages met 1 à 2 minutes à publier : relance dans un moment.")


def publish(slug, shows, meta):
    folder = SOCIAL / slug
    if not folder.exists():
        sys.exit(f"Pas de brouillon pour {slug} : lance d'abord « prepare {slug} »")
    marker = folder / "published.json"
    done = json.loads(marker.read_text("utf-8")) if marker.exists() else {}
    images = sorted(folder.glob("*.jpg"))[:MAX_CAROUSEL]
    urls = [f"{SITE}/social/{slug}/{p.name}" for p in images]
    _, _, page = captions(shows[slug])

    if "instagram" not in done:
        check_online(urls)
        caption = (folder / "instagram.txt").read_text("utf-8").strip()
        done["instagram"] = meta.instagram(urls, caption)
        print(f"{slug} : Instagram ✓ {done['instagram'].get('url')}")
        marker.write_text(json.dumps(done, indent=1, ensure_ascii=False), "utf-8")
    if "facebook" not in done:
        message = (folder / "facebook.txt").read_text("utf-8").strip()
        done["facebook"] = meta.facebook(message, page)
        print(f"{slug} : Facebook ✓ {done['facebook'].get('url')}")
    done["date"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    marker.write_text(json.dumps(done, indent=1, ensure_ascii=False), "utf-8")


def pending_slugs():
    if not SOCIAL.exists():
        return []
    return sorted(p.name for p in SOCIAL.iterdir()
                  if p.is_dir() and not (p / "published.json").exists())


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("prepare", "publish"):
        sys.exit(__doc__)
    cmd, slugs = sys.argv[1], [a for a in sys.argv[2:] if a.strip()]
    shows = load_shows()
    if cmd == "prepare":
        slugs = slugs or new_episode_slugs()
        if not slugs:
            print("Aucun nouvel épisode : pas de brouillon à préparer")
        for s in slugs:
            prepare(s, shows)
    else:
        slugs = slugs or pending_slugs()
        if not slugs:
            print("Aucun brouillon en attente de publication")
            return
        meta = Meta()
        for s in slugs:
            publish(s, shows, meta)


if __name__ == "__main__":
    main()
