module.exports = { apps: [ { name: "restaurant-pos", script: "node_modules/next/dist/bin/next", args: "start", cwd: __dirname, windowsHide: true, autorestart: true, watch: false } ] };
