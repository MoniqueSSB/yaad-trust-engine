#!/bin/sh
# Turns what-yaadly-is.html, week-posts.html and tiktok-slides.html into the PNGs beside them. Needs Google Chrome
# and a network connection (the fonts come from Google Fonts).
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --virtual-time-budget=8000 \
    --window-size="$2" --screenshot="$PWD/$1" "file://$PWD/$3" >/dev/null 2>&1
}
shot what-yaadly-is-feed-1080x1350.png 1080,1350 "what-yaadly-is.html"
shot what-yaadly-is-story-1080x1920.png 1080,1920 "what-yaadly-is.html?s=story"
n=1
for name in the-question five-questions directory-or-yaadly why-i-started setup-check; do
  shot "week-$n-$name-1080x1350.png" 1080,1350 "week-posts.html?p=$n"
  n=$((n+1))
done
for n in 1 2 3 4 5; do
  shot "tiktok-slide-$n-1080x1920.png" 1080,1920 "tiktok-slides.html?p=$n"
done
shot ../../docs/og-v2.png 1200,630 "og.html"
cp ../../docs/og-v2.png ../../docs/og.png
ls -1 *.png
