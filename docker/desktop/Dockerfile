FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends xvfb fluxbox xterm xdotool imagemagick fonts-dejavu-core x11-utils && rm -rf /var/lib/apt/lists/* && useradd -m -u 1000 agent
# A decorative wallpaper helper must never open a dialog over agent input.
RUN mv /usr/bin/fbsetbg /usr/bin/fbsetbg.original && printf '#!/bin/sh\nexit 0\n' > /usr/bin/fbsetbg && chmod 755 /usr/bin/fbsetbg
USER agent
ENV DISPLAY=:99
COPY start.sh /start.sh
ENTRYPOINT ["/bin/sh", "/start.sh"]
