# A Linux to check this on, because there was not one.
#
# Everything here is written on macOS, and the Linux half of it was argument
# rather than evidence until this file existed. Three of the four bugs it found
# were invisible from macOS by construction:
#
#   - `xterm -e node …` does not return. It *is* the terminal, so the launcher
#     has to detach it. Every macOS launcher is a client that exits in
#     milliseconds, so a five second timeout looked harmless there and killed
#     the pane here.
#   - Debian's chafa is 1.14.5 and does not know the `octant` symbol tag. chafa
#     exiting is the renderer exiting: the pane opened and died instantly.
#   - xterm takes its encoding from the locale, and with none set it renders
#     every block character as the Latin-1 reading of its UTF-8 bytes.
#
# Xvfb and ImageMagick are here so the sprite can be *looked at* rather than
# inferred from bytes — `xwd -root | magick xwd:- shot.png` is the whole trick,
# and it is the only reason the mojibake was noticed at all.
#
#   docker build -t pokemanion-linux test/linux
#   docker run -d --name pkmn -v "$PWD":/src:ro pokemanion-linux sleep infinity
#   docker exec pkmn sh -c 'mkdir -p /app && cd /src && tar cf - --exclude=.state --exclude=.git . | (cd /app && tar xf -)'
#   docker exec -d pkmn sh -c 'Xvfb :99 -screen 0 1200x400x24'
#   docker exec -w /app pkmn sh -c 'node src/smoke.mjs'
#
# The suite reports one check fewer than macOS: "every resident sprite is
# committed" asks git which files are tracked, and the copy above deliberately
# leaves .git behind — so it is not a checkout, and that check skips itself.
# Everything it would have caught is about what is committed, which is a
# question for the machine holding the repository rather than for this one.
#
# For the pane, setup has to run first — a pane whose install is not registered
# stands itself down after two seconds, which is deliberate and looks exactly
# like a crash. A stub `claude` on PATH is enough to be found:
#
#   docker exec pkmn sh -c 'printf "#!/bin/sh\n" > /usr/local/bin/claude; chmod +x /usr/local/bin/claude'
#   docker exec -w /app pkmn sh -c 'SHELL=/bin/bash node src/setup.mjs'
#   docker exec -w /app pkmn sh -c 'DISPLAY=:99 node src/companion.mjs demo'
#   docker exec pkmn sh -c 'DISPLAY=:99 xwd -root | magick xwd:- /tmp/shot.png'
#   docker cp pkmn:/tmp/shot.png .

FROM node:22-trixie-slim

# chafa draws the sprite; tmux and xterm are two of the launchers; Xvfb gives
# xterm somewhere to open; imagemagick turns the display into a PNG. The fonts
# matter more than they look: without them every block character is a rectangle,
# which is indistinguishable from the sprite being broken.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chafa tmux xterm xvfb x11-utils imagemagick \
      fonts-dejavu-core git procps ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
