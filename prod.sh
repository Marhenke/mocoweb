#!/bin/sh
export PATH="/Users/marlenehenke/.nvm/versions/node/v24.17.0/bin:$PATH"
if [ -f .env ]; then
	set -a
	. ./.env
	set +a
fi
npm run build && exec node build
