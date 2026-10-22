FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends xvfb fluxbox xterm xdotool imagemagick fonts-dejavu-core x11-utils && rm -rf /var/lib/apt/lists/* && useradd -m -u 1000 agent
USER agent
ENV DISPLAY=:99
COPY start.sh /start.sh
ENTRYPOINT ["/bin/sh", "/start.sh"]
