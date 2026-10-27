#!/usr/bin/env sh
set -e
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; then
  echo "Node.js 22.18 or newer is required: https://nodejs.org/"
  exit 1
fi
[ -f .env ] || { cp .env.example .env; echo "Created .env — add provider keys to use real models (mock council until then)."; }
npm install
npm run build
(open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true) &
npm start
