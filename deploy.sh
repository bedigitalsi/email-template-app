#!/usr/bin/env bash
HOST="152.89.234.40"
USER="bedigital"
PORT=5050
APP_DIR="/home/bedigital/nodeapps/email-template-app"

cd /Users/sandibenec/Desktop/demo-app/email-template-app || exit 1
npm run build || exit 1
rsync -e "ssh -p $PORT" -avz --delete dist/ "$USER@$HOST:$APP_DIR/dist/" || exit 1
# Uncomment these if backend files changed:
# rsync -e "ssh -p $PORT" -avz server.js package.json package-lock.json "$USER@$HOST:$APP_DIR/" || exit 1
# ssh -p $PORT $USER@$HOST "cd $APP_DIR && (npm ci --omit=dev || npm install --omit=dev)" || exit 1
ssh -p $PORT $USER@$HOST "mkdir -p $APP_DIR/tmp && touch $APP_DIR/tmp/restart.txt" || exit 1
echo "Deployed. Health:" && curl -s https://emailapp.bedigital.si/api/health
