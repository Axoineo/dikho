#!/usr/bin/env bash
# Converts one client logo into the white-on-transparent WebP the Corporate
# Gifting logo wall expects.
#
#   scripts/mono-logo.sh <source-image> <slug> [--dark-box] [--crop WxH+X+Y]
#                        [--ink <colour>] [black%,white%]
#
# How it works: the artwork is flattened onto white, reduced to greyscale, and
# that greyscale is used as the ALPHA channel of a single flat colour. So the
# logo's ink becomes opaque and its background falls away — which is what makes
# a mixed bag of JPEGs, transparent PNGs and boxed logos all read as one set.
#
# --ink sets that flat colour. It defaults to the dark slate the wall uses on
# the page's light background; pass white if the wall ever moves onto a dark
# one. Getting this backwards makes every logo invisible, so it is the first
# thing to check if the wall looks empty.
#
# Pass --dark-box for a logo that is a LIGHT mark on a dark/coloured box
# (Titan Eyeplus, Gallantt): the mark is already the bright part, so the
# greyscale must not be inverted. The optional level pair raises the black
# point to drop a background the stretch would otherwise keep.
#
# --crop takes a region off the source BEFORE any of that, for artwork that
# mixes both polarities in one file or carries detail that does not survive
# being flattened to a silhouette. Two use it: AGL, whose "Beautiful Life"
# strip is dark-on-white directly under a white-on-red plate, and KFC, whose
# Colonel roundel becomes a white disc with a face-shaped hole.
set -euo pipefail

src=$1; slug=$2; shift 2
neg="-negate"; lvl='8%,82%'; crop=""; ink='#33415a'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dark-box) neg="" ;;
    --crop)     crop="$2"; shift ;;
    --ink)      ink="$2"; shift ;;
    *%,*%)      lvl="$1" ;;
  esac
  shift
done

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# ImageMagick cannot decode AVIF here; ffmpeg can.
if [[ "${src,,}" == *.avif ]]; then
  ffmpeg -y -loglevel error -i "$src" "$tmp/in.png"; src="$tmp/in.png"
fi

magick "${src}[0]" -background white -alpha remove -alpha off \
  ${crop:+-crop "$crop" +repage} \
  -fuzz 3% -trim +repage -resize '240x96>' -colorspace Gray "$tmp/g.png"

magick "$tmp/g.png" $neg -auto-level -level "$lvl" \
  -alpha copy -fill "$ink" -colorize 100% \
  -quality 82 -define webp:alpha-quality=92 -define webp:method=6 "public/clientele/$slug.webp"

magick identify -format "$slug  %wx%h  %b\n" "public/clientele/$slug.webp"
