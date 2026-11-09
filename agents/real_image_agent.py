"""
agents/real_image_agent.py — Real product/entity photos, legally.

For topics naming a specific real product (a named chip, a phone, a piece of
hardware), a diffusion-generated approximation looks obviously fake to anyone
who's seen the real thing — the opposite of the "attractive, accurate" bar
we're aiming for. The fix is a REAL photo, not a better-generated one.

This is NOT a Google Images scraper. Deliberately: almost every product photo
findable via general image search is copyrighted by the manufacturer, a press
outlet, or a stock agency, and stripping a watermark doesn't remove the
copyright — it removes the attribution while keeping the infringement, which is
worse, not better, and is exactly the kind of thing that gets a monetized
channel copyright-struck.

Instead this queries Wikimedia Commons and Openverse (which aggregates CC-licensed
images from Flickr, museums, and other sources beyond Commons), both of which
expose real license metadata per file (CC0, public domain, CC-BY, CC-BY-SA, etc.)
via their APIs. Only images with an open license we can actually legally reuse
are returned, each with the attribution string the license requires — most
CC-BY/BY-SA licenses require credit, they don't forbid monetized use, and this
pipeline keeps the credit rather than stripping it.

Coverage is real but uneven: well-established products (a phone that's been out
for months, a car people photograph) turn up plenty of licensed shots; a chip
announced days ago usually has none yet, because nobody's had time to shoot and
properly license a photo of it. When neither source has a match, the caller
falls back to AI generation for that scene rather than use anything unlicensed.
"""

import os
import re
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = os.getenv(
    "COMMONS_USER_AGENT",
    "AgenticYT-Research/1.0 (https://github.com/; contact=set-a-real-contact-in-env)",
)

# Licenses that are actually safe to reuse, including in monetized content, as
# long as attribution is kept where the license requires it. Deliberately
# excludes anything requiring per-case legal judgment (fair use claims, "all
# rights reserved" press photos, unclear/missing license) rather than guessing.
ALLOWED_LICENSES = {
    "cc0", "public domain", "pd",
    "cc by", "cc by 2.0", "cc by 3.0", "cc by 4.0",
    "cc by-sa", "cc by-sa 2.0", "cc by-sa 3.0", "cc by-sa 4.0",
}

MIN_WIDTH = int(os.getenv("REAL_IMAGE_MIN_WIDTH", "800"))
MIN_HEIGHT = int(os.getenv("REAL_IMAGE_MIN_HEIGHT", "450"))


