# gtnh-version-extractor
A small script that extracts and serves the current gtnh versions from the gtnh website github repo config


### This GTNH Versions API is available for free at https://gtnh-versions.hypeserv.com.

You can selfhost this or use our free API for extracting **GTNH server pack versions and download URLs** from the gtnh website repo.

Base URL:
[https://gtnh-versions.hypeserv.com](https://gtnh-versions.hypeserv.com)


The upstream config is fetched once at startup and kept in memory.

---

## Endpoints

### `GET /`
Basic status check.

---

### `GET /health`
Returns:
```

ok

````

---

### `GET /versions`
Returns the full `versions` object from the official GTNH config (JSON).

---

### `GET /serverfiles`
Returns **all** server pack URLs (stable + pre-release).  
Format: plain text, one URL per line. Backwards compatible to the old format at: https://downloads.gtnewhorizons.com/ServerPacks/?raw

---

### `GET /serverfiles/stable`
Returns stable only (`x.y.z`) server pack URLs.  
Format: plain text, one URL per line. Backwards compatible to the old format at: https://downloads.gtnewhorizons.com/ServerPacks/?raw

---

## Example

```bash
curl https://gtnh-versions.hypeserv.com/serverfiles/stable
````

---

## Notes

* No authentication required.
* No rate limiting (reasonable use expected).
