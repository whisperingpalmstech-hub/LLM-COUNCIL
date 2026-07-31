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

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app/data

# User
USER node

EXPOSE 3000

# Start script
CMD ["sh", "-c", "npm run migrate && npm start"]
