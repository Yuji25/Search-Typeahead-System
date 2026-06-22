# ============================================================
# Backend Dockerfile
# ============================================================
# Multi-stage not needed for Node.js; single stage is clean.
# We use node:20-alpine for a small production image.
# ============================================================

FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first (layer caching — reinstall only if deps change)
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for nodemon if needed)
RUN npm install --omit=dev

# Copy the rest of the backend source
COPY . .

# Expose the port the Express server listens on
EXPOSE 3001

# Default command: start the server
CMD ["node", "src/server.js"]
