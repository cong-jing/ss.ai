import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const DEV_SERVER_TARGET = "http://127.0.0.2:8999";

export default defineConfig({
    plugins: [vue()],
    resolve: {
        conditions: ["source"],
    },
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/v1/chat/stream": {
                target: DEV_SERVER_TARGET,
                changeOrigin: true,
                // Disable Vite's response buffering so SSE chunks are forwarded immediately
                configure(proxy) {
                    proxy.on("proxyRes", (proxyRes) => {
                        proxyRes.headers["cache-control"] = "no-cache, no-transform";
                        proxyRes.headers["x-accel-buffering"] = "no";
                    });
                }
            },
            "/v1": {
                target: DEV_SERVER_TARGET,
                changeOrigin: true
            },
            "/health": {
                target: DEV_SERVER_TARGET,
                changeOrigin: true
            }
        }
    },
    build: {
        outDir: "dist",
        emptyOutDir: true
    }
});
