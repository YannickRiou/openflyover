#!/bin/bash
# Usage: run-stills.sh <repo> <outdir>   (needs a real GPU; see HANDOVER.md). Fresh browser per variant.
set -e
R=$1; O=$2; D=$(dirname "$0")
for v in before-atm after-atm before-noatm after-noatm; do
  node "$D/fresh.mjs" "$R" "$O" $v
done
# side by side, before | after, per film moment
for a in atm noatm; do for i in 1 2 3; do
  ffmpeg -y -loglevel error -i "$O/before-$a-$i.png" -i "$O/after-$a-$i.png" -filter_complex hstack "$O/avant-apres-$a-$i.png"
done; done
