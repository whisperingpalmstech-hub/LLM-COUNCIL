FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Environment
ENV NODE_ENV=production
ENV DATABASE_URL=./data/synod.sqlite

# The runtime is non-root. Own the copied application so restrictive source
# modes from a developer workstation cannot make imports unreadable in-image.
RUN mkdir -p /app/data && chown -R node:node /app

# User
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Start script
CMD ["sh", "-c", "npm run migrate && npm start"]
