#!/usr/bin/env sh
set -e
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required. Install it from https://nodejs.org/"
  exit 1
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit it later to add real provider keys."
fi
npm install
npm run migrate
npm run seed
(open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true)
npm start
