const userAgent = process.env.npm_config_user_agent ?? "";
const execPath = process.env.npm_execpath ?? "";

if (userAgent.includes("pnpm/") || execPath.includes("pnpm")) {
    process.exit(0);
}

console.error("");
console.error("This project uses pnpm.");
console.error("");
console.error("Please run:");
console.error("");
console.error("  npm run setup");
console.error("");
console.error("After setup, use pnpm commands instead of npm commands:");
console.error("");
console.error("  pnpm install");
console.error("  pnpm build");
console.error("  pnpm deploy:server");
console.error("");

process.exit(1);
