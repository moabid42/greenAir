"""Browser-only basemap stub; tested application/API traffic stays real and local.

The map background is intentionally empty. This suite verifies app behavior and
MapLibre overlays, not external tiles, geocoders or environmental API availability.
"""

import json
from urllib.parse import urlsplit


def local_browser(context):
    blocked = []
    style = {
        "version": 8,
        "sources": {
            "openmaptiles": {
                "type": "vector",
                "tiles": ["https://e2e-map.invalid/{z}/{x}/{y}.pbf"],
                "minzoom": 0,
                "maxzoom": 14,
            }
        },
        "layers": [
            {"id": "background", "type": "background", "paint": {"background-color": "#e3eadf"}}
        ],
    }

    def route(request):
        url = request.request.url
        host = urlsplit(url).hostname
        if host in {"localhost", "127.0.0.1", "::1"}:
            request.continue_()
        elif "styles/" in url or url.endswith("style.json"):
            request.fulfill(status=200, content_type="application/json", body=json.dumps(style))
        elif host == "e2e-map.invalid":
            request.fulfill(status=200, content_type="application/x-protobuf", body=b"")
        else:
            blocked.append(url)
            request.abort()

    context.route("**/*", route)
    return blocked
