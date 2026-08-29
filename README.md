# CloudWatch ☁️

Point your phone at a literal cloud and estimate how far away and how large it is.

This is a browser-first proof of concept. It uses the phone camera, geolocation, device orientation, a rough meteorological cloud-base estimate, and simple viewing geometry. The result is an estimate with uncertainty, not a surveying instrument.

## PoC flow

1. Open the site on a phone.
2. Allow camera, location, and motion/orientation access.
3. Aim at one cloud.
4. Tap its base, top, left edge, and right edge.
5. CloudWatch estimates base altitude, range, width, and vertical extent.

The current PoC estimates cloud-base AGL from the surface temperature/dew-point spread using an LCL rule of thumb, and lets you tune vertical camera FOV because browsers do not reliably expose calibrated camera intrinsics.

## GitHub Pages

The site is intentionally dependency-free so GitHub Pages can serve it directly from `main`.

After Pages is enabled for the repository, choose **Deploy from a branch**, select **main** and **/(root)**, then save.

## Caveats

Single-view geometry is underdetermined without an altitude assumption. CloudWatch exposes that assumption and its uncertainty rather than pretending otherwise. Future versions can add second-position triangulation, calibrated camera profiles, cloud segmentation, sounding/model data, and satellite matching.
