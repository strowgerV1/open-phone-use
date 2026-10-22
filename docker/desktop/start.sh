#!/bin/sh
set -eu
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
for i in 1 2 3 4 5; do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 1
done
mkdir -p /home/agent/.fluxbox /tmp/strowger-fluxbox
printf 'session.screen0.rootCommand: /bin/true\nsession.screen0.toolbar.visible: false\nsession.screen0.focusModel: ClickFocus\n' > /tmp/strowger-fluxbox/init
fluxbox -rc /tmp/strowger-fluxbox/init >/tmp/fluxbox.log 2>&1 &
for i in 1 2 3 4 5; do
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | sed -n '/window id # 0x[1-9a-f]/p' | read -r wm_ready; then break; fi
  sleep 1
done
xterm -title 'STROWGER dedicated Linux desktop' -geometry 110x35+50+40 -bg '#101810' -fg '#dcfca4' &
for i in 1 2 3 4 5; do
  if xdotool search --onlyvisible --name 'STROWGER dedicated Linux desktop' >/dev/null 2>&1; then
    touch /tmp/strowger-desktop-ready
    break
  fi
  sleep 1
done
wait
