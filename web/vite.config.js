const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");

module.exports = defineConfig({
    root: __dirname,
    plugins: [react()],
    build: {
        outDir: "../public",
        emptyOutDir: false
    },
    server: {
        proxy: {
            "/api": "http://localhost:3000",
            "/socket.io": {
                target: "ws://localhost:3000",
                ws: true
            }
        }
    }
});
