# ============================================================
# Frontend Dockerfile — Two-Stage Build
# ============================================================
# Stage 1: Build the Vite React app (node:20-alpine)
# Stage 2: Serve the built static files via nginx
#
# Why two stages?
#   - Stage 1 produces the /dist folder
#   - Stage 2 copies only /dist into a tiny nginx image
#   - Final image has NO Node.js, NO node_modules → very small
# ============================================================

# ----------- Stage 1: Build -----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies
RUN npm install

# Copy source files
COPY . .

# Build the production bundle (outputs to /app/dist)
RUN npm run build

# ----------- Stage 2: Serve with nginx -----------
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built React app from Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