def _is_allowed_license(license_short_name: str) -> bool:
    if not license_short_name:
        return False
    normalized = license_short_name.strip().lower()
    return any(normalized.startswith(allowed) for allowed in ALLOWED_LICENSES)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def search_commons_images(query: str, limit: int = 8) -> list[dict]:
    """
    Returns candidate real photos for `query` that carry an open, reusable
    license, each as:
      {"url", "title", "width", "height", "license", "attribution", "source_page"}
    Empty list (never raises) if nothing licensed appropriately is found —
    caller should fall back to AI-generated art for that scene rather than use
    an unlicensed/ambiguous image.
    """
    try:
        resp = requests.get(
            COMMONS_API,
            params={
                "action": "query",
                "generator": "search",
                "gsrsearch": query,
                "gsrnamespace": 6,  # File: namespace
                "gsrlimit": limit,
                "prop": "imageinfo",
                "iiprop": "url|size|extmetadata|mime",
                "iiurlwidth": 400,  # cheap thumbnail for CLIP relevance scoring, no full download needed
                "format": "json",
            },
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        pages = resp.json().get("query", {}).get("pages", {})
    except Exception as e:
        print(f"PYMSG: [real_image_agent] Commons search failed for {query!r}: {e}", flush=True)
        return []

    candidates = []
    for page in pages.values():
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        mime = info.get("mime", "")
        if not mime.startswith("image/"):
            continue  # skip videos/audio Commons also indexes
        width, height = info.get("width", 0), info.get("height", 0)
        if width < MIN_WIDTH or height < MIN_HEIGHT:
            continue

        meta = info.get("extmetadata", {})
        license_name = meta.get("LicenseShortName", {}).get("value", "")
        if not _is_allowed_license(license_name):
            continue

        artist = _strip_html(meta.get("Artist", {}).get("value", ""))
        credit = _strip_html(meta.get("Credit", {}).get("value", ""))
        attribution = f"{artist or credit or 'Wikimedia Commons contributor'} / Wikimedia Commons ({license_name})"

        candidates.append({
            "url": info["url"],
            "thumb_url": info.get("thumburl", info["url"]),
            "title": page.get("title", ""),
            "width": width,
            "height": height,
            "license": license_name,
            "attribution": attribution,
            "source_page": f"https://commons.wikimedia.org/wiki/{page.get('title', '').replace(' ', '_')}",
        })

    return candidates


OPENVERSE_API = "https://api.openverse.org/v1/images/"
# by-nd (no-derivatives) is commercially licensable but forbids derivative works —
# our pipeline crops/composites/colour-grades every image, which IS a derivative,
# so it's excluded even though Openverse's "commercial" filter would allow it through.
OPENVERSE_EXCLUDED = {"nd", "by-nd"}


def search_openverse_images(query: str, limit: int = 8) -> list[dict]:
    """
    Second source after Commons: Openverse aggregates CC-licensed images from
    Flickr, museums, and other collections — broader real-world product/event
    photo coverage than Commons alone, still with per-image license metadata.
    """
    try:
        resp = requests.get(
            OPENVERSE_API,
            params={
                "q": query,
                "license_type": "commercial",  # excludes NC (non-commercial-only) licenses
                "category": "photograph",       # real photos, not illustrations/vector art
                "page_size": limit,
            },
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
    except Exception as e:
        print(f"PYMSG: [real_image_agent] Openverse search failed for {query!r}: {e}", flush=True)
        return []

    candidates = []
    for item in results:
        license_name = (item.get("license") or "").strip().lower()
        if license_name in OPENVERSE_EXCLUDED:
            continue
        width, height = item.get("width") or 0, item.get("height") or 0
        if width < MIN_WIDTH or height < MIN_HEIGHT:
            continue
        version = item.get("license_version", "")
        attribution = (
            f"{item.get('creator', 'Unknown')} / {item.get('source', 'Openverse')} "
            f"(CC {license_name.upper()} {version})".strip()
        )
        candidates.append({
            "url": item.get("url"),
            "thumb_url": item.get("thumbnail") or item.get("url"),
            "title": item.get("title", query),
            "width": width,
            "height": height,
            "license": f"CC {license_name.upper()} {version}".strip(),
            "attribution": attribution,
            "source_page": item.get("foreign_landing_url") or item.get("url"),
        })

    return candidates


# Some Commons uploads are huge stitched/microscope images (a chip die photo can
# be 200+ megapixels) and trip Pillow's default decompression-bomb guard
# (~179 megapixels), which exists to protect against malicious crafted images.
# These are legitimate downloads from Wikimedia/Openverse, not arbitrary untrusted
# input, so raise the ceiling rather than disable the check outright, and shrink
# immediately after decoding — we only ever need <=1080x1920 for the final video
# anyway, so there's no reason to hold a 200MP image in memory past this point.
MAX_DOWNLOAD_PIXELS = int(os.getenv("REAL_IMAGE_MAX_PIXELS", str(300_000_000)))
MAX_DOWNLOAD_DIMENSION = int(os.getenv("REAL_IMAGE_MAX_DIMENSION", "2500"))


def download_real_image(candidate: dict, output_path: str) -> bool:
    """Downloads and re-encodes a Commons/Openverse candidate to JPEG at `output_path`."""
    try:
        r = requests.get(candidate["url"], headers={"User-Agent": USER_AGENT}, timeout=20)
        r.raise_for_status()

        previous_limit = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = MAX_DOWNLOAD_PIXELS
        try:
            img = Image.open(BytesIO(r.content)).convert("RGB")
            img.thumbnail((MAX_DOWNLOAD_DIMENSION, MAX_DOWNLOAD_DIMENSION), Image.LANCZOS)
        finally:
            Image.MAX_IMAGE_PIXELS = previous_limit

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, format="JPEG", quality=92)
        return True
    except Exception as e:
        print(f"PYMSG: [real_image_agent] Failed to download {candidate.get('url')}: {e}", flush=True)
        return False


def _rank_by_relevance(candidates: list[dict], query: str) -> list[dict]:
    """
    Scores each candidate's cheap thumbnail against `query` with CLIP and sorts
    best-match-first — actual visual relevance, not resolution as a proxy for it.
    Falls back to a resolution sort (the old behavior) if CLIP/torch isn't
    available, so this never blocks image sourcing outright.
    """
    try:
        from io import BytesIO as _BytesIO
        from PIL import Image as _Image
        from agents.clip_utils import score_image_prompt

        scored = []
        for c in candidates:
            try:
                r = requests.get(c["thumb_url"], headers={"User-Agent": USER_AGENT}, timeout=10)
                r.raise_for_status()
                thumb = _Image.open(_BytesIO(r.content)).convert("RGB")
                c["_relevance"] = score_image_prompt(thumb, query)
            except Exception:
                c["_relevance"] = -1.0
            scored.append(c)
        scored.sort(key=lambda c: c["_relevance"], reverse=True)
        return scored
    except Exception as e:
        print(f"PYMSG: [real_image_agent] CLIP ranking unavailable ({e}); sorting by resolution instead.", flush=True)
        return sorted(candidates, key=lambda c: c["width"] * c["height"], reverse=True)


def search_real_photos(query: str, exclude_urls: set[str] | None = None, limit: int = 6) -> list[dict]:
    """
    Returns up to `limit` licensed real-photo candidates for `query`, ranked by
    actual CLIP relevance (not just resolution), from Commons then Openverse,
    with any URL in `exclude_urls` (agents.used_media_registry — already used in
    an earlier video) filtered out so the channel doesn't repeat the same photo
    across different videos.
    """
    exclude_urls = exclude_urls or set()
    candidates = search_commons_images(query, limit=limit * 2)
    candidates += search_openverse_images(query, limit=limit * 2)
    candidates = [c for c in candidates if c["url"] not in exclude_urls]
    if not candidates:
        return []
    return _rank_by_relevance(candidates, query)[:limit]


def fetch_real_entity_image(entity_name: str, output_path: str, exclude_urls: set[str] | None = None) -> dict | None:
    """
    Finds and downloads the single best licensed real photo for `entity_name`.
    Returns the winning candidate dict (with a local "path" key added) plus
    attribution, or None if nothing suitably licensed (and unused) was found —
    the caller should fall back to AI generation in that case.
    """
    candidates = search_real_photos(entity_name, exclude_urls=exclude_urls, limit=5)
    if not candidates:
        return None
    best = candidates[0]
    print(
        f"PYMSG: [real_image_agent] Best match for {entity_name!r}: {best['title']!r} "
        f"(relevance={best.get('_relevance', 0):.3f})",
        flush=True,
    )

    if not download_real_image(best, output_path):
        return None

    best["path"] = output_path
    print(
        f"PYMSG: [real_image_agent] Using real photo for {entity_name!r}: "
        f"{best['title']} ({best['license']}, {best['width']}x{best['height']})",
        flush=True,
    )
    return best
