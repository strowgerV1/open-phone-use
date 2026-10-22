#!/bin/sh
set -eu
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
for i in 1 2 3 4 5; do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 1
done
fluxbox >/tmp/fluxbox.log 2>&1 &
xterm -title 'STROWGER dedicated Linux desktop' &
wait
